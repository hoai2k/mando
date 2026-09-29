# Follow-ups: gameplay sections and the level audit (updated 2026-09-29)

This is the one list of what is still left across the eighteen gameplay
sections and the level-audit fixes. It is gathered from each team's notes in
`docs/sections-notes/*.md`, `docs/AUDIT_LEVELS_2026-09.md` with `audit-fixes.md`,
`docs/SECTIONS_STATUS.md`, `docs/SECTIONS_IMPLEMENTATION.md` §5 and
`docs/ASSETS_IMAGES.md` / `docs/ASSETS_MODELS.md`. Each row cites where it came
from.

**Where things stand.** All 18 sections, the framework, the nine kits, the
audit fixes and the job page are on `main` (2026-09-29); `BUILT_SECTIONS` in
`src/sections/ids.ts` lists all 18.
No human has played any section yet: every one was tuned against autopilots
that aim perfectly, usually with hostiles culled once a second.

Kind: `bug` | `feature` | `tuning` | `art` | `test` | `docs`.

---

## Open

### 1. Bugs

| Item | Where | Kind | Why it matters |
|---|---|---|---|
| The treadmill carries riders one frame late (7 cm at 2 m/s, 47 cm at 14 m/s). The noted fix is to tick it from `board.update`. | `narkina.md` K2; `desert.md` Known issues | bug | Invisible on the Lift and harmless on the Barge Run (desert checked). Worth a look on the frigate at speed. |
| Once a section is complete, `contains` answers true during the transit to the next stage, while the section object still stands. | `ringworld.md` Known issues | bug | A sampling test, or any logic that trusts `contains`, can land on that frame. |

### 2. Unfinished features

| Item | Where | Kind | Why it matters |
|---|---|---|---|
| K3 auto-fire picks the nearest body in its arc even when it cannot reach it, so a latch or boarder near an unmanned gun silences that gun. It is kept as design; the fix, if play asks for it, is a pitch-reachability test in `turretTarget`. | `frigate.md` Known issues; `src/game/vehicles.ts` | feature | Decide after a playtest. It is K3's file, so it affects the Barge Run too. |
| Glacier Chute: the design asks for "aim assist up one notch" while sliding. Only hip-fire's soft-lock applies. | `crevasse.md` Known issues | feature | Gap between the design and the build. |
| Lamplight: the design asks for "camera slightly closer". It uses the player's own dolly. | `crevasse.md` Known issues | feature | Gap between the design and the build. |
| The K1 rail camera has no `basis: 'view'` option (screen-relative sticks). Tram Top's flank camera may want it. | `station.md` Known issues | feature | Sticks follow the rail; fine on the Ring Walk, possibly off on a flank camera. |
| Bots (`game/bot.ts`) steer by `cam.yaw` and know nothing about `moveYaw` or the aim stick. | `station.md` Known issues | feature | Only matters if missions ever get bots; they would need a rail branch. |
| No `armorer` ally kind exists; the Armorer is a re-dressed `marshal`. If the kind is added to `enemy.ts`, `makeArmorer` should use it. | `forge.md` Known issues | feature | Cleanliness and behaviour of Hold the Forge's escort target. |
| Lights Out: steam plumes block detection but not enemy bolts. | `refinery.md` Known issues | feature | The cover looks solid but does not stop fire. |
| The Mark Runs' nets are a section-local projectile, so they do not deflect off shields. | `ringworld.md` Known issues | feature | Inconsistent with every other projectile. |
| The `prisoner` sculpt path is wired but untested with a real file (none exists); until it lands, prisoners use the Maris / Cobb Vanth stand-in, still built on a `pirateMelee` whose own sculpt loads and is thrown away. | `narkina.md` Known issues; `src/sections/one-way-out.ts` | feature | Check the swap the day `prisoner.glb` arrives. The wasted fetch is harmless. |

### 3. Tuning and feel (all need a human playtest)

| Item | Where | Kind | Levers / why |
|---|---|---|---|
| Guns of the Frigate: the tuning is a floor; the latch HP (240/320 +90) and the tube drain (8 hull/s) are "most likely to need moving". | `frigate.md` Known issues | tuning | Bots cut latches far faster than humans will. |
| Ring Walk length: bots take ~140 s; the reasoned human estimate is 5–5.5 min (design 4–5). Needs one human run to confirm. | `station.md` "Pacing", Known issues | tuning | First lever Lock 1's third pass, then the hatch HP, `runLock` wave sizes, `spawnStart` counts, the sweep alarm's size. |
| Tram Top: the station and pirate-tram fights. | `ringworld.md` Known issues | tuning | Beat-table counts and the coupling HP. |
| The Mark Runs duel: HP 4× (+1.5× per hunter) is expected to take humans 20–40 s, against ~6 s for bots. | `ringworld.md` tuning | tuning | Check against real players. |
| Lamplight: bots finish in ~40–50 s; humans in the dark will take minutes. | `crevasse.md` Known issues | tuning | The brood numbers, if it plays short. |
| One Way Out and the Lift: with hostiles alive the solo bot loses most prisoners; counts, pressure timings and the desk hold were tuned from traces. | `narkina.md` Known issues | tuning | Solo difficulty unverified. |
| Barge Run solo broadside (pending playtest): a player who never silences the barge gunner loses the skiff at ~1.2 %/s, and the broadside closes at 75 s, just before a solo skiff breaks up. "Tight on purpose". | `desert.md` Known issues | tuning | Loosen the chip rates in `update`'s broadside case if play says so. |
| Lights Out: played un-culled, the solo bot is spotted in the west lane and fights through on the alarm. Autopilot paces were re-set for main's walk gait. | `refinery.md` Known issues | tuning | Confirm the stealth loop's difficulty for a real player. |
| The Squall: a boarder aft of the king post can outlast the bot; a wave 150 s past its minimum is force-ended. | `trask.md` Known issues | tuning | A safety valve; check whether humans ever hit it. |
| Hold the Forge and Covert Sky timings (forging 165 s at 2 players, the stall rule, the bellows, the flak) were set by bots. | `forge.md` Tuning | tuning | Same human pass as the rest. |
| Magma Run: hostile swings read only as timing (riding IK pins the hands to the grips), and a knocked-off rider flies upright. | `lava.md` Known issues | tuning | The hit works but reads poorly on screen. |
| Lava Flats darkness: in software GL the basalt rim is near-black against the ash and the marker and pillar are unreadable there. The audit says to check on a real GPU. | `AUDIT_LEVELS_2026-09.md` Lava Flats, Guidance | tuning | Guidance could fail on one board. |

### 4. Audit leftovers

All 16 recommendations are done (`audit-fixes.md`); these are the parts they left.

| Item | Where | Kind | Why it matters |
|---|---|---|---|
| #12 / #13: no bot walks the Spice Run's plate jumps or swims the Prison Rig sea against the 55 s air clock; covered only by the build audit, the sections run and screenshots. | `audit-fixes.md` 12, 13, "Not done" | test | New traversal and drowning rules with no walking test. |
| #15 per-territory leftovers: the hatchery's `krykna_brood` sacs, the adobe gate and towers at the Lava Flats town gate, a real street for the cantina row, rises for the ice chimney and the forge steps, dome-rib props at the Forge gate (no model exists), a plaza fountain. | `audit-fixes.md` 15, "Not done"; `AUDIT_LEVELS_2026-09.md` Lava Flats #3, #7 | feature | The remaining de-templating and continuity beats. |
| Mid-zone checkpoints for long zones: the 108 m frozen gallery and the 60–88 m canyons still checkpoint only at entry. | `AUDIT_LEVELS_2026-09.md` Checkpoints; `audit-fixes.md` "Not done" | feature | The merges made these zones longer, so a death costs more. |
| The outdoor `alcove` still only drops a bacta against the wall (`src/world/stage/zones.ts`). Cut a real notch in the rim or rename the flag `bacta`. | `AUDIT_LEVELS_2026-09.md` "Alcove means two different things" | feature | One flag means two things. |
| #8: a narrow (12 m) canyon camp leaves little room to slip past. | `audit-fixes.md` 8 | tuning | "Clear it or slip through" is weak in narrow camps. |
| Crevasse A→B continuity: the glacier door opens on a steel hall; item 5 fixed the floors only, not the materials. | `AUDIT_LEVELS_2026-09.md` Continuity; `audit-fixes.md` 5 | art | The arrival is still a steel hall behind an ice door. |

### 5. Art

**Models: 12 gameplay-section GLB requests are open; none is delivered.** Every
one has a reference sheet (`reference/props/<id>_ref.png`, plus the prisoner's
three views) and ships as a procedural stand-in. Most stand-ins are now built to
their sheets, with the named nodes the sections will drive, so each is "only the
sculpt left" (`ASSETS_MODELS.md` "Gameplay sections — props and a prisoner").
All gameplay-section images and textures are delivered.

| Item | Where | Kind | Why it matters |
|---|---|---|---|
| Priority 1 sculpts: `quad_turret` (frigate, Barge Run; stand-in to sheet), `pirate_corvette` (frigate finale), `searchlight_tower` (Lights Out; stand-in to sheet, `lamp` driven), `prisoner` (One Way Out, the Lift; code wired). | `ASSETS_MODELS.md`; `lava.md`, `refinery.md`, `narkina.md` | art | The props players look at most. |
| Priority 2 sculpts: `thumper` (Worm Sign; stand-in to sheet, `hammer` driven), `hydraulic_press` (The Line; `head` driven), `flak_tower` (Covert Sky; `yaw`/`pitch` driven), `boarding_tube` (frigate). | `ASSETS_MODELS.md`; `desert.md`, `refinery.md`, `forge.md` | art | Awaiting sculpts. |
| Priority 3 sculpts: `welding_arm` (The Line; `base` driven), `beskar_barricade` (Hold the Forge; stand-in to sheet), `valve_wheel` (Chimney), `freight_lift` (the Lift). | `ASSETS_MODELS.md`; `refinery.md`, `forge.md` | art | Set dressing. Awaiting sculpts. |
| Stand-ins with no model requested: the Ring Walk's hatch, booms, pods, spokes, hub and modules; Tram Top's cars, platforms and pirate tram (they need interiors; the delivered `tram` is solid); the Magma Run's quay, gates, barge platform and columns; the frigate's far dock; the Glacier Chute avalanche (white puffs); the Run the Pier trawler. | `station.md`, `ringworld.md`, `lava.md`, `frigate.md`, `crevasse.md`, `trask.md` | art | Candidates for new requests if any read poorly in play. |
| `rain_streak.png` is delivered but unused: the Squall still draws line rain (`src/` has no reference to it). | `ASSETS_IMAGES.md`; `trask.md` | art | A free upgrade not yet wired in. |
| Glacier Chute: the slide pose is a held crouch-walk frame (Din reads as mid-stride). A dedicated surf clip would read better. | `crevasse.md` Known issues | art | The section's signature pose. |
| Re-screenshot the Barge Run's deck guns through the sight: the desert team checked them before lava's quad-gun rebuild moved the default sight to 2.45 m. | `desert.md` "For K3's owner"; `src/game/vehicles.ts` | test | Confirms the rebuilt gun reads right on the skiff, not only in the frigate. |

### 6. Nice-to-haves

| Item | Where | Kind | Why it matters |
|---|---|---|---|
| The Line's flametroopers' flames are not pushed along the belts. | `refinery.md` Known issues | feature | Design nice-to-have. |
| The Run the Pier pier could dog-leg at its gaps rather than run dead straight. | `trask.md` Left to do | feature | Polish. |
| `cargo_crane` could replace the Squall's procedural crane once its load can be driven. | `trask.md` Left to do | art | Polish. |
| Squall corpses (ragdolls) are not carried with the deck roll and can float up to ~2 m off the deck at a big heel; pickups and bolts look ~0.7 m off at 10°. | `trask.md` Known issues | bug | Cosmetic; the bacta is centred to hide it. |
| The Covert Sky dome is a translucent shell with no collider mesh (the section pushes bodies out). | `forge.md` Known issues | feature | Works, but fragile if other code moves bodies. |
| The station board's ambient `spice_run_frigate` fly-by can read as a sister ship during Guns of the Frigate. | `frigate.md` Known issues | art | Left alone because it belongs to the board. |
| In a stepped harness, the first render after many unrendered steps can drop a just-loaded model for a frame (the shot scripts render twice). | `lava.md` Known issues | test | Know it when taking screenshots. |

### Recorded decisions (no action unless play says so)

- Audit #3: the dune gate / glassed court were not made sieges (sieges held to at most 3; Hold the Forge covers the court).
- Audit #6: the Ringworld night-side row was reshaped, not merged, because it sits across the Tram Top cut.
- Audit #10: the trawler deck's far face keeps its rim, so the wheelhouse door sits in a wall (boundary rule a).
- The Ring Walk's gantry wall behind the cage is one-sided so the rail camera can start behind it (`station.md`); correct as built.

---

## Done this round

- **Guns of the Frigate merged** — orchestrator; into the working branch, `BUILT_SECTIONS` now lists all 18 (`src/sections/ids.ts`).
- **17 sections, framework, kits, audit fixes and job page on `main`** — orchestrator.
- **`SECTIONS_STATUS.md` stale rows** — orchestrator; the Chimney and K4 read `merged`, Covert Sky's "towers' look" note is gone and row 4 (`frigate-guns`) reads merged.
- **Guide beacon lit on a `?section=` boot** — desert; the `Campaign` constructor asks the section's `objective().beacon` before lighting it (`src/game/campaign.ts`, checked in `tools/test-section-desert.mjs`). The "stays visible after update" reading had been taken during the intro.
- **Quad gun's shield blocking the sight** — lava; K3 stand-in rebuilt to its 4.0 × 3.0 × 2.7 m sheet, shield behind the seat, default sight 2.45 m over the breech (`src/game/vehicles.ts`); desert checked the Barge Run's guns.
- **Turret HUD line said "stick drives · A hop · RB shield"** — frigate; turrets now show `TEXT.hud.gunning` ("RT fire · Y off", `src/ui/hud.ts`).
- **One Way Out "10+ prisoners" bonus never reached stage C** — narkina; `Campaign.waiveRetinue` / `retinueWaived`, read in `Game.updateBoss` (`tools/test-section-one-way-out.mjs`).
- **`prisoner` model not wired** — narkina; `'prisoner'` in `ModelId`, warmed and probed once per build, worn via `attachAuthored` when the file exists (`src/sections/one-way-out.ts`).
- **One Way Out double score banner in co-op** — narkina; the finish loop breaks after the first crossing (tested).
- **Refinery props' moving nodes** — refinery; stand-ins rebuilt to sheets, `drivenProp` (`src/sections/kit/sculpt.ts`) hides the stand-in and hands the named nodes to The Line and Lights Out.
- **`flak_tower` and `beskar_barricade` stand-ins to sheet** — forge; flak `yaw`/`pitch` driven, barricade 0.9 m on a 0.25 m plinth (`forge.md` "Props to their sheets").
- **`thumper` stand-in to sheet** — desert; 2.0 × 1.8 × 2.4 m with a driven `hammer` node (`src/sections/worm-sign.ts`).
- **Barge Run planks clipping a crate stack** — desert; the stacks moved clear.
- **Ring Walk pacing** — station; reasoned in `station.md` "Pacing" (human ~5–5.5 min), and the sweep gained its alarm beat. Needs one human run (Open §3).
- **Tram Top coupling could be shot out early** — ringworld; dark and untargetable until the tram is alongside (`src/sections/tram-top.ts`, `test-section-tram-top`).
- **Mark Runs "by hand" from any 3.6 m hit** — ringworld; now only a melee blow counts, via `SectionMove.meleeHit` (`src/sections/mark-runs.ts`).
- **Glacier Chute held by a dead teammate** — crevasse; completes once every *living* player is past the snowbank (`src/sections/glacier-chute.ts`, tested).
- **Lamplight's focus control undiscoverable** — crevasse; HUD reads "Hold LT · RMB to focus the beam" / "Spider in the lamp · hold LT · RMB" (`src/text.ts`).
- **Magma Run's unread `wiped` flag** — lava; a wipe calls off the riders and replays the waves from the last gate (`src/sections/magma-run.ts`).
- **Header comments versus code** — Chimney valve pause (lava), Ring Walk Lock 1 now "three" in the header and `LEVEL_SECTIONS.md` (station), Barge Run "once per wipe" (desert), The Line's second squad now drops halfway through the hold, as its header says (refinery).
- **Hard-coded banner strings** — Chimney `TEXT.sections.chimney.floorOf` (lava), Mark Runs `cpNets` / `cpLast` (ringworld).
- **Hold the Forge's retinue call could silently not come** — orchestrator; the chieftain is put on the bar with `Game.adoptBoss`, which starts its boss phases from the top instead of wherever the run's earlier boss left them.
