/**
 * Everything airborne (player.ts `updateSuperRise` / `updateAirMelee` /
 * `updateAirFlip`, enemy.ts `AIR_MOVES`):
 *
 *   - the held super jump stops climbing at its cap — SUPERJUMP_APEX for a
 *     super-jumper without sabers, the higher SUPERJUMP_APEX_SABER for a
 *     lightsaber wielder — instead of rising for as long as A is held;
 *   - a saber acrobat tucked in an air somersault keeps her blades lit, and a
 *     bolt fired at the ball (from in front or behind) is turned, not taken;
 *   - X in the air is an aerial strike that lands on a body under and ahead
 *     of the boots, without stopping the body dead in the air;
 *   - Y in the air is the plunge: the landing smashes everything in a radius
 *     that grows (with the damage) with the height it fell from;
 *   - the agile hostiles use them: a rival duelist leaps in with the aerial
 *     strike, Maul and the officer plunge, and both reach the player.
 *
 * Run:  node tools/test-airborne.mjs
 */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const { page } = h;
await h.waitForText(/WAVE BATTLE|PRESS START/i);

async function match(char) {
  await h.startMode('wave', 1, 'desert', [char]);
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.__manual = true;
    const g = window.__game;
    const blank = () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
      dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false, meleePressed: false,
      rocketPressed: false, zoomHeld: false, zoomDelta: 0, blockHeld: false, slamPressed: false,
      interactHeld: false, meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false });
    const T = { blank };
    T.step = (n = 1, inputs = []) => {
      for (let i = 0; i < n; i++) g.update(1 / 60, [0, 1, 2, 3].map((k) => inputs[k] ?? blank()));
    };
    let guard = 0;
    while (!g.enemies.length && guard++ < 1500) T.step();
    T.Enemy = g.enemies[0]?.constructor;
    // marked, not stepped: a blank frame would let go of a held button
    T.clear = (keep = []) => { for (const e of g.enemies) if (!keep.includes(e)) { e.alive = false; e.removeMe = true; } };
    T.clear();
    T.step(20);
    T.clear();
    for (const p of g.players) { p.hp = p.maxHp = 1e6; }
    T.ground = (x, z, y) => g.board.physics.groundHeight(x, z, y + 30);
    /** back on the ground, still, the camera and the body both facing +z */
    T.settle = () => {
      const p = g.players[0];
      p.position.set(0, T.ground(0, 0, 40), 0);
      p.velocity.set(0, 0, 0);
      p.cam.yaw = 0; p.facingYaw = 0;
      for (let i = 0; i < 120 && !p.grounded; i++) { T.clear(); T.step(); }
      T.step(10);
      p.cam.yaw = 0; p.facingYaw = 0;
    };
    /** a hostile of `kind` at (x, z) on the ground, tough enough to count hits on, asleep */
    T.spawn = (kind, x, z) => {
      const y = T.ground(x, z, 40);
      const e = g.addEnemy(new T.Enemy(kind, new g.players[0].position.constructor(x, y, z)));
      e.hp = e.maxHp = 1e5;
      return e;
    };
    window.T = T;
  });
}

// ---- the super jump's cap ----
const CLIMB = `() => {
  const g = window.__game, T = window.T, p = g.players[0];
  T.settle();
  const from = p.position.y;
  let top = from, frames = 0, rising = 0;
  // A held from the take-off, and held on long past any sensible climb
  T.step(1, [{ ...T.blank(), jumpPressed: true, jumpHeld: true }]);
  for (let i = 0; i < 60 * 8; i++) {
    T.clear();
    T.step(1, [{ ...T.blank(), jumpHeld: true }]);
    top = Math.max(top, p.position.y);
    if (p.velocity.y > 0) rising++;
    frames++;
    if (p.grounded && i > 10) break;
  }
  return { flight: p.profile.flight, apex: p.superJumpApex, rose: +(top - from).toFixed(2), risingSecs: +(rising / 60).toFixed(2), landed: p.grounded };
}`;

await match('bossk');
const plain = await page.evaluate(`(${CLIMB})()`);
console.log('  bossk:', JSON.stringify(plain));
check('a super-jumper without sabers flies the held super jump', plain.flight === 'superjump', plain);
check('...and holding A no longer rises for ever: the climb tops out at its cap',
  plain.rose > plain.apex - 0.6 && plain.rose < plain.apex + 0.4, plain);
check('...a high jump all the same: clear of the tallest climb it must make (the Chimney crack\'s 16.8 m ledge)',
  plain.rose > 16.8 + 1, plain);
check('...and comes back down while A is still held', plain.landed, plain);

await match('ventress');
const saber = await page.evaluate(`(${CLIMB})()`);
console.log('  ventress:', JSON.stringify(saber));
check('a lightsaber wielder\'s jump tops out at her own, higher cap',
  saber.rose > saber.apex - 0.6 && saber.rose < saber.apex + 0.4, saber);
check('...high enough to take the whole 24 m crack in one bound', saber.rose > 24 + 1, saber);
check('...notably higher than a super-jumper without sabers', saber.rose > plain.rose * 1.25, { saber: saber.rose, plain: plain.rose });

// ---- the tucked saber acrobat: blades out, bolts turned ----
const tuck = await page.evaluate(() => {
  const g = window.__game, T = window.T, p = g.players[0];
  T.settle();
  // stow the blades first, so the tuck is what lights them
  p.weapon = 'none'; p.char.setWeapon('none');
  p.position.y += 26;
  p.velocity.set(0, 0, 0);
  p.grounded = false;
  for (let i = 0; i < 12; i++) T.step();   // out of the coyote window
  const hp0 = p.hp;
  T.step(1, [{ ...T.blank(), jumpPressed: true, jumpHeld: true }]);
  for (let i = 0; i < 14; i++) T.step(1, [{ ...T.blank(), jumpHeld: true }]);
  const lit = [];
  p.litBlades(lit);
  const out = { flipping: p.flipping, tucked: p.tucked, drawn: p.sabersDrawn, lit: lit.length,
    upper: p.char.animator.playing('upper'), deflects: 0, shots: [] };
  let deflects = 0;
  const onDeflect = g.projectiles.onDeflect;
  g.projectiles.onDeflect = (...a) => { deflects++; onDeflect?.(...a); };
  const V = p.position.constructor;
  // one from dead ahead, one from behind, one from the flank, each aimed at the ball
  for (const [ax, az] of [[0, 1], [0, -1], [1, 0]]) {
    const target = new V(p.position.x, p.position.y + p.height * 0.5, p.position.z);
    const from = new V(p.position.x + ax * 9, target.y + 0.3, p.position.z + az * 9);
    const dir = target.clone().sub(from).normalize();
    const before = deflects;
    g.projectiles.fire(from, dir, 60, 20, 1, -1);
    for (let i = 0; i < 12; i++) T.step(1, [{ ...T.blank(), jumpHeld: true }]);
    out.shots.push({ from: [ax, az], turned: deflects > before, tucked: p.tucked });
  }
  g.projectiles.onDeflect = onDeflect;
  out.deflects = deflects;
  out.hurt = +(hp0 - p.hp).toFixed(1);
  for (let i = 0; i < 240 && !p.grounded; i++) T.step();
  return out;
});
console.log('  tuck:', JSON.stringify(tuck));
check('a second jump in the air rolls the saber acrobat into the tuck', tuck.flipping && tuck.tucked, tuck);
check('...with her blades lit and in hand', tuck.drawn && tuck.lit > 0, tuck);
check('...held in the blades-out tuck pose', tuck.upper === 'tuckSaberUpper', tuck);
check('every bolt fired at the tucked ball is deflected, front, back and flank',
  tuck.shots.every((s) => s.turned), tuck.shots);
check('...and none of them hurts her', tuck.hurt === 0, tuck);

// ---- the aerial strike ----
const AIRSWING = `({ ahead, below }) => {
  const g = window.__game, T = window.T, p = g.players[0];
  T.settle();
  const e = T.spawn('tusken', 0, ahead);
  e.attackCd = 99;
  T.step(1);
  e.position.set(0, T.ground(0, ahead, 40), ahead);
  e.velocity.set(0, 0, 0);
  // over it, in the air, facing it
  p.position.set(0, e.position.y + below, 0);
  p.velocity.set(0, 0, 0);
  p.grounded = false;
  p.cam.yaw = 0; p.facingYaw = 0;
  T.step(2, [{ ...T.blank() }]);
  const hp0 = e.hp, y0 = p.position.y;
  T.step(1, [{ ...T.blank(), meleePressed: true }]);
  const out = { upper: p.char.animator.playing('upper'), lower: p.char.animator.playing('lower'),
    popVy: +p.velocity.y.toFixed(2) };
  let top = p.position.y;
  for (let i = 0; i < 50; i++) {
    e.attackCd = 99; e.position.x = 0; e.position.z = ahead;
    T.step();
    top = Math.max(top, p.position.y);
    if (p.grounded) break;
  }
  out.hurt = +(hp0 - e.hp).toFixed(1);
  out.hung = +(top - y0).toFixed(2);
  out.fellAfter = p.position.y < top - 0.2 || p.grounded;
  T.clear();
  return out;
}`;
await match('jedi');
const fromAbove = await page.evaluate(`(${AIRSWING})({ ahead: 0.6, below: 2.6 })`);
console.log('  air strike, target under the boots:', JSON.stringify(fromAbove));
check('X in the air plays the aerial strike, arms and legs', fromAbove.upper === 'airSlashUpper' && fromAbove.lower === 'airSlashLower', fromAbove);
check('...it lands on a body below', fromAbove.hurt > 0, fromAbove);
check('...with a small hang, not a dead stop: the body pops and then falls on',
  fromAbove.popVy > 0 && fromAbove.popVy < 4 && fromAbove.hung < 0.6 && fromAbove.fellAfter, fromAbove);
const ahead = await page.evaluate(`(${AIRSWING})({ ahead: 1.6, below: 1.2 })`);
console.log('  air strike, target in front:', JSON.stringify(ahead));
check('...and on a body in front', ahead.hurt > 0, ahead);

// ---- the plunge ----
const PLUNGE = `({ height }) => {
  const g = window.__game, T = window.T, p = g.players[0];
  T.settle();
  const near = T.spawn('tusken', 2.5, 0), far = T.spawn('tusken', -6, 0);
  T.step(1);
  for (const [e, x] of [[near, 2.5], [far, -6]]) { e.position.set(x, T.ground(x, 0, 40), 0); e.velocity.set(0, 0, 0); e.attackCd = 99; }
  const n0 = near.hp, f0 = far.hp;
  p.position.y += height;
  p.velocity.set(0, 0, 0);
  p.grounded = false;
  T.step(2);
  T.step(1, [{ ...T.blank(), slamPressed: true }]);
  const pose = { upper: p.char.animator.playing('upper'), lower: p.char.animator.playing('lower'), vy: p.velocity.y };
  for (let i = 0; i < 240 && !p.grounded; i++) {
    for (const e of [near, far]) e.attackCd = 99;
    T.step();
  }
  T.step(2);
  const out = { ...pose, landed: p.grounded, plunge: p.lastPlunge, smash: p.char.animator.playing('upper'),
    nearHurt: +(n0 - near.hp).toFixed(1), farHurt: +(f0 - far.hp).toFixed(1) };
  T.clear();
  return out;
}`;
const low = await page.evaluate(`(${PLUNGE})({ height: 2.2 })`);
const high = await page.evaluate(`(${PLUNGE})({ height: 14 })`);
console.log('  plunge, low:', JSON.stringify(low));
console.log('  plunge, high:', JSON.stringify(high));
check('Y in the air drives down in the plunge pose', low.upper === 'plungeUpper' && low.vy < -20, low);
check('...and lands on the smash', low.landed && low.smash === 'plungeSmashUpper', low);
check('a low plunge hurts what is close', low.nearHurt > 0, low);
check('...but not what is six metres off', low.farHurt === 0, low);
check('a plunge from high up reaches further and hits harder',
  high.plunge && low.plunge && high.plunge.radius > low.plunge.radius + 2 && high.plunge.damage > low.plunge.damage * 2, { low: low.plunge, high: high.plunge });
check('...far enough to take the one six metres off as well', high.farHurt > 0, high);
check('...and the close one harder than the low plunge did', high.nearHurt > low.nearHurt, { low: low.nearHurt, high: high.nearHurt });

// ---- the agile hostiles use them ----
const AGILE = `async ({ kind, dist, secs }) => {
  const g = window.__game, T = window.T, p = g.players[0];
  T.settle();
  p.hp = 1e6;
  const e = T.spawn(kind, 0, dist);
  e.hp = 1e5;
  await new Promise((r) => setTimeout(r, 1500));
  e.position.set(0, T.ground(0, dist, 40), dist);
  e.velocity.set(0, 0, 0);
  // its clock for the move about to run out (it starts with a second or so on
  // it, which a fast closer can spend just walking in)
  if (e.airMove !== undefined) e.airCd = 0.3;
  const hp0 = p.hp;
  const out = { kind, moves: [], clips: [], hurt: 0, airborne: 0, firstAt: -1 };
  for (let i = 0; i < secs * 60; i++) {
    e.committed = true;
    // the player stands, facing it, doing nothing
    p.cam.yaw = 0; p.facingYaw = 0;
    p.position.x = 0; p.position.z = 0;
    T.step();
    if (e.airMove && !out.moves.includes(e.airMove)) { out.moves.push(e.airMove); if (out.firstAt < 0) out.firstAt = +(i / 60).toFixed(2); }
    if (e.airMove && !e.grounded) out.airborne++;
    const c = e.char.animator?.playing?.('upper');
    if (c && /airSlash|plunge/.test(c) && !out.clips.includes(c)) out.clips.push(c);
    if (hp0 - p.hp > 0 && out.hurtAt === undefined) out.hurtAt = +(i / 60).toFixed(2);
    // what the move itself did: from its crouch to a beat after it lands
    if (e.airMove && out.hpAtMove === undefined) out.hpAtMove = p.hp;
    if (out.hpAtMove !== undefined && !e.airMove && (out.after = (out.after ?? 0) + 1) > 20) break;
  }
  out.moveHurt = out.hpAtMove === undefined ? 0 : +(out.hpAtMove - p.hp).toFixed(1);
  delete out.hpAtMove;
  out.attacks = e.airAttacks;
  out.hurt = +(hp0 - p.hp).toFixed(1);
  e.alive = false; e.removeMe = true;
  return out;
}`;
for (const [kind, move] of [['rivalVentress', 'strike'], ['rivalGalen', 'strike'], ['rivalMaul', 'plunge'], ['officer', 'plunge']]) {
  // the officer splits its openers with the lunge: give it a few goes
  let r;
  for (let attempt = 0; attempt < 4; attempt++) {
    r = await page.evaluate(`(${AGILE})({ kind: '${kind}', dist: 9, secs: 6 })`);
    if (r.moves.length) break;
  }
  console.log(`  ${kind}:`, JSON.stringify(r));
  check(`a ${kind} takes to the air with its ${move}`, r.moves.includes(move) && r.airborne > 10, r);
  check(`...and the move itself reaches the player`, r.moveHurt > 0, r);
}

// a hostile that is not one of the agile few stays on the ground
{
  const r = await page.evaluate(`(${AGILE})({ kind: 'tusken', dist: 7.5, secs: 4 })`);
  check('a Tusken never leaps in from the air', r.attacks === 0 && !r.moves.length, r);
}

if (h.errors.length) check('no page errors', false, h.errors.slice(0, 3));
check.done('test-airborne');
await h.close();
