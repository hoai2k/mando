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

## Playable Mandalorians (2) — priority 1

All share the rig, jetpack mount (`jetpack` bone), and weapon mounts (`weaponR`). Each needs: armored body, distinct helmet, jetpack variant, optional cape on `capeRoot`.

**Authored models for these two are being supplied**, so they are the first real test of
the swap contract. Other Mandalorians (Bo-Katan Kryze, The Armorer) were built
procedurally earlier and are now shelved — not in the game and not requested — but the
config-driven factory in `src/characters/mandalorians.ts` makes restoring any of them a
matter of re-adding one roster entry.

| Character | Reference sheets (`reference/characters/`) | Reference look |
|---|---|---|
| **Din Djarin** | `din_front/side/back.png` | Polished bare-silver beskar cuirass and helmet (no rangefinder), brown flight suit and cape, cheek-ridged helmet, slim jetpack. |
| **Paz Vizsla** | `paz_front/side/back.png` | Heavy dark-blue plate, oversized pauldrons and chest, reinforced helmet crest, bulkiest silhouette (scale ~1.12). |

Shared weapon props (separate .glb each, gripped at origin): **EE-3-style carbine** (muzzle node at barrel tip named `muzzle`, reference `carbine.png`), **gaffi stick** (two-handed staff: spearhead + club knot + bottom blade, reference `gaffi.png`).

## Allies — priority 2

| Character | Type | Reference sheets | Reference look |
|---|---|---|---|
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

Drop files at `public/models/<id>.glb` using ids: `din, paz, ig11, marshal, fennec, tusken, nikto, pyke, pirate, pirate_melee, droid, stormtrooper, deathtrooper, darktrooper, carbine, gaffi`.

**The loader is live** (`src/characters/authored.ts`). A model is picked up automatically
when the file appears; when it is absent the procedural build stands, exactly like the
texture and audio pipelines. Din Djarin and Paz Vizsla ship with authored models today —
wiring a new character up is one call to `loadAuthored(id, height)` in its factory.

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
camera-relative rings, Shift to snap), then exports the changed bones as JSON in the same
units `src/anim/clips.ts` is written in — the way to correct a clip against a real model.

Order of work: reference sheets (`ASSETS_IMAGES.md`) → models → loader. The sheets are the
blocking input; the five playable Mandalorians and the two shared weapons are priority 1
because they share one rig and set the art direction for everything else.
