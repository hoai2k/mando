/**
 * The door, in a browser: `src/gate/gate.ts`.
 *
 * Four things are worth holding still here, and they are the four checks:
 *
 *  1. UNCONFIGURED IS INVISIBLE. With no endpoint compiled in, the built site
 *     boots straight to the title with no door at all. This is the check that
 *     protects the other twenty-odd suites and every dev server: the moment
 *     the door shows up unasked, all of them break at once and this says so
 *     first.
 *  2. CONFIGURED IS SHUT, AND WARMING. A stranger gets the door — and the game
 *     starts coming down behind it, because somebody at this door is about to
 *     play and the connection is otherwise idle. This check replaced an earlier
 *     one asserting the opposite (that a shut door cost 6.9 kB); the reversal
 *     was deliberate and this is where it is written down.
 *  5. A REFUSAL STOPS THE WARMING. The one visitor who should not be sent a
 *     game is the one who is not getting in.
 *  3. A STORED PASS SKIPS IT ENTIRELY, and pings the log on the way through.
 *     This is the "friends see it once" promise, and it is the one a careless
 *     refactor is most likely to cost.
 *  4. AN INVITE LINK SPENDS ITSELF. `?invite=CODE` redeems on arrival with
 *     nothing clicked and nothing typed, and the code is then wiped from the
 *     address bar so it is not left in a screenshot or a shared URL.
 *  6. THE CODE IS NEVER STORED. What the browser keeps is the id the endpoint
 *     answered with, so a pass read out of localStorage is not a reusable
 *     invite.
 *
 * The suite builds its own gated copy of the site, because being gated is a
 * build-time property and `dist/` is deliberately not. Both copies are served
 * off one static server as sibling directories, which works because the Vite
 * build uses a relative `base`.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, makeCheck } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.GATE_PORT ?? 4188);
const ENDPOINT = 'https://gate.example.invalid/exec';
const CODE = 'ANYA-7F2C9K';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
};

function serve(root, port) {
  const server = createServer((req, res) => {
    // normalize() before joining is what keeps `../../etc/passwd` inside root
    let rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, rel);
    const send = async (p) => {
      try {
        const s = await stat(p);
        if (s.isDirectory()) return send(join(p, 'index.html'));
        res.writeHead(200, { 'Content-Type': TYPES[extname(p)] ?? 'application/octet-stream' });
        createReadStream(p).pipe(res);
      } catch {
        res.writeHead(404).end('not found');
      }
    };
    void send(file);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/** Build a second copy of the site with the gate's two values compiled in. */
function buildGated(outDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
      cwd: ROOT,
      stdio: 'ignore',
      env: { ...process.env, VITE_GATE_ENDPOINT: ENDPOINT },
    });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`vite build exited ${code}`)));
    child.on('error', reject);
  });
}

async function main() {
  const check = makeCheck();
  const tmp = await mkdtemp(join(tmpdir(), 'mando-gate-'));
  const { chromium } = loadPlaywright();
  let server, browser;

  try {
    await cp(join(ROOT, 'dist'), join(tmp, 'open'), { recursive: true });
    await buildGated(join(tmp, 'gated'));
    server = await serve(tmp, PORT);
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
    });

    /** One page, with the network pinned down: nothing here talks to Google. */
    async function open(path, { pass = null, endpoint = 'abort' } = {}) {
      const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
      const beacons = [];
      await page.exposeFunction('__recordBeacon', (url, body) => { beacons.push({ url, body }); });
      await page.addInitScript(({ pass }) => {
        // Record rather than send: a beacon is fire-and-forget, so asserting on
        // it any other way is a race.
        navigator.sendBeacon = (url, body) => {
          // The gate sends a Blob; String() on one is "[object Blob]", so read
          // it properly. sendBeacon must still answer true synchronously.
          if (body && typeof body.text === 'function') void body.text().then((t) => window.__recordBeacon(url, t));
          else window.__recordBeacon(url, String(body));
          return true;
        };
        if (pass) localStorage.setItem('gate.pass', JSON.stringify(pass));
      }, { pass });

      // The endpoint is never real in a test. It either refuses to answer at
      // all (the default) or returns a verdict the door has to act on.
      await page.route(`${ENDPOINT}*`, (route) => endpoint === 'abort'
        ? route.abort('failed')
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(endpoint) }));

      const asked = [];
      page.on('request', (r) => asked.push(r.url()));
      await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'domcontentloaded' });
      return { page, beacons, asked };
    }

    const gateUp = (page) => page.evaluate(() => !!document.querySelector('.gate-veil'));
    // The title screen draws "Bounty Hunters" rather than writing it, and the
    // door says those same words in text — so the menu's own rows are the
    // marker that cannot be confused for the thing in front of it.
    const titled = (page) => page.evaluate(() => document.body.innerText.toLowerCase().includes('wave battle'));

    // ---- 1. unconfigured is invisible -------------------------------------
    {
      const { page } = await open('/open/');
      await sleep(3500);
      check('unconfigured build shows no door', !(await gateUp(page)));
      check('unconfigured build reaches the title', await titled(page));
      await page.close();
    }

    // ---- 2. configured is shut, and cheap ---------------------------------
    {
      const { page, asked } = await open('/gated/');
      await sleep(3000);
      check('gated build shows the door', await gateUp(page));
      check('the door offers somewhere to type a code',
            await page.evaluate(() => !!document.querySelector('.gate-veil input')));
      check('the owner\'s own words are on it', await page.evaluate(
        () => (document.querySelector('.gate-blurb')?.textContent ?? '').includes('friends of Hoai Nguyen')));
      // The door is not dead time: the warm hook fires as soon as it is up, and
      // the game's chunks come down while the visitor reads it. Measured in
      // bytes rather than by chunk name, because which chunk carries what is
      // rollup's business and changes with the module graph.
      const bytes = await page.evaluate(() => performance.getEntriesByType('resource')
        .filter((e) => /\.js$/.test(e.name))
        .reduce((n, e) => n + (e.decodedBodySize || 0), 0));
      check('the game warms while the door is up', bytes > 500_000, `${bytes} B of JS`);
      check('warming does not boot the game behind the door',
            !(await titled(page)) && await gateUp(page));
      // The title screen's own two files. They are the largest things a player
      // waits on at the title (1.2 MB and 326 kB) and they are fetched lazily
      // by the screen's construction, so behind a door nothing asks for them
      // until it is too late to help — see the `title` case in prefetch.ts.
      const art = ['logo.png', 'title_bg.jpg']
        .filter((f) => !asked.some((u) => u.endsWith(f)));
      check('the title screen\'s own art warms too', art.length === 0, `missing: ${art.join(', ')}`);
      await page.close();
    }

    // ---- 3. a stored pass skips it entirely -------------------------------
    {
      const pass = { id: 'A Friend', name: 'A Friend', since: Date.now() };
      const { page, beacons } = await open('/gated/', { pass });
      await sleep(3500);
      check('a stored pass shows no door', !(await gateUp(page)));
      check('a stored pass reaches the title', await titled(page));
      check('the session is logged on the way through', beacons.length === 1, JSON.stringify(beacons));
      const sent = beacons[0] ? JSON.parse(beacons[0].body) : {};
      check('the ping says which friend, and that it is a session',
            sent.kind === 'session' && sent.id === pass.id, JSON.stringify(sent));
      await page.close();
    }

    // ---- 5. a refusal stops the warming -----------------------------------
    {
      const { page, asked } = await open('/gated/?invite=NOPE-XXXXXX', { endpoint: { ok: false, reason: 'unknown' } });
      await sleep(3000);
      const said = await page.evaluate(() => document.querySelector('.gate-note')?.textContent ?? '');
      check('a refused visitor is told plainly why', /isn.t recognised/i.test(said), said);
      check('and is left able to correct it',
            await page.evaluate(() => !document.querySelector('.gate-veil input')?.disabled));
      check('and the door stays shut', await gateUp(page));
      // Whatever was still queued is dropped; what was already in flight is
      // allowed to land, so this counts new requests rather than expecting none.
      const before = asked.length;
      await sleep(2500);
      check('nothing further is pulled down for them', asked.length - before <= 2,
            `${asked.length - before} more request(s)`);
      await page.close();
    }

    // ---- 4. an invite link spends itself ----------------------------------
    {
      const admits = { ok: true, id: 'Anya', name: 'Anya' };
      const { page, beacons } = await open(`/gated/?invite=${encodeURIComponent(CODE)}`, { endpoint: admits });
      await sleep(4000);
      check('an invite link needs nothing clicked', !(await gateUp(page)));
      check('and lands on the game', await titled(page));
      // The address bar is the least private place on a computer: screenshots,
      // bookmarks, autocomplete, and links pasted into group chats by someone
      // meaning to share the game rather than their own invite.
      const url = await page.evaluate(() => location.href);
      check('the code is wiped from the address bar', !url.includes('invite'), url);
      const sent = beacons[0] ? JSON.parse(beacons[0].body) : {};
      check('the session says which game it was', sent.game === 'bounty-hunters', JSON.stringify(sent));
      await page.close();
    }

    // ---- 6. the code is never stored --------------------------------------
    {
      const admits = { ok: true, id: 'Anya', name: 'Anya' };
      const { page } = await open(`/gated/?invite=${encodeURIComponent(CODE)}`, { endpoint: admits });
      await sleep(3500);
      const stored = await page.evaluate(() => localStorage.getItem('gate.pass') ?? '');
      check('the stored pass holds an id, not the invite', !stored.includes('7F2C9K'), stored);
      check('and it is the id the endpoint answered with', stored.includes('Anya'), stored);
      // Not namespaced to this game: every game of the owner's on this origin
      // shares the key, so one invite admits a friend to all of them.
      const keys = await page.evaluate(() => Object.keys(localStorage));
      check('the pass is shared across the owner\'s games', keys.includes('gate.pass'), keys.join(', '));
      await page.close();
    }

    check.done('test-gate');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((r) => server.close(r));
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
