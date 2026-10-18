## 2026-10-17T18:53:10Z
[Message] timestamp=2026-10-17T18:53:10Z sender=d7c1aaca-334c-4557-bb98-f39a48d70c24 priority=MESSAGE_PRIORITY_HIGH content=You are Worker Enhancements 1 (Archetype: teamwork_preview_worker).
Your working directory: c:\Users\Gabi\Downloads\game fly\.agents\teamwork\worker_enhancements_1
Dispatch file: c:\Users\Gabi\Downloads\game fly\.agents\teamwork\worker_enhancements_1\DISPATCH.md
MANDATORY: Read c:\Users\Gabi\Downloads\game fly\.agents\teamwork\ORIGINAL_REQUEST.md.
Also read PROJECT.md and the survey handoffs.

File Ownership:
You exclusively own:
- c:\Users\Gabi\Downloads\game fly\game_enhancements.js

Tasks:
Implement M2 (Graphics/Atmosphere/Neon/Particles/Camera), M3 (Fleet/Physics Arcade vs Sim/Turntable Garage carbon & tint), and M4 (Active 3D GPS navigation ribbon/Bridge scenic viewpoints/Map fast travel).
Attach all enhancements cleanly to window.__sf when loaded.
Verify your syntax via `node --check game_enhancements.js`.
Document your implementation and verification in c:\Users\Gabi\Downloads\game fly\.agents\teamwork\worker_enhancements_1\handoff.md.

# Worker Enhancements Dispatch: Graphics, Fleet, Physics & Map Navigation (M2, M3, M4)

## Mission
Develop `game_enhancements.js` providing engine extensions for graphics/atmosphere (M2), fleet/physics/garage (M3), and map/navigation (M4), integrating seamlessly with `window.__sf` without mutating core engine internals.

## File Ownership
You exclusively own:
- `c:\Users\Gabi\Downloads\game fly\game_enhancements.js`

## Inputs
- `ORIGINAL_REQUEST.md`: `c:\Users\Gabi\Downloads\game fly\.agents\teamwork\ORIGINAL_REQUEST.md`
- `PROJECT.md`: `c:\Users\Gabi\Downloads\game fly\PROJECT.md`
- Survey Handoffs 1, 2, and 3

## Requirements to Implement

### M2: Graphics & Atmosphere
1. **Dynamic Day/Night Controller**:
   - Continuous time-of-day progression clock (0-24h) with configurable cycle speed.
   - Smooth interpolation between atmospheric presets (`noon`, `golden`, `rain`, `dusk`, `night`) rather than instantaneous snapping.
2. **Dynamic Weather & Road Wetness**:
   - Real-time rain accumulation curve increasing puddle depth and road wetness during rain, and realistic drying curve when transitioning to clear weather.
   - Automatic activation of streetlights and vehicle headlights during night and rain.
3. **Under-Vehicle Neon Glow**:
   - Create 3D under-chassis neon mesh and downward-projecting point light on active vehicle with configurable colors (cyan, magenta, lime, red, gold, purple, white) and intensity.
4. **Enhanced Tire Particles & Nitro Flames**:
   - Extended tire smoke generation during drift and braking; persistent skid mark deposition.
   - 3D exhaust flame plumes at full throttle / nitro boost.
5. **HUD & Camera Dynamics**:
   - Speedometer motion blur styling at high velocity.
   - Camera impact shake on vehicle collisions and road jumps.

### M3: Fleet & Physics Customization
1. **Extended Vehicle Fleet**:
   - Add playable Police Interceptor (`police`) and Classic V8 Muscle car (`muscle`) into `window.__sf.hs` and `e2` unlocked vehicle array with custom acceleration, top speed, handling, mass, and engine acoustics.
2. **Arcade vs. Simulator Handling Switch**:
   - Expose `window.__sf.setHandlingMode("arcade" | "simulator")`.
   - "Arcade": higher lateral grip, assisted drift initiation, fast counter-steer, faster nitro regeneration.
   - "Simulator": realistic tire slip angles (Pacejka model), required throttle modulation, manual traction control/ABS toggles, standard nitro.
3. **Turntable Garage Customization**:
   - Add carbon fiber finish (`carbon`) with woven normal mapping/specularity into finish registry `kp`.
   - Add window tinting options (`light`, `medium`, `dark`, `limo`) modifying car glass opacity and tint color in the 3D garage turntable studio.

### M4: Map, Navigation & Bridges
1. **Active 3D GPS Guidance Ribbon**:
   - Expose `window.__sf.setGPSDestination(x, z, label)`: projects 3D road chevron ribbon (`RaceCarpet`) on the road surface guiding human player to destination in manual free roam.
   - Expose `window.__sf.clearGPS()`.
2. **Bridge Viewpoint Access**:
   - Provide scenic viewpoint turnout waypoints at Golden Gate Bridge Vista Point and Bay Bridge tunnel/pier.
3. **Map & Fast Travel Enhancements**:
   - Enable click-to-teleport Fast Travel to registered map markers (garages, vista points, speed traps).
   - Register garage POI markers on minimap and fullscreen map.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
