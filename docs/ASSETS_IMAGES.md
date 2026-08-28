# Asset Requests — Images & Textures

**Open image requests only.** Delivered images are recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md) with their original prompts.

**Open: the five playable bounty hunter sheets below.** Everything else — every
environment, sky and UI texture, all nine boards' card art and skies, the surface
textures, and the A-pose turnaround sheets for the rest of the cast — is delivered and
integrated; The Prison Rig's card and sky landed on 2026-08-28 and the loader picked both
up with no code change.

Every image request for the project belongs in this file; once delivered it moves to the
history doc, and anything it feeds (such as the 3D model briefs) references the resulting
filenames from there.

**Global specs unless noted:** sRGB, no baked lighting or shadows (lighting is dynamic), no
text or watermarks, no logos, and no reproductions of copyrighted designs — describe the
design, never name a trademarked character or film frame.

Runtime textures land in `public/assets/textures/` and the loader tries `.jpg` then `.png`.
Production-only reference art lives in `reference/` and is **not** shipped.

## Making more character reference sheets

The five playable bounty hunters below are the outstanding set; every other character in
`ASSETS_MODELS.md` has its three views, recorded in the history doc. This is the recipe.

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

## Open — playable bounty hunter sheets (priority 2)

Five new playable fighters for the roster (see *Playable bounty hunters* in
[`ASSETS_MODELS.md`](ASSETS_MODELS.md)). A sixth, the blue-skinned gunslinger, needs no
sheets — the delivered `duelist` set already is that design.

Same recipe as above: shared preamble + the Subject line below, three views each at
matched pixel heights. **Two additions for this set:** every playable flies, so include a
low-profile twin-nozzle thruster backpack, form-fitted to the character and visible in the
side and back views; and where a weapon hilt is described it is hilt only, never an
ignited blade — blades are FX meshes the game manages.

| Id | Height | Subject |
|---|---|---|
| `ventress` | 1.79 m | "a pale ash-grey-skinned bald female assassin, gaunt striking features with dark markings crowning the bare scalp, a fitted sleeveless grey-black bodysuit under a long split skirt panel, forearm wraps, two curved-hilt sword grips holstered crossed at the back of the belt" |
| `maul` | 1.75 m | "a horned red-and-black tattooed alien warrior, hairless head crowned by a ring of short dark horns, piercing yellow-red eyes, layered matte-black combat tunic with an armored collar and belt sash, fingerless gauntlets, heavy boots, a long double-ended weapon hilt clipped across the lower back" |
| `embo` | 1.78 m | "a broad-shouldered olive-green-skinned bounty hunter alien, pale eyes over a slatted bamboo-like rebreather mask covering the lower face, a very wide circular flat-brimmed woven-metal hat, a fur-trimmed short poncho over banded leather-and-plate armor, heavy gauntlets, a compact crossbow-style blaster holstered at the hip" |
| `bossk` | 1.90 m | "a hulking reptilian bounty hunter, yellow-green scaled hide, a wedge-shaped snout full of needle teeth, slit orange eyes, clawed three-fingered hands and heavy clawed feet, wearing a worn yellow-tan flight suit with the sleeves rolled, a padded chest rig and ammo bandoliers" |
| `greedo` | 1.73 m | "a slender green-skinned alien hunter with a tapered dome head, large glassy dark-purple eyes, a short trunk-like snout, twin antenna-like ear stalks, a bumpy ridged scalp crest, a fitted olive flight jacket over a tan jumpsuit, a gunbelt with a holstered pistol" |
