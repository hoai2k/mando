/** Grip export, global scale, paused scrubbing, and clean pose changes. */
import { launch, makeCheck } from './harness.mjs';
import { readFileSync } from 'node:fs';

const armorerGrips = JSON.parse(readFileSync('src/characters/data/armorerWeaponGrips.json', 'utf8'));

const check = makeCheck();
const base = `http://localhost:${process.env.HARNESS_PORT ?? '4173'}`;
const h = await launch({ url: `${base}/workbench/?edit=models&character=armorer&pose=idle&mode=authored` });
const page = h.page;

const ready = () => page.waitForFunction(() => window.__wb?.figures?.[0]?.inst.modelReady?.(),
  undefined, { timeout: 120000 });
const state = () => page.evaluate(() => {
  const f = window.__wb.figures[0], g = f.extras.gaffi, anim = f.inst.animator;
  f.inst.root.updateMatrixWorld(true);
  const mount = f.inst.root.getObjectByName('weaponMount');
  return {
    lower: anim.playing('lower'), upper: anim.playing('upper'),
    visible: g.visible, scale: g.scale.x, quaternion: g.quaternion.toArray(),
    anchor: mount.matrixWorld.elements.slice(12, 15),
    arm: f.inst.rig.bones.upperArmR.quaternion.toArray(),
  };
});
const near = (a, b, tolerance = 1e-5) => a.length === b.length
  && a.every((value, i) => Math.abs(value - b[i]) < tolerance);

try {
  await ready();
  const initial = await state();
  check('Armorer idle shows the axe at the exported global scale',
    initial.visible && initial.upper === 'idleUpper' && initial.scale === 1.24);

  for (const entry of armorerGrips.entries) {
    const [pose, alternate] = entry.pose.split(':');
    await page.locator('#pose').selectOption(pose);
    if (alternate) await page.locator('#attackAlternate').selectOption(alternate);
    const actual = await page.evaluate(() => {
      const axe = window.__wb.figures[0].extras.gaffi;
      return { position: axe.position.toArray(), quaternion: axe.quaternion.toArray(), scale: axe.scale.x,
        clip: window.__wb.figures[0].inst.animator.playing('upper') };
    });
    check(`Armorer ${entry.pose} uses the submitted hand-local grip`,
      near(actual.position, entry.editedPosition)
        && (near(actual.quaternion, entry.editedQuaternion)
          || near(actual.quaternion, entry.editedQuaternion.map((n) => -n)))
        && actual.scale === armorerGrips.weaponScales[0].scaleMultiplier);
  }
  await page.locator('#pose').selectOption('idle');

  await page.locator('#pauseAnimation').click();
  check('paused playback exposes the animation-time slider', await page.locator('#animationTime').isVisible());
  await page.locator('#pose').selectOption('melee1');
  const melee = await state();
  await page.locator('#pose').selectOption('idle');
  const idle = await state();
  check('melee to idle replaces the authored pose and grip',
    melee.upper !== idle.upper && idle.upper === 'idleUpper'
      && Math.abs(melee.anchor[1] - idle.anchor[1]) > 0.4
      && near(initial.quaternion, idle.quaternion));

  await page.locator('#animationTime').evaluate((input) => {
    input.value = '18';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const scrubbed = await state();
  check('time slider seeks to frame 18 and updates the authored model',
    (await page.locator('#animationTimeValue').textContent()).startsWith('0.30 /')
      && !near(idle.arm, scrubbed.arm));

  await page.locator('#editToggle').click();
  await page.locator('[data-edit-kind="weapon"]').click();
  await page.waitForFunction(() => [...document.querySelector('#weaponTarget').options]
    .some((option) => option.textContent.includes('poleaxe')));
  const labels = await page.locator('#weaponTarget option').allTextContents();
  await page.locator('#weaponTarget').selectOption({ label: labels.find((label) => label.includes('poleaxe')) });
  const before = await state();
  await page.locator('#weaponScale').evaluate((input) => {
    input.value = '1.25';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  check('scale slider updates the editable number', await page.locator('#weaponScaleNumber').inputValue() === '1.25');
  await page.locator('#weaponScaleNumber').fill('1.50');
  const after = await state();
  check('scale grows about the hand anchor', Math.abs(after.scale / before.scale - 1.5) < 1e-6 && near(before.anchor, after.anchor)
    && near(before.quaternion, after.quaternion));

  await page.locator('#pose').selectOption('melee1');
  const scaledMelee = await state();
  await page.locator('#pose').selectOption('idle');
  const scaledIdle = await state();
  check('weapon scale persists across poses; idle grip returns',
    Math.abs(scaledMelee.scale / initial.scale - 1.5) < 1e-6
      && Math.abs(scaledIdle.scale / initial.scale - 1.5) < 1e-6
      && near(initial.quaternion, scaledIdle.quaternion));

  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { window.__weaponExport = blob; return create(blob); };
  });
  await page.locator('#weaponExport').click();
  const scaleExport = await page.evaluate(async () => JSON.parse(await window.__weaponExport.text()));
  check('export stores one global weapon multiplier', scaleExport.format === 'mando-authored-weapon-grips/3'
    && scaleExport.entries.length === 0 && scaleExport.weaponScales.length === 1
    && scaleExport.weaponScales[0].weapon === 'poleaxe'
    && scaleExport.weaponScales[0].scaleMultiplier === 1.5);

  await page.locator('#weaponReset').click();
  check('reset restores the original scale and idle grip',
    (await state()).scale === initial.scale && near(initial.quaternion, (await state()).quaternion));
  const x = page.locator('[data-weapon-position="0"]');
  await x.fill(String(Number(await x.inputValue()) + 0.04));
  await x.blur();
  await page.locator('#weaponExport').click();
  const gripExport = await page.evaluate(async () => JSON.parse(await window.__weaponExport.text()));
  check('idle grip adjustment exports separately from scale', gripExport.entries.length === 1
    && gripExport.entries[0].pose === 'idle' && gripExport.entries[0].weapon.includes('poleaxe')
    && gripExport.weaponScales.length === 0);

  await page.goto(`${base}/workbench/?edit=models&character=ventress&pose=idle&mode=authored`);
  await ready();
  await page.locator('#editToggle').click();
  await page.locator('[data-edit-kind="weapon"]').click();
  await page.waitForFunction(() => [...document.querySelector('#weaponTarget').options]
    .some((option) => option.textContent.includes('saberHolsterR')));
  const saberOptions = await page.locator('#weaponTarget option').allTextContents();
  await page.locator('#weaponTarget').selectOption({ label: saberOptions.find((label) => label.includes('saberHolsterR')) });
  await page.locator('#weaponScaleNumber').fill('1.30');
  await page.locator('#pose').selectOption('saberIdle');
  const saberScale = await page.evaluate(() => window.__wb.figures[0].inst.root.getObjectByName('saberHandR').scale.x);
  check('saber scale carries from hip to hand', saberScale === 1.3);
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Workbench weapon grips');
