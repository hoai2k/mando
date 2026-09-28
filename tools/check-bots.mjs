/**
 * PvP bots: added with Y from an open place, picked for by whoever added them
 * once that player has locked their own fighter in, and always standing at the
 * end of the line — behind every human, in front of the open place.
 *
 * Then the match itself: a bot is a Player with nobody holding its controller,
 * so it has to be in `game.players`, out of the split-screen's reckoning, and
 * actually playing rather than standing where it dropped.
 */
import { launch, makeCheck, BTN, sleep } from './harness.mjs';

const h = await launch();
const check = makeCheck();
const line = () => h.page.evaluate(() => window.__charselLine());

// ---- to the PvP character select ----
await h.waitForText(/PRESS START|WAVE BATTLE/i);
await h.focusButton(/PVP/i);            // by name, not by counting from Wave Battle
await h.pad.tap(BTN.A);
await h.waitForText(/CHOOSE|TERRITORY|DUNE SEA/i);
await h.pad.tap(BTN.A);
await h.waitForText(/DIN DJARIN/i);

// player one settles on a fighter
await h.tapUntil(BTN.A, async () => /READY/i.test(await h.text()));
await sleep(500);
check('player one locks in', (await line()).filter((e) => !e.bot && e.phase === 'ready').length === 1);

// ---- Y puts a bot in the open place ----
check('the open place offers a bot', /Press\s*Y\s*for\s*Bot/i.test((await h.text()).replace(/\s+/g, ' ')));
await h.pad.tap(BTN.Y);
await sleep(400);
let l = await line();
console.log('  line:', l.map((e) => `${e.bot ? 'BOT' : 'P'}:${e.id}:${e.phase}`).join('  '));
check('Y adds a bot, and it stands after the player', l.length === 2 && l[1].bot);
check('...owned by the player who asked for it', l[1].owner === 0);

// ---- that player now picks for it ----
const before = l[1].id;
await h.pad.tap(BTN.DRIGHT);
await sleep(300);
l = await line();
check('a committed player flips the bot, not themselves', l[1].id !== before && l[0].phase === 'ready');

await h.tapUntil(BTN.A, async () => (await line())[1]?.phase === 'ready', { timeoutMs: 25000 });
await sleep(900);
l = await line();
check('and locks the bot in', l[1].phase === 'ready');

// ---- the line holds eight, and no more ----
for (let i = 0; i < 9; i++) { await h.pad.tap(BTN.Y); await sleep(120); }
l = await line();
console.log(`  after asking for nine more bots the line is ${l.length} long`);
check('the line fills to eight fighters and stops', l.length === 8);
check('...seven of them bots, behind the one player', l.filter((e) => e.bot).length === 7);
// back them out again: B on a committed player drives the first bot that is
// still being picked, which is how you take one out of the line
for (let i = 0; i < 6; i++) { await h.pad.tap(BTN.B); await sleep(200); }
l = await line();
check('and they come back out one at a time', l.length === 2 && l[1].bot);

// ---- a second human joins ahead of the bot ----
await h.pads[1].connect();
await h.pads[1].tap(BTN.A);
await sleep(600);
l = await line();
console.log('  line:', l.map((e) => `${e.bot ? 'BOT' : 'P'}:${e.id}:${e.phase}`).join('  '));
check('a joining player takes their place ahead of the bot', l.length === 3 && !l[0].bot && !l[1].bot && l[2].bot);
check("...and the bot's owner follows it", l[2].owner === 0);

// player two backs out again, so the match is one human and one bot
await h.pads[1].tap(BTN.B);
await sleep(500);
await h.pads[1].connect(false);
await sleep(500);
l = await line();
check('and leaving closes the line back up', l.length === 2 && l[1].bot);

// ---- start, and watch the bot play ----
await h.tapUntil(BTN.A, () => h.page.evaluate(() => !!window.__game), { timeoutMs: 30000 });
await h.waitForPlaying();

const match = await h.page.evaluate(async () => {
  const g = window.__game;
  const base = {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
    dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false,
    meleePressed: false, rocketPressed: false, slamPressed: false, zoomHeld: false,
    zoomDelta: 0, blockHeld: false, switchPressed: false, pausePressed: false,
  };
  const inputs = [{ ...base }, { ...base }, { ...base }, { ...base }];
  const bot = g.players.find((p) => p.isBot);
  if (!bot) return { bot: false };
  const from = bot.position.clone();
  const yaw0 = bot.cam.yaw;
  let moved = 0;
  let aimed = 0;
  for (let i = 0; i < 360; i++) {
    g.update(1 / 60, inputs);
    moved = Math.max(moved, bot.position.distanceTo(from));
    aimed = Math.max(aimed, Math.abs(Math.atan2(Math.sin(bot.cam.yaw - yaw0), Math.cos(bot.cam.yaw - yaw0))));
  }
  return {
    bot: true,
    players: g.players.length,
    humans: g.humans,
    isBot: g.players.map((p) => p.isBot),
    teams: g.players.map((p) => p.team),
    moved, aimed,
    alive: bot.alive,
  };
});

console.log(`  match: ${match.players} fighters, ${match.humans} on screen, bot flags ${JSON.stringify(match.isBot)}, teams ${JSON.stringify(match.teams)}`);
check('the match has a bot in it', match.bot === true);
check('two fighters, one of them holding a controller', match.players === 2 && match.humans === 1);
check('and they are on opposite sides', match.teams[0] !== match.teams[1]);
console.log(`  the bot moved ${match.moved.toFixed(1)} m and swung its aim ${match.aimed.toFixed(2)} rad over 6 s`);
check('the bot plays rather than standing where it dropped', match.moved > 2);
check('...and looks for its opponent', match.aimed > 0.2);

await h.close();
check.done('PvP bots');
