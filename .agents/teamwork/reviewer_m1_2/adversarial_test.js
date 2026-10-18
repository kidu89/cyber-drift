const http = require('http');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

// Update progress heartbeat
fs.writeFileSync(
    path.join(__dirname, 'progress.md'),
    `# Progress — Reviewer M1-2\n\n- Last visited: ${new Date().toISOString()}\n- Status: Running adversarial stress tests\n`
);

const { server, startServer, MIME_TYPES, DEFAULT_PORT } = require('../../../server.js');

function request(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: buffer.toString('utf8'),
                    buffer
                });
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function runAdversarialSuite() {
    const results = [];
    const runTest = async (name, fn) => {
        try {
            await fn();
            results.push({ name, pass: true });
            console.log(`PASS: ${name}`);
        } catch (err) {
            results.push({ name, pass: false, error: err.message, stack: err.stack });
            console.log(`FAIL: ${name} -> ${err.message}`);
        }
    };

    const ADV_PORT = 49152; // Ephemeral range to prevent collision
    await new Promise(resolve => server.listen(ADV_PORT, resolve));

    try {
        // --- 1. BINARY STREAMING STRESS TESTS ---
        await runTest('Binary 1: .bin.gz with browser Accept-Encoding gzip/br does NOT send Content-Encoding: gzip', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: '/assets/real/roads.bin.gz',
                method: 'GET',
                headers: {
                    'Accept-Encoding': 'gzip, deflate, br, zstd',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers['content-type'], 'application/octet-stream');
            assert.strictEqual(res.headers['content-encoding'], undefined, 'Server must not gzip encode pre-compressed .bin.gz');
            const diskFile = fs.readFileSync(path.join(__dirname, '../../../assets/real/roads.bin.gz'));
            assert.strictEqual(res.buffer.length, diskFile.length);
            assert.strictEqual(res.buffer.compare(diskFile), 0, 'Served buffer must match disk file exactly byte-for-byte');
        });

        await runTest('Binary 2: Transparent fallback .bin -> .bin.gz matches disk .bin.gz byte-for-byte', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: '/assets/real/roads.bin',
                method: 'GET'
            });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers['content-type'], 'application/octet-stream');
            assert.strictEqual(res.headers['content-encoding'], undefined);
            const diskFile = fs.readFileSync(path.join(__dirname, '../../../assets/real/roads.bin.gz'));
            assert.strictEqual(res.buffer.compare(diskFile), 0);
        });

        await runTest('Binary 3: Non-existent .bin file without .gz returns 404', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: '/assets/real/nonexistent_mesh.bin',
                method: 'GET'
            });
            assert.strictEqual(res.statusCode, 404);
        });

        // --- 2. AUDIO RANGE STRESS TESTS ---
        const audioPath = '/assets/audio/airflow.mp3';
        const audioDiskSize = fs.statSync(path.join(__dirname, '../../../assets/audio/airflow.mp3')).size;

        await runTest('Audio Range 1: Suffix range bytes=-100 (last 100 bytes)', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: audioPath,
                headers: { 'Range': 'bytes=-100' }
            });
            assert.strictEqual(res.statusCode, 206);
            assert.strictEqual(res.headers['content-range'], `bytes ${audioDiskSize - 100}-${audioDiskSize - 1}/${audioDiskSize}`);
            assert.strictEqual(res.headers['content-length'], '100');
            assert.strictEqual(res.buffer.length, 100);

            // Compare with disk slice
            const fd = fs.openSync(path.join(__dirname, '../../../assets/audio/airflow.mp3'), 'r');
            const expectedBuf = Buffer.alloc(100);
            fs.readSync(fd, expectedBuf, 0, 100, audioDiskSize - 100);
            fs.closeSync(fd);
            assert.strictEqual(res.buffer.compare(expectedBuf), 0, 'Last 100 bytes must match actual audio file end');
        });

        await runTest('Audio Range 2: Suffix range larger than total file bytes=-999999', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: audioPath,
                headers: { 'Range': 'bytes=-999999' }
            });
            assert.strictEqual(res.statusCode, 206);
            assert.strictEqual(res.headers['content-range'], `bytes 0-${audioDiskSize - 1}/${audioDiskSize}`);
            assert.strictEqual(res.headers['content-length'], String(audioDiskSize));
            assert.strictEqual(res.buffer.length, audioDiskSize);
        });

        await runTest('Audio Range 3: Inverted range bytes=500-200 returns HTTP 416', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: audioPath,
                headers: { 'Range': 'bytes=500-200' }
            });
            assert.strictEqual(res.statusCode, 416);
            assert.strictEqual(res.headers['content-range'], `bytes */${audioDiskSize}`);
        });

        await runTest('Audio Range 4: Out of bounds range bytes=500000-600000 returns HTTP 416', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: audioPath,
                headers: { 'Range': 'bytes=500000-600000' }
            });
            assert.strictEqual(res.statusCode, 416);
            assert.strictEqual(res.headers['content-range'], `bytes */${audioDiskSize}`);
        });

        await runTest('Audio Range 5: Range beyond file size bytes=500000- returns HTTP 416', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: audioPath,
                headers: { 'Range': 'bytes=500000-' }
            });
            assert.strictEqual(res.statusCode, 416);
            assert.strictEqual(res.headers['content-range'], `bytes */${audioDiskSize}`);
        });

        await runTest('Audio Range 6: Exact single byte range bytes=0-0', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: audioPath,
                headers: { 'Range': 'bytes=0-0' }
            });
            assert.strictEqual(res.statusCode, 206);
            assert.strictEqual(res.headers['content-range'], `bytes 0-0/${audioDiskSize}`);
            assert.strictEqual(res.headers['content-length'], '1');
            assert.strictEqual(res.buffer.length, 1);
        });

        // --- 3. ROBUSTNESS & SECURITY ADVERSARIAL TESTS ---
        await runTest('Security 1: URL-encoded traversal /%2e%2e%2fpackage.json returns 403', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: '/%2e%2e%2fpackage.json'
            });
            assert.strictEqual(res.statusCode, 403);
        });

        await runTest('Security 2: Double dot backslash traversal /..\\package.json returns 403', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: '/..\\package.json'
            });
            assert.strictEqual(res.statusCode, 403);
        });

        await runTest('Security 3: Malformed percent encoding /%FF%FE returns 400 Bad Request', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: '/%FF%FE'
            });
            assert.strictEqual(res.statusCode, 400);
            assert.ok(res.body.includes('400 Bad Request'));
        });

        await runTest('Security 4: Query parameters and hash /index.html?v=123&foo=bar returns 200', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: '/index.html?v=123&foo=bar'
            });
            assert.strictEqual(res.statusCode, 200);
            assert.ok(res.body.includes('<title>Teleoperator</title>'));
        });

        await runTest('Security 5: HEAD request returns headers with no body', async () => {
            const res = await request({
                hostname: 'localhost',
                port: ADV_PORT,
                path: '/boot.js',
                method: 'HEAD'
            });
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers['content-type'], 'application/javascript; charset=utf-8');
            assert.ok(Number(res.headers['content-length']) > 0);
            assert.strictEqual(res.body, '');
        });

    } finally {
        await new Promise(resolve => server.close(resolve));
    }

    // --- 4. CONCURRENCY & EADDRINUSE MULTI-INCREMENT STRESS TEST ---
    await runTest('EADDRINUSE Multi-step: increment through 2 consecutively occupied ports', async () => {
        const basePort = 49200;
        const b1 = http.createServer((q, s) => s.end('b1'));
        const b2 = http.createServer((q, s) => s.end('b2'));

        await new Promise(r => b1.listen(basePort, r));
        await new Promise(r => b2.listen(basePort + 1, r));

        // Spawn server with CLI port basePort and NO_OPEN=1
        const serverPath = path.resolve(__dirname, '../../../server.js');
        const child = cp.spawn(process.execPath, [serverPath, String(basePort), '--no-open'], {
            env: { ...process.env, NO_OPEN: '1' },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let output = '';
        const spawned = new Promise((resolve, reject) => {
            child.stdout.on('data', chunk => {
                output += chunk.toString('utf8');
                if (output.includes(`URL: http://localhost:${basePort + 2}`)) {
                    resolve(output);
                }
            });
            child.stderr.on('data', chunk => output += chunk.toString('utf8'));
            child.on('error', reject);
            setTimeout(() => reject(new Error(`Timeout waiting for port ${basePort + 2}. Log: ${output}`)), 5000);
        });

        try {
            await spawned;
            assert.ok(output.includes(`Port ${basePort} is in use, trying ${basePort + 1}...`));
            assert.ok(output.includes(`Port ${basePort + 1} is in use, trying ${basePort + 2}...`));
            assert.ok(output.includes(`URL: http://localhost:${basePort + 2}`));

            // Verify it responds on basePort + 2
            const res = await request({
                hostname: 'localhost',
                port: basePort + 2,
                path: '/'
            });
            assert.strictEqual(res.statusCode, 200);
            assert.ok(res.body.includes('<title>Teleoperator</title>'));
        } finally {
            child.kill();
            await new Promise(r => b1.close(r));
            await new Promise(r => b2.close(r));
        }
    });

    // Output summary
    console.log('\n--- ADVERSARIAL TEST SUMMARY ---');
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    console.log(`Passed: ${passed}/${results.length}, Failed: ${failed}/${results.length}`);

    fs.writeFileSync(
        path.join(__dirname, 'adversarial_results.json'),
        JSON.stringify(results, null, 2)
    );
}

runAdversarialSuite().catch(err => {
    console.error('Fatal suite failure:', err);
    process.exit(1);
});
