/**
 * Look at the broodmother's clutch.
 *
 * The rack is driven on the sculpt's own six eggs (`src/characters/eggrack.ts`)
 * — ready is the model untouched, spent is that same egg collapsed against her
 * back — and the one thing a check cannot tell you is whether that reads. This
 * puts her on the workbench turntable, pushes each rack state through her, and
 * writes a picture per state, along with the world spots `eggSpot` reports,
 * which is where the delivered egg is born.
 *
 * Usage:  node tools/shot-brood.mjs [outdir]      (default /tmp/brood)
 */
import { mkdir } from 'node:fs/promises';
import { launch } from './harness.mjs';

const out = process.argv[2] || '/tmp/brood';
await mkdir(out, { recursive: true });

const port = process.env.HARNESS_PORT ?? '4173';
const h = await launch({ url: `http://localhost:${port}/workbench/`, width: 900, height: 760 });
const { page } = h;

await page.waitForFunction(() => window.__wb, null, { timeout: 120000 });
await page.evaluate(() => {
  const sel = document.querySelector('select#character');
  sel.value = 'broodmother';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  // the sculpt on its own: the compare view puts the stand-in in the way
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Model')?.click();
});

// real time, not frames: her .glb arrives on a promise
for (let i = 0; i < 60; i++) {
  const ready = await page.evaluate(() => {
    let skinned = 0;
    for (const f of window.__wb?.figures ?? []) f.inst.root.traverse((o) => { if (o.isSkinnedMesh) skinned++; });
    return skinned > 0 && window.__wb.figures.some((f) => f.inst.setEggs);
  });
  if (ready) break;
  await new Promise((r) => setTimeout(r, 2000));
}

const look = (eye, target) => page.evaluate(([e, t]) => {
  const { camera, controls } = window.__wb;
  camera.position.set(e[0], e[1], e[2]);
  controls.target.set(t[0], t[1], t[2]);
  controls.update();
}, [eye, target]);

/** push a rack state, let the ease settle, and write the frame */
const shot = async (name, states, settle = 4000) => {
  await page.evaluate((s) => {
    for (const f of window.__wb.figures) f.inst.setEggs?.(s);
  }, states);
  await new Promise((r) => setTimeout(r, settle));
  await page.screenshot({ path: `${out}/${name}.png` });
  const info = await page.evaluate(() => {
    const f = window.__wb.figures.find((x) => x.inst.eggShown);
    const v = new (window.__wb.camera.position.constructor)();
    const spots = [];
    for (let i = 0; i < 6; i++) {
      v.set(0, 0, 0);
      spots.push(f.inst.eggSpot(i, v) ? [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)] : null);
    }
    return { shown: [0, 1, 2, 3, 4, 5].map((i) => f.inst.eggShown(i)), spots };
  });
  console.log(`${name} -> ${out}/${name}.png`, JSON.stringify(info));
};

const SPENT = [-1, -1, -1, -1, -1, -1];
const READY = [1, 1, 1, 1, 1, 1];
// three charged low, the fourth halfway up: what a clutch mid-match looks like
const MID = [1, 1, 1, 0.4, -1, -1];

await look([0.2, 3.2, -5.2], [0, 2.0, -1.2]);          // over her back, from behind
await shot('rear-ready', READY);
await shot('rear-spent', SPENT);
await shot('rear-mid', MID);

await look([6.4, 4.0, -6.2], [0, 2.4, -1.6]);          // three-quarter, the clutch in profile
await shot('quarter-ready', READY);
await shot('quarter-spent', SPENT);

await h.close();
