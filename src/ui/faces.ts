import { MANDO_ROSTER, type MandoId } from '../characters/mandalorians';
import type { EnemyKind } from '../enemies/enemy';
import type { PlayableId } from '../characters/roster';

/**
 * Drawn face marks, shared by the drop screen and the PvP VS splash: a helmet
 * in a character's own colours, an optic for droids, a many-legged shape for
 * the beasts. Authored portraits (`portrait_<id>.jpg`, see ASSETS_IMAGES.md)
 * take over wherever they exist; these are the always-there fallback.
 */

export function helmetSvg(primary: string, accent: string, visor: string): string {
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

const BEASTS = new Set<EnemyKind>(['krykna', 'broodmother', 'massiff', 'alamite']);
const DROIDS = new Set<EnemyKind>(['droid', 'darktrooper', 'drone', 'escortDroid']);

export function beastSvg(): string {
  return `<svg viewBox="0 0 100 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <g stroke="#6b6f76" stroke-width="5" fill="none" stroke-linecap="round">
      <path d="M50 62 18 34M50 62 12 62M50 62 20 92M50 62 82 34M50 62 88 62M50 62 80 92"/>
    </g>
    <ellipse cx="50" cy="64" rx="20" ry="16" fill="#4a4e55"/>
    <circle cx="43" cy="60" r="3.4" fill="#8a2a22"/><circle cx="57" cy="60" r="3.4" fill="#8a2a22"/>
  </svg>`;
}

export function droidSvg(): string {
  return `<svg viewBox="0 0 100 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path d="M30 26h40l8 14v46l-8 12H30l-8-12V40z" fill="#6b6f76"/>
    <path d="M30 26h40l8 14H22z" fill="#33363b"/>
    <rect x="32" y="52" width="36" height="10" rx="5" fill="#8a2a22"/>
    <rect x="42" y="74" width="16" height="20" rx="3" fill="#33363b"/>
  </svg>`;
}

export function hostileSvg(kind: EnemyKind): string {
  if (BEASTS.has(kind)) return beastSvg();
  if (DROIDS.has(kind)) return droidSvg();
  return helmetSvg('#6b6f76', '#33363b', '#8a2a22');
}

export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** the drawn mark for any playable — Mandalorian colours or the NPC's kind mark */
export function faceSvg(id: PlayableId): string {
  const c = MANDO_ROSTER[id as MandoId];
  if (c) return helmetSvg(hex(c.primary), hex(c.accent), hex(c.suit));
  return hostileSvg(id.replace('npc:', '') as EnemyKind);
}

/** the authored portrait basename a playable answers to */
export { portraitName } from '../core/assets';
