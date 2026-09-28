# Lava Flats team — the Magma Run and the K3 mounts kit

Branch `claude/sections-lava`. Owner of `src/game/vehicles.ts` (K3), `src/sections/magma-run.ts`,
`src/sections/kit/mounts.ts`, `tools/test-section-mounts.mjs`, and `TEXT.sections['magma-run']`.
The Chimney (the other Lava Flats section) was already built as the framework's reference.

## State

| Piece | State |
|---|---|
| K3 vehicle weapons (`VehicleDef.gun`, `sideSwing`) | built, tested |
| K3 lane mode (`Vehicle.lane`, `SplineLane`) | built, tested |
| K3 pillion seat | built, tested |
| K3 turret kind | built, tested (mount, aim, arc, sight, fire, overheat, vent, dismount, unmanned auto-fire) |
| K3 scripted rides (`Vehicle.scripted`, `place`) | built; the Magma Run's barge uses it |
| `magma-run` section | built, registered, passes `test-sections` at 1, 2 and 4 players |

## K3 — what a section gets (`src/game/vehicles.ts`, `src/sections/kit/mounts.ts`)

Every ride the boards park is unchanged: the weapons, the lane and the pillion are opt-in per
ride through `new Vehicle(spec, board, opts: VehicleOpts)`. `tools/test-vehicles.mjs` passes.

- **`VehicleOpts`**: `gun` (a `GunDef`), `sideSwing`, `pillion` (seat offset), `lane`
  (a `SplineLane`), `respawns` (false: a wreck stays gone), `team` (an empty turret's side),
  `hp`, `turret` (a partial `TurretDef` over the kind's own).
- **Gun** (`GunDef`): `rate`, `heat` per shot, `cool` a second (vents all the time), `resume`,
  `damage`, `speed`, soft-lock `cone` and `range`, `muzzles` (alternated). RT fires it from the
  saddle; the soft lock bends a bolt onto the nearest body on the other side inside the cone.
  `BIKE_CANNON` (8/s, 16 dmg, ±12°, locks after ~2 s held), `BIKE_CANNON_HOSTILE` (3.2/s, 7 dmg).
  `Vehicle.heat` / `overheated` for a HUD.
- **Side swing**: X swings the rider's *own* melee weapon (its attack clip, its sound, sabers
  lit) to a flank — the flank with the nearest target, or the stick's lean. It is live through
  the middle of the swing (28–75%) and lands on the first body in a box out to 4.8 m on that
  side. A hostile in a saddle is knocked *out* of it alive (the blow leaves 1 hp), thrown
  sideways at his own speed, and his ride runs on driverless; what he lands in finishes it.
  A hostile's own swing takes 0.95 s (the club is seen raised), a player's ~0.5 s, so the rider
  who swings first wins. `Vehicle.riderFacing` / `swinging` turn the body and free the hands.
- **Lane** (`Vehicle.lane`): forward is carried along the spline; the stick picks a speed inside
  the lane's band (`speed(s)`: min / cruise / max — never under min, so it never stops) and
  leans across it (11 m/s at full stick); a double-tapped lean is the **sideswipe** (+10 m/s
  sideways into whoever is there, the mass rule does the rest). The lane's edges are walls
  (a hard scrape costs the hull). Over a drop deeper than 1.8 m the ride flies it on gravity
  instead of being hauled down by the hover spring. A riderless lane ride runs on, drifts, and
  after 1.1 s goes under where `lane.sinks(s, lat)` says so (`Vehicle.sink()`, no fireball).
  The rider's camera is locked behind along the lane heading; the right stick nudges ±0.24 rad.
  Two ridden lane rides meet hull to hull (the mass rule), never hull to rider.
- **Hostiles on a lane** get a built-in brain (`laneBrainDefault`), overridable per ride with
  `Vehicle.laneBrain` → `LaneOrder` (`lat`, `speed`, `boost`, `swing`, `fire`, `aimAt`).
  A **swinger** comes up alongside the nearest player on the side with room, swings, peels
  away and comes again; a **gunner** rides 16 m *ahead*, weaving across the mark's line, and
  fires back over its shoulder in bursts (`aimAt`) — which puts it in the mark's nose cannons.
- **Pillion**: a ride with `pillion` set takes a second player (Y at a teammate's ride). The
  pillion works the gun and swings to both flanks; the driver only drives. The driver
  stepping off, or dying, slides the pillion onto the bars. A wreck throws both.
- **Turret** (`kind: 'turret'`, the `quad_turret` stand-in: `base`, `yaw`, `pitch` nodes, four
  barrels): it never moves or unparks. The look is the gun inside its arc (`yawArc`,
  `pitchMin/Max`), the gun slews at `slew` rad/s, the gunner's camera sits at `sight` looking
  down the barrels (`applySight`), RT fires, heat locks it and it vents, Y steps off. With
  nobody in it, it fights for `team` at `auto` × its rate (0.5) in bursts; a hostile in it
  fires at the party in bursts with some spread. `moveMount(x, y, z, yaw)` carries one on a
  moving hull.
- **Scripted rides** (`Vehicle.scripted = true`, `place(x, y, z, yaw, vx, vz)`): the section
  moves the hull; its rider's frame still fights. For a barge on a set course or a hull in a
  treadmill arena.
- **`HeadingLane`** (kit): a lane laid by heading (straights and smooth bends), sampled every
  metre and rasterised into 2 m cells so `project(x, z)` is a lookup. Also usable as the
  section's ground (`physics.heightAt`).
- **`RideLedger`** (kit): puts rides into the match mid-stage (`add`, `seat` a hostile), prunes
  finished wrecks, and retires every one on dispose.

## The Magma Run (`src/sections/magma-run.ts`)

Its own stage between the garrison (B) and the Chimney. 2 km of lava lane from a quay in the
tunnels under the town to a basalt landing in the magma chamber. The river is the floor: the
section sets `physics.heightAt` to its own analytic surface (lava, crust islands, ramps, the
quay, the alcove ramp, the landing); nothing without a bike under it lives on the lava.

- **The door and the quay.** The party starts on a landing in an alcove in the tunnel wall, the
  court's transport door shut behind them, a ramp down to a pirate quay on the river: an
  awning, crates, drums, a lamp, one bike per player moored in a line and the crew's two bikes
  in a second line. The camp's squad (from the board's own table) stands round it. Taking a
  bike wakes it: the two crew riders run for their bikes and give chase (*Bike thieves!*).
- **The run-in** (0–500 m): the tunnel, then the canyon. Crust islands (safe ground, bacta on
  three of them), basalt spires, lava falling down the canyon faces. Riders: two ahead, then a
  gunner and a swinger from behind.
- **The columns** (500–1000): six basalt columns stood at the walls crack (a glowing seam at the
  foot, and a line of heat on the lava where each will land) when the leader is 3.3 s away, then
  fall across the river in ~1 s leaving a one-bike gap at the far side; down, each is a row of
  hop-high colliders. Geysers glow for 1.3 s then throw a column of fire for 1.1 s (38 to the
  hull, a hop up into the air).
- **The falls** (1000–1500): two terraces, 9 m each, with a lavafall curtain at each lip and a
  crust ramp beside it (right side on the first, left on the second). A bike off the lip flies
  it. Geysers at the feet; swoops (nikto) dive in off the walls.
- **The gun barge** (1500–2000): a pirate skiff on a raised fighting platform (a scripted ride
  with a moving deck the crew stand on), a flak turret with a gunner at the stern facing back,
  a helmsman, 3–4 crew, a mast with a red lamp. It runs 40 m ahead of the leader down the middle
  and holds the chamber mouth with a red-hot chain boom (the throttle band's floor drops to 0
  in the chamber while it holds). It goes down when its hull breaks, when everyone aboard is
  dead, or when the gunner and the helmsman both are; a bike boosting into it at 9+ m/s closing
  is a ram (5 × closing to the hull, the crew knocked about). Sunk, the boom drops.
- **The landing.** A basalt slab at 1962 m; the band closes and the bikes pull up at an energy
  fence (pylons, red beams) across a short tunnel whose far end glows — the Chimney's arrival
  tunnel, fence behind it. Complete when every living player is on the landing and the barge is
  gone.
- **Checkpoints and fresh bikes.** Gates (toll arches with lamps that turn green) at 40, 500,
  1000, 1500 and 1700 m. The fallen re-form at the party's last gate on a fresh bike, already
  moving. Anyone thrown onto crust gets a fresh bike where they stand after 1.8 s (a teammate's
  pillion is the other way back). A bike shot to pieces at the quay is replaced.
- **Speed**: embers lift off the lava ahead of every rider (still in the world, so they stream
  past at the bike's speed), the lava pops near riders, spray comes off the falls' lips.
- **HUD**: stretch name, speed bar, cannon heat (red and *Venting* when locked), barge hull when
  it is out, `n of 2000 m`. Hints ≤ 26 characters (longer ones wrapped into the kill counter).

### Tuning, and why

| Number | Value | Why |
|---|---|---|
| Throttle band | 16 / 22 / 30 m/s | the design's; ~90 s for the river at cruise |
| Lean | 11 m/s | a lane edge to edge in under 3 s: dodging a crack's fall line is possible from its telegraph |
| Column crack | 3.3 s before the leader arrives, 1.6 s crack + 0.95 s fall | lands about a second ahead of the leader: a near miss, readable |
| Flak | 4 rounds/s, bursts of 5, 1.5 s rest, 6 dmg, 46 m/s, spread | at 10 dmg / 5 rounds / 1.1 s rest it folded a bike in under 3 s |
| Barge deck | 1.75 m over the keel | on the skiff's own 0.8 m deck the crew stood inside the hull's hit spheres and every bolt died on the plate |
| Hostile swing | 0.95 s wind-up | a player who swings first wins; the pirates still land ~1 in 4 |
| Swing on a rider | leaves him 1 hp | he dies in the lava, with the splash, not in mid-air |
| Riders ahead | spawn 60 m ahead | at 85 m they took ten seconds to meet the party |

Measured (autopilot, solo, no culling): ~6 swings land in 90 s and unseat riders into the lava;
the barge fight takes 20–40 s; the autopilot dies 2–3 times over the whole run (mostly at the
barge), which a player with the shield up will not.

## Shared-file changes (each one small and commented)

- `src/world/board.ts`: `VehicleSpec.kind` gains `'turret'`.
- `src/player/riding.ts`: `dropRider(this)`; the pillion's frame (`ridePillion`) instead of
  `drive`; `seatWorld(pos, this)`; facing from `v.riderFacing(this)`; no hands-to-bars during a
  swing or for a pillion; after the camera, a turret gunner's `aiming` and `applySight`.
- `src/player/player.ts`: `dropRider(this)` in `takenByHazard` and `die`; `findVehicle` lets a
  player board a ridden ride whose pillion seat is open.
- `src/sections/index.ts`, `ids.ts` (registration, `SECTION_ASSETS`), `src/text.ts`
  (`TEXT.sections['magma-run']` only).

## Tests

- `tools/test-sections.mjs magma-run` at `PLAYERS=1`, `2`, `4` (default mixed chars): pass.
- `tools/test-section-mounts.mjs`: the turret on the Dune Sea (mount, arc, sight, fire,
  overheat, vent, dismount, still solid, unmanned auto-fire at ≤ half rate) and on the river
  (lane carries and never stops, cruise 22, lean; pillion boards, works the cannon, driver only
  drives, promotion; side swing unseats, the rider dies in the lava, his bike runs on and goes
  under, the blade comes out and goes away). All pass.
- `tools/test-vehicles.mjs`: passes, 82 checks (the parked rides are unchanged).
- `tools/test-modes.mjs`: passes (covers the `player.ts` / `riding.ts` hooks).
- Run the harness suites one at a time: two browsers at once crashed a tab here (`Target crashed`).

## Known issues / left

- Hostile swing animation: enemies' hands are pulled to the grips by their own riding IK, so
  a pirate's swing reads mostly as the timing and the hit, not the arm.
- The knocked-off rider flies upright (his knockdown pose plays once he lands).
- Screenshots in a stepped harness: the first render after many unrendered steps can drop a
  just-loaded model for a frame; render twice before a shot (the shot scripts do).
- No authored models of our own: every prop is a stand-in (quay, gates, barge platform,
  columns). `quad_turret` is requested in `ASSETS_MODELS.md`; its node names are what the
  turret drives.
