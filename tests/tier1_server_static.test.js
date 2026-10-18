'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const http = require('node:http');

const { PROJECT_ROOT, request } = require('./test_harness');

// Suppress automatic browser launch during tests
process.env.NO_OPEN = '1';

const { server, startServer, MIME_TYPES, DEFAULT_PORT } = require('../server.js');
let activePort = 0;

test('Tier 1: Server Infrastructure & Static Asset Integrity', async (t) => {
    let testServerInstance = null;

    await t.test('1.1 Syntax and Escaping Validation', () => {
        // Run node --check server.js
        const serverPath = path.join(PROJECT_ROOT, 'server.js');
        const check = cp.spawnSync(process.execPath, ['--check', serverPath], { encoding: 'utf8' });
        assert.strictEqual(check.status, 0, `Syntax error in server.js: ${check.stderr}`);

        const content = fs.readFileSync(serverPath, 'utf8');
        // Ensure no stray escaped backticks \` exist in code
        const escapedBacktickMatches = content.match(/\\`/g);
        assert.strictEqual(escapedBacktickMatches, null, 'server.js must not contain stray escaped backticks');
    });

    await t.test('1.2 Static Critical Files Presence & Non-Empty Check', () => {
        const requiredFiles = ['index.html', 'boot.js', 'app.js', 'style.css', 'server.js', 'package.json'];
        for (const file of requiredFiles) {
            const fullPath = path.join(PROJECT_ROOT, file);
            assert.strictEqual(fs.existsSync(fullPath), true, `Required file ${file} must exist`);
            const stat = fs.statSync(fullPath);
            assert.ok(stat.size > 0, `Required file ${file} must not be empty`);
        }
    });

    await t.test('1.3 Server Startup on Dedicated Port', async () => {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, () => {
                activePort = server.address().port;
                server.unref();
                resolve();
            });
        });
        assert.ok(activePort > 0, `Server should listen on assigned port ${activePort}`);
    });

    await t.test('1.4 Root GET / Serves index.html with HTTP 200 and Mandatory Isolation Headers', async () => {
        const res = await request({
            hostname: 'localhost',
            port: activePort,
            path: '/',
            method: 'GET'
        });

        assert.strictEqual(res.statusCode, 200, 'Root path should return HTTP 200');
        assert.ok(res.body.includes('<!doctype html>') || res.body.includes('<!DOCTYPE html>'), 'Body should contain html doctype');
        assert.ok(res.body.includes('teleoperator') || res.body.includes('TELE'), 'Body should contain Teleoperator title');

        // Isolation headers required for WebGPU / SharedArrayBuffer
        assert.strictEqual(res.headers['cross-origin-opener-policy'], 'same-origin', 'COOP header must be same-origin');
        assert.strictEqual(res.headers['cross-origin-embedder-policy'], 'require-corp', 'COEP header must be require-corp');
        assert.strictEqual(res.headers['access-control-allow-origin'], '*', 'CORS origin must allow *');
    });

    await t.test('1.5 OPTIONS Preflight Request Returns HTTP 204 with CORS Headers', async () => {
        const res = await request({
            hostname: 'localhost',
            port: activePort,
            path: '/app.js',
            method: 'OPTIONS'
        });

        assert.strictEqual(res.statusCode, 204, 'OPTIONS should return HTTP 204');
        assert.strictEqual(res.headers['access-control-allow-origin'], '*');
        assert.ok(res.headers['access-control-allow-methods'].includes('GET'));
        assert.ok(res.headers['access-control-allow-headers'] === '*' || res.headers['access-control-allow-headers'].includes('Range'));
    });

    await t.test('1.6 MIME Types and Content Negotiation', async () => {
        const testCases = [
            { path: '/style.css', expectedType: 'text/css' },
            { path: '/boot.js', expectedType: 'application/javascript' },
            { path: '/mock_api.json', expectedType: 'application/json' }
        ];

        for (const tc of testCases) {
            const res = await request({
                hostname: 'localhost',
                port: activePort,
                path: tc.path,
                method: 'GET'
            });

            assert.strictEqual(res.statusCode, 200, `Path ${tc.path} should return HTTP 200`);
            const contentType = res.headers['content-type'] || '';
            assert.ok(contentType.includes(tc.expectedType), `Path ${tc.path} expected ${tc.expectedType}, got ${contentType}`);
        }
    });

    await t.test('1.7 Pre-compressed .bin.gz Asset Streaming (No Content-Encoding gzip)', async () => {
        // Find a .bin.gz file if present in assets or root
        let binGzFile = null;
        function findBinGz(dir) {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
                const sub = path.join(dir, e.name);
                if (e.isDirectory() && !e.name.startsWith('.')) {
                    findBinGz(sub);
                    if (binGzFile) return;
                } else if (e.isFile() && e.name.endsWith('.bin.gz')) {
                    binGzFile = sub;
                    return;
                }
            }
        }
        findBinGz(PROJECT_ROOT);

        if (binGzFile) {
            const relPath = '/' + path.relative(PROJECT_ROOT, binGzFile).replace(/\\/g, '/');
            const res = await request({
                hostname: 'localhost',
                port: activePort,
                path: relPath,
                method: 'GET'
            });

            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(res.headers['content-type'], 'application/octet-stream');
            assert.strictEqual(res.headers['content-encoding'], undefined, 'Must not double-compress .bin.gz with Content-Encoding gzip');
            assert.strictEqual(res.headers['accept-ranges'], 'bytes');
        } else {
            // Verify MIME_TYPES mapping contains bin.gz
            assert.strictEqual(MIME_TYPES['.bin.gz'], 'application/octet-stream');
        }
    });

    await t.test('1.8 Byte-Range Streaming (HTTP 206 Partial Content)', async () => {
        const res = await request({
            hostname: 'localhost',
            port: activePort,
            path: '/assets/audio/airflow.mp3',
            method: 'GET',
            headers: {
                'Range': 'bytes=0-99'
            }
        });

        assert.strictEqual(res.statusCode, 206, 'Byte-range request must return HTTP 206 Partial Content');
        assert.ok(res.headers['content-range'].startsWith('bytes 0-99/'), 'Content-Range must specify range bytes 0-99/');
        assert.strictEqual(res.rawBody.length, 100, 'Returned body buffer length must equal requested 100 bytes');
    });

    await t.test('1.9 Security: Path Traversal Protection (HTTP 403 Forbidden)', async () => {
        const res = await request({
            hostname: 'localhost',
            port: activePort,
            path: '/../package.json',
            method: 'GET'
        });

        assert.strictEqual(res.statusCode, 403, 'Path traversal attempt must be blocked with HTTP 403');
    });

    await t.test('1.10 Error Handling: Missing File Returns HTTP 404', async () => {
        const res = await request({
            hostname: 'localhost',
            port: activePort,
            path: '/non_existent_file_test_xyz123.dat',
            method: 'GET'
        });

        assert.strictEqual(res.statusCode, 404, 'Non-existent file should return HTTP 404');
    });

    await t.test('1.11 Error Handling: Invalid Range Returns HTTP 416 without Crashing Server', async () => {
        const res = await request({
            hostname: 'localhost',
            port: activePort,
            path: '/assets/audio/airflow.mp3',
            method: 'GET',
            headers: {
                'Range': 'bytes=99999999-99999998'
            }
        });

        assert.strictEqual(res.statusCode, 416, 'Invalid range should return HTTP 416');
    });

    // Teardown test server
    if (server.listening) {
        if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections();
        }
        await new Promise((resolve) => server.close(resolve));
    }
});
