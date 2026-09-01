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
import { propsSettled } from '../characters/builder';
import type { PlayerCharacter } from '../characters/mandalorians';
import { playableDef, STANDARD_ROSTER, type PlayableId } from '../characters/roster';

/**
 * 3D character select: two pedestals rendered by the game's own renderer, with
 * a thin DOM chrome on top (names, arrows, join/ready prompts). Player 1 is
 * keyboard + first pad; a second pad joins by pressing A on its own pedestal.
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
/** radians of yaw per pixel of mouse drag */
const DRAG_RATE = 0.011;
/** resting emissive lift, matched to how the hero reads in-game */
const BASE_GLOW = 0.22;

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
  appear: number;                 // 0 = off stage, 1 = fully in the line
  screenX: number;                // last projected x, 0..1 across the window
  // DOM
  panel: HTMLElement;
  name: HTMLElement;
  status: HTMLElement;
  spinner: HTMLElement;
  arrows: HTMLElement[];
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
  private titleEl!: HTMLElement;
  private hintEl!: HTMLElement;
  /** in-progress mouse drag: which pedestal it grabbed and where it last was */
  private drag: { slot: number; lastX: number } | null = null;
  /** live press, to tell a click apart from a drag on release */
  private press: { slot: number; x: number; y: number; moved: number } | null = null;

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
      /** close gaps in the pad-to-slot assignment after a player drops out */
      compactPads: () => void;
      /** move a controller to a given player slot, trading places with it */
      seatPad: (padIndex: number, slot: number) => void;
      /** right-stick X for a player slot, for free-look on that pedestal */
      stickX: (slot: number) => number;
    },
  ) {
    // ---- DOM chrome (transparent — the 3D scene shows through) ----
    this.root = document.createElement('div');
    this.root.className = 'menu-screen charsel-screen';
    this.root.style.display = 'none';
    parent.appendChild(this.root);

    const title = document.createElement('div');
    title.className = 'menu-title charsel-title';
    title.textContent = TEXT.charSelect.title;
    this.root.appendChild(title);
    this.titleEl = title;

    // Before the panels, so a picture sits over the 3D stage and under every
    // name plate and arrow — the plates are what a player reads while the
    // pictures are flipping past.
    const posterLayer = document.createElement('div');
    posterLayer.className = 'charsel-posters';
    this.root.appendChild(posterLayer);
    this.posterLayer = posterLayer;

    const panels = document.createElement('div');
    panels.className = 'charsel-panels';
    this.root.appendChild(panels);
    this.panels = panels;

    for (let i = 0; i < MAX_FIGHTERS; i++) this.slots.push(this.makeSlot(i, panels));

    this.startBtn = document.createElement('button');
    this.startBtn.className = 'menu-btn charsel-start';
    this.startBtn.textContent = TEXT.charSelect.start;
    this.startBtn.style.display = 'none';
    this.startBtn.addEventListener('click', () => { audio.uiConfirm(); this.start(); });
    this.root.appendChild(this.startBtn);

    const hint = document.createElement('div');
    hint.className = 'menu-hint';
    hint.innerHTML = TEXT.charSelect.hint;
    this.root.appendChild(hint);
    this.hintEl = hint;

    // ---- mouse drag turns the model on the pedestal you grabbed ----
    // The stage is drawn behind this overlay rather than into it, so the
    // pedestal is picked from which half of the screen the drag started in;
    // that is exactly the region its panel occupies.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      const slot = this.slotNearest(e.clientX);
      // Remember every press, not just the ones that can turn a model: a press
      // on an empty or spinning pedestal can still resolve into a click.
      this.press = { slot, x: e.clientX, y: e.clientY, moved: 0 };
      const phase = this.slots[slot].phase;
      if (phase === 'empty' || phase === 'spinning') return;   // nothing to turn
      this.drag = { slot, lastX: e.clientX };
      this.root.classList.add('dragging');
    });
    this.root.addEventListener('pointermove', (e) => {
      if (this.press) {
        this.press.moved = Math.max(this.press.moved, Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y));
      }
      if (!this.drag) return;
      const s = this.slots[this.drag.slot];
      s.manual = wrapPi(s.manual + (e.clientX - this.drag.lastX) * DRAG_RATE);
      this.drag.lastX = e.clientX;
    });
    // on window, so releasing outside the screen still ends the drag
    const endDrag = () => { this.drag = null; this.root.classList.remove('dragging'); };
    window.addEventListener('pointerup', (e) => {
      // A press that barely moved is a click, not a turn: it selects the
      // pedestal it landed on — join an empty slot, lock in a browsing one,
      // start from a ready one — which is what A does on a pad.
      const press = this.press;
      this.press = null;
      endDrag();
      if (press && press.moved < 6 && !(e.target as HTMLElement).closest('button')) {
        this.select(press.slot);
      }
    });
    window.addEventListener('pointercancel', () => { this.press = null; endDrag(); });

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
    for (const s of this.slots) this.scene.add(s.pedestal, s.ring, s.group);
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
    const panel = document.createElement('div');
    panel.className = 'charsel-panel';
    panels.appendChild(panel);

    const status = document.createElement('div');
    status.className = 'charsel-status';
    panel.appendChild(status);

    const spinner = document.createElement('div');
    spinner.className = 'charsel-spinner';
    spinner.style.display = 'none';
    panel.appendChild(spinner);

    const base = document.createElement('div');
    base.className = 'charsel-base';
    panel.appendChild(base);
    const mkArrow = (dir: -1 | 1): HTMLElement => {
      const a = document.createElement('button');
      a.className = 'charsel-arrow';
      a.textContent = dir < 0 ? '◀' : '▶';
      a.addEventListener('click', () => this.flip(i, dir));
      return a;
    };
    const name = document.createElement('div');
    name.className = 'charsel-name';
    const arrows = [mkArrow(-1), mkArrow(1)];
    base.append(arrows[0], name, arrows[1]);

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

    return {
      phase: 'empty', bot: false, owner: -1, choice: i % this.roster.length, spinT: 0, loadingFor: 0,
      baseYaw: 0, arcT: 0, manual: 0,
      group, chars: new Map(), pedestal, ring, appear: 0, screenX: 0.5,
      panel, name, status, spinner, arrows, waiting: false, poster: null,
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

  /**
   * The on-stage pedestal nearest a click.
   *
   * The stage is drawn behind this overlay rather than into it, so a click is
   * matched to a plinth by where that plinth projects on screen — which is
   * exact however many are up and wherever the line has slid to. (Splitting
   * the window in half worked only while there were exactly two.)
   */
  private slotNearest(clientX: number): number {
    const x = clientX / window.innerWidth;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.onStage(); i++) {
      const d = Math.abs(this.slots[i].screenX - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** Map an input source (-1 keyboard, else pad index) to a player slot. */
  private slotFor(source: number): number {
    const pads = this.opts.padForPlayer();
    // the keyboard is player one's other hand; every pad answers for the slot
    // it was assigned, however many of them there are
    if (source === -1) return 0;
    const slot = pads.indexOf(source);
    if (slot < 0 || slot >= this.slots.length) return -1;
    // A pad is seated by index as soon as it is plugged in, which can point it
    // at a place a bot is standing in — and a bot is nobody's seat. That pad is
    // simply not in the line yet, and pressing A puts it in one.
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

  private select(slot: number): void {
    const s = this.slots[slot];
    if (this.botLocked(slot)) return;
    if (s.phase === 'empty') { audio.uiConfirm(); this.join(slot); }
    else if (s.phase === 'browsing') this.commit(slot);
    else if (s.phase === 'ready' && this.startBtn.style.display !== 'none') { audio.uiConfirm(); this.start(); }
  }

  /**
   * Where a controller's press to join should land: its own place if it is
   * already in the line, otherwise the first free one — and the pad is re-seated
   * to match, so the seat a player takes in the line is the seat their
   * controller drives in the match.
   *
   * Without this, a controller that had already claimed a place by being used
   * on an earlier screen could press A over an empty plinth to its left and
   * join to its right, leaving a gap; the line would then start a match with
   * that player reading a seat their pad was not in.
   */
  private slotForJoin(source: number): number {
    const seat = this.drivingSlot(source);
    // already in the line — either their own place, or the bot they are picking for
    if (seat >= 0 && this.slots[seat].phase !== 'empty') return seat;
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
    if (source !== -1) this.opts.seatPad(source, at);
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
      case 'confirm': this.select(slot); break;
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
    this.arrange(this.lineup());
    this.opts.compactPads();
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
    if (!c || !c.modelReady()) return;   // nothing to lock in until the model is here
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
  configure(opts: { roster: PlayableId[]; title: string; minPlayers?: number; allowBots?: boolean }): void {
    const changed = opts.roster.length !== this.roster.length
      || opts.roster.some((id, i) => id !== this.roster[i]);
    this.roster = [...opts.roster];
    this.minPlayers = opts.minPlayers ?? 1;
    this.allowBots = !!opts.allowBots;
    this.titleEl.textContent = opts.title;
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
      if (s.phase === 'empty') { s.spinner.style.display = 'none'; this.dropPoster(s); continue; }
      anyJoined = true;
      if (s.phase !== 'ready') allReady = false;

      const id = this.roster[s.choice];
      // FLIPPING: a picture, and nothing built. The real body is created once
      // this choice has sat still for SETTLE_MS, or the moment it is locked
      // in; a fighter already built never comes back here.
      if (s.poster?.id !== id && this.showPoster(s, id)) {
        for (const c of s.chars.values()) c.root.visible = false;
        s.spinner.style.display = 'none';
        continue;
      }
      if (s.poster && !s.poster.promoted) {
        s.poster.settle -= dt;
        if (s.poster.settle > 0) {
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
      for (const [cid, c] of s.chars) c.root.visible = cid === id && c.modelReady();
      // the handover: they are pixel-aligned by construction, so there is
      // nothing to see in it
      if (s.poster && current.modelReady()) this.dropPoster(s);
      // sized to the plinth once it is the one on show — and again if its
      // authored model arrives and changes what "this fighter" measures
      this.fitToPlinth(current);

      // no procedural stand-in: wait it out, spinner after a grace period. A
      // poster covers this whenever there is one — the spinner is what a
      // fighter with no generated picture still falls back to.
      const waiting = !current.modelReady() && !s.poster;
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
      if (s.poster) {
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
        else if (this.drag?.slot !== i) s.manual *= Math.exp(-dt / RETURN_TAU);
        // slow turntable, centred on facing the camera, so it reads from both sides
        if (s.phase === 'browsing') s.arcT += dt;
        const arc = s.phase === 'browsing' ? Math.sin(s.arcT * ARC_RATE) * ARC : 0;
        s.group.rotation.y = s.baseYaw + arc + s.manual;
      }
    }
    this.startBtn.style.display = anyJoined && allReady ? '' : 'none';
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
    const pads = this.opts.padForPlayer();
    for (let i = 1; i < this.slots.length; i++) {
      if (this.slots[i].bot) continue;   // a bot is nobody's controller to lose
      if (this.slots[i].phase !== 'empty' && (pads[i] ?? -1) < 0) {
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

  render(renderer: THREE.WebGLRenderer): void {
    this.aimCamera();
    this.layoutPanels();
    this.layoutPosters();
    renderer.render(this.scene, this.camera);
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
  posterShot(px = POSTER_PX, aspect = POSTER_ASPECT): PosterShot | null {
    const s = this.slots[0];
    const c = s.chars.get(this.roster[s.choice]);
    // The weapon has to have landed too. `modelReady` answers for the body
    // alone, and a fighter shot in between carried the procedural stand-in —
    // a thin stick in the picture where the model on the plinth holds a
    // rifle. Waiting is free here: this runs in the generator, not in play.
    if (!c || !c.modelReady() || !propsSettled(c.root)) return null;

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

  /**
   * Put each player's name and arrows under that player's pedestal.
   *
   * The panels used to be equal flex columns, which lined up with two
   * pedestals only because the spacing had been picked to make it so — and
   * only at one aspect ratio. Projecting the pedestal instead is exact at any
   * window shape and any number of players.
   */
  private layoutPanels(): void {
    const box = this.panels.getBoundingClientRect();
    for (const s of this.slots) {
      // Joined slots hang their plate off the plinth; an empty one puts its
      // invitation up where a character would stand, so the eye reads a place
      // waiting to be filled rather than a caption under an empty disc.
      PROJECT.copy(s.group.position);
      // a hand's width below the plinth for a name, chest height for an
      // invitation — measured in the world, so the gap shrinks in perspective
      // with the plinth rather than sitting on the ring when the line is short
      PROJECT.y += s.phase === 'empty' ? 1.15 : -0.45;
      PROJECT.project(this.camera);
      s.screenX = PROJECT.x * 0.5 + 0.5;
      s.panel.style.left = `${s.screenX * 100}%`;
      // Following the plinth vertically as well keeps the name clear of it at
      // every line width: the stage camera pulls back as players join, which
      // slides the whole line up the screen.
      // ...and clamped to the band between the title and the hint, so a short
      // line placing its plinths low on screen can never push a name into them
      const y = (1 - (PROJECT.y * 0.5 + 0.5)) * window.innerHeight - box.top;
      s.panel.style.top = `${Math.max(0, Math.min(y, box.height - 74))}px`;
    }
  }

  // ---------- DOM state ----------

  private refresh(): void {
    this.slots.forEach((s, i) => {
      const id = this.roster[s.choice];
      if (s.phase === 'empty') {
        s.name.textContent = '';
        const join = `<b>${TEXT.charSelect.player(this.humanCount() + 1)}</b><br/>${TEXT.charSelect.join}`;
        // the invitation only offers a bot where the mode has them, and only
        // to a line with somebody in it to pick for one
        s.status.innerHTML = this.allowBots && this.humanCount() > 0
          ? `${join}<br/>${TEXT.charSelect.joinBot}`
          : join;
        s.panel.classList.add('empty');
        s.panel.classList.remove('ready');
      } else if (s.bot) {
        s.name.textContent = playableDef(id).profile.name;
        const owner = TEXT.charSelect.player(s.owner + 1);
        const tag = `<b>${TEXT.charSelect.bot}</b><br/>`;
        s.status.innerHTML = s.phase === 'ready' ? `${tag}${TEXT.charSelect.ready}`
          : s.waiting ? `${tag}${TEXT.charSelect.loading}`
            : this.slots[s.owner]?.phase === 'ready'
              ? `${tag}${TEXT.charSelect.botPicking(owner)}`
              : `${tag}${TEXT.charSelect.botWaiting(owner)}`;
        s.panel.classList.toggle('ready', s.phase === 'ready' || s.phase === 'spinning');
        s.panel.classList.remove('empty');
      } else {
        s.name.textContent = playableDef(id).profile.name;
        s.status.innerHTML = s.phase === 'ready' ? `<b>${TEXT.charSelect.ready}</b>`
          : s.waiting ? `<b>${TEXT.charSelect.player(i + 1)}</b><br/>${TEXT.charSelect.loading}`
            : `<b>${TEXT.charSelect.player(i + 1)}</b>`;
        s.panel.classList.toggle('ready', s.phase === 'ready' || s.phase === 'spinning');
        s.panel.classList.remove('empty');
      }
      const browsing = s.phase === 'browsing' && (!s.bot || this.slots[s.owner]?.phase === 'ready');
      for (const a of s.arrows) a.style.visibility = browsing ? 'visible' : 'hidden';
    });
  }

  /** the line as it stands, for tests: who is in it, in the order they stand */
  lineState(): Array<{ bot: boolean; phase: Phase; id: PlayableId | null; owner: number }> {
    return this.slots
      .filter((s) => s.phase !== 'empty')
      .map((s) => ({ bot: s.bot, phase: s.phase, id: this.roster[s.choice] ?? null, owner: s.owner }));
  }

  show(): void {
    this.root.style.display = '';
    this.drag = null;
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
      this.dropPoster(s);
      for (const c of s.chars.values()) { c.root.visible = false; c.setHeroLight(BASE_GLOW); }
    });
    if (!this.available(0).has(this.roster[this.slots[0].choice])) this.slots[0].choice = 0;
    this.preloadAround();
    this.layoutStage(0);            // open on the line already spaced, not sliding in
    this.layoutPanels();
    this.refresh();
  }
  hide(): void {
    this.root.style.display = 'none';
    this.drag = null;
    this.root.classList.remove('dragging');
    // the pictures are DOM over the stage, and the stage stops being drawn
    for (const s of this.slots) this.dropPoster(s);
  }
  get visible(): boolean { return this.root.style.display !== 'none'; }
}
