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

// ---------- Imperial remnant: stormtrooper / death trooper ----------
export function buildStormtrooper(elite: boolean): CharacterInstance {
  const armor = mat(elite ? 0x1c1e22 : 0xe4e2dc, { rough: 0.4, metal: 0.25 });
  const suitM = mat(elite ? 0x101114 : 0x2a2a2a, { rough: 0.85 });
  const { inst, rig } = buildBiped({ skin: suitM, torso: armor, scale: elite ? 1.08 : 1 });
  const b = rig.bones;
  const dark = mat(0x0c0c0e, { rough: 0.5 });
  // plate details
  addBox(b.chest, armor, 0.34, 0.3, 0.05, 0, 0.06, 0.12);
  addBox(b.hips, armor, 0.32, 0.12, 0.05, 0, 0.04, 0.11);
  addBox(b.shoulderL, armor, 0.15, 0.06, 0.17, -0.05, 0.05, 0, 0, 0, 0.22);
  addBox(b.shoulderR, armor, 0.15, 0.06, 0.17, 0.05, 0.05, 0, 0, 0, -0.22);
  addCyl(b.upperLegL, armor, 0.08, 0.07, 0.24, 0, -0.2, 0);
  addCyl(b.upperLegR, armor, 0.08, 0.07, 0.24, 0, -0.2, 0);
  // helmet: dome + brow band + grimace vents
  addSphere(b.head, armor, 0.15, 0, 0.05, 0, 12, 10, 0.98, 1);
  addBox(b.head, dark, 0.24, 0.035, 0.06, 0, 0.075, 0.1);            // visor band
  addBox(b.head, dark, 0.1, 0.03, 0.03, 0, -0.05, 0.13);             // mouth vent
  addSphere(b.head, dark, 0.02, -0.1, -0.02, 0.1, 5, 4);
  addSphere(b.head, dark, 0.02, 0.1, -0.02, 0.1, 5, 4);
  inst.muzzle = rifle(b.weaponR);
  return inst;
}

// ---------- Dark trooper: heavy flying battle droid ----------
export function buildDarkTrooper(): CharacterInstance {
  const metal = mat(0x24262c, { rough: 0.35, metal: 0.8 });
  const { inst, rig } = buildBiped({ skin: metal, torso: metal, scale: 1.15 });
  const b = rig.bones;
  addBox(b.chest, metal, 0.44, 0.36, 0.26, 0, 0.08, 0);
  addBox(b.shoulderL, metal, 0.2, 0.12, 0.2, -0.06, 0.06, 0);
  addBox(b.shoulderR, metal, 0.2, 0.12, 0.2, 0.06, 0.06, 0);
  // skull-like droid head with red eyes
  addBox(b.head, metal, 0.2, 0.22, 0.22, 0, 0.06, 0);
  const eye = mat(0xff2810, { emissive: 0xff2810, rough: 0.3 });
  addSphere(b.head, eye, 0.025, -0.055, 0.08, 0.11, 6, 5);
  addSphere(b.head, eye, 0.025, 0.055, 0.08, 0.11, 6, 5);
  // integrated back thrusters
  const dark = mat(0x0e0f12, { rough: 0.5, metal: 0.6 });
  addCyl(b.jetpack, dark, 0.05, 0.07, 0.2, -0.09, -0.1, 0);
  addCyl(b.jetpack, dark, 0.05, 0.07, 0.2, 0.09, -0.1, 0);
  inst.muzzle = rifle(b.weaponR);
  return inst;
}

// ---------- Allies ----------
/** IG-series assassin droid: tall thin cylinder head, spindly limbs. */
export function buildIG(): CharacterInstance {
  const steel = mat(0x8a8578, { rough: 0.5, metal: 0.6 });
  const p: Proportions = { ...HUMAN, hipHeight: 1.15, headSize: 0.34, shoulderWidth: 0.2, upperLegLen: 0.56, lowerLegLen: 0.56 };
  const { inst, rig } = buildBiped({ skin: steel, torso: steel, proportions: p });
  const b = rig.bones;
  const dark = mat(0x2c2c28, { rough: 0.6 });
  addCyl(b.head, steel, 0.055, 0.075, 0.3, 0, 0.1, 0, 0, 0, 0, 8);
  // sensor ring
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    addSphere(b.head, mat(0xd8342a, { emissive: 0x881510, rough: 0.4 }), 0.016, Math.cos(a) * 0.07, 0.16, Math.sin(a) * 0.07, 5, 4);
  }
  addCyl(b.chest, dark, 0.09, 0.11, 0.3, 0, 0.06, 0, 0, 0, 0, 8);
  inst.muzzle = rifle(b.weaponR);
  return inst;
}

/** Human gunfighter ally (marshal / sharpshooter flavor via palette). */
export function buildGunfighter(kind: 'marshal' | 'fennec'): CharacterInstance {
  const coat = mat(kind === 'marshal' ? 0x7a2e26 : 0x2c2c30, { rough: 0.9 });
  const suitM = mat(kind === 'marshal' ? 0x4a3a2c : 0x3c3630, { rough: 0.9 });
  const { inst, rig } = buildBiped({ skin: suitM, torso: coat });
  const b = rig.bones;
  const skinM = mat(0xc09068, { rough: 0.85 });
  addSphere(b.head, skinM, 0.12, 0, 0.04, 0, 10, 8);
  if (kind === 'marshal') {
    // wide-brim hat
    addCyl(b.head, coat, 0.2, 0.2, 0.02, 0, 0.13, 0, 0, 0, 0, 12);
    addCyl(b.head, coat, 0.09, 0.1, 0.1, 0, 0.18, 0, 0, 0, 0, 10);
  } else {
    // fennec: helmet cap with orange visor band
    addSphere(b.head, mat(0x3a3a40, { rough: 0.5, metal: 0.3 }), 0.13, 0, 0.07, 0, 10, 8, 0.8, 1);
    addBox(b.head, mat(0xd07828, { emissive: 0x552f10, rough: 0.4 }), 0.2, 0.03, 0.04, 0, 0.05, 0.1);
  }
  inst.muzzle = rifle(b.weaponR);
  return inst;
}

// ---------- Grogu in his floating pram (cosmetic companion) ----------
export function buildGrogu(): CharacterInstance {
  const root = new THREE.Group();
  const pram = new THREE.Group();
  root.add(pram);
  const shell = mat(0x8f9298, { rough: 0.4, metal: 0.5 });
  addSphere(pram, shell, 0.34, 0, 0, 0, 14, 10, 0.85, 1.15);
  // open front rim
  addCyl(pram, mat(0x4a4d52, { rough: 0.6 }), 0.26, 0.26, 0.05, 0, 0.12, 0.12, 1.2, 0, 0, 12);
  const green = mat(0x7a9354, { rough: 0.85 });
  const head = new THREE.Group();
  head.position.set(0, 0.22, 0.1);
  pram.add(head);
  addSphere(head, green, 0.11, 0, 0, 0, 10, 8, 0.9, 1);
  // the ears
  addCyl(head, green, 0.01, 0.05, 0.16, -0.14, 0.02, 0, 0, 0, 1.35, 6);
  addCyl(head, green, 0.01, 0.05, 0.16, 0.14, 0.02, 0, 0, 0, -1.35, 6);
  const dark = mat(0x1a140f, { rough: 0.4 });
  addSphere(head, dark, 0.025, -0.045, 0.01, 0.09, 6, 5);
  addSphere(head, dark, 0.025, 0.045, 0.01, 0.09, 6, 5);
  addBox(pram, mat(0x6b543a, { rough: 1 }), 0.3, 0.1, 0.3, 0, 0.08, 0.05); // robe blanket
  return {
    root, rig: null, animator: null, height: 0.8,
    cosmetic: (dt, time) => {
      pram.position.y = Math.sin(time * 1.8) * 0.08;
      pram.rotation.z = Math.sin(time * 1.1) * 0.05;
      head.rotation.y = Math.sin(time * 0.7) * 0.5;
    },
  };
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
