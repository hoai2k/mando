/**
 * Draw the rig joint audit on a model: each skeleton joint in red, where the
 * mesh says it should be in green, joined by a yellow line — front and side,
 * orthographic, over the model at a third opacity. Reads
 * `docs/audits/rig-joints.json` (written by `measure-lod.mjs`); modifies nothing.
 *
 *   CHROMIUM_PATH=... node tools/asset-pipeline/show-joints.mjs <model id> <out.png>
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';
import { loadPlaywright } from '../harness.mjs';

const [id, out] = process.argv.slice(2);
if (!id || !out) {
  console.error('usage: node tools/asset-pipeline/show-joints.mjs <model id> <out.png>');
  process.exit(2);
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 5198, strictPort: false } });
await server.listen();
const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (e) => console.error('[page]', e));
  await page.goto(`http://localhost:${server.config.server.port}/tools/asset-pipeline/show-joints.html?id=${id}`);
  await page.waitForFunction(() => window.__joints, null, { timeout: 300000 });
  const url = await page.evaluate(() => window.__joints);
  if (!url.startsWith('data:')) throw new Error(url);
  await writeFile(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
  await server.close();
}
