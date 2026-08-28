import * as THREE from 'three';
import { markOwned } from '../core/dispose';
import { addBox, addCyl, addSphere, attachCape, buildBiped, makeCarbine, makeCrossbow, makeGaffi, makeLongRifle, makeSaber, mat, type CharacterInstance } from './builder';
import { attachAuthored } from './authored';

/**
 * Playable characters — one config-driven factory so every fighter shares the
 * same rig, clips and gameplay; only look and loadout differ. Two families
 * share it: helmeted Mandalorians, and bare-headed underworld hunters (config
 * `helmet: null`), who bring their own heads and signature weapons.
 *
 * (The Mando* names predate the hunters; every id below rides the same type.)
 */

export type MandoId = 'din' | 'paz' | 'bokatan' | 'armorer' | 'ventress' | 'embo' | 'bossk' | 'ig11';

export interface PlayerCharacter extends CharacterInstance {
  setWeapon: (w: 'blaster' | 'gaffi') => void;
  setThrust: (t: number) => void;
  /** intensity of the fill light that travels with this character */
  setHeroLight: (intensity: number) => void;
  /** raise (1) or drop (0) the block shield; values between animate it */
  setBlock: (t: number) => void;
  /** flash the shield where a bolt bounced off it */
  shieldHit: () => void;
  gaffi: THREE.Group;
  /** thruster mouths, in world space — where the jet particles are born */
  nozzles: THREE.Object3D[];
  /** true once the authored .glb has replaced the procedural body */
  modelReady: () => boolean;
}

/** visual height per character, used to size an authored model */
/**
 * Height the authored model is normalised to, in metres, BEFORE the config's
 * bulk scale multiplies it — so Paz at 1.67 x 1.16 stands 1.94 m broad rather
 * than the 2.24 m tower the old 2.0 x 1.12 made of him.
 */
const MODEL_HEIGHT: Record<MandoId, number> = {
  din: 1.85, paz: 1.67, bokatan: 1.75, armorer: 1.78,
  ventress: 1.79, embo: 1.78, bossk: 1.9, ig11: 2.2,
};

interface MandoConfig {
  name: string;
  desc: string;
  primary: number;   // main armor plate color
  accent: number;    // pauldrons / details
  suit: number;      // under-suit
  cape: number | null;
  /** Mando helmet variant, or null for a bare-headed hunter (head built per id) */
  helmet: MandoId | null;
  rangefinder: boolean;
  bulk: number;      // 1 = standard; Paz is heavier
  /**
   * Extra width-only multiplier on top of bulk (x/z, never y) for characters
   * that should read broad rather than tall. Kept small: limbs under a
   * non-uniform parent scale stretch as they swing, invisible below ~10%.
   */
  broad?: number;
  /** signature loadout — defaults are the shared carbine and gaffi */
  ranged?: 'carbine' | 'crossbow' | 'longrifle';
  melee?: 'gaffi' | 'sabers';
  /** exposed skin colour, for anyone without a bucket on their head */
  skin?: number;
  /**
   * Where the flight flames live: on the worn jetpack (default), or under the
   * feet for a character that flies on leg thrusters — no pack is built, and
   * the flames ride the foot bones so they angle with the legs in flight.
   */
  thrusters?: 'jetpack' | 'feet';
}

/** HUD display names for each loadout slot. */
export const RANGED_NAMES = { carbine: 'EE-3 Carbine', crossbow: 'Laser Crossbow', longrifle: 'Long Rifle' } as const;
export const MELEE_NAMES = { gaffi: 'Gaffi Stick', sabers: 'Twin Sabers' } as const;

/** What a character's HUD calls the weapon currently in hand. */
export function weaponDisplayName(id: MandoId, weapon: 'blaster' | 'gaffi'): string {
  const cfg = MANDO_ROSTER[id];
  return weapon === 'blaster' ? RANGED_NAMES[cfg.ranged ?? 'carbine'] : MELEE_NAMES[cfg.melee ?? 'gaffi'];
}

export const MANDO_ROSTER: Record<MandoId, MandoConfig> = {
  din: {
    name: 'Kell Dravan', desc: 'The wanderer in pure beskar shine — this is the way.',
    primary: 0xb4bac2, accent: 0x6d7178, suit: 0x4a4239, cape: 0x5a4632, helmet: 'din', rangefinder: false, bulk: 1,
  },
  paz: {
    name: 'Torva Brekk', desc: 'Heavy infantry of the covert — a walking siege wall.',
    primary: 0x2e4a72, accent: 0x1e2c42, suit: 0x33363c, cape: null, helmet: 'paz', rangefinder: false, bulk: 1.16, broad: 1.08,
  },
  bokatan: {
    name: 'Vess Ordane', desc: 'Night owl of the old clans — born to the creed, and to rule it.',
    primary: 0x2f5c8a, accent: 0xb03a3a, suit: 0x2a2d33, cape: null, helmet: 'bokatan', rangefinder: true, bulk: 0.95,
  },
  armorer: {
    name: 'The Forgemistress', desc: 'Keeper of the forge — she shapes the beskar and the creed alike.',
    primary: 0xb59440, accent: 0x6b5320, suit: 0x2e2a24, cape: 0x4a3b22, helmet: 'armorer', rangefinder: false, bulk: 0.98,
  },
  ventress: {
    name: 'Sylla Morvane', desc: 'Twin red blades and a dancer\u2019s patience \u2014 the assassin of the outer dark.',
    primary: 0x33363e, accent: 0x1e2026, suit: 0x2a2c33, cape: null, helmet: null, rangefinder: false, bulk: 0.93,
    melee: 'sabers', skin: 0xcdc3ba,
  },
  embo: {
    name: 'Karshii', desc: 'The hat, the bow, the silence \u2014 a hunter who never wastes a bolt.',
    primary: 0x6d5a3a, accent: 0x59452a, suit: 0x4a3f2e, cape: 0x8a3328, helmet: null, rangefinder: false, bulk: 1.0,
    ranged: 'crossbow', skin: 0x7a8a4f,
  },
  bossk: {
    name: 'Skarvek', desc: 'Cold blood and a long rifle \u2014 he could smell you a board away.',
    primary: 0xc4b285, accent: 0x8a7a55, suit: 0xb0a077, cape: null, helmet: null, rangefinder: false, bulk: 1.08,
    ranged: 'longrifle', skin: 0x8ba03f,
  },
  ig11: {
    name: 'VX-9', desc: 'Hunter-killer droid on its second conscience \u2014 precision, now with mercy by choice.',
    primary: 0x8a8578, accent: 0x5f5a4e, suit: 0x736e62, cape: null, helmet: null, rangefinder: false, bulk: 0.94,
    ranged: 'longrifle', skin: 0x8a8578, thrusters: 'feet',
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
  if (cfg.broad) { rig.root.scale.x *= cfg.broad; rig.root.scale.z *= cfg.broad; }
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

  // ---- heads: Mando helmet variants, or a hunter's own face ----
  const helm = new THREE.Group();
  b.head.add(helm);
  helm.position.y = 0.06;
  const skinMat = cfg.skin !== undefined ? mat(cfg.skin, { rough: 0.85 }) : skin;
  if (cfg.helmet === null) {
    buildHunterHead(id, helm, skinMat, prim, accent, dark);
  } else {
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
    case 'bokatan':
      // Nite Owl swept wings either side of the crown
      addBox(helm, accent, 0.02, 0.09, 0.13, -0.13, 0.09, -0.02, 0, 0, 0.45);
      addBox(helm, accent, 0.02, 0.09, 0.13, 0.13, 0.09, -0.02, 0, 0, -0.45);
      break;
    case 'armorer':
      // horned forge helm
      addCyl(helm, accent, 0.005, 0.035, 0.22, -0.1, 0.16, 0.02, -0.5, 0, -0.5);
      addCyl(helm, accent, 0.005, 0.035, 0.22, 0.1, 0.16, 0.02, -0.5, 0, 0.5);
      break;
  }
  }

  // ---- jetpack (shared Z-6 silhouette, accent-tinted) ----
  const feetThrusters = cfg.thrusters === 'feet';
  if (!feetThrusters) {
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
  }
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
  // Two flame mounts: the pack's twin nozzles, or one sole per foot.
  const flameMounts: Array<[THREE.Object3D, number, number, number]> = feetThrusters
    ? [[b.footL, 0, -0.07, 0.03], [b.footR, 0, -0.07, 0.03]]
    : [[flameRoot, -0.08, NOZZLE_Y, -0.04], [flameRoot, 0.08, NOZZLE_Y, -0.04]];
  const flames: Flame[] = flameMounts.map(([mount, x, y, z]) => {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.visible = false;
    mount.add(group);
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

  // ---- weapons: signature ranged + melee per config, carbine/gaffi default ----
  const gunmetal = mat(0x3d3730, { rough: 0.5, metal: 0.5 });
  const rangedKind = cfg.ranged ?? 'carbine';
  const ranged =
    rangedKind === 'crossbow' ? makeCrossbow(gunmetal, dark) :
    rangedKind === 'longrifle' ? makeLongRifle(gunmetal, dark) :
    makeCarbine(gunmetal, dark);
  ranged.rotation.x = Math.PI / 2;
  b.weaponR.add(ranged);
  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0.015, { carbine: 0.62, crossbow: 0.5, longrifle: 0.95 }[rangedKind]);
  ranged.add(muzzle);
  // The melee prop keeps the gaffi's mount and orientation whatever it looks
  // like, so the melee clips swing a saber exactly as they swing the staff.
  // Twin sabers add an off-hand hilt on weaponL that shows and hides with it.
  let offhand: THREE.Group | null = null;
  let melee: THREE.Group;
  if (cfg.melee === 'sabers') {
    melee = makeSaber(silver, dark);
    offhand = makeSaber(silver, dark);
    offhand.rotation.x = Math.PI / 2;
    offhand.visible = false;
    b.weaponL.add(offhand);
  } else {
    melee = makeGaffi(mat(0x6b4c2c, { rough: 0.95 }), silver);
  }
  melee.rotation.x = Math.PI / 2;
  melee.visible = false;
  b.weaponR.add(melee);

  // ---- block shield ----
  // A force field, not a pane with a border: the body of the dome carries the
  // effect and the edge falls out of it. A Fresnel term brightens the surface
  // where it turns away from the eye, which is what makes a curved field read
  // as a volume; a hex interference pattern drifts across it so it looks
  // energised rather than painted; and a hit sends a ring out from the point
  // of impact. The old bright torus rim did all the work and left the middle
  // empty, so the whole thing read as an outline.
  const shieldRoot = new THREE.Group();
  b.chest.add(shieldRoot);
  shieldRoot.position.set(0, 0.14, 0.34);
  const shieldMat = new THREE.ShaderMaterial({
    uniforms: {
      uStrength: { value: 0 },
      uFlash: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x63b4ff) },
      uHot: { value: new THREE.Color(0xdcefff) },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormalV;
      varying vec3 vViewV;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalMatrix * normal;
        vViewV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uStrength;
      uniform float uFlash;
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uHot;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      varying vec2 vUv;

      // distance to the nearest hex cell edge, for the interference lattice
      float hexEdge(vec2 p) {
        p.x *= 1.1547;
        p.y += mod(floor(p.x), 2.0) * 0.5;
        p = abs(fract(p) - 0.5);
        return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
      }

      void main() {
        if (uStrength <= 0.001) discard;
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewV);
        // grazing angles glow: the dome gains a body instead of a border
        float fres = pow(1.0 - abs(dot(n, v)), 2.4);

        // lattice drifting across the surface — kept faint, it is a texture on
        // the field, not the field itself
        vec2 hp = vec2(vUv.x * 15.0 + uTime * 0.10, vUv.y * 15.0 - uTime * 0.04);
        float cells = smoothstep(0.09, 0.0, hexEdge(hp)) * 0.14;

        // slow standing ripple so an idle field still breathes
        float shimmer = sin(vUv.y * 34.0 - uTime * 2.4) * 0.5 + 0.5;

        // impact ring travelling out from the centre of the dome
        float r = vUv.y / 0.46;
        float ring = smoothstep(0.16, 0.0, abs(r - (1.0 - uFlash))) * uFlash;

        // the dome is double-sided, so a head-on look adds the far wall to the
        // near one; the halved total keeps the middle see-through
        float a = (0.05 + fres * 0.8 + cells + shimmer * 0.05 + ring * 1.0) * uStrength * 0.62;
        vec3 col = mix(uColor, uHot, clamp(fres * 0.55 + ring, 0.0, 1.0));
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // a little bigger than before, and opened out slightly so it covers more
  const SHIELD_R = 0.72, SHIELD_ARC = Math.PI * 0.46;
  const shieldGeo = new THREE.SphereGeometry(SHIELD_R, 30, 16, 0, Math.PI * 2, 0, SHIELD_ARC);
  const shieldSkin = new THREE.Mesh(shieldGeo, shieldMat);
  shieldSkin.rotation.x = Math.PI / 2;   // cap opens forward, along +Z
  shieldRoot.add(shieldSkin);
  // a faint edge, sitting exactly on the dome's lip so it reads as the field
  // ending rather than as a frame drawn around it
  const rimMat = new THREE.MeshBasicMaterial({
    color: 0x9fd0ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(SHIELD_R * Math.sin(SHIELD_ARC), 0.012, 8, 40), rimMat);
  rim.position.z = SHIELD_R * Math.cos(SHIELD_ARC);
  shieldRoot.add(rim);
  shieldRoot.visible = false;
  let shieldFlash = 0;

  // ---- hero ambient ----
  // The player is the one thing that must never be lost against a board, and
  // the station is dark enough — cold key, no sky bounce, a nebula reflection
  // probe — that beskar reads as a silhouette there.
  //
  // This is a per-character lift rather than a light: Three tests a light's
  // layers against the camera, never against the object it falls on, so there
  // is no way to aim one at the hero alone. Instead his materials are cloned
  // and given an emissive term driven by their own texture, which brightens
  // the artwork that is already there and cannot touch anything else on the
  // board.
  const heroMats: THREE.MeshStandardMaterial[] = [];
  let heroAmbient = 0;
  function adoptHeroMaterials(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const many = Array.isArray(mesh.material);
      const source: THREE.Material[] = many ? mesh.material as THREE.Material[] : [mesh.material as THREE.Material];
      const cloned = source.map((m): THREE.Material => {
        const std = m as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) return m;      // muzzle flash, flames
        const c = markOwned(std.clone());   // a per-player copy, not the shared cache entry
        // self-lit by its own surface: where there's a texture the emissive
        // follows it, so the lift reads as ambience rather than a colour wash
        c.emissiveMap = c.map;
        c.emissive = c.map ? new THREE.Color(0xffffff) : c.color.clone();
        c.emissiveIntensity = heroAmbient;
        heroMats.push(c);
        return c;
      });
      mesh.material = many ? cloned : cloned[0];
    });
  }
  adoptHeroMaterials(rig.root);

  // ---- authored model swap ----
  // The procedural build above stays as the animation source and the instant
  // fallback; if models/<id>.glb loads, its skin rides the same rig instead.
  const swap = attachAuthored(rig, id, MODEL_HEIGHT[id], {
    // weapons, thruster flames and the shield pane belong to the character,
    // not to the body being replaced
    keep: [b.weaponR, b.weaponL, flameRoot, shieldRoot, ...flames.map((f) => f.group)],
    enabled: opts.authored !== false,
    onLoad: (model) => {
      adoptHeroMaterials(model.root);   // the skin arrives after the pass above
      // weapons move onto the authored hand so they track the real fingers; the
      // mount reproduces our canonical weaponR frame, so nothing else changes
      if (model.weaponMount) {
        model.weaponMount.add(ranged);
        model.weaponMount.add(melee);
      }
      // the jetpack rides the authored back, so keep the flames with our bone
      // but sit them where the model's thrusters actually are
      if (!feetThrusters) flameRoot.position.y = -0.02;
    },
  });

  let thrust = 0;
  let weapon: 'blaster' | 'gaffi' = 'blaster';
  let shieldUp = false;
  const showWeapon = () => {
    ranged.visible = !shieldUp && weapon === 'blaster';
    melee.visible = !shieldUp && weapon === 'gaffi';
    if (offhand) offhand.visible = melee.visible;
  };
  return {
    ...inst,
    muzzle,
    gaffi: melee,
    modelReady: () => swap.settled,
    setWeapon: (w) => { weapon = w; showWeapon(); },
    nozzles: flames.map((f) => f.group),
    setThrust: (t) => { thrust = t; },
    setBlock: (t) => {
      // both hands go to the shield, so the weapon is stowed while it is up
      const up = t > 0.5;
      if (up !== shieldUp) { shieldUp = up; showWeapon(); }
      shieldRoot.visible = t > 0.02;
      // it grows into place rather than popping, and sits flat until it is up
      shieldRoot.scale.setScalar(0.55 + t * 0.45);
      shieldMat.uniforms.uStrength.value = t;
      rimMat.opacity = 0.22 * t;
    },
    shieldHit: () => { shieldFlash = 1; },
    setHeroLight: (intensity) => {
      heroAmbient = intensity;
      for (const m of heroMats) m.emissiveIntensity = intensity;
    },
    cosmetic: (dt, time) => {
      shieldMat.uniforms.uTime.value = time;
      if (shieldFlash > 0) {
        // the ring runs out from the centre and the lip lifts with it
        shieldFlash = Math.max(0, shieldFlash - dt * 3);
        rimMat.opacity += shieldFlash * 0.3;
      }
      shieldMat.uniforms.uFlash.value = shieldFlash;
      swap.update();
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

/**
 * Bare heads for the hunter roster. Same budget philosophy as the helmets:
 * a few primitives that read at 30 m, standing in until the authored model.
 */
function buildHunterHead(
  id: MandoId, helm: THREE.Group,
  skin: THREE.Material, prim: THREE.Material, accent: THREE.Material, dark: THREE.Material,
): void {
  addSphere(helm, skin, 0.13, 0, 0.03, 0, 14, 12, 1.05, 1);   // skull
  switch (id) {
    case 'ventress': {
      // gaunt pale features: sunken dark eyes, jaw shading, tattoo bands over the crown
      addBox(helm, dark, 0.032, 0.014, 0.01, -0.05, 0.06, 0.125);
      addBox(helm, dark, 0.032, 0.014, 0.01, 0.05, 0.06, 0.125);
      addBox(helm, accent, 0.1, 0.05, 0.09, 0, -0.06, 0.05);   // jaw
      addBox(helm, dark, 0.016, 0.005, 0.16, -0.045, 0.145, -0.02, 0.15);
      addBox(helm, dark, 0.016, 0.005, 0.16, 0.045, 0.145, -0.02, 0.15);
      // high armored collar
      addCyl(helm, prim, 0.1, 0.115, 0.07, 0, -0.13, 0, 0, 0, 0, 10);
      break;
    }
    case 'embo': {
      // slatted rebreather over the lower face, and the hat
      for (let i = 0; i < 3; i++) addBox(helm, dark, 0.12, 0.016, 0.02, 0, -0.045 + i * 0.028, 0.115);
      addBox(helm, accent, 0.14, 0.09, 0.03, 0, -0.03, 0.1);   // mask body behind the slats
      addBox(helm, dark, 0.03, 0.012, 0.01, -0.045, 0.065, 0.12);  // shaded eyes
      addBox(helm, dark, 0.03, 0.012, 0.01, 0.045, 0.065, 0.12);
      const hat = new THREE.Group();
      hat.position.y = 0.13;
      hat.rotation.x = 0.08;
      helm.add(hat);
      addCyl(hat, prim, 0.34, 0.36, 0.022, 0, 0, 0, 0, 0, 0, 18);  // the wide brim
      addCyl(hat, prim, 0.12, 0.16, 0.06, 0, 0.035, 0, 0, 0, 0, 14); // crown
      addCyl(hat, accent, 0.125, 0.125, 0.02, 0, 0.012, 0, 0, 0, 0, 14); // band
      break;
    }
    case 'ig11': {
      // the skull sphere reads as a neck joint under the cylinder head
      addCyl(helm, skin, 0.075, 0.09, 0.16, 0, 0.09, 0, 0, 0, 0, 12);
      addCyl(helm, prim, 0.078, 0.078, 0.035, 0, 0.055, 0, 0, 0, 0, 12);  // sensor collar
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        addSphere(helm, mat(0xc9401e, { rough: 0.3, emissive: 0x401508 }), 0.012,
          Math.sin(a) * 0.08, 0.055, Math.cos(a) * 0.08, 6, 5);
      }
      addCyl(helm, accent, 0.008, 0.008, 0.1, 0.03, 0.22, 0, 0, 0, 0, 6);  // antenna
      addSphere(helm, accent, 0.014, 0.03, 0.27, 0, 6, 5);
      break;
    }
    case 'bossk': {
      // wedge snout, needle teeth, slit eyes; the skull sits a little long
      addBox(helm, skin, 0.1, 0.075, 0.14, 0, -0.015, 0.14, 0.12);   // snout
      addBox(helm, skin, 0.075, 0.05, 0.05, 0, -0.06, 0.19);         // jaw
      for (let i = 0; i < 4; i++) {
        addBox(helm, mat(0xe8e0c8, { rough: 0.5 }), 0.008, 0.02, 0.008, -0.033 + i * 0.022, -0.045, 0.2);
      }
      addSphere(helm, mat(0xc9401e, { rough: 0.4, emissive: 0x30160a }), 0.018, -0.055, 0.055, 0.1, 8, 6);
      addSphere(helm, mat(0xc9401e, { rough: 0.4, emissive: 0x30160a }), 0.018, 0.055, 0.055, 0.1, 8, 6);
      addBox(helm, accent, 0.02, 0.03, 0.1, -0.09, 0.09, -0.02, 0, 0, -0.3);  // brow ridges
      addBox(helm, accent, 0.02, 0.03, 0.1, 0.09, 0.09, -0.02, 0, 0, 0.3);
      break;
    }
  }
}
