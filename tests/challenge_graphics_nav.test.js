/**
 * Challenger Core 2: Empirical Adversarial Stress Test Harness
 * 
 * Verifies and stress-tests:
 * 1. Rapid Day/Night cycle scrubbing & clock boundary values
 * 2. Rapid weather switching & wetness accumulation/drying state continuity
 * 3. Underglow palette boundary values, parsing edge cases & intensity clamping
 * 4. 3D GPS navigation path queries to out-of-bounds coordinates & GPU resource lifecycle
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const ENHANCEMENTS_PATH = path.join(ROOT, 'game_enhancements.js');

// Helper to create a comprehensive mock Three.js environment
function createThreeMocks() {
    class BufferAttributeMock {
        constructor(array, itemSize) {
            this.array = array;
            this.itemSize = itemSize;
            this.count = array ? array.length / itemSize : 0;
        }
    }

    let allocatedGeometries = [];
    let allocatedMaterials = [];

    class BufferGeometryMock {
        constructor() {
            this.attributes = {};
            this.index = null;
            this.disposed = false;
            allocatedGeometries.push(this);
        }
        setAttribute(name, attr) {
            this.attributes[name] = attr;
            return this;
        }
        setIndex(indexAttr) {
            this.index = indexAttr;
            return this;
        }
        computeVertexNormals() {
            return this;
        }
        dispose() {
            this.disposed = true;
        }
    }

    class ColorMock {
        constructor(hex) {
            this.r = 1;
            this.g = 1;
            this.b = 1;
            if (hex !== undefined) this.setHex(hex);
        }
        setHex(hex) {
            this.hex = hex;
            if (isNaN(hex)) {
                this.r = NaN;
                this.g = NaN;
                this.b = NaN;
                return this;
            }
            this.r = ((hex >> 16) & 255) / 255;
            this.g = ((hex >> 8) & 255) / 255;
            this.b = (hex & 255) / 255;
            return this;
        }
        setRGB(r, g, b) {
            this.r = r;
            this.g = g;
            this.b = b;
            return this;
        }
    }

    class MaterialMock {
        constructor() {
            this.color = new ColorMock(0xffffff);
            this.transparent = false;
            this.opacity = 1.0;
            this.depthWrite = true;
            this.vertexColors = false;
            this.disposed = false;
            allocatedMaterials.push(this);
        }
        dispose() {
            this.disposed = true;
        }
    }

    class Object3DMock {
        constructor() {
            this.children = [];
            this.parent = null;
            this.name = '';
            this.visible = true;
            this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
            this.rotation = { x: 0, y: 0, z: 0 };
            this.userData = {};
        }
        add(child) {
            child.parent = this;
            this.children.push(child);
            return this;
        }
        remove(child) {
            const idx = this.children.indexOf(child);
            if (idx !== -1) {
                this.children.splice(idx, 1);
                child.parent = null;
            }
            return this;
        }
        getObjectByName(name) {
            if (this.name === name) return this;
            for (const child of this.children) {
                const found = child.getObjectByName(name);
                if (found) return found;
            }
            return null;
        }
        traverse(callback) {
            callback(this);
            for (const child of this.children) {
                child.traverse(callback);
            }
        }
    }

    class MeshMock extends Object3DMock {
        constructor(geometry, material) {
            super();
            this.isMesh = true;
            this.geometry = geometry || new BufferGeometryMock();
            this.material = material || new MaterialMock();
            this.renderOrder = 0;
        }
    }

    class LightMock extends Object3DMock {
        constructor(color, intensity) {
            super();
            this.isLight = true;
            this.isPointLight = true;
            this.color = new ColorMock(color);
            this.intensity = intensity;
        }
    }

    return {
        BufferGeometry: BufferGeometryMock,
        BufferAttribute: BufferAttributeMock,
        MeshBasicMaterial: MaterialMock,
        Mesh: MeshMock,
        Group: Object3DMock,
        PointLight: LightMock,
        Color: ColorMock,
        getAllocatedGeometries: () => allocatedGeometries,
        getAllocatedMaterials: () => allocatedMaterials,
        resetAllocations: () => {
            allocatedGeometries = [];
            allocatedMaterials = [];
        }
    };
}

function createIsolatedSandbox(threeOverrides = null) {
    const three = threeOverrides || createThreeMocks();

    const scene = new three.Group();
    scene.isScene = true;

    // Create car root and model
    const carRoot = new three.Group();
    carRoot.name = 'CarRoot';
    const carModel = new three.Mesh();
    carModel.name = 'CarModel';
    carRoot.add(carModel);
    scene.add(carRoot);

    // Guide mesh for constructor resolver
    const guideGeom = new three.BufferGeometry();
    const guideAttr = new three.BufferAttribute(new Float32Array([0, 0, 0]), 3);
    guideGeom.setAttribute('position', guideAttr);
    const guideMesh = new three.Mesh(guideGeom, new three.MeshBasicMaterial());

    const mockStorage = new Map();
    const storageObj = {
        getItem: (k) => mockStorage.has(k) ? mockStorage.get(k) : null,
        setItem: (k, v) => mockStorage.set(k, String(v)),
        removeItem: (k) => mockStorage.delete(k),
        clear: () => mockStorage.clear()
    };

    const mockWindow = {
        ready: true,
        localStorage: storageObj,
        location: { href: 'http://localhost:3000/' },
        performance: { now: () => Date.now() },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console: { ...console, log: () => {} }, // suppress logs during test
        requestAnimationFrame: (cb) => setTimeout(cb, 16),
        document: {
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => []
        },
        __sf: {
            ready: true,
            scene: scene,
            camera: { position: { x: 0, y: 5, z: 10 } },
            guide: { g: guideGeom, mesh: guideMesh },
            car: {
                root: carRoot,
                model: carModel,
                materials: { Body: { color: new three.Color(0xffffff) } }
            },
            carId: 'waymo',
            v: {
                pos: { x: 0, y: 15, z: 0 },
                kmh: 0,
                throttle: 0,
                rpm: 1000,
                impact: 0,
                airTime: 0,
                onGround: true,
                landing: 0
            },
            real: {
                layout: {
                    driveHeight: (x, z) => {
                        // Standard San Francisco city coordinates
                        if (Math.abs(x) < 5000 && Math.abs(z) < 5000) return 15.0;
                        // Out-of-bounds terrain: undefined
                        if (Math.abs(x) > 50000 || Math.abs(z) > 50000) return undefined;
                        return 0.0;
                    }
                }
            },
            tele: {
                go: (target) => { mockWindow.__sf.teleTarget = target; }
            },
            toast: (title, msg) => { mockWindow.__sf.lastToast = { title, msg }; },
            setLamps: (car, state) => { mockWindow.__sf.lastLampState = state; },
            mb: {}
        }
    };

    const code = fs.readFileSync(ENHANCEMENTS_PATH, 'utf8');
    const context = vm.createContext({
        window: mockWindow,
        global: mockWindow,
        globalThis: mockWindow,
        self: mockWindow,
        document: mockWindow.document,
        localStorage: mockWindow.localStorage,
        performance: mockWindow.performance,
        setTimeout: mockWindow.setTimeout,
        clearTimeout: mockWindow.clearTimeout,
        requestAnimationFrame: mockWindow.requestAnimationFrame,
        console: mockWindow.console
    });

    vm.runInContext(code, context, { filename: 'game_enhancements.js' });

    return {
        window: mockWindow,
        sf: mockWindow.__sf,
        enhancements: mockWindow.__sf_enhancements,
        three
    };
}

async function runTestSuite() {
    console.log('================================================================');
    console.log('   CHALLENGER CORE 2: EMPIRICAL ADVERSARIAL STRESS TEST HARNESS ');
    console.log('   Graphics, Environment, Weather, Underglow & 3D Navigation    ');
    console.log('================================================================\n');

    const results = {
        passed: 0,
        failed: 0,
        vulnerabilities: []
    };

    function recordPass(testId, title, metric) {
        results.passed++;
        console.log(`[PASS] ${testId}: ${title}`);
        if (metric) console.log(`       Evidence: ${metric}`);
    }

    function recordFail(testId, title, details, impact) {
        results.failed++;
        results.vulnerabilities.push({ testId, title, details, impact });
        console.log(`[FAIL] ${testId}: ${title}`);
        console.log(`       Evidence: ${details}`);
        console.log(`       Impact:   ${impact}\n`);
    }

    // =========================================================================
    // SUITE 1: RAPID DAY/NIGHT CYCLE SCRUBBING & TIME BOUNDARIES
    // =========================================================================
    console.log('--- SUITE 1: RAPID DAY/NIGHT CYCLE SCRUBBING & TIME BOUNDARIES ---');

    // 1.1 Rapid scrubbing stress test: 2,000 rapid calls with random hours
    {
        const { sf, enhancements } = createIsolatedSandbox();
        const start = Date.now();
        let wrapError = false;
        for (let i = 0; i < 2000; i++) {
            const h = (Math.random() * 500) - 250;
            sf.timeOfDay.setTime(h);
            const cur = sf.timeOfDay.time;
            if (isNaN(cur) || cur < 0 || cur >= 24) {
                wrapError = true;
                break;
            }
        }
        const duration = Date.now() - start;
        if (!wrapError) {
            recordPass('ADV-1.1', '2,000 rapid setTime calls with random hours in [-250, +250]', `Completed in ${duration}ms (${(duration/2000).toFixed(3)}ms/call); time wrapped strictly into [0, 24)`);
        } else {
            recordFail('ADV-1.1', 'Rapid setTime produced invalid clock time', `sf.timeOfDay.time = ${sf.timeOfDay.time}`, 'HIGH: Clock values escape valid day range');
        }
    }

    // 1.2 Boundary inputs: NaN & Infinity
    {
        const { sf, enhancements } = createIsolatedSandbox();
        sf.timeOfDay.setTime(NaN);
        const timeNaN = sf.timeOfDay.time;
        const sunElNaN = enhancements.state.timeOfDay.sunEl;

        if (isNaN(timeNaN) || isNaN(sunElNaN)) {
            recordFail(
                'ADV-1.2',
                'setTime(NaN) permanently poisons atmospheric state with NaN',
                `tod.time = ${timeNaN}, tod.sunEl = ${sunElNaN}. (NaN % 24 + 24) % 24 evaluates to NaN.`,
                'CRITICAL: Propagates NaN into sun elevation, road material RGB shaders, and cascade-destroys weather wetness permanently.'
            );
        } else {
            recordPass('ADV-1.2', 'setTime(NaN) sanitized safely', `time: ${timeNaN}`);
        }
    }

    {
        const { sf, enhancements } = createIsolatedSandbox();
        sf.timeOfDay.setTime(Infinity);
        const timeInf = sf.timeOfDay.time;

        if (isNaN(timeInf) || !isFinite(timeInf)) {
            recordFail(
                'ADV-1.3',
                'setTime(Infinity) sets tod.time to NaN due to IEEE-754 modulo rules',
                `Infinity % 24 = NaN in JavaScript; resulted in tod.time = ${timeInf}`,
                'HIGH: Any non-finite float input invalidates the time progression controller.'
            );
        } else {
            recordPass('ADV-1.3', 'setTime(Infinity) sanitized safely', `time: ${timeInf}`);
        }
    }

    // 1.4 Synchronous Scene Graph Traversal Overhead on Slider Scrubbing
    {
        const three = createThreeMocks();
        const { sf, enhancements } = createIsolatedSandbox(three);

        // Populate a realistic open-world scene with 2,500 objects
        for (let i = 0; i < 2500; i++) {
            const m = new three.Mesh();
            m.name = i % 4 === 0 ? `road_seg_${i}` : `bldg_${i}`;
            m.material = new three.MeshBasicMaterial();
            m.material.name = i % 4 === 0 ? 'asphalt_mat' : 'wall_mat';
            sf.scene.add(m);
        }

        const startTraverse = Date.now();
        const SCRUBS = 150;
        for (let i = 0; i < SCRUBS; i++) {
            sf.timeOfDay.setTime(10 + (i % 12)); // Each call triggers updateAtmosphere(sf, 0)
        }
        const traverseDuration = Date.now() - startTraverse;
        const perScrub = (traverseDuration / SCRUBS).toFixed(2);

        if (traverseDuration > 300) {
            recordFail(
                'ADV-1.4',
                'Synchronous scene.traverse on every setTime call causes UI thread blocking during rapid slider scrubbing',
                `${SCRUBS} setTime calls traversed 2,500 objects ${SCRUBS} times (${SCRUBS * 2500} object inspections) taking ${traverseDuration}ms (${perScrub}ms/call)`,
                'MEDIUM: Interactive slider scrubbing will freeze the 60 FPS render loop.'
            );
        } else {
            recordPass('ADV-1.4', 'Scene traversal performance within budget', `${traverseDuration}ms for ${SCRUBS} calls (${perScrub}ms/call)`);
        }
    }

    // =========================================================================
    // SUITE 2: WEATHER SWITCHING & WETNESS STATE CONTINUITY
    // =========================================================================
    console.log('\n--- SUITE 2: WEATHER SWITCHING & WETNESS STATE CONTINUITY ---');

    // 2.1 Rapid weather oscillation
    {
        const { sf, enhancements } = createIsolatedSandbox();
        let wetnessGlitch = false;
        for (let i = 0; i < 300; i++) {
            sf.timeOfDay.setWeather(i % 2 === 0 ? 'rain' : 'clear');
            enhancements.updateAtmosphere(sf, 0.016);
            const w = enhancements.state.timeOfDay.wetness;
            if (isNaN(w) || w < 0 || w > 1) {
                wetnessGlitch = true;
                break;
            }
        }
        if (!wetnessGlitch) {
            recordPass('ADV-2.1', 'Rapid weather oscillation (300 switches) maintains bounded wetness in [0.0, 1.0]', `Final wetness: ${enhancements.state.timeOfDay.wetness.toFixed(4)}`);
        } else {
            recordFail('ADV-2.1', 'Rapid weather oscillation corrupted wetness state', `wetness: ${enhancements.state.timeOfDay.wetness}`, 'HIGH: Road shader wetness uniform escaped [0, 1]');
        }
    }

    // 2.2 Unrecoverable NaN Wetness Cascade
    {
        const { sf, enhancements } = createIsolatedSandbox();
        // Trigger NaN in sunEl via timeOfDay
        sf.timeOfDay.setTime(NaN);
        enhancements.updateAtmosphere(sf, 0.016);
        const wetnessPoisoned = enhancements.state.timeOfDay.wetness;

        // Try to recover by setting weather to rain
        sf.timeOfDay.setWeather('rain');
        enhancements.updateAtmosphere(sf, 1.0);
        const wetnessAfterRain = enhancements.state.timeOfDay.wetness;

        if (isNaN(wetnessPoisoned) || isNaN(wetnessAfterRain)) {
            recordFail(
                'ADV-2.2',
                'NaN cascade from sunEl permanently destroys weather accumulation and drying engine',
                `drySpeed = 0.02 * (1 + max(0, NaN/40)) = NaN; Math.min(1.0, NaN + dt * 0.08) = NaN. Wetness is irrevocably NaN.`,
                'CRITICAL: Once timeOfDay encounters NaN, weather wetness can never recover without full page reload.'
            );
        } else {
            recordPass('ADV-2.2', 'Atmospheric NaN does not cascade into weather engine', `wetness: ${wetnessAfterRain}`);
        }
    }

    // 2.3 Negative delta-time inverted dynamics
    {
        const { sf, enhancements } = createIsolatedSandbox();
        sf.timeOfDay.setWeather('rain');
        enhancements.state.timeOfDay.wetness = 0.5;
        // Negative dt (clock jump backwards or timer jitter)
        enhancements.updateAtmosphere(sf, -5.0);
        const wetAfterRainNeg = enhancements.state.timeOfDay.wetness;

        // In code: Math.min(1.0, 0.5 + (-5.0) * 0.08) = 0.1
        if (wetAfterRainNeg < 0.5) {
            recordFail(
                'ADV-2.3',
                'Negative delta-time causes rain to dry the road and drying to generate water',
                `Negative dt (-5s) in rain reduced wetness from 0.5 to ${wetAfterRainNeg}`,
                'LOW: Edge-case during clock synchronization or sleep/resume.'
            );
        } else {
            recordPass('ADV-2.3', 'Negative dt handled monotonically', `wetness: ${wetAfterRainNeg}`);
        }
    }

    // =========================================================================
    // SUITE 3: UNDERGLOW PALETTE BOUNDARY VALUES & INPUT SANITIZATION
    // =========================================================================
    console.log('\n--- SUITE 3: UNDERGLOW PALETTE BOUNDARY VALUES & INPUT SANITIZATION ---');

    // 3.1 3-digit shorthand hex misparsing
    {
        const { parseHexColor } = require(ENHANCEMENTS_PATH);
        const parsed = parseHexColor('#fff');
        // Expected white: 0xffffff = 16777215. Actual: parseInt('fff', 16) = 4095 = 0x000fff (dark blue)
        if (parsed !== 0xffffff) {
            recordFail(
                'ADV-3.1',
                "parseHexColor('#fff') 3-digit shorthand hex misparsed as 0x000fff (dark blue) instead of 0xffffff (white)",
                `Input: '#fff' -> slice(1) = 'fff' -> parseInt('fff', 16) = ${parsed} (0x${parsed.toString(16).padStart(6, '0')}). Expected: 16777215 (0xffffff).`,
                'HIGH: User selecting #fff white underglow gets deep dark blue instead of white.'
            );
        } else {
            recordPass('ADV-3.1', "3-digit hex shorthand '#fff' correctly expands to 0xffffff", `parsed: 0x${parsed.toString(16)}`);
        }
    }

    // 3.2 Invalid hex strings (#xyz) return NaN
    {
        const { parseHexColor } = require(ENHANCEMENTS_PATH);
        const parsed = parseHexColor('#xyz');
        if (isNaN(parsed)) {
            recordFail(
                'ADV-3.2',
                "parseHexColor('#xyz') returns NaN instead of falling back to default cyan (0x00f0ff)",
                `parseInt('xyz', 16) produces NaN. Code has no isNaN check for #-prefixed strings, so NaN is returned and passed to Color.setHex(NaN).`,
                'HIGH: Malformed color strings corrupt Three.js Material RGB channels with NaN.'
            );
        } else {
            recordPass('ADV-3.2', "Invalid hex '#xyz' safely defaulted to cyan", `parsed: 0x${parsed.toString(16)}`);
        }
    }

    // 3.3 Negative intensity accepted into Three.js opacity and light
    {
        const { sf, enhancements } = createIsolatedSandbox();
        sf.setUnderglow('#00f0ff', -5.0);
        const mesh = sf.car.root.getObjectByName('UnderglowMesh');

        if (enhancements.state.underglow.intensity < 0) {
            recordFail(
                'ADV-3.3',
                'setUnderglow accepts negative intensity (-5.0) without clamping to 0.0',
                `state.underglow.intensity = ${enhancements.state.underglow.intensity}; mesh.material.opacity = 0.82 * Math.min(1.0, -5.0) = -4.1`,
                'MEDIUM: Negative material opacity and negative light intensity produce rendering anomalies in WebGPU shaders.'
            );
        } else {
            recordPass('ADV-3.3', 'Negative underglow intensity clamped to 0.0', `intensity: ${enhancements.state.underglow.intensity}`);
        }
    }

    // 3.4 Disabling with false / null / undefined
    {
        const { sf, enhancements } = createIsolatedSandbox();
        sf.setUnderglow('#00f0ff', 1.5);
        sf.setUnderglow(false);
        const disabledFalse = !enhancements.state.underglow.enabled;

        sf.setUnderglow('#00f0ff', 1.5);
        sf.setUnderglow(null);
        const disabledNull = !enhancements.state.underglow.enabled;

        sf.setUnderglow('#00f0ff', 1.5);
        sf.setUnderglow(undefined);
        const disabledUndef = !enhancements.state.underglow.enabled;

        if (!disabledFalse || !disabledNull) {
            recordFail('ADV-3.4', 'setUnderglow failed to disable with false/null', `disabledFalse=${disabledFalse}, disabledNull=${disabledNull}`, 'HIGH');
        } else if (!disabledUndef) {
            recordFail(
                'ADV-3.4',
                'setUnderglow(undefined) does not disable underglow due to strict null/false check',
                `Line 315 checks: if (colorHex === false || colorHex === null || intensity === 0). Calling setUnderglow(undefined) bypasses this and enables underglow with undefined color.`,
                'LOW: Inconsistent falsy parameter handling.'
            );
        } else {
            recordPass('ADV-3.4', 'setUnderglow disables cleanly on false, null, and undefined', 'All disabled');
        }
    }

    // =========================================================================
    // SUITE 4: 3D GPS NAVIGATION PATH QUERIES TO OUT-OF-BOUNDS COORDINATES
    // =========================================================================
    console.log('\n--- SUITE 4: 3D GPS NAVIGATION PATH QUERIES TO OUT-OF-BOUNDS COORDINATES ---');

    // 4.1 Extreme Out-of-Bounds Coordinates (x=100,000, z=100,000)
    {
        const { sf, enhancements } = createIsolatedSandbox();
        sf.setGPSDestination(100000, 100000, 'Far Out-of-Bounds');
        const ribbon = sf.scene.getObjectByName('RaceCarpet');

        if (!ribbon) {
            recordFail('ADV-4.1', 'RaceCarpet ribbon mesh was not created for out-of-bounds destination', 'Ribbon is null', 'HIGH');
        } else {
            const posArray = ribbon.geometry.attributes.position.array;
            let nanCount = 0;
            for (let i = 0; i < posArray.length; i++) {
                if (isNaN(posArray[i])) nanCount++;
            }

            if (nanCount > 0) {
                recordFail(
                    'ADV-4.1',
                    'setGPSDestination to out-of-bounds coordinates generates NaN vertices in RaceCarpet geometry',
                    `sf.real.layout.driveHeight(100000, 100000) returns undefined for out-of-bounds coords. y = undefined + 0.12 evaluates to NaN. Generated ${nanCount} NaN coordinates in BufferAttribute.`,
                    'CRITICAL: Vertex buffers containing NaN break GPU bounding box computations, cause WebGPU pipeline errors, or create visual tearing across the viewport.'
                );
            } else {
                recordPass('ADV-4.1', 'Out-of-bounds GPS coordinates handled with valid numeric vertices', `Vertices generated: ${posArray.length / 3}`);
            }
        }
    }

    // 4.2 Non-numeric / NaN GPS Coordinates
    {
        const { sf, enhancements } = createIsolatedSandbox();
        sf.setGPSDestination(NaN, NaN, 'Invalid Coords');
        const ribbon = sf.scene.getObjectByName('RaceCarpet');

        if (ribbon) {
            const posArray = ribbon.geometry.attributes.position.array;
            let nanCount = 0;
            for (let i = 0; i < posArray.length; i++) {
                if (isNaN(posArray[i])) nanCount++;
            }
            if (nanCount > 0) {
                recordFail(
                    'ADV-4.2',
                    'setGPSDestination(NaN, NaN) accepted without sanitization and populated GPU vertex buffer with 630 NaNs',
                    `Generated ${posArray.length} floats with ${nanCount} NaNs without throwing or falling back.`,
                    'HIGH: Corrupted GPS inputs propagate directly into rendering buffers.'
                );
            } else {
                recordPass('ADV-4.2', 'setGPSDestination(NaN, NaN) sanitized safely', 'No NaNs');
            }
        } else {
            recordPass('ADV-4.2', 'setGPSDestination(NaN, NaN) rejected cleanly without creating mesh', 'No mesh');
        }
    }

    // 4.3 GPU Resource Lifecycle: BufferGeometry & Material Disposal
    {
        const three = createThreeMocks();
        const { sf } = createIsolatedSandbox(three);

        // Recalculate destination 25 times (simulating moving player or rerouting)
        for (let i = 0; i < 25; i++) {
            sf.setGPSDestination(100 + i * 5, 200 + i * 5, `Waypoint ${i}`);
        }
        sf.clearGPS();

        const allGeoms = three.getAllocatedGeometries();
        const unDisposed = allGeoms.filter(g => !g.disposed);

        if (unDisposed.length > 0) {
            recordFail(
                'ADV-4.3',
                'GPU MEMORY LEAK: setGPSDestination and clearGPS remove meshes from scene without calling .geometry.dispose() or .material.dispose()',
                `Allocated ${allGeoms.length} BufferGeometries; ${unDisposed.length} were orphaned without calling .dispose(). Three.js WebGPU backend retains GPU buffers in VRAM indefinitely until .dispose() is called.`,
                'HIGH: Persistent VRAM leak on every GPS route recalculation during gameplay.'
            );
        } else {
            recordPass('ADV-4.3', 'GPS route recalculations properly dispose BufferGeometries', `All ${allGeoms.length} disposed`);
        }
    }

    // 4.4 API Interface Contract: window.__sf.gps
    {
        const { sf } = createIsolatedSandbox();
        sf.setGPSDestination(500, -1200, 'Golden Gate Vista');

        if (!sf.gps) {
            recordFail(
                'ADV-4.4',
                'Interface Contract Violation: window.__sf.gps is not exposed by setGPSDestination',
                `PROJECT.md § M4 Navigation Contract and tier4 test 4.1 specify window.__sf.gps must be populated with active state ({ target: { x, z, label } }), but __sf.gps is undefined.`,
                'CRITICAL: Fails M4 Navigation Interface Contract and breaks external HUD/minimap consumers expecting __sf.gps.'
            );
        } else {
            sf.clearGPS();
            if (sf.gps !== null) {
                recordFail('ADV-4.4', 'clearGPS does not reset window.__sf.gps to null', `__sf.gps = ${sf.gps}`, 'HIGH');
            } else {
                recordPass('ADV-4.4', 'window.__sf.gps contract fulfilled', 'Exposed and cleared properly');
            }
        }
    }

    // =========================================================================
    // HARNESS SUMMARY & FINDINGS VERDICT
    // =========================================================================
    console.log('\n================================================================');
    console.log(`  EMPIRICAL ADVERSARIAL STRESS TEST SUMMARY: ${results.passed} PASSED, ${results.failed} FAILED`);
    console.log('================================================================');

    if (results.vulnerabilities.length > 0) {
        console.log(`\nDiscovered ${results.vulnerabilities.length} confirmed empirical vulnerabilities:`);
        results.vulnerabilities.forEach((v, idx) => {
            console.log(`\n[Vulnerability ${idx + 1}] [${v.testId}] ${v.title}`);
            console.log(`  Evidence: ${v.details}`);
            console.log(`  Impact:   ${v.impact}`);
        });
    }

    process.exit(results.failed > 0 ? 1 : 0);
}

runTestSuite().catch(err => {
    console.error('Fatal crash in challenge harness:', err);
    process.exit(2);
});
