# Asset Requests — Images & Textures

**Open image requests only.** Delivered images are recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md) with their original prompts — the first 15
environment, sky and UI textures are done and integrated, so nothing on that list needs
making again. **The six new boards (Nevarro, the Crevasse, Trask, the Refinery, the Great
Forge, the Ringworld) opened a fresh batch of requests below** — every one already has a
procedural stand-in in-game, and the loader picks the file up automatically when it lands.

Every image request for the project belongs in this file; once delivered it moves to the
history doc, and anything it feeds (such as the 3D model briefs) references the resulting
filenames from there.

**Global specs unless noted:** sRGB, no baked lighting or shadows (lighting is dynamic), no
text or watermarks, no logos, and no reproductions of copyrighted designs — describe the
design, never name a trademarked character or film frame.

Runtime textures land in `public/assets/textures/` and the loader tries `.jpg` then `.png`.
Production-only reference art (below) lives in `reference/` and is **not** shipped.

## New boards — select-card art (priority 1)

Same style and spec as the two delivered cards (`board_tatooine.jpg`,
`board_waystation.jpg` in the history doc): cinematic concept-art, landscape ~16:9,
≥1024×576, no text. These are the first thing a player sees of each board.

| File | Prompt |
|---|---|
| `board_nevarro.jpg` | "Cinematic wide shot of a volcanic plain: black cracked basalt flats cut by winding glowing lava rivers, steam geysers erupting, an adobe town gate with watchtowers in the distance, a lone armored bounty-hunter silhouette with jetpack mid-leap over a lava channel, ash-brown sky, concept-art style" |
| `board_crevasse.jpg` | "Cinematic shot down into a deep glacial crevasse: sheer blue-white ice walls, natural ice arches bridging the gap, a frozen lake glowing pale on the canyon floor far below, spider-like silhouettes clinging to the walls, a tiny armored figure with a glowing jetpack descending, pale overcast light, concept-art style" |
| `board_trask.jpg` | "Cinematic shot of a storm-lashed alien fishing port at dusk: dark metal dock fingers over churning grey-green sea, moored rusty trawlers heaving on the swell, driving rain, a fork of lightning, sodium work-lights, an armored figure standing on a pier, moody concept-art style" |
| `board_refinery.jpg` | "Cinematic interior shot of a vast industrial refinery hall: a glowing orange reactor column rising through a 40-meter open shaft ringed by catwalks, low corridors with hazard-striped fuel barrels, red alarm lights, an armored figure with jetpack flying up the shaft, concept-art style" |
| `board_forge.jpg` | "Cinematic wide shot of a ruined civilization on a glassed planet: a shattered great dome half-collapsed over fused green-grey glass desert, floating chunks of ruin hanging in the air, a magnetic storm arcing violet lightning in the distance, a lone armored warrior before the ruins, somber concept-art style" |
| `board_ringworld.jpg` | "Cinematic shot along a city street built on the inside of a ring space station, the ground curving up into the sky in the far distance: neon signs and street lights on one half in deep night, warm low sunlight on the other half, a sharp terminator line between them crossing the street, a sleek monorail tram, concept-art style" |
| `board_narkina.jpg` | "Cinematic split-view shot at the waterline of an ocean planet: above, a sterile white Imperial prison facility on pylons under hard grey daylight, glowing white floor strips; below the surface, teal water with kelp, a glowing reef and an armored figure swimming down trailing bubbles, concept-art style" |

## New boards — sky panoramas (priority 2)

Same spec as the delivered `sky_desert.jpg` / `sky_space.jpg`: 360° equirectangular,
≥4096×2048, no ground objects that would conflict with board geometry. Each replaces a
procedural shader sky when present (the Refinery is an interior and needs none).

| File | Board | Prompt |
|---|---|---|
| `sky_nevarro.jpg` | Nevarro | "360 equirectangular panorama of a volcanic planet sky: ash-brown and slate grey haze, one pale white-gold sun low in the murk, thin drifting smoke layers, a faint warm orange glow along the horizon as if from distant lava fields, no ground objects, photorealistic" |
| `sky_ice.jpg` | The Crevasse | "360 equirectangular panorama of a polar sky on a frozen planet: pale overcast white-blue, thin high ice-crystal clouds with a faint sun dog halo around a small cold sun, horizon fading into ice-fog, no ground objects, photorealistic" |
| `sky_trask.jpg` | Trask | "360 equirectangular panorama of a storm sky over an ocean moon: heavy dark grey-green cumulus, rain curtains on the horizon, one brighter break in the cloud, late dusk light, no ground objects, photorealistic" |
| `sky_mandalore.jpg` | The Great Forge | "360 equirectangular panorama of a dead world's sky: muted grey-green haze, a pale sun behind thin toxic-looking cloud bands, faint aurora-like magnetic shimmer near the horizon, somber and still, no ground objects, photorealistic" |
| `sky_ring.jpg` | The Ringworld | "360 equirectangular panorama from inside a colossal ring space station: the ring's inner surface arcing overhead as a faint band of distant city lights across the starfield, a low warm sun on one horizon and deep night on the opposite one, no nearby ground objects, photorealistic" |
| `sky_narkina.jpg` | The Prison Rig | "360 equirectangular panorama of a hard bright overcast sky over an endless grey-green ocean: high white glare through thin cloud, a pale cold sun disc, distant white-capped swell at the horizon in every direction, no land, no objects, photorealistic" |

## New boards — surface textures (priority 3)

Seamless tileable, 1024×1024 unless noted, same rules as the delivered set. Each replaces
a live canvas-procedural texture of the same name (see `src/core/assets.ts`), so drop-in
files upgrade the boards with no code change. (`ring_night_gradient` is procedural on
purpose — its exact alpha ramp is gameplay-tuned; don't author it.)

| File | Used by | Prompt |
|---|---|---|
| `basalt_albedo.jpg` | Nevarro terrain, columns, crust plates | "Seamless tileable texture of cracked volcanic basalt plates, dark charcoal-grey stone split into irregular polygonal slabs by deep seams, a few hairline cracks glowing faint ember-orange, top-down, even lighting, no shadows" |
| `snow_albedo.jpg` | Crevasse terrain | "Seamless tileable texture of wind-drifted packed snow, white with faint blue shadowed ripples, fine sparkle grain, top-down, even lighting, no shadows" |
| `ice_albedo.jpg` | Crevasse ledges, spires, lake plates | "Seamless tileable texture of thick glacial ice, pale blue-white with deep blue marbling below the surface and fine white fracture lines, slightly translucent look, even lighting, no shadows" |
| `lava_flow.jpg` | Nevarro lava rivers (also its emissive map) | "Seamless tileable texture of an active lava flow seen from above: black cooling crust broken by a bright web of molten orange-yellow channels, high contrast, even lighting" |

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

### Playable Mandalorians — priority 1 (authored models incoming; sheets optional)

Din Djarin and Paz Vizsla are the only playable characters, and authored models for both
are being supplied — so these sheets are a fallback rather than the blocking input they
are for the rest of the cast.

| id | Height | Subject |
|---|---|---|
| `din` | 1.8 m | "a bounty hunter in polished bare silver beskar-style plate armour, unpainted mirror-bright plates, a smooth domed helmet with a narrow T-shaped visor and raised cheek ridges, no rangefinder, brown leather flight suit sleeves and gloves, a long weathered brown wool cape, a slim compact jetpack, clean heroic silhouette" |
| `paz` | 1.95 m | "a towering heavy-infantry warrior in deep navy-blue plate armour, oversized squared shoulder pauldrons, a reinforced helmet with a raised central crest ridge and a narrow T-shaped visor, thick armoured limbs, broad imposing silhouette" |

### Allies — priority 2

| id | Height | Subject |
|---|---|---|
| `ig11` | 2.2 m | "a tall gaunt humanoid assassin droid, weathered off-white and brass metal, a smooth vertical cylindrical head ringed near the top with small red photoreceptor lenses, thin exposed piston-and-cable limbs, narrow shoulders, spindly and unsettling" |
| `marshal` | 1.85 m | "a frontier lawman in a dusty red-brown leather duster coat over sand-worn work clothes, a wide-brimmed hat, a holstered blaster pistol at the hip, a weathered sun-beaten human face, desert gunslinger" |
| `fennec` | 1.85 m | "a lean female elite mercenary sharpshooter in fitted dark grey body armour, a slim helmet cap with a glowing amber-orange visor band across the eyes, a long rifle slung across the back, precise and composed" |


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
| `nikto` ◆ | 1.75 m | "a horned alien biker, leathery reddish-brown skin with a crown of short blunt horns across the brow, scuffed dark leather riding gear with a chest harness, lean and wiry" |
| `nikto_swoop` ◆ | 2.6 m long | "a long-nosed single-rider hover speeder bike, battered orange-brown and gunmetal plating, a long forward prow, a large rear engine housing with exhaust vents, low handlebars, no wheels" |

◆ **Pose exceptions** — `nikto`: rider in normal A-pose (he is welded to the bike in-engine, so the sheets stay
separate). `nikto_swoop`: vehicle, orthographic side/front/rear, no rider.

### New-board enemies — priority 2 (in-game now as procedural stand-ins)

These seven arrived with the six new boards and follow every rule above. The ◆ non-bipeds
use orthographic side/front/top views instead of the A-pose preamble.

| id | Height | Subject |
|---|---|---|
| `flametrooper` | 1.9 m | "a soldier in scuffed white segmented armour with bold dark-red trim bands across the chest, shoulders and helmet crest, a flat-faced helmet with a wide narrow visor slit, twin red fuel tanks on the back, a heavy wide-mouthed flame projector slung at the hip on a feed hose, black bodysuit under the plates" |
| `quarren` | 1.9 m | "a squid-faced alien dock worker turned fighter, orange-brown skin, a domed head with two side-set eyes and four short face tentacles over the mouth, heavy dark-green oilskin fisherman's coat over work clothes, a rolled cargo net slung across the back, a stubby wide-mouthed net-launcher tube in hand" |
| `alamite` | 1.85 m | "a pale hunched cave-dweller humanoid, chalky grey-white hide, a heavy brow ridge over sunken dark eyes, small tusks from an underbite, a spined bony ridge down the back, ragged loincloth, wrapped fists, carrying a crude stone club, feral posture but standing in A-pose" |
| `ring_enforcer` | 2.1 m | "a heavy enforcer in dark oxblood-red and gunmetal plate armour, broad shoulders, a visored helm with a squared jaw guard, a rectangular tower shield with a glowing pale-blue energy pane carried on the left arm, a blaster rifle in the right hand" |
| `krykna` ◆ | 1.7 m | "a pale bone-white cave spider the size of a person: a rounded abdomen and smaller head section, six glossy black eyes clustered forward, two small dark fangs, eight long jointed legs rising above the body then angling down to points, chitinous matte shell — orthographic side, front and top views" |
| `krykna_brood` ◆ | 2.8 m | "a massive pale grey-white brood spider, same anatomy as a smaller cave spider but half again the bulk, darker mottled shell, three translucent pale-green egg sacs clinging to the abdomen, eight heavy jointed legs — orthographic side, front and top views" |
| `interceptor_drone` ◆ | 1.7 m | "a sinister black Imperial probe drone: a rounded armored sphere head with one large red photoreceptor and a ring of small amber sensor lights, a skirt of dark plating below, five thin articulated manipulator arms dangling underneath, a small top-mounted thruster — orthographic side, front and top views, hovering, no ground contact" |

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
