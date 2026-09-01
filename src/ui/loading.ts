import { TEXT } from '../text';
import { MANDO_ROSTER, type MandoId } from '../characters/mandalorians';
import { playableDef, type PlayableId } from '../characters/roster';
import { ENEMY_NAME, type EnemyKind } from '../enemies/enemy';
import { ASSET_ROOT, portraitName } from '../core/assets';
import { faceSvg, helmetSvg, hex, hostileSvg } from './faces';
import type { BoardInfo } from '../world/boards';

/**
 * The screen between choosing a fighter and standing on the ground.
 *
 * It exists so the first thing the player sees of a territory is the territory
 * — not its procedural stand-in with the real sand and sky fading in over the
 * opening seconds. The match is held here until the files that would visibly
 * pop are in hand, and the wait is furnished with what they are about to walk
 * into: the place, who they are taking, and who is waiting.
 *
 * Everything here is DOM over a dark ground. The 3D stage from the character
 * select is torn down before this appears, and the match's own scene has not
 * been shown yet, so there is nothing else on screen to fight with.
 */


export class LoadingScreen {
  root: HTMLElement;
  private art: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private cast: HTMLElement;
  private fill: HTMLElement;
  private pct: HTMLElement;
  private note: HTMLElement;
  private skip: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'loading-screen';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div class="loading-art"></div>
      <div class="loading-body">
        <div class="loading-title"></div>
        <div class="loading-sub"></div>
        <div class="loading-cast"></div>
        <div class="loading-bar"><div class="fill"></div></div>
        <div class="loading-foot"><span class="pct"></span><span class="note"></span><span class="skip"></span></div>
      </div>`;
    parent.appendChild(this.root);
    this.art = this.root.querySelector('.loading-art') as HTMLElement;
    this.title = this.root.querySelector('.loading-title') as HTMLElement;
    this.sub = this.root.querySelector('.loading-sub') as HTMLElement;
    this.cast = this.root.querySelector('.loading-cast') as HTMLElement;
    this.fill = this.root.querySelector('.fill') as HTMLElement;
    this.pct = this.root.querySelector('.pct') as HTMLElement;
    this.note = this.root.querySelector('.note') as HTMLElement;
    this.skip = this.root.querySelector('.skip') as HTMLElement;
  }

  /** Dress the screen for a particular drop and show it. */
  show(board: BoardInfo, chars: PlayableId[], enemies: EnemyKind[]): void {
    this.art.style.backgroundImage =
      `url('${ASSET_ROOT}assets/textures/${board.art}'), ${board.gradient}`;
    this.title.textContent = board.name;
    this.sub.textContent = board.desc;
    this.cast.innerHTML = '';
    for (const id of chars) {
      // Mandalorians draw their own helmet in their own colours; a playable
      // NPC (pvp) reuses the hostile mark that already matches its kind
      const c = MANDO_ROSTER[id as MandoId];
      const svg = c
        ? helmetSvg(hex(c.primary), hex(c.accent), hex(c.suit))
        : hostileSvg(id.replace('npc:', '') as EnemyKind);
      this.cast.appendChild(this.card(
        playableDef(id).profile.name, 'yours', svg, portraitName(id),
      ));
    }
    for (const kind of enemies) {
      this.cast.appendChild(this.card(ENEMY_NAME[kind] ?? kind, 'hostile', hostileSvg(kind), portraitName(kind)));
    }
    this.progress(0, TEXT.loading.preparing);
    this.root.style.display = '';
  }

  /**
   * One face. The drawn mark shows immediately and an authored portrait
   * replaces it if the file turns out to exist — the same "procedural now,
   * authored when it arrives" contract the rest of the game runs on, which
   * here also means a missing portrait never delays the thing it illustrates.
   */
  private card(name: string, role: 'yours' | 'hostile', svg: string, portrait: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `loading-card ${role}`;
    el.innerHTML = `<div class="face">${svg}</div><div class="cname">${name}</div>`;
    const face = el.querySelector('.face') as HTMLElement;
    const img = new Image();
    img.onload = () => {
      face.style.backgroundImage = `url('${img.src}')`;
      face.classList.add('has-art');
    };
    img.src = `${ASSET_ROOT}assets/textures/${portrait}.jpg`;
    return el;
  }

  /**
   * Move the bar. `note` is the line under it: what is being waited on.
   *
   * `skip` puts up the offer to drop without waiting, which is the only way
   * off this screen other than the files arriving — the wait is uncapped by
   * design, so that a stand-in is something the player chooses rather than
   * something a slow connection chose for them. It gets its own bright span
   * for that reason: dimmed into the tail of the status line, the one control
   * on the screen read as a footnote.
   */
  progress(ratio: number, note: string, skip = false): void {
    const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    this.fill.style.width = `${pct}%`;
    this.pct.textContent = `${pct}%`;
    this.note.textContent = note;
    this.skip.textContent = skip ? TEXT.loading.skip : '';
  }

  hide(): void { this.root.style.display = 'none'; }
  get visible(): boolean { return this.root.style.display !== 'none'; }
}
