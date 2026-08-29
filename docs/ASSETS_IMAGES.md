# Asset Requests — Images & Textures

**Open image requests only.** Delivered images are recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md) with their original prompts.

**Open: three hunter drop-screen portraits and the 2026-08-29 environment batch below**
(prop reference sheets for the environment and ambient-pass models plus the runtime
textures). The `saber_curved`, `crossbow` and `longrifle` weapon sheets and 26
drop-screen portraits landed on 2026-08-29; the `ventress`, `embo` and `bossk`
turnarounds on 2026-08-28. The weapon *models* those sheets were drawn for are
**parked by decision** — the signature weapons keep their procedural builds for now —
and the fourth sheet, `pistol`, is parked with them. Everything older — every
environment, sky and UI texture, all nine boards' card art and skies, the surface
textures, and the A-pose turnaround sheets for the whole cast — is delivered and
integrated.

Every image request for the project belongs in this file; once delivered it moves to the
history doc, and anything it feeds (such as the 3D model briefs) references the resulting
filenames from there.

**Global specs unless noted:** sRGB, no baked lighting or shadows (lighting is dynamic), no
text or watermarks, no logos, and no reproductions of copyrighted designs — describe the
design, never name a trademarked character or film frame.

Runtime textures land in `public/assets/textures/` and the loader tries `.jpg` then `.png`.
Production-only reference art lives in `reference/` and is **not** shipped.

## Making more character reference sheets

Every character in `ASSETS_MODELS.md` has its three views (`ventress`, `embo` and
`bossk` landed 2026-08-28), recorded in the history doc. This is the recipe.

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

## Playable bounty hunter sheets (delivered)

The three hunter sheets below are delivered; they stay here as the record of the set
until the models land and everything moves to the history doc. The blue-skinned
gunslinger needed no sheets — the delivered `duelist` set already is that design.

Same recipe as above: shared preamble + the Subject line below, three views each at
matched pixel heights. **Two additions for this set:** every playable flies, so include a
low-profile twin-nozzle thruster backpack, form-fitted to the character and visible in the
side and back views; and where a weapon hilt is described it is hilt only, never an
ignited blade — blades are FX meshes the game manages.

| Id | Height | Subject |
|---|---|---|
| `ventress` ✅ delivered | 1.79 m | "a pale ash-grey-skinned bald female assassin, gaunt striking features with dark markings crowning the bare scalp, a fitted sleeveless grey-black bodysuit under a long split skirt panel, forearm wraps, two curved-hilt sword grips holstered crossed at the back of the belt" |
| `embo` ✅ delivered | 1.78 m | "a broad-shouldered olive-green-skinned bounty hunter alien, pale eyes over a slatted bamboo-like rebreather mask covering the lower face, a very wide circular flat-brimmed woven-metal hat, a fur-trimmed short poncho over banded leather-and-plate armor, heavy gauntlets, a compact crossbow-style blaster holstered at the hip" |
| `bossk` ✅ delivered | 1.90 m | "a hulking reptilian bounty hunter, yellow-green scaled hide, a wedge-shaped snout full of needle teeth, slit orange eyes, clawed three-fingered hands and heavy clawed feet, wearing a worn yellow-tan flight suit with the sleeves rolled, a padded chest rig and ammo bandoliers" |

### Hunter weapon prop sheets — delivered, and the models parked

`saber_curved.png`, `crossbow.png` and `longrifle.png` landed in `reference/characters/`
and are recorded with their prompts in [`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md). The
**models** they were drawn for are **parked by decision** (2026-08-29): the game keeps its
procedural weapons, which read well at gameplay distance, and no code waits on a file. The
fourth sheet, `pistol` — Rook Vance's twin heavy pistols — was never produced and is not
wanted while that holds; its prompt is kept here for whenever it is:

| Id | Prompt |
|---|---|
| `pistol` (parked) | "a heavy sci-fi blaster pistol: a boxy receiver, a short thick barrel ending in a flared muzzle, an angled grip, a small top sight, scuffed gunmetal and worn dark steel" |

## Open — drop-screen portraits: the hunter trio (priority 3)

26 portraits landed 2026-08-29 (recorded in the history doc) — every Mandalorian and
every enemy kind the drop screen shows. Still open: the three playable hunters, who
joined the roster after the batch was made.

Drop them at `public/assets/textures/portrait_<id>.jpg`. Nothing else needs
changing: the loader tries the file and keeps its drawn mark if it 404s, and a
missing portrait never delays the drop it illustrates.

- **Format:** 512×614 (5:6 portrait), JPEG, quality 82.
- **Framing:** head and shoulders, facing camera, filling the frame.
- **Lighting:** single warm key from the upper left against a near-black
  background, matching the menus' lit-from-above look.
- **Ids:** `ventress`, `embo`, `bossk` — subjects per their delivered turnaround
  sheets in `reference/characters/`.

## Open — environment prop reference sheets (for image-to-3D)

The visual reference for the environment models opened in
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

## Open — environment textures (runtime)

Textures the audit found boards visibly missing, plus the backdrop textures for the
ambient pass (`PLAN.md` §16). Unlike earlier batches these are
**not yet requested by name in code** — each needs one `loadOptionalTexture` call (or a
material swap) wired in its board module when it lands, noted per row. Specs per the
global rules; seamless tileable unless noted.

| Id | For | Prompt / notes |
|---|---|---|
| `city_facade.jpg` + `city_facade_glow.jpg` | Ringworld building blocks (`world/ringworld.ts`) | The buildings are random-sized boxes under the generic hull texture, so a facade texture — not a model — is the upgrade. Albedo: "Seamless tileable texture of a dense sci-fi city building facade: stacked metal panels, narrow horizontal window strips, vents and conduit runs, subtle grime streaks, gunmetal grey-blue, even lighting, 1024×1024". Glow (emissive map, same layout): "matching emissive map, near-black with scattered lit window strips in warm amber and pale teal". Wiring: swap `buildingMat`'s map + add emissiveMap. |
| `neon_sign_2.png`, `neon_sign_3.png` | Ringworld street signs | Today four flat colour planes. Same recipe as the delivered `neon_sign.png` (glyphs on transparency, invented script): one "glowing magenta-and-amber alien noodle-bar sign", one "glowing violet-and-teal alien hostel sign", 512×256 PNG. Wiring: swap the sign planes' materials. |
| `rust_hull.jpg` | Trask trawlers + dock decks | "Seamless tileable texture of rusty ship hull plating: green-grey steel plates with riveted seams, rust bleeding from joints and scuppers, flaking paint patches, even lighting, 1024×1024". Wiring: swap `hullMat`/`deckMat` maps in `world/trask.ts`. |
| `panel_white.jpg` | Prison Rig decks, tower, pylons | "Seamless tileable texture of clean white sci-fi facility wall panels: smooth off-white composite panels with fine seams, recessed bolts, faint scuffs low on the panel, even lighting, 1024×1024". Wiring: swap `whiteMat`/`deckMat` maps in `world/narkina.ts`. |
| `forge_relief.jpg` | Great Forge dome walls | "Seamless tileable texture of ancient carved stone wall: shallow angular geometric relief of interlocking sigils, grey basalt, chipped and heat-scorched, even lighting, 1024×1024". Wiring: swap `ruinMat`'s map on the dome wall segments in `world/forge.ts`. |
| `kelp_frond.png` | Prison Rig kelp forest | The kelp is solid cylinders today; crossed alpha-card ribbons would read as plants. "A single kelp frond on a transparent background: long tapering ribbon leaf with a gentle S-curve, olive-green, translucent edges, 512×1024 PNG with alpha". Wiring: replace the cylinder stalks with two crossed cards per plant (small code change, kelp is already `decor`). |
| `skyline_silhouette.png`, `skyline_silhouette_2.png` | Ringworld backdrop (PLAN.md §16) | Two parallax layers of city beyond the end bulkheads. "A wide row of varied dark sci-fi tower silhouettes on a transparent background: flat near-black shapes of mixed heights with spires, gantries and rooftop tanks, scattered tiny lit windows in warm amber and pale teal, no detail inside the shapes, 2048×512 PNG with alpha". `_2` is a second, differently-composed row for the far layer. Wiring: two alpha planes per bulkhead end in `world/ringworld.ts`, `decor`. |
| `net_weave.png` | Trask quay nets (PLAN.md §16) | "A hanging cargo net on a transparent background: knotted rope in a sagging diamond mesh, frayed ends, dark tarred brown, 512×512 PNG with alpha". Wiring: alpha planes hung between pilings in `world/trask.ts`, `decor`. |
