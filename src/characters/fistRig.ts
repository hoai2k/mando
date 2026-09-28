import * as THREE from 'three';

/**
 * Fingers for sculpts delivered without them.
 *
 * The humanoid .glb files are Rigify exports whose hands are one bone each
 * (`DEF-hand.L`/`.R`): the fingers are skinned to the palm, so they stay open
 * whatever the arm does, and a punch lands with a flat hand. This gives each
 * hand three bones it can close with — the fingers at the knuckles, again at
 * their middle joints, and the thumb — on the loaded geometry, the way
 * `jawrig.ts` gives the massiff a jaw, so the files on disk stay as delivered.
 *
 * Nothing is picked offline. Every Rigify hand shares one frame — +Y from the
 * wrist to the fingertips, the palm across Z with the thumb on its +Z edge,
 * the palm's face on -X for the right hand and +X for the left — so the
 * fingers are found by where they sit in it: the vertices the hand bone
 * carries, past half the hand's length, off the thumb's edge.
 *
 * At rest the new bones are unturned and the hand looks exactly as it did;
 * `clench` curls them.
 */

const SIDES = ['R', 'L'] as const;
type Side = (typeof SIDES)[number];
/** the loader flattens dots out of node names: `DEF-hand.R` arrives as `DEF-handR` */
const norm = (n: string): string => n.replace(/[.\s:[\]]/g, '');
const smooth = (a: number, b: number, x: number): number => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** a finger bone's name: the knuckle, the middle joint, the thumb */
const boneName = (side: Side, part: 'knuckle' | 'middle' | 'thumb'): string => `fist_${part}${side}`;

interface HandVertex { mesh: number; v: number; p: THREE.Vector3; w: number }

/**
 * Add the finger bones to a freshly loaded humanoid. Idempotent, and a no-op
 * for anything without Rigify hands.
 */
export function applyFistRig(root: THREE.Object3D): void {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && m.geometry.attributes.skinIndex) meshes.push(m);
  });
  const skeletons = new Map<THREE.Skeleton, THREE.SkinnedMesh[]>();
  for (const m of meshes) skeletons.set(m.skeleton, [...(skeletons.get(m.skeleton) ?? []), m]);

  for (const [skeleton, users] of skeletons) {
    if (skeleton.bones.some((b) => b.name.startsWith('fist_'))) continue;   // already rigged
    const bones = skeleton.bones.slice();
    const inverses = skeleton.boneInverses.map((m) => m.clone());
    const remaps: Array<{ side: Side; hand: number; knuckle: number; middle: number; thumb: number; verts: HandVertex[];
      length: number; thumbEdge: number }> = [];

    for (const side of SIDES) {
      const hand = bones.findIndex((b) => norm(b.name) === `DEF-hand${side}`);
      if (hand < 0) continue;
      // the hand's vertices in its own bind frame
      const verts: HandVertex[] = [];
      users.forEach((mesh, mi) => {
        const toHand = inverses[hand].clone().multiply(mesh.bindMatrix);
        const pos = mesh.geometry.attributes.position;
        const idx = mesh.geometry.attributes.skinIndex;
        const wt = mesh.geometry.attributes.skinWeight;
        for (let v = 0; v < pos.count; v++) {
          let w = 0;
          for (let k = 0; k < idx.itemSize; k++) if (idx.getComponent(v, k) === hand) w += wt.getComponent(v, k);
          if (w < 0.05) continue;
          verts.push({ mesh: mi, v, p: new THREE.Vector3().fromBufferAttribute(pos, v).applyMatrix4(toHand), w });
        }
      });
      const firm = verts.filter((h) => h.w > 0.6 && h.p.y > 0).map((h) => h.p.y).sort((a, b) => a - b);
      if (firm.length < 20) continue;
      const length = firm[Math.floor(firm.length * 0.98)];
      // the fingers' edge on the thumb's side, from the fingertips
      const tips = verts.filter((h) => h.p.y > length * 0.82);
      const zs = tips.map((h) => h.p.z);
      const thumbEdge = Math.max(...zs) + (Math.max(...zs) - Math.min(...zs)) * 0.15;
      const bandX = (y: number): number => {
        const band = verts.filter((h) => h.w > 0.6 && Math.abs(h.p.y - y) < length * 0.05);
        return band.length ? band.reduce((s, h) => s + h.p.x, 0) / band.length : 0;
      };
      const thumbRoot = verts.filter((h) => h.p.z > thumbEdge && h.p.y > length * 0.12 && h.p.y < length * 0.32);
      const at = {
        knuckle: new THREE.Vector3(bandX(length * 0.5), length * 0.5, 0),
        middle: new THREE.Vector3(bandX(length * 0.74), length * 0.74, 0),
        thumb: thumbRoot.length
          ? thumbRoot.reduce((s, h) => s.add(h.p), new THREE.Vector3()).divideScalar(thumbRoot.length)
          : new THREE.Vector3(0, length * 0.22, thumbEdge),
      };
      // the bones: the middle joint hangs off the knuckle, the rest off the hand
      const add = (name: string, parent: number, offset: THREE.Vector3, fromHand: THREE.Vector3): number => {
        const bone = new THREE.Bone();
        bone.name = name;
        bone.position.copy(offset);
        bones[parent].add(bone);
        bones.push(bone);
        // bind-pose world of the new bone: the hand's, walked down its offset
        inverses.push(new THREE.Matrix4().makeTranslation(-fromHand.x, -fromHand.y, -fromHand.z).multiply(inverses[hand]));
        return bones.length - 1;
      };
      const knuckle = add(boneName(side, 'knuckle'), hand, at.knuckle, at.knuckle);
      const middle = add(boneName(side, 'middle'), knuckle, at.middle.clone().sub(at.knuckle), at.middle);
      const thumb = add(boneName(side, 'thumb'), hand, at.thumb, at.thumb);
      remaps.push({ side, hand, knuckle, middle, thumb, verts, length, thumbEdge });
    }
    if (!remaps.length) continue;

    // hand the finger vertices over, blended across each joint so the skin
    // folds rather than tears
    for (const { hand, knuckle, middle, thumb, verts, length: L, thumbEdge } of remaps) {
      for (const h of verts) {
        const { y, z } = h.p;
        const give: Array<[number, number]> = [];
        if (z > thumbEdge) {
          const t = smooth(L * 0.14, L * 0.3, y);
          if (t > 0) give.push([thumb, t]);
        } else {
          const f1 = smooth(L * 0.44, L * 0.56, y);
          const f2 = smooth(L * 0.69, L * 0.79, y);
          if (f1 * (1 - f2) > 0) give.push([knuckle, f1 * (1 - f2)]);
          if (f1 * f2 > 0) give.push([middle, f1 * f2]);
        }
        if (give.length) reweigh(users[h.mesh], h.v, hand, give);
      }
    }
    const next = new THREE.Skeleton(bones, inverses);
    for (const mesh of users) {
      mesh.bind(next, mesh.bindMatrix);
      const geo = mesh.geometry;
      geo.attributes.skinIndex.needsUpdate = true;
      geo.attributes.skinWeight.needsUpdate = true;
      // `skinfix` restores this snapshot when its fixes are toggled: the
      // fingers belong in the baseline, as the jaw does
      const snapshot = geo.userData.skinOriginal as { index: THREE.TypedArray; weight: THREE.TypedArray } | undefined;
      if (snapshot) {
        snapshot.index.set(geo.attributes.skinIndex.array as THREE.TypedArray);
        snapshot.weight.set(geo.attributes.skinWeight.array as THREE.TypedArray);
      }
    }
  }
}

/** Move shares of a vertex's hand weight onto finger bones, keeping its four strongest influences. */
function reweigh(mesh: THREE.SkinnedMesh, v: number, hand: number, give: Array<[number, number]>): void {
  const idx = mesh.geometry.attributes.skinIndex as THREE.BufferAttribute;
  const wt = mesh.geometry.attributes.skinWeight as THREE.BufferAttribute;
  const n = idx.itemSize;
  const pairs = new Map<number, number>();
  for (let k = 0; k < n; k++) {
    const w = wt.getComponent(v, k);
    if (w > 0) pairs.set(idx.getComponent(v, k), (pairs.get(idx.getComponent(v, k)) ?? 0) + w);
  }
  const h = pairs.get(hand) ?? 0;
  let taken = 0;
  for (const [bone, share] of give) { pairs.set(bone, h * share); taken += share; }
  pairs.set(hand, h * Math.max(0, 1 - taken));
  const top = [...pairs].filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, n);
  const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
  for (let k = 0; k < n; k++) {
    idx.setComponent(v, k, top[k]?.[0] ?? 0);
    wt.setComponent(v, k, top[k] ? top[k][1] / sum : 0);
  }
}

/** how far each joint turns at a full clench, degrees */
const CURL = { knuckle: 85, middle: 95, thumb: 55 };

/**
 * Close a model's hands: 0 open (as sculpted), 1 a fist. The fingers fold
 * toward the palm's face about the hand's Z; the thumb swings across in
 * front of them about the hand's own length.
 */
export function clench(root: THREE.Object3D, right: number, left = right): void {
  let found = found_.get(root);
  if (!found) {
    found = collect(root);
    // a sculpt still on the wire has no fingers yet: look again next time
    if (!Object.keys(found).length) return;
    found_.set(root, found);
  }
  for (const side of SIDES) {
    const amount = side === 'R' ? right : left;
    // the palm faces -X on the right hand and +X on the left
    const s = side === 'R' ? 1 : -1;
    const d = THREE.MathUtils.DEG2RAD * amount;
    found[boneName(side, 'knuckle')]?.rotation.set(0, 0, s * CURL.knuckle * d);
    found[boneName(side, 'middle')]?.rotation.set(0, 0, s * CURL.middle * d);
    found[boneName(side, 'thumb')]?.rotation.set(0, -s * CURL.thumb * d, s * 20 * d);
  }
}

/** each model's finger bones, found once (not on `userData`, which a clone copies as JSON) */
const found_ = new WeakMap<THREE.Object3D, Record<string, THREE.Object3D>>();

function collect(root: THREE.Object3D): Record<string, THREE.Object3D> {
  const out: Record<string, THREE.Object3D> = {};
  root.traverse((o) => { if (o.name.startsWith('fist_')) out[o.name] = o; });
  return out;
}
