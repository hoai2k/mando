import { TEXT } from '../text';
import { ASSET_ROOT } from '../core/assets';
import { MenuScreen } from './menus';
import { makeStage } from './stage';

/**
 * The controls sheet as a field manual (docs/UI_CONCEPTS.md, round 6): a page
 * of aged paper with the controller drawn in ink and its buttons called out,
 * and two more pages behind it — riding, and the keyboard. The page tabs are
 * the screen's own row of buttons, so left and right turn the page with the
 * pad, the keyboard or a click.
 */

const P = TEXT.controls.pad;
const tex = (file: string): string => `url('${ASSET_ROOT}assets/textures/${file}')`;

/** one callout: the button in red slab type over what it does */
const call = (side: 'l' | 'r', x: number, y: number, lines: Array<[string, string]>): string =>
  `<div class="m-call ${side}" style="left:${x}px;top:${y}px"><b>${lines[0][0]}</b>${lines.map(([, what]) => what).join(' · ')}</div>`;

/** the controller, in ink, with its callouts */
function padPage(): string {
  return `
    <svg class="m-pad" viewBox="0 0 440 300" width="440" height="300" aria-label="${TEXT.controls.padAlt}">
      <g fill="none" stroke="#2a1f14" stroke-width="3" stroke-linejoin="round">
        <path d="M90 60 Q220 30 350 60 Q400 70 420 150 Q440 250 395 272 Q360 285 330 240 Q300 200 220 200 Q140 200 110 240 Q80 285 45 272 Q0 250 20 150 Q40 70 90 60 Z" fill="rgba(42,31,20,.08)"/>
        <path d="M80 58 Q110 40 150 44" stroke-width="7" stroke-linecap="round"/>
        <path d="M360 58 Q330 40 290 44" stroke-width="7" stroke-linecap="round"/>
        <path d="M84 40 Q112 22 146 28 L148 16 Q110 6 82 26 Z" fill="rgba(42,31,20,.15)"/>
        <path d="M356 40 Q328 22 294 28 L292 16 Q330 6 358 26 Z" fill="rgba(42,31,20,.15)"/>
        <circle cx="120" cy="115" r="26"/><circle cx="120" cy="115" r="14" fill="rgba(42,31,20,.2)"/>
        <circle cx="275" cy="175" r="24"/><circle cx="275" cy="175" r="12" fill="rgba(42,31,20,.2)"/>
        <path d="M152 162 h14 v-14 h14 v14 h14 v14 h-14 v14 h-14 v-14 h-14 z"/>
        <circle cx="330" cy="92" r="11"/><circle cx="352" cy="114" r="11"/><circle cx="308" cy="114" r="11"/><circle cx="330" cy="136" r="11"/>
        <circle cx="200" cy="108" r="6"/><circle cx="240" cy="108" r="6"/>
      </g>
      <g font-family="Barlow Condensed, sans-serif" font-weight="700" font-size="12" fill="#2a1f14" text-anchor="middle">
        <text x="330" y="96">Y</text><text x="352" y="118">B</text><text x="308" y="118">X</text><text x="330" y="140">A</text>
      </g>
      <g stroke="#a3301f" stroke-width="1.5" fill="none" stroke-dasharray="3 4">
        <path d="M112 22 L-42 -40"/><path d="M110 50 L-42 38"/><path d="M100 115 L-42 116"/><path d="M170 175 L-42 202"/><path d="M262 188 L-42 282"/>
        <path d="M328 22 L482 -40"/><path d="M330 50 L482 38"/><path d="M341 92 L482 96"/><path d="M363 114 L482 146"/><path d="M299 114 L482 196"/><path d="M341 136 L482 246"/>
      </g>
    </svg>
    ${call('l', 70, 58, [P.lt])}
    ${call('l', 70, 140, [P.lb, P.lbHold])}
    ${call('l', 70, 222, [P.leftStick])}
    ${call('l', 70, 306, [P.dpad, P.dpadMenus])}
    ${call('l', 70, 388, [P.rightStick, P.rightStickClick])}
    ${call('r', 850, 58, [P.rt])}
    ${call('r', 850, 140, [P.rb, P.rbAir])}
    ${call('r', 850, 196, [P.y])}
    ${call('r', 850, 248, [P.b])}
    ${call('r', 850, 298, [P.x])}
    ${call('r', 850, 350, [P.a])}
    <div class="m-foot">${TEXT.controls.padFoot}</div>`;
}

/** a page of [what it does, what to press], set as a two-column ledger */
function tablePage(rows: Array<[string, string]>, extra: Array<[string, string]>, note: string): string {
  const table = (list: Array<[string, string]>): string => list
    .map(([what, keys]) => `<div class="m-row"><span class="w">${what}</span><span class="dots"></span><span class="keys">${keys}</span></div>`)
    .join('');
  return `
    <div class="m-table">${table(rows)}</div>
    ${extra.length ? `<div class="m-table second">${table(extra)}</div>` : ''}
    <div class="m-foot">${note}</div>`;
}

export function buildManual(screen: MenuScreen, onBack: () => void): void {
  const T = TEXT.controls;
  screen.root.classList.add('fe-screen', 'fe-manual');
  const stage = makeStage(screen.root);
  stage.innerHTML = `
    <div class="m-head"><span class="h">${T.manual}</span><span class="k">${T.manualSub}</span></div>
    <div class="m-tabs"></div>
    <div class="m-sheet"></div>
    <div class="fe-prompts m-prompts">
      <span><span class="fe-glyph">◀</span><span class="fe-glyph">▶</span>${T.turnPage}</span>
      <span><span class="fe-glyph b">B</span>${T.back}</span>
    </div>`;
  const sheet = stage.querySelector('.m-sheet') as HTMLElement;
  sheet.style.backgroundImage = tex('ui_paper_aged.jpg');
  const pages = [
    padPage(),
    tablePage(T.driving, [], T.saddleNote),
    tablePage(T.keyboard, T.always, T.keyboardNote),
  ];
  const tabs = stage.querySelector('.m-tabs') as HTMLElement;
  const btns = screen.addButtons(tabs, [
    { label: T.pages.foot, action: () => {} },
    { label: T.pages.saddle, action: () => {} },
    { label: T.pages.keyboard, action: () => {} },
    { label: T.back, action: onBack },
  ]);
  btns.forEach((b, i) => b.classList.toggle('m-back', i === 3));
  const paper = tex('ui_paper_aged.jpg');
  let shown = -1;
  // a tab turns to its page the moment it is focused; Back leaves the page open
  screen.onFocus = (i) => {
    if (i > 2 || i === shown) return;
    shown = i;
    btns.forEach((b, j) => {
      b.classList.toggle('open', j === i);
      b.style.backgroundImage = j === i ? paper : '';
    });
    sheet.className = `m-sheet page-${i}`;
    sheet.innerHTML = pages[i];
  };
  screen.onBack = onBack;
}
