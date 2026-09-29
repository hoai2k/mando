/**
 * Fists in play: a character passed for them closes the gun hand on the gun,
 * both hands on the move and in a bare-handed fight, and opens them standing
 * empty-handed; a character not passed for them keeps the hands as sculpted.
 *
 * Din (carbine), Paz (fists) and Cad Bane (not passed) share one match, each
 * on their own pad, so one load covers all three.
 *
 * Run:  node tools/test-fists.mjs
 */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const { page } = h;
await h.waitForText(/WAVE BATTLE|PRESS START/i);
await h.startMode('wave', 3, 'desert', ['din', 'paz', 'duelist']);
await page.waitForFunction(() => window.__game?.players?.length === 3
  && window.__game.players.every((p) => p.char.modelReady?.()), undefined, { timeout: 180000 });

/**
 * Step the match with these pads held, then read each player's hands: how far
 * (radians) the right and left knuckle bones have turned.
 */
const hands = (pads, frames = 40) => page.evaluate(({ pads, frames }) => {
  window.__manual = true;
  const g = window.__game;
  const blank = {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
    dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false, meleePressed: false,
    rocketPressed: false, zoomHeld: false, zoomDelta: 0, blockHeld: false, slamPressed: false,
    meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false,
  };
  const inputs = g.players.map((_, i) => ({ ...blank, ...(pads[i] ?? {}) }));
  let peak = g.players.map(() => [0, 0]);
  const turn = (p, side) => {
    let bone = null;
    p.char.root.traverse((o) => { if (o.name === `fist_knuckle${side}`) bone = o; });
    return bone ? 2 * Math.acos(Math.min(1, Math.abs(bone.quaternion.w))) : null;
  };
  for (let i = 0; i < frames; i++) {
    // keep the field empty and everyone unhurt, so nothing but the pads decides
    for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
    for (const p of g.players) p.hp = p.maxHp;
    g.update(1 / 60, inputs);
    // one-press inputs only on the first frame
    for (const inp of inputs) inp.meleePressed = false;
    peak = g.players.map((p, k) => [Math.max(peak[k][0], turn(p, 'R') ?? 0), Math.max(peak[k][1], turn(p, 'L') ?? 0)]);
  }
  return g.players.map((p, k) => ({
    id: p.characterId, right: +(turn(p, 'R') ?? -1).toFixed(2), left: +(turn(p, 'L') ?? -1).toFixed(2),
    peak: peak[k].map((v) => +v.toFixed(2)),
    upper: p.char.animator?.playing('upper'), lower: p.char.animator?.playing('lower'), weapon: p.weapon,
  }));
}, { pads, frames });

const closed = (v) => v > 1;
const open = (v) => v >= 0 && v < 0.1;

try {
  const still = await hands([], 90);
  const [din, paz, bane] = still;
  check('Din standing with his carbine: the gun hand closed, the other open',
    din.weapon === 'blaster' && closed(din.right) && open(din.left), din);
  check('Cad Bane is not passed for fists: his hands stay as sculpted', open(bane.right) && open(bane.left), bane);

  const aim = await hands([{ aimHeld: true }], 30);
  check('Din aiming: both hands on the carbine, both closed', closed(aim[0].right) && closed(aim[0].left), aim[0]);

  const run = await hands([{ moveY: 1 }, { moveY: 1 }, { moveY: 1 }], 60);
  check('Din running: both hands closed', run[0].lower === 'runLower' && closed(run[0].right) && closed(run[0].left), run[0]);
  check('Cad Bane running: still open', open(run[2].right) && open(run[2].left), run[2]);

  const walk = await hands([{ moveY: 0.6 }], 60);
  check('Din walking: both hands closed', walk[0].lower === 'walkLower' && closed(walk[0].right) && closed(walk[0].left), walk[0]);

  // settle, then swing bare-handed
  await hands([], 60);
  const swing = await hands([null, { meleePressed: true }], 20);
  check('Paz in a bare-handed fight: both hands closed', closed(swing[1].peak[0]) && closed(swing[1].peak[1]), swing[1]);
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Fists');
