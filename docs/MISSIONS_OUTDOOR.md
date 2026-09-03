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
   (`docs/ASSETS_IMAGES.md`, `docs/ASSETS_MODELS.md`, §9 here) and the design
   is written to the requested asset, with the procedural stand-in as the
   fallback — the rule every other system in the game already follows.
9. **Rides are part of the fight where there is room.** The biggest outdoor
   spaces park rides (swoops, speeder bikes, the landspeeder, the skiff, a
   bantha) and one beat per vehicle board is a **road**: a long outdoor lane
   meant to be ridden under fire, with enemy swoops harrying the column.

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
| Lava Flats | `adobe_tower` ×2 + `adobe_gate` as the **garrison door face** (the dead-end canyon ends at the town gate, doors shut), `survey_crawler` wrecked on the ash flats | `cargo_crate`, basalt boulders, `fuel_barrel` (rhydonium) in the pen |
| Crevasse | `survey_crawler` on the rim shelf, ice spires (the board's own procedural spires, lifted into the level), `krykna_brood` egg sacs (breakable, `addBreakable`) in the hatchery | ice boulders, `corridor_crate` |
| Storm Docks | `trawler` as the trawler deck (static in Phase 3, a `Mover` in Phase 6), `dock_shed` on the quay, `freighter` as the freighter-hold's exterior, `fish_rack` ×4 on the pier | `cargo_crate`, `fish_rack` (thin cover), `fuel_barrel` |
| Refinery | `reactor_core` rising through the reactor crown (40 m: it clears the ceiling, which is right), `pipe_rack` tiled along the pipe run, `alarm_console` ×2 per hall (**the alarm mechanic comes with them**: a console left standing calls the next hatch early) | `fuel_barrel` (rhydonium), `cargo_crate` |
| Great Forge | `mythosaur_skull` at the rim of the sleeper's basin, `forge_brazier` on a dais in the glassed court, dome ribs (procedural) on the skyline | ruin rubble, `corridor_crate` |
| Ringworld | `tram` parked at the tram stop (and running the arcade as a `Mover` in Phase 6), `street_kiosk` ×6 down the arcade, the ring's far side as the terrace's backdrop | `street_kiosk`, `cargo_crate` |
| Prison Rig | a landed `troop_carrier` on the landing deck, `sunken_transport` beached against the assembly deck's edge (its hull is walkable cover), `alarm_console` in the work floor | `cargo_crate` (white skin), `fuel_barrel` |

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
- **Rides in arenas.** The two biggest warlord arenas (the Old One's hollow,
  the sleeper's basin) park a swoop and a skiff at the rim: ramming the
  warlord is allowed, and the monster's ground slam wrecks a ride outright.

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
distance where it matters. `⇒` marks a door. Ceilings are the starting
values; every one is a tunable.

Territories run 8 beats, 9 where a road is added (the Dune Sea, the Lava
Flats, the Great Forge). `TEXT.missions.rooms` carries one label per beat, in
order — the labels are re-authored below and must be updated in `text.ts`; the
load-time name check stays and now checks the count too. Each layout ends with
its **props** and **rides** lines; ids are §1.7's. Boss shells are chosen per territory so that roughly half
the lieutenants fight indoors and every warlord fights **outdoors** — the
monsters need the room and the reveal is better under the sky.

### 3.1 The Dune Sea (`desert`) — ceiling 30

The reference layout, the one in the brief.

1. `open` · **start** · *the trailhead flats* — 70×60 — the homestead dome and
   three vaporators at the near rim, a crashed skiff, three cover rocks; *rock
   rim (sandstone mesas) on both sides and behind, the sandcrawler on the
   skyline beyond it; the ravine mouth ahead, framed by two 30 m mesa pillars,
   in the sun* — no fight. Two swoops and a bantha parked by the dome: the
   40 m trek to the mouth can be ridden.
2. `canyon` · **camp** · *the ravine* — 14×70, one bend — Tusken tents past
   the bend, boulders as cover, bacta in a side crack; *cliffs both sides* —
   Tusken garrison (they cannot be seen from the mouth; they can hear you).
3. `canyon` · **assault ×2** · *the cistern approach* — 12×50, dead end — a
   lamp-lit blast door set in a hewn rock face (⇒ the outpost); *cliffs* —
   carrier drops only (dead end: no runners). The door unlocks on the last
   body.
4. `corridor` + `hall` · **assault ×2** · *the cistern court* — corridor 6×14
   with a bend, hall 20×18 — the **sarlacc-maw pit** in the middle, alcove
   bacta; *walls, roofed at 9 m* — wall hatches.
5. `corridor` ⇒ `open` · **lieutenant** · *the fighting pit* — 56×50 — a bowl
   ringed by rocks, four cover rocks; *rim; the door behind you, a fence ahead*
   — the **sandworm**, which now has sand to burrow through.
6. `road` · **chase** · *the dune road* — 28×160, two bends — a landspeeder,
   two swoops and the skiff parked at the near mouth, a spare swoop pair at
   the 50 m mark; *rim both sides, cairns every 20 m* — nikto swoops on the
   flanks the whole way, drops at 60 m and 110 m, a crate barricade at the
   far mouth (ram it or dismount and clear it).
7. `open` · **camp** · *the caravan graves* — 44×40 — the half-buried sail
   barge as the cover playground, wrecked skiffs, the **Fennec cache**; *low
   rim* — posted garrison. Rides that survived the road come in with you.
8. `canyon` · **assault ×3** · *the dune gate* — 16×60, widening toward the
   end, one bend — caravan crates, a **pass** at the far end; *cliffs* —
   drops + massiffs/Tuskens running in through the pass.
9. `open` · **warlord** · *the Old One's hollow* — 80×70 — the tallest mesas
   of the level all round, a grounded troop carrier wreck at one side, a
   sunken centre; a swoop and a skiff parked at the rim; *fence behind,
   nothing ahead* — the Pit Warlord, then the **krayt** erupts.

Air: beats 1, 5, 6, 7, 9 (`air: true`) — the swoop gang finally shows up in
a Mission.
Props: `homestead_dome`, `vaporator` ×3, `sandcrawler` (backdrop, beyond the
rim), `tusken_tent` ×3, `sail_barge`, `troop_carrier` (wreck), `cargo_crate`,
`corridor_crate`, boulders.
Rides: beat 1 swoop ×2 + bantha; beat 6 landspeeder, swoop ×2, skiff, spare
swoop ×2; beat 9 swoop + skiff.

### 3.2 The Spice Run (`station`) — ceiling 45

No mountains: the void is the border and the platforms are the guide. Rule:
the next platform is always **lit along its near edge**, within 12–18 m, and
never more than 6 m higher than the one you stand on. Gravity is the board's
own (0.45 over a deck, a drift between), which is why the ceiling is the
highest in the table — a jetpack goes a long way at 0.45 g, and the point is
that nobody feels it.

1. `deck` · **start** · *the docking bay* — 40×30 pad — parked crates, a
   fuel bowser; *the void; the **station hull** fills the sky ahead, 120 m
   off, with one lit cargo door on its face* — no fight.
2. `deck` × 3 · **camp** · *the cargo gantries* — three 18×14 plates, 15 m
   gaps, stepping 4 m up each — pirates posted on each plate; *void* — the
   posted squad.
3. `deck` · **assault ×2** · *the outer yard* — 44×36 plate against the hull —
   cargo containers as cover; *the hull wall on one side (a `hull` ridge 40 m
   tall), void on three; the cargo door (⇒) in the hull* — raider dropship
   passes + **jetpack pirates** over the edge. `air: true`.
4. `corridor` + `hall` · **assault ×2** · *the spice vault* — 5×14 corridor
   with a bend, hall 20×18 — **rhydonium barrels**, alcove; *hull interior,
   roofed 8 m* — wall hatches.
5. `hall` · **lieutenant** · *the loading gantry* — 24×20 — pillars — the
   **duelist** (indoors: a saber fight in a hold suits it).
6. `corridor` ⇒ `deck` × 3 · **camp** · *the crew catwalks* — out through the
   far door onto three plates running along the hull's other face; the
   **Fennec cache** on the middle one; *void, hull behind*.
7. `deck` · **assault ×3** · *the reactor ring* — a 40×32 annulus around the
   refinery spire (visual, 16 m column, physics cylinder); *void* — dropships
   + jetpack pirates. `air: true`.
8. `deck` · **warlord** · *the hold of the prize* — 60×50 plate — container
   cover, a parked raider dropship at the far edge; *void; a fence behind* —
   the capo, then the **mudhorn** through the deck plates.

Props: `freighter` (landed, beat 1), `cargo_crane` ×2 (beat 3), the hull
(`hull` ridge under the large-scale hull texture, §9), `reactor_core` (beat
7's spire), `raider_dropship` (parked, beat 8), `cargo_crate` throughout,
`fuel_barrel` (steel).
Rides: none — the jetpack is the road, and the board's gravity makes it one.

### 3.3 The Lava Flats (`nevarro`) — ceiling 30

1. `open` · **start** · *the ash flats* — 64×56 — one **lava channel** across
   the flat with a crust bridge (the v2 `lava` feature), the wrecked survey
   crawler, three basalt rocks; *basalt ridge rim; the trench mouth ahead
   glows orange from inside* — no fight. Two speeder bikes by the crawler.
   Trek 35 m.
2. `canyon` · **camp** · *the lava trench* — 14×70, one bend — a lava channel
   along one wall, the walk on the other; *basalt cliffs* — pirates behind
   basalt.
3. `canyon` · **assault ×2** · *the town gate* — 12×46, dead end — the
   garrison's gate: two adobe watchtowers flanking the adobe gate arch, its
   leaves shut (⇒ the `Gate` set in the arch); *cliffs* — drops.
4. `corridor` + `hall` · **assault ×2** · *the garrison yard* — 22×16 —
   crates, alcove; *roofed 8 m* — hatches.
5. `hall` · **lieutenant** · *the magistrate court* — 24×22 — pillars — the
   promoted **massiff**, indoors.
6. `corridor` ⇒ `open` · **assault ×3** · *the crossing* — 50×44 — two lava
   channels with bridges; *rim with a pass* — drops + massiffs through the
   pass. `air: true`.
7. `road` · **chase** · *the crust causeway* — 26×140, one bend — a causeway
   of cooled crust with **live lava either side** (burn strips 4 m wide along
   both edges: drift and you cook), speeder bikes ×3 parked at the mouth;
   *basalt rim beyond the lava* — swoops overhead, drops at 50 m and 100 m,
   a fence barricade at the far mouth with a pirate squad behind it.
8. `canyon` · **camp** · *the cantina row* — 16×50 — crates, the **Fennec
   cache**; *ruin walls* (a `ruin` ridge: the town's edge).
9. `open` · **warlord** · *the rancor pen* — 76×66 — a lava moat ring at the
   rim's foot (burn, 3 m wide, bridged at the entry), rhydonium barrels
   seeded; *basalt rim, fence behind* — the officer, then the **rancor**.

Props: `survey_crawler` (wreck), `adobe_tower` ×2 + `adobe_gate` (the door
face), `cargo_crate`, `fuel_barrel` (rhydonium), basalt boulders.
Rides: beat 1 speeder bike ×2; beat 7 speeder bike ×3.

### 3.4 The Crevasse (`crevasse`) — ceiling 32 · traction 0.55 over the level

The theme *is* a canyon, so this board leans hardest on the ravine beat and
keeps the ice grip everywhere.

1. `open` · **start** · *the rim shelf* — 60×50 snowfield — ice boulders; *ice
   cliffs; the crack ahead, a dark seam between two 30 m ice pillars* — no
   fight. Trek 40 m.
2. `canyon` · **camp** · *the frozen gallery* — 12×80, two bends — ice
   **pillars** (v2 feature), bacta in a crack; *ice cliffs* — krykna posted
   past the first bend.
3. `canyon` · **assault ×2** · *the nest mouth* — 10×40, dead end — an
   ice-crusted blast door (⇒ the same `Gate`, ice palette); *cliffs* — drops.
4. `corridor` + `hall` · **assault ×2** · *the queen tunnel* — 20×18 —
   pillars, alcove; *ice walls, roofed 8 m* — hatches.
5. `hall` · **lieutenant** · *the hatchery* — 24×20 — pillars — the promoted
   **krykna**, indoors.
6. `corridor` ⇒ `open` · **assault ×3** · *the cracked lake* — 50×46 — flat
   ice, traction 0.4 in a 20 m disc at the centre (a local `tractionAt`
   ring), no cover in the disc, boulders at the edge; *ice rim with a pass* —
   drops + krykna through the pass.
7. `canyon` · **camp** · *the ice chimney* — 14×50 — the **Fennec cache**;
   *cliffs*.
8. `open` · **warlord** · *the breaker deep* — 72×62 — ice rim all round, a
   frozen pool at the centre (the eruption point); *fence behind* — the
   broodmother, then the **ravinak**.

Props: `survey_crawler` (beat 1), the board's ice spires lifted into the
level as cover, `krykna_brood` egg sacs as breakables in the hatchery,
`corridor_crate`, ice boulders.
Rides: none — nothing with a repulsor belongs on this ice, and the board's
personality is on foot.

### 3.5 The Storm Docks (`trask`) — ceiling 28

Borders are warehouse rows (`hull`-style ridge, plank-and-iron, 24 m) and
the **sea**: an open edge of a pier or quay drops into a local water plane at
`floorY − 3`. Going in is "off the path" — you are hauled back to the
checkpoint after a two-second cold beat (the banner: *the harbour took you*).
The mission never uses the territory's real sea 90 m below.

1. `open` · **start** · *the quay steps* — 60×40 — crates, a beached skiff;
   *warehouses on one side, the sea on the other; the pier chain runs out
   ahead under the pier lamps* — no fight. Trek 30 m.
2. `canyon` (pier) · **camp** · *the fish market* — 8×70, the sea both sides —
   market stalls as cover; *the drop* — quarren posted among the stalls.
3. `canyon` · **assault ×2** · *the net lofts* — 12×46 between two warehouse
   rows, dead end at a **freighter's cargo door** (⇒ a `hull` face); *walls* —
   drops.
4. `corridor` + `hall` · **assault ×2** · *the freighter hold* — 20×18 —
   **barrels**, alcove; *roofed 8 m* — hatches.
5. `hall` · **lieutenant** · *the cold stores* — 24×20 — the officer,
   indoors.
6. `corridor` ⇒ `open` · **assault ×3** · *the trawler deck* — 52×44 — a
   static trawler deck with deckhouse cover; *the sea on three sides, the
   freighter's hull behind* — drops + **quarren surfacing** at the deck's
   edge (arrival `swim`, using the local water plane). `air: true`.
7. `canyon` (pier) · **camp** · *the pier heads* — 10×50 — the **Fennec
   cache**; *the drop*.
8. `open` · **warlord** · *the mamacore pool* — 70×60 dock ring around a
   16 m pool (kill hazard; the beacon never in it); *warehouses, fence behind*
   — the capo, then the **mamacore** from the pool.

Props: `dock_shed` (beat 1), `fish_rack` ×4 (beats 2, 7), `freighter` (the
hold's exterior at beat 3's dead end), `trawler` (beat 6's deck; a `Mover` in
Phase 6), `cargo_crate`, `fuel_barrel`.
Rides: the skiff, parked on the quay at beat 1 — the pier is 8 m wide and
the skiff 1.7 m in radius, so it can be taken down the fish market as a
moving wall — and the **harbour crossing** (a `road` on the water plane
between beats 6 and 7) is designed but deferred to Phase 6 with the mover.

### 3.6 The Refinery (`refinery`) — ceiling 30 outdoors, halls roofed at 7 m

The only wave board that is an interior — so the Mission starts *outside*
it and keeps the most interior beats of the nine (three), the tightest
corridors (5 m, a bend in every link) and the barrels.

1. `open` · **start** · *the tanker yard* — 60×50 — a tanker truck, drums;
   *storage tanks (`tank` ridge: 30 m cylinders, walkway railings between)
   and a fence wall; the plant's intake door lit in the wall ahead* — no
   fight. Trek 35 m.
2. `canyon` · **camp** · *the pipe run* — 12×60 between pipe racks and tank
   walls — **barrels**; *tank walls* — stormtroopers behind the drums.
3. `canyon` · **assault ×2** · *the intake ramp* — 12×40, dead end at the
   intake hall's blast door (⇒); *walls* — drops.
4. `corridor` + `hall` · **assault ×2** · *the barrel stores* — 18×16 —
   barrels, alcove; *roofed 7 m* — hatches.
5. `hall` · **lieutenant** · *the furnace floor* — 22×20 — the
   **flametrooper**, indoors, pillars.
6. `corridor` + `hall` · **assault ×2** · *the pump hall* — 20×16 — crates;
   *roofed 7 m* — hatches. (The Refinery's second interior fight.)
7. `corridor` ⇒ `open` · **camp** · *the reactor crown* — 50×44 — the
   reactor shaft's open top: railings, vent stacks as cover, the **Fennec
   cache**; *tanks and the plant's wall*.
8. `open` · **warlord** · *the loading field* — 70×60 — barrels seeded in
   the fight; *tank ridge, fence behind* — the officer, then the **zillo**
   from under the yard.

Props: `pipe_rack` tiled down the pipe run, `reactor_core` (beat 7's
centrepiece, 40 m — it clears the ceiling), `alarm_console` ×2 in each hall
(the alarm mechanic: a standing console calls the next hatch 5 s early),
`fuel_barrel` (rhydonium) everywhere, `cargo_crate`.
Rides: none inside the plant; a landspeeder in the tanker yard (beat 1) for
the trek and, if it survives the run, the loading field.

### 3.7 The Great Forge (`forge`) — ceiling 34

The board whose personality is emptiness — so it opens with the longest
ride in the game.

1. `open` · **start** · *the glassed plain* — 70×60 — fused-glass floor,
   shard rocks, three speeder bikes and a landspeeder by the trailhead's
   cairn; *`ruin` rim (collapsed facades, fused dunes); the broken dome's ribs
   on the skyline ahead, the highway running toward them between two standing
   pylons* — no fight.
2. `road` · **chase** · *the glass highway* — 30×180, two bends — a
   fused-glass road across the plain with ruin pylons every 20 m; *ruin rim*
   — swoops on the flanks, drops at 60 m and 120 m, a fence barricade at the
   far mouth held by alamites.
3. `canyon` · **camp** · *the ruined concourse* — 16×70, one bend — rubble
   cover; *ruin walls* — alamites among the rubble.
4. `canyon` · **assault ×2** · *the shattered gate* — 12×46, dead end at the
   dome's vault door (⇒ a hewn Mandalorian portal); *ruin walls* — drops.
5. `corridor` + `hall` · **assault ×2** · *the dome undercroft* — 20×18 —
   **pillars**, alcove; *roofed 9 m* — hatches.
6. `hall` · **lieutenant** · *the armoury vault* — 22×20 — the promoted
   **alamite**, indoors.
7. `corridor` ⇒ `open` · **assault ×3** · *the glassed court* — 54×48 —
   inside the dome ring under the open sky, the forge brazier lit on its dais
   at the centre (a physics cylinder; fight around it), ruin pillars; *the
   dome's ring wall with a pass* — drops + alamites through the pass.
   `air: true`.
8. `canyon` · **camp** · *the forge steps* — 14×50 — the **Fennec cache**;
   *ruin walls*.
9. `open` · **warlord** · *the sleeper's basin* — 80×70 — a sinkhole: the
   Living Waters pool at the centre, the half-buried mythosaur skull at the
   rim; a swoop and the skiff parked at the entry; *rock rim all round, fence
   behind* — the enforcer, then the **mythosaur** from the pool.

Props: `forge_brazier` (beat 7), `mythosaur_skull` (beat 9), dome ribs
(procedural), ruin rubble, `corridor_crate`.
Rides: beat 1 speeder bike ×3 + landspeeder; beat 9 swoop + skiff.

### 3.8 The Ringworld (`ringworld`) — ceiling 28

Urban outdoors: the cliffs are tower facades (`panel` ridge with lit windows
and signage), canyons are streets, opens are plazas. The terminator's dark
side is a later flourish (`lightAt` over the level, §4 Phase 6).

1. `open` · **start** · *the tram stop* — 56×48 plaza — a parked tram car,
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
   *towers, fence behind* — the duelist, then the **nexu**.

Props: `tram` (parked at the tram stop; running the arcade on a loop as a
`Mover` in Phase 6 — the armored ride through beat 2), `street_kiosk` ×6
(beat 2) and ×3 (beat 6), the `city_facade` + glow textures on the `panel`
ridge, `cargo_crate`.
Rides: a swoop pair at the tram stop for the plaza fight (beat 6 is 50 m
across — just wide enough); the tram is the road beat here.

### 3.9 The Prison Rig (`narkina`) — ceiling 28

Outdoors on a rig: white superstructure walls (`panel` ridge), railings, and
the sea beyond the deck edges (the local water plane, as on Trask — the
banner: *the sea took you*). Shock plates run outdoors too.

1. `open` · **start** · *the landing deck* — 56×44 — a parked shuttle,
   crates; *the block's wall on one side (a lit door in it, not the way yet),
   the sea on two sides; the gantry ahead between two hull walls* — no fight.
   Trek 30 m.
2. `canyon` · **camp** · *the gantry run* — 12×60 between two hull walls —
   two **shock strips** (v2 feature); *hull walls* — troopers posted past the
   first strip.
3. `canyon` · **assault ×2** · *the intake lift* — 10×40, dead end at the
   block's door (⇒); *hull walls* — drops.
4. `corridor` + `hall` · **assault ×2** · *the work floor* — 20×16 — shock
   strips, alcove; *roofed 7 m* — hatches.
5. `hall` · **lieutenant** · *the supervisor deck* — 22×20 — the
   **deathtrooper**, indoors.
6. `corridor` ⇒ `open` · **assault ×3** · *the assembly deck* — 50×44 — the
   open top deck, shock plates, vent stacks; *hull walls on two sides, the sea
   on two* — drops. `air: true`.
7. `canyon` · **camp** · *the discharge gantry* — 12×50 — the **Fennec
   cache**; *hull walls, the sea below*.
8. `open` · **warlord** · *the moon pool deck* — 66×56 ring around a 14 m
   pool (water/kill at the centre); *hull walls, fence behind* — the officer,
   then the **kwazel maw** from the pool.

Props: `troop_carrier` (landed, beat 1), `sunken_transport` beached against
beat 6's edge (its hull is standable cover), `alarm_console` (beat 4),
`cargo_crate` (white skin), `fuel_barrel`.
Rides: none — the decks are too tight and the sea too close; the rig's
personality is the shock plates.

### 3.10 Ceiling table

| desert | station | nevarro | crevasse | trask | refinery | forge | ringworld | narkina |
|---|---|---|---|---|---|---|---|---|
| 30 | 45 | 30 | 32 | 28 | 30 (halls 7) | 34 | 28 | 28 |

Every value is above a full jetpack burn on that board's gravity (the Spice
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

export interface MissionSpec {
  palette: { wall: number; floor: number; trim: number; accent: number; rock: number; backdrop: number };
  ridge: RidgeStyle;
  ceiling: number;               // metres over floorY; default 20
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

- `game.ceilingY = level.ceilingY` in the constructor; null on teardown.
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

One new element per viewport: `.objective` (diamond/chevron SVG + label +
distance). `Hud.update` gets the campaign's `objectivePos` and label, projects
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
- **Rides.** Every parked ride stands on the level (`contains`), 6 m from
  any edge, and can be mounted; a ridden swoop driven at the rim for 5 s
  stays inside the zone; a road is cleared on foot by the autopilot (no
  ride), and on a ride by a scripted throttle-hold with the barricade rammed.
- **Props.** Every prop id a layout names is a delivered file or has a
  stand-in; `propsUsed` after a build equals the prefetcher's list for that
  board in campaign mode (`test-loadperf`).

## 6. Implementation plan

Six phases; each is a mergeable change that leaves the game bootable and
`npm test` green. Phase 0 ships on its own — it improves the *current*
levels the moment it lands and de-risks everything after it.

| Phase | Scope | Files | Done when |
|---|---|---|---|
| **0 · Ceiling** | `Game.ceilingY` and `Game.dropHeight`, the three clamps, hover/swoop goal clamps, the no-fire-above-ceiling hold, `?ceiling=`, the shimmer + one-time banner, the ceiling test | `game.ts`, `player.ts`, `enemy.ts`, `modes.ts`, `campaign.ts`, `hud.ts`, `text.ts`, `tools/test-modes.mjs` | jump-hold and jetpirate tests pass on the v2 Dune Sea level with ceiling 30; wave game unaffected (`ceilingY` null, `dropHeight` 38) |
| **1 · Shells on the Dune Sea** | `ZoneSpec`/`Shell`, `ridge`, `openZone`, `canyonZone`, door face, `Fence`/`Barrier`, roofed halls + hatches, `deck` stub; zone props through `authoredProp`; rides from the level (`spawnVehicles` in campaign, `level.vehicles`); §1.3 sealing in the campaign; the Dune Sea layout from §3.1 *without* its road (beat 6 lands in Phase 4); labels | `mission.ts`, `campaign.ts`, `text.ts`, `arrival.ts` (runner `from`), `game.ts` (`dropReinforcements` accepts a runner split; vehicles in campaign), `vehicles.ts` (`waterY`), `prefetch.ts` | the §3.1 level walks to liberation under the autopilot; build audit green; the v2 tests still pass on the other eight (still v2 layouts, now expressed as `hall` zones — a mechanical translation of `ROOMS` to `zones` with `shell: 'hall'`) |
| **2 · Guidance** | HUD marker, ground arrow, trail posts, barrier lighting, pillar position rule, landmark audit | `hud.ts`, `style.css`, `campaign.ts`, `mission.ts`, `tools/test-missions.mjs` | landmark audit green on the Dune Sea; a player with the HUD alone (no radar) reaches the warlord in a hands-on playtest |
| **3 · Eight more territories** | §3.2–§3.9 layouts, per-style ridges (`ice`, `basalt`, `ruin`, `hull`, `tank`, `panel`), `deck` shell for real, water plane + off-path rule, the lake traction ring, local `lightAt` skipped | `mission.ts`, `text.ts`, `campaign.ts` | all nine pass the build, landmark and walkthrough audits |
| **4 · Fliers, runners & roads** | `air` zones draw air kinds; `run` arrivals through passes; `swim` on the two water boards; the `road` shell and `chase` encounter, the three roads (§3.1 beat 6, §3.3 beat 7, §3.7 beat 2), barricades | `campaign.ts`, `arrival.ts`, `spawner.ts`, `mission.ts` | the flier test passes on desert/station/ringworld; runners enter through the pass, not through a cliff; all three roads clear on foot and on a ride |
| **5 · Polish** | performance pass (merged ridge geometry, cylinder cull radius in `physics.ts` if the move loop shows up), backdrop tint by fog, the ceiling values tuned in play, `docs/LEVEL_DESIGN.md` rewritten to point here as the current design | `mission.ts`, `physics.ts`, docs | 60 fps at 4 players on the largest level (the Old One's hollow with a wave in the air); the ceiling table in §3.10 updated from play |
| **6 · Later** | terrain relief (`heightAt` wrapper inside the footprint), the Ringworld's terminator over the level and its tram as a `Mover` down the arcade, Trask's heaving trawler deck as a `Mover` and the skiff harbour crossing, room streaming at the barriers | — | not scheduled |

Order of the nine after the Dune Sea (Phase 3): Crevasse (the canyon board
proves `ice` and the bends), Spice Run (proves `deck` and the hull door),
Refinery (proves `tank` and the outdoor-start-of-an-interior-board case),
then Lava Flats, Storm Docks (water), Great Forge, Ringworld (`panel`),
Prison Rig (water + `panel`).

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
- **Roads on foot.** A road is 120–180 m; a player who never mounts walks it
  under swoop fire. That is meant to be survivable but worse; if it turns out
  to be a wall, the spare rides move closer and the drops thin.
- **How much of the v2 room feel to keep in halls.** The roofs and hatches
  make halls read as interiors; if the hallway beat wants to stay as short as
  the brief implies ("a hallway battle sequence"), drop each board to one
  hall and one corridor and give the beat to a second canyon.

## 9. Assets this design asks for

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
reuse `cargo_crate`; the door faces reuse `blast_door` in a `ridge` slab.
