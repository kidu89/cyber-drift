const http = require('http');
const assert = require('node:assert');
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const original = fs.readFileSync('server.js', 'utf8');
// Fix ROOT to always point to project root for test purposes if inside subfolder
const fixedMinimal = original
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$')
    .replace("const ROOT = __dirname;", "const ROOT = path.resolve(__dirname, '../../..');");

fs.writeFileSync('.agents/teamwork/explorer_m1_1/server_test_instance.js', fixedMinimal);

test('Server serves index.html with 200 when ROOT points to project directory', async () => {
    const child = spawn(process.execPath, ['.agents/teamwork/explorer_m1_1/server_test_instance.js'], {
        env: { ...process.env, PORT: '3456' }
    });

    // Wait for server to start
    await new Promise(r => setTimeout(r, 1000));

    try {
        const res = await new Promise((resolve, reject) => {
            http.get('http://localhost:3456/', (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
            }).on('error', reject);
        });

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.headers['access-control-allow-origin'], '*');
        assert.strictEqual(res.headers['cross-origin-opener-policy'], 'same-origin');
        assert.strictEqual(res.headers['cross-origin-embedder-policy'], 'require-corp');
        assert.ok(res.body.includes('<title>Teleoperator</title>'));
        console.log('Test PASSED: Server responds with 200 and serves Teleoperator index.html!');
    } finally {
        child.kill();
    }
});
