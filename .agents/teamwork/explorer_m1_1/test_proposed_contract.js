const path = require('path');
process.env.SF_ROOT = path.resolve(__dirname, '../../..');
process.env.NO_OPEN = '1';

const http = require('http');
const assert = require('node:assert');
const test = require('node:test');
const { server, MIME_TYPES } = require('./proposed_server.js');

test('Proposed server serves index.html with COOP/COEP and MIME types', async () => {
    await new Promise((resolve) => server.listen(3998, resolve));

    try {
        const res = await new Promise((resolve, reject) => {
            http.get('http://localhost:3998/', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
            }).on('error', reject);
        });

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.headers['access-control-allow-origin'], '*');
        assert.strictEqual(res.headers['cross-origin-opener-policy'], 'same-origin');
        assert.strictEqual(res.headers['cross-origin-embedder-policy'], 'require-corp');
        assert.strictEqual(res.headers['content-type'], 'text/html; charset=utf-8');
        assert.ok(res.body.includes('<title>Teleoperator</title>'));

        // Also test MIME type map
        assert.strictEqual(MIME_TYPES['.js'], 'application/javascript; charset=utf-8');
        assert.strictEqual(MIME_TYPES['.gz'], 'application/octet-stream');
        assert.strictEqual(MIME_TYPES['.wasm'], 'application/wasm');

        console.log('Test PASSED: proposed_server.js satisfies all M1 Interface Contract criteria!');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
