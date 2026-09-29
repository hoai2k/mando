# Follow-ups: gameplay sections and the level audit (2026-09-28)

This is everything that is still unfinished, deferred or only suggested across
the eighteen gameplay sections and the level-audit fixes, collected in one
place. It comes from each team's notes in `docs/sections-notes/*.md` (Guns of the
Frigate's are read from `origin/claude/sections-frigate:docs/sections-notes/frigate.md`),
`docs/AUDIT_LEVELS_2026-09.md` together with `audit-fixes.md`,
`docs/SECTIONS_STATUS.md`, `docs/SECTIONS_IMPLEMENTATION.md` §5, and
`docs/ASSETS_IMAGES.md` / `docs/ASSETS_MODELS.md`. `src/sections/` has no
`TODO`, `FIXME` or `XXX` markers. Duplicates are merged, and each row cites the
file it came from. Nothing here has been played by a human yet: every section is
`built` or `merged`, and none has reached `tuned`.

Kind: `bug` | `feature` | `tuning` | `art` | `test`.

## 1. Blocking / bugs

| Item | Where | Kind | Why it matters |
|---|---|---|---|
| Guns of the Frigate is not merged. It is built and passes at 1/2/4 players plus its own 27-check suite, but it exists only on `origin/claude/sections-frigate`. `BUILT_SECTIONS` in `src/sections/ids.ts` lists 17 sections and does not include `frigate-guns`. | `SECTIONS_STATUS.md` row 4; `frigate.md` "State" | test | The Spice Run is missing its A ⇒ B section until it is merged and the run is re-verified (`RUNS=station … --runs-only`). |
| The campaign's guide beacon shows for about 1–2 s on a `?section=` boot. It also stays visible over objectives that return `beacon: false` (`campaign.beacon.visible` reads true after `update`). The `Campaign` constructor lights it before the first update. | `desert.md`, `ringworld.md`, `frigate.md` Known issues; `src/game/campaign.ts` | bug | Three teams reported it. The desert team saw it standing over section objectives in screenshots, not only at boot. |
| The K3 stand-in quad gun's shield top (y 2.3) sits at the sight (y 2.25), so aiming below level looks into the shield's back. The frigate raised its own sight to 2.7 m, but the Barge Run's deck guns still use the default (`sight y 2.25` in `vehicles.ts`). | `desert.md` "For K3's owner"; `frigate.md` "The guns"; `src/game/vehicles.ts:339` | bug | The lower half of the Barge Run's gun view is blocked. Fix the default in `vehicles.ts` or the stand-in's shield height. |
| **Fixed (narkina, 2026-09-29):** ten or more brought out now waive the stage C lieutenant's retinue calls (`Campaign.waiveRetinue` / `retinueWaived`, read in `Game.updateBoss`; `tools/test-section-one-way-out.mjs`). Was: the One Way Out "10+ prisoners" bonus is announced but never reaches stage C: the supervisor deck's lieutenant still gets reinforcements. This needs a campaign flag that stage C's lieutenant zone reads. | `narkina.md` Known issues; `src/game/campaign.ts` (shared) | bug | The section promises a reward it does not give. It was left for the orchestrator. |
| `SECTIONS_STATUS.md` has stale rows. `frigate-guns` still reads "in progress", and Covert Sky still says the "towers' look wants a pass" although the tower polish is merged (`forge.md` "Tower polish"). The Chimney and K4 read `built`, not `merged`. | `SECTIONS_STATUS.md` | bug | This file is where paused work resumes from, so wrong rows send the next session to the wrong place. |

## 2. Unfinished features

| Item | Where | Kind | Why it matters |
|---|---|---|---|
| **Fixed (narkina, 2026-09-29):** `'prisoner'` is in `ModelId`, warmed with the section, and probed once per build; when the file exists prisoners are a plain biped wearing it via `attachAuthored` (until then the Maris / Cobb Vanth stand-in the user asked for). Was: the `prisoner` model is not wired: there is no `'prisoner'` in `ModelId` in `src/characters/authored.ts`. When it lands, add the id and call `attachAuthored(rig, 'prisoner', 1.78, …)` in `buildPrisoner`. The stand-in is also built on a `pirateMelee` whose own sculpt loads and is thrown away. | `narkina.md`; `src/sections/one-way-out.ts` | feature | Without this, a delivered prisoner GLB would not appear. The wasted fetch is harmless but untidy. |
| When the models land, the section code has to drive or hide their moving nodes. The Line: `hydraulic_press` `head` and `welding_arm` `shoulder`/`elbow` (today the gantry sculpt hangs over an empty stand-in). Lights Out: `searchlight_tower` `lamp` (the game's own drum sweeps). | `refinery.md` Known issues | feature | Otherwise the delivered models will double up with, or fight, the game-driven parts. |
| K3 auto-fire picks the nearest body in its arc even when it cannot reach it, so a latch or boarder near an unmanned gun silences that gun. This is kept as design in the frigate. The fix, if needed, is a pitch-reachability test in `turretTarget`. | `frigate.md` Known issues; `src/game/vehicles.ts` `turretTarget` | feature | This decision should be made after a human playtest. It is K3's file, so it affects the Barge Run too. |
| Crevasse slide: the design asks for "aim assist up one notch" while sliding. Not done (only hip-fire's soft-lock applies). | `crevasse.md` Known issues | feature | This is a gap between the design spec and the build. |
| Lamplight: the design asks for "camera slightly closer". Not done (it uses the player's own dolly). | `crevasse.md` Known issues | feature | This is a gap between the design spec and the build. |
| The K1 rail camera has no `basis: 'view'` option (screen-relative sticks). Tram Top's flank camera may want it. | `station.md` K1 and Known issues | feature | The sticks follow the rail rather than the screen. That reads fine on the Ring Walk but could feel off on a flank camera. |
| Bots (`game/bot.ts`) steer by `cam.yaw` and know nothing about `moveYaw` or the aim stick. | `station.md` Known issues | feature | This only matters if missions ever get bots, which would then need a rail branch. |
| No `armorer` ally kind exists. The Armorer is a re-dressed `marshal`. If the kind is added to `enemy.ts`, `makeArmorer` should use it. | `forge.md` Known issues | feature | This is a cleanliness and behaviour item for Hold the Forge's escort target. |
| The Hold the Forge chieftain uses `game.boss` for its bar, and the board's boss-phase retinue call fires only if the run's earlier boss left the phase counter at 0. | `forge.md` Known issues | bug | The retinue may silently not appear, depending on what came earlier in the run. |
| Steam plumes block detection but not enemy bolts in Lights Out. | `refinery.md` Known issues | feature | The cover looks solid but does not stop fire. |
| The Mark Runs' nets are a section-local projectile, so they do not deflect off shields. | `ringworld.md` Known issues | feature | This is inconsistent with every other projectile. |
| The treadmill carries riders one frame late (7 cm at 2 m/s, 47 cm at 14 m/s). The noted fix is to tick the treadmill from `board.update`. | `narkina.md` K2 and Known issues | bug | It is invisible on the Lift. Worth checking on the Barge Run and frigate at speed. |
| Once a section is complete, `contains` answers true during the transit to the next stage, while the section object still stands. | `ringworld.md` Known issues | bug | A sampling test (or any logic that trusts `contains`) could land on that frame. |

## 3. Tuning & feel passes suggested by the teams

Every team tuned against autopilots that aim perfectly, with hostiles usually culled once a second. Every section needs a human playtest, and these are the levers the teams named.

| Item | Where | Kind | Why it matters |
|---|---|---|---|
| Guns of the Frigate: the latch HP (240/320 +90) and the tube drain (8 hull/s) are "most likely to need moving". The tuning is a floor. | `frigate.md` Known issues | tuning | Bots cut latches far faster than humans will. |
| Ring Walk pacing: bots take 100–140 s against a design of about 4–5 min. The levers are the `runLock` wave sizes, the `spawnStart` posted counts and the hatch HP. | `station.md` Known issues | tuning | It needs a human run to set its length. |
| Tram Top: the station and pirate-tram fights need a human pass. The levers are the beat-table counts and the coupling HP. | `ringworld.md` Known issues | tuning | Tuned by perfect-aim bots only. |
| The Mark Runs duel: the HP (4× +1.5× per hunter) is expected to take humans 20–40 s, against about 6 s for bots. | `ringworld.md` tuning | tuning | This needs checking against real players. |
| Lamplight: the bot finishes in about 40–50 s, while humans in the dark will take minutes. The brood numbers are the lever if it plays short. | `crevasse.md` Known issues | tuning | Its length is currently unknown. |
| One Way Out and the Lift: with hostiles alive, the solo bot loses most prisoners. The prisoner counts, pressure timings and desk hold were tuned from traces, not play. | `narkina.md` Known issues | tuning | The solo difficulty is unverified. |
| Barge Run solo: a player who never silences the barge gunner loses the skiff hull at about 1.2 %/s, and the broadside closes at 75 s, just before a solo skiff breaks up. "Tight on purpose". The fix is to loosen the chip rates in `update`'s broadside case. | `desert.md` Known issues | tuning | It could be a near-guaranteed solo failure. |
| Lights Out: played un-culled, the solo bot is spotted in the west lane and fights through on the alarm. The autopilot paces were re-set after main's walk gait (0.74 / 0.83; the Line's slow pace 0.76). | `refinery.md` Known issues and "after main's walk gait" | tuning | The stealth loop's difficulty for a real player needs confirming now that the walk gait has changed stick speeds. |
| The Squall: a boarder aft of the king post can outlast the bot, and a wave that runs 150 s past its minimum is force-ended. | `trask.md` Known issues | tuning | This is a safety valve. Check whether humans ever hit it. |
| Hold the Forge and Covert Sky timings (forging 165 s at 2 players, the stall rule, the bellows, the flak) were set by bots. | `forge.md` Tuning | tuning | These need the same human pass as the other sections. |
| Magma Run: hostile swings read only as timing because the enemies' riding IK pins their hands to the grips, and a knocked-off rider flies upright. | `lava.md` Known issues | tuning | The swing reads poorly on screen even though the hit works. |
| Glacier Chute: the slide pose is a held crouch-walk frame (Din reads as mid-stride). A dedicated surf clip would read better. | `crevasse.md` Known issues | art | The slide is the section's signature pose. |
| Lava Flats darkness: in software GL the basalt rim is near-black against the ash, and the marker and pillar are unreadable there. The audit says to check on a real GPU. | `AUDIT_LEVELS_2026-09.md` Lava Flats and Guidance | tuning | Guidance could fail on one board. |

## 4. Audit recommendations not fully done

All 16 recommendations are marked done in `audit-fixes.md`. These are the parts each item left, plus the audit's own suggestions that fell outside the numbered 16.

| Item | Where | Kind | Why it matters |
|---|---|---|---|
| #12 / #13: no bot walks the Spice Run's plate jumps, and none swims the Prison Rig sea against the 55 s air clock. Both are covered only by the build audit, the sections run and screenshots. | `audit-fixes.md` items 12, 13, "Not done" | test | These are new traversal and drowning rules with no walking test. |
| #15 per-territory leftovers: the hatchery's `krykna_brood` sacs, the adobe gate and towers at the Lava Flats town gate (continuity to the garrison), a real street for the cantina row, rises for the ice chimney and the forge steps, dome-rib props at the Forge gate (no model exists), a plaza fountain. | `audit-fixes.md` item 15, "Not done"; `AUDIT_LEVELS_2026-09.md` Lava Flats #3, #7 | feature | These are the remaining de-templating and continuity beats. |
| Mid-zone checkpoints for long zones: the 108 m frozen gallery (after the #6 merge) and the 60–88 m canyons still checkpoint only at entry. | `AUDIT_LEVELS_2026-09.md` Checkpoints; `audit-fixes.md` "Not done" | feature | The merges made these zones longer, so a death costs more. |
| The outdoor `alcove` still only drops a bacta against the wall (`src/world/stage/zones.ts:330`). The audit said to cut a real notch in the rim or rename the flag `bacta`. | `AUDIT_LEVELS_2026-09.md` "Alcove means two different things" | feature | The spec promises a side crack that is not there, and one flag means two things. |
| #8: a narrow (12 m) canyon camp still leaves little room to slip past. | `audit-fixes.md` item 8 | tuning | "Clear it or slip through" is weak in narrow camps. |
| #3: the other option, making the dune gate or the glassed court a siege, was not taken (sieges held to at most 3, and Hold the Forge covers the court). | `audit-fixes.md` item 3 | feature | This is a recorded decision. Revisit only if those zones feel flat. |
| #6: the Ringworld night-side row was reshaped rather than merged, because it sits across the Tram Top cut. | `audit-fixes.md` item 6 | feature | This is a recorded decision, noted for completeness. |
| #10: the trawler deck's far face keeps its rim, so the wheelhouse door sits in a wall (boundary rule a). | `audit-fixes.md` item 10 | feature | This is a recorded decision, noted for completeness. |
| Crevasse A→B continuity: the audit's "fix the materials" for the glacier door → steel hall. Item 5 fixed the floors only. | `AUDIT_LEVELS_2026-09.md` Continuity table; `audit-fixes.md` item 5 | art | The arrival is still a steel hall behind an ice door. |

## 5. Art: stand-ins awaiting models / images

**Models: 12 gameplay-section GLB requests are open, and none has been delivered.**
Reference sheets exist for all of them (`reference/props/<id>_ref.png`, plus
the prisoner's three views). Every one ships today as a procedural stand-in
(`ASSETS_MODELS.md` "Gameplay sections — props and a prisoner").

| Item | Where | Kind | Why it matters |
|---|---|---|---|
| Priority 1 (4): `quad_turret` (frigate, Barge Run), `pirate_corvette` (frigate finale), `searchlight_tower` (Lights Out), `prisoner` (One Way Out, the Lift). | `ASSETS_MODELS.md` | art | These are the props players look at most. The prisoner also needs the code wiring in group 2. |
| Priority 2 (4): `thumper` (Worm Sign), `hydraulic_press` (The Line), `flak_tower` (Covert Sky), `boarding_tube` (frigate). | `ASSETS_MODELS.md` | art | The press needs its node handling (group 2). |
| Priority 3 (4): `welding_arm` (The Line), `beskar_barricade` (Hold the Forge), `valve_wheel` (Chimney), `freight_lift` (the Lift). | `ASSETS_MODELS.md` | art | Set dressing. |
| Stand-ins with no model requested: the Ring Walk's hatch, booms, pods, spokes, hub and modules; Tram Top's cars, platforms and pirate tram (they need interiors, and the delivered `tram` is solid); the Magma Run's quay, gates, barge platform and columns; the frigate's far dock; the Glacier Chute avalanche (white puffs, where a real snow cloud would sell it better); the Run the Pier trawler (simpler than the Squall's hull). | `station.md`, `ringworld.md`, `lava.md`, `frigate.md`, `crevasse.md`, `trask.md` | art | These are candidates for new requests if any read poorly in play. |
| Images: all gameplay-section keyframes and supporting textures are delivered (`ASSETS_IMAGES.md` §"Gameplay sections"). One delivered image is unused: `rain_streak.png` (the Squall still draws line rain, and `src/` has 0 references to it). | `ASSETS_IMAGES.md`; `trask.md` Known issues and Registration | art | It is a free upgrade that is not wired in yet. |
| The Barge Run's stowed boarding planks clip one crate stack slightly. | `desert.md` Known issues | art | A small visual defect. |

## 6. Nice-to-haves

| Item | Where | Kind | Why it matters |
|---|---|---|---|
| The Line's flametroopers' flames are not pushed along the belts. | `refinery.md` Known issues | feature | This is a design nice-to-have. |
| The Run the Pier pier could dog-leg at its gaps rather than run dead straight. | `trask.md` Left to do | feature | Polish. |
| `cargo_crane` could replace the Squall's procedural crane once its load can be driven. | `trask.md` Left to do | art | Polish. |
| Squall corpses (ragdolls) are not carried with the deck roll and can float up to about 2 m off the deck at a big heel. Pickups and bolts are drawn in physics space, so they look about 0.7 m off at 10°. | `trask.md` Known issues | bug | Cosmetic. The bacta is already centred to hide it. |
| The Hold the Forge dome is a translucent shell with no collider mesh (the section pushes bodies out). | `forge.md` Known issues | feature | It works, but it is fragile if other code moves bodies. |
| The station board's ambient `spice_run_frigate` fly-by can read as a sister ship during Guns of the Frigate. | `frigate.md` Known issues | art | This is a possible confusion, left alone because it belongs to the board. |
| In a stepped harness, the first render after many unrendered steps can drop a just-loaded model for a frame (the shot scripts render twice). | `lava.md` Known issues | test | This is a test-harness quirk to know about when taking screenshots. |
| The Ring Walk's gantry wall behind the cage is drawn one-sided so the rail camera can start behind it. | `station.md` Known issues | feature | This is correct as built. Note it if the start is ever reworked. |

## 7. Found while writing the in-game guides (`src/sections/guide.ts`)

Read against each section's code on 2026-09-28. The guides describe what the code does; where a header comment or the design doc says otherwise, the code won.

| Item | Where | Kind | Why it matters |
|---|---|---|---|
| The pirate tram's coupling can be shot out while the tram is still pulling up; the peel-off only fires if it breaks once the tram is alongside, so an early break leaves you killing every gunner instead. | `src/sections/tram-top.ts` | bug | The climax can silently skip its own set piece. |
| **Fixed (narkina, 2026-09-29):** the finish loop breaks after the first crossing (tested). Was: two players reaching the stair on the same frame show the score banner twice (the finish loop doesn't break). | `src/sections/one-way-out.ts` | bug | Cosmetic, co-op only. |
| The chute only completes when every player is alive and past the snowbank, so a dead teammate holds the party until they respawn. | `src/sections/glacier-chute.ts` | tuning | Can read as "stuck" at the finish. |
| Header comments disagree with the code: Chimney valve pause (12 s in the header, 10 s / 6 s in the code); Ring Walk Lock 1 (two passes in the doc, three drops in the code); The Line's door release (the squad drops after the hold, not during it); Barge Run "re-form once" (it happens on every wipe). | those section files, `LEVEL_SECTIONS.md` | docs | A future tuner would read the wrong number. |
| Hard-coded banner strings outside `TEXT`: the Chimney's `floor ${k} of 3` and two Mark Runs checkpoint banners. | `chimney.ts`, `mark-runs.ts` | docs | Breaks the one-place-for-words rule. |
| Mark Runs "by hand" counts any hit from within 3.6 m, so point-blank blaster fire costs no bounty. | `src/sections/mark-runs.ts` | tuning | An exploit, or intended leniency — decide. |
| Magma Run's `wiped` flag is set and never read. | `src/sections/magma-run.ts` | cleanup | Dead code. |
| Lamplight's beam focus uses aim (LT / right mouse), which the controls page doesn't mention (the job page does). | `src/sections/lamplight.ts` | docs | Discoverability. |
