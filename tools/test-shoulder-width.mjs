/** Authored shoulder sockets hold one width per upper-body clip. */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const base = `http://localhost:${process.env.HARNESS_PORT ?? '4173'}`;
const h = await launch({ url: `${base}/workbench/?character=maris&pose=run&mode=authored` });
const page = h.page;

async function shoulderState() {
  return page.evaluate(() => {
    const inst = window.__wb.figures[0].inst;
    const root = inst.root;
    const left = root.getObjectByName('DEF-upper_armL');
    const right = root.getObjectByName('DEF-upper_armR');
    return {
      sockets: [left.position.x, right.position.x],
      arms: [inst.rig.bones.upperArmL.quaternion.toArray(),
        inst.rig.bones.upperArmR.quaternion.toArray()],
    };
  });
}

try {
  await page.waitForFunction(() => window.__wb?.figures?.[0]?.inst.modelReady?.(),
    undefined, { timeout: 120000 });
  check('Maris defaults to 50% rest shoulder width',
    await page.locator('#restShoulders').inputValue() === '0.5');

  await page.locator('#pauseAnimation').click();
  const samples = [];
  for (const fraction of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
    await page.locator('#animationTime').evaluate((slider, f) => {
      slider.value = String(Math.round(Number(slider.max) * f));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, fraction);
    samples.push(await shoulderState());
  }
  const span = (values) => Math.max(...values) - Math.min(...values);
  check('Maris run shoulders stay fixed while both arms swing',
    [0, 1].every((side) => span(samples.map((s) => s.sockets[side])) < 1e-6)
      && [0, 1].every((side) => span(samples.map((s) => s.arms[side][0])) > 0.05));

  await page.locator('#restShoulders').evaluate((slider) => {
    slider.value = '1';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const widened = await shoulderState();
  check('workbench rest-width adjustment refreshes the fixed clip width',
    Math.abs(widened.sockets[0] - samples[0].sockets[0]) > 0.005);
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Shoulder width');
