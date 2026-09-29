import * as THREE from 'three';
import data from './data/handAnchors.json';

/**
 * Where each character's palm is, in its own hand: a point in the canonical
 * hand bone's frame (`handL`/`handR` on the rig, the wrist at the origin, the
 * hand hanging down its -Y), placed by eye in the workbench (Weapon grips →
 * Hand anchors) on the model as it is drawn, and exported to
 * `data/handAnchors.json`. Left out, a hand's palm is where the rig holds a
 * weapon (`weaponL`/`weaponR`).
 *
 * The rides' grips were placed with Din in the saddle, so a grip anchor is
 * where *his* wrist goes. Anyone else is put so that their palm lands where
 * his does: their wrist goes to the grip shifted by the difference between
 * his palm and theirs, in the hand's own frame (`palmShift`). Din himself is
 * unmoved by any edit of his palms, so the grips stay where they were tuned —
 * which is why he is set up first, and everyone else against him.
 */

export type HandSide = 'L' | 'R';
type V3 = [number, number, number];
interface HandPair { left?: V3; right?: V3 }

/** the rig's weapon point: where a hand holds a grip, until a palm is placed */
export const DEFAULT_PALM: Readonly<V3> = [0, -0.05, 0.02];
/** whose hands the rides' grips were placed with */
export const EXAMPLE_RIDER = 'din';

const deployed = data as unknown as Record<string, HandPair>;
const workbench = new Map<string, HandPair>();
const key = (side: HandSide): keyof HandPair => (side === 'L' ? 'left' : 'right');

/** A character's palm, in its hand bone's frame: the workbench's, the file's, or the rig's weapon point. */
export function palmOf(id: string, side: HandSide): THREE.Vector3 {
  const v = workbench.get(id)?.[key(side)] ?? deployed[id]?.[key(side)] ?? DEFAULT_PALM;
  return new THREE.Vector3(...v);
}
/** the deployed palm, before any workbench edit */
export function deployedPalm(id: string, side: HandSide): THREE.Vector3 {
  return new THREE.Vector3(...(deployed[id]?.[key(side)] ?? DEFAULT_PALM));
}

/** A workbench placement stays in that page (null puts the deployed one back). */
export function setWorkbenchPalm(id: string, side: HandSide, at: THREE.Vector3 | null): void {
  const pair = { ...workbench.get(id) };
  if (at) pair[key(side)] = at.toArray().map((n) => +n.toFixed(4)) as V3;
  else delete pair[key(side)];
  if (pair.left || pair.right) workbench.set(id, pair); else workbench.delete(id);
}

/** this page's palm placements, for the workbench's undo */
export function palmSnapshot(): Array<[string, HandPair]> {
  return [...workbench].map(([id, pair]) => [id, { ...pair }]);
}
/** Put this page's palm placements back as a snapshot had them. */
export function restorePalms(snap: Array<[string, HandPair]>): void {
  workbench.clear();
  for (const [id, pair] of snap) workbench.set(id, { ...pair });
}

/** every character whose palms were placed in this page, both hands as they stand, for the export */
export function editedPalms(): Record<string, { left: V3; right: V3 }> {
  const out: Record<string, { left: V3; right: V3 }> = {};
  for (const id of workbench.keys()) {
    out[id] = { left: palmOf(id, 'L').toArray() as V3, right: palmOf(id, 'R').toArray() as V3 };
  }
  return out;
}

/** the file to drop in as `data/handAnchors.json`: what is committed, with this page's placements over it */
export function handAnchorsJson(): string {
  return `${JSON.stringify({ ...deployed, ...editedPalms() }, null, 2)}\n`;
}

/**
 * How far `id`'s wrist goes from a grip placed for Din's, in the hand's own
 * frame: his palm less theirs, so their palm lands where his would. Zero for
 * him, and for anyone whose palms are where his are.
 */
export function palmShift(id: string, side: HandSide, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(palmOf(EXAMPLE_RIDER, side)).sub(palmOf(id, side));
}
