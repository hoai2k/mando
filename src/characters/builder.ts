import * as THREE from 'three';
import { buildRig, HUMAN, type Proportions, type Rig } from '../anim/skeleton';
import { buildClips } from '../anim/clips';
import { Animator } from '../anim/animator';
import { loadProp } from './authored';
import { buildLodProp } from './lod';
import { markShared } from '../core/dispose';
import { makeDarksaberBlade } from './darksaberBlade';
import { SABER_STYLES, WEAPON_PROPS, type SaberStyle, type StaffPropId } from './weaponProps';

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
  /**
   * Report ground speed (m/s) to a character that animates itself — creatures
   * on their own rig, whose gait has to keep up with how fast they are moving.
   */
  setGait?: (speed: number) => void;
  /**
   * The broodmother's egg rack: one entry per visible sac on her back.
   * < 0 = spent (shaded dark); 0..1 = the sac currently charging (dark
   * through most of it, flashing blue near the end); >= 1 = ready (white).
   * The Player controller drives it every frame from its clutch state.
   */
  setEggs?: (states: number[]) => void;
  /**
   * World position of egg-rack sac `index`, written into `out`. The laid or
   * thrown egg spawns exactly there — the sac goes dark and the same egg
   * visibly leaves her back. Returns false when there is no such sac.
   */
  eggSpot?: (index: number, out: THREE.Vector3) => boolean;
  /**
   * What egg-rack sac `index` is showing this frame: `fill` 0 (collapsed) to 1
   * (the sculpt's own egg, untouched) and `shade` on the same scale, 0 dark
   * through 1 for the full pale shell. The readout answering for itself, so a
   * check can hold the clutch to what the player actually sees rather than
   * digging through whichever rack — sculpt or stand-in — happens to be live
   * (`tools/test-brood.mjs`).
   */
  eggShown?: (index: number) => { fill: number; shade: number } | null;
  /**
   * Play this character's attack — a lunge-bite, a leg strike, a claw swipe —
   * and return its duration in seconds. Only the self-animating creatures
   * carry this: characters on the canonical humanoid rig attack through their
   * Animator's melee clips instead. Both the enemy AI's melee wind-up and the
   * player controller's melee press call it when it exists, which is what
   * keeps a beast's attack visible whether the beast is hostile or played.
   */
  attack?: () => number;
  /**
   * How far under the ground a burrowing creature is, 0 = fully surfaced to
   * 1 = fully under. The enemy AI drives it through the burrow cycle; the
   * body answers by sinking its sculpt below the surface it stands on.
   */
  setBurrow?: (depth: number) => void;
  /**
   * Has this character's authored .glb question been answered?
   *
   * False while a model that is known to exist is still downloading, true once
   * it is on — or once the load settled with no file, which makes the
   * procedural build the final look rather than a stand-in. Builds that never
   * ask for a model leave it undefined, which reads as ready.
   *
   * The menus use this to decide what they are allowed to *show*: a character
   * whose sculpt is still coming is drawn as a spinner, never as the body it
   * is about to stop being. In a match the procedural build still stands —
   * that is the fallback the drop screen's skip is knowingly buying.
   */
  modelReady?: () => boolean;
  height: number;
  /**
   * Species bulk, as a uniform scale on `root`. Gameplay code also writes
   * `root.scale` (the hit-flash pop), so anything that does has to multiply
   * this in rather than overwrite it — otherwise a dark trooper renders at
   * trooper size while its hit spheres stay elite-sized.
   */
  baseScale: number;
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
    // handed to every character in every match: match teardown must not free it
    markShared(m);
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

/** a tapered limb hung down its bone */
function limbMesh(bone: THREE.Object3D, m: THREE.Material, len: number, r0: number, r1: number): THREE.Mesh {
  return addCyl(bone, m, r0, r1, len, 0, -len / 2, 0, 0, 0, 0, 8);
}

/** the primitive suit body, for a figure with no sculpt (see `BipedOptions.skin`) */
function plainBody(rig: Rig, p: Proportions, skin: THREE.Material, torso: THREE.Material): void {
  const b = rig.bones;
  addBox(b.hips, skin, 0.34, 0.2, 0.22, 0, 0.02, 0);
  // the abdomen closes the gap between the hips and chest boxes at any proportions
  addBox(b.spine, skin, 0.34, p.spineLen + p.chestLen - 0.13, 0.235, 0, (p.chestLen - p.spineLen + 0.05) / 2, 0);
  addBox(b.chest, torso, 0.4, 0.34, 0.26, 0, 0.1, 0);
  for (const s of ['L', 'R'] as const) {
    limbMesh(b[`upperArm${s}`], skin, p.upperArmLen, 0.055, 0.05);
    limbMesh(b[`forearm${s}`], skin, p.forearmLen, 0.05, 0.042);
    limbMesh(b[`upperLeg${s}`], skin, p.upperLegLen, 0.075, 0.06);
    limbMesh(b[`lowerLeg${s}`], skin, p.lowerLegLen, 0.06, 0.05);
    addBox(b[`foot${s}`], skin, 0.11, 0.07, 0.24, 0, -0.035, 0.05);
  }
}

export interface BipedOptions {
  proportions?: Proportions;
  scale?: number;
  /**
   * A plain primitive body — suit limbs and a torso — for a figure that has
   * no sculpt and never will (the Narkina prisoners, sections/one-way-out.ts).
   * Anything with an authored model leaves this out: its body is the model,
   * or its low-LOD stand-in until the model lands.
   */
  skin?: THREE.Material;
  torso?: THREE.Material;
}

/**
 * Base biped: the canonical rig and its animator, and no body at all. The body
 * is the authored model, or until it lands its low-LOD stand-in — both hung
 * on this rig by `attachAuthored`, which every biped goes through.
 */
export function buildBiped(opts: BipedOptions = {}): { inst: CharacterInstance; rig: Rig } {
  const p = opts.proportions ?? HUMAN;
  const rig = buildRig(p);
  const clips = buildClips(p);
  const animator = new Animator(rig, clips);

  if (opts.skin) plainBody(rig, p, opts.skin, opts.torso ?? opts.skin);
  if (opts.scale && opts.scale !== 1) rig.root.scale.setScalar(opts.scale);

  const inst: CharacterInstance = {
    root: rig.root, rig, animator,
    height: rig.height * (opts.scale ?? 1),
    baseScale: opts.scale ?? 1,
  };
  return { inst, rig };
}

/**
 * Weapons follow the same rule as characters: the procedural shape is the
 * fallback, and an authored model replaces it the moment the file is there.
 * They hang off the same group, so the mount, the muzzle and every clip that
 * swings them are untouched by the swap.
 */
function swapWeapon(g: THREE.Group, id: string, length: number, orientX = 0,
  onLoad?: (root: THREE.Object3D) => void, sculpt = true): void {
  if (!sculpt) {
    // a build that asks for no sculpt (the workbench's procedural view) holds
    // the stand-in for good
    const holder = new THREE.Group();
    const standIn = buildLodProp(id);
    if (standIn) { holder.add(standIn); onLoad?.(standIn); }
    holder.rotation.x = orientX;
    g.add(holder);
    return;
  }
  // Marked while the file is in flight, so anything that has to depict the
  // finished fighter can wait for the weapon as well as the body — a
  // character-select picture shot with the stand-in in hand shows a blocky
  // stand-in where the model carries a rifle. Cleared either way: a weapon
  // with no sculpt is settled the moment that is known.
  g.userData.propPending = true;
  // The stand-in is the weapon's own low-LOD build (lod.ts), in the sculpt's
  // frame, so whatever `onLoad` does to seat the sculpt it does to the
  // stand-in first.
  const prop = loadProp(id, length, {
    axis: 'longest',
    lod: true,
    onStandIn: onLoad,
    onLoad,
    onSettle: () => { g.userData.propPending = false; },
  });
  // The sculpts lie along their longest axis, which is Z; a weapon mounted
  // along Y needs the model turned to match before anything that holds it
  // will hold it the same way.
  prop.rotation.x = orientX;
  g.add(prop);
}

/**
 * Is every authored prop under `root` either in place or known not to exist?
 *
 * "Settled", not "loaded": a weapon with no sculpt on disk answers true, since
 * the stand-in is then the final look and there is nothing left to wait for.
 */
export function propsSettled(root: THREE.Object3D): boolean {
  let waiting = false;
  root.traverse((o) => { if (o.userData.propPending) waiting = true; });
  return !waiting;
}

/**
 * The weapon builders: an empty mount group holding the weapon's sculpt, which
 * stands on its low-LOD build until it lands. `sculpt: false` holds the
 * stand-in for good.
 */
export function makeGaffi(propId: StaffPropId = 'gaffi', sculpt = true): THREE.Group {
  const g = new THREE.Group();
  swapWeapon(g, propId, WEAPON_PROPS[propId].length, -Math.PI / 2, undefined, sculpt);
  return g;
}

export function makeCarbine(sculpt = true): THREE.Group {
  const g = new THREE.Group();
  swapWeapon(g, 'carbine', WEAPON_PROPS.carbine.length, 0, undefined, sculpt);
  return g;
}

/** Additive material for blade/bolt glows — never cached, never a shadow caster. */
function glowMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  return markShared(new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
}

/**
 * Curved-hilt energy sword: a short kinked hilt and a red blade. The blade is
 * an FX mesh (white-hot core in two red sheaths), lives in its own subgroup so
 * an authored hilt swap leaves it alone, and casts no shadow.
 */
/** What a lit blade asks `SaberLights` for (see `makeSaber`). */
export interface SaberLightSpec {
  color: number;
  intensity: number;
  /** where along the blade the light sits, blade-local Y */
  y: number;
}

export function makeSaber(opts: { light?: boolean; style?: SaberStyle; sculpt?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  const white = opts.style === 'white';
  const darksaber = opts.style === 'darksaber';
  const tonfa = opts.style === 'tonfa';
  const double = opts.style === 'double';
  // The outer group is the editable hand attachment; hilt and blade hang off a
  // pivot inside it, so a clip can turn the weapon in the hand (see
  // `gripSpin.ts`). A tonfa pivots on its cross-grip, a straight hilt at the
  // grip itself.
  const spin = new THREE.Group();
  const body = new THREE.Group();
  if (tonfa) {
    spin.position.set(0, 0.08, 0.01);
    body.position.copy(spin.position).multiplyScalar(-1);
  }
  spin.add(body);
  g.add(spin);
  g.userData.gripSpin = spin;
  const blade = new THREE.Group();
  // Maris' tonfa emitter is on the longer, negative-Y end of its authored
  // hilt. The previous positive-Y emitter lit the short capped end instead.
  blade.position.y = tonfa ? -0.26 : double ? 0.24 : 0.06;
  if (tonfa) blade.rotation.z = Math.PI;
  body.add(blade);
  const BLADE_LEN = tonfa ? 0.78 : 0.92;
  // the trail builder needs the blade's frame and reach to sample tip arcs
  g.userData.blade = blade;
  g.userData.bladeLen = BLADE_LEN;
  g.userData.trailColor = darksaber ? [0.9, 0.95, 1.0] : tonfa || white ? [0.72, 0.87, 1.0] : [1.0, 0.22, 0.16];
  if (darksaber) {
    blade.add(makeDarksaberBlade(BLADE_LEN));
  } else for (const [r, color, opacity] of [
    [0.011, tonfa || white ? 0xffffff : 0xfff0f0, 0.95],
    [0.026, tonfa || white ? 0xe8f5ff : 0xff2a1e, 0.42],
    [0.045, tonfa || white ? 0xc9e8ff : 0xff2a1e, 0.14],
  ] as const) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, BLADE_LEN, 8), glowMat(color, opacity));
    m.position.y = BLADE_LEN / 2;
    m.castShadow = false;
    blade.add(m);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), m.material);
    tip.position.y = BLADE_LEN;
    tip.castShadow = false;
    blade.add(tip);
  }
  let opposite: THREE.Group | null = null;
  if (double) {
    // One hilt, two opposed emitters. Both ends follow the same hand and swing.
    opposite = blade.clone();
    opposite.position.y = -0.24;
    opposite.rotation.z = Math.PI;
    body.add(opposite);
    g.userData.oppositeBlade = opposite;
  }
  // A lit blade casts a soft pool of its own colour — but it does not carry a
  // light. It says what light it would cast, and `SaberLights` (fx) lends it
  // one from a fixed pool while it is out and in play. A light per blade meant
  // the scene's light count moved every time a saber was drawn, stowed or
  // thrown, and every change of count recompiles every material in the
  // scene: a second-long freeze, measured, each time the count was new.
  // Paired hilts ask for less each, so their pools overlap naturally while
  // held and separate on a throw. The Darksaber is a dark silhouette and asks
  // for nothing.
  if (opts.light !== false && !darksaber) {
    const paired = tonfa || white || opts.style === 'red';
    blade.userData.saberLight = {
      color: tonfa || white ? 0xddefff : 0xff3a24,
      intensity: paired ? 1.8 : 3.0,
      y: BLADE_LEN * 0.45,
    } satisfies SaberLightSpec;
  }
  // Measured at the generator caps of the fitted authored hilts. Their
  // origins and curved shafts differ; placing every blade at Y=.06 buried
  // most bases inside metal, while Maris' offset emitter missed its shaft.
  const hilt = SABER_STYLES[opts.style ?? 'red'].prop;
  swapWeapon(body, hilt, WEAPON_PROPS[hilt].length, -Math.PI / 2, () => {
    if (tonfa) blade.position.set(0.003, -0.255, -0.048);
    else if (double) {
      blade.position.set(-0.001, 0.211, 0);
      opposite?.position.set(0.002, -0.212, -0.001);
    } else if (white || darksaber) blade.position.set(0.001, 0.126, -0.008);
    else if (opts.style === 'dark') blade.position.set(-0.003, 0.127, -0.013);
    else blade.position.set(-0.002, 0.125, -0.029);
  }, opts.sculpt !== false);
  return g;
}

/**
 * Ribbon trail behind a saber blade: the last few frames of the blade's sweep
 * as a fading additive sheet. At combat speed the eye reads the arc, not the
 * pose — the trail is what makes a 0.2 s cut legible. Samples live in world
 * space and are rebuilt into `host` local space each frame, so the ribbon
 * hangs in the air where the blade *was* instead of riding the wrist.
 *
 * Cost: one mesh, ≤ (N-1)*2 triangles, rebuilt only while swinging.
 */
export function makeBladeTrail(host: THREE.Object3D, saber: THREE.Group, opposite = false): (dt: number, active: boolean) => void {
  const blade = (opposite ? saber.userData.oppositeBlade : saber.userData.blade) as THREE.Object3D | undefined;
  const len = (saber.userData.bladeLen as number) ?? 0.9;
  const trailColor = (saber.userData.trailColor as [number, number, number] | undefined) ?? [1, 0.22, 0.16];
  if (!blade) return () => {};
  const N = 10;            // samples kept
  const TTL = 0.13;        // seconds a sample lives
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(N * 2 * 3);
  const colors = new Float32Array(N * 2 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const index: number[] = [];
  for (let i = 0; i < N - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(index);
  // per-character material, torn down with the body — deliberately NOT the
  // shared cache, so match cleanup can dispose it
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  }));
  mesh.castShadow = false;
  mesh.frustumCulled = false;   // bounds change every frame; the mesh is tiny
  mesh.visible = false;
  host.add(mesh);
  const samples: Array<{ base: THREE.Vector3; tip: THREE.Vector3; age: number }> = [];
  const local = new THREE.Vector3();
  return (dt: number, active: boolean) => {
    for (const s of samples) s.age += dt;
    while (samples.length && samples[samples.length - 1].age > TTL) samples.pop();
    if (active && saber.visible) {
      const base = blade.getWorldPosition(new THREE.Vector3());
      const tip = blade.localToWorld(new THREE.Vector3(0, len, 0));
      samples.unshift({ base, tip, age: 0 });
      if (samples.length > N) samples.pop();
    }
    if (samples.length < 2) { mesh.visible = false; return; }
    mesh.visible = true;
    host.updateWorldMatrix(true, false);
    geo.setDrawRange(0, (samples.length - 1) * 6);
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const fade = Math.max(0, 1 - s.age / TTL);
      for (const [j, p] of [[0, s.base], [1, s.tip]] as const) {
        local.copy(p);
        host.worldToLocal(local);
        positions.set([local.x, local.y, local.z], (i * 2 + j) * 3);
        // additive: darker is more transparent, so the fade lives in the color
        colors.set(trailColor.map((c) => c * fade), (i * 2 + j) * 3);
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  };
}

/** Laser crossbow. */
export function makeCrossbow(sculpt = true): THREE.Group {
  const g = new THREE.Group();
  swapWeapon(g, 'crossbow', WEAPON_PROPS.crossbow.length, 0, undefined, sculpt);
  return g;
}

/**
 * Heavy blaster pistol — the gunslinger's pair. Short and wrist-carried, so a
 * two-handed aim clip still reads: the off-hand copy is a second instance of
 * this on `weaponL`.
 */
export function makePistol(sculpt = true): THREE.Group {
  const g = new THREE.Group();
  // The authored pistol's muzzle is at local -Z and its grip at +Z, opposite
  // the mount's forward and the shot marker. Turn only the sculpt, then seat
  // its grip in the hand so the barrel reaches the +Z muzzle at 0.3 m.
  swapWeapon(g, 'pistol', WEAPON_PROPS.pistol.length, 0, (model) => {
    model.rotation.y = Math.PI;
    model.position.set(0, 0.1, 0.12);
  }, sculpt);
  return g;
}

/** Long-barrelled hunting rifle: the carbine's heavier, slower-looking cousin. */
export function makeLongRifle(sculpt = true): THREE.Group {
  const g = new THREE.Group();
  swapWeapon(g, 'longrifle', WEAPON_PROPS.longrifle.length, 0, undefined, sculpt);
  return g;
}
