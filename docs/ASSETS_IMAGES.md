# Asset Requests — Images & Textures

**Open image requests only.** Delivered images are recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md) with their original prompts — all 15 environment,
sky and UI textures are done and integrated, so nothing on that list needs making again.

Every image request for the project belongs in this file; once delivered it moves to the
history doc, and anything it feeds (such as the 3D model briefs) references the resulting
filenames from there.

**Global specs unless noted:** sRGB, no baked lighting or shadows (lighting is dynamic), no
text or watermarks, no logos, and no reproductions of copyrighted designs — describe the
design, never name a trademarked character or film frame.

Runtime textures land in `public/assets/textures/` and the loader tries `.jpg` then `.png`.
Production-only reference art (below) lives in `reference/` and is **not** shipped.

## Character reference sheets (A-pose turnarounds)

These are the canonical visual reference for every authored 3D character in
[`ASSETS_MODELS.md`](ASSETS_MODELS.md) — they drive image-to-3D generators (Meshy, Tripo,
Rodin, Hunyuan3D) and hand modelling alike. Model from these, not from prose.

**Location: `reference/characters/` — NOT under `public/`.** These are production inputs,
not runtime assets; anything in `public/` is copied into `dist/` and deployed to the live
site, and ~60 full-res PNGs would bloat it for no gain.

**Files:** `<id>_front.png`, `<id>_side.png`, `<id>_back.png` per character, 1024×1536 PNG,
same canvas for all three views so scale stays comparable. Ids match the model doc.

**Shared preamble — prepend verbatim to every character prompt below:**

> Full-body character reference sheet, single figure, relaxed A-pose: arms straight and
> angled about 45 degrees down from the shoulders, palms facing down, legs straight and
> shoulder-width apart, feet flat and parallel, head level facing forward, perfectly
> bilaterally symmetrical, hands empty. Orthographic **front** view, no perspective
> distortion. Flat even neutral lighting, no cast shadows, no rim light, no coloured gels.
> Plain mid-grey background. Whole body in frame head to feet with a small margin.
> Stylized-realistic video-game character art, clean readable silhouette. No text, no
> watermark, no logos. Subject:

For `_side` swap in "Orthographic **true left-side profile** view, identical figure, pose
and scale"; for `_back`, "Orthographic **rear** view, identical figure, pose and scale."

**Working notes.** Generate `_front` first and feed it back as the style anchor for side and
back if the tool supports image-to-image, or the three views won't agree. Keep every
humanoid at the same pixel height per the Height column so relative scale survives into the
models. Descriptions are deliberately written as *designs*, never as named characters —
same rule as the audio prompts — which keeps output original and on-style.

### Playable Mandalorians — priority 1

Shared armour language matters more here than anywhere else: these five use one rig and
must read as one family. Generate `mandalorian_lineup.png` (2048×1024) **first** and use it
as the style anchor for all five individual sheets.

> `mandalorian_lineup.png`: "Five armoured warriors standing side by side in a row, all in
> relaxed A-pose, full body, orthographic front view, flat even lighting, plain mid-grey
> background, identical scale and a shared armour design language: (1) battle-worn
> sage-green plate with dark maroon accents and a small helmet rangefinder stalk;
> (2) polished bare silver plate with a long brown cape; (3) slate blue-grey plate with two
> swept-back angular helmet crest fins; (4) a very large heavy trooper in deep navy plate
> with oversized squared pauldrons; (5) dark bronze armour with a gold horned helmet and a
> brown fur shoulder mantle. Each wears a narrow T-shaped visor helmet."

| id | Height | Subject |
|---|---|---|
| `boba` | 1.8 m | "a bounty hunter in battle-worn beskar-style plate armour, dull sage-green plates with dark maroon-red helmet accents, pauldrons and gauntlets, a dented domed helmet with a narrow T-shaped visor, a small silver rangefinder stalk hinged at the right temple, a jetpack with twin cylindrical tanks and a central rocket, a short weathered brown-grey half-cape over the left shoulder, sand-scoured and scratched" |
| `din` | 1.8 m | "a bounty hunter in polished bare silver beskar-style plate armour, unpainted mirror-bright plates, a smooth domed helmet with a narrow T-shaped visor and raised cheek ridges, no rangefinder, brown leather flight suit sleeves and gloves, a long weathered brown wool cape, a slim compact jetpack, clean heroic silhouette" |
| `bokatan` | 1.75 m | "a female warrior in slate blue-grey plate armour with pale grey trim, a helmet with a narrow T-shaped visor and two swept-back angular crest fins like stylized owl feathers, no cape, a slim armoured flight suit, agile lighter build" |
| `paz` | 1.95 m | "a towering heavy-infantry warrior in deep navy-blue plate armour, oversized squared shoulder pauldrons, a reinforced helmet with a raised central crest ridge and a narrow T-shaped visor, thick armoured limbs, broad imposing silhouette" |
| `armorer` | 1.8 m | "a ceremonial armour-smith in dark bronze-brown armour with gold trim, a gleaming gold helmet with two long curved horns sweeping back from the temples and a narrow T-shaped visor, a thick brown fur mantle across the shoulders, a heavy leather work apron, smith's gloves" |

### Allies — priority 2

| id | Height | Subject |
|---|---|---|
| `ig11` | 2.2 m | "a tall gaunt humanoid assassin droid, weathered off-white and brass metal, a smooth vertical cylindrical head ringed near the top with small red photoreceptor lenses, thin exposed piston-and-cable limbs, narrow shoulders, spindly and unsettling" |
| `marshal` | 1.85 m | "a frontier lawman in a dusty red-brown leather duster coat over sand-worn work clothes, a wide-brimmed hat, a holstered blaster pistol at the hip, a weathered sun-beaten human face, desert gunslinger" |
| `fennec` | 1.85 m | "a lean female elite mercenary sharpshooter in fitted dark grey body armour, a slim helmet cap with a glowing amber-orange visor band across the eyes, a long rifle slung across the back, precise and composed" |
| `grogu` ◆ | 0.8 m | "a tiny green-skinned infant alien with very large dark round eyes and long drooping pointed ears, wearing a coarse beige robe, seated upright inside a floating silver egg-shaped hover-pram with an open front rim, curious gentle expression" |

◆ **Pose exception** — no A-pose. Pram floating level, creature seated upright facing
forward, front/side/back of the pram-plus-occupant. Add `grogu_creature_front.png`: the
creature alone, standing, arms out in a small A-pose, no pram.

### Enemies — priority 2 (grunts) / 3 (elites)

| id | Height | Subject |
|---|---|---|
| `tusken` | 1.8 m | "a desert nomad warrior wrapped head to toe in layered sand-coloured cloth bandages and robes, a mask with two short protruding cylindrical eyepieces and a central breathing tube flanked by two small spike vents, a leather bandolier across the chest, wrapped hands" |
| `pyke` | 2.0 m | "a tall thin alien gangster soldier, a very tall narrow tapered grey-green head rising to a rounded point with two small dark almond eyes set low on the face, thin breathing tubes running from the jaw to a chest rig, a long slate blue-grey coat, narrow sloping shoulders" |
| `pirate` | 1.9 m | "a rough alien space pirate, leathery tan-brown skin with a row of short blunt horns across the brow, mismatched scavenged armour plates over worn brown leathers, one battered metal shoulder pauldron, a utility harness" |
| `pirate_melee` | 1.9 m | "a heavy-built alien pirate brawler, leathery tan-brown skin with short blunt brow horns, thick armoured forearms and scavenged plate over worn leathers, one heavy metal pauldron, a club with a blunt metal head stowed across the back" |
| `droid` | 2.1 m | "a skeletal humanoid labour droid, bone-white and cream plating over exposed dark mechanical joints, an elongated narrow skull-like head with two small glowing red eyes, thin exposed limbs, industrial and worn" |
| `stormtrooper` | 1.9 m | "a soldier in scuffed grimy white segmented armour over a black bodysuit, a helmet with a dark horizontal visor band, angular cheek vents and a small central grille, sand-dusted and field-repaired with mismatched patched plates" |
| `deathtrooper` | 2.0 m | "an elite soldier in matte jet-black segmented armour over a black bodysuit, a smooth helmet with a dark visor band and a faint green lens glow, taller and heavier than a standard trooper, sleek and intimidating" |
| `darktrooper` | 2.2 m | "a heavy humanoid battle droid in matte black armoured plating, a blunt skull-like faceplate with two small glowing red eyes, thick armoured shoulders and limbs, integrated twin thrusters mounted on the back, brutal and mechanical" |
| `massiff` ◆ | 0.8 m | "a squat four-legged reptilian guard-hound, leathery tan-brown hide, a broad heavy jaw full of teeth, a row of short bony spikes down the spine, stubby powerful legs, a short thick tail" |
| `nikto` ◆ | 1.75 m | "a horned alien biker, leathery reddish-brown skin with a crown of short blunt horns across the brow, scuffed dark leather riding gear with a chest harness, lean and wiry" |
| `nikto_swoop` ◆ | 2.6 m long | "a long-nosed single-rider hover speeder bike, battered orange-brown and gunmetal plating, a long forward prow, a large rear engine housing with exhaust vents, low handlebars, no wheels" |

◆ **Pose exceptions** — `massiff`: standing square on all fours, neutral stance, head level.
`nikto`: rider in normal A-pose (he is welded to the bike in-engine, so the sheets stay
separate). `nikto_swoop`: vehicle, orthographic side/front/rear, no rider.

### Weapon props — priority 1 (shared by all five playables)

| id | Size | Subject |
|---|---|---|
| `carbine` | 1024×512 | "a compact sci-fi blaster carbine rifle, scuffed gunmetal grey and dark brown, a boxy receiver, a short ribbed barrel with a flared muzzle, a compact scope on top, a pistol grip and short stock. Orthographic side view, flat even lighting, plain mid-grey background, no hands, no text." |
| `gaffi` | 1024×512 | "a primitive two-handed alien fighting staff: a long weathered wooden shaft bound with cord, a pointed metal spearhead at the top, a knobbed bludgeon head below it, and a short curved axe blade at the base. Orthographic side view, flat even lighting, plain mid-grey background, no hands, no text." |

### Bosses — priority 4 (deferred until the boss fights are built)

| id | Height | Subject |
|---|---|---|
| `wookiee_enforcer` | 2.6 m | "a towering black-furred ape-like gladiator alien, heavy muscular build, a metal-studded bandolier across the chest, armoured fighting gauntlets, scarred and battle-worn" |
| `pyke_capo` | 2.0 m | "an ornately dressed alien crime boss with a tall narrow tapered head, embroidered layered robes in deep plum and gold, jewelled rings, a belt-mounted shield generator emitter" |
| `imperial_officer` | 1.85 m | "a severe uniformed officer in a long black military greatcoat with a peaked cap and rank insignia plaque, gloved hands, gaunt authoritarian bearing" |
| `duelist` | 1.9 m | "a blue-skinned gunslinger alien with a gaunt narrow face, deep-set red eyes and two breathing tubes running from the nose to the temples, a wide-brimmed hat, a long coat, twin holstered pistols" |

### Armour-wear detail maps (optional, post-MVP)

Only if we upgrade the procedural characters before authored models land — per-character
512² tiling detail: "Seamless tileable texture of scratched weathered painted armour plate,
[green / maroon / slate-teal / bone-white / navy] paint over silver metal, chips, scrapes and
blaster scorch marks, even lighting."
