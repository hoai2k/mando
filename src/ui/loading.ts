import { MANDO_ROSTER, type MandoId } from '../characters/mandalorians';
import { ENEMY_NAME, type EnemyKind } from '../enemies/enemy';
import { ASSET_ROOT } from '../core/assets';
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

/**
 * A helmet in a character's own colours, drawn rather than fetched.
 *
 * Portrait art can be dropped in later as `portrait_<id>.jpg` (see
 * docs/ASSETS_IMAGES.md) and takes over automatically; until then this is not
 * a placeholder box but a real mark — beskar shine, a visor, the pauldron
 * colour each Mandalorian is recognisable by.
 */
function helmetSvg(primary: string, accent: string, visor: string): string {
  return `<svg viewBox="0 0 100 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs><linearGradient id="g${primary.slice(1)}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${accent}"/>
    </linearGradient></defs>
    <path d="M50 8c19 0 30 13 30 34v30c0 22-13 40-30 40S20 94 20 72V42C20 21 31 8 50 8z"
      fill="url(#g${primary.slice(1)})"/>
    <path d="M50 8c19 0 30 13 30 34v8H20v-8C20 21 31 8 50 8z" fill="${accent}" opacity="0.55"/>
    <path d="M34 44h32v8c0 9-5 15-16 15s-16-6-16-15z" fill="${visor}"/>
    <path d="M46 60h8v34h-8z" fill="${visor}" opacity="0.75"/>
  </svg>`;
}

/**
 * Hostiles get a mark that matches what is actually coming: a helmet for the
 * things that wear one, an optic for droids, a many-legged shape for the
 * beasts. A row of identical Mandalorian helmets labelled "Krykna" tells the
 * player nothing about the fight they are dropping into.
 */
const BEASTS = new Set<EnemyKind>(['krykna', 'broodmother', 'massiff', 'alamite']);
const DROIDS = new Set<EnemyKind>(['droid', 'darktrooper', 'drone', 'ig11']);

function beastSvg(): string {
  return `<svg viewBox="0 0 100 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <g stroke="#6b6f76" stroke-width="5" fill="none" stroke-linecap="round">
      <path d="M50 62 18 34M50 62 12 62M50 62 20 92M50 62 82 34M50 62 88 62M50 62 80 92"/>
    </g>
    <ellipse cx="50" cy="64" rx="20" ry="16" fill="#4a4e55"/>
    <circle cx="43" cy="60" r="3.4" fill="#8a2a22"/><circle cx="57" cy="60" r="3.4" fill="#8a2a22"/>
  </svg>`;
}

function droidSvg(): string {
  return `<svg viewBox="0 0 100 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path d="M30 26h40l8 14v46l-8 12H30l-8-12V40z" fill="#6b6f76"/>
    <path d="M30 26h40l8 14H22z" fill="#33363b"/>
    <rect x="32" y="52" width="36" height="10" rx="5" fill="#8a2a22"/>
    <rect x="42" y="74" width="16" height="20" rx="3" fill="#33363b"/>
  </svg>`;
}

function hostileSvg(kind: EnemyKind): string {
  if (BEASTS.has(kind)) return beastSvg();
  if (DROIDS.has(kind)) return droidSvg();
  return helmetSvg('#6b6f76', '#33363b', '#8a2a22');
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export class LoadingScreen {
  root: HTMLElement;
  private art: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private cast: HTMLElement;
  private fill: HTMLElement;
  private pct: HTMLElement;
  private note: HTMLElement;

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
        <div class="loading-foot"><span class="pct"></span><span class="note"></span></div>
      </div>`;
    parent.appendChild(this.root);
    this.art = this.root.querySelector('.loading-art') as HTMLElement;
    this.title = this.root.querySelector('.loading-title') as HTMLElement;
    this.sub = this.root.querySelector('.loading-sub') as HTMLElement;
    this.cast = this.root.querySelector('.loading-cast') as HTMLElement;
    this.fill = this.root.querySelector('.fill') as HTMLElement;
    this.pct = this.root.querySelector('.pct') as HTMLElement;
    this.note = this.root.querySelector('.note') as HTMLElement;
  }

  /** Dress the screen for a particular drop and show it. */
  show(board: BoardInfo, chars: MandoId[], enemies: EnemyKind[]): void {
    this.art.style.backgroundImage =
      `url('${ASSET_ROOT}assets/textures/${board.art}'), ${board.gradient}`;
    this.title.textContent = board.name;
    this.sub.textContent = board.desc;
    this.cast.innerHTML = '';
    for (const id of chars) {
      const c = MANDO_ROSTER[id];
      this.cast.appendChild(this.card(
        MANDO_ROSTER[id].name, 'yours',
        helmetSvg(hex(c.primary), hex(c.accent), hex(c.suit)),
        `portrait_${id}`,
      ));
    }
    for (const kind of enemies) {
      this.cast.appendChild(this.card(ENEMY_NAME[kind] ?? kind, 'hostile', hostileSvg(kind), `portrait_${kind}`));
    }
    this.progress(0, 'Preparing the drop');
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

  /** Move the bar. `note` is the line under it: what is being waited on. */
  progress(ratio: number, note: string): void {
    const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
    this.fill.style.width = `${pct}%`;
    this.pct.textContent = `${pct}%`;
    this.note.textContent = note;
  }

  hide(): void { this.root.style.display = 'none'; }
  get visible(): boolean { return this.root.style.display !== 'none'; }
}
