import * as THREE from 'three';
import lodData from './data/lod.json';
import { BONES, buildRig, HUMAN, type BoneName, type Proportions, type Rig } from '../anim/skeleton';
import { markShared } from '../core/dispose';
import { generatedClips } from './authored';

/**
 * Low-LOD stand-ins, measured off the authored models.
 *
 * Every procedural body in the game used to be hand-modelled: helmets, robes
 * and rifles built out of primitives to a description of the character. They
 * are gone. What stands in for an authored model now — while its .glb is
 * still downloading, in the workbench's "Procedural" view, on an
 * `authored: false` build — is that same model at a very low level of detail:
 * a few boxes per bone, each around the vertices that bone drives in the
 * sculpt, in the sculpt's own average colour, on a rig with the sculpt's own
 * joint positions. `tools/asset-pipeline/measure-lod.mjs` measures all of it
 * into `data/lod.json`; re-run it whenever a model changes.
 *
 * Three kinds of stand-in come out of it:
 *
 *  - **characters** (`buildLodBody`): a second, hidden-from-gameplay rig built
 *    with the authored skeleton's proportions, posed every frame from the game
 *    rig exactly the way `retarget` poses the authored skin — so the stand-in
 *    moves the way the sculpt will. The game rig itself keeps its canonical
 *    proportions: the clips, seating, ragdoll and hit geometry are all tuned
 *    to those, and none of that should move because a model is still loading.
 *  - **creatures** (`buildLodCreature`): the sculpt's own skeleton, bone for
 *    bone, with the same code-built gait clips generated on it — the stand-in
 *    walks, strikes and idles on the very clips the sculpt will.
 *  - **props** (`buildLodProp`): weapons and vehicles as a few boxes in the
 *    frame `loadProp` fits the sculpt into, so they sit on the same mounts.
 */

type Row = number[];
interface LodChar { h: number; p: number[]; parts: Row[] }
interface LodCreature { nodes: Array<Array<string | number>>; parts: Row[]; eggs?: Row[] }
interface LodProp { parts: Row[] }
const DATA = lodData as unknown as {
  chars: Record<string, LodChar>;
  creatures: Record<string, LodCreature>;
  props: Record<string, LodProp>;
};

/** the order `lod.json` stores a rig's proportions in (the measuring tool writes the same list) */
const PROPORTION_KEYS: (keyof Proportions)[] = ['hipHeight', 'spineLen', 'chestLen', 'neckLen', 'headSize', 'shoulderWidth',
  'upperArmLen', 'forearmLen', 'upperLegLen', 'lowerLegLen', 'hipWidth', 'shoulderRise', 'hipDrop'];

// One unit cube for every box of every stand-in, and one material per colour:
// hundreds of boxes cost one geometry and a palette.
let unitBox: THREE.BoxGeometry | null = null;
const box = (): THREE.BoxGeometry => (unitBox ??= markShared(new THREE.BoxGeometry(1, 1, 1)));
const palette = new Map<number, THREE.MeshStandardMaterial>();
function lodMat(color: number): THREE.MeshStandardMaterial {
  let m = palette.get(color);
  if (!m) {
    m = markShared(new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.15 }));
    palette.set(color, m);
  }
  return m;
}

function addPart(parent: THREE.Object3D, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number,
  color: number, k = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(box(), lodMat(color));
  mesh.position.set(cx * k, cy * k, cz * k);
  mesh.scale.set(sx * k, sy * k, sz * k);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.lod = true;
  parent.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------- characters

/** Is there a measured stand-in for this model id? */
export const hasLodBody = (id: string): boolean => !!DATA.chars[id];

/** The rig the authored skeleton describes, scaled to a fitted height. */
export function lodProportions(id: string, height?: number): Proportions | null {
  const d = DATA.chars[id];
  if (!d) return null;
  const k = height ? height / d.h : 1;
  const p = { ...HUMAN } as Proportions;
  PROPORTION_KEYS.forEach((key, i) => { if (d.p[i] !== undefined) p[key] = d.p[i] * k; });
  return p;
}

export interface LodBody {
  /** the stand-in's own rig, with the authored skeleton's proportions */
  rig: Rig;
  /**
   * Pose the stand-in from the game rig, and carry the game rig's hand,
   * off-hand and jetpack mounts to where the stand-in's are — so a rifle is
   * in the stand-in's fist rather than a hand-width off it. Per frame, while
   * the stand-in is what shows.
   */
  sync: () => void;
  /** Put the game rig's mounts back where they rest: the sculpt is on. */
  release: () => void;
}

/** bones on the game rig that carry things, and so follow the stand-in's hands */
const FOLLOW: BoneName[] = ['weaponR', 'weaponL', 'jetpack'];

/**
 * Hang a character's low-LOD body on `game`: measured from the model `id`,
 * fitted to `height` (the height the authored skin is fitted to). A model
 * with no measurement gets a plain body on the game rig itself.
 */
export function buildLodBody(game: Rig, id: string, height: number): LodBody {
  const d = DATA.chars[id];
  if (!d) return fallbackBody(game);
  const k = height / d.h;
  const p = lodProportions(id, height)!;
  const rig = buildRig(p);
  rig.root.name = 'lodRig';
  // Its bones answer to names of their own: code and checks that look a bone
  // up by name on a character mean the game rig's.
  for (const b of BONES) rig.bones[b].name = `lod_${b}`;
  for (const [bi, cx, cy, cz, sx, sy, sz, color] of d.parts) {
    addPart(rig.bones[BONES[bi]], cx, cy, cz, sx, sy, sz, color, k);
  }
  game.root.add(rig.root);

  const gp = game.proportions;
  // the clips' hip travel is in the game rig's leg lengths; the stand-in's
  // legs are its own, so its hips travel in proportion
  const stride = (p.upperLegLen + p.lowerLegLen) / (gp.upperLegLen + gp.lowerLegLen);
  const rest = FOLLOW.map((b) => game.bones[b].position.clone());
  // Where each mount should ride on the stand-in. A weapon mount is the hand's
  // own offset, on the stand-in's hand — that is what the sculpt's hand mount
  // reproduces. The jetpack mount stays where it is on the body as a whole:
  // the flames were placed against the sculpt's pack from the game rig, and
  // the stand-in's pack is the sculpt's pack, so only the chest it rides on
  // changes — the mount keeps its rest spot relative to that chest.
  const restAt = (o: THREE.Object3D, root: THREE.Object3D): THREE.Vector3 => {
    const v = new THREE.Vector3();
    for (let a: THREE.Object3D | null = o; a && a !== root; a = a.parent) v.add(a.position);
    return v;
  };
  const packSpot = new THREE.Group();
  packSpot.position.copy(restAt(game.bones.jetpack, game.root)).sub(restAt(rig.bones.chest, rig.root));
  rig.bones.chest.add(packSpot);
  const targets: Record<string, THREE.Object3D> = { weaponR: rig.bones.weaponR, weaponL: rig.bones.weaponL, jetpack: packSpot };
  const at = new THREE.Vector3();
  let released = false;
  return {
    rig,
    sync: () => {
      if (released) return;
      for (const b of BONES) rig.bones[b].quaternion.copy(game.bones[b].quaternion);
      const hips = game.bones.hips.position;
      rig.bones.hips.position.set(hips.x * stride, p.hipHeight + (hips.y - gp.hipHeight) * stride, hips.z * stride);
      // Both rigs rest at identity and now hold the same local rotations, so
      // matching bones already agree in orientation: only where they sit
      // differs, and only that is carried across.
      rig.root.updateWorldMatrix(true, true);
      FOLLOW.forEach((b) => {
        const bone = game.bones[b];
        bone.parent!.updateWorldMatrix(true, false);
        targets[b].getWorldPosition(at);
        bone.position.copy(bone.parent!.worldToLocal(at));
      });
    },
    release: () => {
      released = true;
      FOLLOW.forEach((b, i) => game.bones[b].position.copy(rest[i]));
    },
  };
}

/**
 * A character with no measured model: the plain suit the procedural builds
 * used to share, straight on the game rig's bones.
 */
function fallbackBody(game: Rig): LodBody {
  const p = game.proportions;
  const b = game.bones;
  const suit = 0x5a5a5e, dark = 0x3a3a3e;
  const limb = (bone: THREE.Object3D, len: number, w: number): void => { addPart(bone, 0, -len / 2, 0, w, len, w, suit); };
  addPart(b.hips, 0, 0.02, 0, 0.34, 0.2, 0.22, suit);
  addPart(b.spine, 0, (p.chestLen - p.spineLen + 0.05) / 2, 0, 0.34, p.spineLen + p.chestLen - 0.13, 0.235, suit);
  addPart(b.chest, 0, 0.1, 0, 0.4, 0.34, 0.26, dark);
  addPart(b.head, 0, 0.04, 0, 0.22, 0.26, 0.24, dark);
  for (const s of ['L', 'R'] as const) {
    limb(b[`upperArm${s}`], p.upperArmLen, 0.1);
    limb(b[`forearm${s}`], p.forearmLen, 0.09);
    limb(b[`upperLeg${s}`], p.upperLegLen, 0.14);
    limb(b[`lowerLeg${s}`], p.lowerLegLen, 0.11);
    addPart(b[`foot${s}`], 0, -0.035, 0.05, 0.11, 0.07, 0.24, dark);
    addPart(b[`hand${s}`], 0, -0.03, 0, 0.08, 0.1, 0.08, suit);
  }
  return { rig: game, sync: () => {}, release: () => {} };
}

// ---------------------------------------------------------------- creatures

export interface LodCreatureModel {
  /** where the sculpt's holder would be: add it to the same parent */
  holder: THREE.Group;
  /** the stand-in's model root, carrying `userData.clips` like a loaded sculpt */
  model: THREE.Object3D;
  /** the brood's egg spots, `[x, y, z, radius]` in the holder's frame */
  eggs: Row[];
}

/**
 * A creature's stand-in on the sculpt's own skeleton. Shaped like what
 * `loadCreature` hands back — a holder, a model root under it carrying the
 * gait clips in `userData.clips` — so the builder wires it with the same
 * code it wires the sculpt with.
 *
 * The bones are plain groups rather than `THREE.Bone`s (anything counting
 * bones is asking about the sculpt), named as the sculpt's are so the clips
 * bind; `prefix` renames them where a builder looks bones up by name itself.
 */
export function buildLodCreature(id: string, opts: { prefix?: string } = {}): LodCreatureModel | null {
  const d = DATA.creatures[id];
  if (!d) return null;
  const nodes: THREE.Object3D[] = [];
  for (const row of d.nodes) {
    const [name, parent, px, py, pz, qx, qy, qz, qw, sx, sy, sz] = row as [string, number, ...number[]];
    const n = new THREE.Group();
    n.name = name ? `${opts.prefix ?? ''}${name}` : 'lodCreature';
    n.position.set(px, py, pz);
    n.quaternion.set(qx, qy, qz, qw);
    n.scale.set(sx, sy, sz);
    if (parent >= 0) nodes[parent].add(n);
    nodes.push(n);
  }
  const model = nodes[0];
  // the gaits are measured off the bare skeleton, before any box hangs on it —
  // exactly what the sculpt's clips are generated against
  model.updateMatrixWorld(true);
  model.userData.clips = opts.prefix ? [] : generatedClips(id, model);
  for (const [ni, cx, cy, cz, sx, sy, sz, color, qx, qy, qz, qw] of d.parts) {
    const part = addPart(nodes[ni], cx, cy, cz, sx, sy, sz, color);
    // a box fitted in the cloud's own principal axes carries their turn
    if (qw !== undefined) part.quaternion.set(qx, qy, qz, qw);
  }
  const holder = new THREE.Group();
  holder.name = 'lodHolder';
  holder.add(model);
  return { holder, model, eggs: d.eggs ?? [] };
}

/** Find a node of a creature stand-in by its sculpt name (with the prefix it was built with). */
export function lodNode(model: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  model.traverse((o) => { if (!hit && o.name === name) hit = o; });
  return hit;
}

// ---------------------------------------------------------------- props

/** Is there a measured stand-in for this prop id? */
export const hasLodProp = (id: string): boolean => !!DATA.props[id];

/**
 * A weapon or vehicle as a few boxes, in the frame `loadProp` puts the
 * sculpt's root in — so it takes the same mount, and any adjustment a caller
 * makes to the sculpt's root on load can be made to this too.
 */
export function buildLodProp(id: string): THREE.Group | null {
  const d = DATA.props[id];
  if (!d) return null;
  const g = new THREE.Group();
  g.name = 'lodProp';
  for (const [cx, cy, cz, sx, sy, sz, color, qx, qy, qz, qw] of d.parts) {
    const part = addPart(g, cx, cy, cz, sx, sy, sz, color);
    if (qw !== undefined) part.quaternion.set(qx, qy, qz, qw);
  }
  return g;
}
