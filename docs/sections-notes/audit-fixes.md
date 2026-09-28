# Audit fixes (docs/AUDIT_LEVELS_2026-09.md, "Recommendations, prioritised")

Branch `claude/audit-fixes`, cut from `claude/level-design-gameplay-sections-koa6ye`.
One commit per recommendation, in the table's order. This file is kept current so
the work can be paused and picked up: per item, what changed, why, which tests
changed, and what is left.

**Section boundaries touched:** see the "Boundary changes" list at the end. Every
change to a zone a section enters from or exits into is listed there and mirrored
in `docs/SECTIONS_IMPLEMENTATION.md` §1.

How to run the checks (one browser at a time — two at once run this 15 GB box
out of memory and the page crashes):

```
npm ci && npm run build
export CHROMIUM_PATH=/opt/pw-browsers/chromium HARNESS_PORT=4221
node tools/test-missions.mjs    # and test-modes, test-cover, test-arrivals,
                                # test-monsters, audit-mission-build
node tools/test-sections.mjs
RUNS=desert,station,nevarro,crevasse,trask,refinery,forge,ringworld,narkina node tools/test-sections.mjs --runs-only
```

---

## Items

### 1. Vestibule, and the way back shut during a zone-0 fight — done

- **What.** Every stage with a door behind it (every stage but a run's first)
  now has an 8 m antechamber, `VESTIBULE`, between its back transport door and
  zone 0 (`src/world/stage/vestibule.ts`, laid by `layZones` after the zones so
  the seeded dice are drawn in the same order). It takes zone 0's look: a roofed
  lobby the door's height before a hall, a lit gangway before a deck, a short
  lane between cliffs before open ground; nothing extra on a `bare` (plant/sea)
  stage unless zone 0 is a hall. The back portal stands at its far end
  (`u = -1 - VESTIBULE` in zone 0's frame, `doors.ts`), and its rock face now
  closes the lane rather than zone 0's rim. The party's starts are the
  vestibule's middle (`validateSpots`), and a forward arrival checkpoints there,
  not in the middle of zone 0.
- Zone 0 of such a stage now gets the entry barrier an internal zone would: a
  blast door for a hall, the arena fence for an open lieutenant/warlord. So a
  zone-0 hall seals against the vestibule like any room.
- `Campaign.backLocked`: the back portal shuts while zone 0 is being fought
  (assault, lieutenant, warlord, chase) and while the stage came from a section;
  the back-transit wait is cleared while it is shut. It reopens on clear.
- The desert's far side (the fighting pit, a boss arena in zone 0) is covered
  by the vestibule: the party walks in, and the worm/boss waits for them.
- **Why.** Audit finding 2: the party re-formed 2.4 m inside zone 0, so halls
  and arenas sealed on the first frame with their garrison around them, and a
  solo player backing into the open back door was carried to the last stage.
- **Tests.** `test-missions`: new "the vestibule" block — arriving on the
  desert's far side stands the party outside zone 0 on free, on-stage ground
  near the back door; the arena waits (travel phase, no boss) for 3 s; walking
  in seals it and shuts the way back; standing in the back pocket carries
  nobody; clearing it opens the way back.
- **Boundaries.** Every stage after a section gets the vestibule (rule b).
- **Left.** Nothing.

### 2. Open-ground assault messaging; `waves` → `garrison` — done

- **What.** An outdoor assault that is not a siege calls no waves, so it no
  longer says it does. `enterZone` announces "Sealed in / hold ⟨zone⟩" only for a
  supplied zone (hall, deck, siege); open ground gets "Take ⟨zone⟩ / clear them
  off it" (`TEXT.banners.holdGround`). The HUD line is "Hold ⟨zone⟩ · wave n of
  m" only when supplied, and "Take ⟨zone⟩ · N holding it" otherwise
  (`TEXT.missions.holdGround`).
- New `ZoneSpec.garrison`: the depth of a non-siege open assault's posted force
  (each rank past the first adds two bodies — exactly what `waves` bought
  there). Every non-siege outdoor assault in `mission-layouts.ts` is re-spelled
  `garrison: n` with the same n, so the fights are the same size. A load-time
  warning fires if `waves` is set on open ground that is not a siege.
- `__missionZones` (debug hook) now reports `garrison`, `pass`, `deadEnd`,
  `w`, `l` and the rides, for the tests of later items.
- **Tests.** `test-arrivals`: the ordinary open assault's HUD line mentions
  neither waves nor a seal; no non-siege open assault in any territory sets
  `waves`.
- **Left.** Nothing.

### 3. The runner pass: fixed on the sieges, dropped elsewhere — done

- **What.** A `pass` is now a way in that works: a 6 m notch in the far rim
  (`PASS_W`), clear of the exit's own gap, with a 12 m gully behind it
  (`PASS_DEPTH`) walled on three sides and floored on a plate stage. The runner
  post stands in the gully and `runnerIn` just inside the notch; a siege's
  runner kinds (Tuskens, massiffs, alamites, krykna, melee pirates) run from one
  to the other and then join the fight, instead of being aimed at a far vent and
  running into the rim. The gully's line is registered as a *lane*
  (`StageBuilder.lanes`), which the border merge keeps clear exactly as it does
  the golden path, without the guidance ever pointing down it. A pass whose
  spots do not validate is warned about at build.
- `pass` is dropped from the three non-siege zones that carried it (the dune
  gate, the glassed court, the plaza): nothing but a siege calls runners. The
  dune gate is also shortened from 60 to 40 m, as the audit suggested for it
  without the pass.
- **Tests.** `test-arrivals`: on the Lava Flats' siege, runners are seen, land,
  and end inside the zone. `test-missions` (per board) and
  `audit-mission-build` (every stage of every board): a zone with `pass` must
  have validated runner spots, and a `pass` is only allowed on a siege.
  `audit-mission-build` also now checks every stage's starts stand outside zone
  0 and are free (item 1), and reloads the page per board (it ran the renderer
  out of memory raising nine boards in one page).
- **Left.** Nothing. (Making the dune gate or the glassed court a siege was the
  audit's other option; left alone so sieges stay the rare beat test-arrivals
  holds them to.)

### 4. The cache rule looks back to the last walked beat — done

- **What.** `Campaign.bossAhead(from)`: a camp or trek drops the covert's cache
  if the first boss arena ahead of it *in its stage* comes before any other
  walked beat. It used to need the boss immediately next. A stage that reaches
  its warlord with no walked beat at all (a fight, then the arena) drops
  Fennec's cache in its vestibule on arrival. Lieutenants keep the old reach
  (no vestibule cache), so the halls-then-lieutenant stages do not all gain a
  marshal. One cache per boss per run (`cachesDropped`).
- **Why.** The Spice Run's last stage is camp → assault → warlord, so it was the
  one run with no cache; the Prison Rig kept its discharge gantry only to hold
  one.
- **Tests.** `test-missions`: the Spice Run's last stage puts a cache down,
  standing on the stage.
- **Left.** Nothing.

### 5. Floor texture by shell, not by stage — done

- **What.** A second floor material, `hallFloorMat` (`corridor_floor`), for
  anything roofed: halls, their closets and alcoves, roofed corridors, door
  pockets, a hall's vestibule. Everything open takes the stage's ground texture
  (`stageFloorTexture(ridge)`) whatever the stage kind, so the Crevasse's deep
  now has snow under its open zones, and the Dune Sea's cistern court a plated
  floor.
- **Tests.** `test-missions`: in the ravine, the floor slab under the cistern
  court and the one under the canyon are different materials.
- **Left.** The Crevasse's cavern roof and traction disc are item 15.

### 6. Merge the dead-end canyon assaults; cut the refinery pump hall and the discharge gantry — done

- **Desert.** *The cistern approach* folded into *the ravine*: one 14×88
  `canyon:camp` with a third tent and `deadEnd` (a door in its end face). The
  S-bend now lives on the link behind that door, as a roofed tunnel down to the
  court (14 + 12 + 12, two turns).
- **Crevasse.** *The nest mouth* folded into *the frozen gallery*: one 12×108
  gallery, the surface stage's last zone, ending at the glacier door (the
  transport door's rock face). **Boundary zone changed** (see below).
- **Storm Docks.** *The net lofts* dropped; the fish market is `deadEnd` and its
  far end is the freighter's cargo door (it becomes a pier in item 10).
  **`SECTION_PLACEMENT` trask split moved from `after: 5` to `after: 4`** so the
  cut still falls after the trawler deck.
- **Refinery.** *The intake ramp* folded into *the pipe run*, which becomes the
  lane it was designed as: `canyon:camp` 12×60, five pipe racks down alternate
  walls, barrels, alcove, `deadEnd`; the landspeeder that had nowhere to go is
  gone. *The pump hall* cut; the plant ends at the reactor floor. **Both
  refinery boundaries changed** (see below).
- **Prison Rig.** *The discharge gantry* cut (its only job was the cache; item 4
  puts the cache in the stage's vestibule). Stage D is the assembly deck then
  the moon pool deck.
- **Ringworld — not merged, deliberately.** *The night-side row* sits on the
  other side of the Tram Top cut from the arcade (`split.after: 1`), so folding
  it into the arcade would move it across a section boundary; the tram is
  meant to deliver the party into it. It keeps its name and place and becomes
  a 12×44 `canyon:trek` with two lookouts — the breather the run lacked — so the
  dead-end canyon assault is gone all the same.
- `TEXT.missions.rooms` updated in step (desert, crevasse, trask, refinery,
  narkina); the load-time count check is silent.
- **Tests.** No existing check named these zones. The rooms/beat count check is
  the load-time warning (silent), and every suite that walks or raises the runs
  exercises the new chains.

### 7. Three lieutenants outdoors; breathers between the hall pairs — done

- **Lava Flats:** the lieutenant holds *the town gate* (open 44×40, crates) —
  stage A's last zone. *The magistrate court* becomes a hall `trek` with two
  lookouts, the breather after the garrison yard. It still ends stage B in a
  hall-wall door (the Magma Run boundary). **Boundary zone reshaped.**
- **Storm Docks:** *the trawler deck* is the lieutenant (open 52×44); *the cold
  stores* are a hall `trek` breather with two lookouts. The trawler deck is still
  the zone the Squall cut follows. **Boundary zone reshaped.**
- **Ringworld:** *the plaza* is the lieutenant (open 50×44, kiosks); *the
  sentinel walk* is a 12×44 `canyon:camp` (a covered walkway is a lane), joined
  to the plaza by an open lane. The Ringworld has one hall. The plaza is still
  the zone the Mark Runs cut follows. **Boundary zone reshaped.**
- **Breathers:** `LinkSpec.quiet` — a link that posts nobody (not even behind
  its crates) and always carries a bacta canister. The corridors between the
  hall assault and the hall lieutenant on the Spice Run, the Crevasse, the Great
  Forge and the Prison Rig are quiet and a little longer (18 + 14 m); the
  Refinery's walk into the atrium is quiet too.
- **Tests.** `test-arrivals`: the three lieutenants are open-shell, and no more
  than half the runs fight theirs indoors. `audit-mission-build`: every
  hall-assault → hall-lieutenant pair has a quiet link with nobody posted in it.

### 8. Camps leave a flank — done

- **What.** A camp's posts are six spots across the middle third (u 0.36–0.66
  of its length) on one flank only, at |v| ≥ 0.3 w (clamped 2 m off the wall);
  the other flank is quiet. `ZoneSpec.postSide` picks the flank (default
  alternates by beat). A camp is through the moment anyone alive is past its
  far line anywhere across it (`pastExit`), with its garrison still standing —
  not only within 4.2 m of the exit point.
- **Tests.** `test-missions`: the corral's posts are all on one flank at
  ≥ 0.25 w, and walking down the quiet flank past the far line clears the zone
  with the garrison alive.
- **Left.** A narrow canyon camp (12 m) still has little room to slip by; that
  is the canyon's nature, and the posts are at least off the path.

### 9. Roads: marks called ahead, a swoop pack, a fourth bike — done

The roads stay (the sections are additive).
- **Marks ahead.** `ROAD_MARK_LEAD` = 40 m: a mark fires once the lead is within
  40 m of it, and its squad is sent where the lead will be when the ship lets
  go (lead speed × `ROAD_DROP_ETA` 2.8 s + 8 m, clamped to the road, never
  beyond the barricade). The first mark is called as the zone before the road
  clears — the lead at the corral's exit. The checkpoint still only moves to a
  mark the lead has actually reached.
- **Swoop pack.** On `enterZone('chase')` the board's first air kinds
  (`waveComposition` entries flagged `air`, from the road's ramp wave onward)
  fly in over the rim on either side, 2 + players/2 of them, down the length of
  the road; they are part of what the road must put down. Banner "Swoop pack".
- **Nevarro** parks a fourth speeder bike; and (item 14) the riders rule leaves
  a ride per player unclaimed.
- **Tests.** `test-missions` (road block): at the mouth the first drop has
  already been called before the lead reaches its mark, and a pack of ≥ 2 air
  kinds is in. `test-arrivals`: every corral (a camp whose next zone is a road)
  parks at least four rides.

### 10. Water edges — done

- **What.** `ZoneSpec.water: ('left' | 'right')[]`: on a stage with its own
  water (`world.waterDrop`), those sides of an outdoor zone get no rim; the
  plate's edge is lit like a deck's, and the water is the catch (the off-path
  rule already returns whoever goes in). Applied to the Storm Docks' quay
  (right), fish market (both), trawler deck (both) and pier heads (both), and
  the Prison Rig's landing deck (both), assembly deck (both) and moon pool deck
  (left). The fish market is now the pier the design described (10×70, racks
  down it, no skiff).
- **Tests.** `test-missions` (every board, stage 0): a side marked as the sea has
  nothing standing on it — a ray from across the zone toward it at eye height
  meets nothing within the zone's half width plus 25 m.
- **Left.** The trawler deck's far face still carries its rim so the wheelhouse
  door is set in a wall (boundary rule a).

### 11. The Refinery's lieutenant in the reactor atrium — done

- **What.** The plant stage now starts at x = -35 (so its vestibule and back
  door stay inside the west wall) and, out of the barrel stores, walks a quiet
  corridor east, north between the partitions at x = -22 and x = -7, east
  above the short partition at z = -30 and north into the atrium. *The reactor
  floor* is a `hall:lieutenant` 40×40 with a 38 m roof laid at the atrium's own
  edges round the core, the board's three catwalk rings inside it as high
  ground; its north door is the rear airlock into Lights Out.
- Supporting changes: a hall roofed higher than `DOOR_MAX_H` (8 m) keeps
  door-sized doors, hatches and nooks and fills the wall over them (lintels),
  and transport doors are never taller than 8 m; links on a `plant` or `sea`
  stage lay no walls or rock (they used to lay 40 m ridge slabs inside the
  Refinery along trek links).
- **Tests.** `test-missions` (atrium block): the lieutenant's zone is centred on
  the core with all four catwalk runs inside it; every golden-path point of the
  plant is somewhere a body stands; walking in seals it and stands the
  lieutenant up inside. `audit-mission-build`'s landmark rule now also samples
  from 0.35 and 0.45 of a wide room's width either side (the core hides the far
  door from the middle of the entry; a player steps aside) — noted in the
  commit.

### 12. The Spice Run's plates, gangways and hull — done

- **Plates.** `ZoneSpec.plates { n, gap, rise[] }` on a deck: `n` floor slabs
  with void gaps (capped at `DECK_GAP_MAX` 18 m), each raised `rise[k]` (first
  and last at 0 so the links meet them), both edges of every gap lit.
  `StageBuilder.raised` makes `groundAt` answer the raised plates (and a hall's
  gallery), so posts, vents, cover and the inside test stand on them; spots that
  fall in a gap are moved onto the nearest plate; nothing is set down in the
  void; and spot validation (`fits`) and `Campaign.placeNear` now also need
  ground under a spot. The cargo gantries are 3 plates (18×72, 15 m gaps, middle
  +4 m); the crew catwalks 3 plates (14×60, 12 m gaps, middle +4 m).
- **Gangways.** A link between two decks lays no hull ridges; its edges are lit
  and the void is its border.
- **Hull face on arrival.** The station-hull facade (`hullFace`) now also closes
  a deck stage's *back* door on a hull board: stage C is arrived at in front of
  the hull you left by.
- **The loading gantry** gets a 14 m roof and a gallery 6 m up along one wall
  with steps (`ZoneSpec.gallery`). **The hold of the prize** gets crates and
  four cargo containers; its cache comes from item 4.
- **Tests.** `audit-mission-build` raises every stage (spots validated against
  the new floor rule); the vestibule start check caught a cache crate dropped on
  the party's re-form spots (fixed). No separate plate check was added — see
  "left".
- **Left.** No suite walks the Spice Run's jumps with a bot; the plates were
  checked by the build audit and by screenshots.

### 13. The sea: no pickets, a wreck cache, dive and surface portals, an air meter — done

- **No pickets** on a `sea` stage's links.
- **Air.** `StageSpec.air { seconds, pockets[] }`: the Prison Rig's sea gives 55 s.
  `Player.air` (0..1, null when not under the sea) runs down, refills in an air
  pocket, and at 0 drowns the player at 9 hp/s; a fallen player comes back with
  a full tank. HUD: an AIR gauge, shown only under the sea, pulsing when low;
  a one-time "Air low" banner at 30 %.
- **Wreck cache.** The sunken transport off the kelp forest's north edge
  (-52, 48) is an air pocket (r 4.5) with a bacta canister in it.
- **Portals.** `PortalStyle`: `door` (as before), `hatch` (the gantry run's way
  into the sea: a lit pool in the floor with a lid that slides off it as it
  opens, no pocket walls, no rock face) and `ring` (the sea's way up: a lit
  pool ring overhead with light coming down; the exit one is set in a wide
  foundation wall across the moon pool shaft — boundary rule a — and the sea's
  way back is a bare ring on the seabed). `Gate` gained a `hidden` option (no
  frame, leaves or blocker) for them.
- **Tests.** See the end-of-work runs; the sea stage is raised by
  `audit-mission-build` (starts, spots, doors) and crossed by the sections run.

### 14. Co-op scaling — done

- Open assaults: posted force capped at 10 + 2 × players (was a flat 14), base
  one lower (2 + ramp + players + ranks).
- Camps: capped at posts + players (was posts + 2); camps now have six posts.
- Sealed rooms and arenas: with at least half the living party inside for
  `STRAGGLER_WAIT` (8 s), the rest are re-formed just inside the door (the
  respawn's dissolve-and-gather) and the seal goes; banner "the party regroups
  at the door".
- Riders: an alerted camp never claims more rides than leave one per player.
- **Tests.** `test-missions` (stragglers block): with two players, one in an
  arena and one hanging back in the vestibule, the arena is still waiting at
  4 s and has re-formed the straggler inside and started by 11 s.

### 15. De-template the pairs — done (the four the item names)

- **Great Forge:** stage A is one glassed valley (`canyon` 70 → 28 m) ending in a
  16 × 22 m gorge through the dome's broken footing, the vault door at its back;
  its zones lose their per-zone rims. The Lava Flats keep the rimmed boxes.
- **Ringworld:** the market arcade is a 16×80 street (`canyon:camp`), kiosks ×6
  down both sides, the two swoops at the tram stop's end. Rides may now park in
  a lane at least 60 × 12 m (a street), not only in a 40 m zone or a road.
- **Lava Flats:** the crust causeway has live lava channels down both edges
  (`feature: 'lava'` on a road: lengthwise strips laid per 6 m on the ground
  under them, burning at 26 dps, nothing placed in them).
- **Crevasse:** every open zone of an interior stage gets a cavern lid at the
  flight ceiling (mesh and collider) with ice hanging from it (decor); the
  cracked lake has a 10 m disc of bare ice at its heart (`ZoneSpec.slick`,
  grip `SLICK_TRACTION` 0.4 through `MissionStage.slickAt` → `board.tractionAt`).
- **Tests.** Checked by the build audit and screenshots; the Forge canyon and
  the street are raised by every suite that boots those boards.
- **Left (per-territory notes the item does not name):** the hatchery's
  `krykna_brood` sacs, the adobe gate and towers at the Lava Flats' town gate,
  a street for the cantina row, rises for the ice chimney and the forge steps,
  and dome-rib props at the Forge's gate (no such model exists).

## Boundary changes (section entry and exit zones)

Every change to a zone a gameplay section enters from or exits into, mirrored in
`docs/SECTIONS_IMPLEMENTATION.md` §1. Rule (a) — the last zone before a section
ends in a transport door set in a wall, rock face or hull — and rule (b) — the
first zone after one gets the vestibule — hold throughout.

- **Item 6 — Crevasse, end of A.** *The nest mouth* is folded into *the frozen
  gallery*: the surface stage's last zone is now the 12×108 gallery, and its far
  door is still the glacier door, set in the rock face. §1 chain and the Glacier
  Chute note updated.
- **Item 6 — Storm Docks cut.** `SECTION_PLACEMENT` trask `split.after` 5 → 4
  (the net lofts went); the cut still falls after the trawler deck.
- **Item 6 — Refinery, end of A.** *The intake ramp* is folded into *the pipe
  run*, which ends at the intake's blast door in the rock face. §1 chain and The
  Line note updated.
- **Item 6 — Refinery, end of B.** *The pump hall* is cut; the plant ends at *the
  reactor floor*, whose far door is the rear airlock. §1 chain and Lights Out
  note updated.
- **Item 6 — Ringworld, start of A2.** *The night-side row* is kept (not merged
  across the Tram Top cut) and reshaped into a trek breather; both cut indices
  (`after: 1`, `after: 5`) unchanged. Tram Top note updated.
- **Item 7 — Lava Flats, end of B.** *The magistrate court* is now a hall `trek`
  breather (the lieutenant moved to the town gate); still a hall, its far door in
  its wall. Magma Run note updated.
- **Item 7 — Storm Docks cut zone.** *The trawler deck* is now the lieutenant
  (open ground); its wheelhouse door is in its far rim face. Squall note updated.
- **Item 7 — Ringworld second cut zone.** *The plaza* is now the lieutenant;
  its fire-stair door is in its far rim face. Mark Runs note updated.
- **Item 10 — the trawler deck** is open to the sea on both sides; its far face
  keeps its rim, so the wheelhouse door is still set in a wall.
- **Item 11 — Refinery, end of B.** *The reactor floor* moved into the atrium: a
  40×40 hall with a 38 m roof round the core; its north door, the rear airlock,
  is a door in a hall wall. Lights Out note updated.
- **Item 13 — Prison Rig, end of B.** The moon pool shaft's transport door is a
  lit pool ring set in a wide foundation wall across the shaft (it used to be a
  shed standing on the seabed). One Way Out note updated.

