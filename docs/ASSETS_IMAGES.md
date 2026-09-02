# Asset Requests — Images & Textures

**Open image requests only.** Everything delivered — with its original prompt — lives in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md); nothing that has landed is described here.
Once a request is filled it moves there, and anything that builds on it (the 3D model
briefs, say) cites the resulting filename from there.

**Outstanding right now:** one **replacement generation** — the `sandworm` canvas, whose
first version is superseded by a design change (below, and the first thing to make) —
the environment prop reference sheets, and the optional drop-screen portraits for the
playable NPCs. The rest of the second monster batch was delivered on 2026-09-02 and
approved. The troop carrier sheets went the way
of the monster sheets — both ships' models were delivered on 2026-08-30 without
them, so they are no longer wanted. Nothing else — the cast, the boards, the
skies, every surface texture, the campaign's planet strip and corridor interiors, the
drop-screen portraits, the weapon sheets, the logo and the favicon are all in and wired.
Nothing is parked: `pistol`, the last held sheet, was delivered on 2026-08-29 along with
the model it was drawn for. The **monster boss sheets are no longer wanted** — see below.

**Global specs unless noted:** sRGB, no baked lighting or shadows (lighting is dynamic), no
text or watermarks, no logos, and no reproductions of copyrighted designs — describe the
design, never name a trademarked character or film frame. (The game's own logo and favicon
were the one deliberate exception; both are delivered.)

Runtime textures land in `public/assets/textures/` and the loader tries `.jpg` then `.png`.
Production-only reference art lives in `reference/` and is **not** shipped.

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

## Monster batch two: reference canvases (opened and mostly delivered 2026-09-02)

Four new creature bosses and one body-section prop, designed in
[`docs/BOSSES.md`](BOSSES.md) §2.7–2.10 so that **every territory has a monster and no
monster serves two** — the Refinery, the Ringworld and the Prison Rig had none, and
the Dune Sea's champion was a war massiff the Lava Flats also field. All are in the
game already as procedural stand-ins; these canvases are the first step of the
standard pipeline (sheet → model → swap), and the model briefs that consume them are
in [`ASSETS_MODELS.md`](ASSETS_MODELS.md#monster-bosses--batch-two).

**Status after the 2026-09-02 delivery:**

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

## Not wanted — reference sheets for the mouth re-exports (2026-09-02)

The re-export request in
[`ASSETS_MODELS.md`](ASSETS_MODELS.md#re-exports--openable-mouths-on-the-older-creature-rigs-2026-09-02)
asks for a jaw on the massiff, the krykna and the broodmother. **No new art is needed
for it**: nothing about the creatures' design changes, and the ask is purely a rig
addition. The existing `massiff_front/side/back.png` and `krykna_ref.png` stay the
reference. The mouth audit behind that request, and what it means for future prompts,
is written up in the model doc.

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

## Game-mode art — remaining (docs/MODES.md)

The modes' planet strip and corridor interiors are delivered and wired; what is left is
optional (same upgrade-in-place contract as everything above).

### Drop-screen portraits for playable NPCs (runtime, optional)

PvP fields every NPC as a fighter; the drop screen already looks for
`portrait_<enemyKind>.jpg` and falls back to the drawn marks. Any of the existing
character sheet subjects can be reframed with the standard portrait recipe above —
highest value first: `tusken`, `stormtrooper`, `pirate`, `pyke`, `officer`, `enforcer`.
