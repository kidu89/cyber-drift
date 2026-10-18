const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// Ensure headless mode for test environment
process.env.NO_OPEN = '1';

const { server, startServer, MIME_TYPES, DEFAULT_PORT } = require('../server.js');

const TEST_PORT = 3985;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Helper function to perform HTTP requests
function httpRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: buffer.toString('utf8'),
                    rawBody: buffer
                });
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

// Fast non-blocking helper to test server startup flags and environment variables
function captureServerOutput(args, env = {}) {
    const serverPath = path.resolve(__dirname, '../server.js');
    return new Promise((resolve, reject) => {
        const child = cp.spawn(process.execPath, [serverPath, ...args], {
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let out = '';
        child.stdout.on('data', (chunk) => {
            out += chunk.toString('utf8');
            if (out.includes('stop the server')) {
                child.kill();
                resolve(out);
            }
        });
        child.stderr.on('data', (chunk) => {
            out += chunk.toString('utf8');
        });
        child.on('error', reject);
        setTimeout(() => {
            child.kill();
            resolve(out);
        }, 3000);
    });
}

test.describe('Teleoperator Server Test Suite', () => {

    test('1. Syntax Validation (node --check server.js and zero escaped backticks)', () => {
        const serverPath = path.resolve(__dirname, '../server.js');
        // Run node --check
        const checkResult = cp.spawnSync(process.execPath, ['--check', serverPath], { encoding: 'utf8' });
        assert.strictEqual(checkResult.status, 0, `node --check failed: ${checkResult.stderr}`);

        // Scan for escaped backticks (\`) and escaped expressions (\${)
        const fileContent = fs.readFileSync(serverPath, 'utf8');
        const escapedBacktick = String.fromCharCode(92) + String.fromCharCode(96);
        const escapedInterpolation = String.fromCharCode(92) + '$' + '{';

        assert.strictEqual(fileContent.includes(escapedBacktick), false, 'Found illegal escaped backticks in server.js');
        assert.strictEqual(fileContent.includes(escapedInterpolation), false, 'Found illegal escaped interpolation in server.js');
    });

    test('2. Programmatic Module Exports and Configuration', () => {
        assert.ok(server, 'server instance should be exported');
        assert.strictEqual(typeof server.listen, 'function', 'server must be an http.Server instance');
        assert.strictEqual(typeof startServer, 'function', 'startServer function must be exported');
        assert.strictEqual(typeof MIME_TYPES, 'object', 'MIME_TYPES object must be exported');
        assert.strictEqual(typeof DEFAULT_PORT, 'number', 'DEFAULT_PORT number must be exported');

        assert.strictEqual(MIME_TYPES['.html'], 'text/html; charset=utf-8');
        assert.strictEqual(MIME_TYPES['.js'], 'application/javascript; charset=utf-8');
        assert.strictEqual(MIME_TYPES['.bin'], 'application/octet-stream');
        assert.strictEqual(MIME_TYPES['.gz'], 'application/octet-stream');
        assert.strictEqual(MIME_TYPES['.mp3'], 'audio/mpeg');
    });

    test('3. CLI Port and Environment Variable Parsing', async () => {
        // Test positional CLI port: node server.js 4123 --no-open
        const outPositional = await captureServerOutput(['4123', '--no-open']);
        assert.ok(outPositional.includes('URL: http://localhost:4123'), 'Positional port argument should be used');

        // Test flag CLI port: node server.js --port 4124 --no-open
        const outFlag = await captureServerOutput(['--port', '4124', '--no-open']);
        assert.ok(outFlag.includes('URL: http://localhost:4124'), '--port argument should be used');

        // Test PORT environment variable
        const outEnv = await captureServerOutput(['--no-open'], { PORT: '4125', NO_OPEN: '1' });
        assert.ok(outEnv.includes('URL: http://localhost:4125'), 'PORT env var should be used when no CLI arg provided');

        // Test CLI port precedence over PORT environment variable
        const outPrecedence = await captureServerOutput(['4126', '--no-open'], { PORT: '4125', NO_OPEN: '1' });
        assert.ok(outPrecedence.includes('URL: http://localhost:4126'), 'CLI port should take precedence over PORT env var');
    });

    test('4. Headless Mode Browser Launch Suppression', async () => {
        // When NO_OPEN=1 or --no-open is present, execution starts cleanly without hanging
        const outNoOpen = await captureServerOutput(['4130', '--no-open']);
        assert.ok(outNoOpen.includes('URL: http://localhost:4130'));

        const outEnvNoOpen = await captureServerOutput(['4131'], { NO_OPEN: '1' });
        assert.ok(outEnvNoOpen.includes('URL: http://localhost:4131'));
    });

    test('5. Port Conflict Auto-Increment (EADDRINUSE)', async () => {
        const conflictPort = 3991;
        const blockerServer = http.createServer((req, res) => res.end('blocker'));

        await new Promise((resolve) => blockerServer.listen(conflictPort, resolve));

        try {
            // startServer on occupied port should fallback to conflictPort + 1
            startServer(conflictPort);

            // Wait briefly for server to bind next port
            await new Promise((resolve) => setTimeout(resolve, 300));

            const res = await httpRequest({
                hostname: 'localhost',
                port: conflictPort + 1,
                path: '/',
                method: 'GET'
            });

            assert.strictEqual(res.statusCode, 200);
            assert.ok(res.body.includes('<title>Teleoperator</title>'));
        } finally {
            await new Promise((resolve) => server.close(resolve));
            await new Promise((resolve) => blockerServer.close(resolve));
        }
    });

    test.describe('HTTP Endpoint and Header Verification', () => {
        test.before(async () => {
            await new Promise((resolve) => server.listen(TEST_PORT, resolve));
        });

        test.after(async () => {
            await new Promise((resolve) => server.close(resolve));
        });

        test('6. Root Path (/) serves index.html with HTTP 200', async () => {
            const res = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/',
                method: 'GET'
            });

            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers['content-type'], 'text/html; charset=utf-8');
            assert.ok(res.body.includes('<title>Teleoperator</title>'));
        });

        test('7. Mandatory Isolation and CORS Security Headers on responses', async () => {
            const res = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/',
                method: 'GET'
            });

            assert.strictEqual(res.headers['cross-origin-opener-policy'], 'same-origin');
            assert.strictEqual(res.headers['cross-origin-embedder-policy'], 'require-corp');
            assert.strictEqual(res.headers['cross-origin-resource-policy'], 'cross-origin');
            assert.strictEqual(res.headers['access-control-allow-origin'], '*');
            assert.strictEqual(res.headers['access-control-allow-methods'], 'GET, HEAD, POST, OPTIONS');
            assert.strictEqual(res.headers['access-control-allow-headers'], '*');
        });

        test('8. OPTIONS preflight returns HTTP 204 with empty body and CORS headers', async () => {
            const res = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/boot.js',
                method: 'OPTIONS'
            });

            assert.strictEqual(res.statusCode, 204);
            assert.strictEqual(res.body, '');
            assert.strictEqual(res.headers['access-control-allow-origin'], '*');
            assert.strictEqual(res.headers['access-control-allow-methods'], 'GET, HEAD, POST, OPTIONS');
            assert.strictEqual(res.headers['cross-origin-opener-policy'], 'same-origin');
            assert.strictEqual(res.headers['cross-origin-embedder-policy'], 'require-corp');
        });

        test('9. Static Asset Delivery with proper MIME types', async () => {
            // JavaScript
            const jsRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/boot.js',
                method: 'GET'
            });
            assert.strictEqual(jsRes.statusCode, 200);
            assert.strictEqual(jsRes.headers['content-type'], 'application/javascript; charset=utf-8');
            assert.ok(jsRes.body.length > 0);

            // CSS
            const cssRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/style.css',
                method: 'GET'
            });
            assert.strictEqual(cssRes.statusCode, 200);
            assert.strictEqual(cssRes.headers['content-type'], 'text/css; charset=utf-8');

            // JSON
            const jsonRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/tune.json',
                method: 'GET'
            });
            assert.strictEqual(jsonRes.statusCode, 200);
            assert.strictEqual(jsonRes.headers['content-type'], 'application/json; charset=utf-8');
            assert.doesNotThrow(() => JSON.parse(jsonRes.body));
        });

        test('10. Pre-compressed .bin.gz served as octet-stream without Content-Encoding: gzip', async () => {
            // Direct .bin.gz request
            const directRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/assets/real/roads.bin.gz',
                method: 'GET'
            });
            assert.strictEqual(directRes.statusCode, 200);
            assert.strictEqual(directRes.headers['content-type'], 'application/octet-stream');
            assert.strictEqual(directRes.headers['content-encoding'], undefined, 'Must not send Content-Encoding: gzip');
            assert.strictEqual(directRes.rawBody.length, 5613318);

            // Transparent fallback: requesting /assets/real/roads.bin serves roads.bin.gz
            const fallbackRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/assets/real/roads.bin',
                method: 'GET'
            });
            assert.strictEqual(fallbackRes.statusCode, 200);
            assert.strictEqual(fallbackRes.headers['content-type'], 'application/octet-stream');
            assert.strictEqual(fallbackRes.headers['content-encoding'], undefined, 'Must not send Content-Encoding: gzip');
            assert.strictEqual(fallbackRes.rawBody.length, 5613318);
        });

        test('11. HTML Extension Fallback and SPA Extensionless Route Fallback', async () => {
            // HTML extension fallback (/seed_storage -> seed_storage.html)
            const htmlRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/seed_storage',
                method: 'GET'
            });
            assert.strictEqual(htmlRes.statusCode, 200);
            assert.strictEqual(htmlRes.headers['content-type'], 'text/html; charset=utf-8');
            assert.ok(htmlRes.body.includes('Seed Teleoperator Save'));

            // SPA extensionless fallback (/custom/spa/route -> index.html)
            const spaRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/custom/spa/route',
                method: 'GET'
            });
            assert.strictEqual(spaRes.statusCode, 200);
            assert.strictEqual(spaRes.headers['content-type'], 'text/html; charset=utf-8');
            assert.ok(spaRes.body.includes('<title>Teleoperator</title>'));
        });

        test('12. Audio Byte-Range Streaming (HTTP 206)', async () => {
            // Explicit byte range 0-99
            const rangeRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/assets/audio/airflow.mp3',
                method: 'GET',
                headers: { 'Range': 'bytes=0-99' }
            });

            assert.strictEqual(rangeRes.statusCode, 206);
            assert.strictEqual(rangeRes.headers['content-range'], 'bytes 0-99/183946');
            assert.strictEqual(rangeRes.headers['content-length'], '100');
            assert.strictEqual(rangeRes.headers['accept-ranges'], 'bytes');
            assert.strictEqual(rangeRes.headers['content-type'], 'audio/mpeg');
            assert.strictEqual(rangeRes.rawBody.length, 100);

            // Open-ended range 100-
            const openRangeRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/assets/audio/airflow.mp3',
                method: 'GET',
                headers: { 'Range': 'bytes=100-' }
            });
            assert.strictEqual(openRangeRes.statusCode, 206);
            assert.strictEqual(openRangeRes.headers['content-range'], 'bytes 100-183945/183946');
            assert.strictEqual(openRangeRes.headers['content-length'], '183846');
            assert.strictEqual(openRangeRes.rawBody.length, 183846);

            // Non-audio Range request returns full 200 OK (not 206)
            const nonAudioRangeRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/style.css',
                method: 'GET',
                headers: { 'Range': 'bytes=0-50' }
            });
            assert.strictEqual(nonAudioRangeRes.statusCode, 200);
            assert.strictEqual(nonAudioRangeRes.headers['accept-ranges'], 'bytes');
            assert.ok(nonAudioRangeRes.rawBody.length > 50);
        });

        test('13. Mock API Interception (POST /events)', async () => {
            const mockRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/events',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, JSON.stringify({ test: true }));

            assert.strictEqual(mockRes.statusCode, 200);
            assert.strictEqual(mockRes.headers['content-type'], 'application/json; charset=utf-8');
            const data = JSON.parse(mockRes.body);
            assert.deepStrictEqual(data, { ok: true, counted: true });

            // GET /events falls through to static file
            const staticEventsRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/events',
                method: 'GET'
            });
            assert.strictEqual(staticEventsRes.statusCode, 200);
            assert.ok(staticEventsRes.body.includes('kept'));
        });

        test('14. 404 Not Found Handling for missing files', async () => {
            const res = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/nonexistent_file_xyz.png',
                method: 'GET'
            });

            assert.strictEqual(res.statusCode, 404);
            assert.strictEqual(res.headers['content-type'], 'text/plain');
            assert.strictEqual(res.body, '404 Not Found: /nonexistent_file_xyz.png');
            assert.strictEqual(res.headers['cross-origin-opener-policy'], 'same-origin');
            assert.strictEqual(res.headers['cross-origin-embedder-policy'], 'require-corp');
        });

        test('15. Robustness: Safe URIError handling for malformed URLs returning HTTP 400', async () => {
            const res = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/%E0%A4%A',
                method: 'GET'
            });

            assert.strictEqual(res.statusCode, 400);
            assert.strictEqual(res.headers['content-type'], 'text/plain');
            assert.ok(res.body.includes('400 Bad Request'));
        });

        test('16. Robustness: Path Traversal Protection returning HTTP 403', async () => {
            const res = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/../package.json',
                method: 'GET'
            });

            assert.strictEqual(res.statusCode, 403);
            assert.strictEqual(res.headers['content-type'], 'text/plain');
            assert.ok(res.body.includes('403 Forbidden'));
        });

        test('17. Robustness: Malformed HTTP Range Header Variants return HTTP 416 and Server Process Survives', async () => {
            const audioPath = '/assets/audio/airflow.mp3';
            const diskPath = path.join(__dirname, '..', 'assets/audio/airflow.mp3');
            const stat = fs.statSync(diskPath);
            const expectedContentRange = `bytes */${stat.size}`;

            const malformedRangeHeaders = [
                'bytes=0-abc',
                'bytes=10-xyz',
                'bytes=0-NaN',
                'bytes=0-Infinity',
                'bytes=0-undefined',
                'bytes=0-null',
                'bytes=NaN-10',
                'bytes=Infinity-10',
                'bytes=500-200',
                'bytes=10-5',
                'bytes=1-0',
                'bytes=999999999-',
                'bytes=999999999-1000',
                'bytes=abc-def',
                'bytes=foobar',
                'bytes=-',
                'bytes=--',
                'bytes=-0',
                'bytes=-abc',
                'bytes=abc-'
            ];

            for (const rangeHeader of malformedRangeHeaders) {
                const res = await httpRequest({
                    hostname: 'localhost',
                    port: TEST_PORT,
                    path: audioPath,
                    method: 'GET',
                    headers: { 'Range': rangeHeader }
                });

                assert.strictEqual(
                    res.statusCode,
                    416,
                    `Expected HTTP 416 for Range: "${rangeHeader}", but received ${res.statusCode}`
                );

                assert.strictEqual(
                    res.headers['content-range'],
                    expectedContentRange,
                    `Expected Content-Range "${expectedContentRange}" for Range: "${rangeHeader}", but received "${res.headers['content-range']}"`
                );

                assert.strictEqual(res.headers['cross-origin-opener-policy'], 'same-origin');
                assert.strictEqual(res.headers['cross-origin-embedder-policy'], 'require-corp');
                assert.strictEqual(res.headers['cross-origin-resource-policy'], 'cross-origin');
                assert.strictEqual(res.headers['access-control-allow-origin'], '*');

                // Liveness check: Verify server process did NOT crash and is still accepting requests
                const livenessRes = await httpRequest({
                    hostname: 'localhost',
                    port: TEST_PORT,
                    path: '/',
                    method: 'GET'
                });
                assert.strictEqual(
                    livenessRes.statusCode,
                    200,
                    `Server failed liveness check after processing malformed Range: "${rangeHeader}"`
                );
                assert.ok(
                    livenessRes.body.includes('<title>Teleoperator</title>'),
                    'Server response body corrupted after malformed Range request'
                );
            }
        });
    });
});

