import { TEXT } from '../text';
import * as THREE from 'three';
import { markOwned } from '../core/dispose';
import { buildBiped, makeBladeTrail, makeCarbine, makeCrossbow, makeGaffi, makeLongRifle, makePistol, makeSaber, type CharacterInstance } from './builder';
import { attachAuthored } from './authored';
import { createShieldField } from '../fx/shieldfield';
import type { VoiceId } from '../core/audio';
import { dinMeleeVariants, saberParryClips } from '../workbench/combatStudies';
import { counterweightTracks } from '../anim/counterweight';
import { applyArmorerAxeGrip } from './armorerAxeGrips';
import { applyBosskRifleGrip, BOSSK_RIFLE_SCALE } from './bosskRifleGrip';
import { applySharedWeaponGrip, sharedWeaponScale } from './sharedWeaponGrips';
import { applyHeroStaffGrip } from './heroStaffGrips';
import { applyDinSpearGrip } from './dinSpearGrips';
import { applyDinSaberGrip } from './dinSaberGrips';
import { applyGripSpin, gripSpinFor } from './gripSpin';
import { styleClips } from './styleClips';
import { SABER_STYLES, saberClipSet, weaponProp, type SaberClips, type SaberStyle, type StaffPropId, type WeaponPropId } from './weaponProps';

/**
 * Playable characters — one config-driven factory so every fighter shares the
 * same rig, clips and gameplay; only look and loadout differ. Two families
 * share it: helmeted Mandalorians, and bare-headed underworld hunters (config
 * `helmet: null`), who bring their own heads and signature weapons.
 *
 * (The Mando* names predate the hunters; every id below rides the same type.)
 */

export type MandoId =
  | 'din' | 'paz' | 'bokatan' | 'armorer' | 'boba_fett'
  | 'ventress' | 'jedi' | 'maris' | 'maul' | 'revan' | 'embo' | 'bossk' | 'ig11' | 'duelist';

export interface PlayerCharacter extends CharacterInstance {
  /** 'none' is empty hands — a melee-only fighter with the blades stowed */
  setWeapon: (w: 'blaster' | 'gaffi' | 'none') => void;
  /** put a particular carried gun in the right hand (D-pad right cycles these) */
  setRangedKind: (kind: RangedKind) => void;
  /** put a particular carried blade in the right hand (D-pad left cycles these) */
  setMeleeKind: (kind: MeleeKind) => void;
  setThrust: (t: number) => void;
  /** intensity of the fill light that travels with this character */
  setHeroLight: (intensity: number) => void;
  /** raise (1) or drop (0) the block shield; values between animate it */
  setBlock: (t: number) => void;
  /** blade sweep trails on/off (no-op for anyone without sabers) */
  setTrail: (on: boolean) => void;
  /**
   * A thrown blade leaves the hand: show/hide one saber (0 = main, 1 = off)
   * independently of the weapon state. Only the saber fighters implement it.
   */
  setSaberHeld?: (hand: 0 | 1, held: boolean) => void;
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
export const MODEL_HEIGHT: Record<MandoId, number> = {
  din: 1.85, paz: 1.67, bokatan: 1.75, armorer: 1.78, boba_fett: 1.83,
  ventress: 1.79, jedi: 1.82, maris: 1.70, maul: 1.88, revan: 1.95, embo: 1.78, bossk: 1.9, ig11: 2.2, duelist: 1.9,
};

type StowedGrip = { position: [number, number, number]; quaternion: [number, number, number, number] };
/** Workbench-authored hip-local transforms; the stowed hilts keep these in every pose. */
const AUTHORED_STOWED_SABER_GRIPS: Partial<Record<MandoId, Record<'left' | 'right', StowedGrip>>> = {
  jedi: {
    left: { position: [0.156087, 0.202822, 0.054357], quaternion: [0.0012752, 0.0008093, 0.0053235, 0.9999847] },
    right: { position: [-0.162017, 0.205732, 0.044764], quaternion: [-0.0141541, -0.0038531, -0.0124992, 0.9998143] },
  },
  maris: {
    left: { position: [0.069071, 0.23511, -0.098459], quaternion: [0.0549825, 0.8816258, 0.2257428, -0.4107957] },
    right: { position: [-0.042171, 0.236488, -0.079782], quaternion: [0.0051619, 0.6981478, 0.2753743, 0.660857] },
  },
  ventress: {
    left: { position: [0.175019, 0.182303, 0.025], quaternion: [-0.0143593, -0.1079298, 0.9891353, -0.0987742] },
    right: { position: [-0.167219, 0.188361, 0.007152], quaternion: [-0.0081515, -0.0903281, 0.9918481, 0.0895081] },
  },
};

export interface MandoConfig {
  name: string;
  desc: string;
  /**
   * Which family the fighter belongs to: the helmeted Mandalorians, the
   * bounty hunters, or the Force users. A party's families decide which rivals
   * come for it (src/game/rivals.ts).
   */
  group: 'mando' | 'hunter' | 'force';
  /** a Force user of the dark side, whose party is met by the light first */
  sith?: true;
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
  /**
   * A full bubble instead of the forward dome: the field closes around the
   * whole body and turns fire from every bearing, back included. A droid
   * projecting a sphere is a droid that does not have to face its attacker,
   * which is the point — it costs the same gauge as anyone else's.
   */
  bubbleShield?: boolean;
  /**
   * Signature loadout — defaults are the shared carbine and gaffi. Either slot
   * can name several weapons; the fighter carries all of them and the D-pad
   * cycles that slot, and whichever button uses a slot draws it.
   *
   * `ranged: 'none'` is a fighter whose trigger is not a gun. Saber wielders
   * throw a blade with RT; fighters carrying a blaster throw while their
   * sabers are drawn and fire while the blaster is drawn.
   */
  ranged?: RangedKind | RangedKind[] | 'none';
  melee?: MeleeKind | MeleeKind[];
  /**
   * The sculpt carried in the gaffi slot. Most fighters swing the gaffi; a few
   * carry their own staff (Embo's quarterstaff and IG-11's force pike were
   * picked in the workbench's weapon choice). See WEAPON_PROPS.
   */
  staffProp?: StaffPropId;
  /**
   * Which blade the sabers slot holds, for anyone who carries one: its hilt,
   * whether it comes as a pair, and the clips it swings with (SABER_STYLES).
   * Defaults to Ventress' red pair.
   */
  saberStyle?: SaberStyle;
  /**
   * The weapon this fighter's entry in data/sharedWeaponGrips.json was
   * calibrated on: the signature gun unless it says the sabers (Revan's
   * flourish grip), whose scale then follows the saber into the hand, the
   * holster and the throw.
   */
  sharedGrip?: 'sabers';
  /** exposed skin colour, for anyone without a bucket on their head */
  skin?: number;
  /** whose throat the hurt and death sounds come from; defaults to a helmeted man */
  voice?: VoiceId;
  /**
   * Where the flight flames live: on the worn jetpack (default), or under the
   * feet for a character that flies on leg thrusters — no pack is built, and
   * the flames ride the foot bones so they angle with the legs in flight.
   */
  thrusters?: 'jetpack' | 'feet' | 'none';
  /**
   * Where the flight flames sit below the jetpack bone once the authored model
   * is on, in metres; -0.02 puts them at the mouths of the Z-6 they were
   * placed for.
   */
  flameY?: number;
  /**
   * Built for water: a reptilian or amphibious fighter swims faster, turns
   * harder and comes out of a breach higher than a body that has to be
   * carried through it. Bossk and the Quarren are the obvious ones; the war
   * massiff is a reptile too.
   */
  amphibious?: boolean;
  /**
   * An acrobat somersaults: tapping jump again in the air tucks them into a
   * roll that keeps turning while the button is held, and unwinds to a normal
   * falling stance when it is let go. Only for fighters who read as tumblers —
   * a jetpack rides its thrust, and a hunter with a rifle just falls.
   */
  acrobat?: boolean;
}

/** HUD display names for each loadout slot. */
export const RANGED_NAMES = TEXT.weapons.ranged;
export const MELEE_NAMES = TEXT.weapons.melee;

export type RangedKind = keyof typeof RANGED_NAMES;
export type MeleeKind = keyof typeof MELEE_NAMES;

const list = <T>(v: T | T[] | undefined, fallback: T): T[] =>
  (Array.isArray(v) ? v : v ? [v] : [fallback]);

/** Every gun this character carries, signature first; empty for a thrower. */
export function rangedKinds(id: MandoId): RangedKind[] {
  const cfg = MANDO_ROSTER[id].ranged;
  return cfg === 'none' ? [] : list(cfg as RangedKind | RangedKind[] | undefined, 'carbine');
}
/**
 * A playable id's roster entry, or undefined for anyone the factory does not
 * build — the lookups below take any playable id, a PvP NPC's included, and
 * answer those with the defaults.
 */
const rosterEntry = (id: string): MandoConfig | undefined =>
  (Object.prototype.hasOwnProperty.call(MANDO_ROSTER, id) ? MANDO_ROSTER[id as MandoId] : undefined);

/** The sculpt carried in the gaffi slot (see `staffProp`). */
export const staffPropFor = (id: string): StaffPropId => rosterEntry(id)?.staffProp ?? 'gaffi';
/** The blade carried in the sabers slot (see `saberStyle`). */
export const saberStyleFor = (id: string): SaberStyle => rosterEntry(id)?.saberStyle ?? 'red';
/** The clip families this fighter's sabers play, by use (see `saberClipSet`). */
export const saberClipsFor = (id: string): SaberClips => saberClipSet(saberStyleFor(id));
/** The scale on this fighter's sabers: the shared grip's, where it was set on them (see `sharedGrip`). */
export const saberScaleFor = (id: string): number =>
  (rosterEntry(id)?.sharedGrip === 'sabers' ? sharedWeaponScale(id as MandoId) : 1);

/**
 * The sculpt in the signature melee slot when it is this fighter's own — a
 * staff other than the gaffi, or a single saber rather than a pair — and null
 * when it is the common gaffi or a pair of sabers, which go by their slot.
 */
export function signatureMeleeProp(id: MandoId): WeaponPropId | null {
  if (meleeKinds(id)[0] === 'gaffi') {
    const staff = staffPropFor(id);
    return staff === 'gaffi' ? null : staff;
  }
  const saber = SABER_STYLES[saberStyleFor(id)];
  return saber.pair ? null : saber.prop;
}

/**
 * What the HUD calls one of this character's melee weapons: a staff or a
 * saber of its own goes by its own name, the common ones by their slot's.
 * Asked per weapon rather than once for the signature, since Din's second
 * blade is a single Darksaber and not the slot's "Twin Sabers".
 */
export function meleeNameFor(id: MandoId, kind: MeleeKind): string {
  const key = kind === 'gaffi'
    ? weaponProp(staffPropFor(id)).name
    : SABER_STYLES[saberStyleFor(id)].name ?? weaponProp(SABER_STYLES[saberStyleFor(id)].prop).name;
  return key ? TEXT.weapons.props[key] : MELEE_NAMES[kind];
}

/**
 * How many lit blades this fighter can have out at once: what `SaberLights`
 * sizes its pool by. A pair is two, a single or double-ended saber one, the
 * Darksaber none (it is a dark silhouette), and anyone who is not a hero with
 * sabers — a playable NPC among them — none.
 */
export function litSaberCount(id: string): number {
  if (!rosterEntry(id) || !meleeKinds(id as MandoId).includes('sabers')) return 0;
  const style = saberStyleFor(id);
  if (style === 'darksaber') return 0;
  return SABER_STYLES[style].pair ? 2 : 1;
}

/** Every melee weapon this character carries, signature first. */
export function meleeKinds(id: MandoId): MeleeKind[] {
  return list(MANDO_ROSTER[id].melee, 'gaffi');
}

/**
 * Benched: built and selectable everywhere except the game itself.
 *
 * Removing a character by deleting their config would throw away the helmet
 * shape, the palette and the height that took a pass to get right, and the
 * authored `.glb` on disk would have nothing left pointing at it. So the whole
 * definition stays and only the *playable* list is narrowed: `PLAYABLE_MANDO_IDS`
 * is what the game enumerates, the model workbench still builds anyone in
 * `MANDO_ROSTER`, and putting someone back is deleting their id from this set.
 */
export const BENCHED_MANDO_IDS: ReadonlySet<MandoId> = new Set<MandoId>(['bokatan']);

/** Every character the factory can build, benched ones included. */
export const MANDO_ROSTER: Record<MandoId, MandoConfig> = {
  din: {
    ...TEXT.characters.din,
    group: 'mando',
    primary: 0xb4bac2, accent: 0x6d7178, suit: 0x4a4239, cape: 0x5a4632, helmet: 'din', rangefinder: false, bulk: 1,
    // The spear and the blade he won: D-pad left picks between them.
    melee: ['gaffi', 'sabers'],
    staffProp: 'beskar_spear', saberStyle: 'darksaber',
  },
  paz: {
    ...TEXT.characters.paz,
    group: 'mando',
    primary: 0x2e4a72, accent: 0x1e2c42, suit: 0x33363c, cape: null, helmet: 'paz', rangefinder: false, bulk: 1.16, broad: 1.08,
    staffProp: 'force_pike',
  },
  bokatan: {
    ...TEXT.characters.bokatan,
    group: 'mando',
    primary: 0x2f5c8a, accent: 0xb03a3a, suit: 0x2a2d33, cape: null, helmet: 'bokatan', rangefinder: true, bulk: 0.95,
    voice: 'mando_f',
    staffProp: 'force_pike',
  },
  armorer: {
    ...TEXT.characters.armorer,
    group: 'mando',
    primary: 0xb59440, accent: 0x6b5320, suit: 0x2e2a24, cape: 0x4a3b22, helmet: 'armorer', rangefinder: false, bulk: 0.98,
    staffProp: 'poleaxe',
    voice: 'mando_f',
  },
  boba_fett: {
    ...TEXT.characters.boba_fett,
    group: 'mando',
    // matched to the model: olive plate, rust accents, grey flight suit
    primary: 0x58744c, accent: 0x913f2c, suit: 0x6e6f6a, cape: 0x8c7150,
    helmet: 'boba_fett', rangefinder: true, bulk: 1,
    voice: 'masked',
    // his pack is deeper and hangs lower than the Z-6 the flames were placed
    // for: its underside is 0.33 m below the bone, so his flames drop to it
    // instead of burning inside the pack
    flameY: -0.09,
    staffProp: 'gaffi_collection',
  },
  ventress: {
    ...TEXT.characters.ventress,
    group: 'force', sith: true,
    primary: 0x33363e, accent: 0x1e2026, suit: 0x2a2c33, cape: null, helmet: null, rangefinder: false, bulk: 0.93,
    melee: 'sabers', ranged: 'none', skin: 0xcdc3ba,
    voice: 'human_f', acrobat: true,
  },
  jedi: {
    ...TEXT.characters.jedi,
    group: 'force',
    primary: 0xd9d3c3, accent: 0x645e55, suit: 0x302e2a, cape: null,
    helmet: null, rangefinder: false, bulk: 1,
    melee: 'sabers', ranged: 'none', skin: 0xc9b9a8,
    saberStyle: 'white',
    voice: 'mando_m', acrobat: true, thrusters: 'none',
  },
  maris: {
    ...TEXT.characters.maris,
    group: 'force',
    primary: 0x77635c, accent: 0xb89a90, suit: 0x362d30, cape: null,
    helmet: null, rangefinder: false, bulk: 0.92,
    melee: 'sabers', ranged: 'none', skin: 0xe7c5b8,
    saberStyle: 'tonfa',
    voice: 'human_f', acrobat: true, thrusters: 'none',
  },
  maul: {
    ...TEXT.characters.maul,
    group: 'force', sith: true,
    primary: 0x25212a, accent: 0x7b292b, suit: 0x202027, cape: null,
    helmet: null, rangefinder: false, bulk: 1,
    melee: 'sabers', ranged: 'none', skin: 0xb33b39,
    saberStyle: 'double',
    voice: 'mando_m', acrobat: true, thrusters: 'none',
  },
  revan: {
    ...TEXT.characters.revan,
    group: 'force', sith: true,
    primary: 0x292933, accent: 0x54282f, suit: 0x1b1a21, cape: 0x18171e,
    helmet: null, rangefinder: false, bulk: 1.04,
    melee: 'sabers', ranged: 'none', skin: 0x24242b,
    saberStyle: 'dark', sharedGrip: 'sabers',
    voice: 'masked', acrobat: true, thrusters: 'none',
  },
  embo: {
    ...TEXT.characters.embo,
    group: 'hunter',
    primary: 0x6d5a3a, accent: 0x59452a, suit: 0x4a3f2e, cape: 0x8a3328, helmet: null, rangefinder: false, bulk: 1.0,
    ranged: 'crossbow', skin: 0x7a8a4f,
    staffProp: 'rey_staff',
    voice: 'masked',
  },
  bossk: {
    ...TEXT.characters.bossk,
    group: 'hunter',
    primary: 0xc4b285, accent: 0x8a7a55, suit: 0xb0a077, cape: null, helmet: null, rangefinder: false, bulk: 1.08,
    ranged: 'longrifle', skin: 0x8ba03f,
    voice: 'reptile', amphibious: true,
    staffProp: 'nightsister_polearm',
  },
  duelist: {
    ...TEXT.characters.duelist,
    group: 'hunter',
    primary: 0x2b2f38, accent: 0x1e2129, suit: 0x23262d, cape: null, helmet: null, rangefinder: false, bulk: 0.98,
    ranged: 'pistols', skin: 0x5a86a8,
    voice: 'alien_m', acrobat: true,
    staffProp: 'rey_staff',
  },
  ig11: {
    ...TEXT.characters.ig11,
    group: 'hunter',
    primary: 0x8a8578, accent: 0x5f5a4e, suit: 0x736e62, cape: null, helmet: null, rangefinder: false, bulk: 0.94,
    ranged: 'longrifle', skin: 0x8a8578, thrusters: 'feet',
    staffProp: 'force_pike',
    voice: 'droid', bubbleShield: true,
  },
};

/**
 * The roster the game offers, in character-select order: Mandalorians,
 * bounty hunters, then Force users. Bo-Katan remains benched.
 * Every enumeration in the game — character select, prefetch, the drop screen,
 * the debug handle — goes through this, so benching a character removes them
 * from all of them at once.
 */
const CHARACTER_ORDER: MandoId[] = [
  'din', 'paz', 'armorer', 'bokatan', 'boba_fett',
  'duelist', 'bossk', 'ig11', 'embo',
  'jedi', 'maris', 'revan', 'maul', 'ventress',
];
export const PLAYABLE_MANDO_IDS: MandoId[] =
  CHARACTER_ORDER.filter((id) => !BENCHED_MANDO_IDS.has(id));

/**
 * @param opts.authored  false keeps the procedural build even when an authored
 *   model exists — the model workbench uses it to show both side by side.
 */
export function buildMandalorian(id: MandoId, opts: { authored?: boolean } = {}): PlayerCharacter {
  const cfg = MANDO_ROSTER[id];

  // No body of its own: the authored model is the body, and until it lands
  // its low-LOD stand-in (see `attachAuthored` below and lod.ts).
  const { inst, rig } = buildBiped({ scale: cfg.bulk });
  /** false in the workbench's procedural view: weapons hold their stand-ins too */
  const sculpt = opts.authored !== false;
  if (inst.animator) Object.assign(inst.animator.clips, styleClips(id, rig.proportions));
  if ((id === 'ventress' || id === 'jedi') && inst.animator) {
    Object.assign(inst.animator.clips, saberParryClips(rig.proportions, id));
  }
  if (id === 'din' && inst.animator) {
    Object.assign(inst.animator.clips, dinMeleeVariants(rig.proportions));
    for (const [name, source] of [['darksaber1', 'saber1'], ['darksaber2', 'melee2'], ['darksaber3', 'melee3']] as const) {
      const clip = inst.animator.clips[source].clone();
      const arm = clip.tracks.find((track) => track.name === 'upperArmL.quaternion')!;
      clip.tracks = clip.tracks.filter((track) => track.name !== 'upperArmL.quaternion' && track.name !== 'forearmL.quaternion');
      clip.tracks.push(...counterweightTracks(name, Array.from(arm.times)));
      clip.name = name;
      inst.animator.clips[name] = clip;
    }
  }
  if (cfg.broad) { rig.root.scale.x *= cfg.broad; rig.root.scale.z *= cfg.broad; }
  const b = rig.bones;

  // ---- thrusters ----
  const feetThrusters = cfg.thrusters === 'feet';
  const noThrusters = cfg.thrusters === 'none';
  // Flames live on their own group under the jetpack bone rather than under the
  // nozzle meshes: an authored model hides the procedural body, and a hidden
  // parent would take the flames with it.
  const flameRoot = new THREE.Group();
  b.jetpack.add(flameRoot);
  // The stand-in's pack is the sculpt's own pack at a low LOD, so the flames
  // sit where the sculpt's thrusters are from the start (see `flameY`).
  if (!feetThrusters) flameRoot.position.y = cfg.flameY ?? -0.02;
  // Each nozzle only carries a stubby glow — a white-hot core inside a softer
  // orange sheath, both additive and open-ended so they read as light in the
  // throat of the thruster. The particle jet does the actual flame below it.
  const NOZZLE_Y = -0.24;
  const coreGeo = new THREE.ConeGeometry(0.03, 0.09, 10, 1, true);
  const plumeGeo = new THREE.ConeGeometry(0.05, 0.16, 10, 1, true);
  interface Flame { group: THREE.Group; core: THREE.Mesh; plume: THREE.Mesh; coreMat: THREE.MeshBasicMaterial; plumeMat: THREE.MeshBasicMaterial }
  // Two flame mounts: the pack's twin nozzles, or one sole per foot.
  const flameMounts: Array<[THREE.Object3D, number, number, number]> = noThrusters ? [] : feetThrusters
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

  // ---- weapons ----
  // Every weapon the character carries is built and mounted at once, and only
  // the pair in hand is visible. Nobody has to holster anything to reach the
  // other slot: a swing draws the blade, a shot draws the gun, and the D-pad
  // picks between several of either where a fighter carries them.
  // Either hand's weapon can come in a pair: twin sabers and twin pistols each
  // add a second copy on weaponL that shows and hides with its partner. Shots
  // still leave the right-hand muzzle — the left one is silhouette.
  const pairOn = (make: () => THREE.Group): THREE.Group => {
    const g = make();
    g.rotation.x = Math.PI / 2;
    g.visible = false;
    b.weaponL.add(g);
    return g;
  };

  interface Held { main: THREE.Group; offhand: THREE.Group | null; muzzle?: THREE.Group }
  const MUZZLE_Z: Record<RangedKind, number> = { carbine: 0.62, crossbow: 0.5, longrifle: 0.95, pistols: 0.3 };
  const guns = new Map<RangedKind, Held>();
  for (const kind of rangedKinds(id)) {
    if (guns.has(kind)) continue;
    const main =
      kind === 'crossbow' ? makeCrossbow(sculpt) :
      kind === 'longrifle' ? makeLongRifle(sculpt) :
      kind === 'pistols' ? makePistol(sculpt) :
      makeCarbine(sculpt);
    main.rotation.x = Math.PI / 2;
    main.visible = false;
    b.weaponR.add(main);
    const muzzle = new THREE.Group();
    muzzle.position.set(0, 0.015, MUZZLE_Z[kind]);
    main.add(muzzle);
    guns.set(kind, { main, muzzle, offhand: kind === 'pistols' ? pairOn(() => makePistol(sculpt)) : null });
  }
  // The generic shared-grip scale first, then Bossk's own dedicated rifle
  // scale on top of it. They used to run the other way — this line applied
  // unconditionally to everyone's first ranged weapon, and Bossk's longrifle
  // *is* his only ranged weapon, so its 1.23 was set and then immediately
  // overwritten by `sharedWeaponScale('bossk')`, which has no entry and
  // silently falls back to 1.
  guns.get(rangedKinds(id)[0])?.main.scale.setScalar(sharedWeaponScale(id));
  const bosskRifle = id === 'bossk' ? guns.get('longrifle')?.main : undefined;
  if (bosskRifle) bosskRifle.scale.setScalar(BOSSK_RIFLE_SCALE);

  // Staff and saber share the gripping hand, but their local axes need
  // different mount rotations: a spear thrust carries its point forward.
  const blades = new Map<MeleeKind, Held>();
  const saberStyle = saberStyleFor(id);
  const saberPair = SABER_STYLES[saberStyle].pair;
  for (const kind of meleeKinds(id)) {
    if (blades.has(kind)) continue;
    let main: THREE.Group;
    let offhand: THREE.Group | null = null;
    if (kind === 'sabers') {
      main = makeSaber({ style: saberStyle, sculpt });
      main.name = 'saberHandR';
      // Both blades carry their own soft light so a thrown off-hand saber
      // illuminates its path while the main hand still lights the wielder.
      if (saberPair) {
        offhand = pairOn(() => makeSaber({ style: saberStyle, sculpt }));
        offhand.name = 'saberHandL';
      }
    } else {
      main = makeGaffi(staffPropFor(id), sculpt);
      main.name = weaponProp(staffPropFor(id)).node ?? 'gaffi';
      // The sculpt's pointed end is model -Z. Its prop mount maps that to
      // grip -Y; the carry half-turn lifts the point above Din's hand.
      main.rotation.x = Math.PI;
      if (id === 'din') applyDinSpearGrip(main, null);
    }
    if (kind === 'sabers') {
      main.rotation.x = id === 'maris' ? -Math.PI / 2 : Math.PI / 2;
      if (id === 'maris' && offhand) offhand.rotation.x = -Math.PI / 2;
    }
    main.visible = false;
    b.weaponR.add(main);
    blades.set(kind, { main, offhand });
  }
  if (id === 'armorer') applyArmorerAxeGrip(blades.get('gaffi')!.main, 'idleUpper');
  if (cfg.sharedGrip === 'sabers') blades.get('sabers')!.main.scale.setScalar(sharedWeaponScale(id));

  // One hilt per hand at its hip while stowed. A thrown
  // slot hides its hip copy, so that saber has one visible location at a time.
  const holsters: THREE.Group[] = [];
  if (cfg.ranged === 'none' && blades.has('sabers')) {
    for (const [hand, side] of (saberPair ? [[0, -1], [1, 1]] : [[0, -1]]) as Array<readonly [0 | 1, number]>) {
      const hilt = makeSaber({ light: false, style: saberStyle, sculpt });
      (hilt.userData.blade as THREE.Object3D).visible = false;
      if (hilt.userData.oppositeBlade) (hilt.userData.oppositeBlade as THREE.Object3D).visible = false;
      hilt.name = hand === 0 ? 'saberHolsterR' : 'saberHolsterL';
      hilt.position.set(
        side * (id === 'maul' || id === 'revan' ? 0.22 : id === 'ventress' ? 0.21 : 0.23),
        id === 'ventress' ? 0.07 : 0.025,
        id === 'ventress' ? 0.025 : 0.08,
      );
      hilt.rotation.z = id === 'ventress' ? Math.PI + side * 0.18 : id === 'maul' ? -0.16 : -side * 0.12;
      if (cfg.sharedGrip === 'sabers') hilt.scale.setScalar(sharedWeaponScale(id));
      b.hips.add(hilt);
      holsters.push(hilt);
    }
  }

  // What is in each hand right now; the controller moves these with the D-pad.
  // A thrower carries no gun at all, so the ranged side can be empty.
  let gun = guns.get(rangedKinds(id)[0]) ?? null;
  // An empty right hand still has a muzzle: a point in front of it that
  // stands in as the origin for anything that asks where a shot would leave
  // from, so no caller needs a null check for a fighter with no gun.
  const emptyMuzzle = new THREE.Group();
  emptyMuzzle.position.set(0, 0.015, 0.1);
  b.weaponR.add(emptyMuzzle);
  let blade = blades.get(meleeKinds(id)[0])!;

  // ---- blade trails (sabers only) ----
  // Ribbons in the wake of both blades while swinging; the player toggles
  // them with setTrail and the cosmetic tick keeps them fed. They hang off
  // the rig root so a hidden procedural body doesn't take them with it.
  const trailUpdates: Array<(dt: number, active: boolean) => void> = [];
  const sabers = blades.get('sabers');
  if (sabers) {
    trailUpdates.push(makeBladeTrail(rig.root, sabers.main));
    if (sabers.main.userData.oppositeBlade) trailUpdates.push(makeBladeTrail(rig.root, sabers.main, true));
    if (sabers.offhand) trailUpdates.push(makeBladeTrail(rig.root, sabers.offhand));
  }
  let trailActive = false;

  // ---- block shield ----
  // The shared force field (src/fx/shieldfield.ts), at fighter scale: a
  // forward dome off the chest, or a closed bubble for a carrier who has one.
  // The ride's deflector is the same field around a hull, which is why the
  // shader lives out there rather than in here.
  const bubble = !!cfg.bubbleShield;
  const shield = createShieldField({
    radius: bubble ? 1.12 : 0.72,
    arc: bubble ? Math.PI : Math.PI * 0.46,
  });
  const shieldRoot = shield.root;
  b.chest.add(shieldRoot);
  // a forward dome sits off the chest; a bubble is centred on the body it encloses
  shieldRoot.position.set(0, bubble ? 0.02 : 0.14, bubble ? 0 : 0.34);

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

  // The authored mount is shared by carry and aim. Change only its rifle-local
  // transform as the upper-body clip changes; locomotion below it is irrelevant.
  let bosskRifleAiming: boolean | null = null;

  /**
   * Put every weapon where the workbench grips say it sits in the hand.
   *
   * The grips are local to the authored hand mount, which reproduces our
   * canonical `weaponR` / `weaponL` frame — and until the sculpt lands those
   * bones ride the low-LOD stand-in's hands, which are the sculpt's hands at a
   * low LOD. So the same grips hold for both: applied now for the stand-in,
   * and again once the weapons have moved onto the sculpt's mounts (every one
   * of them sets an absolute transform, so applying twice changes nothing).
   */
  const seatWeapons = (): void => {
    const signature = guns.get(rangedKinds(id)[0]);
    if (signature) applySharedWeaponGrip(id, signature.main);
    // a staff of their own has its grip in data/heroStaffGrips.json, when
    // one was placed; the rest are left as mounted
    const staff = blades.get('gaffi');
    if (staff) applyHeroStaffGrip(id, staffPropFor(id), staff.main);
    const sabers = blades.get('sabers');
    if (cfg.sharedGrip === 'sabers' && sabers) applySharedWeaponGrip(id, sabers.main);
    if (id === 'din' && sabers) applyDinSaberGrip(sabers.main, inst.animator?.playing('upper') ?? null);
    // Cad Bane's workbench grips are local to the authored hands. Keeping
    // them on the mounts lets the same placement follow every body pose.
    const pistols = guns.get('pistols');
    if (id === 'duelist' && pistols?.offhand) {
      pistols.main.position.set(0.025752, 0.067437, -0.06784);
      pistols.main.quaternion.set(0.6537136, -0.0671748, 0.0762969, 0.7498832).normalize();
      pistols.offhand.position.set(-0.01701, 0.072469, -0.096437);
      pistols.offhand.quaternion.set(0.6447175, 0.0555208, -0.0388719, 0.7614103).normalize();
    }
    if (bosskRifle) {
      applyBosskRifleGrip(bosskRifle, false);
      bosskRifleAiming = false;
    }
    // Measured in the workbench against the authored palms at saberIdle.
    // The prop remains parented to each authored hand, so these grip-local
    // offsets carry through the other saber clips without per-pose copies.
    const authoredSaberGrips: Partial<Record<MandoId, { right: [number, number, number]; left: [number, number, number] }>> = {
      jedi: { right: [0.029395, -0.042681, 0.084449], left: [-0.025574, -0.036594, 0.052764] },
      ventress: { right: [-0.061119, 0.037725, -0.05356], left: [0.07399, 0.034259, -0.067775] },
    };
    const grip = authoredSaberGrips[id];
    if (grip && sabers) {
      sabers.main.position.set(...grip.right);
      sabers.offhand?.position.set(...grip.left);
    }
    // Maris' cross-grips sit at a different angle from an inline saber.
    // These hand-local transforms are the paired saberIdle workbench export.
    if (id === 'maris' && sabers?.offhand) {
      sabers.main.position.set(0.056147, -0.0761, -0.04007);
      sabers.main.quaternion.set(-0.1108576, 0.0752094, -0.0055576, 0.9909709).normalize();
      sabers.offhand.position.set(-0.056131, -0.068665, -0.032891);
      sabers.offhand.quaternion.set(-0.145249, -0.1509221, -0.0204729, 0.9776022).normalize();
    }
  };
  /** The stowed hilts, hip-local: the sculpt's pelvis, or until then the game rig's. */
  const seatHolsters = (): void => {
    for (const hilt of holsters) {
      const side = hilt.name.endsWith('L') ? 'left' : 'right';
      const grip = AUTHORED_STOWED_SABER_GRIPS[id]?.[side];
      if (grip) {
        hilt.position.set(...grip.position);
        hilt.quaternion.set(...grip.quaternion).normalize();
      }
    }
  };
  seatWeapons();
  seatHolsters();

  // ---- authored model swap ----
  // The procedural build above stays as the animation source and the instant
  // fallback; if models/<id>.glb loads, its skin rides the same rig instead.
  const swap = attachAuthored(rig, id, MODEL_HEIGHT[id], {
    animator: inst.animator,
    // weapons, thruster flames and the shield pane belong to the character,
    // not to the body being replaced
    keep: [b.weaponR, b.weaponL, flameRoot, shieldRoot, ...flames.map((f) => f.group), ...holsters],
    enabled: opts.authored !== false,
    onLoad: (model) => {
      adoptHeroMaterials(model.root);   // the skin arrives after the pass above
      // weapons move onto the authored hand so they track the real fingers; the
      // mount reproduces our canonical weaponR frame, so nothing else changes
      if (model.weaponMount) {
        for (const w of [...guns.values(), ...blades.values()]) model.weaponMount.add(w.main);
      }
      // The off-hand has to move too. Our own weaponL bone still animates, but
      // it sits where the hidden procedural arm is, so a pistol left on it
      // floats beside the authored body instead of filling its other hand.
      if (model.weaponMountL) {
        for (const w of [...guns.values(), ...blades.values()]) {
          if (w.offhand) model.weaponMountL.add(w.offhand);
        }
      }
      seatWeapons();
      // The procedural hip keeps animating but is hidden under the authored
      // skin. Carry the stowed hilts on the visible pelvis instead.
      if (model.holsterMount) for (const hilt of holsters) model.holsterMount.add(hilt);
      seatHolsters();
    },
  });

  let thrust = 0;
  // A grip editor can temporarily change the transform while the clip stays
  // fixed. Reapply only when the clip changes so the editor retains control.
  let armorerAxeClip: string | null = null;
  let dinSpearClip: string | null = null;
  let dinSaberClip: string | null = null;
  let weapon: 'blaster' | 'gaffi' | 'none' = 'blaster';
  let shieldUp = false;
  // per-hand "still in the hand" mask, so a thrown saber vanishes from its
  // hand alone; always true for anyone who never throws their weapon
  const saberHeld: [boolean, boolean] = [true, true];
  const showWeapon = () => {
    for (const w of guns.values()) {
      w.main.visible = !shieldUp && weapon === 'blaster' && w === gun;
      if (w.offhand) w.offhand.visible = w.main.visible;
    }
    // A thrown blade leaves its own hand empty while the other keeps fighting,
    // so each hand's visibility carries the per-hand held mask.
    for (const w of blades.values()) {
      const out = !shieldUp && weapon === 'gaffi' && w === blade;
      w.main.visible = out && saberHeld[0];
      if (w.offhand) w.offhand.visible = out && saberHeld[1];
      if (w === blades.get('sabers')) {
        for (const hand of [0, 1] as const) {
          if (holsters[hand]) holsters[hand].visible = saberHeld[hand] && !out;
        }
      }
    }
  };
  // Settle the loadout now rather than waiting for the first weapon switch:
  // an off-hand starts hidden, so a character who spawns with a pair was
  // holding only one of them until the player happened to swap and swap back.
  showWeapon();
  return {
    ...inst,
    // the muzzle belongs to whichever gun is in hand — a shot leaves the
    // barrel the player is actually looking down
    get muzzle() { return gun?.muzzle ?? emptyMuzzle; },
    get gaffi() { return blade.main; },
    modelReady: () => swap.settled,
    setWeapon: (w) => { weapon = w; showWeapon(); },
    setRangedKind: (kind: RangedKind) => { gun = guns.get(kind) ?? gun; showWeapon(); },
    setMeleeKind: (kind: MeleeKind) => { blade = blades.get(kind) ?? blade; showWeapon(); },
    setTrail: (on) => { trailActive = on; },
    setSaberHeld: (hand, held) => { saberHeld[hand] = held; showWeapon(); },
    nozzles: flames.map((f) => f.group),
    setThrust: (t) => { thrust = t; },
    setBlock: (t) => {
      // both hands go to the shield, so the weapon is stowed while it is up
      const up = t > 0.5;
      if (up !== shieldUp) { shieldUp = up; showWeapon(); }
      shield.setStrength(t);
    },
    shieldHit: () => { shield.hit(); },
    setHeroLight: (intensity) => {
      heroAmbient = intensity;
      for (const m of heroMats) m.emissiveIntensity = intensity;
    },
    cosmetic: (dt, time) => {
      if (id === 'din') {
        const clip = inst.animator?.playing('upper') ?? null;
        if (clip !== dinSpearClip) {
          applyDinSpearGrip(blades.get('gaffi')!.main, clip);
          dinSpearClip = clip;
        }
        if (clip !== dinSaberClip) {
          applyDinSaberGrip(blades.get('sabers')!.main, clip);
          dinSaberClip = clip;
        }
      }
      if (bosskRifle) {
        const aiming = inst.animator?.playing('upper') === 'aimUpper';
        if (aiming !== bosskRifleAiming) {
          applyBosskRifleGrip(bosskRifle, aiming);
          bosskRifleAiming = aiming;
        }
      }
      if (id === 'armorer') {
        const clip = inst.animator?.playing('upper') ?? null;
        if (clip !== armorerAxeClip) {
          applyArmorerAxeGrip(blades.get('gaffi')!.main, clip);
          armorerAxeClip = clip;
        }
      }
      shield.update(dt, time);
      // after the retarget, so a wheel held in body space is solved against
      // this frame's hand rather than the last one's
      swap.update();
      if (sabers) {
        const clip = inst.animator?.playing('upper') ?? null;
        const spin = gripSpinFor(clip);
        const progress = inst.animator?.clipProgress('upper') ?? 0;
        applyGripSpin(sabers.main, 'right', clip, spin, progress, dt, inst.root, rig.bones.hips);
        if (sabers.offhand) applyGripSpin(sabers.offhand, 'left', clip, spin, progress, dt, inst.root, rig.bones.hips);
      }
      for (const trail of trailUpdates) trail(dt, trailActive);
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
