/**
 * Game tunables that are worth changing without reading the engine.
 *
 * Everything here is read at runtime rather than baked in, so a value can also
 * be overridden per-player from the browser console or a saved preference:
 *
 *     config.audio.sfx = 0.2;   audio.applyConfig();
 *
 * Volumes are linear gains on their bus. `master` scales everything, and `sfx`
 * and `music` scale their own group under it, so the two can be balanced
 * against each other without touching individual sounds.
 */
export interface AudioConfig {
  /** everything, 0–1 */
  master: number;
  /** weapons, impacts, footsteps, voices, jetpack, UI */
  sfx: number;
  /** score and ambience beds */
  music: number;
}

export interface InputConfig {
  /**
   * Off by default: the game is built around a controller, and while the
   * keyboard and mouse path exists it stays out of the way — no pointer lock
   * while playing, and no keyboard bindings shown in the controls — until
   * someone turns it on in Settings.
   */
  keyboardMouse: boolean;
}

export interface CameraConfig {
  /**
   * On by default: the chase distance drifts in when the player is still or
   * moving slowly (the character and the space around them are what matters)
   * and out when they sprint, dash or fly (where they are going matters more).
   * Off falls back to the single distance the right stick dials in, which is
   * what the dolly set before this existed.
   */
  dynamic: boolean;
}

/**
 * How split-screen divides the window between players.
 *
 * `stacked` is the couch default and what the game has always done: players
 * are laid out in rows, so two get a wide letterbox each — the shape that
 * suits a shared TV. `columns` is the transpose, for anyone playing on a tall
 * or portrait display, or who simply prefers a taller, narrower view: two
 * players sit side by side instead. The two describe an axis rather than a
 * fixed picture, so they scale to any number of players — with four the grid
 * is square either way, and only three tell the difference by which edge the
 * odd player takes.
 */
export type SplitMode = 'stacked' | 'columns';

export interface VideoConfig {
  split: SplitMode;
}

export interface Config {
  audio: AudioConfig;
  input: InputConfig;
  camera: CameraConfig;
  video: VideoConfig;
}

export const config: Config = {
  input: { keyboardMouse: false },
  camera: { dynamic: true },
  video: { split: 'stacked' },
  audio: {
    // The buses run at the ceiling: `master` and `music` at unity, with SFX
    // holding the same one-third balance under the score they always had (a
    // busy wave puts a lot of blaster fire on the sfx bus at once, and it
    // swamped the music at anything higher). Everything is 1.67x its old
    // level — the same lift on every sound, so nothing is remixed against
    // anything else — and the master bus leaves through a limiter, so the
    // peaks that summing at these gains would have clipped are caught rather
    // than crackling. See AUDIO_GAIN in `src/core/audio.ts`.
    master: 1,
    sfx: 1 / 3,
    music: 1,
  },
};

/** Volume keys the player can persist, stored under this localStorage key. */
const STORE = 'mando.audio';
/**
 * Saved-volume format. v2 is the louder mix (2026-09-02): every bus went up by
 * `GAIN_BUMP`, which a blob saved before it does not know about — so a player
 * who had ever touched a slider would have been the only one who *didn't* hear
 * the change. Their settings are scaled by the same factor on the way in, so
 * the balance they chose survives at the new loudness.
 */
const STORE_VERSION = 2;
/** how much louder v2 is than v1, on every bus alike */
const GAIN_BUMP = 5 / 3;
/** Input preferences, stored separately so a stale audio blob can't clobber them. */
const INPUT_STORE = 'mando.input';
/** Camera preferences, same reasoning: one key per group of settings. */
const CAMERA_STORE = 'mando.camera';
/** Screen preferences (the split-screen layout). */
const VIDEO_STORE = 'mando.video';

/** Merge any saved volume preferences over the defaults above. */
export function loadSavedConfig(): void {
  try {
    const raw = localStorage.getItem(STORE);
    // no early return: each group loads independently, so a player who has
    // never touched the volumes still gets their input and camera preferences
    const saved = raw ? JSON.parse(raw) as Partial<AudioConfig> & { v?: number } : null;
    if (saved) {
      const keys = ['master', 'sfx', 'music'] as const;
      const kept: Partial<AudioConfig> = {};
      for (const k of keys) {
        const v = saved[k];
        if (typeof v === 'number' && v >= 0 && v <= 1) kept[k] = v;
      }
      // A blob from before the louder mix is rescaled rather than ignored, and
      // every bus by the same factor, so the balance the player chose survives
      // exactly: the lift stops at whatever their loudest bus can still take,
      // which keeps a deliberately quiet mix quieter than the default instead
      // of clamping it up into one.
      let scale = 1;
      if ((saved.v ?? 1) < STORE_VERSION) {
        const loudest = Math.max(0, ...keys.map((k) => kept[k] ?? 0));
        scale = loudest > 0 ? Math.min(GAIN_BUMP, 1 / loudest) : GAIN_BUMP;
      }
      for (const k of keys) {
        const v = kept[k];
        if (v !== undefined) config.audio[k] = Math.min(1, v * scale);
      }
    }
  } catch {
    // a corrupt or blocked store is not worth failing a game boot over
  }
  try {
    const raw = localStorage.getItem(INPUT_STORE);
    const saved = raw ? JSON.parse(raw) as Partial<InputConfig> : null;
    if (saved && typeof saved.keyboardMouse === 'boolean') config.input.keyboardMouse = saved.keyboardMouse;
  } catch {
    // same
  }
  try {
    const raw = localStorage.getItem(CAMERA_STORE);
    const saved = raw ? JSON.parse(raw) as Partial<CameraConfig> : null;
    if (saved && typeof saved.dynamic === 'boolean') config.camera.dynamic = saved.dynamic;
  } catch {
    // same
  }
  try {
    const raw = localStorage.getItem(VIDEO_STORE);
    const saved = raw ? JSON.parse(raw) as Partial<VideoConfig> : null;
    if (saved && (saved.split === 'stacked' || saved.split === 'columns')) config.video.split = saved.split;
  } catch {
    // same
  }
}

/** Persist the screen preferences so they survive a reload. */
export function saveVideoConfig(): void {
  try {
    localStorage.setItem(VIDEO_STORE, JSON.stringify(config.video));
  } catch {
    // private browsing / blocked storage — the session still honours the values
  }
}

/** Persist the camera preferences so they survive a reload. */
export function saveCameraConfig(): void {
  try {
    localStorage.setItem(CAMERA_STORE, JSON.stringify(config.camera));
  } catch {
    // private browsing / blocked storage — the session still honours the values
  }
}

/** Persist the input preferences so they survive a reload. */
export function saveInputConfig(): void {
  try {
    localStorage.setItem(INPUT_STORE, JSON.stringify(config.input));
  } catch {
    // private browsing / blocked storage — the session still honours the values
  }
}

/** Persist the current volumes so they survive a reload. */
export function saveAudioConfig(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify({ v: STORE_VERSION, ...config.audio }));
  } catch {
    // private browsing / blocked storage — the session still honours the values
  }
}
