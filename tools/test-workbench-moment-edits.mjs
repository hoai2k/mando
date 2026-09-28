/**
 * Edits pinned to one keyframe of a clip, their export, their undo — and the
 * fist toggle.
 *
 * Editing a moment, the slider runs freely while dragged and settles on the
 * nearest of the clip's own keys when let go; the edit changes that key and
 * leaves the rest of the clip alone: the first frame must not move, the
 * settled-on frame must, and the export must name the time.
 */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const base = `http://localhost:${process.env.HARNESS_PORT ?? '4173'}`;
const h = await launch({ url: `${base}/workbench/?edit=models&character=paz&pose=unarmed1&mode=authored` });
const page = h.page;

const clipState = () => page.evaluate(() => {
  const anim = window.__wb.figures[0].inst.animator;
  const track = anim.clips.fistCrossUpper.tracks.find((t) => t.name === 'forearmR.quaternion');
  return { keys: track.times.length, times: Array.from(track.times), first: Array.from(track.values.slice(0, 4)) };
});
const boneAngle = () => page.evaluate(() => {
  const q = window.__wb.figures[0].inst.rig.bones.forearmR.quaternion;
  return 2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI;
});
const ledger = () => page.locator('#edit .ledger .edit span').allTextContents();

try {
  await page.waitForFunction(() => window.__wb?.figures?.[0]?.inst.modelReady?.(), undefined, { timeout: 120000 });
  const before = await clipState();

  await page.locator('#pauseAnimation').click();
  await page.locator('#editToggle').click();
  await page.locator('[data-edit-at="moment"]').click();
  const slider = page.locator('#animationTime');
  check('editing a moment keeps the time slider live', await slider.isEnabled());
  // the cross keys every joint at 0, 0.25, 0.38, 0.45, 0.6 of the clip; drag
  // to frame 19 (0.32 s) and let go, and it settles on the launch key (0.34 s)
  const launch = Math.round(0.38 * 0.75 * 1.18 * 1000) / 1000;
  await slider.evaluate((s) => { s.value = '19'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  const dragged = await page.evaluate(() => window.__wb.figures[0].inst.animator.clipProgress('upper'));
  await slider.evaluate((s) => s.dispatchEvent(new Event('change', { bubbles: true })));
  const settled = await page.evaluate(() => window.__wb.figures[0].inst.animator.clipProgress('upper'));
  const dur = 0.75 * 1.18;
  check('the slider moves freely, then settles on the nearest key',
    Math.abs(dragged * dur - 19 / 60) < 2e-3 && Math.abs(settled * dur - launch) < 2e-3, { dragged, settled });
  await page.locator('#bone').selectOption('forearmR');
  const at = await boneAngle();
  const rx = page.locator('#rx');
  const value = Number(await rx.inputValue());
  await rx.fill(String(value + 30));
  await page.waitForTimeout(100);

  const rows = await ledger();
  check('the ledger names the joint and the key', rows.some((r) => r.includes('forearmR') && r.includes(`@${launch.toFixed(2)}s`)), rows);
  const after = await clipState();
  check('the edit changes a key the clip has, adding none', after.keys === before.keys
    && after.times.every((t, i) => Math.abs(t - before.times[i]) < 1e-6), after.times);
  check('the clip’s first frame is untouched', after.first.every((v, i) => Math.abs(v - before.first[i]) < 1e-6));
  const turned = await boneAngle();
  check('the scrubbed frame shows the edit', Math.abs(turned - at) > 20, { at, turned });

  const doc = await page.evaluate(async () => {
    let blob = null;
    const original = URL.createObjectURL;
    URL.createObjectURL = (b) => { blob = b; return original.call(URL, b); };
    document.querySelector('#export').click();
    URL.createObjectURL = original;
    return JSON.parse(await blob.text());
  });
  const moment = doc.clips?.fistCrossUpper?.bones?.forearmR?.moments?.[0];
  check('the export carries the moment, its time and its delta',
    doc.format === 'mando-pose-edit/3' && moment && Math.abs(moment.at - launch) < 2e-3
      && Math.abs(moment.delta[0] - 30) < 0.5 && moment.share > 0 && moment.share < 1, moment);

  await page.locator('#undo').click();
  const undone = await clipState();
  check('undo restores the key', undone.keys === before.keys && (await ledger()).length === 0
    && (await boneAngle()) - at < 0.5, undone);

  // fists: the fingers the model was delivered without, curled on demand
  await page.locator('#editToggle').click();
  await page.locator('#fists').check();
  await page.waitForTimeout(200);
  const fist = await page.evaluate(() => {
    let knuckle = null;
    window.__wb.figures[0].inst.root.traverse((o) => { if (o.name === 'fist_knuckleR') knuckle = o; });
    return knuckle ? knuckle.rotation.z : null;
  });
  check('Clench fists curls the fingers', fist !== null && fist > 1, { fist });
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Workbench moment edits');
