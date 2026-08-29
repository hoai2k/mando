# Asset Requests — Images & Textures

**Open image requests only.** Delivered images are recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md) with their original prompts.

**Open: the drop-screen portraits below, and nothing else.** The three hunter weapon
sheets (`saber_curved`, `crossbow`, `longrifle`) were delivered; the weapon *models* they
were drawn for are **parked by decision** — the signature weapons keep their procedural
builds for now — and the fourth sheet (`pistol`) is parked with them. The `ventress`,
`embo` and `bossk` character sheets landed on 2026-08-28, and the other two hunter
concepts (the horned warrior and the snouted hunter) were cut before their sheets were
made. Everything else — every
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

## Open — drop-screen portraits (priority 3)

The loading screen between the character select and the match shows who is
dropping and who is waiting there. Until these files exist it draws its own
marks — a helmet in each Mandalorian's armour colours, a spider for the
krykna, an optic for the droids — so the screen is complete without them;
a portrait simply takes over the moment one is present.

Drop them at `public/assets/textures/portrait_<id>.jpg`. Nothing else needs
changing: the loader tries the file and keeps its drawn mark if it 404s, and a
missing portrait never delays the drop it illustrates.

- **Format:** 512×614 (5:6 portrait), JPEG, quality 82.
- **Framing:** head and shoulders, facing camera, filling the frame.
- **Lighting:** single warm key from the upper left against a near-black
  background, matching the menus' lit-from-above look.
- **Ids:** the playable nine — `din`, `paz`, `bokatan`, `armorer`, `ventress`,
  `embo`, `bossk`, `duelist`, `ig11` — and any
  enemy kind by its game id: `tusken`, `pyke`, `pirate`, `pirateMelee`,
  `jetpirate`, `droid`, `nikto`, `massiff`, `stormtrooper`, `deathtrooper`,
  `darktrooper`, `duelist`, `officer`, `capo`, `enforcer`, `flametrooper`,
  `krykna`, `broodmother`, `quarren`, `alamite`, `drone`, `ringEnforcer`.
  Only the ones a drop actually shows are worth doing first: each board's
  opening two kinds and the elite that closes its final wave.
