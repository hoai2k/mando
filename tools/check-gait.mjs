/**
 * Does he run, or does he vibrate?
 *
 * Playtest, 2026-09-20: *"sometimes when running straight he starts to look
 * like he's vibrating instead of running."* Two independent causes, and this
 * holds the line under both of them (docs/ANIMATION_AUDIT.md).
 *
 *   1. **The ground has to hold on to him.** Contact is resolved after a step,
 *      so a runner crossing a downhill slope leaves the ground by however much
 *      the ground fell away under him — and lands, and leaves again, thirteen
 *      times a second, with the legs flicking between the run and the fall on
 *      a crossfade that never finishes. So: run straight across the Dune Sea's
 *      real dunes on four headings and at two frame rates, and count how often
 *      contact and the leg clip change. Both must be nil.
 *
 *   2. **A run has a flight phase.** Each step throws the body forward and it
 *      travels with neither foot down, so a cycle covers far more ground than
 *      the foot's sweep. Measured as if a foot were always planted, the gait
 *      has to spin to keep up — six steps a second at the player's run speed
 *      and nearly nine at a sprint, which is a blur of legs under a body going
 *      in a straight line. So: the cadence has to sit in the band a person
 *      runs in, and the planted foot has to actually stand on the sand while
 *      the body goes past it.
 *
 * The third check is the one that cannot be argued with: sample the ankle's
 * speed through the world against its height over the ground. Below ground
 * level it should be nearly still; the moment it lifts it should be travelling
 * much faster than the body, because a swing leg has to catch up and pass.
 *
 *   node tools/check-gait.mjs
 */
import { launch, makeCheck, blankInput } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const { page } = h;
page.on('pageerror', (e) => console.log(`  PAGE ERROR: ${String(e).slice(0, 200)}`));
await h.waitForText(/PRESS START|WAVE BATTLE/i);
await page.evaluate(() => { window.__manual = false; window.__startMode('wave', 1, 'desert', ['din']); });
await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 6000));

// ---------------------------------------------------------------- contact

const contact = await page.evaluate(([BLANK]) => {
  const g = window.__game, p = g.players[0];
  const pad = (o) => [{ ...BLANK, ...o }, { ...BLANK }, { ...BLANK }, { ...BLANK }];
  window.__manual = true;
  for (const e of g.enemies) e.removeMe = true;
  const run = (label, dt, yaw) => {
    p.hp = p.maxHp = 1e6;
    p.position.set(-40, g.board.physics.groundHeight(-40, 0, 40) + 0.2, 0);
    p.velocity.set(0, 0, 0);
    p.cam.yaw = yaw;
    const seconds = 10;
    const n = Math.round(seconds / dt);
    let groundFlips = 0, clipFlips = 0, air = 0, lastG = null, lastC = null, counted = 0, running = 0;
    for (let i = 0; i < n; i++) {
      g.update(dt, pad({ moveY: 1 }));
      const clip = p.char.animator?.playing('lower') ?? null;
      const speed = Math.hypot(p.velocity.x, p.velocity.z);
      // The first fifth is the walk up to speed, which legitimately changes
      // clip. And a heading that ends against a mesa or a dune's steep face
      // legitimately ends in the idle — what is being measured is the gait of
      // a body that *is* running, so only frames at running speed are judged.
      if (i > n * 0.2 && speed > 5) {
        counted++;
        if (lastG !== null && p.grounded !== lastG) groundFlips++;
        if (lastC !== null && clip !== lastC) clipFlips++;
        if (!p.grounded) air++;
        running = i;
      }
      lastG = p.grounded; lastC = clip;
    }
    void running;
    const dur = Math.max(1e-3, counted * dt);
    return { label, clip: lastC, seconds: +dur.toFixed(1),
      speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(1),
      groundPerSec: +(groundFlips / dur).toFixed(2), clipPerSec: +(clipFlips / dur).toFixed(2),
      airPct: +((100 * air) / Math.max(1, counted)).toFixed(1) };
  };
  const out = [];
  for (const [label, yaw] of [['east', Math.PI / 2], ['west', -Math.PI / 2], ['north', 0], ['south', Math.PI]]) {
    out.push(run(`${label} 60fps`, 1 / 60, yaw));
  }
  out.push(run('east 30fps', 1 / 30, Math.PI / 2));
  // and a body that really is in the air still falls: the stick is a slope
  // follower, never a glue
  p.position.set(0, 400, 0);
  p.velocity.set(0, 0, 0);
  for (let i = 0; i < 60; i++) g.update(1 / 60, pad({}));
  const fell = 400 - p.position.y;
  window.__manual = false;
  return { runs: out, fell: +fell.toFixed(1) };
}, [blankInput()]);

for (const r of contact.runs) {
  console.log(`  running ${r.label}: ${r.seconds} s at speed, ` +
    `${r.groundPerSec}/s contact changes, ${r.clipPerSec}/s clip changes, ${r.airPct}% airborne`);
}
check('every heading gave the gait time to be measured',
  contact.runs.every((r) => r.seconds > 2), JSON.stringify(contact.runs.map((r) => [r.label, r.seconds])));
check('running straight never loses the ground',
  contact.runs.every((r) => r.groundPerSec === 0 && r.airPct === 0),
  JSON.stringify(contact.runs.map((r) => [r.label, r.groundPerSec, r.airPct])));
check('...so the legs never flicker between the run and the fall',
  contact.runs.every((r) => r.clipPerSec === 0),
  JSON.stringify(contact.runs.map((r) => [r.label, r.clipPerSec])));
check('and a body with nothing under it still falls',
  contact.fell > 3, `${contact.fell} m in a second`);

// ---------------------------------------------------------------- cadence

const gait = await page.evaluate(() => {
  const g = window.__game, p = g.players[0];
  const anim = p.char.animator;
  const of = (name, speed) => {
    const rate = anim.gaitRate(name, speed, p.char.baseScale);
    const step = anim.stepInterval(name, rate);
    return { name, speed, stepsPerSec: +(1 / step).toFixed(2), stride: +(speed * step).toFixed(2) };
  };
  return [of('runLower', p.profile.runSpeed), of('sprintLower', p.profile.sprintSpeed),
    of('backpedalLower', p.profile.runSpeed)];
});
for (const r of gait) console.log(`  ${r.name} at ${r.speed} m/s: ${r.stepsPerSec} steps/s on a ${r.stride} m stride`);
// A person at 9.2 m/s takes about 4.4 steps a second on a 2.1 m stride, and a
// sprinter at 14.4 about 4.9 on 2.9 m. The band is generous either side; what
// it rules out is the six-to-nine that reads as a blur.
check('the gaits run at a cadence a person could run at',
  gait.every((r) => r.stepsPerSec >= 3 && r.stepsPerSec <= 5.6), JSON.stringify(gait));
check('...on a stride long enough to be a stride',
  gait.every((r) => r.stride >= 1.6), JSON.stringify(gait.map((r) => [r.name, r.stride])));

// ---------------------------------------------------------------- the plant

const plant = await page.evaluate(([BLANK]) => {
  const g = window.__game, p = g.players[0], phys = g.board.physics;
  const pad = (o) => [{ ...BLANK, ...o }, { ...BLANK }, { ...BLANK }, { ...BLANK }];
  window.__manual = true;
  p.hp = p.maxHp = 1e6;
  p.position.set(-40, phys.groundHeight(-40, 0, 40) + 0.2, 0);
  p.velocity.set(0, 0, 0);
  p.cam.yaw = Math.PI / 2;
  const dt = 1 / 60;
  const down = [], up = [];
  let prev = null;
  for (let i = 0; i < 600; i++) {
    g.update(dt, pad({ moveY: 1 }));
    if (i < 150) continue;
    const bones = p.char.rig?.bones;
    if (!bones?.footL) continue;
    p.char.root.updateMatrixWorld(true);
    const e = bones.footL.matrixWorld.elements;
    const x = e[12], y = e[13], z = e[14];
    const over = y - phys.groundHeight(x, z, y + 1.5);
    if (prev) {
      const speed = Math.hypot(x - prev.x, z - prev.z) / dt;
      if (over <= 0) down.push(speed);
      else if (over > 0.25) up.push(speed);
    }
    prev = { x, z };
  }
  window.__manual = false;
  const median = (a) => { a.sort((m, n) => m - n); return +(a[a.length >> 1] ?? 0).toFixed(2); };
  return { body: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(1),
    planted: median(down), swinging: median(up), plantedFrames: down.length, swingFrames: up.length };
}, [blankInput()]);

console.log(`  at ${plant.body} m/s: the foot on the ground moves ${plant.planted} m/s ` +
  `(${plant.plantedFrames} frames), the foot in the air ${plant.swinging} m/s (${plant.swingFrames} frames)`);
check('the planted foot stands on the ground while the body goes past',
  plant.plantedFrames > 30 && plant.planted < plant.body * 0.2,
  `${plant.planted} m/s under a body doing ${plant.body}`);
check('...and the swinging foot travels faster than the body, to catch up',
  plant.swinging > plant.body, `${plant.swinging} m/s against ${plant.body}`);

// ---------------------------------------------------------------- the stance

// Which way the body points while it is moving, and which cycle the legs run
// for it. Playtest, 2026-09-21: *"for melee they need to be able to turn while
// fighting."* A swing used to hold the body square to the camera, and since
// swings chain, a whole melee fight was fought sideways on the strafe cycle.
// Aiming is the stance that asks for that, and blocking keeps it because a
// shield has to face what it stops; a swing turns with the stick.
const stance = await page.evaluate(([BLANK]) => {
  const g = window.__game, p = g.players[0];
  const pad = (o) => [{ ...BLANK, ...o }, { ...BLANK }, { ...BLANK }, { ...BLANK }];
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const deg = (r) => +((r * 180) / Math.PI).toFixed(0);
  window.__manual = true;
  for (const e of g.enemies) e.removeMe = true;
  const dt = 1 / 60;
  const run = (label, over, swing) => {
    p.hp = p.maxHp = 1e6;
    p.position.set(-40, g.board.physics.groundHeight(-40, 0, 40) + 0.2, 0);
    p.velocity.set(0, 0, 0);
    p.cam.yaw = Math.PI / 2;
    p.facingYaw = Math.PI / 2;
    const clips = new Set();
    for (let i = 0; i < 120; i++) {
      g.update(dt, pad({ ...over, meleePressed: swing && i % 30 === 0 }));
      const c = p.char.animator?.playing('lower');
      if (c && c !== 'airLower') clips.add(c);
    }
    return { label,
      offCamera: Math.abs(deg(norm(p.facingYaw - p.cam.yaw))),
      offTravel: Math.abs(deg(norm(p.facingYaw - Math.atan2(p.velocity.x, p.velocity.z)))),
      clip: p.char.animator?.playing('lower'), clips: [...clips].join(',') };
  };
  const out = {
    swingLeft: run('swinging, running left', { moveX: -1 }, true),
    swingBack: run('swinging, running back', { moveY: -1 }, true),
    aimLeft: run('aiming, running left', { moveX: -1, aimHeld: true }, false),
    fireLeft: run('firing, running left', { moveX: -1, shootHeld: true }, false),
    blockLeft: run('blocking, running left', { moveX: -1, blockHeld: true }, false),
  };
  window.__manual = false;
  return out;
}, [blankInput()]);

for (const k of Object.keys(stance)) {
  const r = stance[k];
  console.log(`  ${r.label}: ${r.offCamera}° off the camera, ${r.offTravel}° off travel, legs on ${r.clip}`);
}
check('a swing turns with the stick instead of holding square to the camera',
  stance.swingLeft.offTravel <= 5 && stance.swingBack.offTravel <= 5,
  JSON.stringify([stance.swingLeft.offTravel, stance.swingBack.offTravel]));
check('...so a fight on the move runs rather than strafes',
  stance.swingLeft.clip === 'runLower' && stance.swingBack.clip === 'runLower',
  JSON.stringify([stance.swingLeft.clip, stance.swingBack.clip]));
check('aiming is still the stance that holds the body square',
  stance.aimLeft.offCamera <= 5 && stance.aimLeft.clips.includes('strafe'),
  JSON.stringify(stance.aimLeft));
check('...and so are firing from the hip and blocking',
  stance.fireLeft.offCamera <= 5 && stance.blockLeft.offCamera <= 5,
  JSON.stringify([stance.fireLeft.offCamera, stance.blockLeft.offCamera]));

if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();
check.done('the run');
