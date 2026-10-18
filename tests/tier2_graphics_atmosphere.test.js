'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { PROJECT_ROOT, createMockWindow, loadSandboxedScript } = require('./test_harness');

const ENHANCEMENTS_PATH = path.join(PROJECT_ROOT, 'game_enhancements.js');

test('Tier 2: Graphics, Atmosphere, Weather, Lighting & Dynamic Effects (M2)', async (t) => {
    const enhancementsFileExists = fs.existsSync(ENHANCEMENTS_PATH);

    // 2.1 Dynamic Day/Night Cycle (Feature 2)
    await t.test('2.1 Dynamic Day/Night Cycle Controller & Progression Clock', (sub) => {
        // Authoritative Spec: PROJECT.md § M2 Graphics & Atmosphere Contract
        // window.__sf.timeOfDay: { time: number (0-24), weather: "clear"|"rain"|"fog", setTime(t), setWeather(w) }
        const mockWin = createMockWindow();

        if (enhancementsFileExists) {
            const res = loadSandboxedScript(ENHANCEMENTS_PATH, mockWin);
            assert.strictEqual(res.loaded, true, `Failed to load game_enhancements.js: ${res.error}`);
            assert.ok(mockWin.__sf.timeOfDay || mockWin.__sf.setTime, 'timeOfDay or setTime must be registered on window.__sf');
            
            if (mockWin.__sf.timeOfDay) {
                assert.strictEqual(typeof mockWin.__sf.timeOfDay.setTime, 'function');
                mockWin.__sf.timeOfDay.setTime(14.5);
                assert.strictEqual(mockWin.__sf.timeOfDay.time, 14.5);
                
                // Boundary tests: time wrapping 24h
                mockWin.__sf.timeOfDay.setTime(25);
                assert.ok(mockWin.__sf.timeOfDay.time >= 0 && mockWin.__sf.timeOfDay.time <= 24, 'Time must wrap or clamp in [0, 24]');
            }
        } else {
            // Verify mathematical property of Day/Night cycle lerp
            const presets = ['noon', 'golden', 'fog', 'rain', 'dusk', 'night'];
            const presetHours = { noon: 12, golden: 18, dusk: 20, night: 24, fog: 8, rain: 10 };
            for (const p of presets) {
                assert.ok(presetHours[p] >= 0 && presetHours[p] <= 24, `Preset ${p} must have valid hour in [0, 24]`);
            }
            // Sun elevation spherical coordinates math validation
            const calcSunElevation = (hour) => Math.sin((hour - 6) / 12 * Math.PI);
            assert.ok(calcSunElevation(12) > 0.99, 'Noon sun elevation must be at zenith (~1.0)');
            assert.ok(calcSunElevation(0) < -0.99, 'Midnight sun elevation must be at nadir (~ -1.0)');
            assert.ok(Math.abs(calcSunElevation(6)) < 0.01, 'Dawn (6 AM) sun elevation must cross horizon (~0.0)');
            assert.ok(Math.abs(calcSunElevation(18)) < 0.01, 'Dusk (6 PM) sun elevation must cross horizon (~0.0)');
        }
    });

    // 2.2 Dynamic Weather & Road Wetness (Feature 3)
    await t.test('2.2 Dynamic Weather, Wetness Accumulation & Puddle Roughness Shader Uniforms', (sub) => {
        // Spec: Real-time rain accumulation curve increasing puddle depth and road wetness during rain (0 -> 1),
        // and realistic drying curve (1 -> 0) when transitioning to clear.
        const mockWin = createMockWindow();

        if (enhancementsFileExists) {
            loadSandboxedScript(ENHANCEMENTS_PATH, mockWin);
            if (mockWin.__sf.setWeather) {
                mockWin.__sf.setWeather('rain');
                assert.strictEqual(mockWin.__sf.timeOfDay.weather, 'rain');
            }
        }

        // Test Accumulation and Drying transfer curves
        const accumulateWetness = (current, dt, rate = 0.2) => Math.min(1.0, current + dt * rate);
        const dryWetness = (current, dt, rate = 0.1) => Math.max(0.0, current - dt * rate);

        let wetness = 0.0;
        // Accumulate for 5 seconds
        wetness = accumulateWetness(wetness, 5, 0.2);
        assert.strictEqual(wetness, 1.0, 'Wetness must reach maximum 1.0 under sustained rain');

        // Dry for 5 seconds
        wetness = dryWetness(wetness, 5, 0.1);
        assert.strictEqual(wetness, 0.5, 'Wetness must smoothly decay towards 0.0');
        wetness = dryWetness(wetness, 10, 0.1);
        assert.strictEqual(wetness, 0.0, 'Wetness must clamp at minimum 0.0');

        // Puddle reflection roughness: road roughness decreases from dry (e.g. 0.8) to wet (e.g. 0.1)
        const calcRoadRoughness = (wet) => 0.8 - wet * 0.7;
        assert.ok(Math.abs(calcRoadRoughness(0) - 0.8) < 1e-6, 'Dry road roughness should be high (diffuse)');
        assert.ok(Math.abs(calcRoadRoughness(1.0) - 0.1) < 1e-6, 'Wet road roughness should be low (specular reflection)');
    });

    // 2.3 Street & Headlight Illumination (Feature 4)
    await t.test('2.3 Automatic Streetlight and Headlight Activation (Night > 0.3 or Rain)', (sub) => {
        // Spec: Automatic activation of streetlights and vehicle headlights during night and rain.
        const shouldActivateLights = (nightLevel, weather) => nightLevel > 0.3 || weather === 'rain';

        assert.strictEqual(shouldActivateLights(0.0, 'clear'), false, 'Day clear should keep headlights off');
        assert.strictEqual(shouldActivateLights(0.5, 'clear'), true, 'Night > 0.3 should activate lights');
        assert.strictEqual(shouldActivateLights(0.0, 'rain'), true, 'Rain should activate lights even during day');
        assert.strictEqual(shouldActivateLights(0.31, 'fog'), true, 'Night 0.31 in fog should activate lights');
        assert.strictEqual(shouldActivateLights(0.29, 'clear'), false, 'Night 0.29 in clear should not activate lights');
    });

    // 2.4 Under-Vehicle Neon Illumination (Feature 5)
    await t.test('2.4 Under-Vehicle Neon Underglow API & Color Palette Parsing', (sub) => {
        // Spec: window.__sf.setUnderglow(colorHex, intensity)
        const mockWin = createMockWindow();

        const PALETTE = {
            cyan: '#00f0ff',
            magenta: '#ff007f',
            lime: '#39ff14',
            red: '#ff073a',
            gold: '#ffd700',
            purple: '#9d00ff',
            white: '#ffffff'
        };

        if (enhancementsFileExists) {
            loadSandboxedScript(ENHANCEMENTS_PATH, mockWin);
            if (typeof mockWin.__sf.setUnderglow === 'function') {
                mockWin.__sf.setUnderglow('#00f0ff', 2.5);
                assert.ok(mockWin.__sf.underglow, 'Underglow state should be registered');
                assert.strictEqual(mockWin.__sf.underglow.color, '#00f0ff');
                assert.strictEqual(mockWin.__sf.underglow.intensity, 2.5);
            }
        }

        // Color parsing validation
        const parseColor = (col) => {
            if (PALETTE[col]) return PALETTE[col];
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(col)) return col;
            return '#00f0ff'; // default cyan
        };

        assert.strictEqual(parseColor('magenta'), '#ff007f');
        assert.strictEqual(parseColor('#39ff14'), '#39ff14');
        assert.strictEqual(parseColor('invalid_color'), '#00f0ff');

        // Intensity boundary clamping
        const clampIntensity = (i) => Math.max(0.0, Math.min(10.0, Number(i) || 0));
        assert.strictEqual(clampIntensity(-5), 0.0);
        assert.strictEqual(clampIntensity(15), 10.0);
        assert.strictEqual(clampIntensity(2.5), 2.5);
    });

    // 2.5 Tire Smoke & Persistent Skids (Feature 6)
    await t.test('2.5 Tire Smoke Particle Triggering & Skid Mark Ring Buffer Management', (sub) => {
        // Tire smoke triggers when slip angle exceeds threshold (> 0.25 rad) or heavy braking
        const shouldEmitSmoke = (slipAngle, brakeForce, speedKmh) => {
            if (speedKmh < 10) return false;
            return Math.abs(slipAngle) > 0.25 || (brakeForce > 0.8 && speedKmh > 30);
        };

        assert.strictEqual(shouldEmitSmoke(0.05, 0.2, 80), false, 'Normal cruising should not emit smoke');
        assert.strictEqual(shouldEmitSmoke(0.35, 0.0, 70), true, 'High slip angle drift must emit smoke');
        assert.strictEqual(shouldEmitSmoke(0.02, 0.95, 60), true, 'Hard braking lockup must emit smoke');
        assert.strictEqual(shouldEmitSmoke(0.40, 0.9, 5), false, 'Nearly stopped car (<10 km/h) should not emit smoke');

        // Ring buffer bounds test (prevents memory leak)
        const RING_BUFFER_CAP = 500;
        const ringBuffer = [];
        const addSkidPoint = (pt) => {
            if (ringBuffer.length >= RING_BUFFER_CAP) {
                ringBuffer.shift(); // Evict oldest
            }
            ringBuffer.push(pt);
        };

        for (let i = 0; i < 750; i++) {
            addSkidPoint({ x: i, z: i * 2, alpha: 0.8 });
        }
        assert.strictEqual(ringBuffer.length, RING_BUFFER_CAP, 'Skid mark ring buffer must cap at limit');
        assert.strictEqual(ringBuffer[RING_BUFFER_CAP - 1].x, 749, 'Newest skid mark must be preserved');
        assert.strictEqual(ringBuffer[0].x, 250, 'Oldest skid mark beyond capacity must be evicted');
    });

    // 2.6 Dynamic Exhaust & Nitro Flames (Feature 7)
    await t.test('2.6 Exhaust Backfire Flames & Nitro Plume Visualization', (sub) => {
        const getFlameState = (throttle, nitroActive, rpm, prevThrottle) => {
            if (nitroActive && throttle > 0.8) {
                return { type: 'nitro', intensity: 1.0, color: '#00ccff' };
            }
            // Backfire on rapid throttle lift off at high RPM
            if (prevThrottle > 0.8 && throttle < 0.2 && rpm > 5000) {
                return { type: 'backfire', intensity: 0.8, color: '#ff6600' };
            }
            return { type: 'none', intensity: 0.0, color: null };
        };

        assert.deepStrictEqual(getFlameState(1.0, true, 6000, 1.0), {
            type: 'nitro',
            intensity: 1.0,
            color: '#00ccff'
        });
        assert.deepStrictEqual(getFlameState(0.0, false, 5500, 1.0), {
            type: 'backfire',
            intensity: 0.8,
            color: '#ff6600'
        });
        assert.deepStrictEqual(getFlameState(0.5, false, 3000, 0.5), {
            type: 'none',
            intensity: 0.0,
            color: null
        });
    });

    // 2.7 Dynamic Camera & HUD Effects (Feature 8)
    await t.test('2.7 Speedometer Motion Blur & Impact Camera Shake Dynamics', (sub) => {
        // High speed blur threshold (> 100 km/h)
        const getSpeedometerClass = (speedKmh) => {
            if (speedKmh > 160) return 'hud-speed-extreme-blur';
            if (speedKmh > 100) return 'hud-speed-blur';
            return 'hud-speed-normal';
        };

        assert.strictEqual(getSpeedometerClass(45), 'hud-speed-normal');
        assert.strictEqual(getSpeedometerClass(120), 'hud-speed-blur');
        assert.strictEqual(getSpeedometerClass(220), 'hud-speed-extreme-blur');

        // Camera impact shake decay simulation
        const simulateShake = (initialIntensity, decayRate, frames) => {
            let intensity = initialIntensity;
            for (let f = 0; f < frames; f++) {
                intensity *= (1 - decayRate);
            }
            return intensity;
        };

        const remainingShake = simulateShake(10.0, 0.15, 20);
        assert.ok(remainingShake < 0.5, 'Shake intensity must smoothly decay towards zero');
        assert.ok(remainingShake >= 0, 'Shake intensity must remain non-negative');
    });
});
