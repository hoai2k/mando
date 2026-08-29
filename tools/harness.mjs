/**
 * Browser test harness: drives the real build in Chromium with a synthetic
 * Xbox pad, so gameplay can be verified end to end without a physical
 * controller.
 *
 * Gameplay reads `navigator.getGamepads()` every frame and nothing else, so a
 * fake pad injected before any script runs is indistinguishable from a real
 * one — the input layer, menus, and game loop are all exercised for real.
 *
 * Usage as a library:
 *
 *   import { launch, BTN } from './tools/harness.mjs';
 *   const h = await launch();                 // { page, pad, browser, ... }
 *   await h.startMatch();                     // title -> board -> character
 *   await h.pad.tap(BTN.A);
 *   await h.pad.stick('left', 0, -1, 2000);   // hold forward for 2 s
 *   await h.shot('out.png');
 *   await h.close();
 *
 * Run directly for a smoke test:  node tools/harness.mjs [out.png]
 */
import { createRequire } from 'module';

// Playwright lives with the global toolchain in this environment, not in the
// project's node_modules; fall back to a plain resolve when it is local.
const require_ = createRequire(import.meta.url);
function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright/index.js']) {
    try { return require_(id); } catch { /* try the next */ }
  }
  throw new Error('playwright not found: run `npm ci` (it is a devDependency), then `npx playwright install chromium`');
}

/** Xbox standard-mapping button indices, matching src/core/input.ts */
export const BTN = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  VIEW: 8, START: 9, LS: 10, RS: 11, DUP: 12, DDOWN: 13, DLEFT: 14, DRIGHT: 15,
};

/**
 * Installed before page scripts so the game never sees a padless frame.
 *
 * Four pads exist from the start and only the first is plugged in; the others
 * are connected on demand with `window.__padConnect`, which is what lets the
 * couch co-op paths — joining the character select, and a player's controller
 * dying mid-screen — be driven without four real controllers. State lives on
 * `window.__pads` (with `window.__pad` still naming the first), and the page's
 * own rAF loop polls it through getGamepads() exactly as it would a real
 * device.
 */
function padShim() {
  const states = [0, 1, 2, 3].map((i) => ({
    buttons: new Array(17).fill(0),
    axes: [0, 0, 0, 0],
    connected: i === 0,
  }));
  window.__pads = states;
  window.__pad = states[0];
  window.__padConnect = (i, on = true) => { states[i].connected = on; };
  const snapshot = (state, index) => ({
    id: 'Harness Pad (STANDARD GAMEPAD Vendor: 045e Product: 02ea)',
    index,
    connected: state.connected,
    mapping: 'standard',
    timestamp: performance.now(),
    axes: state.axes.slice(),
    buttons: state.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })),
  });
  // disconnected slots read back as null holes, exactly as a real browser
  // reports a pad that has been unplugged
  navigator.getGamepads = () => states.map((s, i) => (s.connected ? snapshot(s, i) : null));
  // No synthetic 'gamepadconnected' event: its constructor demands a real
  // Gamepad and rejects a plain object. The game polls getGamepads() every
  // frame anyway, so the pad is picked up on the next tick regardless.
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Pad {
  /** `index` picks which of the four shimmed controllers this drives */
  constructor(page, index = 0) { this.page = page; this.index = index; }

  /** plug this controller in, or pull it out mid-session */
  async connect(on = true) {
    await this.page.evaluate(([i, v]) => window.__padConnect(i, v), [this.index, on]);
    await sleep(250);          // a couple of frames for the game to notice
  }

  /** hold a button down */
  async down(btn) { await this.page.evaluate(([i, b]) => { window.__pads[i].buttons[b] = 1; }, [this.index, btn]); }
  /** release a button */
  async up(btn) { await this.page.evaluate(([i, b]) => { window.__pads[i].buttons[b] = 0; }, [this.index, btn]); }

  /**
   * Press and release. The default hold spans several frames: edge detection
   * samples once per frame, and a press shorter than a frame can be missed
   * entirely when the page is running slowly under software rendering.
   */
  async tap(btn, holdMs = 120) {
    await this.down(btn);
    await sleep(holdMs);
    await this.up(btn);
    await sleep(80);
  }

  /** analogue trigger value (LT/RT read `.value`, not just `.pressed`) */
  async trigger(btn, value) {
    await this.page.evaluate(([i, b, v]) => { window.__pads[i].buttons[b] = v; }, [this.index, btn, value]);
  }

  /**
   * Set a stick, optionally for a fixed duration then re-centre.
   * `which` is 'left' (axes 0,1) or 'right' (axes 2,3); y is negative up.
   */
  async stick(which, x, y, holdMs = 0) {
    const axis = which === 'left' ? 0 : 2;
    await this.page.evaluate(([i, idx, sx, sy]) => {
      window.__pads[i].axes[idx] = sx;
      window.__pads[i].axes[idx + 1] = sy;
    }, [this.index, axis, x, y]);
    if (holdMs) {
      await sleep(holdMs);
      await this.page.evaluate(([i, idx]) => {
        window.__pads[i].axes[idx] = 0;
        window.__pads[i].axes[idx + 1] = 0;
      }, [this.index, axis]);
    }
  }

  /** everything to neutral */
  async release() {
    await this.page.evaluate((i) => {
      window.__pads[i].buttons.fill(0);
      window.__pads[i].axes.fill(0);
    }, this.index);
  }
}

/**
 * Start `vite preview` and wait for it to answer, unless something is already
 * serving there. The harness used to assume a server was already up and died
 * with ERR_CONNECTION_REFUSED otherwise, which made it unrunnable from a fresh
 * clone and unusable in CI.
 */
async function ensureServer(url) {
  const reachable = async () => {
    try { await fetch(url, { method: 'GET' }); return true; } catch { return false; }
  };
  if (await reachable()) return null;

  const { spawn } = await import('child_process');
  const root = new URL('..', import.meta.url).pathname;
  const child = spawn('npm', ['run', 'preview', '--', '--port', new URL(url).port || '4173'], {
    cwd: root, stdio: 'ignore', detached: false,
  });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (await reachable()) return child;
  }
  child.kill();
  throw new Error(`preview server did not come up at ${url} — is dist/ built? (npm run build)`);
}

export async function launch({ headless = true, width = 1280, height = 720, url = 'http://localhost:4173/' } = {}) {
  const { chromium } = loadPlaywright();
  const server = await ensureServer(url);
  const browser = await chromium.launch({
    headless,
    // CHROMIUM_PATH lets a sandbox with a pre-installed browser run these tools
    // without playwright downloading its own pinned build; unset in CI, where
    // `npx playwright install` has already put the matching one in place.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Some 404s are expected and mean nothing is wrong. Optional assets are
  // probed on purpose — a model, texture, portrait or sound that isn't there
  // falls back to the procedural build or a drawn mark — and the browser asks
  // every page for a favicon this one doesn't ship. A 404 for anything else
  // still fails the suite.
  const optional = /\/(favicon\.ico|models\/|assets\/(textures|audio)\/)/;
  page.on('console', (m) => {
    // a missing .glb logs by design (procedural fallback), so it isn't an error
    if (m.type() !== 'error') return;
    const url = m.location()?.url ?? '';
    if (/Failed to load resource/.test(m.text()) && optional.test(url)) return;
    if (!/authored/.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript(padShim);
  await page.goto(url, { waitUntil: 'networkidle' });
  await sleep(1500);

  const pad = new Pad(page);
  // one driver per shimmed controller; pads[0] is the same device as `pad`
  const pads = [0, 1, 2, 3].map((i) => new Pad(page, i));
  const text = () => page.evaluate(() => document.body.innerText.replace(/\s*\n+\s*/g, ' | ').trim());
  const game = (fn) => page.evaluate(fn);

  /**
   * Tap a button until a condition holds. Menus gate on real work — character
   * select refuses to lock in a pick before that character's .glb has loaded —
   * so a single press can land too early and silently do nothing.
   */
  async function tapUntil(btn, ready, { timeoutMs = 30000, everyMs = 700 } = {}) {
    const t0 = Date.now();
    for (;;) {
      if (await ready()) return;
      if (Date.now() - t0 > timeoutMs) throw new Error(`tapUntil(${btn}) timed out`);
      await pad.tap(btn, 140);
      await sleep(everyMs);
    }
  }

  /**
   * Click a visible menu item by its label, at its centre point.
   *
   * Playwright's locator click waits for the element to be "stable" across
   * animation frames, which never happens here: software rendering starves the
   * frame loop, and a paused game is still drawing the scene behind the menu.
   * The element is fine — nothing overlaps it — so click the coordinates and
   * skip the wait.
   */
  async function clickText(label) {
    const c = await page.evaluate((l) => {
      const el = [...document.querySelectorAll('.menu-btn, .menu-toggle, .board-card, .charsel-arrow')]
        .find((e) => e.offsetParent !== null && (e.textContent || '').includes(l));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, label);
    if (!c) return false;
    await page.mouse.click(c.x, c.y);
    await sleep(400);
    return true;
  }

  /** menu screens animate in; wait for one whose text matches */
  async function waitForText(re, timeoutMs = 8000) {
    const t0 = Date.now();
    for (;;) {
      const t = await text();
      if (re.test(t)) return t;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${re}; screen reads: ${t}`);
      await sleep(200);
    }
  }

  /** title -> board select -> character select -> playing */
  async function startMatch({ board = 0, character = 0 } = {}) {
    // The title screen has two shapes: the mode select (the default — Wave
    // Battle / PvP / Missions) and the single Press Start behind `?nomodes`.
    // Wave Battle is the focused button on the mode select, so START opens the
    // same board select from either; wait for whichever one is up rather than
    // for the wording of one of them.
    await waitForText(/PRESS START|WAVE BATTLE/i);
    await pad.tap(BTN.START);
    await waitForText(/CHOOSE|TERRITORY|DUNE SEA/i);
    for (let i = 0; i < board; i++) { await pad.tap(BTN.DRIGHT); }
    await pad.tap(BTN.A);
    await waitForText(/MANDALORIAN|DIN DJARIN/i);
    for (let i = 0; i < character; i++) { await pad.tap(BTN.DRIGHT); }
    // Character select is two beats: A locks the pick in and spins the figure
    // into a READY pose, and a second A on that ready slot starts the match.
    // The first A is refused until that character's model has finished
    // loading, so both are retried rather than pressed once and hoped for.
    await tapUntil(BTN.A, async () => /READY/i.test(await text()));
    await sleep(400);
    await tapUntil(BTN.A, () => page.evaluate(() => !!window.__game), { timeoutMs: 15000 });
    // The match is built behind a loading screen and shown when the files its
    // first minute needs have landed, so "a game object exists" is no longer
    // "the player is on the ground". Wait for the drop to finish.
    await waitForPlaying();
  }

  /** Wait out the loading screen (or any other menu) until the match is live. */
  async function waitForPlaying(timeoutMs = 45000) {
    const t0 = Date.now();
    for (;;) {
      if (await page.evaluate(() => window.__state === 'playing')) return;
      if (Date.now() - t0 > timeoutMs) throw new Error(`still ${await page.evaluate(() => window.__state)} after ${timeoutMs}ms`);
      await sleep(200);
    }
  }

  /**
   * Advance game time directly. Software rendering runs at a few frames a
   * second, so waiting in wall-clock time for anything in-game is hopeless;
   * stepping the loop is both faster and deterministic.
   */
  async function step(seconds, input = {}) {
    return page.evaluate(([secs, over]) => {
      const g = window.__game;
      if (!g) throw new Error('no game running');
      const dt = 1 / 60;
      const base = {
        moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
        dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false,
        meleePressed: false, rocketPressed: false, slamPressed: false, zoomHeld: false,
        zoomDelta: 0, blockHeld: false, switchPressed: false, pausePressed: false,
        throttleHeld: false, brakeHeld: false,
      };
      // one input per possible player: the game indexes by player slot, and a
      // three- or four-player match would read past a two-entry array
      const inputs = [{ ...base, ...over }, { ...base }, { ...base }, { ...base }];
      for (let i = 0; i < Math.round(secs * 60); i++) {
        g.update(dt, inputs);
      }
      const p = g.players[0];
      return { wave: g.wave, hp: +p.hp.toFixed(1), alive: p.alive, hostiles: g.aliveEnemyCount };
    }, [seconds, input]);
  }

  return {
    browser, page, pad, pads, errors,
    text, waitForText, tapUntil, clickText, startMatch, waitForPlaying, step, game,
    shot: (path, opts = {}) => page.screenshot({ path, timeout: 90000, ...opts }),
    close: async () => {
      await browser.close();
      server?.kill();
    },
  };
}

// ---- run directly: a smoke test of the whole path ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  const h = await launch();
  console.log('title:', await h.text());
  await h.startMatch();
  console.log('match started');
  // a real pad press: walk forward for a moment, then look around
  await h.pad.stick('left', 0, -1, 1200);
  await h.pad.stick('right', 0.6, 0, 600);
  await h.pad.release();
  const state = await h.step(2);
  console.log('after 2 s of game time:', JSON.stringify(state));
  if (out) {
    // software rendering makes this slow, but a failed screenshot must not hide
    // the result of the run itself
    try { await h.shot(out); } catch (e) { console.warn('screenshot skipped:', e.message.split('\n')[0]); }
  }
  const bad = h.errors.length;
  console.log('errors:', bad ? h.errors.slice(0, 3) : 'none');
  await h.close();
  if (bad) process.exit(1);
}
