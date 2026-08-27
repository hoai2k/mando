# Asset Requests — Images & Textures

The game generates every texture procedurally at boot, so none of these are required to run. When an authored file is dropped into `public/assets/textures/` with the exact filename below, the loader uses it instead of the procedural fallback (`src/core/assets.ts` handles the check-and-fallback).

**Global specs unless noted:** PNG (or JPG for large photos), power-of-two, sRGB, tileable/seamless where marked, no baked lighting or shadows (lighting is dynamic), no text/watermarks, no recognizable copyrighted logos or exact film-frame reproductions — "inspired by" desert-planet / space-western styling.

## Terrain & environment (Tatooine)

| File | Size | Seamless | Generation prompt |
|---|---|---|---|
| `sand_albedo.png` | 1024² | yes | "Seamless tileable texture of fine wind-rippled desert sand, warm ochre-gold color, gentle parallel wind ripples, top-down view, soft even lighting, no shadows, photorealistic, 1024x1024" |
| `sand_normal.png` | 1024² | yes | "Seamless tileable normal map of wind-rippled desert sand dunes, gentle parallel ripples, purple-blue normal map format, 1024x1024" |
| `rock_albedo.png` | 1024² | yes | "Seamless tileable texture of sun-baked desert sandstone rock, layered sedimentary strata, warm tan and rust bands, dry cracked surface, even lighting, no shadows, 1024x1024" |
| `adobe_wall.png` | 1024² | yes | "Seamless tileable texture of smooth adobe stucco wall, pale sand color, subtle hand-troweled texture, faint wind-worn streaks, desert architecture, even lighting, 1024x1024" |
| `tent_cloth.png` | 512² | yes | "Seamless tileable texture of rough woven canvas tent cloth, sun-bleached beige-brown, coarse fiber weave, patched and dusty, even lighting, 512x512" |

## Structures & props (both boards)

| File | Size | Seamless | Generation prompt |
|---|---|---|---|
| `metal_deck.png` | 1024² | yes | "Seamless tileable texture of industrial spaceship deck plating, gunmetal grey steel, hexagonal tread pattern, oil stains and scuffs, scratched edges, even lighting, 1024x1024" |
| `metal_hull.png` | 1024² | yes | "Seamless tileable texture of weathered spacecraft hull panels, off-white and grey painted metal with chipped paint revealing steel, rivets and panel lines, grime streaks, even lighting, 1024x1024" |
| `crate_side.png` | 512² | no | "Face texture of a sci-fi cargo crate, olive-drab reinforced metal box panel with recessed X-brace, stenciled hazard chevrons in faded yellow, scuffed corners, front-on view, even lighting, 512x512" |
| `barrel.png` | 512² | horizontal | "Wrap-around texture of an industrial sci-fi fuel barrel, dark steel with two horizontal reinforcement ribs, faded orange hazard band, grimy, even lighting, 512x512" |
| `neon_sign.png` | 512×256 | no | "Alien cantina neon sign on black background, glowing teal and magenta abstract alien glyphs (invented script, not a real language), slight glow bloom, 512x256" |

## Skies (used as equirect env or backdrop — procedural shader remains default)

| File | Size | Prompt |
|---|---|---|
| `sky_desert.jpg` | 4096×2048 equirect | "360 equirectangular panorama of a desert planet sky at late afternoon, two suns (one large white-gold, one smaller orange) low over endless dunes, pale bleached blue fading to warm ochre horizon haze, few thin clouds, no ground objects, photorealistic" |
| `sky_space.jpg` | 4096×2048 equirect | "360 equirectangular deep space panorama, dense starfield, large wispy purple-and-orange nebula on one side, a distant banded amber gas giant planet, dark and moody, photorealistic astrophotography style" |

## UI / 2D

| File | Size | Prompt |
|---|---|---|
| `board_tatooine.jpg` | 800×450 | "Cinematic wide shot of a desert planet at golden hour: endless ochre dunes, a lone armored bounty-hunter silhouette with jetpack overlooking a distant adobe town, twin suns, heat haze, concept-art style" |
| `board_waystation.jpg` | 800×450 | "Cinematic shot of a grimy industrial space station of scattered floating platforms and cranes around a central refinery spire, purple-orange nebula behind, sodium work-lights, tiny flying armored figure between platforms, concept-art style" |
| `title_bg.jpg` | 1920×1080 | "Moody dark cinematic key art, weathered green-and-maroon armored bounty hunter helmet in dramatic rim light against a dusty dark background, embers drifting, space-western tone, concept-art style, no text" |

## Character texture sheets (post-MVP, for authored models)

When authored glTF characters arrive they should ship with their own textures; no requests here yet. If we upgrade procedural characters first, request per-character 512² "armor wear" detail maps: "Seamless tileable texture of scratched weathered painted armor plate, [green / maroon / slate-teal / bone-white] paint over silver metal, chips, scrapes and blaster scorch marks, even lighting."
