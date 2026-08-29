# Asset Requests — Images & Textures

**Open image requests only.** Delivered images are recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md) with their original prompts.

**Open: one drop-screen portrait (`ig11`) and the environment prop reference sheets
below.** The eleven runtime environment textures requested on 2026-08-29 all landed and
are wired into their boards; so did the `ventress`, `embo` and `bossk` portraits, which
closed that request. The `saber_curved`, `crossbow` and `longrifle` weapon sheets landed
too, but the weapon *models* they were drawn for are **parked by decision** — the
signature weapons keep their procedural builds for now — and the fourth sheet, `pistol`,
is parked with them. Everything older — every environment, sky and UI texture, all nine
boards' card art and skies, the surface textures, and the A-pose turnaround sheets for
the whole cast — is delivered and integrated.

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
fourth sheet, `pistol` — Cad Bane's twin heavy pistols — was never produced and is not
wanted while that holds; its prompt is kept here for whenever it is:

| Id | Prompt |
|---|---|
| `pistol` (parked) | "a heavy sci-fi blaster pistol: a boxy receiver, a short thick barrel ending in a flared muzzle, an angled grip, a small top sight, scuffed gunmetal and worn dark steel" |

## Open — drop-screen portrait: `ig11` (priority 3)

29 portraits are delivered (recorded in the history doc) — every enemy kind the drop
screen shows and eight of the nine playable characters. Still open: **`ig11`**, who
became playable after the batches were made and is the last face still drawn as a mark.

Drop it at `public/assets/textures/portrait_ig11.jpg`. Nothing else needs
changing: the loader tries the file and keeps its drawn mark if it 404s, and a
missing portrait never delays the drop it illustrates.

- **Format:** 512×614 (5:6 portrait), JPEG, quality 82.
- **Framing:** head and shoulders, facing camera, filling the frame.
- **Lighting:** single warm key from the upper left against a near-black
  background, matching the menus' lit-from-above look.
- **Subject:** per the delivered `ig11` turnaround sheets in `reference/characters/` —
  the tall spindly assassin droid, cylindrical head with a red sensor ring.

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

### Pilotable vehicles (PLAN.md §17)

Same recipe, all ▣ (their colliders and saddle positions are tuned in code, so the
side profile matters). Every one is **empty** — no rider, no hands: the game seats the
player character itself.

| Id | Prompt |
|---|---|
| `speeder_bike` ▣ | "a military scout repulsor speeder bike about 3 meters long, no rider: two long forward outrigger vanes ending in steering fins, a narrow saddle over a compact rear engine block, handlebar controls, footrests, no wheels, hovering, drab grey-brown metal, field-worn" |
| `landspeeder` ▣ | "an open-topped civilian repulsor landspeeder about 4.5 meters long, no driver: rounded weathered bodywork, a single open seat behind a low curved windshield, three turbine engine nacelles across the tail, no wheels, hovering, sun-faded paint over dented metal" |
| `skiff` ▣ | "a repulsor cargo skiff about 9 meters long, no crew: a flat open deck with low side rails, a raised tiller steering platform at the stern, crates lashed down at the bow, no wheels, hovering low, weathered tan and rust-brown plating" |

## Environment textures (runtime) — delivered 2026-08-29

All eleven landed and are wired: `city_facade` + `city_facade_glow` (Ringworld facades,
albedo and emissive), `neon_sign_2/3` (street signs), `rust_hull` (Trask hulls and
decks), `panel_white` (the Prison Rig's white surfaces), `forge_relief` (the Forge's
dome walls, on their own cloned material so the relief does not tile across loose
rubble), `kelp_frond` (the kelp is crossed alpha cards now, not cylinders),
`skyline_silhouette` + `_2` (two parallax rows beyond the Ringworld bulkheads) and
`net_weave` (nets along the Trask quay edges). Prompts are recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md).

Nothing in this batch is outstanding. Later texture requests go in a new section here.

## Game-mode art — requested 2026-08-29 (the `?modes` build, docs/MODES.md)

The three experimental modes run fully procedural without any of this and upgrade
in place when files land (same contract as everything above).

### Campaign planet strip (runtime)

Nine planet discs for the campaign select (`src/ui/planets.ts`). Drop-in:
`public/assets/textures/planet_<boardId>.png` — ids `desert`, `station`, `nevarro`,
`crevasse`, `trask`, `refinery`, `forge`, `ringworld`, `narkina`. **Spec:** 512×512 PNG,
the planet a full-bleed circle touching the canvas edges (the UI masks it round and adds
its own key-light overlay), space-black or transparent corners, no rings of text, no
stars baked in.

| Id | Prompt |
|---|---|
| `planet_desert` | "a desert planet seen from orbit: ochre and burnt-orange dune seas, thin lavender atmosphere rim, two faint sun glints" |
| `planet_station` | "a deep-space refinery station from a distance rendered as the destination itself: a dark industrial hulk with warm sodium work-lights and a purple-orange nebula behind" |
| `planet_nevarro` | "a volcanic planet from orbit: black basalt continents veined with glowing lava rivers, grey ash swirls" |
| `planet_crevasse` | "an ice planet from orbit: blue-white glacial sheets split by deep turquoise crevasse scars" |
| `planet_trask` | "an ocean moon from orbit: slate-green storm seas, white cyclone spirals, scattered black dock-islands" |
| `planet_refinery` | "an industrial world from orbit: rust-brown haze bands, gridded refinery lights on the night side" |
| `planet_forge` | "a glassed war-torn planet from orbit: fused green-grey glass plains, a shattered dome scar, magnetic aurora arcs" |
| `planet_ringworld` | "a ringed city habitat from orbit: a bright inhabited ring around a dark gas world, city lights along the band" |
| `planet_narkina` | "a white ocean prison world from orbit: pale seas, geometric white facility platforms in a sparse grid" |

### Corridor interiors (runtime)

The campaign's door-gated corridor segments (`src/world/corridor.ts`) currently use the
flat hull materials. Tileables, 1024², same spec as the other surface textures:

| Id | Prompt |
|---|---|
| `corridor_wall` | "seamless tileable sci-fi corridor wall panel: dark gunmetal plating in tall ribs, recessed bolt lines, faint wear streaks" |
| `corridor_floor` | "seamless tileable industrial deck floor: dark steel tread plate, scuffed walk path down the middle, oil stains" |
| `hazard_stripe` | "seamless tileable yellow-black hazard chevron stripe on worn metal, grime in the paint chips" |

### Drop-screen portraits for playable NPCs (runtime, optional)

PvP fields every NPC as a fighter; the drop screen already looks for
`portrait_<enemyKind>.jpg` and falls back to the drawn marks. Any of the existing
character sheet subjects can be reframed with the standard portrait recipe above —
highest value first: `tusken`, `stormtrooper`, `pirate`, `pyke`, `officer`, `enforcer`.
