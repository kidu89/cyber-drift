#!/usr/bin/env node
'use strict';

const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const TIERS = [
    {
        tier: 1,
        id: 'tier1',
        title: 'Tier 1: Server Infrastructure & Static Asset Integrity',
        file: path.join(__dirname, 'tier1_server_static.test.js'),
        milestone: 'M1',
        features: ['Feature 1: Server Execution, Headers, Fallbacks, Range Streaming & Static Integrity']
    },
    {
        tier: 2,
        id: 'tier2',
        title: 'Tier 2: Graphics, Atmosphere, Weather, Lighting & Dynamic Effects',
        file: path.join(__dirname, 'tier2_graphics_atmosphere.test.js'),
        milestone: 'M2',
        features: [
            'Feature 2: Dynamic Day/Night Progression Clock',
            'Feature 3: Dynamic Weather, Wetness & Puddle Reflection Uniforms',
            'Feature 4: Street & Vehicle Headlight Auto-Illumination',
            'Feature 5: Under-Vehicle Neon Glow API & Palette Parsing',
            'Feature 6: Tire Smoke Particles & Skid Mark Persistent Ring Buffer',
            'Feature 7: Dynamic Exhaust Backfire & Nitro Flame Visualization',
            'Feature 8: Speedometer Motion Blur & Impact Camera Shake Dynamics'
        ]
    },
    {
        tier: 3,
        id: 'tier3',
        title: 'Tier 3: Vehicle Fleet Expansion, Handling Physics & Turntable Garage',
        file: path.join(__dirname, 'tier3_fleet_physics.test.js'),
        milestone: 'M3',
        features: [
            'Feature 9: Playable Police Interceptor & Classic V8 Muscle in Fleet Roster',
            'Feature 10: Arcade vs Simulator Handling Physics Switcher (Pacejka Curve)',
            'Feature 11: Turntable Garage Customization: Carbon Finish & Window Tinting Tiers'
        ]
    },
    {
        tier: 4,
        id: 'tier4',
        title: 'Tier 4: Navigation, Bridges, Missions UI, Gameplay & Persistence',
        file: path.join(__dirname, 'tier4_missions_navigation.test.js'),
        milestone: 'M4, M5',
        features: [
            'Feature 12: Active 3D GPS Guidance Ribbon on Road Surface',
            'Feature 13: Extended Bridge Access & Scenic Viewpoints Waypoint Registry',
            'Feature 14: Interactive Map POI Badges & Fast Travel Teleportation',
            'Feature 15: Checkpoint Races: 4 Urban Circuits, Gates, Countdown & Medals',
            'Feature 16: Police Pursuit Heat 1-5 Escalation & Cooldown Zone Mechanics',
            'Feature 17: Drift & Stunts: Slip Angle Scoring, Multipliers & Jump Trajectory',
            'Feature 18: VIP & Taxi Fares: Beacon Pickup & 5-Star Comfort Rating',
            'Feature 19: Pause Menu Activities Tab DOM Integration (#setSide, #setPane)',
            'Feature 20: Post-Mission Results Scorecard Overlay & localStorage Persistence'
        ]
    }
];

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        tier: null,
        json: false,
        verbose: false,
        strict: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--all') {
            options.tier = 'all';
        } else if (arg.startsWith('--tier=')) {
            options.tier = parseInt(arg.split('=')[1], 10);
        } else if (arg === '-t' || arg === '--tier') {
            options.tier = parseInt(args[++i], 10);
        } else if (arg === '--json') {
            options.json = true;
        } else if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
        } else if (arg === '--strict') {
            options.strict = true;
        }
    }

    if (!options.tier) options.tier = 'all';
    return options;
}

function runTierTest(tierDef, verbose) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const proc = cp.spawn(process.execPath, ['--test', tierDef.file], {
            cwd: PROJECT_ROOT,
            env: { ...process.env, NO_OPEN: '1' },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => {
            stdout += d.toString('utf8');
            if (verbose) process.stdout.write(d);
        });

        proc.stderr.on('data', (d) => {
            stderr += d.toString('utf8');
            if (verbose) process.stderr.write(d);
        });

        proc.on('close', (code) => {
            const durationMs = Date.now() - startTime;
            
            // Parse test counts from output
            // e.g. "ℹ pass 12", "ℹ fail 0", "ℹ tests 12"
            const passMatch = stdout.match(/ℹ pass (\d+)/);
            const failMatch = stdout.match(/ℹ fail (\d+)/);
            const totalMatch = stdout.match(/ℹ tests (\d+)/);

            const passed = passMatch ? parseInt(passMatch[1], 10) : (code === 0 ? 1 : 0);
            const failed = failMatch ? parseInt(failMatch[1], 10) : (code === 0 ? 0 : 1);
            const total = totalMatch ? parseInt(totalMatch[1], 10) : (passed + failed);

            resolve({
                tier: tierDef.tier,
                id: tierDef.id,
                title: tierDef.title,
                milestone: tierDef.milestone,
                features: tierDef.features,
                exitCode: code,
                durationMs,
                passed,
                failed,
                total,
                status: code === 0 && failed === 0 ? 'PASSED' : 'FAILED',
                output: stdout + stderr
            });
        });
    });
}

async function main() {
    const opts = parseArgs();

    let targetTiers = TIERS;
    if (opts.tier !== 'all') {
        targetTiers = TIERS.filter(t => t.tier === opts.tier);
        if (targetTiers.length === 0) {
            console.error(`Invalid tier: ${opts.tier}. Must be 1, 2, 3, 4, or "all".`);
            process.exit(1);
        }
    }

    if (!opts.json) {
        console.log('================================================================');
        console.log('      TELEOPERATOR SAN FRANCISCO E2E TEST RUNNER (TIERS 1-4)    ');
        console.log('================================================================');
        console.log(`Execution Mode: ${opts.tier === 'all' ? 'All Tiers (1-4)' : `Tier ${opts.tier}`}`);
        console.log(`Working Directory: ${PROJECT_ROOT}`);
        console.log(`Node Runtime: ${process.version}\n`);
    }

    const tierResults = [];
    let allPassed = true;

    for (const tierDef of targetTiers) {
        if (!opts.json) {
            process.stdout.write(`Executing ${tierDef.title} (${tierDef.milestone})... `);
        }

        const res = await runTierTest(tierDef, opts.verbose);
        tierResults.push(res);

        if (!opts.json) {
            if (res.status === 'PASSED') {
                console.log(`\x1b[32m[PASS]\x1b[0m (${res.passed}/${res.total} tests in ${res.durationMs}ms)`);
            } else {
                console.log(`\x1b[31m[FAIL]\x1b[0m (${res.failed} failures in ${res.durationMs}ms)`);
                allPassed = false;
            }
        } else {
            if (res.status !== 'PASSED') allPassed = false;
        }
    }

    const totalDuration = tierResults.reduce((acc, r) => acc + r.durationMs, 0);
    const totalPassed = tierResults.reduce((acc, r) => acc + r.passed, 0);
    const totalFailed = tierResults.reduce((acc, r) => acc + r.failed, 0);
    const totalTests = tierResults.reduce((acc, r) => acc + r.total, 0);

    if (opts.json) {
        const jsonReport = {
            summary: {
                totalTiers: targetTiers.length,
                passedTiers: tierResults.filter(r => r.status === 'PASSED').length,
                status: allPassed ? 'PASSED' : 'FAILED',
                totalTests,
                totalPassed,
                totalFailed,
                totalDurationMs: totalDuration,
                timestamp: new Date().toISOString()
            },
            tiers: tierResults.map(r => ({
                tier: r.tier,
                id: r.id,
                milestone: r.milestone,
                title: r.title,
                status: r.status,
                passed: r.passed,
                failed: r.failed,
                total: r.total,
                durationMs: r.durationMs,
                featuresCovered: r.features
            }))
        };
        console.log(JSON.stringify(jsonReport, null, 2));
    } else {
        console.log('\n================================================================');
        console.log('                      TEST EXECUTION SUMMARY                    ');
        console.log('================================================================');
        console.log(`Status:         ${allPassed ? '\x1b[32mALL TESTS PASSED\x1b[0m' : '\x1b[31mSOME TESTS FAILED\x1b[0m'}`);
        console.log(`Tiers Ran:      ${targetTiers.length} / 4`);
        console.log(`Total Tests:    ${totalTests}`);
        console.log(`Passed Tests:   \x1b[32m${totalPassed}\x1b[0m`);
        console.log(`Failed Tests:   ${totalFailed > 0 ? `\x1b[31m${totalFailed}\x1b[0m` : '0'}`);
        console.log(`Total Duration: ${totalDuration} ms`);
        console.log('----------------------------------------------------------------');
        console.log('Feature Coverage Matrix (PROJECT.md Features 1-20):');
        for (const tr of tierResults) {
            console.log(`\n[Tier ${tr.tier}] ${tr.title} (${tr.status}):`);
            for (const f of tr.features) {
                console.log(`  ✓ ${f}`);
            }
        }
        console.log('================================================================\n');
    }

    process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
    console.error('Fatal error in test runner:', err);
    process.exit(1);
});
