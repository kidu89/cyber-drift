# HTTP RFC Range Compliance & Edge Case Analysis for `server.js`

**Author**: Explorer M1-Iter2-2 (`teamwork_preview_explorer`)  
**Target File**: `c:\Users\Gabi\Downloads\game fly\server.js` (Lines 147–182)  
**Parent Orchestrator**: `d7c1aaca-334c-4557-bb98-f39a48d70c24`  
**Date**: 2026-10-17  
**Artifact Path**: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\explorer_m1_iter2_2\analysis.md`  

---

## 1. Executive Summary

An in-depth investigation into HTTP Range request handling within `server.js` was conducted in accordance with RFC 7233 and RFC 9110 (HTTP Semantics, Section 14). 

The investigation confirmed that while `server.js` correctly delivers HTTP 206 for standard byte ranges (`bytes=0-99`, `bytes=100-`) and HTTP 416 for inverted ranges (`bytes=500-200`), the current parser contains **critical vulnerabilities and RFC compliance deviations**:
1. **Critical Remote Denial of Service (Process Termination)**: Sending a Range header with a numeric start and a non-numeric end (e.g., `Range: bytes=0-abc`, `bytes=10-xyz`, `bytes=0-NaN`, `bytes=0-Infinity`) causes `parseInt` to yield `NaN`. Because JavaScript comparisons with `NaN` evaluate to `false`, `end` remains `NaN` and is passed to `fs.createReadStream(filePath, { start, end: NaN })`. Node.js synchronously throws an unhandled `RangeError [ERR_OUT_OF_RANGE]`, immediately terminating the Node.js server process.
2. **Missing Synchronous Stream Guard**: `fs.createReadStream` is executed without an enclosing `try/catch` block. The asynchronous event listener `file.on('error', ...)` attached on the subsequent line is powerless against synchronous constructor exceptions.
3. **Grammar & Semantics Deviations**:
   - `Range: bytes=abc-10` is misparsed as a suffix byte range (`bytes=-10`), erroneously returning HTTP 206 with the last 10 bytes instead of rejecting the invalid start boundary with HTTP 416.
   - `Range: characters=0-10` and `Range: 0-100` are misparsed and served rather than rejected or ignored.
   - `Range: bytes=0--5` is treated as open-ended `bytes=0-` rather than rejected as malformed.
   - Suffix range `bytes=-0` is handled only via accidental arithmetic on `NaN` rather than explicit RFC validation.

This document provides a comprehensive RFC 9110 mapping, an exhaustive 32-scenario edge case matrix, and a production-grade remediation blueprint for the implementation worker.

---

## 2. HTTP RFC Range Specifications (RFC 7233 & RFC 9110)

RFC 9110 Section 14 governs HTTP Range Requests and Section 15.5.17 defines HTTP 416 (Range Not Satisfiable).

### 2.1 ABNF Grammar (RFC 9110 §14.1.2)

```abnf
Range                   = byte-ranges-specifier / other-ranges-specifier
byte-ranges-specifier   = bytes-unit "=" byte-range-set
bytes-unit              = "bytes"
byte-range-set          = 1#( byte-range-spec / suffix-byte-range-spec )
byte-range-spec         = first-byte-pos "-" [ last-byte-pos ]
first-byte-pos          = 1*DIGIT
last-byte-pos           = 1*DIGIT
suffix-byte-range-spec  = "-" suffix-length
suffix-length           = 1*DIGIT
```

### 2.2 Semantic Requirements & Boundary Constraints

1. **Range Unit Validation (§14.1.1, §14.2)**:
   - The only standard unit is `bytes`.
   - An origin server MUST ignore a `Range` header field that contains a range unit it does not understand (§14.2), or reject invalid syntax (§14.1.2).
2. **Satisfiability & Order (§14.1.2)**:
   - For `first-byte-pos "-" last-byte-pos`:
     - `first-byte-pos <= last-byte-pos` is mandatory. If `first-byte-pos > last-byte-pos`, the range is invalid and the server SHOULD generate HTTP 416.
     - If `first-byte-pos >= complete-length`, the range does not overlap the representation and the server SHOULD generate HTTP 416.
     - If `last-byte-pos >= complete-length`, the byte range is interpreted as extending through the last byte (`complete-length - 1`).
   - For open-ended `first-byte-pos "-"`:
     - Extends through the last byte (`complete-length - 1`).
     - If `first-byte-pos >= complete-length`, it is unsatisfiable and MUST return HTTP 416.
   - For suffix `"-" suffix-length`:
     - Represents the final `suffix-length` bytes of the representation.
     - **RFC Explicit Rule**: "A suffix-byte-range-spec is unsatisfiable if the suffix-length is zero" (§14.1.2) -> MUST return HTTP 416.
     - If `suffix-length >= complete-length`, the entire representation is used (bytes `0` to `complete-length - 1`).
3. **Empty Representation (`stat.size === 0`)**:
   - An empty representation has no satisfiable byte ranges. Any Range request on an empty resource MUST return HTTP 416 with `Content-Range: bytes */0`.
4. **HTTP 416 Response Headers (§14.4, §15.5.17)**:
   - Status: `416 Range Not Satisfiable`.
   - Mandatory header: `Content-Range: bytes */<complete-length>`.
   - Body: Optional diagnostic message or empty.
5. **HTTP 206 Response Headers (§14.4)**:
   - Status: `206 Partial Content`.
   - `Content-Range: bytes <first-byte-pos>-<last-byte-pos>/<complete-length>`.
   - `Content-Length: <chunksize>` (where `chunksize = last-byte-pos - first-byte-pos + 1`).
   - `Accept-Ranges: bytes`.
   - `Content-Type: <media-type>`.
6. **Multiple Ranges (§14.1.2)**:
   - Servers that do not implement `multipart/byteranges` MAY reject multiple ranges with HTTP 416 or ignore the header and serve HTTP 200. Rejecting with HTTP 416 is standard and prevents denial-of-service amplification attacks (e.g., Apache Range Header DoS / CVE-2011-3192).

---

## 3. Code Audit of Current Implementation in `server.js`

### 3.1 Verbatim Code (`server.js:147–182`)

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
168:        file.on('error', () => {
169:            if (!res.headersSent) {
170:                res.writeHead(500, { 'Content-Type': 'text/plain' });
171:                res.end('500 Internal Server Error');
172:            }
173:        });
174:        res.writeHead(206, {
175:            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
176:            'Accept-Ranges': 'bytes',
177:            'Content-Length': chunksize,
178:            'Content-Type': contentType,
179:        });
180:        file.pipe(res);
181:        return;
182:    }
```

### 3.2 Detailed Defect Breakdown

#### Defect 1 [CRITICAL]: Unhandled `NaN` in `end` Parameter Crashes Server (DoS)
- **Input**: `Range: bytes=0-abc`
- **Execution Trace**:
  - `parts = ['0', 'abc']`
  - `start = 0` (valid integer)
  - `end = parseInt('abc', 10)` -> `NaN`
  - Line 152: `isNaN(start)` is `false` (skipped).
  - Line 157: `NaN >= stat.size` evaluates to `false` (skipped).
  - Line 158: `0 > NaN` evaluates to `false` (skipped).
  - Line 166: `chunksize = (NaN - 0) + 1` -> `NaN`.
  - Line 167: `fs.createReadStream(filePath, { start: 0, end: NaN })`
  - In Node.js `node:internal/fs/streams:215:5`, the `ReadStream` constructor checks `isInteger(end)` and synchronously executes:
    `throw new ERR_OUT_OF_RANGE('end', 'an integer', end);`
  - Because line 167 is not inside a `try/catch`, this synchronous exception is uncaught and immediately terminates the Node process with exit code 1.

#### Defect 2 [CRITICAL]: Absence of Synchronous Try/Catch around Stream Creation
- Line 168 registers `file.on('error', ...)`. Event emitters can only notify about asynchronous runtime stream errors. A synchronous exception during stream initialization bypasses all event listeners.

#### Defect 3 [HIGH]: Malformed Start Boundary Misinterpreted as Suffix Range
- **Input**: `Range: bytes=abc-10`
- **Execution Trace**:
  - `parts = ['abc', '10']`
  - `start = parseInt('abc', 10)` -> `NaN`
  - Line 152: `isNaN(start)` is `true`.
  - Line 153 executes: `start = stat.size - (parseInt('10', 10) || 0) = stat.size - 10`.
  - Line 154: `end = stat.size - 1`.
  - Server serves HTTP 206 with the last 10 bytes!
  - **RFC Violation**: `abc-10` is an invalid byte range specifier. A suffix range according to RFC 9110 has no start prefix (`-suffix-length`). An invalid start must return HTTP 416, not be transformed into a suffix range.

#### Defect 4 [HIGH]: Non-`bytes` Range Units Erroneously Executed as Suffix Ranges
- **Input**: `Range: characters=0-10`
- **Execution Trace**:
  - `range.replace(/bytes=/, '')` leaves `'characters=0-10'`.
  - `parts = ['characters=0', '10']`.
  - `start = parseInt('characters=0', 10)` -> `NaN`.
  - Line 152: `isNaN(start)` triggers suffix calculation: `start = stat.size - 10`.
  - Server returns HTTP 206 with the last 10 bytes of audio data.
  - **RFC Violation**: Unsupported range units must either be ignored (returning HTTP 200) or rejected (HTTP 416). They must never be executed as byte slices.

#### Defect 5 [MEDIUM]: Missing Unit Specifier Treated as Valid Range
- **Input**: `Range: 0-100`
- **Execution Trace**:
  - `parts = ['0', '100']`.
  - Parsed as `start = 0, end = 100`.
  - Returns HTTP 206.
  - **RFC Violation**: Missing unit specifier is syntactically invalid.

#### Defect 6 [MEDIUM]: Double Dash & Negative End Boundary Misparsed
- **Input**: `Range: bytes=0--5`
- **Execution Trace**:
  - `parts = ['0', '', '5']`.
  - `parts[1]` is `''` (falsy).
  - Line 151 assigns `end = stat.size - 1`.
  - Server serves the full file as HTTP 206 rather than rejecting the malformed boundary with HTTP 416.

#### Defect 7 [LOW]: Suffix Length 0 Handled Accidentally
- **Input**: `Range: bytes=-0`
- Handled only because `stat.size - 0 = stat.size > stat.size - 1`. It should be explicitly validated per RFC 9110 §14.1.2.

---

## 4. Comprehensive Adversarial & RFC Edge Case Matrix

The following matrix details 32 distinct Range header input patterns, their behavior under the current `server.js`, and their target RFC-compliant behavior:

| # | Range Header Input | RFC 9110 Ref | Current `server.js` Result | Flaw / Risk | Target RFC Behavior | Target Status & Content-Range |
|---|---|---|---|---|---|---|
| 1 | `bytes=0-99` | §14.1.2 | HTTP 206, 100 bytes | None | Serve 100 bytes | `206 Partial Content`, `bytes 0-99/${size}` |
| 2 | `bytes=100-` | §14.1.2 | HTTP 206, 100 to EOF | None | Serve 100 to EOF | `206 Partial Content`, `bytes 100-${size-1}/${size}` |
| 3 | `bytes=-100` | §14.1.2 | HTTP 206, last 100 bytes | None | Serve last 100 bytes | `206 Partial Content`, `bytes ${size-100}-${size-1}/${size}` |
| 4 | `bytes=0-0` | §14.1.2 | HTTP 206, 1 byte | None | Serve first byte | `206 Partial Content`, `bytes 0-0/${size}` |
| 5 | `bytes=${size-1}-${size-1}` | §14.1.2 | HTTP 206, 1 byte | None | Serve last byte | `206 Partial Content`, `bytes ${size-1}-${size-1}/${size}` |
| 6 | `bytes=500-200` (inverted) | §14.1.2 | HTTP 416 | None | Reject inverted | `416 Range Not Satisfiable`, `bytes */${size}` |
| 7 | `bytes=999999-` (start > size) | §15.5.17 | HTTP 416 | None | Reject out of bounds | `416 Range Not Satisfiable`, `bytes */${size}` |
| 8 | `bytes=0-999999` (end > size) | §14.1.2 | HTTP 206, clamped | None | Clamp `end` to `size - 1` | `206 Partial Content`, `bytes 0-${size-1}/${size}` |
| 9 | `bytes=-999999` (suffix > size) | §14.1.2 | HTTP 206, clamped | None | Clamp `start` to 0 | `206 Partial Content`, `bytes 0-${size-1}/${size}` |
| 10 | `bytes=-0` (suffix length 0) | §14.1.2 | HTTP 416 (accidental) | Fragile arithmetic | Explicit RFC rejection | `416 Range Not Satisfiable`, `bytes */${size}` |
| 11 | `bytes=0-abc` | §14.1.2 | **CRASH: RangeError NaN** | **CRITICAL DoS** | Reject malformed end | `416 Range Not Satisfiable`, `bytes */${size}` |
| 12 | `bytes=10-xyz` | §14.1.2 | **CRASH: RangeError NaN** | **CRITICAL DoS** | Reject malformed end | `416 Range Not Satisfiable`, `bytes */${size}` |
| 13 | `bytes=0-NaN` | §14.1.2 | **CRASH: RangeError NaN** | **CRITICAL DoS** | Reject malformed end | `416 Range Not Satisfiable`, `bytes */${size}` |
| 14 | `bytes=0-Infinity` | §14.1.2 | **CRASH: RangeError NaN** | **CRITICAL DoS** | Reject malformed end | `416 Range Not Satisfiable`, `bytes */${size}` |
| 15 | `bytes=abc-10` | §14.1.2 | HTTP 206, last 10 bytes | **Logic Flaw** | Reject malformed start | `416 Range Not Satisfiable`, `bytes */${size}` |
| 16 | `bytes=abc-def` | §14.1.2 | HTTP 416 (accidental) | Fragile arithmetic | Reject malformed | `416 Range Not Satisfiable`, `bytes */${size}` |
| 17 | `bytes=foobar` | §14.1.2 | HTTP 416 (accidental) | Fragile arithmetic | Reject malformed | `416 Range Not Satisfiable`, `bytes */${size}` |
| 18 | `bytes=` (empty range) | §14.1.2 | HTTP 416 (accidental) | Fragile arithmetic | Reject empty | `416 Range Not Satisfiable`, `bytes */${size}` |
| 19 | `bytes=-` (lone dash) | §14.1.2 | HTTP 416 (accidental) | Fragile arithmetic | Reject empty boundaries | `416 Range Not Satisfiable`, `bytes */${size}` |
| 20 | `bytes=--` (double dash) | §14.1.2 | HTTP 416 (accidental) | Fragile arithmetic | Reject malformed | `416 Range Not Satisfiable`, `bytes */${size}` |
| 21 | `bytes=0--5` (negative end) | §14.1.2 | HTTP 206, full file | **Logic Flaw** | Reject negative end | `416 Range Not Satisfiable`, `bytes */${size}` |
| 22 | `bytes=+10-50` (plus sign) | §14.1.2 | HTTP 206, 10-50 | RFC: `1*DIGIT` only | Reject non-digit | `416 Range Not Satisfiable`, `bytes */${size}` |
| 23 | `bytes=1.5-2.5` (float) | §14.1.2 | HTTP 206, 1-2 | RFC: `1*DIGIT` only | Reject non-digit | `416 Range Not Satisfiable`, `bytes */${size}` |
| 24 | `bytes=0x10-0x20` (hex) | §14.1.2 | HTTP 206, 0-0 | RFC: `1*DIGIT` only | Reject non-digit | `416 Range Not Satisfiable`, `bytes */${size}` |
| 25 | `characters=0-10` (bad unit) | §14.2 | HTTP 206, last 10 bytes | **Logic Flaw** | Reject invalid unit | `416 Range Not Satisfiable`, `bytes */${size}` |
| 26 | `0-100` (missing unit) | §14.1.2 | HTTP 206, 0-100 | RFC syntax invalid | Reject missing unit | `416 Range Not Satisfiable`, `bytes */${size}` |
| 27 | `bytes = 0-10` (space around =) | §14.1.2 | HTTP 206, last 10 bytes | Regex failure | Support optional whitespace | `206 Partial Content`, `bytes 0-10/${size}` |
| 28 | `bytes= 0 - 100 ` (spaces) | §14.1.2 | HTTP 206, 0-100 | None | Support optional whitespace | `206 Partial Content`, `bytes 0-100/${size}` |
| 29 | `bytes=0-10, 20-30` (multipart) | §14.1.2 | HTTP 206, 0-10 only | Truncation | Reject multipart with 416 | `416 Range Not Satisfiable`, `bytes */${size}` |
| 30 | `bytes=0-0` on 0-byte file | §14.1.2 | HTTP 416 | None | Return 416 for empty file | `416 Range Not Satisfiable`, `bytes */0` |
| 31 | `bytes=999999999999999999-` | §14.1.2 | HTTP 416 | None | Large integer out of bounds | `416 Range Not Satisfiable`, `bytes */${size}` |
| 32 | `Range: bytes=0-50` on `/style.css` | Contract | HTTP 200, full file | None (Test 12 contract) | Range ignored on non-audio | `200 OK`, `Accept-Ranges: bytes` |

---

## 5. Architectural Remediation Blueprint for Worker

### 5.1 Design Principles
1. **Strict Grammar Conformance**: Use a precise regular expression matching RFC 9110 Section 14.1.2 byte ranges (`bytes=\s*(\d+)?\s*-\s*(\d+)?`).
2. **Deterministic Status Codes**: Any request that fails grammar parsing, specifies an invalid unit, contains non-decimal characters, has `start > end`, specifies `suffix-length === 0`, or exceeds resource boundaries returns **HTTP 416 Range Not Satisfiable** with `Content-Range: bytes */${stat.size}`.
3. **Guaranteed Process Survival**: Wrap `fs.createReadStream` in a synchronous `try/catch` block and validate that `start` and `end` are non-negative safe integers before stream construction.

### 5.2 Recommended Drop-in Replacement for `server.js:147–182`

```javascript
    const range = req.headers.range;
    if (range && (ext === '.mp3' || ext === '.ogg' || ext === '.wav')) {
        // RFC 9110 Section 14.1.2: Range = bytes-unit "=" byte-range-set
        // Matches standard single byte ranges: bytes=<start>-<end>, bytes=<start>-, bytes=-<suffix>
        const rangeMatch = typeof range === 'string' && range.trim().match(/^bytes\s*=\s*(\d+)?\s*-\s*(\d+)?$/);

        // Helper to send RFC 9110 compliant HTTP 416
        const send416 = () => {
            if (!res.headersSent) {
                res.writeHead(416, {
                    'Content-Range': `bytes */${stat.size}`,
                    'Content-Type': contentType
                });
                res.end();
            }
        };

        // Reject malformed syntax, missing both boundaries, or empty files
        if (!rangeMatch || (!rangeMatch[1] && !rangeMatch[2]) || stat.size === 0) {
            send416();
            return;
        }

        let start;
        let end;

        if (rangeMatch[1] === undefined) {
            // Suffix byte range: bytes=-<suffixLength>
            const suffixLength = parseInt(rangeMatch[2], 10);
            if (suffixLength === 0) {
                // RFC 9110 Section 14.1.2: suffix-length 0 is unsatisfiable
                send416();
                return;
            }
            start = suffixLength >= stat.size ? 0 : stat.size - suffixLength;
            end = stat.size - 1;
        } else if (rangeMatch[2] === undefined) {
            // Open-ended byte range: bytes=<start>-
            start = parseInt(rangeMatch[1], 10);
            if (start >= stat.size) {
                send416();
                return;
            }
            end = stat.size - 1;
        } else {
            // Explicit byte range: bytes=<start>-<end>
            start = parseInt(rangeMatch[1], 10);
            end = parseInt(rangeMatch[2], 10);
            if (start > end || start >= stat.size) {
                send416();
                return;
            }
            if (end >= stat.size) {
                end = stat.size - 1;
            }
        }

        // Defensive guard: Ensure start and end are strictly non-negative integers with start <= end
        if (isNaN(start) || isNaN(end) || start < 0 || end < start) {
            send416();
            return;
        }

        const chunksize = (end - start) + 1;
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

        file.on('error', () => {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Internal Server Error');
            }
        });

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

---

## 6. Test Suite Hardening Blueprint (`tests/server.test.js`)

To ensure permanent regression immunity, Test 12 in `tests/server.test.js` should be expanded to cover the adversarial vectors:

```javascript
        // Malformed range boundaries returning HTTP 416 without crashing
        const malformedVectors = [
            'bytes=0-abc',
            'bytes=10-xyz',
            'bytes=0-NaN',
            'bytes=0-Infinity',
            'bytes=abc-10',
            'bytes=-abc',
            'bytes=-0',
            'bytes=0--5',
            'bytes=500-200',
            'bytes=999999-',
            'characters=0-10'
        ];

        for (const malformedHeader of malformedVectors) {
            const malformedRes = await httpRequest({
                hostname: 'localhost',
                port: TEST_PORT,
                path: '/assets/audio/airflow.mp3',
                method: 'GET',
                headers: { 'Range': malformedHeader }
            });
            assert.strictEqual(
                malformedRes.statusCode, 
                416, 
                `Expected 416 for malformed Range header: "${malformedHeader}", received ${malformedRes.statusCode}`
            );
            assert.strictEqual(malformedRes.headers['content-range'], 'bytes */183946');
        }
```
