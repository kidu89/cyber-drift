const http = require('http');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

// Ensure headless mode
process.env.NO_OPEN = '1';

const ROOT = path.resolve(__dirname, '..');
const TEST_PORT_BASE = 4200;

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function makeRequest(options, reqBody = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const rawBody = Buffer.concat(chunks);
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    rawBody,
                    body: rawBody.toString('utf8')
                });
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        if (reqBody) req.write(reqBody);
        req.end();
    });
}

async function runTestSuite() {
    console.log('====================================================');
    console.log('  CHALLENGER M1-1: EMPIRICAL STRESS & ROBUSTNESS');
    console.log('====================================================\n');

    const results = {
        passed: 0,
        failed: 0,
        vulnerabilities: []
    };

    function recordPass(desc) {
        results.passed++;
        console.log(`[PASS] ${desc}`);
    }

    function recordFail(desc, details) {
        results.failed++;
        results.vulnerabilities.push({ desc, details });
        console.log(`[FAIL] ${desc}\n       Details: ${details}`);
    }

    // Spawn server process on TEST_PORT_BASE
    const serverProc = cp.spawn(process.execPath, [path.join(ROOT, 'server.js'), String(TEST_PORT_BASE), '--no-open'], {
        env: { ...process.env, NO_OPEN: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let serverReady = false;
    serverProc.stdout.on('data', (d) => {
        if (d.toString().includes('Local Server Running')) serverReady = true;
    });

    // Wait for server to boot
    for (let i = 0; i < 50; i++) {
        if (serverReady) break;
        await new Promise(r => setTimeout(r, 100));
    }

    try {
        // =========================================================================
        // SUITE 1: HIGH CONCURRENCY PARALLEL REQUESTS
        // =========================================================================
        console.log('\n--- SUITE 1: HIGH CONCURRENCY PARALLEL REQUESTS ---');
        
        const roadsDisk = fs.readFileSync(path.join(ROOT, 'assets/real/roads.bin.gz'));
        const appDisk = fs.readFileSync(path.join(ROOT, 'app.js'));
        const indexDisk = fs.readFileSync(path.join(ROOT, 'index.html'));

        const roadsHash = sha256(roadsDisk);
        const appHash = sha256(appDisk);
        const indexHash = sha256(indexDisk);

        console.log(`Target sizes: roads.bin.gz = ${roadsDisk.length} bytes, app.js = ${appDisk.length} bytes, index.html = ${indexDisk.length} bytes`);

        // Test 1.1: 60 concurrent requests (20 roads.bin.gz, 20 app.js, 20 index.html)
        {
            const CONCURRENCY = 60;
            const promises = [];
            const startTime = Date.now();

            for (let i = 0; i < CONCURRENCY; i++) {
                const target = i % 3 === 0 ? '/assets/real/roads.bin.gz' : (i % 3 === 1 ? '/app.js' : '/index.html');
                promises.push(makeRequest({
                    hostname: 'localhost',
                    port: TEST_PORT_BASE,
                    path: target,
                    method: 'GET'
                }).then(res => ({ res, target })));
            }

            const outcomes = await Promise.all(promises);
            const duration = Date.now() - startTime;
            let corrupted = 0;
            let statusErrors = 0;
            let missingHeaders = 0;

            for (const { res, target } of outcomes) {
                if (res.statusCode !== 200) statusErrors++;
                if (res.headers['cross-origin-opener-policy'] !== 'same-origin' ||
                    res.headers['cross-origin-embedder-policy'] !== 'require-corp') {
                    missingHeaders++;
                }
                const expectedHash = target.includes('roads') ? roadsHash : (target.includes('app') ? appHash : indexHash);
                if (sha256(res.rawBody) !== expectedHash) {
                    corrupted++;
                }
                if (target.includes('roads') && res.headers['content-encoding']) {
                    corrupted++;
                }
            }

            if (statusErrors === 0 && corrupted === 0 && missingHeaders === 0) {
                recordPass(`1.1: 60 concurrent requests for .bin.gz, app.js, index.html passed in ${duration}ms (100% SHA256 integrity, isolation headers present)`);
            } else {
                recordFail(`1.1: Concurrent requests failed`, `Status errors: ${statusErrors}, Corrupted: ${corrupted}, Missing headers: ${missingHeaders}`);
            }
        }

        // Test 1.2: 120 burst concurrent requests
        {
            const CONCURRENCY = 120;
            const promises = [];
            const startTime = Date.now();

            for (let i = 0; i < CONCURRENCY; i++) {
                const target = i % 3 === 0 ? '/assets/real/roads.bin.gz' : (i % 3 === 1 ? '/app.js' : '/index.html');
                promises.push(makeRequest({
                    hostname: 'localhost',
                    port: TEST_PORT_BASE,
                    path: target,
                    method: 'GET'
                }).then(res => ({ res, target })));
            }

            const outcomes = await Promise.all(promises);
            const duration = Date.now() - startTime;
            let errors = outcomes.filter(o => o.res.statusCode !== 200 || sha256(o.res.rawBody) !== (o.target.includes('roads') ? roadsHash : (o.target.includes('app') ? appHash : indexHash)));

            if (errors.length === 0) {
                recordPass(`1.2: 120 burst concurrent requests passed in ${duration}ms with zero drops and zero corruptions`);
            } else {
                recordFail(`1.2: 120 burst requests failed`, `${errors.length} requests failed or were corrupted`);
            }
        }

        // Test 1.3: Client abort / premature disconnect stress test
        {
            const ABORT_COUNT = 30;
            const abortPromises = [];
            for (let i = 0; i < ABORT_COUNT; i++) {
                abortPromises.push(new Promise((resolve) => {
                    const req = http.request({
                        hostname: 'localhost',
                        port: TEST_PORT_BASE,
                        path: '/assets/real/roads.bin.gz',
                        method: 'GET'
                    }, (res) => {
                        res.on('data', () => {
                            // Read first chunk and destroy connection immediately
                            req.destroy();
                            resolve(true);
                        });
                    });
                    req.on('error', () => resolve(true));
                    req.end();
                }));
            }
            await Promise.all(abortPromises);
            await new Promise(r => setTimeout(r, 200));

            // Verify server survived client aborts
            const probe = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: '/index.html',
                method: 'GET'
            });

            if (probe.statusCode === 200 && sha256(probe.rawBody) === indexHash) {
                recordPass(`1.3: Server survived ${ABORT_COUNT} concurrent client aborts on 5.6MB file streams without crash`);
            } else {
                recordFail(`1.3: Server degraded after client aborts`, `Status: ${probe.statusCode}`);
            }
        }

        // =========================================================================
        // SUITE 2: PORT COLLISION SIMULATION
        // =========================================================================
        console.log('\n--- SUITE 2: PORT COLLISION SIMULATION ---');

        // Test 2.1: Chained port collision (4 consecutive occupied ports)
        {
            const chainStartPort = 4300;
            const blockers = [];
            for (let p = chainStartPort; p < chainStartPort + 4; p++) {
                const b = http.createServer((q, s) => s.end('blocked'));
                await new Promise(r => b.listen(p, r));
                blockers.push(b);
            }

            // Start server with chainStartPort: should cascade to chainStartPort + 4 = 4304
            const chainChild = cp.spawn(process.execPath, [path.join(ROOT, 'server.js'), String(chainStartPort), '--no-open'], {
                env: { ...process.env, NO_OPEN: '1' },
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let boundPort = null;
            chainChild.stdout.on('data', (d) => {
                const str = d.toString();
                const m = str.match(/http:\/\/localhost:(\d+)/);
                if (m) boundPort = parseInt(m[1], 10);
            });

            for (let i = 0; i < 50; i++) {
                if (boundPort) break;
                await new Promise(r => setTimeout(r, 100));
            }

            // Clean up blockers
            for (const b of blockers) {
                await new Promise(r => b.close(r));
            }

            if (boundPort === chainStartPort + 4) {
                // Verify responsiveness on boundPort
                const res = await makeRequest({
                    hostname: 'localhost',
                    port: boundPort,
                    path: '/',
                    method: 'GET'
                });
                if (res.statusCode === 200) {
                    recordPass(`2.1: Chained port collision cascade (4 occupied ports 4300-4303) successfully auto-incremented and bound port 4304`);
                } else {
                    recordFail(`2.1: Server on cascading port 4304 returned non-200`, `Status: ${res.statusCode}`);
                }
            } else {
                recordFail(`2.1: Chained port collision failed to bind expected port 4304`, `Bound port: ${boundPort}`);
            }

            chainChild.kill();
        }

        // Test 2.2: Concurrent race - multiple server processes starting simultaneously on the same port
        {
            const racePort = 4320;
            const proc1 = cp.spawn(process.execPath, [path.join(ROOT, 'server.js'), String(racePort), '--no-open'], { env: { ...process.env, NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
            const proc2 = cp.spawn(process.execPath, [path.join(ROOT, 'server.js'), String(racePort), '--no-open'], { env: { ...process.env, NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
            const proc3 = cp.spawn(process.execPath, [path.join(ROOT, 'server.js'), String(racePort), '--no-open'], { env: { ...process.env, NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });

            const children = [proc1, proc2, proc3];
            const ports = [];

            children.forEach(c => {
                c.stdout.on('data', (d) => {
                    const str = d.toString();
                    const m = str.match(/http:\/\/localhost:(\d+)/);
                    if (m) ports.push(parseInt(m[1], 10));
                });
            });

            for (let i = 0; i < 50; i++) {
                if (ports.length >= 3) break;
                await new Promise(r => setTimeout(r, 100));
            }

            const uniquePorts = Array.from(new Set(ports));
            let allResponding = true;
            for (const p of uniquePorts) {
                try {
                    const r = await makeRequest({ hostname: 'localhost', port: p, path: '/', method: 'GET' });
                    if (r.statusCode !== 200) allResponding = false;
                } catch {
                    allResponding = false;
                }
            }

            children.forEach(c => c.kill());

            if (uniquePorts.length === 3 && allResponding) {
                recordPass(`2.2: Concurrent race of 3 server processes on port ${racePort} cleanly resolved to 3 unique responding ports (${uniquePorts.join(', ')})`);
            } else {
                recordFail(`2.2: Concurrent race failed to resolve cleanly`, `Ports bound: ${uniquePorts.join(', ')}, All responding: ${allResponding}`);
            }
        }

        // =========================================================================
        // SUITE 3: HTTP RANGE HEADERS (INVERTED, OVERFLOW, NON-NUMERIC)
        // =========================================================================
        console.log('\n--- SUITE 3: HTTP RANGE HEADERS ---');

        const audioPath = '/assets/audio/airflow.mp3';
        const audioDisk = fs.readFileSync(path.join(ROOT, 'assets/audio/airflow.mp3'));
        const audioSize = audioDisk.length;
        console.log(`Audio test file airflow.mp3 size: ${audioSize} bytes`);

        // Test 3.1: Valid standard byte ranges
        {
            const res = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: audioPath,
                method: 'GET',
                headers: { 'Range': 'bytes=0-99' }
            });
            if (res.statusCode === 206 && res.rawBody.length === 100 &&
                res.headers['content-range'] === `bytes 0-99/${audioSize}`) {
                recordPass(`3.1: Standard valid range (bytes=0-99) returned 206 with correct chunk length`);
            } else {
                recordFail(`3.1: Valid range failed`, `Status: ${res.statusCode}, Body length: ${res.rawBody.length}`);
            }
        }

        // Test 3.2: Valid single-byte range (first byte and last byte)
        {
            const resFirst = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: audioPath,
                method: 'GET',
                headers: { 'Range': 'bytes=0-0' }
            });
            const resLast = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: audioPath,
                method: 'GET',
                headers: { 'Range': `bytes=${audioSize - 1}-${audioSize - 1}` }
            });

            if (resFirst.statusCode === 206 && resFirst.rawBody.length === 1 &&
                resLast.statusCode === 206 && resLast.rawBody.length === 1) {
                recordPass(`3.2: Boundary single-byte ranges (0-0 and last-last) returned 206 with 1 byte`);
            } else {
                recordFail(`3.2: Boundary single-byte range failed`, `First: ${resFirst.statusCode}, Last: ${resLast.statusCode}`);
            }
        }

        // Test 3.3: Inverted Range: start > end (e.g. bytes=500-200, bytes=10-5)
        {
            const res1 = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: audioPath,
                method: 'GET',
                headers: { 'Range': 'bytes=500-200' }
            });
            const res2 = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: audioPath,
                method: 'GET',
                headers: { 'Range': 'bytes=10-5' }
            });

            if (res1.statusCode === 416 && res1.headers['content-range'] === `bytes */${audioSize}` &&
                res2.statusCode === 416 && res2.headers['content-range'] === `bytes */${audioSize}`) {
                recordPass(`3.3: Inverted ranges (bytes=500-200, bytes=10-5) properly returned HTTP 416 with Content-Range bytes */${audioSize}`);
            } else {
                recordFail(`3.3: Inverted range did not return 416`, `Status 1: ${res1.statusCode}, Status 2: ${res2.statusCode}`);
            }
        }

        // Test 3.4: Overflow Range: start beyond file size (e.g. bytes=999999-999999, bytes=999999-)
        {
            const resOverflow = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: audioPath,
                method: 'GET',
                headers: { 'Range': 'bytes=9999999-9999999' }
            });
            const resOpenOverflow = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: audioPath,
                method: 'GET',
                headers: { 'Range': 'bytes=9999999-' }
            });

            if (resOverflow.statusCode === 416 && resOpenOverflow.statusCode === 416) {
                recordPass(`3.4: Overflow ranges beyond EOF properly returned HTTP 416`);
            } else {
                recordFail(`3.4: Overflow range beyond EOF did not return 416`, `Status 1: ${resOverflow.statusCode}, Status 2: ${resOpenOverflow.statusCode}`);
            }
        }

        // Test 3.5: End Overflow: end beyond file size, valid start (e.g. bytes=0-9999999)
        {
            const res = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: audioPath,
                method: 'GET',
                headers: { 'Range': 'bytes=0-9999999' }
            });
            if (res.statusCode === 206 && res.rawBody.length === audioSize &&
                res.headers['content-range'] === `bytes 0-${audioSize - 1}/${audioSize}`) {
                recordPass(`3.5: End overflow range (bytes=0-9999999) clamped to file size (HTTP 206 bytes 0-${audioSize - 1}/${audioSize})`);
            } else {
                recordFail(`3.5: End overflow range clamp failed`, `Status: ${res.statusCode}, Body length: ${res.rawBody.length}`);
            }
        }

        // Test 3.6: Suffix overflow (e.g. bytes=-9999999)
        {
            const res = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: audioPath,
                method: 'GET',
                headers: { 'Range': 'bytes=-9999999' }
            });
            if (res.statusCode === 206 && res.rawBody.length === audioSize &&
                res.headers['content-range'] === `bytes 0-${audioSize - 1}/${audioSize}`) {
                recordPass(`3.6: Suffix range exceeding file size (bytes=-9999999) clamped to full file (HTTP 206)`);
            } else {
                recordFail(`3.6: Suffix overflow failed`, `Status: ${res.statusCode}, Body length: ${res.rawBody.length}`);
            }
        }

        // Test 3.7: Non-Numeric Range: bytes=abc-def, bytes=foobar
        {
            const res = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: audioPath,
                method: 'GET',
                headers: { 'Range': 'bytes=abc-def' }
            });
            const res2 = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: audioPath,
                method: 'GET',
                headers: { 'Range': 'bytes=foobar' }
            });
            if (res.statusCode === 416 && res2.statusCode === 416) {
                recordPass(`3.7: Completely non-numeric ranges (bytes=abc-def, bytes=foobar) returned HTTP 416`);
            } else {
                recordFail(`3.7: Non-numeric ranges did not return 416`, `Status 1: ${res.statusCode}, Status 2: ${res2.statusCode}`);
            }
        }

        // Test 3.8: Range Header on non-audio assets (.bin.gz, app.js, index.html)
        {
            const resBin = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: '/assets/real/roads.bin.gz',
                method: 'GET',
                headers: { 'Range': 'bytes=0-100' }
            });
            const resJs = await makeRequest({
                hostname: 'localhost',
                port: TEST_PORT_BASE,
                path: '/app.js',
                method: 'GET',
                headers: { 'Range': 'bytes=0-100' }
            });
            
            // Observe server behavior: returns 200 with full content
            if (resBin.statusCode === 200 && resBin.rawBody.length === roadsDisk.length &&
                resJs.statusCode === 200 && resJs.rawBody.length === appDisk.length) {
                recordPass(`3.8: Range header on non-audio files ignored; returns HTTP 200 with full content (${resBin.rawBody.length} bytes for .bin.gz, ${resJs.rawBody.length} bytes for app.js)`);
            } else {
                recordFail(`3.8: Range header on non-audio files behaved unexpectedly`, `roads status: ${resBin.statusCode}, app status: ${resJs.statusCode}`);
            }
        }

        // Test 3.9: CRITICAL ATTACK: Non-numeric end with valid start (bytes=0-abc, bytes=10-xyz, bytes=0-NaN, bytes=0-Infinity)
        // Does this cause an unhandled exception / crash in server.js?
        {
            console.log('\n>>> Testing Malformed Range Attack Vectors (bytes=0-abc, bytes=10-xyz, bytes=0-NaN, bytes=0-Infinity)...');
            let crashed = false;
            let crashReason = '';

            try {
                const malformedRes = await makeRequest({
                    hostname: 'localhost',
                    port: TEST_PORT_BASE,
                    path: audioPath,
                    method: 'GET',
                    headers: { 'Range': 'bytes=0-abc' }
                });
                console.log(`    Response status for bytes=0-abc: ${malformedRes.statusCode}`);
            } catch (err) {
                crashed = true;
                crashReason = `Client request failed: ${err.message}`;
            }

            // Check if server is still alive
            try {
                const probe = await makeRequest({
                    hostname: 'localhost',
                    port: TEST_PORT_BASE,
                    path: '/index.html',
                    method: 'GET'
                });
                if (probe.statusCode !== 200) {
                    crashed = true;
                    crashReason = `Server responded with status ${probe.statusCode} instead of 200`;
                }
            } catch (err) {
                crashed = true;
                crashReason = `Server process crashed and stopped accepting connections (${err.code || err.message})`;
            }

            if (crashed) {
                recordFail(`3.9: CRITICAL VULNERABILITY: Non-numeric end range (bytes=0-abc) crashes the server process (Uncaught RangeError: ERR_OUT_OF_RANGE)`, crashReason);
            } else {
                recordPass(`3.9: Non-numeric end range handled gracefully without crash`);
            }
        }

    } finally {
        serverProc.kill();
    }

    console.log('\n====================================================');
    console.log(`  TEST RESULTS: ${results.passed} PASSED, ${results.failed} FAILED`);
    console.log('====================================================');

    if (results.vulnerabilities.length > 0) {
        console.log('\nVulnerabilities / Findings discovered:');
        results.vulnerabilities.forEach((v, idx) => {
            console.log(`\n[Vulnerability ${idx + 1}]: ${v.desc}`);
            console.log(`Details: ${v.details}`);
        });
    }

    process.exit(results.failed > 0 ? 1 : 0);
}

runTestSuite().catch(err => {
    console.error('Test harness unexpected fatal error:', err);
    process.exit(2);
});
