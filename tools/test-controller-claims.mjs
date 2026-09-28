/** Keyboard P1 plus the first connected gamepad must produce a working P2. */
import { launch, BTN, makeCheck, sleep } from './harness.mjs';

const check = makeCheck();
const h = await launch();
try {
  await h.waitForText(/PRESS START|WAVE BATTLE/i);
  await h.page.keyboard.press('Enter');
  await h.waitForText(/TERRITORY|DUNE SEA|CHOOSE/i);
  await h.page.keyboard.press('Enter');
  await h.waitForText(/CHOOSE YOUR|DIN DJARIN/i);

  const initial = await h.page.evaluate(() => window.__input.padForPlayer.slice());
  check('keyboard selection reserves player one', initial[0] === -1, initial);

  await h.pad.tap(BTN.A);
  const joined = await h.page.evaluate(() => ({
    seats: window.__input.padForPlayer.slice(),
    line: window.__charselLine(),
  }));
  check('first connected pad joins player two',
    joined.seats[0] === -1 && joined.seats[1] === 0 && joined.line.length === 2,
    joined);

  // Lock each fighter once its model has loaded. Repeated presses here mirror
  // the existing co-op test: a press while a model is loading is ignored.
  let ready = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    const line = await h.page.evaluate(() => window.__charselLine());
    if (line.every((slot) => slot.phase === 'ready')) { ready = true; break; }
    if (line[0]?.phase === 'browsing') await h.page.keyboard.press('Enter');
    if (line[1]?.phase === 'browsing') await h.pad.tap(BTN.A);
    await sleep(500);
  }
  check('both chosen fighters lock in', ready, await h.page.evaluate(() => window.__charselLine()));
  await h.page.keyboard.press('Enter');
  await h.page.waitForFunction(() => window.__state === 'playing' && window.__game?.players.length === 2,
    null, { timeout: 120000 });
  const inGame = await h.page.evaluate(() => window.__input.padForPlayer.slice());
  check('match keeps the keyboard gap and P2 pad', inGame[0] === -1 && inGame[1] === 0, inGame);
  // Count frames, not seconds. The menu path lands on a board that, drawn
  // twice for split screen under the software renderer, advanced 0.85 s of
  // match in about three minutes of wall time — so a 20 s wait timed out on a
  // pad that was working. `__stepFrame` runs the real frame, pad polling and
  // per-slot `input.read` included, so the routing is still what is tested;
  // only the clock is ours.
  await h.manual(true);
  await h.pad.stick('left', 0, -1);
  const frames = await h.page.evaluate(async () => {
    for (let i = 1; i <= 60; i++) {
      window.__stepFrame(1 / 30);
      if (window.__game.players[1].velocity.length() > 0.5) return i;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return null;
  });
  check('the pad moves P2 within a few frames', frames !== null, { frames });
  const speed = await h.page.evaluate(() => window.__game.players.map((p) =>
    +(Math.hypot(p.velocity.x, p.velocity.z) > 0.5)));
  check('the first pad drives P2 alone', speed[0] === 0 && speed[1] === 1, speed);
  await h.pad.release();
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Controller claims');
