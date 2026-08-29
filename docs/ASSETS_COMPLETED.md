# Asset History — Delivered

Assets that have been produced, integrated and verified in-game. **These are closed — they
are not open requests.** Open requests live in [`ASSETS_IMAGES.md`](ASSETS_IMAGES.md),
[`ASSETS_AUDIO.md`](ASSETS_AUDIO.md) and [`ASSETS_MODELS.md`](ASSETS_MODELS.md).

Kept for provenance and so anything can be regenerated on-style if it needs replacing.

---

## Textures & images — 15 files, delivered 2026-08-27

Live in `public/assets/textures/`. Opaque maps were re-encoded to JPEG by
`tools/optimize-textures.mjs` (15.3 MB → 6.8 MB, ~85% off each, no visible loss at in-game
texel density). `sand_normal` and `neon_sign` stay PNG — JPEG ringing corrupts surface
normals, and the sign needs its alpha.

The loader tries `.jpg` then `.png`, so either extension works for a replacement.

| File | Used by | Original prompt |
|---|---|---|
| `sand_albedo.jpg` | Dune Sea terrain (`world/tatooine.ts`) | "Seamless tileable texture of fine wind-rippled desert sand, warm ochre-gold color, gentle parallel wind ripples, top-down view, soft even lighting, no shadows, photorealistic, 1024x1024" |
| `sand_normal.png` | Dune Sea terrain normal map | "Seamless tileable normal map of wind-rippled desert sand dunes, gentle parallel ripples, purple-blue normal map format, 1024x1024" |
| `rock_albedo.jpg` | Mesas + boulders | "Seamless tileable texture of sun-baked desert sandstone rock, layered sedimentary strata, warm tan and rust bands, dry cracked surface, even lighting, no shadows, 1024x1024" |
| `adobe_wall.jpg` | Homestead dome | "Seamless tileable texture of smooth adobe stucco wall, pale sand color, subtle hand-troweled texture, faint wind-worn streaks, desert architecture, even lighting, 1024x1024" |
| `tent_cloth.jpg` | Tusken camp tents | "Seamless tileable texture of rough woven canvas tent cloth, sun-bleached beige-brown, coarse fiber weave, patched and dusty, even lighting, 512x512" |
| `metal_deck.jpg` | Waystation platform decks | "Seamless tileable texture of industrial spaceship deck plating, gunmetal grey steel, hexagonal tread pattern, oil stains and scuffs, scratched edges, even lighting, 1024x1024" |
| `metal_hull.jpg` | Refinery spire + parked freighter | "Seamless tileable texture of weathered spacecraft hull panels, off-white and grey painted metal with chipped paint revealing steel, rivets and panel lines, grime streaks, even lighting, 1024x1024" |
| `crate_side.jpg` | Spice containers, crane hook | "Face texture of a sci-fi cargo crate, olive-drab reinforced metal box panel with recessed X-brace, stenciled hazard chevrons in faded yellow, scuffed corners, front-on view, even lighting, 512x512" |
| `barrel.jpg` | Fuel barrels on the station pads | "Wrap-around texture of an industrial sci-fi fuel barrel, dark steel with two horizontal reinforcement ribs, faded orange hazard band, grimy, even lighting, 512x512" |
| `neon_sign.png` | Cantina sign on the main pad | "Alien cantina neon sign on black background, glowing teal and magenta abstract alien glyphs (invented script, not a real language), slight glow bloom, 512x256" |
| `sky_desert.jpg` | Dune Sea scene background (equirect) | "360 equirectangular panorama of a desert planet sky at late afternoon, two suns (one large white-gold, one smaller orange) low over endless dunes, pale bleached blue fading to warm ochre horizon haze, few thin clouds, no ground objects, photorealistic" |
| `sky_space.jpg` | Waystation scene background (equirect) | "360 equirectangular deep space panorama, dense starfield, large wispy purple-and-orange nebula on one side, a distant banded amber gas giant planet, dark and moody, photorealistic astrophotography style" |
| `board_tatooine.jpg` | Board-select card | "Cinematic wide shot of a desert planet at golden hour: endless ochre dunes, a lone armored bounty-hunter silhouette with jetpack overlooking a distant adobe town, twin suns, heat haze, concept-art style" |
| `board_waystation.jpg` | Board-select card | "Cinematic shot of a grimy industrial space station of scattered floating platforms and cranes around a central refinery spire, purple-orange nebula behind, sodium work-lights, tiny flying armored figure between platforms, concept-art style" |
| `title_bg.jpg` | Title screen background | "Moody dark cinematic key art, weathered green-and-maroon armored bounty hunter helmet in dramatic rim light against a dusty dark background, embers drifting, space-western tone, concept-art style, no text" |

**Integration notes.** Both equirect skies became the actual `scene.background`, replacing
the procedural shader domes (which stay in the code as the fallback when the files are
absent, and are hidden once a panorama loads). The space panorama already contains the
nebula, starfield and gas giant, so the whole procedural sky group is hidden on that board.
`skyIntensity` on the waystation dims the panorama to 0.62 so the bright nebula doesn't
silhouette the platforms against it. HUD text shadows were strengthened at the same time —
the old values washed out against the new bright skies.

---

## Audio — 38 files, delivered 2026-08-27

Live in `public/assets/audio/`, generated with the ElevenLabs sound-generation API.
(Originally 41; Grogu's coo was retired when he was cut. The two massiff sounds — `massiff_growl`, `massiff_yelp` — were retired with the old small massiff and have been regenerated for the war massiff at its new size: a chest-deep snarl and a heavy death rattle rather than a hound's. Their prompts are in `tools/generate-sfx.mjs`.)
**Regeneration prompts are the source of truth in `tools/generate-sfx.mjs`** — edit the
`SFX` table there and re-run rather than copying prompts around:

```bash
ELEVENLABS_API_KEY=... node tools/generate-sfx.mjs [name ...]
```

Existing files are skipped unless named explicitly. The key is read from the environment or
an untracked `.elevenlabs_key`; it is never committed.

The loader tries `.ogg` then `.mp3`, falling back to the WebAudio synth voices if neither
is present, so every one of these remains replaceable.

| Group | Files |
|---|---|
| Weapons & combat | `blaster_shot`, `enemy_blaster`, `blaster_impact`, `melee_whoosh`, `melee_hit`, `rocket_launch`, `explosion`, `hit_marker`, `kill_confirm`, `player_hurt` |
| Movement | `jetpack_loop`, `jetpack_ignite`, `dash`, `land_hard`, `land_soft`, `footstep_sand`, `footstep_metal` |
| Enemy & companion voices | `tusken_cry`, `pyke_chatter`, `pyke_death`, `pirate_taunt`, `pirate_death`, `droid_death`, `swoop_pass`, `imperial_bark`, `imperial_death` |
| Ambience | `amb_desert`, `amb_station` |
| Music | `music_title`, `music_combat_desert`, `music_combat_station`, `music_victory`, `music_defeat` |
| UI | `ui_move`, `ui_confirm`, `ui_back`, `wave_start`, `wave_clear` |

**Integration notes.** Footsteps pick sand or metal from the board and pitch-vary a single
file; spawn and death barks are mapped per enemy kind; ambience and music loop through the
music bus with the synth drone as fallback; victory/defeat stings fire on match end.

---

## Images & reference sheets — 45 entries, delivered 2026-08-28

The seven new boards' art and the character turnaround sheets for the whole cast. Board
textures live in `public/assets/textures/` and are picked up by the loader with no code
change; the sheets are production inputs in `reference/characters/` and are not shipped.

### New boards — select-card art (priority 1)

| id | Details |
|---|---|
| `board_nevarro.jpg` | "Cinematic wide shot of a volcanic plain: black cracked basalt flats cut by winding glowing lava rivers, steam geysers erupting, an adobe town gate with watchtowers in the distance, a lone armored bounty-hunter silhouette with jetpack mid-leap over a lava channel, ash-brown sky, concept-art style" |
| `board_crevasse.jpg` | "Cinematic shot down into a deep glacial crevasse: sheer blue-white ice walls, natural ice arches bridging the gap, a frozen lake glowing pale on the canyon floor far below, spider-like silhouettes clinging to the walls, a tiny armored figure with a glowing jetpack descending, pale overcast light, concept-art style" |
| `board_trask.jpg` | "Cinematic shot of a storm-lashed alien fishing port at dusk: dark metal dock fingers over churning grey-green sea, moored rusty trawlers heaving on the swell, driving rain, a fork of lightning, sodium work-lights, an armored figure standing on a pier, moody concept-art style" |
| `board_refinery.jpg` | "Cinematic interior shot of a vast industrial refinery hall: a glowing orange reactor column rising through a 40-meter open shaft ringed by catwalks, low corridors with hazard-striped fuel barrels, red alarm lights, an armored figure with jetpack flying up the shaft, concept-art style" |
| `board_forge.jpg` | "Cinematic wide shot of a ruined civilization on a glassed planet: a shattered great dome half-collapsed over fused green-grey glass desert, floating chunks of ruin hanging in the air, a magnetic storm arcing violet lightning in the distance, a lone armored warrior before the ruins, somber concept-art style" |
| `board_ringworld.jpg` | "Cinematic shot along a city street built on the inside of a ring space station, the ground curving up into the sky in the far distance: neon signs and street lights on one half in deep night, warm low sunlight on the other half, a sharp terminator line between them crossing the street, a sleek monorail tram, concept-art style" |
| `board_narkina.jpg` | "Cinematic split-view shot at the waterline of an ocean planet: above, a sterile white Imperial prison facility on pylons under hard grey daylight, glowing white floor strips; below the surface, teal water with kelp, a glowing reef and an armored figure swimming down trailing bubbles, concept-art style" |

### New boards — sky panoramas (priority 2)

| id | Details |
|---|---|
| `sky_nevarro.jpg` | Nevarro — "360 equirectangular panorama of a volcanic planet sky: ash-brown and slate grey haze, one pale white-gold sun low in the murk, thin drifting smoke layers, a faint warm orange glow along the horizon as if from distant lava fields, no ground objects, photorealistic" |
| `sky_ice.jpg` | The Crevasse — "360 equirectangular panorama of a polar sky on a frozen planet: pale overcast white-blue, thin high ice-crystal clouds with a faint sun dog halo around a small cold sun, horizon fading into ice-fog, no ground objects, photorealistic" |
| `sky_trask.jpg` | Trask — "360 equirectangular panorama of a storm sky over an ocean moon: heavy dark grey-green cumulus, rain curtains on the horizon, one brighter break in the cloud, late dusk light, no ground objects, photorealistic" |
| `sky_mandalore.jpg` | The Great Forge — "360 equirectangular panorama of a dead world's sky: muted grey-green haze, a pale sun behind thin toxic-looking cloud bands, faint aurora-like magnetic shimmer near the horizon, somber and still, no ground objects, photorealistic" |
| `sky_ring.jpg` | The Ringworld — "360 equirectangular panorama from inside a colossal ring space station: the ring's inner surface arcing overhead as a faint band of distant city lights across the starfield, a low warm sun on one horizon and deep night on the opposite one, no nearby ground objects, photorealistic" |
| `sky_narkina.jpg` | The Prison Rig — "360 equirectangular panorama of a hard bright overcast sky over an endless grey-green ocean: high white glare through thin cloud, a pale cold sun disc, distant white-capped swell at the horizon in every direction, no land, no objects, photorealistic" |

### New boards — surface textures (priority 3)

| id | Details |
|---|---|
| `basalt_albedo.jpg` | Nevarro terrain, columns, crust plates — "Seamless tileable texture of cracked volcanic basalt plates, dark charcoal-grey stone split into irregular polygonal slabs by deep seams, a few hairline cracks glowing faint ember-orange, top-down, even lighting, no shadows" |
| `snow_albedo.jpg` | Crevasse terrain — "Seamless tileable texture of wind-drifted packed snow, white with faint blue shadowed ripples, fine sparkle grain, top-down, even lighting, no shadows" |
| `ice_albedo.jpg` | Crevasse ledges, spires, lake plates — "Seamless tileable texture of thick glacial ice, pale blue-white with deep blue marbling below the surface and fine white fracture lines, slightly translucent look, even lighting, no shadows" |
| `lava_flow.jpg` | Nevarro lava rivers (also its emissive map) — "Seamless tileable texture of an active lava flow seen from above: black cooling crust broken by a bright web of molten orange-yellow channels, high contrast, even lighting" |

### Character reference sheets (A-pose turnarounds)

| id | Details |
|---|---|
| `din` | 1.8 m — "a bounty hunter in polished bare silver beskar-style plate armour, unpainted mirror-bright plates, a smooth domed helmet with a narrow T-shaped visor and raised cheek ridges, no rangefinder, brown leather flight suit sleeves and gloves, a long weathered brown wool cape, a slim compact jetpack, clean heroic silhouette" |
| `paz` | 1.95 m — "a towering heavy-infantry warrior in deep navy-blue plate armour, oversized squared shoulder pauldrons, a reinforced helmet with a raised central crest ridge and a narrow T-shaped visor, thick armoured limbs, broad imposing silhouette" |
| `ig11` | 2.2 m — "a tall gaunt humanoid assassin droid, weathered off-white and brass metal, a smooth vertical cylindrical head ringed near the top with small red photoreceptor lenses, thin exposed piston-and-cable limbs, narrow shoulders, spindly and unsettling" |
| `marshal` | 1.85 m — "a frontier lawman in a dusty red-brown leather duster coat over sand-worn work clothes, a wide-brimmed hat, a holstered blaster pistol at the hip, a weathered sun-beaten human face, desert gunslinger" |
| `fennec` | 1.85 m — "a lean female elite mercenary sharpshooter in fitted dark grey body armour, a slim helmet cap with a glowing amber-orange visor band across the eyes, a long rifle slung across the back, precise and composed" |
| `tusken` | 1.8 m — "a desert nomad warrior wrapped head to toe in layered sand-coloured cloth bandages and robes, a mask with two short protruding cylindrical eyepieces and a central breathing tube flanked by two small spike vents, a leather bandolier across the chest, wrapped hands" |
| `pyke` | 2.0 m — "a tall thin alien gangster soldier, a very tall narrow tapered grey-green head rising to a rounded point with two small dark almond eyes set low on the face, thin breathing tubes running from the jaw to a chest rig, a long slate blue-grey coat, narrow sloping shoulders" |
| `pirate` | 1.9 m — "a rough alien space pirate, leathery tan-brown skin with a row of short blunt horns across the brow, mismatched scavenged armour plates over worn brown leathers, one battered metal shoulder pauldron, a utility harness" |
| `pirate_melee` | 1.9 m — "a heavy-built alien pirate brawler, leathery tan-brown skin with short blunt brow horns, thick armoured forearms and scavenged plate over worn leathers, one heavy metal pauldron, a club with a blunt metal head stowed across the back" |
| `droid` | 2.1 m — "a skeletal humanoid labour droid, bone-white and cream plating over exposed dark mechanical joints, an elongated narrow skull-like head with two small glowing red eyes, thin exposed limbs, industrial and worn" |
| `stormtrooper` | 1.9 m — "a soldier in scuffed grimy white segmented armour over a black bodysuit, a helmet with a dark horizontal visor band, angular cheek vents and a small central grille, sand-dusted and field-repaired with mismatched patched plates" |
| `deathtrooper` | 2.0 m — "an elite soldier in matte jet-black segmented armour over a black bodysuit, a smooth helmet with a dark visor band and a faint green lens glow, taller and heavier than a standard trooper, sleek and intimidating" |
| `darktrooper` | 2.2 m — "a heavy humanoid battle droid in matte black armoured plating, a blunt skull-like faceplate with two small glowing red eyes, thick armoured shoulders and limbs, integrated twin thrusters mounted on the back, brutal and mechanical" |
| `nikto` ◆ | 1.75 m — "a horned alien biker, leathery reddish-brown skin with a crown of short blunt horns across the brow, scuffed dark leather riding gear with a chest harness, lean and wiry" |
| `nikto_swoop` ◆ | 2.6 m long — "a long-nosed single-rider hover speeder bike, battered orange-brown and gunmetal plating, a long forward prow, a large rear engine housing with exhaust vents, low handlebars, no wheels" |
| `flametrooper` | 1.9 m — "a soldier in scuffed white segmented armour with bold dark-red trim bands across the chest, shoulders and helmet crest, a flat-faced helmet with a wide narrow visor slit, twin red fuel tanks on the back, a heavy wide-mouthed flame projector slung at the hip on a feed hose, black bodysuit under the plates" |
| `quarren` | 1.9 m — "a squid-faced alien dock worker turned fighter, orange-brown skin, a domed head with two side-set eyes and four short face tentacles over the mouth, heavy dark-green oilskin fisherman's coat over work clothes, a rolled cargo net slung across the back, a stubby wide-mouthed net-launcher tube in hand" |
| `alamite` | 1.85 m — "a pale hunched cave-dweller humanoid, chalky grey-white hide, a heavy brow ridge over sunken dark eyes, small tusks from an underbite, a spined bony ridge down the back, ragged loincloth, wrapped fists, carrying a crude stone club, feral posture but standing in A-pose" |
| `ring_enforcer` | 2.1 m — "a heavy enforcer in dark oxblood-red and gunmetal plate armour, broad shoulders, a visored helm with a squared jaw guard, a rectangular tower shield with a glowing pale-blue energy pane carried on the left arm, a blaster rifle in the right hand" |
| `krykna` ◆ | 1.7 m — "a pale bone-white cave spider the size of a person: a rounded abdomen and smaller head section, six glossy black eyes clustered forward, two small dark fangs, eight long jointed legs rising above the body then angling down to points, chitinous matte shell — orthographic side, front and top views" |
| `krykna_brood` ◆ | 2.8 m — "a massive pale grey-white brood spider, same anatomy as a smaller cave spider but half again the bulk, darker mottled shell, three translucent pale-green egg sacs clinging to the abdomen, eight heavy jointed legs — orthographic side, front and top views" |
| `interceptor_drone` ◆ | 1.7 m — "a sinister black Imperial probe drone: a rounded armored sphere head with one large red photoreceptor and a ring of small amber sensor lights, a skirt of dark plating below, five thin articulated manipulator arms dangling underneath, a small top-mounted thruster — orthographic side, front and top views, hovering, no ground contact" |
| `carbine` | 1024×512 — "a compact sci-fi blaster carbine rifle, scuffed gunmetal grey and dark brown, a boxy receiver, a short ribbed barrel with a flared muzzle, a compact scope on top, a pistol grip and short stock. Orthographic side view, flat even lighting, plain mid-grey background, no hands, no text." |
| `gaffi` | 1024×512 — "a primitive two-handed alien fighting staff: a long weathered wooden shaft bound with cord, a pointed metal spearhead at the top, a knobbed bludgeon head below it, and a short curved axe blade at the base. Orthographic side view, flat even lighting, plain mid-grey background, no hands, no text." |
| `wookiee_enforcer` | 2.6 m — "a towering black-furred ape-like gladiator alien, heavy muscular build, a metal-studded bandolier across the chest, armoured fighting gauntlets, scarred and battle-worn" |
| `pyke_capo` | 2.0 m — "an ornately dressed alien crime boss with a tall narrow tapered head, embroidered layered robes in deep plum and gold, jewelled rings, a belt-mounted shield generator emitter" |
| `imperial_officer` | 1.85 m — "a severe uniformed officer in a long black military greatcoat with a peaked cap and rank insignia plaque, gloved hands, gaunt authoritarian bearing" |
| `duelist` | 1.9 m — "a blue-skinned gunslinger alien with a gaunt narrow face, deep-set red eyes and two breathing tubes running from the nose to the temples, a wide-brimmed hat, a long coat, twin holstered pistols" |


## Audio — 4 files, delivered 2026-08-28

Signature-weapon voices for the hunter roster, generated with
`node tools/generate-sfx.mjs crossbow_shot longrifle_shot saber_swing saber_ignite`
(prompts live in that script): `crossbow_shot` (Embo's laser crossbow),
`longrifle_shot` (Bossk's and IG-11's long rifle), `saber_swing` (Asajj Ventress's
melee, pitch-varied per combo step), `saber_ignite` (drawing the twin blades). `pistol_shot` (Cad Bane's twin pistols)
followed on 2026-08-29.
Synth fallbacks remain in `src/core/audio.ts`.

---

## Images — 29 files, delivered 2026-08-29

**26 drop-screen portraits** at `public/assets/textures/portrait_<id>.jpg` — the
playable four (`din`, `paz`, `bokatan`, `armorer`) and every enemy kind the drop
screen shows (`tusken`, `pyke`, `pirate`, `pirateMelee`, `jetpirate`, `droid`,
`nikto`, `massiff`, `stormtrooper`, `deathtrooper`, `darktrooper`, `duelist`,
`officer`, `capo`, `enforcer`, `flametrooper`, `krykna`, `broodmother`, `quarren`,
`alamite`, `drone`, `ringEnforcer`). Made to the recipe in `ASSETS_IMAGES.md`
(512×614 JPEG, head and shoulders, warm key from the upper left on near-black).
The loading screen probes these paths already and keeps its drawn mark on a 404, so
arriving at the path is the integration. Still open: the three playable hunters
(`ventress`, `embo`, `bossk`), who joined the roster after this batch.

**3 hunter weapon prop sheets** in `reference/characters/` (production inputs, not
shipped) — original prompts, per the carbine/gaffi recipe (1024×512, orthographic
side view, flat lighting, mid-grey background):

| Id | Prompt |
|---|---|
| `saber_curved` | "a curved-hilt energy sword hilt, hilt only with no blade: a short metal grip kinked like a crescent, an emitter shroud at the top, a hooked pommel, silver and dark gunmetal, weathered" |
| `crossbow` | "a sci-fi energy crossbow: a compact rifle stock and grip, two bow limbs swept sharply forward, small glowing emitter orbs at the limb tips, a taut glowing energy string between them, scuffed gunmetal and brown" |
| `longrifle` | "a very long-barrelled sci-fi hunting rifle: boxy receiver, shoulder stock, a long slim barrel ending in a flared muzzle, a long top-mounted scope, a fore grip, scuffed gunmetal grey and tan" |

They were drawn to unblock the `saber_curved`, `crossbow` and `longrifle` prop models,
but those models are **parked by decision** (2026-08-29) — the game keeps its procedural
weapons — and the `pistol` sheet is parked with them. See `ASSETS_MODELS.md`.

---

## Board music — 10 tracks

Full-length streamed score in `public/music/`, played through an `<audio>` element on the
music bus rather than decoded as samples. The map from track to board is
[`src/core/music.ts`](../src/core/music.ts) — the only file that names a track — and
`public/music/README.md` documents the directory. Filenames are lowercase and hyphenated
so they need no URL escaping; uploads with spaces in the name are renamed on the way in.

| Track | Role |
|---|---|
| `bone-totem-march-1.mp3`, `bone-totem-march-2.mp3` | the desert playlist (The Dune Sea, The Lava Flats, The Great Forge) |
| `dust-beyond-orbit-1.mp3`, `dust-beyond-orbit-2.mp3` | the station playlist (every other board) |
| `mando-african.mp3`, `mando-capoeira.mp3` | any board — they join every rotation |
| `mando-sea-shanty.mp3` | opens The Storm Docks |
| `mando-ice.mp3` | opens The Crevasse |
| `mando-fada.mp3` | opens The Great Forge |
| `mando-indian.mp3` | opens The Prison Rig |

A board plays its opener first where it has one, then picks at random from the rest of its
rotation, never the same track twice running. If every track fails to load the engine
falls back to the `music_combat_desert` / `music_combat_station` samples, and then to a
synth drone, so a board is never silent.

The seven per-board pairs still wanted are open in [`ASSETS_AUDIO.md`](ASSETS_AUDIO.md).

---

## Audio — `saber_hum`, delivered 2026-08-29

| File | Used by | Original prompt |
|---|---|---|
| `saber_hum.mp3` | Looping blade hum while the twin sabers are drawn (`audio.setSaberHum`) | "Steady energy blade idle hum: low warm electrical drone with a slow beating pulse and faint high harmonic shimmer, constant level, no swings, no crackle, seamless continuous loop" |

The engine synthesizes a fallback (two detuned saws an octave apart plus a sub triangle
through a lowpass) when the file is absent, so the hum works either way.
