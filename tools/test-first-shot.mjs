/** First hip-fire shot waits for the hand to raise; ADS fires immediately. */
import { launch, blankInput, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
await h.waitForText(/PRESS START|WAVE BATTLE/i);
await h.startCoop(1, 'desert');

const result = await h.page.evaluate((base) => {
  const g = window.__game;
  const p = g.players[0];
  const shots = [];
  const oldFire = g.projectiles.fire;
  g.projectiles.fire = (origin) => { shots.push(origin.clone()); };
  const step = (n, over = {}) => {
    for (let i = 0; i < n; i++) p.update(0.02, { ...base, ...over }, g);
  };

  step(60);
  const resting = p.char.muzzle.getWorldPosition(p.position.clone()).y;
  step(1, { shootHeld: true });
  const immediate = shots.length;
  step(5);
  const early = shots.length;
  step(8);
  const tapShots = shots.length;
  const raised = shots[0]?.y ?? null;

  step(70);
  step(15, { aimHeld: true });
  const beforeAds = shots.length;
  step(1, { aimHeld: true, shootHeld: true });
  const adsShots = shots.length - beforeAds;

  g.projectiles.fire = oldFire;
  return { immediate, early, tapShots, resting, raised, adsShots };
}, blankInput());

check('hip-fire shot waits for the arm', result.immediate === 0 && result.early === 0, result);
check('brief trigger tap still fires once', result.tapShots === 1, result);
check('first bolt leaves the raised muzzle', result.raised !== null && result.raised > result.resting + 0.1, result);
check('already aiming fires without delay', result.adsShots === 1, result);

check('no runtime exceptions', h.errors.filter(e => !/Failed to load resource:.*404/.test(e)).length === 0,
  h.errors.slice(0, 3));
await h.close();
check.done('first shot');
