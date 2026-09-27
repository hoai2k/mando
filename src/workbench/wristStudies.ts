import * as THREE from 'three';
import type { ClipSet } from '../anim/clips';

/**
 * Wrist studies for Din: each is a shipped strike with a keyed hand added and
 * nothing else changed, so the workbench compares a wrist against no wrist on
 * the same arm path, the same free arm, and — through `gripClipKey` — the same
 * exported grip.
 *
 * AXIS: the swing-plane normal at contact (blade direction × tip velocity) in
 * the forearm's frame, measured on Din's authored model holding his exported
 * per-strike grips. Turning the hand about it moves the tip within the swing
 * itself: negative cocks the tip back behind the hand, positive throws it
 * through. These axes belong to Din's grips; another fighter holding the same
 * clip at a different angle would need its own.
 *
 * Measured with the snap below against the shipped strikes, tip speed at the
 * contact frame rose 74-82% on the first two spear hits (at a 35° cock; the
 * gentler spear wrist here keeps about half of that), 33% on the third and
 * 17-29% on the Darksaber, with contact still at the speed peak.
 */
const AXES: Record<string, [number, number, number]> = {
  melee1: [0.628, 0.013, 0.778],
  melee2: [-0.266, -0.008, -0.964],
  melee3: [0.984, 0.002, -0.176],
  darksaber1: [0.915, 0.378, 0.14],
  darksaber2: [-0.369, -0.27, -0.889],
  darksaber3: [0.993, -0.112, -0.025],
};

/** the melee controller's contact frame, as a share of the clip (player.ts `meleeHitPending`) */
const CONTACT = 0.45;

type Profile = (windup: number, strike: number, dur: number) => Array<[number, number]>;

/**
 * Snap: cocked through the windup, square at contact, thrown past it. The
 * squeeze-and-release of kendo's tenouchi, and the edge alignment a cut
 * needs to bite — the hand leads, the blade arrives last and fastest.
 */
const snap = (cock: number, over: number): Profile => (windup, strike, dur) => [
  [0, -0.6 * cock], [windup, -cock], [CONTACT * dur, 0], [strike, over], [dur, 0],
];

/**
 * Drag: the blade is heavier than the hand. It trails into contact still
 * partly cocked, then its momentum carries the wrist well past the line and
 * lets go slowly — fast in, slow out. For the Darksaber in Din's hands, where
 * the weight of the weapon is the whole point of the fight.
 */
const drag = (cock: number, over: number): Profile => (windup, strike, dur) => [
  [0, -0.6 * cock], [windup, -cock], [CONTACT * dur, -0.35 * cock], [strike, over],
  [strike + (dur - strike) * 0.5, 0.6 * over], [dur, 0],
];

/**
 * The spear is held partway down the shaft, so a flick of the wrist swings its
 * back half toward the forearm: at 35° the rear shaft came within about 5 cm
 * of the gauntlet on the first two hits. It gets a gentler wrist than the
 * blade. The Darksaber's second hit is a backhand whose pommel already passes
 * within 5 cm of the forearm unflexed, so it gets a gentler one too.
 */
const STUDIES: Array<{ base: string; suffix: string; profile: Profile }> = [
  ...['melee1', 'melee2', 'melee3'].map((base) => ({ base, suffix: 'Wrist', profile: snap(20, 12) })),
  { base: 'darksaber1', suffix: 'Wrist', profile: snap(35, 20) },
  { base: 'darksaber2', suffix: 'Wrist', profile: snap(22, 14) },
  { base: 'darksaber3', suffix: 'Wrist', profile: snap(35, 20) },
  { base: 'darksaber1', suffix: 'WristDrag', profile: drag(40, 30) },
  { base: 'darksaber2', suffix: 'WristDrag', profile: drag(26, 20) },
  { base: 'darksaber3', suffix: 'WristDrag', profile: drag(40, 30) },
];

export function wristStudyClips(clips: ClipSet): ClipSet {
  const out: ClipSet = {};
  for (const { base, suffix, profile } of STUDIES) {
    const src = clips[base];
    const arm = src?.tracks.find((t) => t.name === 'upperArmR.quaternion');
    if (!src || !arm || arm.times.length < 4) continue;
    const keys = profile(arm.times[1], arm.times[2], src.duration);
    const axis = new THREE.Vector3(...AXES[base]).normalize();
    const values = keys.flatMap(([, deg]) =>
      new THREE.Quaternion().setFromAxisAngle(axis, deg * Math.PI / 180).toArray());
    const clip = src.clone();
    clip.name = `${base}${suffix}`;
    clip.tracks = clip.tracks.filter((t) => t.name !== 'handR.quaternion');
    clip.tracks.push(new THREE.QuaternionKeyframeTrack('handR.quaternion', keys.map(([t]) => t), values));
    out[clip.name] = clip;
  }
  return out;
}
