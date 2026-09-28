# Gameplay Sections — implementation plan

Written 2026-09-28. How the eighteen sections designed in
[`LEVEL_SECTIONS.md`](LEVEL_SECTIONS.md) are built into Missions. This is the
engineering side of that document. It covers where each section goes in each
territory's run, the framework they share, the nine kits, the notes for building
each section, how they are tested, and who owns which files.

**Live state is kept in [`SECTIONS_STATUS.md`](SECTIONS_STATUS.md).** Read that
first when picking the work up. It says what is built, what is merged, and what is
next. This file is the plan; that file is the state. Update the status file with every
commit that changes a section's state.

## 0. The rules every section is built to

These come from the brief and are not negotiable. A section that breaks one is
not done.

1. **Purely additive.** Every existing zone, stage and set piece stays exactly as
   it is. Sections are inserted **between** existing stages as stages of their
   own. The Storm Docks and the Ringworld are single stages today, so their chains
   are **split** at a door into two or three stages, with every zone kept, and
   the sections go in the splits. `?sections=off` removes every section stage and
   gives back the run as it was. That flag is the regression baseline and the
   escape hatch.
2. **Every run still opens on its wide outdoor trailhead.** No section is ever
   the first stage.
3. **Each section is its own game.** It has its own verb and its own escalation,
   so the start, the middle and the end play differently. It ends on a climax, not
   a timer running out. It must be fun played alone at one player and at four.
   Tune it until it would be worth playing on its own.
4. **Nothing can be left behind.** Section boundaries are **one-way**: no back
   door into or out of a section. Nothing a section needs lives outside it. Every
   tool it asks for (a bike, a thumper, a flare, the boosters, a turret) is handed
   out or re-spawned *inside* it. A lost tool comes back, for example a fresh bike
   at the last gate. Checkpoints are granted by progress, never picked up. A player
   who falls, dies or lags is returned **forward** to the party, never sent back.
   No section can soft-lock. If the party wipes, the section resumes from its last
   checkpoint with its hazards reset to that point.
5. **The way forward and the edges are obvious from the scene.** The way on is
   the brightest, most framed thing in the direction of travel. Edges are
   physical and read as edges: walls, rails, a void, lava, a drop, a tank row. They
   are never an invisible wall in open space. Where the edge is a void or a hazard,
   stepping over it returns you forward to the checkpoint with the off-path banner,
   as the existing stages do.
6. **A realistic continuation.** Each section **enters** through a structure that
   matches the door the previous stage leaves by, and **leaves** into one that
   matches how the next stage begins. The previous stage's door is a real transport
   door (a door in rock, a hull lock, a gate), so the section starts just inside
   one. Examples: a tunnel mouth, an airlock, a skiff landing behind the door, a
   lift car. The section's end is a lift top, a snowbank at a cave mouth, a hatch or
   a landing. Every structure at an end is built so it cannot be a door to
   nowhere: it is cut into a wall that reaches past the border, or it belongs
   to a vehicle, or it is a hole in the floor. The transition card names where
   the party is going, as it does today.
7. **Stand-ins first.** Every sculpt a section wants has a procedural stand-in
   that ships and reads correctly. The authored model upgrades it when the file
   lands, through the existing `loadProp`/`authoredProp` path. No section waits on
   an asset.

## 1. Where each section goes

The chains below give each territory's run in order. **New** marks a section
stage; *split* marks a stage boundary created by cutting an existing
single-stage chain at a door. Beat labels are the existing ones from
`TEXT.missions.rooms`.

| Territory | Run with sections (⇒ is a transport door) |
|---|---|
| Dune Sea | A trailhead → corral → dune road ⇒ B ravine → cistern ⇒ **Barge Run** ⇒ **Worm Sign** ⇒ C fighting pit → … → the Old One's hollow |
| Spice Run | A docking bay → gantries → outer yard ⇒ **Guns of the Frigate** ⇒ B spice vault → loading gantry ⇒ **Ring Walk** ⇒ C crew catwalks → reactor ring → hold of the prize |
| Lava Flats | A ash flats → bike pool → causeway → town gate ⇒ B garrison yard → magistrate court ⇒ **Magma Run** ⇒ **The Chimney** ⇒ C crossing → cantina row → rancor pen |
| Crevasse | A rim shelf → frozen gallery (ends at the nest mouth's door) ⇒ **Glacier Chute** ⇒ **Lamplight** ⇒ B queen tunnel → … → breaker deep |
| Storm Docks | A quay → fish market → freighter hold → cold stores → trawler deck ⇒ *split* ⇒ **The Squall** ⇒ **Run the Pier** ⇒ A2 pier heads → mamacore pool |
| Refinery | A tanker yard → pipe run (ends at the intake door) ⇒ **The Line** ⇒ B the plant (barrel stores → reactor floor) ⇒ **Lights Out** ⇒ C reactor crown → loading field |
| Great Forge | A glassed plain → glass corral → glass highway → shattered gate ⇒ B undercroft → armoury vault ⇒ **Hold the Forge** ⇒ **Covert Sky** ⇒ C glassed court → forge steps → sleeper's basin |
| Ringworld | A tram stop → market arcade ⇒ *split* ⇒ **Tram Top** ⇒ A2 night-side row → terminus → sentinel walk → plaza ⇒ *split* ⇒ **The Mark Runs** ⇒ A3 service spine → high street terrace |
| Prison Rig | A landing deck → gantry run ⇒ B the sea ⇒ **One Way Out** ⇒ C work floor → supervisor deck ⇒ **The Lift** ⇒ D assembly deck → … → moon pool deck |

Why each goes where it does, and how it joins the stages on either side:

- **Barge Run** (Dune Sea, B ⇒ C). The cistern court's far door is already *an
  airlock onto the far side of the mesas*. It opens onto a rock **skiff landing**
  cut into the mesa foot: a ledge, mooring posts, the skiff tied up. The barge is
  pulling away across the open dunes. The run ends when the helmsman dies and the
  barge **grounds** on a sandbank. The party jumps down to the sand at the edge of
  the worm country.
- **Worm Sign** (after the Barge Run). It starts at the grounded barge, which
  stays in view behind the party, and ends at the fighting pit's rim. Stage C
  starts there, so the worm that hunts the crossing is the sandworm the party
  then fights as the lieutenant.
- **Guns of the Frigate** (Spice Run, A ⇒ B). The outer yard's lock is a
  **docking-collar door**. Its far side is the frigate's dorsal hatch: the party
  climbs out onto the hull as the frigate casts off to run the pirate blockade
  round to the station's far dock. It ends when the corvette is down and the
  frigate docks. The dorsal hatch is the way down, into the spice vault (B).
- **Ring Walk** (Spice Run, B ⇒ C). The loading gantry's far door is a
  maintenance airlock onto the habitat ring's **outer hull**. The party walks a
  quarter of the ring and ends at the airlock that opens onto the crew catwalks
  (C).
- **Magma Run** (Lava Flats, B ⇒ C). The magistrate court — since the level
  audit a hall the party walks through past two lookouts, the lieutenant having
  moved out to the town gate — has a far door that leads down
  a ramp to the **lava tunnels under the town**, where a pirate crew keeps its
  bikes at a dock on the lava river. The camp at the dock is the
  steal-the-bikes beat. The river runs out of the tunnels into an open canyon and
  ends where it pours into a **magma chamber**. There the bikes stop at a basalt
  landing at the chimney's foot.
- **The Chimney** (after the Magma Run). The vent floods as the party arrives.
  They climb out of the chamber, and the lip is the edge of the glass fields,
  where stage C starts.
- **Glacier Chute** (Crevasse, A ⇒ B). The frozen gallery runs on to the nest
  mouth, and its far door in the glacier face opens
  onto an ice **tunnel that tips downhill**. A short walk in, the floor gives way
  and the chute begins. It ends in a **snowbank** in the dark at the bottom.
- **Lamplight** (after the Chute). It starts in that snowbank: the brood's
  inner caverns. The burning web wall at the far end opens onto the queen tunnel
  (B).
- **The Squall** (Storm Docks, A ⇒ A2). After the trawler deck fight (since the
  level audit the Storm Docks' lieutenant, on a deck with the sea both sides) the
  trawler's wheelhouse door is the transport: the trawler casts off. The squall
  is the crossing. It ends when the trawler comes alongside the far pier.
- **Run the Pier** (after the Squall). It starts on that pier. The mamacore wakes
  and chases the party down the whole pier chain, which ends at the pier heads
  (A2).
- **The Line** (Refinery, A ⇒ B). The pipe run is a lane between racks that ends
  at the intake's blast door, set in the rock face; it opens onto the
  intake **processing floor**. Its far door is the plant (B).
- **Lights Out** (Refinery, B ⇒ C). The plant's rear airlock, the far door of
  the reactor floor (the lieutenant's room, now the plant's last, walled round
  the reactor atrium), opens onto the **tank
  farm behind the plant**, under the plant's smoke, with searchlights up. It ends
  at the stair to the reactor crown (C).
- **Hold the Forge** (Great Forge, B ⇒ C). The armoury vault's far door is the
  covert's hidden **forge chamber**. It is a round hall under an open shaft to the
  sky, with three tunnels coming in. The Armorer forges the flight-rated boosters
  and the beskar here. The reward is **+25 max HP** for the rest of the run.
- **Covert Sky** (after the Forge). It starts at the shaft's foot with the new
  boosters on. The party flies up the shaft into the ruined city, flies the rings
  to the dome, and dives through the breach into the glassed court (C).
- **Tram Top** (Ringworld, A ⇒ A2). The market arcade's far end is a **tram
  platform**, and the transport door is the platform gate. The tram delivers the
  party to the night-side row (since the level audit a dark street with two
  lookouts in it — the run's breather — rather than a dead-end canyon fight).
- **The Mark Runs** (Ringworld, A2 ⇒ A3). After the plaza (since the level audit
  where the enforcer, the lieutenant, is fought) the mark bolts up a fire
  stair. The plaza's way on is the stair door to the roofs. The chase ends on the
  landing pad above the service spine. The pad's stair down is the way into A3.
- **One Way Out** (Prison Rig, B ⇒ C). The moon pool shaft ends at a lit pool
  ring set in the rig's foundation wall. Surfacing through it comes up
  inside the **cell blocks**, where the riot starts. The stair core is the way up to
  the work floor (C).
- **The Lift** (Prison Rig, C ⇒ D). The supervisor deck's far door is already *the
  lift*. It ends when the lift breaks out onto the top decks (D).

## 2. The framework

### 2.1 A section is a stage

`StageSpec.kind` gains `'section'`, and `StageSpec.section` names which one
(`SectionId`, one of the eighteen ids in §4). A section stage has
`zones: []` and `links: []`, so the beat count and the label check in
`mission-layouts.ts` are unchanged. `Campaign.raise` sees the kind and hands the
build to the section's own module instead of `buildStage`.

```
src/sections/
  api.ts          SectionDef, SectionInstance, SectionContext — the contract
  index.ts        the registry: SectionId → SectionDef
  context.ts      builds a SectionContext for a stage (geometry + spawn helpers)
  kit/            shared systems K1–K9 (one file each, owned per §3)
  <id>.ts         one file per section (a big one may be a folder)
```

The contract (`src/sections/api.ts`):

```ts
interface SectionDef {
  id: SectionId;
  /** build the geometry and the rules; called once when the stage is raised */
  build(ctx: SectionContext): SectionInstance;
  /** model/texture ids the stage asks for, for warming (prefetch.warmStage) */
  assets?: string[];
}

interface SectionInstance {
  /** player spawn points, in order of slot */
  starts: THREE.Vector3[];
  floorY: number;
  ceilingY: number;
  groundAt(x: number, z: number): number;
  contains(x: number, z: number): boolean;
  /** the golden path, for guidance and the test walker */
  path: THREE.Vector3[];
  /** ticked while the match is fighting */
  update(dt: number): void;
  /** true once the section is won: the campaign plays the transport and raises the next stage */
  readonly complete: boolean;
  /** the one objective: the beacon, radar pip, screen marker and HUD line */
  objective(): { pos: THREE.Vector3; label: string; hint: string; beacon?: boolean };
  /** where a fallen player of this slot comes back: always forward, with the party */
  respawnSpot(slot: number): THREE.Vector3;
  /** a body is off the playable area (fell, went over the edge): default below groundAt − 9 */
  offPath?(pos: THREE.Vector3): boolean;
  /** per-player HUD panel: meters and a status line (K5/K6/K8 use it) */
  hud?(slot: number): SectionHud | null;
  /** test autopilot: the inputs a bot would give this player this frame to make progress */
  autopilot(slot: number): Partial<FrameInput> & { yaw?: number };
  dispose(): void;
}
```

What the campaign does for a section stage:

- `raise` builds it through the registry, sets the ceiling and `dropHeight` from
  it, and applies `StageSpec.world` (fog, gravity, traction, background, roofed)
  exactly as for any stage. It spawns no garrison, defenders or rides; the section
  owns its own.
- `update` runs the shared parts it runs for any stage: the settle veil, the
  transport beat, the pickups, the off-path catch (through `section.offPath` and
  `section.respawnSpot`) and the ceiling note. Then it calls `section.update(dt)`
  and returns. When `section.complete` becomes true, it calls
  `beginTransit(stageIdx + 1)`.
- `objectivePos`, `objectiveLabel`, `hint` and `respawnSpot` delegate to the
  section.
- **One-way:** `layDoors` builds no back portal for a stage whose predecessor is a
  section, and a section stage has none either.
- Difficulty: `ctx.wave` is `rampWave(beat0)` for the section's position in the
  run. Sections draw squads with `ctx.squadFor(wave, budget)` and spawn with
  `ctx.spawn(kind, at)`, the same tables and placement the zones use.

### 2.2 The context a section is given

`SectionContext` (`src/sections/context.ts`) is the only way a section touches the
world, so teardown is automatic:

- `game`, `board`, `spec` (palette, ridge), `stageSpec`, `index`, `beat`,
  `wave`, `players`.
- `group`: a `THREE.Group` under `board.group`, removed on dispose.
- `box(...)`, `cyl(...)` and `hazard(...)` add a collider or hazard **and** its
  mesh, recorded for dispose. `mesh(obj)` and `own(disposable)` track anything
  else.
- `prop(id, at, yaw, size, solid?)` places an authored sculpt through `loadProp`,
  with a procedural `fallback()` builder for when the file is missing (rule 7).
- `mats`: palette materials plus the stage's tileables (`tile(name, rx, ry)`).
- `spawn(kind, at, opts)`, `squadFor(wave, budget, opts)`,
  `drop(kinds, spots, cb)` (a carrier pass), `placeNear(pos, kind)`.
- `announce(title, sub)`, `sting(name)` (audio cues that exist in `audio`).
- `checkpoint`: a `Vector3` the section moves forward. The default `respawnSpot`
  uses it with the slot offsets the campaign uses.

### 2.3 Hooks the framework puts into the engine

These are small, and every kit uses them rather than editing the engine's
internals. Each is a single field that is `null` or absent outside a section, so
the rest of the game is untouched:

| Hook | Where | For |
|---|---|---|
| `Game.sharedView: { camera: THREE.PerspectiveCamera } \| null` | `game.ts` render: one full-screen viewport | K1 rail camera |
| `Player.moveYaw: number \| null` | `player.ts`: the movement basis uses it instead of `cam.yaw` | K1 (the camera no longer steers), fixed-forward lanes |
| `Player.sectionMove: SectionMove \| null` | `player.ts`: `take(p, dt, input, game, realDt) => boolean` runs before vehicle/cover/water and may take the frame; `adjust(p, dt, input) => FrameInput` may rewrite the input | K7 slide/flight, K3 turret seat, the Magma Run lane |
| `Hud` section panel | `hud.ts`: renders `SectionInstance.hud(slot)` (label, 0–3 bars, one line) under the objective | K5, K6, K8 |
| `Campaign.section` | `campaign.ts` | the running section, for tests (`window.__game.campaign.section`) |

### 2.4 Flags

- `?sections=off` removes every section stage from every run, which gives the
  runs as they were before sections. The legacy suites run on this.
- `?section=<id>` starts the Missions run **at** that section's stage on its
  territory, with the ramp as if the party had got there. Use it to test, to
  tune and to demo. Pick the section's own territory on the select.

### 2.5 Tests

- `tools/test-missions.mjs` runs on `?sections=off` for the v3 grammar checks,
  unchanged.
- `tools/test-sections.mjs` is the new suite. For every registered section it
  boots its territory with `?section=<id>`, checks the build (starts on ground,
  `contains` their feet, the objective off their feet, the path walkable), then
  drives every player with `section.autopilot(slot)` stepped at 1/30 s. It checks
  that the section completes within its time budget and the next stage is raised.
  It also checks that nobody ends outside `contains`, and that a wipe halfway
  resumes at a checkpoint and can still complete. **A section whose autopilot
  cannot finish it is not done.**
- A kit or section may add a focused suite `tools/test-section-<name>.mjs` for its
  mechanics, for example: the noise meter fires the worm, a turret overheats, the
  magma pauses on a valve, a lamp dazzles a krykna.
- `tools/test-sections.mjs` also runs one full liberation walk on each territory
  **with** sections, using the existing path walker for zone stages and the
  autopilot for section stages.

### 2.6 As built (2026-09-28) — read before writing a section

The framework is in, with **The Chimney** (`src/sections/chimney.ts`) as the
reference section. Copy its shape. What the build settled that the plan above
did not say:

- **Register in three places:** `src/sections/index.ts` (the def),
  `src/sections/ids.ts` (`BUILT_SECTIONS`, and `SECTION_ASSETS` for any model
  ids you `ctx.prop`), and the placement already lists every id in
  `SECTION_PLACEMENT` (`src/world/mission-layouts.ts`). A section is left out of
  its run until it is in `BUILT_SECTIONS`, so the layouts can carry the whole plan.
- **Text:** `TEXT.sections.<id>` in `src/text.ts` has each section's `stage` and
  `title`. Add your own lines inside your own block only. Keep HUD hints under
  ~34 characters: the hint line wraps into the kill counter beyond that.
- **Build vs update:** geometry, colliders, hazards and props in `build`.
  Hostiles, rides (`ctx.rides(specs)`) and pickups (`ctx.pickup(pos)`) on the
  **first `update`**, because placement validates against the standing stage.
- **Height:** `groundAt` is one height per column. On stacked floors or decks,
  place bodies with `ctx.spawn(kind, at, { exact: true })` / `ctx.placeAt`, and
  respawn with `ctx.defaultRespawn(slot, at)`, which keeps `at.y`.
- **Hold to interact:** `FrameInput.interactHeld` (Y held, C on the keyboard) and
  `kit/interact.ts` (`Interactions`: `add`, `update`, `swallow` inside
  `sectionMove.adjust` so the press does not also take cover, and `hudFor` for the
  prompt and bar).
- **Several input hooks:** `kit/moves.ts` `composeMoves(...)` puts more than
  one `adjust`/`take` on the single `Player.sectionMove` slot.
- **Beacon:** return `beacon: false` from `objective()` wherever a sixty-metre
  column would be wrong (a shaft, under a roof, over a deck). The marker, radar
  pip and hint still guide.
- **Flight is universal.** Every playable either jetpacks (~28 m per burn, refills
  on the ground) or super-jumps (rises as long as A is held, no fuel). Design the
  vertical with that in mind. The Chimney shutters its holes so the climb is a
  sequence of held floors rather than a lift.
- **Tests:** `node tools/test-sections.mjs <id>` (env `PLAYERS`, `CHARS` —
  default mixes a jetpack and a super-jumper — and `HARNESS_PORT`;
  `CHROMIUM_PATH=/opt/pw-browsers/chromium` in the cloud sandbox). Every other
  suite runs with sections off (`tools/harness.mjs` sets `window.__sectionsOff`;
  `launch({ sections: true })` opts in). To eyeball a section, boot
  `/?section=<id>` and pick its territory.
- **Autopilot:** the one in the Chimney shows the pattern: a list of waypoints
  (`stand` or `air`, and `gate` for "wait here until this opens"), steered by yaw
  plus stick. Climb *beside* a ledge and step on; rest a jetpack to a full tank
  before a climb. It must finish the section at 2 and at 4 players with the suite's
  hostiles culled.

## 3. The kits

| Kit | File | Owner | API sketch |
|---|---|---|---|
| **K1 rail camera** | `kit/railcam.ts` | Ring Walk | `RailCamera(spline, opts)`: `update(players, dt)` frames the party's centroid on the spline at `lead` (0.45 of the frame) with a max speed, `lock(at)` / `unlock()` stops it for an arena, `reverse` puts the camera ahead of the party looking back (Run the Pier), `leash(players)` pushes laggards forward and re-forms the dead or stuck at the next rail gate. Sets `game.sharedView` and each player's `moveYaw` (stick "up" = along the rail), and turns on **twin-stick aim**: in a rail section the right stick aims the gun in the ground plane, soft-lock to the nearest target in that direction; mouse = ground reticle. The HUD merges the four panels into one strip while `sharedView` is set. Entering and leaving blend the viewports over 0.6 s. |
| **K2 treadmill** | `kit/treadmill.ts` | The Lift | `Treadmill(dir, speed)`: register scrolling `strip`s (a ground/wall plane whose UV scrolls), `conveyor` props (recycled ahead when they pass behind), `parallax` skylines. `spawnAhead(dist)` returns a world point that scrolls in. Speed changes are eased (a stop is a 2 s decel). The platform itself never moves in physics. |
| **K3 mounts** | `kit/mounts.ts` + `game/vehicles.ts` | Magma Run | Vehicle weapons: `VehicleDef.gun` (nose cannon: rate, heat, cone) and `VehicleDef.sideSwing` (the rider's own melee to a flank). `Vehicle.lane: SplineLane` (lane-guided: forward carried by the spline, stick = lateral + throttle band). A pillion seat (`Vehicle.pillion`). A **turret** kind: a `Vehicle` that does not move, with a yaw/pitch arc, heat, a gunner sight camera, and an auto-fire mode at half rate when unmanned. Used by Barge Run and Guns of the Frigate. |
| **K4 hazard front** | `kit/front.ts` | The Chimney | `RisingPlane(y0, rate)` with `pause(s)`, `surge(rate, s)`, `resetTo(y)`, a telegraph band and a kill/heat volume. `PathFront(path, speed)`: a line advancing along a path (the collapsing pier, the avalanche) with `pushBack(m)`. |
| **K5 objective bar** | `kit/objective.ts` | Hold the Forge | `DefendTarget(entity, hp)` gives enemies a target weight toward it and a HUD bar. `Progress(rate)` with `stall()` and `quarterMarks`. Both feed `SectionInstance.hud`. |
| **K6 detection** | `kit/detection.ts` | Lights Out | `Meter` per player (0–1) with decay. `noise(p, amount)` hooks on firing, jetpack, sprint and landing. `lightCone(origin, dir, angle, range)` fills the meter for anyone inside with line of sight. Thresholds fire callbacks. Worm Sign uses noise, Lights Out uses light. |
| **K7 locomotion** | `kit/locomotion.ts` | Glacier Chute (slide), Covert Sky (flight), The Squall (tilt) | `slideMove` (traction ≈ 0.03, gravity along the surface normal, steer = lateral force, dig-in drag, crouched surf pose). `flightMove` (jetpack without fuel cost, higher top speed, dash = boost, slam = dive). `deckTilt(roll)` (a lateral acceleration on every body toward the low side). All go in through `Player.sectionMove`. |
| **K8 pursuit** | `kit/pursuit.ts` | The Mark Runs | `Runner(path, forks)`: an enemy that follows a path with its own speed curve, reacting to the gap to the nearest hunter (waits when far, sprints when close) and to hits (stagger). It chooses a fork away from the most pursuers. |
| **K9 darkness** | `kit/darkness.ts` | Lamplight | Drops ambient and hemisphere light near zero while the stage stands. Hangs a `SpotLight` on each player's helmet along the aim (four at most, shadowless). Adds a focus beam on aim hold with a battery bar. `lit(pos)` tells enemy code whether a point is in a lamp or a warm pool. |

## 4. The sections

Ids are the file names under `src/sections/`. Sizes are from `LEVEL_SECTIONS.md`,
so the diagrams in `docs/sections/` match. Each section also carries the
continuity build from §1 and the rules from §0.

### Dune Sea

**`barge-run`** — the treadmill (K2) plus two turrets (K3). The skiff and barge
are static colliders and the dune strip scrolls at 14 m/s. The skiff's lateral
offset is a `Mover`, eased from 26 m to 9 m. Beats: broadside (the skiff's
deck-gun turret, barge shells telegraphed on the skiff's deck, swoops), then
close and board (two planks; the lower deck is an assault posted in the racks),
then the upper deck (the barge's heavy gun turret against two Tusken skiffs
coming in from astern, then the helmsman). Falling off either hull re-forms you
on the skiff. The skiff has HP; if it breaks up, the phase restarts on a fresh
skiff. Autopilot: the gunner fires the turret at the nearest target, the others
jump when the gap is under 10 m, then path through the decks.

**`worm-sign`** — K6 noise. The field is 180 × 110 m with 17 rock islands on
three routes. The worm is a burrowed controller that drives the existing
`sandworm` (erupt, sink). It targets the loudest player on sand once the party's
hunger crosses a threshold: 2 s ring telegraph, then the strike. Thumper posts
can be carried (hands full, no gun) and planted (1 s) as a 15 s decoy. The
Tusken camps are posted garrisons, and firing adds noise. Three checkpoint
islands. The mesa walls on both flanks are the boundary. The fighting pit's rim
rocks and the grounded barge behind the party frame the axis. Autopilot: hop
along the winding route, walking on sand, and plant a thumper when hunger passes
0.6.

### Spice Run

**`frigate-guns`** — K2 plus K3 turrets plus K5 (hull bar). The dorsal hull is
70 × 22 m with four quad guns, three boarding points and two hatches. Waves come
in over the radar arc from four bearings: drones, gun-dropships, then boarding
tubes that pour pirates onto the deck. The latch can be meleed or rocketed. The
corvette finale has three shield generators, a spinal gun with a lane telegraph
across the deck, and then its bridge. The hull bar is the fail state:
checkpoint every wave, restart from the last. Unmanned guns fire on their own at
half rate. Autopilot: slots 1–3 man guns, slot 0 fights on the deck.

**`ring-walk`** — K1. A torus section, 380 m across, with a 90° arc of hull spine
12 m wide and a conduit down the middle. It has four segments of about 75 m
joined by rail gates and three locks. Hazards: plasma vents on a cycle, 6–8 m
panel gaps at 0.45 g, a gun hatch turret, and the sensor boom sweep that calls
drones. The station hub and spokes are the backdrop, and the ring falling away
over the curve is the edge. Void falls re-form at the last gate. The camera
stands ~10 m out and a little along the axis. Autopilot: walk the rail, shoot the
nearest target, jump the gaps.

### Lava Flats

**`magma-run`** — K3 (lane, cannon, side swing, pillion). A 2.0 km lava river
lane, 26–34 m wide, in its own stage: tunnel, then canyon, then chamber. Bikes
are posted at the tunnel dock with a small pirate crew (a camp you fight or
slip). One bike per player, and a fresh one at every gate. The four stretches are
the run-in, the columns (fall telegraph, geysers), the falls (two terraces, hop
or ramp) and the gun barge (a flak skiff with crew). The fence at the chamber
landing ends it. Enemy riders use `updateRiding` with a lane brain. Autopilot:
throttle to cruise, lean away from telegraphed hazards, fire at the nearest rider
in the cone, swing when a rider is alongside.

**`chimney`** — K4 rising plane. A 22 m × 120 m shaft with a spiral of ledges,
some crumbling, and landings at 35, 70 and 100 m, each with a valve (hold 4 s:
pause 12 s). A central column stands in the lower half. Enemies come from above:
pirates, jetpack drops, boulders, a massiff pack. Heat within 6 m of the magma
stops fuel regen. There is a 2 m/s surge for the last 20 m. Death re-forms at the
highest landing reached by any living player. A wipe resets the magma to 12 m
below that landing. The shaft wall is the boundary. Autopilot: follow the ledge
path, burn up the gaps, and the slot nearest a valve holds it when the magma is
within 10 m.

### Crevasse

**`glacier-chute`** — K7 slide plus K4 avalanche. A banked spline channel of
1.5 km, with a fork that rejoins, four crevasses, an ice tunnel with krykna, and
eight flag gates. A player who falls or is caught re-forms at the next gate. It
ends in the snowbank. Channel walls rise on both sides throughout (the boundary),
and the crevasses read as black gaps in lit ice. Autopilot: steer to the channel
spline, jump at crevasse marks, and shoot.

**`lamplight`** — K9. Three dark chambers of 32–40 m, joined by crawl tunnels,
with three braziers per chamber (interact 2 s, a warm pool of light,
a checkpoint). Krykna avoid lamp cones, and a focused beam for 1.5 s dazzles.
Boldness: 60 s without a new brazier lit. Q throws flares in this section. When
all three braziers in a chamber are lit its web shrinks back. The last web wall
burns open to the queen tunnel. Egg sacs and brazier glow are the only other
light, so the lit braziers are the landmarks and the way on is the next unlit
brazier's ember. Autopilot: go to the nearest unlit brazier, interact, point the
lamp at the nearest krykna.

### Storm Docks

**`squall`** — K7 deck tilt, plus the rogue-wave push and the boom sweep. The
trawler deck is 36 × 14 m under way at sea (the sea strip scrolls, K2). Quarren
climb aboard with the `swim` arrival, lightning strikes the mast, and there are
three waves. Brace with the cover button at a rail, winch or deckhouse wall. The
rails and the sea are the boundary, and going over is the harbour beat: re-form
on the deckhouse roof. Autopilot: fight from the deckhouse lee and brace on the
wave horn.

**`run-the-pier`** — K1 reversed plus K4 path front. A 600 m pier chain in three
sections with gaps, obstacles and the warehouse pass-through. The mamacore is
under the collapse front. Firing into the mouth staggers it back 10 m. A caught
player re-forms at the leading edge after 3 s. Only when everyone is caught does
the section reset to the last gate. The pier edges and the sea are the boundary.
Autopilot: sprint the path, hop the obstacles, dash the gaps.

### Refinery

**`the-line`** — conveyor surfaces (a velocity added to bodies on a belt
collider), presses and arms (timed kill volumes with a telegraph strip), three
belt switches on the catwalks, and the smelter mouth. The hall is 110 × 26 m with
catwalks at 6 m. Walls and the smelter are the boundary. Riding into the smelter
counts as off-path and re-forms you at the last station. Autopilot: walk the
slowest belt, wait on the press cycle, get off the belts at the smelter apron.

**`lights-out`** — K6 light. A 90 × 70 m tank farm under smoke. Three searchlight
towers on authored sweeps, two sensor posts, steam vents that block sight, and
trooper patrols. A silent takedown (melee from behind on an unaware enemy) kills
in one hit. The control booth kills the lights for 10 s at a time. The alarm uses
the refinery's `alarm_console` pattern: fences seal the lanes, turrets rise, a
drop comes in, and a console resets it. It is never a fail. The tank rows are
the boundary, and the lit stair at the far corner is the way on. Autopilot:
follow the patrol-free route, wait out cones, take down whoever is in the way.

### Great Forge

**`hold-the-forge`** — K5. A round forge chamber about 50 m across, three tunnels,
the dais with the forge and the Armorer, two bellows and six barricade sockets.
The forging runs 0 → 100% over 3 min. It stalls while an enemy is within 6 m of
the Armorer and runs at half speed with a bellows broken. If the Armorer falls,
progress goes back to the last quarter mark and she re-forms. Waves alternate
tunnels, and the last comes from all three with the alamite chieftain. Reward:
+25 max HP for the rest of the run, and the flight boosters Covert Sky uses. The
shaft to the sky above the dais is the way on after the forging. Autopilot:
stand on the dais and shoot.

**`covert-sky`** — K7 flight. A 1.2 km × 160 m flying volume up to 110 m, over a
ruined city. A ring line (each ring a checkpoint plus a boost), three flak towers
(land and plant a charge for 3 s, or two rockets into the breech), drone pairs
and alamites on the tower tops. It ends with a dive through the dome breach. The
boundary is the ruin ridge, the ceiling and the city's edge. Anyone who falls
below the rooftops is caught by the updraft and returned to the last ring. That
catch is the stage's `offPath`, and it is explained by a banner. Autopilot: fly
ring to ring, land on each flak tower and plant.

### Ringworld

**`tram-top`** — K2 plus K1. The tram's three cars are static and the city
scrolls at ~10 m/s along ~2.4 km. Beats: street run, gantries every ~70 m (duck
= hold cover on the roof; standing bodies are swept), the station stop (30 s,
squads board), the tunnel (drop through the roof hatches and fight inside the
cars), and the rival tram (jump across, or shoot the coupling). Swept or knocked
off: re-form on the rear car roof. Autopilot: stay on the middle car, crouch on
the gantry horn, drop in for the tunnel.

**`mark-runs`** — K8. Twelve rooftops over about 500 m with two forks. Pirates are
posted on four roofs. Crate kicks and a sign dropped across a gap. The HUD
shows the gap meter and the bounty value. The mark escapes if he is more than
60 m ahead for 8 s, which restarts from the last roof checkpoint. The net
launcher pickup is on roof 1. The final pad duel ends in capture or a kill. Roof
edges and the long drop are the boundary; falling re-forms you on the last
checkpoint roof. Autopilot: follow the mark's path and net him at the pad.

### Prison Rig

**`one-way-out`** — the tile grid (4 m tiles, pattern cycles with a 1.5 s
telegraph), three gantry desks (take one and its side's tiles go dead), six cell
blocks (hold 2 s to release 4–6 prisoners as unarmed allies on the ally escort
AI), and the headcount. The stair core opens at two desks, and 10+ prisoners
earns a bonus. The hall walls are the boundary. Autopilot: take the nearest desk,
release the blocks on the way, walk safe tiles to the stair.

**`the-lift`** — K2. A 12 × 12 m platform; the shaft wall scrolls down at 2 m/s
with landings every 25 m. Squads fire as landings pass. Jet troopers drop onto
the platform and debris falls with shadow telegraphs. Two stops: fight onto the
landing to the breaker (hold 4 s), then 5 s to get back aboard. The top break-out
is the end. Falling off re-forms you on the platform. Autopilot: hold the
platform centre, and at a stop go to the breaker.

## 5. Assets

Requested **now**, because all eighteen are being built:

- **Images** — [`ASSETS_IMAGES.md`](ASSETS_IMAGES.md#gameplay-sections--supporting-images-2026-09-28):
  the eighteen keyframes and every supporting texture and reference sheet, with
  no "on pick" gating any more.
- **Models** — [`ASSETS_MODELS.md`](ASSETS_MODELS.md#gameplay-sections--props-and-a-prisoner-requested-2026-09-28):
  the props and the one character. Every one ships as a procedural stand-in
  first (rule 7), and the stand-in's size and pivot are the spec the model is
  made to.

## 6. How the work is split

The framework (§2) and the hooks (§2.3) land first, on the working branch, with
one section as the reference implementation. Then agents work in parallel, each
in its own git worktree, each owning a territory's two sections and the kits
listed against them in §3:

- **Wave 1.** Lava Flats (with K3), Crevasse (K7 slide, K9), Refinery (K6), Great
  Forge (K5, K7 flight), Prison Rig (K2), and the Ring Walk (K1).
- **Wave 2**, once K1–K3 are merged. Dune Sea (uses K2, K3, K6), Guns of the
  Frigate (K2, K3, K5), Storm Docks (K1, K2, K4, K7 tilt), and Ringworld (K1, K2,
  K8).
- An **audit agent** reviews every existing zone and stage for necessity and user
  experience. It is read-only, and its report is
  [`AUDIT_LEVELS_2026-09.md`](AUDIT_LEVELS_2026-09.md).

Shared files and who may touch them:

- `player.ts`, `game.ts`, `hud.ts` and `campaign.ts`: the framework adds the hooks.
  Agents use the hooks. An agent that must go further keeps its change to one
  small, clearly commented block and says so in the status file.
- `vehicles.ts`: K3's owner only.
- `mission-layouts.ts`: each agent edits only its own territory's stage list.
- `text.ts`: each agent adds only its own `TEXT.sections.<id>` block.
- `src/sections/index.ts`: one line per section.

Merging: the orchestrating session merges each worktree branch into the working
branch, resolves conflicts, and runs `npm run build` and the section suites. It
then merges to `main` per `CLAUDE.md` once verified.
