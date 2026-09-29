/**
 * The Sleeper's own moves (src/enemies/sleeper.ts) — the Great Forge's
 * mythosaur, which a party used to be able to shove into a corner of its
 * basin and pin there.
 *
 *  - a shove moves it a fraction of what it moves anything else
 *  - it rears (the warning ring) before it roars
 *  - the roar throws whoever is inside the ring clear, and raises the shell
 *  - the shell turns a blow back on whoever struck, and sends bolts back
 *  - it sinks, and under the ground nothing reaches it
 *  - it comes up somewhere else
 *  - driven far from where it made its stand, it dives at the next chance
 *
 * Run:  node tools/test-sleeper.mjs   (HARNESS_PORT, CHROMIUM_PATH as usual)
 */
import { launch, blankInput } from './harness.mjs';

const failures = [];
const check = (n, ok, d) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}: ${JSON.stringify(d)}`); if (!ok) failures.push(n); };
const h = await launch();
const { page } = h;

await h.waitForText(/WAVE BATTLE|PRESS START/i);
await h.startCoop(1, 'desert');
await h.manual();
await page.evaluate((blank) => {
  window.__step = (n) => {
    const g = window.__game;
    for (let f = 0; f < n; f++) g.update(1 / 30, [0, 1, 2, 3].map(() => ({ ...blank })));
  };
}, blankInput());
const r1 = await page.evaluate(() => {
  const g = window.__game, p = g.players[0];
  for (const e of g.enemies) e.removeMe = true;
  window.__step(2);
  const V = p.position.constructor;
  const e = g.addReinforcement('mythosaur', p.position.clone().add(new V(0, 0, 10)));
  window.__e = e;
  e.alert(p.position, true);
  e.sleeper.roarCd = 99; e.sleeper.diveCd = 99;
  window.__step(40);
  // knockback: a third
  const a = e.position.clone();
  e.knockback(e.position.clone().add(new V(0, 0, -3)), 12, 0.4);
  window.__step(20);
  const shoved = e.position.distanceTo(a);
  // roar
  p.position.copy(e.position).add(new V(0, 0, -8));
  p.hp = p.maxHp;
  e.sleeper.roarCd = 0;
  window.__step(3);
  const rearing = e.sleeper.mode;
  const d0 = p.position.distanceTo(e.position);
  const p0 = p.position.clone();
  window.__step(60);
  const thrown = p.position.distanceTo(p0);
  const out = { shoved, rearing, roars: e.sleeper.roars, reflect: e.sleeper.reflectT, d0, d1: p.position.distanceTo(e.position), thrown };
  // reflect: a blow comes back, the boss takes nothing
  const hp0 = e.hp, php0 = p.hp;
  e.damage(100, p.position, 0);
  window.__step(1);
  out.bossTook = hp0 - e.hp; out.playerTook = php0 - p.hp;
  // a bolt comes back
  window.__step(40);   // past the hit window the returned blow opened
  p.position.copy(e.position).add(new V(0, 0, -14));
  e.sleeper.reflectT = 2;
  const php1 = p.hp;
  const from = p.position.clone().add(new V(0, 1.5, 0));
  const dir = e.position.clone().add(new V(0, 3, 0)).sub(from).normalize();
  g.projectiles.fire(from.clone().addScaledVector(dir, 1.5), dir, 75, 34, 0, 0);
  window.__step(12);
  out.hpAfterBolt = hp0 - e.hp; out.playerHitByOwnBolt = php1 - p.hp;
  return out;
});
check('a shove moves the Sleeper a fraction', r1.shoved < 2.5, r1);
check('it rears before roaring', r1.rearing === 'rearing', r1);
check('the roar throws the player clear and raises the shell', r1.roars === 1 && r1.reflect > 0 && r1.thrown > 4, r1);
check('the shell turns a blow back', r1.bossTook === 0 && r1.playerTook > 30, r1);
check('the shell sends a bolt back', r1.hpAfterBolt === 0 && r1.playerHitByOwnBolt > 0, r1);

const r2 = await page.evaluate(() => {
  const g = window.__game, p = g.players[0], e = window.__e;
  const V = p.position.constructor;
  p.maxHp = p.hp = 1e6;
  window.__step(120);   // shell off
  if (!p.alive) return { dead: true };
  e.sleeper.roarCd = 99;
  const start = e.position.clone();
  e.sleeper.diveCd = 0;
  window.__step(2);
  const mode1 = e.sleeper.mode;
  window.__step(40);
  const under = { mode: e.sleeper.mode, submerged: e.submerged, targetable: e.targetable };
  const hp0 = e.hp;
  e.damage(200, p.position, 0);
  const tookUnder = hp0 - e.hp;
  for (let i = 0; i < 150 && e.sleeper.mode !== 'free'; i++) window.__step(1);
  const out = { mode1, under, tookUnder, after: e.sleeper.mode, dives: e.sleeper.dives, moved: e.position.distanceTo(start), depth: e.sleeper.depth };
  // driven into a corner: dives at the next chance
  for (let i = 0; i < 100 && e.sleeper.mode !== 'free'; i++) window.__step(1);
  e.sleeper.diveCd = 8;
  e.position.copy(e.sleeper.home).add(new V(20, 0, 0));
  window.__step(3);
  out.corner = e.sleeper.mode;
  return out;
});
check('it sinks, and under the ground nothing reaches it', r2.mode1 === 'sinking' && r2.under.submerged && !r2.under.targetable && r2.tookUnder === 0, r2);
check('it comes up somewhere else', r2.after === 'free' && r2.dives === 1 && r2.moved > 3 && r2.depth === 0, r2);
check('driven far from its stand, it dives', r2.corner === 'sinking', r2);

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
