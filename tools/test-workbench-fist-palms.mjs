/**
 * Fists seated from the palms: a hand's knuckle joint sits where its palm
 * mark says the fingers start (`fistRig.ts` `seatFistsOnPalms`), so moving a
 * palm in the workbench (Weapon grips → Hand anchors) moves that hand's
 * fist, and only that hand's. And a sculpt whose hand bone was put down at
 * the fingertips (the Pyke) still gets fingers to close: the toggle curls them.
 *
 * Run:  node tools/test-workbench-fist-palms.mjs
 */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const page = h.page;

/** each hand's knuckle joint, in its parent bone's frame */
const knuckles = () => page.evaluate(() => {
  const out = {};
  window.__wb.figures[0].inst.root.traverse((o) => { if (/^fist_knuckle[LR]$/.test(o.name)) out[o.name.slice(-1)] = o.position.toArray(); });
  return out;
});
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

try {
  await h.workbench('din', 'idle', 'mode=authored');
  await page.locator('#pauseAnimation').click();
  const before = await knuckles();
  check('Din has a knuckle joint on each hand', before.L && before.R, before);

  // move his right palm 2 cm down the hand (the fingers are down -Y)
  await page.locator('#editToggle').click();
  await page.locator('[data-edit-kind="weapon"]').click();
  await page.locator('[data-palm="R"]').click();
  const axis = page.locator('[data-palm-axis="1"]');
  const y = Number(await axis.inputValue());
  await axis.fill(String(+(y - 0.02).toFixed(4)));
  await axis.dispatchEvent('change');
  await page.waitForTimeout(300);
  const after = await knuckles();
  check('moving a palm moves that hand\'s knuckle joint', dist(before.R, after.R) > 1e-3, { before: before.R, after: after.R });
  check('...and leaves the other hand\'s alone', dist(before.L, after.L) < 1e-6, { before: before.L, after: after.L });

  await page.locator('[data-history="undo"]').click();
  await page.waitForTimeout(300);
  const undone = await knuckles();
  check('undo puts the palm, and the knuckle joint, back', dist(before.R, undone.R) < 1e-6, { before: before.R, undone: undone.R });
  await page.locator('#editToggle').click();

  // the Pyke's hand lies before its hand bone, on the forearm's twist
  await h.workbench('pyke', 'idle', 'mode=authored');
  const turn = () => page.evaluate(() => {
    let knuckle = null;
    window.__wb.figures[0].inst.root.traverse((o) => { if (o.name === 'fist_knuckleR') knuckle = o; });
    if (!knuckle) return null;
    // the turn off its rest (it hangs off the twist bone, turned as the hand is)
    const rest = knuckle.userData.fistCurl.rest;
    const q = rest ? knuckle.quaternion.clone().premultiply(knuckle.quaternion.clone().set(...rest).invert()) : knuckle.quaternion;
    return 2 * Math.acos(Math.min(1, Math.abs(q.w)));
  });
  const open = await turn();
  check('the Pyke has fingers to close', open !== null, open);
  await page.locator('#fists').check();
  await page.waitForTimeout(200);
  const closed = await turn();
  check('Clench fists curls the Pyke\'s fingers', open < 0.05 && closed > 1, { open, closed });
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Workbench fist palms');
