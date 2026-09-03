/**
 * The jetpack, by the direction it is flying.
 *
 * Two things reported from play, and both are here:
 *
 *  1. **A flier turned sideways looked tilted the wrong way.** The body's
 *     forward lean was written to `root.rotation.x` on a default XYZ Euler,
 *     which three applies about the *world* X axis — so it was a lean facing
 *     north and a sideways roll facing east. The check is axis-free: whichever
 *     way the body is pointed, its own right-hand axis must stay level,
 *     because a pitch about that axis cannot tip it out of level.
 *
 *  2. **One flight pose served every direction of flight.** The cruise — nose
 *     down, legs streaming back — was held through a vertical climb and
 *     through a descent onto a roof. There are four now, chosen off the climb
 *     angle and the ground below (`flightPose` in src/anim/animator.ts), and
 *     this walks a flight through them: off the deck, up, out, down, and into
 *     the landing crouch.
 *
 * Stepped directly at a fixed dt rather than in wall-clock time: software
 * rendering runs a frame a second here.
 *
 * Run:  node tools/check-flight-poses.mjs
 */
import { blankInput, launch, makeCheck } from './harness.mjs';

const h = await launch();
const check = makeCheck();

await h.startMatch();

// Every case starts from the same patch of deck. Cases fly the player a long
// way — up 60 m, out 20 — and stacking one on the next put them out over the
// board's edge with nothing underneath, where nothing about the ground can be
// tested at all.
await h.page.evaluate(() => {
  window.__flyHome = window.__game.players[0].position.clone();
});

/**
 * Put the player in a given piece of flight and hold one input through it.
 *
 * Everyone starts back at `__flyHome`, standing. `state` is what happens
 * next: `drop` metres straight up from there, `vel` the velocity to start
 * from, `yaw` the way the camera (and so the stick) points. `press` fires its
 * input on the first frame only, which is what a button press is — held for
 * every frame of a take-off it would read as a stutter of presses.
 *
 * Reports what the two channels ended on, every lower clip seen along the
 * way, and the body's own right-hand axis in world space — taken straight off
 * the world matrix's first column, so it owes nothing to how the rotation was
 * built.
 */
async function fly({ seconds = 1, input = {}, press = {}, state = {} }) {
  return h.page.evaluate(([secs, over, first, st, BLANK]) => {
    const g = window.__game;
    const p = g.players[0];
    p.position.copy(window.__flyHome);
    p.velocity.set(0, 0, 0);
    p.grounded = true;
    p.wasGrounded = true;
    p.slowDescent = false;
    if (st.drop !== undefined) { p.position.y += st.drop; p.grounded = false; p.wasGrounded = false; }
    if (st.vel) p.velocity.set(...st.vel);
    if (st.grounded !== undefined) { p.grounded = st.grounded; p.wasGrounded = st.grounded; }
    if (st.yaw !== undefined) { p.facingYaw = st.yaw; p.cam.yaw = st.yaw; }
    p.fuel = st.fuel ?? 1;
    const held = { ...BLANK, ...over };
    const frame1 = [{ ...held, ...first }, { ...BLANK }, { ...BLANK }, { ...BLANK }];
    const rest = [held, { ...BLANK }, { ...BLANK }, { ...BLANK }];
    const poses = new Set();
    const steps = Math.round(secs * 60);
    for (let i = 0; i < steps; i++) {
      g.update(1 / 60, i === 0 ? frame1 : rest);
      if (p.char.animator.current?.lower) poses.add(p.char.animator.current.lower);
    }
    const root = p.char.root;
    root.updateMatrixWorld(true);
    // Read the pose off the bones the mixer just wrote, not off the clip.
    // `axis` turns a bone's local rotation into where one of its axes ends up
    // pointing in its parent's frame, which is a claim about the pose that
    // does not care how the rotation was authored.
    const axis = (name, v) => {
      const b = p.char.animator.rig.bones[name];
      if (!b) return null;
      const { x: qx, y: qy, z: qz, w } = b.quaternion;
      // q * v * q^-1, written out
      const ix = w * v[0] + qy * v[2] - qz * v[1];
      const iy = w * v[1] + qz * v[0] - qx * v[2];
      const iz = w * v[2] + qx * v[1] - qy * v[0];
      const iw = -qx * v[0] - qy * v[1] - qz * v[2];
      return [
        ix * w + iw * -qx + iy * -qz - iz * -qy,
        iy * w + iw * -qy + iz * -qx - ix * -qz,
        iz * w + iw * -qz + ix * -qy - iy * -qx,
      ];
    };
    // a leg bone points down -Y, so how far its tip has swung toward +X (the
    // character's own left) is the whole lateral story of the pose
    const legAcross = (name) => {
      const d = axis(name, [0, -1, 0]);
      return d && +d[0].toFixed(3);
    };
    // ...and how far the pelvis's up axis has tipped sideways is the roll
    const hipsUp = axis('hips', [0, 1, 0]);
    // column 0 of the world matrix is the body's own +X (right) axis; its Y
    // component is how far out of level the body has been rolled
    const e = root.matrixWorld.elements;
    const len = Math.hypot(e[0], e[1], e[2]) || 1;
    return {
      lower: p.char.animator.current?.lower ?? null,
      upper: p.char.animator.current?.upper ?? null,
      poses: [...poses],
      grounded: p.grounded,
      vy: +p.velocity.y.toFixed(2),
      speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(2),
      leanX: +root.rotation.x.toFixed(4),
      order: root.rotation.order,
      rightTilt: +(e[1] / len).toFixed(4),
      roll: +root.rotation.z.toFixed(4),
      facingYaw: +p.facingYaw.toFixed(3),
      hipsRoll: hipsUp && +hipsUp[0].toFixed(3),
      thighL: legAcross('upperLegL'),
      thighR: legAcross('upperLegR'),
    };
  }, [seconds, input, press, state, blankInput()]);
}

// ---------- 1. the sideways tilt ----------
//
// Fly forward under thrust on four headings. It has to be the same lean every
// time — a pitch about the body's own right axis, which by construction
// leaves that axis level however far the body is yawed.
console.log('\n-- the lean is a lean, not a roll --');
const HEADINGS = [['north', 0], ['east', Math.PI / 2], ['south', Math.PI], ['west', -Math.PI / 2]];
for (const [name, yaw] of HEADINGS) {
  const r = await fly({
    seconds: 1.6,
    input: { jumpHeld: true, moveY: -1 },
    state: { drop: 40, yaw },
  });
  check(`facing ${name}: the body's right axis stays level`, Math.abs(r.rightTilt) < 0.02, r);
  if (yaw === 0) check('...and there is a real lean here to get wrong', Math.abs(r.leanX) > 0.02, { leanX: r.leanX });
}

// ---------- 2. a pose per direction of flight ----------
console.log('\n-- the pose follows the flight --');

// Straight up: full thrust, no stick. The legs hang under the pack.
const up = await fly({
  seconds: 1.2,
  input: { jumpHeld: true },
  state: { drop: 40 },
});
check('driving straight up hangs the legs (flyRiseLower)', up.lower === 'flyRiseLower', up);
check('...and brings its own upper channel with it', up.upper === 'flyRiseUpper', { upper: up.upper });

// Forward and up: thrust plus the stick. This is what the pack was always
// posed for, and it has to still be the cruise.
const cruise = await fly({
  seconds: 2.5,
  input: { jumpHeld: true, moveY: -1 },
  state: { drop: 40 },
});
check('flying forward and up is the cruise (flyLower)', cruise.lower === 'flyLower', cruise);
check('...reached through the plumb climb, as the speed builds', cruise.poses.includes('flyRiseLower'), { poses: cruise.poses });

// Coming down on the pack, high enough that the ground is not yet a factor.
const down = await fly({
  seconds: 1.5,
  input: { aimHeld: true },
  state: { drop: 60, vel: [0, -6, 0] },
});
check('descending straightens the legs downward (flyFallLower)', down.lower === 'flyFallLower', down);
check('...on its own upper channel too', down.upper === 'aimUpper' || down.upper === 'flyFallUpper', { upper: down.upper });

// ---------- 3. flying sideways ----------
//
// Travel only diverges from facing while the sights are up — otherwise the
// body turns to face where it is going — so these hold aim on one bearing and
// push the stick across it. The legs must swing out trailing the drift, in
// mirrored directions for the two ways across, and the body must not bank:
// this is a leg swing, not a roll.
console.log('\n-- flying sideways --');
const DRIFT = { seconds: 1.6, state: { drop: 30, yaw: 0 } };
const driftR = await fly({ ...DRIFT, input: { jumpHeld: true, aimHeld: true, moveX: 1 } });
const driftL = await fly({ ...DRIFT, input: { jumpHeld: true, aimHeld: true, moveX: -1 } });
check('drifting one way trails the legs the other', driftR.lower === 'flyDriftLower', driftR);
check('...and the other way is its mirror', driftL.lower === 'flyDriftLLower', driftL);
check('the two are mirrored, not the same pose twice',
  driftR.thighL !== null && Math.sign(driftR.thighL) === -Math.sign(driftL.thighL),
  { right: [driftR.thighL, driftR.thighR], left: [driftL.thighL, driftL.thighR] });
check('both thighs swing the same way across the body',
  Math.sign(driftR.thighL) === Math.sign(driftR.thighR) && Math.abs(driftR.thighL) > 0.15,
  { thighL: driftR.thighL, thighR: driftR.thighR });
check('drifting right swings the legs to the left', driftR.thighL > 0.15, { thighL: driftR.thighL });
for (const [name, r] of [['right', driftR], ['left', driftL]]) {
  // a bank would tip the body's own right axis out of level, and a pelvis
  // roll under an upright root would tip the hips' up axis sideways
  check(`drifting ${name} is a leg swing, not a bank`,
    r.roll === 0 && Math.abs(r.rightTilt) < 0.02 && Math.abs(r.hipsRoll) < 0.05,
    { roll: r.roll, rightTilt: r.rightTilt, hipsRoll: r.hipsRoll });
}
// Along the bearing, either way down it, the cruise still serves. `leanX`
// says which: positive is travel along the facing, negative is travel back
// down it, so these assert the case they mean rather than trusting the stick.
const ahead = await fly({
  seconds: 1.6,
  input: { jumpHeld: true, aimHeld: true, moveY: 1 },
  state: { drop: 30, yaw: 0 },
});
check('flying where you are looking is still the cruise',
  ahead.lower === 'flyLower' && ahead.leanX > 0, ahead);
const back = await fly({
  seconds: 1.6,
  input: { jumpHeld: true, aimHeld: true, moveY: -1 },
  state: { drop: 30, yaw: 0 },
});
check('...and so is backing off along it, which is not a drift',
  back.lower === 'flyLower' && back.leanX < 0, back);

// ---------- 4. the ground, and arriving on it ----------
console.log('\n-- meeting the ground --');
const land = await fly({
  seconds: 9,
  input: { aimHeld: true },
  state: { drop: 9, vel: [0, -3.5, 0] },
});
check('the brace comes on as the ground closes', land.poses.includes('flyBraceLower'), { poses: land.poses });
check('...and hands over to the crouch rather than to nothing', land.poses.includes('landLower'), { poses: land.poses });
check('...arriving on the ground', land.grounded, { grounded: land.grounded, vy: land.vy });

// A take-off begins a metre off the deck it is leaving, and must not gather
// for a landing on it.
const off = await fly({
  seconds: 0.8,
  input: { jumpHeld: true },
  press: { jumpPressed: true },
  state: {},
});
check('a take-off never braces for the deck it is leaving', !off.poses.includes('flyBraceLower'), { poses: off.poses });
check('...it climbs out on the plumb pose', off.poses.includes('flyRiseLower'), { poses: off.poses });

// ---------- 5. the poses settle ----------
//
// Hold one steady flight and count the pose changes. Hysteresis is what stops
// a body sitting on a threshold from strobing between two clips.
console.log('\n-- the poses settle --');
const held = await h.page.evaluate(([BLANK]) => {
  const g = window.__game;
  const p = g.players[0];
  p.position.copy(window.__flyHome);
  p.position.y += 45;
  p.velocity.set(0, 0, 0);
  p.grounded = false;
  p.wasGrounded = false;
  p.fuel = 1;
  const inputs = [{ ...BLANK, jumpHeld: true, moveY: -0.45 }, { ...BLANK }, { ...BLANK }, { ...BLANK }];
  let changes = 0;
  let last = null;
  for (let i = 0; i < 300; i++) {
    g.update(1 / 60, inputs);
    const now = p.char.animator.current?.lower ?? null;
    if (last !== null && now !== last) changes++;
    last = now;
  }
  return { changes, last };
}, [blankInput()]);
check('a steady flight does not strobe between poses', held.changes <= 2, held);

check('no page errors', h.errors.length === 0, h.errors.slice(0, 3));
check.done('flight poses');
await h.close();
