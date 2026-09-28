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

