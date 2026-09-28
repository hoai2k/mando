/**
 * Melee duels: blades meet, and swings land where the weapon does.
 *
 *   - A strike into someone mid-strike, facing it, is a parry: neither lands,
 *     both fighters are thrown apart, and the later striker plays its parry
 *     clip when its weapon has one.
 *   - Energy blades (the darksaber too) and beskar cut through steel: the
 *     conventional guard fails and the cutting strike lands; a steel strike
 *     swung into a cutting blade is sheared off.
 *   - Contact is the weapon's geometry: a body a metre past the tip is not
 *     hit, by a player or by a hostile, and one inside it is.
 *
 * Run:  node tools/test-parry.mjs
 */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const { page } = h;
await h.waitForText(/WAVE BATTLE|PRESS START/i);

async function match(chars, mode = 'wave') {
  await h.startMode(mode, chars.length, 'desert', chars);
  // let the sculpts and their weapon props settle in
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.__manual = true;
    const g = window.__game;
    const blank = () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
      dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false, meleePressed: false,
      rocketPressed: false, zoomHeld: false, zoomDelta: 0, blockHeld: false, slamPressed: false,
      meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false });
    const T = {};
    T.blank = blank;
    T.step = (n = 1, inputs = []) => {
      for (let i = 0; i < n; i++) g.update(1 / 60, [0, 1, 2, 3].map((k) => inputs[k] ?? blank()));
    };
    let guard = 0;
    while (!g.enemies.length && guard++ < 1500) T.step();
    T.Enemy = g.enemies[0]?.constructor;
    T.clear = () => {
      for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
      T.step(20);
      for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
    };
    T.clear();
    // record the duel events instead of guessing at them from a sound
    T.log = [];
    const clash = g.meleeClash.bind(g), shear = g.meleeShear.bind(g), cut = g.bladeCut.bind(g);
    g.meleeClash = (a, at0, b, sound, at) => { T.log.push(`clash:${sound}`); clash(a, at0, b, sound, at); };
    g.meleeShear = (s, c, at) => { T.log.push('shear'); shear(s, c, at); };
    g.bladeCut = (at) => { T.log.push('cut'); cut(at); };
    for (const p of g.players) { p.hp = p.maxHp = 1e6; }
    window.T = T;
  });
}

/**
 * Put a hostile of `kind` `dist` metres in front of player 0, facing it; wind
 * it up at the player when `windup` is set, then have the player swing (with
 * the lunge suppressed so the distance is the one under test).
 */
const DUEL = `async ({ kind, dist, windup, force = false, playerSwing = true, lunge = false, heavy = false, frames = 60 }) => {
  const g = window.__game, T = window.T, p = g.players[0];
  // face where the camera looks, so the lunge's cone agrees with the body's
  p.facingYaw = p.cam.yaw;
  T.clear();
  T.log.length = 0;
  p.hp = 1e6;
  p.velocity.set(0, 0, 0);
  const pos = p.position.clone();
  pos.x += Math.sin(p.yaw) * dist; pos.z += Math.cos(p.yaw) * dist;
  const e = g.addEnemy(new T.Enemy(kind, pos));
  e.hp = 1e5;
  await new Promise((r) => setTimeout(r, 1800));
  e.position.copy(pos); e.velocity.set(0, 0, 0);
  e.facingYaw = Math.atan2(p.position.x - e.position.x, p.position.z - e.position.z);
  const hp0 = e.hp, php0 = p.hp;
  const out = { parryClip: null, eWound: false };
  if (force) {
    // wound up from right here, whatever the distance, and held in place
    e.windup = e.windupTotal = 0.55;
    e.windupTarget = p;
    e.windupStartedAt = g.time;
    e.char.animator?.playOnce('upper', 'enemySwing', 0.06);
    out.eWound = true;
  } else if (windup) {
    let n = 0;
    while (!(e.windup > 0) && n++ < 300) {
      e.committed = true; e.attackCd = 0;
      e.position.copy(pos); e.velocity.set(0, 0, 0);
      T.step();
    }
    out.eWound = e.windup > 0;
  }
  const stand = p.position.clone();
  if (playerSwing) {
    // no lunge: the swing is judged from where the player stands
    if (!lunge) p.nearestEnemy = () => null;
    T.step(1, [{ ...T.blank(), meleePressed: !heavy, rocketPressed: heavy }]);
  }
  for (let i = 0; i < frames; i++) {
    e.committed = true;
    if (force) { e.position.copy(pos); e.velocity.set(0, 0, 0); e.attackCd = 5; }
    T.step();
    const clip = p.char.animator?.playing?.('upper');
    if (clip && /parry|FlipOut/i.test(clip)) out.parryClip = clip;
  }
  delete p.nearestEnemy;
  out.enemyHurt = +(hp0 - e.hp).toFixed(1);
  out.playerHurt = +(php0 - p.hp).toFixed(1);
  out.log = [...T.log];
  out.gap = +Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z).toFixed(2);
  out.playerMoved = +Math.hypot(p.position.x - stand.x, p.position.z - stand.z).toFixed(2);
  e.alive = false; e.removeMe = true;
  return out;
}`;
const duel = (o) => page.evaluate(`(${DUEL})(${JSON.stringify(o)})`);

// ---- steel on steel: Paz's gaffi into a Tusken's swing ----
await match(['paz']);
{
  const r = await duel({ kind: 'tusken', dist: 1.5, windup: true });
  check('steel meets steel: a parry', r.log.includes('clash:steel'), r);
  check('  neither blow lands', r.enemyHurt === 0 && r.playerHurt === 0, r);
  check('  both thrown apart', r.gap > 1.9, r);
}
{
  // no wind-up: nothing to meet the blade, so it lands
  const r = await duel({ kind: 'tusken', dist: 1.5, windup: false });
  check('an idle hostile inside the gaffi is hit', r.enemyHurt > 0 && !r.log.length, r);
}
{
  // three metres: the old rule hit this; the gaffi stops ~1.8 m short of it
  const r = await duel({ kind: 'tusken', dist: 3.0, windup: false });
  check('a hostile a metre past the tip is not hit', r.enemyHurt === 0, r);
}
{
  // ...but the lunge still carries a swing from there onto them
  const r = await duel({ kind: 'tusken', dist: 3.0, windup: false, lunge: true });
  check('the lunge carries a swing from 3 m into contact', r.enemyHurt > 0, r);
}
{
  // a Tusken's gaffi reaches ~1.4 m: from 2.8 m its swing used to land
  const r = await duel({ kind: 'tusken', dist: 2.8, force: true, playerSwing: false });
  check('a Tusken swinging from 2.8 m does not reach', r.playerHurt === 0, r);
  const r2 = await duel({ kind: 'tusken', dist: 1.4, force: true, playerSwing: false });
  check('a Tusken swinging from 1.4 m does', r2.playerHurt > 0, r2);
}
// every armed hostile walks in to where its weapon reaches, and lands
for (const kind of ['tusken', 'pirateMelee', 'alamite', 'officer', 'enforcer',
  'rivalMaul', 'rivalRevan', 'rivalVentress', 'rivalGalen', 'rivalMaris']) {
  // (the enforcer opens with its ground-slam telegraph, which spends a cooldown first)
  const r = await duel({ kind, dist: 4, windup: false, playerSwing: false, frames: 270 });
  check(`a ${kind} closes and its swing lands`, r.playerHurt > 0, r);
}
{
  // steel swung into an energy blade coming the other way is sheared off
  const r = await duel({ kind: 'rivalVentress', dist: 1.2, windup: true });
  check('steel into a saber\'s swing is sheared', r.log.includes('shear') && r.enemyHurt === 0, r);
}

// ---- beskar and energy cut through steel ----
await match(['din']);
{
  const r = await duel({ kind: 'tusken', dist: 1.6, windup: true });
  check('the beskar spear cuts through a gaffi\'s parry', r.log.includes('cut') && r.enemyHurt > 0, r);
}
{
  const r = await duel({ kind: 'rivalMaul', dist: 1.6, windup: true });
  check('beskar meets a saber: a parry with the saber clash', r.log.includes('clash:saber') && r.enemyHurt === 0, r);
}

// ---- saber on saber, and the parry clip ----
await match(['ventress']);
{
  const r = await duel({ kind: 'rivalMaul', dist: 1.3, windup: true });
  check('saber meets saber: a parry', r.log.includes('clash:saber') && r.enemyHurt === 0 && r.playerHurt === 0, r);
  check('  the later striker (the player) plays the parry clip', r.parryClip === 'saberParryUpper', r);
}
{
  const r = await duel({ kind: 'tusken', dist: 1.3, windup: true });
  check('a saber cuts through a gaffi\'s parry', r.log.includes('cut') && r.enemyHurt > 0, r);
}

{
  // the blades-only heavy lunge (Y) leaps in and lands on what its blades meet
  const r = await duel({ kind: 'tusken', dist: 6, windup: false, lunge: true, heavy: true, frames: 90 });
  check('the heavy lunge lands', r.enemyHurt > 0, r);
}

// ---- the darksaber is a lightsaber ----
await match(['din']);
{
  await page.evaluate(() => { window.T.step(1, [{ ...window.T.blank(), meleeSwapPressed: true }]); window.T.step(10); });
  const kind = await page.evaluate(() => window.__game.players[0].meleeKind);
  const r = await duel({ kind: 'tusken', dist: 1.3, windup: true });
  check('the darksaber cuts through a gaffi\'s parry', kind === 'sabers' && r.log.includes('cut') && r.enemyHurt > 0, { kind, ...r });
  const r2 = await duel({ kind: 'rivalRevan', dist: 1.4, windup: true });
  check('the darksaber meets a saber: a parry', r2.log.includes('clash:saber'), r2);
}

// ---- the clash sounds decode ----
{
  const ok = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const out = {};
    for (const n of ['saber_clash_1', 'saber_clash_2', 'saber_clash_3', 'weapon_clash', 'blade_shear']) {
      const buf = await (await fetch(`assets/audio/${n}.mp3`)).arrayBuffer();
      const a = await ctx.decodeAudioData(buf);
      const d = a.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      out[n] = { secs: +a.duration.toFixed(2), peak: +peak.toFixed(2) };
    }
    return out;
  });
  check('clash samples decode and are audible', Object.values(ok).every((v) => v.secs > 0.3 && v.peak > 0.1), ok);
}

if (h.errors.length) check('no page errors', false, h.errors.slice(0, 3));
check.done('test-parry');
await h.close();
