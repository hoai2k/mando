/**
 * Fold a workbench decisions export into the skin-fix files.
 *
 * The skinning review in the workbench (`/workbench/`, "Skinning review")
 * hands back one JSON of approve / discard calls keyed by fix id. This writes
 * each call onto its fix in `public/models/skinfix/<model>.json`: approve
 * sets the fix `applied`, discard sets it `discarded`, and the decision is
 * kept on the fix so a re-run of `skin-audit.mjs` honours it.
 *
 * Usage: node tools/skin-decide.mjs skinfix-decisions.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'public/models/skinfix';
const file = process.argv[2];
if (!file) { console.error('usage: node tools/skin-decide.mjs <skinfix-decisions.json>'); process.exit(1); }
const doc = JSON.parse(readFileSync(file, 'utf8'));
const decisions = doc.decisions ?? doc;

const byModel = new Map();
for (const [id, decision] of Object.entries(decisions)) {
  const model = id.split('/')[0];
  byModel.set(model, [...(byModel.get(model) ?? []), [id, decision]]);
}
let applied = 0, missing = 0;
for (const [model, list] of byModel) {
  const path = `${OUT}/${model}.json`;
  if (!existsSync(path)) { console.warn(`no fix file for ${model} (${list.length} decisions skipped)`); missing += list.length; continue; }
  const fixes = JSON.parse(readFileSync(path, 'utf8'));
  for (const [id, decision] of list) {
    const fix = fixes.fixes.find((f) => f.id === id);
    if (!fix) { console.warn(`${id}: no such fix`); missing++; continue; }
    if (decision !== 'approve' && decision !== 'discard') { console.warn(`${id}: unknown decision "${decision}"`); missing++; continue; }
    fix.decision = decision;
    fix.status = decision === 'approve' ? 'applied' : 'discarded';
    applied++;
    console.log(`${id}: ${fix.status}`);
  }
  writeFileSync(path, JSON.stringify(fixes));
}
console.log(`${applied} decision${applied === 1 ? '' : 's'} written${missing ? `, ${missing} skipped` : ''}`);
