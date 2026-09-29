/**
 * Footwork: what the feet do while the hands are busy.
 *
 *  - A light push of the stick walks, on the walk cycle; the rim runs.
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
  const full = await run({ frames: 45, stick: 1 });
  check('the rim of the stick runs', full.speed > 8 && full.legs !== 'walkLower', full);

  // ---- the gun ----
  const firing = await run({ frames: 45, stick: 1, hold: ['shootHeld'], from: 20 });
  check('firing slows a runner to a walk', firing.peak <= 1.85 && firing.weapon === 'blaster', firing);
  check('...on the walk cycle', firing.legs === 'walkLower', firing);
  const sprintFire = await run({ frames: 45, stick: 1, press: ['dashPressed'], hold: ['sprintHeld', 'shootHeld'], from: 25 });
  check('LB held does not sprint through the fire', !sprintFire.sprinting && sprintFire.peak <= 1.85, sprintFire);
  const released = await run({ frames: 45, stick: 1 });
  check('let go of the trigger and the run comes back', released.speed > 8, released);

  // ---- the swing ----
  await run({ frames: 30, stick: 1 });
  const swing = await run({ frames: 8, stick: 1, press: ['meleePressed'], from: 4 });
  check('a swing with nothing to lunge at plants the feet',
    swing.swinging && swing.peak <= 1, swing);
  const after = await run({ frames: 60, stick: 1 });
  check('...and the run comes back once it is thrown', after.speed > 8, after);

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
