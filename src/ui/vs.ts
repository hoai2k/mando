import { TEXT } from '../text';
import { audio } from '../core/audio';
import { ASSET_ROOT } from '../core/assets';
import { playableDef, type PlayableId } from '../characters/roster';
import { faceSvg, portraitName } from './faces';
import { makeStage } from './stage';

/**
 * The PvP pre-battle splash: showdown at high noon (docs/UI_CONCEPTS.md,
 * round 6). Every fighter is a Wanted poster slammed onto the guild's bounty
 * board, with a sheriff's star reading VS in the gap between each pair of
 * neighbours — centred in that gap, so it never leans toward either side.
 * Purely presentational: it plays over the seconds the match's files are
 * already warming, then hands off to the drop screen. A press skips it.
 *
 * Up to four hang in one row; five to eight hang in two, with one more star
 * between the rows so there is still one per pairing.
 */

const DURATION = 3.2;
/** the poster is drawn at this width and scaled to the room the line allows */
const POSTER_W = 400;
const POSTER_H = 500;
const SLOT_COLOURS = ['#e0452c', '#3d86e0', '#4fb05a', '#e8b830', '#b06ad8', '#e07a2c', '#3dc0c0', '#c8c0b0'];
const tex = (file: string): string => `url('${ASSET_ROOT}assets/textures/${file}')`;

export class VsScreen {
  root: HTMLElement;
  onDone: (() => void) | null = null;
  private timer = 0;
  private running = false;
  private stage: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'vs-screen';
    this.root.style.display = 'none';
    this.root.style.backgroundImage = tex('ui_bounty_board.jpg');
    parent.appendChild(this.root);
    this.stage = makeStage(this.root);
    // a click anywhere is the same as A: into the fight
    this.root.addEventListener('pointerdown', () => this.finish());
  }

  /**
   * `humans` is how many of `ids` have somebody holding a controller; the rest
   * are bots, and are tagged as such rather than given a player number they
   * would only be borrowing. `where` names the territory under the clock.
   */
  show(ids: PlayableId[], humans = ids.length, where = ''): void {
    const stage = this.stage;
    stage.innerHTML = '';
    const n = ids.length;
    const rows = n <= 4 ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)];
    // poster width and the gap a star sits in, by how crowded the line is
    const w = n === 2 ? 400 : n === 3 ? 300 : n === 4 ? 225 : 180;
    const gap = n === 2 ? 210 : n <= 4 ? 84 : 70;
    const scale = w / POSTER_W;
    const h = POSTER_H * scale;
    const rowGap = 40;
    const top0 = rows.length === 1 ? 70 + (500 - h) / 2 : 40;
    let i = 0;
    const star = (x: number, y: number, main: boolean, delay: number): void => {
      const el = document.createElement('div');
      el.className = `vs-emblem${main ? ' main' : ''}`;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.animationDelay = `${delay}s`;
      el.innerHTML = `<svg viewBox="-100 -100 200 200" aria-hidden="true">
          <polygon points="0,-92 21,-29 88,-29 34,11 54,74 0,36 -54,74 -34,11 -88,-29 -21,-29" fill="#c9a24a" stroke="#6b4c16" stroke-width="5"/>
          <circle r="42" fill="#8a1e12" stroke="#f0d492" stroke-width="3"/></svg><span>VS</span>`;
      stage.appendChild(el);
    };
    rows.forEach((k, r) => {
      const total = k * w + (k - 1) * gap;
      const x0 = (1280 - total) / 2;
      const y = top0 + r * (h + rowGap);
      for (let j = 0; j < k; j++, i++) {
        const id = ids[i];
        const def = playableDef(id);
        const bot = i >= humans;
        const panel = document.createElement('div');
        panel.className = 'vs-panel';
        panel.style.left = `${x0 + j * (w + gap)}px`;
        panel.style.top = `${y}px`;
        panel.style.transform = `scale(${scale})`;
        const tilt = i % 2 === 0 ? -4 : 3.5;
        panel.innerHTML = `
          <div class="vs-poster ${i % 2 === 0 ? 'from-left' : 'from-right'}" style="--tilt:${tilt}deg;animation-delay:${i * 0.1}s;background-image:${tex('ui_paper_aged.jpg')}">
            <span class="vs-pin"></span>
            <span class="vs-tag" style="background:${bot ? '#8b7a63' : SLOT_COLOURS[i % SLOT_COLOURS.length]}">${bot ? TEXT.vs.bot : TEXT.vs.player(i + 1)}</span>
            <div class="vs-w">${TEXT.vs.wanted}</div><div class="vs-d">${TEXT.vs.deadOrAlive}</div>
            <div class="vs-face">${faceSvg(id)}<i style="background-image:${tex(`${portraitName(id)}.jpg`)}"></i></div>
            <div class="vs-name"></div>
            <div class="vs-kit"></div>
          </div>`;
        (panel.querySelector('.vs-name') as HTMLElement).textContent = def.profile.name;
        (panel.querySelector('.vs-kit') as HTMLElement).textContent =
          [def.profile.rangedName, def.profile.meleeName].filter(Boolean).join(' · ')
          + (def.profile.squad ? TEXT.vs.squad(def.profile.squad.count) : '');
        stage.appendChild(panel);
        // a star in the middle of the gap to the next poster in this row
        if (j < k - 1) star(x0 + j * (w + gap) + w + gap / 2, y + h / 2, n === 2, 0.35 + i * 0.1);
      }
    });
    // two rows: one more star between them, so every pairing still has one
    if (rows.length > 1) star(640, top0 + h + rowGap / 2, true, 0.5);
    const foot = document.createElement('div');
    foot.className = 'vs-foot';
    foot.innerHTML = `<div class="clock">${TEXT.vs.highNoon}</div><div class="where"></div><div class="skip">${TEXT.vs.skip}</div>`;
    (foot.querySelector('.where') as HTMLElement).textContent =
      [where, TEXT.boardSelect.ticket.pvp].filter(Boolean).join(' · ');
    stage.appendChild(foot);
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
