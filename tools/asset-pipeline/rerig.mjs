/**
 * Re-rig a character from the joint audit: moves its limb joints to where the
 * mesh bends and writes a copy beside it, leaving the original untouched.
 *
 *   node tools/asset-pipeline/rerig.mjs din                    # → public/models/din_rerig.glb
 *   node tools/asset-pipeline/rerig.mjs din --move=elbow,knee  # only these joints
 *   node tools/asset-pipeline/rerig.mjs din --audit=path/to/rig-joints.json
 *
 * The estimates come from docs/audits/rig-joints.json; by default only the
 * joints the audit calls likely misplaced for this model are moved (both
 * sides, mirrored). `--move=elbow,knee` picks them by hand.
 * See tools/asset-pipeline/rerig-page.ts for what is and is not changed.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { loadPlaywright } from '../harness.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const id = args.find((a) => !a.startsWith('--'));
if (!id) { console.error('usage: node tools/asset-pipeline/rerig.mjs <model id>'); process.exit(1); }
const auditPath = opt('audit', 'docs/audits/rig-joints.json');
const audit = JSON.parse(await readFile(auditPath, 'utf8'));
/**
 * By default, only what the audit itself calls *likely misplaced* for this
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
const move = opt('move', 'likely') === 'likely' ? await likelyMisplaced(id) : opt('move').split(',');
console.log(`moving: ${move.join(', ') || 'nothing'}`);
const joints = audit.models?.[id]?.joints;
if (!joints) { console.error(`no audit for ${id}`); process.exit(1); }

const PORT = 5288;
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const url = `http://localhost:${PORT}/tools/asset-pipeline/rerig.html`;
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 500));
}
if (!move.length) { console.log('nothing to move'); vite.kill(); process.exit(0); }
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(url);
  await page.waitForFunction(() => typeof window.__rerig === 'function', null, { timeout: 120000 });
  const res = await page.evaluate(([m, j, mv]) => window.__rerig(`models/${m}.glb`, j, mv), [id, joints, move]);
  const out = `public/models/${id}_rerig.glb`;
  await writeFile(out, Buffer.from(res.glb, 'base64'));
  console.log(JSON.stringify(res.report, null, 1));
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
  vite.kill();
}
