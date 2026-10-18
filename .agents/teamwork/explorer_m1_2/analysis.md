# Comprehensive Technical Analysis: HTTP Headers, Range Streaming, MIME Types, and Static Asset Delivery in server.js

## 1. Executive Summary

This report delivers a thorough architectural and forensic investigation of `server.js` in the Teleoperator San Francisco WebGPU driving simulation codebase. The local server provides zero-dependency static asset delivery, HTTP header enforcement, audio byte-range streaming, pre-compressed geographic buffer resolution, and mock API simulation. 

Our investigation verified that `server.js` currently fails on startup with a fatal `SyntaxError: Invalid or unexpected token` on line 63 (and 6 subsequent lines) under Node.js v24.1.0 due to escaped backticks in template literals. Beyond the syntax repair, we conducted an exhaustive audit of HTTP security headers (COOP/COEP/CORP/CORS), byte-range streaming mechanics, MIME type resolution, pre-compressed `.bin.gz` handling, static delivery cascades, and security/robustness edge cases. We also formulated an 18-point verification test matrix to guarantee zero regressions during M1 implementation and subsequent milestones.

---

## 2. Forensic Defect Analysis: Syntax Errors in `server.js`

### 2.1 Verbatim Syntax Error
Running `node -c server.js` produces:
```
C:\Users\Gabi\Downloads\game fly\server.js:63
            console.log(\`[Architect] Mocking \${req.method} \${pathname}\`);
                        ^
SyntaxError: Invalid or unexpected token
    at wrapSafe (node:internal/modules/cjs/loader:1666:18)
    at checkSyntax (node:internal/main/check_syntax:76:3)
```

### 2.2 Root Cause and Exhaustive Line Inventory
The root cause is unescaped escape characters (`\`) directly preceding backticks (`` ` ``) and interpolation delimiters (`${...}`) in JavaScript code outside of string literals. A total of 7 lines contain this defect:

| Line # | Current Code in `server.js` | Defect Description | Required Repaired Form |
|---|---|---|---|
| 63 | `console.log(\`[Architect] Mocking \${req.method} \${pathname}\`);` | Escaped backticks & template expression | `console.log(\`[Architect] Mocking ${req.method} ${pathname}\`);` |
| 93 | `res.end(\`404 Not Found: \${pathname}\`);` | Escaped backticks & template expression | `res.end(\`404 Not Found: ${pathname}\`);` |
| 109 | `'Content-Range': \`bytes \${start}-\${end}/\${stat.size}\`,` | Escaped backticks & template expression | `'Content-Range': \`bytes ${start}-${end}/${stat.size}\`,` |
| 129 | `console.log(\`Port \${port} is in use, trying \${port + 1}...\`);` | Escaped backticks & template expression | `console.log(\`Port ${port} is in use, trying ${port + 1}...\`);` |
| 137 | `const gameUrl = \`http://localhost:\${port}\`;` | Escaped backticks & template expression | `const gameUrl = \`http://localhost:${port}\`;` |
| 140 | `console.log(\`  URL: \${gameUrl}\`);` | Escaped backticks & template expression | `console.log(\`  URL: ${gameUrl}\`);` |
| 145 | `exec(\`\${startCmd} \${gameUrl}\`);` | Escaped backticks & template expression | `exec(\`\${startCmd} \${gameUrl}\`);` |

---

## 3. Detailed Inspection of HTTP Headers

### 3.1 Global Response Headers (Lines 44-50)
Every incoming request to `server.js` sets the following mandatory headers before routing:

```javascript
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', '*');
res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
```

#### 3.1.1 Cross-Origin Isolation (`COOP` and `COEP`)
- **Headers**:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- **Architectural Necessity**:
  The Teleoperator game utilizes WebGPU shaders, high-frequency physics threads (120 Hz in `app.js`), and worker pools (`boot.js` lines 119-122 dispatches image texture decoding workers and geometry preparation workers). In modern browsers (Chromium, Firefox, Safari), the following security primitives require **Cross-Origin Isolation** (`window.crossOriginIsolated === true`):
  1. `SharedArrayBuffer` allocation across workers and main thread.
  2. High-precision performance timers (`performance.now()`) with microsecond resolution.
  3. WebAssembly multi-threading support.
  If either `COOP` or `COEP` is omitted or altered, browsers disable `SharedArrayBuffer`, causing worker thread initialization to fail.

#### 3.1.2 Cross-Origin Resource Policy (`CORP`)
- **Header**: `Cross-Origin-Resource-Policy: cross-origin`
- **Architectural Necessity**:
  Because `COEP: require-corp` is enforced, any subresource (such as images, fonts, audio, or geographic buffers) loaded from any domain or local origin would be blocked by the browser unless it explicitly presents a valid CORP header (`cross-origin` or `same-site`). Setting CORP to `cross-origin` ensures that local assets can be loaded inside iframe embeddings (e.g., Mindblown container, preview tools) without triggering CORS/CORP blocking.

#### 3.1.3 CORS Headers
- **Headers**:
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS`
  - `Access-Control-Allow-Headers: *`
- **Architectural Necessity**:
  Enables preflight OPTIONS handling and allows local development tools, test harnesses, and external dev servers to query APIs and stream assets seamlessly.

### 3.2 OPTIONS Preflight Handling (Lines 51-55)
```javascript
if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
}
```
- Returns HTTP 204 No Content with zero body length.
- Preflight requests correctly retain all global headers (`Access-Control-*`, `COOP`, `COEP`, `CORP`).

### 3.3 Status Codes and Headers by Response Type
| Scenario | Status Code | Content-Type | Key Accompanying Headers |
|---|---|---|---|
| Standard File Delivery | 200 OK | From `MIME_TYPES[ext]` | `Content-Length`, `Accept-Ranges: bytes` |
| Range Request (.mp3/.ogg/.wav) | 206 Partial Content | From `MIME_TYPES[ext]` | `Content-Range: bytes S-E/T`, `Content-Length: chunksize`, `Accept-Ranges: bytes` |
| OPTIONS Preflight | 204 No Content | None | `Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS` |
| Mock API Intercept | 200 OK | `application/json; charset=utf-8` | Global COOP/COEP/CORP |
| Missing File with Extension | 404 Not Found | `text/plain` | Global COOP/COEP/CORP |

---

## 4. Detailed Inspection of Range Streaming

### 4.1 Current Implementation (Lines 101-116)
```javascript
const range = req.headers.range;
if (range && (ext === '.mp3' || ext === '.ogg' || ext === '.wav')) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
    });
    file.pipe(res);
    return;
}
```

### 4.2 Analysis: Audio vs. Geographic Buffer Streaming
1. **Audio Streaming**:
   - The project contains 155 `.mp3` audio files in `assets/audio/` (such as `airflow.mp3`, `bay_bed.mp3`, `cop_siren.mp3`, `backfire.mp3`).
   - Modern browsers' HTML5 `<audio>` and Web Audio elements issue Range requests (e.g. `Range: bytes=0-` or `Range: bytes=0-1`) to probe container headers and enable seekable playback.
   - For valid audio ranges (`bytes=0-99`), the server responds with:
     - Status: `206 Partial Content`
     - Header: `Content-Range: bytes 0-99/183946`
     - Header: `Content-Length: 100`
     - Header: `Accept-Ranges: bytes`
     - Body: exactly 100 bytes.
2. **Geographic Buffers (`.bin.gz`) and Non-Audio Assets**:
   - `PROJECT.md` line 6 notes "byte-range streaming for `.bin.gz` geographic buffers".
   - However, in `server.js` line 102, the Range condition is explicitly guarded by:
     `(ext === '.mp3' || ext === '.ogg' || ext === '.wav')`
   - Therefore, a Range header sent on a non-audio file (e.g., `Range: bytes=0-99` on `/style.css` or `/assets/real/roads.bin.gz`) is deliberately passed through to line 118, returning `HTTP 200 OK` with the complete file body.
   - Probing verified this exact behavior in `spec_miner_m1_3/probe.js` line 168:
     `Range header on non-audio file returns 200 OK full content` -> **PASS**.

### 4.3 Range Edge Cases & Parsing Vulnerabilities
Our analysis identified 4 critical edge cases in the current Range parser:
1. **Suffix Byte Ranges (`Range: bytes=-500`)**:
   - HTTP RFC 7233 §2.1 defines `bytes=-500` as requesting the last 500 bytes of the resource.
   - In `server.js`, `range.replace(/bytes=/, '').split('-')` yields `parts = ["", "500"]`.
   - `parseInt("", 10)` returns `NaN`.
   - This causes `start = NaN`, producing `Content-Range: bytes NaN-500/stat.size`, invalid `chunksize = NaN`, and stream instantiation with `{ start: NaN, end: 500 }`.
2. **Unsatisfiable Ranges (`Range: bytes=999999999-`)**:
   - When `start >= stat.size`, RFC 7233 requires HTTP `416 Range Not Satisfiable` with `Content-Range: bytes */stat.size`.
   - In `server.js`, `start` exceeds `end`, resulting in negative `chunksize` and possible stream error.
3. **Malformed Ranges (`Range: bytes=foo-bar` or `Range: invalid`)**:
   - Yields `start = NaN`, causing stream creation failure.
4. **Unhandled Stream Error**:
   - `fs.createReadStream(filePath, { start, end }).pipe(res)` lacks a `.on('error', ...)` handler. If the client abruptly closes the socket or a disk read fails, an unhandled exception could occur.

---

## 5. Detailed Inspection of MIME Types & Content Encoding

### 5.1 Comprehensive MIME Types Table
`server.js` maintains an explicit lookup table of 22 extensions (lines 10-33):

| Extension | Content-Type Header | Usage in Project |
|---|---|---|
| `.html` | `text/html; charset=utf-8` | `index.html`, `seed_storage.html`, SPA routes |
| `.js` | `application/javascript; charset=utf-8` | `app.js`, `boot.js`, `pod.js`, workers |
| `.mjs` | `application/javascript; charset=utf-8` | ES Module scripts |
| `.css` | `text/css; charset=utf-8` | `style.css` (UI, HUD, pause menu) |
| `.json` | `application/json; charset=utf-8` | `tune.json`, `slots.json`, manifest files |
| `.wasm` | `application/wasm` | WebAssembly modules (zero dependencies currently, ready for engine WASM) |
| `.glb` | `model/gltf-binary` | 3D binary vehicle/props models |
| `.gltf` | `model/gltf+json` | 3D JSON descriptor models |
| `.mp3` | `audio/mpeg` | Engine acoustics, sirens, music beds (155 files) |
| `.wav` | `audio/wav` | Uncompressed sound effects |
| `.ogg` | `audio/ogg` | Alternative compressed audio |
| `.webp` | `image/webp` | Title cards, UI icons, texture maps |
| `.png` | `image/png` | UI sprites, icons, fallback textures |
| `.jpg` / `.jpeg` | `image/jpeg` | Vehicle textures, skybox panoramas |
| `.svg` | `image/svg+xml` | Vector UI icons, HUD dials |
| `.ico` | `image/x-icon` | Favicon |
| `.woff` | `font/woff` | Web fonts |
| `.woff2` | `font/woff2` | Modern compressed web fonts |
| `.ttf` | `font/ttf` | TrueType fonts |
| `.bin` | `application/octet-stream` | Raw geographic geometry buffers |
| `.gz` | `application/octet-stream` | Pre-compressed geographic geometry packages |

Default fallback for any unregistered extension: `application/octet-stream`.

### 5.2 The Critical `.bin.gz` DecompressionStream Architecture
A vital architectural discovery was made by inspecting `boot.js` (line 128) and `app.js` (line 4448):

```javascript
// boot.js line 128:
['roads', 'terrain', 'buildings', 'props', 'coast', 'ground', 'green', 'btags']
  .forEach(function (f) { get('assets/real/' + f + '.bin' + (gz ? '.gz' : ''), 'high'); });

// app.js line 4448:
if (globalThis.MB_GZ && /\.(bin|hdr|glb)$/.test(o)) try {
  return await Dl(o + ".gz", {
    priority: t,
    read: s => new Response(s.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
  });
}
```

#### Why `Content-Encoding: gzip` MUST NOT Be Sent:
1. When `boot.js` or `app.js` fetches `roads.bin.gz`, the client code explicitly takes the response body stream and pipes it through `new DecompressionStream("gzip")`.
2. If `server.js` were to include `Content-Encoding: gzip`, the browser's HTTP networking stack would automatically decompress the byte stream during transfer.
3. When the decompressed stream reached JavaScript, `new DecompressionStream("gzip")` would attempt to decompress raw uncompressed binary data, throwing a fatal `TypeError: The input data was not in a valid format` and breaking the entire 3D world generation!
4. Therefore:
   - MIME Type for `.bin.gz` MUST remain `application/octet-stream`.
   - The server MUST serve the raw compressed bytes directly as payload.
   - The server MUST NOT send `Content-Encoding: gzip`.

---

## 6. Detailed Inspection of Static Asset Delivery Cascade

### 6.1 The 6-Stage Resolution Cascade (Lines 70-95)
When a request is received, `server.js` applies a rigorous fallback cascade:

```
[Incoming Request URL]
         │
         ▼
1. Normalize root pathname: '' or '/' -> '/index.html'
         │
         ▼
2. Check primary ROOT path: filePath = path.join(ROOT, pathname)
   Exists & isFile? ──YES──> [Serve filePath (HTTP 200 / 206)]
         │ NO
         ▼
3. Cascade Fallbacks:
   a. Check site_assets: ROOT/site_assets/pathname (isFile) ──YES──> [filePath = siteAssetsPath]
   b. Check pre-gzipped in ROOT: filePath + '.gz' (isFile) ──YES──> [filePath = filePath + '.gz']
   c. Check pre-gzipped in site_assets: siteAssetsPath + '.gz' (isFile) ──YES──> [filePath = siteAssetsPath + '.gz']
   d. Check clean HTML: filePath + '.html' (isFile) ──YES──> [filePath = filePath + '.html']
   e. SPA Fallback: !path.extname(pathname) ──YES──> [filePath = ROOT/index.html]
         │ NO
         ▼
4. Final File Verification:
   Does filePath exist and is NOT a directory?
   ├── YES ──> [Serve file with MIME_TYPES[ext] and Content-Length]
   └── NO  ──> [HTTP 404 Not Found: pathname (text/plain)]
```

### 6.2 Analysis of Resolution Behaviors
1. **Pre-gzipped Binary Transparency**:
   - Request: `GET /assets/real/roads.bin`
   - Disk reality: `assets/real/roads.bin` does NOT exist; only `assets/real/roads.bin.gz` exists (5.61 MB).
   - Behavior: Stage 3b matches `filePath + '.gz'`. It resolves and serves `roads.bin.gz` with `Content-Type: application/octet-stream` and `Content-Length: 5613318`.
2. **Clean HTML Extension Mapping**:
   - Request: `GET /seed_storage`
   - Disk reality: `seed_storage.html` exists in ROOT.
   - Behavior: Stage 3d matches `filePath + '.html'`. It serves `seed_storage.html` with `Content-Type: text/html; charset=utf-8`.
3. **SPA Extensionless Routing**:
   - Request: `GET /activities/races` or `GET /garage`
   - Disk reality: No such file or directory exists, and `path.extname` is empty (`""`).
   - Behavior: Stage 3e matches `!path.extname(pathname)`. It resolves to `ROOT/index.html`, allowing client-side routers to handle deep links.
4. **404 Not Found**:
   - Request: `GET /textures/missing.png`
   - Disk reality: File does not exist, and `path.extname` is `'.png'`.
   - Behavior: Falls through all stages to line 92. Responds with status 404, `Content-Type: text/plain`, and body `404 Not Found: /textures/missing.png`.

### 6.3 Mock API Interception (Lines 60-68)
```javascript
if (pathname.includes('/api/') || pathname.includes('graphql') || pathname.includes('/events')) {
    const match = mockDb.find(call => call.url && call.url.includes(pathname) && call.method === req.method);
    if (match) {
        console.log(`[Architect] Mocking ${req.method} ${pathname}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(match.response));
        return;
    }
}
```
- Loads `mock_api.json` on startup.
- If request path contains `/api/`, `graphql`, or `/events` AND matches an entry by URL substring and HTTP method:
  - Example: `POST /events` matches `https://api.mindblown.ai/events` -> returns HTTP 200 with `{"ok": true, "counted": true}`.
- If no mock rule matches:
  - Example: `GET /events` does not match POST rule -> falls through to static file resolution. Because a static file named `events` exists in ROOT, it serves it with `200 OK`!

### 6.4 Static Asset Delivery Edge Cases & Security Findings
1. **Path Traversal Vulnerability**:
   - Probing revealed: `GET /../../../../Windows/win.ini` and `GET /../package.json` return `200 OK`.
   - Cause: `path.join(ROOT, pathname)` on Windows resolves dot-segments out of `ROOT`.
   - Recommendation: Sanitize `pathname` with `path.normalize` and verify `filePath.startsWith(ROOT)`.
2. **Malformed URI Percent-Encoding Crash Vector**:
   - Line 58 executes: `let pathname = decodeURIComponent(parsedUrl.pathname);` outside any `try/catch`.
   - Sending `GET /%E0%A4%A` causes `decodeURIComponent` to throw an unhandled `URIError: URI malformed`, immediately crashing the Node server process!
   - Recommendation: Wrap `decodeURIComponent` in `try/catch` and return HTTP 400 Bad Request on failure.
3. **Directory Path Resolution**:
   - If a request targets an existing directory without an extension (e.g. `/assets`), `!path.extname('/assets')` is true, so it triggers SPA fallback and serves `index.html`.
   - If a directory has a dot in its name (e.g., `/bundle.v1`), it returns 404.

---

## 7. Formulated Test Criteria Matrix & Regression Prevention

To ensure zero regressions when `server.js` is repaired in M1, the following 18 test criteria MUST be verified:

| Test ID | Category | Request / Input | Expected Status | Expected Headers | Expected Content / Behavior |
|---|---|---|---|---|---|
| **T01** | Syntax | `node -c server.js` | Exit code 0 | N/A | Zero syntax errors, clean compilation |
| **T02** | Startup | `node server.js` (with `PORT=3000`) | Running | N/A | Binds to port 3000 without exception |
| **T03** | Port Fallback | Start on occupied port (e.g. 3000) | Running on 3001 | N/A | `EADDRINUSE` catches and auto-increments port |
| **T04** | Headless Dev | `NO_OPEN=1 node server.js` | Running | N/A | Does not spawn external OS browser window |
| **T05** | Root Delivery | `GET /` | 200 OK | `Content-Type: text/html; charset=utf-8`<br>`COOP: same-origin`<br>`COEP: require-corp` | Returns `index.html` body containing `<title>Teleoperator</title>` |
| **T06** | CORS Preflight | `OPTIONS /` | 204 No Content | `Access-Control-Allow-Origin: *`<br>`Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS` | Empty body (0 bytes) |
| **T07** | ES Module JS | `GET /boot.js` | 200 OK | `Content-Type: application/javascript; charset=utf-8` | Full `boot.js` source code |
| **T08** | Stylesheet | `GET /style.css` | 200 OK | `Content-Type: text/css; charset=utf-8` | Full CSS stylesheet |
| **T09** | JSON Data | `GET /tune.json` | 200 OK | `Content-Type: application/json; charset=utf-8` | Valid JSON payload |
| **T10** | Audio 200 | `GET /assets/audio/airflow.mp3` | 200 OK | `Content-Type: audio/mpeg`<br>`Accept-Ranges: bytes` | Full MP3 binary payload (183,946 bytes) |
| **T11** | Audio Range 206 | `GET /assets/audio/airflow.mp3`<br>`Range: bytes=0-99` | 206 Partial Content | `Content-Range: bytes 0-99/183946`<br>`Content-Length: 100`<br>`Content-Type: audio/mpeg` | Exactly 100 bytes binary slice |
| **T12** | Audio Open Range | `GET /assets/audio/airflow.mp3`<br>`Range: bytes=183000-` | 206 Partial Content | `Content-Range: bytes 183000-183945/183946`<br>`Content-Length: 946` | Exactly 946 bytes to EOF |
| **T13** | Non-Audio Range | `GET /style.css`<br>`Range: bytes=0-99` | 200 OK | `Content-Type: text/css; charset=utf-8`<br>`Accept-Ranges: bytes` | Full 147,498 bytes (Range ignored) |
| **T14** | Pre-gz Transparency | `GET /assets/real/roads.bin` | 200 OK | `Content-Type: application/octet-stream`<br>NO `Content-Encoding: gzip` | Returns `roads.bin.gz` payload (5,613,318 bytes) |
| **T15** | Direct .bin.gz | `GET /assets/real/roads.bin.gz` | 200 OK | `Content-Type: application/octet-stream`<br>NO `Content-Encoding: gzip` | Returns `roads.bin.gz` payload (5,613,318 bytes) |
| **T16** | Clean HTML Ext | `GET /seed_storage` | 200 OK | `Content-Type: text/html; charset=utf-8` | Resolves to `seed_storage.html` |
| **T17** | SPA Route Fallback | `GET /custom/test/route` | 200 OK | `Content-Type: text/html; charset=utf-8` | Resolves to `index.html` |
| **T18** | Missing Asset 404 | `GET /missing_model.glb` | 404 Not Found | `Content-Type: text/plain` | Body contains `404 Not Found: /missing_model.glb` |

---

## 8. White-Box Edge Cases & Hardening Recommendations

For the M1 repair implementation and future Tier 5 adversarial testing, the following edge cases should be monitored and hardened:

1. **Module Exportability**:
   `server.js` currently invokes `startServer(DEFAULT_PORT)` unconditionally at the top level. Adding:
   ```javascript
   if (require.main === module) {
       startServer(DEFAULT_PORT);
   }
   module.exports = { server, startServer, MIME_TYPES };
   ```
   allows automated Node.js test scripts (`node --test`) to import `server`, bind to ephemeral ports (e.g., 3999 or 3100), and close cleanly without port collisions.
2. **Headless Execution Guard**:
   Wrap browser launch in `if (!process.env.NO_OPEN)`:
   ```javascript
   if (!process.env.NO_OPEN) {
       const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
       exec(`${startCmd} ${gameUrl}`);
   }
   ```
3. **URI Error Guard**:
   Wrap `decodeURIComponent` in a `try/catch` to return 400 Bad Request if a malformed URL like `/%E0%A4%A` is requested.
4. **Suffix Byte-Range Calculation**:
   Support `Range: bytes=-N` by parsing `start = Math.max(0, stat.size - parseInt(parts[1], 10))` when `parts[0] === ''` to prevent `NaN` values in `Content-Range`.
5. **Path Traversal Normalization**:
   Ensure `filePath.startsWith(ROOT)` to prevent directory escape.
