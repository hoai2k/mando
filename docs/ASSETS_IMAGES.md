# Asset Requests — Images & Textures

**Open image requests only.** Delivered images are recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md) with their original prompts.

**Nothing is outstanding.** Every environment, sky and UI texture, all nine boards' card
art and skies, the surface textures, and the A-pose turnaround sheets for the whole cast
are delivered and integrated — The Prison Rig's card and sky, the last two open requests,
landed on 2026-08-28 and the loader picked both up with no code change.

Every image request for the project belongs in this file; once delivered it moves to the
history doc, and anything it feeds (such as the 3D model briefs) references the resulting
filenames from there.

**Global specs unless noted:** sRGB, no baked lighting or shadows (lighting is dynamic), no
text or watermarks, no logos, and no reproductions of copyrighted designs — describe the
design, never name a trademarked character or film frame.

Runtime textures land in `public/assets/textures/` and the loader tries `.jpg` then `.png`.
Production-only reference art lives in `reference/` and is **not** shipped.

## Making more character reference sheets

**No sheets are outstanding** — every character in `ASSETS_MODELS.md` has its three views,
recorded in the history doc. This is the recipe for any character added later.

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
