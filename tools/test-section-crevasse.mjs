/**
 * The Crevasse's two sections, mechanic by mechanic
 * (docs/SECTIONS_IMPLEMENTATION.md §2.5): the K7 slide on the Glacier Chute
 * and the K9 darkness in Lamplight.
 *
 * test-sections proves the autopilot can get through each section; this
 * proves the verbs do what the design says they do — the ice pulls you down
 * the fall line, pulling back checks the speed, the stick carves, the walls
 * hold, a swing from the slide lands, a crevasse and the avalanche put you forward and not
 * back; the lamp lights what it points at, the brood shies from it until it
 * is bold, a focused beam dazzles, a flare drives them off, a brazier is a
 * pool they will not enter and three of them open the way.
 *
 * Run:  node tools/test-section-crevasse.mjs
 */
import { launch, blankInput, makeCheck } from './harness.mjs';

const check = makeCheck();
const PORT = process.env.HARNESS_PORT ?? '4173';
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;

async function boot(id, chars = ['din']) {
  await page.goto(`http://localhost:${PORT}/?section=${id}`);
  await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
  await h.startStepped('campaign', chars.length, 'crevasse', chars);
  // through the arrival veil, so the section is ticking
  await page.evaluate(async (blank) => {
    const g = window.__game;
    for (let f = 0; f < 150; f++) {
      g.update(1 / 30, g.players.map(() => blank));
    }
  }, blankInput());
}

// ---------------------------------------------------------------- the chute
console.log('\n-- the Glacier Chute: the slide');
await boot('glacier-chute', ['din', 'maul']);
const chute = await page.evaluate(async (blank) => {
  const g = window.__game, s = g.campaign.section, kit = s.kit, p = g.players[0];
  const step = (n, inp = {}) => { for (let i = 0; i < n; i++) g.update(1 / 30, [{ ...blank, ...inp }, ...g.players.slice(1).map(() => blank)]); };
  const out = {};
  const speed = () => Math.hypot(p.velocity.x, p.velocity.z);
  const put = (x, z, vz = 0) => {
    p.position.set(x, kit.surface(x, z) + 0.05, z);
    p.velocity.set(0, 0, vz);
    p.cam.yaw = 0;
  };
  // walk on until the floor goes
  p.cam.yaw = 0;
  for (let i = 0; i < 300 && !s.debug().collapsed; i++) step(1, { moveY: 1 });
  out.collapsed = s.debug().collapsed;
  // hold everyone well clear of the avalanche for the rest of this
  kit.front.resetTo(-400, 999);

  // 1. the pull: from rest on the first pitch, hands off
  put(0, 60);
  step(90);
  out.pulled = speed();
  out.pulledZ = p.position.z;

  // 2. the dig: the same start, pulling back the whole way
  put(0, 60);
  step(90, { moveY: -1 });
  out.dug = speed();

  // 3. the carve: at speed, stick right for a second turns the heading right (−x)
  put(0, 60, 16);
  step(4);
  const x0 = p.position.x;
  step(20, { moveX: 1 });
  out.carveDx = p.position.x - x0;
  out.carveSpeed = speed();

  // 4. the wall: stick hard over for four seconds, and still in the channel
  put(0, 160, 18);
  let outside = 0;
  for (let i = 0; i < 120; i++) {
    step(1, { moveX: -1 });
    if (!s.contains(p.position.x, p.position.z)) outside++;
  }
  out.wallOutside = outside;
  const lane = kit.laneAt(p.position.x, p.position.z);
  out.wallSide = lane ? Math.abs(lane.side) - (lane.s.half + lane.s.bank) : 99;

  // 5. melee from the slide: a spider in the lane, a press of melee — the
  // fighter's own swing, thrown from the ride (tools/test-glacier-slide.mjs
  // has the rest of it)
  put(0, 170, 12);
  step(1);      // x 0 is up the bank here: let the wall put the body back in the lane first
  const e = g.enemies.find((q) => q.alive && q.kind === 'krykna');
  out.hadSpider = !!e;
  if (e) {
    e.position.set(p.position.x, p.position.y, p.position.z + 1.8);
    e.velocity.set(0, 0, 0);
    const hp = e.hp;
    step(1, { meleePressed: true });
    step(14);
    out.kickHurt = hp - e.hp;
    out.kickDown = e.downed || !e.alive;
  }

  // 6. down a crevasse: out at the next gate, forward
  const crev = kit.crevasses[0];
  put(0, crev.z + crev.w / 2 - 0.5);
  p.position.y -= 3;
  p.velocity.set(0, -6, 0);
  step(20);
  out.crevZ = p.position.z;
  out.crevGate = kit.gates.find((z) => z > crev.z);
  out.crevAlive = p.alive;

  // 7. the avalanche: caught, and dug out ahead of it
  put(0, 250);
  kit.front.resetTo(248, 0);
  step(3);
  out.avZ = p.position.z;
  out.avFront = kit.front.at;
  kit.front.resetTo(-400, 999);

  // 8. the finish: a fallen teammate does not hold the party in the snowbank,
  // but a living one still sliding does
  const q = g.players[1];
  const inSnow = (pl) => { const z = kit.Z_SNOW + 12; pl.position.set(0, kit.surface(0, z) + 0.05, z); pl.velocity.set(0, 0, 0); };
  inSnow(p);
  q.position.set(0, kit.surface(0, 600) + 0.05, 600);
  step(10);
  out.soloFinish = s.complete;
  q.damage(9999, q.position);
  inSnow(p);
  step(3);
  out.deadFinish = s.complete;
  return out;
}, blankInput());

check('walking on, the floor gives way', chute.collapsed);
check('the ice pulls a body down the fall line from rest', chute.pulled > 11 && chute.pulledZ > 75,
  `${chute.pulled.toFixed(1)} m/s after 3 s, z ${chute.pulledZ.toFixed(0)}`);
check('pulling back digs in: slower, but not stopped', chute.dug < chute.pulled * 0.8 && chute.dug > 3,
  `${chute.dug.toFixed(1)} vs ${chute.pulled.toFixed(1)} m/s`);
check('the stick carves the heading (right is −x going downhill) and keeps the speed',
  chute.carveDx < -1.5 && chute.carveSpeed > 14, `dx ${chute.carveDx.toFixed(2)}, ${chute.carveSpeed.toFixed(1)} m/s`);
check('the ice walls hold: stick hard over for four seconds, never out of the channel',
  chute.wallOutside === 0 && chute.wallSide <= 0.01, `outside ${chute.wallOutside}, past the wall ${chute.wallSide.toFixed(2)} m`);
check('there is a spider to kick', chute.hadSpider);
if (chute.hadSpider) check('a swing from the slide hurts it and puts it down', chute.kickHurt > 10 && chute.kickDown, `-${chute.kickHurt} hp`);
check('a crevasse re-forms you at the next gate, forward and alive',
  chute.crevAlive && chute.crevZ >= chute.crevGate, `z ${chute.crevZ.toFixed(0)} (gate at ${chute.crevGate})`);
check('one hunter in the snowbank does not end it while another is still sliding', !chute.soloFinish);
check('a fallen teammate does not hold the party at the finish', chute.deadFinish);
check('the avalanche digs you out ahead of it', chute.avZ > chute.avFront + 40, `z ${chute.avZ.toFixed(0)}, front ${chute.avFront.toFixed(0)}`);

// ---------------------------------------------------------------- the dark
console.log('\n-- Lamplight: the darkness');
await boot('lamplight');
const dark = await page.evaluate(async (blank) => {
  const g = window.__game, s = g.campaign.section, kit = s.kit, p = g.players[0];
  const step = (n, inp = {}) => { for (let i = 0; i < n; i++) g.update(1 / 30, [{ ...blank, ...inp }, ...g.players.slice(1).map(() => blank)]); };
  const out = {};
  // the world's light is out
  let ambient = 0;
  g.scene.traverse((o) => { if (o.isAmbientLight || o.isHemisphereLight || o.isDirectionalLight) ambient = Math.max(ambient, o.intensity); });
  out.ambient = ambient;
  // stand in the middle of chamber A, facing +z, and clear the brood
  const clear = () => { for (const e of g.enemies) if (e.alive && e.team === 1) { e.damage(1e9, e.position, 0); } };
  step(2);
  clear();
  step(30);
  p.position.set(0, 90, -2); p.velocity.set(0, 0, 0);
  p.cam.yaw = 0; p.cam.pitch = -0.05;
  step(3);
  // 1. the lamp lights what it points at, and not what is behind you
  out.litAhead = kit.dark.lit(p.position.clone().setZ(8))?.kind ?? null;
  out.litBehind = kit.dark.lit(p.position.clone().setZ(-12))?.kind ?? null;
  out.lampPower = kit.dark.lamps[0].light.intensity;

  // 2. fear: a spider in the cone backs out of it
  const spawnAt = (x, z) => {
    kit.spawnBrood(0, 1);
    const e = [...kit.home.keys()].find((q) => q.alive && !q.__used);
    e.__used = true;
    e.position.set(x, 90, z); e.velocity.set(0, 0, 0);
    return e;
  };
  // the kit's timers: nothing trickles in on its own during these checks
  kit.darkT[0] = 0;
  // (a clear patch of floor: the braziers are solid, and a body backing into one stops)
  p.position.set(0, 90, -9); p.velocity.set(0, 0, 0);
  step(1);
  const e1 = spawnAt(0.5, 0);
  const d0 = Math.hypot(e1.position.x - p.position.x, e1.position.z - p.position.z);
  let inCone = 0;
  for (let i = 0; i < 45; i++) { step(1); p.position.set(0, 90, -9); p.velocity.set(0, 0, 0); if (kit.dark.lit(e1.position, 0.8, ['lamp'])) inCone++; }
  out.fearGap = Math.hypot(e1.position.x - p.position.x, e1.position.z - p.position.z) - d0;
  out.fearAt = [e1.position.x.toFixed(1), e1.position.z.toFixed(1), e1.alive, e1.downed, e1.awareness, !!e1.sectionSteer];
  out.fearLeftCone = inCone < 45;
  e1.damage(1e9, e1.position, 0);

  // 3. bold: the same spider in the same light comes on
  kit.bold[0] = true;
  p.position.set(0, 90, -2);
  const e2 = spawnAt(0, 9);
  const b0 = Math.hypot(e2.position.x, e2.position.z + 2);
  for (let i = 0; i < 30; i++) { step(1); p.position.set(0, 90, -2); p.velocity.set(0, 0, 0); }
  out.boldGap = Math.hypot(e2.position.x - p.position.x, e2.position.z - p.position.z) - b0;
  // 4. the focused beam dazzles it (bold or not)
  let dazzleAt = -1;
  for (let i = 0; i < 90 && dazzleAt < 0; i++) {
    const yaw = Math.atan2(e2.position.x - p.position.x, e2.position.z - p.position.z);
    p.cam.yaw = yaw;
    const dy = (e2.position.y + 0.8) - (p.position.y + p.height * 0.93);
    p.cam.pitch = Math.atan2(dy, Math.hypot(e2.position.x - p.position.x, e2.position.z - p.position.z));
    step(1, { aimHeld: true });
    p.position.set(0, 90, -2); p.velocity.set(0, 0, 0);
    if (e2.downed) dazzleAt = i / 30;
  }
  out.dazzleAt = dazzleAt;
  out.battery = kit.dark.lamps[0].battery;
  e2.damage(1e9, e2.position, 0);
  kit.bold[0] = false;
  step(30);

  // 5. a flare drives them off
  p.cam.yaw = 0; p.cam.pitch = -0.3;
  step(1, { rocketPressed: true });
  step(45);
  out.flares = kit.dark.flares.length;
  const f = kit.dark.flares[0];
  if (f) {
    const e3 = spawnAt(f.pos.x + 2, f.pos.z + 1);
    p.cam.yaw = Math.PI; // the lamp elsewhere: only the flare is on it
    const f0 = Math.hypot(e3.position.x - f.pos.x, e3.position.z - f.pos.z);
    for (let i = 0; i < 30; i++) { step(1); p.position.set(0, 90, -2); p.velocity.set(0, 0, 0); }
    out.flareGap = Math.hypot(e3.position.x - f.pos.x, e3.position.z - f.pos.z) - f0;
    e3.damage(1e9, e3.position, 0);
  }

  // 6. a brazier: hold two seconds, it lights; it is a pool they will not enter
  const br = kit.braziers[0];
  p.position.set(br.at.x + 1.5, 90, br.at.z); p.velocity.set(0, 0, 0);
  for (let i = 0; i < 75; i++) { step(1, { interactHeld: true }); p.position.set(br.at.x + 1.5, 90, br.at.z); p.velocity.set(0, 0, 0); }
  out.brazierLit = br.lit;
  p.position.set(br.at.x - 8, 90, br.at.z + 8); // the lamp away, the player out of the pool
  p.cam.yaw = Math.PI;
  kit.bold[0] = true; // even a bold one
  const e4 = spawnAt(br.at.x + 9, br.at.z);
  let closest = 99;
  for (let i = 0; i < 150; i++) {
    // bait it across the pool: the player stands on the far side
    p.position.set(br.at.x - 8, 90, br.at.z); p.velocity.set(0, 0, 0);
    step(1);
    closest = Math.min(closest, Math.hypot(e4.position.x - br.at.x, e4.position.z - br.at.z));
  }
  out.poolClosest = closest;
  e4.damage(1e9, e4.position, 0);
  kit.bold[0] = false;

  // 7. all three lit: the web over the way on shrinks back
  const wall = kit.walls[0];
  const solid0 = g.board.physics.boxes.includes(wall.box);
  for (const b of kit.braziers.filter((q) => q.ci === 0 && !q.lit)) b.it.spec.onDone(0);
  step(60);
  out.webWasSolid = solid0;
  out.webOpen = !g.board.physics.boxes.includes(wall.box) && wall.state === 'open';
  // and the way on is lit: every guide lamp on, the mouth a pool of light
  const gd = kit.guides[0];
  out.guideLit = gd.lamps.length > 4 && gd.lamps.every((l) => l.m.visible) && gd.mat.opacity > 0.5
    && kit.dark.pools.some((pl) => pl.pos.distanceTo(gd.mouth) < 0.1);
  out.wayOnLabel = s.objective().label;
  return out;
}, blankInput());

check('the world\'s own light is all but out', dark.ambient < 0.15, dark.ambient.toFixed(3));
check('the lamp lights what it points at, not what is behind', dark.litAhead === 'lamp' && dark.litBehind === null,
  `${dark.litAhead} / ${dark.litBehind}, ${dark.lampPower.toFixed(0)} power`);
check('a krykna in the lamp backs out of the cone, not in at you', dark.fearGap > 0 && dark.fearLeftCone, `+${dark.fearGap.toFixed(1)} m ${JSON.stringify(dark.fearAt)}`);
check('a bold krykna comes on through the lamp', dark.boldGap < -2, `${dark.boldGap.toFixed(1)} m`);
check('a focused beam dazzles it in about a second and a half', dark.dazzleAt > 1.2 && dark.dazzleAt < 2.4,
  `${dark.dazzleAt.toFixed(2)} s, battery ${dark.battery.toFixed(2)}`);
check('the rocket button throws a flare', dark.flares === 1, String(dark.flares));
if (dark.flares) check('a flare drives the brood off', dark.flareGap > 1, `+${dark.flareGap?.toFixed(1)} m`);
check('holding Y at a brazier for two seconds lights it', dark.brazierLit);
check('even a bold krykna will not enter a warm pool', dark.poolClosest > 5.5, `closest ${dark.poolClosest.toFixed(1)} m (pool 6 m)`);
check('three lit: the web over the way on shrinks back and is gone', dark.webWasSolid && dark.webOpen);
check('and the way on lights up: guide lamps down the passage, a pool at the mouth, the marker on it',
  dark.guideLit && dark.wayOnLabel === 'the way on', JSON.stringify({ lit: dark.guideLit, label: dark.wayOnLabel }));

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
check.done('crevasse sections');
