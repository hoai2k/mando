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
4. **A flight ceiling, per board.** Nobody flies above `ceiling` metres over
   the level floor (default 20 m, one number per territory, overridable from
   the URL for tuning). Things may *descend* through it — a carrier's drop,
   a flier crossing the rim — but nothing climbs back out. Fliers come down
   into the play volume and fight at that level.
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

Sizing rule: border height = `ceiling + 6` minimum. A 20 m ceiling wants a
26 m cliff; the backdrop row at 40–50 m sells the scale. Nothing has to be
infinite because nothing can get above 20 m.

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

## 2. The flight ceiling

**Spec.** `MissionSpec.ceiling: number` — metres above `floorY`; default 20.
Per territory (table in §3). Overridable for tuning with `?ceiling=25` (any
number 8–60); the value in play is printed once to the console at level
build and shown in the HUD's debug line while the override is active.

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
| Enemy, arriving (`arrival.ts` drives it) | untouched | a carrier releases from `DROP_HEIGHT` = 38 m, which is above every ceiling in the table; the bodies **fall through** the ceiling because the clamp only acts on a body *below* it moving up. Assert at build: `ceiling ≤ DROP_HEIGHT − 8` |
| Fliers arriving (`fly` mode over the rim) | untouched | they cross the rim above the ceiling and descend to their post; from the moment `arriving` ends the clamp holds them |
| Projectiles, rockets, eggs, the ally crate's drop | none | not bound — a rocket lobbed over the ceiling is fine |
| Cameras | none | the chase rig can sit above the ceiling; the sky is still there |

**Exactly what "no one goes above it" means.** The clamp is one-directional:
a body at or below the ceiling cannot pass it upward; a body above it
(arriving, or placed there) is not teleported down, it is simply not allowed
to climb, and gravity brings it in. That is what lets a drop and a flier's
entrance keep reading as coming *down into* the fight.

**Fliers return to Missions.** v2's `squadFor` skipped every `air` kind
because a swoop's orbit did not fit a 20 m room. With a ceiling and 50 m+
open zones, `air` kinds are drawn again — but only for zones with `air: true`
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

All nine run 8 beats (so `TEXT.missions.rooms` keeps 8 labels per board — the
labels are re-authored below and must be updated in `text.ts`; the load-time
name check stays). Boss shells are chosen per territory so that roughly half
the lieutenants fight indoors and every warlord fights **outdoors** — the
monsters need the room and the reveal is better under the sky.

### 3.1 The Dune Sea (`desert`) — ceiling 20

The reference layout, the one in the brief.

1. `open` · **start** · *the trailhead flats* — 70×60 — a crashed skiff and
   three cover rocks; *rock rim (sandstone mesas) on both sides and behind; the
   ravine mouth ahead, framed by two 30 m mesa pillars, in the sun* — no fight.
   Trek 40 m to the mouth along a line of stone cairns.
2. `canyon` · **camp** · *the ravine* — 14×70, one bend — boulders as cover,
   bacta in a side crack; *cliffs both sides* — Tusken garrison behind the
   bend (they cannot be seen from the mouth; they can hear you).
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
6. `canyon` · **assault ×3** · *the dune gate* — 16×60, widening toward the
   end, one bend — crates from a plundered caravan, a **pass** at the far end;
   *cliffs* — drops + massiffs/Tuskens running in through the pass.
7. `open` · **camp** · *the caravan graves* — 40×36 — wrecked skiffs as
   cover, the **Fennec cache**; *low rim* — posted garrison.
8. `open` · **warlord** · *the Old One's hollow* — 80×70 — the tallest mesas
   of the level all round, a sunken centre; *fence behind, nothing ahead* — the
   Pit Warlord, then the **krayt** erupts.

Air: beats 1, 5, 8 (`air: true`) — the swoop gang finally shows up in a
Mission.

### 3.2 The Spice Run (`station`) — ceiling 30

No mountains: the void is the border and the platforms are the guide. Rule:
the next platform is always **lit along its near edge**, within 12–18 m, and
never more than 6 m higher than the one you stand on. Gravity is the board's
own (0.45 over a deck, a drift between), which is why the ceiling is higher —
a jetpack goes a long way at 0.45 g.

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
   cover; *void; a fence behind* — the capo, then the **mudhorn** through the
   deck plates.

### 3.3 The Lava Flats (`nevarro`) — ceiling 20

1. `open` · **start** · *the ash flats* — 64×56 — one **lava channel** across
   the flat with a crust bridge (the v2 `lava` feature), three basalt rocks;
   *basalt ridge rim; the trench mouth ahead glows orange from inside* — no
   fight. Trek 35 m.
2. `canyon` · **camp** · *the lava trench* — 14×70, one bend — a lava channel
   along one wall, the walk on the other; *basalt cliffs* — pirates behind
   basalt.
3. `canyon` · **assault ×2** · *the glass cut* — 12×46, dead end — the
   garrison's blast door (⇒); *cliffs* — drops.
4. `corridor` + `hall` · **assault ×2** · *the garrison yard* — 22×16 —
   crates, alcove; *roofed 8 m* — hatches.
5. `hall` · **lieutenant** · *the magistrate court* — 24×22 — pillars — the
   promoted **massiff**, indoors.
6. `corridor` ⇒ `open` · **assault ×3** · *the crossing* — 50×44 — two lava
   channels with bridges; *rim with a pass* — drops + massiffs through the
   pass. `air: true`.
7. `canyon` · **camp** · *the cantina row* — 16×50 — crates, the **Fennec
   cache**; *ruin walls* (a `ruin` ridge: the town's edge).
8. `open` · **warlord** · *the rancor pen* — 76×66 — a lava moat ring at the
   rim's foot (burn, 3 m wide, bridged at the entry); *basalt rim, fence
   behind* — the officer, then the **rancor**.

### 3.4 The Crevasse (`crevasse`) — ceiling 22 · traction 0.55 over the level

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

### 3.5 The Storm Docks (`trask`) — ceiling 18

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

### 3.6 The Refinery (`refinery`) — ceiling 20 outdoors, halls roofed at 7 m

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

### 3.7 The Great Forge (`forge`) — ceiling 22

1. `open` · **start** · *the glassed plain* — 70×60 — fused-glass floor,
   shard rocks; *`ruin` rim (collapsed facades, fused dunes); the broken dome's
   ribs on the skyline ahead, the concourse cut between two standing
   pylons* — no fight. Trek 45 m (the longest trailhead trek: this is the
   board whose personality is emptiness).
2. `canyon` · **camp** · *the ruined concourse* — 16×70, one bend — rubble
   cover; *ruin walls* — alamites among the rubble.
3. `canyon` · **assault ×2** · *the shattered gate* — 12×46, dead end at the
   dome's vault door (⇒ a hewn Mandalorian portal); *ruin walls* — drops.
4. `corridor` + `hall` · **assault ×2** · *the dome undercroft* — 20×18 —
   **pillars**, alcove; *roofed 9 m* — hatches.
5. `hall` · **lieutenant** · *the armoury vault* — 22×20 — the promoted
   **alamite**, indoors.
6. `corridor` ⇒ `open` · **assault ×3** · *the glassed court* — 54×48 —
   inside the dome ring under the open sky, ruin pillars; *the dome's ring
   wall with a pass* — drops + alamites through the pass. `air: true`.
7. `canyon` · **camp** · *the forge steps* — 14×50 — the **Fennec cache**;
   *ruin walls*.
8. `open` · **warlord** · *the sleeper's basin* — 80×70 — a sinkhole: the
   Living Waters pool at the centre; *rock rim all round, fence behind* — the
   enforcer, then the **mythosaur** from the pool.

### 3.8 The Ringworld (`ringworld`) — ceiling 18

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

### 3.9 The Prison Rig (`narkina`) — ceiling 18

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

### 3.10 Ceiling table

| desert | station | nevarro | crevasse | trask | refinery | forge | ringworld | narkina |
|---|---|---|---|---|---|---|---|---|
| 20 | 30 | 20 | 22 | 18 | 20 (halls 7) | 22 | 18 | 18 |

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
export type Shell = 'open' | 'canyon' | 'hall' | 'corridor' | 'deck';
export type Encounter = 'start' | 'trek' | 'camp' | 'assault' | 'lieutenant' | 'warlord';
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
  exit?:  'door' | 'fence' | 'mouth';
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
  `max(y) ≤ ceilingY − height + 0.05`. Spawn a `jetpirate` there, run 10 s:
  `max(y) ≤ ceilingY`. Drop a wave: at least one body's `y` exceeded
  `ceilingY` during the drop (it came *through*), and none does after landing.
- **Outdoor seal.** In the first outdoor assault: the entry stays passable
  during the fight, the exit does not; the exit opens on the last body.
- **Hatches.** In the first hall: the wave stands in the closets and the
  hatches open; nobody spawns inside a wall.
- **Fliers.** On a board with `air` zones, at least one air kind appears in
  the run and never leaves the level's footprint.

## 6. Implementation plan

Six phases; each is a mergeable change that leaves the game bootable and
`npm test` green. Phase 0 ships on its own — it improves the *current*
levels the moment it lands and de-risks everything after it.

| Phase | Scope | Files | Done when |
|---|---|---|---|
| **0 · Ceiling** | `Game.ceilingY`, the three clamps, hover/swoop goal clamps, `?ceiling=`, the shimmer + one-time banner, the ceiling test | `game.ts`, `player.ts`, `enemy.ts`, `modes.ts`, `campaign.ts`, `hud.ts`, `text.ts`, `tools/test-modes.mjs` | jump-hold and jetpirate tests pass on the v2 Dune Sea level with ceiling 20; wave game unaffected (`ceilingY` null) |
| **1 · Shells on the Dune Sea** | `ZoneSpec`/`Shell`, `ridge`, `openZone`, `canyonZone`, door face, `Fence`/`Barrier`, roofed halls + hatches, `deck` stub; §1.3 sealing in the campaign; the Dune Sea layout from §3.1; labels | `mission.ts`, `campaign.ts`, `text.ts`, `arrival.ts` (runner `from`), `game.ts` (`dropReinforcements` accepts a runner split) | the §3.1 level walks to liberation under the autopilot; build audit green; the v2 tests still pass on the other eight (still v2 layouts, now expressed as `hall` zones — a mechanical translation of `ROOMS` to `zones` with `shell: 'hall'`) |
| **2 · Guidance** | HUD marker, ground arrow, trail posts, barrier lighting, pillar position rule, landmark audit | `hud.ts`, `style.css`, `campaign.ts`, `mission.ts`, `tools/test-missions.mjs` | landmark audit green on the Dune Sea; a player with the HUD alone (no radar) reaches the warlord in a hands-on playtest |
| **3 · Eight more territories** | §3.2–§3.9 layouts, per-style ridges (`ice`, `basalt`, `ruin`, `hull`, `tank`, `panel`), `deck` shell for real, water plane + off-path rule, the lake traction ring, local `lightAt` skipped | `mission.ts`, `text.ts`, `campaign.ts` | all nine pass the build, landmark and walkthrough audits |
| **4 · Fliers & runners** | `air` zones draw air kinds; `run` arrivals through passes; `swim` on the two water boards | `campaign.ts`, `arrival.ts`, `spawner.ts` | the flier test passes on desert/station/ringworld; runners enter through the pass, not through a cliff |
| **5 · Polish** | performance pass (merged ridge geometry, cylinder cull radius in `physics.ts` if the move loop shows up), backdrop tint by fog, the ceiling values tuned in play, `docs/LEVEL_DESIGN.md` rewritten to point here as the current design | `mission.ts`, `physics.ts`, docs | 60 fps at 4 players on the largest level (the Old One's hollow with a wave in the air); the ceiling table in §3.10 updated from play |
| **6 · Later** | terrain relief (`heightAt` wrapper inside the footprint), the Ringworld's terminator over the level, Trask's heaving deck as a `Mover`, room streaming at the barriers | — | not scheduled |

Order of the nine after the Dune Sea (Phase 3): Crevasse (the canyon board
proves `ice` and the bends), Spice Run (proves `deck` and the hull door),
Refinery (proves `tank` and the outdoor-start-of-an-interior-board case),
then Lava Flats, Storm Docks (water), Great Forge, Ringworld (`panel`),
Prison Rig (water + `panel`).

## 7. Tunables (one place: the top of `mission.ts`)

| Name | Default | What it moves |
|---|---|---|
| `ceiling` (per spec) | 20 | the flight cap; §3.10 |
| `RIM_OVER_CEILING` | 6 | how far the first ridge row clears the ceiling |
| `BACKDROP_H` | 2.2 × ceiling | the mountains-beyond row |
| `TRIGGER_IN` | 6 | how far past an outdoor zone's entry the fight starts |
| `TRAIL_EVERY` | 15 | trail post spacing; `TRAIL_MIN_LEN` 30 |
| `ARROW_PULSE` | 8 s | the ground arrow's bright phase |
| `WATER_DROP` | 2.5 | how far below the floor the water takes you back |
| `MAX_TREK` | 90 | an authoring cap on a link's length; the audit warns past it |
| `DECK_GAP_MAX` | 18 | the audit's cap on a platform gap at the board's gravity |

## 8. Open questions (decide in play, not now)

- **Retreat during outdoor assaults.** §1.3 leaves the entry open. If waves
  chasing a retreating party into a cleared zone turns out to be exploited
  (kiting a wave up a canyon forever), the fallback is a fence at the entry
  that closes on the trigger line — the geometry supports both; it is one
  flag on the zone.
- **Ceiling values.** 20 is a guess that fits a 3.4 s jetpack burn with room
  to spare; the Spice Run's 30 may still be low at 0.45 g. Tune with
  `?ceiling=`.
- **Where the lieutenant fights.** Half indoors, half out (§3) was chosen for
  variety. If the indoor arenas feel like v2, move them out; the shell is one
  word in the spec.
- **How much of the v2 room feel to keep in halls.** The roofs and hatches
  make halls read as interiors; if the hallway beat wants to stay as short as
  the brief implies ("a hallway battle sequence"), drop each board to one
  hall and one corridor and give the beat to a second canyon.
