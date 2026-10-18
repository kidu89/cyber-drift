const assert = require('assert');
const enhancements = require('../../../game_enhancements.js');

console.log('--- Testing game_enhancements.js ---');

// Mock Three.js classes
class MockVector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
}

class MockBufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
  }
}

class MockBufferGeometry {
  constructor() {
    this.attributes = {};
    this.index = null;
  }
  setAttribute(name, attr) {
    this.attributes[name] = attr;
  }
  setIndex(idx) {
    this.index = idx;
  }
  computeVertexNormals() {}
}

class MockMeshBasicMaterial {
  constructor(params = {}) {
    Object.assign(this, params);
    this.color = {
      val: 0,
      setHex(h) { this.val = h; },
      setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; }
    };
  }
}

class MockObject3D {
  constructor(geometry, material) {
    this.name = '';
    this.children = [];
    this.parent = null;
    this.position = new MockVector3();
    this.rotation = new MockVector3();
    this.scale = new MockVector3(1, 1, 1);
    this.visible = true;
    this.material = material || new MockMeshBasicMaterial();
    this.geometry = geometry || new MockBufferGeometry();
    this.userData = {};
  }
  add(obj) {
    obj.parent = this;
    this.children.push(obj);
  }
  remove(obj) {
    const idx = this.children.indexOf(obj);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      obj.parent = null;
    }
  }
  getObjectByName(name) {
    if (this.name === name) return this;
    for (const child of this.children) {
      const res = child.getObjectByName(name);
      if (res) return res;
    }
    return null;
  }
  traverse(cb) {
    cb(this);
    for (const child of this.children) {
      child.traverse(cb);
    }
  }
  get isMesh() {
    return true;
  }
}

class MockPointLight extends MockObject3D {
  constructor(color, intensity, distance) {
    super();
    this.isLight = true;
    this.isPointLight = true;
    this.color = {
      val: color,
      setHex(h) { this.val = h; }
    };
    this.intensity = intensity;
    this.distance = distance;
  }
}

// Setup mock window.__sf
global.window = global;
global.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] !== undefined ? this._store[k] : null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; }
};

global.e2 = ["waymo", "cybercab", "ferrari", "corvette", "cybertruck", "roadster", "missions"];
global.lM = new Set(["ferrari", "corvette", "missions"]);
global.kp = [
  { id: "gloss", name: "Gloss" },
  { id: "metallic", name: "Metallic" }
];
global.nI = {
  gloss: {},
  metallic: {}
};

const mockScene = new MockObject3D();
const mockCamera = new MockObject3D();
const mockCar = {
  root: new MockObject3D(),
  model: new MockObject3D(),
  spec: { mass: 1500, power: 400000, rearGrip: 1.0, nitroMax: 1.0, nitroRefill: 0.16 }
};
const mockV = {
  pos: new MockVector3(0, 5, 0),
  vel: new MockVector3(0, 0, 0),
  S: { ...mockCar.spec },
  assists: { tcs: true, esp: true, steering: true, abs: true },
  nitro: 1.0,
  nitroOn: false,
  throttle: 0,
  brake: 0,
  kmh: 0,
  impact: 0,
  landing: 0,
  airTime: 0,
  onGround: true
};

const mockGuide = {
  g: new MockBufferGeometry(),
  mesh: new MockObject3D()
};
mockGuide.g.setAttribute('position', new MockBufferAttribute(new Float32Array(18), 3));

const mockMb = {
  carWet: 0,
  radialBlur: 0
};

const mockCc = {
  shake: 0
};

const mockTele = {
  lastDest: null,
  go(target) {
    this.lastDest = target;
    return true;
  }
};

const mockMap = {
  pois() {
    return [{ x: 10, z: 20, kind: "flag", name: "Original Race" }];
  },
  onPick: null,
  setPick(p, msg) {
    this.picked = p;
    this.pickMsg = msg;
  }
};

let lastLamps = null;
const mockSf = {
  ready: true,
  scene: mockScene,
  camera: mockCamera,
  car: mockCar,
  carId: 'ferrari',
  v: mockV,
  guide: mockGuide,
  mb: mockMb,
  cc: mockCc,
  tele: mockTele,
  map: mockMap,
  hs: {
    corvette: {
      id: 'corvette',
      spec: { ...mockCar.spec },
      load: () => {}
    }
  },
  setLamps(car, config) {
    lastLamps = config;
  },
  toast(title, msg) {
    console.log(`[Toast] ${title}: ${msg}`);
  }
};

global.__sf = mockSf;

// 1. Initialize Enhancements
enhancements.initAllEnhancements(mockSf);
assert.strictEqual(enhancements.state.initialized, true, 'State should be initialized');
console.log('✓ initAllEnhancements successfully run');

// 2. Test M2: Dynamic Day/Night & Weather
assert.ok(mockSf.timeOfDay, 'window.__sf.timeOfDay must be defined');
assert.strictEqual(typeof mockSf.timeOfDay.setTime, 'function', 'setTime must be a function');
assert.strictEqual(typeof mockSf.timeOfDay.setWeather, 'function', 'setWeather must be a function');

mockSf.timeOfDay.setTime(12.0); // Noon
assert.strictEqual(mockSf.timeOfDay.time, 12.0, 'Time should be 12.0');
enhancements.updateAtmosphere(mockSf, 1.0);
assert.ok(enhancements.state.timeOfDay.sunEl > 40, 'Sun elevation at noon should be high (>40 deg)');
assert.strictEqual(enhancements.state.timeOfDay.nightFactor, 0.0, 'Night factor at noon should be 0');
console.log(`✓ Noon test: sunEl=${enhancements.state.timeOfDay.sunEl.toFixed(1)}, nightFactor=${enhancements.state.timeOfDay.nightFactor}`);

mockSf.timeOfDay.setTime(23.0); // Night
enhancements.updateAtmosphere(mockSf, 1.0);
assert.ok(enhancements.state.timeOfDay.sunEl < 0, 'Sun elevation at night should be negative');
assert.strictEqual(enhancements.state.timeOfDay.nightFactor, 1.0, 'Night factor at midnight should be 1.0');
assert.strictEqual(lastLamps.head, 1.0, 'Headlights should be active at night');
console.log(`✓ Night test: sunEl=${enhancements.state.timeOfDay.sunEl.toFixed(1)}, nightFactor=${enhancements.state.timeOfDay.nightFactor}, headlights=${lastLamps.head}`);

// Weather rain accumulation and drying
mockSf.timeOfDay.setWeather('rain');
assert.strictEqual(mockSf.timeOfDay.weather, 'rain');
for (let i = 0; i < 20; i++) enhancements.updateAtmosphere(mockSf, 0.5);
assert.ok(enhancements.state.timeOfDay.wetness > 0.5, 'Wetness should accumulate during rain');
assert.strictEqual(mockMb.carWet, enhancements.state.timeOfDay.wetness, 'mb.carWet should match wetness');
console.log(`✓ Rain accumulation test: wetness=${enhancements.state.timeOfDay.wetness.toFixed(2)}`);

mockSf.timeOfDay.setWeather('clear');
const wetBefore = enhancements.state.timeOfDay.wetness;
for (let i = 0; i < 20; i++) enhancements.updateAtmosphere(mockSf, 0.5);
assert.ok(enhancements.state.timeOfDay.wetness < wetBefore, 'Wetness should decrease during clear weather');
console.log(`✓ Drying test: wetness reduced from ${wetBefore.toFixed(2)} to ${enhancements.state.timeOfDay.wetness.toFixed(2)}`);

// 3. Test M2: Underglow
assert.strictEqual(typeof mockSf.setUnderglow, 'function', 'setUnderglow must be exposed');
mockSf.setUnderglow('magenta', 2.0);
assert.strictEqual(enhancements.state.underglow.enabled, true, 'Underglow should be enabled');
assert.strictEqual(enhancements.state.underglow.color, 'magenta');
const underglowGroup = mockCar.root.getObjectByName('UnderglowGroup');
assert.ok(underglowGroup, 'UnderglowGroup should be added to car root');
const underglowMesh = underglowGroup.getObjectByName('UnderglowMesh');
assert.ok(underglowMesh, 'UnderglowMesh should be present');
assert.strictEqual(underglowMesh.material.color.val, 0xff007f, 'Mesh color should be magenta 0xff007f');
console.log('✓ Underglow test: magenta mesh attached with hex 0x' + underglowMesh.material.color.val.toString(16));

mockSf.setUnderglow(false);
assert.strictEqual(enhancements.state.underglow.enabled, false, 'Underglow should be disabled');
assert.strictEqual(underglowGroup.visible, false, 'Underglow group should be hidden');
console.log('✓ Underglow toggle off test passed');

// 4. Test M2: Camera Impact Shake & Speedometer
assert.strictEqual(typeof mockSf.triggerImpactShake, 'function', 'triggerImpactShake must be exposed');
mockSf.triggerImpactShake(1.5);
assert.ok(mockCc.shake >= 1.5, 'Camera shake should be boosted');
console.log(`✓ Camera impact shake test: shake=${mockCc.shake}`);

// 5. Test M3: Fleet (Police and Muscle)
assert.ok(mockSf.hs.police, 'hs.police must exist');
assert.ok(mockSf.hs.muscle, 'hs.muscle must exist');
assert.strictEqual(mockSf.hs.police.id, 'police');
assert.strictEqual(mockSf.hs.muscle.id, 'muscle');
assert.ok(global.e2.includes('police'), 'e2 unlocked cars must include police');
assert.ok(global.e2.includes('muscle'), 'e2 unlocked cars must include muscle');
assert.ok(global.lM.has('police'), 'lM ICE cars must include police');
assert.ok(global.lM.has('muscle'), 'lM ICE cars must include muscle');
console.log('✓ Fleet test: police and muscle successfully registered in hs, e2, and lM');

// 6. Test M3: Arcade vs Simulator Handling Switch
assert.strictEqual(typeof mockSf.setHandlingMode, 'function', 'setHandlingMode must be exposed');
mockSf.setHandlingMode('arcade');
assert.strictEqual(mockSf.handlingMode, 'arcade');
assert.strictEqual(mockV.S.rearGrip, 1.26, 'Arcade mode must have boosted rear grip');
assert.strictEqual(mockV.assists.tcs, true, 'Arcade mode must enable TCS assist');
assert.strictEqual(mockV.assists.esp, true, 'Arcade mode must enable ESP assist');
assert.strictEqual(mockV.assists.steering, true, 'Arcade mode must enable steering assist');

mockSf.setHandlingMode('simulator');
assert.strictEqual(mockSf.handlingMode, 'simulator');
assert.strictEqual(mockV.S.rearGrip, 1.0, 'Simulator mode must have standard grip');
assert.strictEqual(mockV.assists.tcs, false, 'Simulator mode must disable TCS');
assert.strictEqual(mockV.assists.esp, false, 'Simulator mode must disable ESP');
assert.strictEqual(mockV.assists.steering, false, 'Simulator mode must disable steering assist');
console.log('✓ Handling mode test: arcade vs simulator toggles grip and stability aids');

// 7. Test M3: Turntable Garage (Carbon Fiber & Window Tint)
assert.ok(global.kp.some(f => f.id === 'carbon'), 'kp finish registry must contain carbon');
assert.ok(global.nI.carbon, 'nI finish parameters must define carbon');
assert.strictEqual(global.nI.carbon.carbon, 1);

assert.strictEqual(typeof mockSf.setWindowTint, 'function', 'setWindowTint must be exposed');
// Add mock glass mesh to car root
const mockGlass = new MockObject3D();
mockGlass.name = 'CarGlass';
mockGlass.material = new MockMeshBasicMaterial({ transparent: true, opacity: 1.0 });
mockCar.root.add(mockGlass);

mockSf.setWindowTint('limo');
assert.strictEqual(enhancements.state.tint.current, 'limo');
assert.strictEqual(mockGlass.material.opacity, 0.20, 'Limo tint should set opacity to 0.20');
assert.strictEqual(mockGlass.material.color.val, 0x040608, 'Limo tint color should be set');
console.log('✓ Garage customization test: carbon fiber and window tint limo applied');

// 8. Test M4: Active 3D GPS Guidance Ribbon
assert.strictEqual(typeof mockSf.setGPSDestination, 'function', 'setGPSDestination must be exposed');
assert.strictEqual(typeof mockSf.clearGPS, 'function', 'clearGPS must be exposed');

mockSf.setGPSDestination(500, 600, 'Golden Gate Overlook');
assert.strictEqual(enhancements.state.gps.active, true, 'GPS must be active');
assert.strictEqual(enhancements.state.gps.destination.x, 500);
assert.strictEqual(enhancements.state.gps.destination.z, 600);
const ribbon = mockScene.getObjectByName('RaceCarpet');
assert.ok(ribbon, 'RaceCarpet ribbon mesh must be added to scene');
const beacon = mockScene.getObjectByName('GPSBeacon');
assert.ok(beacon, 'GPSBeacon must be added to scene');
console.log('✓ 3D GPS Ribbon test: RaceCarpet and GPSBeacon added to scene');

mockSf.clearGPS();
assert.strictEqual(enhancements.state.gps.active, false, 'GPS should be cleared');
assert.strictEqual(mockScene.getObjectByName('RaceCarpet'), null, 'RaceCarpet should be removed');
assert.strictEqual(mockScene.getObjectByName('GPSBeacon'), null, 'GPSBeacon should be removed');
console.log('✓ 3D GPS Ribbon clear test passed');

// 9. Test M4: Scenic Viewpoints
assert.ok(Array.isArray(mockSf.scenicViewpoints), 'scenicViewpoints must be an array');
assert.ok(mockSf.scenicViewpoints.some(v => v.id === 'ggb_north'), 'Must contain Golden Gate North');
assert.ok(mockSf.scenicViewpoints.some(v => v.id === 'bay_tunnel'), 'Must contain Bay Bridge Tunnel');
assert.strictEqual(typeof mockSf.teleportToViewpoint, 'function', 'teleportToViewpoint must be a function');

mockSf.teleportToViewpoint('ggb_north');
assert.strictEqual(mockTele.lastDest.x, -7545, 'Should teleport to GGB North coords');
assert.strictEqual(mockTele.lastDest.z, -3325);
console.log('✓ Bridge scenic viewpoints test: teleported to GGB North');

// 10. Test M4: Map Garages & Fast Travel
assert.ok(Array.isArray(mockSf.garages), 'garages must be an array');
const allPois = mockSf.map.pois();
assert.ok(allPois.some(p => p.kind === 'garage'), 'POIs should include garages');
assert.ok(allPois.some(p => p.kind === 'vista'), 'POIs should include vista points');
assert.ok(allPois.some(p => p.name === 'Original Race'), 'Original POIs preserved');

assert.strictEqual(typeof mockSf.fastTravel, 'function', 'fastTravel must be exposed');
mockSf.fastTravel('garage_downtown');
assert.strictEqual(mockTele.lastDest.x, -240, 'Should teleport to downtown garage');
assert.strictEqual(mockTele.lastDest.z, 420);
console.log('✓ Map & Fast Travel test: garages present and fastTravel works');

console.log('\n========================================');
console.log('ALL 10 VERIFICATION SUITES PASSED (100%)');
console.log('========================================');
