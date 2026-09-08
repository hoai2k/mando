/**
 * The door: a one-time invite code in front of the game.
 *
 * This is a DOORMAN, NOT A LOCK, and the difference matters when reading the
 * code below. The site is a static build on GitHub Pages out of a public
 * repository, so everything here ships to the browser and anyone willing to
 * open devtools can set the pass by hand and walk in. What it does do is keep
 * the game off the open web for passers-by, and tell the owner who is playing.
 * Nothing behind this door is a secret, and no check here should ever be
 * mistaken for one. If it needs to be a real lock, that is a hosting change
 * (Cloudflare Access in front of the whole site) rather than more code here —
 * see `docs/AUTH.md`.
 *
 * WHY A CODE AND NOT A GOOGLE SIGN-IN. The first version of this door was
 * Google Identity Services, which is a fine door and costs the OWNER a Google
 * Cloud project — and Google now requires MFA on the account to open one. That
 * is a real price to pay for the front door of a fan game. An invite code needs
 * no identity provider, no OAuth client, no consent screen and no account of
 * any kind, and it is *better* for the visitor: a friend clicks their link and
 * is playing, with no account picker and no Google account required. What it
 * gives up is verified identity — a code is a code, and a friend can pass
 * theirs on. For "who is playing", the owner's own name in the sheet is worth
 * as much as Google's, so little is actually lost.
 *
 * IT KNOWS NOTHING ABOUT THIS GAME, on purpose. The words on the door, the
 * game it reports itself as, and the decision of what to pull down while it is
 * up are all passed in by the host page (`GateOptions`), and nothing in this
 * file imports from `src/` outside its own directory. Porting it to another
 * game is copying `src/gate/` and writing that page's own `boot.ts`.
 *
 * THE DESIGN CONSTRAINT IS "FRIENDS SEE THIS ONCE." Everything else bends to
 * that:
 *
 *  - **An invite link redeems itself.** `?invite=CODE` is spent on arrival with
 *    nothing to click and nothing to type, and then wiped from the address bar
 *    so it is not left sitting in a screenshot, a bookmark or a shared URL.
 *    The friend's whole experience of the door is a flicker.
 *  - The pass is written to localStorage with **NO EXPIRY**. An expiry would
 *    only be security theatre on a door that is already a doorman.
 *  - The pass is stored under a key that is **not this game's**, so every game
 *    of the owner's on this origin shares it. A friend admitted to one is
 *    already admitted to the rest — GitHub Pages project sites differ only by
 *    path, and localStorage is keyed by origin.
 *  - **The code itself is never stored.** The endpoint answers with an id and a
 *    name, and those are what is kept, so the browser holds no reusable secret.
 *
 * UNSET MEANS OPEN. With no endpoint compiled in, `openGate` resolves
 * immediately and this file may as well not exist. That is the state of every
 * dev server and every browser suite in `tools/`, which is why none of them had
 * to learn about invites — and it is also the safe failure mode for a deploy
 * that loses its configuration: the site keeps working, it just stops counting.
 *
 * THE DOOR IS NOT DEAD TIME. The seconds a visitor spends at it are seconds the
 * connection is idle, and somebody here is somebody about to play — so
 * `GateOptions.warm` is called the moment the door is up and the host starts
 * pulling down what comes next. Warming is dropped the moment a visitor is
 * actually refused.
 */

/** Everything this door needs to know that is not about being let in. */
export interface GateOptions {
  /** Heading. The game's name, usually. */
  title: string;
  /** The line under it: who this is for, and what to do about it. */
  blurb: string;
  /**
   * Which game this is, recorded on every logged row. One endpoint and one
   * sheet can serve several games; this is how their rows stay tellable apart.
   */
  game: string;
  /**
   * Called once, immediately after the door is shown, with a signal that is
   * aborted if the visitor is refused. Start downloading what the visitor is
   * about to need. Anything begun here must be a hint — the host has to work
   * whether or not any of it arrives.
   */
  warm?: (signal: AbortSignal) => void;
  /** Override for the compiled-in endpoint, for a host that sources its own. */
  endpoint?: string;
}

/** What we keep about a friend who has been let in. No expiry, by design. */
export interface Pass {
  /** The endpoint's stable id for this friend. Never the code itself. */
  id: string;
  /** Whatever the owner called them in the sheet. */
  name: string;
  /** When this browser first got in, for the owner's curiosity only. */
  since: number;
}

/**
 * Deliberately NOT namespaced to this game.
 *
 * Every game of the owner's published under the same origin — which is what
 * GitHub Pages project sites are, differing only by path — shares this key, so
 * one invite admits a friend to all of them and the promise is "sign in once",
 * not "once per game".
 */
const PASS_STORE = 'gate.pass';

/** The query parameter an invite link carries. */
const INVITE_PARAM = 'invite';

let ENDPOINT = import.meta.env.VITE_GATE_ENDPOINT ?? '';

/** Configured means gated. No endpoint leaves the door standing open. */
export function gateEnabled(): boolean {
  return ENDPOINT !== '';
}

// ---------- the stored pass ----------

/** The saved pass, or null if this browser has never been let in. */
export function readPass(): Pass | null {
  try {
    const raw = localStorage.getItem(PASS_STORE);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Pass>;
    // A blob that predates a field, or one someone typed in by hand, should
    // read as "no pass" rather than crash the boot before the game exists.
    if (typeof p.id !== 'string' || p.id === '') return null;
    return {
      id: p.id,
      name: typeof p.name === 'string' ? p.name : p.id,
      since: typeof p.since === 'number' ? p.since : Date.now(),
    };
  } catch {
    return null;  // private mode, or storage disabled entirely
  }
}

function writePass(p: Pass): void {
  try { localStorage.setItem(PASS_STORE, JSON.stringify(p)); } catch { /* private mode */ }
}

/** For anyone debugging the door, and for a "forget me" the owner may want. */
export function clearPass(): void {
  try { localStorage.removeItem(PASS_STORE); } catch { /* private mode */ }
}

// ---------- the endpoint ----------

/**
 * Posted as `text/plain` on purpose. A JSON content-type makes the browser
 * send a CORS preflight, and an Apps Script web app cannot answer one — the
 * body is still JSON, the header just keeps the request "simple" so it goes
 * straight through. See `docs/AUTH.md`.
 */
async function post(body: unknown): Promise<unknown> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    // `redirect: follow` is the default and is load-bearing here: Apps Script
    // answers a web app POST with a 302 to googleusercontent.com, and the JSON
    // is on the far side of it.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  return await res.json() as unknown;
}

/**
 * A session ping: this pass opened the game, now.
 *
 * Fire-and-forget, and it carries no code — the pass holds an id, not a secret,
 * so a ping cannot be replayed into an admission. It is telemetry, not
 * authorisation: a forged ping adds a junk row to a session tab and cannot get
 * anybody through the door.
 */
function pingSession(pass: Pass, game: string): void {
  const body = JSON.stringify({ kind: 'session', game, id: pass.id, name: pass.name });
  try {
    // sendBeacon survives the page going busy loading a few megabytes of game,
    // which a plain fetch on the boot path may not.
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    if (navigator.sendBeacon(ENDPOINT, blob)) return;
  } catch { /* fall through to fetch */ }
  void fetch(ENDPOINT, {
    method: 'POST', keepalive: true,
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body,
  }).catch(() => { /* the log is never worth failing a boot over */ });
}

// ---------- the invite in the address bar ----------

/** The code an invite link carries, if this is one. */
function codeFromUrl(): string | null {
  try {
    const v = new URL(location.href).searchParams.get(INVITE_PARAM);
    return v && v.trim() !== '' ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Take the code back out of the address bar once it has been spent.
 *
 * An invite link is a small secret and the address bar is the least private
 * place on a computer: it is screenshotted, read over shoulders, bookmarked,
 * autocompleted and pasted into group chats by people meaning to share the
 * game rather than their own invite. Wiping it costs nothing — the pass is
 * already stored by the time this runs — and the friend is left on a clean URL
 * they can share freely.
 */
function stripInviteFromUrl(): void {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has(INVITE_PARAM)) return;
    url.searchParams.delete(INVITE_PARAM);
    history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
  } catch { /* an exotic URL is not worth failing a boot over */ }
}

// ---------- the screen ----------

/**
 * The door's own styles, injected rather than living in `src/ui/style.css`.
 * Two reasons: the workbench page loads no stylesheet at all and gets the same
 * door for free, and the door has to stand on its own in another game.
 */
const CSS = `
.gate-veil {
  position: fixed; inset: 0; z-index: 9000;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
  background: radial-gradient(ellipse at 50% 35%, #2a2118 0%, #0b0908 70%);
  font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #e8dcc8;
  text-align: center; padding: 24px;
}
.gate-veil h1 {
  font-size: clamp(22px, 4.2vw, 40px); font-weight: 600; letter-spacing: 0.14em;
  text-transform: uppercase; color: #d8b25a; margin-bottom: 2px;
}
.gate-veil p, .gate-veil .gate-blurb { max-width: 30rem; line-height: 1.55; font-size: 14px; color: #b9ac95; }
.gate-veil .gate-slot { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
.gate-veil input {
  background: rgba(12,10,8,0.75); border: 1px solid #6f5a30; border-radius: 3px;
  color: #f0e6d2; font: inherit; font-size: 15px; letter-spacing: 0.12em;
  text-transform: uppercase; padding: 9px 14px; width: 15rem; text-align: center;
}
.gate-veil input:focus { outline: none; border-color: #d8b25a; }
.gate-veil button {
  background: linear-gradient(180deg, #8a6f38, #5c4a25); border: 1px solid #6f5a30;
  color: #f0e6d2; font: inherit; font-size: 14px; padding: 9px 18px; border-radius: 3px; cursor: pointer;
}
.gate-veil button:hover { background: linear-gradient(180deg, #d8b25a, #8a6f38); }
.gate-veil button:disabled { opacity: 0.5; cursor: default; }
.gate-veil .gate-note { font-size: 12px; color: #7d7365; max-width: 26rem; min-height: 1.2em; }
.gate-veil .gate-bad { color: #e08a6a; }
@media (prefers-reduced-motion: no-preference) {
  .gate-veil { animation: gate-in 160ms ease-out; }
  @keyframes gate-in { from { opacity: 0 } to { opacity: 1 } }
}
`;

interface Door {
  veil: HTMLDivElement;
  slot: HTMLDivElement;
  note: HTMLParagraphElement;
  close(): void;
}

function buildDoor(opts: GateOptions): Door {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const veil = document.createElement('div');
  veil.className = 'gate-veil';
  // textContent for the two host-supplied strings: they are configuration, and
  // configuration should not be able to inject markup into the page.
  veil.innerHTML = '<h1></h1><p class="gate-blurb"></p><div class="gate-slot"></div><p class="gate-note"></p>';
  veil.querySelector('h1')!.textContent = opts.title;
  veil.querySelector<HTMLParagraphElement>('.gate-blurb')!.textContent = opts.blurb;
  document.body.appendChild(veil);

  return {
    veil,
    slot: veil.querySelector<HTMLDivElement>('.gate-slot')!,
    note: veil.querySelector<HTMLParagraphElement>('.gate-note')!,
    close() { veil.remove(); style.remove(); },
  };
}

// ---------- the gate ----------

/**
 * Resolves when the player may pass. Never rejects: a door that throws on the
 * boot path is a white screen, so every failure ends at a retry rather than an
 * exception.
 */
export function openGate(opts: GateOptions): Promise<void> {
  if (opts.endpoint !== undefined) ENDPOINT = opts.endpoint;
  if (!gateEnabled()) return Promise.resolve();

  const pass = readPass();
  if (pass) {
    // The whole point: a returning friend never waits on the network, and the
    // session ping goes out behind the game already loading.
    pingSession(pass, opts.game);
    stripInviteFromUrl();   // a friend re-using their old link keeps a clean bar
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const door = buildDoor(opts);
    let settled = false;

    // The door is up and the connection is idle: start pulling. Refusing a
    // visitor aborts this; being admitted deliberately does not, because the
    // whole point is that the files are already coming when the game starts.
    const warming = new AbortController();
    try { opts.warm?.(warming.signal); } catch (e) { console.warn('[gate] warm hook threw', e); }

    const admit = (p: Pass) => {
      if (settled) return;
      settled = true;
      writePass(p);
      pingSession(p, opts.game);
      stripInviteFromUrl();
      door.close();
      resolve();
    };

    // ---- the form, for anyone who arrives without a link ----
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'invite code';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'invite code');
    const go = document.createElement('button');
    go.textContent = 'Enter';
    door.slot.append(input, go);

    const submit = () => {
      const code = input.value.trim();
      if (code === '') { input.focus(); return; }
      void redeem(code, { door, opts, admit, warming, input, go });
    };
    go.onclick = submit;
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };

    const fromLink = codeFromUrl();
    if (fromLink) {
      // An invite link spends itself. Nothing to click, nothing to type — the
      // form stays in the page underneath so that a bad code lands somewhere
      // the visitor can correct it.
      input.value = fromLink;
      void redeem(fromLink, { door, opts, admit, warming, input, go });
    } else {
      input.focus();
    }
  });
}

interface RedeemCtx {
  door: Door;
  opts: GateOptions;
  admit: (p: Pass) => void;
  warming: AbortController;
  input: HTMLInputElement;
  go: HTMLButtonElement;
}

/** Ask the endpoint whether this code belongs to somebody on the list. */
async function redeem(code: string, ctx: RedeemCtx): Promise<void> {
  const { door, opts, admit, warming, input, go } = ctx;
  const busy = (on: boolean) => { input.disabled = on; go.disabled = on; };
  busy(true);
  door.note.className = 'gate-note';
  door.note.textContent = 'Checking your invite…';
  try {
    const r = await post({ kind: 'invite', game: opts.game, code }) as {
      ok?: boolean; id?: string; name?: string; reason?: string;
    };
    if (r.ok && typeof r.id === 'string' && r.id !== '') {
      admit({ id: r.id, name: r.name ?? r.id, since: Date.now() });
      return;
    }
    // A real answer that says no. An unrecognised code is the expected case,
    // and it is worth saying plainly rather than looking like a bug. Warming
    // stops here: this is the one visitor who should not be sent a game.
    warming.abort();
    busy(false);
    door.note.className = 'gate-note gate-bad';
    door.note.textContent = r.reason === 'revoked'
      ? 'That invite has been turned off. Ask for a new one.'
      : "That invite code isn't recognised. Check it, or ask for a new one.";
    input.focus();
    input.select();
  } catch {
    // No answer at all. This does NOT open the door: the endpoint is the guest
    // list, and admitting everyone whenever a request fails would make the list
    // optional for anyone able to drop one. A friend who is already in holds a
    // pass and never reaches this.
    busy(false);
    door.note.className = 'gate-note gate-bad';
    door.note.textContent = 'Could not reach the guest list just now. Try again in a moment.';
    input.focus();
  }
}
