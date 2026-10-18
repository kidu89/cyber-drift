# Handoff Report: Explorer 3 Survey (Vehicles, Physics, Gameplay, Missions, UI & Persistence)

## 1. Observation
- **Vehicle Fleet**:
  - `app.js` (line 12880): `var hs = { waymo: { ... }, cybercab: { ... } };` defines 7 vehicles: `waymo`, `cybercab`, `ferrari` (458 Spider), `corvette` (ZR1X), `cybertruck`, `roadster` (SpaceX package with cold gas thrusters and fans), and `missions` (Porsche Mission S).
  - `e2 = ["waymo", "cybercab", "ferrari", "corvette", "cybertruck", "roadster", "missions"]` defines the unlocked vehicle roster.
  - No playable police interceptor vehicle or classic muscle car is defined in `hs` or `e2`.
- **Vehicle Physics**:
  - `app.js` (line 12880): Class `qx` simulates vehicle dynamics including chassis inertia, Pacejka slip formula `fF(o, 13, 1.45, 0.2)`, tire friction `mu` and `rearGrip`, weight transfer pitch and roll, transmission automatic vs manual with realistic gear ratios, nitro consumption and refill, and assists: ABS, TCS, ESP, and Steering Helper.
  - Grep search for `"simulator"` returned 0 results in `app.js`. No overarching "Arcade" vs "Simulator" preset exists.
- **Garage & Customization**:
  - `app.js` (line 3189245): Class `Iz` (`GarageStudio`) creates an interactive 3D turntable studio with rotating table, ceiling and perimeter light tubes, shadow contact pool, and custom post-processing.
  - `kp = [{ id: "gloss", ... }, { id: "metallic", ... }, { id: "pearl", ... }, { id: "satin", ... }, { id: "matte", ... }, { id: "chrome", ... }, { id: "candy", ... }]` specifies body paint finishes.
  - Customization object schema is `{ c: hexColor, f: finishKey, cal: calColor, rim: rimColor, w: wrapData }`.
  - No window tint or carbon fiber finish exists in the garage data model or UI.
- **Gameplay & Missions**:
  - `app.js` (line 13139): Class `sE` (`qn = window.__sf.race`) implements checkpoint races with lit checkpoint gates, 3-2-1 lights countdown, reaction bonus, bot racers, off-track resets, and podium medal rewards.
  - `app.js` (line 13167): Class `gE` (`vo = window.__sf.police`) implements Heat 1-5 pursuits, patrol pursuit AI, roadblocks, spike strips, helicopter tracking, evasion cooldown timer ("Hiding · Xs"), and bust sequence with fines.
  - `app.js` (line 3622150): Class `vE` implements Speed Traps (`trap`), Speed Zones (`zone`), Drift Zones (`drift`), and Danger Signs (`jump`). Real-time drift points formula: `fMt = o => (o.onGround !== !1 && o.kmh > 25 && Math.abs(o.beta || 0) * 57.2958 > 8 && !o.reverse ? o.kmh * Math.min(50, Math.abs(o.beta || 0) * 57.2958) * 1.5 : 0)`.
  - `app.js` (line 3440402): Class `lE` implements taxi fares with animated 3D pedestrian pickups, glowing curb beacons (`TaxiBeacon`), street vs comfort styles, passenger ratings, and tip bonuses.
  - `app.js` (line 3795613): Object `Si` and class `nT` define 13 challenge types with procedural generator.
  - `index.html` (lines 326-499): Pause menu contains tabs for `autopilot`, `driving`, `vehicle`, `display`, `graphics`, `sound`, `world`, `room`, `leaderboard`, `profile`, `controls`, and `credits`. There is no "Activities" or "Missions" tab.
- **Navigation & Map**:
  - `app.js` (line 3892956): Fullscreen interactive map handles dragging, pinching/wheel zooming, centering on player, and rendering landmarks, highway badges, and stunts.
  - Fullscreen map pointer events only handle pan and zoom; clicking markers does not trigger Fast Travel teleportation.
  - 3D chevrons/braking line (`RaceCarpet`) only projects on road during races or automated navigation.
- **Audio & Persistence**:
  - `app.js` (line 3473665): Class `uE` provides complete Web Audio DSP pipeline, exhaust/intake/subwoofer synthesis, 10 engine sound presets, sirens, PA voice clips, helicopter audio, and 7 radio music tracks.
  - `localStorage` key `teleop2.guest` (schemaVersion 2) persists cash, XP, race best times and podiums, police bounty/escapes, drift records, discovered roads bitmask, and car customizations.

---

## 2. Logic Chain
1. *From Fleet Observations*: The vehicle registry `hs` defines 7 vehicles (`waymo`, `cybercab`, `ferrari`, `corvette`, `cybertruck`, `roadster`, `missions`), but lacks a playable Police Interceptor and a classic V8 muscle car as requested in R3.
2. *From Physics Observations*: While `qx` has sophisticated stability aids and manual/auto transmission, there is no high-level toggle between "Arcade" and "Simulator" modes to automatically adjust tire slip tolerance, countersteer assist, and nitro regeneration.
3. *From Garage Observations*: The turntable studio `Iz` is fully implemented in 3D WebGPU, but the finish list `kp` and customization schema `{ c, f, cal, rim, w }` omit carbon fiber paint and window tinting required by R3.
4. *From Mission Observations*: Underlying engines for races (`sE`), pursuits (`gE`), stunts (`vE`), and taxi fares (`lE`) are robust and functional. However, because the pause menu lacks an Activities/Missions tab, Acceptance Criterion 1 ("Meniul de pauză/activități permite selectarea și pornirea a cel puțin 3 tipuri distincte de misiuni") is not satisfied.
5. *From Map Observations*: The fullscreen map is interactive for navigation viewing, but lacks marker-click Fast Travel teleportation, and free roam lacks an active 3D road navigation guideline to arbitrary player destinations as requested in R4.

---

## 3. Caveats
- AI traffic and pedestrian density settings in `World` settings can influence mission difficulty (e.g., Near-miss runs require traffic enabled).
- Vehicle 3D models require appropriate geometry groups (`CarGlass`, `CarBody`, `CarRim`, `CarCaliper`) to apply customization shaders without artifacts.
- No caveats regarding unexplored code paths within the scope of Explorer 3.

---

## 4. Conclusion
The codebase possesses high-quality foundation systems for vehicles, physics, gameplay loops, audio, and state persistence. The primary work required for R1, R3, and R4 consists of:
1. **Activities / Missions UI**: Adding an "Activities" tab to the Pause Menu allowing immediate selection and launching of Checkpoint Races, Drift Zones, and Police Pursuits (satisfying Acceptance Criterion 1).
2. **Handling Mode Switch**: Adding an "Arcade" vs "Simulator" toggle to the Driving settings that scales lateral grip, drift ease, and nitro recharge.
3. **Garage Enhancements**: Adding carbon fiber finish and a window tint slider (`light`, `medium`, `dark`, `limo`) to the turntable garage.
4. **Fleet Additions**: Adding a playable Police Interceptor variant and classic muscle car to the garage fleet.
5. **Map & GPS Improvements**: Adding Fast Travel (click-to-teleport) on fullscreen map markers and an active 3D road guidance line for player destinations in free roam.

---

## 5. Verification Method
1. **Inspect Source Files**:
   - `c:\Users\Gabi\Downloads\game fly\app.js`: verify vehicle specs at line 12880, races at line 13139, police at line 13167, and garage at line 3189245.
   - `c:\Users\Gabi\Downloads\game fly\index.html`: verify pause menu tabs at line 326.
2. **Start Dev Server**:
   - Run `node server.js` from `c:\Users\Gabi\Downloads\game fly`.
   - Open `http://localhost:3000` in a WebGPU-compatible browser (e.g., Chrome/Edge).
3. **Invalidation Conditions**:
   - The findings would be invalidated if an external plugin or secondary bundle dynamically injected the missing Activities tab, Arcade mode switch, or window tint options at runtime.
