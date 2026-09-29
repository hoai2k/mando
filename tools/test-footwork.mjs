/**
 * Footwork: how a stride starts, how the stick sets its pace, and what the
 * feet do while the hands are busy.
 *
 *  - The stick is the speed: a light push walks, pushed all the way a fighter
 *    runs from the first step (at 80% of the old run speed), and between the
 *    two the walk shades into the run through a jog. LB is still the hurry:
 *    a dodge and a sprint at once.
 *  - A stride off a standstill starts with a push: the body is moving from
 *    the first frame, and the planted foot stays where it stood rather than
 *    the back foot sliding backward under a body that has not moved yet.
 *  - Enemies on foot move at 80% of their listed speed too; riders and fliers
 *    are left as they were.
 *  - Firing slows the feet to a walk — even with LB held, which would
 *    otherwise sprint — and they run again once the trigger is let go.
 *  - A swing plants the feet. The lunge carries a swing onto a target; with
 *    nothing to lunge at, a running fighter stops to throw it rather than
 *    sliding along under the punch.
 *  - None of that applies in the saddle: a rider fires at full speed.
 *
 *   node tools/test-footwork.mjs
 */
import { blankInput, launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const { page } = h;

try {
  await h.startStepped('wave', 1, 'desert', ['din']);

  /**
   * Hold `hold` (and `stick`) for `frames` frames of 1/30 s and report the
   * ground speed and the legs' clip at the end. Enemies are cleared and the
   * player kept well clear of the scenery, so nothing but the input moves them.
   */
  const run = (spec) => page.evaluate(([s, BLANK]) => {
    const g = window.__game, p = g.players[0];
    for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
    p.hp = p.maxHp = 1e6;
    let peak = 0;
    for (let i = 0; i < s.frames; i++) {
      const input = { ...BLANK, moveY: s.stick ?? 0 };
      if (i === 0) for (const k of s.press ?? []) input[k] = true;
      for (const k of s.hold ?? []) input[k] = true;
      g.update(1 / 30, [input, BLANK, BLANK, BLANK]);
      if (i >= (s.from ?? 0)) peak = Math.max(peak, Math.hypot(p.velocity.x, p.velocity.z));
    }
    return {
      speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(2),
      peak: +peak.toFixed(2),
      legs: p.char.animator?.playing('lower') ?? null,
      sprinting: p.sprinting, weapon: p.weapon, swinging: p.meleeTimer > 0,
    };
  }, [spec, blankInput()]);

  // ---- enemies: 80% on foot, riders and fliers as they were ----
  const foes = await page.evaluate(() => {
    // the first wave has to arrive before there is anybody to measure
    window.__simUntil((g) => g.enemies.filter((e) => e.alive).length >= 3, 40);
    const out = {};
    for (const e of window.__game.enemies) {
      if (out[e.kind]) continue;
      const listed = window.__bodyDecl(e.kind).speed;
      out[e.kind] = { style: e.def.style, ratio: +(e.def.speed / listed).toFixed(3) };
    }
    return out;
  });
  const onFoot = Object.values(foes).filter((f) => f.style !== 'swoop' && f.style !== 'hover');
  const riders = Object.values(foes).filter((f) => f.style === 'swoop' || f.style === 'hover');
  check('enemies on foot move at 80% of their listed speed',
    onFoot.length > 0 && onFoot.every((f) => f.ratio === 0.8), foes);
  check('...and riders and fliers as they were', riders.every((f) => f.ratio === 1), foes);

  // somewhere open: the middle of the arena, facing out along +Z
  await page.evaluate(() => {
    const g = window.__game, p = g.players[0];
    p.velocity.set(0, 0, 0);
    p.cam.yaw = p.facingYaw = 0;
    window.__fwHome = p.position.clone();
  });
  // back to the middle, standing, facing +Z — each measurement from the same open ground
  const home = () => page.evaluate(() => {
    const p = window.__game.players[0];
    p.position.copy(window.__fwHome); p.velocity.set(0, 0, 0);
    p.cam.yaw = p.facingYaw = 0;
  });
  await run({ frames: 30 });

  // ---- the stick is the speed ----
  const pace = async (stick) => { await home(); await run({ frames: 30 }); return run({ frames: 60, stick }); };
  const creep = await pace(0.25);
  const walk = await pace(0.45);
  const jog = await pace(0.7);
  const full = await pace(1);
  check('a light push walks, on the walk cycle',
    walk.speed > 1.4 && walk.speed < 2.3 && walk.legs === 'walkLower', walk);
  check('...and a lighter one walks slower', creep.speed > 0.25 && creep.speed < walk.speed && creep.legs === 'walkLower', creep);
  check('further over it is a jog, between the walk and the run', jog.speed > 3.5 && jog.speed < 6, jog);
  check('pushed all the way, a run at 80% of the old 9.2 m/s', Math.abs(full.speed - 9.2 * 0.8) < 0.2 && full.legs === 'runLower', full);
  await home(); await run({ frames: 30 });
  const firstSteps = await run({ frames: 12, stick: 1 });
  check('...from the first steps: no walk to get through first', firstSteps.speed > 6.5, firstSteps);

  // ---- the first step: a push, and the planted foot stays planted ----
  const start = (stick) => page.evaluate(([stick, BLANK]) => {
    const g = window.__game, p = g.players[0], phys = g.board.physics;
    for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
    for (let i = 0; i < 40; i++) g.update(1 / 60, [BLANK, BLANK, BLANK, BLANK]);
    const foot = (b) => {
      p.char.root.updateMatrixWorld(true);
      const e = p.char.rig.bones[b].matrixWorld.elements;
      return { z: e[14], over: e[13] - phys.groundHeight(e[12], e[14], e[13] + 1.5) };
    };
    const fwd = { x: Math.sin(p.facingYaw), z: Math.cos(p.facingYaw) };
    let back = 0, prev = null, first = 0;
    const from = p.position.clone();
    for (let i = 0; i < 20; i++) {
      g.update(1 / 60, [{ ...BLANK, moveY: stick }, BLANK, BLANK, BLANK]);
      if (i === 0) first = p.velocity.x * fwd.x + p.velocity.z * fwd.z;
      const cur = { L: foot('footL'), R: foot('footR') };
      // how far a foot that is down this frame and the last moved backward
      if (prev) for (const k of ['L', 'R']) {
        if (cur[k].over < 0.03 && prev[k].over < 0.03) back += Math.max(0, prev[k].z - cur[k].z) * Math.sign(fwd.z || 1);
      }
      prev = cur;
    }
    const travel = (p.position.x - from.x) * fwd.x + (p.position.z - from.z) * fwd.z;
    return { firstFrame: +first.toFixed(2), plantedBack: +back.toFixed(3), travel: +travel.toFixed(2) };
  }, [stick, blankInput()]);
  await home();
  const walkOff = await start(0.45);
  await home();
  const runOff = await start(1);
  // A planted foot is never perfectly still — a stride in full flow gives up
  // 5-8 cm per metre covered (check-gait) — so the start is held to the same:
  // no more than 9 cm per metre, or 8 cm on a start too short to measure that
  // way. The bug this guards against slid the back foot 27 cm in 7 frames.
  const planted = (r) => r.plantedBack < Math.max(0.08, 0.09 * r.travel);
  check('a walk off a standstill moves the body from the first frame', walkOff.firstFrame > 0.5, walkOff);
  check('...and the feet it stands on stay put', planted(walkOff), walkOff);
  check('a run off a standstill is a push: moving at a third of the run in one frame', runOff.firstFrame > 2.4, runOff);
  check('...and the planted foot stays put', planted(runOff), runOff);

  // ---- LB ----
  await home(); await run({ frames: 30 });
  const hurry = await run({ frames: 12, stick: 1, press: ['dashPressed'], hold: ['sprintHeld'], from: 8 });
  check('LB is still the hurry: fast from the first moment', hurry.speed > 12 && hurry.sprinting, hurry);
  const offSprint = await run({ frames: 15, stick: 1 });
  check('...and letting go drops to the run', Math.abs(offSprint.speed - 9.2 * 0.8) < 0.3, offSprint);

  // ---- the gun ----
  await home();
  const firing = await run({ frames: 45, stick: 1, hold: ['shootHeld'], from: 20 });
  check('firing slows a runner to a walk', firing.peak <= 1.85 && firing.weapon === 'blaster', firing);
  check('...on the walk cycle', firing.legs === 'walkLower', firing);
  const sprintFire = await run({ frames: 45, stick: 1, press: ['dashPressed'], hold: ['sprintHeld', 'shootHeld'], from: 25 });
  check('LB held does not sprint through the fire', !sprintFire.sprinting && sprintFire.peak <= 1.85, sprintFire);
  const released = await run({ frames: 30, stick: 1 });
  check('let go of the trigger and the feet run again', released.speed > 7, released);

  // ---- the swing ----
  await home();
  await run({ frames: 45, stick: 1 });
  const swing = await run({ frames: 8, stick: 1, press: ['meleePressed'], from: 4 });
  check('a swing with nothing to lunge at plants the feet',
    swing.swinging && swing.peak <= 1, swing);
  const after = await run({ frames: 45, stick: 1 });
  check('...and runs on once it is thrown', after.speed > 7, after);

  // ---- the saddle ----
  const ride = await page.evaluate((BLANK) => {
    const g = window.__game, p = g.players[0];
    const v = g.vehicles.find((x) => x.alive !== false) ?? g.vehicles[0];
    if (!v) return { noRide: true };
    p.position.set(v.pos.x + 1.8, v.pos.y + 0.4, v.pos.z);
    p.velocity.set(0, 0, 0);
    const idle = [BLANK, BLANK, BLANK, BLANK];
    for (let i = 0; i < 9; i++) g.update(1 / 30, idle);
    g.update(1 / 60, [{ ...BLANK, slamPressed: true }, BLANK, BLANK, BLANK]);
    if (!p.vehicle) return { mounted: false };
    // nose at open desert, as test-vehicles does, then open the throttle
    v.yaw = Math.atan2(-v.pos.x, -v.pos.z);
    p.cam.yaw = v.yaw;
    const drive = (n, extra) => {
      for (let i = 0; i < n; i++) g.update(1 / 30, [{ ...BLANK, moveY: 1, ...extra }, BLANK, BLANK, BLANK]);
      return Math.hypot(v.vel.x, v.vel.z);
    };
    const cruising = drive(45, {});
    const shooting = drive(20, { shootHeld: true });
    return { mounted: true, cruising: +cruising.toFixed(1), shooting: +shooting.toFixed(1) };
  }, blankInput());
  check('a rider fires at full speed',
    ride.mounted && ride.shooting >= ride.cruising * 0.9 && ride.shooting > 6, ride);

  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Footwork');
