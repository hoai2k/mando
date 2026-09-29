/**
 * The stick's throw is a gait: a light push walks, a harder one hurries
 * toward the run, the rim runs — and the feet play the matching cycle.
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
  const walk = await gait(0.6);
  check('a light push walks at the walk’s own pace', walk.lower === 'walkLower' && walk.upper === 'walkUpper'
    && walk.speed > 1.2 && walk.speed < 1.6, walk);
  // a run builds up: a second's walk, a second's jog, then the run
  const run = await gait(1, 180);
  check('full tilt runs, once it has built up', run.lower === 'runLower' && run.speed > 7, run);
  const back = await gait(0.4);
  check('easing off from a run drops back to a walk', back.lower === 'walkLower' && back.speed < 1.3, back);
  const still = await gait(0, 90);
  check('let go and the fighter stands', still.lower !== 'walkLower' && still.lower !== 'runLower' && still.speed < 0.3, still);
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Walk');
