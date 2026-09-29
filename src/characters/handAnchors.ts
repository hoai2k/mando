import * as THREE from 'three';
import type { Rig } from '../anim/skeleton';
import data from './data/handAnchors.json';

/**
 * Where each character's palm is, on its own hand: placed by eye in the
 * workbench (Weapon grips → Hand anchors) and exported to
 * `data/handAnchors.json`.
 *
 * A palm is a point in metres from the sculpt's own wrist, along the axes our
 * rig's hand has at rest (the fingers down its -Y), carried by the sculpt's
 * hand bone (`palmFrameL`/`palmFrameR`, beside the weapon mounts in
 * `authored.ts`). It rides with the hand as it is drawn, so one placement
 * holds in every pose. (It used to live on the rig's own hand, which the
 * sculpt's is only turned to match: the sculpt's hand sits a different
 * distance from it in each pose, 10 cm between two for Cad Bane.) A build with
 * no sculpt keeps it on the rig's hand. Left out, it is the rig's weapon
 * point.
 *
 * A ride's grip is where the palm goes (`PalmReach`).
 */

export type HandSide = 'L' | 'R';
type V3 = [number, number, number];
interface HandPair { left?: V3; right?: V3 }

/** the rig's weapon point, from the wrist: a palm until one is placed, and the palm frames' origin */
export const DEFAULT_PALM: Readonly<V3> = [0, -0.05, 0.02];

const deployed = data as unknown as Record<string, HandPair>;
const workbench = new Map<string, HandPair>();
const key = (side: HandSide): keyof HandPair => (side === 'L' ? 'left' : 'right');

/** A character's palm, from its wrist: the workbench's, the file's, or the rig's weapon point. */
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

/** the sculpt's palm frame on one hand, or null for a build with no sculpt (yet) */
export function palmFrameOf(root: THREE.Object3D, side: HandSide): THREE.Object3D | null {
  return root.getObjectByName(`palmFrame${side}`) ?? null;
}

/** Where the palm is in the world: on the sculpt's hand, or the rig's for a build without one. */
export function palmWorld(root: THREE.Object3D, rig: Rig, id: string, side: HandSide, out: THREE.Vector3): THREE.Vector3 {
  const frame = palmFrameOf(root, side);
  const q = palmOf(id, side);
  if (!frame) return (side === 'L' ? rig.bones.handL : rig.bones.handR).localToWorld(out.copy(q));
  frame.updateWorldMatrix(true, false);
  return frame.localToWorld(out.copy(q).sub(_def.set(...DEFAULT_PALM)));
}
const _def = new THREE.Vector3();

/**
 * Puts a rider's palm on a grip. The arm is solved on our rig and the sculpt
 * is only turned to match it, so where its palm lands is known only once it
 * has been drawn — and it is no fixed point of the rig's hand: a longer or
 * shorter sculpt arm puts it somewhere else for every bend of the elbow. So
 * this steers: the wrist is aimed at the grip plus a correction, and each
 * frame the correction moves by however far the drawn palm missed. A riding
 * pose barely changes frame to frame, so within a few it lands.
 *
 * It starts from where the palm sits from the wrist as drawn now, which is
 * close. A build with no sculpt has its palm on the rig's own hand, which is
 * exact, and steers by that alone.
 */
export class PalmReach {
  /** the wrist's aim less the grip, in the character's own frame */
  private corr = new Map<HandSide, THREE.Vector3>();
  /** the grip last aimed at, in the character's own frame */
  private aimed = new Map<HandSide, THREE.Vector3>();
  constructor(private root: THREE.Object3D, private rig: Rig, private id: string) {}

  /** Where to aim the wrist so the palm lands on `grip` (world), into `out`. */
  aim(side: HandSide, grip: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const hand = side === 'L' ? this.rig.bones.handL : this.rig.bones.handR;
    this.root.updateWorldMatrix(true, false);
    const at = this.root.worldToLocal(_g.copy(grip));
    const palm = this.root.worldToLocal(palmWorld(this.root, this.rig, this.id, side, _p));
    const wrist = this.root.worldToLocal(hand.getWorldPosition(_w));
    let c = this.corr.get(side);
    const last = this.aimed.get(side);
    if (!palmFrameOf(this.root, side) || !c) {
      // the palm from the wrist as it stands: exact on the rig's own hand, a start on a sculpt's
      c = (c ?? new THREE.Vector3()).copy(wrist).sub(palm);
      this.corr.set(side, c);
    } else if (last) {
      // the drawn palm missed the grip it was aimed at by this much: aim that much further
      c.add(_e.copy(last).sub(palm));
      if (c.length() > 0.4) c.setLength(0.4);
    }
    this.aimed.set(side, (last ?? new THREE.Vector3()).copy(at));
    return this.root.localToWorld(out.copy(at).add(c));
  }
}
const _g = new THREE.Vector3();
const _p = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Vector3();

const reaches = new WeakMap<Rig, PalmReach>();
/** the palm-reach for one character's rig, made once */
export function palmReach(root: THREE.Object3D, rig: Rig, id: string): PalmReach {
  let r = reaches.get(rig);
  if (!r) { r = new PalmReach(root, rig, id); reaches.set(rig, r); }
  return r;
}
