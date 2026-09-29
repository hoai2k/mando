/**
 * Guns of the Frigate: the guns' reach and what their fire does
 * (src/sections/frigate-guns.ts; turret floor in game/vehicles.ts; crossfire in
 * fx/projectiles.ts).
 *
 *   1. Every gun comes all the way round, and over each of the other guns its
 *      barrels stay high enough that the line of fire clears that gun and its
 *      gunner, so a gun cannot hit its own ship.
 *   2. A hit on a pirate craft bursts on it and flashes its hull red.
 *   3. Crossfire: a hunter who flies up into a manned gun's line of fire is
 *      blasted off the deck into space, and comes back up a hatch.
 *   4. ...unless they turn the bolt with a blade (a blocking saber).
 *
 *   node tools/test-section-frigate-fire.mjs      (HARNESS_PORT, CHROMIUM_PATH)
 */
import { launch, blankInput, makeCheck } from './harness.mjs';

const PORT = process.env.HARNESS_PORT ?? '4173';
const check = makeCheck();
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;
await page.goto(`http://localhost:${PORT}/?section=frigate-guns`);
await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
await h.startStepped('campaign', 2, 'station', ['din', 'maul']);
const BLANK = blankInput();

/** step `secs` at 1/30; `fn(g, s)` (source) runs first each frame and returns the two inputs */
const step = (secs, fn) => page.evaluate(async ([secs, BLANK, fn]) => {
  const g = window.__game;
  const f = new Function('g', 's', 'BLANK', fn);
  for (let i = 0; i < Math.round(secs * 30); i++) {
    const s = g.campaign.section;
    const ins = f(g, s, BLANK) ?? [BLANK, BLANK];
    g.update(1 / 30, [...ins, BLANK, BLANK]);
    if (i % 60 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}, [secs, BLANK, fn]);

await page.waitForFunction(() => window.__game.campaign.section?.probe, null, { timeout: 60000 });
for (let i = 0; i < 20; i++) {
  await step(0.5, 'return null;');
  if (await page.evaluate(() => window.__game.campaign.section.probe.guns().length === 4)) break;
}
await page.evaluate(() => window.__game.campaign.section.probe.hold(true));

// ---------------------------------------------------------------- 1. all the way round, over the others
const reach = await page.evaluate(() => {
  const s = window.__game.campaign.section, Y0 = s.floorY;
  const guns = s.probe.guns();
  const out = { arcs: guns.map((g) => g.def.turret.yawArc), clears: [] };
  guns.forEach((g, i) => guns.forEach((o, j) => {
    if (i === j) return;
    const dx = o.pos.x - g.pos.x, dz = o.pos.z - g.pos.z;
    const yaw = Math.atan2(dx, dz), d = Math.hypot(dx, dz);
    const pitch = s.probe.floor(i, yaw);
    // the lowest barrel's line, where it passes over the other gun's near edge
    const y = Y0 + 1.74 + Math.tan(pitch) * Math.max(0, d - 2.5 - 1.9);
    out.clears.push({ i, j, pitch: +pitch.toFixed(3), over: +(y - (Y0 + 3.4)).toFixed(2) });
  }));
  return out;
});
check('every gun comes all the way round', reach.arcs.every((a) => a >= Math.PI - 1e-6), reach.arcs);
check('over every other gun, the line of fire clears it and its gunner', reach.clears.every((c) => c.over > 0.2),
  reach.clears.filter((c) => c.over <= 0.2));

// ---------------------------------------------------------------- 2. a hit on a craft shows
const hit = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section;
  const e = s.probe.gunship('port');
  if (!e) return { e: false };
  const hp0 = e.hp;
  const from = e.position.clone().add({ x: -20, y: 0, z: 0 });
  e.damage(40, from, 0);
  return { e: true, hurt: hp0 - e.hp, flashing: s.probe.flashing() };
});
check('a gun\'s hit on a pirate craft lands', hit.e && hit.hurt > 0, hit);
check('and flashes its hull red', hit.flashing === true, hit);

// ---------------------------------------------------------------- 3. crossfire
// Player 1 mans the starboard gun (faces −x); player 2 hangs in its line of fire.
const setup = `
  const p = g.players[0], q = g.players[1];
  const gun = s.probe.guns()[0];
  window.__gun = gun;
  p.hp = p.maxHp;
  if (p.vehicle !== gun) { p.position.set(gun.pos.x + 2.2, s.floorY + 0.1, gun.pos.z); p.velocity.set(0, 0, 0); }
`;
await step(0.3, setup + 'return null;');
await step(1 / 30, setup + 'return [{ ...BLANK, slamPressed: true }, BLANK];');
await step(0.3, setup + 'return null;');
const manned = await page.evaluate(() => window.__game.players[0].vehicle === window.__gun);
check('a hunter mans the starboard gun', manned);

const hang = (block) => `
  const p = g.players[0], q = g.players[1], gun = window.__gun;
  // twelve metres out along the barrels, at the height of their line
  const yaw = gun.baseYaw, pitch = s.probe.floor(0, yaw) + 0.02;
  const d = 12, y = s.floorY + 1.9 + Math.tan(pitch) * (d - 2.5);
  // the knock is read before the hold below would cancel it
  if (Math.hypot(q.velocity.x, q.velocity.z) > 15) window.__blasted = true;
  if (!window.__q0) window.__q0 = { hp: q.hp };
  if (!window.__blasted) {
    q.position.set(gun.pos.x + Math.sin(yaw) * d, y - 1.1, gun.pos.z + Math.cos(yaw) * d);
    q.velocity.set(0, 0, 0);
    q.cam.face(yaw + Math.PI, 0);
    q.facingYaw = yaw + Math.PI;
  }
  p.cam.yaw = yaw; p.cam.pitch = pitch;
  return [{ ...BLANK, shootHeld: true }, ${block ? "{ ...BLANK, blockHeld: true }" : 'BLANK'}];
`;
// 4 first (the blade), then 3, so the blasted hunter's trip into space ends the test
await page.evaluate(() => { const q = window.__game.players[1]; q.hp = q.maxHp; window.__blasted = false; window.__q0 = null; });
await step(1.2, hang(true));
const saber = await page.evaluate(() => {
  const q = window.__game.players[1];
  return { blasted: !!window.__blasted, hp: q.hp, hp0: window.__q0?.hp ?? null, blocking: q.blocking };
});
check('a hunter blocking with a blade turns the gun\'s bolts', !saber.blasted && saber.hp >= (saber.hp0 ?? 100) - 1, saber);

await page.evaluate(() => { const q = window.__game.players[1]; q.hp = q.maxHp; window.__blasted = false; window.__q0 = null; });
await step(1.2, hang(false));
const struck = await page.evaluate(() => {
  const q = window.__game.players[1];
  return { blasted: !!window.__blasted, hp: q.hp, speed: Math.hypot(q.velocity.x, q.velocity.z) };
});
check('a hunter in the line of fire is blasted by the gun', struck.blasted && struck.hp < 100, struck);
await step(6, 'const p = g.players[0]; return [{ ...BLANK }, BLANK];');
const back = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, q = g.players[1];
  return { x: +q.position.x.toFixed(1), y: +(q.position.y - s.floorY).toFixed(1), z: +q.position.z.toFixed(1), alive: q.alive,
    onDeck: Math.abs(q.position.x) < 11 && Math.abs(q.position.y - s.floorY) < 2 };
});
check('...off into space, and back up a hatch', back.onDeck, back);

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
check.done('frigate fire');
