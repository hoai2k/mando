import * as THREE from 'three';
import { addBox, addCyl, addSphere, attachCape, buildBiped, makeCarbine, makeGaffi, mat, type CharacterInstance } from './builder';

/**
 * The Daimyo — weathered green Mandalorian armor with maroon accents,
 * T-visor helmet, Z-6 style jetpack, half-cape, EE-3-style carbine + gaffi stick.
 */

export interface PlayerCharacter extends CharacterInstance {
  setWeapon: (w: 'blaster' | 'gaffi') => void;
  setThrust: (t: number) => void;
  gaffi: THREE.Group;
}

const ARMOR_GREEN = 0x4a5d43;
const ARMOR_MAROON = 0x6e2f2a;
const SUIT = 0x3a3a38;
const SILVER = 0x9aa0a2;

export function buildBoba(): PlayerCharacter {
  const skin = mat(SUIT, { rough: 0.9 });
  const green = mat(ARMOR_GREEN, { rough: 0.55, metal: 0.45 });
  const maroon = mat(ARMOR_MAROON, { rough: 0.5, metal: 0.4 });
  const dark = mat(0x232323, { rough: 0.6, metal: 0.3 });
  const silver = mat(SILVER, { rough: 0.35, metal: 0.7 });

  const { inst, rig } = buildBiped({ skin, torso: skin });
  const b = rig.bones;

  // chest plates (three-piece Mandalorian cuirass)
  addBox(b.chest, green, 0.17, 0.16, 0.05, -0.1, 0.16, 0.135, 0, 0.12);
  addBox(b.chest, green, 0.17, 0.16, 0.05, 0.1, 0.16, 0.135, 0, -0.12);
  addBox(b.chest, green, 0.3, 0.12, 0.05, 0, 0.0, 0.135);
  addBox(b.hips, green, 0.3, 0.1, 0.04, 0, 0.03, 0.12); // belt plate
  addBox(b.hips, dark, 0.36, 0.06, 0.24, 0, 0.06, 0);   // belt
  // shoulder pauldrons
  addBox(b.shoulderL, maroon, 0.16, 0.07, 0.18, -0.05, 0.05, 0, 0, 0, 0.25);
  addBox(b.shoulderR, maroon, 0.16, 0.07, 0.18, 0.05, 0.05, 0, 0, 0, -0.25);
  // gauntlets
  addCyl(b.forearmL, maroon, 0.062, 0.056, 0.16, 0, -0.14, 0);
  addCyl(b.forearmR, maroon, 0.062, 0.056, 0.16, 0, -0.14, 0);
  // thigh + knee plates
  addBox(b.upperLegL, green, 0.13, 0.2, 0.05, 0, -0.2, 0.07);
  addBox(b.upperLegR, green, 0.13, 0.2, 0.05, 0, -0.2, 0.07);
  addSphere(b.lowerLegL, maroon, 0.06, 0, -0.02, 0.04, 8, 6);
  addSphere(b.lowerLegR, maroon, 0.06, 0, -0.02, 0.04, 8, 6);

  // helmet: dome + cheek slab + visor + rangefinder
  const helm = new THREE.Group();
  b.head.add(helm);
  helm.position.y = 0.06;
  addSphere(helm, green, 0.145, 0, 0.04, 0, 14, 12, 0.95, 1);
  addCyl(helm, green, 0.145, 0.15, 0.14, 0, -0.02, 0, 0, 0, 0, 14);
  addBox(helm, dark, 0.21, 0.035, 0.02, 0, 0.045, 0.135);              // visor horizontal
  addBox(helm, dark, 0.032, 0.1, 0.02, 0, -0.01, 0.142);               // visor vertical
  addCyl(helm, silver, 0.018, 0.018, 0.1, 0.16, 0.1, 0, 0, 0, 0.15, 6); // rangefinder stalk
  addBox(helm, dark, 0.03, 0.05, 0.03, 0.175, 0.16, 0);                 // rangefinder head

  // Z-6 jetpack: twin tanks, center rocket, nozzles
  const jp = new THREE.Group();
  b.jetpack.add(jp);
  addCyl(jp, green, 0.06, 0.06, 0.34, -0.08, 0, -0.04);
  addCyl(jp, green, 0.06, 0.06, 0.34, 0.08, 0, -0.04);
  addSphere(jp, maroon, 0.06, -0.08, 0.17, -0.04, 8, 6);
  addSphere(jp, maroon, 0.06, 0.08, 0.17, -0.04, 8, 6);
  addCyl(jp, silver, 0.035, 0.035, 0.3, 0, 0.1, -0.09);
  addCyl(jp, maroon, 0.001, 0.045, 0.09, 0, 0.29, -0.09);  // rocket tip
  const nozzleL = addCyl(jp, dark, 0.03, 0.045, 0.08, -0.08, -0.2, -0.04);
  const nozzleR = addCyl(jp, dark, 0.03, 0.045, 0.08, 0.08, -0.2, -0.04);

  // jet flames (visible when thrusting)
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa640, transparent: true, opacity: 0.85 });
  const flameGeo = new THREE.ConeGeometry(0.05, 0.5, 8);
  const flames: THREE.Mesh[] = [nozzleL, nozzleR].map((n) => {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.rotation.x = Math.PI;
    f.position.y = -0.3;
    f.visible = false;
    n.add(f);
    return f;
  });

  // cape (left shoulder half-cape)
  const capeUpdate = attachCape(rig, mat(0x554838, { rough: 1 }), 0.26, 4, 0.19);
  rig.bones.capeRoot.position.x = -0.12;

  // weapons
  const carbine = makeCarbine(mat(0x3d3730, { rough: 0.5, metal: 0.5 }), dark);
  carbine.rotation.x = Math.PI / 2; // barrel along hand's -Y (forearm direction)
  b.weaponR.add(carbine);
  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0.015, 0.62);
  carbine.add(muzzle);

  const gaffi = makeGaffi(mat(0x6b4c2c, { rough: 0.95 }), silver);
  gaffi.rotation.x = Math.PI / 2;
  gaffi.visible = false;
  b.weaponR.add(gaffi);

  let thrust = 0;
  const self: PlayerCharacter = {
    ...inst,
    muzzle,
    gaffi,
    setWeapon: (w) => {
      carbine.visible = w === 'blaster';
      gaffi.visible = w === 'gaffi';
    },
    setThrust: (t) => { thrust = t; },
    cosmetic: (dt, time) => {
      capeUpdate(dt, time);
      for (const f of flames) {
        f.visible = thrust > 0.05;
        const s = 0.6 + thrust * (0.8 + Math.sin(time * 47) * 0.25);
        f.scale.set(1, s, 1);
      }
    },
  };
  return self;
}
