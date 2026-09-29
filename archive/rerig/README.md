# Re-rig experiments (on hold)

Re-rigged copies of Din Djarin and Cad Bane: the limb joints moved to where
the mesh bends, skin weights untouched.

- `*_rerig.glb` — joints from the skin-weight seam audit (`docs/audits/rig-joints.md`)
- `*_rerig_geo.glb` — joints from the geometry-only audit (`docs/audits/geo-joints.md`)

Tools: `tools/asset-pipeline/rerig.mjs` (makes them),
`tools/asset-pipeline/pose-compare.mjs` (extreme-pose before/after sheets).

To resume: copy these files back into `public/models/` and set
`RIG_EXPERIMENTS = true` in `src/workbench/roster.ts` (the re-rigged subjects
and the geometric-joint overlay in the workbench).
