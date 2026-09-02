# Character rigging / skinning audit — work in progress

*Started 2026-09-02. This file doubles as the running progress log for the audit
session, so the work can be resumed from the branch alone.*

## Findings so far

- Every humanoid `.glb` is a Rigify export skinned with automatic weights, and
  the weights leak across chains: on `din.glb` ~2,500 vertices carry both
  left-arm and left-leg weight (the side skirt panel, weighted to the hand /
  forearm that hangs beside it — this is the "skirt lifts with the arm").
  The same pattern is in every model (worst: duelist, marshal, pyke, pyke_capo,
  flametrooper, ring_enforcer). Arm ↔ neck/head and chest-plate ↔ both-arms
  overlaps are also common.
- Tool: `tools/lib/glb.mjs` reads the models in Node (meshopt decode, quantised
  attributes, rest-pose node matrices, skinned vertex positions/joints/weights).

## Plan

1. `tools/skin-audit.mjs` — geodesic region labelling + impact metric, emits
   `public/models/skinfix/<id>.json` (applied / pending fixes).
2. Runtime patch in `src/characters/authored.ts` (`loadRaw`).
3. Workbench "Skinning" mode: heatmap, fix toggles, approve/discard, export.
4. Before/after renders of the pending fixes for review.
5. Shoulder-squish investigation (measure, diagnose, propose — no change).

## Status

- [x] glb reader
- [ ] skin-audit tool
- [ ] runtime patch
- [ ] workbench mode
- [ ] review renders
- [ ] shoulder investigation
