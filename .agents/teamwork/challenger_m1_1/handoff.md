# Empirical Challenge Report & Handoff: Server Adversarial Stress Testing

**Challenger Agent**: Challenger M1-1 (`teamwork_preview_challenger`)  
**Parent Orchestrator**: `d7c1aaca-334c-4557-bb98-f39a48d70c24`  
**Working Directory**: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\challenger_m1_1`  
**Date**: 2026-10-17  
**Artifact Path**: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\challenger_m1_1\handoff.md`  
**Handoff Type**: Hard (Challenge Complete)  
**Verdict**: **REQUEST_CHANGES**

---

## Challenge Summary

**Overall Risk Assessment**: **CRITICAL**

An empirical adversarial test harness (`tests/challenge_stress.js`) was developed and executed to challenge `server.js` under extreme load, port conflict conditions, and malformed protocol inputs. While `server.js` exhibits high concurrency throughput and robust port cascading, an **unhandled exception leading to immediate server process crash (Remote Denial of Service)** was empirically confirmed when sending malformed HTTP Range headers with non-numeric end values (e.g. `Range: bytes=0-abc`).

---

## 1. Observation

### 1.1 High Concurrency & Parallel Request Load
- **Tool Command**: `node tests/challenge_stress.js` (Suite 1)
- **Files Tested**:
  - `roads.bin.gz` (5,613,318 bytes)
  - `app.js` (4,068,985 bytes)
  - `index.html` (39,343 bytes)
- **Observations**:
  - **60 parallel requests**: Completed in 3,267ms. 100% SHA-256 hash match against disk files for every request (0 byte corruptions). All responses contained required cross-origin isolation headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`).
  - **120 burst requests** (~388 MB total throughput): Completed in 6,653ms with 120/120 successful HTTP 200 responses and 0 connection drops.
  - **Client Abort Stress**: 30 simultaneous client disconnects mid-stream on 5.6MB transfers were executed via `req.destroy()`. The server survived without throwing uncaught errors or locking file handles, and subsequent requests responded immediately with HTTP 200.

### 1.2 Port Collision Simulation
- **Tool Command**: `node tests/challenge_stress.js` (Suite 2)
- **Observations**:
  - **Chained Collisions**: Ports 4300, 4301, 4302, 4303 were bound by dummy blockers. Invoking `server.js 4300 --no-open` cleanly cascaded across all 4 occupied ports and bound port 4304, serving HTTP 200.
  - **Concurrent Process Race**: 3 separate `node server.js 4320 --no-open` processes launched at the exact same millisecond. They resolved without error to unique ports 4320, 4321, and 4322, and all three responded with HTTP 200.

### 1.3 Range Header Stress Testing & Process Crash (CRITICAL)
- **Tool Command**:
  ```powershell
  node -e "const { server } = require('./server.js'); server.listen(3980, async () => { const res = await fetch('http://localhost:3980/assets/audio/airflow.mp3', { headers: { 'Range': 'bytes=0-abc' } }); });"
  ```
- **Verbatim Error & Stack Trace**:
  ```text
  node:internal/errors:540
        throw error;
        ^

  RangeError [ERR_OUT_OF_RANGE]: The value of "end" is out of range. It must be an integer. Received NaN
      at new ReadStream (node:internal/fs/streams:215:5)
      at Object.createReadStream (node:fs:3142:10)
      at Server.<anonymous> (C:\Users\Gabi\Downloads\game fly\server.js:167:25)
      at Server.emit (node:events:507:28)
      at parserOnIncoming (node:_http_server:1155:12)
      at HTTPParser.parserOnHeadersComplete (node:_http_common:117:17) {
    code: 'ERR_OUT_OF_RANGE'
  }

  Node.js v24.1.0
  ```
- **File & Line**: `server.js:147-167`
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
  ...
  167:        const file = fs.createReadStream(filePath, { start, end });
  ```
- **Empirical Test Matrix**:
  | Range Header | Result in `server.js` | Status / Impact |
  |---|---|---|
  | `bytes=0-100` | 206 Partial Content (101 bytes) | PASS |
  | `bytes=100-` | 206 Partial Content | PASS |
  | `bytes=-100` | 206 Partial Content (last 100 bytes) | PASS |
  | `bytes=500-200` (inverted) | 416 Range Not Satisfiable | PASS |
  | `bytes=999999-` (overflow) | 416 Range Not Satisfiable | PASS |
  | `bytes=0-9999999` (end overflow) | 206 clamped to file size | PASS |
  | `bytes=abc-def` (non-numeric start & end) | 416 Range Not Satisfiable | PASS |
  | `bytes=foobar` (non-numeric string) | 416 Range Not Satisfiable | PASS |
  | `bytes=0-abc` (numeric start, non-numeric end) | **Uncaught RangeError: ERR_OUT_OF_RANGE** | **CRITICAL: PROCESS DIES** |
  | `bytes=10-xyz` (numeric start, non-numeric end) | **Uncaught RangeError: ERR_OUT_OF_RANGE** | **CRITICAL: PROCESS DIES** |
  | `bytes=0-NaN` | **Uncaught RangeError: ERR_OUT_OF_RANGE** | **CRITICAL: PROCESS DIES** |
  | `bytes=0-Infinity` | **Uncaught RangeError: ERR_OUT_OF_RANGE** | **CRITICAL: PROCESS DIES** |

### 1.4 Architectural Contract Discrepancy (PROJECT.md)
- `PROJECT.md` line 6:
  > "- **Server & Delivery**: `server.js` serves static assets with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers, **byte-range streaming for `.bin.gz` geographic buffers**, and automatic port fallback."
- `server.js` line 148 restricts Range handling strictly to audio files:
  `if (range && (ext === '.mp3' || ext === '.ogg' || ext === '.wav'))`
- When requesting `Range: bytes=0-100` for `/assets/real/roads.bin.gz`, `server.js` ignores the range and streams the full 5,613,318 bytes under HTTP 200.

---

## 2. Logic Chain

1. **Root Cause Analysis of the Crash**:
   - In `server.js:149`, `range.replace(/bytes=/, '').split('-')` produces `parts = ['0', 'abc']`.
   - `start` is parsed as `0` (valid integer).
   - `parts[1]` is `'abc'`, which is truthy. `parseInt('abc', 10)` yields `NaN`. Therefore, `end = NaN`.
   - Line 152 checks `if (isNaN(start))`. Since `start = 0`, this branch is skipped.
   - Line 157 checks `if (end >= stat.size)`. In ECMAScript, `NaN >= stat.size` evaluates to `false`.
   - Line 158 checks `if (start > end)`. In ECMAScript, `0 > NaN` evaluates to `false`.
   - The code proceeds to line 167: `fs.createReadStream(filePath, { start, end })` with `end = NaN`.
   - In Node.js `fs.createReadStream`, options validation throws `RangeError [ERR_OUT_OF_RANGE]: The value of "end" is out of range. It must be an integer. Received NaN`.
   - Because this error is thrown synchronously at stream instantiation and is not wrapped in `try/catch`, it bubbles up to the HTTP server's event loop uncaught, triggering `process.exit(1)`.
   - All subsequent client connections to the server receive `ECONNREFUSED`.

2. **Severity Assessment**:
   - The vulnerability is classified as **CRITICAL**. Any unauthenticated client or web scraper sending a single malformed HTTP request crashes the entire Node.js server for all active players.
   - Per HTTP RFC 9110 Section 14.1.2 and RFC 7233 Section 4.4, origin servers must either return `416 Range Not Satisfiable` or ignore invalid range fields and serve the representation under `200 OK`. A server crash violates HTTP specifications.

---

## 3. Caveats

1. **Scope Boundary**: As Challenger, no modifications were made to implementation code (`server.js`). All tests were conducted against unmodified repository code using `tests/challenge_stress.js`.
2. **Platform Context**: Tests were executed on Windows (x64) under Node.js v24.1.0. The synchronous `ERR_OUT_OF_RANGE` exception in Node's `fs.createReadStream` is standard across all platforms (Windows, Linux, macOS).
3. **Alternative Interpretations**:
   - Suffix ranges where `parts[0]` is non-numeric and `parts[1]` is non-numeric (e.g. `bytes=abc-def`) happen to return 416 only because `start` is calculated as `stat.size - 0 = stat.size`, which triggers `start > end`. Relying on accidental arithmetic on `NaN` is fragile.
   - Regarding `.bin.gz` range streaming: client code in `app.js` and `boot.js` currently downloads entire buffer streams with `DecompressionStream`. However, to fully adhere to `PROJECT.md` line 6, `.bin.gz` could either support byte ranges or the specification should explicitly document whole-buffer streaming for pre-compressed assets.

---

## 4. Conclusion

**Verdict**: **REQUEST_CHANGES**

`server.js` cannot be approved in its current state due to the reproducible process crash under malformed HTTP Range requests.

### Required Changes for Worker:
1. **Sanitize `end` and `start` Range parameters**:
   In `server.js:151-165`:
   - If `parts[1]` is present and non-empty, verify `!isNaN(end)`. If `isNaN(end)`, return HTTP 416 immediately:
     ```javascript
     if (parts[1] !== undefined && parts[1] !== '' && isNaN(end)) {
         res.writeHead(416, {
             'Content-Range': `bytes */${stat.size}`,
             'Content-Type': contentType
         });
         res.end();
         return;
     }
     ```
   - Validate that both `start` and `end` are integers before passing them to `fs.createReadStream`.
2. **Defensive Stream Instantiation**:
   Wrap `fs.createReadStream(filePath, { start, end })` in a `try/catch` block to guarantee that any runtime stream initialization failure sends HTTP 500 without crashing the Node.js process:
   ```javascript
   let file;
   try {
       file = fs.createReadStream(filePath, { start, end });
   } catch (err) {
       if (!res.headersSent) {
           res.writeHead(500, { 'Content-Type': 'text/plain' });
           res.end('500 Internal Server Error');
       }
       return;
   }
   ```
3. **Include Regression Test in Test Suite**:
   Add test cases in `tests/server.test.js` verifying that `Range: bytes=0-abc`, `Range: bytes=10-xyz`, and `Range: bytes=0-NaN` return HTTP 416 (or ignore the range) without crashing the process.

---

## 5. Verification Method

To independently reproduce the vulnerability and verify the fix:

1. **Reproduction One-Liner (Must crash with `ERR_OUT_OF_RANGE` prior to fix)**:
   ```powershell
   node -e "const { server } = require('./server.js'); server.listen(3980, async () => { try { await fetch('http://localhost:3980/assets/audio/airflow.mp3', { headers: { 'Range': 'bytes=0-abc' } }); } catch(e) {} server.close(); });"
   ```
   *Current Result*: Exits code 1 with `RangeError [ERR_OUT_OF_RANGE]: The value of "end" is out of range. It must be an integer. Received NaN`.  
   *Expected Post-Fix Result*: Exits code 0; HTTP response is 416 (or 200).

2. **Run Full Adversarial Challenge Suite**:
   ```powershell
   node tests/challenge_stress.js
   ```
   *Expected Post-Fix Result*: All 14 tests pass, exit code 0.

3. **Invalidation Conditions**:
   - Any unhandled exception or process termination upon receiving malformed Range headers (`bytes=0-abc`, `bytes=10-xyz`, `bytes=0-NaN`).
   - Failure to return HTTP 416 or HTTP 200 for malformed ranges.
   - Any regression in the 16 existing tests in `tests/server.test.js`.
