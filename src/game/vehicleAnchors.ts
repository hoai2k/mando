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
 *    the bars, the yoke or the reins. A machine mirrors it across the seat for
 *    the right hand; a mount leaves the right hand to the gun.
 *
 * A ride with no entry keeps the defaults in `VEHICLE_DEFS` and the measured
 * seat, which is how every ride worked before these existed.
 */
export type V3 = [number, number, number];
export interface VehicleAnchor { seat: V3; grip: V3 }

/**
 * The Nikto's swoop is not a pilotable ride but its own build (the bike and
 * its rider in one): this is where the rider's root sits in the bike's space,
 * position in metres and rotation in degrees, when it has been placed by hand.
 */
export interface NiktoRiderAnchor { position: V3; rotation: V3 }

interface AnchorFile {
  version: number;
  vehicles: Partial<Record<VehicleSpec['kind'], VehicleAnchor>>;
  niktoRider: NiktoRiderAnchor | null;
}

const file = data as AnchorFile;

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
