/**
 * Extreme-pose before/after sheets for a re-rig: original | re-rigs, same pose,
 * same orthographic camera.
 *
 *   node tools/asset-pipeline/pose-compare.mjs din din_rerig din_rerig_geo --out=/tmp/shots
 *
 * Writes <out>/<id>-<shot>.png (tiles left to right in the order given).
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadPlaywright } from '../harness.mjs';

const args = process.argv.slice(2);
const outDir = args.find((a) => a.startsWith('--out='))?.slice(6) ?? 'pose-compare';
const [id, ...files] = args.filter((a) => !a.startsWith('--'));
const all = [id, ...files];
// canonical-rig rotations (degrees, XYZ) over the rest pose, and how each is shot
const SIDE = [1, 0, 0], FRONT = [0, 0, 1], THREEQ = [0.8, 0.1, 0.6];
const SHOTS = {
  'elbows-side': { pose: { upperArmL: [-80, 0, 20], upperArmR: [-80, 0, -20], forearmL: [-140, 0, 0], forearmR: [-140, 0, 0] }, dir: SIDE, at: [0, 1.35, 0.2], half: 0.55 },
  'elbows-front': { pose: { upperArmL: [-80, 0, 20], upperArmR: [-80, 0, -20], forearmL: [-140, 0, 0], forearmR: [-140, 0, 0] }, dir: FRONT, at: [0, 1.35, 0], half: 0.55 },
  'knees-side': { pose: { upperLegL: [-110, 0, 4], upperLegR: [-110, 0, -4], lowerLegL: [145, 0, 0], lowerLegR: [145, 0, 0] }, dir: SIDE, at: [0, 0.8, 0.25], half: 0.45 },
  'knees-front': { pose: { upperLegL: [-110, 0, 4], upperLegR: [-110, 0, -4], lowerLegL: [145, 0, 0], lowerLegR: [145, 0, 0] }, dir: FRONT, at: [0, 0.8, 0.2], half: 0.45 },
  'wrists-side': { pose: { upperArmL: [-85, 0, 12], upperArmR: [-85, 0, -12], forearmL: [-5, 0, 0], forearmR: [-5, 0, 0], handL: [-75, 0, 0], handR: [-75, 0, 0] }, dir: SIDE, at: [0, 1.3, 0.5], half: 0.35 },
  'ankles-side': { pose: { footL: [55, 0, 0], footR: [55, 0, 0] }, dir: SIDE, at: [0, 0.2, 0.05], half: 0.3 },
  'ankles-front': { pose: { footL: [55, 0, 0], footR: [55, 0, 0] }, dir: FRONT, at: [0, 0.2, 0.05], half: 0.3 },
  'squat-3q': { pose: { hips: [25, 0, 0], upperLegL: [-115, 0, 8], upperLegR: [-115, 0, -8], lowerLegL: [140, 0, 0], lowerLegR: [140, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0],
    upperArmL: [-70, 0, 25], upperArmR: [-70, 0, -25], forearmL: [-130, 0, 0], forearmR: [-130, 0, 0], handL: [-50, 0, 0], handR: [-50, 0, 0] }, dir: THREEQ, at: [0, 0.95, 0.15], half: 0.8 },
};
const PORT = 5290;
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const url = `http://localhost:${PORT}/tools/asset-pipeline/pose-compare.html`;
for (let i = 0; i < 120; i++) { try { if ((await fetch(url)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 500)); }
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(url);
  await page.waitForFunction(() => typeof window.__poseCompare === 'function', null, { timeout: 120000 });
  const names = Object.keys(SHOTS);
  const shots = await page.evaluate(([i, f, s]) => window.__poseCompare(i, f, s), [id, all, names.map((n) => SHOTS[n])]);
  await mkdir(outDir, { recursive: true });
  for (let k = 0; k < names.length; k++) await writeFile(`${outDir}/${id}-${names[k]}.png`, Buffer.from(shots[k].split(',')[1], 'base64'));
  console.log(`wrote ${names.length} shots to ${outDir}`);
} finally { await browser.close(); vite.kill(); }
