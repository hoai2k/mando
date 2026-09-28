import { TEXT } from '../text';
import { playableDef, type PlayableId } from '../characters/roster';
import { ENEMY_NAME, type EnemyKind } from '../enemies/enemy';
import { ASSET_ROOT, portraitName } from '../core/assets';
import { faceSvg, hostileSvg } from './faces';
import { BOARDS, type BoardInfo } from '../world/boards';
import type { GameMode } from '../game/modes';
import { makeStage } from './stage';

/**
 * The screen between choosing a fighter and standing on the ground.
 *
 * It exists so the first thing the player sees of a territory is the territory
 * — not its procedural stand-in with the real sand and sky fading in over the
 * opening seconds. The match is held here until the files that would visibly
 * pop are in hand, and the wait is furnished with what they are about to walk
 * into: the place, who they are taking, and who is waiting.
 *
 * Dressed as a Wanted sheet pinned to a guild bounty board
 * (docs/UI_CONCEPTS.md): a photograph of the territory, the contract with the
 * hunters' mugshots and the known hostiles', a field note, and a tracking fob
 * whose lamps are the progress bar.
 *
 * Everything here is DOM. The character select's stage is not drawn, and the
 * match's own scene has not been shown yet, so there is nothing else on screen
 * to fight with.
 */

/** the lamps on the tracking fob */
const SEGMENTS = 16;
/** each place in the line keeps its colour from the select */
const SLOT_COLOURS = ['#e0452c', '#3d86e0', '#4fb05a', '#e8b830', '#b06ad8', '#e07a2c', '#3dc0c0', '#c8c0b0'];
const tex = (file: string): string => `url('${ASSET_ROOT}assets/textures/${file}')`;

export class LoadingScreen {
  root: HTMLElement;
  private photo: HTMLElement;
  private caption: HTMLElement;
  private contractNo: HTMLElement;
  private title: HTMLElement;
  private stamp: HTMLElement;
  private sub: HTMLElement;
  private terms: HTMLElement;
  private castBox: HTMLElement;
  private cast: HTMLElement;
  private threats: HTMLElement;
  private tip: HTMLElement;
  private segs: HTMLElement[] = [];
  private fill: HTMLElement;
  private pct: HTMLElement;
  private note: HTMLElement;
  private skip: HTMLElement;
  private tipIndex = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'loading-screen fe-wanted';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div class="w-board" style="background-image:${tex('ui_bounty_board.jpg')}"></div>
      <div class="w-vignette"></div>`;
    parent.appendChild(this.root);
    const stage = makeStage(this.root);
    const T = TEXT.loading;
    stage.innerHTML = `
      <div class="w-polaroid w-paper">
        <div class="photo"></div>
        <div class="caption"></div>
        <span class="w-pin" style="left:50%;top:-6px;margin-left:-8px"></span>
      </div>
      <div class="w-note">
        <div class="k">${T.fieldNote}</div>
        <div class="t"></div>
      </div>
      <div class="w-contract w-paper">
        <span class="w-pin" style="left:24px;top:12px"></span>
        <span class="w-pin" style="right:24px;top:12px"></span>
        <div class="head">
          <div><div class="no"></div><div class="loading-title"></div></div>
          <div class="stamp">${T.accepted}</div>
        </div>
        <div class="loading-sub"></div>
        <div class="terms"></div>
        <div class="loading-cast">
          <div class="group"><div class="k hunters"></div><div class="mugs yours"></div></div>
          <div class="group"><div class="k hostile">${T.hostiles}</div><div class="mugs threats"></div></div>
        </div>
      </div>
      <div class="w-fob">
        <div class="read"><span class="k">${T.fob}</span><span class="pct"></span></div>
        <div class="loading-bar"><div class="lamps"></div><div class="fill"></div></div>
        <div class="loading-foot"><span class="note"></span><span class="skip"></span></div>
      </div>`;
    const q = (sel: string): HTMLElement => stage.querySelector(sel) as HTMLElement;
    for (const paper of stage.querySelectorAll<HTMLElement>('.w-paper')) paper.style.backgroundImage = tex('ui_paper_aged.jpg');
    this.photo = q('.w-polaroid .photo');
    this.caption = q('.w-polaroid .caption');
    this.contractNo = q('.w-contract .no');
    this.title = q('.loading-title');
    this.stamp = q('.w-contract .stamp');
    this.sub = q('.loading-sub');
    this.terms = q('.w-contract .terms');
    this.castBox = q('.loading-cast');
    this.cast = q('.mugs.yours');
    this.threats = q('.mugs.threats');
    this.tip = q('.w-note .t');
    this.fill = q('.loading-bar .fill');
    this.pct = q('.pct');
    this.note = q('.note');
    this.skip = q('.skip');
    const lamps = q('.lamps');
    for (let i = 0; i < SEGMENTS; i++) {
      const seg = document.createElement('span');
      seg.className = 'seg';
      lamps.appendChild(seg);
      this.segs.push(seg);
    }
  }

  /** the photograph, its caption, and a field note: shared by a drop and a door */
  private dressPlace(board: BoardInfo): void {
    this.photo.style.backgroundImage = `${tex(board.art)}, ${board.gradient}`;
    const world = TEXT.worlds[board.id] ?? '';
    this.caption.textContent = TEXT.loading.lastSeen(world, board.name.replace(/^The /, 'the '));
    // a different note each time, walking the list rather than rolling for it,
    // so two drops in a row never repeat themselves
    const tips = TEXT.loading.tips;
    this.tip.textContent = tips[this.tipIndex++ % tips.length];
    // a contract number that belongs to the territory, not to the session
    const i = Math.max(0, BOARDS.findIndex((b) => b.id === board.id));
    this.contractNo.textContent = TEXT.loading.contract(String(417 + i * 38).padStart(4, '0'));
  }

  /** Dress the screen for a particular drop and show it. */
  show(board: BoardInfo, chars: PlayableId[], enemies: EnemyKind[], mode: GameMode = 'wave'): void {
    this.dressPlace(board);
    this.title.textContent = board.name;
    this.sub.textContent = board.desc;
    this.stamp.style.display = '';
    const warlord = (TEXT.bosses.warlord as Record<string, string>)[board.id] ?? '';
    const rooms = ((TEXT.missions.rooms as Record<string, readonly string[]>)[board.id] ?? []).length;
    this.terms.textContent = TEXT.loading.terms(
      mode === 'pvp' ? TEXT.boardSelect.ticket.pvp
        : mode === 'campaign' ? `${TEXT.planets.rooms(rooms)} · ${TEXT.planets.warlord} ${warlord}`
          : TEXT.boardSelect.ticket.waves);
    this.terms.style.display = '';
    this.castBox.style.display = '';
    (this.castBox.querySelector('.k.hunters') as HTMLElement).textContent =
      mode === 'pvp' ? TEXT.loading.fighters : TEXT.loading.hunters;
    this.castBox.classList.toggle('crowded', chars.length + enemies.length > 7);
    this.cast.innerHTML = '';
    this.threats.innerHTML = '';
    chars.forEach((id, i) => {
      this.cast.appendChild(this.card(
        playableDef(id).profile.name, 'yours', faceSvg(id), portraitName(id), SLOT_COLOURS[i % SLOT_COLOURS.length],
      ));
    });
    for (const kind of enemies) {
      this.threats.appendChild(this.card(ENEMY_NAME[kind] ?? kind, 'hostile', hostileSvg(kind), portraitName(kind)));
    }
    // the warlord is on every contract and in no photograph
    if (mode !== 'pvp') {
      const unknown = document.createElement('div');
      unknown.className = 'w-mug unknown';
      unknown.innerHTML = `<div class="face">?</div><div class="cname">${TEXT.loading.unknownWarlord}</div>`;
      this.threats.appendChild(unknown);
    }
    this.progress(0, TEXT.loading.preparing);
    this.root.style.display = '';
  }

  /**
   * The same screen, dressed for a transport door rather than for a drop.
   *
   * A stage change is the same problem as a match start — a place is being
   * raised, and it should be finished before it is looked at — but none of the
   * drop's furniture belongs to it: the cast is already chosen, the hostiles
   * are already met, and the contract was accepted long ago. So it keeps the
   * photograph and the fob and says where the party is going.
   */
  showTransit(board: BoardInfo, label: string, sub: string): void {
    this.dressPlace(board);
    this.title.textContent = label;
    this.sub.textContent = sub;
    this.stamp.style.display = 'none';
    this.terms.style.display = 'none';
    this.castBox.style.display = 'none';
    this.cast.innerHTML = '';
    this.threats.innerHTML = '';
    this.progress(0, TEXT.loading.preparing);
    this.root.style.display = '';
  }

  /**
   * One mugshot. The drawn mark shows immediately and an authored portrait
   * replaces it if the file turns out to exist — the same "procedural now,
   * authored when it arrives" contract the rest of the game runs on, which
   * here also means a missing portrait never delays the thing it illustrates.
   */
  private card(name: string, role: 'yours' | 'hostile', svg: string, portrait: string, colour?: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `loading-card w-mug ${role}`;
    if (colour) el.style.setProperty('--pc', colour);
    el.innerHTML = `<div class="face">${svg}</div><div class="cname"></div>`;
    (el.querySelector('.cname') as HTMLElement).textContent = name;
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
   * Move the fob. `note` is the line beside it: what is being waited on.
   *
   * `skip` puts up the offer to drop without waiting, which is the only way
   * off this screen other than the files arriving — the wait is uncapped by
   * design, so that a stand-in is something the player chooses rather than
   * something a slow connection chose for them. It gets its own bright prompt
   * for that reason: dimmed into the tail of the status line, the one control
   * on the screen read as a footnote.
   */
  progress(ratio: number, note: string, skip = false): void {
    const r = Math.max(0, Math.min(1, ratio));
    const pct = Math.round(r * 100);
    this.fill.style.width = `${pct}%`;
    this.pct.textContent = `${pct}%`;
    const lit = Math.round(r * SEGMENTS);
    this.segs.forEach((s, i) => {
      s.classList.toggle('lit', i < lit);
      // the newest lamp blinks while the fob is still searching
      s.classList.toggle('lead', i === lit - 1 && lit < SEGMENTS);
    });
    this.note.textContent = note;
    this.skip.innerHTML = skip ? `<span class="fe-glyph a">A</span>${TEXT.loading.skip}` : '';
  }

  hide(): void { this.root.style.display = 'none'; }
  get visible(): boolean { return this.root.style.display !== 'none'; }
}
