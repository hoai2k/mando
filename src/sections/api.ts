import type * as THREE from 'three';
import type { FrameInput } from '../core/input';
import type { SectionId, StageSpec } from '../world/mission';
import type { SectionContext } from './context';
import type { Player } from '../player/player';
import type { Game } from '../game/game';

/**
 * The contract every gameplay section is built to
 * (docs/SECTIONS_IMPLEMENTATION.md §2).
 *
 * A section is a **stage** of a territory's run that plays as a game of its
 * own — a lava bike run, a lift under siege, a stealth yard. Its module builds
 * the geometry and runs the rules; the campaign raises it through the registry
 * (`index.ts`), hands it the frame while the match is fighting, asks it where
 * the objective is and where the fallen come back, and plays the transport to
 * the next stage the moment it reports `complete`.
 *
 * The rules a section is written to (the plan's §0): nothing it needs lives
 * outside it, nobody is ever sent backwards, the way on and the edges read from
 * the scene, and its two ends match the doors either side of it.
 */
export interface SectionDef {
  id: SectionId;
  /**
   * Build the geometry and the rules; called once, when the stage is raised.
   *
   * **Spawn nothing here** — no hostiles, rides or pickups. The stage is not
   * standing yet (placement validates against the stage that is), so do it
   * from the first `update` instead. Geometry, colliders, hazards and props
   * all belong here.
   */
  build(ctx: SectionContext): SectionInstance;
  /** what the stage does to the world while it stands: fog, gravity, a roof… */
  world?: StageSpec['world'];
}

/** one bar on the section's HUD panel */
export interface SectionBar {
  label: string;
  /** 0..1 */
  value: number;
  tone?: 'good' | 'warn' | 'danger' | 'info';
}

/** what a section puts on one player's HUD, under the objective */
export interface SectionHud {
  title?: string;
  bars?: SectionBar[];
  line?: string;
}

/** the one objective, for the beacon, radar pip, screen marker and hint line */
export interface SectionObjective {
  pos: THREE.Vector3;
  /** what the marker calls it: "the chimney lip" */
  label: string;
  /** the HUD's standing instruction: "Climb — the magma is rising" */
  hint: string;
  /** light the guide column over it (default true) */
  beacon?: boolean;
}

/** what the test autopilot would press this frame; `yaw` points the camera */
export type AutopilotInput = Partial<FrameInput> & { yaw?: number };

export interface SectionInstance {
  /** player spawn points, in slot order (wrapped for more players) */
  starts: THREE.Vector3[];
  /** the representative floor the ceiling is measured from */
  floorY: number;
  /** the flight ceiling, absolute; `Infinity` for none */
  ceilingY: number;
  /** the walkable surface under a column (off-path is judged against it) */
  groundAt(x: number, z: number): number;
  /** is this x,z inside the playable footprint? (placement validates against it) */
  contains(x: number, z: number): boolean;
  /** the golden path, start to finish — guidance and the test walker read it */
  path: THREE.Vector3[];
  /** ticked while the match is fighting */
  update(dt: number): void;
  /** true once the section is won: the campaign plays the transport onward */
  readonly complete: boolean;
  objective(): SectionObjective;
  /** where a fallen player of this slot comes back: forward, with the party */
  respawnSpot(slot: number): THREE.Vector3;
  /**
   * Is a body at `pos` off the playable area? Default: more than 9 m below
   * `groundAt`. A section with a void, lava or a shaft says so itself.
   */
  offPath?(pos: THREE.Vector3): boolean;
  /** per-player HUD panel, or null for none */
  hud?(slot: number): SectionHud | null;
  /** the inputs a bot would give this player this frame to make progress */
  autopilot(slot: number): AutopilotInput;
  /** anything the context does not already own */
  dispose?(): void;
  /** optional numbers for tests and debugging (`window.__game.campaign.section.debug()`) */
  debug?(): Record<string, unknown>;
}

/**
 * A section's own way of moving a player (`Player.sectionMove`): K7's slide
 * and flight, K3's turret seat and bike lane. Both halves are optional.
 */
export interface SectionMove {
  /** rewrite this frame's input before the player reads it */
  adjust?(p: Player, dt: number, input: FrameInput, game: Game): FrameInput;
  /** take the whole frame — movement, animation, camera — and return true */
  take?(p: Player, dt: number, input: FrameInput, game: Game, realDt: number): boolean;
  /**
   * Own the horizontal velocity this frame and return true (K7: the slide's
   * gravity along the slope, flight's thrust). Everything else of the frame —
   * the jump, the jetpack, the gun, the animation, the camera — runs as
   * normal around it, which is what `take` cannot offer.
   */
  steer?(p: Player, dt: number, input: FrameInput, game: Game): boolean;
  /** hold the body in the crouched pose this frame (K7's surf) */
  crouch?(p: Player): boolean;
}
