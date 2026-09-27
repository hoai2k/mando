# Candidate models — not used by the game

Review copies only. Nothing in `src/` or `public/` points here, so the game still
loads `public/models/flametrooper.glb` and `public/models/ring_enforcer.glb` unchanged.

| file | what changed |
|---|---|
| `flametrooper_mirrored.glb` | the right-hip flame projector and its hose are removed. Below the belt, the right half is a mirror of the left half. Down the middle of the back, the mirror starts higher, just under the regulator, so the two fuel hoses match. |
| `ring_enforcer_mirrored.glb` | the right-hip pistol is removed. Below the belt, the right half is a mirror of the left half. |

Both were produced by `node tools/mirror-lower-body.mjs <model>`. The arms, hands,
head, torso and the enforcer's shield are untouched. The `*_before.png`,
`*_after.png` and `*_after_posed.png` files are renders of the same models.
