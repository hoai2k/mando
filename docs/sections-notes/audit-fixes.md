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

