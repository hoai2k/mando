/**
 * Asset warming: fetch the heavy files before the moment they are needed, in
 * the gaps where the player is reading a menu rather than playing.
 *
 * Two halves, deliberately separate:
 *
 * - **The tracker** knows what is in flight and how far along it is. Every
 *   authored load in the game reports here — models through the glTF loader's
 *   progress events, textures as they start and finish — so a loading screen
 *   can ask "is anything still coming, and how much of it?" without anyone
 *   having to hand it a list. Correctness lives here: what is pending is
 *   whatever actually asked to load.
 * - **The queue** decides what to start early and when. It runs a small number
 *   of fetches at a time and, for anything not urgent, waits for the browser to
 *   report idle first, so warming never competes with a menu's animation. Its
 *   requests are hints: getting them wrong costs a download, never a wrong
 *   picture.
 *
 * Warming only has to put a file in the browser's HTTP cache. The real loaders
 * run later exactly as they always did and find their bytes already there.
 */

/** rough sizes, used for the progress bar until the server tells us better */
const ESTIMATE_MODEL = 3_400_000;
const ESTIMATE_SKY = 900_000;
const ESTIMATE_TEXTURE = 260_000;

export type WarmPriority = 'now' | 'soon' | 'idle';
const ORDER: WarmPriority[] = ['now', 'soon', 'idle'];

/**
 * How long to wait before each re-attempt of a file that failed for a reason
 * that might not repeat — a dropped connection, a proxy hiccup, a 5xx.
 *
 * One policy, shared by the model intake and the texture intake, because it is
 * one judgement: these run while the player is fighting, sharing the connection
 * with a match already pulling in its own scenery, so they hang well back; and
 * a file that has missed five times across two and a half minutes is not
 * coming, so whatever fell back keeps what it is standing in and the game stops
 * asking. Absence is *not* one of these cases — a 404 is an answer, and neither
 * intake retries one.
 */
export const RETRY_DELAYS = [3, 8, 20, 45, 90];

/** How much of a file has arrived, and whether it got there. */
interface Item {
  key: string;
  total: number;
  loaded: number;
  /** known = the server gave a length, so `total` is not a guess */
  known: boolean;
  done: boolean;
  failed: boolean;
  waiters: Array<() => void>;
}

/** guess a size from what the path looks like, for the bar's benefit */
function estimate(key: string): number {
  if (key.endsWith('.glb')) return ESTIMATE_MODEL;
  if (/\bsky_/.test(key)) return ESTIMATE_SKY;
  return ESTIMATE_TEXTURE;
}

class AssetTracker {
  private items = new Map<string, Item>();

  private item(key: string): Item {
    let it = this.items.get(key);
    if (!it) {
      it = { key, total: estimate(key), loaded: 0, known: false, done: false, failed: false, waiters: [] };
      this.items.set(key, it);
    }
    return it;
  }

  /**
   * Register a load that is starting now. The handle is how the loader reports
   * back; calling `finish` twice is harmless, which matters because a texture
   * that falls back from .jpg to .png reports one logical load across two
   * requests.
   */
  start(key: string): { progress: (loaded: number, total: number) => void; finish: (ok: boolean) => void } {
    const it = this.item(key);
    // A second load of a file we already have is a cache hit: leave it finished
    // rather than dropping the bar back to zero for the millisecond it takes.
    if (it.done && !it.failed) return { progress: () => {}, finish: () => {} };
    if (it.done) { it.done = false; it.failed = false; it.loaded = 0; }   // a failure, retried
    return {
      progress: (loaded, total) => {
        it.loaded = loaded;
        if (total > 0) { it.total = total; it.known = true; }
      },
      finish: (ok) => {
        if (it.done) return;
        it.done = true;
        it.failed = !ok;
        it.loaded = it.total;
        for (const w of it.waiters) w();
        it.waiters.length = 0;
      },
    };
  }

  /** True once this file has been asked for at all. */
  seen(key: string): boolean { return this.items.has(key); }
  /** True once it has arrived — or failed, which is also "no longer coming". */
  settled(key: string): boolean { return this.items.get(key)?.done ?? false; }
  failed(key: string): boolean { return this.items.get(key)?.failed ?? false; }

  /**
   * Progress over a set of files, byte-weighted so a 4 MB model does not
   * count the same as a 40 KB decal, plus how many are still coming.
   *
   * Files nobody has started yet still count toward the total at their
   * estimated size: a bar that ignores them would sit at 100% and then jump
   * backwards the moment one starts.
   */
  progress(keys: string[]): { ratio: number; pending: number; failed: number; bytes: number; total: number } {
    let loaded = 0;
    let total = 0;
    let pending = 0;
    let failed = 0;
    for (const key of keys) {
      const it = this.items.get(key);
      if (!it) { total += estimate(key); pending++; continue; }
      loaded += it.done ? it.total : Math.min(it.loaded, it.total);
      total += it.total;
      if (!it.done) pending++;
      if (it.failed) failed++;
    }
    return { ratio: total > 0 ? Math.min(1, loaded / total) : 1, pending, failed, bytes: loaded, total };
  }

  /** Everything in flight right now, whoever asked for it. */
  inFlight(): string[] {
    const out: string[] = [];
    for (const [key, it] of this.items) if (!it.done) out.push(key);
    return out;
  }

  /** Resolve once every one of these files has arrived or failed. */
  settle(keys: string[]): Promise<void> {
    const waits = keys
      .filter((k) => !this.settled(k))
      .map((k) => new Promise<void>((resolve) => this.item(k).waiters.push(resolve)));
    return Promise.all(waits).then(() => undefined);
  }
}

export const tracked = new AssetTracker();

/** run a callback when the browser is idle, or soon, where that does not exist */
function onIdle(fn: () => void): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
    .requestIdleCallback;
  if (ric) ric(fn, { timeout: 1200 });
  else setTimeout(fn, 60);
}

interface Job {
  key: string;
  priority: WarmPriority;
  start: () => Promise<unknown>;
}

class WarmQueue {
  private queued: Job[] = [];
  private started = new Set<string>();
  private running = 0;
  /**
   * Two at a time. Warming shares the connection with whatever the game is
   * loading for real, and a queue of ten 4 MB models saturating it would make
   * the thing the player is actually waiting for arrive last.
   */
  private readonly limit = 2;

  /**
   * Ask for a file early. Repeat requests only ever raise its priority — the
   * character select asking again for what the title screen already queued
   * must not download it twice.
   */
  want(key: string, priority: WarmPriority, start: () => Promise<unknown>): void {
    if (this.started.has(key) || tracked.settled(key)) return;
    const queued = this.queued.find((j) => j.key === key);
    if (queued) {
      if (ORDER.indexOf(priority) < ORDER.indexOf(queued.priority)) queued.priority = priority;
      return;
    }
    this.queued.push({ key, priority, start });
    this.pump();
  }

  private pump(): void {
    if (this.running >= this.limit || this.queued.length === 0) return;
    // a stable sort, and deliberately so: the planner queues near screens before
    // far ones, and that order is what ranks everything sharing a priority
    this.queued.sort((a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority));
    const job = this.queued.shift()!;
    this.running++;
    this.started.add(job.key);
    const go = () => {
      job.start().catch(() => { /* a warm miss is not an error: the real load will say so */ })
        .then(() => {
          this.running--;
          this.pump();
        });
    };
    // urgent work goes now; everything else waits for a gap in the frame
    if (job.priority === 'now') go();
    else onIdle(go);
    this.pump();
  }

  /** How many warm requests are still outstanding, for tests and debugging. */
  outstanding(): number { return this.queued.length + this.running; }
}

export const warmQueue = new WarmQueue();

/**
 * Pull a file into the browser cache, counting bytes as they arrive.
 *
 * The body has to be read to the end or the browser will not keep it, and
 * reading it in chunks is what gives the loading bar something honest to show
 * for a multi-megabyte panorama.
 */
export function warmImage(url: string, key = `warm:${url}`): Promise<void> {
  // Warmed through an <img>, not fetch(), because that is how the pictures
  // this is for will really be asked for later: the portraits, territory cards
  // and planet discs the page draws, through an <img> or through CSS. A fetch
  // lands in a different cache bucket, so warming that way downloads every one
  // of them twice. (The surfaces three wears go the other way — they come in
  // through `loadAuthoredImage`, which fetches them for the status, and are
  // warmed by `warmFetch` to match.)
  const handle = tracked.start(key);
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => { handle.finish(true); resolve(); };
    img.onerror = () => { handle.finish(false); resolve(); };
    img.src = url;
  });
}

export async function warmFetch(url: string, key = `warm:${url}`): Promise<void> {
  // Warm fetches track under a key of their own. The logical file belongs to
  // the loader that will really use it: a texture attempted as .jpg and found
  // as .png must not be marked "failed, stop waiting for it" by a speculative
  // fetch that guessed the wrong extension.
  const handle = tracked.start(key);
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) { handle.finish(false); return; }
    const total = Number(res.headers.get('content-length') ?? 0);
    handle.progress(0, total);
    const body = res.body;
    if (!body) { await res.arrayBuffer(); handle.finish(true); return; }
    const reader = body.getReader();
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value?.byteLength ?? 0;
      handle.progress(loaded, total);
    }
    handle.finish(true);
  } catch {
    handle.finish(false);
  }
}
