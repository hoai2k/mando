/**
 * The chase camera's follow distance breathes with the pace
 * (src/core/camera.ts, tuned in src/core/data/cameraTuning.json):
 *
 *   - standing still pulls it in, running pushes it out, sprinting further;
 *   - running at the lens pulls it out further than running away from it.
 *
 * Run:  node tools/test-camera-follow.mjs
 */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const { page } = h;
await h.waitForText(/WAVE BATTLE|PRESS START/i);
await h.startMode('wave', 1, 'desert', ['din']);
await page.waitForTimeout(2500);
await page.evaluate(() => {
  window.__manual = true;
  const g = window.__game;
  const blank = () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
    dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false, meleePressed: false,
    rocketPressed: false, zoomHeld: false, zoomDelta: 0, blockHeld: false, slamPressed: false,
    meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false });
  const T = { blank };
  T.step = (n = 1, inputs = []) => {
    for (let i = 0; i < n; i++) g.update(1 / 60, [0, 1, 2, 3].map((k) => inputs[k] ?? blank()));
  };
  let guard = 0;
  while (!g.enemies.length && guard++ < 1500) T.step();
  // marked, not stepped: a blank frame would let go of a held sprint
  T.clear = () => { for (const e of g.enemies) { e.alive = false; e.removeMe = true; } };
  for (const p of g.players) p.hp = p.maxHp = 1e6;
  // hold still, or run with `moveY` for `secs`, keeping the arena clear and
  // the camera's heading fixed; report the settled distance and the closing speed
  T.run = (moveY, secs, sprint = false) => {
    const p = g.players[0];
    p.position.set(0, p.position.y, 0);
    let closing = 0;
    for (let i = 0; i < secs * 60; i++) {
      if (i % 30 === 0) T.clear();
      p.cam.yaw = 0;
      if (sprint) p.energy = 1;   // a sprint drains the gauge; hold it long enough to settle
      // a sprint is a dash press held on: the dodge rolls into the sprint
      T.step(1, [{ ...blank(), moveY, sprintHeld: sprint, dashPressed: sprint && i === 0 }]);
      closing = -(p.velocity.x * Math.sin(p.cam.yaw) + p.velocity.z * Math.cos(p.cam.yaw));
    }
    return { dist: +p.cam.dist.toFixed(3), speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(2), closing: +closing.toFixed(2) };
  };
  window.T = T;
});

const r = await page.evaluate(() => {
  const T = window.T;
  const still = T.run(0, 4);
  const a = T.run(1, 3);
  const b = T.run(-1, 3);
  // whichever direction closes on the lens is "toward"
  const [away, toward] = a.closing < b.closing ? [a, b] : [b, a];
  const awayY = a.closing < b.closing ? 1 : -1;
  T.run(0, 4);
  const sprint = T.run(awayY, 3, true);
  return { still, away, toward, sprint };
});
console.log(JSON.stringify(r));
check('running away sits further out than standing still', r.away.dist > r.still.dist + 0.2, r);
check('sprinting sits further out than running', r.sprint.dist > r.away.dist + 0.2, r);
check('running at the lens sits further out than running away', r.toward.closing > 3 && r.toward.dist > r.away.dist + 0.3, r);
check.done('camera follow');
await h.close();
