import * as THREE from 'three';
import { audio } from '../core/audio';
import type { MenuAction } from '../core/input';
import { buildMandalorian, MANDO_ROSTER, type MandoId, type PlayerCharacter } from '../characters/mandalorians';
import { preloadAuthored } from '../characters/authored';

/**
 * 3D character select: two pedestals rendered by the game's own renderer, with
 * a thin DOM chrome on top (names, arrows, join/ready prompts). Player 1 is
 * keyboard + first pad; a second pad joins by pressing A on its own pedestal.
 *
 * Only the authored models are ever shown — the procedural body a character is
 * born with stays hidden, and a pedestal shows a spinner instead if its model
 * takes longer than SPINNER_DELAY to arrive. Committing needs a loaded model,
 * so by the time the match starts every picked model is warm in the cache.
 */

const ROSTER = Object.keys(MANDO_ROSTER) as MandoId[];
const SPINNER_DELAY = 0.7;
const SPIN_DURATION = 0.9;
/** resting emissive lift, matched to how the hero reads in-game */
const BASE_GLOW = 0.22;

type Phase = 'empty' | 'browsing' | 'spinning' | 'ready';

interface Slot {
  phase: Phase;
  choice: number;                 // index into ROSTER
  spinT: number;                  // 0..1 through the commit spin
  loadingFor: number;             // seconds the current model has kept us waiting
  group: THREE.Group;             // pedestal-local root the characters stand in
  chars: Map<MandoId, PlayerCharacter>;
  // DOM
  panel: HTMLElement;
  name: HTMLElement;
  status: HTMLElement;
  spinner: HTMLElement;
  arrows: HTMLElement[];
}

export class CharacterSelect {
  root: HTMLElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  private slots: Slot[] = [];
  private startBtn: HTMLElement;
  private time = 0;

  constructor(
    parent: HTMLElement,
    private opts: {
      onStart: (chars: MandoId[], playerCount: number) => void;
      onBack: () => void;
      /** gamepad index driving each player slot, -1 for none (from InputManager) */
      padForPlayer: () => number[];
    },
  ) {
    // ---- DOM chrome (transparent — the 3D scene shows through) ----
    this.root = document.createElement('div');
    this.root.className = 'menu-screen charsel-screen';
    this.root.style.display = 'none';
    parent.appendChild(this.root);

    const title = document.createElement('div');
    title.className = 'menu-title charsel-title';
    title.textContent = 'Choose Your Mandalorian';
    this.root.appendChild(title);

    const panels = document.createElement('div');
    panels.className = 'charsel-panels';
    this.root.appendChild(panels);

    for (let i = 0; i < 2; i++) this.slots.push(this.makeSlot(i, panels));

    this.startBtn = document.createElement('button');
    this.startBtn.className = 'menu-btn charsel-start';
    this.startBtn.textContent = 'Start Game';
    this.startBtn.style.display = 'none';
    this.startBtn.addEventListener('click', () => { audio.uiConfirm(); this.start(); });
    this.root.appendChild(this.startBtn);

    const hint = document.createElement('div');
    hint.className = 'menu-hint';
    hint.innerHTML = '<b>◀ ▶</b> switch · <b>A</b>/<b>Enter</b> select · <b>B</b>/<b>Esc</b> back';
    this.root.appendChild(hint);

    // ---- 3D stage ----
    this.scene.background = new THREE.Color(0x07080c);
    this.scene.fog = new THREE.Fog(0x07080c, 6, 14);
    // far enough back that the tallest fighter (Paz, 2 m) keeps his head
    // under the title and his feet clear of the name plates
    this.camera.position.set(0, 1.5, 4.8);
    this.camera.lookAt(0, 1.05, 0);

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

    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? -1.4 : 1.4;
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.62, 0.7, 0.12, 36),
        new THREE.MeshStandardMaterial({ color: 0x232a38, roughness: 0.4, metalness: 0.7 }),
      );
      pedestal.position.set(x, 0.06, 0);
      pedestal.receiveShadow = true;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.64, 0.015, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0xd8b25a }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, 0.125, 0);
      this.scene.add(pedestal, ring);
      this.slots[i].group.position.set(x, 0.12, 0);
      this.scene.add(this.slots[i].group);
    }
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

    return {
      phase: 'empty', choice: i % ROSTER.length, spinT: 0, loadingFor: 0,
      group: new THREE.Group(), chars: new Map(),
      panel, name, status, spinner, arrows,
    };
  }

  // ---------- roster availability ----------

  /** ids no OTHER slot has locked in (committed choices are mutually exclusive) */
  private available(slot: number): Set<MandoId> {
    const out = new Set(ROSTER);
    this.slots.forEach((s, i) => {
      if (i !== slot && (s.phase === 'ready' || s.phase === 'spinning')) out.delete(ROSTER[s.choice]);
    });
    return out;
  }

  private step(slot: number, from: number, dir: -1 | 1): number {
    const ok = this.available(slot);
    for (let n = 1; n <= ROSTER.length; n++) {
      const idx = (from + dir * n + ROSTER.length * n) % ROSTER.length;
      if (ok.has(ROSTER[idx])) return idx;
    }
    return from;
  }

  private flip(slot: number, dir: -1 | 1): void {
    const s = this.slots[slot];
    if (s.phase !== 'browsing') return;
    audio.uiMove();
    s.choice = this.step(slot, s.choice, dir);
    s.loadingFor = 0;
    this.preloadNeighbours(slot);
    this.refresh();
  }

  /** Warm the models one flip away in either direction — the likely next views. */
  private preloadNeighbours(slot: number): void {
    const s = this.slots[slot];
    preloadAuthored(ROSTER[this.step(slot, s.choice, 1)]);
    preloadAuthored(ROSTER[this.step(slot, s.choice, -1)]);
  }

  // ---------- character instances ----------

  private charFor(s: Slot, id: MandoId): PlayerCharacter {
    let c = s.chars.get(id);
    if (!c) {
      c = buildMandalorian(id);
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

  // ---------- input ----------

  /** Map an input source (-1 keyboard, else pad index) to a player slot. */
  private slotFor(source: number): number {
    const pads = this.opts.padForPlayer();
    if (source === -1 || source === pads[0]) return 0;
    if (source === pads[1]) return 1;
    return -1;
  }

  handle(action: MenuAction, source: number): void {
    const slot = this.slotFor(source);
    if (slot < 0) return;
    const s = this.slots[slot];
    switch (action) {
      case 'left': this.flip(slot, -1); break;
      case 'right': this.flip(slot, 1); break;
      case 'confirm':
        if (s.phase === 'empty') { audio.uiConfirm(); this.join(slot); }
        else if (s.phase === 'browsing') this.commit(slot);
        else if (s.phase === 'ready' && this.startBtn.style.display !== 'none') { audio.uiConfirm(); this.start(); }
        break;
      case 'back':
        if (s.phase === 'ready') { audio.uiBack(); this.uncommit(slot); }
        else if (slot === 1 && s.phase === 'browsing') { audio.uiBack(); this.leave(slot); }
        else if (slot === 0 && s.phase === 'browsing') { audio.uiBack(); this.opts.onBack(); }
        break;
    }
  }

  private join(slot: number): void {
    const s = this.slots[slot];
    s.phase = 'browsing';
    // land on a free character, not on something the other player took
    if (!this.available(slot).has(ROSTER[s.choice])) s.choice = this.step(slot, s.choice, 1);
    s.loadingFor = 0;
    this.preloadNeighbours(slot);
    this.refresh();
  }

  private leave(slot: number): void {
    const s = this.slots[slot];
    s.phase = 'empty';
    this.refresh();
  }

  private commit(slot: number): void {
    const s = this.slots[slot];
    const c = s.chars.get(ROSTER[s.choice]);
    if (!c || !c.modelReady()) return;   // nothing to lock in until the model is here
    audio.uiConfirm();
    s.phase = 'spinning';
    s.spinT = 0;
    // anyone still browsing this character gets bumped off it
    this.slots.forEach((other, i) => {
      if (i !== slot && other.phase === 'browsing' && other.choice === s.choice) {
        other.choice = this.step(i, other.choice, 1);
        other.loadingFor = 0;
      }
    });
    this.refresh();
  }

  private uncommit(slot: number): void {
    const s = this.slots[slot];
    s.phase = 'browsing';
    s.group.rotation.y = 0;
    s.chars.get(ROSTER[s.choice])?.setHeroLight(BASE_GLOW);
    this.refresh();
  }

  private start(): void {
    const joined = this.slots.filter((s) => s.phase === 'ready');
    if (joined.length === 0 || joined.length !== this.slots.filter((s) => s.phase !== 'empty').length) return;
    this.opts.onStart(joined.map((s) => ROSTER[s.choice]), joined.length);
  }

  // ---------- per-frame ----------

  update(dt: number): void {
    this.time += dt;
    let allReady = true;
    let anyJoined = false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.phase === 'empty') { s.spinner.style.display = 'none'; continue; }
      anyJoined = true;
      if (s.phase !== 'ready') allReady = false;

      const id = ROSTER[s.choice];
      const current = this.charFor(s, id);
      for (const [cid, c] of s.chars) c.root.visible = cid === id && c.modelReady();

      // no procedural stand-in: wait it out, spinner after a grace period
      if (!current.modelReady()) {
        s.loadingFor += dt;
        s.spinner.style.display = s.loadingFor > SPINNER_DELAY ? '' : 'none';
      } else {
        s.loadingFor = 0;
        s.spinner.style.display = 'none';
      }

      current.animator?.update(dt);
      current.cosmetic?.(dt, this.time);

      if (s.phase === 'spinning') {
        s.spinT = Math.min(1, s.spinT + dt / SPIN_DURATION);
        const e = 1 - Math.pow(1 - s.spinT, 3);          // ease-out cubic
        s.group.rotation.y = e * Math.PI * 4;
        // glow crests mid-spin and settles into the ready shine
        current.setHeroLight(BASE_GLOW + Math.sin(s.spinT * Math.PI) * 1.3 + s.spinT * 0.25);
        if (s.spinT >= 1) {
          s.phase = 'ready';
          s.group.rotation.y = 0;
          current.setHeroLight(BASE_GLOW + 0.25);
          this.refresh();
        }
      } else if (s.phase === 'browsing') {
        // slow turntable so the model reads from all sides
        s.group.rotation.y = Math.sin(this.time * 0.4) * 0.35;
      }
    }
    this.startBtn.style.display = anyJoined && allReady ? '' : 'none';
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }

  // ---------- DOM state ----------

  private refresh(): void {
    this.slots.forEach((s, i) => {
      const id = ROSTER[s.choice];
      if (s.phase === 'empty') {
        s.name.textContent = '';
        s.status.innerHTML = `<b>Player ${i + 1}</b><br/>Press <b>A</b> to join`;
        s.panel.classList.add('empty');
        s.panel.classList.remove('ready');
      } else {
        s.name.textContent = MANDO_ROSTER[id].name;
        s.status.innerHTML = s.phase === 'ready' ? '<b>READY</b>' : `<b>Player ${i + 1}</b>`;
        s.panel.classList.toggle('ready', s.phase === 'ready' || s.phase === 'spinning');
        s.panel.classList.remove('empty');
      }
      const browsing = s.phase === 'browsing';
      for (const a of s.arrows) a.style.visibility = browsing ? 'visible' : 'hidden';
    });
  }

  show(): void {
    this.root.style.display = '';
    // P1 walks in browsing; P2 waits for a join. Committed picks reset each visit.
    this.slots.forEach((s, i) => {
      s.phase = i === 0 ? 'browsing' : 'empty';
      s.group.rotation.y = 0;
      s.loadingFor = 0;
      for (const c of s.chars.values()) { c.root.visible = false; c.setHeroLight(BASE_GLOW); }
    });
    if (!this.available(0).has(ROSTER[this.slots[0].choice])) this.slots[0].choice = 0;
    this.preloadNeighbours(0);
    this.refresh();
  }
  hide(): void { this.root.style.display = 'none'; }
  get visible(): boolean { return this.root.style.display !== 'none'; }
}
