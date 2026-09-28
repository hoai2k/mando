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

