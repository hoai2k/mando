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
 * Axes:
 *  - `crossGrip`: a tonfa's perpendicular handle — the shaft wheels around it.
 *  - `forearm`: a roll about the forearm. The blade sweeps a disc in front of
 *    the fist, which is the one full turn that never passes through the arm.
 *    Half a roll is a reverse grip on a blade held square to the forearm.
 *  - `palm`: end over end across the palm.
 *  - `sideWheel`: an upright wheel beside the body, turning forward about the
 *    body's own left-right axis wherever the hand happens to point — the
 *    shaft or blade outboard, a tonfa's handle toward the body. It sets the
 *    weapon's orientation outright rather than adding to the grip, and it is
 *    held in the hips' heading, so a move that turns the body turns the
 *    wheels with it while they stay upright.
 * Keys are progress (0-1) → degrees, linear between keys.
 */
export type SpinAxis = 'crossGrip' | 'forearm' | 'palm' | 'sideWheel';
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

// Maris' cuts: the tonfa hangs back through the windup, then the shaft wheels
// one full turn around the grip into and through contact.
const TONFA_TURN: Array<[number, number]> = [[0, 0], [0.28, -17.2], [0.55, 143.2], [0.82, 360], [1, 360]];
registerGripSpin('tonfa1', { right: [{ about: 'crossGrip', keys: TONFA_TURN }] });
registerGripSpin('tonfa2', { left: [{ about: 'crossGrip', keys: negate(TONFA_TURN) }] });
// The cross slash and the flourish wheel both tonfas upright at her sides, so
// neither blade can pass through her. The slash brings each blade over the top
// and down in front on the contact frame.
const TONFA_SLASH: Array<[number, number]> = [[0, 0], [0.25, -17], [0.45, 200], [0.7, 330], [0.82, 360], [1, 360]];
const TONFA_FLOURISH: Array<[number, number]> = [[0, 0], [0.82, 360], [1, 360]];
registerGripSpin('tonfa3', {
  right: [{ about: 'sideWheel', keys: TONFA_SLASH }], left: [{ about: 'sideWheel', keys: TONFA_SLASH }],
});
registerGripSpin('tonfaFlourish', {
  right: [{ about: 'sideWheel', keys: TONFA_FLOURISH }], left: [{ about: 'sideWheel', keys: TONFA_FLOURISH }],
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
const _world = new THREE.Quaternion();
const _target = new THREE.Quaternion();
const _forearm = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _heading = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const HILT = new THREE.Vector3(0, 1, 0);
const LATERAL = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The axis in the weapon's frame. The hand mount reproduces the canonical
 * `weaponR`/`weaponL` frame, whose +Y runs back up the forearm, so the forearm
 * in the weapon's frame is that axis through the inverse of its grip.
 */
function axisFor(about: Exclude<SpinAxis, 'sideWheel'>, weapon: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  if (about === 'crossGrip') return out.set(1, 0, 0);
  _inv.copy(weapon.quaternion).invert();
  _forearm.set(0, 1, 0).applyQuaternion(_inv);
  if (about === 'forearm') return out.copy(_forearm);
  out.crossVectors(HILT, _forearm);
  return out.lengthSq() > 1e-6 ? out.normalize() : out.set(1, 0, 0);
}

/**
 * A wheel's rest orientation in the body's frame, per hand: the weapon's +Y
 * (a blade, or a tonfa's capped end with the blade behind it) forward, its +X
 * — which carries a tonfa's handle on its far side — pointing outward, so the
 * handle faces in.
 */
const WHEEL_REST = {
  right: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0))),
  left: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0))),
};

/** seconds a grip takes to turn from one clip's hold into the next */
const GRIP_BLEND = 0.15;

interface BlendState { clip: string; from: THREE.Quaternion; t: number }

/**
 * Pose one weapon's in-hand pivot for this frame.
 *
 * When the clip changes, the pivot eases from wherever the last clip left it
 * into the new one's hold over `GRIP_BLEND`, the way the bones crossfade: a
 * strike held in a reverse grip rolls into it from the guard, and rolls back
 * out after. A still frame (dt 0, the workbench scrubbing) takes the new hold
 * at once.
 */
export function applyGripSpin(
  weapon: THREE.Object3D, side: 'right' | 'left', clip: string | null, spin: GripSpin | undefined,
  progress: number, dt: number, body: THREE.Object3D, hips: THREE.Object3D,
): void {
  const pivot = weapon.userData.gripSpin as THREE.Object3D | undefined;
  if (!pivot) return;
  const curves = spin?.[side] ?? [];
  _target.identity();
  const wheel = curves.find((c) => c.about === 'sideWheel');
  if (wheel) {
    // world orientation wanted: the body's frame, turned forward about its own
    // left-right axis, from the wheel's rest; expressed under the weapon
    weapon.updateWorldMatrix(true, false);
    hips.updateWorldMatrix(true, false);
    body.getWorldQuaternion(_world);
    // the hips' heading, yaw only, in the body's frame
    _fwd.set(0, 0, 1).applyQuaternion(hips.getWorldQuaternion(_heading)).applyQuaternion(_inv.copy(_world).invert());
    _world.multiply(_heading.setFromAxisAngle(UP, Math.atan2(_fwd.x, _fwd.z)))
      .multiply(_q.setFromAxisAngle(LATERAL, sample(wheel.keys, progress) * Math.PI / 180))
      .multiply(WHEEL_REST[side]);
    weapon.getWorldQuaternion(_inv).invert();
    _target.copy(_inv).multiply(_world);
  } else {
    for (const curve of curves) {
      axisFor(curve.about as Exclude<SpinAxis, 'sideWheel'>, weapon, _axis);
      _target.premultiply(_q.setFromAxisAngle(_axis, sample(curve.keys, progress) * Math.PI / 180));
    }
  }
  const key = gripClipKey(clip);
  let state = weapon.userData.gripBlend as BlendState | undefined;
  if (!state) state = weapon.userData.gripBlend = { clip: key, from: new THREE.Quaternion(), t: 1 };
  if (state.clip !== key) {
    state.clip = key;
    state.from.copy(pivot.quaternion);
    state.t = 0;
  }
  state.t = dt > 0 ? Math.min(1, state.t + dt / GRIP_BLEND) : 1;
  const k = state.t * state.t * (3 - 2 * state.t);
  pivot.quaternion.copy(state.from).slerp(_target, k);
}
