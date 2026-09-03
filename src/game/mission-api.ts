import type * as THREE from 'three';
import type { EnemyKind } from '../enemies/enemy';

/**
 * What the rest of the game asks of a Missions controller.
 *
 * There are two of them: the outdoor stage runner (`game/campaign.ts`,
 * docs/MISSIONS_OUTDOOR.md) and the walled room chain it replaced
 * (`game/campaign-legacy.ts`, kept behind `?backup=missions` as a way back if
 * the new design does not work out). Nothing outside those two files and the
 * mode's rules should care which is running, so `Game.campaign` is typed by
 * this surface rather than by either class.
 */
export interface MissionController {
  /** the run is won — the warlord, and any monster under it, are down */
  readonly done: boolean;
  /** where the beacon stands and the radar pip points: the one objective */
  readonly objectivePos: THREE.Vector3;
  /** what the objective is called, for the HUD's screen marker */
  readonly objectiveLabel: string;
  /** slots standing in a transport door's pocket, waiting on the rest */
  readonly exited: ReadonlySet<number>;
  /** somewhere inside the level a body of this kind can stand, at or near `pos` */
  placeNear(pos: THREE.Vector3, kind: EnemyKind): THREE.Vector3;
  /** where a fallen player comes back, or null to fall through to the board */
  respawnSpot(slot: number): THREE.Vector3 | null;
  /** the HUD's standing instruction for whoever is standing at `from` */
  hint(from: THREE.Vector3): string;
  /** the run's own logic; ticked only while the match is `fighting` */
  update(dt: number): void;
  /**
   * Move the doors. Separate from `update` because that only ticks while the
   * match is fighting, and a door caught mid-slide by a boss intro or a
   * victory card would freeze there still carrying its blocker.
   */
  animateGates(dt: number): void;
}
