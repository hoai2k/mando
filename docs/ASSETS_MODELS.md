# Asset Requests — 3D Models

Characters first (the original scope of this doc), then the
[environment & hazard models](#environment--hazard-models--priority-by-impact)
opened by the 2026-08-29 territory audit.

**Every character in this document has been delivered and integrated.** What follows is the standing brief — the swap contract, the design of each character, and the budgets — kept so a model can be re-exported or replaced on-style. Anything still open is called out where it appears; as of 2026-08-29 that is the [monster boss batch](#monster-bosses--open-2026-08-29) opened by the boss design round (`docs/BOSSES.md`) — the environment batch landed the same day, and nothing on the humanoid character side is open. An authored glTF (.glb) replaces any character **without touching gameplay code** via the swap contract; where a file is absent the procedural stand-in still stands.

## Swap contract (applies to every biped)

- Skeleton node names must match the canonical rig in `src/anim/skeleton.ts`:
  `hips, spine, chest, neck, head, shoulderL/R, upperArmL/R, forearmL/R, handL/R, upperLegL/R, lowerLegL/R, footL/R` plus attachment points `weaponR, weaponL, jetpack, capeRoot`.
- Origin at the feet, +Z facing forward, real-world scale (heads ~1.7–2.2 m tall as noted).
- Rest pose: relaxed A-pose matching the procedural proportions (`HUMAN` in skeleton.ts) so our procedural clips read correctly; authored clips may ship in the file and will be preferred if present.
- **Visual reference: model from the A-pose turnaround sheets, not from the prose below.** Each character's `_front` / `_side` / `_back` sheets are requested in [`ASSETS_IMAGES.md`](ASSETS_IMAGES.md) and land at `reference/characters/<id>_front.png` etc. The prose here is a summary of the same design — where they disagree, the sheet wins. Heights are specified alongside the sheets so relative scale survives into the models.
- Budgets: ≤ 15k tris playable characters, ≤ 8k tris grunts, ≤ 4k tris critters/props; one 1024² (playables) or 512² (grunts) PBR texture set (baseColor/metal-rough/normal).
- Non-biped characters (marked ◆) use their own free-form rig — animation is procedural code, so any node layout is fine; keep the listed named nodes if possible.
- Style target: stylized-realistic, weathered and used; silhouettes must read at 30 m. Original fan interpretations — no scans/rips of commercial assets.

## Playable Mandalorians (4) — priority 1

All share the rig, jetpack mount (`jetpack` bone), and weapon mounts (`weaponR`). Each needs: armored body, distinct helmet, jetpack variant, optional cape on `capeRoot`.

**Authored models are supplied for all four**, and they were the proving ground for the
swap contract. All four are playable today. The roster carries original names — the ids
below (and the reference-sheet filenames) are unchanged, so nothing in the pipeline moves
when a name does.

| Character | Id / reference sheets (`reference/characters/`) | Reference look |
|---|---|---|
| **Din Djarin** | `din` — `din_front/side/back.png` | Polished bare-silver beskar cuirass and helmet (no rangefinder), brown flight suit and cape, cheek-ridged helmet, slim jetpack. |
| **Paz Vizsla** | `paz` — `paz_front/side/back.png` | Heavy dark-blue plate, oversized pauldrons and chest, reinforced helmet crest, broadest silhouette (normalised to 1.67 m, bulk 1.16, width-only broad 1.08 — never scale y, or limbs stretch as they swing). |
| **Bo-Katan Kryze** | `bokatan` — `bokatan_front/side/back.png` | Blue-and-red plate, rangefinder helmet, lighter build (scale ~0.95). **Benched 2026-08-29** — the build, the sheets and `bokatan.glb` all stay; only the playable list drops her (`BENCHED_MANDO_IDS`), so putting her back is a one-line change. |
| **The Armorer** | `armorer` — `armorer_front/side/back.png` | Gold plate over dark underlayers, horned forge-keeper helm, cape. |

Shared weapon props (separate .glb each, gripped at origin): **EE-3-style carbine** (muzzle node at barrel tip named `muzzle`, reference `carbine.png`), **gaffi stick** (two-handed staff: spearhead + club knot + bottom blade, reference `gaffi.png`).

## Playable bounty hunters (5) — priority 2

A second playable roster: underworld hunters alongside the Mandalorians. (Two more
concepts — a horned warrior and a snouted hunter — were considered and cut.) Standard swap
contract and playable budgets (≤ 15k tris, one 1024² PBR set). Two things every one of
them needs that the sheets are briefed to show: a **low-profile twin-nozzle thruster
backpack** (playable movement is jetpack flight — sized and styled to the character, worn
over the costume, thruster mouths low on the pack where the `jetpack` bone's flames sit),
and empty hands (they mount the shared carbine and gaffi props like the Mandalorians;
signature weapons below are separate props or FX).

**Every hunter model is delivered and integrated** — the three hunters on 2026-08-28, and
the **blue-skinned gunslinger** on 2026-08-29, who is playable as Cad Bane from the
delivered `duelist.glb` and its sheets as-is. He is also the `duelist` enemy kind on the
Ringworld's final wave: the same sculpt on both sides, which is deliberate. An optional
re-export at playable budget can come later if the 8k boss version reads poorly up close.
The fifth of the family, **IG-11**, rides the delivered ally droid model (`ig11.glb`) on
the canonical rig, so it needed no new sculpt.

| Character | Id / reference sheets | Height | Reference look |
|---|---|---|---|
| **Cad Bane** | `duelist` — `duelist_front/side/back.png` | 1.90 m | Gaunt blue-skinned alien gunfighter: red eyes, breathing tubes to the temples, wide-brimmed hat, long coat, twin pistols — one in each hand, on both weapon mounts. |
| **Asajj Ventress** | `ventress` — `ventress_front/side/back.png` | 1.79 m | Bald ash-grey female assassin, dark scalp markings, sleeveless grey-black bodysuit with split skirt panel, two curved sword hilts crossed at the back of the belt (hilts only — blades are FX meshes, like the dark saber). |
| **Embo** | `embo` — `embo_front/side/back.png` | 1.78 m | Olive-green alien behind a slatted rebreather mask, very wide flat woven-metal hat (model it as a distinct mesh under the `head` bone — it may become a gameplay prop later), fur-trimmed poncho over banded armor. |
| **Bossk** | `bossk` — `bossk_front/side/back.png` | 1.90 m | Hulking yellow-green scaled reptilian, wedge snout and needle teeth, clawed hands and feet, rolled-sleeve tan flight suit with chest rig and bandoliers. Bulkiest of the set (scale ~1.08). |
| **IG-11** | `ig11` — `ig11_front/side/back.png` | 2.20 m | The ally assassin droid, playable: cylindrical red-ringed head, exposed piston limbs. Wears no jetpack — flight flames mount under the foot bones instead (`thrusters: 'feet'` in the roster config), so a re-export must not add a pack. |

Integration note: all five are roster entries in `src/characters/mandalorians.ts`, each
carrying its authored model and its signature weapon — twin red curved-hilt sabers
(Ventress), laser crossbow (Embo), long rifle (Bossk and IG-11), twin heavy pistols
(Rook). Paired weapons mount on `weaponR` and `weaponL`; an authored model exposes both
mounts, so an off-hand weapon sits in the model's other hand rather than beside the body.

**Three of the four signature weapon props are delivered and integrated**
(2026-08-29): `saber_curved`, `crossbow` and `longrifle` landed and are picked up
automatically — `swapWeapon()` in `src/characters/builder.ts` already pointed at each id,
so the file arriving *is* the integration, and the procedural build hides behind it. They
had been parked by an earlier decision (the procedural versions read well at gameplay
distance and nothing was blocked on a file); that decision is simply moot now the sculpts
exist. `pistol`, for Cad Bane's pair, is the one still to come — its prompt is in
[`ASSETS_IMAGES.md`](ASSETS_IMAGES.md) and the procedural pistols stand until it does.
A character carrying a pair needs only one file, since the off-hand is a second instance
of it.

## Allies — priority 2

| Character | Type | Reference sheets | Reference look |
|---|---|---|---|
| **IG-11** (`ig11`) | `ig11_front/side/back.png` | ranged ally — also playable, above | Tall spindly assassin droid, cylindrical head with red sensor ring, exposed piston limbs (~2.2 m). |
| **The Marshal** | `marshal_front/side/back.png` | ranged ally | Human gunfighter, red-brown duster coat, wide-brim hat, weathered desert lawman. |
| **Fennec Shand** | `fennec_front/side/back.png` | sniper ally | Sleek dark body armor, helmet cap with orange visor band, long rifle. |

## Enemies — priority 2 (grunts) / 3 (elites)

| Character | Board | Reference sheets | Reference look |
|---|---|---|---|
| **Tusken Raider** | `tusken_front/side/back.png` | desert | Sand-colored wrapped robes, bandolier, cylinder-eyed mask with rebreather spikes, gaderffii stick. |
| **War massiff** ◆ | desert | `massiff_front/side/back.png` | Armoured quadruped predator — **note the size change: 2.1 m tall at the dorsal spines, 5.6 m nose to tail**, roughly triple a trooper's bulk, not the knee-high hound the old sheets imply. Slab-sided plated hide, spine of plates and spikes, flank scutes, heavy tusked skull carried low and forward, thick segmented tail. Free-form rig; keep named nodes `head`, `jaw`, `legFL/FR/BL/BR`, `tail1..5`. |
| **Nikto swoop rider** ◆ | desert | `nikto_front/side/back.png`, `nikto_swoop_front/side/back.png` | Horned leathery-faced alien in biker leathers riding a long-nosed swoop bike; nodes: `bike`, rider on canonical rig welded to seat. |
| **Pyke soldier** | `pyke_front/side/back.png` | both | Tall tapered grey-green helmet with narrow eyes, breather tubes to chest rig, slate long coat, rifle. |
| **Space pirate (ranged & brawler)** | `pirate_front/side/back.png` | station | Ragged spacer leathers, mismatched plates, one metal pauldron, horn-nubbed alien head; brawler variant carries a heavy club. |
| **8D8-style security droid** | `droid_front/side/back.png` | both | Bone-white skeletal frame droid, elongated skull, red eyes (~2.1 m). |
| **Stormtrooper (remnant)** | `stormtrooper_front/side/back.png` | both | Classic white trooper plate gone grimy — scuffed, sand-dusted, mismatched repairs; black visor band. |
| **Death trooper** | `deathtrooper_front/side/back.png` | both | All-black elite trooper armor, taller (~2.0 m), matte with subtle green lens glow. |
| **Dark trooper** | both | `darktrooper_front/side/back.png` | Heavy jet-black humanoid battle droid (~2.2 m), skull-faced with red eyes, integrated back thrusters; uses canonical rig + `jetpack` node. |

## New-board enemies — priority 3

The six new boards (Nevarro, the Crevasse, Trask, the Refinery, the Great Forge, the
Ringworld) shipped with seven new enemy kinds. **All seven are delivered and
integrated** — the last four (ringworld enforcer, krykna, broodmother, interceptor
drone) landed 2026-08-28. The three creatures animate through `GENERATED_CLIPS` in
`src/characters/authored.ts` (code-built idle/move clips in `src/anim/quadruped.ts`,
blended by gait speed); clips shipped in a re-exported .glb would win over these.

✅ = delivered and integrated.

| Character | Boards | Type / intake | Reference look |
|---|---|---|---|
| **Incinerator trooper** (`flametrooper`) ✅ | Nevarro, Refinery | canonical rig, `attachAuthored` | White trooper plate with dark-red trim bands and helmet crest, twin back fuel tanks, wide-mouthed flame projector (projector stays a separate prop on `weaponR` — the muzzle drives the flame stream). |
| **Quarren netcaster** (`quarren`) ✅ | Trask | canonical rig, `attachAuthored` | Squid-faced dock hand: domed head, four face tentacles, heavy oilskin coat, rolled net on the back, stubby net-launcher tube (separate prop on `weaponR`). |
| **Alamite** (`alamite`) ✅ | Great Forge | canonical rig, `attachAuthored` | Pale hunched cave-dweller, heavy brow, tusked underbite, bony dorsal ridge, stone club (prop on `weaponR`). |
| **Ringworld enforcer** (`ring_enforcer`) ✅ | Ringworld | canonical rig, `attachAuthored` | Oxblood-and-gunmetal heavy plate, visored helm; **model the tower shield as a separate mesh parented to `forearmL`** — the glowing pane is an FX mesh the game manages, and the block itself is a gameplay collider, not geometry. |
| **Krykna** (`krykna`) ◆ ✅ | Crevasse | own rig, `loadCreature` | Person-sized bone-white cave spider: abdomen + head section, six black eyes, eight jointed legs. Keep named nodes `body`, `head`, `legL1..L4`, `legR1..R4` — the gait is code-driven per leg. |
| **Krykna broodmother** (`krykna_brood`) ◆ ✅ | Crevasse (wave-10 boss) | own rig, `loadCreature` | The krykna half again the bulk, mottled shell, three egg sacs on the abdomen (own nodes `sac1..3` — they matter to the fight). Same leg node names. |
| **Interceptor drone** (`interceptor_drone`) ◆ ✅ | Great Forge | own rig, `loadCreature` | Black probe-style drone: sphere head, one red photoreceptor, amber sensor ring, five dangling manipulator arms (`arm1..5`), top thruster node `thruster` (its dive trail emits there). |

Budgets as above: ≤ 8k tris each (the broodmother may take 12k), one 512² PBR set (1024²
for the broodmother). The four bipeds obey the standard swap contract; the three ◆
creatures come in through `loadCreature` like the massiff — placed, scaled and grounded,
with movement carried by the enemy code, so any node layout works but the named nodes
above unlock the procedural animation.

## Bosses — delivered, in game as elites

All four models are delivered, integrated and fighting. Rather than wait for dedicated
boss encounters, each entered as a late-wave elite: the duelist (also playable, above) and
the darksaber-carrying Imperial officer from waves 7–10, and the Pyke capo and Wookiee
enforcer one each on the final wave only. Purpose-built boss *fights* — phases, arenas, a
boss bar — remain future work, and their voice sets are deferred with them
(see [`ASSETS_AUDIO.md`](ASSETS_AUDIO.md)).

| Character | Reference sheets | Reference look |
|---|---|---|
| **Krrsantan-class Wookiee enforcer** | `wookiee_enforcer_front/side/back.png` | Towering black-furred Wookiee gladiator (~2.6 m), chest bandolier, fighting gauntlets. |
| **Pyke capo** | `pyke_capo_front/side/back.png` | Ornate Pyke in embroidered robes with personal shield generator effect. |
| **Moff-class Imperial officer w/ dark saber** | `imperial_officer_front/side/back.png` | Black Imperial officer greatcoat, slicked silhouette, glowing black-white blade (blade is an FX mesh). |
| **Cad Bane-class duelist** | `duelist_front/side/back.png` | Blue-skinned gunslinger, wide-brim hat, breathing tubes, twin pistols. |

## Monster bosses — OPEN 2026-08-29

Six large creature bosses, one per board that has a monster, designed in
[`docs/BOSSES.md`](BOSSES.md) — the fights, phases, weak points and numbers live
there; this is the model brief. **All six are open.** Order of work is the standard
pipeline: reference sheets first
([`ASSETS_IMAGES.md`](ASSETS_IMAGES.md#open--monster-boss-reference-sheets-for-image-to-3d),
one `<id>_ref.png` creature canvas each) → model → gameplay. Nothing in the game
blocks on them — the promoted-elite bosses stand until a monster lands.

**Intake:** all six are ◆ creatures through `loadCreature` — own free-form rigs,
placed/scaled/grounded by the loader, movement and gait authored in code against the
named nodes (the massiff/krykna pattern in `src/anim/quadruped.ts`); clips shipped in
the .glb win, as everywhere. **The weak-zone nodes are gameplay**, exactly like the
broodmother's `sac1..3`: the game hangs hit volumes and emissive pulses off them, so
they must be distinct named meshes/nodes placed where the sheet shows them. Origin at
the resting ground/waterline point, +Z forward, real-world scale per the size column.
Style per the character sheets: stylized-realistic, weathered, battle-scarred,
silhouette readable at 30 m, original fan designs only.

**Budgets:** these are the largest and closest-inspected creatures in the game —
≤ 15k tris and one 1024² PBR set (baseColor / metal-rough / normal + **emissive**,
which every one of them uses for its weak zones) for the four full-body monsters;
the two partial-body colossi (`krayt_dragon`, `mythosaur`) may take ≤ 20k tris and
a 2048² set. The mudhorn's wool and the mamacore's barbels should be card/shell
geometry, not fur systems.

| Id | Board | Size | Rig nodes (gameplay in **bold**) | Constraints |
|---|---|---|---|---|
| `mudhorn` | Waystation | 2.6 m shoulder, 4.5 m long | `head, jaw, horn,` **`nape`**`, legFL/FR/BL/BR, tail1..2` | Shaggy matted wool as shell/card geometry; the horn is its weapon, so give it real length (~1 m) and a worn tip; **nape** sits under the horn boss, exposed when the head is down. |
| `ravinak` | Crevasse | 8 m long, ~2.6 m at the back | `head, jaw, tuskL/R,` **`throat`**`, flipperFL/FR/BL/BR, body1..3, tail` | Belly kept smooth for its beached slide; **throat** is a pale soft panel readable from the front; back plates barnacled, not clean. |
| `mamacore` | Trask | 12 m long | `head, jaw,` **`belly, gills1..3`**`, body1..5, finL/R, tailFin` | Mouth interior modelled (the camera will see down it during breaches); **gills** are three distinct emissive frill rows per flank pair; hide reads wet. |
| `rancor` | Nevarro | 5 m tall | `head, jaw,` **`skullSoft`**`, spine1..2, upperArmL/R, forearmL/R, handL/R, upperLegL/R, lowerLegL/R, tail1..2` | Own rig even though biped — the arms outreach the legs and the canonical rig fits none of it; hands need spread-finger geometry (it grabs); **skullSoft** is behind the jaw hinge. |
| `krayt_dragon` | Dune Sea | front 18 m of ~40 m; skull ~4 m wide | `head, jaw,` **`gullet`**`, collar, neck1..4, clawL/R, body1..6` | Model the forebody only — `body6` tapers to a clean sand-sleeve cut, never seen; **gullet** is an emissive throat mesh visible only through the open jaw; mouth interior modelled deep. |
| `mythosaur` | Great Forge | visible 12 m (head, neck, claws) | `head, jaw, hornL/R,` **`eyeL/R, vents1..2`**`, neck1..4, clawL/R, back` | Must match the delivered `mythosaur_skull` sculpt (horn sweep, tusked jaw) — it is the same animal alive; `back` ends at the waterline in a clean cut; horns/skull are deflect armor, so make them read as plate; **eyes** and **vents** emissive. |

Delivery as ever: `public/models/<id>.glb`, picked up automatically once the
gameplay round wires `loadCreature(id)`; sheets to `reference/characters/`.

## Environment & hazard models — priority by impact

**Every model on this page is delivered and integrated** (2026-08-29). The
priority-1 and 2 set landed first — `cargo_crate`, `fuel_barrel`, `trawler`, `tram`,
`sail_barge`, `freighter`, `cargo_crane`, `reactor_core`, `sunken_transport` — and the
rest followed the same day: `adobe_tower`, `adobe_gate`, `forge_brazier`,
`survey_crawler`, the priority-3 dressing (`vaporator`, `tusken_tent`,
`alarm_console`, `street_kiosk`, `dock_shed`, `homestead_dome`, `mythosaur_skull`),
the ambient-pass set (`bantha`, `sandcrawler`, `pipe_rack`, `fish_rack`) and the three
vehicles (`speeder_bike`, `landspeeder`, `skiff`). Each hides its procedural stand-in
the moment it loads and keeps it as the fallback. **Nothing on the model side is
open.**

Opened 2026-08-29 by an audit of all nine board modules (`src/world/*.ts`). Every
structure, vehicle and hazard in the game is procedural primitive geometry today — the
trawlers players ride on Trask are three boxes, the crashed sail barge is two — while
every character already wears an authored model, so the environments are now the gap.
The requests below are ranked by impact: **priority 1 is what players ride, shoot or
hide behind every match; priority 2 is the landmark each board is recognised by;
priority 3 is repeated set dressing.** Reference images for image-to-3D generation
(Tripo etc.) are requested in [`ASSETS_IMAGES.md`](ASSETS_IMAGES.md) and land in
`reference/props/`.

**Intake:** all of these are rigless props on the `loadProp()` path — placed and
scaled, no skeleton, no clips (a file that ships clips anyway will play them, per the
massiff rules). **Unlike the characters, none are wired yet:** each site needs a
one-call swap in its board module when the file lands — load the prop at the
procedural group's anchor, hide the procedural meshes, keep the physics. The collision
footprints below are already tuned and CI-audited (`tools/audit-collision.mjs`) and
**do not change with the model**, so a model must read solid where its collider is and
open where it is not; the sizes given are the envelope to fill.

Six sculpts earned an exception, each because the collider was only ever a box drawn
around a procedural stand-in and the art disagreed with it in a way players would feel:
the **tram** stands 3.78 m to a roof people ride on; the **freighter** spans 10 m
across wings you would otherwise walk through; the **survey crawler** is a 8.9 m
machine, not the low 3.4 m box that stood in for it; the **dock shed** reaches 7.1 m to
its ridge; the **Tusken tents** are 5.2 m across and taper, so they took stacked discs
instead of one narrow box; and the **gate** needed pylons of its own, since the lintel's
collider only ever covered the span above them. Every box was refitted to the sculpt and
all nine boards still audit clean in both directions. Everything else fits the shape it
was given.

**Budgets:** landmarks (⚓) ≤ 10k tris, one 1024² PBR set (baseColor / metal-rough /
normal, emissive where noted); mid-size props ≤ 4k tris / 512²; small repeated props
≤ 1.5k tris / 512². Marked ✷ = a breakable the game removes whole on destruction —
model it as one object with no parts that should outlive it. Style per the character
sheets: stylized-realistic, weathered and used, silhouette readable at 30 m, original
fan designs only.

### Priority 1 — ridden, shot at, or hidden behind every match

| Id | Board(s) | Size | Replaces / constraints |
|---|---|---|---|
| `trawler` ⚓ ✅ | Trask ×2 | 16 m hull, 7 m beam | The two heaving movers players fight on all match — today a box hull, wedge bow, box deckhouse. Flat working deck across the 7×16 m collider top; deckhouse within 4.5 w × 2.6 h × 4 d at local (0, +2.2, −4.5); mast at (0, +4, +1); bow may reach z +7.4. Deck must stay clean enough to fight on. |
| `tram` ⚓ ✅ | Ringworld | 12.2 m long, 3.4 w × 2.6 h | The rideable armored monorail sweeping the whole street. Body + wedge nose fill the 3.4×2.6×12.2 collider; the roof is where riders stand, so it is flat and walkable; side stripe lights read at 16 m/s. |
| `sail_barge` ⚓ ✅ | Dune Sea | ~26 m, listing | The signature cover playground — today two boxes. Hull silhouette follows the audited row of r 4.4 m colliders along its axis, deck top standable; leaning broken mast + torn sail vane within the three stacked sail boxes. Half-buried, scoured, stripped. |
| `cargo_crate` ✅ | Waystation, Trask, Refinery, Prison Rig (~50 instances) | 2.3–2.6 m cube (scaled per site) | The universal cover box both the enemy AI and the player's snap-to-cover press against — point-blank screen time all game. Cube envelope, recessed X-braced faces in the delivered `crate_side` style, corner lift lugs. Second clean-white texture set for the Prison Rig's containers. |
| `fuel_barrel` ✷ ✅ | Waystation ×8, Refinery ×13 | 1.2 Ø × 1.7 m | One sculpt, two skins: plain steel (station cover, `barrel.jpg` style) and **rhydonium** — hazard-yellow band and a glowing amber fill slit (emissive), because on the Refinery these chain-explode and the read *is* the mechanic. Bake the band into the rhydonium skin. |

### Priority 2 — the landmark each board is recognised by

| Id | Board(s) | Size | Replaces / constraints |
|---|---|---|---|
| `freighter` ⚓ ✅ | Waystation | ~11 m parked | The parked light freighter on the landing pad — today a cylinder, a sphere and two box wings. Fills the 8×4×6 collider plus the cockpit blister (r 1.5) at the nose; landing skids down, boarding ramp lowered, chipped off-white hull. |
| `cargo_crane` ⚓ ✅ | Waystation ×3 | 18 m mast, 20 m arm | Mid-airspace landmarks the jetpack weaves through. Mast on the r 0.85 collider; arm along the audited collider row at +17 m; cable trolley with a hanging cargo container filling the 2.4 m cube collider near deck level. The cable itself stays intangible. |
| `reactor_core` ⚓ ✅ | Refinery | 40 m column, r 5.5→4.5 taper | The board's centrepiece chimney. Segmented industrial column wrapped in pipes and ring flanges, tall emissive orange coolant channels up its height (the additive glow shell stays game FX). Must respect the stacked tapering colliders. |
| `sunken_transport` ⚓ ✅ | Prison Rig | ~15 × 9 × 28 m | The swim-through wreck. Twin parallel hull sections under a roof plate with the **open corridor between them kept swimmable** (≥ 2.5 m — the colliders already leave it open), blunt collapsed nose, torn openings at both ends, silt-streaked. |
| `adobe_tower` ✅ | Nevarro ×2 | 11 m tall | The gate watchtowers flanking the town gate anchor. Tapering round adobe tower on the r 3.6 collider, covered lookout top. The 26 m wall runs stay procedural under the delivered `adobe_wall` texture. |
| `adobe_gate` ✅ | Nevarro | 12 m span | The gate arch between the towers: two pylons + lintel filling the 12 × 2.4 m lintel collider at +7.6 m, gate leaves standing open. |
| `forge_brazier` ✅ | Great Forge | ~3.5 m wide | The thematic heart of Mandalore — today a bare cylinder on the dais. Ceremonial forge basin with built-in anvil horn, glowing embers (emissive), blackened iron with worn silver inlay. Sits on the existing procedural dais over the r 1.6 collider. |
| `survey_crawler` ✅ | Crevasse | 10 × 3.4 × 5 m | The wrecked expedition vehicle the north-rim shooters fight around. Tracked cabin listing 0.18 rad within its box collider, bent sensor mast, doors ajar, frost-scoured grey-blue. |

### Priority 3 — repeated set dressing

| Id | Board(s) | Size | Replaces / constraints |
|---|---|---|---|
| `vaporator` ✅ | Dune Sea ×4 | 7 m | The moisture farm's icon — today a pole and three box rings. Slim tapering column with stacked condenser vanes, within the 1.2 m square collider footprint. |
| `tusken_tent` ✅ | Dune Sea ×5 | 5.2 Ø × 3.6 m | Camp tents — today bare textured cones. Hide-and-pole cone, stitched panels, trophies at the flap. |
| `alarm_console` ✷ ✅ | Refinery ×4 | 2.4 × 2.6 × 0.8 m | The shoot-this-to-stop-the-alarm cabinet. Angled console with screen and conduit; **the blinking red beacon above it stays a game mesh** — model the cabinet only. |
| `street_kiosk` ✅ | Ringworld ×8 | 3.2 × 2.4 × 3.2 m | Mid-street cover. Shuttered vendor stall with awning and an emissive holo-menu panel. |
| `dock_shed` ✅ | Trask | 10 × 4.5 × 7 m | The harbour-master's shed on the quay: corrugated walls, portholes, stove pipe, ropes and floats. |
| `homestead_dome` ✅ | Dune Sea | 10 m Ø | The moisture-farm dome. Keep it a smooth dome — the collider is two stacked discs following that curve — with an entry vestibule, hatch and vent stacks. |
| `mythosaur_skull` ✅ | Great Forge | ~8 m | **New landmark, no procedural stand-in:** a half-buried horned leviathan skull at the rim of the Living Waters, paying off the eye-glow-and-call event that already plays there. Placement and collider are added at integration. |

### Ambient life & backdrop — the atmosphere pass

Assets for the seven planned features in `PLAN.md` §16 (sky traffic, the working
landing pad, banthas, the horizon sandcrawler, refinery pipes & steam, quay dressing,
the ringworld skyline). The sky traffic and the landing freighter **reuse the
`freighter` model above** — no new ship is requested; the skyline and the quay nets
are textures (see `ASSETS_IMAGES.md`), not models. That leaves four:

| Id | Board | Size | Role / constraints |
|---|---|---|---|
| `bantha` ◆ ✅ | Dune Sea ×2–3 | 2.5 m shoulder, ~4.5 m long | Ambient grazers at the Tusken camp — the one creature in this batch, through `loadCreature` like the massiff: own quadruped rig, gait authored in code, so keep named nodes `head`, `jaw`, `legFL/FR/BL/BR`, `tail1..3`. Long shaggy wool, great spiral horns, a woven saddle (they are the camp's livestock). ≤ 8k tris, one 1024² PBR set. |
| `sandcrawler` ⚓ ✅ | Dune Sea | ~35 m long | Horizon landmark on the rim slope, reachable on foot: towering rusted slab-sided hull, angled prow with a sealed full-width ramp, continuous tracks, rows of tiny emissive portholes high on the hull. Solid — simple hull colliders added at integration. ≤ 10k tris, 1024² + emissive. |
| `pipe_rack` ✅ | Refinery | ~6 m modular segment | Upgrades the big manifold by the reactor; the rest of the pipe runs stay procedural cylinders. Four mixed-diameter pipes on a wall rack, flange joints, one elbow branch to a valve wheel. Designed to tile end-to-end. ≤ 2k tris, 512². |
| `fish_rack` ✅ | Trask ×2–3 | ~2 m tall | Quay dressing that doubles as thin cover — the only new solid on the board, with a thin box collider entering the cover system. A-frame strung with drying split fish, hooks, a gutting bench at one end. Single object. ≤ 1.5k tris, 512². |

### Pilotable vehicles (PLAN.md §17)

**The system is live** (implemented 2026-08-29): every kind below is parked on its
boards with a procedural stand-in, and the loader is already pointed at these ids —
each model replaces its stand-in the moment the file lands, exactly like the
characters. Player-drivable rides through the same `loadProp` path as the swoop bike. The rider is
the player character seated by the game's own ride clips, so **model the vehicle empty**:
an open saddle or seat with nothing in it, controls (bars, wheel, tiller) placed where
seated hands reach. Origin at the resting ground point, +Z forward. The **swoop is not
requested** — the delivered `nikto_swoop.glb` is reused as a parked, stealable ride.

| Id | Size | Feel / constraints |
|---|---|---|
| `speeder_bike` ✅ | ~3 m long | Military scout repulsor bike: long forward outrigger vanes, saddle over a compact engine block, steering vanes at the nose, footrests. Fastest and most fragile ride. ≤ 3k tris, 512². |
| `landspeeder` ✅ | ~4.5 m long | Open-top civilian sand speeder: rounded weathered body, single open seat, low windshield, three engine nacelles at the tail. ≤ 4k tris, 512². |
| `skiff` ✅ | ~9 m long | Repulsor cargo skiff: flat open deck with low rails, a tiller platform at the stern, lashed cargo at the bow. The deck is walkable and the collider footprint is the deck, so keep it flat and clear amidships. ≤ 5k tris, 512². |

## Delivery & integration

Drop files at `public/models/<id>.glb`. **Delivered and integrated:** every character that
existed before the new boards — `din, paz, bokatan, armorer, marshal, fennec, ig11, tusken,
pyke, nikto, pirate, pirate_melee, droid, stormtrooper, deathtrooper, darktrooper, duelist,
imperial_officer, pyke_capo, wookiee_enforcer`, plus the props `carbine, gaffi,
nikto_swoop` and the creature `massiff` / `massiff_static`, plus the new-board trio
`flametrooper`, `quarren`, `alamite`. **Every character requested is delivered and
integrated** — the last batch (`ring_enforcer`, `krykna`, `krykna_brood`,
`interceptor_drone`, and the playable hunters `ventress`, `embo`, `bossk`) landed on
2026-08-28; the fourth hunter, the blue gunslinger, reuses the delivered `duelist.glb`,
and the fifth, IG-11, reuses `ig11.glb`. **The environment batch above is delivered and
wired too**, along with the weapon props `saber_curved`, `crossbow` and `longrifle`.
Open on the model side: `pistol` alone — the game keeps its procedural pistols until it
lands, and a character who carries a pair needs only the one file, since the off-hand is
a second instance of the same .glb.**

### Three intake paths

| Model | Path | What drives it |
|---|---|---|
| Characters on the canonical humanoid rig | `attachAuthored()` | our clips, through the retargeter |
| Weapons, vehicles — no rig | `loadProp()` | nothing; placed and scaled, carried by its holder |
| Creatures on a rig of their own | `loadCreature()` | clips authored in code against that rig |

**The massiff is the third case.** It is a quadruped: 44 deform bones, four legs and a
tail, so `BONE_MAP` reaches none of it and no humanoid clip means anything to it. It comes
in through `loadCreature('massiff')`, which places and scales the model (1.15 m at the
shoulder, 2.5 m long) and grounds it. `massiff_static` is the unrigged variant of the same
sculpt.

Its gait is authored in code, in `src/anim/quadruped.ts`. Two differences from `clips.ts`
matter to anyone touching it: this skeleton has **real rest rotations baked in**, so every
value is `rest * delta` and the clips are built once the model is loaded and its rest pose
can be read; and every bone runs along its local **+Y**, so a rotation about local X swings
a limb fore and aft, positive being backward. A leg holds its rest height through the
stance half of the cycle and only lifts during the swing half — nothing raises the body, so
a leg that stays bent leaves the animal prancing above the ground it should be pushing off.

**Clips shipped in a `.glb` always win.** `GENERATED_CLIPS` in `authored.ts` is consulted
only when the file carries none, so re-exporting `massiff.glb` with real animation baked in
replaces this with no code change — the loader hands whatever it finds to the same mixer.
Name them to match: something matching `/idle|breath|stand/` and something matching
`/run|gallop|sprint/` or `/walk|trot|move/`.

The id is the filename, and it is not always the character's internal id — the Imperial
officer is the enemy kind `officer` but the file `imperial_officer.glb`, and the melee pirate
is the kind `pirateMelee` but the file `pirate_melee.glb`. The mapping lives in
`AUTHORED_ENEMY` in `src/characters/enemies.ts`.

**The loader is live** (`src/characters/authored.ts`). A model is picked up automatically
when the file appears; when it is absent the procedural build stands, exactly like the
texture and audio pipelines. Every character in the game ships with an authored model
today — wiring a new one up is one call to `loadAuthored(id, height)` in its factory.

What the loader accepts, learned from the first two drops:

| Requirement | Why |
|---|---|
| One skinned mesh, `DEF-*` Rigify bone names | the bone map in `authored.ts` keys off them |
| Any rest pose (A-pose is fine) | mapped bones are pulled onto the canonical rest before animating |
| Flat or nested skeleton | chain roots are re-parented into our hierarchy on load, preserving world rest transforms |
| Any scale, feet at any origin | measured and normalised to the character's game height |
| `EXT_meshopt_compression`, `KHR_mesh_quantization`, `KHR_texture_transform` | all supported |
| No animation clips needed | the game's clips drive the model through the retargeter |

Models are PBR-lit: metallic-roughness maps work, and the scene carries a reflection probe
built from the board's sky so metal has something to catch. Inspect any of it in the
**model workbench** at `/workbench/?edit=models` — every game clip, on any character, with
the authored model and the procedural build side by side. Its *edit mode* freezes the pose,
draws the rig as clickable joints and rotates them with an on-screen gizmo (local, world or
camera-relative rings, Shift to snap). Edits are written into the clips, so leaving edit mode
plays the animation back with them, they undo and redo, and one export carries the whole
session as JSON in the same units `src/anim/clips.ts` is written in — the way to correct a
clip against a real model.

Order of work for anything new: reference sheets (`ASSETS_IMAGES.md`) → model → loader.
The sheets are the blocking input, and a playable character sets the art direction for
everything around it, so it goes first. Nothing in this document is currently waiting on
that pipeline.

## Game-mode props — requested 2026-08-29 (the `?modes` build)

Rigless props through `loadProp`, procedural stand-ins shipping in
`src/world/corridor.ts` until the files land. Reference-sheet recipe as above.

| Id | Prompt |
|---|---|
| `blast_door` ▣ | "a heavy sci-fi blast door in its frame, about 3.5 meters tall: two interlocking armored leaves with a chevron seam, a riveted gunmetal frame with hazard striping on the lintel, hydraulic rams at the jambs, amber status lamp above" |
| `corridor_crate` | "a squat armored supply crate about 1.6 meters wide: reinforced corner caps, recessed side handles, stenciled panels worn to bare metal on the edges — chest-high cover, readable from behind" |

The campaign bosses (docs/MODES.md §4a) are **promoted existing elites** by design —
no new sculpts for *them*. The expansion that outgrows that rule now exists: the six
[monster bosses](#monster-bosses--open-2026-08-29) above are the unique boss models,
requested 2026-08-29 with their design doc (`docs/BOSSES.md`).
