import * as THREE from 'three';
import { addBox, addCyl, addSphere, attachCape, buildBiped, makeCarbine, makeGaffi, mat, type CharacterInstance } from './builder';
import { loadAuthored, retarget, type AuthoredModel } from './authored';

/**
 * Playable Mandalorians — one config-driven factory so every fighter shares
 * the same rig, clips, weapons and gameplay; only armor/silhouette differs.
 */

export type MandoId = 'din' | 'paz';

export interface PlayerCharacter extends CharacterInstance {
  setWeapon: (w: 'blaster' | 'gaffi') => void;
  setThrust: (t: number) => void;
  gaffi: THREE.Group;
}

/** visual height per character, used to size an authored model */
const MODEL_HEIGHT: Record<MandoId, number> = { din: 1.85, paz: 2.0 };

interface MandoConfig {
  name: string;
  desc: string;
  primary: number;   // main armor plate color
  accent: number;    // pauldrons / details
  suit: number;      // under-suit
  cape: number | null;
  helmet: MandoId;   // helmet detail variant
  rangefinder: boolean;
  bulk: number;      // 1 = standard; Paz is heavier
}

export const MANDO_ROSTER: Record<MandoId, MandoConfig> = {
  din: {
    name: 'Din Djarin', desc: 'The Mandalorian — pure beskar shine, this is the way.',
    primary: 0xb4bac2, accent: 0x6d7178, suit: 0x4a4239, cape: 0x5a4632, helmet: 'din', rangefinder: false, bulk: 1,
  },
  paz: {
    name: 'Paz Vizsla', desc: 'Heavy infantry of the covert — walking siege tower.',
    primary: 0x2e4a72, accent: 0x1e2c42, suit: 0x33363c, cape: null, helmet: 'paz', rangefinder: false, bulk: 1.12,
  },
};

export function buildMandalorian(id: MandoId): PlayerCharacter {
  const cfg = MANDO_ROSTER[id];
  const skin = mat(cfg.suit, { rough: 0.9 });
  const prim = mat(cfg.primary, { rough: 0.45, metal: 0.55 });
  const accent = mat(cfg.accent, { rough: 0.5, metal: 0.4 });
  const dark = mat(0x232323, { rough: 0.6, metal: 0.3 });
  const silver = mat(0x9aa0a2, { rough: 0.35, metal: 0.7 });

  const { inst, rig } = buildBiped({ skin, torso: skin, scale: cfg.bulk });
  const b = rig.bones;

  // cuirass
  addBox(b.chest, prim, 0.17, 0.16, 0.05, -0.1, 0.16, 0.135, 0, 0.12);
  addBox(b.chest, prim, 0.17, 0.16, 0.05, 0.1, 0.16, 0.135, 0, -0.12);
  addBox(b.chest, prim, 0.3, 0.12, 0.05, 0, 0.0, 0.135);
  addBox(b.hips, prim, 0.3, 0.1, 0.04, 0, 0.03, 0.12);
  addBox(b.hips, dark, 0.36, 0.06, 0.24, 0, 0.06, 0);
  // pauldrons (Paz gets oversized ones)
  const ps = cfg.bulk > 1.05 ? 1.5 : 1;
  addBox(b.shoulderL, accent, 0.16 * ps, 0.07 * ps, 0.18 * ps, -0.05, 0.05, 0, 0, 0, 0.25);
  addBox(b.shoulderR, accent, 0.16 * ps, 0.07 * ps, 0.18 * ps, 0.05, 0.05, 0, 0, 0, -0.25);
  // gauntlets, thigh and knee plates
  addCyl(b.forearmL, accent, 0.062, 0.056, 0.16, 0, -0.14, 0);
  addCyl(b.forearmR, accent, 0.062, 0.056, 0.16, 0, -0.14, 0);
  addBox(b.upperLegL, prim, 0.13, 0.2, 0.05, 0, -0.2, 0.07);
  addBox(b.upperLegR, prim, 0.13, 0.2, 0.05, 0, -0.2, 0.07);
  addSphere(b.lowerLegL, accent, 0.06, 0, -0.02, 0.04, 8, 6);
  addSphere(b.lowerLegR, accent, 0.06, 0, -0.02, 0.04, 8, 6);

  // ---- helmet variants ----
  const helm = new THREE.Group();
  b.head.add(helm);
  helm.position.y = 0.06;
  addSphere(helm, prim, 0.145, 0, 0.04, 0, 14, 12, 0.95, 1);
  addCyl(helm, prim, 0.145, 0.15, 0.14, 0, -0.02, 0, 0, 0, 0, 14);
  addBox(helm, dark, 0.21, 0.035, 0.02, 0, 0.045, 0.135);   // T-visor horizontal
  addBox(helm, dark, 0.032, 0.1, 0.02, 0, -0.01, 0.142);    // T-visor vertical
  switch (cfg.helmet) {
    case 'din':
      // cheek ridges
      addBox(helm, mat(0x8d9299, { rough: 0.4, metal: 0.6 }), 0.02, 0.08, 0.1, -0.1, -0.01, 0.08, 0, 0.3);
      addBox(helm, mat(0x8d9299, { rough: 0.4, metal: 0.6 }), 0.02, 0.08, 0.1, 0.1, -0.01, 0.08, 0, -0.3);
      break;
    case 'paz':
      addBox(helm, accent, 0.06, 0.04, 0.22, 0, 0.15, 0.02); // reinforced crest
      break;
  }

  // ---- jetpack (shared Z-6 silhouette, accent-tinted) ----
  const jp = new THREE.Group();
  b.jetpack.add(jp);
  addCyl(jp, prim, 0.06, 0.06, 0.34, -0.08, 0, -0.04);
  addCyl(jp, prim, 0.06, 0.06, 0.34, 0.08, 0, -0.04);
  addSphere(jp, accent, 0.06, -0.08, 0.17, -0.04, 8, 6);
  addSphere(jp, accent, 0.06, 0.08, 0.17, -0.04, 8, 6);
  addCyl(jp, silver, 0.035, 0.035, 0.3, 0, 0.1, -0.09);
  addCyl(jp, accent, 0.001, 0.045, 0.09, 0, 0.29, -0.09);
  addCyl(jp, dark, 0.03, 0.045, 0.08, -0.08, -0.2, -0.04);
  addCyl(jp, dark, 0.03, 0.045, 0.08, 0.08, -0.2, -0.04);
  // Flames live on their own group under the jetpack bone rather than under the
  // nozzle meshes: an authored model hides the procedural body, and a hidden
  // parent would take the flames with it.
  const flameRoot = new THREE.Group();
  b.jetpack.add(flameRoot);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa640, transparent: true, opacity: 0.85 });
  const flameGeo = new THREE.ConeGeometry(0.05, 0.5, 8);
  const flames: THREE.Mesh[] = [-0.08, 0.08].map((x) => {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.rotation.x = Math.PI;
    f.position.set(x, -0.5, -0.04);
    f.visible = false;
    flameRoot.add(f);
    return f;
  });

  // ---- cape ----
  let capeUpdate: ((dt: number, time: number) => void) | null = null;
  if (cfg.cape !== null) {
    capeUpdate = attachCape(rig, mat(cfg.cape, { rough: 1 }), 0.26, 4, 0.19);
    rig.bones.capeRoot.position.x = -0.12;
  }

  // ---- weapons (shared: carbine + gaffi) ----
  const carbine = makeCarbine(mat(0x3d3730, { rough: 0.5, metal: 0.5 }), dark);
  carbine.rotation.x = Math.PI / 2;
  b.weaponR.add(carbine);
  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0.015, 0.62);
  carbine.add(muzzle);
  const gaffi = makeGaffi(mat(0x6b4c2c, { rough: 0.95 }), silver);
  gaffi.rotation.x = Math.PI / 2;
  gaffi.visible = false;
  b.weaponR.add(gaffi);

  // ---- authored model swap ----
  // The procedural build above stays as the animation source and the instant
  // fallback; if models/<id>.glb loads we hide its meshes and let the authored
  // skin ride the same rig instead.
  let authored: AuthoredModel | null = null;
  const proceduralMeshes: THREE.Object3D[] = [];
  rig.root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    // weapons and thruster flames survive the swap — they are held by the
    // authored model, not replaced by it
    for (let a: THREE.Object3D | null = o; a; a = a.parent) {
      if (a === b.weaponR || a === b.weaponL || a === flameRoot) return;
    }
    proceduralMeshes.push(o);
  });
  loadAuthored(id, MODEL_HEIGHT[id]).catch((err) => {
    console.warn(`[authored] ${id} preparation failed:`, err);
    return null;
  }).then((model) => {
    if (!model) return;
    authored = model;
    for (const m of proceduralMeshes) m.visible = false;
    rig.root.add(model.root);
    // weapons move onto the authored hand so they track the real fingers; the
    // mount reproduces our canonical weaponR frame, so nothing else changes
    if (model.weaponMount) {
      model.weaponMount.add(carbine);
      model.weaponMount.add(gaffi);
    }
    // the jetpack rides the authored back, so keep the flames with our bone
    // but sit them where the model's thrusters actually are
    flameRoot.position.y = -0.02;
  });

  let thrust = 0;
  return {
    ...inst,
    muzzle,
    gaffi,
    setWeapon: (w) => {
      carbine.visible = w === 'blaster';
      gaffi.visible = w === 'gaffi';
    },
    setThrust: (t) => { thrust = t; },
    cosmetic: (dt, time) => {
      if (authored) retarget(rig, authored);
      capeUpdate?.(dt, time);
      for (const f of flames) {
        f.visible = thrust > 0.05;
        const s = 0.6 + thrust * (0.8 + Math.sin(time * 47) * 0.25);
        f.scale.set(1, s, 1);
      }
    },
  };
}
