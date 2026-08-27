import * as THREE from 'three';
import { InputManager } from './core/input';
import { audio } from './core/audio';
import { Game } from './game/game';
import { buildTatooine } from './world/tatooine';
import { buildWaystation } from './world/waystation';
import type { Board } from './world/board';
import { Hud } from './ui/hud';
import { MenuScreen } from './ui/menus';
import { MANDO_ROSTER, type MandoId } from './characters/mandalorians';

const app = document.getElementById('app')!;

// ---------- renderer ----------
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

// ---------- fullscreen button (bottom right, always visible) ----------
const fsBtn = document.createElement('button');
fsBtn.id = 'fullscreen-btn';
fsBtn.title = 'Fullscreen (controller: View button)';
const FS_EXPAND = '<svg viewBox="0 0 24 24"><path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z"/></svg>';
const FS_SHRINK = '<svg viewBox="0 0 24 24"><path d="M10 4v6H4V8h4V4h2zm4 0h2v4h4v2h-6V4zM4 14h6v6H8v-4H4v-2zm10 0h6v2h-4v4h-2v-6z"/></svg>';
fsBtn.innerHTML = FS_EXPAND;
document.body.appendChild(fsBtn);
function toggleFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
}
fsBtn.addEventListener('click', () => { audio.init(); toggleFullscreen(); });
document.addEventListener('fullscreenchange', () => {
  fsBtn.innerHTML = document.fullscreenElement ? FS_SHRINK : FS_EXPAND;
});
input.onFullscreenToggle = toggleFullscreen;

// ---------- UI ----------
const hud = new Hud(app);
const menuLayer = document.createElement('div');
menuLayer.className = 'layer interactive';
app.appendChild(menuLayer);

type AppState = 'title' | 'select' | 'characters' | 'playing' | 'paused' | 'end';
let state: AppState = 'title';
let game: Game | null = null;
let chosenBoard: 'desert' | 'station' = 'desert';
let playerCount = 1;
let endTimer = 0;
const chosenChars: MandoId[] = ['din', 'paz'];
let charPickSlot = 0;

// ----- title screen -----
const title = new MenuScreen(menuLayer);
// authored key art behind the title, under the existing vignette gradient
title.root.style.backgroundImage =
  "radial-gradient(ellipse at 50% 30%, rgba(30,22,12,0.55), rgba(0,0,0,0.92) 75%), url('assets/textures/title_bg.jpg')";
title.root.style.backgroundSize = 'cover';
title.root.style.backgroundPosition = 'center';
title.addTitle('Mando', 'a Mandalorian fan game');
title.addButtons(null, [
  { label: 'Play', action: () => setState('select') },
  { label: 'Fullscreen', action: toggleFullscreen },
]);
title.addHint('Gamepad: <b>D-pad/Stick</b> navigate · <b>A</b> select · <b>B</b> back · <b>View</b> fullscreen<br/>Keyboard: <b>WASD</b> move · <b>Mouse</b> aim · <b>Space</b> jump/jetpack · <b>Shift</b> sprint/dash · <b>F</b> melee · <b>Q</b> rocket · <b>V</b> Dead Eye · <b>E</b> switch weapon');

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
const cardDesert = makeCard('The Dune Sea', 'Tatooine wastes — Tusken outcasts, Pyke patrols, swoop gangs, and the sarlacc. Watch your step.',
  'board_tatooine.jpg', 'linear-gradient(160deg, #d9a860, #7a4a28)');
const cardStation = makeCard('The Spice Run', 'A smugglers’ waystation in deep space. Floating platforms — the jetpack is the only road.',
  'board_waystation.jpg', 'linear-gradient(160deg, #2a2f4a, #0c0d18)');
let playersBtn: HTMLElement;
select.addButtons(cards, [
  { label: '', action: () => { chosenBoard = 'desert'; openCharacterSelect(); }, el: cardDesert },
  { label: '', action: () => { chosenBoard = 'station'; openCharacterSelect(); }, el: cardStation },
]);
[playersBtn] = select.addButtons(null, [
  { label: 'Players: 1', action: () => togglePlayers() },
  { label: 'Back', action: () => setState('title') },
]);
select.onBack = () => setState('title');
function togglePlayers(): void {
  playerCount = playerCount === 1 ? 2 : 1;
  refreshPlayersBtn();
}
function refreshPlayersBtn(): void {
  if (playerCount === 1) playersBtn.textContent = 'Players: 1';
  else playersBtn.textContent = input.padCount() >= 2 ? 'Players: 2 — split screen' : 'Players: 2 (connect 2nd controller)';
}

// ----- character select -----
const charSelect = new MenuScreen(menuLayer);
const charTitle = document.createElement('div');
charTitle.className = 'menu-title';
charTitle.style.fontSize = 'clamp(28px, 4vw, 52px)';
charTitle.textContent = 'Choose Your Mandalorian';
charSelect.root.appendChild(charTitle);
const charSub = document.createElement('div');
charSub.className = 'menu-subtitle';
charSelect.root.appendChild(charSub);
charSelect.addButtons(null, [
  ...(Object.keys(MANDO_ROSTER) as MandoId[]).map((id) => ({
    label: MANDO_ROSTER[id].name,
    action: () => pickCharacter(id),
  })),
  { label: 'Back', action: () => setState('select') },
]);
charSelect.addHint(
  (Object.keys(MANDO_ROSTER) as MandoId[])
    .map((id) => `<b>${MANDO_ROSTER[id].name}</b> — ${MANDO_ROSTER[id].desc}`)
    .join('<br/>')
);
charSelect.onBack = () => setState('select');

function openCharacterSelect(): void {
  charPickSlot = 0;
  charSub.textContent = playerCount > 1 ? 'Player 1' : 'All Mandalorians fight alike — pick your armor';
  setState('characters');
}
function pickCharacter(id: MandoId): void {
  chosenChars[charPickSlot] = id;
  if (playerCount > 1 && charPickSlot === 0) {
    charPickSlot = 1;
    charSub.textContent = 'Player 2';
    charSelect.setFocus(0);
    return;
  }
  startGame();
}

// ----- pause -----
const pause = new MenuScreen(menuLayer);
pause.addTitle('Paused');
pause.addButtons(null, [
  { label: 'Resume', action: () => resumeGame() },
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

const screens: Record<string, MenuScreen> = { title, select, characters: charSelect, paused: pause, end };

function activeScreen(): MenuScreen | null {
  if (state === 'title') return title;
  if (state === 'select') return select;
  if (state === 'characters') return charSelect;
  if (state === 'paused') return pause;
  if (state === 'end') return end;
  return null;
}

function setState(s: AppState): void {
  state = s;
  for (const key of Object.keys(screens)) screens[key].hide();
  const scr = activeScreen();
  if (scr) scr.show();
  input.menuMode = s !== 'playing';
  if (s === 'playing') hud.show();
  if (s !== 'playing' && s !== 'paused') input.releasePointerLock();
  if (s === 'select') refreshPlayersBtn();
}

function startGame(): void {
  audio.init();
  disposeGame();
  const board: Board = chosenBoard === 'desert' ? buildTatooine() : buildWaystation();
  const aspect = window.innerWidth / (window.innerHeight / (playerCount > 1 ? 2 : 1));
  game = new Game(board, playerCount, aspect, {
    banner: (t, s) => hud.banner(t, s),
    stateChanged: () => { endTimer = 3; },
    hitMarker: (slot) => hud.hitMarker(slot),
  }, [...chosenChars]);
  hud.setLayout(playerCount);
  setState('playing');
  input.requestPointerLock();
  (window as unknown as { __game?: Game }).__game = game; // debug/testing handle
}

function disposeGame(): void {
  if (game) { game.dispose(); game = null; }
}

function resumeGame(): void {
  setState('playing');
  input.requestPointerLock();
}

function quitToTitle(): void {
  document.body.classList.remove('deadeye');
  disposeGame();
  hud.hide();
  setState('title');
}

// clicking the canvas while playing re-locks the pointer
renderer.domElement.addEventListener('click', () => {
  if (state === 'playing') input.requestPointerLock();
});

// ---------- main loop ----------
let last = performance.now();
// test/capture hooks: __manual pauses the live loop; __renderOnce renders one frame
const dbg = window as unknown as { __manual?: boolean; __renderOnce?: (dt?: number) => void };
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

  input.poll(dt);
  const actions = input.drainMenuActions();

  const scr = activeScreen();
  if (scr) {
    for (const a of actions) scr.handle(a);
  } else if (state === 'playing' && game) {
    for (const a of actions) {
      if (a === 'pause' || a === 'back') { setState('paused'); input.releasePointerLock(); }
    }
  }

  if (game && (state === 'playing' || state === 'paused' || state === 'end')) {
    if (state === 'playing') {
      const inputs = [input.read(0, dt), input.read(1, dt)];
      game.update(dt, inputs);
      hud.update(dt, game);
      document.body.classList.toggle('deadeye', game.timeScale < 0.9);
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
  } else {
    renderer.clear();
  }
  input.endFrame();
}

setState('title');
requestAnimationFrame(frame);
