# Authored character models

Drop a character's glTF here as `<id>.glb` and the game picks it up on the next load —
there is no registry to edit. When a file is absent the procedural build stands in, so the
game never breaks on a missing model.

The brief for every model, the skeleton swap contract and the three intake paths
(`attachAuthored` for the canonical humanoid rig, `loadProp` for rigless weapons and
vehicles, `loadCreature` for creatures on a rig of their own) are documented in
[`docs/ASSETS_MODELS.md`](../../docs/ASSETS_MODELS.md).

Two things to know before adding a file:

- **The id is the filename, and it is not always the character's internal id** — the
  Imperial officer is the enemy kind `officer` but the file `imperial_officer.glb`, and
  the melee pirate is `pirateMelee` against `pirate_melee.glb`. The mapping lives in
  `AUTHORED_ENEMY` in `src/characters/enemies.ts`.
- **Clips shipped in the .glb always win.** Where a file carries no animation the game
  drives it — humanoids through the retargeter, creatures through the code-built cycles in
  `src/anim/quadruped.ts`.

Inspect anything here in the model workbench at `/workbench/?edit=models`, which stands the
authored model beside the procedural build it replaces.
