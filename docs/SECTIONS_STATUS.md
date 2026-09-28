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
| K1 rail camera | merged | `kit/railcam.ts` (shared view, twin-stick aim, merged HUD) |
| K2 treadmill | merged | `kit/treadmill.ts` |
| K3 mounts (vehicle guns, side swing, lane, pillion, turret) | merged | `vehicles.ts` + mounts; `tools/test-section-mounts.mjs` |
| K4 hazard front | built | `kit/front.ts` (`RisingPlane`, `PathFront`), by the Chimney |
| K5 objective bar / defend target | merged | `kit/objective.ts` (`DefendTarget`, `Progress`) |
| K6 detection | merged | `kit/detection.ts` |
| K7 locomotion: slide / flight / tilt | merged | `kit/locomotion.ts` (`slideMove`, `flightMove`, `deckTilt`) |
| K8 pursuit | merged | `kit/pursuit.ts` |
| K9 darkness | merged | `kit/darkness.ts` |

## Sections

| # | Section | Territory | Placement | State | Notes |
|---|---|---|---|---|---|
| 1 | barge-run | Dune Sea | B ⇒ · ⇒ worm-sign | merged (working branch) | desert team; deck gun and heavy gun are K3 turrets; verifying |
| 2 | worm-sign | Dune Sea | barge-run ⇒ · ⇒ C | merged (working branch) | desert team; K6 detection crossing (thumpers, worm); verifying |
| 3 | ring-walk | Spice Run | B ⇒ · ⇒ C | merged (working branch) | station team; K1; verifying |
| 4 | frigate-guns | Spice Run | A ⇒ · ⇒ B | in progress | `claude/sections-frigate` (session_01Hh1Lchy7jWq4jMuSCYrcAF); K2 + K3 + K5 |
| 5 | magma-run | Lava Flats | B ⇒ · ⇒ chimney | merged (working branch) | lava team; K3; verifying |
| 6 | chimney | Lava Flats | magma-run ⇒ · ⇒ C | built | reference section; autopilot finishes at 2 and 4 players in ~55 s (hostiles culled) |
| 7 | glacier-chute | Crevasse | A ⇒ · ⇒ lamplight | merged (working branch) | crevasse team; K7 slide + K9 darkness |
| 8 | lamplight | Crevasse | chute ⇒ · ⇒ B | merged (working branch) | crevasse team; K7 slide + K9 darkness |
| 9 | squall | Storm Docks | A (split after trawler deck) ⇒ · ⇒ run-the-pier | merged (working branch) | trask team; K7 tilt |
| 10 | run-the-pier | Storm Docks | squall ⇒ · ⇒ A2 | merged (working branch) | trask team; K1 reversed rail camera, rubber-band collapse front; verifying |
| 11 | lights-out | Refinery | B ⇒ · ⇒ C | merged (working branch) | refinery team; K6 detection, silent takedowns |
| 12 | the-line | Refinery | A ⇒ · ⇒ B | merged (working branch) | refinery team; K6 detection, silent takedowns |
| 13 | covert-sky | Great Forge | hold-the-forge ⇒ · ⇒ C | merged (working branch) | 1/2/4 players pass, ~73 s; towers' look wants a pass (green stripes read as neon) |
| 14 | hold-the-forge | Great Forge | B ⇒ · ⇒ covert-sky | merged (working branch) | 1/2/4 players pass, ~220–275 s; +25 max HP survives stages and deaths |
| 15 | tram-top | Ringworld | A (split after market arcade) ⇒ · ⇒ A2 | merged (working branch) | ringworld team; K1 + K2 train roof, gantry sweeps; verifying |
| 16 | mark-runs | Ringworld | A2 (split after plaza) ⇒ · ⇒ A3 | merged (working branch) | ringworld team; K8 pursuit |
| 17 | one-way-out | Prison Rig | B ⇒ · ⇒ C | merged (working branch) | narkina team; K2 treadmill; prisoner stand-in |
| 18 | the-lift | Prison Rig | C ⇒ · ⇒ D | merged (working branch) | narkina team; K2 treadmill; prisoner stand-in |

## Other

| Item | State | Notes |
|---|---|---|
| Image requests (keyframes + supporting) | open | `ASSETS_IMAGES.md`, committed to `main` early for generation |
| Model requests (props + prisoner) | open | `ASSETS_MODELS.md`; stand-ins ship first |
| Existing-level audit | done | [`AUDIT_LEVELS_2026-09.md`](AUDIT_LEVELS_2026-09.md): 16 prioritised recommendations |
| Audit fixes | merged (working branch) | `claude/audit-fixes`; notes (what was done, what was left) in `sections-notes/audit-fixes.md`; Storm Docks split moved to after zone 4 |

## Log

- 2026-09-28 — plan written; placement decided (§1 of the plan); assets requested.
- 2026-09-28 — framework and the Chimney built; the Chimney's holes are shuttered (a valve per floor opens the one above) because every character can fly.
- 2026-09-28 — wave 1 started as six cloud sessions (ids above), each on its own branch, briefed by `docs/SECTIONS_AGENT_BRIEF.md`; state per team in `docs/sections-notes/<team>.md`. Stage splits for the Storm Docks and Ringworld built into `SECTION_PLACEMENT`.
- 2026-09-28 — the user asked for the audit fixes alongside the sections; all 16 handed to a cloud session.
- 2026-09-28 19:3x — Great Forge merged into the working branch (both sections, K5, K7 flight); whole Forge run hands over through both.
- 2026-09-28 20:0x — merged crevasse, refinery, narkina, ringworld (Mark Runs), trask (Squall) into the working branch; `locomotion.ts` rebuilt with all three K7 modes. Dune Sea session started (Worm Sign now; Barge Run turrets after K3). Full verification running.
- 2026-09-28 20:5x — merged the Refinery radio fix, Covert Sky tower polish, Lava Flats (Magma Run + K3) and Spice Run (Ring Walk + K1). All kits K1–K9 are now in the working branch. Ringworld told to build Tram Top, Storm Docks Run the Pier, Dune Sea to wire K3 turrets; Guns of the Frigate session started. Legacy suites: modes + missions pass; vehicles has 2 rider-damage failures (checking whether they predate the sections on main); co-op crashed under memory pressure, to rerun.
- 2026-09-28 21:4x — suites for the third round all pass (vehicles, sections, runs for Nevarro and Spice Run, K3/K1/Refinery mechanics). Merged the audit fixes, then the Dune Sea (Worm Sign + Barge Run), Tram Top and Run the Pier. 17 of 18 sections are in the working branch; Guns of the Frigate still being tuned. Full verification (every new section at 1/2/4 players, all nine runs, missions, modes) running before `main`.
