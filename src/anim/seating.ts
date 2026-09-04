import * as THREE from 'three';
import type { Rig } from './skeleton';

/**
 * Sitting on things: where a seat actually is on a sculpt, and how to put a
 * hand on a control.
 *
 * Two problems, one cause. Everything a rider is placed by — the seat offsets
 * in `VEHICLE_DEFS`, the pose angles on the Nikto's swoop, the arm keys in
 * `rideUpper` — was measured against the *procedural stand-in*, and every one
 * of those stand-ins is a box where the sculpt that replaces it is a shape.
 * So a rider tuned to the box ends up somewhere the model never put a seat
 * (the landspeeder's headrest is the one that reads worst: it is the topmost
 * thing over the seat column, so a single ray down that column lands the
 * rider on top of it) and with its hands out in the air beside bars it cannot
 * reach.
 *
 * The answer to both is to ask the model. `seatSurface` finds the surface a
 * body is meant to sit on rather than the first thing under a ray, and
 * `reachArm` puts a hand exactly where a grip is and bends the elbow to suit.
 */

const _from = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _ray = new THREE.Raycaster();
const _nm = new THREE.Matrix3();
const _n = new THREE.Vector3();

/** how far apart two hits have to be before they are different surfaces */
const SURFACE_BAND = 0.09;
/** how level a face has to be before a body could sit on it */
const SITTABLE = 0.35;

/**
 * The height of the surface a rider sits on, at a point on a sculpt.
 *
 * Not "the first thing under the seat column" — that is what put a droid on
 * top of a landspeeder's headrest. A seat is the *broadest flat thing* in the
 * footprint a body occupies, so this drops a small grid of rays over that
 * footprint, groups the hits into surfaces, and takes the one the most rays
 * landed on. A backrest, a headrest or a roll bar is narrow: a couple of rays
 * clip its top and the rest go past it onto the cushion, so the cushion wins.
 * Ties go to the lower surface, because a seat is under its own backrest and
 * never over it.
 *
 * The grid is biased forward of the seat point for the same reason — that is
 * where the sitting happens, and it is away from whatever is behind the back.
 *
 * @param model  the sculpt to measure
 * @param at     the seat column, in world space, at the height to cast from
 * @param fwd    the ride's forward, in world space (unit)
 * @param right  the ride's right, in world space (unit)
 * @returns the world height of the seat, or null when nothing is under it
 */
export function seatSurface(model: THREE.Object3D, at: THREE.Vector3,
  fwd: THREE.Vector3, right: THREE.Vector3, reach = 6): number | null {
  const hits: number[] = [];
  for (const across of [-0.18, 0, 0.18]) {
    for (const along of [-0.12, 0.08, 0.26, 0.42]) {
      _from.copy(at).addScaledVector(right, across).addScaledVector(fwd, along);
      _ray.set(_from, _down);
      _ray.far = reach;
      for (const hit of _ray.intersectObject(model, true)) {
        // Only a surface you could sit on counts. An open cockpit is the
        // reason: a ray dropped through it comes out on the *underside* of the
        // hull, and taking that as the seat drops the rider inside the machine.
        // A hull's underside faces down, a seat faces up, and that is the whole
        // of the test.
        if (!hit.face) continue;
        _nm.getNormalMatrix(hit.object.matrixWorld);
        _n.copy(hit.face.normal).applyMatrix3(_nm).normalize();
        if (_n.y < SITTABLE) continue;
        hits.push(hit.point.y);
        break;
      }
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a - b);
  let best = hits[0];
  let bestN = 0;
  for (const h of hits) {
    let n = 0;
    let sum = 0;
    for (const other of hits) {
      if (Math.abs(other - h) <= SURFACE_BAND) { n++; sum += other; }
    }
    // strict `>` walking an ascending list means a tie keeps the lower surface
    if (n > bestN) { bestN = n; best = sum / n; }
  }
  return best;
}

// ---------------------------------------------------------------- arm IK

const _t = new THREE.Vector3();
const _hint = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/**
 * Put a hand on something: two-bone IK down one arm of the canonical rig.
 *
 * The arms are `upperArm → forearm → hand`, each hanging along its parent's
 * -Y, and the elbow bends about the forearm's local X — which is what the
 * clips already animate. So the solve is the textbook one: swing the upper
 * arm off the shoulder-to-target line by the angle the triangle wants, bend
 * the elbow by the rest, and the hand lands on the target.
 *
 * `elbowHint` is a world point the elbow is pulled toward, which is what
 * picks one of the ring of solutions — without it an arm reaching for a
 * handlebar is as likely to come up with the elbow over the shoulder.
 *
 * A target further away than the arm is long is not an error: the arm
 * straightens and points at it, which is the right read for a rider stretched
 * out over a long ride. Everything is done in the shoulder's own space, so a
 * scaled character (every playable has its own build) solves correctly.
 *
 * Call it *after* the animator has written the frame's pose and the character's
 * world matrices are up to date; it overwrites the two bones it owns.
 */
export function reachArm(rig: Rig, side: 'L' | 'R',
  target: THREE.Vector3, elbowHint: THREE.Vector3): void {
  const b = rig.bones;
  const upper = side === 'L' ? b.upperArmL : b.upperArmR;
  const fore = side === 'L' ? b.forearmL : b.forearmR;
  const hand = side === 'L' ? b.handL : b.handR;
  const parent = upper.parent;
  if (!parent) return;
  const l1 = fore.position.length();
  const l2 = hand.position.length();
  if (l1 < 1e-4 || l2 < 1e-4) return;

  // the shoulder's own space: `upper.position` is already in it, and
  // `worldToLocal` carries the character's scale across with the target
  parent.worldToLocal(_t.copy(target));
  parent.worldToLocal(_hint.copy(elbowHint));
  _dir.subVectors(_t, upper.position);
  const raw = _dir.length();
  if (raw < 1e-4) return;
  _dir.divideScalar(raw);
  const d = Math.min(l1 + l2 - 1e-3, Math.max(Math.abs(l1 - l2) + 1e-3, raw));

  // the elbow's side of the shoulder-to-target line, with the along-the-line
  // part taken out so it is a true perpendicular
  _elbow.subVectors(_hint, upper.position);
  _elbow.addScaledVector(_dir, -_elbow.dot(_dir));
  if (_elbow.lengthSq() < 1e-8) {
    // hint on the line: fall back to "elbow away from the body, and down"
    _up.set(side === 'L' ? 1 : -1, -0.4, 0).normalize();
    _elbow.copy(_up).addScaledVector(_dir, -_up.dot(_dir));
    if (_elbow.lengthSq() < 1e-8) return;
  }
  _elbow.normalize();
  _axis.crossVectors(_dir, _elbow).normalize();

  // swing the upper arm off the line, bend the elbow back onto it
  const swing = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const inner = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
  _by.copy(_dir).applyAxisAngle(_axis, swing).negate();   // bone +Y is up the arm
  _bx.copy(_axis);
  _bz.crossVectors(_bx, _by);
  _basis.makeBasis(_bx, _by, _bz);
  upper.quaternion.setFromRotationMatrix(_basis);
  fore.rotation.set(-(Math.PI - inner), 0, 0);
}
