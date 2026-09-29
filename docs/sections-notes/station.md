# Station team — the Spice Run's Ring Walk, and K1 (the rail camera)

Branch `claude/sections-station`. Guns of the Frigate (`frigate-guns`, the other
Spice Run section) is another agent's and is not in this branch.

## State

| Piece | State |
|---|---|
| `ring-walk` (`src/sections/ring-walk.ts`) | **Built, registered, playable.** `test-sections` passes at 1, 2 and 4 players (mixed jetpack and super-jump). Screenshots checked across all four stretches, the three locks, the entry blend and the exit. |
| K1 rail camera (`src/sections/kit/railcam.ts`) | **Built.** Camera on the lane, leash, gates, locks, reversed mode, twin-stick aim, mouse reticle, 0.6 s blend in and out, merged HUD strip. `tools/test-section-railcam.mjs` passes at 2 and 4 players. |
| Regression | `test-modes` and `test-coop` pass (split-screen elsewhere unchanged). |

## The Ring Walk: what it is

Stage B's last room (the loading gantry) ends in a transport door. The section
starts in a **maintenance airlock cage** on the ring's outer hull, in front of
that door (shown shut and red on the gantry's wall). A ray-shield outer door cycles
for 2.2 s, then the party walks a quarter of the habitat ring, 298 m of hull spine
12 m wide. It ends by walking into the throat of the **crew airlock module**, which
is a solid block wider than the spine, so it is not a door to nowhere. The crew
catwalks (stage C) are through it. The whole stage is one camera.

- **Geometry.** Ring radius 190 m, centre `(0, Y0, 190)`, walked from θ = 0 to π/2,
  so both ends are square to the world axes (their blocks are AABBs). The spine's
  surface is a **heightfield** (`physics.heightAt`, restored by the context on
  teardown), which gives the curve exact edges and real holes. Everything standing
  on it is round (the conduit is a chain of cylinders, the cargo pods are
  cylinders), because the solver pushes cylinders out radially and a box on a
  curve lies about its footprint.
- **The void.** Off the edge (|lat| > 7.4) or down a missing panel (y < floor − 3.5)
  is `offPath`. That re-forms you through `respawnSpot`, which is the kit's
  forward spot (below).
- **The four stretches** (metres along the spine):
  1. **The spine** (0–74): 5 + party posted pirates and pykes behind pods and the
     conduit, and a jetpack pair. It teaches the aim.
  2. **The vent run** (74–164): three plasma vents across the whole spine (s 84,
     108, 115), cycling 2.4 s idle, **1.2 s red glow**, 1.0 s firing a 9 m sheet
     (22 damage, a shove back, 0.6 s grace). Two missing panels, 7 m and 6 m. **Lock 1**
     (130–164): three dropship passes, each called when the last is thin.
  3. **The spoke junction** (164–232): the spine widens into an apron at the foot of
     a 20 m spoke that climbs to the hub. **Lock 2** (176–216): a squad out of the
     spoke's door, then jetpack pirates off the spoke **and the gun hatch**, then a
     drop with an enforcer at 2+ players. The hatch rises out of the hull on a 7.5 s
     cycle. While it is open it fires at the nearest hunter, and its eye is a
     `Breakable` (240 + 60·party HP), so bolts and blades both find it. The lock
     needs it shut.
  4. **The sweep** (232–298): two sensor booms, one on each edge, sweep ±75° at
     0.9 m. A body caught standing in a beam calls 1 + ⌈party/2⌉ interceptor drones
     up over the hull's edge (7 s cooldown per boom, 6 alive at most). Jump the
     beam, or stand on the conduit's far side from that boom: the conduit is taller
     than the beam. **Lock 3** (266–298): the Pyke capo, 2 + party guards and an
     enforcer (2+ players) walk out of the airlock you want. When the capo is at
     half health his crew drops in.
- **Pickups:** bacta just past each rail gate, and one on the apron at 3+ players.
- **Nothing resets.** Death and falls re-form forward (see the kit). A wipe just
  re-forms everyone at the kit's spot. The locks keep their state.

**How it plays:** one screen, all four hunters in it. The camera is off the ring's
outer side, up and a little behind, looking along the curve with the hub and spokes
overhead and the planet under the hull. The first stretch is walk-and-shoot, the vent
run is timing and jumping, and the junction is the big arena with a target you have
to go and deal with. The sweep is about positioning, and the capo at the door is the
climax. The autopilot (which aims perfectly) takes ~100–140 s with nothing culled and
~50 s with the suite's culling. Humans should land nearer the design's ~4–5 min.

### Tuning numbers and why

| Number | Value | Why |
|---|---|---|
| Camera eye | back 8, side −9.5 (outside the ring), up 9, look 8 ahead, fov 54 | At back 11 / side 12 / up 10.5 the hunters were 20–30 m from the lens and read as specks. At 6.5 / 8.5 / 7.5 the near stuff filled the frame and a jumper left the top of it. |
| Leash window | span 28 m, lead 0.4, camera 8 m/s | This keeps four hunters in one shot on a 12 m spine. It is short enough that a runner stops at the front edge before the next hazard is off screen. |
| Vents | 2.4 / 1.2 / 1.0 s, three phases | 1.2 s of glow is the design's telegraph. The phases are staggered so there is always a way through at a walk. |
| Gaps | 7 m, 6 m | At 0.45 g a standing jump carries more than 10 m, so these are a timing hazard, not a skill wall. Every character clears them. |
| Hatch HP | 240 + 60·party | At 150 + 40·party two aim-perfect bots shut it in 3 s. |
| Locks | the next wave comes when standing ≤ min(2, party), or after 22–25 s | A lock should never go quiet, and never stall on one straggler. |
| Drop grace | 11 s | A carrier's squad falls a long way, so a lock does not count a drop as landed until then. |
| Lock clear | every hostile inside [from − 6, to + 6], ±22 m, plus its own bodies | The first version counted spawns before they existed (locks cleared instantly) and trusted drop callbacks. |

## K1 — `src/sections/kit/railcam.ts`

`new RailCamera(opts)`, then `engage(game)` on the section's first update,
`update(dt)` every update, `release()` at the exit gate, and complete once `out`.
`dispose()` puts everything back (the campaign also clears `sharedView`, `moveYaw`
and `sectionMove` on teardown).

- **Lane.** A polyline, ~1 m a point (`lane`). The kit measures along it (`s`, metres
  from the first point) and to its right (`lateral`). It provides `pointAt`,
  `tangentAt`, `yawAt` and `project`, and runs on straight past either end.
- **Camera.** It gets its focus from the window, eased (the camera is damped at
  4/s). By default it is offset by `eye {back, side, up, lookAhead}` in the lane's
  frame. A section can pass `pose(s, zoom, out)` instead (Tram Top's tunnel
  framing, say). A lock wider than `span` pulls the offsets out by `zoom`. `stop`
  caps the focus short of an end door.
- **Leash.** The window is `[rear, front]`, with the centroid of the living party
  at `lead`. Only the forward edge moves forward, and the rear never moves back.
  A body behind `rear` is carried forward at 8 m/s through the solver. One still
  4 m behind after 2 s (stuck on something) re-forms forward. A body past `front`
  is moved back and loses its forward speed.
- **Locks.** `lock(from, to)` / `unlock()` pin the window to an arena, and the
  front edge is then a wall.
- **Gates.** `gates` (metres). `gateIdx` advances when the front edge crosses one.
  `respawnSpot(slot)` is the last gate, or the rear of the shot plus 3 m if the
  window has scrolled past it. From there it searches forward for the first spot
  `opts.safe(s, lat)` allows (the Ring Walk rejects gaps, vents, the conduit and
  pods), at `formation[slot]` laterally. That spot is never behind the camera and
  never in a hole.
- **Reversed.** `reverse: true` puts the camera ahead of the party looking back, and
  stick "up" is away from the lens (the party runs at the camera by pulling down).
  This is Run the Pier's mode. The rail test drives it on a straight lane of its own.
- **Stick basis.** Each player's `moveYaw` is the lane's direction at their own `s`,
  so holding "up" walks a curve.
- **Twin-stick aim** (`rail.move`, a `SectionMove`; `engage` installs it unless
  `{ setMove: false }`, so compose it with `composeMoves` if you have other hooks):
  the right stick (`FrameInput.aimStickX/Y`, past 0.35) points the gun on the rail's
  basis. With no stick input, look deltas (the mouse) walk a ground **reticle**
  (2.5–22 m), drawn as an amber ring on the ground while the mouse steers (`reticle(slot)` gives the point). With neither, the gun
  follows the feet. LT hard-locks the nearest hostile in front (within 45 m) and
  pitches to its chest. The result goes into `p.cam.face(yaw, pitch)`. Each
  player's own chase camera keeps running unseen along that aim, so every existing
  firing path works untouched: the camera ray, the soft-lock, squaring the body,
  the saber throw. `Player.aimCone` widens the soft-lock to cos 24°. Look and dolly
  are swallowed.
- **Blend.** In `engage`, `sharedView = { camera, blend, viewFor }`. For 0.6 s every
  viewport is drawn through `viewFor`: its camera flies from just behind its hunter
  to the rail pose (slerped), and its projection walks from "whole picture" to
  "its own piece of the full-screen frame" (`setViewOffset`). At blend 1 the
  pieces tile one image, and the renderer switches to one viewport. `release()`
  plays it backwards onto each player's live chase camera, faced along the rail.
- **Snap.** `snap(s)` moves the window forward at once, for a cut the section makes
  (Tram Top dropping into the cars).

### For Run the Pier and Tram Top

- Run the Pier: `reverse: true`, a K4 `PathFront` for the collapse, and `gates` at
  the three pier gates. Its `safe()` rejects the plank gaps. Use `rail.rear` as the
  "caught" line if you want the frame and the front to agree.
- Tram Top: a straight lane along the roofs, and `eye` off the flank (large `side`,
  small `back`). The kit's rail basis makes "up" along the train. If a flank camera
  wants screen-relative sticks instead, that is a small option to add (`basis:
  'view'`: use the camera's yaw instead of `yawAt`). It is not built yet because the
  Ring Walk's camera is close enough to its rail that the two agree.
- `test-section-railcam.mjs` is the kit's test. Add a reversed-lane case there if
  you change the leash.

## Shared-file changes (every one a small commented block)

| File | Change |
|---|---|
| `src/core/input.ts` | `FrameInput.aimStickX?` / `aimStickY?`, which is the right stick's raw deflection after the deadzone. Set in `read()` next to the look deltas. It is optional, so every existing `blankInput` still type-checks, and only K1 reads it. |
| `src/player/player.ts` | `Player.aimCone: number \| null` (null outside a rail section), and two lines at the top of `aimAssistTarget` that widen `minDot` to it. |
| `src/game/game.ts` | `sharedView` gains optional `blend` and `viewFor(i, rect, w, h)`. In `render`, while `blend < 1` the split is still drawn, each viewport through `viewFor`'s camera, which carries its own projection. `Rect` is imported from `core/layout`. |
| `src/ui/hud.ts` | The merged strip. `setLayout` keeps the split rects and rules, adds a hidden portrait per cell and a full-screen `.hud-merged` layer (one objective marker, one top line). `updateMerged()` fades the rules with the blend and re-lays the cells as a bottom strip only once the blend is whole. `updateObjective` takes an optional camera and optional `exited`. While merged the per-viewport marker and radar are skipped. |
| `src/ui/style.css` | The strip's rules (appended at the end, K1 block). |
| `src/sections/index.ts`, `ids.ts` | One line each: `'ring-walk'`. |
| `src/text.ts` | `TEXT.sections['ring-walk']` only. |

## Known issues and what is left

- **Bots in a rail section.** `game/bot.ts` steers by `cam.yaw` and does not know
  about `moveYaw` or the aim stick. Missions have no bots today. If they ever do,
  the bot brain needs a rail branch.
- **Sticks' basis is the rail, not the screen.** This is per the plan. With the Ring
  Walk's camera 25–35° off the rail it reads naturally, but a flank camera (Tram
  Top) may want a `basis: 'view'` option (see above).
- **Stand-ins.** Everything is procedural: the hatch, booms, pods, spokes, hub and
  modules. No model requests were opened for them. `ring_hull_spine.jpg` (already
  requested) takes over the deck's `metal_deck` when it lands. `planet_station.png`
  dresses the planet.
- **Length.** The autopilot's twin-stick aim is perfect, so real pacing needs a human
  playtest. The levers are the wave sizes in `runLock`, the posted counts in
  `spawnStart`, and the hatch HP.
- **The start.** The gantry wall behind the cage is drawn one-sided (visible from the
  ring) so the rail camera can start behind it. A player who turns round sees the
  shut red door, which is correct. Its collider is a normal box.
