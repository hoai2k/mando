/**
 * Pilotable vehicles (PLAN.md §17), end to end in the real build:
 * spawn, the mount prompt, RB mounting, driving, ramming, being shot
 * down (rider thrown + explosion), dismounting back to a parked solid,
 * and the Trask skiff riding the water.
 *
 *   node tools/test-vehicles.mjs
 */
import { launch } from './harness.mjs';

const h = await launch();
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};

// ---- The Dune Sea: four rides declared ----
await h.page.evaluate(() => window.__startCoop(1, 'desert'));
await h.waitForPlaying();

const spawned = await h.page.evaluate(() => {
  const g = window.__game;
  return {
    n: g.vehicles.length,
    kinds: g.vehicles.map((v) => v.spec.kind).join(','),
    grounded: g.vehicles.every((v) => Number.isFinite(v.pos.y)),
  };
});
check('desert spawns 6 vehicles', spawned.n === 6, spawned.kinds);
check('vehicles sit on real ground', spawned.grounded);

// ---- walk up: prompt, then RB mounts ----
await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const p = g.players[0];
  p.position.set(v.pos.x + 1.8, v.pos.y + 0.4, v.pos.z);
  p.velocity.set(0, 0, 0);
});
await h.step(0.3);
const near = await h.page.evaluate(() => !!window.__game.players[0].nearVehicle);
check('mount prompt in range', near);
await h.step(1 / 60, { slamPressed: true });
const mounted = await h.page.evaluate(() => {
  const g = window.__game;
  const p = g.players[0];
  return { on: !!p.vehicle, rider: g.vehicles[0].rider === p };
});
check('RB mounts the swoop', mounted.on && mounted.rider);

// ---- drive: the accelerator, momentum, and the rider stays in the saddle ----
const start = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  // point the nose at open desert (the arena centre) so a throttle-open run
  // doesn't drive straight into the camp tents
  v.yaw = Math.atan2(-v.pos.x, -v.pos.z);
  g.players[0].cam.yaw = v.yaw;
  return { x: v.pos.x, z: v.pos.z, yaw: v.yaw };
});
await h.step(2, { moveY: 1 });
const drove = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const p = g.players[0];
  return {
    x: v.pos.x, z: v.pos.z,
    speed: Math.hypot(v.vel.x, v.vel.z),
    seatDrift: Math.hypot(p.position.x - v.pos.x, p.position.z - v.pos.z),
    hp: p.hp,
  };
});
const dist = Math.hypot(drove.x - start.x, drove.z - start.z);
check('2 s on the accelerator covers real ground', dist > 15, `${dist.toFixed(1)} m at ${drove.speed.toFixed(1)} m/s`);
check('rider stays on the seat', drove.seatDrift < 1.5, `${drove.seatDrift.toFixed(2)} m off`);

// ---- the brake hauls it up, and then backs it away ----
const braked = await h.page.evaluate(() => ({ speed: Math.hypot(window.__game.vehicles[0].vel.x, window.__game.vehicles[0].vel.z) }));
await h.step(1.2, { moveY: -1 });
const stopped = await h.page.evaluate(() => {
  const v = window.__game.vehicles[0];
  const fwd = v.vel.x * Math.sin(v.yaw) + v.vel.z * Math.cos(v.yaw);
  return { fwd };
});
check('the brake stops it', stopped.fwd < braked.speed * 0.35, `${braked.speed.toFixed(1)} -> ${stopped.fwd.toFixed(1)} m/s`);
await h.step(1.5, { moveY: -1 });
const reversing = await h.page.evaluate(() => {
  const v = window.__game.vehicles[0];
  return { fwd: v.vel.x * Math.sin(v.yaw) + v.vel.z * Math.cos(v.yaw) };
});
check('holding the brake reverses', reversing.fwd < -1.5, `${reversing.fwd.toFixed(1)} m/s astern`);

// ---- steering: the stick turns the nose, and right means right ----
const steered = await h.page.evaluate(async () => {
  const g = window.__game;
  const v = g.vehicles[0];
  v.yaw = 0;                                   // nose on +Z
  v.vel.set(0, 0, 12);
  return { before: v.yaw };
});
await h.step(1, { moveX: 1, moveY: 1 });
const turn = await h.page.evaluate(() => {
  const v = window.__game.vehicles[0];
  const nose = { x: Math.sin(v.yaw), z: Math.cos(v.yaw) };
  return { yaw: v.yaw, nose };
});
// screen-right is -X for a nose on +Z, so a stick pushed right must swing the
// nose toward -X (yaw decreasing) — the sign this scheme lives or dies on
check('stick right turns the nose right', turn.nose.x < -0.3 && turn.yaw < steered.before,
  `nose now (${turn.nose.x.toFixed(2)}, ${turn.nose.z.toFixed(2)})`);

// ---- ramming: a hostile in the path is bowled over and the ride chips ----
const ramBefore = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const e = g.enemies.find((en) => en.alive);
  v.yaw = 0;
  v.vel.set(0, 0, 16);
  e.position.set(v.pos.x, v.pos.y, v.pos.z + 5);
  return { eHp: e.hp, eZ: e.position.z, vHp: v.hp };
});
await h.step(0.5);
const ramAfter = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const e = g.enemies.find((en) => en.hp < en.maxHp) ?? g.enemies[0];
  return { eHp: e.hp, vHp: v.hp, eDown: e.hp < e.maxHp };
});
check('ram damages the hostile', ramAfter.eHp < ramBefore.eHp, `${ramBefore.eHp} -> ${ramAfter.eHp.toFixed(0)}`);
check('ram chips the ride', ramAfter.vHp < ramBefore.vHp, `${ramBefore.vHp} -> ${ramAfter.vHp}`);

// The three checks below read *held* state — a hop mid-arc, a raised shield,
// a rider's health the frame their ride went up — and the page's own render
// loop keeps stepping the match with nothing on the buttons between one
// evaluate and the next, which drops a damped value like the shield before it
// can be read. Drive the loop by hand until they are done.
await h.page.evaluate(() => { window.__manual = true; });

// ---- A hops the ride: a kick off the repulsors, not a way to travel ----
// Stop it and let the hover settle before measuring: the ram run above left
// it crossing dunes at 16 m/s, and the spring lags the ground under a moving
// ride — so "the height it was at" is only the height it rests at once it has
// stopped moving.
await h.page.evaluate(() => { window.__game.vehicles[0].vel.set(0, 0, 0); });
await h.step(0.6);
const hopFrom = await h.page.evaluate(() => ({ y: window.__game.vehicles[0].pos.y }));
await h.step(1 / 60, { jumpPressed: true, jumpHeld: true });
await h.step(0.3);
const hopping = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const p = g.players[0];
  return { y: v.pos.y, riderOver: p.position.y - v.pos.y };
});
check('A hops the ride off its ride height', hopping.y > hopFrom.y + 0.7,
  `+${(hopping.y - hopFrom.y).toFixed(2)} m`);
check('the rider goes up with it', Math.abs(hopping.riderOver) < 3.2,
  `${hopping.riderOver.toFixed(2)} m over the keel`);
await h.step(1.5);
const hopDone = await h.page.evaluate(() => ({ y: window.__game.vehicles[0].pos.y }));
check('and the repulsors catch it again', Math.abs(hopDone.y - hopFrom.y) < 0.3,
  `${hopDone.y.toFixed(2)} vs ${hopFrom.y.toFixed(2)}`);

// ---- B is the ride's deflector: it turns fire, and never a wall ----
await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const p = g.players[0];
  v.hp = v.maxHp;
  p.hp = p.maxHp;
  p.energy = 1;
  p.hitGuard = 0;
});
await h.step(0.4, { blockHeld: true });
const bubble = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const p = g.players[0];
  const out = { shielded: v.shielded, energy0: p.energy };
  let vHp = v.hp, pHp = p.hp;
  v.damage(60, v.pos, -1, 'shot');            // a bolt into the hull
  out.shotLost = vHp - v.hp; vHp = v.hp;
  p.damage(40, v.pos);                        // and a swing at the rider on top of it
  out.riderLost = pHp - p.hp;
  out.bleed = vHp - v.hp; vHp = v.hp;         // nothing bleeds into the hull either
  v.damage(50, v.pos, -1, 'crash');           // a wall is not an attack
  out.crashLost = vHp - v.hp;
  out.energy1 = p.energy;
  return out;
});
check('B raises the ride\'s deflector', bubble.shielded);
check('the bubble turns fire off the hull', bubble.shotLost === 0, `hull -${bubble.shotLost}`);
check('and off the rider on top of it', bubble.riderLost === 0 && bubble.bleed === 0,
  `rider -${bubble.riderLost}, hull -${bubble.bleed}`);
// billed in full: `crashScale` is applied by whatever crashed it (the wall
// path, the ride-on-ride path), so 50 of crash damage is 50 off the hull
check('a crash goes straight through it', bubble.crashLost === 50, `hull -${bubble.crashLost}`);
check('holding it burns the rider\'s gauge', bubble.energy1 < bubble.energy0 - 0.05,
  `${bubble.energy0.toFixed(2)} -> ${bubble.energy1.toFixed(2)}`);
// ramming is a collision, not an attack: the bubble does not make it free
const shieldRam = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const e = g.enemies.find((en) => en.alive);
  v.hp = v.maxHp;
  v.yaw = 0;
  v.vel.set(0, 0, 16);
  e.position.set(v.pos.x, v.pos.y, v.pos.z + 5);
  return { shielded: v.shielded, hp: v.hp, eHp: e.hp };
});
await h.step(0.5, { blockHeld: true });
const rammed = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const e = g.enemies.find((en) => en.hp < en.maxHp) ?? g.enemies[0];
  return { shielded: v.shielded, hp: v.hp, eHp: e.hp };
});
check('a shielded ride still bowls what is in front of it', rammed.eHp < shieldRam.eHp,
  `${shieldRam.eHp.toFixed(0)} -> ${rammed.eHp.toFixed(0)}`);
check('and still chips itself doing it', rammed.shielded && rammed.hp < shieldRam.hp,
  `hull -${(shieldRam.hp - rammed.hp).toFixed(0)} with the bubble up`);

// let go and the same bolt lands again
await h.step(0.4);
const lowered = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  v.hp = v.maxHp;                             // the crash above left it nearly out
  const hp = v.hp;
  v.damage(60, v.pos, -1, 'shot');
  return { shielded: v.shielded, lost: hp - v.hp };
});
check('lowered, the same bolt lands again', !lowered.shielded && lowered.lost > 0,
  `hull -${lowered.lost.toFixed(0)}`);

// ---- shot down: rider thrown, wreck explodes, and the ride comes back ----
// A wreck is not gone any more: it sits dead for RESPAWN_DELAY and then
// reforms where the board parked it, so a match cannot run out of rides.
const home = await h.page.evaluate(() => {
  const v = window.__game.vehicles[0];
  return { x: v.pos.x, z: v.pos.z, specX: v.spec.x, specZ: v.spec.z, hp: v.maxHp };
});
// Killed with the deflector up, deliberately: the bubble turns what is shot
// at you and never the wall, so a ride crashed until it detonates detonates
// around the person riding it whatever they are holding.
await h.step(0.4, { blockHeld: true });
const boom = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const p = g.players[0];
  p.hp = p.maxHp;
  const shielded = v.shielded;
  v.damage(2000, v.pos, -1, 'crash');
  return {
    shielded, vAlive: v.alive, thrown: !p.vehicle, vy: p.velocity.y,
    respawnIn: v.respawnIn, riderLost: p.maxHp - p.hp,
  };
});
check('destruction throws the rider clear', !boom.vAlive && boom.thrown && boom.vy > 4, `vy=${boom.vy.toFixed(1)}`);
check('a shielded ride still dies to a crash', boom.shielded && !boom.vAlive);
check('the wreck takes a piece of the rider with it', boom.riderLost > 12,
  `rider -${boom.riderLost.toFixed(0)}`);
check('the wreck is on a respawn clock', boom.respawnIn > 15 && boom.respawnIn <= 20,
  `${boom.respawnIn.toFixed(0)} s`);
await h.step(0.5);
const post = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const p = g.players[0];
  return { n: g.vehicles.length, alive: p.alive, hp: p.hp, vAlive: v.alive, targeted: false };
});
check('the wreck stays in the roster, dead', post.n === 6 && !post.vAlive, `${post.n} rides`);
// hurt, and hurt by the blast wave on top of the detonation itself — but a
// swoop is a bad landing, not an execution
check('rider survives the ejection, the worse for it', post.alive && post.hp < 85,
  `${post.hp.toFixed(0)}/100 hp`);
// a dead ride is not a target and not on the radar (both read `alive`)
await h.step(19.5);
const back = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  return {
    alive: v.alive, hp: v.hp, x: v.pos.x, z: v.pos.z, visible: v.group.visible,
    boxes: g.board.physics.boxes.length,
  };
});
check('the ride respawns after 20 s', back.alive && back.visible, `alive=${back.alive}`);
check('it comes back whole', back.hp === home.hp, `${back.hp}/${home.hp}`);
check('it comes back where the board parked it',
  Math.hypot(back.x - home.specX, back.z - home.specZ) < 0.5,
  `(${back.x.toFixed(1)}, ${back.z.toFixed(1)}) vs (${home.specX}, ${home.specZ})`);
await h.page.evaluate(() => { window.__manual = false; });

// ---- the rider is the one in the open, not the hull ----
await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const p = g.players[0];
  p.position.set(v.pos.x + 1.6, v.pos.y + 0.4, v.pos.z);
  p.velocity.set(0, 0, 0);
});
await h.step(0.2);
await h.step(1 / 60, { slamPressed: true });
const redirect = await h.page.evaluate(() => {
  const g = window.__game;
  const p = g.players[0];
  const v = p.vehicle;
  const pHp = p.hp, vHp = v.hp;
  p.damage(20, v.pos);
  return { on: !!p.vehicle, pLost: pHp - p.hp, vLost: vHp - v.hp };
});
check('a hit on the rider hurts the rider', redirect.pLost > 15,
  `player -${redirect.pLost.toFixed(0)}, hull -${redirect.vLost.toFixed(1)}`);
check('and only chips the ride under them', redirect.vLost > 0 && redirect.vLost < redirect.pLost * 0.5,
  `hull -${redirect.vLost.toFixed(1)}`);

// ---- RB again dismounts, and the ride parks solid again ----
const boxesBefore = await h.page.evaluate(() => window.__game.board.physics.boxes.length);
await h.step(1 / 60, { slamPressed: true });
const dismounted = await h.page.evaluate(() => {
  const g = window.__game;
  return { off: !g.players[0].vehicle, boxes: g.board.physics.boxes.length };
});
check('RB dismounts', dismounted.off);
check('parked ride is solid again', dismounted.boxes === boxesBefore + 1,
  `${boxesBefore} -> ${dismounted.boxes}`);

// ---- the bantha: a ride that is alive (PLAN.md §17) ----
// Everything above is a repulsor. A mount is the exception on every axis that
// matters: it walks a gait, X charges it, and your gun hand is free.
const banthaAt = await h.page.evaluate(() => {
  const g = window.__game;
  const i = g.vehicles.findIndex((v) => v.spec.kind === 'bantha');
  if (i < 0) return null;
  const v = g.vehicles[i];
  const p = g.players[0];
  p.position.set(v.pos.x + 2, v.pos.y + 0.4, v.pos.z);
  p.velocity.set(0, 0, 0);
  return { i, hp: v.hp, y: v.pos.y };
});
check('the camp keeps a saddled bantha', !!banthaAt, JSON.stringify(banthaAt));
await h.step(0.3);
await h.step(1 / 60, { slamPressed: true });
const onBantha = await h.page.evaluate((i) => {
  const g = window.__game;
  const p = g.players[0];
  const v = g.vehicles[i];
  // point it at open desert so the run does not walk into the camp
  v.yaw = Math.atan2(-v.pos.x, -v.pos.z);
  p.cam.yaw = v.yaw;
  return { on: p.vehicle === v, x: v.pos.x, z: v.pos.z, seatY: p.position.y - v.pos.y };
}, banthaAt.i);
check('RB mounts the bantha', onBantha.on, `seat ${onBantha.seatY.toFixed(2)} m over the keel`);
check('the rider sits above the beast, not inside it', onBantha.seatY > 1.2 && onBantha.seatY < 3.2,
  `${onBantha.seatY.toFixed(2)} m`);
await h.step(2, { moveY: 1 });
const walked = await h.page.evaluate(([i, x, z]) => {
  const g = window.__game;
  const v = g.vehicles[i];
  const p = g.players[0];
  return {
    dist: Math.hypot(v.pos.x - x, v.pos.z - z),
    speed: Math.hypot(v.vel.x, v.vel.z),
    seatDrift: Math.hypot(p.position.x - v.pos.x, p.position.z - v.pos.z),
  };
}, [banthaAt.i, onBantha.x, onBantha.z]);
// a bantha ambles: slower than every repulsor, but it does cover ground
check('the bantha walks under the throttle', walked.dist > 6 && walked.speed < 14,
  `${walked.dist.toFixed(1)} m at ${walked.speed.toFixed(1)} m/s`);
check('the rider stays in the saddle', walked.seatDrift < 1.5, `${walked.seatDrift.toFixed(2)} m off`);

// X: the charge runs it past its own top speed, and it costs a cooldown
const charged = await h.page.evaluate(async ([i]) => {
  const g = window.__game;
  const v = g.vehicles[i];
  const ready = v.chargeReady;
  return { ready, top: v.def.top };
}, [banthaAt.i]);
await h.step(1 / 60, { meleePressed: true });
await h.step(1.0, {});
const charging = await h.page.evaluate(([i]) => {
  const g = window.__game;
  const v = g.vehicles[i];
  return { charging: v.charging, speed: Math.hypot(v.vel.x, v.vel.z), ready: v.chargeReady };
}, [banthaAt.i]);
check('X charges the bantha', charged.ready && charging.charging && charging.speed > charged.top,
  `${charging.speed.toFixed(1)} m/s against a top of ${charged.top}`);
check('the charge goes on cooldown', !charging.ready);

// a trampled hostile takes far more from the horns than from a shoulder
const trample = await h.page.evaluate(([i]) => {
  const g = window.__game;
  const v = g.vehicles[i];
  const e = g.enemies.find((en) => en.alive);
  if (!e) return null;
  const sin = Math.sin(v.yaw), cos = Math.cos(v.yaw);
  e.position.set(v.pos.x + sin * 3.5, v.pos.y + 0.5, v.pos.z + cos * 3.5);
  return { hp: e.hp, id: g.enemies.indexOf(e) };
}, [banthaAt.i]);
await h.step(0.6);
const trampled = await h.page.evaluate(([id]) => {
  const e = window.__game.enemies[id];
  return { hp: e.hp, down: !e.alive || e.hp < e.maxHp };
}, [trample.id]);
check('the charge tramples what is in front of it', trampled.hp < trample.hp,
  `${trample.hp.toFixed(0)} -> ${trampled.hp.toFixed(0)}`);

// The gun hand is free on an animal: RT fires from the saddle. Read the
// evidence a shot leaves rather than the trigger's own frame — the page's
// live loop runs its own blank-input update between our stepped ones, so
// `aiming` is already back down by the time an evaluate can look at it.
const beforeShots = await h.page.evaluate(() => ({ heat: window.__game.players[0].heat }));
await h.step(0.6, { shootHeld: true, aimHeld: true });
const shots = await h.page.evaluate(([i]) => {
  const g = window.__game;
  const p = g.players[0];
  return {
    on: !!p.vehicle, heat: p.heat, weapon: p.weapon,
    pose: p.char.animator?.playing?.('upper') ?? null,
    kind: g.vehicles[i]?.spec.kind,
  };
}, [banthaAt.i]);
check('the blaster fires from the saddle of a mount',
  shots.on && shots.weapon === 'blaster' && shots.heat > beforeShots.heat,
  `heat ${beforeShots.heat.toFixed(2)} -> ${shots.heat.toFixed(2)} on the ${shots.kind}`);
check('the gun comes up in the saddle', shots.pose === 'aimUpper', `upper: ${shots.pose}`);

// dismount and leave the herd as we found it
await h.step(1 / 60, { slamPressed: true });
const offBantha = await h.page.evaluate(() => !window.__game.players[0].vehicle);
check('RB steps off the bantha', offBantha);

// ---- the rider dies at speed: the ride rolls on without them ----
const runaway = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles.find((r) => r.spec.kind === 'swoop' && r.alive);
  const p = g.players[0];
  // sit them on it, pointed at open desert, and give it real speed
  if (p.vehicle) p.vehicle.dropRider();
  v.mount(p);
  v.yaw = Math.atan2(-v.pos.x, -v.pos.z);
  const nose = { x: Math.sin(v.yaw), z: Math.cos(v.yaw) };
  v.vel.set(nose.x * 16, 0, nose.z * 16);
  p.cam.yaw = v.yaw;
  const i = g.vehicles.indexOf(v);
  p.damage(999, p.position);           // shot off the saddle
  return { i, on: !!p.vehicle, speed: Math.hypot(v.vel.x, v.vel.z), x: v.pos.x, z: v.pos.z };
});
check('a killed rider leaves the saddle', !runaway.on);
await h.step(0.5);
const rolling = await h.page.evaluate(([i, x, z]) => {
  const v = window.__game.vehicles[i];
  return {
    speed: Math.hypot(v.vel.x, v.vel.z),
    travelled: Math.hypot(v.pos.x - x, v.pos.z - z),
    rider: !!v.rider,
  };
}, [runaway.i, runaway.x, runaway.z]);
check('the ride keeps going with nobody on it', !rolling.rider && rolling.travelled > 3,
  `${rolling.travelled.toFixed(1)} m at ${rolling.speed.toFixed(1)} m/s`);
await h.step(6);
const settled = await h.page.evaluate(([i]) => {
  const g = window.__game;
  const v = g.vehicles[i];
  return { speed: Math.hypot(v.vel.x, v.vel.z), solid: g.board.physics.boxes.some((b) => b === v.parkedBox) };
}, [runaway.i]);
check('it rolls to a stop and parks solid again', settled.speed < 1 && settled.solid,
  `${settled.speed.toFixed(2)} m/s`);

// ---- the damage model: plate shrugs off bolts and hates walls ----
// A big ride is broken by crashing it, a small one by shooting it — and both
// still take a little of the other.
const model = await h.page.evaluate(() => {
  const g = window.__game;
  const skiff = g.vehicles.find((v) => v.spec.kind === 'skiff');
  const bike = g.vehicles.find((v) => v.spec.kind === 'swoop');
  const read = (v, kind) => {
    const before = v.hp;
    v.damage(100, v.pos, -1, kind);
    const lost = before - v.hp;
    v.hp = v.maxHp;
    return lost;
  };
  return {
    skiffShot: read(skiff, 'shot'), skiffCrash: read(skiff, 'crash'),
    bikeShot: read(bike, 'shot'), bikeCrash: read(bike, 'crash'),
    skiffHp: skiff.maxHp, bikeHp: bike.maxHp,
  };
});
check('a bolt barely marks the heavy hull', model.skiffShot < model.skiffCrash * 0.4,
  `skiff: ${model.skiffShot.toFixed(0)} from a shot vs ${model.skiffCrash.toFixed(0)} from a crash`);
check('but it is never immune to being shot', model.skiffShot > 0, `${model.skiffShot.toFixed(0)}`);
check('the small ride feels a bolt in full', model.bikeShot >= 100,
  `swoop: ${model.bikeShot.toFixed(0)}`);
check('and dies to far fewer of them', model.bikeHp / model.bikeShot < model.skiffHp / model.skiffShot,
  `${(model.bikeHp / model.bikeShot).toFixed(0)} bolts vs ${(model.skiffHp / model.skiffShot).toFixed(0)}`);

// ---- two rides meeting: the light one wears it ----
const smash = await h.page.evaluate(() => {
  const g = window.__game;
  const skiff = g.vehicles.find((v) => v.spec.kind === 'skiff' && v.alive);
  const bike = g.vehicles.find((v) => v.spec.kind === 'swoop' && v.alive);
  // put the swoop just off the skiff's flank, running at it
  bike.pos.set(skiff.pos.x + 6, skiff.pos.y, skiff.pos.z);
  bike.yaw = -Math.PI / 2;
  bike.vel.set(-20, 0, 0);
  bike.coasting = true;
  skiff.hp = skiff.maxHp;
  bike.hp = bike.maxHp;
  return { bikeHp: bike.hp, skiffHp: skiff.hp, i: g.vehicles.indexOf(bike), j: g.vehicles.indexOf(skiff) };
});
await h.step(0.6);
const smashed = await h.page.evaluate(([i, j]) => {
  const g = window.__game;
  return {
    bikeHp: g.vehicles[i].hp, skiffHp: g.vehicles[j].hp,
    bikeMax: g.vehicles[i].maxHp, skiffMax: g.vehicles[j].maxHp,
  };
}, [smash.i, smash.j]);
const bikeLost = smash.bikeHp - smashed.bikeHp, skiffLost = smash.skiffHp - smashed.skiffHp;
check('ride-on-ride crash bills both sides', bikeLost > 0 && skiffLost > 0,
  `swoop -${bikeLost.toFixed(0)}, skiff -${skiffLost.toFixed(0)}`);
// worse in the only sense that matters when the hulls are 180 and 600: the
// share of itself each one lost
const bikeShare = bikeLost / smashed.bikeMax, skiffShare = skiffLost / smashed.skiffMax;
check('and the light one comes off far worse', bikeShare > skiffShare * 3,
  `swoop -${(bikeShare * 100).toFixed(0)}% vs skiff -${(skiffShare * 100).toFixed(0)}%`);

// ---- a bantha dies as an animal, then reforms ----
const beast = await h.page.evaluate(() => {
  const g = window.__game;
  const i = g.vehicles.findIndex((v) => v.spec.kind === 'bantha');
  const v = g.vehicles[i];
  v.hp = v.maxHp;
  v.damage(2000, v.pos, -1);
  return {
    i, alive: v.alive, boom: !!v.pendingExplosion, collapse: !!v.pendingCollapse,
    visible: v.group.visible, respawnIn: v.respawnIn, x: v.spec.x, z: v.spec.z,
  };
});
check('a mount dies without a fireball', !beast.alive && !beast.boom && beast.collapse);
check('and comes apart where it stood rather than vanishing', beast.visible);
await h.step(2);
const gone = await h.page.evaluate(([i]) => {
  const v = window.__game.vehicles[i];
  return { visible: v.group.visible, alive: v.alive };
}, [beast.i]);
check('the body disintegrates', !gone.visible && !gone.alive);
await h.step(18.5);
const reformed = await h.page.evaluate(([i]) => {
  const v = window.__game.vehicles[i];
  return { alive: v.alive, hp: v.hp, visible: v.group.visible, x: v.pos.x, z: v.pos.z };
}, [beast.i]);
check('the herd reforms on the same clock as the machines',
  reformed.alive && reformed.visible && Math.hypot(reformed.x - beast.x, reformed.z - beast.z) < 0.5,
  `back at (${reformed.x.toFixed(1)}, ${reformed.z.toFixed(1)})`);

// ---- Trask: the skiff rides the water ----
// Restarting from a running match: the old game's 'playing' state satisfies
// waitForPlaying before the new board exists, so wait for Trask itself.
await h.page.evaluate(() => window.__startCoop(1, 'trask'));
for (let i = 0; i < 200; i++) {
  const there = await h.page.evaluate(() =>
    window.__game?.board.kind === 'trask' && window.__state === 'playing');
  if (there) break;
  await new Promise((r) => setTimeout(r, 250));
}
const skiff = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const p = g.players[0];
  p.position.set(v.pos.x + 2.2, v.pos.y + 0.4, v.pos.z);
  p.velocity.set(0, 0, 0);
  return { kind: v.spec.kind, y: v.pos.y };
});
check('trask spawns the skiff on the surface', skiff.kind === 'skiff' && skiff.y > 0.5 && skiff.y < 1.6, `y=${skiff.y.toFixed(2)}`);
await h.step(0.3);
const trMount = await h.page.evaluate(() => {
  const g = window.__game;
  const p = g.players[0];
  const v = g.vehicles[0];
  return {
    near: !!p.nearVehicle, alive: p.alive,
    d: Math.hypot(p.position.x - v.pos.x, p.position.z - v.pos.z).toFixed(2),
    py: p.position.y.toFixed(2),
  };
});
await h.step(1 / 60, { slamPressed: true });
const trOn = await h.page.evaluate(() => !!window.__game.players[0].vehicle);
check('skiff mounts', trOn, JSON.stringify(trMount));
// steer down the open channel between the dock fingers
await h.page.evaluate(() => {
  const g = window.__game;
  g.vehicles[0].yaw = Math.PI;              // point down the channel
  g.players[0].cam.yaw = Math.PI;
});
await h.step(3, { moveY: 1 });
const sail = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const p = g.players[0];
  return {
    on: !!p.vehicle, y: v.pos.y, hp: p.hp, speed: Math.hypot(v.vel.x, v.vel.z),
    dist: Math.abs(v.pos.z - 8),
  };
});
// distance, not instantaneous speed: three seconds is enough to sail the
// channel and fetch up against the moored trawler, speed back at zero
check('skiff sails the channel without sinking or biting', sail.on && sail.y > 0.4 && sail.hp > 60 && sail.dist > 10,
  `${sail.dist.toFixed(1)} m at y=${sail.y.toFixed(2)}, rider hp=${sail.hp.toFixed(0)}`);

// ---- reachability: a wave run can actually get to a ride ----
// Every territory that declares vehicles must park at least one within a
// walk of where the party lands. The Forge and the Ringworld each used to
// have exactly one, at the far end of the board (146 m and 136 m from the
// start), which in a wave run meant the ride existed but was never reached.
// Half the radar's 120 m sweep: a ride at that distance is not just walkable,
// it is already on the dial when the party lands, which is what makes taking
// it a decision rather than a lucky find.
const REACH = 60;
const waveBoards = await h.page.evaluate(() =>
  window.__boards.map((b) => b.id));

const settle = async (id) => {
  for (let i = 0; i < 400; i++) {
    const ok = await h.page.evaluate((b) =>
      window.__game?.board.kind === b && window.__state === 'playing', id);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

for (const id of waveBoards) {
  await h.page.evaluate((b) => window.__startMode('wave', 1, b), id);
  if (!await settle(id)) { check(`${id} boots in wave mode`, false); continue; }
  const r = await h.page.evaluate(() => {
    const g = window.__game;
    const p = g.players[0];
    return {
      declared: (g.board.vehicles ?? []).length,
      spawned: g.vehicles.length,
      nearest: g.vehicles.length
        ? Math.min(...g.vehicles.map((v) =>
            Math.hypot(v.pos.x - p.position.x, v.pos.z - p.position.z)))
        : Infinity,
      // NB: no automated "is there standing room beside it" check here. A
      // parked ride registers its own collider, and from outside the class
      // there is no way to test the ground around it without that collider
      // answering first — which reports even the swoop this suite mounts
      // above as unreachable. The end-to-end mounts (desert swoop, trask
      // skiff) are the real coverage; audit-collision.mjs covers scenery.
    };
  });
  check(`${id}: every declared ride spawns`, r.spawned === r.declared,
    `${r.spawned}/${r.declared}`);
  if (!r.declared) continue;
  check(`${id}: a ride is within ${REACH} m of the wave start`, r.nearest <= REACH,
    `nearest ${r.nearest.toFixed(1)} m`);
}

// ---- Missions parks its own rides, on the stage the party is standing on ----
// This used to check that Missions spawned *no* rides at all: every mission
// level was a plate raised ninety metres over the territory, so the board's
// own parked rides were unreachable down below and spawning them was waste.
// Missions parks rides per zone now, and a stage may stand on the territory's
// own ground, so the rule is no longer "none" but "the stage's own, on the
// stage" — a ride you cannot walk to is still the thing being guarded against.
await h.page.evaluate(() => window.__startMode('campaign', 1, 'desert'));
await settle('desert');
const mission = await h.page.evaluate(() => {
  const g = window.__game;
  const stage = g.campaign?.stage;
  if (!stage) return { noStage: true };
  const off = g.vehicles.filter((v) => !stage.contains(v.pos.x, v.pos.z)).length;
  const sunk = g.vehicles.filter((v) =>
    Math.abs(v.pos.y - stage.groundAt(v.pos.x, v.pos.z)) > 3).length;
  return {
    n: g.vehicles.length,
    want: stage.rides.length,
    off,
    sunk,
    floorY: +stage.floorY.toFixed(1),
  };
});
check('missions parks the rides its stage declares',
  !mission.noStage && mission.n === mission.want,
  `${mission.n} spawned, ${mission.want} declared by the stage`);
check('and every one of them is standing on it',
  !mission.noStage && mission.off === 0 && mission.sunk === 0,
  `${mission.off} off the stage, ${mission.sunk} not on its ground (floor y=${mission.floorY})`);

const bad = h.errors.length;
console.log('page errors:', bad ? h.errors.slice(0, 3) : 'none');
await h.close();
process.exit(failed || bad ? 1 : 0);
