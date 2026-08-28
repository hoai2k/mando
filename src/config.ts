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

export interface Config {
  audio: AudioConfig;
  input: InputConfig;
  camera: CameraConfig;
}

export const config: Config = {
  input: { keyboardMouse: false },
  camera: { dynamic: true },
  audio: {
    master: 0.8,
    // SFX sit well under the score: a busy wave puts a lot of blaster fire on
    // the sfx bus at once, and it swamped the music at anything higher.
    sfx: 0.25,
    music: 0.75,
  },
};

/** Volume keys the player can persist, stored under this localStorage key. */
const STORE = 'mando.audio';
/** Input preferences, stored separately so a stale audio blob can't clobber them. */
const INPUT_STORE = 'mando.input';
/** Camera preferences, same reasoning: one key per group of settings. */
const CAMERA_STORE = 'mando.camera';

/** Merge any saved volume preferences over the defaults above. */
export function loadSavedConfig(): void {
  try {
    const raw = localStorage.getItem(STORE);
    // no early return: each group loads independently, so a player who has
    // never touched the volumes still gets their input and camera preferences
    const saved = raw ? JSON.parse(raw) as Partial<AudioConfig> : null;
    if (saved) {
      for (const k of ['master', 'sfx', 'music'] as const) {
        const v = saved[k];
        if (typeof v === 'number' && v >= 0 && v <= 1) config.audio[k] = v;
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
    localStorage.setItem(STORE, JSON.stringify(config.audio));
  } catch {
    // private browsing / blocked storage — the session still honours the values
  }
}
