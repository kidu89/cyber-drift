# Specification Mining & Regression Test Analysis: Malformed HTTP Range Handling

**Agent**: Spec Miner M1-Iter2-3 (`teamwork_preview_spec_miner`)  
**Target File**: `c:\Users\Gabi\Downloads\game fly\server.js`  
**Test File Target**: `c:\Users\Gabi\Downloads\game fly\tests\server.test.js`  
**Working Directory**: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\spec_miner_m1_iter2_3`  
**Date**: 2026-10-17  

---

## 1. Executive Summary & Objective

During adversarial challenge stress testing (documented in `challenger_m1_1/handoff.md`), a **CRITICAL Remote Denial of Service (DoS) vulnerability** was discovered in `server.js`. Sending an HTTP request with a malformed `Range` header featuring a valid numeric start and a non-numeric end (e.g., `Range: bytes=0-abc`, `bytes=10-xyz`, `bytes=0-NaN`) causes an uncaught `RangeError [ERR_OUT_OF_RANGE]: The value of "end" is out of range. It must be an integer. Received NaN` thrown synchronously by Node's internal `fs.createReadStream`. This uncaught exception immediately crashes the Node.js server process, causing subsequent client requests to fail with `ECONNREFUSED`.

This report provides:
1. Comprehensive empirical probing of Range header handling across 28 distinct input vectors.
2. Formal specification discovery per HTTP RFC 9110 / RFC 7233 and project architecture requirements.
3. Concrete, drop-in regression test specifications for `tests/server.test.js` to ensure HTTP 416 responses and server process survival.
4. Authoritative remediation guidance for Worker implementation.

---

## 2. Root Cause Analysis & Vulnerability Mechanism

### 2.1 The Vulnerable Code Path (`server.js:147-182`)

```javascript
147:    const range = req.headers.range;
148:    if (range && (ext === '.mp3' || ext === '.ogg' || ext === '.wav')) {
149:        const parts = range.replace(/bytes=/, '').split('-');
150:        let start = parseInt(parts[0], 10);
151:        let end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
152:        if (isNaN(start)) {
153:            start = stat.size - (parseInt(parts[1], 10) || 0);
154:            end = stat.size - 1;
155:        }
156:        if (start < 0) start = 0;
157:        if (end >= stat.size) end = stat.size - 1;
158:        if (start > end) {
159:            res.writeHead(416, {
160:                'Content-Range': `bytes */${stat.size}`,
161:                'Content-Type': contentType
162:            });
163:            res.end();
164:            return;
165:        }
166:        const chunksize = (end - start) + 1;
167:        const file = fs.createReadStream(filePath, { start, end });
168:        file.on('error', () => { ... });
169:        ...
```

### 2.2 Trace of Failure for `Range: bytes=0-abc`

1. **Line 149**: `range.replace(/bytes=/, '').split('-')` produces `parts = ['0', 'abc']`.
2. **Line 150**: `start = parseInt('0', 10)` => `0` (a valid integer).
3. **Line 151**: `parts[1]` is `'abc'` (truthy string). `parseInt('abc', 10)` evaluates to `NaN`. Therefore, `end = NaN`.
4. **Line 152**: `if (isNaN(start))` evaluates to `false` because `start = 0`. The suffix range branch is skipped.
5. **Line 156**: `if (start < 0)` evaluates to `false`.
6. **Line 157**: `if (end >= stat.size)`: In ECMAScript, `NaN >= number` evaluates to `false`. No clamp occurs.
7. **Line 158**: `if (start > end)`: In ECMAScript, `0 > NaN` evaluates to `false`. The 416 check is skipped!
8. **Line 166**: `const chunksize = (NaN - 0) + 1` evaluates to `NaN`.
9. **Line 167**: `fs.createReadStream(filePath, { start: 0, end: NaN })`.
10. **Node.js Internal Stream Validation**:
    Inside Node.js `node:internal/fs/streams:215`:
    ```javascript
    if (options.end !== undefined) {
        validateInteger(options.end, 'end', 0);
    }
    ```
    Throws `RangeError [ERR_OUT_OF_RANGE]: The value of "end" is out of range. It must be an integer. Received NaN`.
11. **Fatal Process Exit**:
    Because stream instantiation occurs synchronously and is NOT wrapped in a `try/catch` block, this error is not caught by `file.on('error')` (which only handles asynchronous I/O errors during streaming). The exception bubbles to the Node.js event loop uncaught, triggering `process.exit(1)`.

---

## 3. Authoritative Specification Grounding

### 3.1 HTTP Standards (RFC 9110 Section 14 / RFC 7233 Section 4)

1. **Syntax Definition (RFC 9110 §14.1.2)**:
   - `Range = byte-ranges-specifier`
   - `byte-range-spec = first-byte-pos "-" [ last-byte-pos ]`
   - `first-byte-pos = 1*DIGIT`
   - `last-byte-pos = 1*DIGIT`
   - Any non-digit character in `first-byte-pos` or `last-byte-pos` is syntactically invalid.
2. **Invalid Range Handling (RFC 9110 §14.1.2 & §14.4)**:
   - "An origin server that evaluates a Range header field MUST validate that each byte-range-spec and suffix-byte-range-spec within that field is syntactically valid."
   - "An origin server that receives an invalid Range header field SHOULD either ignore that header field or respond with a 416 (Range Not Satisfiable) status code."
   - When returning 416: "The server SHOULD generate a Content-Range header field specifying the current length of the selected representation: `Content-Range: bytes */<complete-length>`."
3. **Application Contract**:
   - In `Teleoperator`, audio streaming endpoints (`.mp3`, `.ogg`, `.wav`) must return `HTTP 416` with header `Content-Range: bytes */<stat.size>` when encountering malformed or unsatisfiable ranges.
   - Non-audio assets (`.bin.gz`, `.js`, `.css`, `.html`) ignore Range headers and return `HTTP 200 OK` with full resource length.
   - Under NO input condition may the server process throw an unhandled exception or crash.

---

## 4. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Range Streaming | Valid Standard Range | Streams partial byte chunk between start and end | `Range: bytes=0-99` for audio | HTTP 206, `Content-Range: bytes 0-99/183946`, `Content-Length: 100`, `Accept-Ranges: bytes` | N/A | RFC 9110 / `tests/server.test.js:293` |
| 2 | Range Streaming | Open-Ended Range | Streams bytes from start offset to end-of-file | `Range: bytes=100-` for audio | HTTP 206, `Content-Range: bytes 100-183945/183946`, `Content-Length: 183846` | N/A | RFC 9110 / `tests/server.test.js:309` |
| 3 | Range Streaming | Suffix Byte Range | Streams the final N bytes of the resource representation | `Range: bytes=-100` for audio | HTTP 206, `Content-Range: bytes 183846-183945/183946`, `Content-Length: 100` | Clamped if suffix > size | RFC 9110 / Empirical Probe |
| 4 | Range Streaming | Single Byte Boundary Range | Streams exact 1-byte boundary slices (first or last byte) | `Range: bytes=0-0` or `bytes=183945-183945` | HTTP 206, `Content-Range: bytes 0-0/183946`, `Content-Length: 1` | N/A | RFC 9110 / Empirical Probe |
| 5 | Range Streaming | End-Overflow Range Clamping | End offset exceeding file size is clamped to file size - 1 | `Range: bytes=0-999999999` | HTTP 206, `Content-Range: bytes 0-183945/183946`, `Content-Length: 183946` | N/A | RFC 9110 / Empirical Probe |
| 6 | Range Streaming | Non-Audio Range Bypass | Static files outside audio extensions ignore Range and serve full content | `Range: bytes=0-50` for `/style.css` or `/roads.bin.gz` | HTTP 200, full payload length, `Accept-Ranges: bytes` | N/A | `server.js:148` / `tests/server.test.js:321` |
| 7 | Error Handling | Inverted Numeric Range Rejection | Start position strictly greater than end position | `Range: bytes=500-200`, `bytes=10-5` | HTTP 416, `Content-Range: bytes */183946` | Rejected before streaming | RFC 9110 §14.4 / `server.js:158` |
| 8 | Error Handling | Out-of-Bounds Start Rejection | Start position equal to or exceeding total resource size | `Range: bytes=999999-`, `bytes=999999-1000000` | HTTP 416, `Content-Range: bytes */183946` | Rejected before streaming | RFC 9110 §14.4 / Empirical Probe |
| 9 | Robustness / Security | Malformed End Range Validation | Non-numeric end position with numeric start must return 416 without crashing | `Range: bytes=0-abc`, `bytes=10-xyz`, `bytes=0-NaN`, `bytes=0-Infinity` | HTTP 416, `Content-Range: bytes */183946` | Must NOT throw `ERR_OUT_OF_RANGE` | `challenger_m1_1/handoff.md` & Empirical Probe |
| 10 | Robustness / Security | Completely Malformed Range Rejection | Non-numeric strings, missing parts, or arbitrary text | `Range: bytes=abc-def`, `bytes=foobar`, `bytes=-`, `bytes=--` | HTTP 416, `Content-Range: bytes */183946` | Handled cleanly, no crash | RFC 9110 / Empirical Probe |
| 11 | Robustness / Security | Malformed Suffix Range Rejection | Suffix range with non-numeric or zero suffix length | `Range: bytes=-0`, `Range: bytes=-abc` | HTTP 416, `Content-Range: bytes */183946` | Handled cleanly, no crash | RFC 9110 / Empirical Probe |
| 12 | Robustness / Security | Defensive Stream Instantiation | Synchronous exceptions during stream creation must be intercepted | Unexpected file system / stream option errors | HTTP 500 Internal Server Error (or 416) | Intercepted via `try/catch`, process survives | Node.js Best Practice / Challenger Handoff |
| 13 | Robustness / Security | Server Process Survival Guarantee | Server continues serving requests normally after any malformed Range | Sequence: Malformed Range -> `GET /` | Subsequent request returns HTTP 200 OK | Process survives, zero connection drops | RFC 9110 / Project Integrity Requirement |
| 14 | Security Headers | Security Headers on 416 Responses | All error responses must include mandatory COOP/COEP/CORS headers | Any malformed Range request | Headers include COOP `same-origin`, COEP `require-corp`, CORP `cross-origin`, CORS `*` | Preserved on all status codes | `PROJECT.md:76-78` / `server.js:67-72` |

---

## 5. Edge Cases Probed

The following empirical matrix was executed via `node .agents/teamwork/spec_miner_m1_iter2_3/probe_ranges.js` against the live `server.js` implementation:

| # | Feature | Input Header | Observed Behavior | Status / Defect | Required Specification Behavior |
|---|---------|--------------|-------------------|-----------------|---------------------------------|
| 1 | Malformed End Range | `Range: bytes=0-abc` | Uncaught `RangeError [ERR_OUT_OF_RANGE]: The value of "end" is out of range. Received NaN` | **CRITICAL PROCESS CRASH** | HTTP 416, `Content-Range: bytes */183946`, Server Survives |
| 2 | Malformed End Range | `Range: bytes=10-xyz` | Uncaught `RangeError [ERR_OUT_OF_RANGE]` | **CRITICAL PROCESS CRASH** | HTTP 416, `Content-Range: bytes */183946`, Server Survives |
| 3 | Malformed End Range | `Range: bytes=0-NaN` | Uncaught `RangeError [ERR_OUT_OF_RANGE]` | **CRITICAL PROCESS CRASH** | HTTP 416, `Content-Range: bytes */183946`, Server Survives |
| 4 | Malformed End Range | `Range: bytes=0-Infinity` | Uncaught `RangeError [ERR_OUT_OF_RANGE]` | **CRITICAL PROCESS CRASH** | HTTP 416, `Content-Range: bytes */183946`, Server Survives |
| 5 | Malformed End Range | `Range: bytes=0-undefined` | Uncaught `RangeError [ERR_OUT_OF_RANGE]` | **CRITICAL PROCESS CRASH** | HTTP 416, `Content-Range: bytes */183946`, Server Survives |
| 6 | Malformed End Range | `Range: bytes=0-null` | Uncaught `RangeError [ERR_OUT_OF_RANGE]` | **CRITICAL PROCESS CRASH** | HTTP 416, `Content-Range: bytes */183946`, Server Survives |
| 7 | Inverted Range | `Range: bytes=500-200` | HTTP 416, `Content-Range: bytes */183946` | PASS | HTTP 416, `Content-Range: bytes */183946` |
| 8 | Inverted Range | `Range: bytes=10-5` | HTTP 416, `Content-Range: bytes */183946` | PASS | HTTP 416, `Content-Range: bytes */183946` |
| 9 | Inverted Range | `Range: bytes=1-0` | HTTP 416, `Content-Range: bytes */183946` | PASS | HTTP 416, `Content-Range: bytes */183946` |
| 10 | Overflow Start | `Range: bytes=999999999-1000` | HTTP 416, `Content-Range: bytes */183946` | PASS | HTTP 416, `Content-Range: bytes */183946` |
| 11 | Overflow Start | `Range: bytes=999999999-` | HTTP 416, `Content-Range: bytes */183946` | PASS | HTTP 416, `Content-Range: bytes */183946` |
| 12 | Non-Numeric Both | `Range: bytes=abc-def` | HTTP 416, `Content-Range: bytes */183946` | PASS (Accidental via `start > end`) | HTTP 416, `Content-Range: bytes */183946` |
| 13 | Single Token String | `Range: bytes=foobar` | HTTP 416, `Content-Range: bytes */183946` | PASS | HTTP 416, `Content-Range: bytes */183946` |
| 14 | Empty Hyphen | `Range: bytes=-` | HTTP 416, `Content-Range: bytes */183946` | PASS | HTTP 416, `Content-Range: bytes */183946` |
| 15 | Double Hyphen | `Range: bytes=--` | HTTP 416, `Content-Range: bytes */183946` | PASS | HTTP 416, `Content-Range: bytes */183946` |
| 16 | Non-Numeric Suffix | `Range: bytes=-abc` | HTTP 416, `Content-Range: bytes */183946` | PASS | HTTP 416, `Content-Range: bytes */183946` |
| 17 | Non-Numeric Prefix | `Range: bytes=abc-` | HTTP 416, `Content-Range: bytes */183946` | PASS | HTTP 416, `Content-Range: bytes */183946` |
| 18 | Zero Length Suffix | `Range: bytes=-0` | HTTP 416, `Content-Range: bytes */183946` | PASS | HTTP 416, `Content-Range: bytes */183946` |
| 19 | Non-Numeric Start | `Range: bytes=NaN-10` | HTTP 206, `Content-Range: bytes 183936-183945/183946` | DEFECT (Misinterpreted as suffix -10) | HTTP 416, `Content-Range: bytes */183946` |
| 20 | Non-Numeric Start | `Range: bytes=Infinity-10` | HTTP 206, `Content-Range: bytes 183936-183945/183946` | DEFECT (Misinterpreted as suffix -10) | HTTP 416, `Content-Range: bytes */183946` |
| 21 | Suffix Range Valid | `Range: bytes=-10` | HTTP 206, `Content-Range: bytes 183936-183945/183946` | PASS | HTTP 206, `Content-Range: bytes 183936-183945/183946` |
| 22 | Single Byte First | `Range: bytes=0-0` | HTTP 206, `Content-Range: bytes 0-0/183946` (1 byte) | PASS | HTTP 206, `Content-Range: bytes 0-0/183946` |
| 23 | Single Byte Last | `Range: bytes=183945-183945`| HTTP 206, `Content-Range: bytes 183945-183945/183946` (1 byte) | PASS | HTTP 206, `Content-Range: bytes 183945-183945/183946` |
| 24 | End Overflow Clamp | `Range: bytes=0-999999999`| HTTP 206, `Content-Range: bytes 0-183945/183946` (183,946 bytes) | PASS | HTTP 206, clamped to full file size |
| 25 | Suffix Overflow Clamp | `Range: bytes=-999999999` | HTTP 206, `Content-Range: bytes 0-183945/183946` (183,946 bytes) | PASS | HTTP 206, clamped to full file size |
| 26 | Multi-part Range | `Range: bytes=0-10, 20-30`| HTTP 206, `Content-Range: bytes 0-10/183946` | Handled first range | HTTP 206 first range OR HTTP 416 |
| 27 | Floating Point Range | `Range: bytes=0-1.5` | HTTP 206, `Content-Range: bytes 0-1/183946` (truncated by `parseInt`) | PASS | Valid integer parsing |
| 28 | Non-Audio Static File | `Range: bytes=0-100` on `/style.css` | HTTP 200, full length 19,457 bytes, `Accept-Ranges: bytes` | PASS | HTTP 200 full content |

---

## 6. Exact Regression Test Specification for `tests/server.test.js`

To prevent regression and guarantee automated verification in CI/test environments, the following test specification must be added to `tests/server.test.js` inside the `test.describe('HTTP Endpoint and Header Verification', ...)` block.

### 6.1 Test Specification Structure

```javascript
test('17. Robustness: Malformed HTTP Range Header Variants return HTTP 416 and Server Process Survives', async () => {
    const audioPath = '/assets/audio/airflow.mp3';
    const diskPath = path.join(__dirname, '..', 'assets/audio/airflow.mp3');
    const stat = fs.statSync(diskPath);
    const expectedContentRange = `bytes */${stat.size}`;

    // Critical attack vectors and malformed variants:
    // Category A: Numeric start, non-numeric end (Previously crashed Node process with ERR_OUT_OF_RANGE)
    // Category B: Non-numeric start, numeric end
    // Category C: Inverted numeric ranges (start > end)
    // Category D: Out-of-bounds start (overflow beyond file size)
    // Category E: Completely syntactically invalid strings
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
        // 1. Send malformed request
        const res = await httpRequest({
            hostname: 'localhost',
            port: TEST_PORT,
            path: audioPath,
            method: 'GET',
            headers: { 'Range': rangeHeader }
        });

        // 2. Must respond with HTTP 416 Range Not Satisfiable
        assert.strictEqual(
            res.statusCode,
            416,
            `Expected HTTP 416 for Range: "${rangeHeader}", but received ${res.statusCode}`
        );

        // 3. Must include Content-Range header indicating unsatisfied bounds (bytes */totalSize)
        assert.strictEqual(
            res.headers['content-range'],
            expectedContentRange,
            `Expected Content-Range "${expectedContentRange}" for Range: "${rangeHeader}", but received "${res.headers['content-range']}"`
        );

        // 4. Must include mandatory security isolation and CORS headers
        assert.strictEqual(res.headers['cross-origin-opener-policy'], 'same-origin');
        assert.strictEqual(res.headers['cross-origin-embedder-policy'], 'require-corp');
        assert.strictEqual(res.headers['cross-origin-resource-policy'], 'cross-origin');
        assert.strictEqual(res.headers['access-control-allow-origin'], '*');

        // 5. CRITICAL LIVENESS CHECK: Verify server process did NOT crash and is still accepting requests
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
```

---

## 7. Remediation Guidance for Worker Agent

When implementing the fix in `server.js`, the Worker should apply the following modifications:

### 7.1 Validate `start` and `end` integers explicitly

In `server.js:147-165`:
```javascript
    const range = req.headers.range;
    if (range && (ext === '.mp3' || ext === '.ogg' || ext === '.wav')) {
        const parts = range.replace(/bytes=/, '').split('-');
        let start = parseInt(parts[0], 10);
        let end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

        // If parts[1] was provided but could not be parsed as an integer (e.g. 'abc', 'NaN'),
        // or parts[0] is not a valid integer for standard ranges, reject immediately with 416.
        if (parts[1] !== undefined && parts[1] !== '' && isNaN(end)) {
            res.writeHead(416, {
                'Content-Range': `bytes */${stat.size}`,
                'Content-Type': contentType
            });
            res.end();
            return;
        }

        if (isNaN(start)) {
            const suffix = parseInt(parts[1], 10);
            if (isNaN(suffix) || suffix <= 0) {
                res.writeHead(416, {
                    'Content-Range': `bytes */${stat.size}`,
                    'Content-Type': contentType
                });
                res.end();
                return;
            }
            start = stat.size - suffix;
            end = stat.size - 1;
        }

        if (start < 0) start = 0;
        if (end >= stat.size) end = stat.size - 1;

        if (isNaN(start) || isNaN(end) || start > end || start >= stat.size) {
            res.writeHead(416, {
                'Content-Range': `bytes */${stat.size}`,
                'Content-Type': contentType
            });
            res.end();
            return;
        }
```

### 7.2 Defensive Stream Instantiation (`try/catch`)

Wrap `fs.createReadStream` to catch synchronous exceptions:
```javascript
        let file;
        try {
            file = fs.createReadStream(filePath, { start, end });
        } catch (streamErr) {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Internal Server Error');
            }
            return;
        }
```

---

## 8. Verification Commands

1. **Reproduce Vulnerability Before Fix**:
   ```powershell
   node -e "const { server } = require('./server.js'); server.listen(0, async () => { try { await fetch('http://localhost:' + server.address().port + '/assets/audio/airflow.mp3', { headers: { 'Range': 'bytes=0-abc' } }); } catch(e) {} finally { server.close(); } });"
   ```
   *Expected Current (Unfixed)*: Crashes with `RangeError [ERR_OUT_OF_RANGE]: The value of "end" is out of range. Received NaN`. Exit code 1.

2. **Run Full Regression & Specification Suite**:
   ```powershell
   node --test tests/server.test.js
   ```
   *Expected Post-Fix*: All 17 tests pass (exit code 0).

3. **Run Adversarial Stress Harness**:
   ```powershell
   node tests/challenge_stress.js
   ```
   *Expected Post-Fix*: 14/14 tests pass (exit code 0).
