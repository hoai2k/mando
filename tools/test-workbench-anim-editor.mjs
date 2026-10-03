/**
 * The animation editor at /workbench/?edit=pose, and the model workbench's
 * default view.
 *
 * Opens on Idle with Din; pausing holds the clock; a turn of a joint keys it
 * at the playhead; keys drag along the timeline, delete, and come back on
 * undo; a double-click adds one; another character plays the edit; another
 * animation opens on its own default character; and the export holds every
 * clip edited in the session.
 */
import { readFile } from 'fs/promises';
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const base = `http://localhost:${process.env.HARNESS_PORT ?? '4173'}`;
const h = await launch({ url: `${base}/workbench/?edit=pose`, width: 1500, height: 900 });
const page = h.page;

const ready = () => page.waitForFunction(() => window.__wb?.figures?.[0]?.inst.modelReady?.(), undefined, { timeout: 120000 });
/** a track as the figure's clip plays it */
const track = (clip, name) => page.evaluate(([c, n]) => {
  const t = window.__wb.figures[0].inst.animator.clips[c]?.tracks.find((x) => x.name === n);
  return t ? { times: Array.from(t.times), values: Array.from(t.values) } : null;
}, [clip, name]);
const time = () => page.evaluate(() => Number(document.querySelector('#tlTime').textContent.split(' ')[0]));
const ctrl = process.platform === 'darwin' ? 'Meta' : 'Control';

try {
  await ready();
  const opened = await page.evaluate(() => ({
    subject: window.__wb.subject.id, pose: window.__wb.pose.id, figures: window.__wb.figures.length,
    items: document.querySelectorAll('#animList .al-item').length,
    current: document.querySelector('#animList .al-item.current')?.textContent.trim(),
    rows: document.querySelectorAll('.tl-scroll .tl-row:not(.tl-ruler):not(.tl-summary)').length,
  }));
  check('opens on Idle with Din, one figure', opened.subject === 'din' && opened.pose === 'idle' && opened.figures === 1, JSON.stringify(opened));
  check('the animation list is long and marks Idle', opened.items > 50 && opened.current === 'Idle', `${opened.items} items, current ${opened.current}`);
  check('the timeline has a row per keyed joint', opened.rows >= 10, `${opened.rows} rows`);

  // pause: the clock stops
  await page.keyboard.press('Space');
  const t0 = await time();
  await page.waitForTimeout(600);
  check('Space pauses playback', Math.abs((await time()) - t0) < 1e-6, `${t0} -> ${await time()}`);

  // step a frame
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  check('→ steps one frame', Math.abs((await time()) - 1 / 60) < 0.006, String(await time()));

  // click the middle summary key: selects every key there and holds that frame
  await page.locator('.tl-summary .k').nth(1).click();
  const mid = await time();
  const selected = await page.locator('.tl-scroll .k.sel').count();
  check('a summary key selects every key at its time', selected > 5 && mid > 0.5, `${selected} at ${mid}`);

  // turn a joint where the playhead is: the clip gets the turn at that key
  const before = await track('idleUpper', 'upperArmL.quaternion');
  await page.evaluate(() => {
    const ed = window.__wb.editor;
    ed.select('upperArmL');
    const bone = window.__wb.figures[0].inst.rig.bones.upperArmL;
    bone.rotateZ(0.5);
    window.__wb.animUI.commitBone('upperArmL');
  });
  const after = await track('idleUpper', 'upperArmL.quaternion');
  const i = after.times.findIndex((t) => Math.abs(t - mid) < 0.01);
  const moved = i >= 0 && after.values.slice(i * 4, i * 4 + 4).some((v, k) => Math.abs(v - before.values[i * 4 + k]) > 0.05);
  check('a turn keys the joint at the playhead', moved && after.times.length === before.times.length, JSON.stringify(after.times));
  check('…and the first key is untouched', after.values.slice(0, 4).every((v, k) => Math.abs(v - before.values[k]) < 1e-5));
  check('the row and the list show the edit', await page.locator('.tl-row.edited').count() > 0
    && await page.locator('#animList .al-item.current.edited').count() === 1);
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await page.waitForTimeout(100);

  // drag the selected keys 0.25 s later
  const lane = await page.locator('.tl-ruler .tl-lane').boundingBox();
  const span = 3;
  const key = page.locator('.tl-summary .k').nth(1);
  const box = await key.boundingBox();
  const startX = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + 30, y, { steps: 3 });
  await page.mouse.move(startX + (0.25 / span) * lane.width, y, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const dragged = await track('idleUpper', 'upperArmL.quaternion');
  check('dragging keys moves them in time', dragged.times.some((t) => Math.abs(t - (mid + 0.25)) < 0.03)
    && !dragged.times.some((t) => Math.abs(t - mid) < 0.005), JSON.stringify(dragged.times));

  // delete them, then undo
  const keysBefore = (await track('idleUpper', 'chest.quaternion')).times.length;
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  const keysAfter = (await track('idleUpper', 'chest.quaternion'))?.times.length ?? 0;
  check('Delete removes the selected keys', keysAfter === keysBefore - 1, `${keysBefore} -> ${keysAfter}`);
  await page.keyboard.press(`${ctrl}+z`);
  await page.waitForTimeout(200);
  check('undo brings them back', (await track('idleUpper', 'chest.quaternion')).times.length === keysBefore);

  // double-click a row: a new key there
  const row = page.locator('.tl-scroll .tl-row').filter({ hasText: 'forearmL' }).locator('.tl-lane');
  const rb = await row.boundingBox();
  const forearmBefore = (await track('idleUpper', 'forearmL.quaternion')).times.length;
  await row.dblclick({ position: { x: rb.width * 0.2, y: rb.height / 2 } });
  await page.waitForTimeout(150);
  check('double-click adds a key', (await track('idleUpper', 'forearmL.quaternion')).times.length === forearmBefore + 1);

  // another character plays the same edit
  const edited = await track('idleUpper', 'upperArmL.quaternion');
  await page.selectOption('#animCharacter', 'paz');
  await ready();
  const onPaz = await track('idleUpper', 'upperArmL.quaternion');
  check('another character plays the edit', !!onPaz && onPaz.times.length === edited.times.length
    && onPaz.values.every((v, k) => Math.abs(v - edited.values[k]) < 1e-5));
  check('a character that cannot play it is not offered',
    await page.locator('#animCharacter option[value="stormtrooper"]').isDisabled() === false
    && await page.evaluate(() => {
      document.querySelector('#animList [data-entry="parry"]').click();
      return [...document.querySelectorAll('#animCharacter option')].find((o) => o.value === 'din').disabled;
    }));
  await ready();
  check('another animation opens on its own default character', await page.evaluate(() => window.__wb.subject.id) === 'ventress');

  // Idle again: back on Paz, the character last chosen for it
  await page.locator('#animList [data-entry="idle"]').click();
  await ready();
  check('an animation reopens on the character chosen for it', await page.evaluate(() => window.__wb.subject.id) === 'paz');

  // the export
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#animExport').click()]);
  const doc = JSON.parse(await readFile(await download.path(), 'utf8'));
  const up = doc.clips?.idleUpper;
  check('export is the anim-edit format', doc.format === 'mando-anim-edit/1');
  check('export holds the edited clip and tracks', !!up?.tracks?.['upperArmL.quaternion']?.newKeys && !!up.tracks['forearmL.quaternion']
    && up.playedBy.includes('Idle'), Object.keys(doc.clips ?? {}).join(','));
  check('export names keys added and moved', up.tracks['forearmL.quaternion'].added.length === 1
    && up.tracks['upperArmL.quaternion'].removed.length === 1 && up.tracks['upperArmL.quaternion'].added.length === 1);
  check('export keys are Euler degrees', up.tracks['upperArmL.quaternion'].newKeys.every((k) => k.deg?.length === 3));

  // the model workbench opens on the model alone
  await page.goto(`${base}/workbench/?edit=models&character=din&pose=idle`);
  await page.waitForFunction(() => window.__wb?.figures?.length > 0, undefined, { timeout: 120000 });
  check('the model workbench defaults to Model, not Compare', await page.evaluate(() => window.__wb.figures.length) === 1
    && await page.locator('#mode [data-mode="authored"][aria-pressed="true"]').count() === 1);

  check('no page errors', h.errors.length === 0, h.errors.join(' | '));
} finally {
  await h.close();
}
check.done('workbench animation editor');
