import type { GameText } from '../text';

/**
 * Every weapon sculpt a hand can hold, and what the game and the workbench
 * both need to know about it.
 *
 * The id is the prop's .glb in public/models. `length` is what the sculpt is
 * scaled to along its longest axis, in metres — the hand grips exported from
 * the workbench were set against these lengths, so a change here moves every
 * grip on that weapon. `family` is how its builder lays it out, and so how it
 * sits on the hand mount: a staff is built along Y and carried with a
 * half-turn, a club and a gun both take a quarter-turn (see weaponChoice.ts).
 * `name` is the key of what the HUD calls it (TEXT.weapons.props), for a prop
 * the HUD names by itself; the rest go by their slot's name.
 */
export type PropFamily = 'staff' | 'club' | 'gun' | 'saber';

interface WeaponProp {
  family: PropFamily;
  length: number;
  name?: keyof GameText['weapons']['props'];
  /**
   * The name its hand group goes by, where it is not the slot's own `gaffi`.
   * The workbench labels grip targets and exports with it.
   */
  node?: string;
  /** what it meets a blade as (src/game/melee.ts), where that is not steel */
  blade?: 'beskar';
}

export const WEAPON_PROPS = {
  // ---- staffs: built by makeGaffi, the gaffi slot's weapon ----
  gaffi: { family: 'staff', length: 1.5 },
  gaffi_collection: { family: 'staff', length: 1.5 },
  beskar_spear: { family: 'staff', length: 1.65, name: 'beskarSpear', node: 'beskarSpear', blade: 'beskar' },
  poleaxe: { family: 'staff', length: 1.45, name: 'poleaxe', node: 'poleaxe' },
  electrostaff: { family: 'staff', length: 1.8 },
  // the workbench's weapon-choice lengths, which the hand grips were set with
  rey_staff: { family: 'staff', length: 1.7, name: 'quarterstaff' },
  force_pike: { family: 'staff', length: 1.9, name: 'forcePike' },
  nightsister_polearm: { family: 'staff', length: 1.8 },
  // ---- clubs ----
  pirate_boarding_club: { family: 'club', length: 0.7 },
  alamite_stone_club: { family: 'club', length: 0.68 },
  // ---- guns ----
  carbine: { family: 'gun', length: 0.72 },
  crossbow: { family: 'gun', length: 0.72 },
  longrifle: { family: 'gun', length: 1.05 },
  pistol: { family: 'gun', length: 0.34 },
  enemy_blaster_rifle: { family: 'gun', length: 0.75 },
  flame_projector: { family: 'gun', length: 0.6 },
  net_launcher: { family: 'gun', length: 0.5 },
  // ---- saber hilts: built by makeSaber, chosen by style (SABER_STYLES) ----
  saber_jedi: { family: 'saber', length: 0.26 },
  saber_dark: { family: 'saber', length: 0.26, name: 'redSaber' },
  saber_curved: { family: 'saber', length: 0.26 },
  saber_double: { family: 'saber', length: 0.43, name: 'doubleSaber' },
  maris_tonfa: { family: 'saber', length: 0.52 },
} as const satisfies Record<string, WeaponProp>;

export type WeaponPropId = keyof typeof WEAPON_PROPS;
type PropsOf<F extends PropFamily> = {
  [K in WeaponPropId]: (typeof WEAPON_PROPS)[K]['family'] extends F ? K : never
}[WeaponPropId];
/** a sculpt makeGaffi can build: anything carried in the gaffi slot */
export type StaffPropId = PropsOf<'staff'>;

/** the registry entry, with the optional fields readable on any id */
export const weaponProp = (id: WeaponPropId): WeaponProp => WEAPON_PROPS[id];

/**
 * The saber styles, one per kind of blade a fighter carries, and what each
 * one means beyond its look (the look itself is makeSaber's):
 *
 *  - `prop` is the authored hilt. The Darksaber borrows the Jedi hilt.
 *  - `pair` is two blades, one per hand, rather than a single one. It decides
 *    how many can be thrown, whether an off-hand copy and a second holster
 *    are built, and how brightly each blade lights its surroundings.
 *  - `clips` is the keyed clip family its strikes play: `saber1`…`saber3`,
 *    `tonfa1`…, `staff1`…, `darksaber1`…. A double-bladed saber is swung as a
 *    staff. See `saberClipSet` for the stance and the legs.
 *  - `name` is what the HUD calls a style whose hilt it borrows from another
 *    (the Darksaber is built on the Jedi hilt); otherwise the hilt's own name
 *    applies, and a pair with none is the slot's "Twin Sabers".
 */
export type SaberStyle = 'red' | 'white' | 'tonfa' | 'dark' | 'double' | 'darksaber';
export type SaberClipSet = 'saber' | 'tonfa' | 'staff' | 'darksaber';

export const SABER_STYLES: Record<SaberStyle, {
  prop: PropsOf<'saber'>; pair: boolean; clips: SaberClipSet; name?: keyof GameText['weapons']['props'];
}> = {
  red: { prop: 'saber_curved', pair: true, clips: 'saber' },
  white: { prop: 'saber_jedi', pair: true, clips: 'saber' },
  tonfa: { prop: 'maris_tonfa', pair: true, clips: 'tonfa' },
  dark: { prop: 'saber_dark', pair: false, clips: 'saber' },
  double: { prop: 'saber_double', pair: false, clips: 'staff' },
  darksaber: { prop: 'saber_jedi', pair: false, clips: 'darksaber', name: 'darksaber' },
};

/** The clip-name prefixes a saber style plays, by use (see `saberClipSet`). */
export interface SaberClips {
  /** strikes: `${attack}1`…`${attack}3` */
  attack: SaberClipSet;
  /** `${stance}IdleUpper`, `${stance}RunUpper`, `${stance}Flourish` */
  stance: SaberClipSet;
  /** a standing strike's legs: `${lower}Lower1`…`${lower}Lower3` */
  lower: 'staff' | 'melee';
}

/**
 * The Darksaber has strikes of its own but borrows the ordinary saber stance,
 * idle, run and flourish; only the staff set has legs of its own for a
 * standing strike. Built once: the controller asks every frame.
 */
const CLIP_SETS = Object.fromEntries(Object.entries(SABER_STYLES).map(([style, { clips }]) => [style, {
  attack: clips,
  stance: clips === 'darksaber' ? 'saber' : clips,
  lower: clips === 'staff' ? 'staff' : 'melee',
}])) as Record<SaberStyle, SaberClips>;

export const saberClipSet = (style: SaberStyle): SaberClips => CLIP_SETS[style];
