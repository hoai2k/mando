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
  /** thruster mouths, in world space — where the jet particles are born */
  nozzles: THREE.Object3D[];
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

/**
 * @param opts.authored  false keeps the procedural build even when an authored
 *   model exists — the model workbench uses it to show both side by side.
 */
export function buildMandalorian(id: MandoId, opts: { authored?: boolean } = {}): PlayerCharacter {
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
  // Each nozzle only carries a stubby glow — a white-hot core inside a softer
  // orange sheath, both additive and open-ended so they read as light in the
  // throat of the thruster. The particle jet does the actual flame below it.
  const NOZZLE_Y = -0.24;
  const coreGeo = new THREE.ConeGeometry(0.03, 0.09, 10, 1, true);
  const plumeGeo = new THREE.ConeGeometry(0.05, 0.16, 10, 1, true);
  interface Flame { group: THREE.Group; core: THREE.Mesh; plume: THREE.Mesh; coreMat: THREE.MeshBasicMaterial; plumeMat: THREE.MeshBasicMaterial }
  const flames: Flame[] = [-0.08, 0.08].map((x) => {
    const group = new THREE.Group();
    group.position.set(x, NOZZLE_Y, -0.04);
    group.visible = false;
    flameRoot.add(group);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffe2a8, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const plumeMat = new THREE.MeshBasicMaterial({
      color: 0xff6a18, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    // cones are built apex-up; flip them and drop the base onto the nozzle mouth
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.rotation.x = Math.PI;
    core.position.y = -0.045;
    const plume = new THREE.Mesh(plumeGeo, plumeMat);
    plume.rotation.x = Math.PI;
    plume.position.y = -0.08;
    group.add(core, plume);
    return { group, core, plume, coreMat, plumeMat };
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
  const wantAuthored = opts.authored !== false;
  (wantAuthored ? loadAuthored(id, MODEL_HEIGHT[id]) : Promise.resolve(null)).catch((err) => {
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
    nozzles: flames.map((f) => f.group),
    setThrust: (t) => { thrust = t; },
    cosmetic: (dt, time) => {
      if (authored) retarget(rig, authored);
      capeUpdate?.(dt, time);
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i];
        f.group.visible = thrust > 0.03;
        if (!f.group.visible) continue;
        // two detuned wobbles per nozzle so the twin jets never pulse in step
        const ph = i * 2.7;
        const flick = 1 + Math.sin(time * 53 + ph) * 0.13 + Math.sin(time * 97 + ph * 1.7) * 0.07;
        const len = (0.55 + 0.45 * thrust) * flick;
        f.plume.scale.set(0.9 + 0.15 * flick, len, 0.9 + 0.15 * flick);
        f.core.scale.set(1, len * (0.85 + 0.3 * Math.sin(time * 71 + ph)), 1);
        f.coreMat.opacity = 0.45 * thrust;
        f.plumeMat.opacity = (0.15 + 0.07 * Math.sin(time * 61 + ph)) * thrust;
      }
    },
  };
}
