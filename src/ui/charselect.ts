import * as THREE from 'three';
import { audio } from '../core/audio';
import { MAX_FIGHTERS, MAX_PLAYERS } from '../core/layout';
import { TEXT } from '../text';
import { damp } from '../core/math';
import { nodeCount, visibleBounds } from '../core/bounds';
import {
  loadPosterIndex, posterMeta, posterUrl,
  POSTER_ANIM_T, POSTER_ASPECT, POSTER_PAD, POSTER_PX, SETTLE_MS,
  type PosterBox,
} from './posters';

/** scratch for projecting a pedestal to the screen */
const PROJECT = new THREE.Vector3();
import type { MenuAction } from '../core/input';
import { ASSET_ROOT } from '../core/assets';
import { makeStage } from './stage';
import { faceSvg, portraitName } from './faces';
import { propsSettled } from '../characters/builder';
import type { PlayerCharacter } from '../characters/mandalorians';
import { applyArmorerAxeGrip } from '../characters/armorerAxeGrips';
import { playableDef, STANDARD_ROSTER, type PlayableId } from '../characters/roster';

/**
 * Character select: the line-up (docs/UI_CONCEPTS.md, "Hunters").
 *
 * What the players see is a row of portrait strips — the whole roster, each
 * hunter a tall slanted card, widened where a player is standing on it — and
 * under it one card per place in the line: who that player has picked, what
 * they carry, and a READY stamp once they are locked in. A place still open
 * says so ("Press A to join"). Player 1 is keyboard + first pad; another pad
 * joins by pressing A.
 *
 * Underneath, the screen is still the 3D stage it was built as: every place is
 * a plinth with the fighter's body on it, driven and loaded exactly as before,
 * just not drawn. That is deliberate. Locking in waits on the body being
 * there, which is what guarantees every picked model is warm by the time the
 * match starts — the drop screen's wait is short because this one did the
 * work — and the stage is also where the poster tool shoots its pictures.
 *
 * Only the authored models are ever shown — the procedural body a character is
 * born with stays hidden, and a pedestal shows a spinner instead if its model
 * takes longer than SPINNER_DELAY to arrive. Committing needs a loaded model,
 * so by the time the match starts every picked model is warm in the cache.
 *
 * That holds for every fighter on offer, the playable NPCs included: a hostile
 * kind is wrapped, not re-implemented, so it reports the same "has my .glb
 * landed" answer its wave-game twin does and waits behind the same spinner. A
 * fighter that has no authored file at all answers ready at once, since there
 * the procedural build is the finished look rather than a stand-in for one.
 */

const SPINNER_DELAY = 0.7;
const SPIN_DURATION = 0.9;
/** half-width and rate of the idle turntable sweep */
const ARC = 0.35;
const ARC_RATE = 0.4;
/** yaw rate at full right-stick deflection, and how fast a released stick eases back */
const MANUAL_RATE = 2.8;
const RETURN_TAU = 0.55;
/** resting emissive lift, matched to how the hero reads in-game */
const BASE_GLOW = 0.22;
/** each place in the line wears a colour: its card's edge and its tag on the strips */
const SLOT_COLOURS = ['#e0452c', '#3d86e0', '#4fb05a', '#e8b830', '#b06ad8', '#e07a2c', '#3dc0c0', '#c8c0b0'];
/** the portrait a fighter wears on this screen */
const portraitUrl = (id: PlayableId): string => `${ASSET_ROOT}assets/textures/${portraitName(id)}.jpg`;
/** the one word a strip has room for: "Din Djarin" is DIN, "The Armorer" ARMORER, "Darth Maul" MAUL */
const stripName = (name: string): string => name.replace(/^(The|Darth)\s+/, '').split(/\s+/)[0];

/**
 * The line only ever holds the players who are here plus one open place —
 * never four plinths with two of them dark. Spacing tightens and the camera
 * eases back as the line grows, both indexed by how many are on stage.
 */
// index = plinths on stage, out to the eight a PvP line can hold once bots
// are in it; the line tightens and the camera walks back as it grows
const STAGE_GAP = [0, 0, 2.8, 2.3, 1.9, 1.72, 1.6, 1.5, 1.42];
const STAGE_Z = [0, 5.2, 5.2, 5.9, 6.5, 7.3, 8.0, 8.6, 9.2];
/** how fast the line re-spaces itself, and how fast a plinth grows in or out */
const STAGE_LAMBDA = 5.5;
const APPEAR_LAMBDA = 7;

/** x of the i-th pedestal when `n` of them are on stage, centred on the line */
function stageX(i: number, n: number): number {
  return (i - (n - 1) / 2) * STAGE_GAP[Math.max(1, Math.min(MAX_FIGHTERS, n))];
}

/**
 * How big a fighter is allowed to stand on its plinth.
 *
 * The PvP roster is not a line-up of one species: beside a 2.2 m trooper it
 * fields a war massiff that measures 3.2 × 4.9 m and a broodmother at 2.7 m
 * across, against a line spaced 1.9 m apart once four players have joined. At
 * their own size those two do not overshoot the plinth so much as swallow
 * whoever is standing next to it, and a spinning massiff sweeps that footprint
 * through both neighbours. So the select scales a fighter down to fit the
 * space — the game does not, and a massiff played is a massiff.
 *
 * The footprint budget is measured against the *tightest* spacing rather than
 * the current one, so a fighter is the same size on the plinth whether it is
 * alone or fourth in a line: a model that resized itself every time somebody
 * joined would read as a bug.
 *
 * Only ever shrinks. Scaling the small up would flatten the roster into one
 * size, and a krykna reading as smaller than a Wookiee is the truth.
 */
const FIT_HEIGHT = 2.4;
const FIT_FOOTPRINT = 1.8;

const _fitBox = new THREE.Box3();
const _fitSize = new THREE.Vector3();
const readyFighters = new WeakSet<PlayerCharacter>();

/** Reveal a fighter only after both its body and every attached prop settle. */
function fighterReady(c: PlayerCharacter): boolean {
  if (readyFighters.has(c)) return true;
  const ready = c.modelReady() && propsSettled(c.root);
  if (ready) readyFighters.add(c);
  return ready;
}

type Phase = 'empty' | 'browsing' | 'spinning' | 'ready';

/** one fighter's place in the line, while the line is being reordered */
interface Occupant {
  /** the plinth it came off, or -1 for one just added */
  from: number;
  bot: boolean;
  owner: number;
  phase: Phase;
  choice: number;
  spinT: number;
  arcT: number;
  manual: number;
}

/** shortest signed equivalent of an angle, so a full manual spin unwinds the near way */
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

interface Slot {
  phase: Phase;
  /** an AI fighter rather than a seat somebody is sitting in */
  bot: boolean;
  /** for a bot, the human slot that adds it and picks for it; -1 for a human */
  owner: number;
  choice: number;                 // index into ROSTER
  spinT: number;                  // 0..1 through the commit spin
  loadingFor: number;             // seconds the current model has kept us waiting
  baseYaw: number;                // yaw that faces this pedestal's model at the camera
  arcT: number;                   // idle-sweep clock, restarted per character
  manual: number;                 // right-stick yaw offset, eased back to 0 on release
  group: THREE.Group;             // pedestal-local root the characters stand in
  chars: Map<PlayableId, PlayerCharacter>;
  pedestal: THREE.Mesh;           // the plinth itself, moved with the group
  ring: THREE.Mesh;
  backGlow: THREE.PointLight;       // soft white light behind a loaded body
  glowRise: number;                 // seconds since this model became visible
  glowId: PlayableId | null;
  appear: number;                 // 0 = off stage, 1 = fully in the line
  // DOM
  panel: HTMLElement;
  name: HTMLElement;
  status: HTMLElement;
  kit: HTMLElement;
  spinner: HTMLElement;
  /** whose portrait the card is wearing, so it is only re-set on a change */
  shownId: PlayableId | null;
  /** last state the status line was written for, so it is only rewritten on a change */
  waiting: boolean;
  /** the pre-rendered picture standing in for this slot's pick, if there is one */
  poster: Poster | null;
}

/** What a poster returns to `tools/posters.mjs`. */
export interface PosterShot {
  /** the cropped picture, as a data URL */
  png: string;
  /** the box it spans, in world units off the fighter's feet */
  box: PosterBox;
  w: number;
  h: number;
  /** node count of the body it was rendered from, so the tool can say what it got */
  nodes: number;
  /**
   * Fraction of the cropped picture that is transparent.
   *
   * The generator refuses a poster with almost none: that means something
   * composited in behind the fighter and the PNG is a solid rectangle, which
   * on the stage reads as a card sitting behind them rather than as a body.
   */
  clear: number;
}

/**
 * A picture standing on a plinth in place of a body that has not been built.
 *
 * `settle` counts down while the choice sits still; at zero the real fighter
 * is built underneath and the picture is retired once that body has actually
 * been drawn — never before, or the plinth is empty for the frames between.
 */
interface Poster {
  id: PlayableId;
  img: HTMLImageElement;
  settle: number;
  /** true once the real body has been asked for */
  promoted: boolean;
}

export class CharacterSelect {
  root: HTMLElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  /**
   * Plinth fit per character root: the scale its build asked for, and the node
   * count that fit was measured against (see `fitToPlinth`). Weak, so a
   * character dropped with its slot takes its entry with it.
   */
  private fits = new WeakMap<THREE.Object3D, { nodes: number; base: number }>();
  private slots: Slot[] = [];
  private startBtn: HTMLElement;
  private panels!: HTMLElement;
  /**
   * Where the flip pictures hang. Its own layer under the panels, so a poster
   * sits over the 3D stage but never over a name plate or an arrow.
   */
  private posterLayer!: HTMLElement;
  private time = 0;
  /** the ids on offer — the standard line-up, or PvP's NPC-widened one */
  private roster: PlayableId[] = [...STANDARD_ROSTER];
  /** PvP refuses to start alone */
  private minPlayers = 1;
  /** whether this mode lets a player put AI fighters in the line (PvP does) */
  private allowBots = false;
  /** the Start button is on screen (everyone joined is locked in) */
  private startShown = false;
  /** -2 unclaimed, -1 keyboard/mouse, otherwise the exact gamepad index. */
  private humanSource: number[] = Array(MAX_PLAYERS).fill(-2);
  private titleEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private subEl!: HTMLElement;
  private contextEl!: HTMLElement;
  /** the roster's portrait strips, one per id on offer, rebuilt when the roster changes */
  private strips!: HTMLElement;
  private stripEls: HTMLElement[] = [];
  private stripRoster: PlayableId[] = [];

  constructor(
    parent: HTMLElement,
    private opts: {
      onStart: (chars: PlayableId[], playerCount: number) => void;
      onBack: () => void;
      /**
       * Who the stage is showing, most-likely-committed first: every plinth's
       * current face, then the two each is one flip from. The prefetcher plans
       * off this, so a flip is what re-ranks the downloads.
       */
      onBrowse: (focus: PlayableId[]) => void;
      /** gamepad index driving each player slot, -1 for none (from InputManager) */
      padForPlayer: () => number[];
      alignPads: (sources: readonly number[]) => void;
      padConnected: (index: number) => boolean;
      /** right-stick X for a player slot, for free-look on that pedestal */
      stickX: (slot: number) => number;
    },
  ) {
    // ---- the line-up, laid out on the front end's fixed stage ----
    this.root = document.createElement('div');
    this.root.className = 'menu-screen fe-screen fe-hunters charsel-screen';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
    const stage = makeStage(this.root);

    const head = document.createElement('div');
    head.className = 'fe-hunters-head';
    head.innerHTML = `<span class="l"><span class="charsel-title"></span><span class="sub"></span></span><span class="ctx"></span>`;
    stage.appendChild(head);
    this.titleEl = head.querySelector('.charsel-title') as HTMLElement;
    this.titleEl.textContent = TEXT.charSelect.title;
    this.subEl = head.querySelector('.sub') as HTMLElement;
    this.subEl.textContent = TEXT.charSelect.sub;
    this.contextEl = head.querySelector('.ctx') as HTMLElement;

    this.strips = document.createElement('div');
    this.strips.className = 'fe-strips';
    stage.appendChild(this.strips);

    // The pictures the 3D stage flips through. The stage is not drawn any
    // more, so neither are they, but they are still laid out: the poster
    // pipeline is measured against this layer.
    const posterLayer = document.createElement('div');
    posterLayer.className = 'charsel-posters';
    this.root.appendChild(posterLayer);
    this.posterLayer = posterLayer;

    const panels = document.createElement('div');
    panels.className = 'charsel-panels';
    stage.appendChild(panels);
    this.panels = panels;

    for (let i = 0; i < MAX_FIGHTERS; i++) this.slots.push(this.makeSlot(i, panels));
    this.buildStrips();

    // the prompt bar: the standard pair on the left, and on the right whatever
    // the line needs next — an open place, a count, or the start itself
    const bar = document.createElement('div');
    bar.className = 'fe-prompts fe-hunters-bar';
    bar.innerHTML = `
      <span><span class="fe-glyph a">A</span>${TEXT.charSelect.confirm}</span>
      <span><span class="fe-glyph b">B</span>${TEXT.charSelect.cancel}</span>`;
    stage.appendChild(bar);
    const hint = document.createElement('span');
    hint.className = 'fe-hunters-status';
    bar.appendChild(hint);
    this.hintEl = hint;
    this.startBtn = document.createElement('button');
    this.startBtn.className = 'charsel-start';
    this.startBtn.innerHTML = `<span class="fe-glyph a">A</span>${TEXT.charSelect.start}`;
    this.startBtn.style.display = 'none';
    this.startBtn.addEventListener('click', () => { audio.uiConfirm(); this.startBtn.blur(); this.start(); });
    bar.appendChild(this.startBtn);

    // ---- 3D stage ----
    this.scene.background = new THREE.Color(0x07080c);
    this.scene.fog = new THREE.Fog(0x07080c, 6, 14);
    // far enough back that the tallest fighter (Paz, 2 m) keeps his head
    // under the title and his feet clear of the name plates; layoutStage moves
    // it further out again as the line grows
    this.camera.position.set(0, 1.5, STAGE_Z[2]);
    this.camera.lookAt(0, 0.85, 0);

    const key = new THREE.DirectionalLight(0xfff0d8, 2.2);
    key.position.set(2.5, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const rim = new THREE.DirectionalLight(0x7aa8ff, 1.4);
    rim.position.set(-3, 2.5, -2.5);
    this.scene.add(key, rim, new THREE.AmbientLight(0x404860, 0.9));

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(8, 40),
      new THREE.MeshStandardMaterial({ color: 0x0d0f16, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // The line starts as player one plus one open place; `layoutStage` sizes
    // and spaces it from there, every frame, as players come and go.
    for (const s of this.slots) this.scene.add(s.pedestal, s.ring, s.group, s.backGlow);
    this.layoutStage(0);

    // Fire and forget. No index means no posters, which is the behaviour this
    // screen had before they existed: build the body, hold a spinner.
    void loadPosterIndex();
  }

  /**
   * Slide the line to the spacing its current size wants, growing the plinths
   * that have just been opened and shrinking away the ones no longer needed.
   *
   * Called every frame with the real frame time, and once with dt 0 when the
   * screen opens, which snaps everything into place instead of letting the
   * first visit animate in from nowhere.
   */
  private layoutStage(dt: number): void {
    const n = this.onStage();
    // past four places (PvP with bots in the line) the cards narrow to fit
    this.panels.classList.toggle('crowded', n > 4);
    // the camera eases back as the line widens, so four fit the frame without
    // two ever looking marooned at the edges
    const z = STAGE_Z[Math.max(1, Math.min(MAX_FIGHTERS, n))];
    this.camera.position.z = dt > 0 ? damp(this.camera.position.z, z, STAGE_LAMBDA, dt) : z;
    // aimed low so the line rides high in frame, leaving the band under the
    // plinths free for the name plates however few pedestals are up
    this.camera.lookAt(0, 0.85, 0);
    this.slots.forEach((s, i) => {
      // a slot that is not on stage parks off the end of the line, so when it
      // opens it slides in from the wing rather than fading up out of nowhere
      const targetX = stageX(i, i < n ? n : i + 1);
      const targetAppear = i < n ? 1 : 0;
      const x = dt > 0 ? damp(s.group.position.x, targetX, STAGE_LAMBDA, dt) : targetX;
      s.appear = dt > 0 ? damp(s.appear, targetAppear, APPEAR_LAMBDA, dt) : targetAppear;
      s.group.position.x = x;
      s.pedestal.position.x = x;
      s.ring.position.x = x;
      s.backGlow.position.set(x, 1.35, -0.72);
      const shown = s.appear > 0.02;
      s.group.visible = shown;
      s.pedestal.visible = shown;
      s.ring.visible = shown;
      // grow in from the plinth up: scale reads as arriving, not as a fade
      const k = Math.max(0.001, s.appear);
      s.group.scale.setScalar(k);
      s.pedestal.scale.set(k, 1, k);
      s.ring.scale.setScalar(k);
      s.panel.style.display = shown ? '' : 'none';
      s.panel.style.opacity = `${Math.min(1, s.appear * 1.4)}`;
      // A pedestal sits off the camera's centre line, so yaw 0 (facing +Z)
      // points the model down-screen rather than at the viewer. Every rotation
      // here is measured from the yaw that actually faces the camera, so the
      // idle sweep is centred on the model looking straight at you — and it is
      // recomputed as the line moves, since it depends on where the plinth is.
      s.baseYaw = Math.atan2(this.camera.position.x - x, this.camera.position.z);
    });
  }

  /**
   * How many plinths belong on stage: everyone in the line, plus a single open
   * place — but only where something could actually take it.
   *
   * Another human can join while there are fewer than MAX_PLAYERS of them (the
   * screen only divides so many ways), a bot can be added where the mode has
   * them, and neither can once the line is MAX_FIGHTERS long. With no room for
   * either, the invitation is a lie: an empty plinth nobody can stand on, which
   * is what a full four-player line grew the moment the line was widened past
   * four.
   *
   * Counting to the *highest* joined slot rather than the number joined keeps
   * it honest when a pad drops out mid-screen and leaves a hole: the hole is
   * itself the open place, and the players past it stay put.
   */
  private onStage(): number {
    let last = 0;
    this.slots.forEach((s, i) => { if (s.phase !== 'empty') last = i; });
    const filled = last + 1;
    const canJoin = this.humanCount() < MAX_PLAYERS || (this.allowBots && this.humanCount() > 0);
    const inviting = filled < MAX_FIGHTERS && canJoin;
    return Math.min(MAX_FIGHTERS, filled + (inviting ? 1 : 0));
  }

  private makeSlot(i: number, panels: HTMLElement): Slot {
    // one card per place in the line: the portrait on the right, fading into
    // the plate on the left that says who, with what, and whether they are in
    const panel = document.createElement('div');
    panel.className = 'charsel-panel';
    panel.style.setProperty('--pc', SLOT_COLOURS[i % SLOT_COLOURS.length]);
    panel.innerHTML = `
      <div class="in">
        <div class="art"><div class="face"></div><div class="photo"></div></div>
        <div class="fade"></div>
        <div class="body">
          <div class="charsel-status"></div>
          <div class="charsel-name"><span class="charsel-name-current"></span></div>
          <div class="charsel-kit"></div>
          <div class="epithet"></div>
        </div>
        <div class="stamp">${TEXT.charSelect.ready}</div>
        <div class="charsel-spinner" style="display:none"></div>
      </div>`;
    panels.appendChild(panel);
    // a click is A on this place: join it, lock it in, or start from it
    panel.addEventListener('click', () => this.select(i, -1));
    const q = (sel: string): HTMLElement => panel.querySelector(sel) as HTMLElement;
    const status = q('.charsel-status');
    const spinner = q('.charsel-spinner');
    const name = q('.charsel-name-current');
    const kit = q('.charsel-kit');

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.7, 0.12, 36),
      new THREE.MeshStandardMaterial({ color: 0x232a38, roughness: 0.4, metalness: 0.7 }),
    );
    pedestal.position.y = 0.06;
    pedestal.receiveShadow = true;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.64, 0.015, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xd8b25a }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.125;
    const group = new THREE.Group();
    group.position.y = 0.12;
    const backGlow = new THREE.PointLight(0xffffff, 0, 4.4, 2);
    backGlow.castShadow = false;

    return {
      phase: 'empty', bot: false, owner: -1, choice: i % this.roster.length, spinT: 0, loadingFor: 0,
      baseYaw: 0, arcT: 0, manual: 0,
      group, chars: new Map(), pedestal, ring, backGlow, glowRise: 0, glowId: null,
      appear: 0,
      panel, name, status, kit, spinner, waiting: false, poster: null, shownId: null,
    };
  }

  // ---------- roster availability ----------

  /** ids no OTHER slot has locked in (committed choices are mutually exclusive) */
  private available(slot: number): Set<PlayableId> {
    const out = new Set(this.roster);
    this.slots.forEach((s, i) => {
      if (i !== slot && (s.phase === 'ready' || s.phase === 'spinning')) out.delete(this.roster[s.choice]);
    });
    return out;
  }

  private step(slot: number, from: number, dir: -1 | 1): number {
    const ok = this.available(slot);
    for (let n = 1; n <= this.roster.length; n++) {
      const idx = (from + dir * n + this.roster.length * n) % this.roster.length;
      if (ok.has(this.roster[idx])) return idx;
    }
    return from;
  }

  private flip(slot: number, dir: -1 | 1): void {
    const s = this.slots[slot];
    if (s.phase !== 'browsing' || this.botLocked(slot)) return;
    audio.uiMove();
    s.choice = this.step(slot, s.choice, dir);
    s.loadingFor = 0;
    s.arcT = 0;                       // each new face starts square to the camera
    this.preloadAround();
    this.refresh();
  }

  /**
   * Tell the prefetcher what the stage is showing, so it can rank its
   * downloads: every plinth's current face first, then the two either side of
   * each — one button press from being on screen — ahead of everything the
   * territory behind them is still pulling down.
   *
   * The faces of every joined slot come before anyone's neighbours: with two
   * players browsing, both of the things actually on screen outrank either
   * one's guess at what comes next.
   */
  private preloadAround(): void {
    const live = this.slots
      .map((s, slot) => ({ s, slot }))
      .filter(({ s }) => s.phase !== 'empty');
    const here = live.map(({ s }) => this.roster[s.choice]);
    const next = live.flatMap(({ s, slot }) => [
      this.roster[this.step(slot, s.choice, 1)],
      this.roster[this.step(slot, s.choice, -1)],
    ]);
    this.opts.onBrowse([...new Set([...here, ...next])]);
  }

  /**
   * Put the pre-rendered picture of `id` on this plinth, if there is one and
   * the body is not already built.
   *
   * Nothing is built here — that is the whole point. A picture costs a DOM
   * node and a cached PNG; a body costs a download, a parse and an upload, and
   * paying that on every press of ◀ is what made flipping feel stuck.
   */
  private showPoster(s: Slot, id: PlayableId): boolean {
    if (s.chars.has(id)) return false;              // already built: it stays built
    if (!posterMeta(id)) return false;              // no picture for this fighter
    this.dropPoster(s);
    const img = document.createElement('img');
    img.src = posterUrl(id);
    img.alt = '';
    img.decoding = 'sync';
    img.className = 'charsel-poster';
    this.posterLayer.appendChild(img);
    s.poster = { id, img, settle: SETTLE_MS / 1000, promoted: false };
    this.layoutPosters();
    return true;
  }

  private dropPoster(s: Slot): void {
    s.poster?.img.remove();
    s.poster = null;
  }

  /**
   * Lay every live poster over the rect its fighter's body will occupy.
   *
   * The stored box is in world units off the fighter's feet, so this projects
   * it through whatever the stage is doing right now — which is what makes one
   * reference render serve one plinth or four, at any window shape, while the
   * camera eases back and the line re-spaces itself. Runs every frame for that
   * reason: the framing is in motion for most of the time a poster is up.
   */
  private layoutPosters(): void {
    const canvas = this.root.parentElement ?? document.body;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.aimCamera();
    for (const s of this.slots) {
      const poster = s.poster;
      if (!poster) continue;
      const box = posterMeta(poster.id);
      if (!box) continue;
      const x = s.group.position.x;
      const origin = PROJECT.set(x, 0, 0).project(this.camera).clone();
      const perX = PROJECT.set(x + 1, 0, 0).project(this.camera).x - origin.x;
      const perY = PROJECT.set(x, 1, 0).project(this.camera).y - origin.y;
      const left = ((origin.x + box.u0 * perX + 1) / 2) * w;
      const right = ((origin.x + box.u1 * perX + 1) / 2) * w;
      // NDC y is up, screen y is down
      const top = ((1 - (origin.y + box.v1 * perY)) / 2) * h;
      const bottom = ((1 - (origin.y + box.v0 * perY)) / 2) * h;
      poster.img.style.left = `${left.toFixed(1)}px`;
      poster.img.style.top = `${top.toFixed(1)}px`;
      poster.img.style.width = `${Math.max(0, right - left).toFixed(1)}px`;
      poster.img.style.height = `${Math.max(0, bottom - top).toFixed(1)}px`;
      // the plinth grows in and shrinks out; its picture goes with it
      poster.img.style.opacity = `${Math.min(1, s.appear * 1.4)}`;
    }
  }

  private charFor(s: Slot, id: PlayableId): PlayerCharacter {
    let c = s.chars.get(id);
    if (!c) {
      c = playableDef(id).build();
      c.root.traverse((o) => { o.castShadow = true; });
      c.animator?.play('lower', 'idleLower');
      c.animator?.play('upper', 'idleUpper');
      // The Armorer presents her signature forge axe on the select plinth.
      // Poster generation uses this same build, so the still and live model
      // agree when the authored body and prop finish loading.
      if (id === 'armorer') {
        c.setWeapon('gaffi');
        applyArmorerAxeGrip(c.gaffi, 'idleUpper');
      }
      c.setHeroLight(BASE_GLOW);
      c.root.visible = false;
      s.group.add(c.root);
      s.chars.set(id, c);
    }
    return c;
  }

  /**
   * Scale a fighter down to its plinth (see FIT_HEIGHT / FIT_FOOTPRINT), and
   * keep it there when its authored model lands.
   *
   * The measurement has to be redone after that swap: a character is born as a
   * procedural stand-in and the .glb replaces it seconds later at its own size,
   * so a fit computed once is a fit of the wrong body. Rather than reach into
   * the loader for a hook, this notices the swap by the shape of the subtree —
   * counting nodes is cheap enough to do every frame for the one fighter each
   * plinth is showing, where re-measuring geometry would not be.
   */
  private fitToPlinth(c: PlayerCharacter): void {
    const root = c.root;
    const nodes = nodeCount(root);
    const seen = this.fits.get(root);
    if (seen && seen.nodes === nodes) return;
    // measure at the size the build asked for, never at a fit already applied
    const base = seen ? seen.base : root.scale.x;
    root.scale.setScalar(base);
    visibleBounds(root, _fitBox);
    if (_fitBox.isEmpty()) return;    // nothing on screen yet: leave it alone
    _fitBox.getSize(_fitSize);
    const fit = Math.min(1,
      FIT_HEIGHT / Math.max(_fitSize.y, 1e-3),
      FIT_FOOTPRINT / Math.max(_fitSize.x, _fitSize.z, 1e-3));
    root.scale.setScalar(base * fit);
    this.fits.set(root, { nodes, base });
  }

  // ---------- input ----------

  /** Map an input source (-1 keyboard, else pad index) to a player slot. */
  private slotFor(source: number): number {
    const pads = this.opts.padForPlayer();
    // the keyboard is player one's other hand; every pad answers for the slot
    // it was assigned, however many of them there are
    if (source === -1) return 0;
    const slot = pads.indexOf(source);
    if (slot < 0 || slot >= this.slots.length) return -1;
    // A pad used on an earlier menu may already have a provisional seat that
    // points at a bot. The bot is nobody's seat; A claims a human place.
    return this.slots[slot].bot ? -1 : slot;
  }

  /**
   * What a click (or A) on one pedestal means, by where that slot is up to.
   * Mouse and pad go through the same three beats: join, lock in, start.
   */
  /** a bot's plinth answers to nobody until its owner has locked themselves in */
  private botLocked(slot: number): boolean {
    const s = this.slots[slot];
    return s.bot && this.slots[s.owner]?.phase !== 'ready';
  }

  private select(slot: number, source = -1): void {
    const s = this.slots[slot];
    if (source === -1 && this.humanSource[slot] === -2 && !s.bot) {
      this.humanSource[slot] = -1;
      this.opts.alignPads(this.humanSource);
    }
    if (this.botLocked(slot)) return;
    if (s.phase === 'empty') { audio.uiConfirm(); this.join(slot); }
    else if (s.phase === 'browsing') this.commit(slot);
    else if (s.phase === 'ready' && this.startShown) { audio.uiConfirm(); this.start(); }
  }

  /**
   * Where a controller's press to join should land: its own place if it is
   * already in the line, otherwise the first free one — then the actual owners
   * are aligned with input, so the seat a player takes in the line is the seat their
   * controller drives in the match.
   *
   * Without this, a controller that had already claimed a place by being used
   * on an earlier screen could press A over an empty plinth to its left and
   * join to its right, leaving a gap; the line would then start a match with
   * that player reading a seat their pad was not in.
   */
  private slotForJoin(source: number): number {
    if (source === -1) {
      if (this.humanSource[0] === -2) {
        this.humanSource[0] = -1;
        this.opts.alignPads(this.humanSource);
      }
      return this.drivingSlot(source);
    }
    const owner = this.humanSource.indexOf(source);
    if (owner >= 0) return this.drivingSlot(source);
    // The first pad to claim P1 owns it. If keyboard/mouse claimed P1 first,
    // this pad joins P2 even if menu activity had auto-seated it at index 0.
    if (this.humanSource[0] === -2) {
      this.humanSource[0] = source;
      this.opts.alignPads(this.humanSource);
      return 0;
    }
    // A human takes the place after the last human, which is a bot's place if
    // any bots are standing there: they shuffle right to make room, so the
    // people are always the front of the line and the machines the back of it.
    const at = this.humanCount();
    if (at >= MAX_PLAYERS || at + this.botCount() >= MAX_FIGHTERS) return -1;
    if (this.slots[at].phase !== 'empty') {
      const order = this.lineup();
      // an empty place held open at `at`: the bots behind it shuffle right,
      // and `join` fills it the moment this returns
      order.splice(at, 0, {
        from: -1, bot: false, owner: -1, phase: 'empty',
        choice: this.slots[at].choice, spinT: 0, arcT: 0, manual: 0,
      });
      this.arrange(order);
    }
    this.humanSource[at] = source;
    this.opts.alignPads(this.humanSource);
    return at;
  }

  /**
   * Which plinth this controller is driving right now.
   *
   * Its own, until that player has locked their own fighter in — from then on
   * their stick and their A button pick for the first bot they asked for that
   * has not been settled yet. That is the whole flow: choose yourself, then
   * choose for the machines, then start. Once their bots are all ready the
   * input comes back to them, so A starts the match as it always did.
   */
  private drivingSlot(source: number): number {
    const seat = this.slotFor(source);
    if (seat < 0 || this.slots[seat].phase !== 'ready') return seat;
    const bot = this.slots.findIndex((s) => s.bot && s.owner === seat && s.phase !== 'ready');
    return bot >= 0 ? bot : seat;
  }

  handle(action: MenuAction, source: number): void {
    if (action === 'alt') { this.addBot(this.slotFor(source)); return; }
    const slot = action === 'confirm' ? this.slotForJoin(source) : this.drivingSlot(source);
    if (slot < 0) return;
    const s = this.slots[slot];
    switch (action) {
      case 'left': this.flip(slot, -1); break;
      case 'right': this.flip(slot, 1); break;
      case 'confirm': this.select(slot, source); break;
      case 'back':
        // a bot backs out of its pick, and out of the line altogether
        if (s.bot) { audio.uiBack(); if (s.phase === 'ready') this.uncommit(slot); else this.leave(slot); }
        else if (s.phase === 'ready') { audio.uiBack(); this.uncommit(slot); }
        else if (slot > 0 && s.phase === 'browsing') { audio.uiBack(); this.leave(slot); }
        else if (s.phase === 'browsing') { audio.uiBack(); this.opts.onBack(); }
        break;
    }
  }

  private join(slot: number): void {
    const s = this.slots[slot];
    s.phase = 'browsing';
    // land on a free character, not on something the other player took
    if (!this.available(slot).has(this.roster[s.choice])) s.choice = this.step(slot, s.choice, 1);
    s.loadingFor = 0;
    s.waiting = false;
    s.arcT = 0;
    this.preloadAround();
    this.refresh();
  }

  private leave(slot: number): void {
    this.slots[slot].phase = 'empty';
    this.humanSource[slot] = -2;
    this.compact();
    this.preloadAround();     // one fewer face on stage: re-rank around the rest
    this.refresh();
  }

  /**
   * Close a gap in the line: every player past a slot that emptied moves down
   * one, and the pads move with them.
   *
   * This is not cosmetic. A match hands player N the input of player N, so a
   * player sitting in slot 3 while slot 2 stands empty would start the game
   * driving nobody. Pads are re-seated to match (the input layer otherwise
   * holds a slot for its device — which is right mid-fight, where a shuffle
   * would swap two players' characters, and wrong here, where nobody has a
   * character yet).
   */
  private compact(): void {
    const order = this.lineup();
    const sources = this.humanSource.slice();
    this.arrange(order);
    this.humanSource.fill(-2);
    order.forEach((entry, to) => {
      if (!entry.bot) this.humanSource[to] = sources[entry.from];
    });
    this.opts.alignPads(this.humanSource);
  }

  /**
   * The line as it should stand: everyone who is in it, humans in their join
   * order and then every bot — which is what puts the bots at the end, just
   * before the open place inviting the next player.
   *
   * A bot's `owner` is an index into the line, so it is remapped here to where
   * its owner has ended up rather than where it used to be.
   */
  private lineup(): Occupant[] {
    const held = this.slots
      .map((s, i) => ({
        from: i, bot: s.bot, owner: s.owner, phase: s.phase,
        choice: s.choice, spinT: s.spinT, arcT: s.arcT, manual: s.manual,
      }))
      .filter((e) => e.phase !== 'empty');
    const order = [...held.filter((e) => !e.bot), ...held.filter((e) => e.bot)];
    const moved = new Map(order.map((e, to) => [e.from, to]));
    for (const e of order) if (e.bot) e.owner = moved.get(e.owner) ?? 0;
    return order;
  }

  /**
   * Write a line-up back onto the plinths and empty whatever is left over.
   *
   * The bodies a slot has built stay with the plinth rather than travelling
   * with their occupant: they are a cache keyed by character, the next
   * occupant reuses or refills it, and every frame decides for itself which
   * one of them is the one to show.
   */
  private arrange(order: Occupant[]): void {
    this.slots.forEach((s, i) => {
      const e = order[i];
      s.phase = e ? e.phase : 'empty';
      s.bot = e ? e.bot : false;
      s.owner = e ? e.owner : -1;
      s.choice = e ? e.choice : s.choice;
      s.spinT = e ? e.spinT : 0;
      s.arcT = e ? e.arcT : 0;
      s.manual = e ? e.manual : 0;
      s.loadingFor = 0;
      s.waiting = false;
      if (!e) {
        this.dropPoster(s);
        for (const c of s.chars.values()) { c.root.visible = false; c.setHeroLight(BASE_GLOW); }
      }
    });
  }

  /** how many humans are in the line (they always hold the front of it) */
  private humanCount(): number { return this.slots.filter((s) => s.phase !== 'empty' && !s.bot).length; }
  /** how many bots are in the line */
  private botCount(): number { return this.slots.filter((s) => s.phase !== 'empty' && s.bot).length; }

  /**
   * Put an AI fighter in the line.
   *
   * It lands after everyone already in it, which — since bots sort behind
   * humans — is the end of the line. The player who asked for it picks its
   * character, but only once they have committed their own: until then it
   * stands there waiting, which is what the status line says.
   */
  private addBot(owner: number): void {
    if (!this.allowBots || owner < 0 || this.slots[owner].bot) return;
    if (this.humanCount() + this.botCount() >= MAX_FIGHTERS) return;
    const order = this.lineup();
    order.push({
      from: -1, bot: true, owner, phase: 'browsing',
      choice: 0, spinT: 0, arcT: 0, manual: 0,
    });
    this.arrange(order);
    // land it on a face nobody has taken
    const at = order.length - 1;
    if (!this.available(at).has(this.roster[this.slots[at].choice])) {
      this.slots[at].choice = this.step(at, this.slots[at].choice, 1);
    }
    audio.uiConfirm();
    this.preloadAround();
    this.refresh();
  }

  private commit(slot: number): void {
    const s = this.slots[slot];
    // Locking in is the answer the settle timer was waiting for, so stop
    // waiting: build the body now rather than a beat from now.
    if (s.poster && !s.poster.promoted) { s.poster.promoted = true; this.charFor(s, this.roster[s.choice]); }
    const c = s.chars.get(this.roster[s.choice]);
    if (!c || !fighterReady(c)) return;   // nothing to lock in until the whole fighter is here
    audio.uiConfirm();
    s.phase = 'spinning';
    s.spinT = 0;
    // anyone still browsing this character gets bumped off it
    this.slots.forEach((other, i) => {
      if (i !== slot && other.phase === 'browsing' && other.choice === s.choice) {
        other.choice = this.step(i, other.choice, 1);
        other.loadingFor = 0;
        other.arcT = 0;
      }
    });
    this.preloadAround();     // a lock-in can bump someone else onto a new face
    this.refresh();
  }

  private uncommit(slot: number): void {
    const s = this.slots[slot];
    s.phase = 'browsing';
    s.arcT = 0;
    s.group.rotation.y = s.baseYaw + s.manual;
    s.chars.get(this.roster[s.choice])?.setHeroLight(BASE_GLOW);
    this.preloadAround();     // browsable again: its neighbours are back in play
    this.refresh();
  }

  /**
   * Dress the screen for a mode: which ids are on offer, what the title says,
   * and how many players the mode insists on (PvP: two). Call before show().
   */
  configure(opts: { roster: PlayableId[]; title: string; minPlayers?: number; allowBots?: boolean; context?: string }): void {
    const changed = opts.roster.length !== this.roster.length
      || opts.roster.some((id, i) => id !== this.roster[i]);
    this.roster = [...opts.roster];
    this.minPlayers = opts.minPlayers ?? 1;
    this.allowBots = !!opts.allowBots;
    this.titleEl.textContent = opts.title;
    this.contextEl.textContent = opts.context ?? '';
    this.buildStrips();
    if (changed) {
      for (const s of this.slots) {
        s.choice = Math.min(s.choice, this.roster.length - 1);
        // cached characters from another roster stay cached (same ids reuse
        // them); ids no longer offered simply never get shown again
      }
    }
  }

  private start(): void {
    // a last close-up before the match takes the line as it stands: players and
    // their pads must be seats 0..n-1 with no hole, or someone drives nobody
    this.compact();
    const joined = this.slots.filter((s) => s.phase === 'ready');
    if (joined.length === 0 || joined.length !== this.slots.filter((s) => s.phase !== 'empty').length) return;
    if (joined.length < this.minPlayers) {
      this.hintEl.innerHTML = TEXT.charSelect.needFighters(this.minPlayers);
      return;
    }
    // humans first, bots after — the order the line is standing in, which is
    // the order the match seats them in
    this.opts.onStart(joined.map((s) => this.roster[s.choice]), joined.filter((s) => !s.bot).length);
  }

  // ---------- per-frame ----------

  update(dt: number): void {
    this.time += dt;
    this.dropDisconnected();
    this.layoutStage(dt);
    let allReady = true;
    let anyJoined = false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.phase === 'empty') {
        s.backGlow.intensity = 0;
        s.glowRise = 0;
        s.glowId = null;
        s.spinner.style.display = 'none'; this.dropPoster(s); continue;
      }
      anyJoined = true;
      if (s.phase !== 'ready') allReady = false;

      const id = this.roster[s.choice];
      if (s.glowId !== id) { s.glowId = id; s.glowRise = 0; s.backGlow.intensity = 0; }
      // FLIPPING: a picture, and nothing built. The real body is created once
      // this choice has sat still for SETTLE_MS, or the moment it is locked
      // in; a fighter already built never comes back here.
      if (s.poster?.id !== id && this.showPoster(s, id)) {
        s.backGlow.intensity = 0;
        for (const c of s.chars.values()) c.root.visible = false;
        s.spinner.style.display = 'none';
        continue;
      }
      if (s.poster && !s.poster.promoted) {
        s.poster.settle -= dt;
        if (s.poster.settle > 0) {
          s.backGlow.intensity = 0;
          for (const c of s.chars.values()) c.root.visible = false;
          continue;
        }
        // Build underneath the picture, and leave the picture up until the body
        // is really standing there. Retiring it here left a hole: the .glb may
        // still be coming, and even a cached one is not on screen until the
        // next render, so the plinth went empty for a frame or twenty first.
        s.poster.promoted = true;
      }
      const current = this.charFor(s, id);
      for (const [cid, c] of s.chars) c.root.visible = cid === id && fighterReady(c);
      // the handover: they are pixel-aligned by construction, so there is
      // nothing to see in it
      const handoff = !!s.poster && fighterReady(current);
      if (handoff) this.dropPoster(s);
      if (fighterReady(current) && !s.poster) {
        s.glowRise = Math.min(1.6, s.glowRise + dt);
        const breathe = 0.8 + 0.2 * Math.sin(this.time * 1.05 + i * 1.3);
        s.backGlow.intensity = 1.5 * Math.min(1, s.glowRise / 1.3) * breathe * s.appear;
      } else {
        s.glowRise = 0;
        s.backGlow.intensity = 0;
      }
      // sized to the plinth once it is the one on show — and again if its
      // authored model arrives and changes what "this fighter" measures
      this.fitToPlinth(current);

      // no procedural stand-in: wait it out, spinner after a grace period. A
      // poster covers this whenever there is one — the spinner is what a
      // fighter with no generated picture still falls back to.
      const waiting = !fighterReady(current) && !s.poster;
      if (waiting) {
        s.loadingFor += dt;
        s.spinner.style.display = s.loadingFor > SPINNER_DELAY ? '' : 'none';
      } else {
        s.loadingFor = 0;
        s.spinner.style.display = 'none';
      }
      // A press on a fighter that has not arrived is refused (see `commit`),
      // so say why rather than letting A read as broken.
      if (waiting !== s.waiting) {
        s.waiting = waiting;
        this.refresh();
      }

      // While the picture is still what is on screen, hold the body underneath
      // it at exactly the pose the picture was shot in, rather than letting its
      // idle run on unseen. The handover then lands on the same frame the
      // picture froze — the fighter does not change stance as the swap
      // happens — and the idle picks up from there. A model that is already in
      // hand never comes through here, so nothing is delayed for it.
      if (s.poster || handoff) {
        current.animator?.poseAt(POSTER_ANIM_T);
        current.cosmetic?.(0, POSTER_ANIM_T);
      } else {
        current.animator?.update(dt);
        current.cosmetic?.(dt, this.time);
      }

      if (s.phase === 'spinning') {
        s.spinT = Math.min(1, s.spinT + dt / SPIN_DURATION);
        const e = 1 - Math.pow(1 - s.spinT, 3);          // ease-out cubic
        s.group.rotation.y = s.baseYaw + e * Math.PI * 4;
        // glow crests mid-spin and settles into the ready shine
        current.setHeroLight(BASE_GLOW + Math.sin(s.spinT * Math.PI) * 1.3 + s.spinT * 0.25);
        if (s.spinT >= 1) {
          s.phase = 'ready';
          s.manual = 0;
          s.group.rotation.y = s.baseYaw;
          current.setHeroLight(BASE_GLOW + 0.25);
          this.refresh();
        }
      } else {
        // Right stick turns the model by hand; letting go eases the offset back
        // to zero, so it settles into the idle sweep rather than snapping.
        const stick = this.opts.stickX(i);
        if (stick !== 0) s.manual = wrapPi(s.manual + stick * MANUAL_RATE * dt);
        else s.manual *= Math.exp(-dt / RETURN_TAU);
        // slow turntable, centred on facing the camera, so it reads from both sides
        if (s.phase === 'browsing') s.arcT += dt;
        const arc = s.phase === 'browsing' ? Math.sin(s.arcT * ARC_RATE) * ARC : 0;
        s.group.rotation.y = s.baseYaw + arc + s.manual;
      }
    }
    const startShown = anyJoined && allReady;
    if (startShown !== this.startShown) { this.startShown = startShown; this.paintBar(); }
  }

  /**
   * A player whose controller goes away leaves the line.
   *
   * Player one is never dropped: that slot is the keyboard's as well, so it
   * survives a pad being unplugged. Everyone else *is* their controller, so
   * losing it is leaving, and the line closes up behind them — back to one
   * open place, exactly as if they had backed out.
   */
  private dropDisconnected(): void {
    const primary = this.humanSource[0];
    if (primary >= 0 && !this.opts.padConnected(primary)) {
      // P1's place survives, but a replacement pad can claim it instead of
      // being sent to a new P2 while the original controller is gone.
      this.humanSource[0] = -2;
      this.opts.alignPads(this.humanSource);
    }
    for (let i = 1; i < this.slots.length; i++) {
      if (this.slots[i].bot) continue;   // a bot is nobody's controller to lose
      const source = this.humanSource[i];
      if (this.slots[i].phase !== 'empty' && source >= 0 && !this.opts.padConnected(source)) {
        audio.uiBack();
        this.leave(i);
      }
    }
  }

  /**
   * Point the stage camera at the window it is actually being shown in.
   *
   * Anything that projects a world point to the screen needs this to have run
   * first, and "first" cannot be taken on trust: a poster is laid out the
   * moment it is created, which is not necessarily after a render. Left to
   * `render` alone the projection still carried the PerspectiveCamera default
   * aspect of 1, and a fighter two metres tall and half a metre wide was laid
   * out in a square.
   */
  private aimCamera(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /**
   * The line-up is DOM over a plain backdrop: the stage behind it is kept
   * running (see the class comment) but not drawn. The posters are still laid
   * out, since they are measured against the stage's own camera.
   */
  render(renderer: THREE.WebGLRenderer): void {
    this.aimCamera();
    this.layoutPosters();
    renderer.clear();
  }

  /**
   * Render the fighter on the first plinth as a poster: a transparent picture
   * of the body alone, through this screen's own camera, plus the box it
   * occupies in world units off its own feet.
   *
   * This lives here, on the screen the pictures are for, rather than in the
   * tool that calls it — the whole value of a poster is that it lands on the
   * same pixels the model will, and a generator with a camera of its own would
   * drift from this one the first time the stage was re-framed. See
   * `src/ui/posters.ts` for the contract; `tools/posters.mjs` drives this.
   *
   * Everything but the body is taken out of the shot: the floor, the plinths
   * and their rings, the fog and the background. The silhouette is measured
   * off the rendered alpha rather than off the geometry, because alpha is what
   * the picture actually covers — a bounding box includes a cape's rest pose
   * and every transparent margin around it.
   */
  posterShot(reference: THREE.WebGLRenderer, px = POSTER_PX, aspect = POSTER_ASPECT): PosterShot | null {
    const s = this.slots[0];
    const c = s.chars.get(this.roster[s.choice]);
    // Capture the same complete fighter that the live plinth will reveal.
    if (!c || !fighterReady(c)) return null;

    // Pin the plinth to the pose the handover happens at.
    //
    // The idle turntable keeps sweeping while a body is being waited for, and
    // how long that takes varies from run to run — so without this a poster
    // was shot at whatever yaw the sweep had reached, which made the pictures
    // irreproducible AND left them at an angle the model never appears at:
    // the runtime holds the sweep at zero for as long as a picture is up, so
    // the body it hands over to is always square to the camera. Same yaw on
    // both sides of the swap and there is nothing to see in it.
    s.arcT = 0;
    s.manual = 0;
    s.group.rotation.y = s.baseYaw;

    // ...and to a fixed point in the idle loop, for the same reason. The
    // animation had run for however many frames the .glb took to arrive, so
    // the same fighter was posed differently on every run — 14 of 30 pictures
    // changed between two back-to-back regenerations, on nothing but download
    // timing.
    c.animator?.poseAt(POSTER_ANIM_T);
    // and let whatever rides on the rig follow it there: an authored skin is
    // retargeted from the procedural pose by `cosmetic`, so the model is still
    // standing in the old pose until this runs. dt 0 so nothing advances.
    c.cosmetic?.(0, POSTER_ANIM_T);
    s.group.updateMatrixWorld(true);

    const w = Math.round(px * aspect);
    const h = px;
    const gl = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    gl.setSize(w, h, false);
    gl.setPixelRatio(1);
    gl.setClearAlpha(0);
    // The picture is handed off to the live renderer on the same plinth.
    // Match its color and lighting path or the body visibly changes at the
    // handoff even when the camera and pose are identical.
    gl.outputColorSpace = reference.outputColorSpace;
    gl.toneMapping = reference.toneMapping;
    gl.toneMappingExposure = reference.toneMappingExposure;
    gl.shadowMap.enabled = reference.shadowMap.enabled;
    gl.shadowMap.type = reference.shadowMap.type;

    // strip the stage back to the one body
    const background = this.scene.background;
    const fog = this.scene.fog;
    this.scene.background = null;
    this.scene.fog = null;
    const hidden: THREE.Object3D[] = [];
    const hide = (o: THREE.Object3D): void => { if (o.visible) { o.visible = false; hidden.push(o); } };
    for (const o of this.scene.children) if ((o as THREE.Mesh).isMesh) hide(o);   // the floor
    this.slots.forEach((slot, i) => {
      hide(slot.pedestal);
      hide(slot.ring);
      if (i !== 0) hide(slot.group);
    });
    // the plinth carries every fighter it has ever shown; only this one poses
    for (const [cid, other] of s.chars) if (cid !== this.roster[s.choice]) hide(other.root);
    c.root.visible = true;
    s.group.visible = true;

    const cam = this.camera.clone();
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    gl.render(this.scene, cam);

    const pixels = new Uint8Array(w * h * 4);
    gl.getContext().readPixels(0, 0, w, h, gl.getContext().RGBA, gl.getContext().UNSIGNED_BYTE, pixels);

    // restore the stage before anything can throw
    for (const o of hidden) o.visible = true;
    this.scene.background = background;
    this.scene.fog = fog;

    // the silhouette, off the alpha the render actually produced
    let x0 = w; let x1 = -1; let y0 = h; let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (pixels[(y * w + x) * 4 + 3] <= 8) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) { gl.dispose(); return null; }   // nothing rendered
    const padX = ((x1 - x0 + 1) * (POSTER_PAD - 1)) / 2;
    const padY = ((y1 - y0 + 1) * (POSTER_PAD - 1)) / 2;
    const l = Math.round(Math.max(0, x0 - padX));
    const r = Math.round(Math.min(w, x1 + 1 + padX));
    const b = Math.round(Math.max(0, y0 - padY));
    const t = Math.round(Math.min(h, y1 + 1 + padY));

    // The crop in NDC only means anything at the framing it was shot in. World
    // units off the fighter's own feet are a property of the body, so the
    // runtime can re-project them for any plinth count and any window shape.
    const plinthX = s.group.position.x;
    const project = (x: number, y: number): THREE.Vector3 =>
      new THREE.Vector3(x, y, 0).project(cam);
    const origin = project(plinthX, 0);
    const perX = project(plinthX + 1, 0).x - origin.x;
    const perY = project(plinthX, 1).y - origin.y;
    const ndc = {
      x0: (l / w) * 2 - 1, x1: (r / w) * 2 - 1,
      y0: (b / h) * 2 - 1, y1: (t / h) * 2 - 1,
    };
    const round = (v: number): number => +v.toFixed(4);
    const box: PosterBox = {
      u0: round((ndc.x0 - origin.x) / perX), u1: round((ndc.x1 - origin.x) / perX),
      v0: round((ndc.y0 - origin.y) / perY), v1: round((ndc.y1 - origin.y) / perY),
    };

    // readPixels is bottom-up, canvas ImageData is top-down
    const cw = r - l;
    const ch = t - b;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    const out = ctx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const src = ((b + (ch - 1 - y)) * w + (l + x)) * 4;
        const dst = (y * cw + x) * 4;
        out.data[dst] = pixels[src];
        out.data[dst + 1] = pixels[src + 1];
        out.data[dst + 2] = pixels[src + 2];
        out.data[dst + 3] = pixels[src + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
    let clear = 0;
    for (let i = 3; i < out.data.length; i += 4) if (out.data[i] <= 8) clear++;
    const png = canvas.toDataURL('image/png');
    gl.dispose();
    return {
      png, box, w: cw, h: ch,
      nodes: nodeCount(c.root),
      clear: +(clear / (cw * ch)).toFixed(4),
    };
  }

  // ---------- DOM state ----------

  private refresh(): void {
    const T = TEXT.charSelect;
    const humans = this.humanCount();
    this.slots.forEach((s, i) => {
      const id = this.roster[s.choice];
      s.panel.classList.toggle('empty', s.phase === 'empty');
      s.panel.classList.toggle('ready', s.phase === 'ready');
      s.panel.classList.toggle('locked', s.phase === 'ready' || s.phase === 'spinning');
      s.panel.classList.toggle('bot', s.bot);
      const epithet = s.panel.querySelector('.epithet') as HTMLElement;
      if (s.phase === 'empty') {
        s.name.textContent = '';
        epithet.textContent = '';
        s.kit.innerHTML = '';
        // the invitation: the next player's number, and a bot where the mode
        // has them and there is somebody in the line to pick for one
        const join = `<b>${T.tag(humans + 1)}</b>${T.join('<span class="fe-glyph a">A</span>')}`;
        s.status.innerHTML = this.allowBots && humans > 0
          ? `${join}<br/>${T.joinBot('<span class="fe-glyph y">Y</span>')}`
          : join;
        this.wear(s, null);
        return;
      }
      const pr = playableDef(id).profile;
      s.name.textContent = pr.name;
      epithet.textContent = pr.desc;
      // what the fighter brings, one chip each, so a thirty-body PvP roster is
      // a choice and not a guess
      const chips = [
        T.kit.hp(pr.maxHp),
        pr.rangedName ?? T.noGun,
        pr.meleeName,
        pr.flight === 'jetpack' ? T.kit.jetpack : T.kit.superJump,
      ];
      if (pr.squad) chips.push(T.kit.squad(pr.squad.count));
      if (pr.special === 'layEgg') chips.push(T.kit.laysEggs);
      s.kit.innerHTML = chips.map((c) => `<span>${c}</span>`).join('');
      const locked = s.phase === 'ready' || s.phase === 'spinning';
      if (s.bot) {
        const owner = T.player(s.owner + 1);
        s.status.innerHTML = `<b>${T.cpu}</b> · ${locked ? T.locked
          : s.waiting ? T.loading
            : this.slots[s.owner]?.phase === 'ready' ? T.botPicking(owner) : T.botWaiting(owner)}`;
      } else {
        s.status.innerHTML = `<b>${T.tag(i + 1)}</b> · ${locked ? T.locked : s.waiting ? T.loading : T.choosing}`;
      }
      this.wear(s, id);
    });
    this.paintStrips();
    this.paintBar();
  }

  /** put a fighter's portrait on a card, over their drawn mark in case the picture is missing */
  private wear(s: Slot, id: PlayableId | null): void {
    if (s.shownId === id) return;
    s.shownId = id;
    const face = s.panel.querySelector('.face') as HTMLElement;
    const photo = s.panel.querySelector('.photo') as HTMLElement;
    face.innerHTML = id ? faceSvg(id) : '';
    photo.style.backgroundImage = id ? `url('${portraitUrl(id)}')` : '';
  }

  /** the roster strips, one per id on offer; rebuilt only when the roster changes */
  private buildStrips(): void {
    if (this.stripRoster.length === this.roster.length
      && this.stripRoster.every((id, i) => id === this.roster[i])) return;
    this.stripRoster = [...this.roster];
    this.strips.innerHTML = '';
    // a PvP roster is three dozen strong: two rows of narrower strips
    this.strips.classList.toggle('two-rows', this.roster.length > 16);
    const perRow = this.roster.length > 16 ? Math.ceil(this.roster.length / 2) : this.roster.length;
    let row: HTMLElement | null = null;
    this.stripEls = this.roster.map((id, j) => {
      if (j % perRow === 0) {
        row = document.createElement('div');
        row.className = 'fe-strip-row';
        this.strips.appendChild(row);
      }
      const name = playableDef(id).profile.name;
      const el = document.createElement('div');
      el.className = 'fe-strip';
      el.setAttribute('aria-label', name);
      el.innerHTML = `
        <div class="in">
          <div class="face">${faceSvg(id)}</div>
          <div class="photo" style="background-image:url('${portraitUrl(id)}')"></div>
          <div class="shade"></div>
          <span class="vn">${TEXT.charSelect.short[id] ?? stripName(name)}</span>
          <span class="tags"></span>
        </div>`;
      el.addEventListener('click', () => this.pickStrip(j));
      row!.appendChild(el);
      return el;
    });
  }

  /** a click on a strip is the mouse player walking the line to that hunter */
  private pickStrip(j: number): void {
    if (this.humanSource[0] === -2) {
      this.humanSource[0] = -1;
      this.opts.alignPads(this.humanSource);
    }
    const slot = this.drivingSlot(-1);
    const s = this.slots[slot];
    if (!s || s.phase !== 'browsing' || this.botLocked(slot)) return;
    if (!this.available(slot).has(this.roster[j])) return;
    if (s.choice === j) { this.commit(slot); return; }      // a second click locks it in
    audio.uiMove();
    s.choice = j;
    s.loadingFor = 0;
    s.arcT = 0;
    this.preloadAround();
    this.refresh();
  }

  /** who is standing on which strip: widened, lit, and tagged with their places */
  private paintStrips(): void {
    this.stripEls.forEach((el, j) => {
      const here = this.slots
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.phase !== 'empty' && s.choice === j);
      el.classList.toggle('hot', here.length > 0);
      el.classList.toggle('taken', here.some(({ s }) => s.phase === 'ready' || s.phase === 'spinning'));
      (el.querySelector('.tags') as HTMLElement).innerHTML = here
        .map(({ s, i }) => `<span class="tg" style="background:${SLOT_COLOURS[i % SLOT_COLOURS.length]}">${s.bot ? TEXT.charSelect.cpu : TEXT.charSelect.tag(i + 1)}</span>`)
        .join('');
    });
  }

  /** the right end of the prompt bar: an open place, a count, or the start */
  private paintBar(): void {
    const T = TEXT.charSelect;
    this.startBtn.style.display = this.startShown ? '' : 'none';
    this.hintEl.style.display = this.startShown ? 'none' : '';
    if (this.startShown) return;
    const joined = this.slots.filter((s) => s.phase !== 'empty').length;
    const locked = this.slots.filter((s) => s.phase === 'ready').length;
    const bits: string[] = [];
    if (this.onStage() > joined) bits.push(T.joinPrompt('<span class="fe-glyph a">A</span>'));
    if (joined > 1 || locked > 0) bits.push(T.lockedCount(locked, joined));
    this.hintEl.innerHTML = bits.join('<span class="dot">·</span>');
  }

  /** the line as it stands, for tests: who is in it, in the order they stand */
  lineState(): Array<{ bot: boolean; phase: Phase; id: PlayableId | null; owner: number }> {
    return this.slots
      .filter((s) => s.phase !== 'empty')
      .map((s) => ({ bot: s.bot, phase: s.phase, id: this.roster[s.choice] ?? null, owner: s.owner }));
  }

  show(primarySource = -1): void {
    this.root.style.display = '';
    this.startShown = false;
    this.humanSource.fill(-2);
    this.humanSource[0] = primarySource;
    this.opts.alignPads(this.humanSource);
    // P1 walks in browsing; P2 waits for a join. Committed picks reset each visit.
    this.slots.forEach((s, i) => {
      s.phase = i === 0 ? 'browsing' : 'empty';
      s.bot = false;
      s.owner = -1;
      s.arcT = 0;
      s.manual = 0;
      s.group.rotation.y = s.baseYaw;
      s.loadingFor = 0;
      s.waiting = false;
      s.glowRise = 0;
      s.glowId = null;
      s.backGlow.intensity = 0;
      this.dropPoster(s);
      for (const c of s.chars.values()) { c.root.visible = false; c.setHeroLight(BASE_GLOW); }
    });
    if (!this.available(0).has(this.roster[this.slots[0].choice])) this.slots[0].choice = 0;
    this.preloadAround();
    this.layoutStage(0);            // open on the line already spaced, not sliding in
    this.refresh();
  }
  hide(): void {
    this.root.style.display = 'none';
    // the pictures are DOM over the stage, and the stage stops being drawn
    for (const s of this.slots) this.dropPoster(s);
  }
  get visible(): boolean { return this.root.style.display !== 'none'; }
}
