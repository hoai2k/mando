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
| Framework (§2): section stage kind, registry, campaign routing, one-way doors, flags, HUD panel, engine hooks, `interactHeld`, `kit/interact`, `kit/moves` | merged | working branch; see §2.6 of the plan |
| `tools/test-sections.mjs` | merged | per-section build + autopilot completion; legacy suites run sections-off |
| K1 rail camera | merged | `kit/railcam.ts` (shared view, twin-stick aim, merged HUD) |
| K2 treadmill | merged | `kit/treadmill.ts` |
| K3 mounts (vehicle guns, side swing, lane, pillion, turret) | merged | `vehicles.ts` + mounts; `tools/test-section-mounts.mjs` |
| K4 hazard front | merged | `kit/front.ts` (`RisingPlane`, `PathFront`), by the Chimney |
| K5 objective bar / defend target | merged | `kit/objective.ts` (`DefendTarget`, `Progress`) |
| K6 detection | merged | `kit/detection.ts` |
| K7 locomotion: slide / flight / tilt | merged | `kit/locomotion.ts` (`slideMove`, `flightMove`, `deckTilt`) |
| K8 pursuit | merged | `kit/pursuit.ts` |
| K9 darkness | merged | `kit/darkness.ts` |

## Sections

| # | Section | Territory | Placement | State | Notes |
|---|---|---|---|---|---|
| 1 | barge-run | Dune Sea | B ⇒ · ⇒ worm-sign | merged | desert team; deck gun and heavy gun are K3 turrets |
| 2 | worm-sign | Dune Sea | barge-run ⇒ · ⇒ C | merged | desert team; K6 detection crossing (thumpers, worm) |
| 3 | ring-walk | Spice Run | B ⇒ · ⇒ C | merged | station team; K1 |
| 4 | frigate-guns | Spice Run | A ⇒ · ⇒ B | built (its branch) | `claude/sections-frigate` (session_01Hh1Lchy7jWq4jMuSCYrcAF); K2 + K3 + K5; tuning, then merge |
| 5 | magma-run | Lava Flats | B ⇒ · ⇒ chimney | merged | lava team; K3 |
| 6 | chimney | Lava Flats | magma-run ⇒ · ⇒ C | merged | reference section; autopilot finishes at 2 and 4 players in ~55 s (hostiles culled) |
| 7 | glacier-chute | Crevasse | A ⇒ · ⇒ lamplight | merged | crevasse team; K7 slide + K9 darkness |
| 8 | lamplight | Crevasse | chute ⇒ · ⇒ B | merged | crevasse team; K7 slide + K9 darkness |
| 9 | squall | Storm Docks | A (split after trawler deck) ⇒ · ⇒ run-the-pier | merged | trask team; K7 tilt |
| 10 | run-the-pier | Storm Docks | squall ⇒ · ⇒ A2 | merged | trask team; K1 reversed rail camera, rubber-band collapse front |
| 11 | lights-out | Refinery | B ⇒ · ⇒ C | merged | refinery team; K6 detection, silent takedowns |
| 12 | the-line | Refinery | A ⇒ · ⇒ B | merged | refinery team; K6 detection, silent takedowns |
| 13 | covert-sky | Great Forge | hold-the-forge ⇒ · ⇒ C | merged | 1/2/4 players pass, ~73 s; tower polish merged |
| 14 | hold-the-forge | Great Forge | B ⇒ · ⇒ covert-sky | merged | 1/2/4 players pass, ~220–275 s; +25 max HP survives stages and deaths |
| 15 | tram-top | Ringworld | A (split after market arcade) ⇒ · ⇒ A2 | merged | ringworld team; K1 + K2 train roof, gantry sweeps |
| 16 | mark-runs | Ringworld | A2 (split after plaza) ⇒ · ⇒ A3 | merged | ringworld team; K8 pursuit |
| 17 | one-way-out | Prison Rig | B ⇒ · ⇒ C | merged | narkina team; K2 treadmill; prisoner stand-in |
| 18 | the-lift | Prison Rig | C ⇒ · ⇒ D | merged | narkina team; K2 treadmill; prisoner stand-in |

## What is left

Everything unfinished, deferred or suggested-but-not-done — bugs, features,
tuning passes, audit leftovers, art stand-ins — is gathered in one list:
[`sections-notes/_followups.md`](sections-notes/_followups.md). Keep it current
when an item is closed or found.

## Other

| Item | State | Notes |
|---|---|---|
| Image requests (keyframes + supporting) | open | `ASSETS_IMAGES.md`, committed to `main` early for generation |
| Model requests (props + prisoner) | open | `ASSETS_MODELS.md`; stand-ins ship first |
| Existing-level audit | done | [`AUDIT_LEVELS_2026-09.md`](AUDIT_LEVELS_2026-09.md): 16 prioritised recommendations |
| Audit fixes | merged | `claude/audit-fixes`; notes (what was done, what was left) in `sections-notes/audit-fixes.md`; Storm Docks split moved to after zone 4 |

## Log

- 2026-09-28 — plan written; placement decided (§1 of the plan); assets requested.
- 2026-09-28 — framework and the Chimney built; the Chimney's holes are shuttered (a valve per floor opens the one above) because every character can fly.
- 2026-09-28 — wave 1 started as six cloud sessions (ids above), each on its own branch, briefed by `docs/SECTIONS_AGENT_BRIEF.md`; state per team in `docs/sections-notes/<team>.md`. Stage splits for the Storm Docks and Ringworld built into `SECTION_PLACEMENT`.
- 2026-09-28 — the user asked for the audit fixes alongside the sections; all 16 handed to a cloud session.
- 2026-09-28 19:3x — Great Forge merged into the working branch (both sections, K5, K7 flight); whole Forge run hands over through both.
- 2026-09-28 20:0x — merged crevasse, refinery, narkina, ringworld (Mark Runs), trask (Squall) into the working branch; `locomotion.ts` rebuilt with all three K7 modes. Dune Sea session started (Worm Sign now; Barge Run turrets after K3). Full verification running.
- 2026-09-28 20:5x — merged the Refinery radio fix, Covert Sky tower polish, Lava Flats (Magma Run + K3) and Spice Run (Ring Walk + K1). All kits K1–K9 are now in the working branch. Ringworld told to build Tram Top, Storm Docks Run the Pier, Dune Sea to wire K3 turrets; Guns of the Frigate session started. Legacy suites: modes + missions pass; vehicles has 2 rider-damage failures (checking whether they predate the sections on main); co-op crashed under memory pressure, to rerun.
- 2026-09-28 21:4x — suites for the third round all pass (vehicles, sections, runs for Nevarro and Spice Run, K3/K1/Refinery mechanics). Merged the audit fixes, then the Dune Sea (Worm Sign + Barge Run), Tram Top and Run the Pier. 17 of 18 sections are in the working branch; Guns of the Frigate still being tuned. Full verification (every new section at 1/2/4 players, all nine runs, missions, modes) running before `main`.
- 2026-09-28 22:4x — main merged into the working branch (rider-anchor seating, walk gait). The walk gait slowed Lights Out's autopilot into the searchlights; paces re-set. All nine runs pass again.
- 2026-09-28 23:3x — the field manual gains "The job": each section's guide (`src/sections/guide.ts`) or the stage's objective, opened by default in a Missions run, with a dev-only "Skip section". `sections-notes/_followups.md` gathers everything left. Turret sight raised clear of the shield.
- 2026-09-28 23:4x — round 5 sent to nine team sessions: rebuild every stand-in prop to the sheet-measured sizes in the plan's §4 "Props to build" notes (named nodes driven when a model lands), and fix the bugs the guide pass found (Tram Top coupling, One Way Out double banner and the unpaid 10+ prisoners bonus, Glacier Chute's wait on the dead, Mark Runs' point-blank "by hand", the guide beacon, comment/code mismatches, strings outside TEXT, `prisoner` missing from ModelId). Frigate merges after its props.
- 2026-09-29 00:2x — **on `main`** (1dcb13d): the framework, all nine kits, 17 of 18 sections, the audit fixes, the job page and its dev skip. Before it: the full suite (51 files) had three failures, all stale tests that failed on `main` too — grip data for the now bare-handed melee pirate, the title art renamed to `title_dune_sea_hd.jpg`, and a block probe that let Wave Battle's first wave walk in mid-burst. Fixed. main's footrest/hull-riding change merged with K3's pillion and turret seats (a turret's seat turns with the gun, its base stays put).

