/**
 * Render select-grid portraits from the authored models (tools/portrait/).
 *
 *   node tools/portraits.mjs din maul boba_fett      # writes portrait_<id>.jpg
 *   node tools/portraits.mjs --out=/tmp/x din        # somewhere else, to compare
 *
 * For fighters image generation cannot be trusted with; the page lights and
 * frames them in the painted portraits' house style. Per-fighter framing lives
 * in FRAMING below. Starts its own Vite dev server — the page is dev-only.
 */
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { loadPlaywright } from './harness.mjs';

/** per-fighter framing: see PortraitOpts in tools/portrait/portrait.ts */
const FRAMING = {
  din: { turn: 0.22 },
  // a bare head is smaller than a helmet: come in closer so it reads the same size
  maul: { turn: 0.25, weapon: 'none', span: 0.56 },
  // the rangefinder stalk is the top of him: let it run to the edge
  boba_fett: { turn: 0.3, headroom: 0.0 },
};

const args = process.argv.slice(2);
const outDir = (args.find((a) => a.startsWith('--out='))?.slice(6)) ?? 'public/assets/textures';
const ids = args.filter((a) => !a.startsWith('--'));
if (!ids.length) { console.error('usage: node tools/portraits.mjs <id> ...'); process.exit(1); }

const PORT = 5287;
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const url = `http://localhost:${PORT}/tools/portrait/`;
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 500));
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1300 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__portrait === 'function', null, { timeout: 120000 });
  await mkdir(outDir, { recursive: true });
  for (const id of ids) {
    const data = await page.evaluate(([i, o]) => window.__portrait(i, o), [id, FRAMING[id] ?? {}]);
    if (!data?.startsWith('data:image/jpeg')) { console.log(`  ${id}: FAILED`); failed++; continue; }
    const file = `${outDir}/portrait_${id}.jpg`;
    await writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log(`  ${id}: ${file}`);
  }
} finally {
  await browser.close();
  vite.kill();
}
process.exit(failed ? 1 : 0);
