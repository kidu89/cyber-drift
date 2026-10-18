# Project: Teleoperator Open-World San Francisco Driving Game

## Architecture
The application is a high-performance 3D open-world driving simulator set in San Francisco, built with Three.js (r186) and WebGPU (WGSL shaders and compute pipelines) with Node.js local serving and zero external runtime dependencies.

- **Server & Delivery**: `server.js` serves static assets with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers, byte-range streaming for `.bin.gz` geographic buffers, and automatic port fallback.
- **Client Entry**: `index.html` loads `boot.js` (GPU detection, device tier classification, worker dispatch) and `app.js` (Three.js WebGPU engine, world generator, physics engine, UI manager).
- **Core Facade**: `window.__sf` exposes engine subsystems:
  - `v`: 4-wheel vehicle physics simulation (120 Hz)
  - `car`, `carId`, `swapCar(id)`: active vehicle entity and fleet swapping
  - `police`: heat levels (1-5), pursuit AI, roadblocks, spike strips, helicopter, sirens, cooldown zone
  - `race`: checkpoint race system with countdown, checkpoints, split times, podium medals
  - `skills`: real-time drift points, slip angle, speed scoring, multipliers
  - `stunts`: speed traps, speed zones, drift zones, danger jumps
  - `map`: minimap (`miniC`) and interactive fullscreen vector map (`bigmap`)
  - `tele`: fast travel coordinate teleportation
  - `garage`: 3D turntable studio with paint finishes, calipers, rims, tinting
  - `tuning`: vehicle performance upgrades and driving assists (ABS, TCS, ESP)
  - `setTime`: atmospheric presets (noon, golden, fog, rain, dusk, night)
  - `audio`: Web Audio DSP synthesizer with engine acoustics, sirens, helicopter, radio
- **Modular Extension Layer**:
  - Companion ES modules (`missions_hub.js`, `game_enhancements.js`) and UI extensions in `index.html` interface with `window.__sf` to add features cleanly without breaking core engine internals.
  - State persistence in `localStorage` under `teleop2.guest` and `sf-drive.missions`.

---

## Feature Inventory

Every feature from user requirements and surveys is enumerated and mapped to a milestone:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Server Execution & Port Serving | Fix escaped backticks in `server.js` to serve HTTP 200 with COOP/COEP headers | M1 | Survey |
| 2 | Dynamic Day/Night Progression | Continuous clock progression and smooth atmospheric transitions | M2 | R2 |
| 3 | Dynamic Weather & Road Wetness | Real-time rain accumulation, drying curve, puddle reflections | M2 | R2 |
| 4 | Street & Headlight Illumination | Automatic streetlights and headlight activation at night/rain | M2 | R2 |
| 5 | Under-Vehicle Neon Illumination | Ground-projected neon glow mesh and lighting for vehicles | M2 | R2 |
| 6 | Tire Smoke & Skid Persistence | Enhanced tire smoke and extended skid mark ring buffers | M2 | R2 |
| 7 | Dynamic Exhaust & Nitro Flames | Visual exhaust backfire flames and nitro boost plumes | M2 | R2 |
| 8 | Dynamic Camera & HUD Effects | Speedometer blur, high-speed motion blur, impact camera shake | M2 | R2 |
| 9 | Extended Vehicle Fleet | Addition of playable Police Interceptor and Classic V8 Muscle car | M3 | R3 |
| 10 | Arcade vs Simulator Physics | Driving mode toggle for grip, drift ease, and nitro regeneration | M3 | R3 |
| 11 | Turntable Garage Enhancements | Carbon fiber body finish, window tinting, custom calipers/rims | M3 | R3 |
| 12 | Active 3D GPS Guidance Ribbon | 3D chevrons on road to destination waypoints in manual drive | M4 | R4 |
| 13 | Extended Bridge & Scenic Routes | Golden Gate Bridge & Bay Bridge viewpoints, highway speed routes | M4 | R4 |
| 14 | Interactive Map & Fast Travel | POI garage/mission badges on minimap/big map with click teleport | M4 | R4 |
| 15 | Checkpoint Races (Time Trials) | Timed urban checkpoint circuits with medals, records, ghost/split | M5 | R1 |
| 16 | Police Pursuit & Heat Scenarii | Dynamic Heat 1-5 pursuit, roadblocks, cooldown escape zone | M5 | R1 |
| 17 | Drift & Stunt Events | Drift scoring on Lombard St & Twin Peaks, jump stunt challenges | M5 | R1 |
| 18 | VIP & Taxi Fares Mode | Passenger transport missions contra-cronometru with comfort rating | M5 | R1 |
| 19 | Mission Hub UI & Pause Integration | Dedicated Activities/Missions tab in pause menu with direct launch | M5 | R1 / AC1 |
| 20 | Results Summary & Persistence | Post-mission scorecard (time, score, cash/XP) saved to localStorage | M5 | R1 / AC2 |
| 21 | E2E Test Suite (Tiers 1-4) | Comprehensive test suite verifying all 20 features across 4 tiers | Test Track | Dual Track |
| 22 | Adversarial Hardening (Tier 5) | White-box stress tests, edge cases, and robustness verification | Final M6 | Dual Track |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Server & Dev Infrastructure | Fix syntax errors in `server.js`, verify `npm start` and test runner | none | DONE |
| Test Track | E2E Test Suite & Test Infra | Develop comprehensive opaque-box test runner and Tiers 1-4 test suite | M1 | DONE |
| M2 | Graphics, Atmosphere & Particles | Dynamic Day/Night cycle, rain/wetness shaders, neon underglow, exhaust flames, HUD effects | M1 | DONE |
| M3 | Fleet Expansion, Physics & Garage | Police interceptor & muscle car, Arcade/Simulator physics mode, carbon fiber & window tint in garage | M1 | DONE |
| M4 | Map, Navigation & Bridges | Active 3D GPS road line, bridge vista routes, map POI badges & click-to-teleport | M1 | DONE |
| M5 | Gameplay, Missions & Activities UI | Activities tab in pause menu, checkpoint races, police pursuit challenge, drift events, VIP fares, results summary & localStorage | M2, M3, M4 | DONE |
| M6 | Final Milestone: 100% E2E Pass & Adversarial Hardening | Phase 1: Pass 100% of Tiers 1-4 E2E tests. Phase 2: Tier 5 adversarial test suite hardening | Test Track, M5 | DONE |

---

## Interface Contracts

### M1 Server Contract
- `GET /` -> 200 OK with `index.html`
- Headers:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- Static files served with appropriate MIME types (`.js`, `.css`, `.json`, `.bin.gz`, `.png`, `.jpg`).
- Command: `npm start` starts server on port 3000 (or next free port).

### M2 Graphics & Atmosphere Contract
- `window.__sf.timeOfDay`: Object with `{ time: number (0-24), weather: "clear"|"rain"|"fog", setTime(t), setWeather(w) }`
- `window.__sf.setUnderglow(colorHex, intensity)`: Configures under-chassis neon light and ground illumination.
- Dynamic road shader uniforms: `wet` smoothly scales from 0.0 to 1.0; puddle reflection roughness adapts dynamically.

### M3 Fleet & Physics Contract
- `window.__sf.hs["police"]` and `window.__sf.hs["muscle"]`: Valid vehicle definitions registered in vehicle registry and `e2` roster.
- `window.__sf.setHandlingMode("arcade" | "simulator")`: Configures steering assist, tire slip tolerance, drift initiation assist, and nitro recharge rate.
- Turntable customization schema accepts `f: "carbon"` and `tint: "light" | "medium" | "dark" | "limo"`.

### M4 Navigation & Map Contract
- `window.__sf.setGPSDestination(x, z, label)`: Projects 3D road chevron ribbon (`RaceCarpet`) from player vehicle to target coordinate in manual driving.
- `window.__sf.clearGPS()`: Clears active navigation ribbon.
- Fullscreen map emits fast-travel teleportation when clicking POI markers or coordinates.

### M5 Missions & Gameplay Contract
- Pause menu: `#setSide` has `<button class="tab" data-tab="missions">`, `#setPane` has `<section class="sec" data-sec="missions">`.
- `window.__sf.startMission(missionType, missionId)`: Launches Checkpoint Race, Police Pursuit, Drift Zone, or VIP Fare.
- `window.__sf.showMissionResult(summary)`: Displays overlay with Time, Score, Medals, XP/Cash earned, and updates `localStorage.getItem("sf-drive.missions")`.

---

## Code Layout

- `server.js`: Node.js local HTTP server.
- `index.html`: Main HTML entry point, HUD canvas, pause menu, UI modals.
- `style.css`: Styles for HUD, pause menu, mission UI, minimap, notifications.
- `boot.js`: Device tier detection, WebGPU capability detection, asset preloading.
- `app.js`: Core Three.js WebGPU engine, world, vehicle physics, audio.
- `missions_hub.js`: Missions & Activities subsystem (checkpoint races, police pursuit challenge, drift scoring, VIP fares, scorecards, localStorage persistence).
- `game_enhancements.js`: Companion enhancement module for dynamic day/night lerp, neon underglow, GPS navigation ribbons, and Arcade/Simulator physics.
- `tests/`: Automated E2E test suite (runner and test cases for Tiers 1-5).
- `.agents/teamwork/`: Orchestrator and agent metadata, briefings, logs, and handoffs (NO source code here).
