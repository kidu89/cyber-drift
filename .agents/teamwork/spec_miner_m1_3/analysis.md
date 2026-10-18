# Specification Mining Analysis: `server.js`

**Date**: 2026-10-17  
**Agent**: Spec Miner M1-3 (`teamwork_preview_spec_miner`)  
**Target**: `c:\Users\Gabi\Downloads\game fly\server.js`  
**Authoritative Sources**:
1. `ORIGINAL_REQUEST.md` (System Requirements & Acceptance Criteria)
2. `PROJECT.md` (M1 Architecture, Interface Contracts, Feature Inventory)
3. `SCOPE.md` (`.agents/teamwork/sub_orch_m1/SCOPE.md` — M1 Scope & Deliverables)
4. `server.js` (Reference implementation with survey analysis in `.agents/teamwork/explorer_survey_1/`)
5. Active runtime probes executed against Node.js v24.1.0 runtime.

---

## 1. Specification Overview & System Contract

The local development server (`server.js`) is a zero-external-dependency Node.js HTTP server. It is the delivery backbone for the Teleoperator 3D WebGPU San Francisco driving game.
Because WebGPU, high-precision performance timers, and Web Workers / `SharedArrayBuffer` require a **cross-origin isolated** execution context in modern browsers, `server.js` is strictly required to provide specific Cross-Origin headers (`COOP`, `COEP`, `CORP`), handle pre-compressed binary geographic tiles (`.bin.gz`), serve static assets with accurate MIME types, stream multi-track audio via byte ranges (`HTTP 206`), support SPA routing fallbacks, and manage port contention via auto-fallback.

---

## 2. Detailed Specification Requirements

### 2.1 Syntax Repair & Compilation Contract
- **SR-SYN-01 (Token Validity)**: `server.js` must compile cleanly under `node -c server.js` with exit code 0 and no `SyntaxError`.
- **SR-SYN-02 (Escaped Backtick Elimination)**: 7 syntax defects caused by escaped backticks (`\``) must be replaced with valid template literal syntax:
  - Line 63: `console.log(\`[Architect] Mocking \${req.method} \${pathname}\`);` -> ``console.log(`[Architect] Mocking ${req.method} ${pathname}`);``
  - Line 93: `res.end(\`404 Not Found: \${pathname}\`);` -> ``res.end(`404 Not Found: ${pathname}`);``
  - Line 109: `'Content-Range': \`bytes \${start}-\${end}/\${stat.size}\`,` -> ``'Content-Range': `bytes ${start}-${end}/${stat.size}`,``
  - Line 129: `console.log(\`Port \${port} is in use, trying \${port + 1}...\`);` -> ``console.log(`Port ${port} is in use, trying ${port + 1}...`);``
  - Line 137: `const gameUrl = \`http://localhost:\${port}\`;` -> ``const gameUrl = `http://localhost:${port}`;``
  - Line 140: `console.log(\`  URL: \${gameUrl}\`);` -> ``console.log(`  URL: ${gameUrl}`);``
  - Line 145: `exec(\`\${startCmd} \${gameUrl}\`);` -> ``exec(`${startCmd} ${gameUrl}`);``

### 2.2 CLI Arguments, Environment Variables & Exports
- **SR-CLI-01 (Port Parameter Resolution)**: The listening port must resolve using the following precedence order:
  1. CLI parameter: Positional argument (`node server.js 8080`) or flag (`node server.js --port 8080` / `node server.js -p 8080`).
  2. Environment variable: `process.env.PORT` parsed as base-10 integer.
  3. Default constant: `3000`.
- **SR-CLI-02 (Browser Launch Control)**: The server opens the default browser using the platform command (`start`, `open`, or `xdg-open`) unless suppressed via `process.env.NO_OPEN` or CLI flag `--no-open`.
- **SR-CLI-03 (Modular Export)**: The module must support being required/imported without side effects:
  - If `require.main === module`, it invokes `startServer(DEFAULT_PORT)`.
  - It exports `{ server, startServer, MIME_TYPES, DEFAULT_PORT }` so automated test suites can programmatically bind and close test instances.

### 2.3 Port Fallback & Lifecycle Management
- **SR-NET-01 (EADDRINUSE Fallback)**: If `server.listen(port)` encounters an `EADDRINUSE` error:
  - It must log `Port ${port} is in use, trying ${port + 1}...` to stdout.
  - It must re-attempt listening on `port + 1`.
  - It must chain recursively until an open port is bound.
- **SR-NET-02 (Non-EADDRINUSE Errors)**: Any other socket error (e.g., `EACCES`) must be caught and logged via `console.error('Server error:', err)` without unhandled rejection or unhandled error event.

### 2.4 Mandatory Security & Cross-Origin Headers
On **every** response (including 200, 204, 206, 400, 404, and mock endpoints), the following headers MUST be set:
- **SR-HDR-01 (COOP)**: `Cross-Origin-Opener-Policy: same-origin`
- **SR-HDR-02 (COEP)**: `Cross-Origin-Embedder-Policy: require-corp`
- **SR-HDR-03 (CORP)**: `Cross-Origin-Resource-Policy: cross-origin`
- **SR-HDR-04 (CORS Origin)**: `Access-Control-Allow-Origin: *`
- **SR-HDR-05 (CORS Methods)**: `Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS`
- **SR-HDR-06 (CORS Headers)**: `Access-Control-Allow-Headers: *`

### 2.5 HTTP Status Codes & Routing Resolution
- **SR-RTE-01 (OPTIONS Preflight)**: Any request with method `OPTIONS` must immediately respond with status **204 No Content**, empty body, and all CORS/COOP/COEP headers.
- **SR-RTE-02 (Root Path Rewrite)**: `GET /` and `GET ""` must resolve to `index.html`.
- **SR-RTE-03 (Static Asset Resolution Hierarchy)**: For a given `pathname`:
  1. Direct file: `path.join(ROOT, pathname)` if it exists and is not a directory.
  2. Site assets fallback: `path.join(ROOT, 'site_assets', pathname)` if exists and is not a directory.
  3. Pre-gzipped buffer fallback: `filePath + '.gz'` if it exists (e.g. `/assets/real/roads.bin` -> serves `roads.bin.gz`).
  4. Site assets pre-gzipped: `siteAssetsPath + '.gz'` if it exists.
  5. HTML extension fallback: `filePath + '.html'` if it exists (e.g. `/seed_storage` -> serves `seed_storage.html`).
  6. SPA extensionless fallback: If `!path.extname(pathname)`, resolve to `path.join(ROOT, 'index.html')`.
- **SR-RTE-04 (200 OK Static Response)**: When a file is found, respond with **200 OK**, `Content-Type: <MIME>`, `Content-Length: <size>`, `Accept-Ranges: bytes`, and stream file body via `fs.createReadStream(filePath).pipe(res)`.
- **SR-RTE-05 (404 Not Found)**: If no file is resolved after all fallbacks, respond with **404 Not Found**, `Content-Type: text/plain`, body `404 Not Found: ${pathname}`.

### 2.6 Audio Byte-Range Streaming (HTTP 206)
- **SR-RNG-01 (Trigger Condition)**: An incoming request contains a `Range` header AND the requested file extension is `.mp3`, `.ogg`, or `.wav`.
- **SR-RNG-02 (206 Response)**: The server responds with status **206 Partial Content**.
- **SR-RNG-03 (Range Headers)**:
  - `Content-Range: bytes ${start}-${end}/${stat.size}`
  - `Accept-Ranges: bytes`
  - `Content-Length: (end - start) + 1`
  - `Content-Type: <audio MIME>`
- **SR-RNG-04 (Non-Audio Range Requests)**: Requests with a `Range` header for non-audio files (e.g. CSS, JS) must return **200 OK** with full file content and `Accept-Ranges: bytes`.

### 2.7 Mock API & Telemetry Engine
- **SR-MCK-01 (Trigger Criteria)**: If `pathname.includes('/api/') || pathname.includes('graphql') || pathname.includes('/events')`:
  - Check `mockDb` (loaded from `ROOT/mock_api.json` at startup).
  - Find first item matching `call.url && call.url.includes(pathname) && call.method === req.method`.
- **SR-MCK-02 (Mock Response)**: If matched:
  - Log `[Architect] Mocking ${req.method} ${pathname}` to stdout.
  - Return status **200 OK**, `Content-Type: application/json; charset=utf-8`.
  - Body: `JSON.stringify(match.response)`.
- **SR-MCK-03 (Mock Fallthrough)**: If no mock entry matches, fall through to normal static file resolution (e.g. `GET /events` falls through to static file `ROOT/events`).

### 2.8 Graceful Error Handling & Hardening
- **SR-ERR-01 (Malformed URI Decoding)**: `decodeURIComponent(parsedUrl.pathname)` can throw `URIError: URI malformed` on inputs like `/%E0%A4%A`. The server must catch this error and return **400 Bad Request** (`Content-Type: text/plain`), preventing unhandled exception crashes.
- **SR-ERR-02 (Path Traversal Protection)**: Path inputs containing directory traversal (`/../package.json` or `/../../../../Windows/win.ini`) must be normalized and contained within `ROOT`. Paths escaping `ROOT` must return **403 Forbidden** or **404 Not Found**.
- **SR-ERR-03 (Read Stream Error Handling)**: Attach error handlers to read streams (`file.on('error', ...)`) to gracefully catch I/O errors and prevent uncaught process termination.

---

## 3. MIME Types Matrix

| Extension | MIME Type | Notes |
|-----------|-----------|-------|
| `.html` | `text/html; charset=utf-8` | SPA & document root |
| `.js` | `application/javascript; charset=utf-8` | ES modules & classic scripts |
| `.mjs` | `application/javascript; charset=utf-8` | ES modules |
| `.css` | `text/css; charset=utf-8` | Stylesheets |
| `.json` | `application/json; charset=utf-8` | Manifests & configs |
| `.wasm` | `application/wasm` | WebAssembly modules |
| `.glb` | `model/gltf-binary` | Binary 3D vehicle/city models |
| `.gltf` | `model/gltf+json` | JSON 3D scene descriptors |
| `.mp3` | `audio/mpeg` | Engine audio & sirens (supports 206) |
| `.wav` | `audio/wav` | Sound effects (supports 206) |
| `.ogg` | `audio/ogg` | Ambient sound (supports 206) |
| `.webp` | `image/webp` | UI textures & icons |
| `.png` | `image/png` | Textures |
| `.jpg` | `image/jpeg` | Textures |
| `.jpeg` | `image/jpeg` | Textures |
| `.svg` | `image/svg+xml` | Vector graphics |
| `.ico` | `image/x-icon` | Favicon |
| `.woff` | `font/woff` | Web fonts |
| `.woff2` | `font/woff2` | Web fonts |
| `.ttf` | `font/ttf` | Web fonts |
| `.bin` | `application/octet-stream` | Binary geographic data |
| `.gz` | `application/octet-stream` | Compressed binary data |
| `*` (other) | `application/octet-stream` | Default binary fallback |

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Syntax & Execution | Syntax Compilation | Unescaped template literal backticks in server.js | `node -c server.js` | Exit code 0 | Exits code 1 with `SyntaxError: Invalid or unexpected token` if unpatched | Static inspection & `node -c` |
| 2 | Networking | Port Resolution Precedence | CLI argument > `process.env.PORT` > `3000` | CLI arg `8080`, `PORT=4000`, or none | Binds specified port or 3000 | Falls back to default if invalid | Code review & CLI spec |
| 3 | Networking | Port Fallback on EADDRINUSE | Incrementally retries `port + 1` when port is bound | Occupied port 3000 | Binds 3001; logs `Port 3000 is in use, trying 3001...` | Catches EADDRINUSE in `server.once('error')` | `server.js:127-134` & probe |
| 4 | Security Headers | Cross-Origin-Opener-Policy | Isolation header for WebGPU / SharedArrayBuffer | Any HTTP request | `Cross-Origin-Opener-Policy: same-origin` | Always set on all responses | `server.js:47`, PROJECT.md:6 |
| 5 | Security Headers | Cross-Origin-Embedder-Policy | Isolation header for WebGPU / SharedArrayBuffer | Any HTTP request | `Cross-Origin-Embedder-Policy: require-corp` | Always set on all responses | `server.js:48`, PROJECT.md:6 |
| 6 | Security Headers | Cross-Origin-Resource-Policy | Enables cross-origin resource sharing | Any HTTP request | `Cross-Origin-Resource-Policy: cross-origin` | Always set on all responses | `server.js:49` |
| 7 | CORS | Permissive CORS Headers | Allows local development from arbitrary origins | Any HTTP request | `Access-Control-Allow-Origin: *`, `Methods`, `Headers` | Present even on error responses | `server.js:44-46` |
| 8 | Routing | OPTIONS Preflight | Responds immediately to OPTIONS preflight | `OPTIONS /any/path` | HTTP 204 No Content, empty body, CORS headers | None | `server.js:51-55` |
| 9 | Routing | Document Root Rewrite | Maps root path to index.html | `GET /` or `GET ""` | HTTP 200 with `index.html` content | 404 if index.html missing | `server.js:70-72` |
| 10 | Routing | Static Asset Direct Serving | Serves files relative to project root | `GET /boot.js`, `GET /style.css` | HTTP 200 with exact MIME type and file body | Falls to site_assets / fallbacks | `server.js:74-76` |
| 11 | Routing | Site Assets Fallback | Searches `site_assets/` subdirectory if root file missing | `GET /assets/...` | HTTP 200 with asset from `site_assets/` | Proceeds to `.gz` fallback | `server.js:77-79` |
| 12 | Compression | Transparent .gz Fallback | Serves pre-compressed file when uncompressed requested | `GET /assets/real/roads.bin` | HTTP 200 with `roads.bin.gz` content | Proceeds to `.html` fallback | `server.js:80-83` & probe |
| 13 | Routing | HTML Extension Fallback | Appends `.html` when file without ext exists | `GET /seed_storage` | HTTP 200 with `seed_storage.html` | Proceeds to SPA fallback | `server.js:84-85` & probe |
| 14 | Routing | SPA Extensionless Route Fallback | Rewrites routes without extensions to `index.html` | `GET /custom/route` | HTTP 200 with `index.html` content | None | `server.js:86-88` & probe |
| 15 | Status Codes | 404 Not Found Response | Returns 404 when file with extension does not exist | `GET /missing.xyz` | HTTP 404, `Content-Type: text/plain`, body `404 Not Found: ...` | Returns 404 | `server.js:91-95` & probe |
| 16 | Audio Streaming | Byte-Range Partial Content (206) | Serves requested byte slices of audio files | `GET /assets/audio/airflow.mp3` with `Range: bytes=0-99` | HTTP 206, `Content-Range: bytes 0-99/183946`, `Content-Length: 100` | Serves 200 if Range omitted | `server.js:101-116` & probe |
| 17 | Audio Streaming | Non-Audio Range Handling | Non-audio files ignore Range header for 206 | `GET /style.css` with `Range: bytes=0-99` | HTTP 200 with full file content and `Accept-Ranges: bytes` | None | `server.js:102` & probe |
| 18 | Mock API | Telemetry & API Interception | Matches requests against `mock_api.json` | `POST /events` | HTTP 200, `application/json`, body from mockDb | Falls through to static file if unmatched | `server.js:60-68` & probe |
| 19 | Automation | Browser Auto-Open | Launches browser via OS command on startup | `startServer()` invoked | Runs `start`, `open`, or `xdg-open` | Suppressed when `NO_OPEN=1` or `--no-open` | `server.js:144-146` |
| 20 | Packaging | Modular Export Interface | Exports server and startServer for testing | `const { server } = require('./server.js')` | Object with `server`, `startServer`, `MIME_TYPES` | Doesn't bind port on require | `proposed_server.js:151-155` |

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Path Resolution | `GET /../package.json` | `path.join(ROOT, pathname)` resolves to `package.json` and serves it (200 OK). Server lacks directory jail check. Needs path normalization check to ensure target resides within `ROOT`. |
| 2 | Path Resolution | `GET /../../../../Windows/win.ini` | On Windows, escapes ROOT and serves system file if exists (200 OK). Critical security hardening requirement: restrict to `ROOT`. |
| 3 | URI Decoding | `GET /%E0%A4%A` (malformed percent encoding) | `decodeURIComponent` throws unhandled `URIError: URI malformed`, terminating the Node.js process with exit code 1. Must be wrapped in try/catch to return HTTP 400 Bad Request. |
| 4 | Reserved Device Names | `GET /CON`, `GET /aux` (Windows reserved devices) | Since `path.extname('/CON')` is empty, triggers SPA fallback and serves `index.html` (200 OK). If requested with extension like `GET /CON.txt`, Windows filesystem throws error on open. |
| 5 | Port Contention | Ports 3000, 3001 occupied | Server catches `EADDRINUSE`, prints `Port 3000 is in use, trying 3001...`, prints `Port 3001 is in use, trying 3002...`, successfully binds port 3002. |
| 6 | Range Header Formatting | `Range: bytes=0-` (open-ended range) | In `server.js`: `parts[1] ? parseInt(parts[1], 10) : stat.size - 1` correctly evaluates `end = stat.size - 1`, streaming bytes from 0 to EOF (206 Partial Content). |
| 7 | Range Header on Audio | `Range: bytes=100-50` (invalid inverted range) | `(end - start) + 1` produces negative chunksize (-49), `fs.createReadStream` receives `{ start: 100, end: 50 }` causing empty/error stream. Should validate `start <= end`. |
| 8 | Headless CI Execution | `node server.js` in CI/testing | `exec(startCmd)` attempts to launch a GUI browser window, which can fail or hang headless test agents. Requires `NO_OPEN=1` or `--no-open` guard. |
| 9 | Direct .bin.gz vs .bin | `GET /assets/real/roads.bin` vs `GET /assets/real/roads.bin.gz` | Both return HTTP 200 with identical byte content and `application/octet-stream` Content-Type. Direct `.bin.gz` hits filesystem directly; `.bin` triggers `.gz` fallback. |
| 10 | Unmocked API path | `GET /api/nonexistent` | Matches `pathname.includes('/api/')` but finds no match in `mockDb`. Falls through to static file resolution, producing `404 Not Found: /api/nonexistent`. |

---

## 4. Comprehensive Acceptance Test Specification

The test suite must be executable with `node --test` (standard Node.js built-in test runner, zero extra dependencies).

### Suite 1: Syntax & Compilation (`test_syntax.js`)
- **T1.1**: Run `node -c server.js`. Assert process exit code is `0` and stderr is empty.
- **T1.2**: Verify no escaped backticks exist in `server.js` using regex `/\\`/g`.

### Suite 2: Security & Cross-Origin Headers (`test_headers.js`)
- **T2.1**: Send `GET /`. Assert:
  - `status === 200`
  - `headers['cross-origin-opener-policy'] === 'same-origin'`
  - `headers['cross-origin-embedder-policy'] === 'require-corp'`
  - `headers['cross-origin-resource-policy'] === 'cross-origin'`
  - `headers['access-control-allow-origin'] === '*'`
- **T2.2**: Send `OPTIONS /`. Assert:
  - `status === 204`
  - Body is empty
  - `headers['access-control-allow-methods'] === 'GET, HEAD, POST, OPTIONS'`
  - `headers['cross-origin-opener-policy'] === 'same-origin'`
  - `headers['cross-origin-embedder-policy'] === 'require-corp'`
- **T2.3**: Send `GET /missing_file.xyz` (404). Assert:
  - `headers['cross-origin-opener-policy'] === 'same-origin'`
  - `headers['cross-origin-embedder-policy'] === 'require-corp'`

### Suite 3: Static Asset Resolution & MIME Types (`test_static.js`)
- **T3.1**: Request `GET /boot.js` -> Status 200, Content-Type `application/javascript; charset=utf-8`.
- **T3.2**: Request `GET /style.css` -> Status 200, Content-Type `text/css; charset=utf-8`.
- **T3.3**: Request `GET /tune.json` -> Status 200, Content-Type `application/json; charset=utf-8`.
- **T3.4**: Request `GET /icon.webp` -> Status 200, Content-Type `image/webp`.
- **T3.5**: Request `GET /assets/real/roads.bin` -> Status 200, Content-Type `application/octet-stream` (served via `.gz` transparent fallback).
- **T3.6**: Request `GET /assets/real/roads.bin.gz` -> Status 200, Content-Type `application/octet-stream`.
- **T3.7**: Request `GET /seed_storage` -> Status 200, Content-Type `text/html; charset=utf-8` (served via `.html` fallback).
- **T3.8**: Request `GET /spa/unknown/route` -> Status 200, Content-Type `text/html; charset=utf-8`, body contains `<title>Teleoperator</title>`.
- **T3.9**: Request `GET /nonexistent.png` -> Status 404, Content-Type `text/plain`, body equals `404 Not Found: /nonexistent.png`.

### Suite 4: Byte-Range Audio Streaming (`test_audio_range.js`)
- **T4.1**: Request `GET /assets/audio/airflow.mp3` with `Range: bytes=0-99`. Assert:
  - Status is 206
  - `headers['content-range'] === 'bytes 0-99/183946'`
  - `headers['content-length'] === '100'`
  - `headers['accept-ranges'] === 'bytes'`
  - `headers['content-type'] === 'audio/mpeg'`
  - Received body length is exactly 100 bytes.
- **T4.2**: Request `GET /assets/audio/airflow.mp3` with `Range: bytes=100-`. Assert:
  - Status is 206
  - `headers['content-range'] === 'bytes 100-183945/183946'`
  - `headers['content-length'] === '183846'`
- **T4.3**: Request `GET /style.css` with `Range: bytes=0-50`. Assert:
  - Status is 200 (full content, not 206).

### Suite 5: Mock API Interception (`test_mock_api.js`)
- **T5.1**: Send `POST /events` with body `{}`. Assert:
  - Status is 200
  - `headers['content-type'] === 'application/json; charset=utf-8'`
  - JSON parsed body deep equals `{"ok": true, "counted": true}`.
- **T5.2**: Send `GET /events`. Assert:
  - Falls through to static file `ROOT/events`, returns status 200 with static file content.

### Suite 6: Port Fallback & Networking (`test_port_fallback.js`)
- **T6.1**: Pre-occupy port `3150` with a temporary HTTP server.
- **T6.2**: Invoke `startServer(3150)`.
- **T6.3**: Assert `startServer` catches `EADDRINUSE` and successfully listens on port `3151`.
- **T6.4**: Send `GET http://localhost:3151/` and verify HTTP 200 response.
- **T6.5**: Clean up and close both test servers.

### Suite 7: Graceful Error Handling & Hardening (`test_error_handling.js`)
- **T7.1 (Malformed URI)**: Send raw socket request `GET /%E0%A4%A HTTP/1.1`. Assert server responds with HTTP 400 Bad Request and does not crash.
- **T7.2 (Path Traversal)**: Send `GET /../package.json` and `GET /../../../../Windows/win.ini`. Assert server does not leak files outside `ROOT` (returns 403 Forbidden or 404 Not Found).
- **T7.3 (Modular Require)**: Require `server.js` from a script. Assert that no port is opened and no browser is launched on require.

---

## 5. Architectural Recommendations for Implementation

1. **Patch Syntax Errors**: Apply the 7 line replacements in `server.js`.
2. **Add CLI & Port Arguments Support**:
   ```javascript
   const args = process.argv.slice(2);
   let portArg = null;
   for (let i = 0; i < args.length; i++) {
       if (args[i] === '--port' || args[i] === '-p') {
           portArg = parseInt(args[i + 1], 10);
           i++;
       } else if (!isNaN(parseInt(args[i], 10))) {
           portArg = parseInt(args[i], 10);
       }
   }
   const DEFAULT_PORT = portArg || (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);
   ```
3. **Wrap URI Decoding in try-catch**:
   ```javascript
   let pathname;
   try {
       pathname = decodeURIComponent(parsedUrl.pathname);
   } catch (err) {
       res.writeHead(400, { 'Content-Type': 'text/plain' });
       res.end('400 Bad Request: Malformed URI');
       return;
   }
   ```
4. **Path Traversal Jail Check**:
   ```javascript
   const safePath = path.normalize(path.join(ROOT, pathname));
   if (!safePath.startsWith(ROOT)) {
       res.writeHead(403, { 'Content-Type': 'text/plain' });
       res.end('403 Forbidden');
       return;
   }
   ```
5. **Support NO_OPEN & Module Export**:
   ```javascript
   if (!process.env.NO_OPEN && !process.argv.includes('--no-open')) {
       const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
       exec(`${startCmd} ${gameUrl}`);
   }

   if (require.main === module) {
       startServer(DEFAULT_PORT);
   }

   module.exports = { server, startServer, MIME_TYPES, DEFAULT_PORT };
   ```
