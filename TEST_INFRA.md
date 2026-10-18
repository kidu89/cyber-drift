# Test Infrastructure Documentation (Tiers 1-4)

## 1. Overview & Test Strategy

The Teleoperator Open-World San Francisco Driving Game test infrastructure provides a modular, deterministic, end-to-end (E2E) testing suite verifying all 20 functional and architectural features specified in `ORIGINAL_REQUEST.md` and `PROJECT.md`.

The suite is architected around Node.js native test runner (`node:test`, `node:assert`) with zero external test runtime dependencies, ensuring seamless execution across developer environments, CI pipelines, and headless server environments.

---

## 2. Test Architecture & Directory Layout

```
game fly/
├── TEST_INFRA.md                       # Test infrastructure specification & usage guide
├── TEST_READY.md                       # Test readiness declaration & feature manifest
├── tests/
│   ├── e2e_runner.js                   # Unified CLI test orchestrator & aggregator
│   ├── test_harness.js                 # Sandboxing, mock window facade & HTTP test utilities
│   ├── tier1_server_static.test.js     # Tier 1: Server, headers, MIME types, security (M1)
│   ├── tier2_graphics_atmosphere.test.js# Tier 2: Day/Night, weather, lighting, HUD (M2)
│   ├── tier3_fleet_physics.test.js     # Tier 3: Vehicle fleet, handling physics, garage (M3)
│   ├── tier4_missions_navigation.test.js# Tier 4: GPS, routes, races, pursuit, drift, fares (M4/M5)
│   ├── server.test.js                  # Pre-existing M1 unit test suite
│   └── challenge_stress.js             # M1 stress & edge-case challenger suite
```

---

## 3. Tiered Progressive Testability Model

The suite is stratified into 4 distinct verification tiers aligned with project milestones:

| Tier | Name | Target Milestone | Scope | Feature Count |
|---|---|---|---|---|
| **Tier 1** | Server & Static Asset Integrity | M1 | HTTP 200, COOP/COEP isolation, MIME negotiation, byte-range streaming, path traversal security, 404/416 error handling, critical static file presence | 1 |
| **Tier 2** | Graphics, Atmosphere & Dynamic Effects | M2 | Day/Night progression clock (0-24h), preset interpolation, rain wetness accumulation/drying curves, puddle roughness, auto street/headlights, neon underglow API, tire smoke/skids, exhaust flames, camera shake & HUD blur | 7 |
| **Tier 3** | Vehicle Fleet, Physics & Turntable Garage | M3 | Extended fleet (Police Interceptor, Classic V8 Muscle) in `hs` and `e2`, Arcade vs Simulator handling modes (Pacejka lateral grip curve), Turntable carbon finish and window tinting schema | 3 |
| **Tier 4** | Navigation, Bridges, Missions UI & Persistence | M4, M5 | 3D GPS navigation ribbon, scenic bridge viewpoints, interactive map POIs & fast travel, Activities tab in pause menu, 4 Checkpoint circuits, Police Pursuit Heat 1-5 & cooldown, Drift scoring, VIP fares & comfort rating, results overlay & localStorage persistence | 9 |

---

## 4. Authoritative Specifications & Expected Output Derivation

For every test case across Tiers 1-4, expected values and test assertions are explicitly derived from:
1. `ORIGINAL_REQUEST.md`: Functional requirements R1 (Missions & Gameplay), R2 (Graphics & Atmosphere), R3 (Fleet & Tuning), R4 (Map & Navigation), Acceptance Criteria AC1-AC3.
2. `PROJECT.md`: Architectural contracts (§ M1 Server Contract, § M2 Graphics Contract, § M3 Fleet Contract, § M4 Navigation Contract, § M5 Missions Contract).
3. Mathematical models:
   - Pacejka Magic Formula for lateral tire friction curves.
   - Sun elevation and azimuth spherical coordinate calculations.
   - Parabolic projectile motion for stunt jump trajectories.
   - Ring-buffer memory capping algorithms for persistent skid marks.

---

## 5. Feature Coverage Matrix

| Feature ID | Description | Milestone | Tier | Test File |
|---|---|---|---|---|
| **Feature 1** | Server Execution, Headers, Fallbacks, Range Streaming & Static Integrity | M1 | Tier 1 | `tier1_server_static.test.js` |
| **Feature 2** | Dynamic Day/Night Progression Clock & Presets | M2 | Tier 2 | `tier2_graphics_atmosphere.test.js` |
| **Feature 3** | Dynamic Weather, Wetness & Puddle Reflection Uniforms | M2 | Tier 2 | `tier2_graphics_atmosphere.test.js` |
| **Feature 4** | Street & Vehicle Headlight Auto-Illumination (Night/Rain) | M2 | Tier 2 | `tier2_graphics_atmosphere.test.js` |
| **Feature 5** | Under-Vehicle Neon Glow API & Palette Parsing | M2 | Tier 2 | `tier2_graphics_atmosphere.test.js` |
| **Feature 6** | Tire Smoke Particles & Skid Mark Persistent Ring Buffer | M2 | Tier 2 | `tier2_graphics_atmosphere.test.js` |
| **Feature 7** | Dynamic Exhaust Backfire & Nitro Flame Visualization | M2 | Tier 2 | `tier2_graphics_atmosphere.test.js` |
| **Feature 8** | Speedometer Motion Blur & Impact Camera Shake Dynamics | M2 | Tier 2 | `tier2_graphics_atmosphere.test.js` |
| **Feature 9** | Playable Police Interceptor & Classic V8 Muscle in Fleet Roster | M3 | Tier 3 | `tier3_fleet_physics.test.js` |
| **Feature 10** | Arcade vs Simulator Handling Physics Switcher (Pacejka Model) | M3 | Tier 3 | `tier3_fleet_physics.test.js` |
| **Feature 11** | Turntable Garage Customization: Carbon Finish & Window Tinting | M3 | Tier 3 | `tier3_fleet_physics.test.js` |
| **Feature 12** | Active 3D GPS Guidance Ribbon on Road Surface | M4 | Tier 4 | `tier4_missions_navigation.test.js` |
| **Feature 13** | Extended Bridge Access & Scenic Viewpoints Waypoint Registry | M4 | Tier 4 | `tier4_missions_navigation.test.js` |
| **Feature 14** | Interactive Map POI Badges & Fast Travel Teleportation | M4 | Tier 4 | `tier4_missions_navigation.test.js` |
| **Feature 15** | Checkpoint Races: 4 Urban Circuits, Gates, Countdown & Medals | M5 | Tier 4 | `tier4_missions_navigation.test.js` |
| **Feature 16** | Police Pursuit Heat 1-5 Escalation & Cooldown Zone Mechanics | M5 | Tier 4 | `tier4_missions_navigation.test.js` |
| **Feature 17** | Drift & Stunts: Slip Angle Scoring, Multipliers & Jump Trajectory | M5 | Tier 4 | `tier4_missions_navigation.test.js` |
| **Feature 18** | VIP & Taxi Fares: Beacon Pickup & 5-Star Comfort Rating | M5 | Tier 4 | `tier4_missions_navigation.test.js` |
| **Feature 19** | Pause Menu Activities Tab DOM Integration (#setSide, #setPane) | M5 | Tier 4 | `tier4_missions_navigation.test.js` |
| **Feature 20** | Post-Mission Results Scorecard Overlay & localStorage Persistence | M5 | Tier 4 | `tier4_missions_navigation.test.js` |

---

## 6. How to Run Tests

### Running the Entire E2E Suite (Tiers 1-4)
```bash
node tests/e2e_runner.js
```

### Running a Specific Tier
```bash
node tests/e2e_runner.js --tier=1
node tests/e2e_runner.js --tier=2
node tests/e2e_runner.js --tier=3
node tests/e2e_runner.js --tier=4
```

### Emitting Structured JSON for Automation
```bash
node tests/e2e_runner.js --json
```

### Running Individual Tier Files with Node's Native Test Runner
```bash
node --test tests/tier1_server_static.test.js
node --test tests/tier2_graphics_atmosphere.test.js
node --test tests/tier3_fleet_physics.test.js
node --test tests/tier4_missions_navigation.test.js
```

---

## 7. Sandboxing & Test Harness (`tests/test_harness.js`)

`test_harness.js` provides:
1. **Isolated In-Memory Storage**: Implements `localStorage` API backed by a Map, preventing test state leakage across test runs.
2. **Lightweight Headless DOM**: Fast mock elements with `querySelector`, `classList`, `setAttribute`, and dataset manipulation for validating pause menu integration and UI overlays without heavyweight headless browser overhead.
3. **VM Context Isolation**: Loads and evaluates client scripts (`game_enhancements.js`, `missions_hub.js`) inside isolated V8 execution contexts (`node:vm`).
4. **Deterministic HTTP Requester**: Clean HTTP client setting `Connection: close` and destroying sockets upon response completion to prevent lingering handles.
