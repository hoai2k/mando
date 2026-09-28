import { TEXT } from '../text';
import { audio } from '../core/audio';
import type { MenuAction } from '../core/input';
import { BOARDS, type BoardInfo } from '../world/boards';
import { ASSET_ROOT } from '../core/assets';
import { makeStage } from './stage';

/**
 * Campaign planet select (docs/MODES.md §4, docs/UI_CONCEPTS.md): the bounty
 * hunt, drawn as a galaxy map with a lens over it.
 *
 * The territories sit on a hyperspace route across the lower half of the
 * screen — always advancing to the right, stepping up or down as it goes, with
 * a dashed lane between each pair. The selected world sits at the centre, and
 * above it a lens looks into that world's own solar system
 * (`system_<id>.jpg`, with the territory's palette standing in until the
 * painting arrives).
 *
 * Moving is a target lock, not a browse: the open lens is gone at once, the map
 * snaps across to the new world while a bracket closes on it, and the new lens
 * springs up out of the planet itself. Quick enough that walking the whole
 * route is a string of clicks rather than a wait.
 *
 * All planets are unlocked for now — the lock-past-your-frontier rule is a
 * designed expansion, not v1.
 *
 * Planet art drops in as assets/textures/planet_<id>.png (ASSETS_IMAGES.md);
 * until then each disc is a CSS sphere in its territory's palette.
 */

/** horizontal distance between two stops on the route, before jitter */
const SPACING = 340;
/** how far above or below the spine a stop may sit */
const SPREAD = 115;
/** the route is drawn at this scale across, so five systems share the screen… */
const K = 0.8;
/** …and flatter up and down, so every stop clears the lens above and the card below */
const KY = 0.6;
/** the selected world's column, the route's spine, and the lens's bottom edge (stage px) */
const MAP_X = 640;
const MAP_Y = 475;
const LENS_BOTTOM = 346;
const LENS_CY = LENS_BOTTOM - 142;
/** the target bracket's reach above a world's centre */
const LOCK_REACH = 48;
/** how long the map takes to cross to the new target before the lens opens, ms */
const PAN_MS = 190;

interface Node { x: number; y: number; }

/**
 * A tiny deterministic generator: the route has to look hand-drawn but be the
 * same every time the screen opens, so the map a player learns stays the map
 * they come back to. (Math.random would redraw it on every visit.)
 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Plot the route left to right. Each stop sits above or below the spine —
 * mostly on the opposite side from the last one, which is what makes the lane
 * zig-zag rather than run straight, but not always: every so often two in a
 * row stay on the same side and the course only shallows out. Placing each
 * stop against the spine rather than stepping from the previous one keeps the
 * whole route inside its band without any clamping to flatten it out.
 */
function plotRoute(count: number): Node[] {
  const rand = rng(0x5eed17);
  const nodes: Node[] = [{ x: 0, y: 0 }];
  let side: 1 | -1 = rand() < 0.5 ? 1 : -1;
  for (let i = 1; i < count; i++) {
    if (i === 1 || rand() < 0.75) side = side === 1 ? -1 : 1;
    // a same-side repeat sits closer in, so the course reads as a bend rather
    // than a second stop at the same altitude
    const near = nodes[i - 1].y !== 0 && Math.sign(nodes[i - 1].y) === side;
    const mag = SPREAD * (near ? 0.2 + rand() * 0.3 : 0.55 + rand() * 0.45);
    nodes.push({ x: i * SPACING + (rand() - 0.5) * 70, y: side * mag });
  }
  return nodes;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const tex = (file: string): string => `url('${ASSET_ROOT}assets/textures/${file}')`;

export class PlanetSelect {
  root: HTMLElement;
  private map: HTMLElement;
  private galaxy: HTMLElement;
  private lens: HTMLElement;
  private lensLabel: HTMLElement;
  private leader: HTMLElement;
  private vistas: HTMLElement[] = [];
  private cells: HTMLElement[] = [];
  private nodes: Node[];
  private lanes: SVGPathElement[] = [];
  private index = 0;
  private openTimer = 0;
  private band: { chapter: HTMLElement; name: HTMLElement; trail: HTMLElement; terms: HTMLElement };
  onPick: ((board: BoardInfo) => void) | null = null;
  onBack: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'menu-screen fe-screen fe-hunt';
    this.root.style.display = 'none';
    parent.appendChild(this.root);

    // the star field fills the window; everything else is on the stage
    this.galaxy = document.createElement('div');
    this.galaxy.className = 'fe-gal';
    this.root.appendChild(this.galaxy);
    const stage = makeStage(this.root);

    this.nodes = plotRoute(BOARDS.length).map((n) => ({ x: n.x * K, y: n.y * KY }));

    // ---- the route, and the planets on it ----
    this.map = document.createElement('div');
    this.map.className = 'fe-map';
    this.map.style.left = `${MAP_X}px`;
    this.map.style.top = `${MAP_Y}px`;
    stage.appendChild(this.map);
    const minY = Math.min(...this.nodes.map((n) => n.y)) - 200;
    const maxY = Math.max(...this.nodes.map((n) => n.y)) + 200;
    const width = this.nodes[this.nodes.length - 1].x + SPACING;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'fe-lanes');
    svg.setAttribute('viewBox', `-300 ${minY} ${width + 300} ${maxY - minY}`);
    svg.setAttribute('width', `${width + 300}`);
    svg.setAttribute('height', `${maxY - minY}`);
    svg.style.left = '-300px';
    svg.style.top = `${minY}px`;
    this.map.appendChild(svg);
    for (let i = 0; i < this.nodes.length - 1; i++) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      // a shallow arc, bowed away from the straight line, so the lane reads as
      // a plotted course instead of a chart axis
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 + (b.y > a.y ? -1 : 1) * 20;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`);
      path.setAttribute('class', 'fe-lane');
      svg.appendChild(path);
      this.lanes.push(path);
    }
    BOARDS.forEach((info, i) => {
      const cell = document.createElement('div');
      cell.className = 'fe-star';
      cell.setAttribute('aria-label', info.name);
      cell.style.left = `${this.nodes[i].x}px`;
      cell.style.top = `${this.nodes[i].y}px`;
      cell.innerHTML = `
        <span class="gl"><i style="background-image:${tex(`planet_${info.id}.png`)}, ${info.gradient}"></i></span>
        <span class="lock"><b></b><b></b><b></b><b></b></span>
        <span class="lb"><span class="rn">${ROMAN[i] ?? i + 1}</span><span class="nm">${info.name.replace(/^The /, '')}</span></span>`;
      cell.addEventListener('click', () => {
        if (this.index === i) this.pick();
        else this.travel(i);
      });
      this.map.appendChild(cell);
      this.cells.push(cell);
    });

    // ---- the lens, and the leader line tying it to the world it shows ----
    const leader = document.createElement('div');
    leader.className = 'fe-leader';
    leader.style.top = `${LENS_BOTTOM}px`;
    stage.appendChild(leader);
    this.leader = leader;
    this.lens = document.createElement('div');
    this.lens.className = 'fe-lens';
    stage.appendChild(this.lens);
    for (const info of BOARDS) {
      const v = document.createElement('div');
      v.className = 'fe-vista';
      v.style.backgroundImage = `${tex(`system_${info.id}.jpg`)}, ${info.gradient}`;
      this.lens.appendChild(v);
      this.vistas.push(v);
    }
    this.lensLabel = document.createElement('div');
    this.lensLabel.className = 'fe-lens-label';
    this.lens.appendChild(this.lensLabel);

    // ---- heading, and the chapter card along the bottom ----
    const head = document.createElement('div');
    head.className = 'fe-hunt-head';
    head.innerHTML = `<span class="h">${TEXT.planets.heading}</span><span class="s">${TEXT.planets.sub}</span>`;
    stage.appendChild(head);

    const band = document.createElement('div');
    band.className = 'fe-hunt-band';
    band.innerHTML = `
      <div class="c1"><span class="chapter"></span><span class="name"></span></div>
      <div class="c2"><span class="trail"></span><span class="terms"></span></div>
      <div class="c3">
        <button class="fe-nav" data-dir="-1" aria-label="previous">◀</button><button class="fe-nav" data-dir="1" aria-label="next">▶</button>
        <span class="fe-prompts"><span><span class="fe-glyph a">A</span><b>${TEXT.planets.rideOut}</b></span><span><span class="fe-glyph b">B</span>${TEXT.boardSelect.prompts.back}</span></span>
      </div>`;
    stage.appendChild(band);
    const q = (sel: string): HTMLElement => band.querySelector(sel) as HTMLElement;
    this.band = { chapter: q('.chapter'), name: q('.name'), trail: q('.trail'), terms: q('.terms') };
    for (const b of band.querySelectorAll<HTMLButtonElement>('.fe-nav')) {
      b.addEventListener('click', () => { b.blur(); this.travel(this.index + Number(b.dataset.dir)); });
    }
  }

  /** everything that follows the selection at once: the map, the bracket, the card */
  private layout(): void {
    this.cells.forEach((d, i) => d.classList.toggle('on', i === this.index));
    this.lanes.forEach((l, i) => l.classList.toggle('plot', i < this.index));
    // The map slides across only: each world keeps its own height on the
    // route, so the neighbours never swing up under the lens or down behind
    // the card, and the leader stretches to wherever the target sits.
    const n = this.nodes[this.index];
    this.map.style.transform = `translateX(${-n.x}px)`;
    this.leader.style.height = `${Math.max(0, MAP_Y + n.y - LOCK_REACH - LENS_BOTTOM)}px`;
    // the star field drifts a little behind the map, so the pan has depth
    this.galaxy.style.backgroundPosition =
      `${-n.x * 0.1}px 0, ${-n.x * 0.05}px 0, ${-n.x * 0.3}px ${-n.y * 0.3}px, ${-n.x * 0.3}px ${-n.y * 0.3}px, ${-n.x * 0.3}px ${-n.y * 0.3}px`;

    const info = BOARDS[this.index];
    const rn = ROMAN[this.index] ?? String(this.index + 1);
    const world = TEXT.worlds[info.id] ?? '';
    const stages = (TEXT.missions.stages as Record<string, readonly string[]>)[info.id] ?? [];
    const rooms = ((TEXT.missions.rooms as Record<string, readonly string[]>)[info.id] ?? []).length;
    const warlord = (TEXT.bosses.warlord as Record<string, string>)[info.id] ?? '';
    this.band.chapter.textContent = TEXT.planets.chapter(rn, world);
    this.band.name.textContent = info.name;
    this.band.trail.textContent = stages.join(' → ');
    this.band.terms.innerHTML = `${TEXT.planets.rooms(rooms)} · ${TEXT.planets.warlord} <b></b>`;
    (this.band.terms.querySelector('b') as HTMLElement).textContent = warlord;
  }

  /** point the lens at the selected system and spring it open out of the planet */
  private openLens(): void {
    const info = BOARDS[this.index];
    this.vistas.forEach((v, i) => v.classList.toggle('on', i === this.index));
    // the lens grows out of the planet: it starts shrunk to a point at the
    // world's centre, a long way below the lens's own middle
    this.lens.style.setProperty('--drop', `${MAP_Y + this.nodes[this.index].y - LENS_CY}px`);
    this.lensLabel.textContent = TEXT.planets.system(ROMAN[this.index] ?? String(this.index + 1), TEXT.worlds[info.id] ?? '');
    this.root.classList.remove('shut');
    this.lens.classList.remove('open');
    void this.lens.offsetWidth;
    this.lens.classList.add('open');
  }

  /** lock onto another world: lens gone, map across, bracket in, new lens up */
  private travel(i: number): void {
    if (i < 0 || i >= this.cells.length || i === this.index) return;
    this.index = i;
    audio.uiMove();
    window.clearTimeout(this.openTimer);
    this.root.classList.add('shut');
    this.lens.classList.remove('open');
    // restart the bracket's closing snap even when a quick double press lands
    // back on a world it just left
    const lock = this.cells[i].querySelector('.lock') as HTMLElement;
    lock.style.animation = 'none';
    void lock.offsetWidth;
    lock.style.animation = '';
    this.layout();
    this.openTimer = window.setTimeout(() => this.openLens(), PAN_MS);
  }

  private pick(): void {
    audio.uiConfirm();
    this.onPick?.(BOARDS[this.index]);
  }

  handle(action: MenuAction): void {
    switch (action) {
      case 'left': this.travel(this.index - 1); break;
      case 'right': this.travel(this.index + 1); break;
      case 'confirm': this.pick(); break;
      case 'back': if (this.onBack) { audio.uiBack(); this.onBack(); } break;
    }
  }

  show(): void {
    this.root.style.display = '';
    // Jump to the selection without a slide the first time the screen paints:
    // an opening animation from wherever the map happened to sit reads as a
    // glitch, not a flourish. The lens still springs open — that one is an
    // arrival, not a glitch.
    this.map.style.transition = 'none';
    this.layout();
    void this.map.offsetWidth;
    this.map.style.transition = '';
    this.openLens();
  }
  hide(): void {
    window.clearTimeout(this.openTimer);
    this.root.style.display = 'none';
  }
  get visible(): boolean { return this.root.style.display !== 'none'; }
}
