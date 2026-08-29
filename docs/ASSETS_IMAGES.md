# Asset Requests — Images & Textures

**Open image requests only.** Everything delivered — with its original prompt — lives in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md); nothing that has landed is described here.
Once a request is filled it moves there, and anything that builds on it (the 3D model
briefs, say) cites the resulting filename from there.

**Outstanding right now:** the environment prop reference sheets, and the optional
drop-screen portraits for the playable NPCs. Nothing else — the cast, the boards, the
skies, every surface texture, the campaign's planet strip and corridor interiors, the
drop-screen portraits, the logo and the favicon are all in and wired.

**Global specs unless noted:** sRGB, no baked lighting or shadows (lighting is dynamic), no
text or watermarks, no logos, and no reproductions of copyrighted designs — describe the
design, never name a trademarked character or film frame. (The game's own logo and favicon
were the one deliberate exception; both are delivered.)

Runtime textures land in `public/assets/textures/` and the loader tries `.jpg` then `.png`.
Production-only reference art lives in `reference/` and is **not** shipped.

## Parked — not wanted while the decision holds

| Id | Why | Prompt, for whenever it changes |
|---|---|---|
| `pistol` | The signature weapon **models** are parked (see [`ASSETS_MODELS.md`](ASSETS_MODELS.md)): the game keeps its procedural weapons, which read well at gameplay distance, and no code waits on a file. The other three sheets were drawn before that call and are delivered; this one never was. | "a heavy sci-fi blaster pistol: a boxy receiver, a short thick barrel ending in a flared muzzle, an angled grip, a small top sight, scuffed gunmetal and worn dark steel" |

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

## Game-mode art — remaining (docs/MODES.md)

The modes' planet strip and corridor interiors are delivered and wired; what is left is
optional (same upgrade-in-place contract as everything above).

### Drop-screen portraits for playable NPCs (runtime, optional)

PvP fields every NPC as a fighter; the drop screen already looks for
`portrait_<enemyKind>.jpg` and falls back to the drawn marks. Any of the existing
character sheet subjects can be reframed with the standard portrait recipe above —
highest value first: `tusken`, `stormtrooper`, `pirate`, `pyke`, `officer`, `enforcer`.
