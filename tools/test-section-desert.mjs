/**
 * The Dune Sea's sections, mechanic by mechanic (docs/sections-notes/desert.md).
 *
 * Worm Sign: noise is heard on sand and not on rock, the hunger is the
 * party's sum against a threshold that scales with party size, the worm comes
 * for the loudest player on the sand, the ring is dodged by reaching rock, a
 * worm that is hungry with everyone on rock waits and takes the next one to
 * step off, a thumper is pulled, carried with the hands full, planted and
 * eaten and comes back to its post, the camps' own fire is heard, the worm
 * cannot be hurt here, and the fallen come back on the furthest checkpoint
 * island.
 *
 * Drives the simulation stepped at 1/30 s and puts bodies exactly where each
 * check needs them. SHOTS=<dir> also saves pictures of the ring and the strike.
 *
 * Run:  node tools/test-section-desert.mjs        (HARNESS_PORT, CHROMIUM_PATH)
 */
import { launch, blankInput, makeCheck } from './harness.mjs';

const check = makeCheck();
const PORT = process.env.HARNESS_PORT ?? '4173';
const SHOTS = process.env.SHOTS ?? '';
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;

async function boot(id, chars = ['din']) {
  await page.goto(`http://localhost:${PORT}/?section=${id}`);
  await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
  await h.startStepped('campaign', chars.length, 'desert', chars);
  await page.evaluate((b) => {
    window.__blank = b;
    // step `n` frames; `inputs(slot, f)` gives each slot's input, `each(g, f)` runs first
    window.__step = (n, inputs, each) => {
      const g = window.__game;
      for (let f = 0; f < n; f++) {
        if (each) each(g, f);
        g.update(1 / 30, [0, 1, 2, 3].map((s) => (inputs && inputs(s, f)) || window.__blank));
      }
    };
    window.__step(90, null);
  }, blankInput());
}

// ------------------------------------------------------------ Worm Sign, solo
await boot('worm-sign', ['din']);
if (SHOTS) {
  // the grounded barge behind the party, and the field ahead
  await page.evaluate(() => { const p = window.__game.players[0]; p.cam.yaw = Math.PI - 0.3; p.cam.pitch = -0.1; window.__stepFrame(1 / 30); });
  await h.shot(`${SHOTS}/ws-barge.png`);
  await page.evaluate(() => { const p = window.__game.players[0]; p.cam.yaw = 0; window.__stepFrame(1 / 30); });
  await h.shot(`${SHOTS}/ws-ahead.png`);
}
const solo = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
  const p = g.players[0];
  const out = {};
  out.threshold1 = t.threshold();
  // walking about on the entry island's rock: nothing heard
  t.field.reset();
  const rock = t.centreOf('E');
  window.__step(60, (slot, f) => slot === 0 ? { ...window.__blank, moveY: 1 } : null, (gg, f) => {
    if (f % 10 === 0) { p.position.set(rock.x, rock.y + 0.05, rock.z - 3); p.velocity.set(0, 0, 0); }
    p.cam.yaw = (f % 20) < 10 ? 0 : Math.PI;
  });
  out.rockNoise = t.field.level(0);
  // walking on the sand: heard
  t.field.reset();
  p.position.set(0, Y0 + 0.1, 20); p.velocity.set(0, 0, 0);
  p.cam.yaw = Math.PI / 2;
  window.__step(45, (slot) => slot === 0 ? { ...window.__blank, moveY: 1 } : null, () => { p.hp = p.maxHp; });
  out.sandWalk = t.field.level(0);
  out.sandAtEnd = t.onSand(p.position);
  // the worm cannot be hurt here
  const w = t.worm;
  const hp0 = w.hp;
  w.damage(99999, w.position, 0);
  out.wormUnhurt = w.alive && w.hp === hp0;
  return out;
});
check('worm sign: walking on rock makes no noise', solo.rockNoise < 0.01, solo);
check('worm sign: walking on sand does', solo.sandWalk > 0.08 && solo.sandAtEnd, solo);
check('worm sign: the worm cannot be hurt in the crossing', solo.wormUnhurt, solo);

// the strike: a solo player standing still on the sand is found, rung and hit
const strike = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
  const p = g.players[0];
  const out = { states: [] };
  t.ready();
  p.position.set(10, Y0 + 0.1, 24); p.velocity.set(0, 0, 0);
  t.field.meters[0] = 1;
  const hp0 = p.hp;
  let sawRing = false;
  for (let f = 0; f < 150; f++) {
    window.__step(1, null, () => { p.position.set(10, Y0 + 0.1, 24); p.velocity.set(0, 0, 0); });
    if (t.state === 'ring') sawRing = true;
    if (!out.states.includes(t.state)) out.states.push(t.state);
    if (t.strikes > 0) break;
  }
  out.sawRing = sawRing;
  out.strikes = t.strikes;
  out.hurt = hp0 - p.hp;
  out.hunger = t.hunger();
  return out;
});
check('worm sign: a loud player on the sand draws a ring and then the strike', strike.sawRing && strike.strikes === 1, strike);
check('worm sign: standing in the ring hurts', strike.hurt > 20, strike);
check('worm sign: the strike halves the hunger', strike.hunger <= 0.55, strike);
if (SHOTS) {
  // the ring, from a step back, then the eruption
  await page.evaluate(() => {
    const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
    const p = g.players[0];
    p.hp = p.maxHp;
    window.__step(120, null, () => { p.hp = p.maxHp; p.position.set(-6, Y0 + 0.1, 30); p.velocity.set(0, 0, 0); });
    t.ready();
    t.field.meters[0] = 1;
    for (let f = 0; f < 60 && t.state !== 'ring'; f++) window.__step(1, null, () => { p.hp = p.maxHp; p.position.set(-6, Y0 + 0.1, 30); });
    window.__step(24, null, () => { p.hp = p.maxHp; p.position.set(-6, Y0 + 0.1, 30); });
    p.cam.yaw = 0.6; p.cam.pitch = -0.2;
    window.__stepFrame(1 / 30);
  });
  await h.shot(`${SHOTS}/ws-ring.png`);
  await page.evaluate(() => {
    const g = window.__game, s = g.campaign.section, t = s.test;
    const p = g.players[0];
    for (let f = 0; f < 90 && t.state !== 'up'; f++) window.__step(1, null, () => { p.hp = p.maxHp; });
    window.__step(4, null, () => { p.hp = p.maxHp; });
    // look back at it from the rock
    const c = t.centreOf('E');
    p.position.set(c.x - 2, c.y, c.z + 6); p.velocity.set(0, 0, 0);
    const r = t.ringAt;
    p.cam.yaw = Math.atan2(r.x - p.position.x, r.z - p.position.z);
    window.__stepFrame(1 / 30);
  });
  await h.shot(`${SHOTS}/ws-erupt.png`);
}

// rock is safe: a player on an island's edge inside the ring is not hit
const rockSafe = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
  const p = g.players[0];
  for (let f = 0; f < 300 && t.state !== 'roam' && t.state !== 'stalk'; f++) window.__step(1, null, () => { p.hp = p.maxHp; });
  const isl = t.islands.find((i) => i.id === 'L1');
  const edge = { x: isl.x + isl.r - 0.8, z: isl.z };
  p.hp = p.maxHp;
  t.ready();
  // noise from the sand beside it, then step up onto the rock as the ring forms
  p.position.set(edge.x + 2.5, Y0 + 0.1, edge.z); p.velocity.set(0, 0, 0);
  t.field.meters[0] = 1;
  let rung = false;
  const s0 = t.strikes;
  for (let f = 0; f < 150 && t.strikes === s0; f++) {
    window.__step(1, null, () => {
      if (!rung && t.state === 'ring') rung = true;
      if (rung) p.position.set(edge.x, isl.top + 0.05, edge.z);
      else p.position.set(edge.x + 2.5, Y0 + 0.1, edge.z);
      p.velocity.set(0, 0, 0);
    });
  }
  const r = t.ringAt;
  return { rung, strikes: t.strikes - s0, hp: p.hp, max: p.maxHp, inRing: Math.hypot(p.position.x - r.x, p.position.z - r.z) < t.ringR, onSand: t.onSand(p.position) };
});
check('worm sign: rock inside the ring is still safe', rockSafe.rung && rockSafe.strikes === 1 && rockSafe.hp === rockSafe.max && !rockSafe.onSand, rockSafe);

// hungry, and everyone on rock: it circles and waits; the first one off gets the ring
const stalk = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
  const p = g.players[0];
  for (let f = 0; f < 300 && t.state !== 'roam'; f++) window.__step(1, null, () => { p.hp = p.maxHp; });
  const c = t.centreOf('E');
  t.ready();
  window.__step(20, null, () => { p.position.set(c.x, c.y + 0.05, c.z); p.velocity.set(0, 0, 0); t.field.meters[0] = 1; });
  const waiting = t.state;
  window.__step(10, null, () => { p.position.set(0, Y0 + 0.1, 16); p.velocity.set(0, 0, 0); t.field.meters[0] = 1; });
  return { waiting, after: t.state };
});
check('worm sign: hungry with nobody on the sand, it waits', stalk.waiting === 'stalk', stalk);
check('worm sign: and the first one off the rock gets the ring', stalk.after === 'ring', stalk);

// the thumper: pull, carry (hands full), plant on sand, it draws the worm, it is eaten, it comes back
const thump = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
  const p = g.players[0];
  const out = {};
  for (let f = 0; f < 400 && t.state !== 'roam' && t.state !== 'stalk'; f++) window.__step(1, null, () => { p.hp = p.maxHp; });
  t.field.reset();
  const th = t.thumpers[0];
  const post = th.post;
  window.__step(40, (slot) => slot === 0 ? { ...window.__blank, interactHeld: true } : null, () => {
    p.position.set(post.x + 0.5, post.y + 0.05, post.z); p.velocity.set(0, 0, 0);
  });
  out.carried = th.state === 'carried' && t.carrying[0] === th;
  // hands full: the trigger does nothing
  const cd0 = p.fireCd;
  let fired = false;
  window.__step(20, (slot) => slot === 0 ? { ...window.__blank, shootHeld: true } : null, () => { if (p.fireCd > cd0 + 0.02) fired = true; });
  out.noGun = !fired;
  // out onto the sand and plant it
  window.__step(40, (slot) => slot === 0 ? { ...window.__blank, interactHeld: true } : null, () => {
    p.position.set(-8, Y0 + 0.1, 22); p.velocity.set(0, 0, 0);
  });
  out.planted = th.state === 'planted';
  window.__thumpShot = () => { p.position.set(-8, Y0, 17); p.cam.yaw = 0.1; p.cam.pitch = -0.25; window.__stepFrame(1 / 30); };
  window.__step(60, null, () => { p.position.set(-8, Y0 + 0.1, 22); });
  out.drawn = t.state;
  // a loud player elsewhere on the sand is ignored while it pounds
  t.ready();
  let rungMe = false;
  window.__step(200, null, () => {
    p.hp = p.maxHp;
    p.position.set(20, Y0 + 0.1, 40); p.velocity.set(0, 0, 0); t.field.meters[0] = 1;
    if (t.state === 'ring' && t.prey && !t.prey.thumper) rungMe = true;
  });
  out.ignored = !rungMe;
  // it pounds out and is eaten
  for (let f = 0; f < 600 && th.state === 'planted'; f++) window.__step(1, null, () => { p.hp = p.maxHp; p.position.set(t.centreOf('E').x, t.centreOf('E').y, 2); });
  out.eaten = th.state;
  for (let f = 0; f < 400 && th.state !== 'post'; f++) window.__step(1, null, () => { p.hp = p.maxHp; });
  out.back = th.state;
  return out;
});
check('worm sign: a thumper is pulled from its post and carried', thump.carried, thump);
check('worm sign: hands full — no gun while carrying', thump.noGun, thump);
check('worm sign: it plants on the sand', thump.planted, thump);
check('worm sign: a planted thumper draws the worm', thump.drawn === 'drawn', thump);
check('worm sign: and the worm ignores a loud player while it listens', thump.ignored, thump);
check('worm sign: when it stops, the worm takes it, and it comes back to its post', thump.eaten !== 'planted' && thump.back === 'post', thump);

// the camps' fire is heard by whoever is on the sand near it
const campFire = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
  const p = g.players[0];
  t.field.reset();
  p.position.set(-30, Y0 + 0.1, 84); p.velocity.set(0, 0, 0);
  const from = p.position.clone(); from.x -= 10; from.y += 1.5;
  const dir = p.position.clone().sub(from).normalize();
  for (let k = 0; k < 5; k++) g.projectiles.fire(from, dir, 30, 1, 1, -1);
  return { level: t.field.level(0) };
});
check('worm sign: a camp firing on you out on the sand makes you louder', campFire.level > 0.2, campFire);

// checkpoints and the respawn
const respawn = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, t = s.test;
  const p = g.players[0];
  const c1 = t.centreOf('C1');
  window.__step(10, null, () => { p.position.set(c1.x, c1.y + 0.05, c1.z); p.velocity.set(0, 0, 0); p.hp = p.maxHp; });
  const reached = t.reached;
  const spot = s.respawnSpot(0);
  return { reached, spotToC1: Math.hypot(spot.x - c1.x, spot.z - c1.z) };
});
check('worm sign: standing on a checkpoint island earns it', respawn.reached === 1, respawn);
check('worm sign: and the fallen come back on it', respawn.spotToC1 < 4, respawn);

// ------------------------------------------------------------ party scaling and the loudest
await boot('worm-sign', ['din', 'maul']);
const duo = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
  const [a, b] = g.players;
  const out = { threshold2: t.threshold() };
  t.ready();
  t.field.reset();
  for (let f = 0; f < 90 && t.state !== 'ring'; f++) {
    window.__step(1, null, () => {
      a.position.set(-8, Y0 + 0.1, 24); b.position.set(8, Y0 + 0.1, 24);
      a.velocity.set(0, 0, 0); b.velocity.set(0, 0, 0);
      t.field.meters[0] = 0.3; t.field.meters[1] = 0.8;
    });
  }
  out.state = t.state;
  out.prey = t.prey ? t.prey.slot : -1;
  return out;
});
check('worm sign: the threshold scales with the party', solo.threshold1 < duo.threshold2, { solo: solo.threshold1, duo: duo.threshold2 });
check('worm sign: it goes for the loudest player on the sand', duo.state === 'ring' && duo.prey === 1, duo);

await h.close();
check.done('desert sections');
