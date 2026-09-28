# Skin-fix review (archived 2026-09-28)

The skin-weight review workflow, retired from the game and the workbench to
keep the active code simpler. Nothing here is built, served or loaded.

The game still applies every fix that was marked `applied`: those remain in
`public/models/skinfix/<model>.json` and are read by
`src/characters/skinfix.ts` when each authored model loads. What is kept here:

| file | what it was |
|---|---|
| `fixes/*.json` | Every fix file as it stood when the workflow was retired: 148 applied, 286 pending and 1 discarded proposal across 30 models. The game's copies hold only the applied ones (the Alamite had none, so it has no game file now). |
| `skin-audit.mjs` | The audit that proposed the fixes (was `tools/skin-audit.mjs`). It wrote the fix files, keeping any decision already taken. |
| `skinPanel.ts` + `skinPanel.css` | The workbench's "Skinning review" panel (was `src/workbench/skinPanel.ts`): skin-test pose, weight paint, per-fix toggles, Approve / Discard, decisions export. |
| `skin-decide.mjs` | Folded an exported decisions file into the fix files (was `tools/asset-pipeline/skin-decide.mjs`). |

To bring it back: move the tools and panel to their old paths, restore the
panel's hookups in `src/workbench/main.ts` (see git history around the
archiving commit) and its CSS in `src/workbench/workbench.css`, and copy the
pending proposals from `fixes/` into the game's fix files. `docs/SKINNING_AUDIT.md`
describes how the audit finds leaks.
