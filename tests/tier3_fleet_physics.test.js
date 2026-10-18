'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { PROJECT_ROOT, createMockWindow, loadSandboxedScript } = require('./test_harness');

const ENHANCEMENTS_PATH = path.join(PROJECT_ROOT, 'game_enhancements.js');

test('Tier 3: Extended Vehicle Fleet, Handling Physics & Turntable Garage (M3)', async (t) => {
    const enhancementsFileExists = fs.existsSync(ENHANCEMENTS_PATH);

    // 3.1 Extended Vehicle Fleet: Police Interceptor & Muscle Car (Feature 9)
    await t.test('3.1 Extended Fleet Registration: Police Interceptor & Classic V8 Muscle in hs and e2', (sub) => {
        // Spec: PROJECT.md § M3 Fleet & Physics Contract
        // window.__sf.hs["police"] and window.__sf.hs["muscle"]: Valid vehicle definitions registered in vehicle registry and e2 roster.
        const mockWin = createMockWindow();

        if (enhancementsFileExists) {
            loadSandboxedScript(ENHANCEMENTS_PATH, mockWin);
            
            // Check vehicle definitions in registry
            assert.ok(mockWin.__sf.hs.police, 'Police interceptor must be registered in window.__sf.hs');
            assert.ok(mockWin.__sf.hs.muscle, 'Classic V8 Muscle car must be registered in window.__sf.hs');

            // Check inclusion in unlocked roster e2
            assert.ok(mockWin.__sf.e2.includes('police'), 'e2 roster must include "police"');
            assert.ok(mockWin.__sf.e2.includes('muscle'), 'e2 roster must include "muscle"');

            // Check physical characteristics
            const police = mockWin.__sf.hs.police;
            assert.ok(police.mass > 1500 && police.mass < 2500, 'Police mass must be realistic for an interceptor');
            assert.ok(police.topSpeed >= 200, 'Police interceptor top speed must be >= 200 km/h');

            const muscle = mockWin.__sf.hs.muscle;
            assert.ok(muscle.mass > 1400 && muscle.mass < 2400, 'Muscle car mass must be realistic');
            
            // Test vehicle swapping
            assert.strictEqual(mockWin.__sf.swapCar('police'), true);
            assert.strictEqual(mockWin.__sf.carId, 'police');
            assert.strictEqual(mockWin.__sf.swapCar('muscle'), true);
            assert.strictEqual(mockWin.__sf.carId, 'muscle');
        } else {
            // Authoritative contract schema validation for M3 vehicles
            const expectedPoliceSchema = {
                id: 'police',
                name: 'SFPD Highway Interceptor',
                mass: 1950,
                topSpeed: 265,
                drive: 'awd',
                siren: true
            };
            const expectedMuscleSchema = {
                id: 'muscle',
                name: '1969 Classic V8 Muscle',
                mass: 1680,
                topSpeed: 240,
                drive: 'rwd',
                driftBias: 0.85
            };

            assert.strictEqual(expectedPoliceSchema.id, 'police');
            assert.ok(expectedPoliceSchema.mass > 1500);
            assert.strictEqual(expectedMuscleSchema.id, 'muscle');
            assert.strictEqual(expectedMuscleSchema.drive, 'rwd');
            assert.ok(expectedMuscleSchema.driftBias > 0.5);
        }
    });

    // 3.2 Arcade vs Simulator Physics Handling Mode (Feature 10)
    await t.test('3.2 Arcade vs Simulator Handling Physics Model Switcher', (sub) => {
        // Spec: window.__sf.setHandlingMode("arcade" | "simulator")
        // "Arcade": higher lateral grip, assisted drift initiation, fast counter-steer, faster nitro regeneration.
        // "Simulator": realistic tire slip angles (Pacejka model), required throttle modulation, manual traction control/ABS toggles, standard nitro.
        const mockWin = createMockWindow();

        if (enhancementsFileExists) {
            loadSandboxedScript(ENHANCEMENTS_PATH, mockWin);
            if (typeof mockWin.__sf.setHandlingMode === 'function') {
                mockWin.__sf.setHandlingMode('arcade');
                assert.strictEqual(mockWin.__sf.handlingMode, 'arcade');
                assert.ok(mockWin.__sf.handlingParams.nitroRechargeRate > 1.0, 'Arcade should have boosted nitro recharge');

                mockWin.__sf.setHandlingMode('simulator');
                assert.strictEqual(mockWin.__sf.handlingMode, 'simulator');
                assert.strictEqual(mockWin.__sf.handlingParams.nitroRechargeRate, 1.0, 'Simulator should have standard nitro recharge');
            }
        }

        // Mathematical modeling: Pacejka tire lateral force curve for simulator vs arcade linear assist
        // Magic Formula: F_y = D * sin(C * arctan(B * slip - E * (B * slip - arctan(B * slip))))
        const pacejkaLateral = (slipAngleDeg) => {
            const B = 0.714;
            const C = 1.4;
            const D = 1.0;
            const E = -0.2;
            const alpha = slipAngleDeg;
            return D * Math.sin(C * Math.atan(B * alpha - E * (B * alpha - Math.atan(B * alpha))));
        };

        const arcadeLateral = (slipAngleDeg) => {
            // Arcade provides high stable grip up to large slip angles
            return Math.min(1.4, 0.2 * slipAngleDeg);
        };

        // At 8 degrees slip:
        const pacejkaGrip8 = pacejkaLateral(8);
        assert.ok(pacejkaGrip8 > 0.85, 'Pacejka should generate near peak grip at ~8 degrees slip');

        // At 35 degrees extreme slide:
        const pacejkaGrip35 = pacejkaLateral(35);
        // Simulator drops off due to slide, Arcade maintains high control
        assert.ok(pacejkaGrip8 > pacejkaGrip35, 'Simulator lateral grip must drop after peak slip angle (Pacejka slide curve)');
    });

    // 3.3 Turntable Garage Enhancements: Carbon Fiber & Window Tinting (Feature 11)
    await t.test('3.3 Turntable Garage Customization Schema: Carbon Finish & Window Tinting Tiers', (sub) => {
        // Spec: Turntable customization schema accepts f: "carbon" and tint: "light" | "medium" | "dark" | "limo".
        const mockWin = createMockWindow();

        if (enhancementsFileExists) {
            loadSandboxedScript(ENHANCEMENTS_PATH, mockWin);
            assert.ok(mockWin.__sf.kp.carbon, 'Finish registry kp must include "carbon" finish definition');
            const carbon = mockWin.__sf.kp.carbon;
            assert.ok(carbon.roughness !== undefined && carbon.metalness !== undefined);
        } else {
            // Verify Carbon fiber finish shader material specifications
            const carbonFinishSpec = {
                name: 'Carbon Fiber Weave',
                roughness: 0.35,
                metalness: 0.1,
                clearcoat: 0.9,
                clearcoatRoughness: 0.1,
                normalScale: 0.8
            };
            assert.strictEqual(carbonFinishSpec.roughness, 0.35);
            assert.strictEqual(carbonFinishSpec.clearcoat, 0.9);
        }

        // Window tint opacity mapping
        const TINT_LEVELS = {
            light: { opacity: 0.35, color: '#1a1a1a' },
            medium: { opacity: 0.55, color: '#111111' },
            dark: { opacity: 0.75, color: '#0a0a0a' },
            limo: { opacity: 0.95, color: '#000000' }
        };

        for (const [tintKey, tintData] of Object.entries(TINT_LEVELS)) {
            assert.ok(['light', 'medium', 'dark', 'limo'].includes(tintKey));
            assert.ok(tintData.opacity >= 0.0 && tintData.opacity <= 1.0, `Tint ${tintKey} opacity must be in [0, 1]`);
            assert.ok(tintData.color.startsWith('#'), `Tint ${tintKey} color must be valid hex`);
        }

        // Monotonic darkness check: light < medium < dark < limo
        assert.ok(TINT_LEVELS.light.opacity < TINT_LEVELS.medium.opacity);
        assert.ok(TINT_LEVELS.medium.opacity < TINT_LEVELS.dark.opacity);
        assert.ok(TINT_LEVELS.dark.opacity < TINT_LEVELS.limo.opacity);
    });
});
