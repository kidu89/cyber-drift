# Handoff Report: Malformed HTTP Range Header Regression Test Specifications

**Agent**: Spec Miner M1-Iter2-3 (`teamwork_preview_spec_miner`)  
**Parent Orchestrator**: `d7c1aaca-334c-4557-bb98-f39a48d70c24`  
**Working Directory**: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\spec_miner_m1_iter2_3`  
**Date**: 2026-10-17  
**Artifact Path**: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\spec_miner_m1_iter2_3\handoff.md`  
**Analysis Path**: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\spec_miner_m1_iter2_3\analysis.md`  
**Handoff Type**: Hard (Task Complete)  

---

## 1. Observation

Direct observations from codebase inspection, RFC standards, and empirical probing:

1. **Empirical Process Crash on Malformed Range End**:
   - **Command Executed**:
     ```powershell
     node -e "const { server } = require('./server.js'); server.listen(3999, async () => { try { const res = await fetch('http://localhost:3999/assets/audio/airflow.mp3', { headers: { 'Range': 'bytes=0-abc' } }); console.log('Status:', res.status); } catch(e) { console.error('Caught error:', e.message); } finally { server.close(); } });"
     ```
   - **Exit Code**: `1` (Fatal Process Termination)
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

2. **Source Code Defect in `server.js` (lines 147-167)**:
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
   ```
   When `parts[0]` is a valid integer string (e.g. `'0'`, `'10'`) and `parts[1]` is non-numeric (e.g. `'abc'`, `'xyz'`, `'NaN'`, `'Infinity'`, `'undefined'`, `'null'`), `parseInt(parts[1], 10)` yields `NaN`.
   `isNaN(start)` evaluates to `false`.
   In JavaScript, `NaN >= stat.size` and `start > NaN` both evaluate to `false`.
   `fs.createReadStream(filePath, { start, end: NaN })` is invoked synchronously without a `try/catch` guard.

3. **Empirical Range Matrix Probing Results**:
   Running `.agents/teamwork/spec_miner_m1_iter2_3/probe_ranges.js` across 28 header variants demonstrated:
   - **Crashes (Exit code 1)**: `bytes=0-abc`, `bytes=10-xyz`, `bytes=0-NaN`, `bytes=0-Infinity`, `bytes=0-undefined`, `bytes=0-null`.
   - **Accidental Pass (416)**: `bytes=abc-def`, `bytes=foobar`, `bytes=-`, `bytes=--`, `bytes=-abc`, `bytes=abc-`, `bytes=null-null` pass only because `isNaN(start)` triggers `start = stat.size - 0 = stat.size`, which happens to satisfy `start > end`.
   - **Misinterpreted Parsing**: `bytes=NaN-10` and `bytes=Infinity-10` are treated as suffix ranges and return 206 instead of 416.
   - **Standard Valid Ranges**: `bytes=0-99` (206), `bytes=100-` (206), `bytes=-10` (206), `bytes=0-0` (206, 1 byte), `bytes=0-999999999` (206 clamped to EOF).
   - **Inverted & Overflow Ranges**: `bytes=500-200` (416), `bytes=999999999-` (416), `bytes=-0` (416).

4. **Existing Test Suite Gap (`tests/server.test.js`)**:
   `tests/server.test.js` contains 16 tests. Test 12 verifies valid audio range streaming (`bytes=0-99`, `bytes=100-`, and non-audio `bytes=0-50`), but contains **zero tests for HTTP 416 responses, invalid ranges, or malformed Range headers**. Consequently, `npm test` passed 16/16 tests despite this critical Denial of Service defect being present.

---

## 2. Logic Chain

1. From Observation 1 and Observation 2, when `parts[1]` contains any string that cannot be parsed into an integer by `parseInt(parts[1], 10)`, `end` becomes `NaN`.
2. Because `start` is a number (e.g. `0`), line 152 (`isNaN(start)`) is false, line 157 (`NaN >= stat.size`) is false, and line 158 (`0 > NaN`) is false.
3. Therefore, execution proceeds directly to line 167: `fs.createReadStream(filePath, { start, end: NaN })`.
4. In Node.js, `fs.createReadStream` validates options synchronously using `validateInteger(options.end, 'end', 0)`. When passed `NaN`, it immediately throws `RangeError [ERR_OUT_OF_RANGE]`.
5. Because there is no `try/catch` wrapper around `fs.createReadStream`, this exception bubbles to the Node.js event loop uncaught, triggering an immediate and fatal process termination (`process.exit(1)`).
6. From Observation 4, the existing automated test suite (`tests/server.test.js`) did not test malformed Range headers, allowing this critical vulnerability to persist undetected in Milestone 1.
7. Under HTTP RFC 9110 §14.1.2 & §14.4 and RFC 7233 §4.4, origin servers receiving invalid or unsatisfiable Range headers must either ignore the header (serving 200) or return `HTTP 416 Range Not Satisfiable` with `Content-Range: bytes */<complete-length>`. Under no circumstance may a server process crash.
8. Therefore, formulating an explicit regression test suite in `tests/server.test.js` that tests these malformed Range variants, asserts HTTP 416 with correct `Content-Range` headers, and proves that subsequent requests continue to be served with HTTP 200 (server survival) is required.

---

## 3. Caveats

1. **Non-Audio Files**: Range requests on non-audio static files (`.bin.gz`, `.js`, `.css`, `.html`) intentionally bypass Range handling and return `HTTP 200 OK` with full resource length per line 148 in `server.js` and Test 12 in `tests/server.test.js`.
2. **Multi-Part Ranges**: HTTP/1.1 multi-part ranges (e.g. `Range: bytes=0-10, 20-30`) currently execute `range.replace(/bytes=/, '').split('-')`, which takes the first chunk (`0-10`) and returns 206. RFC 9110 permits servers to reject or simplify multi-range requests. Returning 416 or serving the first range is compliant.
3. **Radix Parsing**: `parseInt('12abc', 10)` parses `12` due to JavaScript's standard radix parsing. While strict integer regex validation is even safer, validating `!isNaN(end)` and `!isNaN(start)` ensures Node's stream options receive valid integers and will never throw `ERR_OUT_OF_RANGE`.

---

## 4. Conclusion

The specification requirements and regression test designs are fully mined, categorized, and documented in `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\spec_miner_m1_iter2_3\analysis.md`.

### Concrete Specification for Test Author (`tests/server.test.js`):
Add Test 17 to `tests/server.test.js`:
- **Test Title**: `17. Robustness: Malformed HTTP Range Header Variants return HTTP 416 and Server Process Survives`
- **Variants Tested**:
  - Numeric start, non-numeric end: `bytes=0-abc`, `bytes=10-xyz`, `bytes=0-NaN`, `bytes=0-Infinity`, `bytes=0-undefined`, `bytes=0-null`
  - Non-numeric start, numeric end: `bytes=NaN-10`, `bytes=Infinity-10`
  - Inverted numeric ranges: `bytes=500-200`, `bytes=10-5`, `bytes=1-0`
  - Start overflow beyond EOF: `bytes=999999999-`, `bytes=999999999-1000`
  - Syntactically malformed / non-numeric: `bytes=abc-def`, `bytes=foobar`, `bytes=-`, `bytes=--`, `bytes=-0`, `bytes=-abc`, `bytes=abc-`
- **Assertions for each variant**:
  1. `assert.strictEqual(res.statusCode, 416)`
  2. `assert.strictEqual(res.headers['content-range'], 'bytes */' + stat.size)`
  3. `assert.strictEqual(res.headers['cross-origin-opener-policy'], 'same-origin')`
  4. `assert.strictEqual(res.headers['cross-origin-embedder-policy'], 'require-corp')`
  5. `assert.strictEqual(res.headers['cross-origin-resource-policy'], 'cross-origin')`
  6. `assert.strictEqual(res.headers['access-control-allow-origin'], '*')`
  7. **Liveness check**: Perform immediate follow-up `httpRequest` for `GET /`, assert `statusCode === 200`, confirming the server process remains healthy and responsive.

### Concrete Remediation Guidance for Worker Agent (`server.js`):
1. In `server.js:151-165`:
   - Check `if (parts[1] !== undefined && parts[1] !== '' && isNaN(end))` -> Return HTTP 416 immediately with `Content-Range: bytes */${stat.size}`.
   - For suffix parsing, ensure `isNaN(suffix) || suffix <= 0` returns 416.
   - Final condition: `if (isNaN(start) || isNaN(end) || start > end || start >= stat.size)` -> Return HTTP 416.
2. Defensive wrapping:
   - Wrap `fs.createReadStream(filePath, { start, end })` in a `try/catch` block to handle any synchronous stream error without terminating the server process.

---

## 5. Verification Method

To independently verify the bug and validate the proposed test specification:

1. **Bug Reproduction Command (Fails with ERR_OUT_OF_RANGE before fix)**:
   ```powershell
   node -e "const { server } = require('./server.js'); server.listen(3999, async () => { try { await fetch('http://localhost:3999/assets/audio/airflow.mp3', { headers: { 'Range': 'bytes=0-abc' } }); } catch(e) {} finally { server.close(); } });"
   ```
   *Current Observation*: Crashes with code 1, stack trace `RangeError [ERR_OUT_OF_RANGE]: The value of "end" is out of range. Received NaN`.  
   *Expected Post-Fix*: Exits code 0; server serves 416 without crashing.

2. **Probe Script Verification**:
   ```powershell
   node .agents/teamwork/spec_miner_m1_iter2_3/probe_ranges.js
   ```
   *Expected Post-Fix*: 0 crashes across all 28 variants; malformed variants return STATUS 416.

3. **Run Regression Test Suite**:
   ```powershell
   node --test tests/server.test.js
   ```
   *Expected Post-Fix*: 17 tests pass (exit code 0).

4. **Invalidation Conditions**:
   - Sending `Range: bytes=0-abc` causes `server.js` to crash or throw an unhandled exception.
   - `server.js` responds with any status other than HTTP 416 for `bytes=0-abc`, `bytes=10-xyz`, `bytes=0-NaN`.
   - `Content-Range` header on 416 response does not match `bytes */<file_size>`.
   - Security isolation headers (COOP, COEP, CORS) are missing from the 416 response.
   - A subsequent `GET /` request fails with `ECONNREFUSED` or timeout after receiving a malformed Range header.
