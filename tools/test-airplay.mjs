/**
 * Air-combat and skyline-halo regression test.
 *
 * Two things this covers, both reported from play as "I can't see them" and
 * "I can't fight from up there":
 *
 *  1. **Fighting while airborne.** Shooting, aiming and blocking are meant to
 *     work off the ground exactly as they do on it — and aiming with the
 *     jetpack off puts the boosters under you, so you sink slowly enough to
 *     line a shot up instead of falling at 18 m/s. It costs fuel, and an
 *     empty tank does not glide.
 *  2. **Skyline halos** (src/fx/skyline.ts). A flier the same tone as the sky
 *     behind it gets a faint rim of the opposite tone; a flier that already
 *     contrasts gets nothing, and nobody standing on the ground gets one.
 *
 * The simulation is stepped directly at a fixed dt: software rendering runs a
 * frame a second here, and a one-second fall would otherwise be unmeasurable.
 *
 * Run:  node tools/test-airplay.mjs
 */
import { launch } from './harness.mjs';

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}: ${JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
}

/** blank input, a stepper, and a way to put the player in the air */
const RIG = `
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, switchPressed:false, pausePressed:false });
  const g = window.__game;
  const p = g.players[0];
  const step = (n, over) => {
    const ins = [{ ...blank(), ...over }, blank(), blank(), blank()];
    for (let i = 0; i < n; i++) g.update(1/30, ins);
  };
  // the deck the player started on — the station and the Ringworld are
  // platform boards with no heightfield to ask
  const baseY = p.position.y;
  const lift = () => {
    p.position.y = baseY + 40;
    p.velocity.set(0, 0, 0);
    p.grounded = false;
    p.fuel = 1;
  };
`;

const h = await launch();
await h.waitForText(/WAVE BATTLE|PRESS START/i);

// ---- 1. fighting in the air ----
await h.startCoop(1, 'desert');
const air = await h.page.evaluate(`(() => {
  ${RIG}
  const out = {};
  const countShots = (n, over) => {
    let shots = 0;
    const fire = g.projectiles.fire.bind(g.projectiles);
    g.projectiles.fire = (...a) => { shots++; return fire(...a); };
    step(n, over);
    g.projectiles.fire = fire;
    return shots;
  };
  lift();
  out.airShots = countShots(45, { shootHeld: true });
  p.position.y = baseY;
  p.velocity.set(0, 0, 0);
  step(6, {});
  out.groundShots = countShots(45, { shootHeld: true });
  lift();
  step(20, { blockHeld: true });
  out.airBlocking = p.blocking;
  // the fall, aimed and not
  const fall = (over) => {
    lift();
    step(20, over);                       // let it settle into whatever it does
    const y0 = p.position.y, f0 = p.fuel;
    step(30, over);
    return { drop: +(y0 - p.position.y).toFixed(2), fuel: +(f0 - p.fuel).toFixed(2), gliding: p.gliding };
  };
  out.plain = fall({});
  out.aimed = fall({ aimHeld: true });
  lift();
  out.glideShots = countShots(45, { aimHeld: true, shootHeld: true });
  lift();
  p.fuel = 0;
  step(25, { aimHeld: true });
  out.dry = { gliding: p.gliding, speed: +p.velocity.y.toFixed(1) };
  return out;
})()`);
check('shooting works the same in the air as on the ground',
  air.airShots > 0 && air.airShots === air.groundShots, air);
check('the shield raises in the air', air.airBlocking, air.airBlocking);
check('aiming on the way down catches the fall',
  air.aimed.gliding && air.aimed.drop < air.plain.drop * 0.25, { plain: air.plain, aimed: air.aimed });
check('...on fuel, and still firing', air.aimed.fuel > 0.05 && air.glideShots === air.airShots,
  { fuel: air.aimed.fuel, shots: air.glideShots });
check('...and an empty tank falls like a stone',
  !air.dry.gliding && air.dry.speed < -8, air.dry);

// ---- 2. skyline halos ----
// the desert is a light sky, the station a dark one; a dark trooper needs a
// rim on the second and nothing on the first
for (const [board, wantHalo] of [['station', true], ['desert', false]]) {
  await h.startCoop(1, board);
  const r = await h.page.evaluate(`(async () => {
    ${RIG}
    for (const e of g.enemies) e.removeMe = true;
    // beside the player, so the "on the ground" phase is genuinely standing on
    // something: three metres out on the station is still deck, where sixteen
    // is open space — and a body over the abyss is skylined, quite rightly
    const spot = p.position.clone();
    spot.x += 3;
    const e = g.addReinforcement('darktrooper', spot);
    const halo = () => { let s = null; e.char.root.traverse((o) => { if (o.isSprite) s = o; }); return s; };
    // on the deck first: nobody standing on the ground is skylined
    for (let i = 0; i < 40; i++) {
      e.position.set(spot.x, baseY, spot.z);
      e.velocity.set(0, 0, 0);
      step(1, {});
      if (i % 5 === 0) await new Promise((r) => setTimeout(r));
    }
    const grounded = halo() ? +halo().material.opacity.toFixed(3) : 0;
    // then well above it
    for (let i = 0; i < 130; i++) {
      e.position.set(spot.x, p.position.y + 20, spot.z);
      e.velocity.set(0, 0, 0);
      step(1, {});
      if (i % 4 === 0) await new Promise((r) => setTimeout(r));
    }
    const s = halo();
    return { grounded, aloft: s ? +s.material.opacity.toFixed(3) : 0, additive: s ? s.material.blending === 2 : null };
  })()`);
  check(`${board}: nobody on the ground is haloed`, r.grounded < 0.02, r);
  if (wantHalo) {
    check(`${board}: a dark flier over a dark sky gets a faint light rim`,
      r.aloft > 0.1 && r.aloft <= 0.4 && r.additive === true, r);
  } else {
    check(`${board}: a dark flier over a light sky is left alone`, r.aloft < 0.02, r);
  }
}

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
if (failures.length || h.errors.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nair combat and skyline halos: all checks passed');
