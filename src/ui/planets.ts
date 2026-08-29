import { audio } from '../core/audio';
import type { MenuAction } from '../core/input';
import { BOARDS, type BoardInfo } from '../world/boards';
import { ASSET_ROOT } from '../core/assets';

/**
 * Campaign planet select (docs/MODES.md §4): one planet per territory, laid
 * left to right in campaign order and continuing offscreen. Scroll with the
 * stick/arrows, click or A to drop onto one. All planets are unlocked for now
 * — the lock-past-your-frontier rule is a designed expansion, not v1.
 *
 * Planet art drops in as assets/textures/planet_<id>.png (ASSETS_IMAGES.md);
 * until then each disc is a CSS sphere in its territory's palette.
 */
export class PlanetSelect {
  root: HTMLElement;
  private strip: HTMLElement;
  private discs: HTMLElement[] = [];
  private index = 0;
  onPick: ((board: BoardInfo) => void) | null = null;
  onBack: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'menu-screen planet-screen';
    this.root.style.display = 'none';
    parent.appendChild(this.root);

    const title = document.createElement('div');
    title.className = 'menu-title';
    title.textContent = 'The Campaign';
    this.root.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'menu-subtitle';
    sub.textContent = 'Nine territories to liberate, one warlord at a time';
    this.root.appendChild(sub);

    const window_ = document.createElement('div');
    window_.className = 'planet-window';
    this.root.appendChild(window_);
    this.strip = document.createElement('div');
    this.strip.className = 'planet-strip';
    window_.appendChild(this.strip);

    BOARDS.forEach((info, i) => {
      const cell = document.createElement('div');
      cell.className = 'planet-cell';
      cell.innerHTML = `
        <div class="planet-disc" style="background-image:
          radial-gradient(circle at 32% 30%, rgba(255,255,255,0.35), rgba(255,255,255,0) 45%),
          url('${ASSET_ROOT}assets/textures/planet_${info.id}.png'),
          ${info.gradient};"></div>
        <div class="planet-name">${info.name}</div>
        <div class="planet-desc">${info.desc}</div>
        <div class="planet-stage">Chapter ${i + 1}</div>`;
      cell.addEventListener('click', () => {
        if (this.index === i) this.pick();
        else { this.index = i; audio.uiMove(); this.layout(); }
      });
      this.strip.appendChild(cell);
      this.discs.push(cell);
    });

    const hint = document.createElement('div');
    hint.className = 'menu-hint';
    hint.innerHTML = '<b>◀ ▶</b> travel the sector · <b>A</b>/<b>Enter</b>/<b>click</b> begin the chapter · <b>B</b>/<b>Esc</b> back';
    this.root.appendChild(hint);
  }

  private layout(): void {
    this.discs.forEach((d, i) => d.classList.toggle('focused', i === this.index));
    // the strip slides so the focused planet sits at the window's focal point;
    // later chapters run on past the right edge, which is the point
    const cell = this.discs[this.index];
    const offset = cell.offsetLeft + cell.offsetWidth / 2;
    // anchored in viewport units: translate % would measure the strip itself,
    // which grows with every planet and drags the focal point leftward
    this.strip.style.transform = `translateX(calc(34vw - ${offset}px))`;
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
        if (this.index < this.discs.length - 1) { this.index++; audio.uiMove(); this.layout(); }
        break;
      case 'confirm': this.pick(); break;
      case 'back': if (this.onBack) { audio.uiBack(); this.onBack(); } break;
    }
  }

  show(): void {
    this.root.style.display = '';
    this.layout();
  }
  hide(): void { this.root.style.display = 'none'; }
  get visible(): boolean { return this.root.style.display !== 'none'; }
}
