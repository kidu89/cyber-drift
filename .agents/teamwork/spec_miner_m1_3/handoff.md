# Handoff Report: Specification Mining for `server.js`

**Agent**: Spec Miner M1-3 (`teamwork_preview_spec_miner`)  
**Working Directory**: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\spec_miner_m1_3`  
**Handoff Type**: Hard (Task Complete)  
**Target File**: `c:\Users\Gabi\Downloads\game fly\server.js`  
**Analysis File**: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\spec_miner_m1_3\analysis.md`

---

## 1. Observation

Direct observations from codebase inspection, specification documents, and tool executions:

1. **Syntax Failure in `server.js`**:
   Executing `node -c server.js` produces:
   ```
   C:\Users\Gabi\Downloads\game fly\server.js:63
               console.log(\`[Architect] Mocking \${req.method} \${pathname}\`);
                           ^

   SyntaxError: Invalid or unexpected token
       at wrapSafe (node:internal/modules/cjs/loader:1666:18)
       at checkSyntax (node:internal/main/check_syntax:76:3)

   Node.js v24.1.0
   ```
   Direct inspection of `server.js` reveals 7 lines containing escaped backticks (`\``):
   - Line 63: `console.log(\`[Architect] Mocking \${req.method} \${pathname}\`);`
   - Line 93: `res.end(\`404 Not Found: \${pathname}\`);`
   - Line 109: `'Content-Range': \`bytes \${start}-\${end}/\${stat.size}\`,`
   - Line 129: `console.log(\`Port \${port} is in use, trying \${port + 1}...\`);`
   - Line 137: `const gameUrl = \`http://localhost:\${port}\`;`
   - Line 140: `console.log(\`  URL: \${gameUrl}\`);`
   - Line 145: `exec(\`\${startCmd} \${gameUrl}\`);`

2. **Authoritative Interface Specifications**:
   - `PROJECT.md` (lines 6, 74-80):
     - `GET /` -> 200 OK with `index.html`
     - Mandatory headers: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`
     - Static files served with appropriate MIME types (`.js`, `.css`, `.json`, `.bin.gz`, `.png`, `.jpg`)
     - Command: `npm start` starts server on port 3000 (or next free port)
     - Zero external runtime dependencies (native Node.js HTTP)
   - `SCOPE.md` (lines 16-24):
     - Serves `http://localhost:3000` (or fallback port)
     - Response status 200 for `/` and static files
     - Required headers: COOP `same-origin`, COEP `require-corp`
     - Command `npm start` or `node server.js` executes without `SyntaxError`

3. **Runtime Probing Results**:
   - `node -c .agents/teamwork/explorer_survey_1/proposed_server.js` passed with exit code 0.
   - `node --test .agents/teamwork/explorer_survey_1/test_server.js` passed (1 test, 0 failures).
   - Probing the repaired server instance verified:
     - Root `GET /` -> HTTP 200, Content-Type `text/html; charset=utf-8`, COOP `same-origin`, COEP `require-corp`, CORP `cross-origin`, CORS `*`.
     - `OPTIONS /` -> HTTP 204 No Content, empty body, CORS methods `GET, HEAD, POST, OPTIONS`.
     - Static assets (`/boot.js`, `/style.css`, `/tune.json`) -> HTTP 200 with corresponding UTF-8 MIME types.
     - Transparent `.gz` resolution: `GET /assets/real/roads.bin` -> HTTP 200, Content-Type `application/octet-stream`, length 5,613,318 bytes (from `roads.bin.gz`).
     - HTML extension fallback: `GET /seed_storage` -> HTTP 200 (served from `seed_storage.html`).
     - SPA extensionless fallback: `GET /custom/route` -> HTTP 200 with `index.html`.
     - 404 response: `GET /missing_asset.png` -> HTTP 404, Content-Type `text/plain`, body `404 Not Found: /missing_asset.png`.
     - Byte-range streaming: `GET /assets/audio/airflow.mp3` with `Range: bytes=0-99` -> HTTP 206 Partial Content, Content-Range `bytes 0-99/183946`, Content-Length 100.
     - Mock API: `POST /events` -> HTTP 200, Content-Type `application/json; charset=utf-8`, body `{"ok":true,"counted":true}`.
     - Port fallback: When port 3102 was pre-bound, server caught `EADDRINUSE`, printed fallback log, and bound port 3103.

4. **Vulnerabilities & Edge Cases Probed**:
   - **URIError crash**: Sending `GET /%E0%A4%A` caused `decodeURIComponent(parsedUrl.pathname)` to throw an unhandled `URIError: URI malformed`, crashing the Node.js process with `UNCAUGHT EXCEPTION: URIError URI malformed`.
   - **Path Traversal**: `GET /../package.json` and `GET /../../../../Windows/win.ini` returned HTTP 200 and served files outside the project root because `path.join(ROOT, pathname)` lacked containment validation.
   - **CLI Port Arguments**: `server.js` lines 7 only read `process.env.PORT`, ignoring CLI arguments such as `node server.js 8080` or `node server.js --port 8080`.
   - **Headless Browser Launch**: `exec(startCmd)` runs unconditionally in `server.js:145`, which spawns browser windows during automated tests unless guarded by `NO_OPEN` or `--no-open`.
   - **Module Exports**: `server.js` lacks `module.exports` and directly calls `startServer(DEFAULT_PORT)`, preventing test files from importing `server` without immediately binding port 3000 and launching a browser.

---

## 2. Logic Chain

1. From Observation 1, `node -c server.js` fails with a fatal SyntaxError on line 63 due to escaped backticks (`\``). The same defect exists on 6 additional lines (93, 109, 129, 137, 140, 145). Therefore, the server cannot execute until these 7 lines are repaired to standard template literal backticks (SR-SYN-01, SR-SYN-02).
2. From Observation 2, WebGPU and `SharedArrayBuffer` demand cross-origin isolation. If COOP (`same-origin`) or COEP (`require-corp`) headers are omitted or misconfigured, browser engines refuse to initialize WebGPU context. Therefore, setting COOP, COEP, CORP, and CORS headers on all HTTP responses (SR-HDR-01 to SR-HDR-06) is a hard requirement.
3. From Observation 3, the application serves diverse file types: 3D models (`.glb`), shaders, pre-compressed binary geometry (`.bin.gz`), and audio (`.mp3`, `.ogg`, `.wav`). The routing engine must implement a strict fallback hierarchy: direct path -> `site_assets/` -> `.gz` fallback -> `.html` fallback -> SPA `index.html` fallback -> 404 text response (SR-RTE-01 to SR-RTE-05).
4. From Observation 3, audio streaming for engine and ambient sounds relies on HTTP Range requests. When a request includes `Range: bytes=start-end` for audio files, the server must calculate chunk boundaries and respond with HTTP 206 Partial Content (SR-RNG-01 to SR-RNG-03).
5. From Observation 4, `decodeURIComponent` in line 58 throws an uncaught `URIError` when encountering malformed percent encoding. In Node.js, an uncaught exception terminates the process. Therefore, wrapping `decodeURIComponent` in a try-catch block and responding with HTTP 400 Bad Request (SR-ERR-01) is essential for server stability.
6. From Observation 4, `path.join(ROOT, pathname)` resolves relative directory traversals like `/../package.json` outside the root. Enforcing `path.normalize` and verifying that the target starts with `ROOT` (SR-ERR-02) is required to secure the server.
7. From Observation 4, automated testing and CI require running server instances programmatically on arbitrary ports without popping browser windows or colliding with port 3000. Therefore, supporting CLI port arguments (CLI > `process.env.PORT` > 3000), `--no-open` / `NO_OPEN=1`, and exporting `{ server, startServer, MIME_TYPES, DEFAULT_PORT }` when required as a module (SR-CLI-01, SR-CLI-02, SR-CLI-03) is necessary.

---

## 3. Caveats

1. **HTTP/2 and HTTPS**: The specification is strictly for local HTTP/1.1 development over localhost. HTTPS/TLS certificates and HTTP/2 multiplexing are not required for local serving.
2. **Dynamic Write Operations / POST**: Other than `POST /events` mocked via `mock_api.json`, `server.js` is a static asset delivery server; no dynamic file mutation endpoints exist.
3. **Deprecated URL API Warning**: Node.js v24 emitted `DEP0169` deprecation warning regarding `url.parse()`. While functional, replacing `url.parse(req.url)` with `new URL(req.url, 'http://' + req.headers.host)` is recommended for future standards compliance but does not alter the HTTP interface contract.

---

## 4. Conclusion

The specification requirements and acceptance criteria for `server.js` are fully mined, categorized, and documented in `analysis.md`:
- **Core Repairs**: Replace 7 escaped backtick template literals in `server.js`.
- **Interface & Configuration**: Implement port resolution precedence (CLI arg > `process.env.PORT` > 3000), `NO_OPEN` browser guard, and `module.exports` interface for automated testing.
- **Security & Headers**: Ensure COOP (`same-origin`), COEP (`require-corp`), CORP (`cross-origin`), and CORS headers are sent on all responses.
- **Routing & Streaming**: Maintain 6-stage routing hierarchy (direct, site_assets, .gz, .html, SPA index.html, 404), HTTP 206 byte-range audio streaming, and mock API handling.
- **Robustness**: Enforce try-catch around `decodeURIComponent` (HTTP 400), path traversal jail containment (HTTP 403), and stream error handling.
- **Acceptance Test Suite**: 7 executable test suites covering 20 discovered features and 10 edge cases defined in `analysis.md`.

---

## 5. Verification Method

To independently verify all findings and test requirements:

1. **Syntax Check**:
   ```powershell
   node -c server.js
   ```
   *Expected Current*: Fails with `SyntaxError: Invalid or unexpected token` at line 63.  
   *Expected Fixed*: Exits with code 0.

2. **Run Reference Server Test**:
   ```powershell
   node --test .agents/teamwork/explorer_survey_1/test_server.js
   ```
   *Expected*: Passes with 1 test passed, 0 failed.

3. **Inspect Specification Analysis & Test Plan**:
   Inspect `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\spec_miner_m1_3\analysis.md` for:
   - "Features Discovered" table (20 features enumerated)
   - "Edge Cases" table (10 edge cases enumerated)
   - "Comprehensive Acceptance Test Specification" (Suites 1-7 detailed)

4. **Invalidation Conditions**:
   - `server.js` compiles without fixing lines 63, 93, 109, 129, 137, 140, 145.
   - Responses omit `Cross-Origin-Opener-Policy: same-origin` or `Cross-Origin-Embedder-Policy: require-corp`.
   - Port 3000 collision fails to auto-increment to port 3001.
