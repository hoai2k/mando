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
  /**
   * What kind of figure this pose is for. `humanoid` poses are two clips on
   * the canonical rig; `creature` poses drive an animal that animates itself
   * on a rig of its own. A subject only ever offers one of the two — a massiff
   * has no `runUpper` to play, and listing one only offers a control that does
   * nothing when it is picked.
   */
  rig: 'humanoid' | 'creature';
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
  /** creature poses: the ground speed to report, which is what picks its gait */
  gait?: number;
  /** creature poses: replay the creature's own attack on a loop */
  strike?: boolean;
}

const HUMANOID: Pose[] = [
  { rig: 'humanoid', id: 'rest', name: 'Rest pose (no clip)', lower: null, upper: null },
  { rig: 'humanoid', id: 'idle', name: 'Idle', lower: 'idleLower', upper: 'idleUpper' },
  { rig: 'humanoid', id: 'run', name: 'Run', lower: 'runLower', upper: 'runUpper' },
  { rig: 'humanoid', id: 'sprint', name: 'Sprint', lower: 'sprintLower', upper: 'runUpper', rate: 1.35 },
  { rig: 'humanoid', id: 'strafe', name: 'Strafe — right', lower: 'strafeLower', upper: 'aimUpper' },
  { rig: 'humanoid', id: 'strafeL', name: 'Strafe — left', lower: 'strafeLLower', upper: 'aimUpper' },
  { rig: 'humanoid', id: 'backpedal', name: 'Back-pedal', lower: 'backpedalLower', upper: 'aimUpper', rate: -0.9 },
  { rig: 'humanoid', id: 'saberIdle', name: 'Saber stance — idle', lower: 'idleLower', upper: 'saberIdleUpper', melee: true },
  { rig: 'humanoid', id: 'saberRun', name: 'Saber stance — run', lower: 'runLower', upper: 'saberRunUpper', melee: true },
  { rig: 'humanoid', id: 'flourish', name: 'Saber flourish', lower: 'idleLower', upper: 'saberFlourish', melee: true },
  { rig: 'humanoid', id: 'aim', name: 'Aim — standing', lower: 'idleLower', upper: 'aimUpper' },
  { rig: 'humanoid', id: 'runaim', name: 'Aim — running', lower: 'runLower', upper: 'aimUpper' },
  { rig: 'humanoid', id: 'air', name: 'Jump / falling', lower: 'airLower', upper: 'airUpper' },
  { rig: 'humanoid', id: 'land', name: 'Landing — absorb', lower: 'landLower', upper: 'idleUpper' },
  { rig: 'humanoid', id: 'swim', name: 'Swimming — front crawl', lower: 'swimLower', upper: 'swimUpper' },
  { rig: 'humanoid', id: 'fly', name: 'Jetpack flight', lower: 'flyLower', upper: 'flyUpper', thrust: 1 },
  { rig: 'humanoid', id: 'block', name: 'Block — shield up', lower: 'blockLower', upper: 'blockUpper', block: true },
  { rig: 'humanoid', id: 'melee1', name: 'Melee 1 — swing', lower: 'meleeLower1', upper: 'melee1', melee: true },
  { rig: 'humanoid', id: 'saber1', name: 'Sabers 1 — right lead', lower: 'meleeLower1', upper: 'saber1', melee: true },
  { rig: 'humanoid', id: 'saber2', name: 'Sabers 2 — left lead', lower: 'meleeLower2', upper: 'saber2', melee: true },
  { rig: 'humanoid', id: 'saber3', name: 'Sabers 3 — cross slash', lower: 'meleeLower3', upper: 'saber3', melee: true },
  { rig: 'humanoid', id: 'melee2', name: 'Melee 2 — backswing', lower: 'meleeLower2', upper: 'melee2', melee: true },
  { rig: 'humanoid', id: 'melee3', name: 'Melee 3 — overhead', lower: 'meleeLower3', upper: 'melee3', melee: true },
  { rig: 'humanoid', id: 'hit', name: 'Hit reaction', lower: 'idleLower', upper: 'hitUpper' },
  { rig: 'humanoid', id: 'hitL', name: 'Hit — from left flank', lower: 'idleLower', upper: 'hitFromL' },
  { rig: 'humanoid', id: 'hitR', name: 'Hit — from right flank', lower: 'idleLower', upper: 'hitFromR' },
  { rig: 'humanoid', id: 'death', name: 'Death', lower: 'deathLower', upper: 'deathUpper' },
  { rig: 'humanoid', id: 'enemyAim', name: 'Enemy aim', lower: 'idleLower', upper: 'enemyAimUpper' },
  { rig: 'humanoid', id: 'enemySwing', name: 'Enemy swing', lower: 'idleLower', upper: 'enemySwing' },
];

/**
 * What a self-animating creature can be asked to do. It has no channels to
 * play: its own gait clips are blended by the ground speed it is told it is
 * making, and its strike is a method call. The rest pose stands it still with
 * no clip at all, which is the honest "what did the artist sculpt" view.
 */
const CREATURE: Pose[] = [
  { rig: 'creature', id: 'creatureIdle', name: 'Idle', lower: null, upper: null, gait: 0 },
  { rig: 'creature', id: 'creatureWalk', name: 'Walk / prowl', lower: null, upper: null, gait: 1.6 },
  { rig: 'creature', id: 'creatureRun', name: 'Run', lower: null, upper: null, gait: 12 },
  { rig: 'creature', id: 'creatureAttack', name: 'Attack', lower: null, upper: null, gait: 0, strike: true },
];

const REST: Pose = { rig: 'humanoid', id: 'rest', name: 'Rest pose (no clip)', lower: null, upper: null };

export const POSES: Pose[] = [...HUMANOID, ...CREATURE];

/**
 * The poses a figure can actually perform.
 *
 * The picker used to list every humanoid clip for everything on the turntable,
 * so a massiff was offered a saber flourish and a jetpack hover and stood
 * there doing nothing when either was picked. A figure is asked what it has
 * instead: an animator with the clips, or a creature's own gait and strike.
 */
export interface PoseCapabilities {
  /** clip names the figure's animator can play, empty for a creature or a prop */
  clips: ReadonlySet<string>;
  /** the figure animates itself from a reported ground speed */
  gait: boolean;
  /** the figure has an attack of its own */
  strike: boolean;
}

export function posesFor(caps: PoseCapabilities[]): Pose[] {
  if (!caps.length) return [REST];
  const every = (f: (c: PoseCapabilities) => boolean): boolean => caps.every(f);
  const out = HUMANOID.filter((p) => p.lower || p.upper
    ? every((c) => [p.lower, p.upper].every((n) => !n || c.clips.has(n)))
    : true);
  // a creature's poses only when nothing on the turntable is on our rig, so a
  // compare view of a character never mixes the two sets
  if (out.length > 1) return out;
  const creature = CREATURE.filter((p) => (p.strike ? every((c) => c.strike) : every((c) => c.gait)));
  return [REST, ...creature];
}

export const findPose = (id: string): Pose => POSES.find((p) => p.id === id) ?? POSES[1];
