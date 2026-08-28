import * as THREE from 'three';
import { buildRig, HUMAN, type Proportions, type Rig } from '../anim/skeleton';
import { buildClips } from '../anim/clips';
import { Animator } from '../anim/animator';
import { loadProp } from './authored';

/**
 * Procedural character construction: meshes are parented to rig bones so any
 * clip that animates bones animates the character. Replacing a character with
 * an authored glTF = swap the meshes, keep the bone names (see skeleton.ts).
 */

export interface CharacterInstance {
  root: THREE.Group;
  rig: Rig | null;
  animator: Animator | null;
  /** per-frame cosmetic update (cape, flames, custom rigs) */
  cosmetic?: (dt: number, time: number) => void;
  /** world-space muzzle reference for shots */
  muzzle?: THREE.Object3D;
  height: number;
}

const materials = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: number, opts: { rough?: number; metal?: number; emissive?: number; flat?: boolean } = {}): THREE.MeshStandardMaterial {
  const key = `${color}:${opts.rough ?? 0.85}:${opts.metal ?? 0.1}:${opts.emissive ?? 0}:${opts.flat ? 1 : 0}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0.1,
      flatShading: opts.flat ?? false,
    });
    if (opts.emissive) m.emissive = new THREE.Color(opts.emissive);
    materials.set(key, m);
  }
  return m;
}

export function addBox(parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number,
  x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export function addCyl(parent: THREE.Object3D, m: THREE.Material, rTop: number, rBot: number, h: number,
  x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 10): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export function addSphere(parent: THREE.Object3D, m: THREE.Material, r: number,
  x = 0, y = 0, z = 0, wSeg = 12, hSeg = 10, scaleY = 1, scaleZ = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, wSeg, hSeg), m);
  mesh.position.set(x, y, z);
  mesh.scale.set(1, scaleY, scaleZ);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Cylinder hanging down from a bone: the standard limb segment. */
export function limbMesh(bone: THREE.Object3D, m: THREE.Material, len: number, r0: number, r1: number): THREE.Mesh {
  return addCyl(bone, m, r0, r1, len, 0, -len / 2, 0, 0, 0, 0, 8);
}

export interface BipedOptions {
  proportions?: Proportions;
  skin: THREE.Material;        // limbs / body suit
  torso: THREE.Material;       // chest
  scale?: number;
}

/** Base biped: rig + suit limbs + torso. Species detail goes on top. */
export function buildBiped(opts: BipedOptions): { inst: CharacterInstance; rig: Rig } {
  const p = opts.proportions ?? HUMAN;
  const rig = buildRig(p);
  const clips = buildClips(p);
  const animator = new Animator(rig, clips);
  const b = rig.bones;

  addBox(b.hips, opts.skin, 0.34, 0.2, 0.22, 0, 0.02, 0);
  // Abdomen on the spine bone. Without it the hips and chest boxes leave a
  // hole at the waist (~0.28 m on HUMAN proportions) that reads as a missing
  // midsection on anyone without a robe or long coat to hide it. Derived from
  // the proportions so it still closes for the taller/shorter species.
  const absHeight = p.spineLen + p.chestLen - 0.13;
  const absCentre = (p.chestLen - p.spineLen + 0.05) / 2;
  addBox(b.spine, opts.skin, 0.34, absHeight, 0.235, 0, absCentre, 0);
  addBox(b.chest, opts.torso, 0.4, 0.34, 0.26, 0, 0.1, 0);
  limbMesh(b.upperArmL, opts.skin, p.upperArmLen, 0.055, 0.05);
  limbMesh(b.forearmL, opts.skin, p.forearmLen, 0.05, 0.042);
  limbMesh(b.upperArmR, opts.skin, p.upperArmLen, 0.055, 0.05);
  limbMesh(b.forearmR, opts.skin, p.forearmLen, 0.05, 0.042);
  limbMesh(b.upperLegL, opts.skin, p.upperLegLen, 0.075, 0.06);
  limbMesh(b.lowerLegL, opts.skin, p.upperLegLen, 0.06, 0.05);
  limbMesh(b.upperLegR, opts.skin, p.upperLegLen, 0.075, 0.06);
  limbMesh(b.lowerLegR, opts.skin, p.lowerLegLen, 0.06, 0.05);
  addBox(b.footL, opts.skin, 0.11, 0.07, 0.24, 0, -0.035, 0.05);
  addBox(b.footR, opts.skin, 0.11, 0.07, 0.24, 0, -0.035, 0.05);
  addSphere(b.handL, opts.skin, 0.05, 0, -0.02, 0, 8, 6);
  addSphere(b.handR, opts.skin, 0.05, 0, -0.02, 0, 8, 6);

  if (opts.scale && opts.scale !== 1) rig.root.scale.setScalar(opts.scale);

  const inst: CharacterInstance = {
    root: rig.root, rig, animator, height: rig.height * (opts.scale ?? 1),
  };
  return { inst, rig };
}

/** Simple verlet-ish cape: chain of segments trailing from capeRoot. */
export function attachCape(rig: Rig, m: THREE.Material, width = 0.42, segs = 5, segLen = 0.24): (dt: number, time: number) => void {
  const nodes: THREE.Object3D[] = [];
  let parent: THREE.Object3D = rig.bones.capeRoot;
  for (let i = 0; i < segs; i++) {
    const g = new THREE.Group();
    g.position.y = i === 0 ? 0 : -segLen;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width * (1 + i * 0.1), segLen, 0.02), m);
    mesh.position.y = -segLen / 2;
    mesh.castShadow = true;
    g.add(mesh);
    parent.add(g);
    nodes.push(g);
    parent = g;
  }
  const swing: number[] = new Array(segs).fill(0);
  const vel: number[] = new Array(segs).fill(0);
  return (dt: number, time: number) => {
    // pseudo-physics: each segment springs toward hanging + wind ripple
    for (let i = 0; i < segs; i++) {
      const target = Math.sin(time * 2.2 + i * 0.9) * 0.06;
      const k = 26 - i * 3;
      vel[i] += (target - swing[i]) * k * dt;
      vel[i] *= Math.exp(-4 * dt);
      swing[i] += vel[i] * dt;
      nodes[i].rotation.x = swing[i] + (i === 0 ? 0.12 : 0.03);
    }
  };
}

/** Impulse the cape when the character accelerates (called by controller). */
/**
 * Weapons follow the same rule as characters: the procedural shape is the
 * fallback, and an authored model replaces it the moment the file is there.
 * They hang off the same group, so the mount, the muzzle and every clip that
 * swings them are untouched by the swap.
 */
function swapWeapon(g: THREE.Group, id: string, length: number, orientX = 0): void {
  const prop = loadProp(id, length, {
    axis: 'longest',
    onLoad: () => { for (const c of [...g.children]) if ((c as THREE.Mesh).isMesh) c.visible = false; },
  });
  // The sculpts lie along their longest axis, which is Z; a procedural weapon
  // built along Y needs the model turned to match before anything that holds it
  // will hold it the same way.
  prop.rotation.x = orientX;
  g.add(prop);
}

export function makeGaffi(m1: THREE.Material, m2: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  addCyl(g, m1, 0.02, 0.024, 1.35, 0, 0, 0, 0, 0, 0, 8); // shaft
  addCyl(g, m2, 0.005, 0.05, 0.22, 0, 0.78, 0, 0, 0, 0, 8); // spearhead
  addSphere(g, m2, 0.055, 0, 0.62, 0, 8, 6, 1.4, 1); // club knot
  addCyl(g, m2, 0.05, 0.02, 0.16, 0, -0.72, 0, Math.PI * 0.5, 0, 0, 6); // bottom blade
  swapWeapon(g, 'gaffi', 1.5, -Math.PI / 2);
  return g;
}

export function makeCarbine(mBody: THREE.Material, mDark: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  addBox(g, mBody, 0.05, 0.09, 0.42, 0, 0, 0.1);            // receiver
  addCyl(g, mDark, 0.016, 0.016, 0.34, 0, 0.015, 0.42, Math.PI / 2, 0, 0, 8); // barrel
  addCyl(g, mDark, 0.03, 0.03, 0.06, 0, 0.015, 0.6, Math.PI / 2, 0, 0, 8);    // muzzle
  addBox(g, mDark, 0.03, 0.12, 0.05, 0, -0.08, 0.02, 0.3);  // grip
  addBox(g, mDark, 0.03, 0.05, 0.2, 0, 0.07, 0.12);         // scope
  swapWeapon(g, 'carbine', 0.72);
  return g;
}
