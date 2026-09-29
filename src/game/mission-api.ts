import type * as THREE from 'three';
import type { EnemyKind } from '../enemies/enemy';
import type { SectionHud } from '../sections/api';
import type { SectionId } from '../world/mission';

/**
 * What the rest of the game asks of a Missions controller.
 *
 * There is one of them now, the outdoor stage runner (`game/campaign.ts`,
 * docs/MISSIONS_OUTDOOR.md). This surface was cut when a walled room chain
 * ran beside it behind a flag; that design has been retired, and the
 * interface stays because it is still the whole of what `Game` and the HUD
 * need — `Game.campaign` is typed by it so nothing outside the mode's rules
 * reaches into the stage runner's internals by accident.
 */
export interface MissionController {
  /** the run is won — the warlord, and any monster under it, are down */
  readonly done: boolean;
  /** where the beacon stands and the radar pip points: the one objective */
  readonly objectivePos: THREE.Vector3;
  /** what the objective is called, for the HUD's screen marker */
  readonly objectiveLabel: string;
  /**
   * True while a newly raised stage's art is still arriving. The run is frozen
   * behind it and the shell holds a veil over the top — the same bargain the
   * drop makes, applied to every transport door after it.
   */
  readonly settlingStage: boolean;
  /** how far that wait has got, for the bar over it */
  stageSettleProgress(): { ratio: number; pending: number };
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
  /** a gameplay section's HUD panel for this player, when one is standing */
  sectionHud?(slot: number): SectionHud | null;
  /** the end of the frame, for a standing gameplay section (`SectionInstance.afterFrame`) */
  sectionAfterFrame?(dt: number): void;
  /** the stage in play, for the manual's job page: its name, and its section if it is one */
  readonly stageBrief?: { label: string; section: SectionId | null };
  /**
   * A section's reward reaching the next stage (One Way Out's ten-or-more
   * prisoners): the lieutenant fought in stage `stage` calls for backup and
   * none comes; `line` is the banner said instead. Lives on the run, so it
   * is gone when the run ends.
   */
  waiveRetinue?(stage: number, line: string): void;
  /** that reward's banner line, if the boss fight standing now is waived, else null */
  retinueWaived?(): string | null;
  /** development only: play the transport out of the standing section as though it were won */
  skipSection?(): boolean;
}
