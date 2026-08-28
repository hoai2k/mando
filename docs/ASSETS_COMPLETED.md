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
