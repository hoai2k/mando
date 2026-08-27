# Asset Requests — 3D Character Models

Every character below runs today as a procedural stand-in. An authored glTF (.glb) can replace any of them **without touching gameplay code** via the swap contract.

## Swap contract (applies to every biped)

- Skeleton node names must match the canonical rig in `src/anim/skeleton.ts`:
  `hips, spine, chest, neck, head, shoulderL/R, upperArmL/R, forearmL/R, handL/R, upperLegL/R, lowerLegL/R, footL/R` plus attachment points `weaponR, weaponL, jetpack, capeRoot`.
- Origin at the feet, +Z facing forward, real-world scale (heads ~1.7–2.2 m tall as noted).
- Rest pose: relaxed A-pose matching the procedural proportions (`HUMAN` in skeleton.ts) so our procedural clips read correctly; authored clips may ship in the file and will be preferred if present.
- **Visual reference: model from the A-pose turnaround sheets, not from the prose below.** Each character's `_front` / `_side` / `_back` sheets are requested in [`ASSETS_IMAGES.md`](ASSETS_IMAGES.md) and land at `reference/characters/<id>_front.png` etc. The prose here is a summary of the same design — where they disagree, the sheet wins. Heights are specified alongside the sheets so relative scale survives into the models.
- Budgets: ≤ 15k tris playable characters, ≤ 8k tris grunts, ≤ 4k tris critters/props; one 1024² (playables) or 512² (grunts) PBR texture set (baseColor/metal-rough/normal).
- Non-biped characters (marked ◆) use their own free-form rig — animation is procedural code, so any node layout is fine; keep the listed named nodes if possible.
- Style target: stylized-realistic, weathered and used; silhouettes must read at 30 m. Original fan interpretations — no scans/rips of commercial assets.

## Playable Mandalorians (5) — priority 1

All share the rig, jetpack mount (`jetpack` bone), and weapon mounts (`weaponR`). Each needs: armored body, distinct helmet, jetpack variant, optional cape on `capeRoot`.

| Character | Reference sheets (`reference/characters/`) | Reference look |
|---|---|---|
| **Boba Fett** | `boba_front/side/back.png` | Weathered green beskar, maroon helmet accents and pauldrons, dented dome, T-visor, rangefinder stalk, Z-6 style jetpack with rocket tip, short half-cape. |
| **Din Djarin** | `din_front/side/back.png` | Polished bare-silver beskar cuirass and helmet (no rangefinder), brown flight suit and cape, cheek-ridged helmet, slim jetpack. |
| **Bo-Katan Kryze** | `bokatan_front/side/back.png` | Blue-grey Nite Owl armor, owl-crest helmet fins, no cape, lighter frame. |
| **Paz Vizsla** | `paz_front/side/back.png` | Heavy dark-blue plate, oversized pauldrons and chest, reinforced helmet crest, bulkiest silhouette (scale ~1.12). |
| **The Armorer** | `armorer_front/side/back.png` | Gilded horned helmet, dark leather apron armor, fur mantle across the shoulders, no cape. |

Shared weapon props (separate .glb each, gripped at origin): **EE-3-style carbine** (muzzle node at barrel tip named `muzzle`, reference `carbine.png`), **gaffi stick** (two-handed staff: spearhead + club knot + bottom blade, reference `gaffi.png`).

## Allies — priority 2

| Character | Type | Reference sheets | Reference look |
|---|---|---|---|
| **Grogu in hover-pram** ◆ | cosmetic companion | `grogu_front/side/back.png`, `grogu_creature_front.png` | Small green big-eared child in a floating silver egg-shaped pram, brown robe; nodes: `pram`, `head`. |
| **IG-11** | `ig11_front/side/back.png` | ranged ally | Tall spindly assassin droid, cylindrical head with red sensor ring, exposed piston limbs (~2.2 m). |
| **The Marshal** | `marshal_front/side/back.png` | ranged ally | Human gunfighter, red-brown duster coat, wide-brim hat, weathered desert lawman. |
| **Fennec Shand** | `fennec_front/side/back.png` | sniper ally | Sleek dark body armor, helmet cap with orange visor band, long rifle. |

## Enemies — priority 2 (grunts) / 3 (elites)

| Character | Board | Reference sheets | Reference look |
|---|---|---|---|
| **Tusken Raider** | `tusken_front/side/back.png` | desert | Sand-colored wrapped robes, bandolier, cylinder-eyed mask with rebreather spikes, gaderffii stick. |
| **Nikto swoop rider** ◆ | desert | `nikto_front/side/back.png`, `nikto_swoop_front/side/back.png` | Horned leathery-faced alien in biker leathers riding a long-nosed swoop bike; nodes: `bike`, rider on canonical rig welded to seat. |
| **Pyke soldier** | `pyke_front/side/back.png` | both | Tall tapered grey-green helmet with narrow eyes, breather tubes to chest rig, slate long coat, rifle. |
| **Space pirate (ranged & brawler)** | `pirate_front/side/back.png` | station | Ragged spacer leathers, mismatched plates, one metal pauldron, horn-nubbed alien head; brawler variant carries a heavy club. |
| **8D8-style security droid** | `droid_front/side/back.png` | both | Bone-white skeletal frame droid, elongated skull, red eyes (~2.1 m). |
| **Stormtrooper (remnant)** | `stormtrooper_front/side/back.png` | both | Classic white trooper plate gone grimy — scuffed, sand-dusted, mismatched repairs; black visor band. |
| **Death trooper** | `deathtrooper_front/side/back.png` | both | All-black elite trooper armor, taller (~2.0 m), matte with subtle green lens glow. |
| **Dark trooper** | both | `darktrooper_front/side/back.png` | Heavy jet-black humanoid battle droid (~2.2 m), skull-faced with red eyes, integrated back thrusters; uses canonical rig + `jetpack` node. |

## Bosses — priority 4 (planned, not yet in game)

| Character | Reference sheets | Reference look |
|---|---|---|
| **Krrsantan-class Wookiee enforcer** | `wookiee_enforcer_front/side/back.png` | Towering black-furred Wookiee gladiator (~2.6 m), chest bandolier, fighting gauntlets. |
| **Pyke capo** | `pyke_capo_front/side/back.png` | Ornate Pyke in embroidered robes with personal shield generator effect. |
| **Moff-class Imperial officer w/ dark saber** | `imperial_officer_front/side/back.png` | Black Imperial officer greatcoat, slicked silhouette, glowing black-white blade (blade is an FX mesh). |
| **Cad Bane-class duelist** | `duelist_front/side/back.png` | Blue-skinned gunslinger, wide-brim hat, breathing tubes, twin pistols. |

## Delivery & integration

Drop files at `public/assets/models/<id>.glb` using ids: `boba, din, bokatan, paz, armorer, grogu, ig11, marshal, fennec, tusken, nikto, pyke, pirate, pirate_melee, droid, stormtrooper, deathtrooper, darktrooper, carbine, gaffi`. Loader integration (glTF detection + procedural fallback, mirroring the texture/audio pattern) is the next engineering task once the first model lands — register in `src/characters/builder.ts`.

Order of work: reference sheets (`ASSETS_IMAGES.md`) → models → loader. The sheets are the
blocking input; the five playable Mandalorians and the two shared weapons are priority 1
because they share one rig and set the art direction for everything else.
