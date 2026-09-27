import * as THREE from 'three';
import { gripClipKey } from './gripClipKey';

/**
 * A held weapon turning inside the hand rather than with it.
 *
 * A saber twirl, a tonfa spun around its cross-grip, a hilt flipped into a
 * reverse grip: the blade turns far further than any wrist can, and keying the
 * hand bone that far corkscrews the glove. So every saber carries a pivot at
 * the grip (`userData.gripSpin`, see `makeSaber`) and a clip keys it here, by
 * clip name, against the upper channel's progress.
 *
 * Axes, in the weapon's own frame:
 *  - `crossGrip`: a tonfa's perpendicular handle — the shaft wheels around it.
 *  - `forearm`: a roll about the forearm. The blade sweeps a disc in front of
 *    the fist, which is the one full turn that never passes through the arm.
 *  - `palm`: end over end across the palm. 180° held is a reverse grip.
 * Keys are progress (0-1) → degrees, linear between keys.
 */
export type SpinAxis = 'crossGrip' | 'forearm' | 'palm';
export interface SpinCurve { about: SpinAxis; keys: Array<[number, number]> }
export interface GripSpin { right?: SpinCurve[]; left?: SpinCurve[] }

const SPINS = new Map<string, GripSpin>();

export function registerGripSpin(clip: string, spin: GripSpin): void {
  SPINS.set(clip, spin);
}

export function gripSpinFor(clip: string | null): GripSpin | undefined {
  return SPINS.get(gripClipKey(clip));
}

const negate = (keys: Array<[number, number]>): Array<[number, number]> => keys.map(([t, d]) => [t, -d]);

// Maris' shipped cuts: the tonfa hangs back through the windup, then the shaft
// wheels one full turn around the grip into and through contact.
const TONFA_TURN: Array<[number, number]> = [[0, 0], [0.28, -17.2], [0.55, 143.2], [0.82, 360], [1, 360]];
const TONFA_FLOURISH: Array<[number, number]> = [[0, 0], [0.82, 360], [1, 360]];
registerGripSpin('tonfa1', { right: [{ about: 'crossGrip', keys: TONFA_TURN }] });
registerGripSpin('tonfa2', { left: [{ about: 'crossGrip', keys: negate(TONFA_TURN) }] });
registerGripSpin('tonfa3', {
  right: [{ about: 'crossGrip', keys: TONFA_TURN }], left: [{ about: 'crossGrip', keys: negate(TONFA_TURN) }],
});
registerGripSpin('tonfaFlourish', {
  right: [{ about: 'crossGrip', keys: TONFA_FLOURISH }], left: [{ about: 'crossGrip', keys: negate(TONFA_FLOURISH) }],
});

function sample(keys: Array<[number, number]>, p: number): number {
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const [t0, a0] = keys[i - 1], [t1, a1] = keys[i];
      return a0 + (a1 - a0) * (p - t0) / (t1 - t0);
    }
  }
  return keys[keys.length - 1][1];
}

const _q = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _forearm = new THREE.Vector3();
const _axis = new THREE.Vector3();
const HILT = new THREE.Vector3(0, 1, 0);

/**
 * The axis in the weapon's frame. The hand mount reproduces the canonical
 * `weaponR`/`weaponL` frame, whose +Y runs back up the forearm, so the forearm
 * in the weapon's frame is that axis through the inverse of its grip.
 */
function axisFor(about: SpinAxis, weapon: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  if (about === 'crossGrip') return out.set(1, 0, 0);
  _inv.copy(weapon.quaternion).invert();
  _forearm.set(0, 1, 0).applyQuaternion(_inv);
  if (about === 'forearm') return out.copy(_forearm);
  out.crossVectors(HILT, _forearm);
  return out.lengthSq() > 1e-6 ? out.normalize() : out.set(1, 0, 0);
}

/** Pose one weapon's in-hand pivot for this frame; no curves puts it back square in the grip. */
export function applyGripSpin(weapon: THREE.Object3D, curves: SpinCurve[] | undefined, progress: number): void {
  const pivot = weapon.userData.gripSpin as THREE.Object3D | undefined;
  if (!pivot) return;
  pivot.quaternion.identity();
  for (const curve of curves ?? []) {
    axisFor(curve.about, weapon, _axis);
    pivot.quaternion.premultiply(_q.setFromAxisAngle(_axis, sample(curve.keys, progress) * Math.PI / 180));
  }
}
