/**
 * Riders on rides, in the workbench.
 *
 *   - The Nikto rides his swoop: parented to the bike, so the hover bob and
 *     the ram carry him with it rather than bobbing the bike under a statue.
 *   - Every ride is on the picker with Din in the seat, his hips on the seat
 *     anchor and his left hand on the grip anchor.
 *   - Moving an anchor in edit mode moves him with it, and the export is the
 *     game's own vehicleAnchors.json with the edit in it.
 *
 * Run:  node tools/test-vehicle-anchors.mjs
 */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const base = `http://localhost:${process.env.HARNESS_PORT ?? '4173'}`;
const h = await launch({ url: `${base}/workbench/?character=nikto&mode=authored` });
const { page } = h;
const settle = () => page.waitForFunction(() => {
  const f = window.__wb?.figures?.[0];
  return f && (f.inst.modelReady?.() ?? true);
}, null, { timeout: 90000 });
await settle();
await page.waitForTimeout(500);

const nikto = await page.evaluate(async () => {
  const r = window.__wb.figures[0].inst.root.userData.niktoRider;
  const gaps = [];
  for (let i = 0; i < 8; i++) {
    await new Promise((res) => setTimeout(res, 90));
    r.bike.updateMatrixWorld(true);
    const bike = r.bike.getWorldPosition(r.bike.position.clone());
    const rider = r.rider.getWorldPosition(r.rider.position.clone());
    gaps.push({ bike: bike.y, gap: rider.y - bike.y });
  }
  const bob = Math.max(...gaps.map((g) => g.bike)) - Math.min(...gaps.map((g) => g.bike));
  const drift = Math.max(...gaps.map((g) => g.gap)) - Math.min(...gaps.map((g) => g.gap));
  return { bob: +bob.toFixed(3), drift: +drift.toFixed(4), parent: r.rider.parent === r.bike };
});
check('the Nikto rides his bike (parented to it)', nikto.parent, nikto);
check('...and moves with it as it bobs', nikto.bob > 0.01 && nikto.drift < 0.002, nikto);
const poses = await page.$$eval('#pose option', (os) => os.map((o) => o.textContent));
check('the Nikto has his hover, cruise and ram', ['Hover', 'Cruise — full speed', 'Ram'].every((p) => poses.includes(p)), poses);

const groups = await page.$$eval('#character optgroup', (gs) => gs.map((g) => ({
  label: g.label, ids: [...g.querySelectorAll('option')].map((o) => o.value),
})));
const rides = groups.find((g) => g.label === 'Creatures & vehicles');
check('Creatures & vehicles lists every ride', !!rides && ['swoop', 'speederBike', 'landspeeder', 'bantha', 'skiff']
  .every((k) => rides.ids.includes(`vehicle:${k}`)), rides?.ids);
check('...and no weapons', !!rides && !rides.ids.some((id) => /carbine|gaffi|rifle|club|projector|launcher|electrostaff/.test(id)));

for (const kind of ['swoop', 'speederBike', 'landspeeder', 'bantha', 'skiff']) {
  await page.goto(`${base}/workbench/?character=vehicle:${kind}&mode=authored`);
  await settle();
  await page.waitForTimeout(400);
  const seat = await page.evaluate(() => {
    const vr = window.__wb.figures[0].inst.root.userData.vehicleRig;
    vr.frame.updateMatrixWorld(true);
    const rider = vr.frame.children.find((c) => c !== vr.frame.children[0] && c.getObjectByName?.('hips'));
    const hips = rider.getObjectByName('hips').getWorldPosition(vr.seat.clone());
    const seatW = vr.frame.localToWorld(vr.seat.clone());
    const hand = rider.getObjectByName('handL')?.getWorldPosition(vr.seat.clone());
    const gripW = vr.frame.localToWorld(vr.grip.clone());
    return {
      stance: vr.def.stance,
      hipsOverSeat: +(hips.y - seatW.y).toFixed(3),
      handToGrip: hand ? +hand.distanceTo(gripW).toFixed(3) : null,
      hasHands: !!vr.def.hands,
    };
  });
  const sat = seat.stance === 'stand' ? true : seat.hipsOverSeat > -0.05 && seat.hipsOverSeat < 0.2;
  check(`${kind}: Din sits the seat anchor`, sat, seat);
  if (seat.hasHands) check(`${kind}: ...with his left hand on the grip`, seat.handToGrip !== null && seat.handToGrip < 0.12, seat);
}

// ---- editing: move the swoop's seat up 10 cm through the panel ----
await page.goto(`${base}/workbench/?character=vehicle:swoop&mode=authored`);
await settle();
await page.click('#editToggle');
await page.click('[data-edit-kind="weapon"]');
await page.waitForSelector('[data-anchor-axis="p1"]');
const before = await page.evaluate(() => window.__wb.figures[0].inst.root.userData.vehicleRig.frame.children
  .find((c) => c.getObjectByName?.('hips')).position.y);
await page.$eval('[data-anchor-axis="p1"]', (el) => { el.value = String(Number(el.value) + 0.1); el.dispatchEvent(new Event('change')); });
await page.waitForTimeout(200);
const after = await page.evaluate(() => window.__wb.figures[0].inst.root.userData.vehicleRig.frame.children
  .find((c) => c.getObjectByName?.('hips')).position.y);
check('raising the seat anchor raises the rider with it', Math.abs(after - before - 0.1) < 0.002, { before, after });
const download = page.waitForEvent('download');
await page.click('#anchorExport');
const file = await (await download).path();
const { readFile } = await import('node:fs/promises');
const json = JSON.parse(await readFile(file, 'utf8'));
check('the export is the game\'s anchor file with the swoop in it',
  json.version === 1 && Array.isArray(json.vehicles?.swoop?.seat) && Array.isArray(json.vehicles.swoop.grip), json);

// ---- paused, an edit still shows on the model; the footrest; the rider's turn ----
if (await page.locator('#pauseAnimation').getAttribute('aria-pressed') !== 'true') await page.click('#pauseAnimation');
const where = (name) => page.evaluate((n) => {
  const vr = window.__wb.figures[0].inst.root.userData.vehicleRig;
  vr.frame.updateMatrixWorld(true);
  let bone = null;
  vr.frame.traverse((o) => { if (!bone && o.name.replace(/[.]/g, '') === n) bone = o; });
  return bone ? vr.frame.worldToLocal(bone.getWorldPosition(vr.seat.clone())).toArray() : null;
}, name);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const setAnchor = async (handle, values) => {
  await page.locator('#anchorTarget').selectOption(handle);
  await page.waitForSelector('[data-anchor-axis="p0"]');
  for (const [i, v] of values.entries()) {
    if (v === null) continue;
    await page.$eval(`[data-anchor-axis="p${i}"]`, (el, value) => { el.value = String(value); el.dispatchEvent(new Event('change')); }, v);
  }
  await page.waitForTimeout(150);
};
const handBefore = await where('DEF-handL');
const grip = await page.evaluate(() => window.__wb.figures[0].inst.root.userData.vehicleRig.grip.toArray());
await setAnchor('grip', [null, null, grip[2] + 0.1]);
const handAfter = await where('DEF-handL');
check('paused, moving the grip moves the model\'s own hand', !!handBefore && !!handAfter
  && handAfter[2] - handBefore[2] > 0.05, { handBefore, handAfter });

const sole = [0.2, 0.2, -0.1];
await setAnchor('foot', sole);
const ankle = await where('footL');
check('a footrest puts the left foot on it (the ankle just over the sole)', !!ankle
  && dist(ankle, [sole[0], sole[1] + 0.08, sole[2]]) < 0.04, { ankle, sole });
const ankleR = await where('footR');
const seatX = await page.evaluate(() => window.__wb.figures[0].inst.root.userData.vehicleRig.seat.x);
check('...and the right foot on its mirror', !!ankleR
  && dist(ankleR, [2 * seatX - sole[0], sole[1] + 0.08, sole[2]]) < 0.04, { ankleR });

// the toes, in the ride's frame: which way each foot points once it is on the rest
const toes = (name) => page.evaluate((n) => {
  const vr = window.__wb.figures[0].inst.root.userData.vehicleRig;
  vr.frame.updateMatrixWorld(true);
  const bone = vr.frame.getObjectByName(n);
  const q = bone.getWorldQuaternion(bone.quaternion.clone());
  const fq = vr.frame.getWorldQuaternion(bone.quaternion.clone()).invert();
  return bone.up.clone().set(0, 0, 1).applyQuaternion(q).applyQuaternion(fq).toArray().map((v) => +v.toFixed(3));
}, name);
const forward = { L: await toes('footL'), R: await toes('footR') };
check('on a footrest the feet still point forward, not twisted back', forward.L[2] > 0.5 && forward.R[2] > 0.5, forward);

const setRotation = async (handle, values) => {
  await page.locator('#anchorTarget').selectOption(handle);
  await page.waitForSelector('[data-anchor-axis="r0"]');
  for (const [i, v] of values.entries()) {
    await page.$eval(`[data-anchor-axis="r${i}"]`, (el, value) => { el.value = String(value); el.dispatchEvent(new Event('change')); }, v);
  }
  await page.waitForTimeout(150);
};
await setRotation('foot', [0, 30, 0]);
const splay = { L: await toes('footL'), R: await toes('footR') };
check('the foot\'s rotation lays the sole: toes turned 30° out, the right foot mirrored',
  Math.abs(splay.L[0] - 0.5) < 0.03 && Math.abs(splay.R[0] + 0.5) < 0.03 && splay.L[2] > 0.8 && Math.abs(splay.L[1]) < 0.03, splay);

await setRotation('grip', [0, 0, 15]);
const gripWarn = await page.locator('.hint.warn').count();
check('a grip\'s rotation is kept, with a warning that it changes nothing yet', gripWarn === 1);

await setRotation('seat', [0, 20, 0]);
const turned = await page.evaluate(() => window.__wb.figures[0].inst.root.userData.vehicleRig.frame.children
  .find((c) => c.getObjectByName?.('hips')).rotation.y);
check('the seat\'s Y turns the rider on it', Math.abs(turned - 20 * Math.PI / 180) < 1e-3, { turned });

const download2 = page.waitForEvent('download');
await page.click('#anchorExport');
const json2 = JSON.parse(await readFile(await (await download2).path(), 'utf8'));
const sw = json2.vehicles.swoop;
check('the export carries the footrest, the turn and the rotations',
  Array.isArray(sw.foot) && sw.yaw === 20 && sw.footRotation?.[1] === 30 && sw.gripRotation?.[2] === 15 && !sw.seatRotation, sw);

// ---- the Nikto rides the same bike: the swoop's grip as edited this session
// reaches him, unless he has a grip of his own on it, which then holds ----
await page.click('#editToggle');
await h.workbench('nikto', 'creatureIdle');
// seated, and his hands put on the bars, once his sculpt and the bike's have landed
await page.waitForFunction(() => window.__wb?.figures?.[0]?.inst.modelReady?.(), undefined, { timeout: 120000 });
await page.waitForTimeout(400);
const niktoHand = await page.evaluate(([edited, committed]) => {
  const r = window.__wb.figures[0].inst.root.userData.niktoRider;
  r.bike.updateMatrixWorld(true);
  // a grip is where the palm goes: his palm frame's origin (he has no palm placed of his own)
  const hand = (r.rider.getObjectByName('palmFrameL') ?? r.rider.getObjectByName('handL')).getWorldPosition(r.bike.position.clone());
  // the swoop's frame to his bike's: the same sculpt hangs 0.385 m lower on his
  const at = (g) => r.bike.localToWorld(r.bike.position.clone().set(g[0], g[1] - 0.385, g[2]));
  const own = r.bike.localToWorld(r.bike.position.clone().set(...r.grip));
  return {
    edited: +hand.distanceTo(at(edited)).toFixed(3), committed: +hand.distanceTo(at(committed)).toFixed(3),
    own: +hand.distanceTo(own).toFixed(3), hasOwn: Math.abs(r.grip[1] - (edited[1] - 0.385)) > 1e-3,
  };
}, [[grip[0], grip[1], grip[2] + 0.1], grip]);
check(niktoHand.hasOwn ? 'the Nikto\'s hand holds his own grip on the bars'
  : 'the Nikto\'s hand follows the swoop\'s grip as edited this session',
niktoHand.hasOwn ? niktoHand.own < 0.01 : niktoHand.edited < 0.15 && niktoHand.edited < niktoHand.committed, niktoHand);

if (h.errors.length) check('no page errors', false, h.errors.slice(0, 3));
check.done('vehicle anchors');
await h.close();
