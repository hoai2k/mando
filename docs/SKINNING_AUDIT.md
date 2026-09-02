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
**applied**. Everything else — chest plates driven by an arm, cowls driven by
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
before/after sheet (`docs/skinning/`).

### Reviewing the pending fixes

Open `/workbench/`, pick a character, press **Skinning review**:

- **Hold the skin-test pose** puts the figure in a pose that moves every
  chain (left arm up, right arm out, left leg striding, head turned) — a leak
  only shows when its chain moves.
- **Paint weights** colours vertices by the weight a chain carries, or by the
  vertices the enabled fixes touch; **Highlight** on a fix paints that fix.
- Tick / untick a fix to see it on and off live. **Approve** / **Discard**
  record a decision (kept in the browser across characters).
- **Export decisions** downloads one JSON; `node tools/skin-decide.mjs
  <file>` folds it into the fix files (approve → applied, discard →
  discarded). Commit the JSON files.

A confident fix can be discarded the same way if it looks wrong.

## 2. Shoulders read squished inward

### Measurement

For each model and pose (frame 0 of the clip), the skinned mesh was measured
in the browser: the width across the "shoulder caps" (deltoid + pauldron
vertices around each upper-arm joint), compared with the same vertices in the
sculpt's own bind pose. Δ in cm, negative = narrower than sculpted:

| model | sculpt width cm | arms vertical | idle | run | aim | enemy aim | melee 1 (frame 0) | hit | fly |
|---|---|---|---|---|---|---|---|---|---|
| din | 60 | -3.9 | 1 | 0.4 | -3.6 | -3.3 | -8 | 5.8 | 5 |
| paz | 81 | -1.5 | 3.9 | 3.1 | -2.2 | -1.8 | -4.4 | 10.1 | 9 |
| bokatan | 50 | -5.9 | 1.7 | 1.3 | -5.8 | -5.4 | -5.6 | 6.4 | 5.6 |
| armorer | 62 | -5.7 | -0.6 | -1.3 | -6.4 | -5.6 | -8.9 | 4.5 | 3.7 |
| ventress | 56 | -11.8 | -2.2 | -2.1 | -10.3 | -10.3 | -9.2 | 0.7 | 0.6 |
| embo | 74 | -3 | -0.5 | -0.2 | -6.9 | -5.5 | -11.2 | -0.9 | -0.4 |
| bossk | 81 | -11.5 | -3.3 | -3.5 | -12.3 | -11.3 | -12.7 | -0.6 | -0.8 |
| duelist | 65 | -11.8 | -0.7 | -0.9 | -9 | -9 | -10.3 | 3.8 | 3.4 |
| ig11 | 62 | -3.2 | 5.8 | 6 | -2.4 | -2.2 | -4.3 | 8.8 | 8.9 |
| stormtrooper | 74 | -9.2 | -1.9 | -2.5 | -9.7 | -8.8 | -13.3 | 2.8 | 2.1 |
| deathtrooper | 85 | -8.6 | -1 | -1.5 | -10.1 | -9 | -13.2 | 3.4 | 2.8 |
| darktrooper | 122 | -5.4 | -3.9 | -4.5 | -11 | -9 | -22.4 | -0.4 | -0.3 |
| pyke | 72 | -16.9 | -2.2 | -2.8 | -14 | -13.3 | -13.4 | 3 | 2.1 |
| tusken | 66 | -12 | -1.8 | -1.9 | -10.9 | -11.3 | -11.2 | 3.2 | 2.7 |
| marshal | 67 | -11.6 | -0.5 | -0.9 | -11.4 | -10.4 | -9.4 | 4.2 | 3.5 |
| fennec | 58 | -10.9 | 0.4 | 0.1 | -8.5 | -8.5 | -8.5 | 5.3 | 4.8 |
| pirate | 90 | -11.4 | -4 | -5 | -7.9 | -6.8 | -24.2 | 0.5 | 0.3 |
| droid | 70 | -11.6 | -2 | -2.3 | -10.4 | -10.6 | -12.8 | 3.4 | 2.7 |
| **mean** | | **-8.7** | -0.7 | -1.0 | **-8.5** | **-7.9** | **-11.3** | +3.6 | +3.1 |

(`tools`-free script: `scratchpad/measure.mjs` during the audit; the numbers
are reproducible from the workbench with `SkinnedMesh.getVertexPosition`.)

### Diagnosis

It is not the skinning, and it is not the clavicles (they measure horizontal
in every file and the clips barely touch them). It is the **arm-rest
convention in the retargeter** meeting clips that hold the upper arm near
vertical:

1. `CANON_DIR` in `src/characters/authored.ts` pulls every upper arm's rest
   to straight down, so a clip's Z splay is the *absolute* angle from
   vertical. The sculpts were built in an A-pose with the upper arm 16–31°
   out (mean 24°), and the deltoid, sleeve top and pauldron were modelled
   around that. With the arm vertical the caps fold inward by 4–17 cm per
   model — that is the "arms vertical" column, and it is the pose the
   workbench calls *Rest*.
2. The August audit fixed idle and run by raising their splay to 19–21°
   (columns 3–4: within ±2 cm of the sculpt for most of the cast). It did
   not touch the rest: `aimUpper`, `enemyAimUpper`, every melee / saber
   end-key and the hit reacts hold the right arm at Z = +8 … −12, and the
   aim clips then yaw the chest 18°, which carries the right upper arm to
   **12° inside vertical**, across the body. The cap on that side folds in
   and down with it (visible on Din's right pauldron in the aim shot), and
   the chest yaw foreshortens the joint width by another ~2 cm. Net ≈ −8 to
   −14 cm on most models in aim / enemy aim / melee — a third of the
   shoulder width on Ventress or Bossk.
3. The pauldron and the top of the sleeve are 40–60 % weighted to
   `upper_arm` rather than `shoulder` (see the paint in the workbench), which
   is why a rigid plate follows the arm inward at all. This is secondary: it
   sets *how much* of the cap moves, not whether it does.

Models with the widest sculpted A-pose (bossk 31°, darktrooper 29°, embo
27.5°, ventress 26.6°) show it most; ig11 (9°) barely at all — exactly the
pattern the convention predicts.

### Proposed fix (not applied)

Three options, cheapest first; the first two are complementary.

- **A. Clip-side (recommended first step).** Give every upper clip a splay
  floor of about 15–18° on both arms, measured *after* chest yaw: aim /
  enemy aim right arm from Z −12 to about −24, left arm stays; melee, saber
  and hit end-keys from Z ±8 to ±18–22. The workbench's edit mode exports
  exactly these numbers. Cost: one afternoon; risk: none to the rig. This
  alone recovers ~6–8 cm on most models in the poses that matter.
- **B. Retargeter-side (systemic).** Make the arm rest the sculpt's own
  frontal splay instead of vertical: in `loadAuthored`, keep each upper
  arm's authored direction *projected into the frontal plane* as its
  `CANON_DIR`, and subtract that per-model splay from the clips' Z on the way
  through `retarget` (a per-model constant, ~24°). Clips then say "how much
  more than the sculpt", every model gets its sculpted shoulders in every
  pose, and idle/run's bumped-up splay goes back to a natural number. Cost:
  a day including re-tuning the idle/run values the August fix changed;
  needs the splay-sign conventions in `clips.ts` updated.
- **C. Skin-side (cosmetic, per model).** Move the pauldron / cap weight
  from `upper_arm` to `shoulder` within ~10 cm of the joint. Keeps the plate
  rigid to the torso the way armour behaves. This is expressible as another
  `skinfix` class if wanted; it would go through the same review queue.

Do A now; B if the rest of the roster's poses are ever re-authored; C only
for the heavy-plate characters (paz, darktrooper, ring_enforcer) where the
plate visibly hinges.

## 3. Files

- `tools/lib/glb.mjs` — Node reader for the models (meshopt, quantised
  attributes, rest-pose matrices, skinned vertices).
- `tools/skin-audit.mjs` — the audit; writes `public/models/skinfix/*.json`.
- `tools/skin-decide.mjs` — folds workbench decisions into the fix files.
- `src/characters/skinfix.ts` — runtime application; `authored.ts` calls it.
- `src/workbench/skinPanel.ts` — the review panel.
- `docs/skinning/` — before / after sheet for every model in the test pose.
