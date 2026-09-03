# Asset Requests — Images & Textures

**Open image requests only.** Everything delivered — with its original prompt — lives in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md); nothing that has landed is described here.
Once a request is filled it moves there, and anything that builds on it (the 3D model
briefs, say) cites the resulting filename from there.

**Open: the Missions v3 outdoor surface set (2026-09-03)** — see
[below](#missions-v3--outdoor-surfaces-requested-2026-09-03). Everything before it was
delivered by 2026-09-02, some of it weeks earlier, and has moved to the history doc:
the 27 environment prop reference sheets (all with their models in the game), the six
optional drop-screen portraits for the playable NPCs, and the second monster batch's
five canvases including the replacement `sandworm`. The cast, the boards, the skies,
every surface texture, the campaign's planet strip and corridor interiors, the weapon
sheets, the logo and the favicon were already in and wired.

What remains below is not a request: the recipe for making more character sheets, and
the record of three sets deliberately **not** wanted, kept because each says something a
future request would otherwise have to rediscover.

The model side ([`ASSETS_MODELS.md`](ASSETS_MODELS.md)) carries the mouth re-exports
for the older creature rigs and a small optional outdoor set for the same Missions
design.

**Global specs unless noted:** sRGB, no baked lighting or shadows (lighting is dynamic), no
text or watermarks, no logos, and no reproductions of copyrighted designs — describe the
design, never name a trademarked character or film frame. (The game's own logo and favicon
were the one deliberate exception; both are delivered.)

Runtime textures land in `public/assets/textures/` and the loader tries `.jpg` then `.png`.
Production-only reference art lives in `reference/` and is **not** shipped.

## Missions v3 — outdoor surfaces, requested 2026-09-03

Opened by `docs/MISSIONS_OUTDOOR.md`, the redesign of the mission levels as outdoor
zones held in by terrain: open ground, ravines, roads, a hallway beat behind a door in
a cliff. The level's borders are **rim** pieces — noised cylinders 36 m and taller —
and its floors are wide plates under the sky, and neither has a surface made for it:
every environment texture in the game is a top-down ground tileable or a small-scale
panel. A 36 m cliff face wants a *face*. All of these are pre-wired in design (each
`ridge` style and each outdoor floor names its texture and keeps the palette colour as
the fallback), so arriving at the path is the integration, as with the corridor set.

**Specs:** seamless tileable, 1024×1024 unless noted, sRGB, even lighting, no shadows,
no text. Cliff faces are viewed **side-on from 2–40 m** — so their features must be
large (strata bands, fracture planes, rivet seams a metre apart), not the fine grain of
the ground textures; each cliff also gets a matching normal map (`_normal.png`).
Grounds are top-down like the existing set. Land in `public/assets/textures/`.

### Cliff faces — one per `ridge` style (priority 1)

| File | Where | Prompt |
|---|---|---|
| `cliff_sandstone.jpg` + `cliff_sandstone_normal.png` | Dune Sea rims, pillars and mesas; the Refinery's rock behind its tanks | "Seamless tileable texture of a tall desert sandstone cliff face seen side-on: thick horizontal strata bands in warm tan, ochre and rust, wind-scoured overhangs and vertical fracture planes, patches of pale dust in the ledges, large-scale features, even lighting, no shadows" |
| `cliff_basalt.jpg` + normal | Lava Flats rims and pillars | "Seamless tileable texture of a columnar basalt cliff face side-on: tightly packed vertical hexagonal basalt columns in dark charcoal-grey, broken column tops, thin ember-orange glow deep in a few of the seams, ash dusting the ledges, even lighting, no shadows" |
| `cliff_ice.jpg` + normal | Crevasse rims, ice pillars, the nest-mouth door surround | "Seamless tileable texture of a glacier wall side-on: pale blue-white ice with deep blue translucent depth, horizontal compression bands, vertical melt grooves, frost bloom and fine white fracture lines, wind-packed snow lodged on ledges, even lighting, no shadows" |
| `cliff_ruin.jpg` + normal | Great Forge rims (collapsed facades, fused dunes) and pylons | "Seamless tileable texture of a war-ruined stone facade side-on, partly melted to green-grey glass: blast-scorched carved masonry with shallow angular sigil relief, sections slumped and fused into smooth vitrified glass, heat-cracked, ash-streaked, even lighting, no shadows" |
| `tank_wall.jpg` + normal | Refinery rims: the storage tanks and fence walls | "Seamless tileable texture of the side of a huge industrial storage tank: curved riveted steel plates in oxidised grey-green, horizontal reinforcement ribs, a faded yellow-black hazard band, stencilled numbering worn to illegibility, rust weeping from the rivet lines, even lighting, no shadows" |
| `warehouse_wall.jpg` + normal | Storm Docks rims: the warehouse rows | "Seamless tileable texture of a harbour warehouse wall side-on: tall corrugated iron sheets over a timber frame, green-black paint peeling to rust, salt streaks, barnacle crust at the base band, a row of small dark windows high up, even lighting, no shadows" |
| `hull_plate_large.jpg` + `hull_plate_large_glow.jpg` + normal | Spice Run: the station's 120 m hull face and the Prison Rig's hull walls (tinted white at runtime) | Albedo: "Seamless tileable texture of a very large spacecraft hull seen side-on at distance: metre-scale armour panels in off-white and grey with chipped paint, heavy panel seams, recessed conduit runs, docking-light housings, a few vents and greebles, grime streaks, even lighting, no shadows, 2048×2048". Glow (emissive, same layout): "matching emissive map, near-black with small docking lights in amber and pale blue along the seams and a few lit porthole strips" |

### Outdoor floors — the themes that have none (priority 2)

| File | Where | Prompt |
|---|---|---|
| `ash_ground.jpg` | Lava Flats open zones and the causeway | "Seamless tileable top-down texture of a volcanic ash flat: fine grey-black ash with wind ripples, scattered pumice pebbles, faint pale mineral crust, even lighting, no shadows" |
| `glass_plain.jpg` | Great Forge open zones and the glass highway | "Seamless tileable top-down texture of ground fused to glass by a great heat: smooth green-grey vitrified surface with frozen ripples and bubbles, cracked into large plates, dust in the cracks, faint reflections, even lighting, no shadows" |
| `street_paving.jpg` | Ringworld plazas and streets | "Seamless tileable top-down texture of a sci-fi city street: large interlocking dark composite paving slabs with fine seams, a worn lane stripe in faded teal, drain grilles, scuffs and stains, even lighting, no shadows" |
| `dock_planks.jpg` | Storm Docks quays and piers | "Seamless tileable top-down texture of a weathered harbour pier: wide grey-brown timber planks with iron bolts, gaps between planks, salt-bleached and wet-dark patches, rope fibres and fish scales caught in the gaps, even lighting, no shadows" |
| `scree_ground.jpg` | ravine floors on the Dune Sea and the Crevasse (tinted per palette) | "Seamless tileable top-down texture of a canyon floor: packed gravel and angular scree in mixed grey-tan stone, a few larger flat rocks, dry silt between, even lighting, no shadows" |
| `sea_surface.jpg` + `sea_surface_normal.png` | the local water plane on the Storm Docks and the Prison Rig | "Seamless tileable top-down texture of a cold harbour sea surface: dark green-grey water with short choppy wind waves, foam flecks, slight oily sheen, even lighting, no shadows". Normal: "matching seamless normal map of short choppy waves" |

### Ridge silhouettes and small alphas (priority 3)

| File | Where | Prompt |
|---|---|---|
| `ridge_silhouette_desert.png`, `_basalt.png`, `_ice.png`, `_ruin.png` (2048×512 PNG, alpha) | the horizon strip above each level's backdrop row — the `skyline_silhouette` technique, one per ridge family | "Wide horizontal silhouette strip of a distant [desert mesa range / jagged volcanic ridge / ice peaks and seracs / ruined city skyline melted into glass], solid near-black shapes on a transparent background, seamless left-to-right, no gradient, no text" — one image per bracketed subject |
| `energy_cells.png` (512×512 PNG, alpha) | the fence pane and the ceiling-contact shimmer | "Seamless tileable alpha pattern of a fine hexagonal energy-field cell grid: thin bright lines on transparent, slightly irregular brightness per cell, no colour" |

Not requested: a cliff **model** set (the rims are noised cylinders merged per zone,
which the design prefers for a while — it is what lets a layout change in an
afternoon), and any new sky (the nine panoramas already cover every level, since a
mission level sits under its territory's sky).

## Making more character reference sheets

Every character in `ASSETS_MODELS.md` already has its three views, so this section is
here for the next character rather than for anything outstanding. Delivered sheets and
their prompts are in the history doc.

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

## Not wanted — reference sheets for the mouth re-exports (2026-09-02)

The re-export request in
[`ASSETS_MODELS.md`](ASSETS_MODELS.md#re-exports--openable-mouths-on-the-older-creature-rigs-2026-09-02)
asks for a jaw on the massiff, the krykna and the broodmother. **No new art is needed
for it**: nothing about the creatures' design changes, and the ask is purely a rig
addition. The existing `massiff_front/side/back.png` and `krykna_ref.png` stay the
reference. The mouth audit behind that request, and what it means for future prompts,
is written up in the model doc.

## Not wanted — troop carrier reference sheets

Overtaken by their own models, delivered 2026-08-30: a sheet drawn now would be
traced from the sculpt rather than the other way round. Prompts kept below as the
design a re-sculpt has to match; model briefs in
[`ASSETS_MODELS.md`](ASSETS_MODELS.md#troop-carriers--requested-and-delivered-2026-08-30). Vehicle
recipe, like the swoop and the skiff: **orthographic side, front and top views on one
canvas**, 1536×1024, one consistent scale, flat even lighting, plain mid-grey
background, no pilots, no text. Files to `reference/props/`.

| Id | Prompt |
|---|---|
| `troop_carrier` | "a boxy military sci-fi troop transport aircraft about 15 meters long: slab-sided gunmetal-grey armored fuselage, a blunt cockpit with a narrow visor band, two short anhedral wings with a big engine nacelle each, open side drop-doors along the belly, hazard striping at the door sills, no landing gear, in level flight" |
| `raider_dropship` | "a scabbed-together outlaw dropship about 14 meters long: asymmetric rust-brown and bare-metal hull plates over an old cargo lifter frame, mismatched welded patches, a bulbous scavenged cockpit, four crooked engine pods on pylons, an underslung open drop bay with chain rigging, no landing gear, in level flight" |

## Not wanted — monster boss reference sheets

The visual reference for the six monster bosses designed in
[`docs/BOSSES.md`](BOSSES.md). **They were overtaken by their own models**: all six
sculpts were delivered and wired on 2026-08-29 without them, so a sheet would now be
drawn from the model rather than the other way round. The prompts stay below for one
reason only — if a monster is ever re-sculpted, this is the design it has to match, and
the model brief in
[`ASSETS_MODELS.md`](ASSETS_MODELS.md#monster-bosses--requested-and-delivered-2026-08-29)
carries the rig and the constraints alongside it.

**Location: `reference/characters/` — NOT under `public/`** (production inputs).
**Files:** these are creatures, so like the bantha and krykna they take
**orthographic side, front and top views on one canvas** instead of the biped
front/side/back triple: one `<id>_ref.png` per monster, 1536×1024. The mamacore,
krayt and mythosaur are longer than they are tall — keep the side view the large
one and let front/top share the remaining band, all three at one consistent scale.

**Shared preamble — prepend verbatim to every monster prompt below:**

> A single colossal creature for a stylized-realistic sci-fi video game:
> orthographic side, front and top views of the identical creature arranged on one
> canvas at one consistent scale, no perspective distortion. Flat even neutral
> lighting, no cast shadows, plain mid-grey background, no people, no environment,
> no text, no watermark. Weathered, battle-scarred, cleanly readable silhouette.
> Subject:

Weak zones called out in a prompt (a glowing gullet, gill frills, throat) must read
in the art — they become emissive weak-point meshes on the model, so the sheet is
where their placement gets decided. Same standing rules as every sheet: original fan
designs only, described and never named.

| Id | Prompt |
|---|---|
| `mudhorn` | "a hulking woolly one-horned beast 2.6 meters at the shoulder and 4.5 meters long: a single huge forward-curved horn on a broad armored nose boss, a coat of shaggy dark-brown matted wool over a humped muscular rhinoceros build, four stout legs with cloven hooves, small furious deep-set eyes, a short tufted tail" |
| `ravinak` | "a massive tusked sea-beast eight meters long built like an armored walrus-crocodile: a blunt whiskered snout with two great down-curved ivory tusks, a wide blubbered body in slate-grey hide with barnacled bone plates along the back, a pale soft throat, four broad clawed flippers, a heavy tapering tail" |
| `mamacore` | "a monstrous deep-harbor fish twelve meters long: a cavernous circular mouth ringed with rows of needle teeth, long barbels trailing from the jaw, a scarred storm-grey mottled hide, a pale belly, rows of faintly glowing pale gill frills behind the head, stubby side fins, a broad flat eel tail, small milky eyes" |
| `rancor` | "a towering hunched reptilian brute five meters tall: massive long-clawed arms longer than its legs, a flat wide skull with an underslung jaw and short tusks, small deep-set eyes, leathery umber-brown hide creased with old fighting-pit scars, thick stumpy legs, a short heavy tail" |
| `krayt_dragon` | "the front eighteen meters of a colossal burrowing desert dragon emerging from the ground: a broad flat skull with a wide jaw crammed with teeth, four small pale eyes, a frilled bone collar, a thick armored neck of overlapping rings, two clawed burrowing forelimbs, a long tapering serpent body ridged with sand-worn plates, bone-white and ochre hide, a faint amber glow deep inside the open gullet" |
| `mythosaur` | "the head, neck and forelimbs of an ancient horned leviathan rising from dark water, twelve meters of creature: a broad armored skull with two great down-swept curved horns, glowing pale eyes, a tusked underbite jaw, ridged black-green hide streaked with mineral scale, heavy overlapping neck plates, two powerful clawed forelimbs, paired glowing gill vents on the throat" |

The mythosaur must read as the living animal of the delivered `mythosaur_skull`
sculpt — same horn sweep, same tusked jaw — since the game half-buries that skull
thirty meters from where the creature surfaces.

