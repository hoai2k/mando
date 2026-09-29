/**
 * Guns of the Frigate (docs/LEVEL_SECTIONS.md §2.4) — its mechanics, one beat
 * at a time, in the real build. `tools/test-sections.mjs` proves the section
 * can be finished; this proves the pieces it is made of do what the design
 * says they do:
 *
 *  1. The **guns**: four quad guns in a diamond, 200° arcs, owned by the
 *     party, and an unmanned one shoots drones down on its own.
 *  2. They **cannot depress onto the deck**: a gunner aiming at a boarder on
 *     the deck gets the barrels no lower than level, and the boarder lives.
 *  3. A **boarding tube**: it latches, drains the hull while it is on, pours
 *     boarders; bolts barely mark its latch, a blade cuts it, and a rocket's
 *     worth of blast cuts another.
 *  4. The **hull bar** is the fail state: emptied, the wave comes round again
 *     with the hull it began with.
 *  5. The **corvette**: its bridge shrugs off everything while a shield dome
 *     stands; unmanned guns only chip armour; the spinal gun's line hurts
 *     whoever is on it and nobody who is not.
 *  6. The **void**: over the side comes back up through the nearest hatch.
 *
 *   node tools/test-section-frigate.mjs      (HARNESS_PORT as the other suites)
 */
import { launch, blankInput, makeCheck } from './harness.mjs';

const PORT = process.env.HARNESS_PORT ?? '4173';
const check = makeCheck();
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;
await page.goto(`http://localhost:${PORT}/?section=frigate-guns`);
await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
await h.startStepped('campaign', 1, 'station', ['din']);

/** step the match `secs` at 1/30 with player 0 pressing `over`; `fn` runs each frame first */
const step = (secs, over = {}, fn = null) => page.evaluate(async ([secs, over, BLANK, fn]) => {
  const g = window.__game;
  const f = fn ? new Function('g', 's', fn) : null;
  for (let i = 0; i < Math.round(secs * 30); i++) {
    const s = g.campaign.section;
    if (f) f(g, s);
    g.update(1 / 30, [{ ...BLANK, ...over }, BLANK, BLANK, BLANK]);
    if (i % 60 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}, [secs, over, blankInput(), fn]);

// the first frames stand the guns up (after the stage settles); then hold the section's own script still
await page.waitForFunction(() => window.__game.campaign.section?.probe, null, { timeout: 60000 });
for (let i = 0; i < 20; i++) {
  await step(0.5);
  if (await page.evaluate(() => window.__game.campaign.section.probe.guns().length === 4)) break;
}
await page.evaluate(() => window.__game.campaign.section.probe.hold(true));
const Y0 = await page.evaluate(() => window.__game.campaign.section.floorY);

// ---------------------------------------------------------------- 1. the guns
const guns = await page.evaluate(() => {
  const s = window.__game.campaign.section;
  return s.probe.guns().map((v) => ({
    kind: v.spec.kind, x: v.pos.x, z: v.pos.z, arc: v.def.turret.yawArc, auto: v.def.turret.auto,
    pmin: v.def.turret.pitchMin, team: v.team, yaw: v.baseYaw,
  }));
});
check('four quad guns stand on the hull', guns.length === 4 && guns.every((g) => g.kind === 'turret'), guns);
check('each with a 200° arc', guns.every((g) => Math.abs(g.arc * 2 - (200 * Math.PI) / 180) < 0.01));
check('the party\'s guns, firing at half rate when nobody is in them', guns.every((g) => g.team === 0 && g.auto === 0.5));
check('in a diamond: bow, stern, port, starboard',
  guns.some((g) => g.z > 15) && guns.some((g) => g.z < -15) && guns.some((g) => g.x > 5) && guns.some((g) => g.x < -5));

// the player well away from every gun; a swarm from ahead; nobody touches a trigger
await page.evaluate(() => {
  const g = window.__game, p = g.players[0];
  p.position.set(0, g.campaign.section.floorY + 0.1, -12 + 2.6);
  g.campaign.section.probe.swarm('ahead', 4);
});
await step(14, {}, 'g.players[0].hp = g.players[0].maxHp;');
const swarm = await page.evaluate(() => {
  const s = window.__game.campaign.section;
  const d = s.probe.drones();
  return { alive: d.filter((e) => e.alive).length, n: d.length, hull: s.probe.hull(), kills: window.__game.totalKills };
});
check('unmanned guns shoot drones down on their own', swarm.kills >= 2, swarm);

// ---------------------------------------------------------------- 2. no depression onto the deck
const depress = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, p = g.players[0];
  const gun = s.probe.guns()[0];               // starboard, facing −x
  p.position.set(gun.pos.x + 2.2, s.floorY + 0.1, gun.pos.z);
  p.velocity.set(0, 0, 0);
  // a boarder on the deck in front of the gun, inside its arc
  const Enemy = g.enemies[0]?.constructor;
  return { gunX: gun.pos.x, gunZ: gun.pos.z, have: !!Enemy };
});
await step(0.2);
await step(1 / 30, { slamPressed: true });
await step(0.2);
const mounted = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, p = g.players[0];
  return p.vehicle === s.probe.guns()[0];
});
check('Y mans a gun', mounted);
// a pirate on the deck, eight metres off the gun's muzzle, low in its sight
await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section;
  const gun = s.probe.guns()[0];
  // eight or nine metres off the barrels, in the gun's arc, on the deck
  window.__deckPirate = s.probe.spawn('pirate', gun.pos.x - 3, gun.pos.z + 9);
});
await step(3, { shootHeld: true }, `
  const p = g.players[0], e = window.__deckPirate;
  if (!e) return;
  const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z;
  p.cam.yaw = Math.atan2(dx, dz);
  p.cam.pitch = -0.45;
  e.scripted = { drive: () => 'still' };   // it stands where it was put
`);
const noDepress = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section;
  const gun = s.probe.guns()[0], e = window.__deckPirate;
  return { pitch: gun.aimPitch, min: gun.def.turret.pitchMin, heat: gun.heat, alive: e ? e.alive : null, hp: e ? e.hp : null };
});
check('a gunner cannot bring the barrels down onto the deck', noDepress.pitch >= noDepress.min - 1e-3, noDepress);
check('and the boarder standing there is not hit', noDepress.alive === true && noDepress.hp >= 30, noDepress);
await step(1 / 30, { slamPressed: true });
await step(0.3);
await page.evaluate(() => { const e = window.__deckPirate; if (e) { e.alive = false; e.counted = true; e.removeMe = true; } });

// ---------------------------------------------------------------- 3. a boarding tube
await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, p = g.players[0];
  p.position.set(-2, s.floorY + 0.1, -2);
  s.probe.setHull(1000);
  s.probe.latchAt(0);
});
await step(2.5, {}, 'g.players[0].hp = g.players[0].maxHp;');
const tube = await page.evaluate(() => {
  const s = window.__game.campaign.section;
  const l = s.probe.latch(0);
  return { tube: s.probe.tube(0), latch: !!l && l.alive, hull: s.probe.hull(), latchHp: l ? l.hp : 0, latchMax: l ? l.maxHp : 0 };
});
check('a boarding tube latches at B1', tube.latch && tube.tube && tube.tube.state === 'latched', tube);
check('and pours boarders onto the deck', tube.tube && tube.tube.bodies >= 2, tube);
const drain0 = tube.hull;
await step(2, {}, 'g.players[0].hp = g.players[0].maxHp; for (const e of g.enemies) if (e.alive && e.squad === 8842) e.damage(9999, e.position, -1);');
const drain1 = await page.evaluate(() => window.__game.campaign.section.probe.hull());
check('a latched tube drains the hull', drain1 < drain0 - 10, { from: drain0, to: drain1 });
const bolts = await page.evaluate(() => {
  const s = window.__game.campaign.section, l = s.probe.latch(0);
  const before = l.hp;
  for (let i = 0; i < 10; i++) l.damage(22, l.position.clone(), 0);
  return { before, after: l.hp, max: l.maxHp };
});
check('bolts barely mark the latch (ten hits, under a tenth of it)', bolts.before - bolts.after < bolts.max * 0.1, bolts);

// a blade: stand at the latch, facing it, and swing until it gives
await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, p = g.players[0], l = s.probe.latch(0);
  p.position.set(l.position.x - 1.9, s.floorY + 0.1, l.position.z);
  p.velocity.set(0, 0, 0);
});
let cut = false;
for (let i = 0; i < 20 && !cut; i++) {
  await step(0.5, { meleePressed: true }, `
    const p = g.players[0], l = s.probe.latch(0);
    p.hp = p.maxHp;
    for (const e of g.enemies) if (e.alive && e.squad === 8842) e.damage(9999, e.position, -1);
    if (l) { p.cam.yaw = Math.atan2(l.position.x - p.position.x, l.position.z - p.position.z); p.cam.pitch = -0.1; }
  `);
  cut = await page.evaluate(() => !window.__game.campaign.section.probe.latch(0));
}
const afterCut = await page.evaluate(() => window.__game.campaign.section.probe.tube(0));
check('a blade cuts the latch', cut, afterCut);
check('and the tube tears away, its ship leaving', !afterCut || afterCut.cut, afterCut);

// a rocket's worth of blast cuts another
await page.evaluate(() => window.__game.campaign.section.probe.latchAt(1));
await step(2, {}, 'g.players[0].hp = g.players[0].maxHp;');
const rocket = await page.evaluate(() => {
  const s = window.__game.campaign.section, l = s.probe.latch(1);
  if (!l) return { ok: false };
  const max = l.maxHp;
  l.damage(90, l.position.clone(), 0);
  const mid = l.hp;
  l.damage(90, l.position.clone(), 0);
  l.damage(90, l.position.clone(), 0);
  l.damage(90, l.position.clone(), 0);
  return { ok: true, max, mid, alive: l.alive };
});
check('a rocket\'s blast lands in full on a latch', rocket.ok && rocket.max - rocket.mid >= 89, rocket);
await step(0.5);
check('and enough of them cut it', await page.evaluate(() => !window.__game.campaign.section.probe.latch(1)));
await page.evaluate(() => { for (const e of window.__game.enemies) if (e.alive && e.team === 1) e.damage(9999999, e.position, 0); });
await step(3);

// ---------------------------------------------------------------- 4. the hull bar
await page.evaluate(() => {
  const s = window.__game.campaign.section;
  s.probe.hold(false);
  s.probe.setHull(700);
  s.probe.wave(1);
});
await step(1);
const cp = await page.evaluate(() => window.__game.campaign.section.probe.checkpoint());
check('a wave begins by taking the hull as its checkpoint', Math.abs(cp - 700) < 1, cp);
await page.evaluate(() => window.__game.campaign.section.probe.setHull(0));
await step(0.5);
const breached = await page.evaluate(() => window.__game.campaign.section.probe.phase());
check('an empty hull calls the breach', breached.phase === 'breather' && breached.restartAt === 'wave', breached);
await step(6);
const again = await page.evaluate(() => ({ ...window.__game.campaign.section.probe.phase(), hull: window.__game.campaign.section.probe.hull() }));
check('and the same wave comes round again, with the hull it began with',
  again.phase === 'wave' && again.wave === 1 && Math.abs(again.hull - 700) < 30, again);

// ---------------------------------------------------------------- 5. the corvette
await page.evaluate(() => {
  const s = window.__game.campaign.section;
  s.probe.corvette();
  s.probe.hold(true);
});
await step(0.5);
const shielded = await page.evaluate(() => {
  const s = window.__game.campaign.section, b = s.probe.bridge();
  const before = b.hp;
  b.damage(300, b.position.clone(), 0);
  return { before, after: b.hp, gens: s.probe.gens().filter((e) => e && e.alive).length };
});
check('the corvette\'s bridge takes nothing while a shield dome stands', shielded.after === shielded.before && shielded.gens === 3, shielded);
const domes = await page.evaluate(() => {
  const s = window.__game.campaign.section, g0 = s.probe.gens()[0];
  const before = g0.hp;
  g0.damage(20, g0.position.clone(), -1);          // an unmanned gun's bolt
  const auto = before - g0.hp;
  g0.damage(20, g0.position.clone(), 0);           // a gunner's
  const manned = before - auto - g0.hp;
  for (const e of s.probe.gens()) if (e) e.damage(99999, e.position.clone(), 0);
  return { auto, manned };
});
check('unmanned fire only chips a dome\'s armour; a gunner\'s lands', domes.auto < domes.manned * 0.3 && domes.manned >= 19.9, domes);
await step(0.5);
const open = await page.evaluate(() => {
  const s = window.__game.campaign.section, b = s.probe.bridge();
  const before = b.hp;
  b.damage(100, b.position.clone(), 0);
  return { before, after: b.hp };
});
check('with the domes gone, the bridge is open', open.before - open.after >= 99, open);

// the spinal gun: its line on the player, then a line well away from them
const spinal = async (laneZ, standZ) => {
  await page.evaluate(([laneZ, standZ]) => {
    const g = window.__game, s = g.campaign.section, p = g.players[0];
    if (p.vehicle) p.vehicle.dropRider(p);
    p.alive = true;
    p.hp = p.maxHp;
    p.position.set(2, s.floorY + 0.1, standZ);
    p.velocity.set(0, 0, 0);
    s.probe.spinal(laneZ);
  }, [laneZ, standZ]);
  await step(3.4, {}, `const p = g.players[0]; if (p.alive) { p.position.x = 2; p.position.z = ${standZ}; p.velocity.x = 0; p.velocity.z = 0; }`);
  return page.evaluate(() => { const p = window.__game.players[0]; return { hp: p.hp, alive: p.alive }; });
};
const hit = await spinal(4, 4);
check('the spinal gun hurts whoever is on its line', !hit.alive || hit.hp <= 100 - 50, hit);
await step(4);
const miss = await spinal(-20, 4);
check('and nobody who got off it', miss.alive && miss.hp >= 99, miss);

// ---------------------------------------------------------------- 6. the void
await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, p = g.players[0];
  p.alive = true;
  p.hp = p.maxHp;
  p.position.set(24, s.floorY - 20, 12);
  p.velocity.set(0, -5, 0);
});
await step(0.3);
const back = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, p = g.players[0];
  return { x: p.position.x, y: p.position.y - s.floorY, z: p.position.z, on: s.contains(p.position.x, p.position.z) };
});
check('over the side comes back up through the nearest hatch (the forward one)',
  back.on && Math.abs(back.y) < 0.6 && Math.hypot(back.x - 0, back.z - 8) < 6, back);
await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, p = g.players[0];
  p.position.set(-26, s.floorY - 20, -20);
  p.velocity.set(0, -5, 0);
});
await step(0.3);
const back2 = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, p = g.players[0];
  return { x: p.position.x, y: p.position.y - s.floorY, z: p.position.z };
});
check('and from astern, up through the aft one', Math.abs(back2.y) < 0.6 && Math.hypot(back2.x, back2.z + 12) < 6, back2);

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
void Y0;
void depress;
await h.close();
check.done('frigate');
