import { TEXT } from '../text';
import { ASSET_ROOT, portraitName } from '../core/assets';
import type { BoardInfo } from '../world/boards';
import type { Game } from '../game/game';
import { FINAL_WAVE, MID_BOSS_WAVE } from '../enemies/spawner';
import { faceSvg } from './faces';
import { MenuScreen } from './menus';
import { makeStage } from './stage';

/**
 * The pause screen: "Hold fire" (docs/UI_CONCEPTS.md, round 6).
 *
 * The match stays on screen behind it, frozen and washed to sepia by the
 * screen's own backdrop filter, with the menu down the left and a card pinned
 * on the right saying how the contract stands: the wave, the clock, each
 * hunter's takedowns, and what comes next. The two choices that throw the run
 * away say so under their names.
 */

const SLOT_COLOURS = ['#e0452c', '#3d86e0', '#4fb05a', '#e8b830', '#b06ad8', '#e07a2c', '#3dc0c0', '#c8c0b0'];
const tex = (file: string): string => `url('${ASSET_ROOT}assets/textures/${file}')`;
const clockOf = (s: number): string => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

export interface PauseActions {
  resume: () => void;
  controls: () => void;
  settings: () => void;
  restart: () => void;
  quit: () => void;
}

export class PauseScreen {
  readonly screen: MenuScreen;
  private card: HTMLElement;
  private restartNote: HTMLElement;

  constructor(parent: HTMLElement, actions: PauseActions) {
    const T = TEXT.pause;
    this.screen = new MenuScreen(parent, 'menu-screen fe-screen fe-pause');
    const stage = makeStage(this.screen.root);
    stage.innerHTML = `
      <div class="p-head"><div class="k">${T.kicker}</div><div class="h">${T.heading}</div></div>
      <div class="p-menu"></div>
      <div class="p-card w-paper"><span class="w-pin" style="left:50%;top:-6px;margin-left:-8px"></span><div class="in"></div></div>
      <div class="fe-prompts p-prompts">
        <span><span class="fe-glyph a">A</span>${T.select}</span>
        <span><span class="fe-glyph b">B</span>${T.resume}</span>
      </div>`;
    (stage.querySelector('.p-card') as HTMLElement).style.backgroundImage = tex('ui_paper_aged.jpg');
    this.card = stage.querySelector('.p-card .in') as HTMLElement;
    const btns = this.screen.addButtons(stage.querySelector('.p-menu') as HTMLElement, [
      { label: T.resume, action: actions.resume },
      { label: T.controls, action: actions.controls },
      { label: T.settings, action: actions.settings },
      { label: T.restart, action: actions.restart },
      { label: T.quit, action: actions.quit },
    ]);
    // the cost, under the two choices that have one
    const note = (el: HTMLElement, text: string): HTMLElement => {
      const n = document.createElement('small');
      n.textContent = text;
      el.appendChild(n);
      return n;
    };
    this.restartNote = note(btns[3], '');
    note(btns[4], T.quitNote);
    this.screen.onBack = actions.resume;
  }

  /** Pin the contract as it stands. Call before the state shows the screen. */
  dress(game: Game, board: BoardInfo): void {
    const T = TEXT.pause;
    this.restartNote.textContent = T.restartNote(game.mode);
    const kills = game.players.reduce((n, p) => n + p.kills, 0);
    const stat = (v: string, k: string): string => `<div><div class="v">${v}</div><div class="kk">${k}</div></div>`;
    const stats = [
      game.mode === 'wave' ? stat(`${Math.min(Math.max(game.wave, 1), FINAL_WAVE)}<small>/${FINAL_WAVE}</small>`, T.statWave) : '',
      stat(clockOf(game.elapsed), T.statClock),
      stat(String(kills), T.statTakedowns),
    ].filter(Boolean);
    // what comes next, in the terms of the mode being played
    const lieutenant = (TEXT.bosses.lieutenant as Record<string, string>)[board.id] ?? '';
    const warlord = (TEXT.bosses.warlord as Record<string, string>)[board.id] ?? '';
    const next = game.boss?.alive ? T.onTheField(game.boss.bossName)
      : game.mode === 'wave'
        ? game.wave <= MID_BOSS_WAVE ? T.nextLieutenant(lieutenant, MID_BOSS_WAVE) : T.nextWarlord(warlord, FINAL_WAVE)
        : game.mode === 'campaign' && game.campaign ? game.campaign.objectiveLabel
          : TEXT.banners.objective.pvp;
    this.card.innerHTML = `
      <div class="k">${T.inProgress}</div>
      <div class="t"></div>
      <div class="stats" style="grid-template-columns:repeat(${stats.length},1fr)">${stats.join('')}</div>
      <div class="rows"></div>
      <div class="next">${T.upNext} ${next}</div>`;
    (this.card.querySelector('.t') as HTMLElement).textContent = board.name;
    const rows = this.card.querySelector('.rows') as HTMLElement;
    game.players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `
        <span class="tab" style="background:${p.isBot ? '#8b7a63' : SLOT_COLOURS[i % SLOT_COLOURS.length]}"></span>
        <span class="mug">${faceSvg(p.characterId)}<i style="background-image:${tex(`${portraitName(p.characterId)}.jpg`)}"></i></span>
        <span class="nm"></span><span class="n">${p.kills}</span>`;
      (row.querySelector('.nm') as HTMLElement).textContent = p.profile.name;
      rows.appendChild(row);
    });
  }
}
