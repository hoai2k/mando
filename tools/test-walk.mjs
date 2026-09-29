/**
 * The stick's throw is the speed: a light push walks, a harder one jogs, the
 * rim runs — and the feet play the matching cycle, the walk shading into the
 * run in step rather than cutting over at a threshold.
 *
 * Run:  node tools/test-walk.mjs
 */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const { page } = h;
await h.waitForText(/WAVE BATTLE|PRESS START/i);
await h.startMode('wave', 1, 'desert', ['din']);
await page.waitForTimeout(2500);

const gait = (tilt, frames = 120) => page.evaluate(({ tilt, frames }) => {
  window.__manual = true;
  const g = window.__game, p = g.players[0];
  const input = {
    moveX: 0, moveY: tilt, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
    dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false, meleePressed: false,
    rocketPressed: false, zoomHeld: false, zoomDelta: 0, blockHeld: false, slamPressed: false,
    meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false,
  };
  // keep the field empty and the fighter unhurt, so nothing but the stick decides
  for (let i = 0; i < frames; i++) {
    for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
    p.hp = p.maxHp;
    g.update(1 / 60, [input]);
  }
  return {
    speed: +Math.hypot(p.velocity.x, p.velocity.z).toFixed(2),
    lower: p.char.animator.playing('lower'),
    upper: p.char.animator.playing('upper'),
  };
}, { tilt, frames });

try {
  const creep = await gait(0.2);
  check('a creeping stick walks slowly', creep.lower === 'walkLower' && creep.speed > 0.25 && creep.speed < 0.8, creep);
  const walk = await gait(0.45);
  check('a light push walks, at a brisk pace', walk.lower === 'walkLower' && walk.upper === 'walkUpper'
    && walk.speed > 1.4 && walk.speed < 2.3, walk);
  // every step of the throw a little faster than the last: no plateau, no jump
  const ladder = [];
  for (const tilt of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) ladder.push((await gait(tilt)).speed);
  check('the speed climbs smoothly with the stick', ladder.every((v, i) => i === 0 || (v > ladder[i - 1] && v - ladder[i - 1] < 1.6)),
    ladder);
  const run = await gait(1, 60);
  check('full tilt runs, within a second', run.lower === 'runLower' && run.speed > 7, run);
  const back = await gait(0.4);
  check('easing off from a run drops back to a walk', back.lower === 'walkLower' && back.speed < 1.6, back);
  const still = await gait(0, 90);
  check('let go and the fighter stands', still.lower !== 'walkLower' && still.lower !== 'runLower' && still.speed < 0.3, still);
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Walk');
