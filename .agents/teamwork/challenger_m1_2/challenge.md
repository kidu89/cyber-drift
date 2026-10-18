# Adversarial Challenge Report: server.js

**Challenger**: Challenger M1-2 (`teamwork_preview_challenger`)  
**Target**: `c:\Users\Gabi\Downloads\game fly\server.js`  
**Test Suite**: `.agents/teamwork/challenger_m1_2/fuzz_server.js`  
**Date**: 2026-10-17  
**Verdict**: **APPROVE**

---

## 1. Executive Summary

`server.js` was subjected to an adversarial test battery comprising 84 distinct test cases spanning malformed URI encodings, Unicode boundary conditions, path traversal variations, Windows-specific filesystem attacks, long URL/header payloads, HTTP method permutations, raw TCP socket fuzzing, byte-range boundaries, CORS/COOP/COEP isolation validation, and concurrency stress testing.

All 84 adversarial test cases passed cleanly. The server exhibited zero crashes, zero uncaught exceptions, zero unhandled promise rejections, zero process hangs, and zero out-of-root file disclosures.

---

## 2. Test Battery & Empirical Results

| Test Category | Invocations | Passed | Failed | Status |
|---------------|-------------|--------|--------|--------|
| **1. Malformed URIs & Encodings** | 23 | 23 | 0 | **PASS** |
| **2. Path Traversal & File Boundaries** | 30 | 30 | 0 | **PASS** |
| **3. Boundary Sizes & Stress** | 14 | 14 | 0 | **PASS** |
| **4. HTTP Methods & Protocol Variations** | 10 | 10 | 0 | **PASS** |
| **5. CORS & Security Isolation Headers** | 6 | 6 | 0 | **PASS** |
| **6. Concurrency & Stress (100 parallel reqs)** | 1 | 1 | 0 | **PASS** |
| **TOTAL** | **84** | **84** | **0** | **100% PASS** |

---

## 3. Detailed Vulnerability & Stress Analysis

### 3.1. Malformed URIs & Unicode Boundary Decodes
- **Truncated UTF-8 & Broken Hex**:
  - Payloads: `/%E0%A4%A`, `/%`, `/%%`, `/%ZZ`, `/%2qar`, `/%u0000`, `/test%`, `/foo%gar`.
  - Behavior: `decodeURIComponent(parsedUrl.pathname)` throws `URIError: URI malformed`.
  - Handling: Safely caught in `try/catch` at lines 81-88 of `server.js`. Returns `400 Bad Request: Malformed URI` with Content-Type `text/plain`.
- **Surrogate Halves**:
  - Payloads: Lone high surrogate `/%ED%A0%80` (U+D800), lone low surrogate `/%ED%BF%BF` (U+DFFF).
  - Behavior: Rejected by UTF-8 decoder with `URIError`. Caught and returns `400 Bad Request`.
- **Overlong Encodings & Out-of-Range Codepoints**:
  - Payloads: Overlong slash `/%C0%AF`, `/%E0%80%AF`, `/%F0%80%80%AF`, overlong null `/%C0%80`, invalid lead bytes `/%FF`, `/%FE`, codepoints > U+10FFFF `/%F4%90%80%80`.
  - Behavior: All trigger `400 Bad Request`.
- **Null Byte Handling (`%00`)**:
  - Payloads: `/%00`, `/index.html%00`, `/boot.js%00.png`, `/%00/boot.js`, `/%00/../package.json`.
  - Behavior:
    - In Node.js, `decodeURIComponent('%00')` evaluates to `\0`.
    - Modern Node.js `fs.existsSync` returns `false` without throwing for paths containing null bytes.
    - Because `!fs.existsSync(filePath)` evaluates to `true`, short-circuit logical OR (`||`) prevents `fs.statSync(filePath)` from being invoked on strings with null bytes.
    - Files with extensions like `/index.html%00` and `/boot.js%00.png` return `404 Not Found`.
    - Extensionless paths trigger the SPA routing fallback to `index.html` without crashing.

### 3.2. Path Traversal & Windows Filesystem Boundaries
- **Double-Dot Traversal Variants**:
  - Payloads: `/../package.json`, `/..`, `/../`, `/../../package.json`, `/../../../package.json`, deep traversal (`/../../../../../../../../Windows/win.ini`).
  - Defense Layer 1: Line 90 `if (req.url.includes('..') || pathname.includes('..'))` catches raw and decoded dot-dot sequences, returning `403 Forbidden`.
- **URL-Encoded Slashes & Dots**:
  - Payloads: `/..%2fpackage.json`, `/%2e%2e%2fpackage.json`, `/%2E%2E%2Fpackage.json`.
  - Defense: WHATWG URL parser preserves encoded `%2f`. `decodeURIComponent` decodes `%2e%2e%2f` to `../../`. Line 90 `pathname.includes('..')` triggers and returns `403 Forbidden`.
- **Backslashes on Windows**:
  - Payloads: `/..\\package.json`, `/..%5cpackage.json`, `/%2e%2e%5cpackage.json`.
  - Defense: Detected by `..` checks and returns `403 Forbidden`.
- **Filesystem Root Containment**:
  - Defense Layer 2: Lines 110-118 normalize the resolved path (`safePath = path.normalize(path.join(ROOT, pathname))`) and verify that `safePath.startsWith(rootNorm + path.sep)` or matches `rootNorm`.
  - Payloads: `/C:/Windows/win.ini`, `/C%3A/Windows/win.ini`, `//localhost/c$/Windows/win.ini`.
  - Defense: Normalizes to paths under `ROOT` (e.g. `ROOT\C:\Windows\win.ini`), which do not exist on disk, resulting in clean `404 Not Found`. No out-of-root access is possible.
- **DOS Device Names & NTFS ADS**:
  - Payloads: `/CON`, `/CON.html`, `/AUX.js`, `/NUL.txt`, `/PRN.html`, `/index.html::$DATA`.
  - Defense: Node.js on Windows returns `false` for `fs.existsSync` on DOS devices; device names with extensions return `404 Not Found`. NTFS ADS requests safely map to standard stream or return 404.

### 3.3. Boundary Sizes, Stress, and Concurrency
- **Long URI Paths & Query Strings**:
  - 2,000-character URL path handled cleanly (404/200).
  - 8,000-character query string handled cleanly (200).
  - 64,000-character query string: Node HTTP parser cleanly rejected header overflow (`HPE_HEADER_OVERFLOW`), terminating connection without crashing the server process.
- **Header Stress & Malformed Host**:
  - 8KB custom header handled cleanly.
  - Malformed Host header (`Host: invalid[host]:port`) handled safely without crashing `new URL()`.
  - Missing Host header (HTTP/1.0) gracefully defaults to `localhost`.
- **Audio Byte-Range Stress**:
  - Single-byte range (`bytes=0-0`) returns `206 Partial Content` (1 byte).
  - Suffix range beyond file size (`bytes=-99999999`) clamped to start, returns `206 Partial Content`.
  - Inverted range (`bytes=100-50`) returns `416 Range Not Satisfiable`.
  - Out-of-bounds start (`bytes=99999999-`) returns `416 Range Not Satisfiable`.
  - Malformed ranges (`bytes=abc-def`, `bytes=-`) return `416 Range Not Satisfiable`.
- **Concurrency**:
  - Burst of 100 concurrent asynchronous HTTP requests executed; 100/100 completed with HTTP 200 OK.

### 3.4. Security Isolation & CORS Headers
- All response status codes (`200 OK`, `204 No Content`, `206 Partial Content`, `400 Bad Request`, `403 Forbidden`, `404 Not Found`) consistently emit:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
  - `Cross-Origin-Resource-Policy: cross-origin`
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: GET, HEAD, POST, OPTIONS`
  - `Access-Control-Allow-Headers: *`

---

## 4. Verdict

**APPROVE**

`server.js` satisfies all adversarial boundary criteria, adheres strictly to the M1 server contract, and exhibits resilient error handling across all tested attack surfaces.
