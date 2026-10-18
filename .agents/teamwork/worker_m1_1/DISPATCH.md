# Worker M1-1 Dispatch: Server Repair & Automated Test Suite

## Mission
Implement the repair of `server.js` according to Explorer and Spec Miner recommendations, add automated test suite `tests/server.test.js`, run build and test commands, and produce a complete handoff report.

## File Ownership
You exclusively own:
- `c:\Users\Gabi\Downloads\game fly\server.js`
- `c:\Users\Gabi\Downloads\game fly\tests\server.test.js`

## Inputs & Specifications
- `ORIGINAL_REQUEST.md`: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\ORIGINAL_REQUEST.md`
- `PROJECT.md`: `c:\Users\Gabi\Downloads\game fly\PROJECT.md`
- `SCOPE.md`: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\sub_orch_m1\SCOPE.md`
- Explorer M1-1 Handoff: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\explorer_m1_1\handoff.md`
- Explorer M1-2 Handoff: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\explorer_m1_2\handoff.md`
- Spec Miner M1-3 Handoff: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\spec_miner_m1_3\handoff.md`
- Reference patch: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\explorer_m1_1\proposed_server.js`

## Requirements
1. Repair the 7 lines with escaped backticks in `server.js` (lines 63, 93, 109, 129, 137, 140, 145) to valid unescaped template literals.
2. Add headless guard for browser opening: suppress browser opening if `process.env.NO_OPEN === "1"` or `process.argv.includes("--no-open")`.
3. Support port configuration via CLI argument (`node server.js 3001`) and `process.env.PORT` before defaulting to 3000, and keep auto-increment on `EADDRINUSE`.
4. Catch `URIError` on malformed URLs (`decodeURIComponent`) and return HTTP 400 Bad Request.
5. Export `{ server, startServer, MIME_TYPES, DEFAULT_PORT }` when required as a module, allowing the test suite to start and stop the server programmatically.
6. Create `tests/server.test.js` testing:
   - Syntax validation (`node --check server.js`)
   - Server startup and HTTP 200 for `/` and static assets
   - COOP (`same-origin`), COEP (`require-corp`), CORP (`cross-origin`), and CORS headers
   - Audio Range requests returning HTTP 206 with `Content-Range`
   - `.bin.gz` served as `application/octet-stream` without `Content-Encoding: gzip`
   - 404 handling
   - Port conflict resolution / fallback
7. Run tests via `node --test tests/server.test.js` and document passing results in your `handoff.md`.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.


## 2026-10-17T18:15:46Z
[Message] timestamp=2026-10-17T18:15:46Z sender=d7c1aaca-334c-4557-bb98-f39a48d70c24 priority=MESSAGE_PRIORITY_HIGH content=You are Worker M1-1 (Archetype: teamwork_preview_worker).
Your working directory is: c:\Users\Gabi\Downloads\game fly\.agents\teamwork\worker_m1_1
Dispatch file: c:\Users\Gabi\Downloads\game fly\.agents\teamwork\worker_m1_1\DISPATCH.md
MANDATORY: Read c:\Users\Gabi\Downloads\game fly\.agents\teamwork\ORIGINAL_REQUEST.md first.
Also read PROJECT.md, SCOPE.md, and the handoffs from Explorer M1-1, Explorer M1-2, and Spec Miner M1-3.
