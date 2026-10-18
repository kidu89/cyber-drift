# Survey & Gap Analysis: Vehicles, Physics, Gameplay, Missions, UI & Persistence

**Explorer**: Explorer 3 (`teamwork_preview_explorer`)  
**Date**: 2026-10-17  
**Scope**: Vehicle models/classes, vehicle physics (arcade vs sim, steering, drift, nitro), garage & customization (turntable, paint, rims, windows, calipers), gameplay/missions (checkpoint races, police pursuit with heat levels 1-5, drift scoring, VIP fares), UI/HUD (speedometer, minimap, fullscreen map, GPS 3D line), audio architecture, and `localStorage` state persistence.

---

## 1. Executive Summary

A comprehensive investigation was conducted into the Teleoperator codebase (`app.js`, `index.html`, `server.js`, `workers/car.js`, and `assets/`). The codebase is an advanced WebGPU/Three.js driving simulation featuring a high-fidelity vehicle dynamic model (`qx`), a procedural & landmark-driven San Francisco open world, an interactive 3D turntable garage (`Iz` / `GarageStudio`), a multi-tiered police pursuit system (`gE`), checkpoint racing with AI opponents (`sE`), PR stunts & drift scoring (`vE`), animated pedestrian taxi fares (`lE`), and a Web Audio synthesis & effects pipeline (`uE`).

However, notable architectural and feature gaps exist against requirements **R1**, **R3**, and **R4** of `ORIGINAL_REQUEST.md`:
1. **R1 (Gameplay & Missions)**: While underlying engines for checkpoint races, police pursuits, drift zones, and taxi fares exist, there is **no pause/activities menu tab** allowing players to select and launch missions on demand. Also, there is no free-roam drift combo/multiplier system outside predefined zones.
2. **R3 (Fleet & Tuning)**:
   - **No Arcade vs. Simulator Mode toggle**: The physics engine (`qx`) supports granular assist toggles (ABS, TCS, ESP, Steering Helper), but has no high-level mode switch between "Arcade" (easier drift initiation, auto-countersteer, regenerative nitro) and "Simulator" (realistic tire traction limits, strict slip angles).
   - **Missing Vehicles**: The vehicle registry `hs` contains 7 models, but lacks a dedicated playable **Police Interceptor** and a **Classic Muscle Car**.
   - **Customization gaps**: The garage allows body color, rim color, caliper color, and paint finish (gloss, metallic, pearl, satin, matte, chrome, candy), but **lacks window tinting** and **carbon fiber finish**.
3. **R4 (Map & Navigation)**:
   - **No Active GPS 3D Guidance in Free Roam**: The 3D chevrons/braking line (`RaceCarpet`) only activates during races or automated guidance, lacking a player-set waypoint line projected on the road surface in free roam.
   - **No Fast Travel from Fullscreen Map**: The fullscreen map supports panning and zooming, but clicking markers (events, speed traps, garages) does not trigger teleportation.

---

## 2. Vehicle Fleet & Models Architecture

### 2.1 Vehicle Registry (`hs` & `e2`)
In `app.js` (line 12880), the vehicle registry `hs` defines 7 distinct vehicle models:
```javascript
var e2 = ["waymo", "cybercab", "ferrari", "corvette", "cybertruck", "roadster", "missions"];
var lM = new Set(["ferrari", "corvette", "missions"]); // Manual / ICE vehicles
```

| ID | Display Name | Model / Maker | Drivetrain & Power | Weight | 0-100 km/h | Engine / Sound Profile | Asset Path |
|---|---|---|---|---|---|---|---|
| `waymo` | Waymo | Jaguar I-PACE (Waymo Driver) | Dual-motor AWD (310 kW) | 2,300 kg | 4.5 s | EV (`fc.ev`) | `assets/waymo/` |
| `cybercab` | Cybercab | Tesla Cybercab (Tesla FSD) | Rear-motor RWD (250 kW) | 1,520 kg | 4.4 s | EV Sport (`fc.ev_sport`) | `assets/cybercab/` |
| `ferrari` | Ferrari | 458 Spider (Manual Override) | 4.5L V8 RWD (570 PS) | 1,480 kg | 3.3 s | High-rev V8 (`fc.v8`) | `assets/car/` |
| `corvette` | Corvette | ZR1X (Manual Override) | Hybrid Twin-Turbo V8 AWD (1250 hp) | 1,810 kg | 2.5 s | Twin-Turbo V8 (`fc.v8tt`) | `assets/corvette/` |
| `cybertruck`| Cybertruck | Tesla Cybertruck (Tesla FSD) | Tri-motor AWD (630 kW) | 3,100 kg | 2.7 s | EV Truck (`fc.ev_truck`) | `assets/cybertruck/` |
| `roadster` | Roadster | Tesla Roadster (SpaceX Pkg) | Cold-gas Thrusters + Fan AWD | 1,900 kg | 1.1 s (0-60) | EV Hypercar (`fc.ev_hyper`) | `assets/roadster/` |
| `missions` | Mission S | Porsche (Manual Override) | Hybrid Flat-Six RWD (750 PS) | ~1,500 kg | 2.8 s | Flat-Six (`fc.flat6`) | `assets/missions/` |

### 2.2 Vehicle Asset Pipeline (`workers/car.js`)
- Each model has a `.glb` geometry and a `.json` metadata file (e.g., `assets/corvette/corvette.json`).
- The worker `workers/car.js` parses the GLTF/GLB binary buffer, splits geometry by material groups (`CarBody`, `CarGlass`, `CarTaillight`, `CarHeadlight`, `CarSignal`, `CarCarbon`), performs normal smoothing on body panels, and identifies wheel hubs by spatial clustering (`$ = [[-.855,.358,-1.16], [.849,.358,-1.159], ...]`) to isolate front/rear wheels, brake calipers, and brake discs.

### 2.3 Fleet Gaps vs R3
1. **No Playable Police Interceptor**: While police pursuit patrol cars spawn dynamically during wanted levels, they are not selectable in the garage or player car fleet.
2. **No Classic Muscle Car**: Corvette ZR1X is a contemporary hybrid hypercar; a classic American muscle car (e.g. 1969 Dodge Charger / Ford Mustang with a roaring small-block/big-block V8 `fc.sml`) is missing.

---

## 3. Vehicle Physics Engine (`qx`)

### 3.1 Physics Architecture
In `app.js` (line 12880), the vehicle physics engine is encapsulated in class `qx`:
- **Chassis & Inertia**: Tracks mass, yaw moment of inertia `izz`, pitch moment `ipitch`, roll moment `iroll`, height of center of gravity `hcg`, weight transfer distribution between front axle `a` and rear axle `b`.
- **Suspension & Ride Dynamics**:
  - `rideHz` (1.35 to 2.4 Hz), damping ratio `rideZeta` (~0.7), anti-roll bars (`arb`), bump travel (`bump`), droop travel (`droop`).
  - Dynamic body pitch (`bPitch`, `bPitchV`) and roll (`bRoll`, `bRollV`) calculated on cornering, acceleration, braking, and hill inclines.
- **Tire Traction & Slip Dynamics**:
  - Friction coefficient `mu` (1.24 to 1.50) with `rearGrip` (1.06 to 1.12) and lateral grip `latMu`/`latMuR`.
  - Pacejka-style magic formula slip curve approximation:
    ```javascript
    function fF(o, t = 13, e = 1.45, s = 0.2) {
      let n = t * o;
      return Math.sin(e * Math.atan(n - s * (n - Math.atan(n))));
    }
    ```
  - Calculates longitudinal slip ratio `kappa` and lateral slip angle `slip` per wheel.
  - Sideslip angle `beta` tracked for chassis drift state.
- **Downforce & Aerodynamics**:
  - Drag area `cdA`, rolling resistance `crr`, aerodynamic downforce `downforce`.
  - Roadster features ground-effect suction fans (`fanKg: 2200`) providing flat cornering grip at all speeds.
- **Drivetrain & Transmission**:
  - Dual transmission mode: Automatic (`auto`) and Manual (`manual`).
  - Realistic gear ratios (e.g., Ferrari 7-speed `[3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69]`, Corvette 8-speed `[2.91, 1.76, 1.22, 0.95, 0.75, 0.62, 0.53, 0.46]`).
  - Clutch bite time (`biteTime`), shift cuts (`shiftCut`), rev matching blips (`blip`), upshift/downshift kick (`kick`).
  - EV electric motor single-speed direct drive with power curves `torque(rpm)` and regenerative braking (`regen: 480 - 1040 Nm`).
- **Nitro / NOS**:
  - Nitro force (`nitroForce: 7000 - 16000 N`), consumption rate (`nitroUse: 0.2 - 0.22/s`), natural recharge rate (`nitroFill: 0.05 - 0.07/s`).
  - Reaction time bonus on race start refills +0.25 nitro.
  - Active nitro fires cold-gas thrusters / exhaust flame effects.
- **Active Stability Assists**:
  - `abs`: Modulates brake fluid pressure `absP[0..3]` when wheel lockup is detected.
  - `tcs`: Cuts engine throttle/torque `tcsCut[0..3]` when driven wheel slip exceeds limit.
  - `esp`: Applies individual wheel braking `espB[0..3]` to counter understeer and snap oversteer.
  - `steering`: Steering helper smoothing turn-in, speed-sensitive steering angle limit (`steerMax` to `steerMaxHigh`).
- **Autopilot / Driver Assist (DA)**:
  - Modes: Manual (no assist), L3 (Guidance), L4 (Lane & cruise), L5 (Self-driving with Chill vs Mad Max driving profiles).

### 3.2 Physics Gap: Arcade vs. Simulator Mode
- **Current implementation**: Only offers separate checkmarks for ABS, TCS, ESP, and Steering Helper in the "Driving" settings tab.
- **Requirement R3**: Demands an adjustable preset toggle between **Arcade** and **Simulator**:
  - *Arcade Mode*: Higher tire lateral grip, increased drift slip forgiveness, reduced spin-out risk, regenerative nitro refill on drafting/drifting, and automatic countersteer assistance.
  - *Simulator Mode*: Realistic tire load sensitivity, strict slip angle breakaway, authentic ABS/TCS modulation, manual clutch timing, no unassisted countersteer.
- **Verdict**: Missing overarching Arcade/Simulator mode preset controller.

---

## 4. Garage & Customization System (`Iz`)

### 4.1 3D Turntable Studio (`GarageStudio`)
In `app.js` (lines around 3189245), `Iz = class { ... }`:
- **Studio Environment**:
  - Circular turntable floor (`StudioFloor`, radius 6.9m, height 6m) with rotating center table (`this.table.rotation.y = e`).
  - Light tubes: 10 to 14 cylindrical light bars arranged in a perimeter ring and overhead bars with custom radiance and rim reflections.
  - Contact shadow projection pool (`this.pool`) and glowing neon boundary ring (`this.ring`).
  - Custom camera exposure, vignette, bloom, glare spread, and studio tone mapping.

### 4.2 Customization Parameters & Persistence
- Customization data model per vehicle:
  ```javascript
  {
    c: hexColor,      // Body color (hex or null for factory)
    f: finishKey,     // Finish id (or null for factory)
    cal: calColor,    // Brake caliper color
    rim: rimColor,    // Rim color
    w: wrapData       // Decals / wrap image
  }
  ```
- Saved under `teleop2.guest.custom[carId]` and synced across sessions.
- Finishes defined in `kp`:
  - `gloss`: Solid colour, deep clear coat
  - `metallic`: Fine metal flake under the coat
  - `pearl`: Colour that shifts with light
  - `satin`: Soft sheen, low gloss
  - `matte`: Flat, no clear coat
  - `chrome`: Mirror-polished colour
  - `candy`: Deep tinted coat over bright flake

### 4.3 Customization Gaps vs R3
1. **Window Tint Missing**:
   - The garage UI has no controls for window glass tint / opacity.
   - The vehicle material pipeline does not support glass tint color/opacity in `custom[carId]`.
2. **Carbon Fiber Finish Missing**:
   - While `CarCarbon` geometry parts exist, `carbon` is not an available paint finish option in `kp` for body panels.

---

## 5. Gameplay & Missions Architecture

### 5.1 Checkpoint Races & Time Trials (`sE` & `qn`)
In `app.js` (lines around 13139):
- **Track Construction**: Built from road graph splines with length `i.L` and sequential checkpoint gates `i.cps`.
- **Visuals**:
  - Checkpoint gates illuminated in 3D world (`i.lightGates(l.cp)`).
  - 3-2-1 countdown tree with green launch light.
  - Reaction time tracking with "Perfect start" bonus (boost + nitro refill).
  - 3D road surface chevrons / braking line (`RaceCarpet`).
- **Opponents & AI**:
  - AI bots (`s.bots`) driving dynamic racing lines with catch-up logic.
  - Multiplayer room competitors (`this.mp.racers`).
- **Rules & Results**:
  - Off-track timer (`s.offT > 3.5s`) resets car to track ("Back on the track").
  - Results card with podium positions (1st, 2nd, 3rd), race completion time in milliseconds, prize money (`ywt`), and local storage record updates (`race.best[id]`, `race.wins`, `race.podiums`).

### 5.2 Dynamic Police Pursuit System (`gE` & `vo`)
In `app.js` (lines around 13167):
- **Heat Levels 1 to 5**:
  - Escalates on speeding, traffic collisions, red light infractions, and ramming patrol cars.
  - UI displays dynamic heat/wanted HUD with 5 stars and progress bar.
- **Pursuit Tactics**:
  - Level 1-2: Patrol cars pursue with siren wail and radio calls.
  - Level 3: Aggressive PIT maneuvers, roadblocks (`roadblock(t)`) blocking boulevard lanes.
  - Level 4: Spike strips deployed in roadway gaps (`spikes(t)`), bursting tires (`tyres.n`, reduced grip, wheel sparks), and police helicopter dispatch (`heliUpdate(t)`).
  - Level 5: High-speed interceptors, multi-car roadblocks, aggressive ramming.
- **Cooldown & Evader Mechanics**:
  - Losing line of sight initiates evasion cooldown (`this.cool`).
  - Hiding in alleys / side streets accelerates cooldown ("Hiding · Xs").
  - Cooldown bar turns green upon escape, granting bounty cash reward (`this.bounty`).
- **Bust Mechanics**:
  - If car is boxed in or stopped near police for >2.5s, "Busting %" fills to 100%.
  - Player is busted: fine deducted from cash balance, car respawned at release location.
- **Pursuit Audio**:
  - Full radio chatter (`cop_radio.mp3`, `cop_pa.mp3`), sirens (`cop_wail.mp3`, `cop_yelp.mp3`, `cop_chirp.mp3`), and helicopter rotors (`heli_loop.mp3`, `heli_near.mp3`).

### 5.3 PR Stunts & Drift Scoring (`vE`)
In `app.js` (lines around 3622150):
- **Four Stunt Types**:
  1. `trap`: Speed Traps (instantaneous radar speed in km/h).
  2. `zone`: Speed Zones (average speed maintained between entry and exit gates).
  3. `drift`: Drift Zones (accumulated drift points from entry to exit gate).
  4. `jump`: Danger Signs (meters jumped through air off ramps).
- **Drift Scoring Formula**:
  ```javascript
  fMt = o => {
    let t = o.kmh, e = Math.abs(o.beta || 0) * 57.2958; // slip angle in degrees
    return o.onGround !== !1 && t > 25 && e > 8 && !o.reverse ? t * Math.min(50, e) * 1.5 : 0;
  };
  ```
  Points accumulate per millisecond while slip angle > 8° and speed > 25 km/h.
- **3-Star Medal System**: Each stunt has 1-star, 2-star, and 3-star thresholds. Total stars and best scores saved in `sf-drive.stunts`.

### 5.4 VIP Fares & Taxi Service (`lE`)
In `app.js` (lines around 3440402):
- **Waymo Taxi Mode**:
  - 3D glowing curb beacon (`TaxiBeacon` with animated ring, disc, beam, core) at pickup/dropoff points.
  - Animated 3D passengers (`Zr` / `En` / voxel `D0`) walking from sidewalk to car door, opening door, and ducking inside.
  - Two ride styles:
    - *Street*: Passenger tips on high speed, near misses, and police heat.
    - *Comfort*: Strict G-force tolerance. Hard braking, collisions, or high lateral accelerations trigger passenger complaints ("Too rough a ride") and reduce tip/rating.
- **Challenge Engine (`nT` & `Si`)**:
  - Comprehensive catalog of 13 challenge types (`race`, `police`, `taxi`, `food`, `courier`, `vip`, `trial`, `drift`, `speed`, `jump`, `nearmiss`, `photo`, `collect`).
  - Procedural stops, delivery timers, temperature decay (for food), and star ratings.

### 5.5 Gameplay Gaps vs R1
1. **No Pause/Activities Menu Selection**:
   - In `index.html` and `app.js`, the Pause menu has tabs for autopilot, driving, vehicle, display, graphics, sound, world, room, leaderboard, profile, controls, and credits.
   - **There is no "Activities / Missions" tab** in the pause menu allowing the user to select and launch a Checkpoint Race, Drift Challenge, or Police Pursuit on demand.
2. **Free-Roam Drift Multiplier HUD Missing**:
   - Drift points are only scored and displayed during an active `drift` zone stunt or challenge, rather than as an open-world stunt combo multiplier (like Forza Horizon style).

---

## 6. UI / HUD & Navigation Systems

### 6.1 Speedometer & HUD (`#hud` & `#dial`)
- **SVG Instrument Dial** (`index.html` lines 241-255):
  - Digital speed readout (`#spd`) and selectable units (`KM/H` vs `MPH`).
  - Tachometer arc (`#rpm`, `#rpmT`, `#red`) responding to engine RPM.
  - Nitro gauge arc (`#nos`, `#nosT`) showing cold-gas thruster / nitrous charge.
  - Gear indicator (`#gear`: 1-8, D, R).
  - Status indicators for active stability aids: `#aABS`, `#aTCS`, `#aESP`, and `#aDA` (Driver Assist level).

### 6.2 Minimap & Fullscreen Interactive Map
- **Minimap** (`#miniC`, canvas 400x400):
  - Rotates with vehicle heading (`-psi`).
  - Renders road vector geometry, highway corridors, player marker, and stunt icons.
- **Fullscreen Map** (`app.js` lines 3892956+):
  - Activated via `Tab` or `G` key.
  - Interactive canvas: smooth pan (mouse drag / touch drag), zoom (mouse wheel / pinch gesture), center-on-player button (`◎`).
  - Detailed overlays: street names (`ld`), district/neighborhood labels (`Z4t`), water labels (`Q4t`), highway shields (US-101, I-80), landmarks (`Kst`), stunt badges.
- **Navigation Lines**:
  - `RaceCarpet`: 3D chevrons projected on road geometry in races, colored green for accelerating, amber for braking, red for excessive entry speed.
  - "What's Next" guide card (`nextUp`) displays distance and estimated time to closest uncompleted stunt.

### 6.3 Navigation Gaps vs R4
1. **No Free-Roam 3D GPS Guidance Line**:
   - Players cannot click a destination on the map in free roam to generate an active 3D road line or turn-by-turn arrows.
2. **No Map Click Fast Travel**:
   - Clicking landmarks, speed traps, garages, or race start locations on the fullscreen map does **not** teleport the player (fast travel only exists in multiplayer room panel to teleport to another driver).

---

## 7. Audio Architecture (`uE`)

- **High-End Web Audio Pipeline**:
  - Two-stage dynamic compressor + waveshaper saturation curve (`tanh`) for analog warmth and brickwall limiting.
  - Dedicated bus channels: `master`, `game`, `sfx`, `world`, `amb`, `ui`, `mus` (radio music with lowpass filter and helicopter ducking).
- **Engine Sound Synthesis**:
  - 10 engine sound presets in `fc`: `flat6`, `v12`, `diesel`, `small`, `v8`, `v8tt`, `ev`, `ev_sport`, `ev_truck`, `ev_hyper`.
  - Multi-layer audio mixing: exhaust manifold resonance, subwoofer bass thump (`subLP`), intake howl (`intakeBP`), stereo delay widening (23ms & 29ms stereo panners).
  - Exhaust backfire pops and crackles (`backfire.mp3`, `crack.mp3`).
  - Convolution reverb with real impulse response WAVs: `ir_street.wav` and `ir_tunnel.wav`.
- **Pursuit & Environmental Audio**:
  - Full police sirens, PA voice clips, and helicopter audio loops.
  - Radio station with 7 tracks (`track_1.mp3` through `track_7.mp3`).
  - Tire skid and drift sounds (`tyre_drift.mp3`, `tyre_squeal.mp3`, `tyre_scrub.mp3`, `tyre_corner.mp3`).
- **Verdict**: Audio implementation is exceptionally comprehensive and meets or exceeds R1/R2/R3 audio requirements.

---

## 8. State Persistence Architecture (`localStorage`)

- **Primary Save State (`teleop2.guest`)**:
  ```json
  {
    "schemaVersion": 2,
    "gid": "87737085-b0cf-49f4-8eb8-38b98fb79696",
    "pos": { "x": -2927.2, "z": 1661.2, "psi": -5.262 },
    "car": "roadster",
    "taxi": { "total": 0, "rides": 0, "stars": [] },
    "race": { "money": 750, "played": 0, "wins": 0, "podiums": 0, "best": {} },
    "police": { "bounty": 0, "escapes": 0, "busts": 0 },
    "km": 1.1,
    "earned": 750,
    "xp": 1000,
    "ch": { "cash": 0, "runs": 0, "best": {} },
    "roads": { "n": 7986, "b": "..." },
    "boards": [],
    "best": { "kmh": 168.3, "drift": 2.4, "bounty": 0 },
    "settings": { "store": { "sf-drive.settings": "..." }, "mph": true },
    "custom": {
      "roadster": { "c": "#ff0000", "f": "gloss", "cal": "#ffff00", "rim": "#111111" }
    },
    "cash": { "base": 0, "log": [...] }
  }
  ```
- **Supplementary Keys**:
  - `sf-drive.settings`: User preferences (graphics quality, intro state).
  - `sf-drive.stunts`: Personal records for speed traps, speed zones, drift zones, danger signs.
  - `sf-drive.cars`: List of unlocked vehicle IDs.
  - `teleop.car`: Active car ID.
  - `teleop.fares`: Fares enabled/disabled.
- **Verdict**: Persistence layer is robust, schema-versioned, and correctly synchronizes race results, stunt scores, police fines/escapes, and customization data.

---

## 9. Comprehensive Gap Analysis Matrix

| Requirement | Area | Existing Implementation | Identified Gaps | Recommended Implementation Path |
|---|---|---|---|---|
| **R1** | Activities Menu | Procedural challenge generator `nT` and `Si` exist; races and stunts placed in world. | **No Activities/Missions tab in Pause Menu**. Acceptance criteria requires starting at least 3 distinct missions from menu. | Add an `<button class="tab" data-tab="activities">` in `index.html` pause menu, and implement an Activities Pane listing Checkpoint Races, Drift Zones, and Police Pursuits with immediate "Start" action. |
| **R1** | Checkpoint Races | Complete racing engine `sE` with lit gates, 3-2-1 lights, AI bots, podium and prize money. | Cannot launch races directly from pause menu without driving to start marker. | Wire up `race` items in the new Activities menu to call `startSolo()` on predefined urban tracks. |
| **R1** | Police Pursuit | Complete pursuit engine `gE` with heat 1-5, roadblocks, spike strips, helicopter, evasion cooldown, and bust fines. | Cannot trigger pursuit challenge from menu. | Add "Police Pursuit" launcher in Activities menu that sets heat to selected level (1-5) and calls `startPursuit()`. |
| **R1** | Drift Scoring | Drift zone scoring `fMt` with real-time slip angle & speed calculation. | No free-roam drift combo counter / multiplier HUD outside designated zones. | Implement an open-world drift combo counter that displays drift points & multipliers in real-time when sliding anywhere in SF. |
| **R1** | VIP Fares | Taxi service `lE` with 3D passenger walking/boarding, comfort vs street style, tip & star rating. | No menu shortcut to trigger a VIP escort fare. | Include "VIP Escort" in the Activities menu that spawns a VIP passenger with zero-collision tolerance. |
| **R3** | Fleet Expansion | 7 cars: Waymo, Cybercab, Ferrari 458, Corvette ZR1X, Cybertruck, Roadster SpaceX, Mission S. | **Missing Police Interceptor** and **Classic Muscle Car**. | Add a Police Interceptor variant (with working siren lights & cop skin) and a classic V8 muscle car to `hs` registry. |
| **R3** | Physics Tuning (Arcade vs Sim) | Physics engine `qx` with assists (ABS, TCS, ESP, Steering Helper) and Autopilot L3-L5. | **No Arcade vs Simulator Mode switch**. | Add a top-level "Handling Mode" switch in Driving settings: Arcade (high grip, easy drift countersteer, auto-regenerating nitro) vs Simulator (raw physics, authentic traction limit, configurable ABS/TCS). |
| **R3** | Garage Customization | Turntable studio `Iz` with body paint, finishes (gloss, metallic, pearl, satin, matte, chrome, candy), rim color, calipers, wraps. | **Missing Window Tint** and **Carbon Fiber Finish**. | Add `carbon` to `kp` finishes list; add `tint` (light, medium, dark, limo) to garage UI and bind to car `Glass` material opacity/color. |
| **R4** | GPS Navigation | 3D chevrons & braking line `RaceCarpet` active in races; "What's Next" guide card. | **No 3D guidance line in free roam towards user-chosen destination**. | Allow player to click a destination on the map to project 3D road line chevrons from player position to destination using `router.routeTo()`. |
| **R4** | Bridges & Routes | Golden Gate Bridge & Bay Bridge fully modeled in road network with speed traps. | Overlook scenic spots need clear event markers. | Add scenic viewpoint race / time trial routes across both bridges to Marin Headlands and Treasure Island. |
| **R4** | Fullscreen Map | Interactive canvas map with pan, pinch/wheel zoom, center-on-player, and landmark/stunt badges. | **No Fast Travel (click-to-teleport)** on map markers. | Add click detection on map markers (garages, speed traps, race starts) displaying a popup with a "Fast Travel" button calling `v.place(x, z, psi)`. |

---

## 10. Verification Method & Testing Guide

To independently verify the findings of this survey:
1. **Source Inspection**:
   - Examine `app.js` line 12880 for vehicle fleet specs `hs` and physics class `qx`.
   - Examine `app.js` line 13139 for race system `sE` and persistence schema `nE()`.
   - Examine `app.js` line 13167 for police pursuit system `gE`.
   - Examine `app.js` line 3189245 for turntable garage studio `Iz` and finish catalog `kp`.
   - Examine `app.js` line 3892956 for fullscreen map click handling.
   - Examine `index.html` lines 326-499 for current pause menu tab list.
2. **Runtime Verification**:
   - Start local server: `node server.js` (default port 3000).
   - Open `http://localhost:3000`.
   - Open settings menu (`Esc` / `P` key) and verify:
     - No "Activities" or "Missions" tab is present.
     - No "Arcade vs Simulator" toggle is present in Driving tab.
   - Open garage and check finish options: verify absence of carbon fiber finish and window tint.
   - Open fullscreen map (`Tab` / `G`), click on a landmark or stunt badge: verify no fast travel modal appears.
