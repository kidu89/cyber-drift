# Review & Adversarial Challenge Report: Server Infrastructure (M1)

**Reviewer**: Reviewer M1-2 (`teamwork_preview_reviewer`)  
**Target Files**: `server.js`, `tests/server.test.js`  
**Milestone**: M1 (Server & Dev Infrastructure)  
**Parent Agent**: `d7c1aaca-334c-4557-bb98-f39a48d70c24`  
**Date**: 2026-10-17  

---

## 1. Review Summary

**Verdict**: **APPROVE**  
**Integrity Status**: **VERIFIED** (No hardcoded test outputs, no facade implementations, zero bypasses, authentic test execution).  
**Overall Risk Assessment**: **LOW**

The implementation in `server.js` and verification suite in `tests/server.test.js` successfully repair the 7 escaped backtick syntax errors, conform to all interface contracts defined in `PROJECT.md` and `SCOPE.md`, and demonstrate robust engineering practices for WebGPU cross-origin isolation, binary asset streaming, audio byte-range requests, port conflict resolution, and headless test execution.

---

## 2. In-Depth Evaluation of Core Focus Areas

### 2.1 Binary Asset Streaming (`.bin.gz` as `application/octet-stream` without `Content-Encoding: gzip`)
- **Requirement**: Pre-compressed geographic buffers (`roads.bin.gz`, `buildings.bin.gz`, etc.) must be served as `application/octet-stream` without `Content-Encoding: gzip`. Client engine in `app.js` and `workers/img.js` explicitly invokes `new DecompressionStream("gzip")`. Sending `Content-Encoding: gzip` causes the browser HTTP layer to decompress the stream prematurely, leading to fatal client-side double decompression errors.
- **Implementation in `server.js`**:
  - Line 54-56: `.bin` and `.gz` both map to `application/octet-stream`.
  - Line 143: `ext = path.extname(filePath).toLowerCase()` evaluates to `.gz` for `.bin.gz`.
  - Lines 184-188: Static stream responds with `Content-Type: application/octet-stream`, `Content-Length`, `Accept-Ranges: bytes`. No `Content-Encoding` header is attached.
  - Lines 126-127: Transparent fallback `/assets/real/roads.bin` -> `/assets/real/roads.bin.gz` serves the compressed binary asset seamlessly.
- **Verification**:
  - Independent adversarial test verified that even when a browser sends `Accept-Encoding: gzip, deflate, br, zstd`, the response contains NO `Content-Encoding` header.
  - The streamed payload matches `assets/real/roads.bin.gz` (5,613,318 bytes) byte-for-byte (`Buffer.compare === 0`).

### 2.2 Audio Range Requests (HTTP 206)
- **Requirement**: Support byte-range streaming for Web Audio API playback of `.mp3`, `.ogg`, and `.wav` assets with RFC 7233 / 9110 compliant partial responses (206) and bounds validation (416).
- **Implementation in `server.js`**:
  - Lines 147-182: Intercepts `Range` header specifically for audio extensions (`.mp3`, `.ogg`, `.wav`).
  - Standard ranges (`bytes=0-99`): returns HTTP 206, `Content-Range: bytes 0-99/183946`, `Content-Length: 100`.
  - Open-ended ranges (`bytes=100-`): returns HTTP 206, `Content-Range: bytes 100-183945/183946`, `Content-Length: 183846`.
  - Suffix ranges (`bytes=-100`): returns HTTP 206, `Content-Range: bytes 183846-183945/183946`, `Content-Length: 100`. Byte slice matches actual disk slice.
  - Oversized suffix ranges (`bytes=-999999`): clamped to entire file length (0 to `stat.size - 1`).
  - Inverted ranges (`bytes=500-200`): returns HTTP 416 with `Content-Range: bytes */183946`.
  - Out-of-bounds ranges (`bytes=500000-600000`): returns HTTP 416 with `Content-Range: bytes */183946`.
  - Single byte requests (`bytes=0-0`): returns HTTP 206, length 1.
  - Non-audio requests with `Range`: ignored, returning full 200 OK.
- **Verification**:
  - Verified across 6 separate adversarial range scenarios; all boundaries clamped and validated accurately.

### 2.3 EADDRINUSE Port Auto-Increment
- **Requirement**: If the default port (3000) or requested port is occupied, automatically increment and retry until an available port is found.
- **Implementation in `server.js`**:
  - Lines 199-223: `server.once('error', (err) => { if (err.code === 'EADDRINUSE') { startServer(port + 1); } })`.
- **Verification**:
  - Verified single collision: port 3991 occupied -> automatically binds 3992.
  - Verified multi-step collision: consecutively blocking ports 49200 and 49201 -> child process increments through both and successfully binds port 49202, serving incoming HTTP traffic without hanging.

### 2.4 Headless Mode
- **Requirement**: Suppress automatic browser launch when running in headless environments, CI pipelines, or background test runners.
- **Implementation in `server.js`**:
  - Line 217: `const noOpen = process.env.NO_OPEN === '1' || process.env.NO_OPEN === 'true' || process.argv.includes('--no-open');`
  - Browser spawning via `exec(...)` is skipped whenever `noOpen` evaluates to true.
- **Verification**:
  - Verified with `--no-open`, `NO_OPEN=1`, and `NO_OPEN=true`.
  - Verified `npm start` executes cleanly with `NO_OPEN=1` and outputs the startup banner without opening a browser window.

---

## 3. Findings & Observations

### [Minor] Finding 1: Static Port Allocation in `tests/server.test.js`
- **Location**: `tests/server.test.js:13, 126`
- **Observation**: Test 5 hardcodes `const conflictPort = 3991` and suite test port `TEST_PORT = 3985`. When multiple test runners or subagents execute concurrently on the same host, both attempt to bind port 3991 simultaneously in `blockerServer.listen(3991)`, leading to transient `EADDRINUSE` errors in test setup.
- **Risk Level**: Minor (only manifests under multi-agent concurrent test execution).
- **Recommendation**: In future milestones or test track, use dynamic ephemeral ports (e.g., binding to port `0` to let the OS assign an unused port) to make concurrent test executions fully isolated.

### [Minor] Finding 2: URL Segment Normalization Before Traversal Check
- **Location**: `server.js:82-94`
- **Observation**: When `req.url` contains `/%2e%2e/package.json`, WHATWG `new URL` normalizes `/%2e%2e/` against root `/`, resulting in `pathname = '/package.json'`. Since `package.json` resides inside `ROOT`, it returns HTTP 200 rather than HTTP 403. However, encoded slash traversal like `/%2e%2e%2fpackage.json` is not normalized by `new URL` and correctly triggers HTTP 403. Files outside `ROOT` remain strictly protected by `safePath` and `isContained` checks.
- **Risk Level**: Low / Informational.
- **Recommendation**: For stylistic consistency, checking `req.url.toLowerCase().includes('%2e')` would reject encoded dot segments at line 90.

---

## 4. Verified Claims Matrix

| Claim | Method | Result |
|---|---|---|
| `node --check server.js` exits 0 with zero syntax errors | `run_command` (`node --check server.js`) | PASS |
| Template literals free of escaped backticks | Automated regex scan in test 1 | PASS |
| Cross-Origin Isolation headers present on all responses | Node test 7 and independent HTTP fetch | PASS |
| `.bin.gz` served as `octet-stream` without `Content-Encoding: gzip` | Node test 10 and independent adversarial test | PASS |
| Transparent `.bin` fallback to `.bin.gz` | Node test 10 and independent adversarial test | PASS |
| Audio Range returns HTTP 206 with accurate byte slices | Node test 12 and 6 adversarial test cases | PASS |
| Inverted & out-of-bounds audio range returns HTTP 416 | Adversarial tests 3, 4, 5 | PASS |
| Single & multi-step EADDRINUSE auto-increment | Node test 5 and independent multi-port test | PASS |
| Headless browser suppression via `NO_OPEN` / `--no-open` | Node test 4 and direct CLI spawn test | PASS |
| Safe URI decoding (HTTP 400 on malformed URI) | Node test 15 and adversarial test | PASS |
| Path containment within ROOT (HTTP 403 on traversal) | Node test 16 and adversarial test | PASS |
| `npm start` execution | Spawn `npm start` with `NO_OPEN=1` | PASS |

---

## 5. Adversarial Stress-Test Results Summary

An independent suite (`.agents/teamwork/reviewer_m1_2/adversarial_test.js`) containing 15 test cases was executed:
- **Total Tests**: 15
- **Passed**: 15 (100%)
- **Failed**: 0
- **Detailed Log**: Saved in `.agents/teamwork/reviewer_m1_2/adversarial_results.json`.

---

## 6. Reviewer Conclusion

Milestone 1 work completed by Worker M1-1 is of high quality, structurally sound, and complies with all project specifications and security requirements. No integrity violations or blocking flaws were detected.

**Final Verdict**: **APPROVE**
