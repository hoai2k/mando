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
| Framework (§2): section stage kind, registry, campaign routing, one-way doors, flags, HUD panel, engine hooks | in progress | orchestrator |
| `tools/test-sections.mjs` | planned | orchestrator |
| K1 rail camera | planned | Ring Walk agent |
| K2 treadmill | planned | Prison Rig agent |
| K3 mounts (vehicle guns, side swing, lane, pillion, turret) | planned | Lava Flats agent |
| K4 hazard front | planned | Lava Flats agent (Chimney) |
| K5 objective bar / defend target | planned | Great Forge agent |
| K6 detection | planned | Refinery agent |
| K7 locomotion: slide / flight / tilt | planned | Crevasse / Great Forge / Storm Docks agents |
| K8 pursuit | planned | Ringworld agent |
| K9 darkness | planned | Crevasse agent |

## Sections

| # | Section | Territory | Placement | State | Notes |
|---|---|---|---|---|---|
| 1 | barge-run | Dune Sea | B ⇒ · ⇒ worm-sign | planned | wave 2 |
| 2 | worm-sign | Dune Sea | barge-run ⇒ · ⇒ C | planned | wave 2 |
| 3 | ring-walk | Spice Run | B ⇒ · ⇒ C | planned | wave 1 (K1) |
| 4 | frigate-guns | Spice Run | A ⇒ · ⇒ B | planned | wave 2 |
| 5 | magma-run | Lava Flats | B ⇒ · ⇒ chimney | planned | wave 1 (K3) |
| 6 | chimney | Lava Flats | magma-run ⇒ · ⇒ C | planned | wave 1 (K4) |
| 7 | glacier-chute | Crevasse | A ⇒ · ⇒ lamplight | planned | wave 1 |
| 8 | lamplight | Crevasse | chute ⇒ · ⇒ B | planned | wave 1 |
| 9 | squall | Storm Docks | A (split after trawler deck) ⇒ · ⇒ run-the-pier | planned | wave 2 |
| 10 | run-the-pier | Storm Docks | squall ⇒ · ⇒ A2 | planned | wave 2 |
| 11 | lights-out | Refinery | B ⇒ · ⇒ C | planned | wave 1 |
| 12 | the-line | Refinery | A ⇒ · ⇒ B | planned | wave 1 |
| 13 | covert-sky | Great Forge | hold-the-forge ⇒ · ⇒ C | planned | wave 1 |
| 14 | hold-the-forge | Great Forge | B ⇒ · ⇒ covert-sky | planned | wave 1 |
| 15 | tram-top | Ringworld | A (split after market arcade) ⇒ · ⇒ A2 | planned | wave 2 |
| 16 | mark-runs | Ringworld | A2 (split after plaza) ⇒ · ⇒ A3 | planned | wave 2 |
| 17 | one-way-out | Prison Rig | B ⇒ · ⇒ C | planned | wave 1 |
| 18 | the-lift | Prison Rig | C ⇒ · ⇒ D | planned | wave 1 (K2) |

## Other

| Item | State | Notes |
|---|---|---|
| Image requests (keyframes + supporting) | open | `ASSETS_IMAGES.md`, committed to `main` early for generation |
| Model requests (props + prisoner) | open | `ASSETS_MODELS.md`; stand-ins ship first |
| Existing-level audit | planned | report to `docs/AUDIT_LEVELS_2026-09.md` |

## Log

- 2026-09-28 — plan written; placement decided (§1 of the plan); assets requested.
