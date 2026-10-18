const http = require('http');
const assert = require('node:assert');
const test = require('node:test');
const { server } = require('./proposed_server.js');

test('Server serves index.html with security and CORS headers', async () => {
    await new Promise((resolve) => server.listen(3999, resolve));

    try {
        const res = await new Promise((resolve, reject) => {
            http.get('http://localhost:3999/', (res) => {
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
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
