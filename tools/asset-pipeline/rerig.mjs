/**
 * Re-rig a character from a joint audit: moves its limb joints to where the
 * mesh says they are and writes a copy beside it, leaving the original untouched.
 *
 *   node tools/asset-pipeline/rerig.mjs din                    # → public/models/din_rerig.glb
 *   node tools/asset-pipeline/rerig.mjs din --move=elbow,knee  # only these joints
 *   node tools/asset-pipeline/rerig.mjs din --audit=path/to/rig-joints.json
 *   node tools/asset-pipeline/rerig.mjs din --source=geo       # → public/models/din_rerig_geo.glb
 *   node tools/asset-pipeline/rerig.mjs din --source=geo --min-confidence=0.7 --min-offset=3
 *
 * Two sources of estimates:
 *
 *  - `--source=seam` (the default): docs/audits/rig-joints.json, the skin-weight
 *    seam. By default only the joints that audit calls likely misplaced for
 *    this model are moved.
 *  - `--source=geo`: docs/audits/geo-joints.json, read off the volume of the
 *    mesh alone (tools/asset-pipeline/geo-joints.mjs). By default the limb
 *    joints (elbow, wrist, knee, ankle) whose estimate is confident on *both*
 *    sides (`--min-confidence`, default 0.6) and that sit at least
 *    `--min-offset` cm (default 2) from the rig's joint on average. Shoulders
 *    and hips are never moved from it unless named in `--move`.
 *
 * Either way both sides move to one mirrored estimate. See rerig-page.ts for
 * what is and is not changed in the file.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { loadPlaywright } from '../harness.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const id = args.find((a) => !a.startsWith('--'));
if (!id) { console.error('usage: node tools/asset-pipeline/rerig.mjs <model id> [--source=seam|geo]'); process.exit(1); }
const source = opt('source', 'seam');
if (!['seam', 'geo'].includes(source)) { console.error(`unknown --source=${source}`); process.exit(1); }
const auditPath = opt('audit', source === 'geo' ? 'docs/audits/geo-joints.json' : 'docs/audits/rig-joints.json');
const audit = JSON.parse(await readFile(auditPath, 'utf8'));
const minConf = Number(opt('min-confidence', '0.6'));
const minOffset = Number(opt('min-offset', '2'));
const outPath = opt('out', `public/models/${id}_rerig${source === 'geo' ? '_geo' : ''}.glb`);
/**
 * Seam source: only what the audit itself calls *likely misplaced* for this
 * model (the summary table in rig-joints.md): limb joints where the seam
 * estimate and the centre-line reading agree. A long coat or a robe can drag
 * a seam estimate a hand's width off with nothing wrong at the joint — Cad
 * Bane's knees read 13 cm out under his duster — and those are left alone.
 */
async function likelyMisplaced(model) {
  const md = await readFile(auditPath.replace(/\.json$/, '.md'), 'utf8');
  const row = md.split('\n').find((l) => l.startsWith(`| ${model} |`));
  if (!row) return [];
  const cell = row.split('|')[3] ?? '';
  return [...new Set([...cell.matchAll(/([a-z]+)\.[LR]/g)].map((m) => m[1]))];
}
/** Geometry source: limb joints confident on both sides and far enough from the rig to be worth moving. */
function confident(joints) {
  return ['elbow', 'wrist', 'knee', 'ankle'].filter((j) => {
    const L = joints[`${j}.L`], R = joints[`${j}.R`];
    if (!L?.est || !R?.est) return false;
    const off = ((L.offsetCm ?? 0) + (R.offsetCm ?? 0)) / 2;
    return L.conf >= minConf && R.conf >= minConf && off >= minOffset;
  });
}
const joints = audit.models?.[id]?.joints;
if (!joints) { console.error(`no audit for ${id} in ${auditPath}`); process.exit(1); }
const pick = opt('move', 'default');
const move = pick !== 'default' ? pick.split(',') : source === 'geo' ? confident(joints) : await likelyMisplaced(id);
console.log(`source: ${source} (${auditPath}); moving: ${move.join(', ') || 'nothing'}`);
if (source === 'geo') {
  for (const j of ['elbow', 'wrist', 'knee', 'ankle']) {
    const L = joints[`${j}.L`], R = joints[`${j}.R`];
    console.log(`  ${j.padEnd(6)} conf ${L.conf}/${R.conf}  off ${L.offsetCm}/${R.offsetCm} cm  ${move.includes(j) ? 'MOVE' : 'keep'}`);
  }
}

// a port of its own: a server left on it by an earlier run (strictPort) would be answering for another checkout
const PORT = Number(opt('port', '5289'));
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
// npx starts vite as its child: stop the whole group, or vite outlives this script
const stopVite = () => { try { process.kill(-vite.pid); } catch { vite.kill(); } };
const url = `http://localhost:${PORT}/tools/asset-pipeline/rerig.html`;
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 500));
}
if (!move.length) { console.log('nothing to move'); stopVite(); process.exit(0); }
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(url);
  await page.waitForFunction(() => typeof window.__rerig === 'function', null, { timeout: 120000 });
  const res = await page.evaluate(([m, j, mv, src]) => window.__rerig(`models/${m}.glb`, j, mv, src), [id, joints, move, source]);
  await writeFile(outPath, Buffer.from(res.glb, 'base64'));
  console.log(JSON.stringify(res.report, null, 1));
  console.log(`wrote ${outPath}`);
} finally {
  await browser.close();
  stopVite();
}
