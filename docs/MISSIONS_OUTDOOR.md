# Missions v3 — outdoor levels: design & implementation plan

Written 2026-09-03. Supersedes the *shape* of the mission level described in
`docs/LEVEL_DESIGN.md` §2–§4 (the eight walled rooms and roofed corridors);
everything else in that file — the Gauntlet lessons, sealed assault waves,
checkpoints, the pickup economy, per-player cameras, the walkthrough audit —
carries over unchanged. `docs/MODES.md` §4 stays the mode's rulebook.

## 0. The brief, distilled into rules

The v2 level is a room chain in the sky: walled boxes, 5.5 m walls, roofed
6 m corridors, blast doors everywhere. It plays well but it reads as a
dungeon that could be anywhere — the Dune Sea's run and the Prison Rig's run
differ in palette and set pieces, not in the *kind of place* you are in. The
fix is not to throw the chain away (the containment, the pinches, the one
golden path are what make it work) but to build the chain out of **outdoor
spaces bounded by terrain**, with interiors as one beat among several rather
than the whole level.

The rules the rest of this document serves:

1. **Begin outdoors.** Every territory's trailhead is an open, outdoor-feeling
   space that shows the theme's personality in the first ten seconds — dunes
   and mesas, a snowfield over a crack in the ice, a quay under a squall, a
   deck under the stars. (The Refinery, the one interior wave board, starts in
   its tanker yard and *enters* the plant.) No territory opens in a box.
2. **Vary the volume.** Open ground → a ravine → a hall behind a door → back
   out into a bigger open space. The chain alternates *open, constrained,
   interior, open* so the tempo resets by geometry, not just by doors.
3. **Borders are terrain.** Outdoor spaces are held in by mountains, cliffs,
   ridges, ruin walls, tank farms, hull plating — whatever the theme offers —
   and those borders only need to rise above the flight ceiling, not to the
   sky. Where the theme has no terrain (space), the *void* is the border and
   platform placement is the guide.
4. **A flight ceiling, per board — high enough not to feel.** The ceiling
   exists for two reasons only: nobody skips a beat by flying over its
   border, and there is a clean cut between the **playable sky** and the
   **ambient sky** — carriers cross and drop from above it, flying enemies
   have to come down into the playable volume before they may attack. It is
   *not* a lid on the jetpack: the default sits above what one full burn
   reaches (30 m over the floor; 45 m on the Spice Run's low gravity), so a
   player flying freely rarely meets it and only ever does so on purpose. One
   number per territory, overridable from the URL for tuning. Things may
   *descend* through it; nothing climbs back out.
5. **Long treks are fine when the goal is obvious.** A 60–90 m walk between
   fights is allowed — and welcome, it is where the theme breathes — provided
   the destination is a visible landmark and the guide points at it. Distance
   is never the limit; legibility is.
6. **One objective, three layers of guidance.** A landmark you can see, a
   marker on the screen that always knows where it is (with an edge arrow when
   it is off screen), and a ground arrow at every cleared checkpoint pointing
   to the next area's beginning.
7. **Interiors are the hallway beat, not the level.** The existing corridor +
   walled-room construction stays, roofed now and reached through a door in a
   cliff, hull or wall. Every interior has a way in and a way out, and the way
   out opens onto something bigger.
8. **Use everything, and ask for what is missing.** Every prop, texture, ride
   and creature in the game is available to Missions — the inventory belongs
   to the game, not to the wave mode. Where the best version of a place wants
   a surface or a sculpt that does not exist, it is requested
   (`docs/ASSETS_IMAGES.md`, `docs/ASSETS_MODELS.md`, §10 here) and the design
   is written to the requested asset, with the procedural stand-in as the
   fallback — the rule every other system in the game already follows.
9. **Rides are part of the fight where there is room.** The biggest outdoor
   spaces park rides (swoops, speeder bikes, the landspeeder, the skiff, a
   bantha) and one beat per vehicle board is a **road**: a long outdoor lane
   meant to be ridden under fire, with enemy swoops harrying the column.
10. **A level is a chain of stages, and a stage can be a different map.** Where
   two parts of a run want different world rules — space and a hull interior,
   a deck and the sea beneath it, the open ground of a territory and a plant
   built inside it — the run crosses a **transport door** and the next stage
   loads behind a short transition. Map size and resource limits never decide
   the design; the door does. Where a run is one place, it stays one map.

## 1. The grammar: shells × encounters

The v2 spec conflated *what a space is shaped like* with *what happens in it*.
v3 splits them. Every beat of a level is a **zone** = a **shell** (the
geometry) carrying an **encounter** (the rules).

### 1.1 Shells

| Shell | What it is | Size (w × l, m) | Roof | Borders | How waves arrive |
|---|---|---|---|---|---|
| `open` | a wide outdoor floor: a flat, a court, a deck, a plaza | 40–90 × 36–70 | sky | **rim**: a ring of cliff/ridge/wall pieces taller than the ceiling, with a gap where the path enters and one where it leaves; optional **pass** notch in the rim for runners | carrier drop (from above the ceiling); runners through the pass; fliers over the rim (if `air`) |
| `canyon` | a constrained outdoor lane: a ravine, a trench, a street, a pier, a gantry | 8–16 × 40–90, ≤ 2 bends | sky | cliff walls both sides (or the drop, for a pier); mouths framed by two tall pillar pieces | carrier drop; runners from the far mouth unless it is a dead end |
| `hall` | the v2 walled room, now **roofed** | 16–26 × 14–22 | slab at `roofH` (8–10 m) | real walls, blast doors in both mouths | **wall hatches**: a door leaf in a side wall with a closet behind it; the squad is posted in the closet and the hatch opens (arrival `post`, then walk) |
| `corridor` | the v2 corridor leg, unchanged | 5–6 wide, 12–18 per leg, ≤ 1 bend | 3.8 m | walls | posted defenders behind flush crates (unchanged) |
| `deck` | a floating platform or platform cluster (the Spice Run only) | plates 18–60 across, gaps 12–18 | sky | the void: stepping off is "off the path" and returns you to the checkpoint | dropship pass; fliers; jetpack pirates |
| `road` | a long outdoor lane meant to be **ridden**: a dune road, a crust causeway, a glass highway | 24–30 × 120–180, bends through 30 m-wide junctions so a ride can take them at speed | sky | rim both sides (a ride into the rim is a crash, not an exit); mouths framed by pillars | enemy swoops orbiting the column; carrier drops at two marks along the road; a squad behind a barricade at the far mouth |

A **door** is only ever placed where a `hall`/`corridor` meets anything (a
door *in* a cliff face, a hull, a ruin wall, a rig bulkhead). Outdoor-to-
outdoor transitions have no door: the canyon mouth, the pass, the gap in the
rim *is* the transition, and if it has to seal (an assault's exit) it seals
with a **fence** — two pylons and an energy pane — not a slab of metal.

### 1.2 Encounters

Unchanged from v2 plus one: `start`, `trek`, `camp`, `assault`, `lieutenant`,
`warlord`.

- **`trek`** is new: no garrison, no seal; the zone clears when the party
  reaches its far end. It exists so a long walk under the theme's sky can be a
  beat of its own (the rule-5 breather) without a fight bolted onto it. A
  `trek` may carry 1–2 posted **lookouts** who alert the next zone's camp when
  they spot you — a reason to move quietly, at no cost.
- **`chase`** is new, and only ever sits on a `road`: rides are parked at the
  road's start (and a spare pair a third of the way along, for whoever fell
  off), the column is harried the whole length — swoops on the flanks, a drop
  at each of two marks — and the far mouth is a **barricade**: a fence with a
  squad behind it that dismounts you, or a crate line a skiff can ram
  through. Clears when every living player is past the far mouth; the
  checkpoint is the far end, with the surviving rides parked beside it.
- **`camp`**, **`assault`**, the two boss arenas: as in v2. `waves` on an
  assault, 2–3.

### 1.3 Sealing — outdoor zones seal their exit only

The v2 rule (both doors shut on entry, the party must all be inside first)
is what makes a fight feel like a locked room. Outdoors it becomes:

| Zone | On entry | Trigger | On clear |
|---|---|---|---|
| outdoor `assault` (`open`/`canyon`/`deck`) | the **exit** barrier (door or fence) is already shut, it stays shut; the entry stays open | first living body crosses the zone's **trigger line** (entry + 6 m along travel) | exit opens; checkpoint at the exit |
| interior `assault` (`hall`) | both doors seal | the whole living party is past the entry door (v2 `allInside`) | both open |
| boss arena, any shell | both barriers seal (fence behind the party for an open arena) | whole living party inside | exit opens; the run ends if it was the warlord |
| `chase` (`road`) | the far mouth's barricade is shut; the entry stays open | first body past the trigger line | the barricade opens (fence) or is rammed (crates); checkpoint at the far end |
| `camp`, `trek` | nothing seals | first body inside | reaching the far end |

Retreating out of an outdoor assault is allowed — you retreat into ground you
already cleared, and the waves follow you, which is a worse fight than holding
the line; the seal outdoors is about *progress*, not about a cage.

### 1.4 Borders: how terrain is built

There is one new builder primitive, **`ridge`**, and it makes every outdoor
border on every board:

- Input: a polyline on the level's floor plan, a height, a thickness, a
  palette, a style (`rock` | `ice` | `basalt` | `ruin` | `hull` | `tank` |
  `panel`).
- Physics: a run of overlapping **cylinders** (`physics.addCylinder`, the
  primitive the mesas already use — a box lies about a round thing) along the
  polyline: radius 3–6 m, spaced ≈ 1.2 r so there is no gap a body fits
  through, tops at `floorY + ceiling + 6` or higher. Behind the walkable
  footprint the rim needs no physics at all.
- Mesh: per cylinder a tapered `CylinderGeometry` with its ring vertices
  displaced by a small noise (so it reads as rock, not a tube), all pieces of
  one material merged into one `BufferGeometry` per zone (`mergeGeometries`)
  so a level of ~400 pieces is a handful of draw calls. `hull`/`panel`/`tank`
  styles use boxes and clean cylinders instead of noise.
- **Backdrop row**: a second, mesh-only row 12–25 m behind the first, taller
  (1.5–2.5× the ceiling), sparser, tinted toward the fog colour: the
  "mountains beyond". Never collided with; never reachable.
- Gaps: the polyline is authored with breaks where the path passes; each
  break is framed by two **pillar** pieces (r 4–5, taller than their
  neighbours) so the way through is a shape you recognise from across the
  zone.

Sizing rule: border height = `ceiling + 6` minimum. A 30 m ceiling wants a
36 m cliff; the backdrop row at 60–70 m sells the scale. Nothing has to be
infinite because nothing can get above the ceiling.

### 1.5 Floors

Outdoor floors stay the v2 flat plates in the first cut (one box per zone,
`EPS`-staggered as now) so `contains`, spawn validation and the walkthrough
autopilot keep working unchanged. Relief is a later phase (§4, Phase 6): a
mission-local `heightAt` wrapped over the territory's inside the footprint.
Until then, "terrain" inside a zone is **cover rock** — physics cylinders
1–2.5 m tall with the same noised mesh — placed where v2 placed crates, plus
the theme's props (the barge, the tanks, the kiosks) as landmarks.

### 1.6 Lighting

The v2 hemisphere fill + work lamp per room stays for interiors. Outdoor
zones drop the work lamp and rely on the territory's own sun/sky (the level
sits at `MISSION_Y` under the same sky and fog as the wave board), with the
hemisphere fill kept at a lower intensity (0.8) so cliff faces in shadow are
not black. Canyon dead-ends get a lamp over the door so the door reads as the
goal in the dark.

### 1.7 Props — the whole inventory is fair game

The v2 level dressed every room from one crate sculpt. v3 dresses each zone
from the game's full prop shelf — the sculpts the wave boards were built
around are what make a place *that* place, and Missions is allowed all of
them. `ZoneSpec.props` places them in zone-local coordinates through the same
`authoredProp` / `loadProp` path the boards use, with `fitColliders` where a
prop is solid, so a delivered sculpt hides its stand-in and the physics is
fitted to the art exactly as on the wave boards. The prefetcher's per-board
prop list (`BOARD_PROPS`) gains a Missions counterpart derived from the
layout at load — `tools/test-loadperf.mjs` already holds that list against
`propsUsed`, so a prop a zone asks for is warmed before the drop.

What each territory draws on (the ids are the delivered `.glb` files):

| Territory | Landmarks (one per zone, the thing you walk toward) | Cover & dressing |
|---|---|---|
| Dune Sea | `sandcrawler` on the trailhead's skyline, `homestead_dome` + `vaporator` ×3 at the trailhead, `sail_barge` in the caravan graves, `tusken_tent` ×3 in the ravine camp, a grounded `troop_carrier` wreck in the hollow | `cargo_crate`, `corridor_crate`, boulders (§9) |
| Spice Run | the station **hull** (a `hull` ridge, §9 texture), a landed `freighter` on the docking bay, `cargo_crane` ×2 over the outer yard, `reactor_core` as the reactor ring's spire, a parked `raider_dropship` on the prize's hold | `cargo_crate` ×many, `fuel_barrel` (steel skin) |
| Lava Flats | the board's own `adobe_tower` ×2 + `adobe_gate` as the **garrison's transport door** (the opening stage ends in front of the town gate, leaves shut), its `survey_crawler` wrecked on the ash flats | `cargo_crate`, basalt boulders, `fuel_barrel` (rhydonium) in the pen |
| Crevasse | `survey_crawler` on the rim shelf, ice spires (the board's own procedural spires, lifted into the level), `krykna_brood` egg sacs (breakable, `addBreakable`) in the hatchery | ice boulders, `corridor_crate` |
| Storm Docks | `trawler` as the trawler deck (static in Phase 3, a `Mover` in Phase 6), `dock_shed` on the quay, `freighter` as the freighter-hold's exterior, `fish_rack` ×4 on the pier | `cargo_crate`, `fish_rack` (thin cover), `fuel_barrel` |
| Refinery | `reactor_core` rising through the reactor crown (40 m: it clears the ceiling, which is right), `pipe_rack` tiled along the pipe run, `alarm_console` ×2 per hall (**the alarm mechanic comes with them**: a console left standing calls the next hatch early) | `fuel_barrel` (rhydonium), `cargo_crate` |
| Great Forge | `mythosaur_skull` at the rim of the sleeper's basin, `forge_brazier` on a dais in the glassed court, dome ribs (procedural) on the skyline | ruin rubble, `corridor_crate` |
| Ringworld | `tram` parked at the tram stop (and running the arcade as a `Mover` in Phase 6), `street_kiosk` ×6 down the arcade, the ring's far side as the terrace's backdrop | `street_kiosk`, `cargo_crate` |
| Prison Rig | a landed `troop_carrier` on the landing deck, the board's own `sunken_transport`, kelp and reef in the sea stage (swum through, a cache inside the wreck), a second wreck beached against the assembly deck's edge as walkable cover, `alarm_console` in the work floor | `cargo_crate` (white skin), `fuel_barrel` |

Breakables come with the props that have them (`fuel_barrel` rhydonium,
`alarm_console`, the egg sacs) — `addBreakable` is board-agnostic.

### 1.8 Rides — vehicles in the fight

The vehicle system (`game/vehicles.ts`) is skipped in Missions today
(`spawnVehicles` runs for every mode but `campaign`). v3 turns it on, from
the **level** rather than the board: `ZoneSpec.vehicles` parks rides in
zone-local coordinates and `Game` spawns `level.vehicles` for a campaign
match. Nothing in the vehicle code changes except one line: a ride's hover
height takes `campaign.level.waterY` over `board.waterY` on the two water
boards, so a skiff over the local harbour does not drop to the territory's
sea 90 m below.

Rules for where rides go:

- **Room to turn.** A ride only appears in a zone whose short side is ≥ 56 m
  (a swoop at 24 m/s turns in ~10 m; a skiff needs more) or on a `road`. The
  rim stops it (physics cylinders), a door or fence blocks it, and a canyon
  mouth ≥ 12 m lets it through — so a ride crosses from an open zone into a
  canyon but never into a hall; the door beat is where you dismount.
- **Off the plate.** A ride carried off a `deck` or over a pier edge falls
  to `killY` and explodes as it does today; the rider is returned by the
  off-path rule. The level's build audit checks that no parked ride sits
  within 6 m of an open edge.
- **Enemy rides.** The nikto swoop is an `air` kind, so every zone with rides
  also draws it (`air: true`) — vehicle-on-vehicle is the point. A ridden
  bantha is a moving wall for a camp assault; a skiff is a mobile platform
  whose deck a second player stands and shoots from.
- **The road beat** (`road` shell, `chase` encounter) is the set piece. Three
  territories get one: the Dune Sea's dune road, the Lava Flats' crust
  causeway, the Great Forge's glass highway. The Ringworld's arcade gets its
  tram as a `Mover` later (Phase 6) — an armored ride you cannot steer is a
  different, good beat. The Storm Docks' harbour crossing by skiff (a `road`
  whose floor is the water plane) is designed but deferred with it.
- **Rides stay in their stage.** A transport door is a map boundary; a ride
  is left where it stands (and remembered there for a return trip). Every
  stage that wants rides parks its own.
- **Rides in arenas.** The two biggest warlord arenas (the Old One's hollow,
  the sleeper's basin) park a swoop and a skiff at the rim: ramming the
  warlord is allowed, and the monster's ground slam wrecks a ride outright.

### 1.9 Stages and transport doors

A run is a list of **stages**, each a map of its own: a purpose-built zone
chain (the v3 level), **the territory itself** (a rimmed, ceilinged region of
the wave board — its real dunes, its real lava rivers, its real dome), an
**existing interior** used whole (the Refinery plant), or **the sea** (the
Prison Rig's swimmable ocean). One stage is the default; a territory takes
more only when its parts want different world rules — sky and fog, gravity,
water, lighting, a roof — or when reusing a map that already exists is better
than rebuilding it. Seven of the nine end up with two or three stages (§3);
the Storm Docks and the Ringworld are one place and stay one map.

A stage boundary is a **transport door** — a door, a canyon mouth, a lift, a
dive hatch, a moon pool — and it behaves by these rules:

- **Forward: one boards, all go.** The moment one living player crosses the
  door's threshold, the party is transported: a 1.5 s beat (the door's light
  goes white, inputs blank, everyone's camera drifts toward the door, the
  transport sting), the loading card for the next stage, and the party
  **re-forms** at the new stage's start with the existing dissolve-and-re-form
  animation. Nobody is left behind and nobody is asked. The threshold sits at
  the end of a 4 m pocket behind the door leaves, so it is stepped through
  deliberately, never brushed by.
- **Back: everyone boards, then go.** The door you arrived by is a transport
  door too, and it takes the party back — but only when **every living
  player** is in its pocket. A player who steps in is marked **exited** on
  every HUD (their portrait dims, the line *⟨name⟩ has stepped out — waiting
  on the others*), their own view shows *You have exited · B to cancel*, they
  take no damage and no input but cancel, and pressing cancel walks them back
  out. The dead are not counted: they are already at the checkpoint. When the
  last living player steps in, the transport plays and the previous stage
  loads **as the party left it** — cleared through the zone they exited, its
  gates open, its garrison gone, its pickups taken — from a `StageMemory`
  the campaign keeps per stage. Going back is a safety valve (a missed cache,
  a ride left behind), and the all-aboard rule is what stops it happening by
  accident.
- **Checkpoints cross with the party.** Arriving in a stage checkpoints its
  start; a wipe in a new stage re-forms the party there, never in the last
  one.
- **The ramp continues.** Difficulty is by *beat*, counted across stages; the
  first zone of stage two is one deeper than the last zone of stage one.
- **What loads.** A stage swap is the match boot's own path — put the loading
  card up, tear the current board down (`Game.dispose`'s subtree pass, the
  physics list, enemies, projectiles, carriers, rides), build the next
  stage, re-place the players — with the next stage's assets **warmed while
  the current one is played** (`prefetch.ts` already plans by mode; it gains
  a stage index), so the card is a beat, not a wait. Music does not stop; the
  ambience swaps with the board.
- **Nothing skips.** A transport door is shut until its zone is clear, like
  any exit barrier, and the ceiling and rim rules hold on every stage.

## 2. The flight ceiling

**What it is for.** Two things, and nothing else: (1) a border cannot be
flown over, so a beat cannot be skipped; (2) the sky is split into a
**playable** band the fight lives in and an **ambient** band above it that
belongs to the backdrop — carriers pass through the ambient band and drop
from it, flying enemies arrive through it but must descend into the playable
band before they engage. It is deliberately *not* a constraint on free
flight: the default is set above the height one full jetpack burn reaches
(a 3.4 s burn at up to 11.5 m/s climbs ~25 m on Tatooine gravity), so the
player who is flying around a zone never touches it, and the one who is
trying to climb the rim meets it a few metres short of the top.

**Spec.** `MissionSpec.ceiling: number` — metres above `floorY`; default 30,
45 on the Spice Run (0.45 g makes a burn go much further). Per territory
(table in §3.10). Overridable for tuning with `?ceiling=40` (any number
10–80); the value in play is printed once to the console at level build and
shown in the HUD's debug line while the override is active. The rule when
tuning: **raise it until nobody notices it in free flight, then check the rim
still cannot be crossed.** The build audit asserts every rim piece clears it
by `RIM_OVER_CEILING`.

**Absolute value.** `Campaign` sets `game.ceilingY = level.floorY + ceiling`
(`Game.ceilingY: number | null`, null outside Missions and on wave boards, so
nothing else in the game changes).

**Who it binds, and how.**

| Body | Where | Rule |
|---|---|---|
| Player (jetpack, super jump, glide, eased descent) | `Player.integrateAndLand` after `moveCapsule`, one clamp | if `position.y + height > ceilingY`: `position.y = ceilingY − height`, `velocity.y = min(velocity.y, 0)`, `thrusting = 0` for the frame (the pack sputters against it: the audio thrust level goes to 0.3 and the nozzle plume is skipped), `gliding` is unaffected (it only descends) |
| Enemy, walkers and boss leaps | `Enemy.update` after integration, all styles | same position/velocity clamp; a **super jump's apex flattens** against it — the leap still lands where it aimed, along a lower arc |
| Enemy, `hover` | `updateHover` | `hoverTarget.y = min(hoverTarget.y, ceilingY − 2)` in addition to the clamp |
| Enemy, `swoop` | `updateSwoop` | `gy = min(gy, ceilingY − 2)`; the 26 m orbit is only used where a zone allows `air` (§1.1), so it never orbits into a cliff |
| Enemy, arriving (`arrival.ts` drives it) | `DROP_HEIGHT` becomes a per-match value | a carrier flies and releases in the **ambient band**: the campaign sets `game.dropHeight = ceiling + 10` (38 m stays the wave game's value), so the pass is always above the ceiling and the bodies **fall through** it — the clamp only acts on a body *below* it moving up |
| Fliers arriving (`fly` mode over the rim) | `arrival.ts` | they cross the rim in the ambient band and descend to their post; from the moment `arriving` ends the clamp holds them |
| Fliers attacking | `updateHover`, `updateSwoop`, `updateVolley` | **no fire from the ambient band**: a flier above `ceilingY` holds its volley and its dive and steers down; it may only attack once inside the playable band. This is the second half of the cut — a swoop that strafes from beyond reach is exactly what the ambient sky is not for |
| Projectiles, rockets, eggs, the ally crate's drop | none | not bound — a rocket lobbed over the ceiling is fine |
| Cameras | none | the chase rig can sit above the ceiling; the sky is still there |

**Exactly what "no one goes above it" means.** The clamp is one-directional:
a body at or below the ceiling cannot pass it upward; a body above it
(arriving, or placed there) is not teleported down, it is simply not allowed
to climb, and gravity brings it in. That is what lets a drop and a flier's
entrance keep reading as coming *down into* the fight.

**Fliers return to Missions.** v2's `squadFor` skipped every `air` kind
because a swoop's orbit did not fit a 20 m room. With a ceiling that keeps
them in reach and 50 m+ open zones, `air` kinds are drawn again — but only for zones with `air: true`
(the `open` and `deck` shells that are ≥ 50 m across). Canyons, halls and
corridors keep skipping them.

**Feedback.** On the first clamp of a run the HUD shows the existing banner
machinery once: *"Ceiling — the storm sits low here"* / *"the hull's field
ends here"* (a per-board line in `TEXT.missions.ceiling`), then never again.
No hard visual wall: a faint horizontal shimmer ring at the contact point for
0.4 s (a pooled additive `RingGeometry`, the vent-glyph technique) is enough
to say "that was the top", and it is cheap.

## 3. Per-territory layouts

Notation for each beat: **shell · encounter · label** — size — set pieces —
*borders / landmark* — arrival. Links between beats are given as a trek
distance where it matters. `⇒` marks a door; **⇒⇒** marks a **transport
door** (§1.9) and the line after it names the stage it opens. Ceilings are
the starting values; every one is a tunable.

Territories run 8 or 9 beats across their stages. `TEXT.missions.rooms`
carries one label per beat, in order — the labels are re-authored below and
must be updated in `text.ts`; the load-time name check stays and now checks
the count too. Each layout ends with its **props** and **rides** lines; ids
are §1.7's. Boss shells are chosen per territory so that roughly half the
lieutenants fight indoors and every warlord fights **outdoors** — the
monsters need the room and the reveal is better under the sky.

**Stage kinds used below.** *territory* — a rimmed, ceilinged region of the
wave board itself, zones laid as rects on its real terrain, waves from its
own validated posts, its props and parked rides already in place (the four
heightfield boards open this way: nothing sells "this is the Dune Sea" like
the dunes). *built* — the v3 zone chain on plates. *interior* — a built
chain of halls and corridors under a roof, with its own fog and lighting and
no sky. *plant* — the Refinery's existing wave board used whole. *sea* — the
Prison Rig's ocean. The v1 campaign failed on the territory board because it
was an open arena with a to-do list; a territory stage is not that: it is a
**bounded region** (the rim follows the heightfield), two or three zones with
trigger lines and an exit barrier, and the ceiling over it — the containment
rules of §1.3 with the board's own ground under them.

### 3.1 The Dune Sea (`desert`) — ceiling 30 · three stages

The reference layout, the one in the brief.

**Stage A — the open desert** (*territory*: the wave board's dunes around
the homestead, a 140×110 m region rimmed by its own mesas plus `ridge`
fill, the sandcrawler on the real horizon).

1. `open` · **start** · *the trailhead flats* — 70×60 — the homestead dome
   and vaporators, the crashed skiff, the board's own rocks; *the mesas on
   both sides and behind; the ravine mouth ahead, framed by two 36 m mesa
   pillars, dark between them* — no fight. Two swoops and a bantha by the
   dome.
2. `road` · **chase** · *the dune road* — 28×160 over the real dunes, two
   bends — a landspeeder, two swoops and the skiff parked at the near mouth, a
   spare swoop pair at the 50 m mark; *rim both sides, cairns every 20 m* —
   nikto swoops on the flanks, drops at 60 m and 110 m, a crate barricade at
   the far mouth. The road ends at the ravine mouth: **⇒⇒ the ravine**.

**Stage B — the ravine and the outpost** (*built*, then *interior*: the
canyon under the open sky, the cistern behind its door).

3. `canyon` · **camp** · *the ravine* — 14×70, one bend — Tusken tents past
   the bend, boulders as cover, bacta in a side crack; *cliffs both sides* —
   Tusken garrison (they cannot be seen from the mouth; they can hear you).
4. `canyon` · **assault ×2** · *the cistern approach* — 12×50, dead end — a
   lamp-lit blast door in a hewn rock face (⇒ the outpost); *cliffs* —
   carrier drops only. The door unlocks on the last body.
5. `corridor` + `hall` · **assault ×2** · *the cistern court* — corridor 6×14
   with a bend, hall 20×18 — the **sarlacc-maw pit** in the middle, alcove
   bacta; *walls, roofed at 9 m* — wall hatches. Its far door is an airlock
   onto the far side of the mesas: **⇒⇒ the fighting pit**.

**Stage C — the far side** (*built*: open ground and the last canyon, the
tallest mesas of the level).

6. `open` · **lieutenant** · *the fighting pit* — 56×50 — a bowl ringed by
   rocks, four cover rocks; *rim; the airlock behind you, a fence ahead* —
   the **sandworm**, which now has sand to burrow through.
7. `canyon` · **assault ×3** · *the dune gate* — 16×60, widening toward the
   end, one bend — caravan crates, a **pass** at the far end; *cliffs* —
   drops + massiffs/Tuskens running in through the pass.
8. `open` · **camp** · *the caravan graves* — 44×40 — the half-buried sail
   barge as the cover playground, wrecked skiffs, the **Fennec cache**; *low
   rim* — posted garrison.
9. `open` · **warlord** · *the Old One's hollow* — 80×70 — the tallest mesas
   of the level all round, a grounded troop carrier wreck at one side, a
   sunken centre; a swoop and a skiff parked at the rim; *fence behind,
   nothing ahead* — the Pit Warlord, then the **krayt** erupts.

Air: beats 1, 2, 6, 8, 9 (`air: true`).
Props: the board's own (`homestead_dome`, `vaporator`, `sandcrawler`,
`tusken_tent`) in stage A; `tusken_tent` ×3, `cargo_crate`, `corridor_crate`,
boulders in B; `sail_barge`, `troop_carrier` (wreck), boulders in C.
Rides: beat 1 swoop ×2 + bantha; beat 2 landspeeder, swoop ×2, skiff, spare
swoop ×2; beat 9 swoop + skiff. Rides do not cross a transport door.

### 3.2 The Spice Run (`station`) — ceiling 45 · three stages

No mountains: the void is the border and the platforms are the guide. Rule:
the next platform is always **lit along its near edge**, within 12–18 m, and
never more than 6 m higher than the one you stand on. The station's inside
is a different world from its outside — flat 0.45 g throughout, no drift, no
starfield, hull fog and work lights — which is exactly what a stage is for.

**Stage A — the approach** (*built*, deck shells under the board's gravity
field and starfield).

1. `deck` · **start** · *the docking bay* — 40×30 pad — a landed freighter,
   parked crates, a fuel bowser; *the void; the **station hull** fills the sky
   ahead, 120 m off, with one lit cargo door on its face* — no fight.
2. `deck` × 3 · **camp** · *the cargo gantries* — three 18×14 plates, 15 m
   gaps, stepping 4 m up each — pirates posted on each plate; *void*.
3. `deck` · **assault ×2** · *the outer yard* — 44×36 plate against the hull —
   cargo containers, two cranes overhead; *the hull wall on one side (a
   `hull` ridge 40 m tall), void on three; the cargo door in the hull* —
   raider dropship passes + **jetpack pirates** over the edge. `air: true`.
   The cargo door is an airlock: **⇒⇒ inside the station**.

**Stage B — inside the station** (*interior*: gravity 0.45 flat, roofed
halls at 8 m, hull-plate walls, sodium work light, no sky).

4. `corridor` + `hall` · **assault ×2** · *the spice vault* — 5×14 corridor
   with a bend, hall 20×18 — **rhydonium barrels**, alcove; hatches.
5. `hall` · **lieutenant** · *the loading gantry* — 24×20 — pillars — the
   **gunslinger**: a gunfight in a hold. Its far door: **⇒⇒ the far side**.

**Stage C — the prize** (*built*, back under the stars and the gravity
field).

6. `deck` × 3 · **camp** · *the crew catwalks* — three plates along the
   hull's other face; the **Fennec cache** on the middle one; *void, hull
   behind*.
7. `deck` · **assault ×3** · *the reactor ring* — a 40×32 annulus around the
   refinery spire (`reactor_core`, 16 m column, physics cylinder); *void* —
   dropships + jetpack pirates. `air: true`.
8. `deck` · **warlord** · *the hold of the prize* — 60×50 plate — container
   cover, a parked raider dropship at the far edge; *void; a fence behind* —
   the capo, then the **mudhorn** through the deck plates.

Props: `freighter` (landed, beat 1), `cargo_crane` ×2 (beat 3), the hull
(`hull` ridge under the large-scale hull texture, §9), `reactor_core` (beat
7's spire), `raider_dropship` (parked, beat 8), `cargo_crate` throughout,
`fuel_barrel` (steel).
Rides: none — the jetpack is the road, and the board's gravity makes it one.

### 3.3 The Lava Flats (`nevarro`) — ceiling 30 · three stages

**Stage A — the flats** (*territory*: the wave board's lava flats between
its two real rivers, rimmed by `basalt` ridge, the town gate's real towers
at the far end).

1. `open` · **start** · *the ash flats* — 64×56 — the board's lava river
   crossing the flat on its crust plates, the wrecked survey crawler, basalt
   rocks; *basalt rim; the gate towers ahead, glowing from the lava between
   you and them* — no fight. Two speeder bikes by the crawler.
2. `road` · **chase** · *the crust causeway* — 26×140, one bend — a causeway
   of cooled crust with **live lava either side** (the board's own rivers:
   drift and you cook), speeder bikes ×3 at the mouth; *basalt rim beyond the
   lava* — swoops overhead, drops at 50 m and 100 m, a fence barricade at the
   far mouth with a pirate squad behind it.
3. `open` · **assault ×2** · *the town gate* — 44×36 in front of the gate —
   the two adobe watchtowers flanking the adobe gate arch, its leaves shut,
   basalt cover; *the town wall; drops*. The gate is the way in: **⇒⇒ the
   garrison**.

**Stage B — the garrison** (*interior*: adobe walls, roofed 8 m, lamp light).

4. `corridor` + `hall` · **assault ×2** · *the garrison yard* — 22×16 —
   crates, alcove; hatches.
5. `hall` · **lieutenant** · *the magistrate court* — 24×22 — pillars — the
   promoted **massiff**. Its far door: **⇒⇒ the glass fields**.

**Stage C — the glass fields** (*built*).

6. `open` · **assault ×3** · *the crossing* — 50×44 — two lava channels with
   bridges; *rim with a pass* — drops + massiffs through the pass.
   `air: true`.
7. `canyon` · **camp** · *the lava trench* — 14×70, one bend — a lava channel
   along one wall, the walk on the other, the **Fennec cache**; *basalt
   cliffs* — pirates behind basalt.
8. `open` · **warlord** · *the rancor pen* — 76×66 — a lava moat ring at the
   rim's foot (burn, 3 m wide, bridged at the entry), rhydonium barrels
   seeded; *basalt rim, fence behind* — the officer, then the **rancor**.

Props: the board's own (`survey_crawler`, `adobe_tower` ×2, `adobe_gate`) in
stage A; `cargo_crate`, `fuel_barrel` (rhydonium), basalt boulders.
Rides: beat 1 speeder bike ×2; beat 2 speeder bike ×3.

### 3.4 The Crevasse (`crevasse`) — ceiling 32 · traction 0.55 · two stages

The theme *is* a canyon, so this board leans hardest on the ravine beat —
and the second half goes **under the ice**, which is a cavern with a roof, a
different light and no sky: its own stage.

**Stage A — the surface** (*territory*: the wave board's north rim
snowfield and the crevasse's upper reach, `ice` ridge).

1. `open` · **start** · *the rim shelf* — 60×50 snowfield — the wrecked
   survey crawler, ice boulders; *ice cliffs; the crack ahead, a dark seam
   between two 36 m ice pillars* — no fight. Trek 40 m.
2. `canyon` · **camp** · *the frozen gallery* — 12×80, two bends — ice
   **pillars**, bacta in a crack; *ice cliffs* — krykna posted past the first
   bend.
3. `canyon` · **assault ×2** · *the nest mouth* — 10×40, dead end — an
   ice-crusted door in the glacier face; *cliffs* — drops. **⇒⇒ the deep**.

**Stage B — the deep** (*interior* cavern: a stalactite roof at the
ceiling's height, ice-blue fill light and lamps, fog close, traction 0.55,
the frozen lake and the breaker pool in an open cavern floor).

4. `corridor` + `hall` · **assault ×2** · *the queen tunnel* — 20×18 —
   pillars, alcove; hatches.
5. `hall` · **lieutenant** · *the hatchery* — 24×20 — pillars, egg sacs as
   breakables — the promoted **krykna**.
6. `open` · **assault ×3** · *the cracked lake* — 50×46 under the cavern
   roof — flat ice, traction 0.4 in a 20 m disc at the centre, no cover in the
   disc, boulders at the edge; *ice walls with a pass* — drops through roof
   vents (the carrier is heard, not seen) + krykna through the pass.
7. `canyon` · **camp** · *the ice chimney* — 14×50 — the **Fennec cache**;
   *ice walls*.
8. `open` · **warlord** · *the breaker deep* — 72×62 — ice walls all round, a
   frozen pool at the centre; *fence behind* — the broodmother, then the
   **ravinak**.

Props: `survey_crawler` (beat 1), the board's ice spires as cover,
`krykna_brood` egg sacs as breakables in the hatchery, `corridor_crate`, ice
boulders.
Rides: none — nothing with a repulsor belongs on this ice, and the board's
personality is on foot.

### 3.5 The Storm Docks (`trask`) — ceiling 28 · one stage

Borders are warehouse rows (`warehouse` ridge, 34 m) and the **sea**: an
open edge of a pier or quay drops into a local water plane at `floorY − 3`.
Going in is "off the path" — you are hauled back to the checkpoint after a
two-second cold beat (the banner: *the harbour took you*). One place, one
map: the freighter's hold is a small interior and nothing about the world
changes inside it.

1. `open` · **start** · *the quay steps* — 60×40 — the dock shed, crates, a
   beached skiff; *warehouses on one side, the sea on the other; the pier
   chain runs out ahead under the pier lamps* — no fight. Trek 30 m.
2. `canyon` (pier) · **camp** · *the fish market* — 8×70, the sea both sides —
   market stalls and fish racks as cover; *the drop* — quarren posted among
   the stalls.
3. `canyon` · **assault ×2** · *the net lofts* — 12×46 between two warehouse
   rows, dead end at a **freighter's cargo door** (⇒ the freighter's hull);
   *walls* — drops.
4. `corridor` + `hall` · **assault ×2** · *the freighter hold* — 20×18 —
   **barrels**, alcove; *roofed 8 m* — hatches.
5. `hall` · **lieutenant** · *the cold stores* — 24×20 — the officer,
   indoors.
6. `corridor` ⇒ `open` · **assault ×3** · *the trawler deck* — 52×44 — the
   trawler's deck with its deckhouse as cover; *the sea on three sides, the
   freighter's hull behind* — drops + **quarren surfacing** at the deck's
   edge (arrival `swim`, using the local water plane). `air: true`.
7. `canyon` (pier) · **camp** · *the pier heads* — 10×50 — the **Fennec
   cache**; *the drop*.
8. `open` · **warlord** · *the mamacore pool* — 70×60 dock ring around a
   16 m pool (kill hazard; the beacon never in it); *warehouses, fence behind*
   — the capo, then the **mamacore** from the pool.

Props: `dock_shed` (beat 1), `fish_rack` ×4 (beats 2, 7), `freighter` (the
hold's exterior at beat 3's dead end), `trawler` (beat 6's deck; a `Mover` in
the later phase), `cargo_crate`, `fuel_barrel`.
Rides: the skiff, parked on the quay at beat 1 — the pier is 8 m wide and
the skiff 1.7 m in radius, so it can be taken down the fish market as a
moving wall. The **harbour crossing** (a `road` on the water plane between
beats 6 and 7) is designed but deferred with the mover.

### 3.6 The Refinery (`refinery`) — ceiling 30 outdoors · three stages

The one wave board that is an interior — so the Mission starts *outside* it,
and the plant in the middle is **the wave board itself**, used whole: its
halls, its 40 m reactor shaft, its catwalks, its alarm consoles and barrel
rows are already built and audited, and a zone chain laid over them beats
rebuilding a lesser copy.

**Stage A — the yard** (*built*, outdoors, `tank` ridge).

1. `open` · **start** · *the tanker yard* — 60×50 — a tanker truck, drums;
   *storage tanks (30 m cylinders, walkway railings between) and a fence
   wall; the plant's intake door lit in the wall ahead* — no fight. A
   landspeeder by the truck. Trek 35 m.
2. `canyon` · **camp** · *the pipe run* — 12×60 between pipe racks and tank
   walls — **barrels**; *tank walls* — stormtroopers behind the drums.
3. `canyon` · **assault ×2** · *the intake ramp* — 12×40, dead end at the
   intake hall's blast door; *walls* — drops. **⇒⇒ the plant**.

**Stage B — the plant** (*plant*: the Refinery wave board, `enclosed`, its
own lighting; zones are rects over its rooms, hatches are its existing
doors, the ceiling is its roof).

4. `hall` · **assault ×2** · *the barrel stores* — the board's barrel hall —
   barrels, alcove; hatches.
5. `hall` · **lieutenant** · *the reactor floor* — the shaft's base, the
   40 m chimney overhead, catwalks as the high ground — the **flametrooper**.
   The jetpack owns the shaft, which is the point of fighting here.
6. `hall` · **assault ×2** · *the pump hall* — crates; hatches. Its far door
   is the plant's rear airlock: **⇒⇒ the loading field**.

**Stage C — the loading field** (*built*, outdoors).

7. `open` · **camp** · *the reactor crown* — 50×44 — the shaft's open top
   (`reactor_core` rising through it: it clears the ceiling), railings, vent
   stacks as cover, the **Fennec cache**; *tanks and the plant's wall*.
8. `open` · **warlord** · *the loading field* — 70×60 — barrels seeded in
   the fight; *tank ridge, fence behind* — the officer, then the **zillo**
   from under the yard.

Props: `pipe_rack` (beat 2), the plant's own everything in stage B
(`alarm_console`: the alarm mechanic runs as on the wave board),
`reactor_core` (beat 7), `fuel_barrel` (rhydonium), `cargo_crate`.
Rides: a landspeeder in the tanker yard for the trek to the ramp.

### 3.7 The Great Forge (`forge`) — ceiling 34 · three stages

The board whose personality is emptiness — so it opens with the longest
ride in the game, across the real plain toward the real dome.

**Stage A — the plain** (*territory*: the wave board's glassed plain from
the outer rim to the dome, `ruin` ridge fill).

1. `open` · **start** · *the glassed plain* — 70×60 — shard rocks, three
   speeder bikes and a landspeeder by the trailhead's cairn; *ruin rim; the
   dome's broken ribs on the skyline ahead, the highway toward them between
   two standing pylons* — no fight.
2. `road` · **chase** · *the glass highway* — 30×180, two bends — ruin pylons
   every 20 m; *ruin rim* — swoops on the flanks, drops at 60 m and 120 m, a
   fence barricade at the far mouth held by alamites.
3. `open` · **assault ×2** · *the shattered gate* — 44×40 at the dome's foot
   — rubble, the vault door in the dome wall; drops. **⇒⇒ the undercroft**.

**Stage B — the undercroft** (*interior*: carved-relief walls, roofed 9 m,
brazier light).

4. `corridor` + `hall` · **assault ×2** · *the dome undercroft* — 20×18 —
   **pillars**, alcove; hatches.
5. `hall` · **lieutenant** · *the armoury vault* — 22×20 — the promoted
   **alamite**. Its far door climbs to the court: **⇒⇒ the glassed court**.

**Stage C — the dome and the basin** (*built*, open sky through the broken
roof).

6. `open` · **assault ×3** · *the glassed court* — 54×48 — inside the dome
   ring, the forge brazier lit on its dais at the centre (a physics cylinder;
   fight around it), ruin pillars; *the ring wall with a pass* — drops +
   alamites through the pass. `air: true`.
7. `canyon` · **camp** · *the forge steps* — 14×50 — the **Fennec cache**;
   *ruin walls*.
8. `open` · **warlord** · *the sleeper's basin* — 80×70 — a sinkhole: the
   Living Waters pool at the centre, the half-buried mythosaur skull at the
   rim; a swoop and the skiff parked at the entry; *rock rim all round, fence
   behind* — the enforcer, then the **mythosaur** from the pool.

Props: the board's own dome and ribs in stage A, `forge_brazier` (beat 6),
`mythosaur_skull` (beat 8), ruin rubble, `corridor_crate`.
Rides: beat 1 speeder bike ×3 + landspeeder; beat 8 swoop + skiff.

### 3.8 The Ringworld (`ringworld`) — ceiling 28 · one stage

Urban outdoors: the cliffs are tower facades (`panel` ridge with the
`city_facade` textures), canyons are streets, opens are plazas. One place
under one sky, so one map; the terminator's dark side is a later flourish.

1. `open` · **start** · *the tram stop* — 56×48 plaza — the parked tram,
   kiosks; *towers on three sides; the high street runs off ahead under a
   neon arch* — no fight. Trek 30 m.
2. `canyon` · **camp** · *the market arcade* — 16×80, straight — kiosks and
   crates (long sightlines: the street feel); *facades* — pirates in the
   kiosks.
3. `canyon` · **assault ×2** · *the night-side row* — 12×50, dead end at the
   terminus's door (⇒); *facades* — dropships.
4. `corridor` + `hall` · **assault ×2** · *the terminus* — 22×18 — crates,
   alcove; *roofed 8 m* — hatches.
5. `hall` · **lieutenant** · *the sentinel walk* — 22×22 — the **ring
   enforcer**, indoors, pillars.
6. `corridor` ⇒ `open` · **assault ×3** · *the plaza* — 50×44 — a fountain
   (physics cylinder) and benches; *facades with a pass (an alley)* —
   dropships + **jetpack pirates**. `air: true`.
7. `canyon` · **camp** · *the service spine* — 14×60 — the **Fennec cache**;
   *facades*.
8. `open` · **warlord** · *the high street terrace* — 64×56 — a raised
   terrace over the ring's curve (visual backdrop: the far side of the ring);
   *towers, fence behind* — the gunslinger, then the **nexu**.

Props: `tram` (parked at the tram stop; running the arcade on a loop as a
`Mover` later — the armored ride through beat 2), `street_kiosk` ×6 (beat 2)
and ×3 (beat 6), `cargo_crate`.
Rides: a swoop pair at the tram stop for the plaza fight (beat 6 is 50 m
across — just wide enough); the tram is the road beat here.

### 3.9 The Prison Rig (`narkina`) — ceiling 28 · four stages

The wave board's best half is **under the water** — a kelp forest, a reef, a
sunken transport you swim through, a moon pool that surfaces inside the
facility — and a level 90 m in the sky can never reach it. So the Mission
goes down: decks, then the sea, then the block it surfaces into, then the
top decks. The sea is a stage of its own (water rules, its own light and
fog, no ceiling but the surface).

**Stage A — the landing deck** (*built*, `panel` ridge, the sea at the
edges).

1. `open` · **start** · *the landing deck* — 56×44 — a landed troop carrier,
   crates; *the block's wall on one side, the sea on two; the gantry ahead
   between two hull walls* — no fight. Trek 30 m.
2. `canyon` · **camp** · *the gantry run* — 12×60 between two hull walls —
   two **shock strips**; *hull walls* — troopers posted past the first strip.
   The gantry ends at a **dive hatch** over the water: **⇒⇒ the sea**.

**Stage B — the sea** (*sea*: the wave board's ocean floor, kelp, reef and
wreck, the surface as the ceiling, swim rules, drowning as the clock).

3. `open` (underwater) · **trek** · *the kelp forest* — 90×70 of sea floor —
   the way marked by the reef's glow and the wreck's silhouette; *the reef
   walls; the kwazel maw's shadow crosses the light once, far off* — no
   hostiles; the clock is air. A bacta cache in the sunken transport's
   corridor for whoever swims through it.
4. `canyon` (underwater) · **trek** · *the moon pool shaft* — the pool's
   pylons, 12×40 up to the surface inside the block — the light above is the
   goal. Surfacing is the transport: **⇒⇒ the cell block**.

**Stage C — the cell block** (*interior*: white panels, shock floors,
roofed 7 m, hard white light).

5. `corridor` + `hall` · **assault ×2** · *the work floor* — 20×16 — shock
   strips, alcove, the alarm console; hatches.
6. `hall` · **lieutenant** · *the supervisor deck* — 22×20 — the
   **deathtrooper**. Its far door is the lift: **⇒⇒ the top decks**.

**Stage D — the top decks** (*built*, `panel` ridge, the sea at the edges).

7. `open` · **assault ×3** · *the assembly deck* — 50×44 — the open top
   deck, shock plates, vent stacks, the beached sunken transport's twin as a
   wreck against the edge (standable cover), the **Fennec cache**; *hull
   walls on two sides, the sea on two* — drops. `air: true`.
8. `open` · **warlord** · *the moon pool deck* — 66×56 ring around a 14 m
   pool (water at the centre — the thing below has been following you);
   *hull walls, fence behind* — the officer, then the **kwazel maw** from
   the pool.

Props: `troop_carrier` (landed, beat 1), the board's own kelp, reef and
`sunken_transport` in stage B, `alarm_console` (beat 5), a wreck on beat 7,
`cargo_crate` (white skin), `fuel_barrel`.
Rides: none — the decks are too tight and the sea too close; the rig's
personality is the shock plates and the dive.

### 3.10 Ceiling and stage table

| | desert | station | nevarro | crevasse | trask | refinery | forge | ringworld | narkina |
|---|---|---|---|---|---|---|---|---|---|
| ceiling | 30 | 45 | 30 | 32 | 28 | 30 (plant: its roof) | 34 | 28 | 28 (sea: the surface) |
| stages | 3 | 3 | 3 | 2 | 1 | 3 | 3 | 1 | 3 |
| opens on | the territory | built decks | the territory | the territory | built | built yard | the territory | built | built |

Every ceiling is above a full jetpack burn on that board's gravity (the Spice
Run's 45 assumes its 0.45 g pads; the drift between platforms is lighter
still, which is why it is the one to watch). The Ringworld and the two rig /
dock boards run lower because their borders are buildings and hull, which
read wrong past ~35 m; the Forge runs highest because its ruin rims are the
tallest thing on any board.

## 4. Guidance

The v2 guide is a light pillar at the objective, a gold radar pip and a
distance on the HUD line. Outdoors, with 80 m zones and bends, that is not
enough on its own: the pillar is often behind a cliff and the radar gives a
bearing, not a picture. v3 layers four things, all driven by the one
`objectivePos` the campaign already owns, so there is still exactly one
objective.

1. **The landmark rule (authoring).** Every zone's exit is a *thing* you can
   see from its entry: the pillar-framed canyon mouth, the lamp over a door
   in the rock, the lit edge of the next platform, the neon arch. The build
   audit raycasts from each zone's `entry` (at eye height) to its exit point
   and to the top of the exit's pillars, and fails the level if none of
   those rays is clear. Bends are allowed inside a zone because the pillars
   at its far mouth stand taller than the bend hides.
2. **The screen marker (`ui/hud.ts`, per viewport).** A diamond drawn at the
   objective's projected screen position with the label and distance under
   it (*the ravine · 42 m*); when the objective is outside the viewport, the
   diamond slides to the viewport edge and becomes a chevron pointing at it.
   Per player, per frame, using that player's own camera
   (`ThirdPersonCamera.camera.project`); the existing HUD line keeps the
   instruction ("Make for…"). The marker is the guide that survives fog,
   night side and a bend at once.
3. **The ground arrow (`game/campaign.ts`).** On `clearRoom` — the moment a
   checkpoint is earned — a flat chevron (additive, palette accent, 3 m
   long) lays down at the cleared zone's exit, pointing along the path to the
   next zone's entry, and pulses for 8 s; the existing checkpoint chime and
   *Push on to …* banner play with it. The chevron then dims to 0.25 and
   stays as a breadcrumb. Where a trek is longer than 30 m the level also
   carries **trail posts** — emissive marker posts every ~15 m along the
   golden path (`MissionLevel.path`, §5.2), lit in the accent colour on the
   side facing back toward the party — the Minecraft Dungeons breadcrumb.
4. **The beacon pillar (kept).** The v2 light pillar and radar pip remain,
   because they work from any distance and cost nothing. Its position rule
   changes slightly: in `travel` it stands at the next zone's **entry** (the
   mouth, the door); in `fight` at the exit barrier (a shut door with a
   pillar over it reads "clear the area to open it"); in an arena, on the
   boss.

**Transport doors as guides.** A transport door reads as *more* than a door:
a wider frame, a white-blue light distinct from the accent, the marker's
label says where it goes (*the ravine · airlock*), and the confirm pocket
behind the leaves is lit. On the way back it is the only door in the stage
whose marker is dimmed rather than lit — the way on is never in doubt.

**Doors and fences as guides.** A shut barrier is dark (the seam glows red);
the moment it may open, the frame's trim goes to the accent colour and the
lamp over it lights, *before* the leaves move. Fences do the same with their
pylon tops. What is ahead is always the brightest thing in the direction of
travel.

**When the guidance changes state.** It is tied to the campaign's existing
phase machine and needs no new state:

| Campaign state | Marker target | Pillar | Ground arrow |
|---|---|---|---|
| `travel` toward zone *i* | zone *i*'s entry | at the entry | at zone *i−1*'s exit, dimmed after 8 s |
| `fight` in zone *i* (camp/assault) | zone *i*'s exit barrier | at the exit | — |
| `fight` in an arena | the boss | on the boss | — |
| `clearRoom(i)` | → zone *i+1*'s entry | → entry | laid at zone *i*'s exit, pulsing |

## 5. Engineering design

### 5.1 Data model (`src/world/mission.ts`)

```ts
export type Shell = 'open' | 'canyon' | 'hall' | 'corridor' | 'deck' | 'road';
export type Encounter = 'start' | 'trek' | 'camp' | 'assault' | 'chase' | 'lieutenant' | 'warlord';
export type RidgeStyle = 'rock' | 'ice' | 'basalt' | 'ruin' | 'hull' | 'tank' | 'panel';

export interface ZoneSpec {
  shell: Shell;
  kind: Encounter;
  label: string;                 // TEXT.missions.rooms[board][i]
  w: number; l: number;
  waves?: number;                // assault
  feature?: RoomFeature;         // pit | lava | shock | barrels | pillars | crates  (v2, kept)
  alcove?: boolean;
  air?: boolean;                 // fliers may be drawn for this zone
  bends?: (-1 | 1)[];            // canyon: up to two bends at l/3 and 2l/3
  deadEnd?: boolean;             // canyon: the exit is a door in the far face, not a mouth
  pass?: boolean;                // open: a runner notch in the far rim
  lookouts?: number;             // trek: posted sentries
  plates?: { w: number; l: number; gap: number; rise: number }[];   // deck: platform chain
  roofH?: number;                // hall: default 8
  entry?: 'door' | 'fence' | 'mouth';   // default by shell pair; see §1.3
  exit?:  'door' | 'fence' | 'mouth' | 'barricade';   // barricade: road only
  /** authored sculpts, zone-local (u along travel, v across); §1.7 */
  props?: { id: string; u: number; v: number; yaw?: number; size?: number; collide?: boolean }[];
  /** rides parked in the zone, zone-local; §1.8 */
  vehicles?: { kind: VehicleSpec['kind']; u: number; v: number; yaw?: number }[];
  /** road: where the drops come along it (fractions of l) and what holds the far mouth */
  marks?: number[];
  barricade?: 'fence' | 'crates';
}

export type StageKind = 'built' | 'territory' | 'interior' | 'plant' | 'sea';
export type PortalKind = 'door' | 'mouth' | 'lift' | 'dive' | 'surface';

/** one map of the run; a territory's `MissionSpec.stages` is walked in order */
export interface StageSpec {
  kind: StageKind;
  label: string;                 // the loading card's line: "the ravine"
  /** world overrides for this stage: fog, sky, gravity, waterY, lighting, roof */
  world?: Partial<Pick<Board, 'fog' | 'background' | 'skyFile' | 'gravity' | 'waterY' | 'enclosed' | 'heroLight'>> & { roof?: boolean };
  ceiling?: number;              // overrides the spec's; a sea stage uses the surface
  /** territory stages: the region of the wave board the rim follows (world x,z polygon) */
  region?: [number, number][];
  zones: ZoneSpec[];
  links: LinkSpec[];
  /** how this stage is left; the last stage has none */
  exitPortal?: PortalKind;
}

export interface MissionSpec {
  palette: { wall: number; floor: number; trim: number; accent: number; rock: number; backdrop: number };
  ridge: RidgeStyle;
  ceiling: number;               // metres over floorY; default 30
  stages: StageSpec[];           // one or more; `zones`/`links` below are stage 0's when there is one
  corrW?: number; wallH?: number; roofH?: number; traction?: number; fill?: number;
  water?: boolean;               // a local water plane at floorY - 3 beyond open edges (trask, narkina)
  zones: ZoneSpec[];
  links: LinkSpec[];             // one per pair; `len` is now the trek length (12–90); bends as before
}
```

`RoomSpec` → `ZoneSpec` and `rooms` → `zones` throughout (`MissionRoom` →
`MissionZone`; the campaign's `room` getter and every test that reads
`c.level.rooms` follow). Keep a `rooms` alias getter on `MissionLevel` for
one release so `tools/test-modes.mjs` keeps passing until it is updated.

`MissionLevel` gains:

```ts
ceilingY: number;
/** the local water plane on water boards (Vehicle and the off-path rule read it) */
waterY?: number;
/** every parked ride, in world space — Game spawns these in place of the board's */
vehicles: VehicleSpec[];
/** the golden path: entry, bend points and exit of every zone, in order — trail posts and the autopilot */
path: THREE.Vector3[];
/** per zone: the trigger line's u along travel (outdoor assaults) */
zones: MissionZone[];   // { spec, entry, center, exit, rect, sealRect, triggerU, entryBarrier, exitBarrier, vents, farVents, sideVents, posts, hatches, landmark }
```

### 5.2 Builder (`buildMission`)

The turtle-of-frames walk stays exactly as it is; what each step emits
depends on the shell. New helpers inside `buildMission`, all writing into the
same `group`/`physics`/`rects`/`blocked` the v2 helpers use:

- `ridge(points, opts)` — §1.4. Returns the pillar positions it framed gaps
  with (for the landmark audit).
- `openZone(f, zs)` — floor plate; a rim polyline: back edge (with the entry
  gap at v = 0 unless it is the start), both sides, front edge (exit gap;
  `pass` cuts a second 4 m notch at v = ±w/3 for runners with a **runner
  post** 8 m outside it that `arrival.ts` can use as the `run` mode's
  `from`); backdrop row; cover rocks where v2 put crates (`clearOf` as now);
  vents: far-wall and side vents as now but pulled 4 m in from the rim.
- `canyonZone(f, zs)` — floor plates per leg with bends handled like the v2
  junction but *without* walls: each leg gets a `ridge` on both sides and the
  junction's outer corner gets a pillar; `deadEnd` closes the last leg with a
  **door face** (a 10 m wide `ridge` piece of the `hull` style with a `Gate`
  set into it and a lamp over it); otherwise the far mouth gets pillars and
  either nothing or a `Fence`.
- `hallZone` / `corridorLeg` — v2's room and leg builders, unchanged apart
  from: the room grows a roof slab at `roofH` (`solid` at `top + roofH`), the
  work lamp drops to `roofH − 0.4`, and two **hatches** (a `Gate` in each
  side wall at l/2 with a 3×4 closet behind it; `hatches: {gate, post}[]`)
  replace the far/side vents for wave arrival.
- `roadZone(f, zs)` — a `canyon` with the lane width of an `open`: legs on
  the same turtle, bends through a junction square the road's own width (a
  30 m square is a corner a swoop takes at speed), rim both sides, cairns or
  pylons every 20 m (the trail posts, bigger), the drop marks (`marks`) as
  vents 6 m in from the rim on both sides, and the far mouth closed by a
  `Fence` or a **crate line** (six `cargo_crate` breakables across the mouth
  at 40 hp each; a ram or a rocket opens a gap). Ride parking at u = 6 and at
  `l / 3`.
- Stages: `buildMission` becomes `buildStage(board, spec, stageIdx)` and
  returns one `MissionLevel` per stage. A `built`/`interior` stage is the v3
  chain on plates (an `interior` adds the roof slab at the ceiling and its
  own hemisphere + lamps, and its board overrides set `fog` close and
  `background` dark); a `territory` stage skips plates and `ridge`s the
  `region` polygon along the board's `heightAt`, lays zones as rects on the
  terrain, and takes vents from the board's `groundSpawns` that fall inside
  each zone (validated as now); a `plant` stage is the Refinery board with
  zones as rects over its halls and its doors registered as hatches; a `sea`
  stage builds nothing but the portal pylons and the markers — the wave
  board's sea is the map. The **transport door** is a `Portal`: a `Gate`
  variant 5 m wide with a 4 m pocket behind it, a threshold trigger at the
  pocket's end, and the white-blue frame light.
- Props: `zs.props` placed through `authoredProp` after the zone's own
  geometry, with `fitColliders` when `collide` is set; each lands on the
  `blocked` list so cover and vents stay out of it. A landmark prop (a
  crawler, a barge, a skull) is placed *before* vents are validated.
- Rides: `zs.vehicles` transformed to world space and appended to
  `level.vehicles`; the audit rejects one within 6 m of an open edge or
  inside a zone whose short side is under 56 m unless the zone is a `road`.
- `deckZone(f, zs)` — one plate or a chain of plates (`plates[]`) with gaps
  and rises; an emissive strip along each plate's near edge; no rim. The
  level's `contains` covers plates only, so the off-path rule catches a miss.
- `Fence` — `Gate`'s sibling: two pylons (physics cylinders r 0.5, 4 m),
  an additive pane between them spanning the gap to `ceiling` (so nothing
  hops it), a blocker box like `Gate`'s, `open()` fades the pane over 0.5 s
  and drops the blocker at 0.8 of the fade. Both implement
  `interface Barrier { open(): void; close(): void; readonly closed: boolean; update(dt): void; pos }`,
  and `MissionZone.entryBarrier/exitBarrier: Barrier | null` replace
  `entryGate/exitGate`.
- Water: when `spec.water`, one `PlaneGeometry` at `floorY − 3` under the
  whole footprint plus 60 m, tinted from the palette; not a `Hazard` — the
  campaign's off-path check gains `p.position.y < floorY − 2.5` on water
  boards (§5.3).
- Trail posts: for every link with `len ≥ 30`, posts every 15 m along the
  link's legs at v = +2 (mesh + tiny emissive head; no physics).
- Validation runs as now (`fits` per vent/post/hatch post/runner post),
  plus the **landmark audit** (§4.1) and the **ceiling assert** (§2). Both
  `console.warn` in dev and are asserted by the test.

### 5.3 Campaign (`src/game/campaign.ts`)

- **Stages.** `Campaign` holds `stageIdx`, the current `level`, and a
  `StageMemory[]` (per stage: the zone index cleared through, pickups taken,
  rides left and where). Beat numbering for the ramp is global across stages
  (`rampWave` takes the beat's index in the whole run). `enterStage(i,
  fromBack)` runs the transition: `game.transition(label)` (the 1.5 s beat,
  inputs blanked, cameras drift to the door), `game.swapStage(() =>
  buildStageBoard(i))` (loading card via `LoadingScreen.show` dressed with
  the stage label; teardown of the current board through the existing
  `dispose` subtree pass plus the entity lists; build; `hud.setLayout`
  untouched), then players `spawnAt` the stage's starts with the re-form
  animation, checkpoint = the stage start. A stage entered `fromBack` is
  built with its memory applied: gates open through the cleared zone, no
  garrison there, taken pickups absent, rides parked where they were left.
- **Portals.** Forward: the exit portal's threshold trigger with any living
  player inside → `enterStage(stageIdx + 1)`. Back: the entry portal's
  pocket keeps `exited: Set<slot>`; a player in the pocket is `p.exited =
  true` (no input but cancel, no damage, the HUD state below); cancel
  (`input.back`) walks them 3 m out and clears it; when `exited` equals the
  living set, `enterStage(stageIdx − 1, true)`. The first stage's entry has
  no back portal.
- **Prefetch.** `matchAssets(board, chars, mode)` gains a stage index; the
  campaign calls `warmFor` for stage *i+1* as stage *i* begins, so a swap's
  card is a beat, not a wait. Territory stages need nothing new (the board
  is already built at match start); a `plant` stage warms the Refinery's
  prop list.
- `game.ceilingY = level.ceilingY` in the constructor and on every stage
  swap; null on teardown.
- `enterRoom` → `enterZone`, with the §1.3 table: outdoor assaults close only
  `exitBarrier` (it is already closed by `syncGates`; the change is that the
  *entry* is left open) and start on the trigger line
  (`inside(zone) && u ≥ triggerU` for any living player); halls keep
  `allInside`. `syncGates` learns that a camp/trek opens both, an outdoor
  assault opens its entry always, and a hall opens its entry while being
  approached — same code, keyed on `shell` as well as `kind`.
- `spawnRoomWave` → `spawnZoneWave`: by shell — `open`/`canyon`/`deck` call
  `dropReinforcements` as now, but when the zone has a `pass`/far mouth and
  the wave's kinds include RUNNERS, those members go by `run` from the
  runner post instead (the game's `flybyDrop` and the arrival `run` mode
  already coexist per squad in the wave game — reuse `planArrival` with a
  `from`); `hall` posts the squad in the hatch closets (`placeNear` at each
  `hatch.post`, `silent`) and opens the hatches, which is the whole arrival.
  Fliers (`air` entries) are kept by `squadFor` when `zone.spec.air`.
- `chase` encounters: `enterZone` calls the road's swoop pack (air kinds via
  `fly` over the rim, `squadFor` with `air` forced) and arms the marks; each
  mark fires its drop when the lead living player passes it; the barricade's
  squad is posted at build. Clears when every living player is past the far
  mouth (`u > l`), which also parks any ridden vehicle's position as the
  checkpoint's furniture. A player who loses their ride walks — the spare
  pair at `l / 3` is for them, and the road is still winnable on foot (the
  test covers it).
- Vehicles: `Game` spawns `level.vehicles` in campaign instead of skipping
  `spawnVehicles`; `Vehicle` reads `campaign.level.waterY` where present.
- `trek` encounters: `enterZone` posts nothing (lookouts were posted at
  build like camp garrisons, with `notice` doubled); clears on `nearExit`.
- Guidance: `objectivePos` per the §4 table; `clearRoom` → `clearZone` lays
  the ground arrow (`GroundArrow` class next to the vent glyphs: pooled,
  additive) and hands the HUD marker its new target and label via
  `game.events`. The trail posts are level geometry and need no runtime.
- Off-path: `y < floorY − FALL_DROP` as now, plus `y < floorY − 2.5` when
  `spec.water` — with the water banner from `TEXT.banners.offPath` variants.
- The ally cache placement (`room.spec.w * 0.28` off the lane) works
  unchanged for the wider zones; cap the offset at 9 m so it is not lost in
  an 80 m open.

### 5.4 The ceiling (`player.ts`, `enemy.ts`, `game.ts`)

Exactly §2. Three code sites: the clamp in `Player.integrateAndLand`, the
clamp in `Enemy.update` (after the style switch, skipped while `arriving`),
and the two goal clamps in `updateHover`/`updateSwoop`. `Game.ceilingY`
carries it. The `?ceiling=` override is read in `Campaign`'s constructor
(`modes.ts` gets a `ceilingOverride()` beside `bossRush()`).

### 5.5 HUD (`ui/hud.ts`, `ui/style.css`)

Two new elements per viewport: `.objective` (diamond/chevron SVG + label +
distance) and `.exited` — the back-portal state: on the exited player's own
viewport a centred card (*You have exited · B to cancel*), on everyone
else's a line under the objective (*⟨name⟩ has stepped out — waiting on
⟨n⟩*) and the exited player's portrait dimmed in the party strip. `Hud.update` gets the campaign's `objectivePos` and label, projects
with the player's camera, and positions it with `transform`; the chevron
rotates to the direction of the clamped edge point. Hidden outside Missions.

### 5.6 Text (`src/text.ts`)

`TEXT.missions.rooms[board]` re-authored to the labels in §3 (8 per board,
order kept). New: `TEXT.missions.ceiling[board]` (the one-time ceiling line),
`TEXT.banners.offPath.water` (two variants), `TEXT.missions.trail` if the
marker needs a "follow the lights" hint on the first long trek.

### 5.7 Tests (`tools/test-modes.mjs` + a new `tools/test-missions.mjs`)

Keep every v2 campaign check (they are about rules, and the rules survive)
and add, run over **all nine** boards rather than the Dune Sea alone:

- **Build audit.** Zones do not overlap; every fight zone keeps ≥ 3
  validated vents (or 2 hatches); no rim gap without pillars; every ridge
  piece's top ≥ `ceilingY + 6`; `ceiling ≤ DROP_HEIGHT − 8`.
- **Landmark audit.** The §4.1 raycast passes for every zone.
- **Walkthrough.** The v2 autopilot, now walking `level.path` point to
  point (entry → bends → exit) instead of room centres, to liberation on
  every board, zero falls, zero wedges, zero off-path teleports.
- **Ceiling.** Stand a player in the first `open` zone, hold jump for 8 s:
  `max(y) ≤ ceilingY − height + 0.05`, *and* a single full burn from the
  floor peaks at least 4 m under it (the "not felt in free flight" rule).
  Spawn a `jetpirate` there, run 10 s: `max(y) ≤ ceilingY`. Drop a wave: the
  carrier's release point is above `ceilingY`, at least one body's `y`
  exceeded `ceilingY` during the drop (it came *through*), and none does
  after landing. Fly a `jetpirate` in over the rim: it fires no bolt while
  above `ceilingY`.
- **Outdoor seal.** In the first outdoor assault: the entry stays passable
  during the fight, the exit does not; the exit opens on the last body.
- **Hatches.** In the first hall: the wave stands in the closets and the
  hatches open; nobody spawns inside a wall.
- **Fliers.** On a board with `air` zones, at least one air kind appears in
  the run and never leaves the level's footprint.
- **Stages.** On a three-stage board: crossing the exit portal with one
  player transports both (new `stageIdx`, the old board's group gone from
  the scene, the physics list rebuilt, no hostiles carried over, both players
  at the new starts, checkpoint there); the transition takes < 2.5 s with
  warmed assets. Back portal: one player in the pocket → not transported,
  `exited` set, the HUD card up; cancel clears it; both in → transported
  back, and the previous stage is rebuilt cleared through the zone it was
  left from (gates open, no garrison, taken pickups absent). A dead player
  does not block the back transit.
- **Territory stages.** The rim polygon closes (no gap but the authored
  ones), every point of every zone rect is inside it, the walkthrough
  crosses the region on the real heightfield with zero wedges, and no
  hostile posts outside the rim.
- **Rides.** Every parked ride stands on the level (`contains`), 6 m from
  any edge, and can be mounted; a ridden swoop driven at the rim for 5 s
  stays inside the zone; a road is cleared on foot by the autopilot (no
  ride), and on a ride by a scripted throttle-hold with the barricade rammed.
- **Props.** Every prop id a layout names is a delivered file or has a
  stand-in; `propsUsed` after a build equals the prefetcher's list for that
  board in campaign mode (`test-loadperf`).

## 6. Implementation plan

Eight phases; each is a mergeable change that leaves the game bootable and
`npm test` green. Phase 0 ships on its own — it improves the *current*
levels the moment it lands and de-risks everything after it.

| Phase | Scope | Files | Done when |
|---|---|---|---|
| **0 · Ceiling** | `Game.ceilingY` and `Game.dropHeight`, the three clamps, hover/swoop goal clamps, the no-fire-above-ceiling hold, `?ceiling=`, the shimmer + one-time banner, the ceiling test | `game.ts`, `player.ts`, `enemy.ts`, `modes.ts`, `campaign.ts`, `hud.ts`, `text.ts`, `tools/test-modes.mjs` | jump-hold and jetpirate tests pass on the v2 Dune Sea level with ceiling 30; wave game unaffected (`ceilingY` null, `dropHeight` 38) |
| **1 · Shells on the Dune Sea** | `ZoneSpec`/`Shell`, `ridge`, `openZone`, `canyonZone`, door face, `Fence`/`Barrier`, roofed halls + hatches, `deck` stub; zone props through `authoredProp`; rides from the level (`spawnVehicles` in campaign, `level.vehicles`); §1.3 sealing; the Dune Sea's stages B and C from §3.1 built as **one** map for now (the airlock between them is a plain door until Phase 3), stage A's two beats as built plates; labels | `mission.ts`, `campaign.ts`, `text.ts`, `arrival.ts` (runner `from`), `game.ts` (`dropReinforcements` runner split; vehicles in campaign), `vehicles.ts` (`waterY`), `prefetch.ts` | the §3.1 run walks to liberation under the autopilot; build audit green; the v2 tests still pass on the other eight (still v2 layouts, expressed as `hall` zones — a mechanical translation of `ROOMS` to `zones` with `shell: 'hall'`) |
| **2 · Guidance** | HUD marker, ground arrow, trail posts, barrier lighting, pillar position rule, landmark audit | `hud.ts`, `style.css`, `campaign.ts`, `mission.ts`, `tools/test-missions.mjs` | landmark audit green on the Dune Sea; a player with the HUD alone (no radar) reaches the warlord in a hands-on playtest |
| **3 · Stages & transport doors** | `StageSpec`, `buildStage`, `Portal`, `Game.transition` + `swapStage` (loading card, teardown, rebuild, re-form), `StageMemory`, the back-portal all-aboard rule and its HUD state, per-stage prefetch; the Dune Sea split into its three stages; the Spice Run's interior stage and the Refinery's `plant` stage as the two proofs (a different world, an existing map) | `mission.ts`, `campaign.ts`, `game.ts`, `main.ts` (the boot path factored so a swap can call it), `ui/loading.ts`, `hud.ts`, `prefetch.ts`, `dispose.ts` | the stage tests pass on the Dune Sea; the Spice Run's stage B runs at flat 0.45 g with no starfield; the Refinery's plant stage uses the wave board's geometry with zero new colliders |
| **4 · The other territories** | §3.2–§3.9 layouts on built plates (territory-stage openings come in Phase 6 — until then those four boards open on a built plate with the same beats), per-style ridges (`ice`, `basalt`, `ruin`, `hull`, `tank`, `warehouse`, `panel`), `deck` shell for real, the `interior` stage kind, water plane + off-path rule, the lake traction ring, the Prison Rig's `sea` stage | `mission.ts`, `text.ts`, `campaign.ts` | all nine pass the build, landmark, walkthrough and stage audits |
| **5 · Fliers, runners & roads** | `air` zones draw air kinds; `run` arrivals through passes; `swim` on the two water boards; the `road` shell and `chase` encounter, the three roads (§3.1 beat 2, §3.3 beat 2, §3.7 beat 2), barricades | `campaign.ts`, `arrival.ts`, `spawner.ts`, `mission.ts` | the flier test passes on desert/station/ringworld; runners enter through the pass, not through a cliff; all three roads clear on foot and on a ride |
| **6 · Territory stages** | the `territory` stage kind: `ridge` along a heightfield region, zones as rects on terrain, vents from the board's own posts, the board's props and rides as-is; the openings of the Dune Sea, Lava Flats, Great Forge and Crevasse moved onto their wave boards | `mission.ts`, `campaign.ts`, the four board modules (region anchors exported) | the territory-stage tests pass on all four; the built-plate openings stay as the fallback behind a flag until a playtest picks |
| **7 · Polish** | performance pass (merged ridge geometry, cylinder cull radius in `physics.ts` if the move loop shows up), backdrop tint by fog, the ceiling values tuned in play, `docs/LEVEL_DESIGN.md` rewritten to point here as the current design | `mission.ts`, `physics.ts`, docs | 60 fps at 4 players on the largest stage (the Old One's hollow with a wave in the air); the ceiling table in §3.10 updated from play |
| **8 · Later** | terrain relief on built plates (`heightAt` wrapper inside the footprint), the Ringworld's terminator over the level and its tram as a `Mover` down the arcade, Trask's heaving trawler deck as a `Mover` and the skiff harbour crossing | — | not scheduled |

Order of the territories in Phase 4 after the Dune Sea: Crevasse (proves
`ice`, the bends and the cavern `interior`), Spice Run (already has its
interior from Phase 3; adds `deck` for real), Refinery (its yard and field
around the Phase 3 plant), then Lava Flats, Storm Docks (water), Great
Forge, Ringworld (`panel`), Prison Rig (water, `panel`, the `sea` stage).

## 7. Tunables (one place: the top of `mission.ts`)

| Name | Default | What it moves |
|---|---|---|
| `ceiling` (per spec) | 30 | the playable-sky cut; §3.10 — tune *up* until unfelt |
| `DROP_OVER_CEILING` | 10 | how far into the ambient band a carrier releases |
| `RIM_OVER_CEILING` | 6 | how far the first ridge row clears the ceiling |
| `BACKDROP_H` | 2.2 × ceiling | the mountains-beyond row |
| `TRIGGER_IN` | 6 | how far past an outdoor zone's entry the fight starts |
| `TRAIL_EVERY` | 15 | trail post spacing; `TRAIL_MIN_LEN` 30 |
| `ARROW_PULSE` | 8 s | the ground arrow's bright phase |
| `WATER_DROP` | 2.5 | how far below the floor the water takes you back |
| `MAX_TREK` | 90 | an authoring cap on a link's length; the audit warns past it |
| `DECK_GAP_MAX` | 18 | the audit's cap on a platform gap at the board's gravity |
| `RIDE_MIN_SIDE` | 56 | the shortest side a non-road zone needs before it may park a ride |
| `RIDE_EDGE_CLEAR` | 6 | how far from an open edge a ride is parked |
| `BARRICADE_HP` | 40 | per crate in a crate-line barricade |
| `ROAD_MARK_LEAD` | 0 | seconds before the lead player reaches a mark that its drop is called |
| `PORTAL_POCKET` | 4 | depth of the confirm pocket behind a transport door's leaves |
| `PORTAL_BEAT` | 1.5 s | the transport beat before the loading card |
| `PORTAL_CANCEL_STEP` | 3 | how far a cancelled exit walks the player back out |

## 8. Open questions (decide in play, not now)

- **Retreat during outdoor assaults.** §1.3 leaves the entry open. If waves
  chasing a retreating party into a cleared zone turns out to be exploited
  (kiting a wave up a canyon forever), the fallback is a fence at the entry
  that closes on the trigger line — the geometry supports both; it is one
  flag on the zone.
- **Ceiling values.** 30 clears one full burn by a few metres on 1 g; the
  Spice Run's 45 may still be low at 0.45 g, and a player chaining glide and
  burn on any board can climb higher than one burn. The tuning direction is
  always *up*: the ceiling is the level-skip guard and the sky cut, not a
  challenge. Tune with `?ceiling=`.
- **Where the lieutenant fights.** Half indoors, half out (§3) was chosen for
  variety. If the indoor arenas feel like v2, move them out; the shell is one
  word in the spec.
- **Forward transit on one player.** The brief's rule, and the pocket makes
  it deliberate. If a playtest still finds it fired by accident (a fight
  spilling into the pocket), the fallback is *hold A in the pocket for 1 s*;
  the all-aboard rule stays on the way back regardless.
- **Territory stages vs built openings.** Phase 4 ships the four heightfield
  boards' openings on plates and Phase 6 moves them onto the real terrain
  behind a flag. If the rim on a heightfield misbehaves (v1's ghost), the
  plates stay and nothing else changes.
- **Roads on foot.** A road is 120–180 m; a player who never mounts walks it
  under swoop fire. That is meant to be survivable but worse; if it turns out
  to be a wall, the spare rides move closer and the drops thin.
- **How much of the v2 room feel to keep in halls.** The roofs and hatches
  make halls read as interiors; if the hallway beat wants to stay as short as
  the brief implies ("a hallway battle sequence"), drop each board to one
  hall and one corridor and give the beat to a second canyon.

## 9. What shipped (2026-09-03)

The design above is the plan; this is the state of the code, so nobody has to
diff the two to find out. Implemented on branch
`claude/missions-outdoor-design-iqs1c3`.

**Built and playable.**

- **The ceiling** (§2) — `Game.ceilingY` / `Game.dropHeight`, clamps on the
  player and on every enemy style, hover and swoop goals held under the lid,
  and the rule that makes the cut mean something: **a flier above the ceiling
  may not fire**, it has to descend into the playable band first. Carriers
  release from `ceiling + 10`, so a drop still falls *through* the cut.
  `?ceiling=<m>` overrides it for tuning.
- **Shells** (§1.1) — `open`, `canyon`, `hall`, `deck`, `road`, in
  `world/mission.ts`. Outdoor zones are held in by `ridge()` borders; halls
  are roofed and take their waves from **wall hatches**; decks have open
  edges; roads carry drop marks and a barricade.
- **Encounters** (§1.2) — `start`, `trek`, `camp`, `assault`, `chase`,
  `lieutenant`, `warlord`, with the §1.3 sealing table: indoors the party is
  sealed in, outdoors only the way on shuts and the fight starts on a trigger
  line six metres past the entry.
- **Stages and transport doors** (§1.9) — `built` and `interior` stages, the
  `Portal` with its pocket, the forward rule (one player boards, all go), the
  back rule (every living player in the pocket, an *exited* state on every
  HUD, B to cancel), `StageMemory` so a stage you return to comes back as you
  left it, and per-stage world overrides (fog, background, sky, gravity,
  traction, a local water plane).
- **Guidance** (§4) — the beacon pillar and radar pip, the per-viewport
  **screen marker** with its off-screen edge chevron, the **ground arrow** at
  every earned checkpoint, and **trail posts** down any lane over 30 m.
- **Props and rides** (§1.7, §1.8) — every zone places authored sculpts
  through the same loader the wave boards use, and parks its own rides;
  `VehicleSpec.y` is new so a ride sits on the plate it was parked on rather
  than on the territory ninety metres below. The **road/chase** beat runs on
  the Dune Sea, the Lava Flats and the Great Forge.
- **The way back** — `?backup=missions` runs the previous room chain whole
  (`world/mission-legacy.ts`, `game/campaign-legacy.ts`). Both satisfy
  `MissionController`; nothing else in the game branches on which is running.
- **Tests** — `tools/test-missions.mjs`: the build, the borders, the ceiling
  (including a measured jetpack burn and a flier that must come down before
  it shoots), a golden-path walkthrough to liberation, the transport doors
  both ways with the cancel, a per-board audit of all nine, and the backup
  flag.

**Changed from the plan, on evidence.**

- **Ceilings went up.** One full burn measures **28.3 m** at Tatooine gravity,
  which the planned 30 m lid did not clear — a player would have felt a rule
  that is not meant to be felt. The table is now 38 / 60 / 38 / 38 / 34 / 36 /
  40 / 34 / 34 (§3.10 order), with the Spice Run highest for its 0.45 g.
- **A rim's collision is one slab per run, not one collider per rock.** Every
  collider in the world is walked by every capsule step, every ground probe
  and every spawn validation; four hundred cylinders per stage would be paid
  for on every frame by every body. The rocks are merged mesh — what you see —
  and a thin tall box just inside them is what you walk into. Free-standing
  gap pillars keep their own cylinder.
- **A ravine bends between zones, not inside one.** A bend inside a zone puts
  half of it outside its own rect, and the seal, the vents, the trigger line
  and the guidance all key off that rect. `LinkSpec.turn` already bent the
  lanes *between* zones, so that is where the ravines bend.

**Deferred, and honestly so.**

- **The `territory`, `plant` and `sea` stage kinds** (§3's stage table).
  Stages today are `built` plates and `interior` halls. So the Dune Sea's
  opening is a built plate rather than the wave board's own dunes, the
  Refinery's middle stage is a built interior rather than the plant itself,
  and the Prison Rig has three stages rather than four — its sea is not yet a
  stage. The stage machinery is what those need; each is a new `buildStage`
  branch, not a new system.
- **The landmark raycast audit** (§4.1). The pillars are built and the marker
  works; nothing yet fails a level for hiding its own way on.
- **Terrain relief inside a zone** — floors are flat plates, as §1.5 planned
  for the first cut.

## 10. Assets this design asks for

Requested 2026-09-03 in the two asset docs; everything below ships procedural
first and upgrades when the file lands, per the project rule. None of it
blocks a phase.

**Textures (`docs/ASSETS_IMAGES.md`, "Missions v3 — outdoor surfaces").** The
rims are the new surface in the game and the existing tileables are
top-down ground textures; a 26 m cliff face wants a *face*. One cliff
texture per ridge style (`cliff_sandstone`, `cliff_basalt`, `cliff_ice`,
`cliff_ruin`, `tank_wall`, `warehouse_wall`, `hull_plate_large` + glow), a
ground per outdoor theme that lacks one (`ash_ground`, `glass_plain`,
`street_paving`, `dock_planks`, `scree_ground`), the local sea
(`sea_surface` + normal), four **ridge silhouettes** (alpha horizon strips
for above the backdrop row, the skyline-silhouette technique), and one small
alpha (`energy_cells`) for the fence pane and the ceiling shimmer.

**Models (`docs/ASSETS_MODELS.md`, "Missions v3 — outdoor set").** Small and
optional: a boulder set (3), a cliff pillar pair (rock and ice — the gap
framers, the one rim piece players look straight at), the energy pylon and
the trail post. Wall hatches reuse `blast_door` at 0.6 scale; barricades
reuse `cargo_crate`; the door faces and the transport doors reuse
`blast_door` (the latter at 1.3 scale with the white-blue frame light) in a
`ridge` slab.
