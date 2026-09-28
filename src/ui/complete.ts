import { TEXT } from '../text';
import { ASSET_ROOT, portraitName } from '../core/assets';
import { BOARDS } from '../world/boards';
import { playableDef, type PlayableId } from '../characters/roster';
import type { HuntLedger } from '../core/hunt';
import { faceSvg } from './faces';
import { MenuScreen } from './menus';
import { makeStage } from './stage';

/**
 * The end of the bounty hunt: all nine territories liberated
 * (docs/UI_CONCEPTS.md, round 6). The route lit end to end with every world
 * ticked, the hunters who put in the most takedowns across it, and the way
 * on — hunt again, roll the credits, or leave.
 */

const tex = (file: string): string => `url('${ASSET_ROOT}assets/textures/${file}')`;
/** where each world sits on the lit route, stage px */
const ROUTE_Y = [0, -22, 40, 20, -48, 30, -26, 36, -30];
const clockOf = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`;
};

export interface CompleteActions { again: () => void; credits: () => void; quit: () => void; }

export class CompleteScreen {
  readonly screen: MenuScreen;
  private stage: HTMLElement;

  constructor(parent: HTMLElement, actions: CompleteActions) {
    const T = TEXT.complete;
    this.screen = new MenuScreen(parent, 'menu-screen fe-screen fe-complete');
    this.stage = makeStage(this.screen.root);
    this.stage.innerHTML = `
      <div class="c-head"><div class="k">${T.kicker}</div><div class="h">${T.heading}</div><div class="t"></div></div>
      <div class="c-route"></div>
      <div class="c-crew"></div>
      <div class="c-bar"></div>`;
    this.screen.addButtons(this.stage.querySelector('.c-bar') as HTMLElement, [
      { label: T.huntAgain, action: actions.again },
      { label: T.credits, action: actions.credits },
      { label: T.quit, action: actions.quit },
    ]);
    this.screen.onBack = actions.quit;
  }

  show(h: HuntLedger): void {
    const T = TEXT.complete;
    (this.stage.querySelector('.c-head .t') as HTMLElement).textContent = T.tally(h.liberated.length, clockOf(h.elapsed));
    // the route, lit end to end, every freed world ticked
    const xs = BOARDS.map((_, i) => 90 + i * 132);
    const pts = xs.map((x, i) => `${x},${ROUTE_Y[i] ?? 0}`);
    const path = `M ${pts[0]} ` + pts.slice(1).map((p, i) => {
      const [x0, y0] = pts[i].split(',').map(Number);
      const [x1, y1] = p.split(',').map(Number);
      return `Q ${(x0 + x1) / 2} ${(y0 + y1) / 2 + (y1 > y0 ? -24 : 24)} ${x1} ${y1}`;
    }).join(' ');
    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
    (this.stage.querySelector('.c-route') as HTMLElement).innerHTML = `
      <svg viewBox="0 -100 1280 200" width="1280" height="200" aria-hidden="true"><path d="${path}"/></svg>
      ${BOARDS.map((b, i) => `
        <div class="w${h.liberated.includes(b.id) ? ' done' : ''}" style="left:${xs[i]}px;top:${ROUTE_Y[i]}px">
          <span class="gl" style="background-image:${tex(`planet_${b.id}.png`)}, ${b.gradient}"></span>
          <span class="tk">✓</span><span class="rn">${ROMAN[i] ?? i + 1}</span>
        </div>`).join('')}`;
    // the four who did the most, by takedowns across the whole hunt
    const crew = (Object.entries(h.kills) as Array<[PlayableId, number]>).sort((a, b) => b[1] - a[1]).slice(0, 4);
    (this.stage.querySelector('.c-crew') as HTMLElement).innerHTML = crew.map(([id, kills], i) => `
      <div class="m">
        <span class="pic">${faceSvg(id)}<i style="background-image:${tex(`${portraitName(id)}.jpg`)}"></i></span>
        <span class="n">${playableDef(id).profile.name}</span>
        <span class="k">${T.takedowns(kills)}${i === 0 ? ` · ${T.mostTakedowns}` : ''}</span>
      </div>`).join('');
  }
}
