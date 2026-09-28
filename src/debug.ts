/**
 * Debug and test hooks: every `window.__*` handle the app hangs off the page,
 * in one typed place.
 *
 * These are what the browser suites in `tools/` drive the game through — start
 * a match without walking the menus, take the clock, read the state, build one
 * of anything on a bench — and what a person at the console reaches for. They
 * used to be set with a separate `window as unknown as {…}` cast apiece, each
 * typed `unknown`, in three different styles; a hook renamed on one side of
 * that cast kept compiling and simply stopped existing on the other.
 *
 * The names are a contract with the suites, not an implementation detail:
 * `grep __ tools/*.mjs` before renaming or dropping one.
 *
 * Everything here is `import type`, so this file costs the bundle nothing and
 * pulls no module into the page that the page did not already load.
 */
import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Config } from './config';
import type { AudioEngine, VOICES } from './core/audio';
import type { FrameInput, InputManager } from './core/input';
import type { BOARD_PROPS } from './core/prefetch';
import type { enemyBody, enemyHitParts, enemyStats, EnemyKind } from './enemies/enemy';
import type { MandoId } from './characters/mandalorians';
import type { PlayableId, playableDef } from './characters/roster';
import type { Game } from './game/game';
import type { GameMode } from './game/modes';
import type { AppState } from './main';
import type { CharacterSelect, PosterShot } from './ui/charselect';
import type { VsScreen } from './ui/vs';
import type { Board } from './world/board';
import type { BOARDS } from './world/boards';
import type { fitStats } from './world/collide';
import type { ZoneSpec } from './world/mission';
import type { Figure } from './workbench/main';
import type { Pose } from './workbench/poses';
import type { Subject } from './workbench/roster';

/** one of `tools/harness.mjs`'s shimmed controllers, as `navigator.getGamepads()` reads it */
export interface HarnessPadState {
  /** per standard-mapping button: 0 up, 1 down, anything between for a trigger */
  buttons: number[];
  axes: number[];
  connected: boolean;
}

/** A body on the hitbox bench as it actually renders (see `__bodySize`). */
export interface BodySample {
  nodes: number;
  min: [number, number, number];
  max: [number, number, number];
  /** a downsampled point cloud, flat xyz, in the body's local frame */
  pts: number[];
  /** each point's share of the body's bulk, one per point */
  wts: number[];
}

/** One zone of one territory's run, flattened (see `__missionZones`). */
export interface MissionZoneRow {
  board: string;
  stage: number;
  label: ZoneSpec['label'];
  shell: ZoneSpec['shell'];
  kind: ZoneSpec['kind'];
  waves: number | null;
  /** open ground that is not a siege: the depth of its posted force */
  garrison: number | null;
  siege: boolean;
  pass: boolean;
  deadEnd: boolean;
  w: number;
  l: number;
  rides: string[];
}

export interface DebugHooks {
  // ---- set by the game (src/main.ts) ----

  /** live tunables: `__config.audio.sfx = 0.2; __audio.applyConfig(); __saveAudio();` */
  __config: Config;
  __audio: AudioEngine;
  __saveAudio: () => void;
  __saveCamera: () => void;

  /** the app screen currently up; 'playing' the moment a drop finishes */
  __state: AppState;
  /** the running match, and null once it is torn down (never a stale one) */
  __game: Game | null;
  __charsel: CharacterSelect;
  __vs: VsScreen;
  __input: InputManager;
  __renderer: THREE.WebGLRenderer;
  __boards: typeof BOARDS;
  __voices: typeof VOICES;
  /** the playable roster, so a test never hardcodes a character's name or count */
  __roster: Array<{ id: MandoId; name: string }>;
  /** the widened PvP roster */
  __pvpRoster: PlayableId[];
  __enemyKinds: EnemyKind[];

  /** put the territory select's focus on card `i` */
  __selectFocus: (i: number) => void;
  /** the .glb loads still in the air */
  __loading: () => string[];
  /** a wave's spawn positions, planned without building any of it */
  __planWave: (board: Board, wave: number, players: number, nx: number, ny: number, nz: number) =>
    Array<{ kind: EnemyKind; pos: [number, number, number]; body: ReturnType<typeof enemyBody> }>;
  /** stand one fighter on the select screen and shoot its poster (tools/posters.mjs) */
  __posterShot: (id: string, timeoutMs?: number) =>
    Promise<(PosterShot & { id: string }) | { id: string; error: string }>;
  /** has this .glb arrived and parsed? */
  __modelCached: (id: string) => boolean;
  /** build a roster id or a hostile kind on the hitbox bench; returns its bench index */
  __buildBody: (id: string) => number;
  /** measure bench body `i`; null while it has nothing visible */
  __bodySize: (i: number) => BodySample | null;
  /** the declared collider and stat sheet behind a roster id or a hostile kind */
  __bodyDecl: (id: string) =>
    | ({ kind: 'playable' } & ReturnType<typeof playableDef>['profile'])
    | ({ kind: 'enemy'; hitParts: ReturnType<typeof enemyHitParts> } & ReturnType<typeof enemyStats>);

  /** back to the title from wherever the app is */
  __quitToTitle: () => void;
  /** the renderer's viewport rectangle: x, y, width, height */
  __viewport: () => [number, number, number, number];
  /** how many of this drop's required files are still outstanding */
  __loadPending: () => number;
  /** the character-select line as it stands: humans, then bots */
  __charselLine: () => ReturnType<CharacterSelect['lineState']>;
  /** the sculpt ids the built board asked for */
  __propsUsed: () => string[];
  __fitStats: () => typeof fitStats;
  __playables: () => Array<ReturnType<typeof playableDef>>;
  __boardProps: () => typeof BOARD_PROPS;
  __missionZones: () => MissionZoneRow[];
  /** start an n-player co-op match without walking the menus */
  __startCoop: (n: number, boardId?: string) => void;
  /** start a match in any mode without walking the menus */
  __startMode: (m: GameMode, n: number, boardId?: string, chars?: PlayableId[]) => void;

  /** one frame of everything — menus, the drop, the match — on a dt the caller picks */
  __stepFrame: (dt?: number) => void;
  /** render the match once without advancing it */
  __renderOnce: (dt?: number) => void;
  /** the drop's state, readable without advancing it */
  __loadState: () => { screen: AppState; built: boolean; pending: number };

  // ---- set by the model workbench (src/workbench/main.ts) ----

  /** what is on the turntable; replaced on every rebuild */
  __wb: {
    figures: Figure[];
    subject: Subject;
    pose: Pose;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
  };

  // ---- set by the page's caller, read by the game ----

  /** stop the live loop: nothing updates or renders until `__stepFrame` says so */
  __manual: boolean;
  /** keep the loading screen up after the drop's files are in */
  __holdLoading: boolean;

  // ---- test-injected: installed by tools/harness.mjs's init scripts, never
  // ---- by the app. Declared so the one reader in src (`__beforeBuild`) and
  // ---- anyone reading this list sees the whole surface.

  /** wind the dice to a fixed offset; main.ts calls it at the top of `buildMatch` */
  __beforeBuild: () => void;
  /** the run's seed (HARNESS_SEED) */
  __seed: number;
  /** put the seeded dice at a known place mid-run */
  __reseed: (n: number) => void;
  /** advance `seconds` of match time on blank input plus `over` for player one */
  __sim: (seconds: number, over?: Partial<FrameInput>, dt?: number) => Game;
  /** step until `done(game)`, up to `maxSeconds`; the seconds it took, or null */
  __simUntil: (done: (g: Game) => boolean, maxSeconds?: number, over?: Partial<FrameInput>, dt?: number) => number | null;
  /** the four shimmed controllers */
  __pads: HarnessPadState[];
  /** the first shimmed controller (older suites' name for `__pads[0]`) */
  __pad: HarnessPadState;
  /** plug a shimmed controller in, or pull it out */
  __padConnect: (i: number, on?: boolean) => void;
}

declare global {
  // Every hook is optional on the page: which ones exist depends on which
  // entry loaded (game or workbench), how far it has got, and whether a test
  // harness put its own in first.
  interface Window extends Partial<DebugHooks> {}
}

/**
 * Hang `hooks` off `window`. Just `Object.assign`, but typed: a misspelt name
 * or a hook of the wrong shape fails the build here instead of a suite later.
 */
export function expose(hooks: Partial<DebugHooks>): void {
  Object.assign(window, hooks);
}
