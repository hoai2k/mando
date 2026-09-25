/** Bossk's carry/aim grips and the choice-screen handoff with a delayed rifle. */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const base = `http://localhost:${process.env.HARNESS_PORT ?? '4173'}`;
const h = await launch({ url: `${base}/workbench/?character=bossk&pose=aim&mode=authored` });
let releaseRifle = () => {};

try {
  const page = h.page;
  await page.waitForFunction(() => window.__wb?.figures?.[0]?.inst.modelReady?.(), null, { timeout: 120000 });
  const grip = () => page.evaluate(() => {
    const f = window.__wb.figures[0];
    f.inst.cosmetic?.(0, 0);
    const rifle = f.inst.muzzle.parent;
    return { clip: f.inst.animator.playing('upper'), position: rifle.position.toArray(),
      quaternion: rifle.quaternion.toArray(), scale: rifle.scale.x };
  });
  const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-5);
  const aim = await grip();
  check('Bossk aim uses the submitted rifle grip and scale',
    aim.clip === 'aimUpper' && near(aim.position, [-0.10552, -0.358886, 0.114163])
    && near(aim.quaternion, [0.6799579, -0.0927467, -0.0845205, 0.7224345]) && aim.scale === 1.23);
  await page.locator('#pose').selectOption('runaim');
  const running = await grip();
  check('running aim keeps the aim grip', running.clip === 'aimUpper' && near(running.position, aim.position));
  await page.locator('#pose').selectOption('idle');
  const carry = await grip();
  check('Bossk idle uses the submitted carry grip',
    carry.clip === 'idleUpper' && near(carry.position, [0.008026, -0.060982, 0.023936])
    && near(carry.quaternion, [0.6696135, -0.0169063, 0.0185478, 0.7422856]) && carry.scale === 1.23);

  // Hold the real rifle request after the body arrives. The poster must stay
  // over the hidden 3D fighter, and confirmation must wait for the whole kit.
  const select = await h.browser.newPage();
  let requested;
  const rifleRequested = new Promise((resolve) => { requested = resolve; });
  const held = new Promise((resolve) => { releaseRifle = resolve; });
  await select.route('**/longrifle.glb', async (route) => {
    requested();
    await held;
    await route.continue();
  });
  await select.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await select.waitForFunction(() => !!window.__charsel);
  await select.evaluate(() => {
    const cs = window.__charsel;
    cs.configure({ roster: ['bossk'], title: 'Bossk', minPlayers: 1 });
    cs.show();
  });
  await select.waitForFunction(() => {
    const cs = window.__charsel, slot = cs.slots[0];
    return !!slot.poster || cs.showPoster(slot, 'bossk');
  });
  await select.evaluate(() => { for (let i = 0; i < 90; i++) window.__charsel.update(1 / 60); });
  await rifleRequested;
  await select.waitForFunction(() => {
    const cs = window.__charsel, slot = cs.slots[0], fighter = slot.chars.get('bossk');
    return fighter?.modelReady() && fighter.muzzle.parent.userData.propPending;
  }, null, { timeout: 120000 });
  const pending = await select.evaluate(() => {
    const cs = window.__charsel, slot = cs.slots[0], fighter = slot.chars.get('bossk');
    cs.update(1);
    cs.commit(0);
    return { visible: fighter.root.visible, poster: !!slot.poster, phase: slot.phase };
  });
  check('choice screen keeps the poster and blocks selection while the rifle loads',
    !pending.visible && pending.poster && pending.phase === 'browsing');

  releaseRifle();
  await select.waitForFunction(() => {
    const cs = window.__charsel, slot = cs.slots[0], fighter = slot.chars.get('bossk');
    cs.update(1 / 60);
    return !fighter.muzzle.parent.userData.propPending && fighter.root.visible && !slot.poster;
  }, null, { timeout: 120000 });
  const ready = await select.evaluate(() => {
    const cs = window.__charsel, slot = cs.slots[0];
    cs.commit(0);
    return { visible: slot.chars.get('bossk').root.visible, poster: !!slot.poster, phase: slot.phase };
  });
  check('choice screen reveals and accepts the finished fighter',
    ready.visible && !ready.poster && ready.phase === 'spinning');
  await select.close();
} finally {
  releaseRifle();
  await h.close();
}

check.done('Bossk grips and complete choice-screen loading');
