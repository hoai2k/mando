import * as THREE from 'three';
import { loadProp } from '../characters/authored';
import { addBox, addCyl, addSphere, makeCarbine, makeCrossbow, makeGaffi, makeLongRifle, makePistol, mat, type CharacterInstance } from '../characters/builder';
import { addElectrostaffArcs } from '../characters/electrostaffFx';
import { mountEnemyProp } from '../characters/enemies';
import { MANDO_ROSTER, meleeKinds, rangedKinds, staffPropFor, type MandoId } from '../characters/mandalorians';
import type { Pose } from './poses';

/**
 * Weapon choice — try a different held weapon on a character, in the
 * workbench only.
 *
 * Plenty of the cast carry a weapon because it was the one to hand when they
 * were built: every trooper has the same infantry rifle, every Mandalorian the
 * same gaffi. This swaps the held prop live, pose by pose, so a better pick can
 * be judged on the figure and handed back as JSON. Nothing here touches what
 * the game builds.
 *
 * Sabers, the Darksaber and Din's beskar spear are not on offer, and their
 * owners' slots offer nothing: those fighters are defined by that one weapon.
 */

export type WeaponSlot = 'melee' | 'gun';

/**
 * How a weapon's builder lays it out, which decides how it sits on the hand
 * mount. A staff is built along Y and carried with a half-turn; a club and a
 * gun both take a quarter-turn, one head-up and one barrel-forward.
 */
type Family = 'staff' | 'club' | 'gun';

/** Each family's weaponR-local mount, as the game's builders place it. */
const CANON: Record<Family, THREE.Matrix4> = {
  staff: new THREE.Matrix4().makeRotationX(Math.PI),
  club: new THREE.Matrix4().makeRotationX(Math.PI / 2),
  gun: new THREE.Matrix4().makeRotationX(Math.PI / 2),
};

interface Made {
  main: THREE.Group;
  /** a second copy for the left hand — only the twin pistols have one */
  offhand?: THREE.Group;
  /** per-frame animation the weapon carries on its own, e.g. electrostaff arcs */
  tick?: (time: number) => void;
}

export interface WeaponOption {
  /** the prop id: the .glb in public/models it loads */
  id: string;
  name: string;
  slot: WeaponSlot;
  family: Family;
  make: () => Made;
}

const wood = (): THREE.Material => mat(0x6b4c2c, { rough: 0.95 });
const steel = (): THREE.Material => mat(0x8a8f92, { rough: 0.4, metal: 0.6 });
const gunmetal = (): THREE.Material => mat(0x3d3730, { rough: 0.5, metal: 0.5 });
const gunDark = (): THREE.Material => mat(0x1d1d1f, { rough: 0.55, metal: 0.4 });

/**
 * A polearm with no builder of its own in the game yet. It follows
 * `makeGaffi`'s layout exactly — a shaft along Y, the sculpt's long Z axis
 * turned onto it — so it sits in the hand the way every other staff does.
 */
function polearm(id: string, length: number): Made {
  const g = new THREE.Group();
  addCyl(g, wood(), 0.02, 0.024, length * 0.9, 0, 0, 0, 0, 0, 0, 8);
  g.userData.propPending = true;
  const prop = loadProp(id, length, {
    axis: 'longest',
    onLoad: () => { for (const c of g.children) if ((c as THREE.Mesh).isMesh) c.visible = false; },
    onSettle: () => { g.userData.propPending = false; },
  });
  prop.rotation.x = -Math.PI / 2;
  g.add(prop);
  return { main: g };
}

/** The enemy props, built the way `characters/enemies.ts` builds each of them. */
function enemyRifle(): Made {
  const g = new THREE.Group();
  const dark = mat(0x2a2a2a, { rough: 0.5, metal: 0.5 });
  addBox(g, dark, 0.045, 0.07, 0.4, 0, 0, 0.08);
  addCyl(g, dark, 0.014, 0.014, 0.3, 0, 0.01, 0.36, Math.PI / 2, 0, 0, 6);
  mountEnemyProp(g, 'enemy_blaster_rifle', 0.75, 0, 0.14, 0, true);
  return { main: g };
}
function club(id: 'pirate_boarding_club' | 'alamite_stone_club'): Made {
  const g = new THREE.Group();
  if (id === 'pirate_boarding_club') {
    addCyl(g, mat(0x241d16, { rough: 0.8 }), 0.025, 0.03, 0.7);
    addBox(g, steel(), 0.1, 0.14, 0.1, 0, 0.38, 0);
    mountEnemyProp(g, id, 0.7, Math.PI / 2, 0, 0.14);
  } else {
    addCyl(g, mat(0x77695a, { rough: 1 }), 0.025, 0.035, 0.62);
    addSphere(g, mat(0x8d8272, { rough: 1, flat: true }), 0.11, 0, 0.36, 0, 6, 5, 1.3, 1);
    mountEnemyProp(g, id, 0.68, Math.PI / 2, 0, 0.14);
  }
  return { main: g };
}
function flameProjector(): Made {
  const g = new THREE.Group();
  addBox(g, gunDark(), 0.06, 0.09, 0.34, 0, 0, 0.05);
  addCyl(g, steel(), 0.045, 0.045, 0.3, 0, 0.01, 0.3, Math.PI / 2, 0, 0, 8);
  mountEnemyProp(g, 'flame_projector', 0.6, 0, 0.2, 0, true);
  return { main: g };
}
function netLauncher(): Made {
  const g = new THREE.Group();
  addCyl(g, gunDark(), 0.05, 0.06, 0.4, 0, 0, 0.1, Math.PI / 2, 0, 0, 8);
  addCyl(g, steel(), 0.075, 0.06, 0.1, 0, 0, 0.32, Math.PI / 2, 0, 0, 8);
  mountEnemyProp(g, 'net_launcher', 0.5, 0, 0.12, 0, true);
  return { main: g };
}

/**
 * Everything a slot can be offered. The lightsabers (`saber_*`), Maris' saber
 * tonfas and the beskar spear are left out on purpose — see the file comment.
 */
export const WEAPON_OPTIONS: WeaponOption[] = [
  { id: 'gaffi', name: 'Gaderffii stick', slot: 'melee', family: 'staff', make: () => ({ main: makeGaffi(wood(), steel(), 'gaffi') }) },
  { id: 'gaffi_collection', name: 'Tusken gaderffii', slot: 'melee', family: 'staff', make: () => ({ main: makeGaffi(wood(), steel(), 'gaffi_collection') }) },
  { id: 'poleaxe', name: 'Poleaxe', slot: 'melee', family: 'staff', make: () => ({ main: makeGaffi(wood(), steel(), 'poleaxe') }) },
  {
    id: 'electrostaff', name: 'Electrostaff', slot: 'melee', family: 'staff',
    make: () => {
      const main = makeGaffi(mat(0x25262c, { rough: 0.55, metal: 0.55 }), mat(0x888b98, { rough: 0.4, metal: 0.7 }), 'electrostaff');
      return { main, tick: addElectrostaffArcs(main) };
    },
  },
  { id: 'force_pike', name: 'Force pike', slot: 'melee', family: 'staff', make: () => polearm('force_pike', 1.9) },
  { id: 'rey_staff', name: 'Quarterstaff', slot: 'melee', family: 'staff', make: () => polearm('rey_staff', 1.7) },
  { id: 'nightsister_polearm', name: 'Nightsister polearm', slot: 'melee', family: 'staff', make: () => polearm('nightsister_polearm', 1.8) },
  { id: 'pirate_boarding_club', name: 'Boarding club', slot: 'melee', family: 'club', make: () => club('pirate_boarding_club') },
  { id: 'alamite_stone_club', name: 'Stone club', slot: 'melee', family: 'club', make: () => club('alamite_stone_club') },

  { id: 'carbine', name: 'EE-3 carbine', slot: 'gun', family: 'gun', make: () => ({ main: makeCarbine(gunmetal(), gunDark()) }) },
  { id: 'longrifle', name: 'Long rifle', slot: 'gun', family: 'gun', make: () => ({ main: makeLongRifle(gunmetal(), gunDark()) }) },
  { id: 'crossbow', name: 'Laser crossbow', slot: 'gun', family: 'gun', make: () => ({ main: makeCrossbow(gunmetal(), gunDark()) }) },
  { id: 'pistol', name: 'Blaster pistol', slot: 'gun', family: 'gun', make: () => ({ main: makePistol(gunmetal(), gunDark()) }) },
  {
    id: 'pistols', name: 'Twin blaster pistols', slot: 'gun', family: 'gun',
    make: () => ({ main: makePistol(gunmetal(), gunDark()), offhand: makePistol(gunmetal(), gunDark()) }),
  },
  { id: 'enemy_blaster_rifle', name: 'Infantry blaster rifle', slot: 'gun', family: 'gun', make: enemyRifle },
  { id: 'flame_projector', name: 'Flame projector', slot: 'gun', family: 'gun', make: flameProjector },
  { id: 'net_launcher', name: 'Net launcher', slot: 'gun', family: 'gun', make: netLauncher },
];

export const findWeaponOption = (id: string | null | undefined): WeaponOption | undefined =>
  WEAPON_OPTIONS.find((o) => o.id === id);

/**
 * What a pose puts in the hand. An attack is a melee pose and an aim is a gun
 * pose; the rest (idle, locomotion, flight, hit reacts) could carry either.
 * Saber stances belong to the saber's owner, and the block and unarmed poses
 * put the weapon away, so none of those offers a choice.
 */
export type PoseWeapon = WeaponSlot | 'either' | 'none';
export function poseWeapon(p: Pose): PoseWeapon {
  if (p.rig !== 'humanoid' || p.unarmed || p.block) return 'none';
  if (p.id.startsWith('saber') || p.id === 'flourish') return 'none';
  if (p.melee || p.id === 'enemySwing') return 'melee';
  if (p.upper && /aim/i.test(p.upper)) return 'gun';
  return 'either';
}

// ---------- a character's loadout ----------

/** The weapon a slot holds today, as the game builds it. */
interface HeldDefault {
  main: THREE.Object3D;
  offhand: THREE.Object3D | null;
  family: Family;
  /** the builder's own mount for this weapon, which a swap is measured from */
  canon: THREE.Matrix4;
}

export interface SlotDefault {
  /** option id of today's weapon, or null for bare hands */
  id: string | null;
  name: string;
  held: HeldDefault | null;
}

export interface Loadout {
  melee: SlotDefault | null;
  gun: SlotDefault | null;
  /** which slot an either-pose shows in the game */
  hand: WeaponSlot;
}

/**
 * The non-playable cast and the one weapon each carries. A single hand holds
 * it in every pose — the rifle is swung as a club in the enemy swing — so it
 * stands as the default for both slots. The swoop rider, creatures and props
 * are absent: nothing on them holds a weapon.
 */
const NPC_WEAPON: Record<string, { id: string | null; family: Family }> = {
  tusken: { id: 'gaffi_collection', family: 'staff' },
  pyke: { id: 'enemy_blaster_rifle', family: 'gun' },
  pirate: { id: 'enemy_blaster_rifle', family: 'gun' },
  pirateMelee: { id: 'pirate_boarding_club', family: 'club' },
  droid: { id: 'enemy_blaster_rifle', family: 'gun' },
  stormtrooper: { id: 'enemy_blaster_rifle', family: 'gun' },
  deathtrooper: { id: 'enemy_blaster_rifle', family: 'gun' },
  darktrooper: { id: 'enemy_blaster_rifle', family: 'gun' },
  escortDroid: { id: 'enemy_blaster_rifle', family: 'gun' },
  marshal: { id: 'enemy_blaster_rifle', family: 'gun' },
  fennec: { id: 'enemy_blaster_rifle', family: 'gun' },
  capo: { id: 'enemy_blaster_rifle', family: 'gun' },
  ringEnforcer: { id: 'enemy_blaster_rifle', family: 'gun' },
  gunslinger: { id: 'pistols', family: 'gun' },
  officer: { id: 'electrostaff', family: 'staff' },
  flametrooper: { id: 'flame_projector', family: 'gun' },
  quarren: { id: 'net_launcher', family: 'gun' },
  alamite: { id: 'alamite_stone_club', family: 'club' },
  enforcer: { id: null, family: 'club' },
};

const localMatrix = (o: THREE.Object3D): THREE.Matrix4 =>
  new THREE.Matrix4().compose(o.position, o.quaternion, new THREE.Vector3(1, 1, 1));

/**
 * Read a freshly built character's weapons, before its authored model lands
 * and moves them onto the sculpt's hands. Null when nothing is on offer.
 */
export function loadoutFor(subjectId: string, inst: CharacterInstance & { gaffi?: THREE.Object3D }): Loadout | null {
  const rig = inst.rig;
  if (!rig) return null;
  const nameOf = (id: string | null): string => findWeaponOption(id)?.name ?? 'Bare hands';
  if (subjectId in MANDO_ROSTER) {
    const id = subjectId as MandoId;
    const guns = rangedKinds(id);
    const blades = meleeKinds(id);
    // `muzzle` is the drawn gun's barrel end, so its parent is the gun itself
    const gunMain = guns.length ? inst.muzzle?.parent ?? null : null;
    const gun: SlotDefault | null = gunMain ? {
      id: guns[0], name: nameOf(guns[0]),
      held: {
        main: gunMain, family: 'gun', canon: CANON.gun,
        offhand: guns[0] === 'pistols' ? rig.bones.weaponL.children.find((c) => c.name !== 'saberHandL') ?? null : null,
      },
    } : null;
    // Din's gaffi slot is his beskar spear, and a saber is its owner's own:
    // neither is offered, and neither is offered a replacement
    const staffId = staffPropFor(id);
    const melee: SlotDefault | null = blades[0] === 'gaffi' && id !== 'din' && inst.gaffi ? {
      id: staffId, name: nameOf(staffId),
      held: { main: inst.gaffi, offhand: null, family: 'staff', canon: CANON.staff },
    } : null;
    if (!gun && !melee) return null;
    return { gun, melee, hand: gun ? 'gun' : 'melee' };
  }
  const npc = NPC_WEAPON[subjectId];
  if (!npc) return null;
  const main = rig.bones.weaponR.children[0] ?? null;
  const held: HeldDefault | null = main ? {
    main, offhand: rig.bones.weaponL.children[0] ?? null, family: npc.family,
    // an enemy builder places each weapon by hand, so its own spawn transform
    // is the mount the weapon was designed around
    canon: localMatrix(main),
  } : null;
  const slot: SlotDefault = { id: npc.id, name: nameOf(npc.id), held };
  return { melee: slot, gun: slot, hand: findWeaponOption(npc.id)?.slot ?? 'melee' };
}

// ---------- swapping the prop on a figure ----------

/**
 * Hide a default weapon without fighting the character's own weapon logic.
 *
 * A Mandalorian re-shows his gun or staff on every `setWeapon`, so hiding it
 * once would last until the next pose change. Instead `visible` reads false for
 * as long as the swap stands, and whatever the character *asks* for is passed
 * to the replacement — it draws and stows exactly when the default would.
 */
interface Hidden { object: THREE.Object3D; shown: boolean }
function hide(object: THREE.Object3D, mirrors: THREE.Object3D[]): Hidden {
  const h: Hidden = { object, shown: object.visible };
  Object.defineProperty(object, 'visible', {
    configurable: true, enumerable: true,
    get: () => false,
    set: (v: boolean) => { h.shown = v; for (const m of mirrors) m.visible = v; },
  });
  for (const m of mirrors) m.visible = h.shown;
  return h;
}
function unhide(h: Hidden): void {
  Reflect.deleteProperty(h.object, 'visible');
  h.object.visible = h.shown;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

export class FigureWeapons {
  private active: {
    slot: WeaponSlot; option: WeaponOption; made: Made; hidden: Hidden[];
    held: HeldDefault | null; lastPos: THREE.Vector3; lastQuat: THREE.Quaternion; placed: boolean;
  } | null = null;

  constructor(private root: THREE.Object3D, private bones: { weaponR: THREE.Object3D; weaponL: THREE.Object3D },
    readonly loadout: Loadout) {}

  /** the option in hand now, or null when the default is showing */
  get shown(): string | null { return this.active?.option.id ?? null; }

  /** Put `optionId` in the hand for `slot`, or the default when it is null. */
  show(slot: WeaponSlot | null, optionId: string | null): void {
    const def = slot ? this.loadout[slot] : null;
    const option = findWeaponOption(optionId);
    if (!slot || !def || !option || option.slot !== slot || option.id === def.id) { this.release(); return; }
    if (this.active?.slot === slot && this.active.option === option) return;
    this.release();
    const made = option.make();
    made.main.name = option.id;
    if (made.offhand) made.offhand.name = `${option.id}L`;
    const mirrors = [made.main, ...(made.offhand ? [made.offhand] : [])];
    const hidden: Hidden[] = [];
    if (def.held) {
      hidden.push(hide(def.held.main, mirrors));
      if (def.held.offhand) hidden.push(hide(def.held.offhand, []));
    }
    this.active = {
      slot, option, made, hidden, held: def.held,
      lastPos: new THREE.Vector3(), lastQuat: new THREE.Quaternion(), placed: false,
    };
    this.frame(0);
  }

  release(): void {
    const a = this.active;
    if (!a) return;
    for (const h of a.hidden) unhide(h);
    a.made.main.removeFromParent();
    a.made.offhand?.removeFromParent();
    this.active = null;
  }

  /**
   * Keep the replacement where the default is. The default moves: onto the
   * authored hand when the sculpt lands, and to a new grip whenever a clip
   * with its own grip starts (Din, the Armorer, the Tusken). The replacement
   * is re-seated only when the default actually moved, so a grip being
   * dragged in the weapon grip editor is left alone in between.
   */
  frame(time: number): void {
    const a = this.active;
    if (!a) return;
    const { held, made, option } = a;
    const parent = held?.main.parent ?? this.mount('weaponMount', this.bones.weaponR);
    if (parent && made.main.parent !== parent) parent.add(made.main);
    if (made.offhand) {
      const left = held?.offhand?.parent ?? this.mount('weaponMountL', this.bones.weaponL);
      if (left && made.offhand.parent !== left) left.add(made.offhand);
    }
    const moved = !a.placed || (held && (!held.main.position.equals(a.lastPos) || !held.main.quaternion.equals(a.lastQuat)));
    if (moved) {
      a.placed = true;
      this.seat(made.main, held?.main ?? null, held, option.family);
      if (made.offhand) this.seat(made.offhand, held?.offhand ?? null, held, option.family);
      if (held) { a.lastPos.copy(held.main.position); a.lastQuat.copy(held.main.quaternion); }
    }
    made.tick?.(time);
  }

  /**
   * Same family: take the default's grip outright — a gaffi held where the
   * poleaxe was held. Across families, carry the default's grip adjustment
   * over and seat the new weapon on its own family's mount inside it.
   * Scale is the new prop's own: a default's size multiplier was tuned for
   * that sculpt, not this one.
   */
  private seat(target: THREE.Object3D, from: THREE.Object3D | null, held: HeldDefault | null, family: Family): void {
    if (from && held && held.family === family) {
      target.position.copy(from.position);
      target.quaternion.copy(from.quaternion);
    } else {
      if (from && held) _m.copy(localMatrix(from)).multiply(held.canon.clone().invert()).multiply(CANON[family]);
      else _m.copy(CANON[family]);
      _m.decompose(target.position, target.quaternion, _s);
    }
    target.scale.setScalar(1);
  }

  /** the authored hand mount once the sculpt is in, else our own weapon bone */
  private mount(name: string, fallback: THREE.Object3D): THREE.Object3D {
    return this.root.getObjectByName(name) ?? fallback;
  }
}

// ---------- the session's picks ----------

export interface WeaponChoiceEntry {
  character: string;
  characterName: string;
  slot: WeaponSlot;
  choice: string;
  defaultId: string | null;
  defaultName: string;
}

const STORE = 'workbench.weaponChoices.v1';

/**
 * Picks per character and slot. Held in memory and mirrored to localStorage
 * when it is there, so a reload keeps them; an entry is removed, not stored,
 * when the pick goes back to the default.
 */
export class WeaponChoices {
  private map = new Map<string, WeaponChoiceEntry>();

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? '[]') as WeaponChoiceEntry[];
      for (const e of Array.isArray(saved) ? saved : []) {
        if (findWeaponOption(e.choice)?.slot === e.slot) this.map.set(this.key(e.character, e.slot), e);
      }
    } catch { /* private mode, or nothing saved */ }
  }

  get(character: string, slot: WeaponSlot): string | null {
    return this.map.get(this.key(character, slot))?.choice ?? null;
  }

  set(character: string, characterName: string, slot: WeaponSlot, def: SlotDefault, choice: string | null): void {
    const key = this.key(character, slot);
    if (!choice || choice === def.id) this.map.delete(key);
    else this.map.set(key, { character, characterName, slot, choice, defaultId: def.id, defaultName: def.name });
    this.save();
  }

  clear(): void { this.map.clear(); this.save(); }

  entries(): WeaponChoiceEntry[] {
    return [...this.map.values()].sort((a, b) => a.character.localeCompare(b.character) || a.slot.localeCompare(b.slot));
  }

  private key(character: string, slot: WeaponSlot): string { return `${character}|${slot}`; }
  private save(): void {
    try { localStorage.setItem(STORE, JSON.stringify(this.entries())); } catch { /* private mode */ }
  }
}
