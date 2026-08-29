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
check('desert spawns 4 vehicles', spawned.n === 4, spawned.kinds);
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

// ---- drive: momentum, and the rider stays in the saddle ----
const start = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  // aim the camera at open desert (the arena centre) so throttle-forward
  // doesn't drive straight into the camp tents
  g.players[0].cam.yaw = Math.atan2(-v.pos.x, -v.pos.z);
  return { x: v.pos.x, z: v.pos.z };
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
check('2 s of throttle covers real ground', dist > 15, `${dist.toFixed(1)} m at ${drove.speed.toFixed(1)} m/s`);
check('rider stays on the seat', drove.seatDrift < 1.5, `${drove.seatDrift.toFixed(2)} m off`);

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

// ---- shot down: rider thrown, wreck explodes and is removed ----
const boom = await h.page.evaluate(() => {
  const g = window.__game;
  const v = g.vehicles[0];
  const p = g.players[0];
  v.damage(500, v.pos, -1);
  return { vAlive: v.alive, thrown: !p.vehicle, vy: p.velocity.y };
});
check('destruction throws the rider clear', !boom.vAlive && boom.thrown && boom.vy > 4, `vy=${boom.vy.toFixed(1)}`);
await h.step(0.5);
const post = await h.page.evaluate(() => {
  const g = window.__game;
  return { n: g.vehicles.length, alive: g.players[0].alive };
});
check('wreck removed after the blast', post.n === 3);
check('rider survives the ejection', post.alive);

// ---- redirect: hits on a mounted rider land on the hull ----
await h.step(1.5); // let the throw land
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
  return { on: !!p.vehicle || v.hp < vHp, pLost: pHp - p.hp, vLost: vHp - v.hp };
});
check('rider damage lands on the hull', redirect.pLost === 0 && redirect.vLost === 20,
  `player -${redirect.pLost}, hull -${redirect.vLost}`);

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
await h.page.evaluate(() => { window.__game.players[0].cam.yaw = Math.PI; });
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

const bad = h.errors.length;
console.log('page errors:', bad ? h.errors.slice(0, 3) : 'none');
await h.close();
process.exit(failed || bad ? 1 : 0);
