# Candidate models, not used by the game

Review copies only. The candidate GLBs are in `public/models/candidates/` so the review
bench can load them from the live site (https://hoai2k.github.io/mando/mirror-bench/).
Nothing in the game loads that folder: it still uses `public/models/flametrooper.glb`
and `public/models/ring_enforcer.glb` unchanged. The candidates are plain core glTF
(float attributes, no compression or quantisation), so any glTF viewer opens them.

| file | what changed |
|---|---|
| `flametrooper_mirrored.glb` | the right-hip flame projector and its hose are removed. Below the belt, the right half is a mirror of the left half. Down the middle of the back, the mirror starts higher, just under the regulator, so the two fuel hoses match. |
| `ring_enforcer_mirrored.glb` | the right-hip pistol is removed. Below the belt, the right half is a mirror of the left half. This sculpt's body is centred at x = -0.016 (about 3.4 cm to its right at game scale), so the mirror plane sits there rather than at 0. |

Both were produced by `node tools/mirror-lower-body.mjs <model>`. The triangle selection lives in `tools/lib/mirror-core.mjs`, which the review viewer also runs for its live leg-mirroring preview. The arms, hands,
head, torso and the enforcer's shield are untouched. The `*_before.png`,
`*_after.png` and `*_after_posed.png` files are renders of the same models.
