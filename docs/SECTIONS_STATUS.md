# Gameplay Sections — status

Live state of the work planned in
[`SECTIONS_IMPLEMENTATION.md`](SECTIONS_IMPLEMENTATION.md). Update this file with
every commit that changes a row. When the work is paused, this is where it picks
up.

**States:** `planned` → `in progress` (by whom, on which branch) → `built`
(on a branch; builds; its own suite passes) → `merged` (on `main`) → `tuned`
(played, tuned, signed off).

Working branch: `claude/level-design-gameplay-sections-koa6ye`.

## Framework and kits

| Item | State | Branch / notes |
|---|---|---|
| Framework (§2): section stage kind, registry, campaign routing, one-way doors, flags, HUD panel, engine hooks, `interactHeld`, `kit/interact`, `kit/moves` | built | working branch; see §2.6 of the plan |
| `tools/test-sections.mjs` | built | per-section build + autopilot completion; legacy suites run sections-off |
| K1 rail camera | in progress | `claude/sections-station` (session_01NYx37KChWoPF4k4yoA3wU4) |
| K2 treadmill | in progress | `claude/sections-narkina` (session_016ZcRf4vJc1PBtms2RPxLmv) |
| K3 mounts (vehicle guns, side swing, lane, pillion, turret) | in progress | `claude/sections-lava` (session_01BPuY7Qem1Lo3SoWhictNCn) |
| K4 hazard front | built | `kit/front.ts` (`RisingPlane`, `PathFront`), by the Chimney |
| K5 objective bar / defend target | in progress | `claude/sections-forge` (session_015kBibi2vUexHSCuSiTatrk) |
| K6 detection | in progress | `claude/sections-refinery` (session_01Syyrg6ofDmLtWpnCPoZDSD) |
| K7 locomotion: slide / flight / tilt | in progress | slide: crevasse, flight: forge, tilt: Storm Docks (wave 2) |
| K8 pursuit | planned | Ringworld agent |
| K9 darkness | in progress | `claude/sections-crevasse` (session_012dcLJ9xNYqd21FWmQZwry9) |

## Sections

| # | Section | Territory | Placement | State | Notes |
|---|---|---|---|---|---|
| 1 | barge-run | Dune Sea | B ⇒ · ⇒ worm-sign | planned | wave 2 |
| 2 | worm-sign | Dune Sea | barge-run ⇒ · ⇒ C | planned | wave 2 |
| 3 | ring-walk | Spice Run | B ⇒ · ⇒ C | in progress | `claude/sections-station` (session_01NYx37KChWoPF4k4yoA3wU4) |
| 4 | frigate-guns | Spice Run | A ⇒ · ⇒ B | planned | wave 2 |
| 5 | magma-run | Lava Flats | B ⇒ · ⇒ chimney | in progress | `claude/sections-lava` (session_01BPuY7Qem1Lo3SoWhictNCn) |
| 6 | chimney | Lava Flats | magma-run ⇒ · ⇒ C | built | reference section; autopilot finishes at 2 and 4 players in ~55 s (hostiles culled) |
| 7 | glacier-chute | Crevasse | A ⇒ · ⇒ lamplight | in progress | `claude/sections-crevasse` (session_012dcLJ9xNYqd21FWmQZwry9) |
| 8 | lamplight | Crevasse | chute ⇒ · ⇒ B | in progress | `claude/sections-crevasse` (session_012dcLJ9xNYqd21FWmQZwry9) |
| 9 | squall | Storm Docks | A (split after trawler deck) ⇒ · ⇒ run-the-pier | planned | wave 2 |
| 10 | run-the-pier | Storm Docks | squall ⇒ · ⇒ A2 | planned | wave 2 |
| 11 | lights-out | Refinery | B ⇒ · ⇒ C | in progress | `claude/sections-refinery` (session_01Syyrg6ofDmLtWpnCPoZDSD) |
| 12 | the-line | Refinery | A ⇒ · ⇒ B | in progress | `claude/sections-refinery` (session_01Syyrg6ofDmLtWpnCPoZDSD) |
| 13 | covert-sky | Great Forge | hold-the-forge ⇒ · ⇒ C | in progress | `claude/sections-forge` (session_015kBibi2vUexHSCuSiTatrk) |
| 14 | hold-the-forge | Great Forge | B ⇒ · ⇒ covert-sky | in progress | `claude/sections-forge` (session_015kBibi2vUexHSCuSiTatrk) |
| 15 | tram-top | Ringworld | A (split after market arcade) ⇒ · ⇒ A2 | planned | wave 2 |
| 16 | mark-runs | Ringworld | A2 (split after plaza) ⇒ · ⇒ A3 | planned | wave 2 |
| 17 | one-way-out | Prison Rig | B ⇒ · ⇒ C | in progress | `claude/sections-narkina` (session_016ZcRf4vJc1PBtms2RPxLmv) |
| 18 | the-lift | Prison Rig | C ⇒ · ⇒ D | in progress | `claude/sections-narkina` (session_016ZcRf4vJc1PBtms2RPxLmv) |

## Other

| Item | State | Notes |
|---|---|---|
| Image requests (keyframes + supporting) | open | `ASSETS_IMAGES.md`, committed to `main` early for generation |
| Model requests (props + prisoner) | open | `ASSETS_MODELS.md`; stand-ins ship first |
| Existing-level audit | in progress | local subagent; report to `docs/AUDIT_LEVELS_2026-09.md` |

## Log

- 2026-09-28 — plan written; placement decided (§1 of the plan); assets requested.
- 2026-09-28 — framework and the Chimney built; the Chimney's holes are shuttered (a valve per floor opens the one above) because every character can fly.
- 2026-09-28 — wave 1 started as six cloud sessions (ids above), each on its own branch, briefed by `docs/SECTIONS_AGENT_BRIEF.md`; state per team in `docs/sections-notes/<team>.md`. Stage splits for the Storm Docks and Ringworld built into `SECTION_PLACEMENT`.
