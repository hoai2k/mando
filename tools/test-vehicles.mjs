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
await h.step(2, { throttleHeld: true });
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
await h.step(1.2, { brakeHeld: true });
const stopped = await h.page.evaluate(() => {
  const v = window.__game.vehicles[0];
  const fwd = v.vel.x * Math.sin(v.yaw) + v.vel.z * Math.cos(v.yaw);
  return { fwd };
});
check('the brake stops it', stopped.fwd < braked.speed * 0.35, `${braked.speed.toFixed(1)} -> ${stopped.fwd.toFixed(1)} m/s`);
await h.step(1.5, { brakeHeld: true });
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
await h.step(1, { moveX: 1, throttleHeld: true });
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
check('wreck removed after the blast', post.n === 5);
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
await h.step(2, { throttleHeld: true });
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
await h.step(3, { throttleHeld: true });
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

// ---- Missions runs on a level 90 m up: no ground rides down below ----
await h.page.evaluate(() => window.__startMode('campaign', 1, 'desert'));
await settle('desert');
const mission = await h.page.evaluate(() => {
  const g = window.__game;
  return {
    n: g.vehicles.length,
    declared: (g.board.vehicles ?? []).length,
    floorY: g.campaign?.level.floorY ?? null,
  };
});
check('missions spawns no unreachable ground rides', mission.n === 0,
  `${mission.n} spawned, ${mission.declared} declared on the territory, floor at y=${mission.floorY}`);

const bad = h.errors.length;
console.log('page errors:', bad ? h.errors.slice(0, 3) : 'none');
await h.close();
process.exit(failed || bad ? 1 : 0);
