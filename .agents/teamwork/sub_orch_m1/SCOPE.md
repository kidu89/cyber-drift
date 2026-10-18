# Scope: Milestone 1 — Server & Dev Infrastructure

## Architecture
The local server (`server.js`) is a zero-external-dependency Node.js HTTP server that serves `index.html`, JavaScript modules (`app.js`, `boot.js`), and binary geographic packages (`.bin.gz`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Server Execution & Port Serving | Fix escaped backticks in `server.js` to serve HTTP 200 with COOP/COEP headers and support `npm start` | M1 | Survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Server Syntax Repair & Verification | Fix 7 lines in `server.js` with escaped backticks, verify with Node test runner and HTTP fetch | none | PLANNED |

## Interface Contracts
### Server Contract
- Serves `http://localhost:3000` (or fallback port)
- Response status 200 for `/` and static files
- Required headers:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- Command `npm start` or `node server.js` executes without SyntaxError.

## Code Layout
- `server.js`: HTTP server to fix.
- `.agents/teamwork/explorer_survey_1/proposed_server.js`: Reference fixed server created during survey.
- `.agents/teamwork/explorer_survey_1/test_server.js`: Verification test suite for server.
