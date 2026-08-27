import * as THREE from 'three';
import { HUMAN, type Proportions } from '../anim/skeleton';
import { addBox, addCyl, addSphere, buildBiped, makeGaffi, mat, type CharacterInstance } from './builder';

/** Enemy character builders — show-inspired silhouettes, procedural meshes on the canonical rig. */

function rifle(parent: THREE.Object3D): THREE.Object3D {
  const dark = mat(0x2a2a2a, { rough: 0.5, metal: 0.5 });
  const g = new THREE.Group();
  addBox(g, dark, 0.045, 0.07, 0.4, 0, 0, 0.08);
  addCyl(g, dark, 0.014, 0.014, 0.3, 0, 0.01, 0.36, Math.PI / 2, 0, 0, 6);
  g.rotation.x = Math.PI / 2;
  parent.add(g);
  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0.01, 0.52);
  g.add(muzzle);
  return muzzle;
}

// ---------- Tusken Raider: sand robes, eye-stalk mask, gaderffii ----------
export function buildTusken(): CharacterInstance {
  const robe = mat(0xb8a37e, { rough: 1 });
  const wrap = mat(0x8f7c58, { rough: 1 });
  const { inst, rig } = buildBiped({ skin: robe, torso: robe });
  const b = rig.bones;
  // robe skirt + hood
  addCyl(b.hips, wrap, 0.24, 0.3, 0.5, 0, -0.22, 0, 0, 0, 0, 10);
  addCyl(b.chest, wrap, 0.2, 0.24, 0.3, 0, 0.08, 0, 0, 0, 0, 10);
  // bandolier
  addBox(b.chest, mat(0x5a4632, { rough: 0.9 }), 0.09, 0.4, 0.28, 0, 0.06, 0, 0, 0, 0.6);
  // head: wrapped mask, low-profile eye stalks, rebreather spikes
  const head = b.head;
  addSphere(head, wrap, 0.14, 0, 0.05, 0, 10, 8, 1.05, 1);
  const dark = mat(0x1e1a14, { rough: 0.7 });
  addCyl(head, dark, 0.028, 0.032, 0.06, -0.06, 0.07, 0.12, Math.PI / 2, 0, 0, 6);
  addCyl(head, dark, 0.028, 0.032, 0.06, 0.06, 0.07, 0.12, Math.PI / 2, 0, 0, 6);
  addCyl(head, dark, 0.012, 0.02, 0.09, 0, -0.01, 0.13, Math.PI / 2, 0, 0, 6);
  for (const sx of [-0.045, 0.045]) addCyl(head, dark, 0.006, 0.012, 0.06, sx, -0.04, 0.12, Math.PI / 2, 0, 0, 5);
  // gaderffii in right hand
  const gaffi = makeGaffi(mat(0x6b4c2c, { rough: 0.95 }), mat(0x8a8f92, { rough: 0.4, metal: 0.6 }));
  gaffi.rotation.x = Math.PI / 2;
  b.weaponR.add(gaffi);
  return inst;
}

// ---------- Pyke soldier: tall tapered helmet, slate coat, rifle ----------
const PYKE_P: Proportions = { ...HUMAN, hipHeight: 0.9, headSize: 0.34, shoulderWidth: 0.22 };
export function buildPyke(): CharacterInstance {
  const coat = mat(0x4e5d63, { rough: 0.85 });
  const suit = mat(0x39434a, { rough: 0.9 });
  const { inst, rig } = buildBiped({ skin: suit, torso: coat, proportions: PYKE_P });
  const b = rig.bones;
  addCyl(b.hips, coat, 0.23, 0.27, 0.45, 0, -0.2, 0, 0, 0, 0, 10); // long coat
  // signature tall tapered head/helmet
  const helm = mat(0x8b9483, { rough: 0.6, metal: 0.2 });
  const dark = mat(0x14161a, { rough: 0.6 });
  addCyl(b.head, helm, 0.045, 0.115, 0.34, 0, 0.16, 0, 0, 0, 0, 10);
  addSphere(b.head, helm, 0.115, 0, 0.0, 0.01, 10, 8, 0.9, 1.05);
  addSphere(b.head, dark, 0.028, -0.055, 0.02, 0.095, 6, 5);
  addSphere(b.head, dark, 0.028, 0.055, 0.02, 0.095, 6, 5);
  // breather tubes to chest
  addCyl(b.chest, dark, 0.014, 0.014, 0.3, -0.07, 0.16, 0.12, 0.5, 0, 0.2, 5);
  addCyl(b.chest, dark, 0.014, 0.014, 0.3, 0.07, 0.16, 0.12, 0.5, 0, -0.2, 5);
  inst.muzzle = rifle(b.weaponR);
  return inst;
}

// ---------- Space pirate: rough leathers, pauldron, rifle or fists ----------
export function buildPirate(melee: boolean): CharacterInstance {
  const leather = mat(0x5c4632, { rough: 0.95 });
  const shirt = mat(0x6e6250, { rough: 0.95 });
  const { inst, rig } = buildBiped({ skin: shirt, torso: leather, scale: 1.05 });
  const b = rig.bones;
  addBox(b.shoulderL, mat(0x71716d, { rough: 0.5, metal: 0.5 }), 0.18, 0.08, 0.2, -0.05, 0.05, 0, 0, 0, 0.3);
  // leathery alien head with head-tail nubs / horns
  const skinM = mat(0x9c7050, { rough: 0.9 });
  addSphere(b.head, skinM, 0.13, 0, 0.04, 0, 10, 8, 1.1, 1);
  const dark = mat(0x241d16, { rough: 0.8 });
  addSphere(b.head, dark, 0.02, -0.05, 0.06, 0.11, 5, 4);
  addSphere(b.head, dark, 0.02, 0.05, 0.06, 0.11, 5, 4);
  for (let i = 0; i < 4; i++) addCyl(b.head, skinM, 0.01, 0.025, 0.09, -0.06 + i * 0.04, 0.16, -0.04, -0.5, 0, 0, 5);
  if (melee) {
    const club = new THREE.Group();
    addCyl(club, dark, 0.025, 0.03, 0.7);
    addBox(club, mat(0x555a5e, { rough: 0.4, metal: 0.6 }), 0.1, 0.14, 0.1, 0, 0.38, 0);
    club.rotation.x = Math.PI / 2;
    b.weaponR.add(club);
  } else {
    inst.muzzle = rifle(b.weaponR);
  }
  return inst;
}

// ---------- Security droid: bone-white skeletal frame ----------
const DROID_P: Proportions = { ...HUMAN, hipHeight: 1.05, headSize: 0.3, shoulderWidth: 0.24, upperLegLen: 0.52, lowerLegLen: 0.52 };
export function buildDroid(): CharacterInstance {
  const bone = mat(0xcfc8b8, { rough: 0.5, metal: 0.35 });
  const dark = mat(0x2c2c2c, { rough: 0.6, metal: 0.4 });
  const { inst, rig } = buildBiped({ skin: bone, torso: dark, proportions: DROID_P });
  const b = rig.bones;
  addBox(b.chest, bone, 0.34, 0.3, 0.2, 0, 0.08, 0); // boxy chassis
  addCyl(b.chest, bone, 0.03, 0.03, 0.2, 0, 0.02, 0.14, Math.PI / 2, 0, 0, 6);
  // elongated droid skull with glowing eyes
  addCyl(b.head, bone, 0.06, 0.1, 0.28, 0, 0.08, 0.03, 0.35, 0, 0, 8);
  const eye = mat(0xff3820, { emissive: 0xff3820, rough: 0.4 });
  addSphere(b.head, eye, 0.022, -0.045, 0.1, 0.1, 6, 5);
  addSphere(b.head, eye, 0.022, 0.045, 0.1, 0.1, 6, 5);
  inst.muzzle = rifle(b.weaponR);
  return inst;
}

// ---------- Nikto swoop rider: bike + seated rider, moved as one unit ----------
export function buildNikto(): CharacterInstance {
  const group = new THREE.Group();
  // swoop bike
  const bikeBody = mat(0x8a4b2f, { rough: 0.5, metal: 0.5 });
  const dark = mat(0x2a2a2a, { rough: 0.6, metal: 0.4 });
  const bike = new THREE.Group();
  addBox(bike, bikeBody, 0.34, 0.24, 1.7, 0, 0, 0.1);
  addCyl(bike, dark, 0.1, 0.14, 0.35, 0, 0, -0.8, Math.PI / 2, 0, 0, 8);   // engine
  addCyl(bike, bikeBody, 0.05, 0.09, 0.7, 0, -0.02, 1.15, Math.PI / 2, 0, 0, 8); // nose
  addCyl(bike, dark, 0.02, 0.02, 0.5, 0, 0.18, 0.75, 0.9, 0, 0, 6);        // handlebar stem
  addBox(bike, dark, 0.5, 0.03, 0.03, 0, 0.38, 0.95);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 8), new THREE.MeshBasicMaterial({ color: 0x77bbff, transparent: true, opacity: 0.8 }));
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0, -1.35);
  bike.add(flame);
  bike.position.y = 0.55;
  group.add(bike);
  // rider (statically posed on the canonical rig — no clips needed)
  const leather = mat(0x4a3b28, { rough: 0.95 });
  const { inst: rider } = buildBiped({ skin: leather, torso: mat(0x3a2f22, { rough: 0.9 }) });
  const rb = (rider.rig!).bones;
  const skinM = mat(0xa66a4a, { rough: 0.9 });
  addSphere(rb.head, skinM, 0.13, 0, 0.04, 0, 10, 8);
  for (let i = 0; i < 5; i++) addCyl(rb.head, skinM, 0.008, 0.018, 0.06, -0.06 + i * 0.03, 0.13, 0.06, -0.4, 0, 0, 5);
  const D = Math.PI / 180;
  const pose: Array<[THREE.Object3D, number, number, number]> = [
    [rb.upperLegL, -95 * D, 0, 8 * D], [rb.upperLegR, -95 * D, 0, -8 * D],
    [rb.lowerLegL, 100 * D, 0, 0], [rb.lowerLegR, 100 * D, 0, 0],
    [rb.chest, 22 * D, 0, 0],
    [rb.upperArmL, -70 * D, -20 * D, 0], [rb.upperArmR, -70 * D, 20 * D, 0],
    [rb.forearmL, -30 * D, 0, 0], [rb.forearmR, -30 * D, 0, 0],
    [rb.head, -14 * D, 0, 0],
  ];
  for (const [o, x, y, z] of pose) o.rotation.set(x, y, z);
  rider.root.position.set(0, 0.62, -0.1);
  group.add(rider.root);

  return {
    root: group, rig: null, animator: null, height: 1.6,
    cosmetic: (dt, time) => {
      bike.position.y = 0.55 + Math.sin(time * 6) * 0.05;
      bike.rotation.z = Math.sin(time * 3.1) * 0.06;
      flame.scale.y = 0.8 + Math.sin(time * 40) * 0.2;
    },
  };
}

// ---------- Massiff: quadruped spiky hound ----------
export function buildMassiff(): CharacterInstance {
  const hide = mat(0x8a6a4a, { rough: 0.95 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.42;
  root.add(body);
  addSphere(body, hide, 0.24, 0, 0, 0, 10, 8, 0.85, 1.5);
  // head with wide jaw
  const head = new THREE.Group();
  head.position.set(0, 0.12, 0.36);
  body.add(head);
  addSphere(head, hide, 0.16, 0, 0, 0.04, 9, 7, 0.8, 1.1);
  addBox(head, mat(0x3a2c20, { rough: 0.9 }), 0.18, 0.05, 0.2, 0, -0.08, 0.12);
  // back spikes
  for (let i = 0; i < 5; i++) addCyl(body, hide, 0.005, 0.03, 0.14, 0, 0.2, 0.2 - i * 0.12, -0.3 + i * 0.12, 0, 0, 5);
  // legs
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.16, 0.22], [0.16, 0.22], [-0.16, -0.24], [0.16, -0.24]] as const) {
    const leg = new THREE.Group();
    leg.position.set(x, -0.1, z);
    addCyl(leg, hide, 0.045, 0.03, 0.34, 0, -0.16, 0);
    body.add(leg);
    legs.push(leg);
  }
  const tail = addCyl(body, hide, 0.008, 0.045, 0.3, 0, 0.05, -0.42, 1.2, 0, 0, 6);
  return {
    root, rig: null, animator: null, height: 0.7,
    cosmetic: (dt, time) => {
      for (let i = 0; i < 4; i++) legs[i].rotation.x = Math.sin(time * 14 + (i % 2) * Math.PI + (i > 1 ? 1.4 : 0)) * 0.6;
      body.position.y = 0.42 + Math.abs(Math.sin(time * 14)) * 0.04;
      head.rotation.y = Math.sin(time * 2.2) * 0.15;
      tail.rotation.z = Math.sin(time * 9) * 0.2;
    },
  };
}
