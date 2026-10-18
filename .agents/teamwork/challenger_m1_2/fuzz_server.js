const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');

// Suppress automatic browser launch
process.env.NO_OPEN = '1';

const { server } = require('../../../server.js');

const FUZZ_PORT = 49152;
const BASE_URL = `http://localhost:${FUZZ_PORT}`;

// Result collectors
const results = {
    total: 0,
    passed: 0,
    failed: 0,
    categories: {},
    failures: []
};

function recordResult(category, name, passed, details) {
    results.total++;
    if (!results.categories[category]) {
        results.categories[category] = { total: 0, passed: 0, failed: 0 };
    }
    results.categories[category].total++;
    if (passed) {
        results.passed++;
        results.categories[category].passed++;
    } else {
        results.failed++;
        results.categories[category].failed++;
        results.failures.push({ category, name, details });
    }
}

function makeRequest(options, postData = null, timeout = 3000) {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: 'localhost',
            port: FUZZ_PORT,
            timeout,
            ...options
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve({
                    success: true,
                    statusCode: res.statusCode,
                    statusMessage: res.statusMessage,
                    headers: res.headers,
                    body: buffer.toString('utf8'),
                    rawBody: buffer
                });
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('Request timed out'));
            resolve({
                success: false,
                error: 'TIMEOUT'
            });
        });

        req.on('error', (err) => {
            resolve({
                success: false,
                error: err.code || err.message
            });
        });

        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

function makeRawSocketRequest(rawPayload, timeout = 3000) {
    return new Promise((resolve) => {
        const client = new net.Socket();
        let responseData = '';
        let timer = setTimeout(() => {
            client.destroy();
            resolve({ success: false, error: 'TIMEOUT', response: responseData });
        }, timeout);

        client.connect(FUZZ_PORT, '127.0.0.1', () => {
            client.write(rawPayload);
        });

        client.on('data', (chunk) => {
            responseData += chunk.toString('utf8');
        });

        client.on('end', () => {
            clearTimeout(timer);
            resolve({ success: true, response: responseData });
        });

        client.on('error', (err) => {
            clearTimeout(timer);
            resolve({ success: false, error: err.code || err.message, response: responseData });
        });
    });
}

function verifySecurityHeaders(headers) {
    const checks = {
        coop: headers['cross-origin-opener-policy'] === 'same-origin',
        coep: headers['cross-origin-embedder-policy'] === 'require-corp',
        corp: headers['cross-origin-resource-policy'] === 'cross-origin',
        corsOrigin: headers['access-control-allow-origin'] === '*',
        corsMethods: headers['access-control-allow-methods'] === 'GET, HEAD, POST, OPTIONS',
        corsHeaders: headers['access-control-allow-headers'] === '*'
    };
    return checks.coop && checks.coep && checks.corp && checks.corsOrigin && checks.corsMethods && checks.corsHeaders;
}

async function runFuzzSuite() {
    console.log(`Starting Adversarial Fuzzing against server.js on port ${FUZZ_PORT}...`);
    await new Promise((resolve) => server.listen(FUZZ_PORT, resolve));

    try {
        // =====================================================================
        // Category 1: Malformed URIs & Encodings
        // =====================================================================
        const malformedUriPayloads = [
            { name: 'Truncated percent (%E0%A4%A)', path: '/%E0%A4%A', expectStatus: 400 },
            { name: 'Single percent (/% )', path: '/%', expectStatus: 400 },
            { name: 'Double percent (/%%)', path: '/%%', expectStatus: 400 },
            { name: 'Invalid hex digits (/%ZZ)', path: '/%ZZ', expectStatus: 400 },
            { name: 'Invalid middle hex (/%2qar)', path: '/%2qar', expectStatus: 400 },
            { name: 'Lone high surrogate (%ED%A0%80)', path: '/%ED%A0%80', expectStatus: 400 },
            { name: 'Lone low surrogate (%ED%BF%BF)', path: '/%ED%BF%BF', expectStatus: 400 },
            { name: 'Codepoint above U+10FFFF (%F4%90%80%80)', path: '/%F4%90%80%80', expectStatus: 400 },
            { name: 'Overlong UTF-8 slash (%C0%AF)', path: '/%C0%AF', expectStatus: 400 },
            { name: 'Overlong UTF-8 null (%C0%80)', path: '/%C0%80', expectStatus: 400 },
            { name: '3-byte overlong slash (%E0%80%AF)', path: '/%E0%80%AF', expectStatus: 400 },
            { name: '4-byte overlong slash (%F0%80%80%AF)', path: '/%F0%80%80%AF', expectStatus: 400 },
            { name: 'Invalid UTF-8 lead byte (%FF)', path: '/%FF', expectStatus: 400 },
            { name: 'Invalid UTF-8 lead byte (%FE)', path: '/%FE', expectStatus: 400 },
            { name: 'Orphan continuation bytes (%80%80)', path: '/%80%80', expectStatus: 400 },
            { name: 'Non-standard Unicode escape (/%u0000)', path: '/%u0000', expectStatus: [400, 404] },
            { name: 'Trailing percent (/test%)', path: '/test%', expectStatus: 400 },
            { name: 'Middle broken percent (/foo%gar)', path: '/foo%gar', expectStatus: 400 },
            { name: 'Null byte alone (/%00)', path: '/%00', expectStatus: [200, 400, 404] },
            { name: 'Null byte in filename (/index.html%00)', path: '/index.html%00', expectStatus: 404 },
            { name: 'Null byte extension bypass (/boot.js%00.png)', path: '/boot.js%00.png', expectStatus: 404 },
            { name: 'Null byte path prefix (/%00/boot.js)', path: '/%00/boot.js', expectStatus: 404 },
            { name: 'Null byte traversal (/%00/../package.json)', path: '/%00/../package.json', expectStatus: [400, 403, 404] }
        ];

        for (const testCase of malformedUriPayloads) {
            const res = await makeRequest({ path: testCase.path, method: 'GET' });
            let ok = false;
            if (res.success) {
                if (Array.isArray(testCase.expectStatus)) {
                    ok = testCase.expectStatus.includes(res.statusCode);
                } else {
                    ok = res.statusCode === testCase.expectStatus;
                }
                // Verify server did not return sensitive system files
                if (res.body.includes('[extensions]') || res.body.includes('[fonts]')) {
                    ok = false;
                }
            }
            recordResult('1. Malformed URIs & Encodings', testCase.name, ok, {
                path: testCase.path,
                expected: testCase.expectStatus,
                actual: res.statusCode,
                body: res.body ? res.body.substring(0, 100) : res.error
            });
        }

        // =====================================================================
        // Category 2: Path Traversal Variants
        // =====================================================================
        const traversalPayloads = [
            { name: 'Standard ../package.json', path: '/../package.json', expectStatus: [403] },
            { name: 'Direct /..', path: '/..', expectStatus: [403] },
            { name: 'Trailing slash /../', path: '/../', expectStatus: [403] },
            { name: 'Double traversal /../../package.json', path: '/../../package.json', expectStatus: [403] },
            { name: 'Triple traversal /../../../package.json', path: '/../../../package.json', expectStatus: [403] },
            { name: 'Deep traversal /../../../../../../../../Windows/win.ini', path: '/../../../../../../../../Windows/win.ini', expectStatus: [403] },
            { name: 'URL-encoded slash /..%2fpackage.json', path: '/..%2fpackage.json', expectStatus: [403] },
            { name: 'Fully URL-encoded dots and slash /%2e%2e%2fpackage.json', path: '/%2e%2e%2fpackage.json', expectStatus: [403] },
            { name: 'Uppercase hex /%2E%2E%2Fpackage.json', path: '/%2E%2E%2Fpackage.json', expectStatus: [403] },
            { name: 'Backslash traversal /..\\package.json', path: '/..\\package.json', expectStatus: [403] },
            { name: 'Encoded backslash /..%5cpackage.json', path: '/..%5cpackage.json', expectStatus: [403] },
            { name: 'Encoded dots and backslash /%2e%2e%5cpackage.json', path: '/%2e%2e%5cpackage.json', expectStatus: [403] },
            { name: 'Double encoded dots /%252e%252e/package.json', path: '/%252e%252e/package.json', expectStatus: [200, 404] }, // Safe inside root
            { name: 'Double encoded slash /..%252fpackage.json', path: '/..%252fpackage.json', expectStatus: [403] },
            { name: 'Quadruple dots /....//....//package.json', path: '/....//....//package.json', expectStatus: [403, 404] },
            { name: 'Out-of-root target with %2e%2e (/%2e%2e/Windows/win.ini)', path: '/%2e%2e/Windows/win.ini', expectStatus: [403, 404] },
            { name: 'Absolute Windows drive /C:/Windows/win.ini', path: '/C:/Windows/win.ini', expectStatus: [403, 404] },
            { name: 'Encoded Windows drive /C%3A/Windows/win.ini', path: '/C%3A/Windows/win.ini', expectStatus: [403, 404] },
            { name: 'Windows UNC path //localhost/c$/Windows/win.ini', path: '//localhost/c$/Windows/win.ini', expectStatus: [403, 404] },
            { name: 'Leading backslash /\\index.html', path: '/\\index.html', expectStatus: [200, 403, 404] },
            { name: 'Multiple leading slashes ///index.html', path: '///index.html', expectStatus: [200] },
            { name: 'Dot segment prefix /./index.html', path: '/./index.html', expectStatus: [200] },
            { name: 'Nonexistent file with extension /.env.secret', path: '/.env.secret', expectStatus: [404] },
            { name: 'Nonexistent dotfile with extension /.git/config.txt', path: '/.git/config.txt', expectStatus: [404] },
            { name: 'DOS device CON with extension (/CON.html)', path: '/CON.html', expectStatus: [404] },
            { name: 'DOS device AUX with extension (/AUX.js)', path: '/AUX.js', expectStatus: [404] },
            { name: 'DOS device NUL with extension (/NUL.txt)', path: '/NUL.txt', expectStatus: [404] },
            { name: 'DOS device PRN with extension (/PRN.html)', path: '/PRN.html', expectStatus: [404] },
            { name: 'Extensionless route SPA fallback (/missions)', path: '/missions', expectStatus: [200] },
            { name: 'Extensionless route SPA fallback (/garage/custom)', path: '/garage/custom', expectStatus: [200] }
        ];

        for (const testCase of traversalPayloads) {
            const res = await makeRequest({ path: testCase.path, method: 'GET' });
            let ok = false;
            if (res.success) {
                // Must NEVER leak out-of-root data (like win.ini)
                const leakedData = res.body.includes('[extensions]') ||
                                   res.body.includes('System32') ||
                                   res.body.includes('[fonts]');
                if (!leakedData) {
                    ok = testCase.expectStatus.includes(res.statusCode);
                }
            }
            recordResult('2. Path Traversal & File Boundaries', testCase.name, ok, {
                path: testCase.path,
                expected: testCase.expectStatus,
                actual: res.statusCode,
                bodySnippet: res.body ? res.body.substring(0, 100) : res.error
            });
        }

        // =====================================================================
        // Category 3: Boundary Sizes & Stress (Long URLs, Headers, Queries)
        // =====================================================================
        const longPath2k = '/' + 'a'.repeat(2000);
        const longQuery8k = '/?query=' + 'q'.repeat(8000);
        const longQuery64k = '/?query=' + 'q'.repeat(64000);

        // Long path 2k
        const res2k = await makeRequest({ path: longPath2k, method: 'GET' });
        recordResult('3. Boundary Sizes & Stress', '2,000 char URL path', res2k.success && (res2k.statusCode === 404 || res2k.statusCode === 200), {
            statusCode: res2k.statusCode
        });

        // Long query 8k
        const resQuery8k = await makeRequest({ path: longQuery8k, method: 'GET' });
        recordResult('3. Boundary Sizes & Stress', '8,000 char query string', resQuery8k.success && resQuery8k.statusCode === 200, {
            statusCode: resQuery8k.statusCode
        });

        // Massive query 64k (Node HTTP parser rejects header overflow safely)
        const resQuery64k = await makeRequest({ path: longQuery64k, method: 'GET' });
        const pass64k = (!resQuery64k.success && resQuery64k.error === 'HPE_HEADER_OVERFLOW') ||
                        (resQuery64k.success && (resQuery64k.statusCode === 414 || resQuery64k.statusCode === 431 || resQuery64k.statusCode === 200));
        recordResult('3. Boundary Sizes & Stress', '64,000 char query string (no server crash)', pass64k, {
            success: resQuery64k.success,
            statusCode: resQuery64k.statusCode,
            error: resQuery64k.error
        });

        // Large Custom Header (8KB)
        const resHeader8k = await makeRequest({
            path: '/',
            method: 'GET',
            headers: { 'X-Big-Header': 'Z'.repeat(8000) }
        });
        recordResult('3. Boundary Sizes & Stress', '8KB custom header handling', (resHeader8k.success && resHeader8k.statusCode === 200) || (!resHeader8k.success && resHeader8k.error === 'HPE_HEADER_OVERFLOW'), {
            statusCode: resHeader8k.statusCode,
            error: resHeader8k.error
        });

        // Malformed Host Header
        const resBadHost = await makeRequest({
            path: '/',
            method: 'GET',
            headers: { 'Host': 'invalid[host]:port' }
        });
        recordResult('3. Boundary Sizes & Stress', 'Malformed Host header in URL resolution', resBadHost.success && (resBadHost.statusCode === 400 || resBadHost.statusCode === 200), {
            statusCode: resBadHost.statusCode
        });

        // Empty Host Header
        const resEmptyHost = await makeRequest({
            path: '/',
            method: 'GET',
            headers: { 'Host': '' }
        });
        recordResult('3. Boundary Sizes & Stress', 'Empty Host header fallback to localhost', resEmptyHost.success && resEmptyHost.statusCode === 200, {
            statusCode: resEmptyHost.statusCode
        });

        // Range Header Stress & Boundary Cases
        const rangeCases = [
            { name: 'Range 0-0 single byte', range: 'bytes=0-0', expectStatus: 206 },
            { name: 'Inverted range (100-50)', range: 'bytes=100-50', expectStatus: 416 },
            { name: 'Huge range beyond EOF (99999999-)', range: 'bytes=99999999-', expectStatus: 416 },
            { name: 'Suffix range beyond file size (bytes=-99999999)', range: 'bytes=-99999999', expectStatus: 206 },
            { name: 'Nonsense range (bytes=abc-def)', range: 'bytes=abc-def', expectStatus: 416 },
            { name: 'Empty range (bytes=-)', range: 'bytes=-', expectStatus: 416 },
            { name: 'Multi-part range (bytes=0-10, 20-30)', range: 'bytes=0-10, 20-30', expectStatus: [206, 416] },
            { name: 'Giant numeric overflow range', range: 'bytes=' + '9'.repeat(100) + '-', expectStatus: [206, 416] }
        ];

        for (const rc of rangeCases) {
            const res = await makeRequest({
                path: '/assets/audio/airflow.mp3',
                method: 'GET',
                headers: { 'Range': rc.range }
            });
            let ok = false;
            if (res.success) {
                if (Array.isArray(rc.expectStatus)) {
                    ok = rc.expectStatus.includes(res.statusCode);
                } else {
                    ok = res.statusCode === rc.expectStatus;
                }
            }
            recordResult('3. Boundary Sizes & Stress', `Audio Range: ${rc.name}`, ok, {
                range: rc.range,
                expected: rc.expectStatus,
                actual: res.statusCode
            });
        }

        // =====================================================================
        // Category 4: HTTP Methods & Protocol Variations
        // =====================================================================
        const methodsToTest = ['GET', 'POST', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'PATCH'];
        for (const m of methodsToTest) {
            const resM = await makeRequest({ path: '/index.html', method: m });
            let ok = resM.success && (resM.statusCode === 200 || resM.statusCode === 204 || resM.statusCode === 404 || resM.statusCode === 405);
            if (m === 'OPTIONS') {
                ok = resM.success && resM.statusCode === 204 && resM.body === '';
            } else if (m === 'HEAD') {
                ok = resM.success && resM.statusCode === 200 && resM.body === '';
            }
            recordResult('4. HTTP Methods & Protocol Variations', `Method: ${m}`, ok, {
                method: m,
                statusCode: resM.statusCode,
                bodyLength: resM.body ? resM.body.length : 0
            });
        }

        // Raw TCP Socket Fuzzing: HTTP/1.0 without Host
        const rawHttp10 = await makeRawSocketRequest("GET / HTTP/1.0\r\n\r\n");
        const okHttp10 = rawHttp10.success && rawHttp10.response.includes('200 OK');
        recordResult('4. HTTP Methods & Protocol Variations', 'HTTP/1.0 without Host header', okHttp10, {
            responseSnippet: rawHttp10.response.substring(0, 100)
        });

        // Raw TCP Socket Fuzzing: Garbage request line
        const rawGarbage = await makeRawSocketRequest("NOT_A_VALID_HTTP_REQUEST_LINE\r\n\r\n");
        const okGarbage = rawGarbage.success || rawGarbage.error === 'ECONNRESET';
        recordResult('4. HTTP Methods & Protocol Variations', 'Garbage TCP payload (no server crash)', okGarbage, {
            responseSnippet: rawGarbage.response ? rawGarbage.response.substring(0, 100) : rawGarbage.error
        });

        // Raw TCP Socket Fuzzing: Pipelined requests
        const pipelinePayload = "GET /index.html HTTP/1.1\r\nHost: localhost\r\n\r\nGET /style.css HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
        const rawPipeline = await makeRawSocketRequest(pipelinePayload);
        const okPipeline = rawPipeline.success && rawPipeline.response.includes('200 OK');
        recordResult('4. HTTP Methods & Protocol Variations', 'HTTP/1.1 Pipelined Requests', okPipeline, {
            responseSnippet: rawPipeline.response.substring(0, 100)
        });

        // =====================================================================
        // Category 5: CORS & Security Isolation Header Verification
        // =====================================================================
        const testStatusCases = [
            { name: '200 OK headers (/)', path: '/', method: 'GET', status: 200 },
            { name: '204 No Content headers (OPTIONS /boot.js)', path: '/boot.js', method: 'OPTIONS', status: 204 },
            { name: '206 Partial Content headers (Range)', path: '/assets/audio/airflow.mp3', method: 'GET', status: 206, headers: { 'Range': 'bytes=0-50' } },
            { name: '400 Bad Request headers (/%E0%A4%A)', path: '/%E0%A4%A', method: 'GET', status: 400 },
            { name: '403 Forbidden headers (/../package.json)', path: '/../package.json', method: 'GET', status: 403 },
            { name: '404 Not Found headers (/missing_xyz.png)', path: '/missing_xyz.png', method: 'GET', status: 404 }
        ];

        for (const sc of testStatusCases) {
            const res = await makeRequest({
                path: sc.path,
                method: sc.method,
                headers: sc.headers || {}
            });
            const statusMatch = res.success && res.statusCode === sc.status;
            const headersOk = res.success && verifySecurityHeaders(res.headers);
            recordResult('5. CORS & Security Isolation Headers', sc.name, statusMatch && headersOk, {
                expectedStatus: sc.status,
                actualStatus: res.statusCode,
                headersOk,
                headers: res.headers
            });
        }

        // =====================================================================
        // Category 6: Concurrency & Stress
        // =====================================================================
        console.log('Running burst of 100 concurrent requests...');
        const burstPromises = [];
        for (let i = 0; i < 100; i++) {
            const targetPath = (i % 2 === 0) ? '/index.html' : '/boot.js';
            burstPromises.push(makeRequest({ path: targetPath, method: 'GET' }));
        }
        const burstResults = await Promise.all(burstPromises);
        const burstAll200 = burstResults.every(r => r.success && r.statusCode === 200);
        recordResult('6. Concurrency & Stress', '100 Concurrent Requests (Burst test)', burstAll200, {
            total: burstResults.length,
            failedRequests: burstResults.filter(r => !r.success || r.statusCode !== 200).length
        });

    } finally {
        await new Promise((resolve) => server.close(resolve));
    }

    return results;
}

runFuzzSuite().then((res) => {
    console.log('\n====================================================');
    console.log(`FUZZING SUITE SUMMARY: ${res.passed}/${res.total} tests passed (${res.failed} failures)`);
    console.log('====================================================');
    for (const [cat, data] of Object.entries(res.categories)) {
        console.log(` - ${cat}: ${data.passed}/${data.total} passed`);
    }
    if (res.failures.length > 0) {
        console.log('\nFAILURES:');
        console.log(JSON.stringify(res.failures, null, 2));
    }
    process.exit(res.failed === 0 ? 0 : 1);
}).catch(err => {
    console.error('Fatal runner error:', err);
    process.exit(2);
});
