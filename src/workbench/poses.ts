/**
 * The poses the workbench can hold a character in — the same clips the game
 * plays, named the way you'd ask for them.
 *
 * `lower`/`upper` are the two animator channels; one-shots (melee swings, hit
 * reacts, death) are looped here so they can be watched rather than glimpsed.
 */
export interface Pose {
  id: string;
  name: string;
  lower: string | null;
  upper: string | null;
  /** playback rate for the lower channel, e.g. sprint is run played faster */
  rate?: number;
  /** jetpack thrust to show while this pose runs */
  thrust?: number;
  /** gaffi stick instead of the carbine */
  melee?: boolean;
}

export const POSES: Pose[] = [
  { id: 'rest', name: 'Rest pose (no clip)', lower: null, upper: null },
  { id: 'idle', name: 'Idle', lower: 'idleLower', upper: 'idleUpper' },
  { id: 'run', name: 'Run', lower: 'runLower', upper: 'runUpper' },
  { id: 'sprint', name: 'Sprint', lower: 'runLower', upper: 'runUpper', rate: 1.35 },
  { id: 'aim', name: 'Aim — standing', lower: 'idleLower', upper: 'aimUpper' },
  { id: 'runaim', name: 'Aim — running', lower: 'runLower', upper: 'aimUpper' },
  { id: 'air', name: 'Jump / falling', lower: 'airLower', upper: 'airUpper' },
  { id: 'fly', name: 'Jetpack flight', lower: 'flyLower', upper: 'flyUpper', thrust: 1 },
  { id: 'melee1', name: 'Melee 1 — swing', lower: 'idleLower', upper: 'melee1', melee: true },
  { id: 'melee2', name: 'Melee 2 — backswing', lower: 'idleLower', upper: 'melee2', melee: true },
  { id: 'melee3', name: 'Melee 3 — overhead', lower: 'idleLower', upper: 'melee3', melee: true },
  { id: 'hit', name: 'Hit reaction', lower: 'idleLower', upper: 'hitUpper' },
  { id: 'death', name: 'Death', lower: 'deathLower', upper: 'deathUpper' },
  { id: 'enemyAim', name: 'Enemy aim', lower: 'idleLower', upper: 'enemyAimUpper' },
  { id: 'enemySwing', name: 'Enemy swing', lower: 'idleLower', upper: 'enemySwing' },
];

export const findPose = (id: string): Pose => POSES.find((p) => p.id === id) ?? POSES[1];
