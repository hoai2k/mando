import * as THREE from 'three';
import { HUMAN, type Proportions, type Rig } from '../anim/skeleton';
import { reachArm, seatSurface } from '../anim/seating';
import { clamp, damp } from '../core/math';
import { attachAuthored, loadCreature, loadProp, type CreatureId } from './authored';
import { addBox, addCyl, addSphere, buildBiped, makeGaffi, mat, type CharacterInstance } from './builder';
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
  droid: 2.1, deathtrooper: 2.0, darktrooper: 2.2,
  pirate: 1.9, pirate_melee: 1.9, marshal: 1.85, fennec: 1.8, imperial_officer: 1.88,
  tusken: 1.8, pyke: 2.0, stormtrooper: 1.9, pyke_capo: 2.05, wookiee_enforcer: 2.6,
  // the swoop rider is measured standing, then posted on the saddle by the pose
  nikto: 1.76,
  // the new-board roster (see ASSETS_MODELS.md for the model briefs)
  flametrooper: 1.9, quarren: 1.9, alamite: 1.85, ring_enforcer: 2.1,
};

/**
 * Give an enemy its authored skin, if one exists. On load, everything hanging
 * off the canonical weapon bones re-mounts into the authored hands — exactly
 * as the players' weapons do. The canonical bones ride the *hidden
 * procedural* arms, whose proportions differ from the sculpt's, so a rifle or
 * gaffi left there floats a hand-width off the authored fist (worst at the
 * top of a swing, but visible on every aim pose too). The muzzle group lives
 * inside the weapon group and travels with it, so the firing code keeps
 * finding it wherever the gun goes; shot direction is computed from the
 * chest, never from the barrel, so aim is untouched.
 */
function authoredEnemy(inst: CharacterInstance, rig: Rig, id: keyof typeof AUTHORED_ENEMY, enabled = true): void {
  const swap = attachAuthored(rig, id, AUTHORED_ENEMY[id], {
    keep: [rig.bones.weaponR, rig.bones.weaponL],
    enabled,
    onLoad: (model) => {
      if (model.weaponMount) for (const w of [...rig.bones.weaponR.children]) model.weaponMount.add(w);
      if (model.weaponMountL) for (const w of [...rig.bones.weaponL.children]) model.weaponMountL.add(w);
    },
  });
  const prev = inst.cosmetic;
  inst.cosmetic = (dt, time) => { swap.update(); prev?.(dt, time); };
  // the menus show a spinner rather than the body underneath until this turns
  // true; `settled` covers "no file exists" too, so a kind without a sculpt is
  // presentable immediately
  inst.modelReady = () => swap.settled;
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
  addBox(b.chest, mat(0x5a4632, { rough: 0.9 }), 0.09, 0.4, 0.28, 0, 0.06, 0, 0, 0, -0.6);
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
  addBox(b.shoulderL, mat(0x71716d, { rough: 0.5, metal: 0.5 }), 0.18, 0.08, 0.2, 0.05, 0.05, 0, 0, 0, -0.3);
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
/**
 * Escort droid — the covert's ranged ally, out of the supply cache.
 *
 * It replaced IG-11 in the ally caches on 2026-09-03: IG-11 is a playable
 * bounty hunter now, and a character you can pick off the select screen has
 * no business also walking out of a supply crate as an NPC. The niche it left
 * behind is what this fills — a tall, durable droid that lays down a long
 * volley — so the ally beat plays the same, from a body that is nobody's
 * player character.
 *
 * Deliberately not IG's silhouette: a broad wedge skull and heavy shoulders
 * rather than a cylinder head on spindly limbs.
 */
export function buildEscortDroid(): CharacterInstance {
  const shell = mat(0x3a3d44, { rough: 0.45, metal: 0.7 });
  const p: Proportions = { ...HUMAN, hipHeight: 1.16, headSize: 0.34, shoulderWidth: 0.3, upperLegLen: 0.55, lowerLegLen: 0.55 };
  const { inst, rig } = buildBiped({ skin: shell, torso: shell, proportions: p });
  const b = rig.bones;
  const dark = mat(0x1c1e22, { rough: 0.6, metal: 0.5 });
  // wedge skull: long muzzle box under a flat brow, no cylinder anywhere
  addBox(b.head, shell, 0.19, 0.17, 0.2, 0, 0.09, 0.01);
  addBox(b.head, dark, 0.15, 0.06, 0.1, 0, 0.03, 0.12);
  const optic = mat(0x4aa8d8, { emissive: 0x14384e, rough: 0.35 });
  addSphere(b.head, optic, 0.024, -0.055, 0.11, 0.09, 6, 5);
  addSphere(b.head, optic, 0.024, 0.055, 0.11, 0.09, 6, 5);
  // heavy shoulder blocks and a slab chest: a bodyguard's frame
  addBox(b.shoulderL, dark, 0.16, 0.13, 0.17, -0.04, 0.04, 0);
  addBox(b.shoulderR, dark, 0.16, 0.13, 0.17, 0.04, 0.04, 0);
  addBox(b.chest, shell, 0.34, 0.38, 0.22, 0, 0.07, 0);
  inst.muzzle = rifle(b.weaponR);
  // No sculpt yet — `escort_droid` is an open model request (ASSETS_MODELS.md),
  // so this takes no `authored` flag: there is nothing to compare against. The
  // day the file lands, wiring it is an `authoredEnemy` call plus a height in
  // AUTHORED_ENEMY, exactly as every other kind was wired.
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
 * Guild gunslinger — the late-wave lone shooter.
 *
 * Successor to the Cad Bane-class duelist, retired from the hostile roster on
 * 2026-09-03 when Cad Bane became playable: the same sculpt cannot be a
 * fighter you pick and an elite you shoot. The *role* survives him unchanged —
 * fast, accurate, hits hard, and folds if you can close on him — so the wave
 * tables kept their slot and only the body in it changed.
 *
 * A freelancer out of the hunters' guild rather than a named face: sealed
 * breath mask under a low hood, armoured long coat, bandolier across the
 * chest, and a pistol in each hand.
 */
export function buildGunslinger(): CharacterInstance {
  const coat = mat(0x3a3229, { rough: 0.9 });
  const suitM = mat(0x241f1a, { rough: 0.9 });
  const { inst, rig } = buildBiped({ skin: suitM, torso: coat });
  const b = rig.bones;
  const plate = mat(0x6a6258, { rough: 0.55, metal: 0.4 });
  // sealed mask: a plated skull with a dark filter slot, no face showing
  addSphere(b.head, plate, 0.12, 0, 0.04, 0, 10, 8);
  addBox(b.head, mat(0x14161a, { rough: 0.4 }), 0.16, 0.05, 0.04, 0, 0.05, 0.1);
  addCyl(b.head, mat(0x8a8f98, { rough: 0.5, metal: 0.5 }), 0.03, 0.035, 0.05, 0, -0.03, 0.1, Math.PI / 2, 0, 0, 8);
  // low hood over the plate, and a collar standing off the shoulders
  addSphere(b.head, coat, 0.135, 0, 0.06, -0.02, 10, 8, 0.75, 1);
  addCyl(b.chest, coat, 0.17, 0.13, 0.09, 0, 0.26, 0, 0, 0, 0, 10);
  addBox(b.chest, coat, 0.36, 0.4, 0.24, 0, 0.08, 0);
  // bandolier: shells across the chest, the one read at a glance
  for (let i = 0; i < 6; i++) {
    addBox(b.chest, plate, 0.03, 0.055, 0.03, -0.13 + i * 0.05, 0.19 - i * 0.05, 0.12, 0, 0, 0.6);
  }
  inst.muzzle = rifle(b.weaponR);
  // No sculpt yet — `gunslinger` is an open model request (ASSETS_MODELS.md),
  // so no `authored` flag here either. `duelist.glb` is deliberately *not*
  // borrowed in the meantime: that file is Cad Bane, and reusing it would put
  // a player character straight back on the hostile side.
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
  addBox(b.chest, mat(0x9aa2b0, { rough: 0.4, metal: 0.6 }), 0.07, 0.03, 0.02, 0.13, 0.2, 0.15);  // rank plaque

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
  addBox(b.chest, mat(0x5a4632, { rough: 0.9 }), 0.11, 0.5, 0.34, 0, 0.06, 0, 0, 0, -0.5);  // bandolier
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
  let walkAction: THREE.AnimationAction | null = null;
  let moveAction: THREE.AnimationAction | null = null;
  /** metres covered per second of the move clip, for rate-matching the gait */
  let clipStride = 4;
  /** the walk covers far less ground per cycle than the gallop */
  let walkStride = 1.5;
  let gaitSpeed = 0;
  let attackAction: THREE.AnimationAction | null = null;
  /** seconds into the current strike; < 0 = not striking (drives the fallback pose too) */
  let attackT = -1;
  const ATTACK_DUR = 0.6;
  /** false only while a sculpt that exists is still on its way (see CharacterInstance.modelReady) */
  let settled = !authored;
  if (authored) {
    const model = loadCreature('massiff', {
      onSettle: () => { settled = true; },
      onLoad: (loaded) => {
        body.visible = false;
        posed = false;
        const clips = (loaded.userData.clips ?? []) as THREE.AnimationClip[];
        if (!clips.length) return;
        const pick = (re: RegExp): THREE.AnimationClip | undefined => clips.find((c) => re.test(c.name));
        const idle = pick(/idle|breath|stand/i);
        const walk = pick(/walk|trot|prowl/i);
        const move = pick(/run|gallop|sprint/i) ?? (walk ? undefined : pick(/move/i));
        const atk = pick(/attack|bite|strike/i);
        mixer = new THREE.AnimationMixer(loaded);
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
      },
    });
    root.add(model);
  }

  return {
    root, rig: null, animator: null, height: 2.0, baseScale: 1,
    modelReady: () => settled,
    setGait: (speed: number) => { gaitSpeed = speed; },
    attack: () => {
      attackT = 0;
      if (attackAction) {
        attackAction.reset();
        attackAction.setEffectiveWeight(1);
        attackAction.play();
      }
      return ATTACK_DUR;
    },
    cosmetic: (dt, time) => {
      if (attackT >= 0) { attackT += dt; if (attackT > ATTACK_DUR) attackT = -1; }
      if (mixer) {
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
      // the stand-in's lunge-bite, over the gait: neck coils up and back,
      // drives down into the bite, jaw thrown open on the way in
      if (attackT >= 0) {
        const w = strikeCurve(attackT, ATTACK_DUR);
        neck.rotation.x += w * -0.45;
        jaw.rotation.x += Math.max(0, -w) * 0.9;
        body.position.y += Math.max(0, w) * 0.08;
      }
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
  let bikeSettled = !authored;
  /** the sculpt, once it lands: what the rider is seated and gripped against */
  let swoopModel: THREE.Object3D | null = null;
  if (authored) {
    const swoop = loadProp('nikto_swoop', 2.6, {
      onLoad: () => { for (const m of bike.children) if ((m as THREE.Mesh).isMesh) m.visible = false; },
      onSettle: () => { bikeSettled = true; swoopModel = swoop; },
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
    [rb.upperLegL, -95 * D, 0, -8 * D], [rb.upperLegR, -95 * D, 0, 8 * D],
    [rb.lowerLegL, 100 * D, 0, 0], [rb.lowerLegR, 100 * D, 0, 0],
    [rb.chest, 22 * D, 0, 0],
    [rb.upperArmL, -70 * D, 20 * D, 0], [rb.upperArmR, -70 * D, -20 * D, 0],
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
   * Done once — the rider is a still pose, not an animation.
   */
  let seated = false;
  const seatRider = (): void => {
    if (seated || !swoopModel) return;
    seated = true;
    group.updateMatrixWorld(true);
    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    group.getWorldDirection(fwd);
    right.set(fwd.z, 0, -fwd.x);
    const at = group.localToWorld(new THREE.Vector3(SWOOP_SEAT.x, bike.position.y + 3, SWOOP_SEAT.z));
    const world = seatSurface(swoopModel, at, fwd, right, 5);
    if (world === null) return;
    const saddleY = group.worldToLocal(new THREE.Vector3(at.x, world, at.z)).y;
    // the pose above is tuned to the *stand-in* saddle, so this corrects it by
    // however far the sculpt's own saddle differs — which keeps the tuning for
    // the procedural rider and the retargeted one both
    rider.root.position.y += saddleY - SWOOP_SEAT.stand;
    group.updateMatrixWorld(true);
    for (const side of [-1, 1] as const) {
      const grip = group.localToWorld(new THREE.Vector3(
        SWOOP_SEAT.x + side * SWOOP_BARS.x, saddleY + SWOOP_BARS.y, SWOOP_SEAT.z + SWOOP_BARS.z));
      const hint = grip.clone().addScaledVector(right, side * 0.5);
      hint.y -= 0.4;
      reachArm(riderRig, side === 1 ? 'L' : 'R', grip, hint);
    }
  };

  // the swoop's melee is a ram: nose dipped and driven forward, then pulled up
  let attackT = -1;
  const ATTACK_DUR = 0.45;
  return {
    root: group, rig: null, animator: null, height: 1.6, baseScale: 1,
    // rider and bike are two separate files: this fighter is only presentable
    // once both have answered, or a menu shows an authored rider on a box
    modelReady: () => bikeSettled && swap.settled,
    attack: () => { attackT = 0; return ATTACK_DUR; },
    cosmetic: (dt, time) => {
      swap.update();
      if (swap.settled) seatRider();
      bike.position.y = 0.55 + Math.sin(time * 6) * 0.05;
      bike.rotation.z = Math.sin(time * 3.1) * 0.06;
      bike.rotation.x = 0;
      flame.scale.y = 0.8 + Math.sin(time * 40) * 0.2;
      if (attackT >= 0) {
        attackT += dt;
        if (attackT > ATTACK_DUR) attackT = -1;
        else {
          const w = strikeCurve(attackT, ATTACK_DUR);
          bike.rotation.x = w * 0.28;          // nose down on the coil, whipped up through
          bike.position.y += Math.max(0, -w) * 0.12;
        }
      }
    },
  };
}

// ---------- Incinerator trooper: red-striped white armor, flame projector ----------
export function buildFlametrooper(authored = true): CharacterInstance {
  const armor = mat(0xe0ddd4, { rough: 0.45, metal: 0.25 });
  const stripe = mat(0xa8281e, { rough: 0.5 });
  const suitM = mat(0x2a2a2a, { rough: 0.85 });
  const { inst, rig } = buildBiped({ skin: suitM, torso: armor });
  const b = rig.bones;
  const dark = mat(0x0c0c0e, { rough: 0.5 });
  addBox(b.chest, armor, 0.34, 0.3, 0.05, 0, 0.06, 0.12);
  addBox(b.chest, stripe, 0.35, 0.06, 0.055, 0, 0.14, 0.12);     // red band
  addBox(b.hips, armor, 0.32, 0.12, 0.05, 0, 0.04, 0.11);
  addBox(b.shoulderL, stripe, 0.15, 0.06, 0.17, -0.05, 0.05, 0, 0, 0, 0.22);
  addBox(b.shoulderR, stripe, 0.15, 0.06, 0.17, 0.05, 0.05, 0, 0, 0, -0.22);
  // helmet: flat-faced with a wide visor slot and a red crest stripe
  addSphere(b.head, armor, 0.15, 0, 0.05, 0, 12, 10, 0.95, 0.92);
  addBox(b.head, armor, 0.22, 0.2, 0.06, 0, 0.04, 0.1);
  addBox(b.head, dark, 0.18, 0.03, 0.03, 0, 0.075, 0.13);        // visor slit
  addBox(b.head, stripe, 0.03, 0.16, 0.2, 0, 0.14, -0.01);       // crest
  // twin fuel tanks on the back
  addCyl(b.jetpack, mat(0x8f2c20, { rough: 0.5, metal: 0.4 }), 0.07, 0.07, 0.42, -0.09, -0.06, -0.02);
  addCyl(b.jetpack, mat(0x8f2c20, { rough: 0.5, metal: 0.4 }), 0.07, 0.07, 0.42, 0.09, -0.06, -0.02);
  // flame projector: fat shrouded barrel, pilot light at the mouth
  const proj = new THREE.Group();
  addBox(proj, dark, 0.06, 0.09, 0.34, 0, 0, 0.05);
  addCyl(proj, mat(0x555a5e, { rough: 0.4, metal: 0.6 }), 0.045, 0.045, 0.3, 0, 0.01, 0.3, Math.PI / 2, 0, 0, 8);
  addCyl(proj, dark, 0.065, 0.05, 0.09, 0, 0.01, 0.47, Math.PI / 2, 0, 0, 8);
  const pilot = addSphere(proj, mat(0xffa030, { emissive: 0xff6a10, rough: 0.3 }), 0.018, 0, 0.05, 0.47, 6, 5);
  proj.rotation.x = Math.PI / 2;
  b.weaponR.add(proj);
  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0.01, 0.5);
  proj.add(muzzle);
  inst.muzzle = muzzle;
  authoredEnemy(inst, rig, 'flametrooper', authored);
  const prev = inst.cosmetic;
  inst.cosmetic = (dt, time) => {
    (pilot.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + Math.sin(time * 13) * 0.4;
    prev?.(dt, time);
  };
  return inst;
}

// ---------- Krykna: pale cave spider on its own free-form rig ----------
/**
 * Human-scale skitterer (the playtest rule holds: nothing smaller than a
 * person). Free-form rig like the massiff: the gait is code, not clips, so an
 * authored model comes in through `loadCreature` when one lands.
 */
function buildKryknaBase(
  scale: number, bodyColor: number, authored: boolean, creatureId: CreatureId,
  decorate?: (body: THREE.Group) => void,
  /** the sculpt, the moment it lands: the broodmother's clutch rides on it */
  onModel?: (model: THREE.Object3D) => void,
): CharacterInstance {
  const chitin = mat(bodyColor, { rough: 0.75 });
  const joint = mat(0x8d867a, { rough: 0.85 });
  const dark = mat(0x22201c, { rough: 0.7 });
  const root = new THREE.Group();

  const BODY_Y = 0.95;
  const body = new THREE.Group();
  body.position.y = BODY_Y;
  root.add(body);
  addSphere(body, chitin, 0.42, 0, 0.05, -0.25, 12, 9, 0.9, 1.25);   // abdomen
  addSphere(body, chitin, 0.3, 0, 0, 0.35, 10, 8, 0.85, 1);          // cephalothorax
  // eye cluster + fangs
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI - Math.PI / 2;
    addSphere(body, dark, 0.035, Math.sin(a) * 0.16, 0.1 + Math.cos(a) * 0.06, 0.6, 5, 4);
  }
  for (const sx of [-1, 1]) addCyl(body, dark, 0.008, 0.035, 0.22, sx * 0.09, -0.14, 0.62, 2.6, 0, 0, 5);

  // eight legs: two joints each, animated as four diagonal pairs
  const legs: { hip: THREE.Group; knee: THREE.Group; side: number; phase: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1;
    const zi = (i % 4) - 1.5;
    const hip = new THREE.Group();
    hip.position.set(side * 0.28, 0.08, zi * 0.28 + 0.1);
    hip.rotation.z = side * -0.9;
    hip.rotation.y = zi * 0.28 * side;
    addCyl(hip, joint, 0.035, 0.05, 0.75, 0, 0.34, 0, 0, 0, 0, 6);   // femur, angled up-out
    const knee = new THREE.Group();
    knee.position.set(0, 0.7, 0);
    knee.rotation.z = side * 2.1;
    addCyl(knee, chitin, 0.014, 0.034, 0.95, 0, 0.42, 0, 0, 0, 0, 6); // tibia, down to the point
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee, side, phase: (i % 2) * Math.PI + zi * 0.7 });
  }

  decorate?.(body);

  // The authored spider plays the code-built clips from GENERATED_CLIPS (its
  // file ships none), blended and rate-matched to the gait like the massiff.
  let posed = true;
  let mixer: THREE.AnimationMixer | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  let moveAction: THREE.AnimationAction | null = null;
  let attackAction: THREE.AnimationAction | null = null;
  let attackT = -1;
  const ATTACK_DUR = 0.55;
  let clipStride = 3;
  let settled = !authored;
  if (authored) {
    const model = loadCreature(creatureId, {
      onSettle: () => { settled = true; },
      onLoad: (loaded) => {
        body.visible = false;
        posed = false;
        onModel?.(loaded);
        const clips = (loaded.userData.clips ?? []) as THREE.AnimationClip[];
        if (!clips.length) return;
        const idle = clips.find((c) => /idle|breath|stand/i.test(c.name));
        const move = clips.find((c) => /run|gallop|sprint|walk|trot|move/i.test(c.name));
        const atk = clips.find((c) => /attack|strike|bite/i.test(c.name));
        mixer = new THREE.AnimationMixer(loaded);
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
      },
    });
    root.add(model);
  }
  root.scale.setScalar(scale);

  let gaitSpeed = 0;
  return {
    root, rig: null, animator: null, height: 1.7 * scale, baseScale: scale,
    modelReady: () => settled,
    setGait: (speed: number) => { gaitSpeed = speed; },
    attack: () => {
      attackT = 0;
      if (attackAction) {
        attackAction.reset();
        attackAction.setEffectiveWeight(1);
        attackAction.play();
      }
      return ATTACK_DUR;
    },
    cosmetic: (dt, time) => {
      if (attackT >= 0) { attackT += dt; if (attackT > ATTACK_DUR) attackT = -1; }
      if (mixer) {
        const striking = strikeBlend(attackAction);
        const moving = Math.min(gaitSpeed / 4, 1) * (1 - striking);
        if (moveAction) {
          moveAction.setEffectiveWeight(moving);
          moveAction.timeScale = clamp(gaitSpeed / Math.max(clipStride, 0.5), 0.5, 2.4);
        }
        if (idleAction) idleAction.setEffectiveWeight((1 - moving) * (1 - striking));
        mixer.update(dt);
        return;
      }
      if (!posed) return;
      const rate = 4 + Math.min(gaitSpeed, 8) * 1.4;
      const lift = Math.min(1, 0.25 + gaitSpeed / 5);
      for (const leg of legs) {
        const ph = time * rate + leg.phase;
        leg.hip.rotation.x = Math.sin(ph) * 0.35 * lift;
        leg.knee.rotation.z = leg.side * (2.1 + Math.cos(ph) * 0.25 * lift);
      }
      body.position.y = BODY_Y + Math.sin(time * rate * 2) * 0.03 * lift;
      body.rotation.y = Math.sin(time * 1.1) * 0.05;
      // the stand-in's strike: rear up on the back legs with the front pair
      // raised, then slam them down as the body drops onto the target
      if (attackT >= 0) {
        const w = strikeCurve(attackT, ATTACK_DUR);
        for (const leg of legs) {
          // hips sit along ±z; the front row (largest z) leads the strike
          const front = leg.hip.position.z > 0.5 ? 1 : leg.hip.position.z > 0.2 ? 0.45 : 0;
          leg.hip.rotation.x += w * -0.9 * front;
          leg.knee.rotation.z += leg.side * w * -0.4 * front;
        }
        body.position.y += Math.max(0, w) * 0.16;
        body.rotation.x = w * -0.22;
      } else {
        body.rotation.x = 0;
      }
    },
  };
}

export function buildKrykna(authored = true): CharacterInstance {
  return buildKryknaBase(1, 0xcfc6b4, authored, 'krykna');
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
  return buildKryknaBase(0.55, 0xcfc6b4, true, 'krykna');
}

/**
 * Where the stand-in's rack sits: `[x, y, z, radius]` on the *procedural*
 * spider, in the character root's frame.
 *
 * Only the stand-in needs these. The authored sculpt carries six real eggs and
 * the game drives those (`characters/eggrack.ts`); this is the same clutch in
 * the same 1–2–2–1 pyramid, sized down onto the stand-in's much smaller
 * abdomen so a queen whose .glb has not landed still has an ammunition readout
 * to look at.
 */
const RACK_SPOTS: readonly (readonly [number, number, number, number])[] = [
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
  // stand-in spider wears the six spheres built below instead. They hang off
  // the procedural `body` group, so the moment the sculpt lands and that group
  // goes invisible they go with it, and there is never a frame wearing both.
  let rack: SculptRack | null = null;
  const rackMeshes: THREE.Mesh[] = [];
  const inst = buildKryknaBase(1.65, 0x9d9484, authored, 'krykna_brood', (body) => {
    for (const [x, y, z, r] of RACK_SPOTS.slice(0, BROOD_EGG_RACK)) {
      // a shell, not a bead: rough enough that six of them do not read as one
      // glossy mass when the whole clutch is up
      const m = new THREE.MeshStandardMaterial({ color: 0x0a0c0a, roughness: 0.78 });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), m);
      // the spots are in the root's frame; the stand-in's abdomen is not
      mesh.position.set(x, y - body.position.y, z);
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
      body.add(mesh);
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
  const slicker = mat(0x3d4a42, { rough: 0.95 });
  const suitM = mat(0x4a4438, { rough: 0.9 });
  const { inst, rig } = buildBiped({ skin: suitM, torso: slicker });
  const b = rig.bones;
  const skinM = mat(0xb06a4a, { rough: 0.85 });
  // domed head with side-set eyes and four face tentacles
  addSphere(b.head, skinM, 0.14, 0, 0.06, 0, 10, 8, 1.15, 1);
  const dark = mat(0x1c1812, { rough: 0.7 });
  addSphere(b.head, dark, 0.024, -0.09, 0.08, 0.08, 5, 4);
  addSphere(b.head, dark, 0.024, 0.09, 0.08, 0.08, 5, 4);
  const tentacles: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const t = addCyl(b.head, skinM, 0.012, 0.028, 0.22, -0.06 + i * 0.04, -0.08, 0.1, 0.35 + (i % 2) * 0.15, 0, 0, 5);
    tentacles.push(t);
  }
  // rolled net slung over the shoulder + hip floats
  addCyl(b.chest, mat(0x7a6c50, { rough: 1 }), 0.07, 0.09, 0.5, 0, 0.06, -0.02, 0, 0, -0.9, 7);
  addSphere(b.hips, mat(0xc26a2a, { rough: 0.8 }), 0.06, 0.2, 0.02, 0, 6, 5);
  // net launcher: a stubby wide-mouthed tube
  const launcher = new THREE.Group();
  addCyl(launcher, dark, 0.05, 0.06, 0.4, 0, 0, 0.1, Math.PI / 2, 0, 0, 8);
  addCyl(launcher, mat(0x6b6f72, { rough: 0.4, metal: 0.6 }), 0.075, 0.06, 0.1, 0, 0, 0.32, Math.PI / 2, 0, 0, 8);
  b.weaponR.add(launcher);
  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0, 0.38);
  launcher.add(muzzle);
  inst.muzzle = muzzle;
  authoredEnemy(inst, rig, 'quarren', authored);
  const prev = inst.cosmetic;
  inst.cosmetic = (dt, time) => {
    for (let i = 0; i < tentacles.length; i++) tentacles[i].rotation.x = 0.35 + (i % 2) * 0.15 + Math.sin(time * 2.2 + i) * 0.08;
    prev?.(dt, time);
  };
  return inst;
}

// ---------- Alamite: pale cave-dweller of the Mandalore ruins ----------
export function buildAlamite(authored = true): CharacterInstance {
  const hide = mat(0xb9b2a4, { rough: 1 });
  const P: Proportions = { ...HUMAN, hipHeight: 0.92, chestLen: 0.34, shoulderWidth: 0.3, upperArmLen: 0.38, forearmLen: 0.34 };
  const { inst, rig } = buildBiped({ skin: hide, torso: hide, proportions: P });
  const b = rig.bones;
  const dark = mat(0x2a241c, { rough: 0.8 });
  // heavy brow ridge, sunken eyes, tusked underbite
  addSphere(b.head, hide, 0.15, 0, 0.05, 0.01, 10, 8, 0.95, 1.05);
  addBox(b.head, hide, 0.24, 0.06, 0.12, 0, 0.1, 0.08);
  addSphere(b.head, dark, 0.02, -0.06, 0.05, 0.12, 5, 4);
  addSphere(b.head, dark, 0.02, 0.06, 0.05, 0.12, 5, 4);
  for (const sx of [-0.05, 0.05]) addCyl(b.head, mat(0xd8cdaa, { rough: 0.6 }), 0.004, 0.018, 0.08, sx, -0.06, 0.12, Math.PI, 0, 0, 4);
  // bony dorsal ridge down the spine
  for (let i = 0; i < 4; i++) addCyl(b.chest, hide, 0.01, 0.045, 0.12, 0, 0.16 - i * 0.09, -0.14, -0.5, 0, 0, 5);
  // rag loincloth + wrapped fists
  addCyl(b.hips, mat(0x6a5c44, { rough: 1 }), 0.22, 0.26, 0.3, 0, -0.14, 0, 0, 0, 0, 8);
  // crude stone club
  const club = new THREE.Group();
  addCyl(club, mat(0x77695a, { rough: 1 }), 0.025, 0.035, 0.62);
  addSphere(club, mat(0x8d8272, { rough: 1, flat: true }), 0.11, 0, 0.36, 0, 6, 5, 1.3, 1);
  club.rotation.x = Math.PI / 2;
  b.weaponR.add(club);
  authoredEnemy(inst, rig, 'alamite', authored);
  return inst;
}

// ---------- Imperial interceptor drone: probe-droid-style kamikaze flier ----------
export function buildInterceptorDrone(authored = true): CharacterInstance {
  const shell = mat(0x2e3138, { rough: 0.4, metal: 0.7 });
  const dark = mat(0x14151a, { rough: 0.55, metal: 0.5 });
  const root = new THREE.Group();
  const core = new THREE.Group();
  core.position.y = 1.15;
  root.add(core);
  addSphere(core, shell, 0.34, 0, 0, 0, 12, 10, 0.85, 1);
  addCyl(core, dark, 0.36, 0.3, 0.1, 0, -0.16, 0, 0, 0, 0, 10);        // sensor skirt
  const eye = addSphere(core, mat(0xff2810, { emissive: 0xff2810, rough: 0.3 }), 0.06, 0, 0.02, 0.3, 8, 6);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    addSphere(core, mat(0xffb060, { emissive: 0x7a3a10, rough: 0.4 }), 0.02, Math.cos(a) * 0.28, 0.12, Math.sin(a) * 0.28, 5, 4);
  }
  // dangling manipulator arms — what gives a probe droid its silhouette
  const arms: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const arm = addCyl(core, dark, 0.012, 0.022, 0.55, Math.cos(a) * 0.2, -0.42, Math.sin(a) * 0.2, 0.12 * Math.cos(a * 3), 0, 0.12 * Math.sin(a * 2), 5);
    arms.push(arm);
  }
  addCyl(core, dark, 0.05, 0.08, 0.16, 0, 0.3, 0, 0, 0, 0, 8);          // top thruster
  let posed = true;
  let mixer: THREE.AnimationMixer | null = null;
  let settled = !authored;
  if (authored) {
    const model = loadCreature('interceptor_drone', {
      onSettle: () => { settled = true; },
      onLoad: (loaded) => {
        core.visible = false;
        posed = false;
        const clips = (loaded.userData.clips ?? []) as THREE.AnimationClip[];
        if (clips.length) {
          mixer = new THREE.AnimationMixer(loaded);
          mixer.clipAction(clips[0]).play();   // one looping hover-idle is the whole performance
        }
      },
    });
    root.add(model);
  }
  return {
    root, rig: null, animator: null, height: 1.7, baseScale: 1,
    modelReady: () => settled,
    cosmetic: (dt, time) => {
      if (mixer) { mixer.update(dt); return; }
      if (!posed) return;
      core.position.y = 1.15 + Math.sin(time * 2.6) * 0.06;
      core.rotation.y = Math.sin(time * 0.9) * 0.4;
      for (let i = 0; i < arms.length; i++) arms[i].rotation.x = 0.12 * Math.cos(i * 3) + Math.sin(time * 3 + i * 1.7) * 0.09;
      (eye.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9 + Math.sin(time * 7) * 0.35;
    },
  };
}

// ---------- Ringworld enforcer: shielded heavy — flank him or go around ----------
export function buildRingEnforcer(authored = true): CharacterInstance {
  const plate = mat(0x5a2e30, { rough: 0.5, metal: 0.4 });
  const suitM = mat(0x26262c, { rough: 0.85 });
  const { inst, rig } = buildBiped({ skin: suitM, torso: plate, scale: 1.1 });
  const b = rig.bones;
  const dark = mat(0x101014, { rough: 0.5 });
  addBox(b.chest, plate, 0.42, 0.34, 0.26, 0, 0.08, 0);
  addBox(b.shoulderL, plate, 0.2, 0.1, 0.2, -0.06, 0.06, 0);
  addBox(b.shoulderR, plate, 0.2, 0.1, 0.2, 0.06, 0.06, 0);
  // visored enforcer helm with a squared jaw guard
  addSphere(b.head, plate, 0.15, 0, 0.05, 0, 10, 8, 0.95, 1);
  addBox(b.head, dark, 0.22, 0.045, 0.06, 0, 0.06, 0.11);
  addBox(b.head, plate, 0.2, 0.1, 0.08, 0, -0.05, 0.09);
  inst.muzzle = rifle(b.weaponR);
  // tower shield on the left arm: an energy pane framed in metal. The pane is
  // cosmetic — the real block is the shield collider the enemy code raises,
  // facing wherever he faces — but the glow is what tells you to flank.
  const shield = new THREE.Group();
  addBox(shield, dark, 0.5, 1.1, 0.05, 0, 0, 0);
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 1.0),
    new THREE.MeshBasicMaterial({
      color: 0x66c8ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  pane.position.z = 0.04;
  shield.add(pane);
  shield.position.set(0, -0.12, 0.1);
  shield.rotation.y = Math.PI;
  b.forearmL.add(shield);
  authoredEnemy(inst, rig, 'ring_enforcer', authored);
  const prev = inst.cosmetic;
  inst.cosmetic = (dt, time) => {
    (pane.material as THREE.MeshBasicMaterial).opacity = 0.24 + Math.sin(time * 5.5) * 0.06;
    prev?.(dt, time);
  };
  return inst;
}

// ---------- monster bosses: the four creature sculpts (docs/BOSSES.md) ----------

/**
 * The shape a monster boss falls back to.
 *
 * Every other creature in the game is a procedural animal first and a sculpt
 * second, because it shipped before its model did. These four are the other way
 * round — they exist because the models landed — so rather than four bespoke
 * procedural beasts that nobody will ever see, they share one: a blocked-out
 * mass on four or two limbs, at the right size and silhouette to fight against.
 * It is hidden the instant the sculpt lands, which on a warm cache is the same
 * frame it spawns; it stands only if a file fails, and a boss you cannot see is
 * a match you cannot finish.
 */
function buildMonsterBase(
  creatureId: CreatureId, height: number, length: number, hide: number,
  opts: {
    biped?: boolean;
    horn?: number;
    /**
     * A colossus that is only half on the surface (docs/BOSSES.md §2.5, §2.6).
     * The sculpt is a whole animal; `sink` drops it into the ground by that
     * many metres and `pitch` rears the front up out of it, so what stands
     * above the surface is the head, neck and forelimbs and the body runs away
     * underneath. The buried part is not hidden — it is *under the terrain*,
     * which is what makes the intersection read when the ground opens.
     */
    buried?: { sink: number; pitch: number };
    /**
     * A reared worm rather than an animal on legs: the stand-in is a column
     * of segments curving up out of the ground to a mandibled head, pivoting
     * at the sand line, and it has nothing to walk on.
     */
    worm?: boolean;
  } = {},
): CharacterInstance {
  const skin = mat(hide, { rough: 0.9 });
  const dark = mat(0x2a241e, { rough: 0.8 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = height * 0.55;
  root.add(body);

  const legs: THREE.Group[] = [];
  /** the worm's segments, for the stand-in's writhe */
  const coils: THREE.Mesh[] = [];
  if (opts.worm) {
    // The column stands on the pivot: the base segment is under the surface
    // (the cut is never seen), the rest rise and lean forward to the head.
    body.position.y = 0;
    const plate = mat(0x6b5a3e, { rough: 0.95 });
    const n = 7;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const r = height * 0.21 * (1 - f * 0.25);
      // a quarter-arc: up from the sand and forward
      const y = -height * 0.25 + f * height * 0.92;
      const z = -length * 0.28 + Math.sin(f * Math.PI * 0.5) * length * 0.36;
      coils.push(addSphere(body, i % 2 ? plate : skin, r, 0, y, z, 12, 9, 0.8, 1.15));
    }
    // the head: a blunt dome, and three mandibles spread around the mouth
    const hy = height * 0.8, hz = length * 0.1;
    addSphere(body, skin, height * 0.24, 0, hy, hz, 12, 9, 0.9, 1.1);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
      const m = new THREE.Group();
      m.position.set(Math.cos(a) * height * 0.16, hy + Math.sin(a) * height * 0.16, hz + height * 0.18);
      m.rotation.set(-Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
      addCyl(m, dark, 0.02, height * 0.055, height * 0.34, 0, 0, height * 0.14, Math.PI / 2, 0, 0, 6);
      body.add(m);
    }
  } else if (opts.biped) {
    addSphere(body, skin, height * 0.3, 0, 0, 0, 10, 8, 1, 1.25);              // hunched torso
    addSphere(body, skin, height * 0.17, 0, height * 0.3, length * 0.1, 9, 7); // skull
    for (const sx of [-1, 1]) {
      // arms longer than the legs, as the design says
      const arm = new THREE.Group();
      arm.position.set(sx * height * 0.26, height * 0.12, 0);
      addCyl(arm, skin, height * 0.07, height * 0.055, height * 0.55, 0, -height * 0.27, 0, 0.25, 0, sx * 0.2, 7);
      body.add(arm);
      legs.push(arm);
      const leg = new THREE.Group();
      leg.position.set(sx * height * 0.15, -height * 0.2, 0);
      addCyl(leg, skin, height * 0.09, height * 0.06, height * 0.35, 0, -height * 0.17, 0, 0, 0, 0, 7);
      root.add(leg);
      leg.position.y += body.position.y;
      legs.push(leg);
    }
  } else {
    addSphere(body, skin, height * 0.42, 0, 0, 0, 12, 9, length / height * 0.42, 1);  // barrel
    addSphere(body, skin, height * 0.26, 0, height * 0.1, length * 0.42, 10, 8);       // head
    if (opts.horn) addCyl(body, dark, 0.02, opts.horn, opts.horn * 3, 0, height * 0.3, length * 0.5, -0.5, 0, 0, 7);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * height * 0.25, -height * 0.3, sz * length * 0.28);
      addCyl(leg, skin, height * 0.1, height * 0.07, height * 0.4, 0, -height * 0.2, 0, 0, 0, 0, 7);
      body.add(leg);
      legs.push(leg);
    }
  }

  // The sculpt: `loadCreature` scales it to its registered height and stands it
  // on the ground, and its code clips (anim/quadruped.ts) drive it — blended
  // and rate-matched to ground speed exactly as the massiff and spiders are.
  let posed = true;
  let mixer: THREE.AnimationMixer | null = null;
  let idleAction: THREE.AnimationAction | null = null;
  let moveAction: THREE.AnimationAction | null = null;
  let attackAction: THREE.AnimationAction | null = null;
  let attackT = -1;
  /** matches the 'attack' clip durations in anim/quadruped.ts, close enough */
  const ATTACK_DUR = 0.85;
  let clipStride = 3;
  let settled = false;
  const sculpt = loadCreature(creatureId, {
    onSettle: () => { settled = true; },
    onLoad: (loaded) => {
      body.visible = false;
      for (const l of legs) l.visible = false;
      posed = false;
      const clips = (loaded.userData.clips ?? []) as THREE.AnimationClip[];
      if (!clips.length) return;
      mixer = new THREE.AnimationMixer(loaded);
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
    },
  });
  if (opts.buried) {
    // `loadCreature` stands the sculpt on the ground; this puts it back under.
    // The pitch is applied to the holder rather than the model so the clips,
    // which are authored in the model's own space, are unaffected by it.
    sculpt.position.y = -opts.buried.sink;
    sculpt.rotation.x = opts.buried.pitch;
  }
  root.add(sculpt);

  let gaitSpeed = 0;
  return {
    root, rig: null, animator: null, height, baseScale: 1,
    modelReady: () => settled,
    setGait: (speed: number) => { gaitSpeed = speed; },
    attack: () => {
      attackT = 0;
      if (attackAction) {
        attackAction.reset();
        attackAction.setEffectiveWeight(1);
        attackAction.play();
      }
      return ATTACK_DUR;
    },
    cosmetic: (dt, time) => {
      if (attackT >= 0) { attackT += dt; if (attackT > ATTACK_DUR) attackT = -1; }
      if (mixer) {
        const striking = strikeBlend(attackAction);
        const moving = Math.min(gaitSpeed / 3, 1) * (1 - striking);
        if (moveAction) {
          moveAction.setEffectiveWeight(moving);
          moveAction.timeScale = clamp(gaitSpeed / Math.max(clipStride, 0.5), 0.6, 2.2);
        }
        if (idleAction) idleAction.setEffectiveWeight((1 - moving) * (1 - striking));
        mixer.update(dt);
        return;
      }
      if (!posed) return;
      if (opts.worm) {
        // the stand-in's writhe: the column sways and each coil rolls a beat
        // behind the one under it; the strike rears the whole column back and
        // drives it down, pivoting at the sand line
        body.rotation.y = Math.sin(time * 0.7) * 0.12;
        coils.forEach((c, i) => { c.position.x = Math.sin(time * 1.6 - i * 0.6) * height * 0.02 * i; });
        body.rotation.x = attackT >= 0 ? strikeCurve(attackT, ATTACK_DUR) * -0.22 : Math.sin(time * 1.1) * 0.03;
        return;
      }
      // the stand-in's own trudge, so a missing file is still a moving animal
      const rate = 2.4 + Math.min(gaitSpeed, 8) * 0.9;
      legs.forEach((l, i) => { l.rotation.x = Math.sin(time * rate + i * 1.7) * (0.1 + Math.min(gaitSpeed, 6) * 0.04); });
      body.position.y = height * 0.55 + Math.sin(time * rate * 2) * height * 0.012;
      // the stand-in's strike: the whole front rears back, then pitches into it
      if (attackT >= 0) {
        const w = strikeCurve(attackT, ATTACK_DUR);
        body.rotation.x = w * -0.16;
        body.position.y += Math.max(0, w) * height * 0.05;
      } else {
        body.rotation.x = 0;
      }
    },
  };
}

/** Waystation's smuggled beast: a one-horned woolly bull, 2.6 m at the shoulder. */
export function buildMudhorn(): CharacterInstance {
  return buildMonsterBase('mudhorn', 3.0, 4.5, 0x4a3a2a, { horn: 0.16 });
}

/** The Crevasse ice-breaker: a tusked leviathan on four broad flippers. */
export function buildRavinak(): CharacterInstance {
  return buildMonsterBase('ravinak', 3.4, 8, 0x5c6470);
}

/** Trask's harbour monster, finally surfaced. */
export function buildMamacore(): CharacterInstance {
  return buildMonsterBase('mamacore', 4.6, 12, 0x5a6360);
}

/** Nevarro's pit monster, loosed on the town square. */
export function buildRancor(): CharacterInstance {
  return buildMonsterBase('rancor', 5.0, 4, 0x6b5340, { biped: true });
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
  return buildMonsterBase('krayt_dragon', 5.4, 18, 0xcfc0a0, { buried: { sink: 3.0, pitch: -0.34 } });
}

/** The Great Forge's sleeper, rising out of the Living Waters. */
export function buildMythosaur(): CharacterInstance {
  // Same treatment, shallower: the horns, skull, neck and both foreclaws stand
  // out of the water and `back` sits on the surface, which is the cut the model
  // brief asked for.
  return buildMonsterBase('mythosaur', 8.0, 12, 0x30443c, { buried: { sink: 1.6, pitch: -0.34 } });
}

// ---------- the second monster batch (docs/BOSSES.md §2.7–2.10) ----------
//
// None of these four has a sculpt yet: their briefs are open in
// ASSETS_MODELS.md, and until a file lands the stand-in from `buildMonsterBase`
// is the boss. The sizes and node names below are the brief's, so the day a
// model arrives it drops in with no code change, exactly as the first six did.

/** The Refinery's specimen: an armored crawler, five metres at the shoulder and twelve long. */
export function buildZillo(): CharacterInstance {
  return buildMonsterBase('zillo', 5.0, 12, 0x5a5f4a);
}

/** The Ringworld's night hunter: a quilled cat, landspeeder-sized and faster than one. */
export function buildNexu(): CharacterInstance {
  return buildMonsterBase('nexu', 2.2, 5.0, 0x8a7a5a);
}

/** The Prison Rig's amphibian, hauled up out of the moon pool onto the decks. */
export function buildKwazelMaw(): CharacterInstance {
  return buildMonsterBase('kwazel_maw', 4.2, 9, 0x3a6a5a);
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
export function buildSandworm(): CharacterInstance {
  const root = new THREE.Group();
  const skin = mat(0xc9b184, { rough: 0.92 });
  const plate = mat(0xb9a074, { rough: 0.95 });
  const dark = mat(0x2a241e, { rough: 0.8 });

  // ---- the stand-in: the same animal in blocked-out segments ----
  const standIn = new THREE.Group();
  root.add(standIn);
  const segLen = WORM_LENGTH / (WORM_SEGMENTS + 1);
  const standSegs: THREE.Group[] = [];
  for (let i = 0; i <= WORM_SEGMENTS; i++) {
    const g = new THREE.Group();
    const head = i === WORM_SEGMENTS;
    // the body tapers toward the tail, and the head is the widest thing on it
    const t = i / WORM_SEGMENTS;
    const r = head ? 1.5 : 0.55 + t * 0.75;
    addSphere(g, i % 2 || head ? skin : plate, r, 0, 0, 0, 10, 8, 0.92, segLen / r * 0.62);
    if (head) {
      // three of the four mandibles read from any angle; the fourth is behind
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const m = new THREE.Group();
        m.position.set(Math.cos(a) * 1.0, Math.sin(a) * 1.0, 1.1);
        m.rotation.set(-Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
        addCyl(m, dark, 0.02, 0.34, 2.1, 0, 0, 0.9, Math.PI / 2, 0, 0, 6);
        g.add(m);
      }
    }
    standIn.add(g);
    standSegs.push(g);
  }

  // ---- the sculpt ----
  // Fitted by its longest axis rather than its height: the file is a straight
  // forty-metre worm, so its height says nothing about its size. Not grounded
  // either — the solver below decides where every part of it sits.
  let settled = false;
  let chain: THREE.Object3D[] | null = null;   // spine1 … spine24, head
  let jaw: THREE.Object3D | null = null;
  let restStep = 1;                            // metres between joints, once fitted
  const sculpt = loadProp('sandworm', WORM_LENGTH, {
    axis: 'longest',
    onSettle: () => { settled = true; },
    onLoad: (loaded) => {
      const find = (n: string): THREE.Object3D | null => {
        let hit: THREE.Object3D | null = null;
        loaded.traverse((o) => { if (!hit && o.name === n) hit = o; });
        return hit;
      };
      const links: THREE.Object3D[] = [];
      for (let i = 1; i <= WORM_SEGMENTS; i++) {
        const b = find(`spine${i}`);
        if (!b) return;                        // an unexpected rig: keep the stand-in
        links.push(b);
      }
      const headBone = find('head');
      if (!headBone) return;
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
      standIn.visible = false;
    },
  });
  root.add(sculpt);

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
      const step = chain ? restStep : segLen;
      solve(time, step);

      // The whole solve is done in world space, because the trail is a world
      // history; the body is then carried into the root's frame, which the enemy
      // controller is meanwhile moving and turning.
      root.updateMatrixWorld(true);
      const toLocal = _basis.copy(root.matrixWorld).invert();

      if (chain) {
        // the sculpt: place the tail, then aim each bone at the next joint
        const first = chain[0];
        _p.copy(targets[0]).applyMatrix4(toLocal);
        const holder = sculpt;
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

      // the stand-in: the segments are placed straight onto the same targets
      for (let i = 0; i < standSegs.length; i++) {
        const g = standSegs[i];
        g.position.copy(targets[i]).applyMatrix4(toLocal);
        const to = targets[Math.min(i + 1, standSegs.length - 1)];
        _dir.subVectors(to, targets[i]);
        if (_dir.lengthSq() > 1e-8) {
          g.lookAt(g.position.x + _dir.x, g.position.y + _dir.y, g.position.z + _dir.z);
        }
      }
      void gaitSpeed;
    },
  };
}
