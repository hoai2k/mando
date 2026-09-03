import type * as THREE from 'three';
import type { Player } from '../../player/player';

/**
 * A mode is a rule set over one simulation (docs/MODES.md §1) — not a second
 * game. Everything that makes Wave Battle, PvP and Missions different from
 * one another lives behind this interface: when the match opens, what happens
 * every frame, where a fallen player comes back, and what the HUD says. The
 * simulation underneath — bodies, bolts, bosses, vehicles, split-screen — is
 * the same code in all three and stays on `Game`.
 *
 * Before this existed the differences were eleven `mode ===` branches spread
 * through `Game.update`, which is where a rule for one mode quietly became a
 * rule for all three.
 */
export interface ModeRules {
  /** the line under the board's name on the opening banner */
  readonly objective: string;

  /**
   * Where player `slot` begins, when the mode has an opinion — PvP starts its
   * fighters apart on the board's own posts. Null takes the board's own start.
   */
  startFor?(slot: number): THREE.Vector3 | null;

  /** once the players and the board exist, before the first frame */
  begin(): void;

  /**
   * The mode's own clock, run at the top of the frame: the wave flow, PvP
   * scoring, the campaign's objectives. Bosses, allies and vehicles update
   * after this, whatever the mode.
   */
  update(dt: number): void;

  /**
   * A player whose death performance has finished. The mode decides whether
   * that costs a stand, where they come back, and with how much health — or
   * whether the match is over instead.
   */
  respawn(p: Player): void;

  /** the whole party is down — only the wave game can lose a match outright */
  partyWiped?(): void;

  /** HUD top line, or null to take the shared default */
  topLine(p: Player): string | null;
  /** HUD score line, or null to take the shared default */
  scoreLine(p: Player): string | null;
}

/**
 * The intro banner has had its couple of seconds: open the match. The modes
 * with no wave clock (PvP, Missions) all start the same way — the wave game
 * opens by ringing its first wave instead.
 */
export function openMatch(g: { state: string; stateTimer: number; wave: number; setState(s: 'fighting'): void }): void {
  if (g.state !== 'intro' || g.stateTimer > 0) return;
  g.setState('fighting');
  g.wave = 1;
}
