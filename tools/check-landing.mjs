/**
 * Does a drop land on its feet?
 *
 * What has to hold: a light landing is not interrupted by a crouch, a real
 * drop plays the absorb, a fast fall goes all the way down into the deep
 * crouch and costs a beat before the player can run out of it — and in either
 * crouch the feet stay on the ground rather than sinking through it. All
 * measured off the live game rather than off the clip.
 */
import { launch, makeCheck } from './harness.mjs';

const h = await launch();
await h.startMatch();
const check = makeCheck();

/** drop the player from `height` metres and report what the legs did */
async function drop(height) {
  return h.page.evaluate(async (h0) => {
    const g = window.__game;
    const p = g.players[0];
    const anim = p.char.animator;
    const dt = 1 / 60;
    const input = {
      moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
      dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false,
      meleePressed: false, rocketPressed: false, slamPressed: false, zoomHeld: false,
      zoomDelta: 0, blockHeld: false, switchPressed: false, pausePressed: false,
    };
    const inputs = [input, { ...input }, { ...input }, { ...input }];
    // put it in the air over where it already stands, then let go
    p.position.y += h0;
    p.velocity.set(0, 0, 0);
    p.grounded = false;
    let impact = 0;
    let crouched = false;
    let clip = null;
    // the ankles, against where they stand: a crouch folds over planted feet
    const feet = [p.char.rig.bones.footL, p.char.rig.bones.footR];
    const v = feet[0].position.clone();
    const ankle = () => Math.min(...feet.map((f) => f.getWorldPosition(v).y - p.position.y));
    const rest = ankle();
    let sink = 0;
    const watch = () => {
      const c = anim.current?.lower;
      if (c === 'landLower' || c === 'landHardLower') {
        crouched = true;
        clip = c;
        sink = Math.max(sink, rest - ankle());
      }
    };
    for (let i = 0; i < 240 && !p.grounded; i++) {
      impact = -p.velocity.y;
      g.update(dt, inputs);
      // `current` is the animator's own bookkeeping — the clip actually on the
      // lower channel this frame
      watch();
    }
    // now ask it to run, and see how fast it gets going
    const forward = inputs.map((v, i) => (i ? v : { ...v, moveY: -1 }));
    const speeds = [];
    for (let i = 0; i < 30; i++) {
      g.update(dt, forward);
      watch();
      speeds.push(Math.hypot(p.velocity.x, p.velocity.z));
    }
    return { impact, crouched, clip, sink, after5: speeds[4], after25: speeds[24] };
  }, height);
}

const light = await drop(0.35);
console.log(`  light drop: impact ${light.impact.toFixed(1)} m/s, speed 5 frames later ${light.after5.toFixed(2)} m/s`);
check('a kerb-step does not play the landing crouch', !light.crouched);

const normal = await drop(4);
console.log(`  jump-height drop: impact ${normal.impact.toFixed(1)} m/s`);
check('a jump-height drop takes it in the knees', normal.crouched && normal.clip === 'landLower', normal.clip);
check('...over feet that stay on the ground', normal.sink < 0.015, `${(normal.sink * 100).toFixed(1)} cm below standing`);

const heavy = await drop(20);
console.log(`  heavy drop: impact ${heavy.impact.toFixed(1)} m/s, speed 5 frames later ${heavy.after5.toFixed(2)}, 25 frames later ${heavy.after25.toFixed(2)}`);
check('a heavy drop goes all the way down into the deep crouch', heavy.crouched && heavy.clip === 'landHardLower', heavy.clip);
check('...over feet that stay on the ground', heavy.sink < 0.015, `${(heavy.sink * 100).toFixed(1)} cm below standing`);
check('a heavy landing holds the player up where a light one does not', heavy.after5 < normal.after5);
check('and lets them go again a beat later', heavy.after25 > heavy.after5);

await h.close();
check.done('Landings');
