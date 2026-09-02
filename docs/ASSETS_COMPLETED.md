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
| `pistol` | "a heavy sci-fi blaster pistol: a boxy receiver, a short thick barrel ending in a flared muzzle, an angled grip, a small top sight, scuffed gunmetal and worn dark steel" |

All four unblocked their prop models, and all four models have since landed. The sheets
were briefly parked along with those models by a 2026-08-29 decision — the procedural
weapons read well at gameplay distance and nothing was blocked on a file — which the
sculpts arriving made moot; `pistol` was the last of them, delivered the same day.
See `ASSETS_MODELS.md`.

---

## Models — 3 files, delivered 2026-08-29

| Id | What it replaced |
|---|---|
| `pistol` | The procedural heavy pistol in `makePistol()`. Pre-wired: `swapWeapon()` already pointed at the id, so the file arriving was the whole integration. One file serves a pair — Cad Bane and Rook Vance each carry two instances, on `weaponMount` and `weaponMountL`. |
| `blast_door` | The whole emissive-trimmed door frame in `buildDoorFrame()` (`world/corridor.ts`), lit pane included — the sculpt carries its own hazard striping and status lamp. Needs a quarter turn: it is wide along its own Z where the frame is wide along X. |
| `corridor_crate` | The cover crates in `buildCorridor()`. Unlike every other sculpt, this one sizes its collider rather than being scaled into it: a corridor invents its crates each run, so there was no audited shape to preserve, and the delivered sculpt ran 22% taller and 50% deeper than the old box. |

Prompts are in [`ASSETS_MODELS.md`](ASSETS_MODELS.md), which keeps them for re-export.

---

## Monster bosses — 6 files, delivered 2026-08-29

The six creature bosses designed in [`BOSSES.md`](BOSSES.md), requested and delivered
the same day — and delivered *without* the reference sheets that were meant to precede
them, which is why that sheet request is now marked not-wanted rather than open.

| Id | Board | What it became |
|---|---|---|
| `mudhorn` | Waystation | The Smugglers' Prize, 2600 HP |
| `ravinak` | Crevasse | The Ice-Breaker, 3000 HP |
| `mamacore` | Trask | The Mamacore, 3400 HP — the board's timer hazard, finally with a body |
| `rancor` | Nevarro | The Warlord's Rancor, 3600 HP |
| `krayt_dragon` | Dune Sea | The Old One of the Dune Sea, 5200 HP — half-buried |
| `mythosaur` | Great Forge | The Sleeper Below, 5600 HP — half-buried |

Every one shipped its brief's rig verbatim (weak-zone nodes included) and no clips, so
each has a code gait in `src/anim/quadruped.ts`. Prompts and the two re-export notes
are in [`ASSETS_MODELS.md`](ASSETS_MODELS.md).

---

## Troop carriers — 2 files, delivered 2026-08-30

The wave-arrival transports (`src/enemies/arrival.ts`), requested and delivered the
same day, without their reference sheets — that request is marked not-wanted, like
the monsters' before it.

| Id | Flies for | Integration |
|---|---|---|
| `troop_carrier` | Imperial boards | Pre-wired `loadProp` swap in `Carrier`; the pass slows from the 85 m/s jet blur to a 46 m/s flyby once cached, and landers park it on procedural skids (the sculpts carry no gear, by design). |
| `raider_dropship` | Outlaw boards | Same contract, same day. |

Prompts are in [`ASSETS_MODELS.md`](ASSETS_MODELS.md), which keeps them for re-export.

---

## Board music — 11 tracks

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
| `mando-boss.mp3` | the warlord's theme — every board's final boss battle, and never anything else |

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

## Audio — 28 files, delivered 2026-08-29

Per-character voices for the playable roster, generated with
`node tools/generate-sfx.mjs <name ...>` (prompts in that script). Every playable
used to share one `player_hurt` grunt recorded for a man inside a helmet, so the
droid and the reptile yelped like a human; each species now has its own family of
three hurt takes plus a death cry, picked at random with a little pitch scatter.

| Voice | Who | Files |
|---|---|---|
| `mando_m` | Kell Dravan, Torva Brekk | `hurt_mando_m_1..3`, `death_mando_m` |
| `mando_f` | Vess Ordane, The Forgemistress | `hurt_mando_f_1..3`, `death_mando_f` |
| `human_f` | Sylla Morvane | `hurt_human_f_1..3`, `death_human_f` |
| `masked` | Karshii (rebreather) | `hurt_masked_1..3`, `death_masked` |
| `reptile` | Skarvek | `hurt_reptile_1..3`, `death_reptile` |
| `droid` | VX-9 (servos and sparks, no voice) | `hurt_droid_1..3`, `death_droid` |
| `alien_m` | Rook Vance | `hurt_alien_m_1..3`, `death_alien_m` |

The engine keeps a per-voice synth fallback too, so a droid stays mechanical even
before the files decode. `player_hurt` is retained as the `mando_m` fallback only.

---

---

## Environment textures (runtime) — 11 files, delivered 2026-08-29

The batch the board audit asked for, at `public/assets/textures/`. Unlike earlier
texture batches these were **not** pre-wired — each needed a `loadOptionalTexture` call
or a material swap in its board module, all of which landed with the files. Verified by
walking each board's live scene graph and confirming the file is on a real material.

| Id | For | Original prompt / notes |
|---|---|---|
| `city_facade.jpg` + `city_facade_glow.jpg` | Ringworld building blocks (`world/ringworld.ts`) | The buildings are random-sized boxes under the generic hull texture, so a facade texture — not a model — is the upgrade. Albedo: "Seamless tileable texture of a dense sci-fi city building facade: stacked metal panels, narrow horizontal window strips, vents and conduit runs, subtle grime streaks, gunmetal grey-blue, even lighting, 1024×1024". Glow (emissive map, same layout): "matching emissive map, near-black with scattered lit window strips in warm amber and pale teal". Wiring: swap `buildingMat`'s map + add emissiveMap. |
| `neon_sign_2.png`, `neon_sign_3.png` | Ringworld street signs | Today four flat colour planes. Same recipe as the delivered `neon_sign.png` (glyphs on transparency, invented script): one "glowing magenta-and-amber alien noodle-bar sign", one "glowing violet-and-teal alien hostel sign", 512×256 PNG. Wiring: swap the sign planes' materials. |
| `rust_hull.jpg` | Trask trawlers + dock decks | "Seamless tileable texture of rusty ship hull plating: green-grey steel plates with riveted seams, rust bleeding from joints and scuppers, flaking paint patches, even lighting, 1024×1024". Wiring: swap `hullMat`/`deckMat` maps in `world/trask.ts`. |
| `panel_white.jpg` | Prison Rig decks, tower, pylons | "Seamless tileable texture of clean white sci-fi facility wall panels: smooth off-white composite panels with fine seams, recessed bolts, faint scuffs low on the panel, even lighting, 1024×1024". Wiring: swap `whiteMat`/`deckMat` maps in `world/narkina.ts`. |
| `forge_relief.jpg` | Great Forge dome walls | "Seamless tileable texture of ancient carved stone wall: shallow angular geometric relief of interlocking sigils, grey basalt, chipped and heat-scorched, even lighting, 1024×1024". Wiring: swap `ruinMat`'s map on the dome wall segments in `world/forge.ts`. |
| `kelp_frond.png` | Prison Rig kelp forest | The kelp is solid cylinders today; crossed alpha-card ribbons would read as plants. "A single kelp frond on a transparent background: long tapering ribbon leaf with a gentle S-curve, olive-green, translucent edges, 512×1024 PNG with alpha". Wiring: replace the cylinder stalks with two crossed cards per plant (small code change, kelp is already `decor`). |
| `skyline_silhouette.png`, `skyline_silhouette_2.png` | Ringworld backdrop (PLAN.md §16) | Two parallax layers of city beyond the end bulkheads. "A wide row of varied dark sci-fi tower silhouettes on a transparent background: flat near-black shapes of mixed heights with spires, gantries and rooftop tanks, scattered tiny lit windows in warm amber and pale teal, no detail inside the shapes, 2048×512 PNG with alpha". `_2` is a second, differently-composed row for the far layer. Wiring: two alpha planes per bulkhead end in `world/ringworld.ts`, `decor`. |
| `net_weave.png` | Trask quay nets (PLAN.md §16) | "A hanging cargo net on a transparent background: knotted rope in a sagging diamond mesh, frayed ends, dark tarred brown, 512×512 PNG with alpha". Wiring: alpha planes hung between pilings in `world/trask.ts`, `decor`. |

Wiring notes for the three that were more than a map swap: the Forge's relief goes on a
clone of `ruinMat` so the carving does not tile across loose rubble; the kelp is two
crossed alpha cards per plant with the cylinder kept as the stand-in until the artwork
lands; the skyline rows and the quay nets are `decor`, and the collision audit's decor
flag now inherits down a group so a prop built from parts declares itself once.

## Drop-screen portraits — the hunter trio, delivered 2026-08-29

`portrait_ventress.jpg`, `portrait_embo.jpg`, `portrait_bossk.jpg`, to the recipe in the
earlier 26-portrait batch (512×614 JPEG, head and shoulders, warm key from the upper left
on near-black). No code change: the loading screen already probes `portrait_<id>.jpg` and
keeps its drawn mark on a 404. `portrait_ig11` is the last one still open.

---

## Audio — `saber_deflect`, delivered 2026-08-29

| File | Used by | Original prompt |
|---|---|---|
| `saber_deflect.mp3` | Each bolt Ventress turns on a blade (`audio.saberDeflect()`) | "Energy blade parrying a blaster bolt: short bright metallic ping with an electric crackle and a fast sizzling tail, dry, no reverb" |

0.48 s, verified decoding in-browser at peak 0.666 / rms 0.092. The synth voice (a square
zap over a bright noise burst) remains the fallback.

## Audio — 25 files, delivered 2026-08-29

The last of the open sound-effect requests: everything the six new boards and the
Prison Rig opened, plus the two speeder sounds the vehicles work added. Briefs are
the ones that stood in `ASSETS_AUDIO.md`; durations and loop flags live in
`tools/generate-sfx.mjs`.

| Group | Files |
|---|---|
| Ambience beds (18 s seamless) | `amb_lava`, `amb_ice`, `amb_rain`, `amb_refinery`, `amb_forge`, `amb_city`, `amb_sea` |
| Board effects | `thunder_crack`, `geyser_blast`, `alarm_klaxon`, `ice_crack`, `flame_burst`, `mythosaur_call`, `splash_in`, `splash_out`, `mamacore_roar`, `floor_charge` |
| Footsteps | `footstep_snow`, `footstep_stone` |
| New-board voices | `spider_chitter`, `quarren_bark`, `alamite_shriek`, `drone_whine` |
| Vehicles | `speeder_loop` (seamless), `speeder_ignite` |
| Variation sets | `footstep_sand_1..4`, `footstep_metal_1..4`, `melee_whoosh_1..3` |

The variation sets had been blocked on "a variant-picking helper in `src/core/audio.ts`";
the per-character voices added one, so they went in with it. Footsteps draw at random
from their four takes, and the three whooshes rise in intensity so the melee combo steps
through them rather than shuffling.

With these, all nine boards play their own ambience instead of borrowing the desert
or station bed, and every enemy kind with a bark hook has the voice for it.

---

## Playable hunter turnaround sheets — 3 sets, delivered 2026-08-28

`ventress`, `embo` and `bossk`, three views each in `reference/characters/` (production
inputs, not shipped), to the shared A-pose recipe in
[`ASSETS_IMAGES.md`](ASSETS_IMAGES.md). Two additions applied to this set: every playable
flies, so each carries a low-profile twin-nozzle thruster backpack form-fitted to the
character and visible in the side and back views; and a described weapon hilt is hilt
only, never an ignited blade, since blades are FX meshes the game manages. The
blue-skinned gunslinger needed no sheets — the delivered `duelist` set already is that
design.

| Id | Height | Original subject line |
|---|---|---|
| `ventress` | 1.79 m | "a pale ash-grey-skinned bald female assassin, gaunt striking features with dark markings crowning the bare scalp, a fitted sleeveless grey-black bodysuit under a long split skirt panel, forearm wraps, two curved-hilt sword grips holstered crossed at the back of the belt" |
| `embo` | 1.78 m | "a broad-shouldered olive-green-skinned bounty hunter alien, pale eyes over a slatted bamboo-like rebreather mask covering the lower face, a very wide circular flat-brimmed woven-metal hat, a fur-trimmed short poncho over banded leather-and-plate armor, heavy gauntlets, a compact crossbow-style blaster holstered at the hip" |
| `bossk` | 1.90 m | "a hulking reptilian bounty hunter, yellow-green scaled hide, a wedge-shaped snout full of needle teeth, slit orange eyes, clawed three-fingered hands and heavy clawed feet, wearing a worn yellow-tan flight suit with the sleeves rolled, a padded chest rig and ammo bandoliers" |

## Game identity — the logo, delivered 2026-08-29

| File | Where | Original prompt / notes |
|---|---|---|
| `logo.png` (1600×600 PNG, alpha) | `public/assets/textures/` → the title screen's heading | Title-screen wordmark reading **BOUNTY HUNTERS** and nothing else: heavy condensed uppercase, weathered aged-gold metal with worn edges, HUNTERS set below and wider than BOUNTY, transparent background. Wired ahead of delivery: `MenuScreen.addTitle(text, sub, 'logo')` swaps the set type for the image on load and keeps the text as the accessible label. |

The logo and the matching favicon are the deliberate exception to the "no text, no logos"
rule that keeps the rest of the generated art free of invented signage — the game's own
name is the one thing meant to be readable.

## Drop-screen portrait — `ig11`, delivered 2026-08-29

`portrait_ig11.jpg` (512×614), the last face still drawn as a mark, to the same recipe as
the earlier portrait batches. Every card on the drop screen carries authored art now.

---

## Game-mode art and the favicon — 13 files, delivered 2026-08-29

| Files | Where | Notes |
|---|---|---|
| `planet_<id>.png` ×9 | `public/assets/textures/` → the campaign's planet strip | One disc per territory (`desert`, `station`, `nevarro`, `crevasse`, `trask`, `refinery`, `forge`, `ringworld`, `narkina`). Pre-wired: `ui/planets.ts` builds the url from the board id, under a specular highlight and over the board's gradient, so arriving at the path was the integration. Prefetch now warms all nine when Missions is picked, a couple of screens ahead of the strip. |
| `corridor_wall.png`, `corridor_floor.png`, `hazard_stripe.png` | `public/assets/textures/` → the campaign's corridor segments | Needed wiring: `world/corridor.ts` was flat hull materials. Each surface now takes its tileable and keeps the flat colour as the fallback — on **cloned** materials, since `mat()` caches by colour and the corridor's floor plate would otherwise have landed on every surface in the game sharing that hex. Warmed at idle for campaign matches, since a corridor is built at match start but walked into minutes later. |
| `favicon.png` (512×512 PNG, alpha) | `public/` → the browser tab | The T-visored helmet mark in aged gold. Pre-wired: `<link rel="icon">` in `index.html` and `workbench/index.html`. Verified serving at 200, 512×512. |

---

## Audio — boss battle and ambient pass, 5 files, delivered 2026-08-29

| File | Used by | Original prompt |
|---|---|---|
| `boss_horn.mp3` | The boss introduction card and, quieter, each phase turn (`audio.bossHorn`) | "Massive dark war horn call announcing a boss battle: deep brassy swell rising over two seconds into a huge percussive orchestral hit with a low drum boom, cinematic, dry tail" |
| `ship_pass.mp3` | Sky-traffic close pass on the Waystation and Ringworld | "Large spacecraft passing overhead at distance: deep engine rumble sliding through a slow doppler shift, airy wash, four seconds, no other sounds" |
| `ship_landing.mp3` | The Waystation working pad's touchdown and liftoff | "Heavy freighter landing thrusters: roaring downdraft swelling then cutting to a hydraulic settle and a metallic clunk of landing gear" |
| `steam_hiss.mp3` | Refinery wall vents, volume by the nearest player's range | "Industrial steam vent burst: sharp pressurized hiss softening into a fading plume of white noise, two seconds" |
| `bantha_low.mp3` | The Dune Sea herd's idle low | "Colossal woolly beast lowing: deep mournful bellow with a breathy rumbling tail, three seconds, single call, no other sounds" |

All sample-first with synth fallbacks; every one verified decoding in-browser from the
built bundle.

---

## Audio — 24 files, delivered 2026-09-02

Everything the request doc still listed as open with a consumer, produced in one pass.
Prompts live in `tools/generate-sfx.mjs`; all 24 verified serving and decoding
in-browser from the built bundle.

**Monster boss voices (17).** A roar, a hurt cry and a death per creature, written to
that animal's build so the six read as different beasts rather than one growl pitched
down: `mudhorn_*`, `ravinak_*`, `rancor_*`, `krayt_*`, `mythosaur_*`, plus
`mamacore_hurt` and `mamacore_death`. The mamacore's roar is the delivered
`mamacore_roar` from the pier attack — the boss *is* that hazard surfacing, so a second
recording of the same animal would have been wrong. Routed through
`audio.monster(voice, part)`, which falls back to the shared beast synth when a set is
missing.

**Game modes (4).** `door_cycle` (mission gates, which had no voice at all before),
`checkpoint_chime`, `bacta_pickup`, `pvp_round_win` — each replacing a borrowed UI
confirm or wave-clear chime at its own call site.

**Hooks built to consume them (2).** `droid_servo`, played as one shared bed whose
level the game weights by each droid's distance and speed rather than a loop per
machine; and `amb_krayt_call`, on a 70–160 s distant-ambience timer on the Dune Sea.

**Earlier in the pass (1).** `boss_horn` had already landed on 2026-08-29; the four
game-mode files above were the rest of that table.

---

## Environment prop reference sheets — 27 subjects, delivered 2026-08-29 → 09-02

**All delivered, and every one of the 27 has its model in the game.** Verified against
`reference/props/` on 2026-09-02: each subject below has its `_ref.png` (the larger
props their second `_side.png` too) and a matching `public/models/<id>.glb`. They were
the visual reference for the environment models opened in
[`ASSETS_MODELS.md`](ASSETS_MODELS.md#environment--hazard-models--priority-by-impact),
in the models' priority order — these drive image-to-3D generators (Tripo, Meshy,
Rodin) and hand modelling alike, same as the character sheets. Model from these, not
from the prose.

**Location: `reference/props/` — NOT under `public/`** (production inputs, not runtime
assets). **Files:** `<id>_ref.png` per prop, 1024×1024. Vehicles and structures whose
proportions carry gameplay (marked ▣) also get `<id>_side.png` — a true orthographic
side profile, same recipe — since image-to-3D keeps whatever proportions the input
has, and these have colliders to fit.

**Shared preamble — prepend verbatim to every prop prompt below:**

> A single environment prop for a stylized-realistic sci-fi video game, centered,
> whole object in frame with a small margin, three-quarter view from slightly above,
> flat even neutral lighting, no cast shadows, plain mid-grey background, no people,
> no text, no watermark. Weathered, used, cleanly readable silhouette. Subject:

For `_side` swap the view phrase for "true orthographic side profile view, no
perspective distortion, identical design and scale".

### Priority 1

| Id | Prompt |
|---|---|
| `trawler` ▣ | "a rusty alien fishing trawler about 16 meters long: high blunt bow, low flat open working deck, boxy deckhouse set aft, a single mast with a boom crane, coiled nets and floats lashed along the gunwales, hull plated in weathered green-grey steel with rust streaks" |
| `tram` ▣ | "an armored monorail tram car about 12 meters long: sleek boxy body with a wedge-shaped nose, riveted gunmetal plating, a completely flat walkable roof with low grab rails, narrow lit windows, amber warning stripes along both sides" |
| `sail_barge` ▣ | "a crashed desert sail barge about 26 meters long listing into the sand: layered bronze-brown armored hull with an open top deck and railings, a leaning broken mast with a torn dark-red sail vane, half-buried and wind-scoured, no wheels" |
| `cargo_crate` | "a cubic sci-fi cargo crate: olive-drab reinforced metal box with a recessed X-braced panel on each face, stenciled faded-yellow hazard chevrons, corner lift lugs, scuffed edges" |
| `fuel_barrel` | "an industrial sci-fi fuel barrel: dark steel drum with two horizontal reinforcement ribs, a bright hazard-yellow band around the upper third, a narrow glowing amber fill-level slit, grimy and dented" |

### Priority 2

| Id | Prompt |
|---|---|
| `freighter` ▣ | "a small parked cargo freighter starship about 11 meters long: cylindrical hull with a rounded dark cockpit blister on the nose, two stubby side wings, deployed landing skids, a lowered boarding ramp, off-white and grey hull with chipped paint and grime streaks" |
| `cargo_crane` ▣ | "an industrial gantry crane: a latticed steel mast about 18 meters tall, a long horizontal boom arm, a cable trolley holding a hanging olive cargo container, a sodium work lamp on the mast, gunmetal and faded safety-orange, greasy" |
| `reactor_core` ▣ | "a sci-fi reactor column forty meters tall, slightly tapering: a segmented industrial cylinder wrapped in pipe runs and conduit bundles, ring flanges every few meters, tall glowing orange coolant channels running its full height, scorched grey metal" |
| `sunken_transport` ▣ | "a sunken prison transport ship about 28 meters long, broken open: two parallel boxy hull sections joined by a flat roof plate leaving an open flooded corridor between them, a blunt collapsed nose, buckled and torn plating, chalky grey-white paint streaked with silt and corrosion" |
| `adobe_tower` ▣ | "a desert adobe watchtower about 11 meters tall: tapering rounded clay tower, a covered lookout platform at the top with slit windows, a ladder up one side, pale sand-colored wind-worn stucco" |
| `adobe_gate` ▣ | "a desert town gate: two thick adobe pylons carrying a wide flat lintel span, carved lantern niches, heavy riveted metal gate leaves standing open, pale sand-colored stucco over stone" |
| `forge_brazier` | "an ancient ceremonial forge brazier about 3.5 meters wide: a broad iron basin on a stepped ring base, glowing embers inside, an anvil horn and hammer rest built into the rim, hanging chain links, blackened cast iron with worn silver inlay" |
| `survey_crawler` | "a wrecked tracked survey crawler about 10 meters long: boxy crew cabin on two broad crawler tracks, a bent sensor mast, cracked windows, a door hanging open, pale grey-blue paint, frost-scoured and abandoned" |

### Priority 3

| Id | Prompt |
|---|---|
| `vaporator` | "a moisture vaporator: a slim seven-meter tapering metal column with stacked square condenser vanes near the top, small pipes and a control box at the base, brushed grey metal, sand-pitted" |
| `tusken_tent` | "a nomad hide tent about 3.5 meters tall: a cone of stitched leather hides and sun-bleached cloth lashed over a frame of crooked poles, bone and horn trophies hung at the entrance flap, dusty earth tones" |
| `alarm_console` | "a freestanding industrial alarm console: an angled dark metal cabinet with a screen, chunky buttons and a keyed panel, conduit running down to the floor, hazard striping on the edges, worn gunmetal" |
| `street_kiosk` | "a compact sci-fi street vendor kiosk: a boxy metal stall with a half-open roll-down shutter, a small counter, a canvas awning, a glowing holographic menu panel, layered stickers and grime, teal and dark grey" |
| `dock_shed` | "a harbour-master's shed about 10 meters long: corrugated metal walls on a riveted frame, a shallow-pitched roof with a stove pipe, round porthole windows, a sliding door, coiled rope and floats hung on the wall, storm-faded green paint and rust" |
| `homestead_dome` | "a desert homestead: a smooth adobe dome about 10 meters across with a short entry vestibule, a rounded doorway with a metal hatch, small vent stacks, pale sand-colored wind-worn stucco" |
| `mythosaur_skull` | "a colossal fossilized skull of a horned leviathan about 8 meters long, half-buried in glassy grey sand: long tusked jaw, broad brow with two great curved horns, deep eye sockets, bone weathered grey-green, cracked and mineral-streaked" |

### Ambient life & backdrop (PLAN.md §16)

Same recipe. The `bantha` is a creature, so like the krykna sheets it takes
orthographic **side, front and top** views on one canvas instead of the prop preamble's
three-quarter view.

| Id | Prompt |
|---|---|
| `bantha` ◆ | "a colossal shaggy quadruped beast of burden, 2.5 meters at the shoulder: long dense brown wool hanging in matted curtains, a broad skull with two great spiral-curved horns sweeping down and forward, small placid dark eyes, thick stumpy legs, a swaying heavy build, a saddle of layered woven cloth and leather cinched behind the hump — orthographic side, front and top views" |
| `sandcrawler` ▣ | "a colossal rusted tracked hauler-fortress about 35 meters long: a towering slab-sided hull of oxidized red-brown plating narrowing to a steeply angled prow, a sealed full-width boarding ramp at the front, rows of tiny lit portholes high on the hull, massive continuous tracks along the base, sand-drifted and ancient" |
| `pipe_rack` ▣ | "a modular industrial pipe run segment about six meters long: a steel wall rack carrying four parallel pipes of mixed diameters with bolted flange joints, one elbow branch dropping to a hand valve wheel, hazard tape at the rack ends, scuffed gunmetal and oxide-red primer" |
| `fish_rack` | "a dockside fish-drying rack about two meters tall: a weathered metal A-frame strung with taut lines, rows of split alien fish hanging to dry, iron hooks, a stained gutting bench at one end, storm-worn timber and rusted steel" |

### Pilotable vehicles (PLAN.md §17)

Same recipe, all ▣ (their colliders and saddle positions are tuned in code, so the
side profile matters). Every one is **empty** — no rider, no hands: the game seats the
player character itself.

| Id | Prompt |
|---|---|
| `speeder_bike` ▣ | "a military scout repulsor speeder bike about 3 meters long, no rider: two long forward outrigger vanes ending in steering fins, a narrow saddle over a compact rear engine block, handlebar controls, footrests, no wheels, hovering, drab grey-brown metal, field-worn" |
| `landspeeder` ▣ | "an open-topped civilian repulsor landspeeder about 4.5 meters long, no driver: rounded weathered bodywork, a single open seat behind a low curved windshield, three turbine engine nacelles across the tail, no wheels, hovering, sun-faded paint over dented metal" |
| `skiff` ▣ | "a repulsor cargo skiff about 9 meters long, no crew: a flat open deck with low side rails, a raised tiller steering platform at the stern, crates lashed down at the bow, no wheels, hovering low, weathered tan and rust-brown plating" |

---

## Monster batch two — 5 canvases, delivered 2026-09-02

Four new creature bosses and one body-section prop, designed in
[`docs/BOSSES.md`](BOSSES.md) §2.7–2.10 so that **every territory has a monster and no
monster serves two** — the Refinery, the Ringworld and the Prison Rig had none, and
the Dune Sea's champion was a war massiff the Lava Flats also field. All are in the
game already as procedural stand-ins; these canvases are the first step of the
standard pipeline (sheet → model → swap), and the model briefs that consume them are
in [`ASSETS_MODELS.md`](ASSETS_MODELS.md#monster-bosses--batch-two).

**All delivered.** The `sandworm` canvas took two passes — the first was modelled
pre-curved into a hook, which the single-body design cannot use — and the replacement
below is the one to model from. `sandworm_arch` was delivered and then retired by that
same design change; it is kept as a record, and no model is wanted for it.

**Status at delivery:**

| Id | Canvas | Verdict |
|---|---|---|
| `zillo` | delivered | **Approved.** Plates and the cyan seams read as the weak zone, three claws a foot, back low enough for the Refinery's 7.2 m ceilings, one scale across all three views. |
| `nexu` | delivered | **Approved.** All four eyes placed as specced, red-tipped quills, forked tail, long-limbed for the pounce. |
| `kwazel_maw` | delivered | **Approved, with one note for the modeller:** the flank stripes came back as thin dashes. Widen them into continuous bands on the sculpt, or they will not read as a weak point at 30 m. |
| `sandworm_arch` | delivered | **Retired, not the art's fault** — see the design change below. Kept in `reference/` as the record; no model is wanted. |
| `sandworm` | delivered | **Superseded — regenerate** (below). |

### The prompts as delivered

The three approved canvases were made from these. Kept as the record a re-sculpt works
from; the two worm rows are gone, superseded by the replacement below.

**Location: `reference/characters/` — NOT under `public/`** (production inputs).
**Files:** one `<id>_ref.png` per subject, 1536×1024, **orthographic side, front and
top views on one canvas** at one consistent scale (the creature recipe above, not
the biped triple). The zillo and the kwazel maw are longer than they are
tall — keep the side view the large one.

**Shared preamble — prepend verbatim to every prompt below:**

> A single colossal creature for a stylized-realistic sci-fi video game:
> orthographic side, front and top views of the identical creature arranged on one
> canvas at one consistent scale, no perspective distortion. Flat even neutral
> lighting, no cast shadows, plain mid-grey background, no people, no environment,
> no text, no watermark. Weathered, battle-scarred, cleanly readable silhouette.
> Subject:

Weak zones called out in a prompt (glowing seams, eyes, flank stripes, the gullet)
must read in the art — they become emissive weak-point meshes on the model. Same
standing rules as every sheet: original fan designs only, described and never named.

| Id | Board | Prompt |
|---|---|---|
| `zillo` | Refinery | "an enormous armored reptilian crawler five meters at the shoulder and twelve meters long, a long flat skull with a lipless underslung jaw and small deep-set eyes, the whole body clad in large overlapping slate-green armor plates with pale flesh glowing faintly cyan in the seams between the plates, four splayed powerful limbs each ending in three heavy claws, a long tail ridged with spines to the tip" |
| `nexu` | Ringworld | "a giant hunting cat the size of a small speeder, 2.2 meters at the shoulder and five meters long, lean and long-limbed: a wide head with a jaw that splits far back past the cheeks, four eyes, two forward and two on the temples, all glowing pale green, a ridge of red-tipped quills standing up along the spine, tawny hide with black rosettes, long claws, a forked tail" |
| `kwazel_maw` | Prison Rig | "a huge amphibious swamp beast 4.2 meters tall and nine meters long hauling itself along on four splayed webbed limbs: a wide flat toad-like head with a mouth that opens the full width of it, bulbous side-set milky eyes, a long low body, a broad flat rudder tail, slick dark blue-black hide with rows of bioluminescent cyan stripes running down both flanks from behind the head to the tail" |

### Replacement generation — `sandworm` (2026-09-02)

The first `sandworm` canvas is good art that the design outgrew, plus three faults of
its own. **What changed in the design:** the worm's body was going to be three separate
arch props following the head. It is now **one continuous animal** whose spine the game
bends along the path the head has travelled, so the humps that break the surface are
the same body, they follow its turns, and they can carry weak points later. That means
the sculpt must be modelled **dead straight**, because a body that is bent in the mesh
cannot be laid along a path. The delivered canvas is modelled pre-curved into a forward
hook, which is unusable for it.

Three faults independent of that, all worth fixing in the regeneration:

- **The three views disagree on proportion.** The top view shows a long segmented tube,
  the side view a short hooked stub, and the front view sits at a smaller scale than
  either. Image-to-3D averages disagreeing views into a confused mesh — one scale, as
  the preamble asks.
- **The maw splits four ways**, where the rig and the animation code name three parts.
  Four is the better look, so the **rig brief has been changed to match the art**
  (`mandibleL/R/T/B`); keep the four-way maw and keep it symmetrical.
- **There is almost no neck** — it reads as a head and a collar. The body must run the
  full length now, so this resolves itself.

`sandworm_arch` is **not** to be regenerated: the single body replaces it.

| Id | Board | Prompt |
|---|---|---|
| `sandworm` (replacement) | Dune Sea (champion) | "the full body of a colossal burrowing desert worm lying perfectly straight and horizontal, forty meters long and two meters thick, in a rigid straight line from end to end with no curve or bend anywhere: a blunt eyeless domed head at one end split four ways by long curved mandibles, two lateral, one upper and one lower, spread open around a circular gullet ringed with rows of inward-curving teeth glowing faintly amber deep inside, behind the head a uniform segmented body of overlapping bone-pale armor plates over sand-ochre hide with a low ridge of dorsal spines along its length, tapering to a blunt tail" |

Because the subject is forty metres long and two thick, the side and top views want the
full width of the canvas as two long bands, with the front view (looking down the
throat) small in a corner. That is the one place this subject departs from the shared
creature layout.

---

## Drop-screen portraits for the playable NPCs — 6 files, delivered

PvP fields every NPC as a fighter; the drop screen already looks for
`portrait_<enemyKind>.jpg` and falls back to the drawn marks. Any of the existing
character sheet subjects can be reframed with the standard portrait recipe above —
highest value first: `tusken`, `stormtrooper`, `pirate`, `pyke`, `officer`, `enforcer`.

All six are on disk as `portrait_<kind>.jpg` and live with no code change — the drop
screen probes for the file and falls back to its drawn marks when there is none. The
playable hunters' three (`ventress`, `embo`, `bossk`) and `ig11` landed earlier and have
their own entries above.
