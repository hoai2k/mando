# Asset Requests — 3D Character Models

**Every character in this document has been delivered and integrated.** What follows is the standing brief — the swap contract, the design of each character, and the budgets — kept so a model can be re-exported or replaced on-style. Anything still open is called out where it appears; as of 2026-08-29 that is nothing on the character side. An authored glTF (.glb) replaces any character **without touching gameplay code** via the swap contract; where a file is absent the procedural stand-in still stands.

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
| **Kell Dravan** | `din` — `din_front/side/back.png` | Polished bare-silver beskar cuirass and helmet (no rangefinder), brown flight suit and cape, cheek-ridged helmet, slim jetpack. |
| **Torva Brekk** | `paz` — `paz_front/side/back.png` | Heavy dark-blue plate, oversized pauldrons and chest, reinforced helmet crest, broadest silhouette (normalised to 1.67 m, bulk 1.16, width-only broad 1.08 — never scale y, or limbs stretch as they swing). |
| **Vess Ordane** | `bokatan` — `bokatan_front/side/back.png` | Blue-and-red plate, rangefinder helmet, lighter build (scale ~0.95). |
| **The Forgemistress** | `armorer` — `armorer_front/side/back.png` | Gold plate over dark underlayers, horned forge-keeper helm, cape. |

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
the **blue-skinned gunslinger** on 2026-08-29, who is playable as Rook Vance from the
delivered `duelist.glb` and its sheets as-is. He is also the `duelist` enemy kind on the
Ringworld's final wave: the same sculpt on both sides, which is deliberate. An optional
re-export at playable budget can come later if the 8k boss version reads poorly up close.
The fifth of the family, **VX-9**, rides the delivered ally droid model (`ig11.glb`) on
the canonical rig, so it needed no new sculpt.

| Character | Id / reference sheets | Height | Reference look |
|---|---|---|---|
| **Rook Vance** | `duelist` — `duelist_front/side/back.png` | 1.90 m | Gaunt blue-skinned alien gunfighter: red eyes, breathing tubes to the temples, wide-brimmed hat, long coat, twin pistols — one in each hand, on both weapon mounts. |
| **Sylla Morvane** | `ventress` — `ventress_front/side/back.png` | 1.79 m | Bald ash-grey female assassin, dark scalp markings, sleeveless grey-black bodysuit with split skirt panel, two curved sword hilts crossed at the back of the belt (hilts only — blades are FX meshes, like the dark saber). |
| **Karshii** | `embo` — `embo_front/side/back.png` | 1.78 m | Olive-green alien behind a slatted rebreather mask, very wide flat woven-metal hat (model it as a distinct mesh under the `head` bone — it may become a gameplay prop later), fur-trimmed poncho over banded armor. |
| **Skarvek** | `bossk` — `bossk_front/side/back.png` | 1.90 m | Hulking yellow-green scaled reptilian, wedge snout and needle teeth, clawed hands and feet, rolled-sleeve tan flight suit with chest rig and bandoliers. Bulkiest of the set (scale ~1.08). |
| **VX-9** | `ig11` — `ig11_front/side/back.png` | 2.20 m | The ally assassin droid, playable: cylindrical red-ringed head, exposed piston limbs. Wears no jetpack — flight flames mount under the foot bones instead (`thrusters: 'feet'` in the roster config), so a re-export must not add a pack. |

Integration note: all five are roster entries in `src/characters/mandalorians.ts`, each
carrying its authored model and its signature weapon — twin red curved-hilt sabers
(Sylla), laser crossbow (Karshii), long rifle (Skarvek and VX-9), twin heavy pistols
(Rook). Paired weapons mount on `weaponR` and `weaponL`; an authored model exposes both
mounts, so an off-hand weapon sits in the model's other hand rather than beside the body.

**The signature weapons themselves stay procedural — this is a decision, not a gap.**
Three weapon props were requested as models — `saber_curved`, `crossbow`, `longrifle` —
and their side-view sheets were delivered (`reference/characters/`), but the .glbs are
**parked as of 2026-08-29**: the procedurally built weapons read well at gameplay distance
and nothing is blocked on a file. `pistol`, added later for Rook Vance, is parked with
them. If that is revisited, the brief is unchanged — one .glb per weapon on the standard
`loadProp()` path, gripped at origin, and a character carrying a pair needs only one
file, since the off-hand is a second instance of it.

## Allies — priority 2

| Character | Type | Reference sheets | Reference look |
|---|---|---|---|
| **VX-9** (`ig11`) | `ig11_front/side/back.png` | ranged ally — also playable, above | Tall spindly assassin droid, cylindrical head with red sensor ring, exposed piston limbs (~2.2 m). |
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

## Delivery & integration

Drop files at `public/models/<id>.glb`. **Delivered and integrated:** every character that
existed before the new boards — `din, paz, bokatan, armorer, marshal, fennec, ig11, tusken,
pyke, nikto, pirate, pirate_melee, droid, stormtrooper, deathtrooper, darktrooper, duelist,
imperial_officer, pyke_capo, wookiee_enforcer`, plus the props `carbine, gaffi,
nikto_swoop` and the creature `massiff` / `massiff_static`, plus the new-board trio
`flametrooper`, `quarren`, `alamite`. **Everything requested is delivered, and nothing is open.** The last batch
(`ring_enforcer`, `krykna`, `krykna_brood`, `interceptor_drone`, and the playable hunters
`ventress`, `embo`, `bossk`) landed on 2026-08-28 and is integrated; the fourth hunter,
the blue gunslinger, reuses the delivered `duelist.glb`, and the fifth, VX-9, reuses
`ig11.glb`. The signature-weapon props (`saber_curved`, `crossbow`, `longrifle`, and `pistol` after
them) were the only outstanding items and are **parked by decision** — the game keeps its
procedural versions for now, as described under the hunters above.**

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
