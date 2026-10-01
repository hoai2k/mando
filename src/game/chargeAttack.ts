/**
 * The charged melee strike: hold the melee button past a tap and the fighter
 * settles into a wound-up ready pose, the strike gathering power while the
 * button stays down; let go and the weapon's heavy swing is thrown out of
 * that pose, harder the longer it was held.
 *
 * Everything here is pure data and arithmetic so any combatant can use it —
 * the player drives it today (src/player/player.ts), and a hostile that wants
 * to telegraph a big swing can hold the same ready clip and scale its hit the
 * same way.
 *
 *  - A press shorter than CHARGE_THRESHOLD is a tap: the ordinary combo swing.
 *  - Past it the ready pose holds, and the charge climbs from 0 to 1 over
 *    CHARGE_FULL seconds.
 *  - The release lands for `chargeDamageScale(level)` times the heavy swing's
 *    damage: 1x at the threshold, CHARGE_MAX_SCALE at a full charge.
 *  - A full charge (`breaksGuard`) goes through a conventional parry: the
 *    defender's strike is beaten aside and the blow lands (src/game/melee.ts).
 */

/** seconds the button must stay down before a press is a charge, not a tap */
export const CHARGE_THRESHOLD = 0.22;
/** seconds of holding, past the threshold, to a full charge */
export const CHARGE_FULL = 1.2;
/** the damage multiplier at a full charge (1 at the threshold) */
export const CHARGE_MAX_SCALE = 2.5;
/** at or above this charge the strike breaks a conventional parry */
export const CHARGE_BREAK_LEVEL = 0.999;
/**
 * Held at full for longer than this, the feet start to give a little of the
 * attack pace back — a fighter can sit on a full charge, but not for free.
 */
export const CHARGE_FULL_GRACE = 0.8;
/** how much of the attack pace a long-held full charge gives up, at most */
export const CHARGE_HOLD_SLOW = 0.2;
/** a hit at least this heavy knocks a fighter out of their charge */
export const CHARGE_INTERRUPT_DAMAGE = 6;

/** how far the charge has got after `held` seconds in the ready pose (0..1) */
export const chargeLevel = (held: number): number => Math.max(0, Math.min(1, held / CHARGE_FULL));

/** the release's damage multiplier for a charge `level` (0..1) */
export const chargeDamageScale = (level: number): number => 1 + (CHARGE_MAX_SCALE - 1) * Math.max(0, Math.min(1, level));

/** whether a release at `level` breaks a conventional guard */
export const breaksGuard = (level: number): boolean => level >= CHARGE_BREAK_LEVEL;

/**
 * The pace multiplier (on the attack pace) after `pastFull` seconds held at a
 * full charge: 1 until the grace runs out, easing down to 1 - CHARGE_HOLD_SLOW.
 */
export function chargeHoldPace(pastFull: number): number {
  const over = Math.max(0, pastFull - CHARGE_FULL_GRACE);
  return 1 - CHARGE_HOLD_SLOW * Math.min(1, over / 2);
}

/**
 * Which ready pose and release a weapon uses. `melee` is every staff, spear,
 * poleaxe and gaffi; the saber families follow the saber style's clip set
 * (src/characters/weaponProps.ts); `fists` is bare hands, a brawler's or a
 * saber fighter whose blades are both away.
 */
export type ChargeFamily = 'melee' | 'saber' | 'tonfa' | 'staff' | 'darksaber' | 'fists';

export interface ChargeMove {
  /** the held wind-up on the upper channel (a looping clip) */
  ready: string;
  /** the release: the family's heavy swing */
  upper: string;
  /** the legs' half of the release, when the strike is thrown from a stand */
  lower: string;
  /**
   * Where in the release clip it starts, as a share of the clip: just before
   * its own wind-up key, which is the shape the ready pose holds — the hold
   * was the anticipation, so the strike does not wind up a second time.
   */
  from: number;
  /** the release's contact key, as a share of the clip (the combo's 45%) */
  hit: number;
  /** the legs always take the strike when standing (a punch thrown from the hips) */
  lowerAlways?: boolean;
  /**
   * How far past the target's radius the lunge stops, metres, when the
   * strike's contact is closer in than a combo swing's (the player's default
   * is LUNGE_STANDOFF). The twin sabers' finisher throws both blades out to
   * the sides from a gather on the chest, so it is thrown from closer.
   */
  standoff?: number;
}

export const CHARGE_MOVES: Record<ChargeFamily, ChargeMove> = {
  // overhead chop: cocked high behind the head, dropped through the target
  melee: { ready: 'meleeReadyUpper', upper: 'melee3', lower: 'meleeLower3', from: 0.36, hit: 0.45 },
  // the Darksaber's finisher is the overhead chop with the free arm's counterweight
  darksaber: { ready: 'darksaberReadyUpper', upper: 'darksaber3', lower: 'meleeLower3', from: 0.36, hit: 0.45 },
  // both blades gathered across the chest, thrown apart
  saber: { ready: 'saberReadyUpper', upper: 'saber3', lower: 'meleeLower3', from: 0.36, hit: 0.45, standoff: 0.45 },
  // both tonfas cocked back, wheeled over the top and down
  tonfa: { ready: 'tonfaReadyUpper', upper: 'tonfa3', lower: 'meleeLower3', from: 0.24, hit: 0.45 },
  // the double blade wound round behind the lead shoulder, then the pivot
  staff: { ready: 'staffReadyUpper', upper: 'staff3', lower: 'staffLower3', from: 0.26, hit: 0.45 },
  // the rear fist cocked by the ear, then the cross
  fists: { ready: 'fistReadyUpper', upper: 'fistCrossUpper', lower: 'fistCrossLower', from: 0.22, hit: 0.45, lowerAlways: true },
};

/** the release each ready pose leads into, for anything keyed on the strike's clip (the weapon grips) */
export const CHARGE_READY_RELEASE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(CHARGE_MOVES).map((m) => [m.ready, m.upper]),
);
