# World, Environment, Shaders & Map Survey Analysis (Explorer 2)

**Author**: Explorer 2 (Archetype: `teamwork_preview_explorer`)  
**Target Repository**: `c:\Users\Gabi\Downloads\game fly`  
**Reference Document**: `.agents/teamwork/ORIGINAL_REQUEST.md` (Requirements R2 & R4)  
**Date**: 2026-10-17

---

## 1. Executive Summary

This report delivers an exhaustive technical audit of the 3D world representation, road network, landmarks, lighting, weather/sky, custom WebGPU WGSL shaders (asphalt wetness/reflections), particle systems, and navigation/minimap systems in the Teleoperator driving simulator.

The application is built on top of a cutting-edge **Three.js (r186) custom WebGPU pipeline** with custom clustered lighting, WGSL shaders, dynamic sky baking in a Web Worker, and an exact geographic model of San Francisco. While the foundational rendering and procedural world generation are exceptionally capable, several critical gaps exist when measured against the expansion requirements for **R2 (Graphics & Atmosphere)** and **R4 (Map & Navigation)** in `ORIGINAL_REQUEST.md`:

1. **Day/Night Cycle & Weather Transitions (R2)**: The engine possesses 6 discrete atmospheric presets (`noon`, `golden`, `fog`, `rain`, `dusk`, `night`), but transitions are currently instantaneous discrete state swaps triggered solely by keyboard input (`T` key) or the pause menu. There is no continuous real-time clock advancement, no smooth lerp interpolation between lighting/sky states, and no dynamic weather cycle (rain starting/stopping dynamically).
2. **Asphalt & Puddle Dynamics (R2)**: The custom WGSL road shader contains Need for Speed-style wetness modeling with dual-octave simplex noise puddles, Screen Space Reflections (SSR), and anisotropic GGX light streaks. However, puddle depth and wetness are static boolean/preset uniforms; there is no dynamic water accumulation during rain or drying/evaporation after rain stops.
3. **Vehicle Particle Systems (R2)**: Tire smoke, skid marks (3200-quad ring buffer), crash sparks, 2D exhaust flame/backfire sprites, falling rain streaks (4200 quads), and puddle splashes exist. However, **neon underglow beneath vehicles is completely absent**, skid marks overwrite rapidly due to buffer size limits without long-term city persistence, and nitro flames are simple 2D billboard sprite planes rather than full 3D volumetric flame jets.
4. **Bridge Access & Viewpoints (R4)**: Golden Gate Bridge (`M2`) and Bay Bridge (`S2`) are geometrically modeled with deck splines, suspension towers, and cables. However, because external region data for Marin and the East Bay (`assets/real/marin/` and `assets/real/west/`) are not included in the asset pack, both bridges currently force the player into a turnaround loop ramp (Golden Gate plaza loop; Yerba Buena Island tunnel loop) rather than granting free access to scenic viewpoints and overlooks.
5. **GPS Navigation vs Autopilot (R4)**: A 3D road chevron guide mesh (`yz`, `GuideArrows`) exists. However, setting a destination pin on the map currently automatically forces the vehicle into autonomous Level 5 Autopilot (`mn.setMode("l5")`). In manual driving mode, guide chevrons are suppressed unless racing or forcing the global setting `brakeLine: "always"`. There is no dedicated manual GPS navigation ribbon or directional marker guiding the player to user-selected map pins.
6. **Map Markers & Garages (R4)**: The interactive fullscreen map and minimap (`kT`) plot speed traps, drift zones, danger signs, traffic, and landmarks, and support click-to-teleport. However, **garages are not marked on the map or minimap** (garage is only an off-world UI pause menu turntable), and new mission types (checkpoint races, police pursuit hot zones) lack dedicated map icons.

---

## 2. 3D World & City Representation

### 2.1 Coordinate Projection and Spatial Extent
The geographic reference is configured in `assets/real/place.json` centered on San Francisco:
- **Origin Reference**:
  - `lon0`: `-122.3935`
  - `lat0`: `37.79553`
  - Scale multipliers: `kx = 87990` m/deg lon, `kz = 111050` m/deg lat.
- **Bounding Box**:
  - West: `-122.516` (~Ocean Beach / Pacific Ocean)
  - East: `-122.384` (~San Francisco Bay / Embarcadero)
  - North: `37.812` (~Fisherman's Wharf / Golden Gate Strait)
  - South: `37.750` (~Twin Peaks / Noe Valley / Mission)
- **District Classification**:
  27 distinct procedural districts (`fidi`, `towers`, `jackson`, `chinatown`, `union`, `tenderloin`, `soma`, `wharf`, `northbeach`, `telegraph`, `nob`, `russian`, `marina`, `cowhollow`, `pacific`, `western`, `hayes`, `presidio`, `mission`, `castro`, `dolores`, `noe`, `twinpeaks`, `haight`, `richmond`, `seacliff`, `sausalito`).

### 2.2 Binary Asset Architecture
The runtime environment streams gzipped binary data packages from `assets/real/`:
- `terrain.bin.gz`: Heightfield elevation grids and terrain normals, parsed by function `iV(t)` in `app.js`.
- `roads.bin.gz`: Complete vector road graph containing edges (`a.edges`), junctions (`a.juns`), lane counts, speed limits, surface types, sidewalk polygons (`a.walks`), and curb polylines (`a.curbs`).
- `buildings.bin.gz`: Quantized extruded building footprints with floor heights, roof geometries, and facade style tags.
- `props.bin.gz`: Instanced street furniture, lampposts (`lamp`, `lamp2`, `plamp`, `dlamp`), traffic signals, fire hydrants, benches, newsboxes, and parking meters.
- `coast.bin.gz`: Sea wall and coastline contour splines.
- `green.bin.gz`: Park boundaries (Golden Gate Park, Presidio, Marina Green, Washington Square).
- `ground.bin.gz`: Ground plane surface mesh.
- `btags.bin.gz`: Building labels and landmark metadata.
- `sky.bin.gz`: Baked spherical harmonics / sky visibility occlusion.

### 2.3 Road Network Graph & Surface Dynamics
In `app.js`, function `cpt(o)` reconstructs the road network into a connected topological graph:
- **Edges (`a.edges`)**: Feature polyline coordinates `m.P`, spline lengths `m.L`, lane counts `m.lanes`, highway flags `m.hwy`, tunnel flags `m.tunnel`, and width functions `m.W`.
- **Junctions (`a.juns`)**: Multi-leg intersection nodes connecting inbound and outbound road segments with procedural fillet geometry (`apt(m)`).
- **Surface Elevation Query**: The function `ro(x, z, normal, hint)` computes the precise driving height across the city, combining terrain heightfield `$t(x, z)`, bridge decks (`a.decks`), and curb steps.
- **Surface Type Classification**: Function `h0(x, z)` determines surface material: `"road"`, `"walk"`, `"median"`, `"lot"`, `"sea"`, or `"out"`.

---

## 3. Landmarks & Bridges Implementation

### 3.1 Golden Gate Bridge
- **Definition**: Object `M2` in `app.js` (line ~3899511):
  - Segment start `a`: `[-7392.2, -1700]` (Presidio approach)
  - Segment end `b`: `[-7543.8, -3327.6]` (Marin approach)
  - Tower positions: `[0, 1280]` relative meters
  - Road width: `hw = 14` meters (6 lanes with central barrier)
- **Construction Functions**:
  - `Odt(o, t)` & `Hdt(o, t, ...)` in `app.js` (line ~2015679):
    - Deploys suspension tower meshes, main catenary suspension cables, vertical hanger cables, road truss deck, and toll plaza pad (`"Golden Gate toll plaza"`).
    - **Access Limitation**: Because the `assets/real/marin/` subfolder is not present, `Odt` falls back to generating a circular turnaround loop:
      `let v = [d[0] + m[0]*22 + g[0]*5, d[1] + m[1]*22 + g[1]*5]; ring: y; plaza: M`
      This forces vehicles heading north to loop around on the bridge deck before reaching the Marin bluffs and Vista Point overlook.

### 3.2 San Francisco–Oakland Bay Bridge
- **Definition**: Object `S2` in `app.js` (line ~3899542):
  - Segment start `a`: `[259.5, 1020.5]` (Rincon Hill / SoMa approach)
  - Segment end `b`: `[2307.4, -1392.4]` (Yerba Buena Island)
  - Tower positions: `[698, 1402, 2108, 2812]` meters
  - Anchorage: `anch = 1755` meters
  - Structure: Double-deck configuration (`layer: 1` lower deck westbound, `layer: 2` upper deck eastbound)
- **Construction Function**:
  - `Ddt(o, t)` in `app.js` (line ~2019163):
    - Connects I-80 ramps from downtown SF to the suspension bridge spans.
    - Generates lower and upper road decks with vertical level transitions.
    - **Access Limitation**: At Yerba Buena Island, the road enters a turnaround loop (`Yerba Buena Tunnel` loop ramp: `u = hk(...)`, `d = hk(...)`, `B = zu(...)`) routing traffic from the lower deck back onto the upper deck rather than continuing into the eastern span / Treasure Island belvedere.

### 3.3 Lombard Street (The Crooked Street)
- **Implementation**:
  - Detected via edge filter `c5t = o => o.name === "Lombard Street" && o.oneway && o.cls === "residential" && o.L < 400 && (o._crk ??= ...)` at lines ~2490621 and ~3004234.
  - Dedicated brick switchback geometry with retaining walls (`LombardWalksNear`), decorative railings (`lomb_rail`), ornamental vegetation (`LombardPlants`), and spectator crowds (`LombardCrowd`).
  - Stunt integration: Speed/drift challenges and jump ramp challenges are mapped to the steep descent.

### 3.4 Twin Peaks & Sutro Tower
- **Implementation**:
  - Geometric groups: `TwinPeaksHouses`, `TwinPeaks` far mesh group, and `SutroTower` communications tower mesh group (line ~1963138).
  - Stunt integration:
    - Drift zone: `id: "twinpeaks", kind: "drift", name: "Twin Peaks", a: [-4855, 4935], b: [-4737, 4615], stars: [8000, 20000, 40000]`.
    - XP board: `id: "twinpeaks", kind: "xp", name: "Twin Peaks", x: -4807, z: 4802`.
  - Roads: `Twin Peaks Boulevard` and `Christmas Tree Point Road` provide winding elevation routes up to the scenic city vista.

### 3.5 Additional Modeled Landmarks
- **Transamerica Pyramid**: Custom landmark mesh in FiDi.
- **Salesforce Tower**: High-rise structure with dynamic top crown lighting.
- **Coit Tower**: Located on Telegraph Hill with fast travel board.
- **Ferry Building**: Clock tower landmark on Embarcadero waterfront.
- **Pier 39 & Fisherman's Wharf**: Dedicated textures (`assets/tex/lm/pier39/`, `assets/tex/lm/waterfront/`), sea lion audio ambient loops (`p39_lions`), and crab sign.
- **Palace of Fine Arts**: Rotunda dome with custom floodlight shaders (`palace62`).
- **Alcatraz Island**: Modeled in the bay with working lighthouse beacon (`id: "light"`).

---

## 4. Lighting, Sky & Day-Night Cycle

### 4.1 Atmospheric Presets (`aa`)
Located at line ~3957000 in `app.js`, the global `aa` dictionary defines 6 atmospheric environments:

| Preset Name | Sun Elevation / Azimuth | Sun Color & Intensity | Fog Color & Density | Ambient / Exposure | Special Attributes |
|---|---|---|---|---|---|
| **Noon** (`"noon"`) | El: 23°, Az: 240° | `[1.0, 0.88, 0.72]`, I: 4.6 | `[0.62, 0.66, 0.72]`, `4e-4` | Exp: 0.99, Bloom: 0.2 | Clear sky, crisp shadows, dry road patches (`patches: 0.25`) |
| **Golden Hour** (`"golden"`) | El: 11°, Az: 252° | `[1.0, 0.56, 0.28]`, I: 4.4 | `[0.75, 0.60, 0.50]`, `6e-4` | Exp: 1.24, Bloom: 0.2 | Sun shafts (`shafts: 0.35`), warm specular highlights |
| **Fog** (`"fog"`) | El: 30°, Az: 225° | `[0.9, 0.92, 0.95]`, I: 0.6 | `[0.85, 0.86, 0.875]`, `9.5e-3` | Exp: 1.10, Bloom: 0.12 | Dense marine fog layer (`bank: 1`), damp asphalt (`damp: 0.4`) |
| **Rain** (`"rain"`) | El: 40°, Az: 200° | `[0.8, 0.84, 0.90]`, I: 0.35 | `[0.266, 0.288, 0.324]`, `3.5e-3` | Exp: 1.50, Bloom: 0.24 | Full wetness (`wet: 1`), puddle accumulation, rain audio loop |
| **Blue Hour** (`"dusk"`) | El: -4°, Az: 262° | `[1.0, 0.50, 0.30]`, I: 0.1 | `[0.06, 0.058, 0.075]`, `8e-4` | Exp: 2.90, Bloom: 0.36 | Twilight gradient (`twi: [0.5, 0.22, 0.1]`), streetlights on |
| **Night** (`"night"`) | El: -20°, Moon: `[125, 28, 6]` | Sun I: 0.0 | `[0.03, 0.03, 0.036]`, `8e-4` | Exp: 3.80, Bloom: 0.38 | Stars (`stars: 0.3`), full streetlight grid, window glows |

### 4.2 Dynamic Sky Baking Architecture
- Skydomes are procedurally generated by an off-thread Web Worker (`pu("sky")`) invoking function `rN(o, t, e)`.
- The worker renders high-dynamic-range half-float equirectangular textures (`gnt(data, width)` into `Ji` DataTexture, `format: RGBA`, `type: HalfFloatType`).
- A caching map (`_T`, `ZM`) retains precomputed environments to reduce CPU stalls during switches.

### 4.3 Streetlights & Vehicle Illumination
- **Streetlight Grid**:
  - An instanced array of spotlights (`Qt`, up to 32 active lights on desktop, 4 on mobile, 2 on battery saver) tracks the player vehicle position:
    `let ht = new Bc(new Ft(1, .72, .42), 0, 34, 1.18, .85, 2);`
  - Lamp positions are extracted from prop placements (`dt.inst` with types `lamp`, `lamp2`, `plamp`, `dlamp`).
  - Spotlights cast realtime dynamic shadow maps with configured bias (`bias: -4e-4`, `normalBias: 0.04`).
- **Vehicle Headlights & Taillights**:
  - Headlights: Pair of forward-facing spotlights (`It = [-1, 1].map(...)`, range 90m, low-beam angle 0.52 rad) with left-lamp shadow casting.
  - Automatically activate when night factor `qe > 0.3` or when weather is rainy (`mt.wet > 0`).
  - Taillights: Red emissive geometry and trailing ribbons (`TailTrails`).
- **Building Window Lighting**:
  - Building shaders sample procedural floor/window grids with emissive multipliers scaled by `night` and room occupancy randomness.

---

## 5. Shaders & Environmental Materials

### 5.1 Custom WGSL Road & Asphalt Shader
Located in `app.js` around line ~1704449, the road rendering pipeline uses custom WebGPU WGSL shaders:
- **Wetness Blending**:
  ```wgsl
  let wa = max(wet, damp);
  let pn = sfN(wp.xz / 7.0) * 0.6 + sfN(wp.xz / 1.9 + 3.0) * 0.4;
  ```
- **Puddle Formation**:
  - Puddles accumulate in gutters (`gut`), wheel ruts, and topographical depressions (`hgt`):
    ```wgsl
    let thr = 0.74 - 0.36 * wa - 0.3 * gut - 0.12 * tp + 0.1 * fogD + 0.22 * nightD * (1.0 - gut);
    let pud = smoothstep(thr, thr + 0.05 + 0.3 * fogD, pn + 0.08 * (0.5 - hgt) * (1.0 - fogD)) * step(0.02, wa) * (1.0 - 0.45 * fogD);
    let rim = (smoothstep(thr - 0.06, thr, pn) * step(0.02, wa) - pud) * (1.0 - fogD);
    ```
- **Albedo & Roughness Modulation**:
  - Asphalt darkens by up to 45% when wet (`c *= 1.0 - 0.45 * wa`).
  - Roughness drops sharply in puddles (`rough = mix(rough, 0.02, pud)`), turning them into near-perfect mirrors.
  - Normal map perturbation (`nA`) attenuates under standing water to create glass-like puddle surfaces.

### 5.2 Screen-Space Reflections (SSR) & Light Streaks
- **Screen Space Reflections**:
  - The WebGPU post-processing pipeline performs screen-space raymarching against the linear view-depth buffer.
  - Hits are reflected onto surfaces with roughness under `0.34`.
  - Reflects dynamic city buildings, sky dome, traffic vehicles, and roadside props.
- **Anisotropic Streetlamp Streaks (`gHAN`)**:
  - Implements Need for Speed-style vertical light streak elongation:
    ```wgsl
    gHAN = wa * (1.0 - 0.5 * pud) * step(0.02, wa) * max(step(0.02, wet), step(0.5, bc.b));
    ```
  - Blends an elongated GGX specular lobe (`ggxStreak`) to create characteristic wet-night streetlight streaks along the asphalt.
- **Vehicle Chassis Shadow/Occlusion (`carRay`)**:
  - A raycast function prevents streetlamp streaks from drawing through the player's vehicle body.

---

## 6. Particle Systems & Visual Effects

### 6.1 Particle Engine Architecture (`class AE`)
The unified particle manager `AE` (instantiated at line ~4011619 as `new AE(Yt, { rain: 4200, skids: 3200 })`) manages all real-time visual effects:

| Effect | Implementation | Count / Buffer Size | Visual Characteristics |
|---|---|---|---|
| **Tire Smoke** | Instanced `Points` (`$r`) with smoke particle texture (`LMt()`) | 3 size tiers (`small`: 1.8m, `mid`: 3.4m, `big`: 5.6m), `N = 220` particles | Spawns under wheel slip (`slip[E] > 0.25`); expands and drifts with wind |
| **Skid Marks** | Continuous quad strip ribbon mesh (`_e`) with `IMt()` tire tread texture | `SK = 3200` quad segments | Placed at tire contact points when lateral/longitudinal slip occurs |
| **Crash Sparks** | Instanced `Points` with additive blending (`Wo`) | `NS = 160` particles | Spawns on high-velocity vehicle impacts (`E.s > 0.03`, speed > 5 km/h) |
| **Nitro Flames** | 3 Billboard plane sprites (`Vr` / `yr`) at exhaust tips | 3 sprites | Blue/cyan gradient sprite (`[0, white], [0.25, cyan], [0.6, blue]`), triggered by Nitro |
| **Backfire Pops** | 3 Billboard plane sprites (`Vr` / `yr`) at exhaust tips | 3 sprites | Orange/purple flash sprite (`[0, white], [0.22, yellow], [0.5, orange]`), triggered on gear shifts/deceleration |
| **Precipitation (Rain)** | Dynamic camera-centered quad line mesh (`_e`) | `NR = 4200` rain drops (1600 on mobile) | High-speed streaks falling around camera view frustum with camera velocity compensation |
| **Puddle Splashes** | Ground-projected circular ripple meshes (`_e`) | `NSP = 260` splash instances | Expanding concentric rings on road surface during rain |
| **Tail Light Trails** | Extruded quad strip ribbon mesh (`_e`) | `NT = 40` trail segments per light | Red motion streak trails following vehicle taillights at night |

### 6.2 Particle System Deficiencies
1. **Neon Underglow Missing**: No meshes, materials, point lights, or ground decals exist for vehicle underglow.
2. **Skid Mark Eviction**: The 3200-quad buffer wraps around rapidly during extended drifting sessions (e.g. Twin Peaks drift zone), causing earlier tire marks to vanish within seconds.
3. **Exhaust Flame Dynamism**: Exhaust flames are fixed static 2D quad sprites with scaling rather than dynamic particle emitters with fluid turbulence, smoke curls, and dynamic point light emission on the road/bumper.

---

## 7. Map Representation & Navigation

### 7.1 Minimap (`miniC`) and Fullscreen Map (`bigmap`)
The game implements a dual map architecture (`xT` tile map fallback and `kT` vector map):
- **Minimap Canvas (`#miniC`)**:
  - Dynamically sized circular/squircle HUD element (top-right by default).
  - Configurable rotation: `heading` (tracks vehicle orientation) or `north` (fixed north up).
  - Displays street geometry, shorelines, player marker, traffic vehicles (with color-coded icons: yellow cab, blue bus, red cop), and active navigation path.
- **Fullscreen Map (`#bigmap`)**:
  - Toggled with `Tab` or `G` key.
  - Supports smooth pan, pinch/scroll zoom, `F` (fit all city bounds), `O` (toggle north/heading orientation).
  - Displays:
    - Street names with highway route shields (`US-101`, `I-80`, `I-280`, `Route 1`).
    - PR Stunt badges (speed traps with radar icon, speed zones, drift zones, danger sign jumps).
    - Landmarks with custom icons (Golden Gate Bridge, Bay Bridge, Coit Tower, Lombard St, etc.).
  - **Fast Travel**: Clicking any valid road segment prompts "Teleport here", teleporting the vehicle via `c0.go(target)`.

### 7.2 GPS Guidance & The Autopilot Conflict
- **3D Chevron Mesh (`yz`, `GuideArrows`)**:
  - A dynamic instanced chevron ribbon (`this.mesh`, name `"GuideArrows"`) projects arrows onto the road surface along the navigation spline.
  - Color encodes braking recommendation: Green (maintain throttle), Orange (brake), Red (overspeed for upcoming curve).
  - Floating 3D billboard turn arrows (`this.icons`, `GuideTurn`) appear ahead of upcoming sharp turns.
- **The Core Conflict**:
  - When the player selects a destination pin on the fullscreen map, line 4032014 triggers:
    ```js
    mn.setDest(target);
    mn.mode !== "l5" && mn.setMode("l5"); // FORCES Level 5 Autopilot!
    ```
  - In manual driving mode, the guide chevrons are suppressed unless racing (`qn.active`) or if the user enabled `brakeLine: "always"`.
  - There is currently no concept of a "Manual GPS Destination Mode" where the player drives manually while following a high-visibility route ribbon.

---

## 8. Gap Analysis against R2 & R4 Requirements

The following matrix cross-references each requirement from `ORIGINAL_REQUEST.md` against existing code and defines the implementation obligations:

| Requirement | Original Request Spec | Existing Code State | Identified Gaps | Technical Obligation |
|---|---|---|---|---|
| **R2.1 Dynamic Day/Night Cycle & Weather** | Seamless transition between midday, golden hour, night with streetlights, and rainy weather. | 6 discrete presets in `aa` (`noon`, `golden`, `fog`, `rain`, `dusk`, `night`). Switched via `T` key or pause menu. Web Worker sky dome generator. | 1. No continuous clock progression.<br>2. Transitions are instantaneous jumps without smooth lerping.<br>3. Weather (rain) is a static preset, not dynamic. | Create a `DayNightCycle` controller that advances time continuously, smoothly interpolates sky/sun/fog/light parameters, and dynamically triggers weather events. |
| **R2.2 Wet Road & Dynamic Reflections** | Asphalt with wetness shader and dynamic reflections of buildings and streetlights in rain. | WGSL shader with `wa = max(wet, damp)`, puddle thresholding with 2-layer simplex noise, SSR depth raymarching, and anisotropic GGX streaks (`gHAN`). | 1. Static wetness uniform without dynamic accumulation or drying.<br>2. SSR reflections miss off-screen objects without fallback. | Implement dynamic wetness accumulation curve that builds up when raining and evaporates over time, modulating `wet` and `pud` parameters. |
| **R2.3 GPU Particle Effects** | Tire smoke and persistent skid marks during braking/drift, exhaust/nitro flames at full throttle, and neon underglow. | `AE` particle engine: 3-tier smoke points, 3200-quad skid mark ring buffer, crash sparks, 2D nitro/backfire sprites, falling rain lines. | 1. **Neon underglow is completely missing**.<br>2. Skid marks overwrite too quickly (no persistent baking).<br>3. Nitro flames are static 2D quad sprites. | 1. Implement neon underglow mesh/light system under vehicle chassis with configurable colors.<br>2. Expand skid mark capacity or implement decal projection.<br>3. Upgrade nitro exhaust to multi-particle flame jets with ground light casting. |
| **R2.4 HUD & Dynamic Camera** | Optimized speedometer, high-speed motion blur, and realistic dynamic camera shake on impacts and bumps. | SVG speedometer (`dial`, `spd`, `gear`, `rpm`, `nos`), velocity-reprojected camera motion blur (`vsVelI`), and multi-layer camera shake/vibration. | 1. Speedometer lacks integrated mission/pursuit heat displays.<br>2. High-speed FOV surge (nitro kick) could be enhanced. | Extend HUD with mission widgets (heat meter, drift multiplier, race timer) and enhance camera FOV warp during nitro activation. |
| **R4.1 Active GPS Navigation** | 3D guide line projected directly on road surface or directional arrows to selected destination. | `yz` (`GuideArrows`) chevrons and `GuideTurn` billboards exist, but are tied to Autopilot L5 or racing. | Setting a destination in free roam forces autonomous Level 5 driving. Manual driving hides the guide path unless `brakeLine: "always"`. | Decouple GPS routing from Autopilot L5. Allow setting destination pins in manual mode with a dedicated high-visibility 3D GPS navigation path. |
| **R4.2 Extended Bridge Routes & Circuits** | Full access onto Golden Gate Bridge and Bay Bridge to viewpoints, highway speed runs, closed park circuits. | Bridges are modeled (`M2`, `S2`), but terminate in turnaround loops. Highways (`US-101`, `I-80`, `I-280`) exist. Park boundaries exist. | 1. Bridges force U-turns before reaching scenic overlooks.<br>2. Park routes lack configured closed race circuits with barrier placements. | 1. Open bridge exits to scenic belvederes / overlook turnouts (Golden Gate Vista Point, Yerba Buena overlook).<br>2. Define closed circuit edge sequences in Golden Gate Park and Presidio. |
| **R4.3 Minimap & Fullscreen Interactive Map** | Clear marking of events, speed traps, garages, with Fast Travel teleportation. | Fullscreen map (`QB`) & minimap (`kT`) plot speed traps, drift zones, jumps, traffic, and landmarks. Click-to-teleport is supported. | 1. **Garages are NOT marked on the map**.<br>2. Checkpoint races and pursuit hotspots lack dedicated map badges.<br>3. Fast travel requires clicking roads rather than clicking event/garage icons directly. | 1. Add garage icon markers (`icon: "garage"`) to map data.<br>2. Add mission markers (races, police pursuits) to the map.<br>3. Enable direct 1-click fast travel when clicking event badges or garages. |

---

## 9. Recommended Architectural Integration Plan

To implement R2 and R4 without disrupting the existing modularity:
1. **Environment Controller (`EnvironmentManager`)**:
   - Wrap `aa` presets into a continuous interpolation engine (`lerpSkyState(stateA, stateB, factor)`).
   - Advance sun position along an astronomical arc: `sunEl(t)`, `sunAz(t)`.
   - Update `sn` (directional sun), `Yt.fog`, `_.toneMappingExposure`, and sky environment textures continuously or at stepped intervals (e.g., every 500ms).
2. **Dynamic Weather Manager (`WeatherSystem`)**:
   - Implement wetness accumulation: when raining, `wet` increases from `0.0` to `1.0` over 30 seconds; after rain stops, `wet` decreases from `1.0` to `0.0` over 90 seconds.
   - Modulate rain particle density in `AE.rain` and puddle splash frequency in `AE.splash` proportionally to current precipitation intensity.
3. **Vehicle Neon Underglow (`VehicleUnderglow`)**:
   - Attach a low-altitude rectangular quad mesh (`UnderglowMesh`) beneath the vehicle chassis with additive blending (`THREE.AdditiveBlending`), textured with a soft radial falloff neon glow.
   - Position a colored point light (`THREE.PointLight`) below the vehicle chassis casting soft light on the asphalt.
   - Expose color selection in the Garage UI (`#garageBtn`).
4. **Enhanced GPS Navigation (`GPSNavigationSystem`)**:
   - Provide a `setManualDestination(x, z, label)` method on the router.
   - Keep manual control active while feeding the computed A* road path to `GuideArrows` (`yz`), rendering high-visibility neon cyan/green chevrons and distance-to-next-turn HUD prompts.
5. **Map Markers & Extended Routes**:
   - Add garage POI definitions to `place.json` / `mapLandmarks` with coordinates at major San Francisco hubs (e.g. Embarcadero, Downtown, Marina).
   - Configure closed park circuit loops in Golden Gate Park (e.g. John F. Kennedy Dr / Martin Luther King Jr Dr loop) with barrier placement arrays.
   - Expand bridge endpoints by placing scenic overlook parking pads with fast travel boards at Golden Gate Vista Point and Yerba Buena Island.
