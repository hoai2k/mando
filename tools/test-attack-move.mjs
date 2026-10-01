/**
 * Fighting on the move (ATTACK_MOVE_FACTOR in src/player/player.ts):
 *
 *  - a chain of swings thrown while running keeps moving, a little slower
 *    than the run (roughly 70% of it), rather than stopping to throw them;
 *  - the legs stay on their run/walk cycle under the swing — the upper body
 *    plays the strike;
 *  - holding the trigger while running eases the pace the same way, rather
 *    than dropping to a walk;
 *  - a swing begun mid-sprint keeps a reasonable pace (it drops to the attack
 *    pace, not to a standstill);
 *  - and the run comes back once the attacking stops.
 *
 *   node tools/test-attack-move.mjs
 */
import { blankInput, launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const { page } = h;

try {
  await h.startStepped('wave', 1, 'desert', ['din']);

  // somewhere open: wherever the drop left us, facing out along +Z
  await page.evaluate(() => {
    const g = window.__game, p = g.players[0];
    p.hp = p.maxHp = 1e6;
    p.velocity.set(0, 0, 0);
    p.cam.yaw = p.facingYaw = 0;
    window.__amHome = p.position.clone();
  });

  /**
   * Run forward for `lead` frames, then keep running for `frames` more while
   * pressing melee every `every` frames (or holding `hold`). Enemies are
   * marked dead, not stepped away, so a held stick is never let go. Reports
   * the speed and the legs' clip over the attacking frames.
   */
  const run = (spec) => page.evaluate(([s, BLANK]) => {
    const g = window.__game, p = g.players[0];
    p.position.copy(window.__amHome); p.velocity.set(0, 0, 0);
    p.cam.yaw = p.facingYaw = 0;
    const clear = () => { for (const e of g.enemies) { e.alive = false; e.removeMe = true; } };
    const speed = () => Math.hypot(p.velocity.x, p.velocity.z);
    const lead = s.lead ?? 45;
    let runSpeed = 0;
    const speeds = [];
    const legs = new Set();
    let swingFrames = 0;
    for (let i = 0; i < lead + s.frames; i++) {
      clear();
      p.cam.yaw = 0;
      if (s.sprint) p.energy = 1;
      const input = { ...BLANK, moveY: 1 };
      if (s.sprint) { input.sprintHeld = true; input.dashPressed = i === 0; }
      const k = i - lead;
      if (k >= 0) {
        if (s.every && k % s.every === 0) input.meleePressed = true;
        for (const key of s.hold ?? []) input[key] = true;
      }
      g.update(1 / 30, [input, BLANK, BLANK, BLANK]);
      if (k === -1) runSpeed = speed();
      // give the pace a few frames to settle into the attack before judging it
      if (k >= (s.settle ?? 6)) {
        const attacking = s.every ? p.meleeTimer > 0 : true;
        if (attacking) {
          swingFrames++;
          speeds.push(speed());
          const c = p.char.animator?.playing('lower');
          if (c) legs.add(c);
        }
      }
    }
    return {
      runSpeed: +runSpeed.toFixed(2),
      min: +Math.min(...speeds).toFixed(2),
      max: +Math.max(...speeds).toFixed(2),
      swingFrames,
      legs: [...legs].join(','),
      weapon: p.weapon,
      sprinting: p.sprinting,
    };
  }, [spec, blankInput()]);

  const ratio = (r) => ({ lo: +(r.min / r.runSpeed).toFixed(2), hi: +(r.max / r.runSpeed).toFixed(2) });
  const inBand = (r) => r.runSpeed > 6 && r.min >= 0.5 * r.runSpeed && r.max <= 0.95 * r.runSpeed;
  const runningLegs = (r) => r.legs.length > 0 && r.legs.split(',').every((c) => /^(run|walk)Lower$/.test(c));

  const swings = await run({ frames: 90, every: 8 });
  check('a chain of swings on the run keeps moving, a little under the run',
    swings.swingFrames > 30 && inBand(swings), { ...swings, ...ratio(swings) });
  check('...with the legs on the run/walk cycle under the strikes', runningLegs(swings), swings.legs);

  const firing = await run({ frames: 45, hold: ['shootHeld'], settle: 15 });
  check('holding the trigger on the run keeps moving, a little under the run',
    firing.weapon === 'blaster' && inBand(firing), { ...firing, ...ratio(firing) });

  const sprintSwing = await run({ frames: 12, every: 30, sprint: true, settle: 4 });
  check('a swing begun mid-sprint keeps a reasonable pace',
    // the attack pace is ~70% of the run (din: 9.2 * 0.8 = 7.36 m/s); a sprint
    // may drop to it, but never toward a standstill
    sprintSwing.swingFrames > 4 && sprintSwing.min > 4.5 && sprintSwing.max < sprintSwing.runSpeed,
    sprintSwing);

  const after = await run({ frames: 45, lead: 0 });
  check('...and the run comes back once the attacking stops', after.max > 7, after);

  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Attack on the move');
