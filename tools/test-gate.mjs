/**
 * The door, in a browser: `src/gate/gate.ts`.
 *
 * Four things are worth holding still here, and they are the four checks:
 *
 *  1. UNCONFIGURED IS INVISIBLE. With no client ID compiled in, the built site
 *     boots straight to the title with no door at all. This is the check that
 *     protects the other twenty-odd suites and every dev server: the moment
 *     the door shows up unasked, all of them break at once and this says so
 *     first.
 *  2. CONFIGURED IS SHUT, AND CHEAP. A stranger gets the door, and the game's
 *     chunks are never fetched behind it — the point of loading the gate from
 *     its own entry.
 *  3. A STORED PASS SKIPS IT ENTIRELY, and pings the log on the way through.
 *     This is the "friends see it once" promise, and it is the one a careless
 *     refactor is most likely to cost.
 *  4. A BROKEN DOOR OPENS. If Google's script cannot load, the gate lets
 *     everyone in rather than stranding a friend behind machinery of ours that
 *     failed. It is a doorman, not a lock, and this is where that shows.
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
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const ENDPOINT = 'https://gate.example.invalid/exec';

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
      env: { ...process.env, VITE_GATE_CLIENT_ID: CLIENT_ID, VITE_GATE_ENDPOINT: ENDPOINT },
    });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`vite build exited ${code}`)));
    child.on('error', reject);
  });
}

/**
 * A stand-in for Google Identity Services that never calls back, so the door
 * stays up and the checks can look at it. Served in place of the real script,
 * which this suite must never reach for.
 */
const GSI_STUB = `
  window.__gsi = { initialized: null, prompted: 0, buttons: 0 };
  window.google = { accounts: { id: {
    initialize: (o) => { window.__gsi.initialized = o; },
    prompt: () => { window.__gsi.prompted++; },
    renderButton: (el) => { window.__gsi.buttons++; el.innerHTML = '<div id="stub-btn">Continue with Google</div>'; },
  } } };
`;

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
    async function open(path, { gsi = 'stub', pass = null } = {}) {
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
        if (pass) localStorage.setItem('mando.pass', JSON.stringify(pass));
      }, { pass });

      await page.route('https://accounts.google.com/gsi/client', (route) => {
        if (gsi === 'block') return route.abort('failed');
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: GSI_STUB });
      });
      // The endpoint is never real in a test; anything that reaches it fails.
      await page.route(`${ENDPOINT}*`, (route) => route.abort('failed'));

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
      check('the door renders a Google button', await page.evaluate(() => !!document.querySelector('#stub-btn')));
      check('One Tap is asked for the silent path', await page.evaluate(() => window.__gsi.prompted > 0));
      const opts = await page.evaluate(() => window.__gsi.initialized);
      check('auto_select is on (the once-ever promise)', opts?.auto_select === true, JSON.stringify(opts?.auto_select));
      check('itp_support is on (Safari keeps working)', opts?.itp_support === true);
      check('the client id is the one built in', opts?.client_id === CLIENT_ID, opts?.client_id);
      // The point of booting from src/gate: the game is not downloaded by
      // somebody who never gets in. Weighed in bytes rather than matched by
      // name — the gate's own entry chunk is also called `main-*.js`, and the
      // question here is how much a stranger costs us, not what it is called.
      const bytes = await page.evaluate(() => performance.getEntriesByType('resource')
        .filter((e) => /\.js$/.test(e.name))
        .reduce((n, e) => n + (e.decodedBodySize || 0), 0));
      check('a stranger downloads the door, not the game', bytes < 100_000, `${bytes} B of JS`);
      await page.close();
    }

    // ---- 3. a stored pass skips it entirely -------------------------------
    {
      const pass = { sub: '1234567890', email: 'friend@example.com', name: 'A Friend', since: Date.now() };
      const { page, beacons } = await open('/gated/', { pass });
      await sleep(3500);
      check('a stored pass shows no door', !(await gateUp(page)));
      check('a stored pass reaches the title', await titled(page));
      check('the session is logged on the way through', beacons.length === 1, JSON.stringify(beacons));
      const sent = beacons[0] ? JSON.parse(beacons[0].body) : {};
      check('the ping says which friend, and that it is a session',
            sent.kind === 'session' && sent.sub === pass.sub, JSON.stringify(sent));
      await page.close();
    }

    // ---- 4. a broken door opens -------------------------------------------
    {
      const { page } = await open('/gated/', { gsi: 'block' });
      await sleep(4000);
      check('a door that cannot load Google lets everyone through', !(await gateUp(page)));
      check('and the game still boots', await titled(page));
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
