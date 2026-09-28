import { TEXT } from '../text';
import { ASSET_ROOT } from '../core/assets';
import { BOARDS, type BoardInfo } from '../world/boards';
import type { MenuScreen } from './menus';
import { makeStage } from './stage';

/**
 * Territory select for Wave Battle and PvP: a transit departures board.
 *
 * Each territory is a row of split-flap tiles — gate, destination, the
 * warlord who holds it, and a status that reads BOARDING on the row you are
 * on. Beside the board, the ticket for that row: where it goes, a photograph
 * of the place and what waits there. Moving the focus re-flips the row and
 * re-stamps the ticket, so browsing has a little clatter to it.
 *
 * The rows are still the `MenuScreen`'s focusables (and still `.board-card`s),
 * so navigation, the mouse and the test harness treat the screen exactly as
 * they treated the old grid; a single column means DOWN and RIGHT both step to
 * the next row, which is what the harness's "press RIGHT n times" relies on.
 */

/** pad or cut to exactly `n` characters, so every row's tiles line up */
const flap = (s: string, n: number): string => s.toUpperCase().slice(0, n).padEnd(n, ' ');
const gate = (i: number): string => String(i + 1).padStart(2, '0');
/** "The Dune Sea" reads as DUNE SEA on a board that is short of tiles */
const bare = (s: string): string => s.replace(/^The /, '');
const DEST = 14;
const HELD = 21;
const STATUS = 8;

export interface Departures {
  /** dress the board for a mode: its sub-line and what the ticket admits */
  setMode(mode: 'wave' | 'pvp'): void;
}

export function buildDepartures(screen: MenuScreen, onPick: (board: BoardInfo) => void): Departures {
  screen.root.classList.add('fe-screen', 'fe-departures');
  const stage = makeStage(screen.root);
  const warlord = (id: string): string => (TEXT.bosses.warlord as Record<string, string>)[id] ?? '';
  const world = (id: string): string => TEXT.worlds[id] ?? '';
  const T = TEXT.boardSelect;

  stage.innerHTML = `
    <div class="fe-board">
      <div class="fe-board-head">
        <span class="fe-board-title"><span class="big">${T.departures}</span><span class="fe-hdr fe-sub"></span></span>
        <span class="fe-clock">${T.clock}</span>
      </div>
      <div class="fe-cols">
        <span class="fe-hdr" style="width:27px">${T.cols.gate}</span>
        <span class="fe-hdr" style="width:190px">${T.cols.dest}</span>
        <span class="fe-hdr" style="width:286px">${T.cols.held}</span>
        <span class="fe-hdr">${T.cols.status}</span>
      </div>
      <div class="fe-rows"></div>
      <div class="fe-prompts">
        <span><span class="fe-glyph">▲</span><span class="fe-glyph">▼</span>${T.prompts.pick}</span>
        <span><span class="fe-glyph a">A</span>${T.prompts.punch}</span>
        <span><span class="fe-glyph b">B</span>${T.prompts.back}</span>
      </div>
    </div>
    <div class="fe-ticket">
      <div class="fe-ticket-paper" style="background-image:url('${ASSET_ROOT}assets/textures/ui_paper_aged.jpg')"></div>
      <div class="fe-perf" style="top:-6px"></div>
      <div class="fe-perf" style="bottom:-6px"></div>
      <div class="fe-ticket-body">
        <div class="row2 type"><span>${T.ticket.oneWay}</span><span class="t-gate"></span></div>
        <span class="admit"></span>
        <div class="photo"></div>
        <span class="type t-to"></span>
        <span class="name"></span>
        <span class="desc"></span>
        <div class="grid"><span class="t-held"></span><span class="t-terms"></span></div>
        <div class="barcode"></div>
      </div>
      <div class="stamp">${T.ticket.punch}</div>
    </div>`;

  const q = <E extends HTMLElement>(sel: string): E => stage.querySelector(sel) as E;
  const rowsBox = q('.fe-rows');
  const sub = q('.fe-sub');
  const ticket = q('.fe-ticket');
  let mode: 'wave' | 'pvp' = 'wave';

  const statuses: HTMLElement[] = [];
  const rows = BOARDS.map((info, i) => {
    const row = document.createElement('div');
    row.className = 'board-card';
    row.setAttribute('aria-label', info.name);
    row.innerHTML = `
      <span class="fe-flap">${gate(i)}</span>
      <span class="fe-flap">${flap(bare(info.name), DEST)}</span>
      <span class="fe-flap">${flap(bare(warlord(info.id)), HELD)}</span>
      <span class="fe-flap st">${flap(T.onTime, STATUS)}</span>`;
    rowsBox.appendChild(row);
    statuses.push(row.querySelector('.st') as HTMLElement);
    return row;
  });

  screen.addButtons(rowsBox, BOARDS.map((info, i) => ({
    label: '', el: rows[i], action: () => onPick(info),
  })));

  let shown = -1;
  const paintTicket = (i: number): void => {
    const info = BOARDS[i];
    q('.t-gate').textContent = T.ticket.gate(gate(i));
    q('.admit').textContent = T.ticket.admit(mode === 'pvp' ? T.ticket.fighters : T.ticket.hunters);
    q('.photo').style.backgroundImage = `url('${ASSET_ROOT}assets/textures/${info.art}'), ${info.gradient}`;
    q('.t-to').textContent = T.ticket.to(world(info.id));
    q('.name').textContent = info.name;
    q('.desc').textContent = info.desc;
    q('.t-held').textContent = `${T.cols.held} · ${warlord(info.id)}`;
    q('.t-terms').textContent = mode === 'pvp' ? T.ticket.pvp : T.ticket.waves;
  };

  screen.onFocus = (i) => {
    statuses.forEach((s, j) => { s.textContent = flap(j === i ? T.boarding : T.onTime, STATUS); });
    paintTicket(i);
    if (i === shown) return;
    shown = i;
    // the clatter: the row's tiles re-flip and the ticket takes a fresh stamp
    for (const f of rows[i].querySelectorAll<HTMLElement>('.fe-flap')) {
      f.classList.remove('flip'); void f.offsetWidth; f.classList.add('flip');
    }
    ticket.classList.remove('fresh'); void ticket.offsetWidth; ticket.classList.add('fresh');
  };

  return {
    setMode(m) {
      mode = m;
      sub.textContent = T.sub(m === 'pvp' ? TEXT.title.pvp : TEXT.title.waveBattle);
      shown = -1;
    },
  };
}
