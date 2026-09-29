import * as THREE from 'three';
import data from './data/vehicleAnchors.json';
import type { VehicleSpec } from '../world/board';

/**
 * Hand-placed anchors for sitting on things, exported from the model
 * workbench's vehicle subjects (Weapon grips → vehicle anchors) into
 * `data/vehicleAnchors.json`.
 *
 * Each ride has two, in its own space — metres from the keel, +X to the
 * rider's left, +Z forward, the same frame `VEHICLE_DEFS` measures in:
 *
 *  - `seat`: the point on the saddle, cushion or deck the rider sits (or
 *    stands) on. When it is set it wins over the height measured off the
 *    sculpt (`seatSurface`), which can only guess at where a body belongs.
 *  - `grip`: where the left hand — the one that never holds the gun — takes
 *    the bars, the yoke or the reins. A machine mirrors it across the rider's
 *    own midline for the right hand (`handFromSeat`), side by side on a grip
 *    placed on it; a mount leaves the right hand to the gun. A rider leans
 *    forward to a grip past arm's reach (`leanToReach`).
 *  - `legSpread`, optional: how far each knee sits out from the centre line,
 *    in metres, so the thighs clear the saddle or the cowl. A width rather
 *    than an angle, so every rider's own hips and thighs work out how far to
 *    open (`spreadKnees`); left out, the riding clip's own legs stand.
 *  - `foot`, optional: where the left foot rests — a footrest, a peg — with
 *    the right mirrored across the seat as the hands are. The leg reaches it
 *    (`reachLeg`), its knee bowed forward and out by `legSpread`.
 *  - `yaw`, optional: the rider turned on the seat, in degrees, for a ride
 *    whose helm is not dead ahead of where its pilot stands.
 *  - `modelYaw`, optional: the ride's sculpt turned on its keel, in degrees,
 *    for one delivered a little off square. Anchors are placed after it.
 *  - `seatRotation`, `gripRotation`, `footRotation`, optional: each anchor
 *    turned, in degrees about X, Y, Z (applied Y first), in the ride's frame.
 *    The seat's Y is the rider's turn (`yaw`, which the export keeps in step);
 *    its X and Z tilt the rider in the workbench only. The foot's is how the
 *    sole lies on its rest — 0, 0, 0 flat with the toes forward, the right
 *    foot mirrored — and the game stands the feet so. The grip's is not used
 *    yet: a note of how the bars lie.
 *
 * A ride with no entry keeps the defaults in `VEHICLE_DEFS` and the measured
 * seat, which is how every ride worked before these existed.
 */
export type V3 = [number, number, number];
export interface VehicleAnchor {
  seat: V3; grip: V3; legSpread?: number; foot?: V3; yaw?: number; modelYaw?: number;
  seatRotation?: V3; gripRotation?: V3; footRotation?: V3;
}

const _euler = new THREE.Euler();
/**
 * A foot anchor's rotation as the world rotation of the sole, for side 1 (the
 * rider's left) or -1 (mirrored across the seat), given the ride frame's own
 * world rotation.
 */
export function footQuaternion(frame: THREE.Quaternion, degrees: V3, side: 1 | -1, out: THREE.Quaternion): THREE.Quaternion {
  const d = THREE.MathUtils.DEG2RAD;
  _euler.set(degrees[0] * d, side * degrees[1] * d, side * degrees[2] * d, 'YXZ');
  return out.copy(frame).multiply(new THREE.Quaternion().setFromEuler(_euler));
}

/** the least a pair of hands sits either side of the rider's midline: side by side on one tiller */
export const HAND_HALF_SPREAD = 0.1;

/**
 * Where a hand goes from the seat, in the ride's frame. The grip is the left
 * hand's; the right hand mirrors it across the rider's own midline — the seat
 * turned by `yaw` (radians), so a rider turned toward a helm keeps his hands
 * symmetric about himself, not about the ride. A pair never closes on one
 * point: a grip on the midline puts the hands side by side on it,
 * `HAND_HALF_SPREAD` either way. A lone rein hand (`pair` false) goes where
 * the grip is.
 */
export function handFromSeat(grip: { x: number; y: number; z: number }, side: 1 | -1, yaw: number, pair: boolean,
  out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // into the rider's frame, where +X is his left
  const lx = grip.x * c - grip.z * s, lz = grip.x * s + grip.z * c;
  const across = side * (pair ? Math.max(lx, HAND_HALF_SPREAD) : lx);
  return out.set(across * c + lz * s, grip.y, -across * s + lz * c);
}

/** a foot anchor is the sole on the rest; the ankle the leg reaches for stands this far over it (m) */
export const ANKLE_OVER_SOLE = 0.08;

/**
 * The Nikto's swoop is not a pilotable ride but its own build (the bike and
 * its rider in one): this is where the rider's root sits in the bike's space,
 * position in metres and rotation in degrees, when it has been placed by hand,
 * and his knees' spread (as `VehicleAnchor.legSpread`; the swoop's when unset).
 */
export interface NiktoRiderAnchor { position: V3; rotation: V3; legSpread?: number }

interface AnchorFile {
  version: number;
  vehicles: Partial<Record<VehicleSpec['kind'], VehicleAnchor>>;
  niktoRider: NiktoRiderAnchor | null;
}

// a JSON import types its arrays as number[], not the three-tuples they are
const file = data as unknown as AnchorFile;

export const VEHICLE_ANCHORS: Partial<Record<VehicleSpec['kind'], VehicleAnchor>> = file.vehicles;
export const NIKTO_RIDER: NiktoRiderAnchor | null = file.niktoRider;

/**
 * How far a rider's root (the feet, on the canonical rig) sits below the
 * surface it is carried on, for a body whose hips stand `hipHeight` over its
 * feet. A straddled saddle takes the weight on the thighs and carries the hips
 * a hand's width proud of it; a seat takes it on the backside, so the hips sit
 * almost on the cushion; a deck takes the feet.
 *
 * Measured off the rider rather than fixed: a fixed rise sits a tall fighter
 * down into the saddle and floats a short one over it. For the canonical
 * 0.95 m hips it gives exactly the old constants (0.85 and 0.93).
 */
export function stanceRise(stance: 'saddle' | 'seated' | 'stand', hipHeight: number): number {
  return stance === 'stand' ? 0 : hipHeight - (stance === 'saddle' ? 0.1 : 0.02);
}

/** the canonical rig's hip height, for a rider whose own is not known */
export const CANONICAL_HIPS = 0.95;

/** how high a character's hips stand over its feet, from its rig */
export function hipsOverFeet(char: {
  rig: { proportions: { hipHeight: number }; root: { scale: { y: number } } } | null;
}): number {
  const rig = char.rig;
  return rig ? rig.proportions.hipHeight * rig.root.scale.y : CANONICAL_HIPS;
}
