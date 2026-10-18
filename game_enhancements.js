/**
 * Teleoperator Open-World San Francisco Driving Game
 * Game Enhancements Module (M2, M3, M4)
 * 
 * M2: Graphics & Atmosphere (Day/Night, Weather, Road Wetness, Neon Underglow, Exhaust & Nitro Flames, Camera Shake, Speedometer Blur)
 * M3: Fleet & Physics (Police Interceptor, Classic Muscle, Arcade vs Simulator Handling, Turntable Garage Carbon Fiber & Window Tint)
 * M4: Map, Navigation & Bridges (Active 3D GPS Guidance Ribbon, Bridge Scenic Viewpoints, Map Fast Travel & POI Garage Badges)
 */

(function (global) {
  'use strict';

  // State containers
  const state = {
    initialized: false,
    handlingMode: 'arcade', // 'arcade' | 'simulator'
    underglow: {
      color: '#00f0ff',
      intensity: 1.5,
      enabled: false,
      group: null,
      mesh: null,
      light: null
    },
    timeOfDay: {
      time: 14.0, // 0-24h
      weather: 'clear', // 'clear' | 'rain' | 'fog'
      cycleSpeed: 0.02, // hours per real-time second (~20 min full cycle)
      wetness: 0.0,
      nightFactor: 0.0,
      sunEl: 40.0
    },
    gps: {
      active: false,
      destination: null, // { x, z, label }
      waypoints: [],
      ribbonMesh: null,
      beaconMesh: null,
      lastPlayerPos: null
    },
    tint: {
      current: null // 'light' | 'medium' | 'dark' | 'limo'
    },
    particles: {
      exhaustFlames: [],
      flameLight: null,
      active: false
    },
    cameraShake: {
      intensity: 0.0,
      decay: 8.0
    },
    scenicViewpoints: [
      {
        id: 'ggb_north',
        name: 'Golden Gate Vista Point (North)',
        x: -7545,
        y: 72,
        z: -3325,
        desc: 'Panoramic overlook of the Golden Gate Strait and San Francisco skyline'
      },
      {
        id: 'ggb_south',
        name: 'Golden Gate Welcome Center (Presidio)',
        x: -7392,
        y: 68,
        z: -1700,
        desc: 'Historic Presidio overlook at the southern bridge anchor'
      },
      {
        id: 'bay_tunnel',
        name: 'Yerba Buena Island Lookout',
        x: 2307,
        y: 55,
        z: -1392,
        desc: 'Scenic tunnel portal overlook across the East Bay and San Francisco harbor'
      },
      {
        id: 'bay_pier',
        name: 'Bay Bridge Pier 24 Waterfront',
        x: 260,
        y: 15,
        z: 1020,
        desc: 'Embarcadero waterfront vista under the bridge suspension spans'
      },
      {
        id: 'twin_peaks',
        name: 'Twin Peaks 360 Summit',
        x: -150,
        y: 275,
        z: 450,
        desc: 'Highest panoramic viewpoint in central San Francisco'
      }
    ],
    garages: [
      {
        id: 'garage_downtown',
        name: 'Downtown Central Garage',
        x: -240,
        y: 25,
        z: 420,
        desc: 'Full-service tuning studio and vehicle showroom'
      },
      {
        id: 'garage_mission',
        name: 'Mission District Custom Studio',
        x: -650,
        y: 18,
        z: 980,
        desc: 'Custom paint, carbon fiber wraps, and suspension tuning'
      },
      {
        id: 'garage_marina',
        name: 'Marina Speed & Performance',
        x: -1420,
        y: 8,
        z: -1100,
        desc: 'High-speed dyno testing and track alignments'
      }
    ]
  };

  // Helper: color parsing
  const COLOR_MAP = {
    cyan: 0x00f0ff,
    magenta: 0xff007f,
    lime: 0x39ff14,
    red: 0xff1122,
    gold: 0xffb700,
    purple: 0x9d00ff,
    white: 0xffffff,
    blue: 0x0066ff,
    green: 0x00ff66,
    yellow: 0xffff00,
    orange: 0xff6600
  };

  function parseHexColor(input) {
    if (typeof input === 'number') return input;
    if (typeof input === 'string') {
      const lower = input.toLowerCase().trim();
      if (COLOR_MAP[lower] !== undefined) return COLOR_MAP[lower];
      if (lower.startsWith('#')) return parseInt(lower.slice(1), 16);
      if (lower.startsWith('0x')) return parseInt(lower.slice(2), 16);
      const parsed = parseInt(lower, 16);
      if (!isNaN(parsed)) return parsed;
    }
    return 0x00f0ff; // default cyan
  }

  // Helper: Three.js constructor resolver from engine instances
  function resolveThreeConstructors(sf) {
    const scene = sf.scene;
    const camera = sf.camera;
    const guide = sf.guide;

    const BufferGeometry = guide?.g?.constructor || (sf.car?.model?.geometry?.constructor);
    const BufferAttribute = guide?.g?.attributes?.position?.constructor;
    const MeshBasicMaterial = guide?.mesh?.material?.constructor;
    const Mesh = guide?.mesh?.constructor;
    const Vector3 = camera?.position?.constructor;
    const Group = scene?.constructor ? scene.constructor : (sf.car?.root?.constructor);

    return {
      BufferGeometry,
      BufferAttribute,
      MeshBasicMaterial,
      Mesh,
      Vector3,
      Group
    };
  }

  // =========================================================================
  // M2: GRAPHICS, ATMOSPHERE, NEON, PARTICLES & CAMERA DYNAMICS
  // =========================================================================

  function initAtmosphereAndWeather(sf) {
    const presets = sf.PRESETS || {};

    const timeOfDayObj = {
      get time() {
        return state.timeOfDay.time;
      },
      set time(v) {
        state.timeOfDay.time = (v % 24 + 24) % 24;
        updateAtmosphere(sf, 0);
      },
      get weather() {
        return state.timeOfDay.weather;
      },
      set weather(v) {
        state.timeOfDay.weather = v;
      },
      get cycleSpeed() {
        return state.timeOfDay.cycleSpeed;
      },
      set cycleSpeed(v) {
        state.timeOfDay.cycleSpeed = Math.max(0, +v || 0);
      },
      setTime: function (t) {
        timeOfDayObj.time = t;
      },
      setWeather: function (w) {
        timeOfDayObj.weather = w;
      }
    };

    sf.timeOfDay = timeOfDayObj;
    sf.setTime = function (t) { timeOfDayObj.setTime(t); };
    sf.setWeather = function (w) { timeOfDayObj.setWeather(w); };

    // Load initial preference
    try {
      const savedTime = localStorage.getItem('sf-drive.tod.time');
      if (savedTime !== null) state.timeOfDay.time = parseFloat(savedTime) || 14.0;
      const savedWeather = localStorage.getItem('sf-drive.tod.weather');
      if (savedWeather) state.timeOfDay.weather = savedWeather;
    } catch (_) {}
  }

  function updateAtmosphere(sf, dt) {
    const tod = state.timeOfDay;

    // Advance clock
    if (tod.cycleSpeed > 0 && dt > 0) {
      tod.time = (tod.time + tod.cycleSpeed * dt) % 24;
    }

    const t = tod.time;

    // Calculate Sun Elevation: peak +55 deg at 13:00, lowest -45 deg at 01:00
    // Normalized 24h sine: noon (12:00) is peak positive, 00:00 is peak negative
    const sunAngleRad = ((t - 6) / 12) * Math.PI;
    tod.sunEl = 55.0 * Math.sin(sunAngleRad);

    // Calculate Night Factor (0.0 = day, 1.0 = deep night)
    // Night starts ramping at 18:30 (dusk) to full night at 20:30.
    // Dawn starts at 05:00 and reaches full day at 07:00.
    let nightFactor = 0.0;
    if (t >= 20.5 || t < 5.0) {
      nightFactor = 1.0;
    } else if (t >= 18.5 && t < 20.5) {
      nightFactor = (t - 18.5) / 2.0;
    } else if (t >= 5.0 && t < 7.0) {
      nightFactor = 1.0 - (t - 5.0) / 2.0;
    } else {
      nightFactor = 0.0;
    }
    tod.nightFactor = nightFactor;

    // Weather wetness accumulation & drying curves
    const isRaining = tod.weather === 'rain';
    const isFoggy = tod.weather === 'fog';

    if (isRaining) {
      // Rain accumulation curve
      tod.wetness = Math.min(1.0, tod.wetness + dt * 0.08);
    } else {
      // Natural drying curve
      const drySpeed = 0.02 * (1.0 + Math.max(0, tod.sunEl / 40.0));
      tod.wetness = Math.max(0.0, tod.wetness - dt * drySpeed);
    }

    const damp = Math.max(isFoggy ? 0.4 : 0.0, tod.wetness * 0.85);

    // Update Renderer wetness uniform
    if (sf.mb) {
      sf.mb.carWet = tod.wetness;
      if (isRaining) {
        sf.mb.rainIntensity = Math.min(1.0, tod.wetness * 1.2);
      }
    }

    // Update Road Materials in Scene
    if (sf.scene) {
      const roadColorR = damp;
      const roadColorG = tod.wetness;
      const roadColorB = nightFactor;

      sf.scene.traverse(function (obj) {
        if (!obj.isMesh || !obj.material) return;
        const mat = obj.material;
        const name = (mat.name || obj.name || '').toLowerCase();
        if (
          name.includes('road') ||
          name.includes('asphalt') ||
          name.includes('deck') ||
          name.includes('tunnel') ||
          name.includes('highway')
        ) {
          if (mat.color && typeof mat.color.setRGB === 'function') {
            mat.color.setRGB(roadColorR, roadColorG, roadColorB);
          }
        }
      });
    }

    // Automatic Streetlights & Vehicle Headlights / Taillights
    const lightsActive = nightFactor > 0.3 || tod.wetness > 0.2 || isFoggy;
    if (sf.car && typeof sf.setLamps === 'function') {
      sf.setLamps(sf.car, {
        head: lightsActive ? 1.0 : 0.0,
        tail: lightsActive ? 1.0 : 0.35,
        signal: 0
      });
    }

    // Streetlights in world
    if (sf.scene && sf.scene.userData) {
      sf.scene.userData.nightFactor = nightFactor;
    }
  }

  function initUnderglow(sf) {
    sf.underglow = state.underglow;

    sf.setUnderglow = function (colorHex, intensity) {
      if (colorHex === false || colorHex === null || intensity === 0) {
        state.underglow.enabled = false;
        if (state.underglow.group) state.underglow.group.visible = false;
        return;
      }

      state.underglow.enabled = true;
      state.underglow.color = colorHex;
      state.underglow.intensity = intensity !== undefined ? +intensity : 1.5;

      applyUnderglow(sf);
    };

    // If car changes, re-attach underglow
    const origSwapCar = sf.swapCar;
    if (typeof origSwapCar === 'function') {
      sf.swapCar = function (id) {
        const res = origSwapCar.apply(this, arguments);
        if (res && typeof res.then === 'function') {
          return res.then(function (val) {
            if (state.underglow.enabled) {
              setTimeout(() => applyUnderglow(sf), 100);
            }
            return val;
          });
        }
        if (state.underglow.enabled) {
          setTimeout(() => applyUnderglow(sf), 100);
        }
        return res !== undefined ? res : true;
      };
    }
  }

  function applyUnderglow(sf) {
    if (!sf.car || !sf.car.root) return;
    const carRoot = sf.car.root;
    const colorVal = parseHexColor(state.underglow.color);
    const intensity = state.underglow.intensity;

    // Check if underglow group already attached
    let group = carRoot.getObjectByName('UnderglowGroup');
    if (!group) {
      const constructors = resolveThreeConstructors(sf);
      if (!constructors.BufferGeometry || !constructors.Mesh) return;

      group = new (constructors.Group || sf.scene.constructor)();
      group.name = 'UnderglowGroup';
      group.position.set(0, 0.12, 0.1);

      // Create glowing neon under-chassis plane
      const geom = new constructors.BufferGeometry();
      const hw = 0.95; // half width
      const hl = 1.95; // half length
      const pos = new Float32Array([
        -hw, 0, -hl,
         hw, 0, -hl,
        -hw, 0,  hl,
         hw, 0,  hl
      ]);
      const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
      const normals = new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0]);
      const indices = new Uint16Array([0, 2, 1, 2, 3, 1]);

      geom.setAttribute('position', new constructors.BufferAttribute(pos, 3));
      geom.setAttribute('uv', new constructors.BufferAttribute(uvs, 2));
      geom.setAttribute('normal', new constructors.BufferAttribute(normals, 3));
      geom.setIndex(new constructors.BufferAttribute(indices, 1));

      // Neon shader / basic additive material
      const mat = new constructors.MeshBasicMaterial();
      mat.color.setHex(colorVal);
      mat.transparent = true;
      mat.opacity = 0.82;
      mat.depthWrite = false;

      const mesh = new constructors.Mesh(geom, mat);
      mesh.name = 'UnderglowMesh';
      mesh.renderOrder = 2;
      group.add(mesh);

      // Downward point light
      if (typeof window !== 'undefined' && sf.scene) {
        // Find existing light constructor from scene or create via light class
        let LightClass = null;
        sf.scene.traverse(function (node) {
          if (!LightClass && node.isLight && node.isPointLight) {
            LightClass = node.constructor;
          }
        });
        if (!LightClass) {
          // Fallback to searching directional or spotlight
          sf.scene.traverse(function (node) {
            if (!LightClass && node.isLight) {
              LightClass = node.constructor;
            }
          });
        }
        if (LightClass) {
          try {
            const light = new LightClass(colorVal, intensity * 2.2, 5.5);
            light.name = 'UnderglowLight';
            light.position.set(0, 0.15, 0);
            group.add(light);
            state.underglow.light = light;
          } catch (_) {}
        }
      }

      carRoot.add(group);
      state.underglow.group = group;
      state.underglow.mesh = mesh;
    } else {
      // Update existing colors
      const mesh = group.getObjectByName('UnderglowMesh');
      if (mesh && mesh.material) {
        mesh.material.color.setHex(colorVal);
        mesh.material.opacity = 0.82 * Math.min(1.0, intensity);
      }
      const light = group.getObjectByName('UnderglowLight');
      if (light) {
        if (light.color) light.color.setHex(colorVal);
        light.intensity = intensity * 2.2;
      }
      group.visible = state.underglow.enabled;
    }
  }

  function initCameraAndHUD(sf) {
    // 1. Camera impact shake trigger
    sf.triggerImpactShake = function (intensity) {
      state.cameraShake.intensity = Math.min(3.0, (state.cameraShake.intensity || 0) + (intensity || 1.0));
      if (sf.cc) {
        sf.cc.shake = Math.min(2.5, (sf.cc.shake || 0) + (intensity || 1.0) * 1.2);
      }
    };

    // 2. Dynamic speedometer blur styling on high speed
    // 3. Collision and jump impact detection loop
  }

  function updateCameraAndHUD(sf, dt) {
    const v = sf.v;
    if (!v) return;

    // Detect collision impact
    if (v.impact > 0.04) {
      const impactMagnitude = Math.min(2.0, v.impact * 2.5);
      sf.triggerImpactShake(impactMagnitude);
    }

    // Detect jump landing
    if (v.airTime > 0.25 && v.onGround && v.landing > 0.05) {
      const landingMagnitude = Math.min(1.8, v.landing * 1.5);
      sf.triggerImpactShake(landingMagnitude);
    }

    // Speedometer motion blur styling (>120 km/h)
    if (typeof document !== 'undefined') {
      const dial = document.getElementById('dial') || document.querySelector('.dial') || document.querySelector('.gauge');
      if (dial) {
        const speed = Math.abs(v.kmh || 0);
        if (speed > 120) {
          const ratio = Math.min(1.0, (speed - 120) / 100);
          const blurPx = (ratio * 4.5).toFixed(1);
          dial.style.filter = `blur(${blurPx}px) drop-shadow(0 0 10px rgba(0, 240, 255, 0.65))`;
          dial.style.transform = `scale(${1.0 + ratio * 0.04})`;
          dial.style.transition = 'filter 0.08s ease-out, transform 0.08s ease-out';
        } else if (dial.style.filter) {
          dial.style.filter = '';
          dial.style.transform = '';
        }
      }
    }

    // Renderer high-speed radial motion blur
    if (sf.mb) {
      const speed = Math.abs(v.kmh || 0);
      if (speed > 130) {
        const extraBlur = Math.min(0.22, ((speed - 130) / 180) * 0.2);
        sf.mb.radialBlur = Math.max(sf.mb.radialBlur || 0, extraBlur);
      }
    }
  }

  function updateParticlesAndFlames(sf, dt) {
    const v = sf.v;
    const car = sf.car;
    if (!v || !car || !car.root) return;

    const fullThrottle = v.throttle > 0.95 && (v.rpm || 0) > 6000;
    const nitroActive = !!v.nitroOn;

    // Exhaust flames at full throttle / nitro
    if (fullThrottle || nitroActive) {
      // Ensure exhaust flame meshes exist on active car
      let flameGroup = car.root.getObjectByName('ExhaustPlumes');
      if (!flameGroup) {
        const constructors = resolveThreeConstructors(sf);
        if (constructors.BufferGeometry && constructors.Mesh) {
          flameGroup = new (constructors.Group || sf.scene.constructor)();
          flameGroup.name = 'ExhaustPlumes';

          // Create dual exhaust cones
          const geom = new constructors.BufferGeometry();
          const p = [
            // Left cone
            -0.38, 0.32, 2.3,   -0.38, 0.42, 2.3,   -0.38, 0.37, 2.85,
            -0.42, 0.37, 2.3,   -0.34, 0.37, 2.3,   -0.38, 0.37, 2.85,
            // Right cone
             0.38, 0.32, 2.3,    0.38, 0.42, 2.3,    0.38, 0.37, 2.85,
             0.34, 0.37, 2.3,    0.42, 0.37, 2.3,    0.38, 0.37, 2.85
          ];
          geom.setAttribute('position', new constructors.BufferAttribute(new Float32Array(p), 3));
          geom.computeVertexNormals();

          const mat = new constructors.MeshBasicMaterial();
          mat.transparent = true;
          mat.depthWrite = false;
          mat.opacity = 0.9;

          const flameMesh = new constructors.Mesh(geom, mat);
          flameMesh.name = 'FlameMesh';
          flameGroup.add(flameMesh);

          car.root.add(flameGroup);
        }
      }

      if (flameGroup) {
        flameGroup.visible = true;
        const flameMesh = flameGroup.getObjectByName('FlameMesh');
        if (flameMesh && flameMesh.material) {
          // Blue/cyan for nitro, fiery orange/yellow for V8 backfire
          if (nitroActive) {
            flameMesh.material.color.setHex(0x00d0ff);
            flameMesh.scale.set(1.1, 1.1, 1.4 + Math.random() * 0.4);
          } else {
            flameMesh.material.color.setHex(0xff7700);
            flameMesh.scale.set(0.9, 0.9, 1.0 + Math.random() * 0.3);
          }
        }
      }
    } else {
      const flameGroup = car.root.getObjectByName('ExhaustPlumes');
      if (flameGroup) {
        flameGroup.visible = false;
      }
    }

    // Extended tire smoke & skid marks on drift or heavy braking
    const isDrifting = Math.abs(v.beta || 0) > 0.12 || (v.drift || 0) > 0.2;
    const isBrakingHard = (v.brake || 0) > 0.45 && (v.speed || 0) > 6;
    if (isDrifting || isBrakingHard) {
      if (sf.brk && sf.brk.fx) {
        const fx = sf.brk.fx;
        // Inject dense smoke particles
        if (typeof fx.smoke === 'function') {
          fx.smoke(v.pos.x, v.pos.y + 0.2, v.pos.z, isDrifting ? 1.5 : 1.0);
        }
      }
    }
  }

  // =========================================================================
  // M3: FLEET & PHYSICS CUSTOMIZATION
  // =========================================================================

  function initFleetAndPhysics(sf) {
    sf.hs = sf.hs || {};
    const hs = sf.hs;
    const baseCorvette = hs.corvette || hs.ferrari || hs.waymo || {};
    const baseSpec = baseCorvette.spec || {};

    // 1. Playable Police Interceptor V8
    if (!hs.police) {
      hs.police = {
        id: 'police',
        name: 'SFPD Interceptor',
        model: 'Police Interceptor V8',
        maker: 'SFPD Highway Patrol',
        mass: 1950,
        topSpeed: 265,
        drive: 'awd',
        siren: true,
        dir: baseCorvette.dir || 'assets/car/',
        glb: baseCorvette.glb || 'corvette.glb',
        meta: baseCorvette.meta || 'corvette.json',
        tex: baseCorvette.tex || [],
        load: baseCorvette.load,
        spec: {
          ...baseSpec,
          mass: 1950,
          power: 520000,
          rearGrip: 1.18,
          maxSpeedKmh: 320,
          nitroMax: 1.5,
          nitroRefill: 0.22,
          idle: baseSpec.idle || 800,
          vmax: 88, // ~316 km/h
          name: 'Police Interceptor'
        },
        sound: 'v8tt',
        cam: null,
        hl: [0.6, 0.62, -1.95],
        orbit: { R: 6.6, h: 1.45, look: 0.55 },
        stats: [
          ['680 hp', 'Supercharged V8'],
          ['3.2 s', '0-100 km/h'],
          ['320 km/h', 'top speed']
        ],
        drives: 'Heavy-duty highway pursuit interceptor with bullbar, pursuit suspension, high-speed sirens and flashing lightbar.',
        accent: '#0066cc'
      };
    } else {
      if (!hs.police.mass) hs.police.mass = 1950;
      if (!hs.police.topSpeed) hs.police.topSpeed = 265;
    }

    // 2. Playable Classic V8 Muscle Car
    if (!hs.muscle) {
      hs.muscle = {
        id: 'muscle',
        name: 'V8 Muscle',
        model: 'Classic Fastback 1969',
        maker: 'Detroit V8',
        mass: 1680,
        topSpeed: 240,
        drive: 'rwd',
        driftBias: 0.85,
        dir: baseCorvette.dir || 'assets/car/',
        glb: baseCorvette.glb || 'corvette.glb',
        meta: baseCorvette.meta || 'corvette.json',
        tex: baseCorvette.tex || [],
        load: baseCorvette.load,
        spec: {
          ...baseSpec,
          mass: 1680,
          power: 450000,
          rearGrip: 0.90, // looser rear end for power-slides
          maxSpeedKmh: 285,
          nitroMax: 1.2,
          nitroRefill: 0.18,
          idle: baseSpec.idle || 750,
          vmax: 79, // ~284 km/h
          name: 'Classic Muscle'
        },
        sound: 'corvette',
        cam: null,
        hl: [0.6, 0.62, -1.95],
        orbit: { R: 6.6, h: 1.45, look: 0.55 },
        stats: [
          ['520 hp', '7.0L 427ci Big Block V8'],
          ['3.8 s', '0-100 km/h'],
          ['285 km/h', 'top speed']
        ],
        drives: 'Raw American iron: loud 7.0-litre big-block V8, heavy rear-wheel-drive torque, instant burnouts and thundering exhaust roar.',
        accent: '#ff9900'
      };
    } else {
      if (!hs.muscle.mass) hs.muscle.mass = 1680;
      if (!hs.muscle.topSpeed) hs.muscle.topSpeed = 240;
    }

    // Ensure added to e2 unlocked array on sf and global
    sf.e2 = sf.e2 || global.e2 || [];
    if (!sf.e2.includes('police')) sf.e2.push('police');
    if (!sf.e2.includes('muscle')) sf.e2.push('muscle');
    if (global.e2 && Array.isArray(global.e2)) {
      if (!global.e2.includes('police')) global.e2.push('police');
      if (!global.e2.includes('muscle')) global.e2.push('muscle');
    }

    // Ensure sf.swapCar works if not already defined
    if (typeof sf.swapCar !== 'function') {
      sf.swapCar = function (id) {
        if (sf.hs && sf.hs[id]) {
          sf.carId = id;
          return true;
        }
        return false;
      };
    }

    // Add to ICE engine set (lM)
    if (global.lM && typeof global.lM.add === 'function') {
      global.lM.add('police');
      global.lM.add('muscle');
    }

    // 3. Arcade vs Simulator Handling Switch
    sf.setHandlingMode = function (mode) {
      const targetMode = mode === 'simulator' ? 'simulator' : 'arcade';
      state.handlingMode = targetMode;
      sf.handlingMode = targetMode;
      sf.handlingParams = {
        mode: targetMode,
        nitroRechargeRate: targetMode === 'arcade' ? 2.0 : 1.0,
        rearGrip: targetMode === 'arcade' ? 1.26 : 1.0,
        slipMultiplier: targetMode === 'arcade' ? 0.6 : 1.0
      };

      const v = sf.v;
      if (v && v.S) {
        if (targetMode === 'arcade') {
          // Arcade: Higher lateral grip, assisted drift initiation, fast counter-steer, faster nitro regeneration
          v.S.rearGrip = 1.26;
          v.S.nitroRefill = 0.35; // 2x nitro refill rate
          v.assists = {
            tcs: true,
            esp: true,
            steering: true,
            abs: true
          };
          if (sf.toast) sf.toast('Handling: Arcade', 'High grip · assisted drift · rapid nitro refill');
        } else {
          // Simulator: Realistic Pacejka tire slip angles, required throttle modulation, manual traction control / ABS
          v.S.rearGrip = 1.0;
          v.S.nitroRefill = 0.16; // Standard refill
          v.assists = {
            tcs: false,
            esp: false,
            steering: false,
            abs: true
          };
          if (sf.toast) sf.toast('Handling: Simulator', 'Raw physics · Pacejka tire slip · manual throttle modulation');
        }
      }

      try {
        localStorage.setItem('sf-drive.handlingMode', targetMode);
      } catch (_) {}

      return targetMode;
    };

    // Initialize with saved or default handling mode
    try {
      const savedMode = localStorage.getItem('sf-drive.handlingMode');
      sf.setHandlingMode(savedMode || 'arcade');
    } catch (_) {
      sf.setHandlingMode('arcade');
    }

    // 4. Turntable Garage Customization (Carbon fiber & Window Tint)
    initGarageEnhancements(sf);
  }

  function initGarageEnhancements(sf) {
    // Add carbon fiber finish to finish registry kp on sf and global
    sf.kp = sf.kp || global.kp || {};
    const carbonSpec = {
      id: 'carbon',
      key: 'k',
      name: 'Carbon Fiber',
      sub: 'Exposed woven carbon composite',
      roughness: 0.35,
      metalness: 0.1,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1,
      normalScale: 0.8,
      lvl: 1
    };

    if (Array.isArray(sf.kp)) {
      if (!sf.kp.some(f => f.id === 'carbon')) {
        sf.kp.push(carbonSpec);
      }
      sf.kp.carbon = carbonSpec;
    } else if (typeof sf.kp === 'object') {
      sf.kp.carbon = carbonSpec;
    }

    if (global.kp && Array.isArray(global.kp)) {
      if (!global.kp.some(f => f.id === 'carbon')) {
        global.kp.push(carbonSpec);
      }
      global.kp.carbon = carbonSpec;
    }

    // Add carbon fiber shader properties to nI registry
    if (global.nI && typeof global.nI === 'object') {
      if (!global.nI.carbon) {
        global.nI.carbon = {
          flakes: 0,
          flakeScale: 800,
          flakeTilt: 0.08,
          flakeMetal: 0.25,
          flakeRough: 0.25,
          baseRough: 0.25,
          baseMetal: 0.35,
          depth: 0.85,
          coat: 1.0,
          coatRough: 0.035,
          carbon: 1
        };
      }
    }

    // Window Tinting System
    const TINT_SPECS = {
      light: { opacity: 0.85, transmission: 0.45, color: 0x252e38, hex: '#252e38' },
      medium: { opacity: 0.70, transmission: 0.30, color: 0x181f28, hex: '#181f28' },
      dark: { opacity: 0.45, transmission: 0.15, color: 0x0d1218, hex: '#0d1218' },
      limo: { opacity: 0.20, transmission: 0.05, color: 0x040608, hex: '#040608' }
    };

    sf.setWindowTint = function (tintLevel) {
      if (!tintLevel || !TINT_SPECS[tintLevel]) {
        state.tint.current = null;
        return;
      }
      state.tint.current = tintLevel;
      const spec = TINT_SPECS[tintLevel];

      if (sf.car && sf.car.root) {
        sf.car.root.traverse(function (node) {
          if (!node.isMesh || !node.material) return;
          const mat = node.material;
          const name = (mat.name || node.name || '').toLowerCase();
          const isGlass =
            name.includes('glass') ||
            name.includes('window') ||
            name.includes('windscreen') ||
            name.includes('windshield') ||
            mat.transmission > 0.05 ||
            (mat.transparent && mat.opacity < 0.95);

          if (isGlass) {
            mat.transparent = true;
            mat.opacity = spec.opacity;
            if (mat.transmission !== undefined) mat.transmission = spec.transmission;
            if (mat.color && typeof mat.color.setHex === 'function') {
              mat.color.setHex(spec.color);
            }
          }
        });
      }

      // Persist tint choice
      try {
        const carId = sf.carId || 'ferrari';
        localStorage.setItem(`sf-drive.tint.${carId}`, tintLevel);
      } catch (_) {}
    };

    // Reapply tint on car swap or paintCar
    const origPaintCar = sf.paintCar;
    if (typeof origPaintCar === 'function') {
      sf.paintCar = function () {
        const res = origPaintCar.apply(this, arguments);
        if (state.tint.current) {
          setTimeout(() => sf.setWindowTint(state.tint.current), 50);
        }
        return res;
      };
    }
  }

  // =========================================================================
  // M4: MAP, ACTIVE 3D GPS NAVIGATION RIBBON & BRIDGES
  // =========================================================================

  function initMapAndGPS(sf) {
    sf.gps = null;

    // 1. Active 3D GPS Navigation Ribbon (RaceCarpet)
    sf.setGPSDestination = function (x, z, label) {
      const target = { x, z, label: label || 'Destination' };
      state.gps.destination = target;
      state.gps.active = true;
      sf.gps = {
        active: true,
        target: target,
        destination: target
      };

      buildGPSRibbon(sf);

      if (sf.toast) {
        sf.toast('GPS Navigation', 'Route plotted to ' + (label || 'Destination'));
      }
    };

    sf.clearGPS = function () {
      state.gps.active = false;
      state.gps.destination = null;
      state.gps.waypoints = [];
      sf.gps = null;

      if (state.gps.ribbonMesh && state.gps.ribbonMesh.parent) {
        state.gps.ribbonMesh.parent.remove(state.gps.ribbonMesh);
        state.gps.ribbonMesh = null;
      }
      if (state.gps.beaconMesh && state.gps.beaconMesh.parent) {
        state.gps.beaconMesh.parent.remove(state.gps.beaconMesh);
        state.gps.beaconMesh = null;
      }
    };

    // 2. Scenic Viewpoints registry & Fast Travel
    sf.scenicViewpoints = state.scenicViewpoints;

    sf.teleportToViewpoint = function (viewpointId) {
      const vp = state.scenicViewpoints.find(v => v.id === viewpointId);
      if (vp && sf.tele && typeof sf.tele.go === 'function') {
        sf.tele.go({ x: vp.x, z: vp.z, y: vp.y, quiet: true });
        if (sf.toast) sf.toast(vp.name, vp.desc);
      }
    };

    // 3. Garage POIs & Map integration
    sf.garages = state.garages;

    // Wrap map POIs list to include garages & viewpoints on minimap and fullscreen map
    if (sf.map) {
      const origPois = sf.map.pois;
      sf.map.pois = function () {
        const baseMarkers = origPois ? origPois.apply(this, arguments) : [];

        // Add Garages
        const garageMarkers = state.garages.map(g => ({
          x: g.x,
          z: g.z,
          kind: 'garage',
          col: '#00f0ff',
          name: g.name,
          label: 'Garage',
          glyph: '🔧',
          stars: 0
        }));

        // Add Scenic Viewpoints
        const vistaMarkers = state.scenicViewpoints.map(v => ({
          x: v.x,
          z: v.z,
          kind: 'vista',
          col: '#ffb700',
          name: v.name,
          label: 'Scenic Vista',
          glyph: '👁️',
          stars: 0
        }));

        // Add Active GPS destination pin
        const gpsMarkers = state.gps.active && state.gps.destination
          ? [{
              x: state.gps.destination.x,
              z: state.gps.destination.z,
              kind: 'dest',
              col: '#39ff14',
              name: state.gps.destination.label,
              label: 'GPS Destination',
              glyph: '🏁',
              stars: 0
            }]
          : [];

        return [...baseMarkers, ...garageMarkers, ...vistaMarkers, ...gpsMarkers];
      };

      // Wrap map click / pick to support click-to-teleport Fast Travel
      const origOnPick = sf.map.onPick;
      sf.map.onPick = function (clickX, clickZ, radius) {
        // Check if user clicked near any garage or scenic viewpoint (fast travel)
        const allPOIs = [...state.garages, ...state.scenicViewpoints];
        const searchRadius = Math.max(radius || 40, 60);

        let nearestPOI = null;
        let minDist = searchRadius;

        for (const poi of allPOIs) {
          const d = Math.hypot(poi.x - clickX, poi.z - clickZ);
          if (d < minDist) {
            minDist = d;
            nearestPOI = poi;
          }
        }

        if (nearestPOI) {
          // Clicked directly on a POI marker: fast travel or select
          if (sf.tele && typeof sf.tele.go === 'function') {
            sf.map.setPick?.({
              x: nearestPOI.x,
              z: nearestPOI.z,
              name: nearestPOI.name
            }, 'Fast Travel · ' + nearestPOI.name);
          }
          return;
        }

        if (origOnPick) {
          return origOnPick.apply(this, arguments);
        }
      };
    }

    // 4. Fast Travel helper
    sf.fastTravel = function (target) {
      if (!sf.tele || typeof sf.tele.go !== 'function') return false;

      if (typeof target === 'string') {
        const poi = [...state.garages, ...state.scenicViewpoints].find(p => p.id === target || p.name === target);
        if (poi) {
          sf.tele.go({ x: poi.x, z: poi.z, y: poi.y || 0, quiet: true });
          if (sf.toast) sf.toast('Fast Travel', 'Teleported to ' + poi.name);
          return true;
        }
      } else if (target && typeof target.x === 'number' && typeof target.z === 'number') {
        sf.tele.go({ x: target.x, z: target.z, y: target.y || 0, quiet: true });
        if (sf.toast) sf.toast('Fast Travel', 'Teleported to waypoint');
        return true;
      }
      return false;
    };
  }

  function buildGPSRibbon(sf) {
    if (!state.gps.active || !state.gps.destination) return;
    const dest = state.gps.destination;
    const v = sf.v;
    if (!v || !sf.scene) return;

    const startX = v.pos.x;
    const startZ = v.pos.z;

    // Generate road waypoints from player to destination
    // If router available, use K0 / router, otherwise create dense interpolated road waypoints
    const waypoints = [];
    const count = 35;
    const driveHeight = (sf.real && sf.real.layout && typeof sf.real.layout.driveHeight === 'function')
      ? (x, z) => sf.real.layout.driveHeight(x, z)
      : () => v.pos.y;

    for (let i = 0; i <= count; i++) {
      const frac = i / count;
      const x = startX + (dest.x - startX) * frac;
      const z = startZ + (dest.z - startZ) * frac;
      const y = driveHeight(x, z) + 0.12;
      waypoints.push({ x, y, z });
    }
    state.gps.waypoints = waypoints;

    // Remove existing ribbon
    if (state.gps.ribbonMesh && state.gps.ribbonMesh.parent) {
      state.gps.ribbonMesh.parent.remove(state.gps.ribbonMesh);
      state.gps.ribbonMesh = null;
    }

    const constructors = resolveThreeConstructors(sf);
    if (!constructors.BufferGeometry || !constructors.Mesh) return;

    // Generate 3D Chevron Arrow Carpet (RaceCarpet style)
    // 6 vertices and 4 triangles per chevron arrow pointing along the path
    const chevronCount = Math.max(2, waypoints.length - 1);
    const posArr = [];
    const colArr = [];
    const idxArr = [];

    const chevronOffsetsX = [-1.0, 0.0, -1.0, 0.0, 1.0, 1.0];
    const chevronOffsetsZ = [-0.4, 0.25, -0.9, -0.28, -0.4, -0.9];
    const chevronTriangles = [0, 1, 2, 2, 1, 3, 4, 5, 1, 5, 3, 1];

    for (let c = 0; c < chevronCount; c++) {
      const p0 = waypoints[c];
      const p1 = waypoints[c + 1] || dest;

      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz) || 1;
      const ndx = dx / len;
      const ndz = dz / len;
      const u = -ndz; // perpendicular vector
      const w = ndx;

      const baseIdx = c * 6;

      for (let p = 0; p < 6; p++) {
        const offU = chevronOffsetsX[p] * 1.1;
        const offW = chevronOffsetsZ[p] * 1.6;
        const vx = p0.x + u * offU + ndx * offW;
        const vy = p0.y + 0.14;
        const vz = p0.z + w * offU + ndz * offW;

        posArr.push(vx, vy, vz);

        // Glowing neon cyan/gold gradient
        const alpha = Math.min(1.0, (c + 1) / chevronCount);
        colArr.push(0.0, 0.95, 1.0, 0.75 * alpha);
      }

      for (const t of chevronTriangles) {
        idxArr.push(baseIdx + t);
      }
    }

    const geom = new constructors.BufferGeometry();
    geom.setAttribute('position', new constructors.BufferAttribute(new Float32Array(posArr), 3));
    geom.setAttribute('color', new constructors.BufferAttribute(new Float32Array(colArr), 4));
    geom.setIndex(new constructors.BufferAttribute(new Uint32Array(idxArr), 1));
    geom.computeVertexNormals();

    const mat = new constructors.MeshBasicMaterial();
    mat.vertexColors = true;
    mat.transparent = true;
    mat.depthWrite = false;

    const ribbonMesh = new constructors.Mesh(geom, mat);
    ribbonMesh.name = 'RaceCarpet';
    ribbonMesh.renderOrder = 3;
    sf.scene.add(ribbonMesh);
    state.gps.ribbonMesh = ribbonMesh;

    // Destination 3D Beacon (pillar of light)
    if (!state.gps.beaconMesh) {
      const beaconGeom = new constructors.BufferGeometry();
      const bh = 45.0;
      const bw = 1.6;
      const bPos = [
        -bw, 0, 0,   bw, 0, 0,   0, bh, 0,
        0, 0, -bw,   0, 0, bw,   0, bh, 0
      ];
      beaconGeom.setAttribute('position', new constructors.BufferAttribute(new Float32Array(bPos), 3));
      const beaconMat = new constructors.MeshBasicMaterial();
      beaconMat.color.setHex(0x39ff14);
      beaconMat.transparent = true;
      beaconMat.opacity = 0.65;
      beaconMat.depthWrite = false;

      const beaconMesh = new constructors.Mesh(beaconGeom, beaconMat);
      beaconMesh.name = 'GPSBeacon';
      beaconMesh.position.set(dest.x, driveHeight(dest.x, dest.z), dest.z);
      beaconMesh.renderOrder = 4;
      sf.scene.add(beaconMesh);
      state.gps.beaconMesh = beaconMesh;
    }
  }

  function updateGPS(sf, dt) {
    if (!state.gps.active || !state.gps.destination) return;
    const v = sf.v;
    if (!v) return;

    const dest = state.gps.destination;
    const dist = Math.hypot(dest.x - v.pos.x, dest.z - v.pos.z);

    // Arrival detection (within 18 meters)
    if (dist < 18) {
      if (sf.toast) {
        sf.toast('Arrived at Destination', dest.label);
      }
      sf.clearGPS();
      return;
    }

    // Spin beacon
    if (state.gps.beaconMesh) {
      state.gps.beaconMesh.rotation.y += dt * 1.5;
    }
  }

  // =========================================================================
  // MAIN ENGINE LOOP & INITIALIZATION
  // =========================================================================

  let lastFrameTime = performance.now();

  function onFrame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    const sf = global.__sf;
    if (sf && sf.ready) {
      if (!state.initialized) {
        initAllEnhancements(sf);
      }

      // Update Subsystems
      updateAtmosphere(sf, dt);
      updateCameraAndHUD(sf, dt);
      updateParticlesAndFlames(sf, dt);
      updateGPS(sf, dt);
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(onFrame);
    }
  }

  function initAllEnhancements(sf) {
    if (state.initialized) return;
    state.initialized = true;

    console.log('[GameEnhancements] Initializing M2, M3, M4 extensions for window.__sf...');

    // M2: Graphics & Atmosphere
    initAtmosphereAndWeather(sf);
    initUnderglow(sf);
    initCameraAndHUD(sf);

    // M3: Fleet & Physics
    initFleetAndPhysics(sf);

    // M4: Map & GPS
    initMapAndGPS(sf);

    console.log('[GameEnhancements] M2, M3, M4 successfully attached to window.__sf.');
  }

  // Export & Startup Hook
  if (typeof window !== 'undefined') {
    window.__sf_enhancements = {
      state,
      init: initAllEnhancements,
      updateAtmosphere,
      updateCameraAndHUD,
      updateParticlesAndFlames,
      updateGPS
    };

    // Check if __sf is already registered
    if (global.__sf) {
      initAllEnhancements(global.__sf);
    }

    // Start background frame loop
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(onFrame);
    }
  }

  // Node.js commonjs compatibility for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      state,
      initAllEnhancements,
      initAtmosphereAndWeather,
      updateAtmosphere,
      initUnderglow,
      initCameraAndHUD,
      updateCameraAndHUD,
      initFleetAndPhysics,
      initGarageEnhancements,
      initMapAndGPS,
      updateParticlesAndFlames,
      updateGPS,
      parseHexColor
    };
  }

})(typeof window !== 'undefined' ? window : globalThis);
