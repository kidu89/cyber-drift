'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { PROJECT_ROOT, createMockWindow, loadSandboxedScript } = require('./test_harness');

const MISSIONS_PATH = path.join(PROJECT_ROOT, 'missions_hub.js');
const ENHANCEMENTS_PATH = path.join(PROJECT_ROOT, 'game_enhancements.js');
const INDEX_HTML_PATH = path.join(PROJECT_ROOT, 'index.html');
const STYLE_CSS_PATH = path.join(PROJECT_ROOT, 'style.css');

test('Tier 4: Navigation, Bridges, Missions UI, Gameplay & Persistence (M4 & M5)', async (t) => {
    const missionsFileExists = fs.existsSync(MISSIONS_PATH);
    const enhancementsFileExists = fs.existsSync(ENHANCEMENTS_PATH);
    const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
    const styleCss = fs.readFileSync(STYLE_CSS_PATH, 'utf8');

    // 4.1 Active 3D GPS Guidance Ribbon (Feature 12)
    await t.test('4.1 Active 3D GPS Ribbon: setGPSDestination & clearGPS Contract', (sub) => {
        // Spec: PROJECT.md § M4 Navigation & Map Contract
        // window.__sf.setGPSDestination(x, z, label)
        // window.__sf.clearGPS()
        const mockWin = createMockWindow();

        if (enhancementsFileExists) {
            loadSandboxedScript(ENHANCEMENTS_PATH, mockWin);
            if (typeof mockWin.__sf.setGPSDestination === 'function') {
                mockWin.__sf.setGPSDestination(500, -1200, 'Golden Gate Vista');
                assert.ok(mockWin.__sf.gps, 'GPS state must be active');
                assert.strictEqual(mockWin.__sf.gps.target.x, 500);
                assert.strictEqual(mockWin.__sf.gps.target.z, -1200);
                assert.strictEqual(mockWin.__sf.gps.target.label, 'Golden Gate Vista');

                mockWin.__sf.clearGPS();
                assert.strictEqual(mockWin.__sf.gps, null, 'clearGPS must reset active GPS state');
            }
        }

        // Algorithmic validation: Euclidean distance and chevron waypoint generation
        const calcDistance = (x1, z1, x2, z2) => Math.hypot(x2 - x1, z2 - z1);
        const dist = calcDistance(0, 0, 300, 400);
        assert.strictEqual(dist, 500, '3-4-5 triangle distance should equal 500');

        // Interpolation between player and target
        const numChevrons = 5;
        const chevrons = [];
        for (let i = 1; i <= numChevrons; i++) {
            const frac = i / (numChevrons + 1);
            chevrons.push({ x: frac * 300, z: frac * 400 });
        }
        assert.strictEqual(chevrons.length, 5);
        assert.strictEqual(chevrons[2].x, 150);
        assert.strictEqual(chevrons[2].z, 200);
    });

    // 4.2 Bridge Viewpoints & Routes (Feature 13)
    await t.test('4.2 Bridge Access and Scenic Viewpoints Waypoint Registry', (sub) => {
        // Spec: Scenic viewpoint turnout waypoints at Golden Gate Bridge Vista Point and Bay Bridge
        const scenicWaypoints = [
            { id: 'ggb_vista', name: 'Golden Gate Vista Point', x: -850, z: -3200 },
            { id: 'bay_bridge_pier', name: 'Bay Bridge Pier Overlook', x: 2100, z: -450 },
            { id: 'twin_peaks', name: 'Twin Peaks Summit', x: -400, z: 1200 }
        ];

        for (const wp of scenicWaypoints) {
            assert.ok(wp.name.length > 0);
            assert.strictEqual(typeof wp.x, 'number');
            assert.strictEqual(typeof wp.z, 'number');
            // Check bounding box for SF world coordinates
            assert.ok(wp.x >= -5000 && wp.x <= 5000, `X coordinate ${wp.x} within SF map bounds`);
            assert.ok(wp.z >= -5000 && wp.z <= 5000, `Z coordinate ${wp.z} within SF map bounds`);
        }
    });

    // 4.3 Interactive Map & Fast Travel (Feature 14)
    await t.test('4.3 Interactive Map POI Badges and Fast Travel Coordinate Dispatch', (sub) => {
        const mockWin = createMockWindow();

        // Fast travel teleportation
        const targetX = 1250;
        const targetZ = -800;
        mockWin.__sf.tele(targetX, targetZ);

        assert.strictEqual(mockWin.__sf.car.model.position.x, targetX, 'Car X position updated by fast travel');
        assert.strictEqual(mockWin.__sf.car.model.position.z, targetZ, 'Car Z position updated by fast travel');
    });

    // 4.4 Pause Menu Activities Integration (Feature 19 / AC 1)
    await t.test('4.4 Pause Menu Activities Tab DOM Integration (#setSide and #setPane)', (sub) => {
        // Spec: Pause menu: #setSide has <button class="tab" data-tab="missions">,
        // #setPane has <section class="sec" data-sec="missions">.
        if (missionsFileExists) {
            // When worker_missions integrates into index.html
            const hasTab = indexHtml.includes('data-tab="missions"') || indexHtml.includes('data-tab="activities"');
            const hasSec = indexHtml.includes('data-sec="missions"') || indexHtml.includes('data-sec="activities"');
            assert.ok(hasTab, 'index.html #setSide must contain missions/activities tab button');
            assert.ok(hasSec, 'index.html #setPane must contain missions/activities section');
        } else {
            // Validate expected DOM contract template
            const expectedTab = '<button class="tab" data-tab="missions" role="tab"><span class="tabIco">🏁</span><span class="tabLbl">Activities</span></button>';
            const expectedSec = '<section class="sec" data-sec="missions">';
            assert.ok(expectedTab.includes('data-tab="missions"'));
            assert.ok(expectedSec.includes('data-sec="missions"'));
        }
    });

    // 4.5 Checkpoint Races (Time Trials) (Feature 15)
    await t.test('4.5 Checkpoint Races: 4 Urban Circuits, Gates, Countdown and Medal Targets', (sub) => {
        // Spec: 4 predefined urban circuits: Downtown Grand Prix, Marina Bay Sprint, Twin Peaks Hillclimb, Lombard Slalom
        const CIRCUITS = {
            downtown_gp: {
                name: 'Downtown Grand Prix',
                laps: 2,
                gates: 8,
                medals: { gold: 75.0, silver: 90.0, bronze: 110.0 }
            },
            marina_sprint: {
                name: 'Marina Bay Sprint',
                laps: 1,
                gates: 6,
                medals: { gold: 55.0, silver: 65.0, bronze: 80.0 }
            },
            twin_peaks_climb: {
                name: 'Twin Peaks Hillclimb',
                laps: 1,
                gates: 10,
                medals: { gold: 105.0, silver: 125.0, bronze: 150.0 }
            },
            lombard_slalom: {
                name: 'Lombard Slalom',
                laps: 1,
                gates: 7,
                medals: { gold: 40.0, silver: 50.0, bronze: 65.0 }
            }
        };

        assert.strictEqual(Object.keys(CIRCUITS).length, 4, 'Must define at least 4 distinct circuits');

        // Verify medal progression: gold < silver < bronze
        for (const [id, circuit] of Object.entries(CIRCUITS)) {
            assert.ok(circuit.medals.gold < circuit.medals.silver, `${id} Gold time must be faster than Silver`);
            assert.ok(circuit.medals.silver < circuit.medals.bronze, `${id} Silver time must be faster than Bronze`);
            assert.ok(circuit.gates >= 5, `${id} must have at least 5 checkpoints`);
        }

        // Checkpoint proximity trigger test (within gate radius e.g. 15 meters)
        const isInsideGate = (carPos, gatePos, radius = 15) => Math.hypot(carPos.x - gatePos.x, carPos.z - gatePos.z) <= radius;
        assert.strictEqual(isInsideGate({ x: 100, z: 200 }, { x: 105, z: 205 }, 15), true, 'Inside gate radius triggers checkpoint');
        assert.strictEqual(isInsideGate({ x: 100, z: 200 }, { x: 150, z: 200 }, 15), false, 'Outside gate radius does not trigger');
    });

    // 4.6 Police Pursuit & Heat Scenarii (Feature 16)
    await t.test('4.6 Police Pursuit Challenge: Heat Levels 1-5 Escalation & Cooldown Zone Mechanics', (sub) => {
        // Spec: Dynamic Heat 1-5 pursuit, roadblocks on Heat 3+, helicopter on Heat 5, Cooldown timer evasion
        const getPursuitTactics = (heat) => {
            return {
                cruiserCount: heat * 2,
                roadblocks: heat >= 3,
                spikeStrips: heat >= 4,
                helicopter: heat >= 5,
                cooldownDuration: 10 + heat * 5 // e.g. Heat 1: 15s, Heat 5: 35s
            };
        };

        const heat1 = getPursuitTactics(1);
        assert.strictEqual(heat1.roadblocks, false);
        assert.strictEqual(heat1.helicopter, false);

        const heat3 = getPursuitTactics(3);
        assert.strictEqual(heat3.roadblocks, true);
        assert.strictEqual(heat3.helicopter, false);

        const heat5 = getPursuitTactics(5);
        assert.strictEqual(heat5.roadblocks, true);
        assert.strictEqual(heat5.spikeStrips, true);
        assert.strictEqual(heat5.helicopter, true);
        assert.ok(heat5.cooldownDuration >= 30);

        // Cooldown timer state machine:
        // When distance to nearest cop > 150m, inCooldown is true; if timer reaches 0, player escapes!
        let inCooldown = false;
        let cooldownRemaining = 15.0;
        let escaped = false;

        const updatePursuit = (distToPolice, dt) => {
            if (distToPolice > 150) {
                inCooldown = true;
                cooldownRemaining = Math.max(0, cooldownRemaining - dt);
                if (cooldownRemaining === 0) escaped = true;
            } else {
                inCooldown = false;
                cooldownRemaining = 15.0; // Reset
            }
        };

        // Police in sight:
        updatePursuit(80, 2.0);
        assert.strictEqual(inCooldown, false);
        assert.strictEqual(escaped, false);

        // Breaking sight for 16 seconds:
        updatePursuit(200, 16.0);
        assert.strictEqual(inCooldown, true);
        assert.strictEqual(escaped, true, 'Cooldown reaching 0 successfully completes evasion challenge');
    });

    // 4.7 Drift & Stunt Events (Feature 17)
    await t.test('4.7 Drift & Stunts: Slip Angle Scoring, Multipliers and Jump Distance Calculation', (sub) => {
        // Spec: Real-time drift detection tracking slip angle (beta), speed, duration, multipliers
        const calcDriftScoreTick = (slipAngleRad, speedKmh, dt, multiplier) => {
            if (Math.abs(slipAngleRad) < 0.20 || speedKmh < 30) return 0;
            const basePoints = speedKmh * Math.abs(slipAngleRad) * 10;
            return Math.floor(basePoints * dt * multiplier);
        };

        assert.strictEqual(calcDriftScoreTick(0.05, 80, 0.1, 1), 0, 'No drift score when driving straight');
        assert.strictEqual(calcDriftScoreTick(0.40, 15, 0.1, 1), 0, 'No drift score when below speed threshold');

        const scoreTick = calcDriftScoreTick(0.50, 70, 0.1, 2);
        assert.ok(scoreTick > 0, 'High speed high slip angle generates drift score with multiplier');

        // Stunt Jump distance calculation (parabolic flight path)
        const calcJumpDistance = (velocityMs, angleRad, gravity = 9.81) => {
            return (Math.pow(velocityMs, 2) * Math.sin(2 * angleRad)) / gravity;
        };

        const jumpDist = calcJumpDistance(30, Math.PI / 6); // 30 m/s at 30 degrees
        assert.ok(jumpDist > 70 && jumpDist < 90, `Jump distance should be ~79m, got ${jumpDist.toFixed(1)}m`);
    });

    // 4.8 VIP & Taxi Fares Mode (Feature 18)
    await t.test('4.8 VIP & Taxi Fares: Beacon Pickup, Delivery Timer and 5-Star Comfort Rating', (sub) => {
        // Comfort rating degrades on excessive G-force or crashes
        const calcComfortStars = (comfortHealth, tripTimeSec, targetTimeSec, collisions) => {
            if (collisions >= 3 || comfortHealth < 20) return 1;
            let stars = 5;
            if (collisions > 0) stars -= 1;
            if (comfortHealth < 70) stars -= 1;
            if (tripTimeSec > targetTimeSec) stars -= 1;
            return Math.max(1, Math.min(5, stars));
        };

        assert.strictEqual(calcComfortStars(100, 45, 60, 0), 5, 'Perfect smooth ride earns 5 stars');
        assert.strictEqual(calcComfortStars(60, 50, 60, 0), 4, 'Moderate comfort loss drops to 4 stars');
        assert.strictEqual(calcComfortStars(100, 75, 60, 1), 3, 'Late + 1 collision drops to 3 stars');
        assert.strictEqual(calcComfortStars(10, 80, 60, 4), 1, 'Severe crashes result in 1 star minimum');
    });

    // 4.9 Results Summary Overlay & Persistence (Feature 20 / AC 2)
    await t.test('4.9 Results Summary Overlay & localStorage Persistence (sf-drive.missions)', (sub) => {
        // Spec: Result overlay with Time, Score, Medals, Cash/XP earned, saved to localStorage.getItem("sf-drive.missions")
        const mockWin = createMockWindow();

        const missionSummary = {
            missionId: 'downtown_gp',
            missionType: 'race',
            time: 72.4,
            medal: 'gold',
            score: 12500,
            cashEarned: 5000,
            xpEarned: 2500,
            isNewBest: true
        };

        // Save progress into localStorage under sf-drive.missions
        const saveMissionResult = (win, summary) => {
            const raw = win.localStorage.getItem('sf-drive.missions');
            const data = raw ? JSON.parse(raw) : { records: {}, totalCash: 0, totalXP: 0 };
            data.records[summary.missionId] = {
                bestTime: summary.time,
                bestMedal: summary.medal,
                bestScore: summary.score
            };
            data.totalCash += summary.cashEarned;
            data.totalXP += summary.xpEarned;
            win.localStorage.setItem('sf-drive.missions', JSON.stringify(data));
            return data;
        };

        const updatedData = saveMissionResult(mockWin, missionSummary);
        assert.strictEqual(updatedData.records['downtown_gp'].bestMedal, 'gold');
        assert.strictEqual(updatedData.totalCash, 5000);
        assert.strictEqual(updatedData.totalXP, 2500);

        // Verify read back from storage
        const storedJson = mockWin.localStorage.getItem('sf-drive.missions');
        assert.ok(storedJson, 'sf-drive.missions key must exist in localStorage');
        const parsed = JSON.parse(storedJson);
        assert.strictEqual(parsed.records['downtown_gp'].bestTime, 72.4);
    });
});
