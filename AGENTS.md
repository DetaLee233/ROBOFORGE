# AGENTS.md

## Project

**ROBOFORGE / 机甲工坊** — a browser 3D game built with Three.js (r128, loaded from CDN as a global).
Robocraft-like: build a vehicle from parts, then fight a 5v5 PVE battle. No build step, no bundler,
no ES modules — everything is classic `<script>` files loaded in order by `index.html`.

Open `index.html` directly (works from `file://`; CDN needs internet) or serve the folder.

## Hard rules

- **Classic scripts only.** Never add `import`/`export` or `type="module"`. Top-level `class`/`const`
  declarations are shared globals across scripts; keep new global names unique.
- **Register new scripts in `index.html`** in dependency order, and in the test bundles' `order`
  array (see Testing).
- **Each part lives in its own file** under `js/parts/` and must be registered in `js/parts/registry.js`
  (`classes`, `meta`, `order`). Weapons extend `Weapon`; movement parts extend `MovementPart`;
  blocks extend `Part`/`Block`.
- **Never edit source files with PowerShell** `Get-Content | Set-Content` / `-replace`. It corrupts the
  UTF-8 Chinese text and merges lines. Use the edit/write tools instead.
- No comments unless they already exist in the surrounding style (the codebase uses concise Chinese
  comments — match it).
- Do not add a build system or dependencies.

## Architecture

```
index.html            entry; loads three.js + all scripts in order
css/style.css
js/main.js            App bootstrap: renderer, Input, screens (hangar/editor/library/game), main loop
js/core/
  events.js           EventBus singleton `Bus` + event-name constants `EV`
  utils.js            math/noise/grid helpers `Utils`, CELL, GRID_NEIGHBORS, BALLISTIC_GRAVITY
  config.js           global `Config` — tunable movement/physics/mass/AI constants shared by
                      Vehicle / Game / AI (gravity, MAX_THRUST, MAX_AIR, mass clamps, jump/dash, ranges)
  settings.js         persisted `Settings` (invert mouse/steer, sensitivity)
  materials.js        cached materials `Materials.get(kind, team)`
  audio.js            procedural WebAudio `AudioFX`
  input.js            `Input` (keys/mouse/pointer-lock)
  orbitcam.js         `OrbitCam` (hangar/editor camera)
js/parts/             Part <- Block/ReinforcedBlock, MovementPart <- Wheel/Track/Leg/Rotor,
                      Weapon <- MachineGun/GrenadeLauncher, plus functional modules
js/vehicle/
  blueprint.js        JSON schema, validate/normalize (+ per-key assignment), buildVehicle/grow
  vehicleLibrary.js   builtin + user-saved vehicles; randomNear(cost)
  vehicle.js          runtime: parts, damage/connectivity, physics (drive/omni/fly), firing
  projectile.js       ballistic projectiles with gravity + AOE
js/world/arena.js     center-symmetric terrain, covers, cliffs, air walls, spawn points; `exclusions`
                      keep covers/cliffs out of capture-mode objective zones
js/ai/aiController.js AI driving/aiming: keeps engagement range, dodges incoming projectiles, seeks
                      cover when under fire / low HP, uses the battery module, jumps (legs), flies
                      (rotors), switches weapon groups, and aims at priority parts (disarm / immobilise /
                      finish weak targets) instead of hull centre; in capture mode drives to objectives and
                      returns to base to repair when hurt.
js/game/shield.js     `Shield` — reusable spherical faction barrier (allies pass, enemies blocked)
js/game/capture.js    `CapturePoint` + `CaptureMode` — "夺点" mode: 3 mirror-symmetric capture points,
                      base rings/octahedra/shields, progress accumulation, win logic (`CAPTURE` constants)
js/game/game.js       match manager (`mode`: 'tdm' | 'capture'), camera (3rd person / ADS), HUD, explosions
js/ui/                hangar, editor, library page, thumbnails, hud, settings panel
```

Patterns: OOP entities, functional helpers on `Utils`, event-driven via `Bus` (`EV.*`).

## Key gameplay constants

- Budget 2000. Block 1/200hp, reinforced 3/400hp, wheel 30/1500, track 45/4500, leg 100/2000,
  rotor 80/1500, MG 80/4000hp, grenade 240/4800hp, railgun 300/2000hp, computer 100/500, battery 200/1000.
- Weapon/module parts occupy a 3×3×3 grid footprint when building (models are 1.5–2.8 cells).
- Weapons share one vehicle energy pool (`vehicle.weaponEnergy/MaxEnergy`, 1000, regen 100/s).
  Per-shot cost: MG 5.8 / 200 direct + 10 AOE (radius 0.75 cell); grenade 75 / 800 direct + AOE
  (93 center → 3 at edge, radius 9.6 cells), range 720 (map-wide), fast/low-drop (speed 200, gravity 26).
  Grenade aiming: with a ballistics computer → auto-solve to the crosshair point; without → "artillery"
  (fires along the crosshair, no drop compensation, so raising aims farther). MG full-auto drains pool ~1 min.
- Railgun (充能射线炮, 300): hold to charge (220 energy/s, 3s max), release fires a piercing beam
  (radius grows 0.15 → 1.5 cell with charge) hitting every vehicle along the ray; area dmg 10→400 plus
  centre 15→600; destroyed blocks 10% explode (3 cells, 50 friendly-fire). 1s cooldown, needs 1 gun.
- Fire rate: `Vehicle._fireWeapons` fires one ready weapon per tick at rate `fullRate * min(1, count/required)`
  (MG fullRate 26.7/s required 4; grenade 4/s required 2) — fewer guns = longer cooldown; more than required
  adds no rate. Only `weapon.lobbed` (grenade) uses honeycomb cells (`Utils.hexOffsets`) and snaps the
  aim point to terrain when near ground; direct-fire guns (MG, with its small hit AoE) aim at `aimPoint`.
- Ballistics computer: shared energy max -200, recoil/spread -50% (no stacking). Battery: switch key
  adds +800 to the shared pool, 12s cooldown.
- HUD: cooldown ring around the crosshair (`#cd-ring`, `--cd` = readiness from `Vehicle.groupCooldownRatio`);
  `#grenade-sight` = "丰" reticle (vertical + 3 equal horizontal bars) while a lobbed grenade is active.
- Vehicle destroyed when remaining part HP < 20% of max. Disconnected parts are destroyed.
- Capture mode (`CAPTURE` in capture.js): 3 mirror-symmetric points (radius 10 blocks, capture 15s, contested
  pauses; an owned point can be reclaimed — 15s neutralise + 15s recapture) + bases at the diagonal spawns
  (radius-15 ring). Owning points adds 1% / 15s each to that team's end progress; bases spawn a faction
  octahedron (edge 3→8) + radius-30 `Shield` once owned. Holding all 3 points disables the enemy base shield,
  exposing its octahedron (progress ≤30% has a 30k hidden-HP buffer; damage is 1% = 1000 HP). Win at 100%
  progress or by destroying the enemy octahedron. Destroyed vehicles respawn at their base after 10s; a
  damaged vehicle sitting in its base radius is fully repaired in 3s (`Game._updateRepair`). `CaptureMode.zones`
  keeps arena covers/cliffs out of the objective areas.
- Matchmaking: `Game._spawnTeams` fills a shuffled "bag" of cost-near library blueprints (excluding the
  player's own), refilling when empty, so AI fleets stay diverse instead of cloning the player.
- Blocks are full-cell (no gaps) and only render exposed faces (`culledBoxGeometry`); `dir`-mounted
  blocks rotate their face normals by `Utils.FACE_MATS[dir]` before neighbour culling.
- Camera: third-person at `(topY|halfLength) + camOffset` blocks (wheel adjusts 5..10 blocks);
  view/aim strictly along `_camDir` (ground pitch up to ~1.15 rad) so looking up isn't flattened;
  right mouse = ADS first-person zoom and makes own vehicle transparent.

## Testing

Headless suites live outside the repo (temp dir) and load the browser scripts into a `vm` context
with a real `three` + `jsdom`/`puppeteer-core`:

- `smoke.js`  — logic: constants, ballistics, damage/connectivity, library, physics, parts, etc.
- `domTest.js` — editor/library/HUD via jsdom
- `e2e.js`    — full page in headless Chrome (WebGL), console-error check

Run with `node <suite>.js` and env `RF_ROOT=<repo root>`, `RF_TMP=<temp node_modules dir>`.
When adding a new part/script, add it to the suites' `order` arrays too.
