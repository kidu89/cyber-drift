# Comprehensive Survey & Architecture Analysis: Teleoperator Open-World Simulator

**Date:** 2026-10-17  
**Investigator:** Explorer 1 (`teamwork_preview_explorer`)  
**Workspace Root:** `c:\Users\Gabi\Downloads\game fly`  
**Target:** Open-World Driving Game Expansion in San Francisco (WebGPU & Three.js)

---

## 1. Executive Summary

The project is an advanced, high-fidelity 3D open-world driving simulator called **"Teleoperator"** set in a scale model of San Francisco. It uses **WebGPU** with **Three.js** (custom bundle with TSL/Three Shading Language nodes, custom shader pipelines, depth prepasses, screen-space reflections, bloom, and dynamic lighting).

Key findings:
1. **Zero-dependency Architecture**: The project runs as static client-side ES modules served by `server.js` (standard Node.js built-ins). No external bundler (Webpack/Vite) is strictly required to run or extend the game.
2. **Server Bug Identified**: `server.js` currently fails on startup with `SyntaxError: Invalid or unexpected token` due to 7 escaped backticks (`\``). A drop-in patch and replacement file have been created and verified.
3. **Rich Subsystem Foundation**: Core game systems already exist in `app.js` and are exposed through the global facade `window.__sf`:
   - **Missions & Checkpoint Races**: `sE` (`window.__sf.race`), `Hst` (`window.__sf.challenges`).
   - **Police Pursuits & Heat**: `gE` (`window.__sf.police`), roadblocks, spikes, sirens, helicopters.
   - **Drift & Skill Chains**: `Kx` (`window.__sf.skills`), real-time multipliers, near-misses, slip angles.
   - **Taxi Fares & VIP Rides**: `lE` (`window.__sf.taxi`), `tM` (`window.__sf.rides`), "Comfort" vs "Street" ride styles.
   - **Atmosphere & Weather**: `aa` presets (`noon`, `golden`, `fog`, `rain` with `wet: 1`, `dusk`, `night`), dynamic streetlamps and headlights.
   - **Fleet & Tuning**: 7 vehicle classes in `hs`, turntable 3D garage `Fz`, performance tuning `Vz`, handling styles and driver assists in `NE`.
   - **Navigation & Map**: Real-time minimap and fullscreen vector map `kT`/`$B`, fast travel teleportation `W_`, 3D road surface projected guidance line `yz`/`xc`, Golden Gate & Bay Bridge structures with Marin region loading (`ot.needRegion("marin")`).
4. **Testing Setup**: Node.js v24.1.0 built-in test runner (`node --test`) and syntax validator (`node --check`) are available and verified.

---

## 2. Workspace Root & Directory Structure

```
c:\Users\Gabi\Downloads\game fly\
├── .agents/                      # Teamwork agent metadata & reports
├── assets/
│   ├── audio/                    # 156 sound effects, engine audio, sirens, radio tracks
│   │   ├── cop_chirp.mp3, cop_wail.mp3, cop_yelp.mp3, cop_pa.mp3, heli_loop.mp3
│   │   ├── tyre_drift.mp3, tyre_squeal.mp3, tyre_corner.mp3, spray.mp3, rain.mp3
│   │   ├── track_1.mp3 ... track_7.mp3 (Horizon radio stations)
│   │   └── audio.json
│   ├── car/                      # Ferrari 458 Spider assets (scene.json, tire.webp, turntable.webp)
│   ├── corvette/                 # Corvette ZR1X (corvette.json, turntable.webp)
│   ├── cybercab/                 # Tesla Cybercab (cybercab.json, turntable.webp)
│   ├── cybertruck/               # Tesla Cybertruck (cybertruck.json, turntable.webp)
│   ├── missions/                 # Porsche Mission S / Mission E (missions.json, turntable.webp)
│   ├── real/                     # San Francisco spatial, terrain, road & building binaries
│   │   ├── btags.bin.gz, buildings.bin.gz, coast.bin.gz, green.bin.gz, ground.bin.gz
│   │   ├── place.json            # San Francisco bounds, coordinates, district definitions
│   │   ├── props.bin.gz, roads.bin.gz, sky.bin.gz, terrain.bin.gz
│   │   └── marin/                # Sausalito / Marin Headlands beyond Golden Gate Bridge
│   ├── roadster/                 # Tesla Roadster SpaceX package (roadster.json, turntable.webp)
│   ├── tex/                      # Asphalt, sidewalks, decals, facades, foliage textures
│   ├── veg/                      # Tree & vegetation data (trees.bin.gz)
│   └── waymo/                    # Waymo Jaguar I-PACE (waymo.json, turntable.webp)
├── fonts/                        # Archivo and JetBrainsMono fonts (woff2)
├── workers/                      # Web Workers for asynchronous decoding and generation
│   ├── car.js                    # Vehicle geometry processing worker
│   ├── img.js                    # Texture image decompression worker
│   ├── lod.js                    # Level-of-detail computation worker
│   └── sky.js                    # Sky and atmosphere computation worker
├── app.js                        # Main bundled application & Three.js WebGPU engine (~4.07 MB)
├── boot.js                       # Pre-flight device tier detection, GPU initialization & preloader
├── cookie-controls.js            # Cookie consent and settings banner
├── electron_main.js              # Electron wrapper (main process)
├── index.html                    # Main HTML shell, HUD elements, canvas, settings modal
├── mock_api.json                 # Mock responses for external API calls
├── package.json                  # Manifest (name: webpulls-clone, scripts, dependencies)
├── pod.js                        # Game metadata container
├── server.js                     # Local HTTP server (Node.js built-ins)
├── start_server.bat              # Batch script to launch server
├── style.css                     # Main stylesheet (~147 KB)
├── tune.json                     # Tuning tokens and AI metadata
└── vercel.json                   # Vercel deployment configuration
```

---

## 3. Package Dependencies, Environment & Build Tooling

### 3.1 Node & NPM Environment
- **Node.js**: `v24.1.0` (Active on system)
- **NPM**: `11.3.0`
- **Operating System**: Windows (PowerShell)

### 3.2 `package.json`
```json
{
  "name": "webpulls-clone",
  "version": "1.0.0",
  "description": "Auto-generated local mirror",
  "main": "electron_main.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  },
  "devDependencies": {
    "electron": "^28.0.0"
  }
}
```

### 3.3 Build & Runtime Analysis
- No bundling step (Webpack, Rollup, Vite) is required. The browser loads `./app.js` directly as an ES module (`<script type="module" src="./app.js"></script>`).
- Node modules are not currently installed (`node_modules` does not exist), but `server.js` only uses core Node modules (`http`, `fs`, `path`, `url`, `child_process`).
- **Defect in `server.js`**:
  Lines 63, 93, 109, 129, 137, 140, 145 contain escaped backticks `\` that cause a syntax error in Node.js.
  Fixing these 7 lines allows `node server.js` to run cleanly without any external packages.

---

## 4. Main Application Entry Points & Lifecycle

### 4.1 HTML Entry Point (`index.html`)
The page layout consists of:
1. **Pre-flight Script**: `boot.js` (loaded before the module graph).
2. **Main Canvas**: `<div id="view"><canvas id="c"></canvas></div>` for WebGPU rendering.
3. **Overlays**:
   - `#where`: District and street name display (`wHood`, `wSt`, `wX`).
   - `#mini`: Minimap canvas container (`<canvas id="miniC" width="400" height="400">`).
   - `#hud`: Speedometer dial (`spd`, `gear`, `rpm`, `nos`), driving assists (`aABS`, `aTCS`, `aESP`, `aDA`).
   - `#pause`: Pause & Settings modal (`#setSide` tabs and `#setPane` sections).
   - `#menu`: Header actions (`mpChip`, `bPause`).
   - `#touch`: Mobile controls (`tSteer`, `tGas`, `tBrake`, `tHb`, `tNitro`, `tLift`, `tFlip`).
   - `#title`: Title screen and loading progress bar (`#bar`, `#stage`, `#go`).
4. **App Module**: `<script type="module" src="./app.js"></script>`.

### 4.2 Pre-flight Engine Initialization (`boot.js`)
Executed before `app.js` runs:
1. **Device Tier Detection**: Determines device capability (`desktop`, `mobile`, `safe`). Adjusts quality levels (`saver`, `mobile`, `perf`, `high`, `ultra`).
2. **WebGPU Request**:
   ```javascript
   navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
     .then(a => a.requestDevice({ requiredFeatures: ['timestamp-query', 'shader-f16'] ... }))
   ```
   Stores adapter/device on `globalThis.SF_GPU`.
3. **Worker Spawning**: Spawns decoders into `globalThis.SF_WORKERS`:
   - `workers/img.js` (2 to 8 parallel texture decoders)
   - `workers/car.js` (vehicle geometry builder)
   - `workers/sky.js` (atmosphere computation)
4. **Binary Asset Preloading**: Initiates high-priority HTTP fetch for city binary assets in `assets/real/*.bin.gz` and stores promises in `globalThis.SF_PRE`.

### 4.3 Core Runtime & Engine Lifecycle (`app.js`)
1. **WebGPU Renderer Setup (`bS`)**: Initializes WebGPU pipeline, depth prepass, Screen Space Reflections (SSR), FXAA antialiasing, bloom, tone mapping exposure, and material pipelines.
2. **Scene & Camera (`Yt`, `Le`)**: Creates Three.js Scene `Yt` and PerspectiveCamera `Le`.
3. **Physics & World Colliders (`ae`, `fz`)**: Sets up spatial hashing for road surfaces, curbs, buildings, props, and dynamic traffic colliders.
4. **Vehicle Model & Dynamics (`ee`, `qx`)**: Simulates 4-wheel vehicle physics, suspension travel, tire friction circle, tire slip, ABS modulation, TCS traction control, ESP stability control, transmission gears (Auto / Manual), and nitrous boost.
5. **Main Animation Loop (`hO`)**:
   - Governed by `requestAnimationFrame(hO)`.
   - Physics sub-stepping at fixed 120 Hz (`z4 = 1/120`).
   - Processes user input (`Cn.read()`).
   - Updates traffic (`ze`), pedestrians (`te`), police pursuit logic (`vo`), races (`qn`), stunts (`Or`), skills (`Hv`).
   - Renders frame: `_.render(Yt, Le)`.
6. **Global Facade (`window.__sf`)**:
   Exposes internal engines for inspection, customization, and external scripting:
   - `window.__sf.scene`: Three.js scene
   - `window.__sf.camera`: Three.js camera
   - `window.__sf.v`: Active vehicle physics instance
   - `window.__sf.car`: Three.js vehicle visual hierarchy
   - `window.__sf.carId`: Active car identifier (`waymo`, `ferrari`, `corvette`, `cybertruck`, `roadster`, `missions`, `cybercab`)
   - `window.__sf.swapCar(id)`: Asynchronously swap player vehicle
   - `window.__sf.setTime(name)`: Switch weather and lighting (`noon`, `golden`, `fog`, `rain`, `dusk`, `night`)
   - `window.__sf.police`: Police pursuit controller (`vo`)
   - `window.__sf.race`: Race and checkpoint controller (`qn`)
   - `window.__sf.skills`: Drift and skill scoring controller (`Hv`)
   - `window.__sf.stunts`: Speed traps, speed zones, drift zones controller (`Or`)
   - `window.__sf.map`: Minimap and interactive fullscreen map controller (`li`)
   - `window.__sf.tele`: Fast travel teleport controller (`c0`)
   - `window.__sf.garage`: Customization garage controller (`zi`)
   - `window.__sf.tuning`: Performance tuning controller (`Bnt`)
   - `window.__sf.audio`: Web Audio synthesizer and sample engine (`fn`)
   - `window.__sf.input`: Input system (`Cn`)

---

## 5. Mapping Existing Subsystems to User Requirements

### R1. Gameplay & Missions
| Requirement Feature | Existing Underlying System | File / Code Location | Architectural Status |
|---|---|---|---|
| **Urban Races (Time Trials / Checkpoints)** | Class `sE` (`window.__sf.race`), `raceStarts` (`Ll`), `c1` (beacons) | `app.js:3370705` | Complete checkpoint race engine with HUD (`time`, `cp`, `pos`), race tree start, medals, personal bests, and reset. Needs user-accessible menu triggers. |
| **Police Pursuit (Heat 1-5, Roadblocks, Cooldown)** | Class `gE` (`window.__sf.police`), `ze` (cop cars & helicopter) | `app.js:3578805` | Dynamic pursuit engine with heat levels 1-5, patrol dispatch, roadblocks (`this.blocks`), spike strips (`this.strips`), evasion countdown (`this.cool`), bust mechanics, sirens/PA audio. |
| **Drift Events & Stunts** | Class `Kx` (`window.__sf.skills`), `skillHud` (`GN`), `vE` (`Or`) | `app.js:3018023`, `app.js:3470000` | Real-time slip angle detection, speed multipliers, crash penalties, drift scoring, speed traps & drift zones in `Or` with star benchmarks. |
| **Taxi & VIP Fares** | Class `lE` (`window.__sf.taxi`), `tM` (`window.__sf.rides`) | `app.js:3439444` | Pick up / drop off passengers at glowing curbs, comfort vs street rating, passenger tip calculation, fare UI cards. |
| **Challenge Hub** | Function `Hst` (`window.__sf.challenges`) | `app.js:3847331` | Unified mission / challenge aggregation across San Francisco. |

### R2. Graphics, Atmosphere & Environmental Effects
| Requirement Feature | Existing Underlying System | File / Code Location | Architectural Status |
|---|---|---|---|
| **Dynamic Day/Night & Weather** | Object `aa`, method `Mt(timeKey)` (`window.__sf.setTime`) | `app.js:3958470`, `app.js:3992000` | 6 presets: `noon`, `golden`, `fog`, `rain`, `dusk`, `night`. Includes sun azimuth/elevation, Rayleigh/Mie fog, and exposure. |
| **Wet Asphalt & Reflections** | `K.road` material, `aa.rain` (`wet: 1`), `_.ssr` (Screen Space Reflections) | `app.js:3958470`, `app.js:3984000` | Asphalt shader modulates dampness and puddle reflectance. SSR enabled on High/Ultra graphics. |
| **GPU Particle Effects** | Class `AE` (`Ae`), `cs` (debris & sparks) | `app.js:3989000` | 4200 rain particles, 3200 tire smoke / skidmark particles, exhaust pop and backfire audio. |
| **HUD & Dynamic Camera** | `so` (`cE`), `vc` (`oz`), SVG dial `#dial` | `index.html:241`, `app.js:3985000` | Speedometer dial, radial/motion blur scaling with speed, camera vibration on road bumps and impacts. |

### R3. Fleet, Customization & Physics Tuning
| Requirement Feature | Existing Underlying System | File / Code Location | Architectural Status |
|---|---|---|---|
| **Fleet of Vehicles** | Object `hs`, array `e2`, `Th(carId)` | `app.js:3145424`, `app.js:4012000` | 7 vehicles: `waymo`, `cybercab`, `ferrari`, `corvette`, `cybertruck`, `roadster`, `missions`. Distinct audio and handling. |
| **Arcade vs Simulator Physics** | `ee.assists` (ABS, TCS, ESP, Steering), `NE` menu, `aids` | `index.html:362`, `app.js:3746634` | Fully toggleable ABS, traction control, ESP, and steering assistance. Manual vs automatic shifting. |
| **Turntable Customization Garage** | Class `Fz` (`zi`), `Vz` (`Bnt`), `assets/*/turntable.webp` | `app.js:4025000` | Color customization for body paint (gloss, matte, pearl, carbon fiber), brake calipers, rim finish, and window tint on turntable. |

### R4. Map, GPS Navigation & Extended Routes
| Requirement Feature | Existing Underlying System | File / Code Location | Architectural Status |
|---|---|---|---|
| **Active 3D GPS Guidance** | Class `yz` (`xc`), `gz` (`mn`), `mn.setDest()` | `app.js:3109093`, `app.js:3048509` | Projected chevron line directly on road surface with directional turn arrows towards target destination. |
| **Minimap & Fullscreen Map** | Class `kT` (`li`), `$B` (`bigmap`) | `app.js:13407` | Interactive 2D vector minimap and fullscreen zoomable/draggable map with POI icons, speed traps, and landmarks. |
| **Fast Travel (Teleportation)** | Class `W_` (`c0`), `c0.go(target)` | `app.js:2870432` | Teleports vehicle to any road point or POI with fade overlay. |
| **Extended Routes & Bridges** | Golden Gate Bridge (`US-101`), Bay Bridge (`I-80`), `marin` region | `place.json:24`, `app.js:2017121` | Both bridges modeled with multi-lane decks. Regional loading `r4("marin")` streams Sausalito and Marin Headlands. |

---

## 6. Development, Test & Execution Commands

### 6.1 Server Execution Command
To start the local development server:
```bash
node server.js
```
*(Once the 7 syntax errors in `server.js` are resolved. Default port: 3000).*

### 6.2 Test Command
Using Node.js native test runner:
```bash
node --test .agents/teamwork/explorer_survey_1/test_server.js
```
*(Can be extended for unit tests of mission managers, state stores, and physics configurations).*

### 6.3 Syntax Verification Command
```bash
node --check app.js
node --check boot.js
node --check proposed_server.js
```

---

## 7. Recommended Integration Architecture

To implement the open-world driving game requirements without breaking the existing monolithic core:

1. **Modular Extension Script (`missions_hub.js`)**:
   Load as an ES module in `index.html`:
   ```html
   <script type="module" src="./missions_hub.js"></script>
   ```
2. **Expose Dedicated Missions Menu**:
   - Add a `<button class="tab" data-tab="missions" role="tab">` to `<nav id="setSide">` in `index.html`.
   - Add `<section class="sec" data-sec="missions">` in `<div id="setPane">` in `index.html`.
   - The existing `NE` class in `app.js` automatically binds to any `[data-tab]` and switches to the matching section.
   - The UI will present 3 distinct mission categories:
     1. **Urban Checkpoint Races** (Sprint & Circuit routes through Downtown, Lombard St, Twin Peaks).
     2. **Police Pursuit Scenarios** (Heat Level 1-5 escapes, cooldown survival, roadblock evasion).
     3. **Drift & Stunt Trials** (Downhill drift on Lombard St, Twin Peaks drift zones, jump challenges).
3. **Bridge & Marin Unlocking**:
   - Trigger `window.__sf.real.needRegion('marin')` and remove any boundary restrictions on the bridge approaches to allow seamless driving into Marin Vista Point and Sausalito.
4. **Persistent Progress**:
   - Save mission completion, stars, best times, and cash rewards directly to `localStorage` under `sf-drive.missions`.
