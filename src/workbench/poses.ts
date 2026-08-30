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
  /** playback rate for the lower channel, e.g. the back-pedal is its cycle reversed */
  rate?: number;
  /** jetpack thrust to show while this pose runs */
  thrust?: number;
  /** gaffi stick instead of the carbine */
  melee?: boolean;
  /** raise the block shield */
  block?: boolean;
}

export const POSES: Pose[] = [
  { id: 'rest', name: 'Rest pose (no clip)', lower: null, upper: null },
  { id: 'idle', name: 'Idle', lower: 'idleLower', upper: 'idleUpper' },
  { id: 'run', name: 'Run', lower: 'runLower', upper: 'runUpper' },
  { id: 'sprint', name: 'Sprint', lower: 'sprintLower', upper: 'runUpper', rate: 1.35 },
  { id: 'strafe', name: 'Strafe — right', lower: 'strafeLower', upper: 'aimUpper' },
  { id: 'strafeL', name: 'Strafe — left', lower: 'strafeLLower', upper: 'aimUpper' },
  { id: 'backpedal', name: 'Back-pedal', lower: 'backpedalLower', upper: 'aimUpper', rate: -0.9 },
  { id: 'saberIdle', name: 'Saber stance — idle', lower: 'idleLower', upper: 'saberIdleUpper', melee: true },
  { id: 'saberRun', name: 'Saber stance — run', lower: 'runLower', upper: 'saberRunUpper', melee: true },
  { id: 'flourish', name: 'Saber flourish', lower: 'idleLower', upper: 'saberFlourish', melee: true },
  { id: 'aim', name: 'Aim — standing', lower: 'idleLower', upper: 'aimUpper' },
  { id: 'runaim', name: 'Aim — running', lower: 'runLower', upper: 'aimUpper' },
  { id: 'air', name: 'Jump / falling', lower: 'airLower', upper: 'airUpper' },
  { id: 'fly', name: 'Jetpack flight', lower: 'flyLower', upper: 'flyUpper', thrust: 1 },
  { id: 'block', name: 'Block — shield up', lower: 'blockLower', upper: 'blockUpper', block: true },
  { id: 'melee1', name: 'Melee 1 — swing', lower: 'meleeLower1', upper: 'melee1', melee: true },
  { id: 'saber1', name: 'Sabers 1 — right lead', lower: 'meleeLower1', upper: 'saber1', melee: true },
  { id: 'saber2', name: 'Sabers 2 — left lead', lower: 'meleeLower2', upper: 'saber2', melee: true },
  { id: 'saber3', name: 'Sabers 3 — cross slash', lower: 'meleeLower3', upper: 'saber3', melee: true },
  { id: 'melee2', name: 'Melee 2 — backswing', lower: 'meleeLower2', upper: 'melee2', melee: true },
  { id: 'melee3', name: 'Melee 3 — overhead', lower: 'meleeLower3', upper: 'melee3', melee: true },
  { id: 'hit', name: 'Hit reaction', lower: 'idleLower', upper: 'hitUpper' },
  { id: 'hitL', name: 'Hit — from left flank', lower: 'idleLower', upper: 'hitFromL' },
  { id: 'hitR', name: 'Hit — from right flank', lower: 'idleLower', upper: 'hitFromR' },
  { id: 'death', name: 'Death', lower: 'deathLower', upper: 'deathUpper' },
  { id: 'enemyAim', name: 'Enemy aim', lower: 'idleLower', upper: 'enemyAimUpper' },
  { id: 'enemySwing', name: 'Enemy swing', lower: 'idleLower', upper: 'enemySwing' },
];

export const findPose = (id: string): Pose => POSES.find((p) => p.id === id) ?? POSES[1];
