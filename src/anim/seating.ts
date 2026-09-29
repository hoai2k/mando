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
  reachLimb(side === 'L' ? b.upperArmL : b.upperArmR, side === 'L' ? b.forearmL : b.forearmR,
    side === 'L' ? b.handL : b.handR, target, elbowHint, _up.set(side === 'L' ? 1 : -1, -0.4, 0).normalize().clone(), -1);
}

const _lean = new THREE.Quaternion();
const _parentW = new THREE.Quaternion();
const _mid = new THREE.Vector3();
const _waist = new THREE.Vector3();
const _leanAxis = new THREE.Vector3();
const _shoulder = new THREE.Vector3();
const _joint = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** turn a bone about a world axis, whatever its parents' turn */
function turnWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  bone.parent!.getWorldQuaternion(_parentW);
  _lean.setFromAxisAngle(axis, angle);
  bone.quaternion.premultiply(_parentW.clone().invert().multiply(_lean).multiply(_parentW));
}

/** how far a rider may bend forward to reach a grip */
const MAX_LEAN = THREE.MathUtils.degToRad(70);

/**
 * Lean a rider forward, just as far as the hands need to reach their grips (up
 * to 70°). Half the bend is at the hips, the legs held where they stand, the
 * rest shared by the spine and the chest: a grip down at hip height is reached
 * by folding at the hips, as a body does, where a bend at the waist alone
 * lowers the shoulders without bringing them any nearer. A grip in reach
 * changes nothing. Call it after the clip has written the pose and before
 * `reachArm`, with the world matrices current; returns the lean, radians.
 */
export function leanToReach(rig: Rig, grips: Array<{ side: 'L' | 'R'; at: THREE.Vector3 }>): number {
  const b = rig.bones;
  const turned = leanBones(rig);
  unlean(rig);
  if (!grips.length || !b.hips.parent) return 0;
  // each arm's full reach, shoulder to wrist, in world metres
  const arms = grips.map(({ side, at }) => {
    const upper = side === 'L' ? b.upperArmL : b.upperArmR;
    const fore = side === 'L' ? b.forearmL : b.forearmR;
    const hand = side === 'L' ? b.handL : b.handR;
    upper.getWorldPosition(_shoulder);
    fore.getWorldPosition(_joint);
    const length = _shoulder.distanceTo(_joint) + _joint.distanceTo(hand.getWorldPosition(_mid));
    return { upper, at, length };
  });
  const short = (): number => {
    b.hips.updateMatrixWorld(true);
    return Math.max(...arms.map((a) => a.upper.getWorldPosition(_shoulder).distanceTo(a.at) - 0.98 * a.length));
  };
  if (short() <= 0) return 0;
  // toward the grips, about the level axis square to them
  _mid.set(0, 0, 0);
  for (const g of grips) _mid.add(g.at);
  _mid.divideScalar(grips.length);
  b.spine.getWorldPosition(_waist);
  _mid.sub(_waist).setY(0);
  if (_mid.lengthSq() < 1e-6) return 0;
  _leanAxis.crossVectors(UP, _mid.normalize()).normalize();
  const start = turned.map((bone) => bone.quaternion.clone());
  const settle = (angle: number): number => {
    lean(angle);
    leaned.set(rig, { before: start, after: turned.map((bone) => bone.quaternion.clone()) });
    return angle;
  };
  const lean = (angle: number): number => {
    turned.forEach((bone, i) => bone.quaternion.copy(start[i]));
    turnWorld(b.hips, _leanAxis, angle / 2);
    b.hips.updateMatrixWorld(true);
    // the thighs turned back as far, so the legs stand as they did
    turnWorld(b.upperLegL, _leanAxis, -angle / 2);
    turnWorld(b.upperLegR, _leanAxis, -angle / 2);
    turnWorld(b.spine, _leanAxis, angle / 4);
    b.spine.updateMatrixWorld(true);
    turnWorld(b.chest, _leanAxis, angle / 4);
    b.hips.updateMatrixWorld(true);
    return short();
  };
  if (lean(MAX_LEAN) > 0) return settle(MAX_LEAN);
  let lo = 0, hi = MAX_LEAN;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (lean(mid) > 0) lo = mid; else hi = mid;
  }
  return settle(hi);
}

const leanBones = (rig: Rig): THREE.Object3D[] =>
  [rig.bones.hips, rig.bones.spine, rig.bones.chest, rig.bones.upperLegL, rig.bones.upperLegR];

/**
 * Take last frame's lean off wherever the clip has not written the bone since:
 * a pose with no track for a thigh leaves it as the lean left it, and leaning
 * again from there winds the legs round frame by frame. Call it straight after
 * the clip writes the pose — before anything else turns a thigh (a leg spread,
 * a footrest), which would hide the lean's own mark from it.
 */
export function unlean(rig: Rig): void {
  const last = leaned.get(rig);
  if (!last) return;
  leanBones(rig).forEach((bone, i) => { if (bone.quaternion.equals(last.after[i])) bone.quaternion.copy(last.before[i]); });
  leaned.delete(rig);
  rig.bones.hips.updateMatrixWorld(true);
}

/** each rider's last lean: the bones as the pose had them, and as the lean left them */
const leaned = new WeakMap<Rig, { before: THREE.Quaternion[]; after: THREE.Quaternion[] }>();

/**
 * Put a foot on something — a footrest, a peg, a stirrup: the same solve down
 * one leg (`upperLeg → lowerLeg → foot`), the target being the ankle. Which way
 * the knee bends comes from the hint, as the elbow's does: put it ahead of the
 * hip and out to the side, where a rider's knee goes.
 */
export function reachLeg(rig: Rig, side: 'L' | 'R',
  ankle: THREE.Vector3, kneeHint: THREE.Vector3): void {
  const b = rig.bones;
  reachLimb(side === 'L' ? b.upperLegL : b.upperLegR, side === 'L' ? b.lowerLegL : b.lowerLegR,
    side === 'L' ? b.footL : b.footR, ankle, kneeHint, new THREE.Vector3(0, 0, 1), 1);
}

const _parentQ = new THREE.Quaternion();

/**
 * Stand a foot on a rest at an orientation: `world` is how the sole should
 * lie, as a world rotation of the canonical foot (which at rest is flat,
 * toes along the body's +Z). Call it after `reachLeg`, which leaves the foot
 * at whatever angle the clip gave the ankle.
 */
export function orientFoot(rig: Rig, side: 'L' | 'R', world: THREE.Quaternion): void {
  const foot = side === 'L' ? rig.bones.footL : rig.bones.footR;
  if (!foot.parent) return;
  foot.parent.updateWorldMatrix(true, false);
  foot.parent.getWorldQuaternion(_parentQ);
  foot.quaternion.copy(_parentQ.invert().multiply(world));
}

/**
 * The two-bone solve itself, for any limb hanging along its parents' -Y.
 * `fallback` is the direction (in the limb root's space) to bow the middle
 * joint when the hint lies on the root-to-target line. `bend` is the way the
 * middle joint hinges about its own X: an elbow folds the forearm forward
 * (-X), a knee folds the shin back (+X). Solving a knee as an elbow still
 * lands the ankle on the rest, but only by rolling the whole leg half a turn
 * about the thigh — which is what spun a rider's feet round backwards.
 */
function reachLimb(upper: THREE.Object3D, fore: THREE.Object3D, hand: THREE.Object3D,
  target: THREE.Vector3, elbowHint: THREE.Vector3, fallback: THREE.Vector3, bend: 1 | -1): void {
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
    // hint on the line: fall back to the limb's own default bow
    _elbow.copy(fallback).addScaledVector(_dir, -fallback.dot(_dir));
    if (_elbow.lengthSq() < 1e-8) return;
  }
  _elbow.normalize();
  _axis.crossVectors(_dir, _elbow).normalize();

  // swing the upper arm off the line, bend the elbow back onto it
  const swing = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const inner = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
  _by.copy(_dir).applyAxisAngle(_axis, swing).negate();   // bone +Y is up the arm
  // the hinge axis faces whichever way makes this joint's own bend fold the
  // limb toward the hint
  _bx.copy(_axis).multiplyScalar(-bend);
  _bz.crossVectors(_bx, _by);
  _basis.makeBasis(_bx, _by, _bz);
  upper.quaternion.setFromRotationMatrix(_basis);
  fore.rotation.set(bend * (Math.PI - inner), 0, 0);
}

const _thigh = new THREE.Vector3();
const _out = new THREE.Vector3();
const _open = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Open (or close) a rider's knees to `knee` metres either side of the centre
 * line, over whatever the clip has the legs doing: a saddle is only so narrow,
 * and a pose that clears one ride's cowl puts the thighs through another's.
 *
 * The width is the ride's, not an angle, so one number serves every rider:
 * each body's own hip width and thigh length decide how far its thighs turn
 * to put the knees there. Each thigh turns out about the axis square to it
 * and to the side, so a leg forward in a seat and a leg down a saddle both
 * swing their knee outward rather than rolling about themselves.
 *
 * Call it after the animator has posed the frame; it turns the thighs it owns.
 */
export function spreadKnees(rig: Rig, knee: number): void {
  const p = rig.proportions;
  const scale = rig.root.scale.x || 1;
  const reach = (knee / scale - p.hipWidth) / p.upperLegLen;
  const want = Math.asin(THREE.MathUtils.clamp(reach, -0.95, 0.95));
  for (const side of ['L', 'R'] as const) {
    const bone = side === 'L' ? rig.bones.upperLegL : rig.bones.upperLegR;
    // +X is the rig's left: each thigh opens toward its own side
    const out = side === 'L' ? 1 : -1;
    _thigh.set(0, -1, 0).applyQuaternion(bone.quaternion);
    const now = Math.asin(THREE.MathUtils.clamp(out * _thigh.x, -1, 1));
    const turn = THREE.MathUtils.clamp(want - now, -Math.PI / 4, Math.PI / 4);
    _out.set(out, 0, 0);
    _open.crossVectors(_thigh, _out);
    if (Math.abs(turn) < 1e-4 || _open.lengthSq() < 1e-6) continue;
    bone.quaternion.premultiply(_q.setFromAxisAngle(_open.normalize(), turn));
  }
}
