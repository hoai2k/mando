/**
 * The browser half of the geometric joint estimator: serves the repo with
 * Vite, opens `geo-joints.html` in Chromium and gives back a handle whose
 * `dump(id, height)` returns a character's bind-pose triangles (and, for
 * comparison only, its skeleton's joints), and whose `shot(spec)` renders a
 * picture. See geo-joints.mjs.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';
import { loadPlaywright } from '../harness.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function openGeoPage() {
  const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 5197, strictPort: false } });
  await server.listen();
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
  page.on('pageerror', (e) => console.error('[page]', e));
  const load = async () => {
    await page.goto(`http://localhost:${server.config.server.port}/tools/asset-pipeline/geo-joints.html`);
    await page.waitForFunction(() => window.__geoReady, null, { timeout: 180000 });
  };
  await load();
  return {
    /** a fresh page: the loader caches every model it has seen (textures and all), so start clean per model */
    reset: load,
    async dump(id, height) {
      const r = await page.evaluate(([i, h]) => window.__geoDump(i, h), [id, height]);
      const buf = Buffer.from(r.tris, 'base64');
      return { tris: new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4), joints: r.joints, bones: r.bones };
    },
    async shot(spec) {
      const url = await page.evaluate((s) => window.__geoShot(s), spec);
      return Buffer.from(url.split(',')[1], 'base64');
    },
    async close() { await browser.close(); await server.close(); },
  };
}
