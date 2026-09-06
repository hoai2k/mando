/**
 * The acrobat's air somersault.
 *
 * Six things to hold. A second jump in the air rolls Ventress into the tuck
 * and keeps her turning while the button is down; letting go does not leave
 * her falling head-down but carries the turn round to upright and unfolds her
 * into a normal fall; and a fighter without `airFlip` — Din, who has a
 * jetpack to hold instead — never rolls at all.
 *
 * Then the two the height buys. A hop with no room in it for a whole
 * revolution does not start one at all, and a roll held all the way into the
 * ground still gets its feet under it before the boots arrive — the tuck is
 * given up early enough for the turn to finish in the air that is left.
 *
 * And the last is where the turn is centred: on the weight of the tucked body,
 * which the tuck gathers forward of the spine. Turning about the standing hips
 * throws that ball round a circle a quarter-metre across, so the test watches
 * the body's own mass centre and holds it to a line.
 */
import { launch, BTN } from './harness.mjs';

const h = await launch();
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failures++; };

/** start a match as the named fighter, whatever their place in the roster is */
async function startAs(name) {
  await h.waitForText(/PRESS START|WAVE BATTLE/i);
  await h.pad.tap(BTN.START);
  await h.waitForText(/CHOOSE|TERRITORY|DUNE SEA/i);
  await h.pad.tap(BTN.A);
  await h.waitForText(/CHOOSE YOUR|DIN DJARIN/i);
  for (let i = 0; i < 14; i++) {
    if (new RegExp(name, 'i').test(await h.text())) break;
    await h.pad.tap(BTN.DRIGHT);
  }
  await h.tapUntil(BTN.A, async () => /READY/i.test(await h.text()));
  await h.pad.tap(BTN.A);
  await h.tapUntil(BTN.A, () => h.page.evaluate(() => !!window.__game), { timeoutMs: 20000 });
  await h.waitForPlaying();
}

/**
 * Lift the player off the ground, then hold jump for `holdFrames` and let go,
 * sampling the body's pitch and which clip its legs are playing throughout.
 */
async function tumble(holdFrames) {
  return h.page.evaluate(async (frames) => {
    const g = window.__game;
    const p = g.players[0];
    const anim = p.char.animator;
    const dt = 1 / 60;
    const base = {
      moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
      dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false,
      meleePressed: false, rocketPressed: false, slamPressed: false, zoomHeld: false,
      zoomDelta: 0, blockHeld: false, switchPressed: false, pausePressed: false,
    };
    const pad = (over) => [{ ...base, ...over }, { ...base }, { ...base }, { ...base }];
    // well clear of the ground, falling gently, with no jump left to spend
    p.position.y += 24;
    p.velocity.set(0, 0, 0);
    p.grounded = false;
    g.update(dt, pad({}));

    const out = { held: [], settle: [], clipsHeld: new Set(), clipsAfter: new Set() };
    for (let i = 0; i < frames; i++) {
      g.update(dt, pad({ jumpHeld: true, jumpPressed: i === 0 }));
      out.held.push(p.char.root.rotation.x);
      if (anim.current?.lower) out.clipsHeld.add(anim.current.lower);
    }
    for (let i = 0; i < 180 && !p.grounded; i++) {
      g.update(dt, pad({}));
      out.settle.push(p.char.root.rotation.x);
      if (anim.current?.lower) out.clipsAfter.add(anim.current.lower);
    }
    return {
      name: p.profile.name,
      airFlip: p.profile.airFlip,
      held: out.held,
      settle: out.settle,
      clipsHeld: [...out.clipsHeld],
      clipsAfter: [...out.clipsAfter],
      grounded: p.grounded,
    };
  }, holdFrames);
}

// ---- the acrobat ----
await startAs('ventress');
const v = await tumble(45);
const turned = Math.max(...v.held) - Math.min(...v.held);
console.log(`  ${v.name}: airFlip=${v.airFlip}, pitch swept ${turned.toFixed(2)} rad while held, legs ran ${v.clipsHeld.join(',')}`);
check(v.airFlip === true, 'Ventress is flagged as an acrobat');
check(turned > 5, 'holding jump in the air turns her most of a revolution or more');
check(v.clipsHeld.includes('tuckLower'), '...in the tuck-roll pose');

const last = v.settle[v.settle.length - 1];
const upright = Math.abs(Math.atan2(Math.sin(last), Math.cos(last)));
console.log(`  after release: settled at ${last.toFixed(3)} rad (${upright.toFixed(3)} from upright), legs ran ${v.clipsAfter.join(',')}`);
check(upright < 0.25, 'letting go leaves her upright, not head-down');
check(v.clipsAfter.includes('airLower'), '...and unfolds back to the falling stance');
// the turn must carry on past the release rather than stopping dead
const afterRelease = Math.abs(v.settle[6] - v.settle[0]);
check(afterRelease > 0.05, 'the roll carries on turning after the button comes up');

// ---- what the height has to buy ----
//
// The segment weights below are a crude mass model of a humanoid rig — torso,
// head, arms, legs at roughly their real shares — summed over the bones to
// find where the body's weight actually is at any moment of the roll.
const MASS = [
  ['hips', 'chest', 0.36], ['chest', 'head', 0.14], ['head', 'head', 0.08],
  ['upperArmL', 'forearmL', 0.03], ['forearmL', 'handL', 0.03],
  ['upperArmR', 'forearmR', 0.03], ['forearmR', 'handR', 0.03],
  ['upperLegL', 'lowerLegL', 0.08], ['lowerLegL', 'footL', 0.055],
  ['upperLegR', 'lowerLegR', 0.08], ['lowerLegR', 'footR', 0.055],
];

/**
 * A whole jump, played out on the pad the way a player would: leap, hold the
 * button for `climbFrames` to ride the super jump up (Ventress is helmetless,
 * so hers is a held climb rather than a jetpack), let go, then ask for the
 * roll and hold the tuck all the way into the ground.
 *
 * Comes back with the pitch, the legs' clip and where the body's weight was on
 * every frame of it.
 */
async function jumpAndRoll(climbFrames, mass) {
  return h.page.evaluate(async ([climbFrames, mass]) => {
    const g = window.__game;
    const p = g.players[0];
    const anim = p.char.animator;
    const dt = 1 / 60;
    const base = {
      moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
      dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false,
      meleePressed: false, rocketPressed: false, slamPressed: false, zoomHeld: false,
      zoomDelta: 0, blockHeld: false, switchPressed: false, pausePressed: false,
    };
    const pad = (over) => [{ ...base, ...over }, { ...base }, { ...base }, { ...base }];
    const at = new (p.position.constructor)();
    const to = new (p.position.constructor)();
    const centre = () => {
      const bones = p.char.rig?.bones;
      if (!bones) return null;
      const sum = new (p.position.constructor)();
      let m = 0;
      for (const [a, b, w] of mass) {
        bones[a].getWorldPosition(at);
        bones[b].getWorldPosition(to);
        sum.addScaledVector(at.add(to).multiplyScalar(0.5), w);
        m += w;
      }
      return sum.divideScalar(m);
    };
    // back on the ground and still, before anything is asked of her
    for (let i = 0; i < 600 && !p.grounded; i++) g.update(dt, pad({}));
    p.velocity.set(0, 0, 0);
    g.update(dt, pad({ jumpHeld: true, jumpPressed: true }));      // the leap
    const top = { y: p.position.y };
    for (let i = 0; i < climbFrames; i++) g.update(dt, pad({ jumpHeld: true }));
    top.y = p.position.y - top.y;
    g.update(dt, pad({}));                                          // and let go of it
    g.update(dt, pad({}));
    const out = { climbed: top.y, pitch: [], air: [], tucked: [], clips: new Set(), centres: [], frames: 0 };
    for (let i = 0; i < 900; i++) {
      // the first of these is the press that asks for the roll; the leap's own
      // press is the one that must never start one
      g.update(dt, pad({ jumpHeld: true, jumpPressed: i === 0 }));
      out.pitch.push(p.char.root.rotation.x);
      out.air.push(!p.grounded);
      out.tucked.push(p.tuckBlend > 0.9 && p.flipAngle > 0);
      if (anim.current?.lower) out.clips.add(anim.current.lower);
      const c = centre();
      out.centres.push(c ? [c.x, c.y, c.z] : null);
      if (p.grounded) { out.frames = i + 1; break; }
    }
    return { ...out, clips: [...out.clips] };
  }, [climbFrames, mass]);
}

// A flat hop, taken and asked to roll straight away: 10 m/s of leap against
// 26 m/s² is 0.77 s of air, and a whole revolution wants more than that.
const hop = await jumpAndRoll(0, MASS);
const hopTurn = Math.max(...hop.pitch) - Math.min(...hop.pitch);
console.log(`  flat hop: ${hop.frames} frames of air, pitch swept ${hopTurn.toFixed(2)} rad, legs ran ${hop.clips.join(',')}`);
check(hop.frames > 20, 'the flat hop does leave the ground');
check(!hop.clips.includes('tuckLower'), 'a hop with no room for a whole turn does not start one');
check(hopTurn < 1, '...and the body never leaves upright');

// The same jump with the climb held first, which is how an acrobat buys the
// height — and then the tuck held all the way down, so the roll has to give
// itself up in time to land on its feet.
const high = await jumpAndRoll(40, MASS);
const lastAir = high.pitch[high.air.lastIndexOf(true)];
const off = Math.abs(Math.atan2(Math.sin(lastAir), Math.cos(lastAir)));
console.log(`  held climb: ${high.climbed.toFixed(1)} m of rise, ${high.frames} frames of air, last airborne pitch ${lastAir.toFixed(2)} rad (${off.toFixed(2)} from upright), legs ran ${high.clips.join(',')}`);
check(high.clips.includes('tuckLower'), 'the height bought by the climb does buy the roll');
check(off < 0.3, '...and holding the tuck all the way down still lands her on her feet');

// ---- where the turn is centred ----
//
// Falling straight down, the body's weight should travel a straight line: the
// roll spins it, it does not carry it. Read only over the frames the tuck is
// fully on, so the pose blending into and out of it is not read as a swing.
const rolled = high.centres.filter((c, i) => c && high.tucked[i] && high.air[i]);
let drift = 0;
if (rolled.length > 20) {
  const mx = rolled.reduce((s, c) => s + c[0], 0) / rolled.length;
  const mz = rolled.reduce((s, c) => s + c[2], 0) / rolled.length;
  drift = Math.max(...rolled.map((c) => Math.hypot(c[0] - mx, c[2] - mz)));
}
console.log(`  mass centre wandered ${drift.toFixed(3)} m off its line over ${rolled.length} frames of tumble`);
check(rolled.length > 20, 'the body is on a rig, and rolled long enough to read');
// turning about the standing hips instead puts this at a quarter of a metre
check(drift < 0.06, 'the tumble turns about the body\'s weight, not a point behind it');

// ---- and a fighter who is not one ----
await h.page.reload({ waitUntil: 'networkidle' });
await startAs('din djarin');
const d = await tumble(45);
const dinTurn = Math.max(...d.held) - Math.min(...d.held);
console.log(`  ${d.name}: airFlip=${d.airFlip}, pitch swept ${dinTurn.toFixed(2)} rad, legs ran ${d.clipsHeld.join(',')}`);
check(d.airFlip === false, 'Din is not an acrobat');
check(dinTurn < 1, 'and holding jump in the air does not roll him');
check(!d.clipsHeld.includes('tuckLower'), '...nor put him in a tuck');

await h.close();
console.log(failures ? `\n${failures} failure(s)` : '\nthe somersault rolls and lands upright');
process.exit(failures ? 1 : 0);
