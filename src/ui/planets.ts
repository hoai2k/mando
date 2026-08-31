import { audio } from '../core/audio';
import type { MenuAction } from '../core/input';
import { BOARDS, type BoardInfo } from '../world/boards';
import { ASSET_ROOT } from '../core/assets';

/**
 * Campaign planet select (docs/MODES.md §4): a star map rather than a list.
 * The territories are laid out as a hyperspace route — always advancing to the
 * right, but stepping up or down as it goes, with a dashed lane drawn between
 * each pair. Moving the selection pans the whole map so the newly selected
 * planet settles near the middle of the screen, the way a board select works
 * in a campaign map. All planets are unlocked for now — the lock-past-your-
 * frontier rule is a designed expansion, not v1.
 *
 * Planet art drops in as assets/textures/planet_<id>.png (ASSETS_IMAGES.md);
 * until then each disc is a CSS sphere in its territory's palette.
 */

/** horizontal distance between two stops on the route, before jitter */
const SPACING = 340;
/** a planet's own radius plus the caption under it, in map units */
const CAPTION_ROOM = 140;
/** how far above or below the spine a stop may sit */
const SPREAD = 115;

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

export class PlanetSelect {
  root: HTMLElement;
  private viewport: HTMLElement;
  private map: HTMLElement;
  private cells: HTMLElement[] = [];
  private nodes: Node[];
  private lanes: SVGPathElement[] = [];
  private index = 0;
  /** half the vertical room the map wants, in map units — measured below */
  private needHalf = 1;
  onPick: ((board: BoardInfo) => void) | null = null;
  onBack: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'menu-screen planet-screen';
    this.root.style.display = 'none';
    parent.appendChild(this.root);

    const title = document.createElement('div');
    title.className = 'menu-title';
    title.textContent = 'Missions';
    this.root.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'menu-subtitle';
    sub.textContent = 'Nine territories to liberate, one warlord at a time';
    this.root.appendChild(sub);

    // The viewport is the window onto the map; it clips only at the screen's
    // own edges, so a focused planet's glow is never cut by a container.
    const viewport = document.createElement('div');
    viewport.className = 'planet-viewport';
    this.root.appendChild(viewport);
    this.viewport = viewport;
    this.map = document.createElement('div');
    this.map.className = 'planet-map';
    viewport.appendChild(this.map);

    this.nodes = plotRoute(BOARDS.length);
    // How much vertical room the map needs around whichever planet is centred:
    // the widest swing between any two stops close enough to share the screen,
    // plus the height of a caption hanging under the lower of them. Measured
    // from the route itself rather than assumed, so tuning SPREAD can't quietly
    // start cutting names off at the bottom of the frame.
    let swing = 0;
    this.nodes.forEach((a, i) => {
      for (let j = i + 1; j < Math.min(this.nodes.length, i + 3); j++) {
        swing = Math.max(swing, Math.abs(this.nodes[j].y - a.y));
      }
    });
    this.needHalf = swing + CAPTION_ROOM;

    // ---- the route itself, drawn under the planets ----
    const minY = Math.min(...this.nodes.map((n) => n.y));
    const maxY = Math.max(...this.nodes.map((n) => n.y));
    const width = this.nodes[this.nodes.length - 1].x + SPACING;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'planet-lanes');
    svg.setAttribute('viewBox', `0 ${minY - 200} ${width} ${maxY - minY + 400}`);
    svg.setAttribute('width', `${width}`);
    svg.setAttribute('height', `${maxY - minY + 400}`);
    svg.style.left = '0';
    svg.style.top = `${minY - 200}px`;
    this.map.appendChild(svg);

    for (let i = 0; i < this.nodes.length - 1; i++) {
      const a = this.nodes[i];
      const b = this.nodes[i + 1];
      // a shallow arc, bowed away from the straight line, so the lane reads as
      // a plotted course instead of a chart axis
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 + (b.y > a.y ? -1 : 1) * 26;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`);
      path.setAttribute('class', 'planet-lane');
      svg.appendChild(path);
      this.lanes.push(path);
    }

    // ---- the planets ----
    BOARDS.forEach((info, i) => {
      const cell = document.createElement('div');
      cell.className = 'planet-node';
      cell.style.left = `${this.nodes[i].x}px`;
      cell.style.top = `${this.nodes[i].y}px`;
      cell.innerHTML = `
        <div class="planet-disc-wrap">
          <div class="planet-disc" style="background-image:
            radial-gradient(circle at 32% 30%, rgba(255,255,255,0.35), rgba(255,255,255,0) 45%),
            url('${ASSET_ROOT}assets/textures/planet_${info.id}.png'),
            ${info.gradient};"></div>
        </div>
        <div class="planet-plate">
          <div class="planet-stage">Mission ${i + 1}</div>
          <div class="planet-name">${info.name}</div>
          <div class="planet-desc">${info.desc}</div>
        </div>`;
      cell.addEventListener('click', () => {
        if (this.index === i) this.pick();
        else { this.index = i; audio.uiMove(); this.layout(); }
      });
      this.map.appendChild(cell);
      this.cells.push(cell);
    });

    const hint = document.createElement('div');
    hint.className = 'menu-hint';
    hint.innerHTML = '<b>◀ ▶</b> travel the sector · <b>A</b>/<b>Enter</b>/<b>click</b> begin the mission · <b>B</b>/<b>Esc</b> back';
    this.root.appendChild(hint);

    // the fit-to-height scale is measured, so it has to be re-measured
    addEventListener('resize', () => { if (this.visible) this.layout(); });
  }

  private layout(): void {
    this.cells.forEach((d, i) => {
      d.classList.toggle('focused', i === this.index);
      // planets behind you on the route stay lit; the ones ahead sit back
      d.classList.toggle('past', i < this.index);
    });
    this.lanes.forEach((l, i) => l.classList.toggle('travelled', i < this.index));
    // The map slides so the selected planet sits at the viewport's middle, and
    // shrinks to fit when the window is short — the neighbour a full swing up
    // or down the route needs its name on screen too, and a scaled map is far
    // better than a caption cut off by the frame.
    const half = this.viewport.clientHeight / 2;
    const scale = half > 0 ? Math.min(1, Math.max(0.6, half / this.needHalf)) : 1;
    const n = this.nodes[this.index];
    this.map.style.transform = `scale(${scale}) translate(${-n.x}px, ${-n.y}px)`;
  }

  private pick(): void {
    audio.uiConfirm();
    this.onPick?.(BOARDS[this.index]);
  }

  handle(action: MenuAction): void {
    switch (action) {
      case 'left':
        if (this.index > 0) { this.index--; audio.uiMove(); this.layout(); }
        break;
      case 'right':
        if (this.index < this.cells.length - 1) { this.index++; audio.uiMove(); this.layout(); }
        break;
      case 'confirm': this.pick(); break;
      case 'back': if (this.onBack) { audio.uiBack(); this.onBack(); } break;
    }
  }

  show(): void {
    this.root.style.display = '';
    // Jump to the selection without a slide the first time the screen paints:
    // an opening animation from wherever the map happened to sit reads as a
    // glitch, not a flourish.
    this.map.style.transition = 'none';
    this.layout();
    void this.map.offsetWidth;
    this.map.style.transition = '';
  }
  hide(): void { this.root.style.display = 'none'; }
  get visible(): boolean { return this.root.style.display !== 'none'; }
}
