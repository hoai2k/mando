import { audio } from '../core/audio';
import { ASSET_ROOT } from '../core/assets';
import { playableDef, type PlayableId } from '../characters/roster';
import { faceSvg, portraitName } from './faces';

/**
 * The PvP pre-battle splash: fighters on opposing angled panels split by a
 * slanted divider, Smash-style, with the VS emblem on the seam. Purely
 * presentational — it plays over the seconds the match's files are already
 * warming, then hands off to the drop screen. A press skips it.
 *
 * Panel slant is one shared angle so every seam is parallel; each panel is a
 * clip-path over the full screen, which keeps the layout exact for 2, 3 or 4
 * fighters without per-count CSS.
 */

const DURATION = 3.2;
/** seam slant, as % of screen width the top edge leads the bottom by */
const SLANT = 6;
/** fighter panel palettes, by slot — one each for a full eight-strong line */
const PANEL = [
  ['#7a1f14', '#2a0c08'],
  ['#1d3a5f', '#0a141f'],
  ['#7a5c1a', '#2a1f08'],
  ['#1f5f33', '#081f10'],
  ['#5a2470', '#1c0a24'],
  ['#1c5f63', '#071f20'],
  ['#7a3a12', '#2a1206'],
  ['#4a4f58', '#14171a'],
];

export class VsScreen {
  root: HTMLElement;
  onDone: (() => void) | null = null;
  private timer = 0;
  private running = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'vs-screen';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
    // a click anywhere is the same as A: into the fight
    this.root.addEventListener('pointerdown', () => this.finish());
  }

  /**
   * `humans` is how many of `ids` have somebody holding a controller; the rest
   * are bots, and are tagged as such rather than given a player number they
   * would only be borrowing.
   */
  show(ids: PlayableId[], humans = ids.length): void {
    this.root.innerHTML = '';
    const n = ids.length;
    ids.forEach((id, i) => {
      const def = playableDef(id);
      const panel = document.createElement('div');
      panel.className = `vs-panel from-${i % 2 === 0 ? 'left' : 'right'}`;
      const palette = PANEL[i % PANEL.length];
      panel.style.background = `linear-gradient(160deg, ${palette[0]}, ${palette[1]})`;
      // seam x at the top leads the bottom by SLANT, shared by neighbours
      const x0 = (i / n) * 100;
      const x1 = ((i + 1) / n) * 100;
      const top0 = i === 0 ? -SLANT : x0 + SLANT / 2;
      const bot0 = i === 0 ? -SLANT : x0 - SLANT / 2;
      const top1 = i === n - 1 ? 100 + SLANT : x1 + SLANT / 2;
      const bot1 = i === n - 1 ? 100 + SLANT : x1 - SLANT / 2;
      panel.style.clipPath = `polygon(${top0}% 0, ${top1}% 0, ${bot1}% 100%, ${bot0}% 100%)`;
      panel.style.animationDelay = `${i * 0.09}s`;
      const cx = (x0 + x1) / 2;
      panel.innerHTML = `
        <div class="vs-fighter${n > 2 ? ' narrow' : ''}" style="left:${cx}%">
          <div class="vs-face">${faceSvg(id)}</div>
          <div class="vs-tag">${i < humans ? `P${i + 1}` : 'BOT'}</div>
          <div class="vs-name">${def.profile.name}</div>
          <div class="vs-kit">${def.profile.rangedName ?? def.profile.meleeName}${def.profile.squad ? ' · squad ×' + def.profile.squad.count : ''}</div>
        </div>`;
      this.root.appendChild(panel);
      // authored portrait takes over the drawn mark when the file exists
      const face = panel.querySelector('.vs-face') as HTMLElement;
      const img = new Image();
      img.onload = () => {
        face.style.backgroundImage = `url('${img.src}')`;
        face.classList.add('has-art');
      };
      img.src = `${ASSET_ROOT}assets/textures/${portraitName(id)}.jpg`;
    });
    // one emblem per seam keeps a 4-way readable; the centre one is the loudest
    for (let i = 1; i < n; i++) {
      const vs = document.createElement('div');
      vs.className = `vs-emblem${n === 2 || i === Math.ceil(n / 2) ? ' main' : ''}`;
      // the emblem rides its seam's midpoint (the seam slants SLANT/2 each way)
      vs.style.left = `${(i / n) * 100}%`;
      vs.textContent = 'VS';
      this.root.appendChild(vs);
    }
    this.root.style.display = '';
    this.timer = 0;
    this.running = true;
    audio.waveStart();
  }

  /** confirm / click / timeout all end it the same way */
  finish(): void {
    if (!this.running) return;
    this.running = false;
    this.root.style.display = 'none';
    audio.uiConfirm();
    this.onDone?.();
  }

  update(dt: number): void {
    if (!this.running) return;
    this.timer += dt;
    if (this.timer >= DURATION) this.finish();
  }

  hide(): void {
    this.running = false;
    this.root.style.display = 'none';
  }
  get visible(): boolean { return this.root.style.display !== 'none'; }
}
