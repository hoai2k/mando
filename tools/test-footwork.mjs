/**
 * Footwork: how a run builds, and what the feet do while the hands are busy.
 *
 *  - A light push of the stick walks, on the walk cycle.
 *  - Pushed for a run, a fighter walks for a second, jogs for a second, then
 *    runs at 80% of the old run speed. LB is still the hurry: a dodge and a
 *    sprint at once, and coming off it drops to the run, not to a walk.
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
  });
  await run({ frames: 30 });

  // ---- the walk ----
  const walk = await run({ frames: 45, stick: 0.45 });
  check('a light push of the stick walks, on the walk cycle',
    walk.speed > 0.4 && walk.speed < 2.1 && walk.legs === 'walkLower', walk);
  // ---- the build-up: walk, jog, run ----
  await run({ frames: 30 });                                   // to a standstill
  const walking = await run({ frames: 24, stick: 1 });          // 0.8 s
  const jogging = await run({ frames: 24, stick: 1 });          // 1.6 s
  const running = await run({ frames: 36, stick: 1 });          // 2.8 s
  check('pushed for a run, the first second is a walk', walking.speed <= 1.5 && walking.legs === 'walkLower', walking);
  check('...the second a jog', jogging.speed > 3 && jogging.speed < 5.5, jogging);
  check('...and then a run, at 80% of the old 9.2 m/s', Math.abs(running.speed - 9.2 * 0.8) < 0.2, running);
  await run({ frames: 30 });
  const hurry = await run({ frames: 12, stick: 1, press: ['dashPressed'], hold: ['sprintHeld'], from: 8 });
  check('LB is still the hurry: fast from the first moment', hurry.speed > 12 && hurry.sprinting, hurry);
  const offSprint = await run({ frames: 15, stick: 1 });
  check('...and letting go drops to the run, not back to a walk', Math.abs(offSprint.speed - 9.2 * 0.8) < 0.3, offSprint);

  // ---- the gun ----
  const firing = await run({ frames: 45, stick: 1, hold: ['shootHeld'], from: 20 });
  check('firing slows a runner to a walk', firing.peak <= 1.85 && firing.weapon === 'blaster', firing);
  check('...on the walk cycle', firing.legs === 'walkLower', firing);
  const sprintFire = await run({ frames: 45, stick: 1, press: ['dashPressed'], hold: ['sprintHeld', 'shootHeld'], from: 25 });
  check('LB held does not sprint through the fire', !sprintFire.sprinting && sprintFire.peak <= 1.85, sprintFire);
  const released = await run({ frames: 90, stick: 1 });
  check('let go of the trigger and the run builds back up', released.speed > 7, released);

  // ---- the swing ----
  await run({ frames: 90, stick: 1 });
  const swing = await run({ frames: 8, stick: 1, press: ['meleePressed'], from: 4 });
  check('a swing with nothing to lunge at plants the feet',
    swing.swinging && swing.peak <= 1, swing);
  const after = await run({ frames: 90, stick: 1 });
  check('...and the run builds back up once it is thrown', after.speed > 7, after);

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
