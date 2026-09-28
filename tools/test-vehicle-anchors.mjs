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

if (h.errors.length) check('no page errors', false, h.errors.slice(0, 3));
check.done('vehicle anchors');
await h.close();
