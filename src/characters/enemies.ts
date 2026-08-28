import * as THREE from 'three';
import { HUMAN, type Proportions, type Rig } from '../anim/skeleton';
import { clamp } from '../core/math';
import { attachAuthored, loadCreature, loadProp } from './authored';
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
/**
 * Heights the authored enemy models are normalised to, matching the `height`
 * their DEFS entry uses for hit spheres and camera framing.
 */
const AUTHORED_ENEMY: Record<string, number> = {
  droid: 2.1, deathtrooper: 2.0, darktrooper: 2.2, duelist: 1.9,
  pirate: 1.9, pirate_melee: 1.9, marshal: 1.85, fennec: 1.8, imperial_officer: 1.88,
  tusken: 1.8, pyke: 2.0, stormtrooper: 1.9, pyke_capo: 2.05, wookiee_enforcer: 2.6,
  // the swoop rider is measured standing, then posted on the saddle by the pose
  nikto: 1.76,
};

/**
 * Give an enemy its authored skin, if one exists. The weapon stays on the
 * canonical `weaponR` bone rather than moving into the model's hand: enemy
 * rifles are aimed by the same clips on either build, and keeping one mount
 * keeps the muzzle where the firing code already looks for it.
 */
function authoredEnemy(inst: CharacterInstance, rig: Rig, id: keyof typeof AUTHORED_ENEMY, enabled = true): void {
  const swap = attachAuthored(rig, id, AUTHORED_ENEMY[id], {
    keep: [rig.bones.weaponR, rig.bones.weaponL],
    enabled,
  });
  const prev = inst.cosmetic;
  inst.cosmetic = (dt, time) => { swap.update(); prev?.(dt, time); };
}

export function buildTusken(authored = true): CharacterInstance {
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
  authoredEnemy(inst, rig, 'tusken', authored);
  return inst;
}

// ---------- Pyke soldier: tall tapered helmet, slate coat, rifle ----------
const PYKE_P: Proportions = { ...HUMAN, hipHeight: 0.9, headSize: 0.34, shoulderWidth: 0.22 };
export function buildPyke(authored = true): CharacterInstance {
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
  authoredEnemy(inst, rig, 'pyke', authored);
  return inst;
}

// ---------- Space pirate: rough leathers, pauldron, rifle or fists ----------
export function buildPirate(melee: boolean, authored = true): CharacterInstance {
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
  authoredEnemy(inst, rig, melee ? 'pirate_melee' : 'pirate', authored);
  return inst;
}

// ---------- Security droid: bone-white skeletal frame ----------
const DROID_P: Proportions = { ...HUMAN, hipHeight: 1.05, headSize: 0.3, shoulderWidth: 0.24, upperLegLen: 0.52, lowerLegLen: 0.52 };
export function buildDroid(authored = true): CharacterInstance {
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
  authoredEnemy(inst, rig, 'droid', authored);
  return inst;
}

// ---------- Imperial remnant: stormtrooper / death trooper ----------
export function buildStormtrooper(elite: boolean, authored = true): CharacterInstance {
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
  authoredEnemy(inst, rig, elite ? 'deathtrooper' : 'stormtrooper', authored);
  return inst;
}

// ---------- Dark trooper: heavy flying battle droid ----------
export function buildDarkTrooper(authored = true): CharacterInstance {
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
  authoredEnemy(inst, rig, 'darktrooper', authored);
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
export function buildGunfighter(kind: 'marshal' | 'fennec', authored = true): CharacterInstance {
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
  authoredEnemy(inst, rig, kind, authored);
  return inst;
}

/**
 * Cad Bane-class duelist: blue-skinned gunslinger under a wide brim, twin
 * pistols, breathing tubes from nose to temple. Listed in ASSETS_MODELS.md as
 * a planned boss; with a model in hand it enters as a late-wave elite instead
 * of a scripted fight — a fast, high-damage shooter you have to answer.
 */
export function buildDuelist(authored = true): CharacterInstance {
  const coat = mat(0x2b2f38, { rough: 0.9 });
  const suitM = mat(0x1e2129, { rough: 0.9 });
  const { inst, rig } = buildBiped({ skin: suitM, torso: coat });
  const b = rig.bones;
  const skinM = mat(0x5a86a8, { rough: 0.8 });     // blue-grey hide
  addSphere(b.head, skinM, 0.12, 0, 0.04, 0, 10, 8);
  // wide-brim hat
  addCyl(b.head, coat, 0.22, 0.22, 0.02, 0, 0.13, 0, 0, 0, 0, 14);
  addCyl(b.head, coat, 0.1, 0.11, 0.11, 0, 0.19, 0, 0, 0, 0, 10);
  // breathing tubes, nose to temple
  const tube = mat(0x8a8f98, { rough: 0.5, metal: 0.5 });
  addCyl(b.head, tube, 0.014, 0.014, 0.14, -0.06, 0.02, 0.08, 0.5, 0, -0.25);
  addCyl(b.head, tube, 0.014, 0.014, 0.14, 0.06, 0.02, 0.08, 0.5, 0, 0.25);
  addBox(b.chest, coat, 0.36, 0.4, 0.24, 0, 0.08, 0);
  inst.muzzle = rifle(b.weaponR);
  authoredEnemy(inst, rig, 'duelist', authored);
  return inst;
}

/**
 * Moff-class Imperial officer with the darksaber. Listed in ASSETS_MODELS.md
 * among the planned bosses; with a model in hand he enters as a late-wave
 * melee elite — the close-quarters answer to the duelist's rifle.
 *
 * The blade is an FX mesh on the weapon bone: a black core with a white
 * fringe, which is what makes a darksaber read as one and not just a sword.
 */
export function buildImperialOfficer(authored = true): CharacterInstance {
  const coat = mat(0x14161a, { rough: 0.8 });
  const { inst, rig } = buildBiped({ skin: mat(0x1b1d22, { rough: 0.85 }), torso: coat, scale: 1.04 });
  const b = rig.bones;
  addSphere(b.head, mat(0xc8a184, { rough: 0.85 }), 0.12, 0, 0.04, 0, 10, 8);
  addCyl(b.head, coat, 0.135, 0.135, 0.09, 0, 0.12, 0, 0, 0, 0, 12);        // officer cap
  addCyl(b.head, coat, 0.19, 0.19, 0.015, 0, 0.09, 0.03, 0, 0, 0, 12);      // peak
  addBox(b.chest, coat, 0.42, 0.46, 0.28, 0, 0.08, 0);                      // greatcoat
  addBox(b.hips, coat, 0.4, 0.5, 0.3, 0, -0.18, 0);                         // skirt of the coat
  addBox(b.chest, mat(0x9aa2b0, { rough: 0.4, metal: 0.6 }), 0.07, 0.03, 0.02, -0.13, 0.2, 0.15);  // rank plaque

  // darksaber: black blade, white edge glow
  const saber = new THREE.Group();
  addCyl(saber, mat(0x3a3d44, { rough: 0.4, metal: 0.7 }), 0.022, 0.026, 0.2, 0, -0.08, 0);
  // The blade is opaque and depth-writing, and the glow sits a hair behind it,
  // so the core stays black and only the rim of the halo shows past its edges —
  // which is the whole reason a darksaber reads as one.
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.86, 0.03),
    new THREE.MeshBasicMaterial({ color: 0x08080c }),
  );
  blade.position.y = 0.47;
  saber.add(blade);
  const fringe = new THREE.Mesh(
    new THREE.BoxGeometry(0.125, 0.9, 0.008),
    new THREE.MeshBasicMaterial({ color: 0xdfe6ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  fringe.position.set(0, 0.47, -0.014);
  saber.add(fringe);
  saber.rotation.x = Math.PI / 2;
  b.weaponR.add(saber);

  authoredEnemy(inst, rig, 'imperial_officer', authored);
  const prev = inst.cosmetic;
  inst.cosmetic = (dt, time) => {
    // the blade breathes, so it reads as energy rather than a painted plank
    const m = fringe.material as THREE.MeshBasicMaterial;
    m.opacity = 0.42 + Math.sin(time * 9) * 0.08;
    prev?.(dt, time);
  };
  return inst;
}

/**
 * Pyke capo: the syndicate's local boss, in embroidered robes behind a
 * personal shield. Another of ASSETS_MODELS.md's planned bosses, entering as a
 * late-wave elite — a shielded shooter you have to flank or out-damage.
 */
export function buildPykeCapo(authored = true): CharacterInstance {
  const robe = mat(0x4a3f63, { rough: 0.85 });
  const { inst, rig } = buildBiped({ skin: mat(0x39434a, { rough: 0.9 }), torso: robe, proportions: PYKE_P });
  const b = rig.bones;
  addCyl(b.hips, robe, 0.26, 0.32, 0.5, 0, -0.22, 0, 0, 0, 0, 10);
  const helm = mat(0xa08c6a, { rough: 0.5, metal: 0.35 });
  addCyl(b.head, helm, 0.05, 0.12, 0.36, 0, 0.17, 0, 0, 0, 0, 10);
  addSphere(b.head, helm, 0.12, 0, 0, 0.01, 10, 8, 0.9, 1.05);
  inst.muzzle = rifle(b.weaponR);
  // personal shield bubble — the thing that makes a capo a capo
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 20, 14),
    new THREE.MeshBasicMaterial({
      color: 0xc08cff, transparent: true, opacity: 0.13, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  bubble.position.y = 1.0;
  inst.root.add(bubble);
  authoredEnemy(inst, rig, 'pyke_capo', authored);
  const prev = inst.cosmetic;
  inst.cosmetic = (dt, time) => {
    const m = bubble.material as THREE.MeshBasicMaterial;
    m.opacity = 0.11 + Math.sin(time * 2.2) * 0.03;
    bubble.rotation.y = time * 0.4;
    prev?.(dt, time);
  };
  return inst;
}

/**
 * Krrsantan-class Wookiee enforcer: a 2.6 m gladiator who closes and hits.
 * The last of the planned bosses to arrive with a model.
 */
export function buildWookieeEnforcer(authored = true): CharacterInstance {
  const fur = mat(0x2b2019, { rough: 1 });
  const WOOKIEE_P: Proportions = { ...HUMAN, hipHeight: 1.3, chestLen: 0.38, shoulderWidth: 0.36, upperArmLen: 0.42, forearmLen: 0.38 };
  const { inst, rig } = buildBiped({ skin: fur, torso: fur, proportions: WOOKIEE_P, scale: 1.05 });
  const b = rig.bones;
  addSphere(b.head, fur, 0.19, 0, 0.06, 0.02, 12, 10);
  addBox(b.chest, mat(0x5a4632, { rough: 0.9 }), 0.11, 0.5, 0.34, 0, 0.06, 0, 0, 0, 0.5);  // bandolier
  const gauntlet = mat(0x6d6a63, { rough: 0.4, metal: 0.6 });
  addCyl(b.forearmL, gauntlet, 0.09, 0.08, 0.22, 0, -0.18, 0);
  addCyl(b.forearmR, gauntlet, 0.09, 0.08, 0.22, 0, -0.18, 0);
  authoredEnemy(inst, rig, 'wookiee_enforcer', authored);
  return inst;
}

// ---------- Nikto swoop rider: bike + seated rider, moved as one unit ----------
/**
 * War massiff — an armoured quadruped bred well past the size of the pack
 * animals the Tuskens keep. Shoulder height ~1.9 m, ~4 m nose to tail, so it
 * reads as an apex predator next to a 1.8 m trooper rather than a hound
 * underfoot. Free-form rig: the gait, jaw and tail are animated in code by
 * `cosmetic`, since there is no biped skeleton to hang clips on.
 */
export function buildMassiff(authored = true): CharacterInstance {
  const hide = mat(0x8a6a45, { rough: 0.95 });
  const plate = mat(0x6f5535, { rough: 0.8 });
  const dark = mat(0x2e2418, { rough: 0.9 });
  const tusk = mat(0xd8cdaa, { rough: 0.6 });
  const root = new THREE.Group();

  // Low, slab-sided torso: flattened rather than barrel-round so it reads as
  // armour over muscle from 30 m, with the shoulders carried higher than the
  // hips and the skull slung out front below them — a stalking predator line.
  const BODY_Y = 1.22;
  const body = new THREE.Group();
  body.position.y = BODY_Y;
  root.add(body);
  addSphere(body, hide, 0.64, 0, 0, 0.05, 12, 9, 1.15, 1.85);        // barrel
  addSphere(body, hide, 0.52, 0, 0.1, 0.62, 10, 8, 1.12, 0.95);      // shoulder hump
  addSphere(body, hide, 0.5, 0, -0.06, -0.92, 10, 8, 1.05, 1.15);    // haunches
  body.scale.y = 0.84;                                                // flatten the whole mass

  // dorsal armour: overlapping plates down the spine, spikes standing off them
  for (let i = 0; i < 10; i++) {
    const z = 0.95 - i * 0.25;
    const hump = Math.max(0, 1 - Math.abs(i - 2.5) / 6);
    addBox(body, plate, 0.54 - Math.abs(i - 3) * 0.03, 0.11, 0.21, 0, 0.55 + hump * 0.08, z, -0.1, 0, 0);
    addCyl(body, plate, 0.012, 0.08, 0.34 - i * 0.016, 0, 0.72 + hump * 0.08, z, -0.22, 0, 0, 5);
  }
  // flank scutes
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      addBox(body, plate, 0.09, 0.2, 0.32, sx * 0.6, 0.14 - i * 0.03, 0.7 - i * 0.36, 0, 0, sx * 0.3);
    }
  }

  // neck and heavy skull, carried low and forward
  const neck = new THREE.Group();
  neck.position.set(0, -0.02, 1.02);
  body.add(neck);
  addCyl(neck, hide, 0.3, 0.34, 0.5, 0, -0.08, 0.18, Math.PI / 2 - 0.28, 0, 0, 8);
  const head = new THREE.Group();
  head.position.set(0, -0.2, 0.44);
  neck.add(head);
  addBox(head, hide, 0.48, 0.36, 0.46, 0, 0, 0.06);                  // skull
  addBox(head, plate, 0.44, 0.1, 0.4, 0, 0.19, 0.04);                // crown plate
  addBox(head, hide, 0.4, 0.24, 0.46, 0, -0.05, 0.42);               // snout
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.17, 0.1);
  head.add(jaw);
  addBox(jaw, dark, 0.36, 0.13, 0.5, 0, -0.02, 0.26);
  for (let i = 0; i < 6; i++) {
    const tx = -0.15 + (i % 2) * 0.3;
    const tz = 0.12 + ((i / 2) | 0) * 0.22;
    addCyl(jaw, tusk, 0.005, 0.038, 0.19, tx, 0.1, tz, 0, 0, 0, 5);       // lower fangs
    addCyl(head, tusk, 0.005, 0.034, 0.16, tx, -0.16, tz + 0.04, Math.PI, 0, 0, 5); // upper
  }
  for (const ex of [-1, 1]) {
    addSphere(head, mat(0xc4761f, { rough: 0.35, emissive: 0x6a2f06 }), 0.055, ex * 0.23, 0.08, 0.2, 7, 6);
    addCyl(head, plate, 0.01, 0.055, 0.28, ex * 0.19, 0.24, -0.02, -0.55, 0, ex * 0.35, 5); // brow horns
  }

  // four heavy legs, sized so the feet meet the ground from the flattened body
  const legs: THREE.Object3D[] = [];
  for (const [x, z, front] of [[-0.5, 0.6, 1], [0.5, 0.6, 1], [-0.5, -0.88, 0], [0.5, -0.88, 0]] as const) {
    const leg = new THREE.Group();
    // the body is scaled 0.84 in y, so undo it here or the legs squash with it
    leg.position.set(x, -0.26 / 0.84, z);
    leg.scale.y = 1 / 0.84;
    addCyl(leg, hide, 0.19, 0.15, 0.5, 0, -0.25, 0, 0, 0, 0, 7);          // upper
    addCyl(leg, hide, 0.15, 0.16, 0.46, 0, -0.7, front ? 0.04 : -0.04, 0, 0, 0, 7); // lower
    addBox(leg, dark, 0.36, 0.14, 0.5, 0, -0.98, 0.11);                    // foot
    for (let c = 0; c < 3; c++) addCyl(leg, tusk, 0.004, 0.024, 0.12, -0.11 + c * 0.11, -1.0, 0.36, 1.35, 0, 0, 4);
    body.add(leg);
    legs.push(leg);
  }

  // thick spiked tail, tapering in segments so it can swing as a chain
  const tailSegs: THREE.Object3D[] = [];
  let attach: THREE.Object3D = body;
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.06 : 0, i === 0 ? -1.3 : -0.42);
    addCyl(seg, hide, 0.21 - i * 0.034, 0.25 - i * 0.034, 0.44, 0, 0, -0.22, Math.PI / 2, 0, 0, 7);
    addCyl(seg, plate, 0.01, 0.06 - i * 0.007, 0.22, 0, 0.21 - i * 0.026, -0.2, -0.35, 0, 0, 5);
    attach.add(seg);
    attach = seg;
    tailSegs.push(seg);
  }

  // The sculpt is a quadruped on its own skeleton, so no humanoid clip reaches
  // it: it comes in through the creature path, is placed and grounded, and this
  // enemy's movement carries it. The procedural build stays as the fallback and
  // hides the moment the model lands.
  //
  // If the file ships its own clips — the rigged quadruped is being authored —
  // they drive it here: a mixer picks a locomotion clip by name and plays it at
  // a rate tied to how fast the beast is actually moving. Until then the sculpt
  // rides along statically, which is how the swoop bike works.
  let posed = true;
  let mixer: THREE.AnimationMixer | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  let moveAction: THREE.AnimationAction | null = null;
  /** metres covered per second of the move clip, for rate-matching the gait */
  let clipStride = 4;
  let gaitSpeed = 0;
  if (authored) {
    const model = loadCreature('massiff', {
      onLoad: (loaded) => {
        body.visible = false;
        posed = false;
        const clips = (loaded.userData.clips ?? []) as THREE.AnimationClip[];
        if (!clips.length) return;
        const pick = (re: RegExp): THREE.AnimationClip | undefined => clips.find((c) => re.test(c.name));
        const idle = pick(/idle|breath|stand/i);
        const move = pick(/run|gallop|sprint/i) ?? pick(/walk|trot|move/i);
        mixer = new THREE.AnimationMixer(loaded);
        if (idle) { idleAction = mixer.clipAction(idle); idleAction.play(); }
        if (move) {
          moveAction = mixer.clipAction(move);
          moveAction.play();
          moveAction.setEffectiveWeight(0);
          // a gallop cycle covers roughly a body length; close enough to keep
          // the feet from skating until the clip's real stride is known
          clipStride = 4 / Math.max(move.duration, 0.2);
        }
      },
    });
    root.add(model);
  }

  return {
    root, rig: null, animator: null, height: 2.0, baseScale: 1,
    setGait: (speed: number) => { gaitSpeed = speed; },
    cosmetic: (dt, time) => {
      if (mixer) {
        // cross-fade idle against the run by how fast the body is travelling,
        // and drive the run's playback rate off the same speed so it doesn't skate
        const moving = Math.min(gaitSpeed / 6, 1);
        if (moveAction) {
          moveAction.setEffectiveWeight(moving);
          moveAction.timeScale = clamp(gaitSpeed / Math.max(clipStride, 0.5), 0.4, 2.2);
        }
        if (idleAction) idleAction.setEffectiveWeight(1 - moving);
        mixer.update(dt);
        return;
      }
      if (!posed) return;   // a static sculpt has its own shape; leave it be
      // stalking gait: diagonal pairs, slower and heavier than a hound's
      const gait = time * 7;
      for (let i = 0; i < 4; i++) {
        const phase = gait + ((i === 0 || i === 3) ? 0 : Math.PI);
        legs[i].rotation.x = Math.sin(phase) * 0.5;
      }
      body.position.y = BODY_Y + Math.abs(Math.sin(gait)) * 0.07;
      body.rotation.z = Math.sin(gait) * 0.035;
      neck.rotation.y = Math.sin(time * 1.7) * 0.1;
      neck.rotation.x = Math.sin(time * 2.3) * 0.06;
      jaw.rotation.x = 0.12 + Math.abs(Math.sin(time * 3.1)) * 0.24; // panting
      for (let i = 0; i < tailSegs.length; i++) {
        tailSegs[i].rotation.y = Math.sin(time * 3.4 - i * 0.5) * 0.16;
        tailSegs[i].rotation.x = Math.sin(time * 2.1 - i * 0.4) * 0.05;
      }
    },
  };
}

export function buildNikto(authored = true): CharacterInstance {
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
  // The bike is a vehicle, not a character — nothing animates it, so it comes
  // in through the prop path and simply replaces the procedural box.
  if (authored) {
    const swoop = loadProp('nikto_swoop', 2.6, {
      onLoad: () => { for (const m of bike.children) if ((m as THREE.Mesh).isMesh) m.visible = false; },
    });
    bike.add(swoop);
  }
  // rider (statically posed on the canonical rig — no clips needed)
  const leather = mat(0x4a3b28, { rough: 0.95 });
  const { inst: rider, rig: riderRig } = buildBiped({ skin: leather, torso: mat(0x3a2f22, { rough: 0.9 }) });
  const rb = riderRig.bones;
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
  // seat the pelvis just above the bike's saddle (top ~0.67): the rig's origin
  // is at the feet, so the root has to sit below the group origin or the rider
  // floats a metre over the bike with nothing bridging the gap
  rider.root.position.set(0, -0.22, -0.1);
  group.add(rider.root);

  // The rider is a whole biped on the canonical rig, just held in one pose
  // rather than animated, so the swap works exactly as it does for anyone
  // else — the retarget simply reproduces the same seated pose every frame.
  const swap = attachAuthored(riderRig, 'nikto', AUTHORED_ENEMY.nikto, {
    keep: [rb.weaponR, rb.weaponL],
    enabled: authored,
    // The seat offset above is tuned to the procedural rider's proportions;
    // the authored one sits with its hips lower, so it needs raising to meet
    // the same saddle.
    onLoad: () => { rider.root.position.y = -0.09; },
  });

  return {
    root: group, rig: null, animator: null, height: 1.6, baseScale: 1,
    cosmetic: (dt, time) => {
      swap.update();
      bike.position.y = 0.55 + Math.sin(time * 6) * 0.05;
      bike.rotation.z = Math.sin(time * 3.1) * 0.06;
      flame.scale.y = 0.8 + Math.sin(time * 40) * 0.2;
    },
  };
}
