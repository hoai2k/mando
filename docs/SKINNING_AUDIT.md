# Character rigging & skinning audit

*2026-09-02. Method: every humanoid `.glb` read in Node (`tools/lib/glb.mjs`),
skin weights analysed per vertex (`tools/skin-audit.mjs`), and the results
checked in the model workbench in a pose that swings every chain at once.*

Two questions were asked: why does Din's skirt lift when his arm moves, and
why do the shoulders read squished in so many poses. They turned out to be
different problems with different fixes — the first is skin weights (fixed
here, with a review queue for the doubtful cases), the second is the
retargeter's arm-rest convention meeting clips that hold the arms near
vertical (diagnosed and measured here, fix proposed, nothing changed).

## 1. Weights leak across limb chains

### What is wrong

All 27 humanoid models are Rigify exports skinned with Blender's automatic
weights. Automatic weights only know distance, so any two body parts that
rest near each other share weight: Din's side skirt panels hang beside his
hands and carry up to 60 % hand / forearm weight; a helmet cheek near a
pauldron carries shoulder weight; a gauntlet against a thigh carries thigh
weight. Nothing shows in the rest pose (every bone is at bind), and all of it
shows the moment a clip moves the limb.

Measured across the cast (vertices carrying weight on two chains at once):

| leak | models affected | worst cases (vertices, drag) |
|---|---|---|
| arm → lower body (skirt / coat / belt / thigh follows the hand) | 26 of 27 | marshal 6.6k verts / 83 cm, pyke 4.8k / 69 cm, duelist 4.2k / 50 cm, flametrooper 1k / 39 cm, ventress 0.5k / 40 cm, din 2.7k / 22 cm |
| lower body → arm (hand / sleeve twitches with the stride) | 19 | pyke_capo 1.2k, tusken 107 verts / 36 cm, marshal 246 |
| arm → head (helmet dents when the arm rises) | 20 | darktrooper 827, wookiee 519, pirate_melee 418, embo 398 |
| arm → chest / chest → arm, neck → cowl / pauldron | all | din 2.6k cowl verts on the neck bone, etc. — mostly deliberate blends, queued for review |

"Drag" is how far the vertex would move for one radian of swing of the
offending chain (weight × lever from the chain's pivot), in cm at game scale.
Everything under 1.5 cm is ignored as invisible.

### How it is detected (`tools/skin-audit.mjs`)

1. Weld the mesh by position and build its edge graph.
2. Label each vertex with a **region** — lower body, left arm, right arm,
   torso, head — by *geodesic* distance over the mesh from the vertices that
   are unambiguously in each region (≥ 90 % of their weight there). Geodesic
   rather than Euclidean is the whole trick: the skirt hem is a hand's width
   from the hand in space but half a body away along the mesh, so it labels
   as lower body, and the hand labels as arm.
3. Any weight on a bone outside the vertex's region is a leak, except the
   pairings that are normal blends (abdomen ↔ chest, neck ↔ chest, leg ↔ leg).
4. Leaks above the drag floor are grouped into fixes per (region, driver).
   A fix zeroes the foreign weights and renormalises the rest; a vertex left
   with nothing borrows its nearest region-certain neighbour's weights.

Confidence: a fix in a class that is always wrong (arm ↔ lower body, arm ↔
head, arm ↔ other arm) on vertices whose region label is unambiguous ships
**applied**, and so does a torso-labelled vertex driven by an arm when it
sits more than a tenth of the height below the armpit (a coat skirt or
cuirass panel — the deltoid blend that makes torso ↔ arm a review class
lives at the shoulder). Everything else — chest plates driven by an arm, cowls driven by
the neck, ambiguous vertices, borrowed weights — ships **pending** for review.

### How it is applied

The `.glb` files are untouched. `public/models/skinfix/<id>.json` carries the
fixes; `src/characters/skinfix.ts` applies the `applied` ones to the shared
geometry the moment the model parses (`loadRaw` in `authored.ts`), so every
clone wears them. `skinfix/index.json` lists which models have a file, so the
rest cost no request. Re-running the audit keeps any decision already folded
into a file.

Result on Din: before, both skirt panels flare out to the sides with the arms
raised; after, the skirt hangs. Verified in the workbench and in the
before/after sheet for every model (`docs/skinning/<id>.png`, test pose,
as delivered on the left, with the applied fixes on the right). Pyke's and
the Marshal's long coats, IG-11's hanging plates and the Tusken's strap are
the other big visible changes. Two decisions were taken from the first sheet
and folded in with `skin-decide.mjs`: the Marshal's ambiguous coat-panel
vertices (`marshal/arm-drives-lower/*/review`) are approved, since the panel
still lifted with the arm without them; and `tusken/lower-drives-arm/left` is
discarded — it is the sculpt's own staff end hanging at knee height, which
the labelling read as arm, and taking the leg weight off it turned a strap
that folded away into a stiff rod.

### Archived: the review workflow

The workbench review (skin-test pose, weight paint, per-fix toggles, Approve /
Discard and the decisions export) was retired on 2026-09-28: the applied
fixes held up, and the unreviewed proposals were never needed. The game
applies only the fixes marked applied, which are all that
`public/models/skinfix/` now holds. Everything else is kept in
`archive/skinfix-review/`: the audit, the panel, the decision tool, and a
full copy of every fix file as it stood, pending and discarded proposals
included. See its README to bring any of it back.

## 3. Files

- `tools/lib/glb.mjs` — Node reader for the models (meshopt, quantised
  attributes, rest-pose matrices, skinned vertices).
- `src/characters/skinfix.ts` — runtime application; `authored.ts` calls it.
- `public/models/skinfix/*.json` — the applied fixes, one file per model.
- `archive/skinfix-review/` — the retired audit (`skin-audit.mjs`), review
  panel (`skinPanel.ts`), decision tool (`skin-decide.mjs`) and the full fix
  files with every proposal.
- `docs/skinning/` — before / after sheet for every model in the test pose.
