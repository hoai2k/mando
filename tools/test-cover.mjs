/**
 * Cover has to be cover.
 *
 * The report from play was taking cover at the side of a doorway in Missions
 * and being shot anyway — "their lasers were penetrating the wall". They were.
 *
 * A bolt moves by teleporting a step each frame and then asking what it met,
 * and it asked the *bodies* before it asked the *world*. The step is as long
 * as the weapon is fast — half a metre a frame at 60 Hz, three on a hitched
 * one against the loop's 0.05 s clamp — and the body test is a segment-vs-
 * sphere over the whole of it, so a step that ended inside a wall still
 * reported a hit on whoever was standing against the far side of it. A blast
 * door wall is 1 m thick and a body hugging it sits 0.45 m off the face: well
 * inside one step of anything faster than a Pyke's carbine.
 *
 * The flame stream had a bigger version of the same hole — it committed to an
 * aim line and then billed damage for the better part of a second with no
 * world check at all, so ducking behind a wall mid-volley did nothing.
 *
 * The invariant, at every frame rate and every bolt speed the roster has:
 * solid cover between a muzzle and a body means the body is not hit.
 *
 * Run:  node tools/test-cover.mjs
 */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const { page } = h;
await h.waitForText(/WAVE BATTLE|PRESS START/i);
await page.evaluate(() => {
  window.__manual = false;
  window.__quitToTitle?.();
  window.__startMode('wave', 1, 'station', ['din']);
});
await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
await page.evaluate(() => { window.__manual = true; });

/** every bolt speed on the roster, slowest (quarren net) to fastest (a Mandalorian's) */
const SPEEDS = [19, 26, 28, 34, 44, 60, 75];
/** 60 Hz, a dipped 30, and the loop's own worst case — dt is clamped at 0.05 */
const FRAMES = [['60fps', 1 / 60], ['30fps', 1 / 30], ['20fps', 0.05]];

const bolts = await page.evaluate(({ SPEEDS, FRAMES }) => {
  const g = window.__game;
  const p = g.players[0];
  const V3 = p.position.constructor;
  const phys = g.board.physics;
  const px = p.position.x, py = p.position.y, pz = p.position.z;

  // A body pressed against cover, which is the worst case and the one a player
  // actually plays: the capsule (r = 0.45) flush against the near face.
  const chest = new V3(px, py + p.profile.hitHeight * 0.5, pz);
  const target = {
    position: chest, radius: p.profile.hitRadius + 0.35, team: 0, alive: true,
    shield: null, onHit: () => { landed++; },
  };
  let landed = 0;

  /** fire one bolt from `standoff` metres past the far face and run it out */
  const probe = (speed, dt, standoff, farFace) => {
    for (const b of g.projectiles.bolts) { b.active = false; b.mesh.visible = b.glow.visible = false; }
    landed = 0;
    const from = new V3(farFace + standoff, py + 1.0, pz);
    g.projectiles.fire(from, chest.clone().sub(from).normalize(), speed, 25, 1, -1);
    for (let i = 0; i < 120 && !landed; i++) g.projectiles.update(dt, phys, [target], g.board.waterY);
    return landed > 0;
  };

  /**
   * @param thick the cover's thickness; 1 m is a mission wall, 0.5 a crate.
   * Phases are swept because a muzzle stands wherever the shooter does: the
   * hole only opened when a step happened to straddle the far face.
   */
  const sweep = (thick) => {
    const gap = 0.45;                       // capsule radius: flush against it
    const cx = px + gap + thick / 2;
    const box = phys.addBox(cx, py + 3, pz, thick, 6, 14);
    const farFace = cx + thick / 2;
    const rows = [];
    for (const [fps, dt] of FRAMES) {
      for (const speed of SPEEDS) {
        let through = 0, n = 0;
        for (let s = 3; s < 9; s += 0.02) { n++; if (probe(speed, dt, s, farFace)) through++; }
        rows.push({ fps, speed, step: +(speed * dt).toFixed(2), pct: Math.round((100 * through) / n) });
      }
    }
    // and the control, on the same geometry with the cover taken away: a shot
    // that misses because the maths is wrong proves nothing about the wall
    phys.boxes.splice(phys.boxes.indexOf(box), 1);
    let open = 0;
    for (const [, dt] of FRAMES) for (const speed of SPEEDS) if (probe(speed, dt, 5, farFace)) open++;
    return { rows, open, shots: FRAMES.length * SPEEDS.length };
  };

  return { wall: sweep(1), crate: sweep(0.5) };
}, { SPEEDS, FRAMES });

for (const [name, r] of [['1 m wall', bolts.wall], ['0.5 m crate', bolts.crate]]) {
  const worst = r.rows.reduce((a, b) => (b.pct > a.pct ? b : a));
  check(`${name}: no bolt speed at any frame rate gets through`, worst.pct === 0,
    `worst ${worst.fps} @ ${worst.speed} m/s (${worst.step} m/step): ${worst.pct}%`);
  check(`${name}: control — with the cover gone every shot lands`,
    r.open === r.shots, `${r.open}/${r.shots}`);
}

// ---- the flame stream, which used to burn straight through -------------
const flame = await page.evaluate(() => {
  const g = window.__game;
  const p = g.players[0];
  const V3 = p.position.constructor;
  const phys = g.board.physics;
  const px = p.position.x, py = p.position.y, pz = p.position.z;

  const e = g.addReinforcement('flametrooper', new V3(px + 8, py, pz));
  e.awareness = 'engaged';
  // the stream commits to a line when the trigger goes: aim it at the chest
  e.flameAim.set(px, py + 1.0, pz);

  const burn = (thick) => {
    p.hp = p.maxHp = 100000; p.hitGuard = 0;
    const before = p.hp;
    const box = thick > 0
      ? phys.addBox(px + 0.45 + thick / 2, py + 3, pz, thick, 6, 14) : null;
    for (let i = 0; i < 9; i++) { e.flameTick(g, p); p.hitGuard = 0; }
    if (box) phys.boxes.splice(phys.boxes.indexOf(box), 1);
    return before - p.hp;
  };

  const open = burn(0);
  const walled = burn(1);
  e.alive = false; e.removeMe = true;
  return { open, walled };
});
check('flame: a stream committed to its line does not burn through a wall',
  flame.walled === 0, `${flame.walled} damage through 1 m of wall`);
check('flame: control — with nothing in the way it still burns',
  flame.open > 0, flame.open);

// ---- and the doorway a player actually hides at ---------------------------
// The synthetic wall above proves the projectile maths. This proves the thing
// that was reported: standing at the side of a real mission door, behind the
// post, and being shot through it. The posts were decoration.
await page.evaluate(() => {
  window.__manual = false;
  window.__quitToTitle?.();
  window.__startMode('campaign', 1, 'refinery', ['din']);
});
await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
await page.evaluate(() => { window.__manual = true; });

const doors = await page.evaluate(() => {
  const g = window.__game;
  const p = g.players[0];
  const V3 = p.position.constructor;
  const phys = g.board.physics;
  const gates = [];
  for (const r of g.campaign.level.rooms) {
    for (const gate of [r.entryGate, r.exitGate]) if (gate) gates.push(gate);
  }
  // Open every door first, and check they really opened.
  //
  // A shut gate parks a blocker 4.8 m across the opening, which swallows the
  // posts whole — probing them with the door closed measures the door and
  // passes whatever the frame is made of. The bug is at an *open* doorway,
  // which is the only place it could ever have been.
  for (const gate of gates) {
    gate.open();
    for (let i = 0; i < 60 && gate.closed; i++) gate.update(1 / 30);
  }
  const stillShut = gates.filter((gate) => gate.closed).length;
  // the frame's own numbers: posts 0.5 m square, 3.6 m tall, 1.6 m out either side
  const POST_X = 1.6;
  let solid = 0, shot = 0, total = 0;
  for (const gate of gates) {
    const cos = Math.cos(gate.yaw), sin = Math.sin(gate.yaw);
    for (const side of [-1, 1]) {
      total++;
      const cx = gate.pos.x + cos * side * POST_X;
      const cz = gate.pos.z - sin * side * POST_X;
      // 1. the post is solid at chest height
      if (phys.solidAt(cx, gate.pos.y + 1.2, cz)) solid++;
      // 2. and a bolt aimed at a body tucked behind it does not arrive.
      //    The body sits one capsule-radius behind the post, square on.
      const bx = cx - cos * 0.75, bz = cz + sin * 0.75;
      const chest = new V3(bx, gate.pos.y + 1.0, bz);
      const target = { position: chest, radius: p.profile.hitRadius + 0.35, team: 0,
        alive: true, shield: null, onHit: () => { hit = true; } };
      let hit = false;
      const from = new V3(cx + cos * 6, gate.pos.y + 1.0, cz - sin * 6);
      g.projectiles.fire(from, chest.clone().sub(from).normalize(), 34, 25, 1, -1);
      for (let i = 0; i < 40 && !hit; i++) g.projectiles.update(0.05, phys, [target], g.board.waterY);
      if (hit) shot++;
    }
  }
  return { total, solid, shot, stillShut };
});
check('the doors under test are actually open', doors.stillShut === 0,
  `${doors.stillShut} still blocking`);
check('every mission door post is solid', doors.solid === doors.total,
  `${doors.solid}/${doors.total} posts`);
check('and fire does not reach a body tucked behind one', doors.shot === 0,
  `${doors.shot}/${doors.total} shot through`);

check.done('cover');
await h.close();
