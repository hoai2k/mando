/**
 * Guard coverage: what a raised shield and a working pair of blades actually
 * turn.
 *
 * Both of these were reported as "some attacks get through", and both were
 * real and measurable. The blades used to answer only a ±69° cone and to spend
 * a gauge that emptied after about twenty bolts, so sustained fire from
 * straight ahead started landing while the character was visibly parrying.
 * IG-11's field was a forward pane like everyone else's, so anything behind
 * the droid ignored it.
 *
 * The test fires single bolts from chosen bearings and asks whether the
 * player's health moved. Nothing here is about damage numbers: a bolt either
 * reached the body or it did not.
 *
 * Run:  node tools/test-block.mjs
 */
import { launch } from './harness.mjs';

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}: ${JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};

const h = await launch();
const { page } = h;
await h.waitForText(/WAVE BATTLE|PRESS START/i);

/**
 * Drive one fighter in an empty desert and report, per bearing, whether a bolt
 * fired from there reached them.
 *
 * `spam` keeps the melee button going (the blades stay out and swinging, which
 * is what a player does); `block` holds the shield up instead.
 */
const PROBE = `(spec) => {
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  const g = window.__game;
  const p = g.players[0];
  let frame = 0;
  const step = () => {
    const inputs = [blank(), blank(), blank(), blank()];
    if (spec.spam && frame % 6 === 0) inputs[0].meleePressed = true;
    if (spec.block) {
      inputs[0].blockHeld = true;
      // The pane runs off the sprint gauge and empties in five seconds by
      // design; this probe is minutes long, so the gauge is topped back up.
      // What is under test here is which bearings the field answers, not how
      // long a fighter can hold it.
      p.energy = 1;
    }
    frame++;
    g.update(1/60, inputs);
  };
  // settle: blades drawn, or the pane all the way up
  for (let i = 0; i < 60; i++) step();
  // an empty field — nothing else may touch the health we are watching
  for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
  p.hp = p.maxHp = 100000;

  const fireFrom = (bearingDeg) => {
    const a = (bearingDeg * Math.PI) / 180;
    const yaw = p.facingYaw;
    const origin = p.position.clone();
    origin.x += Math.sin(yaw + a) * 12;
    origin.z += Math.cos(yaw + a) * 12;
    origin.y += 0.9;
    const aim = p.position.clone();
    aim.y += 0.9;
    g.projectiles.fire(origin, aim.sub(origin).normalize(), 70, 7, 1, -1);
  };
  const landed = (bearingDeg) => {
    const before = p.hp;
    fireFrom(bearingDeg);
    for (let i = 0; i < 40; i++) step();
    const hit = p.hp < before;
    p.hp = 100000;
    return hit;
  };

  const byBearing = {};
  for (const b of spec.bearings) byBearing[b] = landed(b);
  // and a burst from dead ahead, which is what empties a gauge
  let through = 0;
  for (let n = 0; n < 40; n++) {
    const before = p.hp;
    fireFrom(0);
    for (let i = 0; i < 12; i++) step();
    if (p.hp < before) through++;
    p.hp = 100000;
  }
  return { byBearing, sustainedThrough: through, energy: +p.energy.toFixed(2),
    guard: spec.spam ? p.sabersDrawn : p.blocking };
}`;

async function probe(id, spec) {
  await page.evaluate((who) => {
    window.__manual = false;
    window.__quitToTitle?.();
    window.__startMode('wave', 1, 'desert', [who]);
  }, id);
  await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
  // A fighter is born as a procedural stand-in and its authored model arrives
  // on a network round trip, bringing its OWN clip durations with it. The
  // blades' free parry is keyed on `meleeTimer > 0`, so a swing rhythm that
  // changes mid-probe changes which bolts arrive inside a live swing — which
  // is how this passes on a fast machine and drops a handful of bolts on a
  // slow one (nightly run 199: five of forty through). Wait for the skin
  // before measuring, the same rule the model intake documents.
  await page.waitForFunction(() => {
    const g = window.__game;
    if (!g || !g.players.length) return false;
    let skinned = false;
    g.players[0].char.root.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
    return skinned;
  }, null, { timeout: 60000 });
  await page.evaluate(() => { window.__manual = true; });
  const out = await page.evaluate(`(${PROBE})(${JSON.stringify(spec)})`);
  // leaving manual stepping on wedges the next startMode: it never reaches
  // 'playing' because nothing is driving the loop
  await page.evaluate(() => { window.__manual = false; });
  return out;
}

// ---- the blades: a swing turns fire from anywhere but behind, and never tires
const front = [0, 45, 70, 90];
const behind = [135, 180];
const v = await probe('ventress', { spam: true, bearings: [...front, ...behind] });
check('sabers are out while X is spammed', v.guard === true, v.guard);
check('blades turn fire across the whole front',
  front.every((b) => v.byBearing[b] === false), v.byBearing);
check('a shot from behind still lands',
  behind.every((b) => v.byBearing[b] === true), v.byBearing);
check('sustained fire is turned, not just the first twenty',
  v.sustainedThrough === 0, { through: v.sustainedThrough, energy: v.energy });

// ---- IG-11: the field closes, so no bearing gets through
const ig = await probe('ig11', { block: true, bearings: [...front, ...behind] });
check('IG-11 has the shield up', ig.guard === true, ig.guard);
check('IG-11 turns fire from every bearing',
  [...front, ...behind].every((b) => ig.byBearing[b] === false), ig.byBearing);

// ---- and a forward pane is still a forward pane for everyone else
const din = await probe('din', { block: true, bearings: [0, 180] });
check('a forward pane covers the front', din.byBearing[0] === false, din.byBearing);
check('a forward pane leaves the back open', din.byBearing[180] === true, din.byBearing);

await h.close();
console.log(failures.length ? `\nFAILED: ${failures.join(', ')}` : '\nall block checks passed');
process.exit(failures.length ? 1 : 0);
