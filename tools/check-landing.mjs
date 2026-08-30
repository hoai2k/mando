/**
 * Does a drop land on its feet?
 *
 * Three things to hold: a light landing is not interrupted by a crouch, a real
 * drop plays one, and a heavy drop costs a beat before the player can run out
 * of it. All measured off the live game rather than off the clip.
 */
import { launch } from './harness.mjs';

const h = await launch();
await h.startMatch();
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failures++; };

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
      throttleHeld: false, brakeHeld: false,
    };
    const inputs = [input, { ...input }, { ...input }, { ...input }];
    // put it in the air over where it already stands, then let go
    p.position.y += h0;
    p.velocity.set(0, 0, 0);
    p.grounded = false;
    let impact = 0;
    let crouched = false;
    for (let i = 0; i < 240 && !p.grounded; i++) {
      impact = -p.velocity.y;
      g.update(dt, inputs);
      // `current` is the animator's own bookkeeping — the clip actually on the
      // lower channel this frame
      if (anim.current?.lower === 'landLower') crouched = true;
    }
    // now ask it to run, and see how fast it gets going
    const forward = inputs.map((v, i) => (i ? v : { ...v, moveY: -1 }));
    const speeds = [];
    for (let i = 0; i < 30; i++) {
      g.update(dt, forward);
      if (anim.current?.lower === 'landLower') crouched = true;
      speeds.push(Math.hypot(p.velocity.x, p.velocity.z));
    }
    return { impact, crouched, after5: speeds[4], after25: speeds[24] };
  }, height);
}

const light = await drop(0.35);
console.log(`  light drop: impact ${light.impact.toFixed(1)} m/s, speed 5 frames later ${light.after5.toFixed(2)} m/s`);
check(!light.crouched, 'a kerb-step does not play the landing crouch');

const normal = await drop(4);
console.log(`  jump-height drop: impact ${normal.impact.toFixed(1)} m/s`);
check(normal.crouched, 'a jump-height drop takes it in the knees');

const heavy = await drop(20);
console.log(`  heavy drop: impact ${heavy.impact.toFixed(1)} m/s, speed 5 frames later ${heavy.after5.toFixed(2)}, 25 frames later ${heavy.after25.toFixed(2)}`);
check(heavy.crouched, 'a heavy drop takes it in the knees');
check(heavy.after5 < normal.after5, 'a heavy landing holds the player up where a light one does not');
check(heavy.after25 > heavy.after5, 'and lets them go again a beat later');

await h.close();
console.log(failures ? `\n${failures} failure(s)` : '\nlandings absorb the way they should');
process.exit(failures ? 1 : 0);
