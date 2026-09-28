import { TEXT } from '../text';
import { ASSET_ROOT, portraitName } from '../core/assets';
import { BOARDS, type BoardInfo } from '../world/boards';
import type { GameMode } from '../game/modes';
import type { PlayableId } from '../characters/roster';
import { FINAL_WAVE } from '../enemies/spawner';
import { faceSvg } from './faces';
import { MenuScreen } from './menus';
import { makeStage } from './stage';

/**
 * What comes after a board (docs/UI_CONCEPTS.md, round 5). Four faces:
 *
 * - **held** — a Wave Battle won: the contract photo stamped PAID IN FULL and
 *   a payout ledger, each hunter's takedowns and their share.
 * - **liberated** — a Mission won: back on the bounty-hunt map, the lens
 *   stamped LIBERATED and the next world waiting down the lane.
 * - **champion** — a duel won: the last fighter standing full height, the rest
 *   of the line ranked beside them.
 * - **defeat** — the Wanted sheet torn and scorched, the hunters crossed out.
 *
 * The buttons are one `MenuScreen` row, so the pad, the keyboard and the mouse
 * drive it the way they drive every other menu; each face shows the ones that
 * make sense for it.
 */

/** one fighter's line on the end screen */
export interface EndFighter {
  id: PlayableId;
  name: string;
  /** their place in the line, which is their colour */
  slot: number;
  bot: boolean;
  kills: number;
}

export interface EndReport {
  mode: GameMode;
  won: boolean;
  board: BoardInfo;
  fighters: EndFighter[];
  /** index into `fighters` of a duel's champion, -1 for none */
  winner: number;
  /** seconds on the clock */
  elapsed: number;
  /** the wave counter when it ended (Wave Battle) */
  wave: number;
}

export interface EndActions {
  /** the campaign's next territory */
  next: () => void;
  /** back to the departures board for another territory */
  departures: () => void;
  retry: () => void;
  /** back to the character select, same territory */
  roster: () => void;
  quit: () => void;
}

type Face = 'held' | 'liberated' | 'champion' | 'defeat';

const SLOT_COLOURS = ['#e0452c', '#3d86e0', '#4fb05a', '#e8b830', '#b06ad8', '#e07a2c', '#3dc0c0', '#c8c0b0'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const tex = (file: string): string => `url('${ASSET_ROOT}assets/textures/${file}')`;
const portrait = (id: PlayableId): string => tex(`${portraitName(id)}.jpg`);
const colour = (f: EndFighter): string => (f.bot ? '#8b7a63' : SLOT_COLOURS[f.slot % SLOT_COLOURS.length]);
const clockOf = (s: number): string => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
/** "The Dune Sea" in the middle of a sentence */
const inline = (name: string): string => name.replace(/^The /, 'the ');

export class EndScreen {
  readonly screen: MenuScreen;
  /** the PvP champion's portrait block; the tests look for it by this class */
  readonly hero: HTMLElement;
  private faces: Record<Face, HTMLElement>;
  private bg: HTMLElement;
  private btn: Record<'next' | 'departures' | 'retry' | 'roster' | 'quit', HTMLElement>;

  constructor(parent: HTMLElement, actions: EndActions) {
    const T = TEXT.end;
    this.screen = new MenuScreen(parent, 'menu-screen fe-screen fe-end');
    this.bg = document.createElement('div');
    this.bg.className = 'e-bg';
    this.screen.root.appendChild(this.bg);
    const stage = makeStage(this.screen.root);
    stage.innerHTML = `
      <div class="e-face e-held">
        <div class="e-head"><div class="k settled"></div><div class="h">${T.held}</div></div>
        <div class="e-polaroid w-paper">
          <div class="photo"></div><div class="caption"></div>
          <span class="w-pin" style="left:50%;top:-6px;margin-left:-8px"></span>
          <div class="e-stamp">${T.paid}</div>
        </div>
        <div class="e-summary"></div>
        <div class="e-ledger w-paper">
          <span class="w-pin" style="left:22px;top:12px"></span><span class="w-pin" style="right:22px;top:12px"></span>
          <div class="top"><span class="t">${T.ledger}</span><span class="k place"></span></div>
          <div class="cols k"><span></span><span></span><span>${T.ledgerCols.hunter}</span><span class="r">${T.ledgerCols.takedowns}</span><span class="r">${T.ledgerCols.credits}</span></div>
          <div class="rows"></div>
          <div class="foot"><span class="k split"></span><span class="total"></span></div>
        </div>
      </div>

      <div class="e-face e-liberated">
        <div class="e-hunt-top"><span class="h">${TEXT.planets.heading}</span><span class="s chapter"></span></div>
        <div class="e-lens"><div class="vista"></div><div class="shade"></div><div class="label"></div><div class="e-stamp">${T.liberatedStamp}</div></div>
        <div class="e-leader"></div>
        <div class="e-route">
          <svg viewBox="-300 -80 900 160" width="900" height="160" aria-hidden="true"><path class="done" d="M -300 20 Q -150 -10 0 0"></path><path class="plot" d="M 0 0 Q 140 -40 280 -50"></path><path class="ahead" d="M 280 -50 Q 440 -20 600 30"></path></svg>
          <div class="here"><span class="pulse"></span><span class="gl"></span><span class="tick">✓</span><span class="lb"></span></div>
          <div class="next"><span class="gl"></span><span class="ring"></span><span class="lb"></span></div>
        </div>
        <div class="e-band">
          <div class="c1"><span class="chap"></span><span class="free"></span><span class="sum"></span></div>
          <div class="c2 mugs"></div>
        </div>
      </div>

      <div class="e-face e-champion">
        <div class="end-hero"><div class="end-face"></div><div class="glint"></div><div class="edge"></div></div>
        <div class="e-champ-name"><div class="s">${T.lastStanding}</div><div class="n"></div><div class="end-tag"></div></div>
        <div class="e-ranks"><div class="top"><span class="h where"></span><span class="k">${T.standings}</span></div><div class="rows"></div></div>
      </div>

      <div class="e-face e-defeat">
        <div class="e-sheet w-paper">
          <div class="burn"></div>
          <div class="k no"></div>
          <div class="h">${T.defeat}</div>
          <div class="mugs"></div>
          <div class="line"></div>
          <div class="e-stamp">${T.void}</div>
        </div>
        <div class="e-quip"></div>
      </div>

      <div class="e-bar">
        <div class="e-btns"></div>
        <span class="fe-prompts"><span><span class="fe-glyph a">A</span>${T.confirm}</span><span><span class="fe-glyph b">B</span>${T.quit}</span></span>
      </div>`;
    for (const paper of stage.querySelectorAll<HTMLElement>('.w-paper')) paper.style.backgroundImage = tex('ui_paper_aged.jpg');
    const q = (sel: string): HTMLElement => stage.querySelector(sel) as HTMLElement;
    this.faces = {
      held: q('.e-held'), liberated: q('.e-liberated'), champion: q('.e-champion'), defeat: q('.e-defeat'),
    };
    this.hero = q('.end-hero');
    const [next, departures, retry, roster, quit] = this.screen.addButtons(q('.e-btns'), [
      { label: T.nextTerritory, action: actions.next },
      { label: T.nextDeparture, action: actions.departures },
      { label: T.retry, action: actions.retry },
      { label: T.newHunters, action: actions.roster },
      { label: T.quit, action: actions.quit },
    ]);
    this.btn = { next, departures, retry, roster, quit };
    this.screen.onBack = actions.quit;
  }

  /** Dress the screen for how the board ended. Call before the state shows it. */
  show(r: EndReport): void {
    const face: Face = !r.won ? 'defeat' : r.mode === 'pvp' ? 'champion' : r.mode === 'campaign' ? 'liberated' : 'held';
    for (const [k, el] of Object.entries(this.faces)) el.style.display = k === face ? '' : 'none';
    this.hero.style.display = face === 'champion' ? '' : 'none';
    const i = BOARDS.indexOf(r.board);
    const next = r.mode === 'campaign' && r.won && i >= 0 && i < BOARDS.length - 1 ? BOARDS[i + 1] : null;
    const T = TEXT.end;

    // the buttons each face offers, and what they are called there
    const shown = {
      next: face === 'liberated' && !!next,
      departures: face === 'held',
      retry: true,
      roster: face === 'champion' || face === 'defeat',
      quit: true,
    };
    for (const [k, el] of Object.entries(this.btn)) el.style.display = shown[k as keyof typeof shown] ? '' : 'none';
    if (next) this.btn.next.textContent = T.rideOn(next.name);
    this.btn.retry.textContent = face === 'champion' ? T.rematch : T.retry;
    this.btn.roster.textContent = r.mode === 'pvp' ? T.newFighters : T.newHunters;

    this.bg.className = `e-bg ${face}`;
    this.bg.style.backgroundImage = face === 'held' || face === 'defeat' ? tex('ui_bounty_board.jpg')
      : face === 'champion' ? `${tex(r.board.art)}, ${r.board.gradient}` : '';

    const warlord = (TEXT.bosses.warlord as Record<string, string>)[r.board.id] ?? '';
    const world = TEXT.worlds[r.board.id] ?? '';
    const clock = clockOf(r.elapsed);
    const contract = String(417 + Math.max(0, i) * 38).padStart(4, '0');
    const f = this.faces[face];
    const q = (sel: string): HTMLElement => f.querySelector(sel) as HTMLElement;
    const kills = r.fighters.reduce((n, x) => n + x.kills, 0);

    if (face === 'held') {
      q('.settled').textContent = T.settled(contract);
      q('.photo').style.backgroundImage = `${tex(r.board.art)}, ${r.board.gradient}`;
      q('.caption').textContent = T.cleared(r.board.name, clock);
      q('.e-summary').textContent = T.heldSummary(FINAL_WAVE, warlord, clock);
      q('.place').textContent = `${world} · ${r.board.name}`;
      const top = Math.max(...r.fighters.map((x) => x.kills));
      q('.rows').innerHTML = '';
      for (const x of r.fighters) {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `
          <span class="tab" style="background:${colour(x)}"></span>
          <span class="mug" style="background-image:${portrait(x.id)}">${faceSvg(x.id)}</span>
          <span class="who"><span class="nm"></span><span class="k">${this.tag(x)}${x.kills === top && top > 0 ? ` · ${T.topGun}` : ''}</span></span>
          <span class="num">${x.kills}</span>
          <span class="cr">${(x.kills * T.creditsPerKill).toLocaleString('en-US')}</span>`;
        (row.querySelector('.nm') as HTMLElement).textContent = x.name;
        q('.rows').appendChild(row);
      }
      q('.split').textContent = T.split(r.fighters.length);
      q('.total').innerHTML = `${(kills * T.creditsPerKill).toLocaleString('en-US')} <small>${T.cr}</small>`;
    } else if (face === 'liberated') {
      const rn = ROMAN[i] ?? String(i + 1);
      const rooms = ((TEXT.missions.rooms as Record<string, readonly string[]>)[r.board.id] ?? []).length;
      q('.chapter').textContent = T.routeCount(i + 1, BOARDS.length);
      q('.vista').style.backgroundImage = `${tex(`system_${r.board.id}.jpg`)}, ${r.board.gradient}`;
      q('.label').textContent = TEXT.planets.system(rn, world);
      q('.here .gl').style.backgroundImage = `${tex(`planet_${r.board.id}.png`)}, ${r.board.gradient}`;
      q('.here .lb').textContent = `${rn} · ${r.board.name.replace(/^The /, '')}`;
      const nextEl = q('.next');
      nextEl.style.display = next ? '' : 'none';
      q('.e-route .plot').style.display = next ? '' : 'none';
      q('.e-route .ahead').style.display = next ? '' : 'none';
      if (next) {
        q('.next .gl').style.backgroundImage = `${tex(`planet_${next.id}.png`)}, ${next.gradient}`;
        q('.next .lb').textContent = T.nextStop(ROMAN[i + 1] ?? String(i + 2), next.name.replace(/^The /, ''));
      }
      q('.chap').textContent = next ? T.chapterDone(rn, world) : T.huntDone;
      q('.free').textContent = T.free(r.board.name);
      q('.sum').textContent = T.liberatedSummary(rooms, warlord, clock);
      q('.mugs').innerHTML = r.fighters.map((x) => `
        <span class="mug"><span class="pic" style="background-image:${portrait(x.id)};outline-color:${colour(x)}">${faceSvg(x.id)}</span>
          <span class="st"><span class="p" style="color:${colour(x)}">${this.tag(x)}</span><span class="n">${x.kills}</span></span></span>`).join('');
    } else if (face === 'champion') {
      const champ = r.fighters[r.winner] ?? r.fighters[0];
      const heroFace = this.hero.querySelector('.end-face') as HTMLElement;
      heroFace.innerHTML = faceSvg(champ.id);
      heroFace.classList.remove('has-art');
      heroFace.style.backgroundImage = '';
      // authored art takes over the drawn mark when the file exists
      const img = new Image();
      img.onload = () => { heroFace.style.backgroundImage = `url('${img.src}')`; heroFace.classList.add('has-art'); };
      img.src = `${ASSET_ROOT}assets/textures/${portraitName(champ.id)}.jpg`;
      (this.hero.querySelector('.edge') as HTMLElement).style.background = colour(champ);
      q('.e-champ-name .n').textContent = champ.name;
      q('.end-tag').innerHTML = `<span class="chip" style="background:${colour(champ)}"></span>${TEXT.end.championTag(
        champ.bot ? TEXT.vs.bot : TEXT.vs.player(champ.slot + 1), champ.kills)} · ${clock}`;
      q('.where').textContent = `${r.board.name} · ${TEXT.title.pvp}`;
      const order = [champ, ...r.fighters.filter((x) => x !== champ).sort((a, b) => b.kills - a.kills)];
      q('.rows').innerHTML = '';
      order.forEach((x, n) => {
        const row = document.createElement('div');
        row.className = `rk${n === 0 ? ' first' : ''}`;
        row.style.setProperty('--pc', colour(x));
        row.style.animationDelay = `${0.2 + n * 0.08}s`;
        row.innerHTML = `
          <span class="in"><span class="pic" style="background-image:${portrait(x.id)}"></span><span class="fade"></span>
            <span class="txt"><span class="place">${n + 1}</span>
              <span class="who"><span class="p">${this.tag(x)}</span><span class="nm"></span>
              <span class="k">${T.takedowns(x.kills)} · ${n === 0 ? T.stillStanding : T.out}</span></span></span></span>`;
        (row.querySelector('.nm') as HTMLElement).textContent = x.name;
        q('.rows').appendChild(row);
      });
    } else {
      q('.no').textContent = TEXT.loading.contract(contract) + ` · ${r.board.name}`;
      q('.mugs').innerHTML = r.fighters.map((x) => `
        <span class="mug"><span class="pic" style="background-image:${portrait(x.id)}">${faceSvg(x.id)}</span>
          <svg class="x" viewBox="0 0 92 112" aria-hidden="true"><path d="M10 12 L82 100 M82 12 L10 100"/></svg>
          <span class="nm">${x.name} · ${x.kills}</span></span>`).join('');
      q('.line').textContent = (r.mode === 'wave' ? T.fellAtWave(Math.min(r.wave, FINAL_WAVE), FINAL_WAVE, clock) : T.fellAt(clock))
        + (r.fighters.length > 1 ? T.between(kills) : '');
      q('.e-quip').textContent = r.mode === 'pvp' ? '' : T.keeps(warlord, inline(r.board.name));
    }
  }

  /** after the state has shown the screen: focus the first button this face offers */
  focusFirst(): void {
    const order = [this.btn.next, this.btn.departures, this.btn.retry, this.btn.roster, this.btn.quit];
    const first = order.findIndex((el) => el.style.display !== 'none');
    this.screen.setFocus(Math.max(0, first));
  }

  private tag(f: EndFighter): string {
    return f.bot ? TEXT.charSelect.cpu : TEXT.charSelect.tag(f.slot + 1);
  }
}
