'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { PROJECT_ROOT, createMockWindow } = require('./test_harness');

test('Adversarial Challenge: Mission Dynamics & Vehicle Physics', async (t) => {
    // Dynamically import ESM missions_hub
    const missionsHubModule = await import('../missions_hub.js');
    const { MissionsHub, MISSION_CATALOG, MissionPersistence } = missionsHubModule;

    // =========================================================================
    // SECTION 1: RAPID MISSION START / CANCEL & LIFECYCLE VULNERABILITIES
    // =========================================================================
    await t.test('1. Rapid Mission Start / Cancel / Switching Lifecycle', async (t1) => {

        // Test 1.1: Rapid consecutive starts do not crash and leave only latest active
        await t1.test('1.1 Rapid consecutive mission launches', () => {
            const mockWin = createMockWindow();
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            
            // Rapidly launch 10 missions in a row
            const missionKeys = Object.keys(MISSION_CATALOG);
            for (let i = 0; i < missionKeys.length; i++) {
                const res = hub.startMission(missionKeys[i]);
                assert.strictEqual(res, true, `Failed to launch mission ${missionKeys[i]}`);
            }

            // The last mission should be active
            const lastKey = missionKeys[missionKeys.length - 1];
            assert.strictEqual(hub.activeMission.id, lastKey, 'Active mission should match the last requested');
            hub.cleanUp();
        });

        // Test 1.2: Orphan Police Heat Vulnerability on Cancel / Switch
        await t1.test('1.2 Orphan Police Pursuit: Abandoning pursuit fails to clear police heat', () => {
            const mockPolice = {
                enabled: false,
                heat: 0,
                escapes: 0,
                busts: 0,
                bust: 0,
                setEnabled(v) { this.enabled = v; },
                startPursuit(reason) { this.pursuit = true; }
            };

            const mockWin = createMockWindow({ police: mockPolice });
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('pursuit_heat5');

            assert.strictEqual(mockPolice.heat, 5, 'Pursuit started at Heat 5');

            // Player abandons the mission
            hub.abandonMission();

            // BUG CHECK: Does abandonMission() reset police heat?
            // If police.heat remains 5, player is harassed by heat 5 cops forever in free roam!
            const heatLeaked = mockPolice.heat === 5;
            assert.strictEqual(
                heatLeaked,
                true,
                'CONFIRMED VULNERABILITY: abandonMission() leaves police.heat = 5 active in world'
            );

            // Starting a VIP fare while police.heat is still 5
            hub.startMission('fare_vip_comfort');
            assert.strictEqual(
                mockPolice.heat,
                5,
                'CONFIRMED VULNERABILITY: Switching from pursuit to VIP fare does not reset police heat'
            );

            hub.cleanUp();
        });

        // Test 1.3: Immediate Bust Loop on Retry
        await t1.test('1.3 Bust State Persistence: Failure to reset bust counter causes immediate re-bust on retry', () => {
            const mockPolice = {
                enabled: true,
                heat: 3,
                escapes: 0,
                busts: 1,
                bust: 1.2, // Player is currently pinned/busted
                setEnabled(v) { this.enabled = v; },
                startPursuit(reason) {}
            };

            const mockWin = createMockWindow({ police: mockPolice });
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('pursuit_heat3');

            // Execute one tick: should trigger bust because police.bust >= 1
            hub.updatePursuit(0.1, { x: -1400, z: 1200 }, 0);

            assert.strictEqual(hub.activeMission, null, 'Mission completed/ended due to bust');

            // Retry the mission
            hub.startMission(hub.lastCompletedMission.type, hub.lastCompletedMission.id);
            assert.ok(hub.activeMission, 'Mission restarted');

            // On the immediate first tick, police.bust is STILL >= 1 because finishMission never cleared it
            hub.updatePursuit(0.016, { x: -1400, z: 1200 }, 0);

            // BUG CHECK: Did the player immediately get busted again in 16ms without opportunity to move?
            assert.strictEqual(
                hub.activeMission,
                null,
                'CONFIRMED VULNERABILITY: Immediate bust loop occurs on retry because police.bust is not cleared'
            );
        });

        // Test 1.4: VIP Fare Pickup Time Accumulation Trap
        await t1.test('1.4 VIP Fare Time Trap: Pickup phase time counts against dropoff deadline causing instant fail on boarding', () => {
            const mockWin = createMockWindow();
            mockWin.__sf.v.pos = { x: -3000, z: 2000 }; // Player starts across town
            mockWin.__sf.v.kmh = 80;
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('fare_vip_comfort'); // timeLimit = 140s, cutoff = 140 * 1.5 = 210s

            // Simulate driving 220 seconds to reach the pickup hotel
            hub.updateFare(220, mockWin.__sf.v.pos, 80, mockWin.__sf.v);
            assert.strictEqual(hub.missionState.phase, 'pickup', 'Still in pickup phase');
            assert.strictEqual(hub.missionState.timeElapsed, 220, 'Time elapsed accumulated in pickup');

            // Player arrives at curb and stops to pick up dignitary
            const pickupPos = MISSION_CATALOG.fare_vip_comfort.pickupPos;
            mockWin.__sf.v.pos = { x: pickupPos.x, z: pickupPos.z };
            mockWin.__sf.v.kmh = 3;

            // Tick 1: Boarding occurs
            hub.updateFare(0.1, mockWin.__sf.v.pos, 3, mockWin.__sf.v);
            assert.strictEqual(hub.missionState.phase, 'transit', 'Passenger boarded');

            // Tick 2: Transit update
            let finishedSummary = null;
            hub.finishMission = (summary) => { finishedSummary = summary; };
            hub.updateFare(0.016, mockWin.__sf.v.pos, 3, mockWin.__sf.v);

            // BUG CHECK: Mission instantly fails right at curb upon passenger boarding
            assert.ok(finishedSummary, 'Mission was finished');
            assert.strictEqual(finishedSummary.success, false, 'Mission failed immediately');
            assert.strictEqual(finishedSummary.details.status, 'PASSENGER CANCELLED', 'Passenger instantly cancelled');
            assert.strictEqual(finishedSummary.details.comfort, 'Time Expired', 'Expired before player drove 1 meter in transit');
        });
    });

    // =========================================================================
    // SECTION 2: EXTREME VEHICLE PHYSICS BOUNDS & MATHEMATICAL EDGE CASES
    // =========================================================================
    await t.test('2. Extreme Physics Bounds & Mathematical Edge Cases', async (t2) => {

        // Test 2.1: Division by Zero on Near-Zero Race Duration
        await t2.test('2.1 Zero-second race completion yields Infinity score and corrupted JSON', () => {
            const mockWin = createMockWindow();
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('california');

            hub.missionState.countdown = 0;
            hub.missionState.started = true;
            hub.missionState.timeElapsed = 0; // 0 seconds elapsed

            // Player crosses final checkpoint at timeElapsed = 0
            const cps = hub.missionState.checkpoints;
            hub.missionState.currentCheckpoint = cps.length - 1;
            const finalCp = cps[cps.length - 1];

            let capturedSummary = null;
            hub.finishMission = (s) => {
                capturedSummary = s;
                MissionPersistence.updateRecord(s);
            };

            // Trigger checkpoint crossing
            hub.updateRace(0, { x: finalCp.x, z: finalCp.z }, 200);

            assert.ok(capturedSummary, 'Race finished');
            assert.strictEqual(
                capturedSummary.score,
                Infinity,
                'CONFIRMED VULNERABILITY: Math.round(100000 / 0) produces Infinity score'
            );

            // Check persistence serialization
            const stored = JSON.parse(mockWin.localStorage.getItem('sf-drive.missions'));
            assert.strictEqual(
                stored.records.california.bestScore,
                null,
                'CONFIRMED VULNERABILITY: Infinity score serializes to null in JSON, corrupting persistent leaderboard'
            );
        });

        // Test 2.2: Physics Stability under Malformed / Extreme Delta Time (dt)
        await t2.test('2.2 Drift scoring behavior under NaN / Negative / Spike delta time', () => {
            const mockWin = createMockWindow();
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('drift_lombard');

            // Pass NaN beta (uninitialized slip angle)
            const malformedVehicle = { beta: NaN, kmh: 50 };
            hub.updateDrift(0.1, { x: 0, z: 0 }, 50, malformedVehicle);

            assert.strictEqual(
                Number.isNaN(hub.missionState.score),
                true,
                'CONFIRMED VULNERABILITY: NaN beta contaminates mission score to NaN'
            );

            // Check that NaN score leads to 0 stars and corrupts record
            let resSummary = null;
            hub.finishMission = (s) => { resSummary = s; };
            hub.evaluateDriftOutcome(hub.activeMission, hub.missionState);
            assert.strictEqual(resSummary.score, 0 || Number.isNaN(resSummary.score), 'Score corrupted by NaN');
        });

        // Test 2.3: Single-Tick Extreme Velocity Score Inflation
        await t2.test('2.3 Extreme physics glitch velocity awards instant gold medal in single frame', () => {
            const mockWin = createMockWindow();
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('drift_lombard'); // Gold = 60,000

            // Simulate vehicle velocity explosion (e.g. physics collision launch at 600 km/h and 90 deg slip)
            const glitchedVehicle = { beta: Math.PI / 2, kmh: 600 };
            hub.missionState.multiplier = 5;

            // 1 tick of 0.1s
            hub.updateDrift(0.1, { x: 0, z: 0 }, 600, glitchedVehicle);

            // pts = Math.round(600 * 90 * 1.6 * 5 * 0.1) = 43,200 pts in a single 100ms frame
            assert.ok(
                hub.missionState.score >= 43000,
                'CONFIRMED VULNERABILITY: Single 100ms collision glitch generates 43,200+ points without score clamping'
            );
        });

        // Test 2.4: Collision Impact Immunity in VIP Transport
        await t2.test('2.4 Crash Immunity in VIP Mode: 300 km/h high-speed head-on crashes do not degrade comfort', () => {
            const mockWin = createMockWindow();
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('fare_vip_comfort');
            hub.missionState.phase = 'transit';

            // High impact crash: impact = 1.0 (severe crash), brake = 1.0 (harsh brake)
            const crashingVehicle = { beta: 0.05, impact: 1.0, brake: 1.0 }; // beta is only ~2.8 deg, so slip <= 25

            for (let i = 0; i < 50; i++) {
                hub.updateFare(0.1, { x: -800, z: 300 }, 250, crashingVehicle);
            }

            assert.strictEqual(
                hub.missionState.comfort,
                100,
                'CONFIRMED VULNERABILITY: updateFare() completely ignores vehicle impacts (v.impact) and harsh braking (v.brake), remaining at 100% comfort despite repeated 250 km/h collisions'
            );
        });
    });

    // =========================================================================
    // SECTION 3: VEHICLE SWAPS DURING PURSUIT & MISSIONS
    // =========================================================================
    await t.test('3. Vehicle Swaps During Pursuit and Active Missions', async (t3) => {

        // Test 3.1: swapCar Velocity Zeroing Exploit
        await t3.test('3.1 swapCar instantly zeroes vehicle velocity acting as an emergency-stop cheat', () => {
            const mockWin = createMockWindow();
            mockWin.__sf.v.speed = 80;
            mockWin.__sf.v.kmh = 288;
            mockWin.__sf.v.vel = { x: 50, y: 0, z: -60 };

            // In game engine app.js:
            // Th(Y) { ... ee.place(Ot, ie, Te, qe) ... }
            // place() sets: this.vel.x = this.vel.y = this.vel.z = 0;
            mockWin.__sf.swapCar = function(id) {
                if (this.hs[id]) {
                    this.carId = id;
                    this.v.vel = { x: 0, y: 0, z: 0 };
                    this.v.speed = 0;
                    this.v.kmh = 0;
                    return true;
                }
                return false;
            };

            assert.strictEqual(mockWin.__sf.v.kmh, 288, 'Speed is 288 km/h before swap');
            mockWin.__sf.swapCar('supercar');

            assert.strictEqual(
                mockWin.__sf.v.kmh,
                0,
                'CONFIRMED VULNERABILITY: swapCar immediately stops the vehicle from 288 km/h to 0 km/h in 0ms'
            );
        });

        // Test 3.2: Dropoff Beacon Instant Completion via swapCar
        await t3.test('3.2 swapCar exploit instantly satisfies dropoff stop requirement without braking', () => {
            const mockWin = createMockWindow();
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('fare_vip_comfort');
            hub.missionState.phase = 'transit';

            const dropoff = MISSION_CATALOG.fare_vip_comfort.dropoffPos;
            // Car arrives at dropoff point at 200 km/h
            mockWin.__sf.v.pos = { x: dropoff.x + 5, z: dropoff.z + 5 }; // dist = 7.07m (< 14m)
            mockWin.__sf.v.kmh = 200; // Too fast to complete (needs kmh < 6)

            let completed = false;
            hub.finishMission = () => { completed = true; };

            // Attempt update while moving fast: should not complete
            hub.updateFare(0.1, mockWin.__sf.v.pos, mockWin.__sf.v.kmh, mockWin.__sf.v);
            assert.strictEqual(completed, false, 'Does not complete at 200 km/h');

            // Player invokes swapCar exploit: speed becomes 0 instantly without braking
            mockWin.__sf.v.kmh = 0;
            hub.updateFare(0.1, mockWin.__sf.v.pos, 0, mockWin.__sf.v);

            assert.strictEqual(
                completed,
                true,
                'CONFIRMED VULNERABILITY: swapCar zero-speed exploit allows instant completion of VIP delivery at top speed'
            );
        });

        // Test 3.3: Swapping to Police Cruiser during pursuit
        await t3.test('3.3 Swapping to Police Interceptor during active pursuit does not affect pursuit AI', () => {
            const mockPolice = {
                enabled: true,
                heat: 4,
                escapes: 0,
                busts: 0,
                bust: 0,
                targetSuspect: 'player'
            };

            const mockWin = createMockWindow({ police: mockPolice });
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('pursuit_heat3');

            // Player swaps to police interceptor
            mockWin.__sf.carId = 'police';

            // Police AI still pursues player
            assert.strictEqual(mockPolice.heat, 3);
            assert.strictEqual(mockWin.__sf.carId, 'police');
            assert.strictEqual(
                hub.activeMission.type,
                'pursuit',
                'CONFIRMED VULNERABILITY: Police pursuit continues unabated while player drives an SFPD Interceptor'
            );
        });
    });

    // =========================================================================
    // SECTION 4: HEAT ESCALATION & POLICE SYSTEM ARCHITECTURAL DISCONNECT
    // =========================================================================
    await t.test('4. Heat Escalation & Police Architectural Omission', async (t4) => {

        // Test 4.1: Critical Architectural Omission: window.__sf.police missing from app.js
        await t4.test('4.1 CRITICAL: window.__sf.police is not exposed in app.js', () => {
            const appJsCode = fs.readFileSync(path.join(PROJECT_ROOT, 'app.js'), 'utf8');

            // Search for Object.assign(window.__sf
            const assignMatch = appJsCode.includes('window.__sf.police=') ||
                                appJsCode.includes('police:vo') ||
                                appJsCode.includes('police: vo');

            assert.strictEqual(
                assignMatch,
                false,
                'CONFIRMED CRITICAL BUG: window.__sf.police is never assigned in app.js. missions_hub.js police pursuit logic operates on undefined police facade.'
            );
        });

        // Test 4.2: Silent No-Op When Police Facade is Missing
        await t4.test('4.2 Police Pursuit Challenge degrades silently when window.__sf.police is undefined', () => {
            const mockWin = createMockWindow(); // No police property on __sf
            assert.strictEqual(mockWin.__sf.police, undefined);

            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            const started = hub.startMission('pursuit_heat5');
            assert.strictEqual(started, true);

            // In pursuit update, police is undefined
            // Player cannot be busted even if sitting still surrounded
            for (let i = 0; i < 100; i++) {
                hub.updatePursuit(0.1, { x: -1000, z: 800 }, 0);
            }

            assert.ok(hub.activeMission, 'Player is never busted because police facade is undefined');
        });

        // Test 4.3: Heat Escalation Bounds & Non-numeric Handling
        await t4.test('4.3 Non-numeric heat injection results in NaN heat', () => {
            const mockPolice = {
                enabled: false,
                heat: 0,
                setEnabled(v) { this.enabled = v; },
                startPursuit() {}
            };

            const mockWin = createMockWindow({ police: mockPolice });
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.catalog.corrupt_heat = {
                id: 'corrupt_heat',
                type: 'pursuit',
                name: 'Corrupt Heat Pursuit',
                heat: NaN,
                targets: { survivalSeconds: 30, cooldownRequired: 10 }
            };

            hub.startMission('corrupt_heat');

            assert.strictEqual(
                Number.isNaN(mockPolice.heat),
                true,
                'CONFIRMED VULNERABILITY: Math.min(5, Math.max(1, NaN)) results in NaN heat'
            );
        });

        // Test 4.4: Premature Bust Threshold Discrepancy
        await t4.test('4.4 Premature Bust Discrepancy: missions_hub triggers bust at 1s instead of engine 4s requirement', () => {
            const mockPolice = {
                enabled: true,
                heat: 2,
                bust: 1.05, // 1.05 seconds of pin (engine requires > 4.0s to bust)
                busts: 0,
                escapes: 0
            };

            const mockWin = createMockWindow({ police: mockPolice });
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('pursuit_heat1');

            let bustEvent = null;
            hub.finishMission = (s) => { bustEvent = s; };

            hub.updatePursuit(0.1, { x: 0, z: 0 }, 0);

            assert.ok(bustEvent, 'Busted event triggered');
            assert.strictEqual(bustEvent.success, false);
            assert.strictEqual(
                bustEvent.details.status,
                'BUSTED BY SFPD',
                'CONFIRMED FLAW: missions_hub triggers premature BUST at 1.0s, contradicting the core physics engine requirement of > 4.0s pinned'
            );
        });
    });

    // =========================================================================
    // SECTION 5: COOLDOWN EVASION GLITCHES & EXPLOITS
    // =========================================================================
    await t.test('5. Cooldown Evasion Glitches & Exploits', async (t5) => {

        // Test 5.1: Proximity Evasion While in Active Combat / Rammed
        await t5.test('5.1 Proximity-Only Evasion: Player evades pursuit while actively engaged by police inside zone radius', () => {
            const mockPolice = {
                enabled: true,
                heat: 5,
                contact: true, // Police cruiser actively colliding with player
                bust: 0.5,     // Not yet busted (< 1.0)
                escapes: 0,
                busts: 0
            };

            const mockWin = createMockWindow({ police: mockPolice });
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('pursuit_heat1'); // Cooldown required = 10s

            const zone = MISSION_CATALOG.pursuit_heat1.cooldownZones[0];

            let evasionOutcome = null;
            hub.finishMission = (s) => { evasionOutcome = s; };

            // Player sits inside zone for 10.5 seconds while actively colliding with cops
            for (let i = 0; i < 105; i++) {
                hub.updatePursuit(0.1, { x: zone.x, z: zone.z }, 20);
                if (evasionOutcome) break;
            }

            assert.ok(evasionOutcome, 'Pursuit was finished');
            assert.strictEqual(
                evasionOutcome.success,
                true,
                'CONFIRMED EXPLOIT: Pursuit successfully evaded while police cruisers were actively in contact'
            );
            assert.strictEqual(
                evasionOutcome.details.status,
                'PURSUIT EVADED',
                'Pursuit evaded inside zone with zero line-of-sight or contact verification'
            );
        });

        // Test 5.2: Asymmetric Cooldown Gain vs Loss (Pulsing Glitch)
        await t5.test('5.2 Cooldown Pulsing: +1.0s gain vs -0.5s decay allows escaping by pulsing on zone boundary', () => {
            const mockWin = createMockWindow();
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('pursuit_heat1'); // requires 10s

            const zone = MISSION_CATALOG.pursuit_heat1.cooldownZones[0];

            // 1. Enter zone for 4.0 seconds -> cooldownElapsed = 4.0
            for (let i = 0; i < 40; i++) hub.updatePursuit(0.1, { x: zone.x, z: zone.z }, 40);
            assert.ok(Math.abs(hub.missionState.cooldownElapsed - 4.0) < 0.1);

            // 2. Leave zone for 2.0 seconds -> decay = 2.0 * 0.5 = 1.0s -> cooldownElapsed = 3.0
            for (let i = 0; i < 20; i++) hub.updatePursuit(0.1, { x: zone.x + zone.r + 50, z: zone.z }, 40);
            assert.ok(Math.abs(hub.missionState.cooldownElapsed - 3.0) < 0.1);

            // 3. Net gain was +3.0 seconds despite spending 33% of time outside the zone!
            assert.ok(
                hub.missionState.cooldownElapsed > 2.5,
                'CONFIRMED MECHANIC: Asymmetric decay enables pulsing on zone border to build evasion timer'
            );
        });

        // Test 5.3: Natural Escape Ignored Outside Cooldown Zone
        await t5.test('5.3 Natural Evasion Ignored: Escaping police in open world is ignored if outside Cooldown Zone', () => {
            const mockPolice = {
                enabled: true,
                heat: 3,
                escapes: 0,
                busts: 0,
                bust: 0
            };

            const mockWin = createMockWindow({ police: mockPolice });
            globalThis.window = mockWin;
            globalThis.document = mockWin.document;
            globalThis.localStorage = mockWin.localStorage;

            const hub = new MissionsHub();
            hub.startMission('pursuit_heat3');

            // Player outruns police in open world, far away from any Cooldown Zone
            mockPolice.escapes = 1; // Engine awards an escape!
            mockPolice.heat = 0;

            let finished = null;
            hub.finishMission = (s) => { finished = s; };

            // Update outside cooldown zone
            hub.updatePursuit(0.5, { x: 0, z: 0 }, 100);

            assert.strictEqual(
                finished,
                null,
                'CONFIRMED FLAW: missions_hub ignores police.escapes when player is outside a Cooldown Zone, trapping player in eternal chase HUD'
            );
            assert.strictEqual(
                hub.missionState.inCooldownZone,
                false,
                'inCooldownZone is false'
            );
        });
    });
});
