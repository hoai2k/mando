/**
 * Re-encode oversized authored textures for web delivery.
 *
 * Usage: node tools/optimize-textures.mjs [--check]
 *
 * The generated PNGs land at ~1.9 MB each, which is far more than a browser
 * game should ship. Anything fully opaque re-encodes to JPEG at a fraction of
 * the size with no visible loss at in-game texel density. Files that need an
 * alpha channel, and the normal map (JPEG ringing corrupts surface normals),
 * stay PNG.
 *
 * Uses the Playwright Chromium already installed for the boot tests — no
 * native image toolchain (sharp / ImageMagick / PIL) is available here.
 */
import { chromium } from 'playwright';
import { readdir, readFile, writeFile, stat, unlink } from 'fs/promises';

const DIR = new URL('../public/assets/textures/', import.meta.url).pathname;
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// PNGs that must stay PNG, and why
const KEEP_PNG = new Set([
  'sand_normal.png', // normal map: JPEG artefacts become surface artefacts
  'neon_sign.png',   // alpha: sign glyphs sit on transparency
]);

const QUALITY = 0.9;
const checkOnly = process.argv.includes('--check');

const files = (await readdir(DIR)).filter((f) => f.endsWith('.png') || f.endsWith('.jpg'));
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();

let before = 0, after = 0;
for (const file of files) {
  const path = DIR + file;
  const size = (await stat(path)).size;
  before += size;

  if (KEEP_PNG.has(file) || file.endsWith('.jpg')) {
    after += size;
    console.log(`keep  ${file.padEnd(24)} ${(size / 1024).toFixed(0).padStart(5)} KB`);
    continue;
  }

  const b64 = (await readFile(path)).toString('base64');
  const result = await page.evaluate(async ([data, quality]) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = `data:image/png;base64,${data}`; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    // refuse to flatten anything with real transparency
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return { opaque: false };
    const url = c.toDataURL('image/jpeg', quality);
    return { opaque: true, jpeg: url.slice(url.indexOf(',') + 1) };
  }, [b64, QUALITY]);

  if (!result.opaque) {
    after += size;
    console.log(`alpha ${file.padEnd(24)} ${(size / 1024).toFixed(0).padStart(5)} KB (kept as PNG)`);
    continue;
  }

  const out = Buffer.from(result.jpeg, 'base64');
  const outName = file.replace(/\.png$/, '.jpg');
  after += out.length;
  const pct = (100 - (out.length / size) * 100).toFixed(0);
  console.log(`jpeg  ${file.padEnd(24)} ${(size / 1024).toFixed(0).padStart(5)} KB -> ${(out.length / 1024).toFixed(0).padStart(5)} KB  (-${pct}%)`);
  if (!checkOnly) {
    await writeFile(DIR + outName, out);
    await unlink(path);
  }
}

console.log(`\ntotal ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
if (checkOnly) console.log('(--check: nothing written)');
await browser.close();
process.exit(0);
