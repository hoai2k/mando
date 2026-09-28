# Asset Requests — Images & Textures

**Open image requests only.** Everything delivered — with its original prompt — lives in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md); nothing that has landed is described here.
Once a request is filled it moves there, and anything that builds on it (the 3D model
briefs, say) cites the resulting filename from there.

**Open as of 2026-09-28:** the unchosen UI concept art and optional fighter poses in
[Open — front-end UI concepts](#open--front-end-ui-concepts-2026-09-28) below.
The nine Missions system vistas from round 4 are delivered; the galaxy arm
background remains optional.
The Twin Suns title, its armored-posse variant, and Wanted loading assets are delivered. Gameplay-section keyframes raised by
[`LEVEL_SECTIONS.md`](LEVEL_SECTIONS.md) are delivered; supporting images are
conditional on choosing sections for building. Before those batches there were no
open requests (as of 2026-09-24). The Jedi and Maris
canonical views, the five-hilt collection, and the two Sith character
front sheets are saved under `reference/characters/`. The Spice Run sky frigate's
canonical three-view sheet lives in `reference/props/` and is recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md). The Guild Gunslinger and Escort Droid
front, side and back sheets now live in `reference/characters/` and are recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md). The Missions v3 outdoor
surface set was requested and delivered on 2026-09-03 and is wired into the mission
stages, so it has moved to the history doc along with everything before it:
the 27 environment prop reference sheets (all with their models in the game), the six
optional drop-screen portraits for the playable NPCs, and the second monster batch's
five canvases including the replacement `sandworm`. The cast, the boards, the skies,
every surface texture, the campaign's planet strip and corridor interiors, the weapon
sheets, the logo and the favicon were already in and wired.

The 2026-09-25 enemy weapon audit added
[`enemy_weapon_collection_v1.png`](../reference/characters/enemy_weapon_collection_v1.png):
five separated rows for an infantry blaster rifle, pirate boarding club,
flame projector, net launcher, and stone club. One Tripo generation produced
five separable 3D props, processed and integrated as described in
`ASSETS_MODELS.md`.

`reference/characters/maris_brood_front_left_stylized.png` is the selected
Maris front; matching side and back sheets and an authored playable model are
delivered. The earlier `maris_brood_front.png` remains for comparison.

`reference/characters/jedi_saber_options.png` is a four-hilt comparison sheet
for design review: the current Jedi concept, a slim heroic hilt, a double hilt,
and a dark armored hilt. It is exploration art, not four approved canonical
model references. Generate a clean individual reference for any selected hilt
before making its 3D prop.

`reference/characters/saber_hilt_collection.png` is the five-hilt successor,
adding Maris Brood's short tonfa-style guard shoto as the bottom row. It is
laid out with detached silhouettes and generous gaps for a possible shared
image-to-3D generation and later segmentation. The art does not guarantee
that a generator will produce five disconnected mesh components; inspect the
result before relying on automatic separation. Blades are runtime FX, so no
blade color or glow is baked into this sheet.
`reference/characters/saber_hilt_collection_v2.png` and `_v3.png` record
intermediate tonfa revisions. The canonical generation input is
`saber_hilt_collection_v4.png`: cleaner surfaces, five separated rows, and a
tonfa emitter on the long end. Its Tripo model split successfully into five
individual GLBs, described in [`ASSETS_MODELS.md`](ASSETS_MODELS.md).

`reference/characters/sith_leader_front.png` is the hooded, masked leader
based on the supplied two references. `sith_soldier_front.png` is the horned,
red-and-black marked warrior based on the supplied image. Their 3D models are
integrated as playable Darth Revan and Darth Maul, respectively. Either may
also appear as a hostile when nobody in the party selected that identity.

What remains below is not a request: the recipe for making
more character sheets, and
the record of three sets deliberately **not** wanted, kept because each says something a
future request would otherwise have to rediscover.

The model side ([`ASSETS_MODELS.md`](ASSETS_MODELS.md)) carries a small optional
outdoor set for Missions v3. The older spider mouth re-exports were closed by
decision on 2026-09-24.

**Global specs unless noted:** sRGB, no baked lighting or shadows (lighting is dynamic), no
text or watermarks, no logos, and no reproductions of copyrighted designs — describe the
design, never name a trademarked character or film frame. (The game's own logo and favicon
were the one deliberate exception; both are delivered.)

Runtime textures land in `public/assets/textures/` and the loader tries `.jpg` then `.png`.
Production-only reference art lives in `reference/` and is **not** shipped.

## Open — front-end UI concepts (2026-09-28)

Art for the title, character select and loading screen redesign explored in
[`UI_CONCEPTS.md`](UI_CONCEPTS.md). Round 3 chose the Twin Suns title and Wanted
loading screen. Their three background assets are delivered and recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md#chosen-ui-backgrounds--3-files-delivered-2026-09-28).
The other concept assets stay here pending a choice to use them. Every concept
swaps the 3D pedestals for a portrait grid.

Runtime files land in `public/assets/textures/`. Same global specs as everything else
in this doc: no text, no logos, no watermarks, original designs described rather than
named.

### Wanted for any concept — the portrait grid

The existing portraits are 512×614 JPEG, head and shoulders, warm key light from the
upper left on a near-black background.

**Done (2026-09-28), rendered rather than generated.** `portrait_din.jpg`,
`portrait_maul.jpg` and the missing `portrait_boba_fett.jpg` are shots of the authored
models, lit and framed in the painted portraits' style by `tools/portraits.mjs`
(`node tools/portraits.mjs din maul boba_fett`; per-fighter framing is in its `FRAMING`
table). The same tool is the fallback for any future fighter the image generator cannot
be trusted with.

### Concept B — "Twin Suns", the widescreen showdown

| File | Size | Prompt |
|---|---|---|
| `pose_<id>.png` (optional) | 768×1536, transparent | Full-body action-pose cut-outs, one per playable fighter, for the tall lineup strips. Optional: the strips work with the current head-and-shoulders portraits cropped tall, so ask for these only if the portrait crops feel too tight in the build. |

### Concept C — "Navicomputer", the salvaged gunship console

| File | Size | Prompt |
|---|---|---|
| `ui_cockpit_frame.png` | 1920×1080, transparent centre | "First-person view from the pilot seat of a battered small gunship: heavy gunmetal canopy struts framing the view, a console lip along the bottom edge with worn toggle switches, amber indicator lamps, hazard-striped trim, scuffed paint and rivets. The canopy glass area must be fully transparent (alpha) so a background can show through. No text." |
| `ui_hyperspace.jpg` | 1920×1080 | "Looking forward into a hyperspace tunnel: pale blue-white star streaks converging to a bright vanishing point slightly right of centre, faint amber haze at the edges, motion blur. No ships, no text." |

### Concept D — "Sabacc", cards on a cantina table

| File | Size | Prompt |
|---|---|---|
| `ui_felt.jpg` | 1024×1024, tileable | "Seamless tileable top-down texture of worn dark teal card-table felt with faint cigarette burns, drink rings and brushed nap. Flat even lighting, no text." |
| `ui_card_back.png` | 512×720 | "The back of an ornate sci-fi gambling card: deep burgundy field, a fine gold geometric border, a symmetrical original emblem of interlocking diamonds and a stylised crescent in the centre, slight wear on the corners. Flat lighting, no text, no real-world logos." |
| `title_cantina.jpg` | 1920×1080 | "Interior of a dim frontier cantina at night, seen from a gambling table: blurry patrons in the background, glowing pink and cyan neon tubes, a curved bar, haze and smoke, warm pools of light on a green-felt table in the foreground with scattered chips. Leave the upper centre calm for a logo. No legible text." |

## Optional — galaxy map background

The nine Missions system vistas are delivered in `public/assets/textures/` and
recorded in [`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md#missions-system-vistas--9-files-delivered-2026-09-28).
The background below is optional for the galaxy-map-with-a-lens layout.

**Optional, for the "galaxy map with a lens" layout:**

| File | Size | Prompt |
|---|---|---|
| `galaxy_arm.jpg` | 2560×1440 | "Top-down view along one spiral arm of a galaxy, a long band of warm gold and pale violet star clouds running left to right across the middle, dark dust lanes, scattered bright stars, deep black above and below the band. No text, no labels." |

## Gameplay sections — supporting images (conditional)

The 18 keyframe concepts requested by [`LEVEL_SECTIONS.md`](LEVEL_SECTIONS.md) are
delivered in `reference/sections/` and recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md#gameplay-sections--18-keyframe-concepts-delivered-2026-09-28).
The supporting images below remain conditional on choosing a section for building.

**Supporting images — generate only when a section is picked.** Each is listed under the
section that needs it. If a section is not chosen for building, its images are never
made. Global specs above apply. Prop sheets follow the vehicle and prop recipe
(orthographic side, front and top on one 1536×1024 canvas, one scale, flat even
lighting, plain mid-grey background, no people, no text) into `reference/props/`.
Textures are 1024×1024 seamless into `public/assets/textures/`.

| Section | File | Prompt |
|---|---|---|
| Worm Sign | `thumper_ref.png` | "a desert nomad's sand-thumper: a 2.4 meter tripod of lashed scavenged pipe and bone with a heavy iron piston hammer on a crank, a counterweight of stones in a net, leather straps and prayer ribbons, a spike foot, built to be carried and planted in sand" |
| Ring Walk | `ring_hull_spine.jpg` | "Seamless tileable top-down texture of a spacecraft hull walkway: large riveted grey armor plates with a raised central conduit trough, anti-slip tread strips, faded yellow edge hazard bands, scorch marks, micrometeor pitting, even lighting, no shadows" |
| Guns of the Frigate | `quad_turret_ref.png` | "a dorsal ship's quad blaster turret about 4 meters across: a squat armored rotating dome with four long stacked cannon barrels, an open gunner's seat behind a curved armor shield, heat-sink fins, chipped gunmetal-grey paint with rust-brown patches" |
| Guns of the Frigate | `pirate_corvette_ref.png` | "a scabbed-together outlaw corvette about 60 meters long: an old cargo hull with welded armor slabs, a long spinal cannon along the keel, three bulbous shield generator domes on pylons, mismatched engine pods, rust-brown and bare metal, in level flight" |
| Glacier Chute | `glacier_chute.jpg` | "Seamless tileable top-down texture of smooth glacier ice worn into a slide channel: pale blue-white ice with long parallel skid grooves and scratches running one direction, frost dust in the grooves, a few dark inclusions, even lighting, no shadows" |
| Lamplight | `web_sheet.png` (alpha) | "Seamless tileable alpha texture of dense spider silk sheeting: thick irregular pale strands and translucent membranes, a few clumps and dew beads, white on transparent, no colour" |
| Lights Out | `searchlight_tower_ref.png` | "an industrial security searchlight tower 14 meters tall: a lattice steel mast with a caged ladder, a small platform at the top with a large drum searchlight on a motorised yoke, a sensor mast, a hazard-striped base, oxidised grey-green steel" |
| The Line | `conveyor_belt.jpg` | "Seamless tileable top-down texture of a heavy industrial conveyor belt: dark rubberised segmented belt with raised transverse cleats, worn to bare metal at the edges, oil stains and grit, even lighting, no shadows" |
| The Line | `hydraulic_press_ref.png` | "a heavy industrial hydraulic press gantry spanning a conveyor, 8 meters wide and 7 meters tall: two thick steel columns, a massive press head on four hydraulic rams, hazard striping on the press face, hoses and gauges, grimy grey-yellow paint" |
| Covert Sky | `flak_tower_ref.png` | "an improvised air-defence flak emplacement on a ruined stone tower top: a twin-barrelled rotating flak cannon on a sandbagged ring of rubble, ammunition crates, a sensor dish, scorched stone, all about 6 meters across" |
| Hold the Forge | `beskar_barricade_ref.png` | "a waist-high curved portable barricade of dark blue-grey forged metal, 3 meters wide and 1.2 meters tall, hammered plate with a riveted rim, a fold-out brace foot behind, a simple engraved crest of a horned skull on the face, battle-dented" |
| The Mark Runs | `rooftop.jpg` | "Seamless tileable top-down texture of a sci-fi city rooftop: dark weatherproof membrane panels with seams, small vent grilles, cable runs, puddle stains, faded teal service markings, even lighting, no shadows" |
| One Way Out | `prisoner_front.png`, `_side.png`, `_back.png` | Use the character preamble above. Subject: "a gaunt adult prison laborer in a plain pale work jumpsuit with numbered chest and shoulder patches, a thin grey padded work vest, soft rubber-soled boots, cropped hair, hands empty, worn and tired" |
| The Lift | `shaft_wall.jpg` + `shaft_wall_normal.png` | "Seamless tileable texture of the inside wall of a tall industrial lift shaft seen side-on: white composite panels with heavy horizontal ribs every metre, recessed guide rails, small amber marker lights in the rib line, grime streaks running down, even lighting, no shadows" |

## Making more character reference sheets

Every character in `ASSETS_MODELS.md` now has its three
views, so this section is here for the next character too. Delivered sheets and their
prompts are in the history doc.

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

The now-closed re-export brief in
[`ASSETS_MODELS.md`](ASSETS_MODELS.md#re-exports--openable-mouths-on-the-older-creature-rigs-2026-09-02)
describes a jaw on the massiff and fang bones for the krykna and broodmother. **No new art is needed
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
