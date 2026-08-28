import * as THREE from 'three';
import { config, loadSavedConfig, saveAudioConfig, saveCameraConfig, saveInputConfig, saveVideoConfig } from './config';
import { InputManager } from './core/input';
import { MAX_PLAYERS, splitLayout } from './core/layout';
import { matchAssets, warmBoardSelect, warmMatch, warmTerritory, warmTitle } from './core/prefetch';
import { tracked } from './core/warm';
import { LoadingScreen } from './ui/loading';
import { FINAL_WAVE, waveComposition } from './enemies/spawner';
import type { EnemyKind } from './enemies/enemy';
import { audio } from './core/audio';
import { Game } from './game/game';
import { BOARDS } from './world/boards';
import type { Board, BoardId } from './world/board';
import { Hud } from './ui/hud';
import { MenuScreen } from './ui/menus';
import { CharacterSelect } from './ui/charselect';
import { controlsMarkup } from './ui/controls-art';
import { MANDO_ROSTER, type MandoId } from './characters/mandalorians';

const app = document.getElementById('app')!;

// ---------- renderer ----------
loadSavedConfig();
// The tunables in src/config.ts are meant to be adjustable while playing:
//   __config.audio.sfx = 0.2; __audio.applyConfig(); __saveAudio();
//   __config.camera.dynamic = false; __saveCamera();
Object.assign(window, {
  __config: config, __audio: audio, __saveAudio: saveAudioConfig, __saveCamera: saveCameraConfig,
});

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
}
resize();
window.addEventListener('resize', resize);

// ---------- input & audio unlock ----------
const input = new InputManager(renderer.domElement);
const unlockAudio = () => audio.init();
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// ---------- corner buttons (bottom right, always visible) ----------
const corner = document.createElement('div');
corner.id = 'corner-buttons';
document.body.appendChild(corner);

function cornerButton(title: string, svg: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'corner-btn';
  b.title = title;
  b.innerHTML = svg;
  b.addEventListener('click', () => { audio.init(); audio.uiConfirm(); b.blur(); onClick(); });
  corner.appendChild(b);
  return b;
}

cornerButton('Controls', '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 2a8 8 0 110 16 8 8 0 010-16zm-1 3h2v2h-2V7zm0 4h2v6h-2v-6z"/></svg>',
  () => openOverlay('controls'));
cornerButton('Settings', '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.6 7.6 0 000-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-1.7-1L15 3.4h-4l-.3 2.6a7.6 7.6 0 00-1.7 1l-2.4-1-2 3.4L4.6 11a7.6 7.6 0 000 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 001.7 1l.3 2.6h4l.3-2.6a7.6 7.6 0 001.7-1l2.4 1 2-3.4-2-1.6zM12 15.2A3.2 3.2 0 1112 8.8a3.2 3.2 0 010 6.4z"/></svg>',
  () => openOverlay('settings'));

const fsBtn = document.createElement('button');
fsBtn.className = 'corner-btn';
fsBtn.title = 'Fullscreen (controller: View button)';
const FS_EXPAND = '<svg viewBox="0 0 24 24"><path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z"/></svg>';
const FS_SHRINK = '<svg viewBox="0 0 24 24"><path d="M10 4v6H4V8h4V4h2zm4 0h2v4h4v2h-6V4zM4 14h6v6H8v-4H4v-2zm10 0h6v2h-4v4h-2v-6z"/></svg>';
fsBtn.innerHTML = FS_EXPAND;
corner.appendChild(fsBtn);
function toggleFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
}
fsBtn.addEventListener('click', () => { audio.init(); fsBtn.blur(); toggleFullscreen(); });
document.addEventListener('fullscreenchange', () => {
  fsBtn.innerHTML = document.fullscreenElement ? FS_SHRINK : FS_EXPAND;
});
input.onFullscreenToggle = toggleFullscreen;

// ---------- UI ----------
const hud = new Hud(app);
const menuLayer = document.createElement('div');
menuLayer.className = 'layer interactive';
app.appendChild(menuLayer);

type AppState = 'title' | 'select' | 'characters' | 'loading' | 'playing' | 'paused' | 'end' | 'controls' | 'settings';
let state: AppState = 'title';
let game: Game | null = null;
let chosenBoard = BOARDS[0];
let playerCount = 1;
let endTimer = 0;
const chosenChars: MandoId[] = ['din', 'paz'];

// ----- title screen -----
const title = new MenuScreen(menuLayer);
// authored key art behind the title, under the existing vignette gradient
title.root.style.backgroundImage =
  "radial-gradient(ellipse at 50% 30%, rgba(30,22,12,0.55), rgba(0,0,0,0.92) 75%), url('assets/textures/title_bg.jpg')";
title.root.style.backgroundSize = 'cover';
title.root.style.backgroundPosition = 'center';
title.addTitle('Mando', 'a Mandalorian fan game');
// One prompt, arcade style: Start (or Enter, or a click) drops straight into
// territory select and takes the window fullscreen on the way. Browsers only
// honour requestFullscreen from a real user gesture — a gamepad press isn't
// one, so the fullscreen half is best-effort and failure is silent.
title.addButtons(null, [
  { label: 'Press Start', action: () => { enterFullscreen(); warmBoardSelect(); setState('select'); } },
]);
function enterFullscreen(): void {
  if (!document.fullscreenElement) {
    try { document.documentElement.requestFullscreen?.()?.catch(() => {}); } catch { /* not a user gesture */ }
  }
}

// ----- board select -----
const select = new MenuScreen(menuLayer);
select.addTitle('Choose Territory');
const cards = document.createElement('div');
cards.className = 'board-cards';
select.root.appendChild(cards);
function makeCard(name: string, desc: string, art: string, grad: string): HTMLElement {
  const c = document.createElement('div');
  c.className = 'board-card';
  c.innerHTML = `<div class="art" style="background-image:url('assets/textures/${art}'), ${grad}"></div>
    <div class="name">${name}</div><div class="desc">${desc}</div>`;
  cards.appendChild(c);
  return c;
}
select.addButtons(cards, BOARDS.map((info) => ({
  label: '',
  action: () => {
    chosenBoard = info;
    // the player is about to spend a while picking a fighter: spend it
    // pulling down this territory's sky, ground and opening waves
    warmTerritory(info.id);
    setState('characters');
  },
  el: makeCard(info.name, info.desc, info.art, info.gradient),
})));
select.onBack = () => setState('title');

// ----- the drop: loading screen between the character select and the match -----
const loading = new LoadingScreen(menuLayer);

// ----- character select (3D stage, drawn by the game renderer) -----
const charSelect = new CharacterSelect(menuLayer, {
  onStart: (chars, count) => {
    chosenChars.length = 0;
    chosenChars.push(...chars);
    // pad out the unused slots so a later index is never undefined
    while (chosenChars.length < MAX_PLAYERS) chosenChars.push('paz');
    playerCount = count;
    startGame();
  },
  onBack: () => setState('select'),
  padForPlayer: () => input.padForPlayer,
  compactPads: () => input.compactPlayerSlots(),
  seatPad: (padIndex, slot) => input.seatPad(padIndex, slot),
  stickX: (slot) => input.menuStickX(slot),
});

// ----- controls & settings -----
// Reachable from the corner buttons at any time, so they remember where they
// were opened from and go back there rather than dumping you on the title.
let overlayReturn: AppState = 'title';

const controls = new MenuScreen(menuLayer);
controls.addTitle('Controls');
const controlsArt = document.createElement('div');
const paintControls = (): void => { controlsArt.innerHTML = controlsMarkup(config.input.keyboardMouse); };
paintControls();
controls.root.appendChild(controlsArt);
controls.addButtons(null, [{ label: 'Back', action: () => closeOverlay() }]);
controls.onBack = () => closeOverlay();

const settings = new MenuScreen(menuLayer);
settings.addTitle('Settings');
const volume = (label: string, key: 'master' | 'sfx' | 'music') =>
  settings.addSlider(label, () => config.audio[key], (v) => {
    config.audio[key] = v;
    audio.applyConfig();
    saveAudioConfig();
  });
volume('Master volume', 'master');
volume('Sound effects', 'sfx');
volume('Music', 'music');
settings.addToggle('Dynamic camera', () => config.camera.dynamic, (on) => {
  config.camera.dynamic = on;
  saveCameraConfig();
});
settings.addChoice('Split screen', [
  { value: 'stacked' as const, label: 'Stacked' },
  { value: 'columns' as const, label: 'Side by side' },
], () => config.video.split, (v) => {
  config.video.split = v;
  saveVideoConfig();
  // A match in progress re-lays its HUD immediately; the renderer reads the
  // rectangles fresh every frame, so the viewports follow on their own.
  if (game) hud.setLayout(playerCount);
});
settings.addToggle('Keyboard & mouse', () => config.input.keyboardMouse, (on) => {
  config.input.keyboardMouse = on;
  saveInputConfig();
  paintControls();
  // Turning it off mid-game hands the cursor straight back rather than
  // waiting for the next pause; turning it on grabs it for mouse look.
  if (state === 'playing') {
    if (on) input.requestPointerLock();
    else input.releasePointerLock();
  }
});
settings.addButtons(null, [{ label: 'Back', action: () => closeOverlay() }]);
settings.addHint('Saved on this device. Gamepad: <b>left / right</b> to adjust.<br/>'
  + '<b>Dynamic camera</b> — the chase camera closes in when you are still and opens out when you sprint, '
  + 'dash or fly. Off, it holds the one distance the right stick dials in.<br/>'
  + '<b>Split screen</b> — which way co-op divides the window: <b>stacked</b> gives each player a wide strip, '
  + '<b>side by side</b> turns the same layout on its side. Four players get a quadrant either way.<br/>'
  + '<b>Keyboard &amp; mouse</b> — adds WASD and mouse aiming; while it is off the cursor stays free during play.');

settings.onBack = () => closeOverlay();

/**
 * Cursor behaviour, controller-game style: hidden while playing, and back the
 * instant the mouse moves so the corner buttons stay reachable, then hidden
 * again after a couple of idle seconds. Menus always show it. Under pointer
 * lock (the keyboard-and-mouse path) the browser hides it for us anyway.
 */
const CURSOR_IDLE = 2;
let cursorWake = 0;
addEventListener('pointermove', () => { cursorWake = CURSOR_IDLE; }, { passive: true });
addEventListener('pointerdown', () => { cursorWake = CURSOR_IDLE; }, { passive: true });

function updateCursor(dt: number): void {
  if (cursorWake > 0) cursorWake -= dt;
  const hide = state === 'playing' && cursorWake <= 0;
  document.body.classList.toggle('cursor-hidden', hide);
}

function openOverlay(which: 'controls' | 'settings'): void {
  if (state !== 'controls' && state !== 'settings') overlayReturn = state;
  setState(which);
}
function closeOverlay(): void {
  setState(overlayReturn);
  if (overlayReturn === 'playing') input.requestPointerLock();
}

// ----- pause -----
const pause = new MenuScreen(menuLayer);
pause.addTitle('Paused');
pause.addButtons(null, [
  { label: 'Resume', action: () => resumeGame() },
  { label: 'Controls', action: () => openOverlay('controls') },
  { label: 'Settings', action: () => openOverlay('settings') },
  { label: 'Restart Board', action: () => { startGame(); } },
  { label: 'Quit to Title', action: () => quitToTitle() },
]);
pause.onBack = () => resumeGame();

// ----- end (victory/defeat) -----
const end = new MenuScreen(menuLayer);
const endTitle = document.createElement('div');
endTitle.className = 'menu-title';
endTitle.style.fontSize = 'clamp(34px, 5vw, 64px)';
end.root.appendChild(endTitle);
const endStats = document.createElement('div');
endStats.className = 'menu-hint';
end.root.appendChild(endStats);
end.addButtons(null, [
  { label: 'Retry Board', action: () => startGame() },
  { label: 'Quit to Title', action: () => quitToTitle() },
]);
end.onBack = () => quitToTitle();

(window as unknown as { __charsel?: CharacterSelect }).__charsel = charSelect; // debug/testing handle
(window as unknown as { __input?: InputManager }).__input = input;              // debug/testing handle
// Board factories, so a test can build any board on its own — the collision
// audit in tools/audit-collision.mjs walks every board's meshes against its
// physics world without having to play nine matches to reach them.
(window as unknown as { __boards?: typeof BOARDS }).__boards = BOARDS;
// debug/testing handle: the playable roster, so a test never has to hardcode a
// character's name or count — both have changed under it before
(window as unknown as { __roster?: unknown }).__roster =
  (Object.keys(MANDO_ROSTER) as MandoId[]).map((id) => ({ id, name: MANDO_ROSTER[id].name }));

const screens: Record<string, MenuScreen> = { title, select, paused: pause, end, controls, settings };

function activeScreen(): MenuScreen | null {
  if (state === 'title') return title;
  if (state === 'select') return select;
  if (state === 'paused') return pause;
  if (state === 'end') return end;
  if (state === 'controls') return controls;
  if (state === 'settings') return settings;
  return null;
}

function setState(s: AppState): void {
  state = s;
  (window as unknown as { __state?: string }).__state = s;   // debug/testing handle
  for (const key of Object.keys(screens)) screens[key].hide();
  if (s === 'characters') { if (!charSelect.visible) charSelect.show(); }
  else charSelect.hide();
  if (s !== 'loading') loading.hide();
  const scr = activeScreen();
  if (scr) scr.show();
  input.menuMode = s !== 'playing';
  if (s === 'playing') hud.show();
  if (s !== 'playing' && s !== 'paused') input.releasePointerLock();
}

/**
 * The drop, in three beats: put the loading screen up, build the match behind
 * it, then hold it there until what the first minute needs has arrived.
 *
 * The build is synchronous and takes long enough to be seen, so it happens a
 * frame after the screen is shown rather than before — otherwise the character
 * select freezes mid-turntable and the loading screen appears when the work is
 * already done.
 */
function startGame(): void {
  audio.init();
  disposeGame();
  const chars = chosenChars.slice(0, playerCount);
  // anything still missing goes to the front of the queue now
  warmMatch(chosenBoard.id, chars);
  loading.show(chosenBoard, chars, keyEnemies(chosenBoard.id));
  setState('loading');
  loadTimer = 0;
  requestAnimationFrame(() => requestAnimationFrame(() => buildMatch()));
}

/** The hostiles worth showing on the loading screen: the opening wave, and the elite that ends it. */
function keyEnemies(board: BoardId): EnemyKind[] {
  const opening = waveComposition(board, 1, 1).map((e) => e.kind);
  const last = waveComposition(board, FINAL_WAVE, 1).map((e) => e.kind);
  const picked: EnemyKind[] = [...opening.slice(0, 2), last[last.length - 1]];
  return [...new Set(picked.filter(Boolean))];
}

function buildMatch(): void {
  const board: Board = chosenBoard.build();
  // seed the cameras with the aspect of the viewport they will actually get;
  // render() recomputes it per frame, but a wrong first frame is a visible pop
  const first = splitLayout(playerCount)[0];
  const aspect = (window.innerWidth * first.w) / (window.innerHeight * first.h);
  // Layout first: the Game constructor announces the board, and setLayout wipes
  // and rebuilds the HUD elements. Built the other way round, that opening
  // banner was written into DOM that was destroyed a line later, so "The Dune
  // Sea / Survive 10 waves" never actually appeared.
  hud.setLayout(playerCount);
  game = new Game(board, playerCount, aspect, {
    banner: (t, s) => hud.banner(t, s),
    stateChanged: () => { endTimer = 3; },
    hitMarker: (slot) => hud.hitMarker(slot),
  }, [...chosenChars]);
  (window as unknown as { __game?: Game }).__game = game; // debug/testing handle
  built = true;
}

/**
 * Hold the loading screen while the drop's files land, then start the match.
 *
 * What it waits on is the required set — the players' models, wave one's
 * hostiles, the sky — plus whatever the board asked for as it built, which is
 * the only honest account of a territory's own textures. A file that *fails*
 * settles like any other: the procedural version of that surface is what the
 * game has always fallen back to, and waiting longer would not produce it.
 *
 * The wait is capped. A slow connection should not be able to strand someone
 * on this screen, and every asset here has a fallback that works.
 */
const LOAD_CAP = 30;
const LOAD_SKIP_AFTER = 5;
let loadTimer = 0;
let built = false;

function updateLoading(dt: number): void {
  loadTimer += dt;
  const chars = chosenChars.slice(0, playerCount);
  const keys = [...matchAssets(chosenBoard.id, chars), ...(built ? boardLoads() : [])];
  const p = tracked.progress(keys);
  // the build itself is a real part of the wait, and worth a moving bar
  const ratio = built ? 0.15 + p.ratio * 0.85 : Math.min(0.15, loadTimer * 0.3);
  const note = !built ? 'Raising the territory'
    : p.pending > 0 ? `${p.pending} file${p.pending === 1 ? '' : 's'} to go`
      : 'Ready';
  loading.progress(ratio, loadTimer > LOAD_SKIP_AFTER && p.pending > 0 ? `${note} · A to drop now` : note);
  // __holdLoading keeps the screen up for capture and for the tests that read
  // it; a real drop is over in the time it takes to fetch what is missing
  if (dbg.__holdLoading) return;
  if (built && (p.pending === 0 || loadTimer > LOAD_CAP)) enterMatch();
}

/**
 * Texture loads the board kicked off while building, whatever they turned out
 * to be — this is what makes the wait cover a territory's own ground and sky
 * without anyone maintaining a list of them.
 *
 * Speculative warm fetches are excluded: those are the *next* thing being
 * pulled down in the background, and holding the drop for them would mean
 * waiting on files this match does not need.
 */
function boardLoads(): string[] {
  return tracked.inFlight().filter((k) => !k.startsWith('warm:') && k.includes('assets/textures/'));
}

function enterMatch(): void {
  built = false;
  setState('playing');
  input.requestPointerLock();
}

function disposeGame(): void {
  if (!game) return;
  game.dispose();
  game = null;
  // the debug/testing handle must not outlive the match either: a torn-down
  // Game still answers to `.wave`, which makes it look like one is running
  (window as unknown as { __game?: Game | null }).__game = null;
}

function resumeGame(): void {
  setState('playing');
  input.requestPointerLock();
}

function quitToTitle(): void {
  disposeGame();
  hud.hide();
  setState('title');
}

// Start an N-player match without N controllers plugged in. Split-screen is
// otherwise untestable on one machine, and the layout is the part most likely
// to break — every slot still reads its own device, so a pad that is there
// drives its player and a slot without one simply stands still.
Object.assign(window, {
  // back to the title from wherever we are, so a test can run several matches
  __quitToTitle: () => quitToTitle(),
  // how many of this drop's required files are still outstanding, for tests:
  // it must read 0 by the time the match is on screen
  __loadPending: () => tracked.progress(matchAssets(chosenBoard.id, chosenChars.slice(0, playerCount))).pending,
  __startCoop: (n: number, boardId?: string) => {
    playerCount = Math.max(1, Math.min(MAX_PLAYERS, n));
    if (boardId) chosenBoard = BOARDS.find((b) => b.id === boardId) ?? chosenBoard;
    while (chosenChars.length < MAX_PLAYERS) chosenChars.push('paz');
    startGame();
  },
});

// clicking the canvas while playing re-locks the pointer
renderer.domElement.addEventListener('click', () => {
  if (state === 'playing') input.requestPointerLock();
});

// ---------- main loop ----------
let last = performance.now();
// test/capture hooks: __manual pauses the live loop; __renderOnce renders one frame
const dbg = window as unknown as {
  __manual?: boolean; __renderOnce?: (dt?: number) => void; __holdLoading?: boolean;
};
dbg.__renderOnce = (dt = 1 / 24) => {
  if (game) {
    hud.update(dt, game);
    game.render(renderer);
  }
};
function frame(now: number): void {
  requestAnimationFrame(frame);
  if (dbg.__manual) { last = now; return; }
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  updateCursor(dt);
  input.poll(dt);
  const events = input.drainMenuEvents();

  const scr = activeScreen();
  if (state === 'characters') {
    for (const e of events) charSelect.handle(e.action, e.source);
  } else if (state === 'loading') {
    // an impatient player can always drop early: everything still coming has a
    // fallback, so the worst case is a surface that pops in a second later
    for (const e of events) if (e.action === 'confirm' && built && loadTimer > LOAD_SKIP_AFTER) enterMatch();
  } else if (scr) {
    for (const e of events) scr.handle(e.action);
  } else if (state === 'playing' && game) {
    for (const e of events) {
      if (e.action === 'pause' || e.action === 'back') { setState('paused'); input.releasePointerLock(); }
    }
  }

  if (state === 'loading') updateLoading(dt);

  if (game && state !== 'title' && state !== 'select' && state !== 'characters' && state !== 'loading') {
    if (state === 'playing') {
      const inputs = Array.from({ length: MAX_PLAYERS }, (_, i) => input.read(i, dt));
      game.update(dt, inputs);
      hud.update(dt, game);
      // transition to end screen shortly after victory/defeat
      if (game.state === 'victory' || game.state === 'defeat') {
        endTimer -= dt;
        if (endTimer <= 0) {
          endTitle.textContent = game.state === 'victory' ? 'Territory Held' : 'The Mando Has Fallen';
          const mins = Math.floor(game.elapsed / 60);
          const secs = Math.floor(game.elapsed % 60).toString().padStart(2, '0');
          endStats.innerHTML = game.players
            .map((p, i) => `<b>P${i + 1}</b> ${p.kills} kills`)
            .join(' · ') + ` · wave ${game.wave} · ${mins}:${secs}`;
          setState('end');
        }
      }
    }
    game.render(renderer);
  } else if (state === 'characters') {
    charSelect.update(dt);
    charSelect.render(renderer);
  } else {
    renderer.clear();
  }
  input.endFrame();
}

// The title screen is the longest anyone sits still: start pulling down the
// first Mandalorian and the territory art behind the next screen while they do.
warmTitle();
setState('title');
requestAnimationFrame(frame);
