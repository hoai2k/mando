/**
 * Melee reach audit: how far does each weapon actually reach?
 *
 * Every fighter is put in a real match and swings through its combo (and, for
 * the hostiles, its wind-up) with nobody near. Each frame the weapon's meshes
 * are measured in world space: how far in front of the body's centre the
 * furthest point of the blade, spear head or club is — at the clip's nominal
 * contact key, and over the whole swing.
 *
 * Contact itself is geometric now (src/game/melee.ts): a swing lands where
 * these meshes meet a body. What this audit still guards is the distance a
 * hostile *commits* to a swing from (`attackRange`, centre to centre): past
 * its weapon's reach plus a body's radius, the swing can only whiff. Those
 * are flagged.
 *
 * Run:  node tools/audit-melee-reach.mjs [id ...] [enemy:kind ...]
 */
import { launch } from './harness.mjs';

const PLAYERS = process.argv.slice(2).filter((a) => !a.startsWith('enemy:'));
const ENEMIES = process.argv.slice(2).filter((a) => a.startsWith('enemy:')).map((a) => a.slice(6));
const ALL_PLAYERS = ['din', 'din:sabers', 'paz', 'armorer', 'boba_fett', 'ventress', 'jedi', 'maris', 'maul', 'revan',
  'embo', 'bossk', 'duelist', 'ig11', 'npc:tusken', 'npc:pirateMelee', 'npc:alamite', 'npc:officer', 'npc:enforcer'];
const ALL_ENEMIES = ['tusken', 'pirateMelee', 'alamite', 'officer', 'enforcer',
  'rivalMaul', 'rivalRevan', 'rivalVentress', 'rivalGalen', 'rivalMaris'];

const h = await launch();
const { page } = h;
await h.waitForText(/WAVE BATTLE|PRESS START/i);

/** in-page: the furthest weapon point in front of `who`, horizontally */
const MEASURE = `(who, char) => {
  const T = who.position.constructor;
  const bones = char.rig?.bones;
  const mounts = [bones?.weaponR, bones?.weaponL, char.gaffi, char.root.getObjectByName("weaponMount"), char.root.getObjectByName("weaponMountL")].filter(Boolean);
  const yaw = who.facingYaw ?? who.yaw ?? 0;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let best = 0, bestAhead = 0, lo = Infinity, hi = -Infinity;
  const seen = new Set();
  const v = new T();
  for (const m of mounts) m.traverse((o) => {
    if (!o.isMesh || seen.has(o)) return;
    let vis = true;
    for (let p = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
    if (!vis) return;
    seen.add(o);
    o.updateWorldMatrix(true, false);
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 400));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const dx = v.x - who.position.x, dz = v.z - who.position.z;
      const flat = Math.hypot(dx, dz);
      const ahead = dx * fx + dz * fz;
      if (flat > 0 && ahead / flat > 0.25 && flat > best) best = flat;
      if (ahead > bestAhead) bestAhead = ahead;
      lo = Math.min(lo, v.y - who.position.y); hi = Math.max(hi, v.y - who.position.y);
    }
  });
  return { reach: +best.toFixed(2), ahead: +bestAhead.toFixed(2), lo: +lo.toFixed(2), hi: +hi.toFixed(2), meshes: seen.size };
}`;

const rows = [];
let flagged = 0;
for (const spec of PLAYERS.length || !ENEMIES.length ? (PLAYERS.length ? PLAYERS : ALL_PLAYERS) : []) {
  const [id, alt] = spec.split(':sabers');
  const sabers = spec.endsWith(':sabers');
  await page.evaluate((c) => {
    window.__manual = false;
    window.__quitToTitle?.();
    window.__startMode('wave', 1, 'desert', [c]);
  }, id);
  await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
  // let the authored model and its weapon prop settle in
  await page.waitForTimeout(2500);
  const out = await page.evaluate(`(() => {
    window.__manual = true;
    const measure = ${MEASURE};
    const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
      dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
      rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, slamPressed:false,
      meleeSwapPressed:false, rangedSwapPressed:false, pausePressed:false });
    const g = window.__game;
    const p = g.players[0];
    const step = (inp) => g.update(1/60, [inp ?? blank(), blank(), blank(), blank()]);
    for (let i = 0; i < 20; i++) step();
    for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
    for (let i = 0; i < 30; i++) step();
    p.hp = p.maxHp = 100000;
    if (${sabers} && p.meleeKind !== 'sabers') step({ ...blank(), meleeSwapPressed: true });
    const swings = [];
    for (let s = 0; s < 6; s++) {
      step({ ...blank(), meleePressed: true });
      const clip = p.char.animator?.playing?.('upper') ?? '?';
      let frames = 0, maxReach = 0;
      while (p.meleeHitPending > 0 && frames < 200) {
        step(); frames++;
        const m = measure(p, p.char);
        if (m.reach > maxReach) maxReach = m.reach;
        if (p.meleeHitPending <= 0) swings.push({ step: p.meleeStep, clip, hit: m, maxBefore: +maxReach.toFixed(2), range: p.meleeRange });
      }
      // finish the swing, keep the combo alive
      let guard = 0;
      while (p.meleeTimer > 0 && guard++ < 200) {
        step();
        const m = measure(p, p.char);
        if (m.reach > maxReach) maxReach = m.reach;
      }
      swings[swings.length - 1].maxSwing = +maxReach.toFixed(2);
    }
    return { kind: p.meleeKind, swings };
  })()`);
  rows.push({ who: spec, ...out });
  console.log(`\n${spec} (${out.kind})`);
  for (const s of out.swings) {
    console.log(`  step ${s.step} ${String(s.clip).padEnd(22)} contact reach ${s.hit.reach.toFixed(2)} m`
      + ` (whole swing ${s.maxSwing.toFixed(2)}) · weapon y ${s.hit.lo}..${s.hit.hi}`);
  }
}

for (const kind of ENEMIES.length ? ENEMIES : PLAYERS.length ? [] : ALL_ENEMIES) {
  await page.evaluate(() => {
    window.__manual = false;
    window.__quitToTitle?.();
    window.__startMode('wave', 1, 'desert', ['paz']);
  });
  await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
  const out = await page.evaluate(`(async () => {
    window.__manual = true;
    const measure = ${MEASURE};
    const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
      dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
      rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, slamPressed:false,
      meleeSwapPressed:false, rangedSwapPressed:false, pausePressed:false });
    const g = window.__game;
    const p = g.players[0];
    const step = () => g.update(1/60, [blank(), blank(), blank(), blank()]);
    // wait for a hostile to exist so its class can be borrowed
    let n = 0;
    while (!g.enemies.length && n++ < 1200) step();
    const Enemy = g.enemies[0].constructor;
    for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
    for (let i = 0; i < 30; i++) step();
    p.hp = p.maxHp = 1e6;
    const pos = p.position.clone(); pos.z += 2.2;
    const e = g.addEnemy(new Enemy('${kind}', pos));
    // wait for the authored model
    await new Promise((r) => setTimeout(r, 2500));
    const res = [];
    for (let k = 0; k < 4; k++) {
      let guard = 0;
      e.committed = true; e.attackCd = 0;
      while (!(e.windup > 0) && guard++ < 600) { e.committed = true; step(); }
      let maxReach = 0;
      while (e.windup > 0 && guard++ < 900) {
        const before = e.windup;
        step();
        const m = measure(e, e.char);
        if (m.reach > maxReach) maxReach = m.reach;
        if (e.windup <= 0 && before > 0) res.push({ hit: m, maxBefore: +maxReach.toFixed(2),
          range: e.def.attackRange, special: e.special ?? null });
      }
      for (let i = 0; i < 40; i++) { step(); const m = measure(e, e.char); if (m.reach > maxReach) maxReach = m.reach; }
      if (res.length) res[res.length - 1].maxSwing = +maxReach.toFixed(2);
      p.position.copy(e.position); p.position.z -= 2.2;
    }
    return res;
  })()`);
  rows.push({ who: `enemy:${kind}`, swings: out });
  console.log(`\nenemy ${kind}`);
  for (const s of out) {
    // a trooper's radius, and the blade's forgiveness (STRIKE_MARGIN)
    const reachable = (s.maxSwing ?? 0) + 0.45 + 0.15;
    const bad = s.hit.meshes > 0 && s.range > reachable;
    if (bad) flagged++;
    console.log(`${bad ? '!!' : '  '}${s.special ?? 'swing'} contact reach ${s.hit.reach.toFixed(2)} m (whole ${s.maxSwing?.toFixed(2)})`
      + ` · weapon y ${s.hit.lo}..${s.hit.hi} · commits at ${s.range} m centre to centre${bad ? ` — past the ${reachable.toFixed(2)} m it can reach` : ''}`);
  }
}

if (h.errors?.length) console.log('\npage errors:', h.errors.slice(0, 5));
console.log(flagged ? `\n${flagged} swing(s) commit from beyond their weapon's reach` : '\nevery hostile commits within its weapon\'s reach');
if (flagged) process.exitCode = 1;
await h.close();
