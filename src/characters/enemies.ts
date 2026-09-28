import * as THREE from 'three';
import { HUMAN, type Proportions, type Rig } from '../anim/skeleton';
import { reachArm, seatSurface } from '../anim/seating';
import { clamp, damp } from '../core/math';
import { attachAuthored, ENEMY_MODELS, loadCreature, loadProp, type CreatureId, type HumanoidKind } from './authored';
import { addCyl, addSphere, buildBiped, makeGaffi, makePistol, mat, propsSettled, type CharacterInstance } from './builder';
import { buildLodCreature, buildLodProp, type LodCreatureModel } from './lod';
import { applyTuskenWeaponGrip } from './tuskenWeaponGrips';
import { applySharedWeaponGrip } from './sharedWeaponGrips';
import { WEAPON_PROPS } from './weaponProps';
import { hipsOverFeet, NIKTO_RIDER, stanceRise, VEHICLE_ANCHORS } from '../game/vehicleAnchors';
import { addElectrostaffArcs } from './electrostaffFx';
import { attachEggRack, BROOD_EGG_RACK, eggTint, type SculptRack } from './eggrack';

// the clutch's size is the sculpt's, and it is the rack module that counts it
export { BROOD_EGG_RACK };

/** Enemy character builders — show-inspired silhouettes, procedural meshes on the canonical rig. */

/**
 * The coil-and-strike curve the procedural creature attacks share: rises 0→1
 * through the coil (the mass gathers), snaps through to -1 at the strike, and
 * eases back to rest. Mirrors the shape of the generated 'attack' clips in
 * anim/quadruped.ts, so the stand-in sculpt and the authored model read as
 * the same move.
 */
/**
 * The self-animating creatures each own a mixer with the same three-way blend
 * — idle under locomotion under a one-shot strike — and each used to weight
 * the strike at a flat 0.85 while it ran, then drop it to nothing the frame it
 * finished, so every bite and swipe snapped off its last frame back to the
 * gait. Same class of defect the humanoid one-shots had (their animator
 * clamps and fades); this is the creature copy of that fix, shared.
 *
 * `strikeAction` prepares the clip: one pass, held on its final frame rather
 * than disabled at the end. `strikeBlend` is the weight the strike gets this
 * frame — full through the body of the clip, ramping out over its final
 * 0.1 s so the held pose hands back to the gait instead of cutting to it.
 */
function strikeAction(mixer: THREE.AnimationMixer, clip: THREE.AnimationClip): THREE.AnimationAction {
  const a = mixer.clipAction(clip);
  a.setLoop(THREE.LoopOnce, 1);
  a.clampWhenFinished = true;
  return a;
}
const STRIKE_WEIGHT = 0.85;
const STRIKE_RAMP = 0.1;
function strikeBlend(action: THREE.AnimationAction | null): number {
  if (!action || !action.enabled) return 0;
  const dur = action.getClip().duration;
  if (dur <= 0) return 0;
  const left = dur - action.time;
  // never started, reset and waiting, or stopped short: not a strike in flight
  if (!action.isRunning() && left > 1e-3) return 0;
  return left <= 0 ? 0 : STRIKE_WEIGHT * Math.min(1, left / STRIKE_RAMP);
}

/** a looping idle begins somewhere in its cycle, so a pack does not breathe in step */
function startIdle(action: THREE.AnimationAction): void {
  action.play();
  action.time = Math.random() * action.getClip().duration;
}

function strikeCurve(t: number, dur: number): number {
  const ph = clamp(t / dur, 0, 1);
  if (ph < 0.3) return ph / 0.3;
  if (ph < 0.55) return 1 - ((ph - 0.3) / 0.25) * 2;
  return -1 + (ph - 0.55) / 0.45;
}

export function mountEnemyProp(group: THREE.Group, id: string, length: number,
  orientX = 0, z = 0, y = 0, flip = false, sculpt = true): void {
  // until the sculpt lands the holder carries the prop's own low-LOD build,
  // in the same frame (lod.ts); `sculpt: false` holds that for good
  let prop: THREE.Group;
  if (sculpt) {
    group.userData.propPending = true;
    prop = loadProp(id, length, {
      axis: 'longest',
      lod: true,
      onSettle: () => { group.userData.propPending = false; },
    });
  } else {
    prop = new THREE.Group();
    const standIn = buildLodProp(id);
    if (standIn) prop.add(standIn);
  }
  prop.rotation.x = orientX;
  if (flip) prop.rotation.y = Math.PI;
  prop.position.z = z;
  prop.position.y = y;
  group.add(prop);
}

function rifle(parent: THREE.Object3D, sculpt = true): THREE.Object3D {
  const g = new THREE.Group();
  g.rotation.x = Math.PI / 2;
  parent.add(g);
  mountEnemyProp(g, 'enemy_blaster_rifle', WEAPON_PROPS.enemy_blaster_rifle.length, 0, 0.14, 0, true, sculpt);
  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0.01, 0.52);
  g.add(muzzle);
  return muzzle;
}

/**
 * Give an enemy its authored skin, if one exists: the model and the height it
 * is fitted to are the kind's entry in ENEMY_MODELS. Until it lands — or in a
 * build that asks for no model — the body is that model's low-LOD stand-in
 * (lod.ts), which `attachAuthored` hangs on the rig. On load, everything
 * hanging off the canonical weapon bones re-mounts into the authored hands —
 * exactly as the players' weapons do. The canonical bones ride the hidden
 * game rig, whose proportions differ from the sculpt's, so a rifle or gaffi
 * left there floats a hand-width off the authored fist (worst at the top of a
 * swing, but visible on every aim pose too). The muzzle group lives inside the
 * weapon group and travels with it, so the firing code keeps finding it
 * wherever the gun goes; shot direction is computed from the chest, never
 * from the barrel, so aim is untouched.
 */
function authoredEnemy(inst: CharacterInstance, rig: Rig, kind: HumanoidKind, enabled = true): void {
  const { model: id, height } = ENEMY_MODELS[kind];
  const swap = attachAuthored(rig, id, height, {
    animator: inst.animator,
    keep: [rig.bones.weaponR, rig.bones.weaponL],
    enabled,
    onLoad: (model) => {
      if (model.weaponMount) for (const w of [...rig.bones.weaponR.children]) {
        model.weaponMount.add(w);
        applySharedWeaponGrip(kind, w);
      }
      if (model.weaponMountL) for (const w of [...rig.bones.weaponL.children]) {
        model.weaponMountL.add(w);
        applySharedWeaponGrip(kind, w, 'left');
      }
    },
  });
  // The grips are local to the authored hand mount, which reproduces the
  // canonical weapon bones' frame — and until the sculpt lands those bones ride
  // its low-LOD stand-in's hands. So the stand-in holds its weapons the way
  // the sculpt will (applied again on load; every grip is absolute).
  for (const w of rig.bones.weaponR.children) applySharedWeaponGrip(kind, w);
  for (const w of rig.bones.weaponL.children) applySharedWeaponGrip(kind, w, 'left');
  const prev = inst.cosmetic;
  inst.cosmetic = (dt, time) => { swap.update(); prev?.(dt, time); };
  // the menus show a spinner rather than the body underneath until this turns
  // true; `settled` covers "no file exists" too, so a kind without a sculpt is
  // presentable immediately
  inst.modelReady = () => swap.settled && propsSettled(inst.root);
}

// ---------- Tusken Raider: gaderffii ----------
export function buildTusken(authored = true): CharacterInstance {
  const { inst, rig } = buildBiped();
  const b = rig.bones;
  // gaderffii in right hand
  const gaffi = makeGaffi('gaffi_collection', authored);
  // The +Y spearhead should point with the striking arm, not up from it.
  gaffi.rotation.x = Math.PI;
  b.weaponR.add(gaffi);
  authoredEnemy(inst, rig, 'tusken', authored);
  const previous = inst.cosmetic;
  let gripClip: string | null = '';
  inst.cosmetic = (dt, time) => {
    previous?.(dt, time);
    const clip = inst.animator?.playing('upper') ?? null;
    // the stand-in's hand holds it the way the sculpt's does (see authoredEnemy)
    if (clip !== gripClip) {
      applyTuskenWeaponGrip(gaffi, clip);
      gripClip = clip;
    }
  };
  return inst;
}

// ---------- Pyke soldier: rifle ----------
const PYKE_P: Proportions = { ...HUMAN, hipHeight: 0.9, headSize: 0.34, shoulderWidth: 0.22 };
export function buildPyke(authored = true): CharacterInstance {
  const { inst, rig } = buildBiped({ proportions: PYKE_P });
  inst.muzzle = rifle(rig.bones.weaponR, authored);
  authoredEnemy(inst, rig, 'pyke', authored);
  return inst;
}

// ---------- Space pirate: rough leathers, pauldron, rifle or bare fists ----------
export function buildPirate(melee: boolean, authored = true): CharacterInstance {
  const { inst, rig } = buildBiped({ scale: 1.05 });
  const b = rig.bones;
  // the brawler fights with his fists: nothing in his hands
  if (!melee) inst.muzzle = rifle(b.weaponR, authored);
  // The blaster sculpt has a face on both sides. Use the healthy pirate
  // brawler body as a temporary skin; the gun stays a separate hand prop.
  authoredEnemy(inst, rig, melee ? 'pirateMelee' : 'pirate', authored);
  return inst;
}

// ---------- Security droid ----------
const DROID_P: Proportions = { ...HUMAN, hipHeight: 1.05, headSize: 0.3, shoulderWidth: 0.24, upperLegLen: 0.52, lowerLegLen: 0.52 };
export function buildDroid(authored = true): CharacterInstance {
  const { inst, rig } = buildBiped({ proportions: DROID_P });
  inst.muzzle = rifle(rig.bones.weaponR, authored);
  authoredEnemy(inst, rig, 'droid', authored);
  return inst;
}

// ---------- Imperial remnant: stormtrooper / death trooper ----------
export function buildStormtrooper(elite: boolean, authored = true): CharacterInstance {
  const { inst, rig } = buildBiped({ scale: elite ? 1.08 : 1 });
  inst.muzzle = rifle(rig.bones.weaponR, authored);
  authoredEnemy(inst, rig, elite ? 'deathtrooper' : 'stormtrooper', authored);
  return inst;
}

// ---------- Dark trooper: heavy flying battle droid ----------
export function buildDarkTrooper(authored = true): CharacterInstance {
  const { inst, rig } = buildBiped({ scale: 1.15 });
  inst.muzzle = rifle(rig.bones.weaponR, authored);
  authoredEnemy(inst, rig, 'darktrooper', authored);
  return inst;
}

// ---------- Allies ----------
/**
 * Escort droid — the covert's ranged ally, out of the supply cache.
 *
 * It replaced IG-11 in the ally caches on 2026-09-03: IG-11 is a playable
 * bounty hunter now, and a character you can pick off the select screen has
 * no business also walking out of a supply crate as an NPC. The niche it left
 * behind is what this fills — a tall, durable droid that lays down a long
 * volley — so the ally beat plays the same, from a body that is nobody's
 * player character.
 */
export function buildEscortDroid(authored = true): CharacterInstance {
  const p: Proportions = { ...HUMAN, hipHeight: 1.16, headSize: 0.34, shoulderWidth: 0.3, upperLegLen: 0.55, lowerLegLen: 0.55 };
  const { inst, rig } = buildBiped({ proportions: p });
  inst.muzzle = rifle(rig.bones.weaponR, authored);
  authoredEnemy(inst, rig, 'escortDroid', authored);
  return inst;
}

/** Human gunfighter ally (marshal / sharpshooter). */
export function buildGunfighter(kind: 'marshal' | 'fennec', authored = true): CharacterInstance {
  const { inst, rig } = buildBiped();
  inst.muzzle = rifle(rig.bones.weaponR, authored);
  authoredEnemy(inst, rig, kind, authored);
  return inst;
}

/**
 * Guild gunslinger — the late-wave lone shooter.
 *
 * Successor to the Cad Bane-class duelist, retired from the hostile roster on
 * 2026-09-03 when Cad Bane became playable: the same sculpt cannot be a
 * fighter you pick and an elite you shoot. The *role* survives him unchanged —
 * fast, accurate, hits hard, and folds if you can close on him — so the wave
 * tables kept their slot and only the body in it changed. A pistol in each hand.
 */
export function buildGunslinger(authored = true): CharacterInstance {
  const { inst, rig } = buildBiped();
  const b = rig.bones;
  for (const weaponBone of [b.weaponR, b.weaponL]) {
    const pistol = makePistol(authored);
    pistol.rotation.x = Math.PI / 2;
    weaponBone.add(pistol);
    if (weaponBone === b.weaponR) {
      const muzzle = new THREE.Group();
      muzzle.position.z = 0.3;
      pistol.add(muzzle);
      inst.muzzle = muzzle;
    }
  }
  authoredEnemy(inst, rig, 'gunslinger', authored);
  return inst;
}

/**
 * Moff-class Imperial officer with a double-ended electrostaff. The shaft is
 * an authored prop, with animated purple discharge on both tips at runtime.
 */
export function buildImperialOfficer(authored = true): CharacterInstance {
  const { inst, rig } = buildBiped({ scale: 1.04 });
  const staff = makeGaffi('electrostaff', authored);
  staff.rotation.x = Math.PI / 2;
  staff.rotation.z = 0.55;
  staff.position.z = -0.2;
  rig.bones.weaponR.add(staff);
  const updateArcs = addElectrostaffArcs(staff);

  authoredEnemy(inst, rig, 'officer', authored);
  const prev = inst.cosmetic;
  inst.cosmetic = (dt, time) => {
    updateArcs(time);
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
  const { inst, rig } = buildBiped({ proportions: PYKE_P });
  inst.muzzle = rifle(rig.bones.weaponR, authored);
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
  authoredEnemy(inst, rig, 'capo', authored);
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
  const WOOKIEE_P: Proportions = { ...HUMAN, hipHeight: 1.3, chestLen: 0.38, shoulderWidth: 0.36, upperArmLen: 0.42, forearmLen: 0.38 };
  const { inst, rig } = buildBiped({ proportions: WOOKIEE_P, scale: 1.05 });
  authoredEnemy(inst, rig, 'enforcer', authored);
  return inst;
}

// ---------- Nikto swoop rider: bike + seated rider, moved as one unit ----------
/**
 * War massiff — an armoured quadruped bred well past the size of the pack
 * animals the Tuskens keep. Shoulder height ~1.9 m, ~4 m nose to tail, so it
 * reads as an apex predator next to a 1.8 m trooper rather than a hound
 * underfoot. On a skeleton of its own: the gaits are code-built clips
 * (anim/quadruped.ts) generated against the sculpt's rig — and against the
 * stand-in's, which is the same rig at a low LOD (lod.ts).
 */
export function buildMassiff(authored = true): CharacterInstance {
  const root = new THREE.Group();

  // The sculpt is a quadruped on its own skeleton, so no humanoid clip reaches
  // it: it comes in through the creature path, is placed and grounded, and this
  // enemy's movement carries it. Its gaits play through a mixer that picks a
  // locomotion clip by name and plays it at a rate tied to how fast the beast
  // is actually moving. The stand-in is wired the same way, and handed over
  // when the sculpt lands.
  let mixer: THREE.AnimationMixer | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  let walkAction: THREE.AnimationAction | null = null;
  let moveAction: THREE.AnimationAction | null = null;
  /** metres covered per second of the move clip, for rate-matching the gait */
  let clipStride = 4;
  /** the walk covers far less ground per cycle than the gallop */
  let walkStride = 1.5;
  let gaitSpeed = 0;
  let attackAction: THREE.AnimationAction | null = null;
  const ATTACK_DUR = 0.6;
  const wire = (body: THREE.Object3D): void => {
    mixer = null;
    idleAction = walkAction = moveAction = attackAction = null;
    const clips = (body.userData.clips ?? []) as THREE.AnimationClip[];
    if (!clips.length) return;
    const pick = (re: RegExp): THREE.AnimationClip | undefined => clips.find((c) => re.test(c.name));
    const idle = pick(/idle|breath|stand/i);
    const walk = pick(/walk|trot|prowl/i);
    const move = pick(/run|gallop|sprint/i) ?? (walk ? undefined : pick(/move/i));
    const atk = pick(/attack|bite|strike/i);
    mixer = new THREE.AnimationMixer(body);
    if (atk) {
      attackAction = strikeAction(mixer, atk);
    }
    if (idle) { idleAction = mixer.clipAction(idle); startIdle(idleAction); }
    if (walk) {
      walkAction = mixer.clipAction(walk);
      walkAction.play();
      walkAction.setEffectiveWeight(0);
      walkStride = 1.6 / Math.max(walk.duration, 0.2);
    }
    if (move) {
      moveAction = mixer.clipAction(move);
      moveAction.play();
      moveAction.setEffectiveWeight(0);
      // a gallop cycle covers roughly a body length; close enough to keep
      // the feet from skating until the clip's real stride is known
      clipStride = 4 / Math.max(move.duration, 0.2);
    }
  };
  const standIn = buildLodCreature('massiff');
  /** false only while a sculpt that exists is still on its way (see CharacterInstance.modelReady) */
  let settled = !authored;
  if (authored) {
    const model = loadCreature('massiff', {
      onSettle: () => { settled = true; },
      onLoad: (loaded) => {
        if (standIn) standIn.holder.visible = false;
        wire(loaded);
      },
    });
    root.add(model);
  }
  // after the sculpt's holder, so a search of the body by bone name meets the
  // sculpt's bones before the stand-in's
  if (standIn) { root.add(standIn.holder); wire(standIn.model); }

  return {
    root, rig: null, animator: null, height: 2.0, baseScale: 1,
    modelReady: () => settled,
    setGait: (speed: number) => { gaitSpeed = speed; },
    attack: () => {
      if (attackAction) {
        attackAction.reset();
        attackAction.setEffectiveWeight(1);
        attackAction.play();
      }
      return ATTACK_DUR;
    },
    cosmetic: (dt) => {
      if (!mixer) return;
      // Three gaits, blended by ground speed: still → prowling walk →
      // full gallop, each rate-matched to the metres actually covered so
      // no gait skates. Below the gallop threshold the old two-way blend
      // played the gallop at 0.4x, which is slow motion, not stalking.
      // A strike in flight owns the pose: locomotion ducks under it.
      const striking = strikeBlend(attackAction);
      const moving = Math.min(gaitSpeed / 1.2, 1) * (1 - striking);
      const gallop = clamp((gaitSpeed - 2.5) / 2, 0, 1);
      if (moveAction) {
        moveAction.setEffectiveWeight(walkAction ? moving * gallop : moving);
        moveAction.timeScale = clamp(gaitSpeed / Math.max(clipStride, 0.5), 0.4, 2.2);
      }
      if (walkAction) {
        walkAction.setEffectiveWeight(moving * (1 - gallop));
        walkAction.timeScale = clamp(gaitSpeed / Math.max(walkStride, 0.3), 0.5, 1.8);
      }
      if (idleAction) idleAction.setEffectiveWeight((1 - moving) * (1 - striking));
      mixer.update(dt);
    },
  };
}

/**
 * The swoop's saddle and bars, in the bike group's own space.
 *
 * `stand` is where the *procedural* bike's saddle sits — the height every pose
 * angle in `buildNikto` was tuned against — so a sculpt whose saddle is
 * somewhere else is corrected by the difference rather than re-tuned. The bar
 * offsets are the same ones the pilotable swoop declares in `VEHICLE_DEFS`,
 * because it is the same sculpt.
 */
const SWOOP_SEAT = { x: 0, z: -0.28, stand: 0.67 };
const SWOOP_BARS = { x: 0.28, y: 0.29, z: 0.23 };
/**
 * Where the sculpt's saddle came out, in the bike group's space — measured
 * once for the whole session rather than once per rider.
 *
 * `nikto_swoop.glb` is eighty thousand triangles and the measurement is a
 * dozen rays through it; a wave can post half a dozen of these fighters in a
 * frame, and six of those measurements in one frame is a stall long enough
 * for the browser to kill the renderer for not answering. Every rider is on
 * the same bike, so they all get the same answer.
 */
let swoopSaddleY: number | null = null;
/** the swoop's keel over the ground, at rest — its hover height (VEHICLE_DEFS.swoop.hover) */
const BIKE_REST = 0.55;

export function buildNikto(authored = true): CharacterInstance {
  const group = new THREE.Group();
  // The swoop bike is a vehicle, not a character — nothing animates it, so it
  // comes in through the prop path, standing on its own low-LOD build (lod.ts)
  // until the sculpt lands.
  const bike = new THREE.Group();
  // the drive flame is an effect, not the bike's body: it stays whichever
  // build of the bike is showing
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 8), new THREE.MeshBasicMaterial({ color: 0x77bbff, transparent: true, opacity: 0.8 }));
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(0, 0, -1.35);
  bike.add(flame);
  bike.position.y = BIKE_REST;
  group.add(bike);
  let bikeSettled = !authored;
  /** what the rider is seated and gripped against: the sculpt, once it lands */
  let swoopModel: THREE.Object3D | null = null;
  /** only a measurement of the sculpt is worth remembering for every rider */
  let swoopIsSculpt = false;
  if (authored) {
    const swoop = loadProp('nikto_swoop', 2.6, {
      lod: true,
      onSettle: () => { bikeSettled = true; swoopModel = swoop; swoopIsSculpt = true; },
    });
    bike.add(swoop);
  } else {
    const standIn = buildLodProp('nikto_swoop');
    if (standIn) { bike.add(standIn); swoopModel = standIn; }
  }
  // rider (statically posed on the canonical rig — no clips needed)
  const { inst: rider, rig: riderRig } = buildBiped();
  const rb = riderRig.bones;
  const D = Math.PI / 180;
  const pose: Array<[THREE.Object3D, number, number, number]> = [
    [rb.upperLegL, -95 * D, 0, -8 * D], [rb.upperLegR, -95 * D, 0, 8 * D],
    [rb.lowerLegL, 100 * D, 0, 0], [rb.lowerLegR, 100 * D, 0, 0],
    [rb.chest, 22 * D, 0, 0],
    [rb.upperArmL, -70 * D, 20 * D, 0], [rb.upperArmR, -70 * D, -20 * D, 0],
    [rb.forearmL, -30 * D, 0, 0], [rb.forearmR, -30 * D, 0, 0],
    [rb.head, -14 * D, 0, 0],
  ];
  for (const [o, x, y, z] of pose) o.rotation.set(x, y, z);
  // The rider rides the bike: parented to it, so the hover bob, the roll and
  // the ram's nose-dip carry the body with them. Positions below are in the
  // bike's space, whose origin is the keel, BIKE_REST over the ground. Seated
  // so the pelvis sits just above the stand-in saddle (top ~0.67 over the
  // ground): the rig's origin is at the feet, so the root goes well below the
  // keel. The body on the rig — sculpt or its low-LOD stand-in — has the
  // sculpt's hips, which sit lower than the game rig's, so the root is raised
  // to meet the saddle with them from the start.
  rider.root.position.set(0, -0.09 - BIKE_REST, -0.1);
  bike.add(rider.root);

  // The rider is a whole biped on the canonical rig, just held in one pose
  // rather than animated, so the swap works exactly as it does for anyone
  // else — the retarget simply reproduces the same seated pose every frame.
  const swap = attachAuthored(riderRig, ENEMY_MODELS.nikto.model, ENEMY_MODELS.nikto.height, {
    keep: [rb.weaponR, rb.weaponL],
    enabled: authored,
  });

  /**
   * Put the rider's hands on the bars: the swoop's grip anchor from the
   * workbench when it has one (the same sculpt as the pilotable swoop, in the
   * same frame), or the bars `VEHICLE_DEFS` declares, off the saddle.
   */
  const handsToBars = (saddleY: number): void => {
    bike.updateMatrixWorld(true);
    const anchor = VEHICLE_ANCHORS.swoop;
    const fwd = new THREE.Vector3();
    group.getWorldDirection(fwd);
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    for (const side of [-1, 1] as const) {
      const local = anchor
        ? new THREE.Vector3(side === 1 ? anchor.grip[0] : 2 * anchor.seat[0] - anchor.grip[0], anchor.grip[1], anchor.grip[2])
        : new THREE.Vector3(SWOOP_SEAT.x + side * SWOOP_BARS.x, saddleY + SWOOP_BARS.y, SWOOP_SEAT.z + SWOOP_BARS.z);
      const grip = bike.localToWorld(local);
      const hint = grip.clone().addScaledVector(right, side * 0.5);
      hint.y -= 0.4;
      reachArm(riderRig, side === 1 ? 'L' : 'R', grip, hint);
    }
  };

  /**
   * Sit the rider on the swoop it is actually riding, and put its hands on
   * the bars.
   *
   * Every number in the pose above is measured against the procedural box the
   * bike used to be. The sculpt's saddle is somewhere else and its bars are
   * somewhere else again, so on the authored build this fighter rode along
   * beside its own bike holding nothing. Both are read off the sculpt the
   * frame after it lands: the saddle by the same footprint probe the pilotable
   * rides use, the bars by the grips the swoop's own definition declares.
   * Hand-placed anchors from the workbench win over both: the rider's own
   * (`NIKTO_RIDER`), then the swoop's seat. Done once — the rider is a still
   * pose, not an animation.
   */
  let seated = false;
  let saddle = SWOOP_SEAT.stand - BIKE_REST;
  const seatRider = (): void => {
    if (seated || !swoopModel) return;
    seated = true;
    group.updateMatrixWorld(true);
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    group.getWorldDirection(fwd);
    right.set(fwd.z, 0, -fwd.x);
    // only a measurement of the sculpt is worth remembering for every rider
    let saddleY = swoopIsSculpt ? swoopSaddleY : null;
    if (saddleY === null) {
      const at = bike.localToWorld(new THREE.Vector3(SWOOP_SEAT.x, 3, SWOOP_SEAT.z));
      const world = seatSurface(swoopModel, at, fwd, right, 5);
      if (world === null) return;
      saddleY = bike.worldToLocal(new THREE.Vector3(at.x, world, at.z)).y;
      if (swoopIsSculpt) swoopSaddleY = saddleY;
    }
    saddle = saddleY;
    const seat = VEHICLE_ANCHORS.swoop?.seat;
    if (NIKTO_RIDER) {
      rider.root.position.set(...NIKTO_RIDER.position);
      rider.root.rotation.set(...NIKTO_RIDER.rotation.map((d) => d * D) as [number, number, number]);
    } else if (seat) {
      rider.root.position.set(seat[0], seat[1] - stanceRise('saddle', hipsOverFeet({ rig: riderRig })), seat[2]);
    } else {
      // the pose above is tuned to the *stand-in* saddle, so this corrects it
      // by however far the sculpt's own saddle differs — which keeps the
      // tuning for the stand-in rider and the retargeted one both
      rider.root.position.y += saddle - (SWOOP_SEAT.stand - BIKE_REST);
    }
    handsToBars(saddle);
  };
  // the workbench moves the rider by hand and asks for the hands again
  group.userData.niktoRider = { bike, rider: rider.root, handsToBars: () => handsToBars(saddle) };

  // the swoop's melee is a ram: nose dipped and driven forward, then pulled up
  let attackT = -1;
  const ATTACK_DUR = 0.45;
  /** how fast it is going, eased, for the pitch and the lean into the run */
  let speed = 0;
  let speedTarget = 0;
  return {
    root: group, rig: null, animator: null, height: 1.6, baseScale: 1,
    // rider and bike are two separate files: this fighter is only presentable
    // once both have answered, or a menu shows an authored rider on a box
    modelReady: () => bikeSettled && swap.settled,
    attack: () => { attackT = 0; return ATTACK_DUR; },
    // At speed the nose goes down into the run and the tail burns long; parked
    // it sits level on a lazy hover. Reported by the enemy's move each frame.
    setGait: (v) => { speedTarget = v; },
    cosmetic: (dt, time) => {
      swap.update();
      if (swap.settled) seatRider();
      speed = damp(speed, speedTarget, 4, dt);
      const run = clamp(speed / 15, 0, 1);
      bike.position.y = BIKE_REST + Math.sin(time * (6 + run * 3)) * (0.05 - run * 0.025);
      bike.rotation.z = Math.sin(time * 3.1) * (0.06 + run * 0.05);
      bike.rotation.x = run * 0.1;
      flame.scale.y = (0.8 + run * 0.9) + Math.sin(time * 40) * 0.2;
      if (attackT >= 0) {
        attackT += dt;
        if (attackT > ATTACK_DUR) attackT = -1;
        else {
          const w = strikeCurve(attackT, ATTACK_DUR);
          bike.rotation.x += w * 0.28;          // nose down on the coil, whipped up through
          bike.position.y += Math.max(0, -w) * 0.12;
        }
      }
    },
  };
}

// ---------- Incinerator trooper: flame projector ----------
export function buildFlametrooper(authored = true): CharacterInstance {
  const { inst, rig } = buildBiped();
  const proj = new THREE.Group();
  proj.rotation.x = Math.PI / 2;
  rig.bones.weaponR.add(proj);
  mountEnemyProp(proj, 'flame_projector', WEAPON_PROPS.flame_projector.length, 0, 0.2, 0, true, authored);
  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0.01, 0.5);
  proj.add(muzzle);
  inst.muzzle = muzzle;
  authoredEnemy(inst, rig, 'flametrooper', authored);
  return inst;
}

// ---------- Krykna: pale cave spider on its own free-form rig ----------
/**
 * Human-scale skitterer (the playtest rule holds: nothing smaller than a
 * person). On a rig of its own like the massiff: the sculpt comes in through
 * `loadCreature` and plays the code-built clips from GENERATED_CLIPS (its file
 * ships none), and until it lands its low-LOD stand-in plays the same clips on
 * the same skeleton.
 */
function buildKryknaBase(
  scale: number, authored: boolean, creatureId: CreatureId,
  /** the stand-in, as it is built: the broodmother's stand-in clutch rides on it */
  decorate?: (standIn: LodCreatureModel) => void,
  /** the sculpt, the moment it lands: the broodmother's clutch rides on it */
  onModel?: (model: THREE.Object3D) => void,
): CharacterInstance {
  const root = new THREE.Group();

  // blended and rate-matched to the gait like the massiff
  let mixer: THREE.AnimationMixer | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  let moveAction: THREE.AnimationAction | null = null;
  let attackAction: THREE.AnimationAction | null = null;
  const ATTACK_DUR = 0.55;
  let clipStride = 3;
  const wire = (body: THREE.Object3D): void => {
    mixer = null;
    idleAction = moveAction = attackAction = null;
    const clips = (body.userData.clips ?? []) as THREE.AnimationClip[];
    if (!clips.length) return;
    const idle = clips.find((c) => /idle|breath|stand/i.test(c.name));
    const move = clips.find((c) => /run|gallop|sprint|walk|trot|move/i.test(c.name));
    const atk = clips.find((c) => /attack|strike|bite/i.test(c.name));
    mixer = new THREE.AnimationMixer(body);
    if (atk) {
      attackAction = strikeAction(mixer, atk);
    }
    if (idle) { idleAction = mixer.clipAction(idle); startIdle(idleAction); }
    if (move) {
      moveAction = mixer.clipAction(move);
      moveAction.play();
      moveAction.setEffectiveWeight(0);
      // a skitter cycle covers roughly a body length and a half
      clipStride = 1.6 / Math.max(move.duration, 0.2);
    }
  };
  const standIn = buildLodCreature(creatureId);
  let settled = !authored;
  if (authored) {
    const model = loadCreature(creatureId, {
      onSettle: () => { settled = true; },
      onLoad: (loaded) => {
        if (standIn) standIn.holder.visible = false;
        onModel?.(loaded);
        wire(loaded);
      },
    });
    root.add(model);
  }
  // after the sculpt's holder: a search by bone name meets the sculpt first
  if (standIn) {
    root.add(standIn.holder);
    decorate?.(standIn);
    wire(standIn.model);
  }
  root.scale.setScalar(scale);

  let gaitSpeed = 0;
  return {
    root, rig: null, animator: null, height: 1.7 * scale, baseScale: scale,
    modelReady: () => settled,
    setGait: (speed: number) => { gaitSpeed = speed; },
    attack: () => {
      if (attackAction) {
        attackAction.reset();
        attackAction.setEffectiveWeight(1);
        attackAction.play();
      }
      return ATTACK_DUR;
    },
    cosmetic: (dt) => {
      if (!mixer) return;
      const striking = strikeBlend(attackAction);
      const moving = Math.min(gaitSpeed / 4, 1) * (1 - striking);
      if (moveAction) {
        moveAction.setEffectiveWeight(moving);
        moveAction.timeScale = clamp(gaitSpeed / Math.max(clipStride, 0.5), 0.5, 2.4);
      }
      if (idleAction) idleAction.setEffectiveWeight((1 - moving) * (1 - striking));
      mixer.update(dt);
    },
  };
}

export function buildKrykna(authored = true): CharacterInstance {
  return buildKryknaBase(1, authored, 'krykna');
}

/**
 * A laid krykna egg (the playable broodmother's Y): the same pale sac that
 * rides her abdomen, set down whole. It breathes — a slow pulse that
 * quickens as nothing in particular, since the egg doesn't know its own
 * clock; the wobble is what tells a rival it's live and worth shooting.
 */
export function buildSpiderEgg(): CharacterInstance {
  const sac = mat(0xd8e4da, { rough: 0.5, emissive: 0x2a3a24 });
  const web = mat(0x8d867a, { rough: 0.9 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.42;
  root.add(body);
  addSphere(body, sac, 0.4, 0, 0, 0, 12, 9, 1.15, 0.95);
  addSphere(body, sac, 0.18, 0.2, 0.28, 0.12, 8, 6);
  addSphere(body, sac, 0.14, -0.22, 0.24, -0.1, 8, 6);
  // web strands anchoring it to the ground
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    addCyl(root, web, 0.01, 0.02, 0.5, Math.cos(a) * 0.34, 0.2, Math.sin(a) * 0.34, 0.9 * Math.sin(a), 0, 0.9 * Math.cos(a), 5);
  }
  return {
    root, rig: null, animator: null, height: 0.9, baseScale: 1,
    cosmetic: (dt, time) => {
      const pulse = 1 + Math.sin(time * 4.2) * 0.04 + Math.sin(time * 13) * 0.015;
      body.scale.set(pulse, 2 - pulse, pulse);
    },
  };
}

/** What hatches from it: a half-size krykna on the same rig and clips. */
export function buildSpiderling(): CharacterInstance {
  return buildKryknaBase(0.55, true, 'krykna');
}

/**
 * Where the stand-in's rack sits: `[x, y, z, radius]` in the character root's
 * frame — the sculpt's own six eggs, measured off it with the stand-in
 * (`buildLodCreature`'s `eggs`). These are only the fallback for a
 * measurement that has none.
 *
 * Only the stand-in needs them. The authored sculpt carries six real eggs and
 * the game drives those (`characters/eggrack.ts`); the stand-in wears spheres
 * in the same spots so a queen whose .glb has not landed still has an
 * ammunition readout to look at.
 */
const RACK_SPOTS: readonly (readonly number[])[] = [
  [0, 1.00, -0.80, 0.16],
  [-0.23, 1.05, -0.72, 0.17],
  [0.23, 1.05, -0.72, 0.17],
  [-0.22, 1.25, -0.62, 0.17],
  [0.22, 1.25, -0.62, 0.17],
  [0, 1.35, -0.55, 0.17],
];

/** How small a spent stand-in sac gets: slack, not gone. */
const EMPTY_FILL = 0.38;
/** and a slack sac is flatter than a full one, not merely smaller */
const SLACK_SQUASH = 0.55;
/** how fast a sac fills and empties, in units of fullness per second */
const FILL_RATE = 3.5;
const EMPTY_RATE = 7;

const EGG_SPENT = new THREE.Color(0x0a0c0a);
// the sculpt's own eggs are a warm cream, not white; a readout that ignored
// that read as six plastic balls stuck on her back
const EGG_READY = new THREE.Color(0xdfdcc4);
const GLOW_SPENT = new THREE.Color(0x000000);
const GLOW_READY = new THREE.Color(0x4c5142);

/** Broodmother: half again the size, darker, egg sacs riding the abdomen. */
export function buildBroodmother(authored = true): CharacterInstance {
  // Her clutch is the playable broodmother's ammunition readout (docs/MODES.md
  // §3), and there are six because the sculpt carries six — real geometry on
  // her abdomen, not decoration laid over it. Once the .glb is in, the game
  // drives those eggs themselves: a ready egg is the sculpt untouched and a
  // spent one is that same egg darkened and collapsed against her back.
  //
  // Until then — and forever, on a board where the file never arrives — the
  // stand-in spider wears the six spheres built below instead, where the
  // sculpt's own eggs are. They hang off the stand-in, so the moment the
  // sculpt lands and the stand-in goes invisible they go with it, and there is
  // never a frame wearing both.
  let rack: SculptRack | null = null;
  const rackMeshes: THREE.Mesh[] = [];
  const inst = buildKryknaBase(1.65, authored, 'krykna_brood', (standIn) => {
    const spots = standIn.eggs.length >= BROOD_EGG_RACK ? standIn.eggs : RACK_SPOTS;
    for (const [x, y, z, r] of spots.slice(0, BROOD_EGG_RACK)) {
      // a shell, not a bead: rough enough that six of them do not read as one
      // glossy mass when the whole clutch is up
      const m = new THREE.MeshStandardMaterial({ color: 0x0a0c0a, roughness: 0.78 });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), m);
      // the spots are in the root's frame, which the stand-in's holder shares
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      // A readout, not skin: the player's hurt flash clones every material it
      // finds and drives it red, which would both steal these out from under
      // the closure below and paint the clutch a colour that means something
      // else. This flag is what keeps the flash off them.
      mesh.userData.readout = true;
      // Hidden until something drives it. The same body fights as a wave boss,
      // where nobody is counting her eggs and no one calls setEggs — she would
      // otherwise wear six black balls for no reason. The first push of the
      // rack state is what brings it out.
      mesh.visible = false;
      standIn.holder.add(mesh);
      rackMeshes.push(mesh);
    }
  }, (model) => {
    // the sculpt is in: take its own eggs, and let the stand-in's go dark
    rack = attachEggRack(model);
  });

  // the delivered egg spawns at the egg it left, so it reads as the same egg
  inst.eggSpot = (index, out) => {
    if (rack?.spot(index, out)) return true;
    const mesh = rackMeshes[index];
    if (!mesh) return false;
    mesh.getWorldPosition(out);
    return true;
  };
  // How full each sac is *on screen*, which lags what the clutch says: a sac
  // fills as the egg grows in it and collapses when the egg leaves, and both
  // read better eased than snapped. `want` is the clutch's answer, `fill` is
  // what the body is showing on the way there.
  const want = new Array(BROOD_EGG_RACK).fill(0);
  const fill = new Array(BROOD_EGG_RACK).fill(0);
  const raw = new Array(BROOD_EGG_RACK).fill(-1);
  const tint = new THREE.Color();
  let driven = false;

  /** Paint and size sac `i` from its eased fullness. */
  const dress = (i: number): void => {
    const f = fill[i];
    const s = raw[i];
    // The sculpt's own egg, when there is one: full and pale at ready, dark
    // and slack at spent, and the shader mixes the two.
    if (rack) {
      rack.setFill(i, f);
      rack.setTint(i, eggTint(s, f, tint));
      return;
    }
    // ...and the stand-in's bead, which has no egg underneath it to reveal, so
    // it says the same thing by collapsing to a slack shell instead.
    const mesh = rackMeshes[i];
    if (!mesh) return;
    const k = EMPTY_FILL + (1 - EMPTY_FILL) * f;
    mesh.scale.set(k, k * (SLACK_SQUASH + (1 - SLACK_SQUASH) * f), k);
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (s >= 0.72 && s < 1) {
      // the last beat of the charge: a couple of blue flashes
      const flash = Math.sin(((s - 0.72) / 0.28) * Math.PI * 4) > 0;
      m.color.setHex(flash ? 0x6fa8ff : 0x2a3448);
      m.emissive.setHex(flash ? 0x2a5fc0 : 0x101a30);
      return;
    }
    // black when empty through pale when ready, so a half-grown egg is visibly
    // half-grown in colour as well as in size
    m.color.copy(EGG_SPENT).lerp(EGG_READY, f);
    m.emissive.copy(GLOW_SPENT).lerp(GLOW_READY, f);
  };

  inst.setEggs = (states) => {
    driven = true;
    for (let i = 0; i < BROOD_EGG_RACK; i++) {
      if (rackMeshes[i]) rackMeshes[i].visible = true;
      const s = states[i] ?? -1;
      raw[i] = s;
      want[i] = s >= 1 ? 1 : Math.max(0, s);
      dress(i);
    }
  };

  // What the rack is showing right now, for the checks that read it back
  // (tools/test-brood.mjs): how full sac `i` looks and how brightly it reads,
  // 0 for a spent sac and 1 for the sculpt's own pale egg.
  inst.eggShown = (index) => {
    if (index < 0 || index >= BROOD_EGG_RACK) return null;
    if (rack) return rack.shown(index);
    const m = rackMeshes[index]?.material as THREE.MeshStandardMaterial | undefined;
    if (!m) return null;
    const lum = m.color.r * 0.2126 + m.color.g * 0.7152 + m.color.b * 0.0722;
    // the stand-in's own pale bead is the brightest it goes, so report against
    // that rather than against white — the two racks answer on one scale
    const top = EGG_READY.r * 0.2126 + EGG_READY.g * 0.7152 + EGG_READY.b * 0.0722;
    return { fill: fill[index], shade: lum / top };
  };

  const prevCosmetic = inst.cosmetic;
  inst.cosmetic = (dt, time) => {
    prevCosmetic?.(dt, time);
    if (!driven) return;
    // The hurt flash takes private copies of the body's materials, and a copy
    // does not carry the rack's shader hook: this puts it back on whatever the
    // mesh is wearing now, rather than shading a material nothing draws.
    rack?.refresh();
    for (let i = 0; i < BROOD_EGG_RACK; i++) {
      // Filling is slow because the egg is: it tracks the three-second charge
      // rather than racing it. Emptying is quick — the egg physically left her
      // back — but not instant, or the sac would pop out of existence.
      const rate = want[i] > fill[i] ? FILL_RATE : EMPTY_RATE;
      fill[i] = damp(fill[i], want[i], rate, dt);
      dress(i);
    }
  };
  return inst;
}

// ---------- Quarren netcaster: squid-faced dock hand turned hostile ----------
export function buildQuarren(authored = true): CharacterInstance {
  const { inst, rig } = buildBiped();
  // net launcher: a stubby wide-mouthed tube
  const launcher = new THREE.Group();
  rig.bones.weaponR.add(launcher);
  mountEnemyProp(launcher, 'net_launcher', WEAPON_PROPS.net_launcher.length, 0, 0.12, 0, true, authored);
  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0, 0.38);
  launcher.add(muzzle);
  inst.muzzle = muzzle;
  authoredEnemy(inst, rig, 'quarren', authored);
  return inst;
}

// ---------- Alamite: pale cave-dweller of the Mandalore ruins ----------
export function buildAlamite(authored = true): CharacterInstance {
  const P: Proportions = { ...HUMAN, hipHeight: 0.92, chestLen: 0.34, shoulderWidth: 0.3, upperArmLen: 0.38, forearmLen: 0.34 };
  const { inst, rig } = buildBiped({ proportions: P });
  // crude stone club
  const club = new THREE.Group();
  club.rotation.x = Math.PI / 2;
  rig.bones.weaponR.add(club);
  mountEnemyProp(club, 'alamite_stone_club', WEAPON_PROPS.alamite_stone_club.length, Math.PI / 2, 0, 0.14, false, authored);
  authoredEnemy(inst, rig, 'alamite', authored);
  return inst;
}

// ---------- Imperial interceptor drone: probe-droid-style kamikaze flier ----------
export function buildInterceptorDrone(authored = true): CharacterInstance {
  const root = new THREE.Group();
  let mixer: THREE.AnimationMixer | null = null;
  const wire = (body: THREE.Object3D): void => {
    mixer = null;
    const clips = (body.userData.clips ?? []) as THREE.AnimationClip[];
    if (clips.length) {
      mixer = new THREE.AnimationMixer(body);
      mixer.clipAction(clips[0]).play();   // one looping hover-idle is the whole performance
    }
  };
  const standIn = buildLodCreature('interceptor_drone');
  let settled = !authored;
  if (authored) {
    const model = loadCreature('interceptor_drone', {
      onSettle: () => { settled = true; },
      onLoad: (loaded) => {
        if (standIn) standIn.holder.visible = false;
        wire(loaded);
      },
    });
    root.add(model);
  }
  if (standIn) { root.add(standIn.holder); wire(standIn.model); }
  return {
    root, rig: null, animator: null, height: 1.7, baseScale: 1,
    modelReady: () => settled,
    cosmetic: (dt) => { mixer?.update(dt); },
  };
}

// ---------- Ringworld enforcer: shielded heavy — flank him or go around ----------
/**
 * The tower shield is the sculpt's own; the real block is the shield collider
 * the enemy code raises, facing wherever he faces.
 */
export function buildRingEnforcer(authored = true): CharacterInstance {
  const { inst, rig } = buildBiped({ scale: 1.1 });
  inst.muzzle = rifle(rig.bones.weaponR, authored);
  authoredEnemy(inst, rig, 'ringEnforcer', authored);
  return inst;
}

// ---------- monster bosses: the creature sculpts (docs/BOSSES.md) ----------

/**
 * A monster boss: its sculpt, on the code clips `anim/quadruped.ts` builds
 * against its rig, and until that lands its low-LOD stand-in (lod.ts) on the
 * same rig playing the same clips — so a boss whose file is slow, or never
 * comes, is still that animal, at the right size, moving the way it will.
 */
function buildMonsterBase(
  creatureId: CreatureId, height: number, length: number,
  opts: {
    /**
     * A colossus that is only half on the surface (docs/BOSSES.md §2.5, §2.6).
     * The sculpt is a whole animal; `sink` drops it into the ground by that
     * many metres and `pitch` rears the front up out of it, so what stands
     * above the surface is the head, neck and forelimbs and the body runs away
     * underneath. The buried part is not hidden — it is *under the terrain*,
     * which is what makes the intersection read when the ground opens.
     */
    buried?: { sink: number; pitch: number };
  } = {},
): CharacterInstance {
  const root = new THREE.Group();

  // blended and rate-matched to ground speed exactly as the massiff and
  // spiders are
  let mixer: THREE.AnimationMixer | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  let moveAction: THREE.AnimationAction | null = null;
  let attackAction: THREE.AnimationAction | null = null;
  /** matches the 'attack' clip durations in anim/quadruped.ts, close enough */
  const ATTACK_DUR = 0.85;
  let clipStride = 3;
  const wire = (body: THREE.Object3D): void => {
    mixer = null;
    idleAction = moveAction = attackAction = null;
    const clips = (body.userData.clips ?? []) as THREE.AnimationClip[];
    if (!clips.length) return;
    mixer = new THREE.AnimationMixer(body);
    const idle = clips.find((c) => c.name === 'idle');
    const move = clips.find((c) => c.name === 'move');
    const atk = clips.find((c) => c.name === 'attack') ?? clips.find((c) => /attack|strike|bite/i.test(c.name));
    if (atk) {
      attackAction = strikeAction(mixer, atk);
    }
    if (idle) { idleAction = mixer.clipAction(idle); startIdle(idleAction); }
    if (move) {
      moveAction = mixer.clipAction(move);
      moveAction.play();
      moveAction.setEffectiveWeight(0);
      // one cycle carries the animal about its own length
      clipStride = length / Math.max(move.duration, 0.2);
    }
  };
  const standIn = buildLodCreature(creatureId);
  let settled = false;
  const sculpt = loadCreature(creatureId, {
    onSettle: () => { settled = true; },
    onLoad: (loaded) => {
      if (standIn) standIn.holder.visible = false;
      wire(loaded);
    },
  });
  const holders = [sculpt, ...(standIn ? [standIn.holder] : [])];
  if (opts.buried) {
    // `loadCreature` stands the sculpt on the ground; this puts it back under.
    // The pitch is applied to the holder rather than the model so the clips,
    // which are authored in the model's own space, are unaffected by it.
    for (const h of holders) {
      h.position.y = -opts.buried.sink;
      h.rotation.x = opts.buried.pitch;
    }
  }
  // the stand-in after the sculpt's holder: a search by bone name meets the sculpt first
  for (const h of holders) root.add(h);
  if (standIn) wire(standIn.model);

  let gaitSpeed = 0;
  return {
    root, rig: null, animator: null, height, baseScale: 1,
    modelReady: () => settled,
    setGait: (speed: number) => { gaitSpeed = speed; },
    attack: () => {
      if (attackAction) {
        attackAction.reset();
        attackAction.setEffectiveWeight(1);
        attackAction.play();
      }
      return ATTACK_DUR;
    },
    cosmetic: (dt) => {
      if (!mixer) return;
      const striking = strikeBlend(attackAction);
      const moving = Math.min(gaitSpeed / 3, 1) * (1 - striking);
      if (moveAction) {
        moveAction.setEffectiveWeight(moving);
        moveAction.timeScale = clamp(gaitSpeed / Math.max(clipStride, 0.5), 0.6, 2.2);
      }
      if (idleAction) idleAction.setEffectiveWeight((1 - moving) * (1 - striking));
      mixer.update(dt);
    },
  };
}

/** Waystation's smuggled beast: a one-horned woolly bull, 2.6 m at the shoulder. */
export function buildMudhorn(): CharacterInstance {
  return buildMonsterBase('mudhorn', 3.0, 4.5);
}

/** The Crevasse ice-breaker: a tusked leviathan on four broad flippers. */
export function buildRavinak(): CharacterInstance {
  return buildMonsterBase('ravinak', 3.4, 8);
}

/** Trask's harbour monster, finally surfaced. */
export function buildMamacore(): CharacterInstance {
  return buildMonsterBase('mamacore', 4.6, 12);
}

/** Nevarro's pit monster, loosed on the town square. */
export function buildRancor(): CharacterInstance {
  return buildMonsterBase('rancor', 5.0, 4);
}

/**
 * The Dune Sea's burrowing dragon. Only the front of it is ever on the
 * surface: the sculpt is sunk and reared so the skull, collar and burrowing
 * claws stand clear of the sand and the body runs away beneath it.
 */
export function buildKraytDragon(): CharacterInstance {
  // Sunk 3 m and reared: measured against the rig, that leaves the skull at
  // ~4.8 m, the collar and both burrowing claws clear of the sand, the front of
  // the body breaking the surface, and everything from `body3` back under it.
  return buildMonsterBase('krayt_dragon', 5.4, 18, { buried: { sink: 3.0, pitch: -0.34 } });
}

/** The Great Forge's sleeper, rising out of the Living Waters. */
export function buildMythosaur(): CharacterInstance {
  // Same treatment, shallower: the horns, skull, neck and both foreclaws stand
  // out of the water and `back` sits on the surface, which is the cut the model
  // brief asked for.
  return buildMonsterBase('mythosaur', 8.0, 12, { buried: { sink: 1.6, pitch: -0.34 } });
}

// ---------- the second monster batch (docs/BOSSES.md §2.7–2.10) ----------

/** The Refinery's specimen: an armored crawler, five metres at the shoulder and twelve long. */
export function buildZillo(): CharacterInstance {
  return buildMonsterBase('zillo', 5.0, 12);
}

/** The Ringworld's night hunter: a quilled cat, landspeeder-sized and faster than one. */
export function buildNexu(): CharacterInstance {
  return buildMonsterBase('nexu', 2.2, 5.0);
}

/** The Prison Rig's amphibian, hauled up out of the moon pool onto the decks. */
export function buildKwazelMaw(): CharacterInstance {
  return buildMonsterBase('kwazel_maw', 4.2, 9);
}

/** nose to tail, metres — the sculpt is fitted to this along its long axis */
const WORM_LENGTH = 40;
/** joints in the delivered spine chain (`spine1` at the tail … `spine24` at the head) */
const WORM_SEGMENTS = 24;
/** how far under the surface the head sits while the worm is hunting */
const WORM_SINK = 7.5;
/** how high the head rears above the surface once it has broken through */
const WORM_REAR = 5.2;
/**
 * The travelling wave down the body: amplitude, and how far it is biased under
 * the sand so only the crests break out.
 *
 * Amplitude and period are not free of each other. A joint can only climb as
 * far as the segment in front of it is long, so a wave steeper than
 * `restStep` per joint is one the body physically cannot follow: the chain
 * goes taut, every joint falls short of its target, and the error piles up
 * along the body until the head cannot reach the ground it is supposed to be
 * diving under. `A * 2π / period` is that per-joint climb, and it is kept
 * comfortably under the segment length — which for a forty-metre animal on 24
 * joints means one long swell down the body rather than a row of little humps.
 */
const WORM_WAVE = 4.0;
const WORM_WAVE_BIAS = 1.0;
/** joints one full wave spans */
const WORM_WAVE_PERIOD = 24;
/** how fast the wave runs down the body, radians a second */
const WORM_WAVE_SPEED = 1.1;
/**
 * Joints behind the head that blend from the head's own height into the wave.
 * Long enough that the dive is a slope the body can actually make: the head
 * drops `WORM_SINK` over this many segments, so too few and the neck is asked
 * to fall further than it can reach.
 */
const WORM_NECK = 8;

/**
 * The Dune Sea's worm (docs/BOSSES.md §2.7): one continuous forty-metre animal
 * laid along the path its own head has travelled.
 *
 * Everything else in the game is a body at a position. This is a body along a
 * *history*: the game moves only the head, and the rest of the worm is solved
 * each frame onto a trail of where that head has been, with a travelling wave
 * deciding which stretches of it are above the sand. That is what makes the
 * humps read as the same animal — they follow its turns, they are attached, and
 * there is no cut face to hide. It replaces three separate arch props that used
 * to chase the head at fixed distances.
 *
 * The solver drives two different things through one path. Before the sculpt
 * lands it is a chain of plated segments placed straight onto the targets; once
 * the sculpt is in it is the delivered `spine1..24` bone chain, walked from the
 * tail forward with each bone aimed at the next joint's target. Both read the
 * same trail, so the stand-in moves exactly like the real thing.
 */
/**
 * Draw every mesh under `o` unconditionally.
 *
 * For a body whose parts are posed in world space each frame — a worm laid
 * along its own trail — a bounding sphere measured from the rest pose is not
 * a statement about where anything is, so the cull it drives is a coin toss.
 */
function noCulling(o: THREE.Object3D): void {
  o.traverse((n) => { (n as THREE.Mesh).frustumCulled = false; });
}

export function buildSandworm(): CharacterInstance {
  const root = new THREE.Group();

  // ---- the body: the sculpt, or until it lands its low-LOD stand-in ----
  // Both are the same spine chain, so the solver below lays either one along
  // the trail the same way. The stand-in's bones carry a prefix of their own:
  // anything that looks the worm's head up by name means the sculpt's.
  let settled = false;
  let chain: THREE.Object3D[] | null = null;   // spine1 … spine24, head
  let jaw: THREE.Object3D | null = null;
  let restStep = 1;                            // metres between joints, once fitted
  /** the holder the chain hangs in, which the solver moves to put the tail in place */
  let holder: THREE.Object3D = root;
  const adopt = (loaded: THREE.Object3D, into: THREE.Object3D, prefix = ''): boolean => {
    const find = (n: string): THREE.Object3D | null => {
      let hit: THREE.Object3D | null = null;
      loaded.traverse((o) => { if (!hit && o.name === prefix + n) hit = o; });
      return hit;
    };
    const links: THREE.Object3D[] = [];
    for (let i = 1; i <= WORM_SEGMENTS; i++) {
      const b = find(`spine${i}`);
      if (!b) return false;                    // an unexpected rig: keep what stands
      links.push(b);
    }
    const headBone = find('head');
    if (!headBone) return false;
    links.push(headBone);
    // The rest spacing is what the solver has to sample the path at, or the
    // mesh stretches between joints. Measured on the fitted model, so it is
    // already in metres.
    loaded.updateMatrixWorld(true);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    links[0].getWorldPosition(a);
    links[1].getWorldPosition(b);
    restStep = a.distanceTo(b) || 1;
    chain = links;
    jaw = find('jaw');
    holder = into;
    noCulling(loaded);
    return true;
  };
  // Fitted by its longest axis rather than its height: the file is a straight
  // forty-metre worm, so its height says nothing about its size. Not grounded
  // either — the solver below decides where every part of it sits.
  const standIn = buildLodCreature('sandworm', { prefix: 'lod_' });
  const sculpt = loadProp('sandworm', WORM_LENGTH, {
    axis: 'longest',
    onSettle: () => { settled = true; },
    onLoad: (loaded) => {
      if (adopt(loaded, sculpt) && standIn) standIn.holder.visible = false;
    },
  });
  root.add(sculpt);
  // Forty metres of animal, solved onto a trail, with every part of it placed
  // by hand each frame. Three culls a mesh by the bounding sphere of its rest
  // pose carried through its world matrix — which here describes the head's
  // model at the holder's position and says nothing about where the body
  // actually is. So the whole worm winked out while humps of it were still on
  // screen and above the sand, which is what a playtest reported. One animal
  // is not worth culling; draw it.
  if (standIn && !chain) {
    root.add(standIn.holder);
    adopt(standIn.model, standIn.holder, 'lod_');
  }

  // ---- the path the body is laid along ----
  // World points of where the root has been, newest last, sampled about every
  // metre. Long enough to carry the whole animal plus slack for its turns.
  const trail: THREE.Vector3[] = [];
  const TRAIL_STEP = 1.0;
  const TRAIL_MAX = Math.ceil(WORM_LENGTH / TRAIL_STEP) + 24;
  let seeded = false;
  const seedTrail = (): void => {
    seeded = true;
    const yaw = root.rotation.y;
    // straight out behind it, so a worm that has only just spawned still has a body
    for (let k = TRAIL_MAX; k >= 1; k--) {
      trail.push(new THREE.Vector3(
        root.position.x - Math.sin(yaw) * k * TRAIL_STEP,
        root.position.y,
        root.position.z - Math.cos(yaw) * k * TRAIL_STEP));
    }
  };

  /** how far under the surface the head is, 0 surfaced … 1 fully under */
  let depth = 1;
  const _p = new THREE.Vector3();
  const _q = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _side = new THREE.Vector3();
  const _third = new THREE.Vector3();
  const _basis = new THREE.Matrix4();
  // `aim` runs inside the same frame as the world-to-local transform above it,
  // so it keeps its own matrix rather than borrowing that one
  const _aimBasis = new THREE.Matrix4();
  const _rot = new THREE.Quaternion();
  const _inv = new THREE.Quaternion();
  const targets: THREE.Vector3[] = [];
  for (let i = 0; i <= WORM_SEGMENTS; i++) targets.push(new THREE.Vector3());
  /** how high each joint rides this frame, head first */
  const lifts = new Float64Array(WORM_SEGMENTS + 1);

  /**
   * Walk back along the trail and put a joint every `step` metres, then lift
   * each one by the wave. `targets[0]` is the tail and the last is the head, so
   * the array reads the same way the bone chain is parented.
   */
  const solve = (time: number, step: number): void => {
    const head = root.position;
    if (!seeded) seedTrail();
    if (trail[trail.length - 1].distanceToSquared(head) > TRAIL_STEP * TRAIL_STEP) {
      trail.push(head.clone());
      if (trail.length > TRAIL_MAX) trail.shift();
    }
    const n = WORM_SEGMENTS;
    // How high each joint rides, worked out before any of them is placed,
    // because the spacing along the ground depends on it.
    const headY = (1 - depth) * WORM_REAR - depth * WORM_SINK;
    for (let seg = 0; seg <= n; seg++) {
      // The wave runs down the body, biased under the surface so most of the
      // animal is buried and only the crests break out — the whole read of the
      // creature.
      const phase = (seg / WORM_WAVE_PERIOD) * Math.PI * 2 - time * WORM_WAVE_SPEED;
      let lift = Math.sin(phase) * WORM_WAVE - WORM_WAVE_BIAS;
      // The joints just behind the head blend into whatever the head is doing,
      // so the neck curves down into the sand instead of kinking at the skull.
      // `seg` counts joints back from the head — reading it from the other end
      // lifted the tail out of the sand and left the head riding the wave,
      // which is a worm that surfaces backwards.
      if (seg < WORM_NECK) {
        const t = seg / WORM_NECK;
        lift = headY * (1 - t) + lift * t;
      }
      lifts[seg] = lift;
    }
    let k = trail.length - 1;
    let walked = 0;
    let want = 0;
    _p.copy(head);
    for (let seg = 0; seg <= n; seg++) {
      if (seg > 0) {
        // A joint is a fixed length, and part of it is spent climbing. Walking
        // a whole segment's worth along the *ground* each time asks the body to
        // cover more than it has, and every joint after it falls a little
        // further behind — which ends with the head short of where the burrow
        // cycle put it. So the ground step is the segment with its climb taken
        // out of it, and never so short that a steep stretch stalls on the spot.
        const dy = lifts[seg] - lifts[seg - 1];
        want += Math.sqrt(Math.max(step * step - dy * dy, step * step * 0.0625));
      }
      while (walked < want && k > 0) {
        const next = trail[k - 1];
        const d = _p.distanceTo(next);
        if (walked + d >= want) {
          _p.lerp(next, (want - walked) / (d || 1));
          walked = want;
          break;
        }
        walked += d;
        _p.copy(next);
        k--;
      }
      // The trail carries the ground height where the head was standing at the
      // time, so the body follows the dunes it crossed rather than hanging off
      // whatever height the head happens to be at now.
      // index 0 is the tail, so fill from the back
      targets[n - seg].set(_p.x, _p.y + lifts[seg], _p.z);
    }
  };

  /** point `bone` (whose own axis runs along local +Y) from `at` toward `to` */
  const aim = (bone: THREE.Object3D, at: THREE.Vector3, to: THREE.Vector3): void => {
    _dir.subVectors(to, at);
    if (_dir.lengthSq() < 1e-8) return;
    _dir.normalize();
    // a full basis rather than a shortest-arc rotation, so the body cannot roll
    // as it turns — a twisting worm reads as a broken one
    _side.crossVectors(_up, _dir);
    if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
    _side.normalize();
    _third.crossVectors(_side, _dir).normalize();
    _aimBasis.makeBasis(_side, _dir, _third);
    _rot.setFromRotationMatrix(_aimBasis);
    const parent = bone.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(_inv).invert();
      bone.quaternion.copy(_inv).multiply(_rot);
    } else {
      bone.quaternion.copy(_rot);
    }
    bone.updateMatrixWorld(true);
  };

  let gaitSpeed = 0;
  let attackT = -1;
  const ATTACK_DUR = 0.95;
  return {
    root, rig: null, animator: null, height: 5.5, baseScale: 1,
    modelReady: () => settled,
    setGait: (speed) => { gaitSpeed = speed; },
    setBurrow: (d) => { depth = d; },
    attack: () => { attackT = 0; return ATTACK_DUR; },
    cosmetic: (dt, time) => {
      if (attackT >= 0) { attackT += dt; if (attackT > ATTACK_DUR) attackT = -1; }
      solve(time, restStep);

      // The whole solve is done in world space, because the trail is a world
      // history; the body is then carried into the root's frame, which the enemy
      // controller is meanwhile moving and turning.
      root.updateMatrixWorld(true);
      const toLocal = _basis.copy(root.matrixWorld).invert();

      if (chain) {
        // the sculpt: place the tail, then aim each bone at the next joint
        const first = chain[0];
        _p.copy(targets[0]).applyMatrix4(toLocal);
        // `first` hangs under the rig node inside the holder, so the holder is
        // what carries it to the tail's target
        first.getWorldPosition(_q);
        holder.position.add(_p.sub(_q.applyMatrix4(toLocal)));
        holder.updateMatrixWorld(true);
        for (let i = 0; i < chain.length - 1; i++) {
          chain[i].getWorldPosition(_p);
          aim(chain[i], _p, targets[i + 1]);
        }
        // The head is the end of the chain, so nothing behind it aims it and it
        // would simply inherit the neck's bearing — a surfaced worm lying flat
        // on the sand with its mouth pointing along the ground. Carry it on past
        // the last joint, lifted while it is out, so the maw comes up to face
        // whatever it is about to bite.
        const headBone = chain[chain.length - 1];
        headBone.getWorldPosition(_p);
        _dir.subVectors(targets[targets.length - 1], targets[targets.length - 2]);
        if (_dir.lengthSq() > 1e-8) {
          _dir.normalize();
          _q.copy(_p).addScaledVector(_dir, restStep);
          _q.y += (1 - depth) * restStep * 1.1;
          aim(headBone, _p, _q);
        }
        if (jaw) {
          // the mandibles gape through the strike and snap shut on it
          const w = attackT >= 0 ? Math.max(0, strikeCurve(attackT, ATTACK_DUR)) : 0;
          jaw.rotation.x = w * 0.7;
        }
        return;
      }

      void gaitSpeed;
    },
  };
}
