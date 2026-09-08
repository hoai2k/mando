/**
 * The door: a one-time Google sign-in in front of the game.
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
 * THE DESIGN CONSTRAINT IS "FRIENDS SEE THIS ONCE." Everything else bends to
 * that:
 *
 *  - The pass is written to localStorage with NO EXPIRY. A friend signs in on
 *    a browser and that browser never asks again. An expiry would only be
 *    security theatre on a door that is already a doorman.
 *  - When the pass *is* missing — a new device, cleared site data, or Safari's
 *    ITP, which drops script-written storage after seven days without a visit
 *    — Google's One Tap is asked to re-establish it with `auto_select`. For
 *    anyone already signed into Google in that browser that is silent and
 *    click-free: the door flashes and the title screen arrives. They are never
 *    asked for a password by us or by Google; the worst case is picking their
 *    account from a card.
 *  - The button is rendered anyway, underneath, because One Tap can decline to
 *    show (its own cooldown after dismissals, or no Google session at all) and
 *    a door with nothing to click is a locked door.
 *
 * UNSET MEANS OPEN. With no client ID and no endpoint compiled in, `openGate`
 * resolves immediately and this file may as well not exist. That is the state
 * of every dev server and every browser suite in `tools/`, which is why none of
 * them had to learn about logging in — and it is also the safe failure mode for
 * a deploy that loses its configuration: the site keeps working, it just stops
 * counting.
 */

/** What we keep about a friend who has been let in. No expiry, by design. */
export interface Pass {
  /** Google's stable account id. The only field the log joins on. */
  sub: string;
  email: string;
  name: string;
  picture?: string;
  /** When this browser first got in, for the owner's curiosity only. */
  since: number;
}

/** One key, in the `mando.*` namespace the rest of the settings use. */
const PASS_STORE = 'mando.pass';

const CLIENT_ID = import.meta.env.VITE_GATE_CLIENT_ID ?? '';
const ENDPOINT = import.meta.env.VITE_GATE_ENDPOINT ?? '';

/** Configured means gated. Either value missing leaves the door standing open. */
export function gateEnabled(): boolean {
  return CLIENT_ID !== '' && ENDPOINT !== '';
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
    if (typeof p.sub !== 'string' || p.sub === '') return null;
    if (typeof p.email !== 'string') return null;
    return {
      sub: p.sub,
      email: p.email,
      name: typeof p.name === 'string' ? p.name : p.email,
      picture: typeof p.picture === 'string' ? p.picture : undefined,
      since: typeof p.since === 'number' ? p.since : Date.now(),
    };
  } catch {
    return null;  // private mode, or storage disabled entirely
  }
}

function writePass(p: Pass): void {
  try { localStorage.setItem(PASS_STORE, JSON.stringify(p)); } catch { /* private mode */ }
}

/** Used by the pause menu's "sign out", and by anyone debugging the door. */
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
 * Deliberately fire-and-forget and deliberately UNVERIFIED — there is no fresh
 * Google token on a returning visit (they last an hour; the pass lasts
 * forever) so this is the stored profile taken at its word. It is telemetry,
 * not authorisation: a forged ping can add a junk row to the log's session
 * tab and cannot get anybody through the door. `signin` rows are the verified
 * ones; those are the guest list.
 */
function pingSession(pass: Pass): void {
  const body = JSON.stringify({ kind: 'session', sub: pass.sub, email: pass.email, name: pass.name });
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

// ---------- Google Identity Services ----------

/** The slice of the GIS global this file touches. */
interface GsiCredential { credential?: string }
interface GsiId {
  initialize(opts: {
    client_id: string;
    callback: (r: GsiCredential) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    itp_support?: boolean;
    use_fedcm_for_prompt?: boolean;
  }): void;
  prompt(): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
}
declare global {
  interface Window { google?: { accounts?: { id?: GsiId } } }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

function loadGsi(): Promise<GsiId> {
  return new Promise((resolve, reject) => {
    const done = () => {
      const id = window.google?.accounts?.id;
      if (id) resolve(id); else reject(new Error('GIS loaded without accounts.id'));
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) { existing.addEventListener('load', done); existing.addEventListener('error', () => reject(new Error('GIS blocked'))); return; }
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.onload = done;
    s.onerror = () => reject(new Error('GIS blocked'));
    document.head.appendChild(s);
  });
}

// ---------- the screen ----------

/**
 * The door's own styles, injected rather than living in `src/ui/style.css`.
 * Two reasons: the workbench page loads no stylesheet at all and gets the same
 * door for free, and a stranger who never signs in downloads this one file
 * instead of the game's CSS.
 */
const CSS = `
.gate-veil {
  position: fixed; inset: 0; z-index: 9000;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
  background: radial-gradient(ellipse at 50% 35%, #2a2118 0%, #0b0908 70%);
  font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #e8dcc8;
  text-align: center; padding: 24px;
}
.gate-veil h1 {
  font-size: clamp(22px, 4.2vw, 40px); font-weight: 600; letter-spacing: 0.14em;
  text-transform: uppercase; color: #d8b25a; margin-bottom: 2px;
}
.gate-veil p { max-width: 30rem; line-height: 1.55; font-size: 14px; color: #b9ac95; }
.gate-veil .gate-slot { min-height: 44px; display: flex; align-items: center; justify-content: center; }
.gate-veil .gate-note { font-size: 12px; color: #7d7365; max-width: 26rem; }
.gate-veil .gate-bad { color: #e08a6a; }
.gate-veil .gate-retry {
  background: linear-gradient(180deg, #8a6f38, #5c4a25); border: 1px solid #6f5a30;
  color: #f0e6d2; font: inherit; font-size: 14px; padding: 8px 18px; border-radius: 3px; cursor: pointer;
}
.gate-veil .gate-retry:hover { background: linear-gradient(180deg, #d8b25a, #8a6f38); }
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

function buildDoor(): Door {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const veil = document.createElement('div');
  veil.className = 'gate-veil';
  veil.innerHTML = `
    <h1>Bounty Hunters</h1>
    <p>This one is for friends. Sign in with Google once and this browser
       won't ask again.</p>
    <div class="gate-slot"></div>
    <p class="gate-note"></p>
  `;
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
 * boot path is a white screen, so every failure ends either at a retry button
 * or — when the door itself is broken rather than the visitor — wide open.
 */
export function openGate(): Promise<void> {
  if (!gateEnabled()) return Promise.resolve();

  const pass = readPass();
  if (pass) {
    // The whole point: a returning friend never waits on the network, and the
    // session ping goes out behind the game already loading.
    pingSession(pass);
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const door = buildDoor();
    let settled = false;
    const admit = (p: Pass) => {
      if (settled) return;
      settled = true;
      writePass(p);
      pingSession(p);
      door.close();
      resolve();
    };
    /**
     * Used only when the DOOR is broken — the GIS script blocked by an
     * extension or a network that cannot reach Google. Turning friends away
     * because our own machinery failed is the wrong trade for a doorman: it
     * costs a real player their evening to stop a stranger who could have
     * edited localStorage anyway.
     */
    const openWide = (why: string) => {
      if (settled) return;
      settled = true;
      console.warn(`[gate] letting everyone through: ${why}`);
      door.close();
      resolve();
    };

    const onCredential = (r: GsiCredential) => {
      const token = r.credential;
      if (!token) { door.note.className = 'gate-note gate-bad'; door.note.textContent = 'Google sent nothing back. Try again?'; return; }
      door.note.className = 'gate-note';
      door.note.textContent = 'Checking the guest list…';
      void verify(token, door, admit);
    };

    loadGsi().then((gsi) => {
      gsi.initialize({
        client_id: CLIENT_ID,
        callback: onCredential,
        // The three flags that make this a once-ever prompt rather than a
        // login: pick the account automatically when there is one and it has
        // been used here before, keep working under Safari's ITP, and use
        // FedCM, which is where One Tap now lives.
        auto_select: true,
        itp_support: true,
        use_fedcm_for_prompt: true,
        // There is nothing behind the door to click at, so a stray tap
        // dismissing the prompt would just strand them on the button.
        cancel_on_tap_outside: false,
      });
      // Both, always. `prompt()` is the silent path and often the only thing a
      // returning friend sees; the button is what is left when One Tap is in
      // its cooldown or the browser has no Google session to offer.
      gsi.renderButton(door.slot, {
        type: 'standard', theme: 'filled_black', size: 'large',
        text: 'continue_with', shape: 'pill', logo_alignment: 'left',
      });
      gsi.prompt();
    }).catch((e: unknown) => openWide(`Google's script did not load (${String(e)})`));
  });
}

/** Ask the endpoint whether this token belongs to somebody on the list. */
async function verify(token: string, door: Door, admit: (p: Pass) => void): Promise<void> {
  try {
    const r = await post({ kind: 'signin', credential: token }) as {
      ok?: boolean; sub?: string; email?: string; name?: string; picture?: string; reason?: string;
    };
    if (r.ok && typeof r.sub === 'string' && typeof r.email === 'string') {
      admit({
        sub: r.sub, email: r.email, name: r.name ?? r.email,
        picture: r.picture, since: Date.now(),
      });
      return;
    }
    // A real answer that says no. Not on the list is the expected case, and it
    // is worth saying plainly rather than looking like a bug.
    door.note.className = 'gate-note gate-bad';
    door.note.textContent = r.reason === 'not-listed'
      ? `${r.email ?? 'That account'} isn't on the guest list. Ask for an invite and try again.`
      : 'Google could not confirm that sign-in. Try again?';
  } catch {
    // No answer at all. Unlike a broken GIS script this does NOT open the
    // door: the endpoint is the guest list, and admitting everyone whenever a
    // request fails would make the list optional for anyone who can drop one.
    // A friend who is already in has their pass and never reaches this.
    door.note.className = 'gate-note gate-bad';
    door.note.textContent = 'Could not reach the guest list just now. Try again in a moment.';
    const retry = document.createElement('button');
    retry.className = 'gate-retry';
    retry.textContent = 'Try again';
    retry.onclick = () => { retry.remove(); door.note.textContent = 'Checking the guest list…'; void verify(token, door, admit); };
    door.note.after(retry);
  }
}
