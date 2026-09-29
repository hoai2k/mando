/**
 * Workbench overlay: the geometric joint audit (tools/asset-pipeline/geo-joints.mjs,
 * docs/audits/geo-joints.md) drawn on the authored figures, following the pose.
 *
 *   green  where the mesh's volume puts each limb joint
 *   blue   where the skin-weight seam puts it (the rig audit), when known
 *   red    the rig's own joint (the bone's head), live
 *
 * plus, optionally, the volume-based stand-in: capsules along the geometric
 * centre lines sized by the section profile, and elliptic slabs for the torso.
 *
 * Everything is measured in the bind pose, so each marker and stand-in piece
 * is re-expressed in the frame of the bone it belongs to (its bind-pose world
 * matrix, from a separate un-posed copy of the same file) and hung on that
 * bone — it then moves with the figure through every clip.
 */
import * as THREE from 'three';
import { loadAuthored } from '../characters/authored';
import type { BoneName } from '../anim/skeleton';
import overlayData from './data/geoOverlay.json';

type V3 = [number, number, number];
interface Seg { part: string; a: V3; b: V3; r0: number; r1: number; e0?: number; e1?: number; flat?: boolean }
interface ModelData { height: number; joints: Record<string, { est: V3; seam: V3 | null; conf: number }>; standIn: Seg[] }
const DATA = (overlayData as unknown as { models: Record<string, ModelData> }).models;

const JOINT_BONE: Record<string, string> = {
  shoulder: 'upperArm', elbow: 'forearm', wrist: 'hand', hip: 'upperLeg', knee: 'lowerLeg', ankle: 'foot',
};
const PART_BONE: Record<string, string> = {
  upperArm: 'upperArm', forearm: 'forearm', hand: 'hand', thigh: 'upperLeg', shin: 'lowerLeg', foot: 'foot',
};
const SPINE: BoneName[] = ['hips', 'spine', 'chest', 'neck', 'head'];

export const GEO_COLORS = { geo: 0x30ff60, seam: 0x3aa0ff, rig: 0xff3030 };

interface Attached { groups: THREE.Object3D[]; standIn: boolean; pending: boolean }
const attached = new WeakMap<THREE.Object3D, Attached>();

/** is there a geometric audit for this character? */
export const hasGeoAudit = (charId: string): boolean => !!DATA[charId];

/**
 * Keep the overlay on (or off) each figure. Cheap to call every frame: it
 * attaches once the figure's authored model has landed, and removes itself
 * when switched off.
 */
export function syncGeoOverlay(figures: Array<{ inst: { root: THREE.Object3D }; waitingFor: string | null }>,
  charId: string, on: boolean, standIn: boolean): void {
  for (const f of figures) {
    const root = f.inst.root;
    const cur = attached.get(root);
    if (cur && (!on || cur.standIn !== standIn)) {
      for (const g of cur.groups) g.removeFromParent();
      attached.delete(root);
    }
    if (!on || attached.has(root) || !f.waitingFor || !DATA[charId]) continue;
    // wait for the authored (skinned) model to be on the figure
    let has = false;
    root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) has = true; });
    if (!has) continue;
    const entry: Attached = { groups: [], standIn, pending: true };
    attached.set(root, entry);
    // the file this figure is (the original, or a re-rigged copy of it)
    const modelFile = f.waitingFor.split('/').pop()!.replace(/\.glb$/, '');
    void attach(root, DATA[charId], modelFile, standIn).then((groups) => {
      // switched off (or rebuilt) while loading: drop what was made
      if (attached.get(root) !== entry) { for (const g of groups) g.removeFromParent(); return; }
      entry.groups = groups;
      entry.pending = false;
    });
  }
}

async function attach(root: THREE.Object3D, data: ModelData, modelFile: string, withStandIn: boolean): Promise<THREE.Object3D[]> {
  const bind = await loadAuthored(modelFile, data.height);
  if (!bind) return [];
  const frame = new THREE.Group();
  frame.add(bind.root);
  frame.updateMatrixWorld(true);
  const byCanon = new Map<string, THREE.Object3D>();
  for (const n of bind.nodes) if (n.canonical) byCanon.set(n.canonical, n.obj);
  // the figure's bone of the same name, and the bind-pose world matrix to express things against
  const figBones = new Map<string, THREE.Object3D>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone && o.name) figBones.set(o.name, o); });
  const target = (canon: string): { bone: THREE.Object3D; inv: THREE.Matrix4 } | null => {
    const b = byCanon.get(canon);
    const fb = b ? figBones.get(b.name) : undefined;
    return b && fb ? { bone: fb, inv: b.matrixWorld.clone().invert() } : null;
  };
  const groups: THREE.Object3D[] = [];
  const hang = (canon: string, obj: THREE.Object3D, bindWorld: THREE.Matrix4): void => {
    const t = target(canon);
    if (!t) return;
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(t.inv).multiply(bindWorld);
    t.bone.add(obj);
    groups.push(obj);
  };
  const dot = (color: number, r: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }));
    m.renderOrder = 20;
    return m;
  };
  for (const [key, j] of Object.entries(data.joints)) {
    const [name, side] = key.split('.');
    const canon = `${JOINT_BONE[name]}${side}`;
    hang(canon, dot(GEO_COLORS.geo, 0.012 * (0.6 + 0.4 * j.conf)), new THREE.Matrix4().makeTranslation(...j.est));
    if (j.seam) hang(canon, dot(GEO_COLORS.seam, 0.009), new THREE.Matrix4().makeTranslation(...j.seam));
    // the rig's joint: the bone's own head
    const b = byCanon.get(canon);
    if (b) hang(canon, dot(GEO_COLORS.rig, 0.010), b.matrixWorld.clone());
  }
  if (withStandIn) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, roughness: 0.8, transparent: true, opacity: 0.7 });
    const spineY = SPINE.map((c) => [c, byCanon.get(c)?.getWorldPosition(new THREE.Vector3()).y ?? Infinity] as const);
    for (const s of data.standIn) {
      const a = new THREE.Vector3(...s.a), b = new THREE.Vector3(...s.b);
      const len = Math.max(1e-3, a.distanceTo(b));
      const piece = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(s.r1, s.r0, len, 16), mat);
      piece.add(body);
      if (s.flat) {
        body.scale.set(1, 1, ((s.e0 ?? 1) + (s.e1 ?? 1)) / 2);
      } else {
        for (const [y, r] of [[-len / 2, s.r0], [len / 2, s.r1]] as const) {
          const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
          cap.position.y = y;
          piece.add(cap);
        }
      }
      const q = s.flat ? new THREE.Quaternion() : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      const world = new THREE.Matrix4().compose(a.clone().lerp(b, 0.5), q, new THREE.Vector3(1, 1, 1));
      let canon: string;
      if (s.part === 'torso') {
        // the spine bone at or below the slab
        const mid = (s.a[1] + s.b[1]) / 2;
        canon = spineY.filter(([, y]) => y <= mid).pop()?.[0] ?? 'hips';
      } else {
        const [part, side] = s.part.split('.');
        canon = `${PART_BONE[part]}${side}`;
      }
      hang(canon, piece, world);
    }
  }
  return groups;
}
