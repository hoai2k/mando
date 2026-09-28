import { TEXT } from '../text';
import { ASSET_ROOT } from '../core/assets';
import { MenuScreen } from './menus';
import { makeStage } from './stage';

/**
 * The credits: one slow roll over the twin suns, heading by heading, ending
 * on the creed. B (or the Back button) leaves whenever you like; the roll
 * stops on its last line rather than looping.
 */

/** how fast the roll climbs, stage px per second */
const SPEED = 42;

export class CreditsScreen {
  readonly screen: MenuScreen;
  private roll: HTMLElement;

  constructor(parent: HTMLElement, onBack: () => void) {
    const T = TEXT.credits;
    this.screen = new MenuScreen(parent, 'menu-screen fe-screen fe-credits');
    this.screen.root.insertAdjacentHTML('afterbegin',
      `<div class="cr-sky" style="background-image:url('${ASSET_ROOT}assets/textures/board_tatooine.jpg')"></div>`);
    const stage = makeStage(this.screen.root);
    const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    stage.innerHTML = `
      <div class="cr-window"><div class="cr-roll">
        <div class="cr-title">${esc(T.title)}</div><div class="cr-sub">${esc(T.sub)}</div>
        ${T.sections.map((sec, i) => `
          <div class="cr-sec${i === 0 ? ' lead' : ''}">
            <div class="cr-head">${esc(sec.head)}</div>
            ${sec.lines.map(([role, who]) => role
              ? `<div class="cr-line"><span class="r">${esc(role)}</span><span class="w">${esc(who)}</span></div>`
              : `<div class="cr-line solo">${esc(who)}</div>`).join('')}
          </div>`).join('')}
        <div class="cr-last">${esc(T.last)}</div>
      </div></div>
      <div class="cr-bar"></div>`;
    this.roll = stage.querySelector('.cr-roll') as HTMLElement;
    this.screen.addButtons(stage.querySelector('.cr-bar') as HTMLElement, [{ label: T.back, action: onBack }]);
    this.screen.onBack = onBack;
  }

  /** start the roll from the bottom of the screen */
  begin(): void {
    const roll = this.roll;
    roll.style.animation = 'none';
    void roll.offsetHeight;
    const travel = roll.offsetHeight + 360;
    roll.style.animation = `cr-roll ${(travel / SPEED).toFixed(1)}s linear forwards`;
  }
}
