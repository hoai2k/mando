# Asset Requests — Images & Textures

**Open image requests only.** Everything delivered — with its original prompt — lives in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md); nothing that has landed is described here.
Once a request is filled it moves there, and anything that builds on it (the 3D model
briefs, say) cites the resulting filename from there.

**Nothing is open (audited 2026-09-02).** Every request this file was carrying had in
fact been delivered, some of it weeks earlier, and has now moved to the history doc:
the 27 environment prop reference sheets (all with their models in the game), the six
optional drop-screen portraits for the playable NPCs, and the second monster batch's
five canvases including the replacement `sandworm`. The cast, the boards, the skies,
every surface texture, the campaign's planet strip and corridor interiors, the weapon
sheets, the logo and the favicon were already in and wired.

What remains below is not a request: the recipe for making more character sheets, and
the record of three sets deliberately **not** wanted, kept because each says something a
future request would otherwise have to rediscover.

**The open asset work is on the model side, not here** —
[`ASSETS_MODELS.md`](ASSETS_MODELS.md) carries the second monster batch's four sculpts
and the mouth re-exports for the three oldest creature rigs.

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

