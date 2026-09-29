import * as THREE from 'three';
import deployedTunes from './data/fistTunes.json';

/**
 * Fists for sculpts whose hands cannot make one.
 *
 * Most humanoid .glb files are Rigify exports whose hands are one bone each
 * (`DEF-hand.L`/`.R`): the fingers are skinned to the palm, so they stay open
 * whatever the arm does, and a punch lands with a flat hand. This gives each
 * such hand three bones it can close with — the fingers at the knuckles, again
 * at their middle joints, and the thumb — on the loaded geometry, the way
 * `jawrig.ts` gives the massiff a jaw, so the files on disk stay as delivered.
 * A sculpt that shipped real finger bones (Boba Fett's Valve biped) is closed
 * by those instead.
 *
 * Nothing is picked offline, and nothing assumes how a hand is turned on its
 * bone: the re-rigged sculpts do not agree. Each hand is measured —
 *  - the fingers run down the hand bone, which every Rigify sculpt lays from
 *    the wrist to the knuckles (a cuff or a relaxed curl makes the vertices'
 *    own longest axis a poor guess at it);
 *  - the palm faces along the axis the hand's cross-section is thinnest on,
 *    toward the side the relaxed fingertips and the thumb lean to;
 *  - the thumb is the edge that sticks out past the finger column.
 * The fingers are the vertices the hand carries past half that length, off the
 * thumb's edge. A hand is the vertices the hand bone carries most of all, not
 * only those it carries more than half of: on some sculpts the wrist shares
 * every hand vertex with the forearm.
 *
 * Some sculpts leave the hand to the forearm's twist bone altogether (Embo,
 * Ventress): the hand bone carries none of it, so neither a wrist nor a finger
 * can move it. Those vertices — past the wrist, carried by the arm — are
 * handed to the hand bone first, blended across the wrist.
 *
 * The first sculpts closed well on the frame every Rigify hand was assumed to
 * share (+Y to the fingertips, the palm on -X for the right hand and +X for
 * the left, the thumb on +Z); those keep it, exactly (`SHARED_FRAME`), and
 * only the rest are measured.
 *
 * At rest the new bones are unturned and the hand looks exactly as it did;
 * `clench` curls them, each about the axis found for it.
 */

/** sculpts whose fists were approved on the shared Rigify hand frame: kept on it */
const SHARED_FRAME: ReadonlySet<string> = new Set([
  'din', 'paz', 'bossk', 'ig11', 'bokatan', 'nikto', 'pirate_melee', 'wookiee_enforcer',
]);

/**
 * A sculpt's fist as tuned in the workbench's Fist section and exported into
 * `data/fistTunes.json`: where the two finger joints sit along the hand (a
 * fraction of its length, wrist to fingertips), how far each joint turns at a
 * full clench (degrees), the fingers' curl tilted about the palm's normal
 * (toward the thumb, or the little finger), and a flip for a palm the
 * measurement put on the wrong side. A sculpt with fingers of its own (`own`)
 * takes the curls, the tilt and the flip; its joints are where it was built.
 */
export interface FistTune {
  knuckleAt: number;
  middleAt: number;
  knuckle: number;
  middle: number;
  thumb: number;
  thumbTwist: number;
  tilt: number;
  flip: boolean;
}
/** fingers this rig added to a one-bone hand, or the ones the sculpt shipped with */
export type FistKind = 'added' | 'own';
const DEFAULTS: Record<FistKind, FistTune> = {
  added: { knuckleAt: 0.5, middleAt: 0.74, knuckle: 85, middle: 95, thumb: 55, thumbTwist: 20, tilt: 0, flip: false },
  own: { knuckleAt: 0.5, middleAt: 0.74, knuckle: 70, middle: 70, thumb: 35, thumbTwist: 0, tilt: 0, flip: false },
};
const deployed = deployedTunes as Record<string, Partial<FistTune>>;
const workbenchTunes = new Map<string, FistTune>();
const kinds = new Map<string, FistKind>();

/** Which fingers a sculpt closes with, once it has been rigged. */
export function fistKind(model: string): FistKind | null { return kinds.get(model) ?? null; }
/** The fist a sculpt closes with before any tune. */
export function fistDefaults(model: string): FistTune { return { ...DEFAULTS[kinds.get(model) ?? 'added'] }; }
/** The deployed tune's values over the defaults: what the game plays. */
export function deployedFistTune(model: string): FistTune { return { ...fistDefaults(model), ...deployed[model] }; }
/** The tune in force: a workbench adjustment, or what is deployed. */
export function fistTune(model: string): FistTune { return workbenchTunes.get(model) ?? deployedFistTune(model); }
/** this page's fist tunes, for the workbench's undo */
export function fistTuneSnapshot(): Array<[string, FistTune]> {
  return [...workbenchTunes].map(([model, tune]) => [model, { ...tune }]);
}
/** Put this page's fist tunes back as a snapshot had them: the models whose tune changed, to refit. */
export function restoreFistTunes(snap: Array<[string, FistTune]>): string[] {
  const touched = new Set([...workbenchTunes.keys(), ...snap.map(([m]) => m)]);
  workbenchTunes.clear();
  for (const [model, tune] of snap) workbenchTunes.set(model, { ...tune });
  return [...touched];
}
/** A workbench adjustment stays in that page; null goes back to the deployed tune. */
export function setWorkbenchFistTune(model: string, tune: FistTune | null): void {
  if (tune) workbenchTunes.set(model, { ...tune }); else workbenchTunes.delete(model);
}

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

/** a hand vertex, with the influences it had before any finger took a share */
interface HandVertex { mesh: number; v: number; p: THREE.Vector3; w: number; orig: Array<[number, number]> }

/**
 * How a fist closes on one bone: about this axis (in its parent's frame), this
 * far at a full clench. Plain numbers, because it rides on the bone's
 * `userData`, which every clone of the model copies as JSON.
 */
interface Curl {
  axis: [number, number, number];
  degrees: number;
  /** which of the tune's curls turns it */
  part?: 'knuckle' | 'middle' | 'thumb';
  /** the palm's normal in the parent's frame, which the tune's tilt turns the fingers' axis about */
  palm?: [number, number, number];
  twist?: { axis: [number, number, number]; degrees: number };
  /** a sculpt's own finger bone curls from its rest pose rather than from none */
  rest?: [number, number, number, number];
  /** the sculpt it was rigged on, so the game knows whose fists it may close (`fists.ts`) */
  model?: string;
}
const arr = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];

/**
 * The hand's own frame, measured: `along` the fingers, `palm` the way the palm
 * faces, `thumb` the way the thumb sticks out; and how long the hand is.
 */
interface HandFrame {
  along: THREE.Vector3; palm: THREE.Vector3; thumb: THREE.Vector3; length: number; from: number;
  /** how sure the measurement is of the palm's side (0 for the shared frame, which is not measured) */
  sure: number;
}

/** eigenvectors of the points' spread, the widest first (Jacobi on the 3×3 covariance) */
function principalAxes(points: THREE.Vector3[]): THREE.Vector3[] {
  const c = centroid(points);
  const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += d[i] * d[j];
  }
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-14) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cos = 1 / Math.sqrt(t * t + 1), sin = t * cos;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = cos * akp - sin * akq; a[k][q] = sin * akp + cos * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = cos * apk - sin * aqk; a[q][k] = sin * apk + cos * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = cos * vkp - sin * vkq; v[k][q] = sin * vkp + cos * vkq;
      }
    }
  }
  return [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]).map((i) => new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize());
}

function centroid(ps: THREE.Vector3[]): THREE.Vector3 {
  return ps.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(Math.max(1, ps.length));
}

/**
 * Measure a hand in its bone's frame. `forearm` is the direction back up the
 * arm from the wrist, which is what tells the fingers' end of the hand from
 * the wrist's.
 */
function measureHand(points: THREE.Vector3[], forearm: THREE.Vector3, side: Side, bone?: THREE.Vector3): HandFrame {
  const along = bone ? bone.clone().normalize() : principalAxes(points)[0].clone();
  if (along.dot(forearm) > 0) along.negate();
  const proj = points.map((p) => p.dot(along)).sort((a, b) => a - b);
  const from = proj[Math.floor(proj.length * 0.02)];
  const length = Math.max(1e-4, proj[Math.floor(proj.length * 0.98)] - from);
  const at = (p: THREE.Vector3): number => (p.dot(along) - from) / length;
  // across the hand and through it: the flat of the hand's cross-section,
  // over the back of the hand where it is flattest
  const flat = points.filter((p) => at(p) > 0.3 && at(p) < 0.7);
  const [mid, thin] = principalAxes((flat.length >= 12 ? flat : points)
    .map((p) => p.clone().addScaledVector(along, -p.dot(along))));
  // Two cues, each only a lean, and they have to agree: a right hand's thumb
  // is along × palm, a left hand's palm × along. The thumb is the side of the
  // width that reaches out past the finger column; the palm the side the
  // relaxed fingertips lean to from the knuckles. The surer one decides both.
  const tips = points.filter((p) => at(p) > 0.82);
  const midHand = points.filter((p) => at(p) > 0.12 && at(p) < 0.5);
  const knuckles = points.filter((p) => at(p) > 0.4 && at(p) < 0.6);
  const span = (ps: THREE.Vector3[], axis: THREE.Vector3): number => {
    const d = ps.map((p) => p.dot(axis));
    return Math.max(1e-6, Math.max(...d) - Math.min(...d));
  };
  const tipW = tips.map((p) => p.dot(mid)), handW = midHand.map((p) => p.dot(mid));
  const over = Math.max(...handW) - Math.max(...tipW);
  const under = Math.min(...tipW) - Math.min(...handW);
  const thumbCue = (over - under) / span(midHand, mid);
  const palmCue = centroid(tips).sub(centroid(knuckles)).dot(thin) / span(knuckles, thin);
  const hand = side === 'R' ? 1 : -1;
  // the thumb a palm on +thin would have, by the hand's handedness
  const chiral = Math.sign(new THREE.Vector3().crossVectors(along, thin).dot(mid)) * hand;
  const vote = palmCue + chiral * thumbCue;
  const palm = vote >= 0 ? thin.clone() : thin.clone().negate();
  const thumb = new THREE.Vector3().crossVectors(along, palm).multiplyScalar(hand);
  return { along, palm, thumb, length, from, sure: Math.abs(vote) };
}

/**
 * The frame the first Rigify sculpts share: fingers +Y from the wrist, palm on
 * -X (right) or +X (left), thumb on +Z; the hand as long as the fingertips the
 * hand carries firmly reach.
 */
function sharedFrame(side: Side, verts: HandVertex[]): HandFrame {
  const ys = verts.filter((h) => h.w > 0.6 && h.p.y > 0).map((h) => h.p.y).sort((a, b) => a - b);
  const length = ys.length ? ys[Math.floor(ys.length * 0.98)] : 0.05;
  return {
    along: new THREE.Vector3(0, 1, 0), palm: new THREE.Vector3(side === 'R' ? -1 : 1, 0, 0),
    thumb: new THREE.Vector3(0, 0, 1), length, from: 0, sure: 0,
  };
}

/**
 * Give the hand bone the hand, where the sculpt left it to the arm: vertices
 * past the wrist (in the hand's own frame) that the hand and the two bones up
 * the arm from it carry, most of all the arm, go to the hand — fully a little
 * way past the wrist, blended across it. A hand the bone already carries is
 * left alone.
 */
function adoptHand(users: THREE.SkinnedMesh[], bones: THREE.Bone[], inverses: THREE.Matrix4[], hand: number): void {
  const up1 = bones.indexOf(bones[hand].parent as THREE.Bone);
  const up2 = up1 >= 0 ? bones.indexOf(bones[up1].parent as THREE.Bone) : -1;
  const arm = new Set([hand, up1, up2].filter((i) => i >= 0));
  const p = new THREE.Vector3();
  const found: Array<{ mesh: THREE.SkinnedMesh; v: number; y: number }> = [];
  let carried = 0;
  for (const mesh of users) {
    const toHand = inverses[hand].clone().multiply(mesh.bindMatrix);
    const pos = mesh.geometry.attributes.position, idx = mesh.geometry.attributes.skinIndex, wt = mesh.geometry.attributes.skinWeight;
    for (let v = 0; v < pos.count; v++) {
      let best = -1, bw = 0, handW = 0;
      for (let k = 0; k < idx.itemSize; k++) {
        const w = wt.getComponent(v, k), b = idx.getComponent(v, k);
        if (w > bw) { bw = w; best = b; }
        if (b === hand) handW += w;
      }
      if (!arm.has(best)) continue;
      p.fromBufferAttribute(pos, v).applyMatrix4(toHand);
      if (p.y <= 0) continue;
      if (handW >= 0.5) carried++;
      found.push({ mesh, v, y: p.y });
    }
  }
  // the hand already moves with its bone: nothing to adopt
  if (found.length < 20 || carried > found.length * 0.3) return;
  const ys = found.map((f) => f.y).sort((a, b) => a - b);
  const reach = ys[Math.floor(ys.length * 0.98)];
  for (const { mesh, v, y } of found) {
    const share = smooth(0, reach * 0.15, y);
    const idx = mesh.geometry.attributes.skinIndex as THREE.BufferAttribute;
    const wt = mesh.geometry.attributes.skinWeight as THREE.BufferAttribute;
    // the arm's weight, `share` of it moved onto the hand
    const pairs = new Map<number, number>();
    for (let k = 0; k < idx.itemSize; k++) {
      const w = wt.getComponent(v, k), b = idx.getComponent(v, k);
      if (w <= 0) continue;
      if (arm.has(b) && b !== hand) {
        pairs.set(b, (pairs.get(b) ?? 0) + w * (1 - share));
        pairs.set(hand, (pairs.get(hand) ?? 0) + w * share);
      } else pairs.set(b, (pairs.get(b) ?? 0) + w);
    }
    const top = [...pairs].filter(([, w]) => w > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, idx.itemSize);
    const sum = top.reduce((a, [, w]) => a + w, 0) || 1;
    for (let k = 0; k < idx.itemSize; k++) {
      idx.setComponent(v, k, top[k]?.[0] ?? 0);
      wt.setComponent(v, k, top[k] ? top[k][1] / sum : 0);
    }
  }
}

/** the direction back up the arm from a bone's origin, in its own frame */
function towardParent(bone: THREE.Object3D): THREE.Vector3 {
  const back = bone.position.clone().negate().applyQuaternion(bone.quaternion.clone().invert());
  return back.lengthSq() > 1e-10 ? back.normalize() : new THREE.Vector3(0, -1, 0);
}

/**
 * Add the finger bones to a freshly loaded humanoid, or read the ones it came
 * with. Idempotent, and a no-op for anything without hands to close.
 */
export function applyFistRig(root: THREE.Object3D, model = ''): void {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && m.geometry.attributes.skinIndex) meshes.push(m);
  });
  const skeletons = new Map<THREE.Skeleton, THREE.SkinnedMesh[]>();
  for (const m of meshes) skeletons.set(m.skeleton, [...(skeletons.get(m.skeleton) ?? []), m]);

  for (const [skeleton, users] of skeletons) {
    if (skeleton.bones.some((b) => b.userData.fistCurl)) continue;   // already rigged
    if (rigOwnFingers(skeleton, users, model)) continue;
    const bones = skeleton.bones.slice();
    const inverses = skeleton.boneInverses.map((m) => m.clone());
    const remaps: FittedHand[] = [];
    if (model) kinds.set(model, 'added');
    const tune = fistTune(model);

    const hands: Array<{ side: Side; hand: number; verts: HandVertex[]; frame: HandFrame }> = [];
    for (const side of SIDES) {
      const hand = bones.findIndex((b) => norm(b.name) === `DEF-hand${side}`);
      if (hand < 0) continue;
      adoptHand(users, bones, inverses, hand);
      // the hand's vertices in its own bind frame: those it carries most of all
      const verts: HandVertex[] = [];
      users.forEach((mesh, mi) => {
        const toHand = inverses[hand].clone().multiply(mesh.bindMatrix);
        const pos = mesh.geometry.attributes.position;
        const idx = mesh.geometry.attributes.skinIndex;
        const wt = mesh.geometry.attributes.skinWeight;
        for (let v = 0; v < pos.count; v++) {
          let w = 0, other = 0;
          for (let k = 0; k < idx.itemSize; k++) {
            const x = wt.getComponent(v, k);
            if (idx.getComponent(v, k) === hand) w += x; else other = Math.max(other, x);
          }
          if (w < 0.25 || w < other) continue;
          const orig: Array<[number, number]> = [];
          for (let k = 0; k < idx.itemSize; k++) orig.push([idx.getComponent(v, k), wt.getComponent(v, k)]);
          verts.push({ mesh: mi, v, p: new THREE.Vector3().fromBufferAttribute(pos, v).applyMatrix4(toHand), w, orig });
        }
      });
      if (verts.length < 20) continue;
      const frame = SHARED_FRAME.has(model)
        ? sharedFrame(side, verts)
        : measureHand(verts.map((h) => h.p), towardParent(bones[hand]), side, new THREE.Vector3(0, 1, 0));
      hands.push({ side, hand, verts, frame });
    }
    // A sculpt's hands are mirror images (a Rigify left hand's frame is its
    // right's with X flipped), so a hand the cues barely decide goes the way
    // its surer twin does.
    if (hands.length === 2 && hands.every((h) => h.frame.sure > 0)) {
      const flip = (v: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(-v.x, v.y, v.z);
      const [a, b] = hands;
      const pooled = a.frame.palm.clone().multiplyScalar(a.frame.sure).addScaledVector(flip(b.frame.palm), b.frame.sure);
      for (const h of hands) {
        const want = h === a ? pooled : flip(pooled);
        if (h.frame.palm.dot(want) < 0) { h.frame.palm.negate(); h.frame.thumb.negate(); }
      }
    }
    for (const { side, hand, verts, frame } of hands) {
      const at = (p: THREE.Vector3): number => (p.dot(frame.along) - frame.from) / frame.length;
      const tips = verts.filter((h) => at(h.p) > 0.82).map((h) => h.p.dot(frame.thumb));
      const edge = Math.max(...tips) + (Math.max(...tips) - Math.min(...tips)) * 0.15;
      const bandAt = (u: number): THREE.Vector3 => {
        const band = verts.filter((h) => Math.abs(at(h.p) - u) < 0.06).map((h) => h.p);
        return band.length ? centroid(band) : frame.along.clone().multiplyScalar(frame.from + u * frame.length);
      };
      const thumbRoot = verts.filter((h) => h.p.dot(frame.thumb) > edge && at(h.p) > 0.12 && at(h.p) < 0.32).map((h) => h.p);
      const base = bandAt(0.22);
      const pos = {
        knuckle: bandAt(tune.knuckleAt), middle: bandAt(tune.middleAt),
        thumb: thumbRoot.length ? centroid(thumbRoot) : base.addScaledVector(frame.thumb, edge - base.dot(frame.thumb)),
      };
      // the fingers curl toward the palm, about the axis square to both
      const curlAxis = new THREE.Vector3().crossVectors(frame.along, frame.palm).normalize();
      // the thumb swings about the hand's length, across in front of the palm
      const thumbSign = Math.sign(new THREE.Vector3().crossVectors(frame.along, frame.thumb).dot(frame.palm)) || 1;
      const add = (name: string, parent: number, offset: THREE.Vector3, fromHand: THREE.Vector3, curl: Curl): number => {
        const bone = new THREE.Bone();
        bone.name = name;
        bone.position.copy(offset);
        bone.userData.fistCurl = { ...curl, model };
        bones[parent].add(bone);
        bones.push(bone);
        // bind-pose world of the new bone: the hand's, walked down its offset
        inverses.push(new THREE.Matrix4().makeTranslation(-fromHand.x, -fromHand.y, -fromHand.z).multiply(inverses[hand]));
        return bones.length - 1;
      };
      const palm = arr(frame.palm);
      const knuckle = add(boneName(side, 'knuckle'), hand, pos.knuckle, pos.knuckle,
        { axis: arr(curlAxis), degrees: DEFAULTS.added.knuckle, part: 'knuckle', palm });
      const middle = add(boneName(side, 'middle'), knuckle, pos.middle.clone().sub(pos.knuckle), pos.middle,
        { axis: arr(curlAxis), degrees: DEFAULTS.added.middle, part: 'middle', palm });
      const thumb = add(boneName(side, 'thumb'), hand, pos.thumb, pos.thumb, {
        axis: arr(frame.along.clone().multiplyScalar(thumbSign)), degrees: DEFAULTS.added.thumb, part: 'thumb',
        twist: { axis: arr(curlAxis), degrees: DEFAULTS.added.thumbTwist },
      });
      remaps.push({ side, hand, knuckle, middle, thumb, verts, frame, thumbEdge: edge, bandAt });
    }
    if (!remaps.length) continue;

    for (const fitted of remaps) weigh(fitted, users, tune);
    const next = new THREE.Skeleton(bones, inverses);
    for (const mesh of users) mesh.bind(next, mesh.bindMatrix);
    settle(users);
    // kept, so the workbench can move the joints and weigh the skin again
    if (model) fits.set(model, [...(fits.get(model) ?? []), { users, bones, inverses, hands: remaps }]);
  }
}

/** one hand's added fingers: the bones, the vertices they share, and how to find a point along it */
interface FittedHand {
  side: Side; hand: number; knuckle: number; middle: number; thumb: number;
  verts: HandVertex[]; frame: HandFrame; thumbEdge: number;
  bandAt: (u: number) => THREE.Vector3;
}
interface FittedRig { users: THREE.SkinnedMesh[]; bones: THREE.Bone[]; inverses: THREE.Matrix4[]; hands: FittedHand[] }
/** each sculpt's added fingers, on the file's own template that every copy shares */
const fits = new Map<string, FittedRig[]>();

/**
 * Hand the finger vertices over, blended across each joint so the skin folds
 * rather than tears: from the influences they had before, so it can be done
 * again with the joints somewhere else.
 */
function weigh(h: FittedHand, users: THREE.SkinnedMesh[], tune: FistTune): void {
  const { frame } = h;
  for (const vert of h.verts) {
    const mesh = users[vert.mesh];
    const idx = mesh.geometry.attributes.skinIndex as THREE.BufferAttribute;
    const wt = mesh.geometry.attributes.skinWeight as THREE.BufferAttribute;
    vert.orig.forEach(([b, w], k) => { idx.setComponent(vert.v, k, b); wt.setComponent(vert.v, k, w); });
    const u = (vert.p.dot(frame.along) - frame.from) / frame.length;
    const give: Array<[number, number]> = [];
    if (vert.p.dot(frame.thumb) > h.thumbEdge) {
      const t = smooth(0.14, 0.3, u);
      if (t > 0) give.push([h.thumb, t]);
    } else {
      const f1 = smooth(tune.knuckleAt - 0.06, tune.knuckleAt + 0.06, u);
      const f2 = smooth(tune.middleAt - 0.05, tune.middleAt + 0.05, u);
      if (f1 * (1 - f2) > 0) give.push([h.knuckle, f1 * (1 - f2)]);
      if (f1 * f2 > 0) give.push([h.middle, f1 * f2]);
    }
    if (give.length) reweigh(mesh, vert.v, h.hand, give);
  }
}

/** push new weights to the GPU and into the skin-fix baseline */
function settle(users: THREE.SkinnedMesh[]): void {
  for (const mesh of users) {
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

/**
 * Each hand's frame as the fist rig measured it (in the hand bone's own
 * space): along the fingers, toward the palm, where the hand starts and how
 * long it is — what a placed palm is read against (the workbench's Follow the
 * palm). Empty for a sculpt with fingers of its own.
 */
export function fistFrames(model: string): Array<{
  side: Side; hand: string; along: THREE.Vector3; palm: THREE.Vector3; from: number; length: number;
}> {
  return (fits.get(model) ?? []).flatMap((rig) => rig.hands.map((h) => ({
    side: h.side, hand: rig.bones[h.hand].name, along: h.frame.along.clone(), palm: h.frame.palm.clone(),
    from: h.frame.from, length: h.frame.length,
  })));
}

/**
 * Move a sculpt's added finger joints to where its tune now puts them, and
 * weigh the skin to them again: on the file's template, whose bind matrices
 * and skin every copy shares, and on each of `roots`' own copies of the bones.
 * A sculpt with its own fingers has nothing to move.
 */
export function refitFists(model: string, roots: THREE.Object3D[]): void {
  const tune = fistTune(model);
  const seats = new Map<string, THREE.Vector3>();
  for (const rig of fits.get(model) ?? []) {
    for (const h of rig.hands) {
      const knuckle = h.bandAt(tune.knuckleAt), middle = h.bandAt(tune.middleAt);
      rig.inverses[h.knuckle].makeTranslation(-knuckle.x, -knuckle.y, -knuckle.z).multiply(rig.inverses[h.hand]);
      rig.inverses[h.middle].makeTranslation(-middle.x, -middle.y, -middle.z).multiply(rig.inverses[h.hand]);
      const offsets = { knuckle, middle: middle.clone().sub(knuckle) };
      rig.bones[h.knuckle].position.copy(offsets.knuckle);
      rig.bones[h.middle].position.copy(offsets.middle);
      seats.set(boneName(h.side, 'knuckle'), offsets.knuckle);
      seats.set(boneName(h.side, 'middle'), offsets.middle);
      weigh(h, rig.users, tune);
    }
    settle(rig.users);
  }
  for (const root of roots) root.traverse((o) => { const at = seats.get(o.name); if (at) o.position.copy(at); });
}

/**
 * A sculpt with real fingers (a Valve biped: `…_R_Finger1`, `…_R_Finger11`,
 * `…_R_Finger12` down each finger, `Finger0*` the thumb): each joint curls
 * toward the palm about the axis square to its own bone and the palm, the palm
 * measured off the vertices the hand and its fingers carry. True if it had any.
 */
function rigOwnFingers(skeleton: THREE.Skeleton, users: THREE.SkinnedMesh[], model: string): boolean {
  const fingers = skeleton.bones.filter((b) => /_[LR]_Finger\d+(_\d+)?$/.test(b.name));
  if (!fingers.length) return false;
  if (model) kinds.set(model, 'own');
  for (const side of SIDES) {
    const hand = skeleton.bones.find((b) => new RegExp(`_${side}_Hand(_\\d+)?$`).test(b.name));
    const mine = fingers.filter((b) => b.name.includes(`_${side}_Finger`));
    if (!hand || !mine.length) continue;
    const handIndex = skeleton.bones.indexOf(hand);
    const carried = new Set([handIndex, ...mine.map((b) => skeleton.bones.indexOf(b))]);
    const points: THREE.Vector3[] = [];
    for (const mesh of users) {
      const toHand = skeleton.boneInverses[handIndex].clone().multiply(mesh.bindMatrix);
      const pos = mesh.geometry.attributes.position, idx = mesh.geometry.attributes.skinIndex, wt = mesh.geometry.attributes.skinWeight;
      for (let v = 0; v < pos.count; v++) {
        let w = 0;
        for (let k = 0; k < idx.itemSize; k++) if (carried.has(idx.getComponent(v, k))) w += wt.getComponent(v, k);
        if (w > 0.5) points.push(new THREE.Vector3().fromBufferAttribute(pos, v).applyMatrix4(toHand));
      }
    }
    if (points.length < 20) continue;
    const frame = measureHand(points, towardParent(hand), side);
    for (const bone of mine) {
      // the palm, in the finger bone's own frame at rest
      const toBone = new THREE.Quaternion();
      for (let b: THREE.Object3D | null = bone; b && b !== hand; b = b.parent) toBone.premultiply(b.quaternion);
      const palm = frame.palm.clone().applyQuaternion(toBone.invert());
      // the way the bone runs: to its child, or on from its parent for a fingertip
      const child = bone.children.find((c) => (c as THREE.Bone).isBone);
      const run = (child ? child.position.clone() : bone.position.clone().applyQuaternion(bone.quaternion.clone().invert())).normalize();
      const axis = new THREE.Vector3().crossVectors(run, palm);
      if (axis.lengthSq() < 1e-8) continue;
      const thumb = /_Finger0\d*(_\d+)?$/.test(bone.name);
      // a finger's first bone turns at the knuckle; the ones past it (Finger11, Finger12) are its middle
      const part = thumb ? 'thumb' : /_Finger\d(_\d+)?$/.test(bone.name) ? 'knuckle' : 'middle';
      bone.userData.fistCurl = {
        axis: arr(axis.normalize()), degrees: thumb ? DEFAULTS.own.thumb : DEFAULTS.own.knuckle, part, palm: arr(palm),
        rest: bone.quaternion.toArray() as [number, number, number, number], model,
      } satisfies Curl;
    }
  }
  return true;
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

const _q = new THREE.Quaternion();
const _twist = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _palm = new THREE.Vector3();

/**
 * Close a model's hands: 0 open (as sculpted), 1 a fist. Each finger joint
 * turns about the axis measured for it, toward the palm.
 */
export function clench(root: THREE.Object3D, right: number, left = right): void {
  let found = found_.get(root);
  if (!found) {
    found = collect(root);
    // a sculpt still on the wire has no fingers yet: look again next time
    if (!found.length) return;
    found_.set(root, found);
  }
  const tune = fistTune((found[0].bone.userData.fistCurl as Curl).model ?? '');
  const flip = tune.flip ? -1 : 1;
  for (const { bone, side } of found) {
    const curl = bone.userData.fistCurl as Curl;
    const d = THREE.MathUtils.DEG2RAD * (side === 'R' ? right : left) * flip;
    _axis.fromArray(curl.axis);
    if (tune.tilt && curl.palm && curl.part !== 'thumb') _axis.applyAxisAngle(_palm.fromArray(curl.palm), tune.tilt * THREE.MathUtils.DEG2RAD);
    _q.setFromAxisAngle(_axis, (curl.part ? tune[curl.part] : curl.degrees) * d);
    if (curl.twist) {
      const twist = curl.part === 'thumb' ? tune.thumbTwist : curl.twist.degrees;
      _q.multiply(_twist.setFromAxisAngle(_axis.fromArray(curl.twist.axis), twist * d));
    }
    if (curl.rest) bone.quaternion.fromArray(curl.rest).multiply(_q);
    else bone.quaternion.copy(_q);
  }
}

/**
 * The sculpt a character's fists were rigged on (`applyFistRig`'s `model`), or
 * null while it has none — no fingers yet, or a model with no hands to close.
 */
export function fistModel(root: THREE.Object3D): string | null {
  let found = found_.get(root);
  if (!found) {
    found = collect(root);
    if (!found.length) return null;
    found_.set(root, found);
  }
  return (found[0].bone.userData.fistCurl as Curl).model ?? null;
}

/** each model's finger bones and which hand they close, found once (not on `userData`, which a clone copies as JSON) */
const found_ = new WeakMap<THREE.Object3D, Array<{ bone: THREE.Object3D; side: Side }>>();

function collect(root: THREE.Object3D): Array<{ bone: THREE.Object3D; side: Side }> {
  const out: Array<{ bone: THREE.Object3D; side: Side }> = [];
  root.traverse((o) => {
    if (!o.userData.fistCurl) return;
    const side: Side = o.name.startsWith('fist_') ? (o.name.endsWith('R') ? 'R' : 'L') : /_R_/.test(o.name) ? 'R' : 'L';
    out.push({ bone: o, side });
  });
  return out;
}
