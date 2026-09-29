import { TEXT } from '../text';
import * as THREE from 'three';
import type { Game } from './game';
import type { Player } from '../player/player';
import type { Enemy } from '../enemies/enemy';
import { applyKnockback } from '../core/body';
import type { Board, VehicleSpec } from '../world/board';
import type { FrameInput } from '../core/input';
import type { StaticBox } from '../core/physics';
import type { DeflectSphere } from '../fx/projectiles';
import { loadProp } from '../characters/authored';
import { propsUsed } from '../world/props';
import { audio } from '../core/audio';
import { clamp, damp, dampAngle } from '../core/math';
import { BANTHA_STRIDE } from '../anim/quadruped';
import { orientFoot, reachLeg, seatSurface, spreadKnees } from '../anim/seating';
import type { Rig } from '../anim/skeleton';
import { ANKLE_OVER_SOLE, CANONICAL_HIPS, footQuaternion, stanceRise, VEHICLE_ANCHORS, type VehicleAnchor } from './vehicleAnchors';
import { createShieldField, type ShieldField } from '../fx/shieldfield';
import { saberClipsFor } from '../characters/mandalorians';

/**
 * Pilotable vehicles (PLAN.md §17): rides with hit points parked around the
 * boards. Y near one mounts, the left stick drives it — forward and back on
 * the throttle, left and right on the nose, the same stick that moves the
 * character on foot — ramming is the weapon, and sooner or later it is shot
 * out from under you or you put it into a wall. Then the rider is thrown, the
 * wreck goes up at the size of the hull that made it *and takes a piece of
 * the rider with it*, and twenty seconds later the ride is back where the
 * board parked it. Not transport: a toy that ends in a crash.
 *
 * The other two face buttons keep the meaning they have on foot, which is the
 * whole point of the scheme: A hops the ride the way it jumps the character,
 * and RB raises a shield — the rider's own field thrown round the hull, over
 * both of them. It turns attacks and nothing else: a wall is not an attack,
 * and neither is your own repulsor core going up under you.
 *
 * What breaks a ride depends on what it is. Gunfire is what kills the light
 * frames; crashing is what kills the heavy ones, and the heavier the hull the
 * more lopsided that trade — see `shotResist` and `crashScale` on the def.
 */

export interface VehicleDef {
  name: string;
  hp: number;
  /** top speed under throttle, m/s */
  top: number;
  /** what the accelerator is worth, m/s² */
  throttle: number;
  /** what the brake is worth, m/s² — reverse pulls away at 60% of throttle */
  brake: number;
  /** how fast it coasts down with both pedals up, m/s² */
  drag: number;
  /** how fast the nose comes round at speed, rad/s */
  turn: number;
  /**
   * How quickly sideways slide bleeds off (damp lambda). Low is loose: the
   * tail steps out through a hard turn and the ride drifts before it bites.
   */
  grip: number;
  /** boost impulse, m/s, on the dash button */
  boost: number;
  /** collision capsule radius (moveCapsule is one capsule, so long hulls approximate) */
  radius: number;
  /** capsule/parked-box height from the keel up */
  body: number;
  /** ride height of the keel over ground (or water) */
  hover: number;
  /** hull length, for the ram axis and the bolt spheres */
  length: number;
  /** player-root offset from the keel while riding (saddle top − hip height) */
  seat: { x: number; y: number; z: number };
  /**
   * How the rider is carried: thrown across a saddle, sitting in a seat with
   * the legs forward, or standing at a tiller. It picks the pose clips and
   * how far under the seat surface the rider's root goes.
   */
  stance: 'saddle' | 'seated' | 'stand';
  /**
   * Where the rider's hands go, measured **from the seat surface** in the
   * ride's own space: `x` is the half-spacing (mirrored for the two hands),
   * `y` the height above the seat, `z` how far ahead of it.
   *
   * Anchored to the seat rather than to the keel because the seat is the one
   * thing that is measured off the sculpt (`seatToModel`): a model whose
   * saddle sits higher than the stand-in's carries the bars up with it, which
   * is the whole point. A ride that leaves this out keeps the animation's own
   * arms — `hands: 'left'` is for an animal, where the off hand holds the
   * reins and the other one holds a blaster.
   */
  hands?: { x: number; y: number; z: number; only?: 'left' };
  /** authored .glb to swap in when present */
  modelId?: string;
  modelSize?: number;
  /** which extent `modelSize` measures; the default takes the longest */
  modelAxis?: 'x' | 'y' | 'z' | 'longest';
  /** stand the sculpt on the keel instead of hanging it off its own origin */
  modelGround?: boolean;
  /** turn the sculpt about the vertical (radians), for one delivered facing the wrong way */
  modelYaw?: number;
  /**
   * An animal rather than a machine. A mount has no engine and no ignition, it
   * walks its gait clips instead of hovering, and when it dies it goes down in
   * the sand — no repulsor core to detonate.
   */
  living?: boolean;
  /**
   * How much of a bolt, a blade or a blast the hull actually feels.
   *
   * The heavier the ride, the less small-arms fire means to it: a cargo skiff
   * is a slab of freight plate and a bolt is a scorch mark on it, where the
   * same bolt through a swoop's spine is most of a swoop. Under 1 the ride is
   * armoured against shooting — never immune, which is the point of "still
   * takes some" — and the way to break it is to crash it.
   */
  shotResist: number;
  /**
   * What a crash costs: a multiplier on the speed the impact took away.
   *
   * This is the other half of the same trade. Mass that shrugs off bolts has
   * nowhere to put its momentum when it meets a wall, so for the big rides
   * this is where nearly all their damage comes from.
   */
  crashScale: number;
  /** tonnage — who comes off worse when two rides meet, and who barely notices */
  mass: number;
  /**
   * A gun on the ride (K3, docs/SECTIONS_IMPLEMENTATION.md §3): a nose cannon
   * on a bike, the barrels of a turret. Absent on every ride the boards park —
   * there the vehicle is the weapon — and a section opts a ride in through
   * `VehicleOpts`.
   */
  gun?: GunDef;
  /**
   * The rider's own melee weapon swung to a flank from the saddle (K3): the
   * melee button, at whoever is alongside. Off unless a section opts in.
   */
  sideSwing?: boolean;
  /** a second seat behind the driver, in the ride's own space; the pillion works the weapons */
  pillion?: { x: number; y: number; z: number };
  /** a stationary mount: an arc, a sight and a gun, and no engine at all */
  turret?: TurretDef;
}

/**
 * A gun on a ride (K3). A bike's twin nose cannons, a turret's four barrels:
 * the trigger is held, the muzzles alternate, and heat stacks until the gun
 * locks up and has to vent — a hold is seconds, not a state, the same as the
 * rider's own blaster.
 */
export interface GunDef {
  /** shots a second with the trigger held */
  rate: number;
  /** the heat one shot adds; the gun locks at 1 */
  heat: number;
  /** heat vented a second off the trigger */
  cool: number;
  /** an overheated gun is back below this */
  resume: number;
  damage: number;
  /** bolt speed, m/s */
  speed: number;
  /** half-angle of the soft-lock cone, radians — a bolt bends onto a target inside it */
  cone: number;
  /** how far the soft lock looks, metres */
  range: number;
  /** muzzles in the ride's own space (as `seat`), alternated shot to shot */
  muzzles: { x: number; y: number; z: number }[];
  voice?: 'carbine' | 'crossbow' | 'longrifle' | 'pistols';
}

/** A turret (K3): a ride that cannot move, with an arc, a sight and an auto-fire mode. */
export interface TurretDef {
  /** half the yaw arc either side of the mount's facing, radians (π = all round) */
  yawArc: number;
  pitchMin: number;
  pitchMax: number;
  /** the gunner's eye over the keel, in the gun's own (turned) space */
  sight: { x: number; y: number; z: number };
  /** the height of the trunnion the barrels pitch about */
  pivot: number;
  /** how fast the gun comes round, rad/s */
  slew: number;
  /** with nobody in it: fire at this fraction of the rate (0 = never) */
  auto: number;
  /** how far an unmanned gun looks for something to shoot */
  autoRange: number;
}

/**
 * What a section hands a ride it builds (K3): the weapons it carries, the
 * lane that guides it, and whether it comes back where it was parked when
 * it is wrecked. Every field is optional, and a ride built without any of
 * them is exactly the ride the boards park.
 */
export interface VehicleOpts {
  gun?: GunDef;
  sideSwing?: boolean;
  pillion?: { x: number; y: number; z: number };
  lane?: SplineLane | null;
  /** false: a wreck stays a wreck (the section brings a fresh one) */
  respawns?: boolean;
  /** a turret's side when nobody is in it (0 = the party's gun) */
  team?: number;
  /** hit points other than the kind's own (a gun barge is a skiff built lighter) */
  hp?: number;
  /** a turret built otherwise than the kind's own: its arc, its auto-fire */
  turret?: Partial<TurretDef>;
}

/**
 * A lane-guided ride's road (K3, `Vehicle.lane`): a spline down a river, a
 * pier, a chute. Forward is carried along it, so the stick is *where in the
 * lane* and *how fast*, never which way the level goes. `lat` is metres to
 * the right of the centre line, looking along the lane.
 */
export interface SplineLane {
  /** total length, metres */
  readonly length: number;
  /** where a point is on the lane; `hint` is the last answer, which keeps a bend that doubles back honest */
  project(x: number, z: number, hint?: number): { s: number; lat: number };
  /** the world point at distance `s`, `lat` metres right of the line (y is the floor there) */
  point(s: number, lat: number, out: THREE.Vector3): THREE.Vector3;
  /** the heading of the lane at `s` (yaw: 0 = +Z) */
  heading(s: number): number;
  /** how far either side of the line a hull may go at `s` */
  halfWidth(s: number): number;
  /** the throttle band at `s`: pulled back, stick centred, stick forward */
  speed(s: number): { min: number; cruise: number; max: number };
  /** a riderless hull here goes under (lava, open water) rather than coasting to a stop */
  sinks?(s: number, lat: number): boolean;
}

/** what a lane brain asks of a hostile's ride this frame (see `Vehicle.laneBrain`) */
export interface LaneOrder {
  /** the lane offset to make for, metres right of the line */
  lat: number;
  /** the speed to hold, m/s */
  speed: number;
  boost?: boolean;
  /** swing to this flank now (-1 left, 1 right) */
  swing?: -1 | 1 | 0;
  /** hold the trigger */
  fire?: boolean;
  /**
   * Fire at this point instead of off the nose: the rider's own blaster,
   * turned in the saddle at someone behind (the gun's rate and heat still
   * apply). A gunner riding ahead of the party shoots back this way.
   */
  aimAt?: THREE.Vector3 | null;
}

export const VEHICLE_DEFS: Record<VehicleSpec['kind'], VehicleDef> = {
  swoop: {
    name: 'Swoop', hp: 180, top: 24, throttle: 15, brake: 24, drag: 4.5,
    turn: 2.3, grip: 4.5, boost: 9,
    shotResist: 1, crashScale: 1.6, mass: 1,
    radius: 0.85, body: 1.1, hover: 0.55, length: 2.8,
    // saddle at 0.44 over the keel on `nikto_swoop`, bars either side of the
    // cowl just ahead of it — both measured off the sculpt, see `seatToModel`
    seat: { x: 0, y: -0.38, z: -0.28 }, stance: 'saddle',
    modelId: 'nikto_swoop', modelSize: 2.6,
    hands: { x: 0.28, y: 0.29, z: 0.23 },
  },
  speederBike: {
    name: TEXT.vehicles.speeder, hp: 150, top: 27, throttle: 18, brake: 22, drag: 4,
    turn: 2.6, grip: 3.8, boost: 10,
    // the lightest frame in the game: quickest to shoot down, and the one
    // ride that is genuinely fragile in a straight line
    shotResist: 1.15, crashScale: 1.6, mass: 0.9,
    radius: 0.8, body: 1.15, hover: 0.6, length: 3.0,
    // back on the saddle (0.50 over the keel on `speeder_bike`) with the bars
    // half a metre ahead of it and 34 cm up — the sculpt's own measurements
    seat: { x: 0, y: -0.34, z: -0.55 }, stance: 'saddle',
    modelId: 'speeder_bike', modelSize: 3.0,
    hands: { x: 0.3, y: 0.34, z: 0.5 },
  },
  landspeeder: {
    name: 'Landspeeder', hp: 320, top: 22, throttle: 11, brake: 18, drag: 3.5,
    turn: 1.7, grip: 5.5, boost: 8,
    shotResist: 0.5, crashScale: 4, mass: 2.4,
    radius: 1.15, body: 1.1, hover: 0.45, length: 4.4,
    // An open cockpit, not a saddle: the driver sits in the right-hand seat
    // (the sculpt's cushion is at x +0.22, z -0.42) with the legs forward into
    // the footwell and the hands out on the yoke over it.
    seat: { x: 0.22, y: -0.32, z: -0.42 }, stance: 'seated',
    modelId: 'landspeeder', modelSize: 4.5,
    hands: { x: 0.16, y: 0.19, z: 0.37 },
  },
  bantha: {
    // The Tuskens' own transport, and the one ride on the board that is alive:
    // slow, enormously heavy, and a wall of hide that soaks fire the way no
    // repulsor hull does. It cannot drift — four feet in the sand bite — and
    // it cannot flee, so taking one is a decision to walk into the fight.
    name: 'Bantha', hp: 500, top: 10, throttle: 5, brake: 9, drag: 3.2,
    turn: 1.5, grip: 9, boost: 4.5,
    // hide and wool over four tonnes of animal: bolts sink into it, and the
    // way to stop one is to put it into something
    shotResist: 0.45, crashScale: 2.5, mass: 4.5,
    radius: 1.5, body: 2.5, hover: 0.02, length: 5.4,
    seat: { x: 0, y: 2.05, z: -0.2 }, stance: 'saddle', living: true,
    modelId: 'bantha', modelSize: 4.5, modelAxis: 'z', modelGround: true,
    // the rein hand goes to the saddle's own pommel, 45 cm forward of the seat
    hands: { x: 0.14, y: 0.13, z: 0.45, only: 'left' },
  },
  skiff: {
    name: TEXT.vehicles.skiff, hp: 600, top: 15, throttle: 6.5, brake: 10, drag: 2.4,
    turn: 1.0, grip: 6.5, boost: 6,
    // freight plate: a hundred bolts to bring down, a dozen good crashes
    shotResist: 0.28, crashScale: 6, mass: 6,
    radius: 1.7, body: 1.3, hover: 0.9, length: 9,
    // The sculpt was delivered with its helm astern: turned half round, the
    // console end leads, and the pilot stands at it on the flat of the deck
    // (0.13 over the keel), facing it, with the cargo lashed behind.
    seat: { x: 0, y: 0.8, z: 2.6 }, stance: 'stand',
    modelId: 'skiff', modelSize: 9, modelYaw: Math.PI,
  },
  turret: {
    // K3's stationary mount: a quad gun on a ring. Nothing about it drives —
    // it has no top speed and never unparks — so every number the engine
    // reads is zero, and what it has instead is the arc, the sight and the gun.
    name: 'Quad gun', hp: 420, top: 0, throttle: 0, brake: 0, drag: 0,
    turn: 0, grip: 10, boost: 0,
    shotResist: 0.45, crashScale: 0, mass: 40,
    radius: 1.4, body: 2.2, hover: 0, length: 2.8,
    // the gunner sits in the bucket behind the breech and turns with the gun
    seat: { x: 0, y: 0.05, z: -1.0 }, stance: 'seated',
    modelId: 'quad_turret', modelSize: 4, modelAxis: 'longest', modelGround: true,
    gun: {
      // heat vents all the time and a shot adds it: 9 × 0.078 against 0.45 a
      // second locks a held trigger in about four seconds
      rate: 9, heat: 0.078, cool: 0.45, resume: 0.3, damage: 22, speed: 95,
      cone: 0.05, range: 140, voice: 'longrifle',
      muzzles: [
        { x: 0.32, y: 1.72, z: 1.9 }, { x: -0.32, y: 1.72, z: 1.9 },
        { x: 0.32, y: 1.42, z: 1.9 }, { x: -0.32, y: 1.42, z: 1.9 },
      ],
    },
    turret: {
      yawArc: Math.PI * 0.75, pitchMin: -0.25, pitchMax: 0.7,
      // the sight clears the shield plate (top at 2.3): any lower and aiming
      // below level looks into the plate's back
      sight: { x: 0, y: 2.7, z: -0.35 }, pivot: 1.55,
      slew: 2.6, auto: 0.5, autoRange: 90,
    },
  },
};

/**
 * The Magma Run's bike cannon (K3): twin bolts off the nose, alternating,
 * bent onto a target inside a ±12° cone. About two seconds of trigger to lock
 * it up, and a second and a half to come back.
 */
export const BIKE_CANNON: GunDef = {
  // 8 × 0.13 a second in, 0.55 out: a held trigger locks in two seconds
  rate: 8, heat: 0.13, cool: 0.55, resume: 0.35, damage: 16, speed: 80,
  cone: 12 * Math.PI / 180, range: 70, voice: 'carbine',
  muzzles: [{ x: 0.22, y: 0.55, z: 1.45 }, { x: -0.22, y: 0.55, z: 1.45 }],
};

/** the same cannons with a pirate on the trigger: slower, and not as sure */
export const BIKE_CANNON_HOSTILE: GunDef = {
  ...BIKE_CANNON, rate: 3.2, damage: 7, cone: 6 * Math.PI / 180, range: 55,
};

/** where a pillion sits on a speeder bike: over the engine, behind the saddle */
export const BIKE_PILLION = { x: 0, y: -0.28, z: -1.15 };

/** a mount's charge: how long the horns are down, and the wait before another */
const _restFoot = new THREE.Vector3();
const _bodyQ = new THREE.Quaternion();
const _soleQ = new THREE.Quaternion();
const _restKnee = new THREE.Vector3();

const CHARGE_TIME = 1.5;
const CHARGE_COOLDOWN = 5;
/** what the charge is worth as a multiple of the animal's own top speed */
const CHARGE_TOP = 1.75;

/**
 * What hurt the ride.
 *
 * - `shot` — a bolt, a blade, a blast, a burn: something aimed at the hull.
 *   Armoured against (`shotResist`), and the one kind the deflector turns.
 * - `crash` — a wall, or another hull. Charged in full (`crashScale`), and no
 *   field is any help against it.
 * - `contact` — the chip a hull takes for ramming a body. Billed at the shot
 *   rate, because that is what the number was tuned as, but it is the ride
 *   running into something rather than something being aimed at the ride, so
 *   the bubble does not pay for it: a shielded ride bowling a squad still
 *   wears itself down doing it.
 */
export type DamageKind = 'shot' | 'crash' | 'contact';

/**
 * How long a wreck stays a wreck. Rides are the board's toys, not a resource
 * you can spend: whatever you crash, shoot down or ride into the sarlacc is
 * back where it was parked twenty seconds later, so a match never quietly
 * runs out of them.
 */
const RESPAWN_DELAY = 20;
/** the dissolve on the way out, and the reassembly on the way back */
const DISSOLVE_TIME = 1.1;
const REFORM_TIME = 1.2;
/** speed lost in one impact before it counts as a crash rather than a scrape */
const CRASH_MIN = 4;
/** closing speed at which two rides meeting counts as a collision */
const VEHICLE_CRASH_MIN = 7;
/** a riderless ride under this speed has finished rolling and parks */
const COAST_STOP = 0.8;

/** how much of top speed reverse is worth */
const REVERSE_FRACTION = 0.35;
/** below this forward speed the brake stops stopping and starts reversing */
const REVERSE_THRESHOLD = 0.4;
/** stick deflection under which the throttle reads as centred and it coasts */
const PEDAL_DEADZONE = 0.05;

/**
 * The hop (A): a repulsor kick, not a jump.
 *
 * The field dumps everything it has downward for a moment, the ride leaves
 * ride height, arcs, and is caught again the instant it comes back down to
 * it. Enough to clear a crate line, a low wall or a body in the road — and
 * nowhere near enough to be flight, which is what the cooldown is for.
 */
const HOP_VEL = 8;
/** how long the repulsors stay let go: a ceiling on the arc, not its length */
const HOP_TIME = 1.2;
const HOP_COOLDOWN = 1;
/** how long after the sights come down the camera keeps settling onto the nose */
const AIM_SETTLE = 1.2;
/** what a hopping ride falls at while the field is off, m/s² */
const HOP_GRAVITY = 22;
/**
 * How far above ride height the repulsors reach up and take the hop back.
 *
 * Without the reach a hop arrives at ride height still doing eight metres a
 * second and punches straight through it into the ground, then spends the
 * next second climbing back out — which reads as the ride being dropped
 * rather than landing. Caught this far up, the hover's own damping has the
 * room to arrest it and set it down.
 */
const HOP_CATCH = 0.6;

/**
 * A lane-guided ride's repulsors reach this far down and no further. Off a
 * terrace lip the ground falls away by more, and the ride flies the drop on
 * gravity instead of being hauled down it by the hover spring — which at
 * seven metres is twenty g, and reads as the ride being slammed, not falling.
 */
const LANE_REACH = 1.8;
/** metres a second of sideways lean at full stick */
const LANE_LEAN = 11;
/** how quickly the lean follows the stick (damp lambda) */
const LANE_LEAN_BITE = 5.5;
/** the shove a double-tapped lean gives — the sideswipe, into whoever is there */
const SIDESWIPE = 10;
/** how far a knocked-off, riderless lane hull rolls on before the lava has it */
const SINK_AFTER = 1.1;
/** how long going under takes */
const SINK_TIME = 1.6;

/**
 * The side swing (K3): the rider's own weapon, swung from the saddle at
 * whoever is alongside. The box is measured from the swinger's hull in its
 * own axes — out to the flank, and a little ahead and behind — and a hit
 * lands on the *rider*, not the hull: a knocked rider comes out of the saddle
 * and their ride runs on without them.
 */
const SWING_OUT_MIN = 0.4;
const SWING_OUT_MAX = 4.8;
const SWING_ALONG = 3.2;
const SWING_COOLDOWN = 0.35;
/**
 * When in the swing it can land, as fractions of its length: the blade is
 * live through the middle of the arc, and it lands on the first thing it
 * meets there. Tested every frame rather than at one instant, because two
 * rides side by side at twenty metres a second do not hold still for it.
 */
const SWING_FROM = 0.28;
const SWING_TO = 0.75;
/**
 * A hostile's club comes round slower than a player's own weapon — long
 * enough to see it raised — so a rider who swings first wins the exchange.
 */
const HOSTILE_SWING = 0.95;

/** seconds of ride deflector on a full rider gauge */
const SHIELD_SECONDS = 4;
/** what turning one bolt costs the gauge, on top of the drain for holding it */
const SHIELD_BOLT_COST = 0.035;
/**
 * And what everything else costs, per point of damage it would have done.
 *
 * Proportional rather than flat because the rest of what a bubble turns is
 * not a discrete event: a warlord's slam should be expensive, and sitting a
 * ride in a lava river should bleed the gauge rather than empty it in a third
 * of a second, which is what a per-frame flat charge on a burn tick does.
 */
const SHIELD_COST_PER_DAMAGE = 0.0012;
/** a hit under this is a graze: it costs the gauge, it does not ring the field */
const SHIELD_RING_MIN = 5;
/** the bubble is real from here up, so a field still rising turns nothing */
const SHIELD_LIVE = 0.6;

/**
 * What your own ride going up under you costs, before the hull's own measure
 * scales it (`blastScale`). This is the counterweight to the deflector: the
 * bubble turns everything anyone shoots at you, so the thing that still has
 * to be feared is the wall — and a hull crashed until it detonates detonates
 * around the rider, shield or no shield.
 */
const RIDER_BLAST = 26;

/** how far a seated rider's head stands over the seat, for framing the shot */
const RIDER_OVER_SEAT = 1.5;

/**
 * How far a rider's root (its feet, on the canonical rig) sits below the
 * surface it is carried on. A straddled saddle takes the weight on the thighs
 * and carries the hips a hand's width proud of it; a seat takes it on the
 * backside, so the hips sit almost on the cushion; a deck takes the feet.
 */
const STANCE_RISE: Record<VehicleDef['stance'], number> = {
  saddle: stanceRise('saddle', CANONICAL_HIPS), seated: stanceRise('seated', CANONICAL_HIPS), stand: 0,
};
/**
 * Our own woven saddle, from `buildVehicleMesh`: how far its seat stands over
 * the group's origin, and how far into the fur the whole thing is pressed.
 *
 * A mount is measured against the *animal*, and a flat saddle laid on top of
 * a measurement taken off the shaggiest point of a curved back floats over it
 * with daylight underneath. Sinking it by its own thickness beds it into the
 * coat and leaves the rider sitting at the height the back actually is.
 */
const SADDLE_PAD = 0.13;
const SADDLE_SINK = 0.26;

/**
 * The seat height a kind's sculpt measures at, over the keel — measured once
 * for the whole session.
 *
 * Measuring is a dozen rays against a model that can be enormous (the swoop's
 * is eighty thousand triangles), and a board parks six rides while its waves
 * bring a seventh in by the squad. Doing it per instance is the same answer
 * computed over and over — the sculpt is one file, the seat offset is one
 * number per kind — and enough main thread in one frame to hang the renderer
 * hard enough that the browser kills it, which is what it did to the modes
 * suite. The sculpt cannot change under a running session, so neither can the
 * answer.
 */
const seatByKind = new Map<VehicleSpec['kind'], number>();
/**
 * The footprint a kind's sculpt actually occupies — half its width and half
 * its length over the keel, measured once per session like the seat.
 *
 * A parked ride used to be boxed from `def.radius`, which is the *driving*
 * capsule: one number, deliberately generous, so a hull at speed shoulders
 * things aside rather than catching on them. As a parked footprint it is
 * simply the wrong measurement — too fat on a bantha (1.5 against an animal
 * drawn 1.26 across, so you were held off it by two-thirds of a metre of
 * nothing and could never walk up to one) and too *thin* on a landspeeder
 * (1.15 against a hull drawn 1.6, so you walked into its flank). The sculpt
 * knows how wide it is; ask it.
 */
const footByKind = new Map<VehicleSpec['kind'], { x: number; z: number }>();

const _ramPoint = new THREE.Vector3();
/** the bodies a hostile-driven hull is measured against, filled per frame */
const _rammable: (Player | Enemy)[] = [];
const _foot = new THREE.Box3();
const _seatFrom = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
// K3 scratch
const _aimPt = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _sight = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _shot = new THREE.Vector3();
const _lock = new THREE.Vector3();
const _lockPt = new THREE.Vector3();
const _tgtPos = new THREE.Vector3();
const _brainAim = new THREE.Vector3();

/** an angle folded into (-π, π] */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** a player rather than a hostile (the swing and the seat treat them differently) */
function isPlayer(x: Player | Enemy): x is Player {
  return 'characterId' in x;
}

export class Vehicle {
  def: VehicleDef;
  /** the keel point: hovers `def.hover` over the ground */
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw: number;
  hp: number;
  maxHp: number;
  alive = true;
  rider: Player | null = null;
  /**
   * A hostile in the saddle instead. Every ride on a mission stands in
   * somebody's camp (docs/MISSIONS_OUTDOOR.md §1.8), and when that camp is
   * alerted some of them get on: a Tusken on its bantha is a wall of hide
   * coming at you at a run, and the way to have the bantha is to drop the
   * Tusken. One occupant or the other, never both; `rider` stays the
   * player's slot so nothing that reads it has to learn a second shape.
   */
  hostile: Enemy | null = null;
  /** a hostile is on its way to this one — the player can still get there first */
  reserved = false;
  group = new THREE.Group();
  /** who shot it last, for kill credit on the explosion */
  lastHitBy = -1;
  private body = new THREE.Group();
  private parkedBox: StaticBox | null = null;
  /** half-width and half-length of the sculpt, once it has been measured */
  private foot: { x: number; z: number } | null = null;
  private bobPhase = Math.random() * Math.PI * 2;
  private boostCd = 0;
  /** seconds left in a hop's arc (0 = on its repulsors), and the wait for another */
  private hopT = 0;
  private hopCd = 0;
  /** the rider is asking for the deflector; `shieldRaise` is how far up it is */
  private shieldWanted = false;
  private shieldRaise = 0;
  /** the field itself, built the first time one is actually raised */
  private shieldField: ShieldField | null = null;
  /** scratch for the bubble handed to the projectile system */
  private shieldSphere: DeflectSphere = {
    center: new THREE.Vector3(), radius: 1, normal: new THREE.Vector3(0, 0, 1),
    kind: 'shield', minDot: -1.1, consume: () => this.spendShield(),
  };
  /** last frame's steering input, for the visual bank into a turn */
  private steer = 0;
  /** seconds left of the camera settling back onto the nose after the sights come down */
  private aimSettle = 0;
  /**
   * Height of the rider's root above the keel. Starts at the def's value,
   * which is tuned to the procedural stand-in, and is re-measured off the
   * authored sculpt the moment one lands — see `seatToModel`.
   */
  private seatY: number;
  /** the workbench's hand-placed seat and grip for this kind, if it has them (vehicleAnchors.ts) */
  private anchor: VehicleAnchor | null;
  /** where across and along the ride the seat is — the anchor's, or the def's */
  private seatX: number;
  private seatZ: number;
  /** where the hands go, from the seat — see `VehicleDef.hands` */
  readonly hands: VehicleDef['hands'];
  /** how far the rider's knees open, when the ride sets it — see `VehicleAnchor.legSpread` */
  get legSpread(): number | null { return this.anchor?.legSpread ?? null; }
  /** the rider turned on the seat, radians — see `VehicleAnchor.yaw` */
  get seatYaw(): number { return THREE.MathUtils.degToRad(this.anchor?.yaw ?? 0); }
  /** a walking mount's back, which carries the saddle as it moves (`SaddleBone`) */
  private saddle: SaddleBone | null = null;
  /** per-body ram cooldown, so one pass hits once */
  private ramMemo = new Map<object, number>();
  private dustTimer = 0;
  /** a living mount's gait, once its sculpt and clips are in (see `onModel`) */
  private mixer: THREE.AnimationMixer | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  /** ground the walk clip covers per second of clip (m/s), for rate-matching the feet */
  private walkStride = BANTHA_STRIDE;
  /** metres left to walk before the next footfall lands */
  private strideLeft = 1.2;
  /** how long until this one lows again while it is being ridden */
  private lowIn = 6 + Math.random() * 8;
  /** seconds left in a charge (X on a mount); ≤ 0 = not charging */
  private chargeT = 0;
  private chargeCd = 0;
  /** seconds until the wreck is a ride again; > 0 only while dead */
  respawnIn = 0;
  /** dissolve on death, then reassembly on return — both count down to 0 */
  private dissolveT = 0;
  private reformT = 0;
  /**
   * Rolling on with nobody aboard. A ride whose rider is killed at speed does
   * not stop dead under them: it carries its momentum until the drag, the
   * ground or a wall takes it, and only then parks.
   */
  private coasting = false;
  /** suppresses one frame of wall damage when a ride-on-ride crash already paid for it */
  private crashGrace = 0;
  /** per-vehicle crash cooldown, so one collision bills once */
  private hitMemo = new Map<Vehicle, number>();

  // ---- K3: mounted weapons, the lane, the pillion, the turret ----
  /**
   * The lane this ride is guided along, or null for a free ride. While set,
   * forward is carried along it, the stick is lean and a throttle band, and
   * the ride never stops (docs/SECTIONS_IMPLEMENTATION.md §3, K3).
   */
  lane: SplineLane | null = null;
  /** where on the lane it is: metres along, metres right of the line */
  laneS = 0;
  laneLat = 0;
  /** sideways speed across the lane, m/s */
  private latVel = 0;
  /** the sideswipe: the last lean tap's side and when, and the wait before another */
  private tapSide = 0;
  private tapT = 0;
  private leanWas = 0;
  private swipeCd = 0;
  /** a second player sat behind the driver, working the weapons */
  pillion: Player | null = null;
  /** the gun's heat, 0..1, and whether it has locked up to vent */
  heat = 0;
  overheated = false;
  private gunCd = 0;
  private muzzleIdx = 0;
  /** a swing from the saddle, while one is in the air */
  private swing: {
    side: -1 | 1; t: number; dur: number; landed: boolean;
    by: Player | Enemy; weapon: Player['weapon'] | null;
  } | null = null;
  private swingCd = 0;
  private swingStep = 0;
  /** false: a wreck stays gone (a section brings the fresh one) */
  respawns = true;
  /**
   * Moved by its section, not by its own physics (K3): a barge on a set
   * course, a hull in a treadmill arena. Its rider's frame still fights —
   * swings, the gun — but nothing drives it; `place` puts it where it goes.
   */
  scripted = false;
  /** a riderless lane hull's count down to the lava, and going under */
  private sinkIn = -1;
  private sinkT = 0;
  /** a turret's own facing (its arc is measured from it), and the barrels' pitch */
  baseYaw = 0;
  aimPitch = 0;
  /** whose gun an unmanned turret is */
  team = 0;
  /** a turret's burst rhythm with a hostile or nobody on it */
  private burstLeft = 0;
  private burstRest = 0;
  /** the turret's moving parts, stand-in or sculpt */
  private yawNode: THREE.Object3D | null = null;
  private pitchNode: THREE.Object3D | null = null;
  /**
   * A section's own brain for a hostile rider on a lane (K3). Null: the
   * built-in one — come alongside a player, swing or fire, peel off.
   */
  laneBrain: ((v: Vehicle, dt: number, game: Game) => LaneOrder) | null = null;
  /** the built-in brain's state */
  brain = { mode: 'close' as 'close' | 'peel', t: 0, side: 1 as -1 | 1, role: 'swinger' as 'swinger' | 'gunner' };

  constructor(public spec: VehicleSpec, private board: Board, opts: VehicleOpts = {}) {
    const base = VEHICLE_DEFS[spec.kind];
    this.def = opts.gun || opts.sideSwing || opts.pillion || opts.hp || opts.turret
      ? {
        ...base,
        ...(opts.gun ? { gun: opts.gun } : {}),
        ...(opts.sideSwing ? { sideSwing: true } : {}),
        ...(opts.pillion ? { pillion: opts.pillion } : {}),
        ...(opts.hp ? { hp: opts.hp } : {}),
        ...(opts.turret && base.turret ? { turret: { ...base.turret, ...opts.turret } } : {}),
      }
      : base;
    this.lane = opts.lane ?? null;
    this.respawns = opts.respawns ?? true;
    this.team = opts.team ?? 0;
    this.hp = this.maxHp = this.def.hp;
    this.yaw = spec.yaw ?? 0;
    this.baseYaw = this.yaw;
    // `y` is the deck it was parked on (a mission level's plate); without it
    // the search starts from the terrain, which on a mission board is ninety
    // metres under the floor the ride is standing on.
    if (spec.y !== undefined) this.pos.y = spec.y + this.def.hover;
    const ground = spec.y ?? this.groundAt(spec.x, spec.z);
    this.pos.set(spec.x, ground + this.def.hover, spec.z);
    this.anchor = VEHICLE_ANCHORS[spec.kind] ?? null;
    this.seatX = this.anchor?.seat[0] ?? this.def.seat.x;
    this.seatZ = this.anchor?.seat[2] ?? this.def.seat.z;
    this.hands = handsFor(this.def, this.anchor);
    this.seatY = this.anchor ? this.anchor.seat[1] - STANCE_RISE[this.def.stance] : this.def.seat.y;
    this.group.add(this.body);
    const parts = buildVehicleMesh(spec.kind, this.body, (root) => this.onModel(root), undefined,
      (root) => this.seatToStandIn(root));
    this.yawNode = parts.yaw;
    this.pitchNode = parts.pitch;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.def.turret ? this.baseYaw : this.yaw;
    if (this.lane) {
      const at = this.lane.project(this.pos.x, this.pos.z);
      this.laneS = at.s;
      this.laneLat = at.lat;
    }
    this.park();
  }

  /** ground (or water surface) under a point — repulsors ride whichever is higher */
  private groundAt(x: number, z: number): number {
    const phys = this.board.physics;
    const base = phys.heightAt ? phys.heightAt(x, z) : 0;
    let g = phys.groundHeight(x, z, Math.max(base, this.pos.y - this.def.hover) + 0.8);
    if (!isFinite(g)) g = base;
    if (this.board.waterY !== undefined) g = Math.max(g, this.board.waterY);
    return g;
  }

  /** A parked ride is solid: one axis-aligned box over its footprint. */
  private park(): void {
    if (this.parkedBox) return;
    // the sculpt's own footprint where it has landed, the def's numbers until
    // then — and the AABB of that rectangle turned to the ride's yaw
    const hx = this.foot?.x ?? this.def.radius;
    const hz = this.foot?.z ?? this.def.length / 2;
    const s = Math.abs(Math.sin(this.yaw)), c = Math.abs(Math.cos(this.yaw));
    const w = 2 * (s * hz + c * hx);
    const d = 2 * (c * hz + s * hx);
    const bottom = this.pos.y - this.def.hover;
    const top = this.pos.y + this.def.body;
    this.parkedBox = this.board.physics.addBox(
      this.pos.x, (bottom + top) / 2, this.pos.z, w, top - bottom, d,
    );
  }

  private unpark(): void {
    if (!this.parkedBox) return;
    const boxes = this.board.physics.boxes;
    const i = boxes.indexOf(this.parkedBox);
    if (i >= 0) boxes.splice(i, 1);
    this.parkedBox = null;
  }

  mount(rider: Player): void {
    // K3: a ride with a driver already on it and a second seat takes this one
    // as the pillion — the weapons are theirs, the stick stays the driver's
    if (this.rider && this.pillionOpen && rider !== this.rider) {
      this.pillion = rider;
      rider.vehicle = this;
      audio.land(false);
      return;
    }
    // a turret never leaves its ring: it stays solid with a gunner in it
    if (!this.def.turret) this.unpark();
    this.rider = rider;
    rider.vehicle = this;
    // a machine turns over; an animal complains about the weight
    if (this.def.living) audio.banthaLow(0.5);
    else audio.speederIgnite();
  }

  /** A hostile swings up: the ride is theirs until they are shot off it. */
  mountHostile(e: Enemy): void {
    if (!this.def.turret) this.unpark();
    this.reserved = false;
    this.hostile = e;
    if (this.def.living) audio.banthaLow(0.5);
    else audio.speederIgnite();
  }

  /**
   * The hostile is off — shot out of the saddle, or the ride went up under
   * them. Same rule as a player's exit: speed still in it rolls on and parks
   * where it stops, which is where the party walks up and takes it.
   */
  dropHostile(): void {
    const e = this.hostile;
    if (!e) return;
    this.hostile = null;
    e.ride = null;
    this.swing = null;
    if (!this.alive || this.def.turret) return;
    if (Math.hypot(this.vel.x, this.vel.z) > COAST_STOP || this.hopT > 0) this.coasting = true;
    else this.park();
  }

  /** a driver is aboard and the second seat is empty (K3) */
  get pillionOpen(): boolean {
    return !!this.def.pillion && this.alive && !!this.rider && !this.pillion;
  }

  /** whoever works the weapons: the pillion when there is one, the driver otherwise */
  get gunner(): Player | null {
    return this.pillion ?? this.rider;
  }

  /**
   * Let the rider off — stepped off, bailed out, shot off the saddle, killed.
   *
   * A ride with speed still in it does not stop dead the moment the saddle
   * empties: it rolls on driverless (`coasting`), and only parks once the
   * drag, the ground or a wall has taken the last of the momentum. A rider
   * killed at forty kilometres an hour leaves a speeder still going, which is
   * both what should happen and a genuinely useful thing to walk back to.
   */
  dropRider(who: Player | null = this.rider): void {
    // K3: the pillion steps off the back and the ride carries on under its driver
    if (who && who === this.pillion) {
      this.pillion = null;
      who.vehicle = null;
      if (this.swing?.by === who) this.endSwing();
      return;
    }
    const rider = this.rider;
    if (!rider || who !== rider) return;
    if (this.swing?.by === rider) this.endSwing();
    this.rider = null;
    rider.vehicle = null;
    this.shieldWanted = false;
    audio.setEngine(rider.slot, 0);
    // a driver gone with a pillion aboard: the pillion slides forward onto
    // the bars, and the ride never stops being ridden
    if (this.pillion && this.alive) {
      this.rider = this.pillion;
      this.pillion = null;
      return;
    }
    if (!this.alive || this.def.turret) return;
    // Still in the air off a hop counts as still rolling: parking registers a
    // solid box where the ride is *now*, and a rider who bails at the top of
    // one would otherwise leave an invisible box hanging over the road while
    // the hull sank out of it.
    if (Math.hypot(this.vel.x, this.vel.z) > COAST_STOP || this.hopT > 0) this.coasting = true;
    else this.park();
  }

  /**
   * Hurt the ride.
   *
   * `kind` is the whole balance of §17's second pass: a **shot** — a bolt, a
   * blade, a blast, a burn — is scaled by the hull's `shotResist`, so what
   * kills a speeder bike barely marks a skiff; a **crash** is charged in full,
   * because no amount of plate helps a thing that has stopped against a wall
   * at speed. Big rides are broken by crashing them, small ones by shooting
   * them, and both still take a little of the other.
   */
  damage(amount: number, from: THREE.Vector3, bySlot = -1, kind: DamageKind = 'shot'): void {
    if (!this.alive || amount <= 0) return;
    // The deflector is up: a bolt, a blade, a blast or a burn stops at the
    // bubble and costs the rider's gauge instead of the hull. A **crash** goes
    // straight through it — the field is between the ride and what is shooting
    // at it, not between the ride and the wall.
    if (kind === 'shot' && this.shielded) { this.shieldHit(amount); return; }
    if (kind !== 'crash') amount *= this.def.shotResist;
    this.hp -= amount;
    if (bySlot >= 0) this.lastHitBy = bySlot;
    if (this.rider) {
      this.rider.cam.shake(Math.min(0.12, amount * 0.006));
      this.rider.noteVehicleHit(from);
    }
    if (this.hp <= 0) this.destroy(!this.def.living);
  }

  /**
   * The end of the ride — for twenty seconds.
   *
   * A machine throws its rider clear and goes up, in a blast sized to the
   * thing that made it: a swoop is a pop, a laden skiff is an event. An animal
   * does neither. It dies where it stands and comes apart into the air over a
   * second or so, which is the only death in the game with no fireball in it.
   * Either way the ride is not gone: `respawnIn` runs down and it reforms
   * where it was first parked (see `respawn`).
   */
  private destroy(how: boolean | 'sink'): void {
    if (!this.alive) return;
    this.alive = false;
    const explode = how === true;
    const at = this.pos.clone();
    const slot = this.rider?.slot ?? this.lastHitBy;
    this.endSwing();
    // K3: a pillion goes the way the driver does — thrown clear, and burnt
    const pil = this.pillion;
    if (pil) {
      this.dropRider(pil);
      pil.velocity.copy(this.vel);
      pil.velocity.y = Math.max(pil.velocity.y, 8);
      pil.velocity.x -= Math.sin(this.yaw + Math.PI / 2) * 3;
      pil.velocity.z -= Math.cos(this.yaw + Math.PI / 2) * 3;
      pil.position.y += 0.6;
      if (explode) pil.damage(RIDER_BLAST * this.blastScale, at, -1, { heavy: true });
    }
    if (this.rider) {
      const r = this.rider;
      this.dropRider();
      // thrown clear: the ride's momentum plus a kick up and out
      r.velocity.copy(this.vel);
      r.velocity.y = Math.max(r.velocity.y, 7.5);
      r.velocity.x += Math.sin(this.yaw + Math.PI / 2) * 3;
      r.velocity.z += Math.cos(this.yaw + Math.PI / 2) * 3;
      r.position.y += 0.6;
      // and it costs them. Thrown clear is not away: a hull detonating is
      // detonating *under* the person sitting on it, so the ride you crash
      // takes a piece of you with it — sized to the hull, like the fireball,
      // so a swoop is a bad landing and a skiff is most of a Mandalorian.
      // Nothing turns this: the deflector answers attacks, and your own
      // repulsor core is not attacking you.
      if (explode) r.damage(RIDER_BLAST * this.blastScale, at, -1, { heavy: true });
    }
    if (this.hostile) {
      // the same throw, and it is fatal more often than not: a hostile has a
      // fraction of a player's health and no armour against its own hull
      const e = this.hostile;
      this.dropHostile();
      e.velocity.copy(this.vel);
      e.velocity.y = Math.max(e.velocity.y, 7.5);
      e.velocity.x += Math.sin(this.yaw + Math.PI / 2) * 3;
      e.velocity.z += Math.cos(this.yaw + Math.PI / 2) * 3;
      e.position.y += 0.6;
      e.damage(explode ? RIDER_BLAST * this.blastScale * 3 : 30, at, slot);
      if (e.alive) e.knockdown(1.6);
    }
    this.shieldWanted = false;
    this.shieldRaise = 0;
    this.shieldField?.setStrength(0);
    this.unpark();
    this.coasting = false;
    this.vel.set(0, 0, 0);
    this.sinkIn = -1;
    // a section's ride does not come back where it was parked: it brings a fresh one
    this.respawnIn = this.respawns ? RESPAWN_DELAY : Infinity;
    if (how === 'sink') {
      // K3: into the lava — no fireball, the hull goes under where it is
      this.sinkT = SINK_TIME;
      audio.splash(true);
    } else if (explode) {
      this.group.visible = false;
      this.pendingExplosion = { at: at.setY(at.y + 0.5), slot, scale: this.blastScale };
    } else {
      // the body stays up while it comes apart, sinking as it goes
      this.dissolveT = DISSOLVE_TIME;
      this.pendingCollapse = at.clone();
    }
  }

  /**
   * How big the fireball is: a swoop's own length against the skiff's, so the
   * blast that ends a ride is the size of the ride that made it.
   */
  private get blastScale(): number {
    return clamp(this.def.length / 4 + this.def.mass * 0.08, 0.55, 2.1);
  }

  /**
   * Take this ride out of the world without a wreck.
   *
   * Missions swaps whole maps at a transport door, and the rides parked on
   * the old one go with it — quietly, since nothing blew them up. Its parked
   * collider is the part that matters: left in the physics world it is an
   * invisible box standing in the middle of the next stage.
   */
  retire(): void {
    if (this.pillion) this.dropRider(this.pillion);
    if (this.rider) this.dropRider();
    if (this.hostile) { this.hostile.ride = null; this.hostile = null; }
    this.reserved = false;
    this.unpark();
    this.group.visible = false;
    // Dead and staying dead: a wreck comes back on `respawnIn`, and a ride
    // left behind on a map the party has walked out of should not. The
    // campaign drops it from `Game.vehicles` in the same breath, so nothing
    // ticks it again either way — this is belt and braces on a ride that
    // would otherwise reassemble itself inside the next stage.
    this.alive = false;
    this.respawnIn = Infinity;
  }

  /** set by destroy(); the game detonates it on its next update pass */
  pendingExplosion: { at: THREE.Vector3; slot: number; scale: number } | null = null;
  /** set by destroy() for a living mount; the game kicks up the dust for it */
  pendingCollapse: THREE.Vector3 | null = null;
  /** set by respawn(); the game plays the reassembly where it lands */
  pendingReform: THREE.Vector3 | null = null;

  /**
   * Back on its feet, or back on its repulsors, where it was first parked.
   *
   * Not where it died: a ride dragged across the board and wrecked in a
   * corner would respawn in that corner and drift the board's layout away
   * from what it was designed as, so the spec's own coordinates are the only
   * ones a respawn ever uses.
   */
  private respawn(): void {
    const ground = this.groundAt(this.spec.x, this.spec.z);
    this.pos.set(this.spec.x, ground + this.def.hover, this.spec.z);
    this.vel.set(0, 0, 0);
    this.yaw = this.spec.yaw ?? 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.lastHitBy = -1;
    this.coasting = false;
    this.hopT = this.hopCd = 0;
    this.dissolveT = 0;
    this.heat = 0;
    this.overheated = false;
    this.latVel = 0;
    this.sinkIn = -1;
    this.sinkT = 0;
    this.baseYaw = this.yaw;
    if (this.lane) {
      const on = this.lane.project(this.pos.x, this.pos.z);
      this.laneS = on.s;
      this.laneLat = on.lat;
    }
    this.reformT = REFORM_TIME;
    this.hitMemo.clear();
    this.group.visible = true;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.body.position.y = 0;
    this.park();
    this.pendingReform = this.pos.clone();
  }

  /**
   * The deflector's reach: a bubble big enough to hold the hull and whoever is
   * sitting or standing on top of it. A long ride gets a wide field rather
   * than a tight one round the keel — a skiff's rider stands three metres
   * behind the bow, and a shield that left them outside it would be no shield.
   */
  get shieldRadius(): number {
    return Math.max(this.def.radius, this.def.length * 0.42) + 0.5;
  }

  /** height of the bubble's centre over the keel */
  private get shieldY(): number { return this.def.body * 0.5 + 0.15; }

  /** true once the field is really up — a bubble still rising turns nothing */
  get shielded(): boolean {
    return this.alive && this.shieldRaise >= SHIELD_LIVE && !!this.rider;
  }

  /**
   * The deflector as the projectile system sees it: a closed bubble round the
   * hull, answering from every bearing (`minDot` under -1, so a bolt from dead
   * astern is met too). Null unless the field is actually up.
   */
  get shieldCollider(): DeflectSphere | null {
    if (!this.shielded) return null;
    const s = this.shieldSphere;
    s.center.set(this.pos.x, this.pos.y + this.shieldY, this.pos.z);
    s.radius = this.shieldRadius;
    // a mirrored bolt goes back out along the nose rather than nowhere
    s.normal.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    return s;
  }

  /**
   * A hit turned by the bubble: the ring runs out from where it landed, and
   * the rider pays a sip of the same gauge that is holding it up. Asked by the
   * projectile system before each deflect (`consume`), so an empty gauge lets
   * the bolt through instead of holding a field nobody is powering.
   */
  private spendShield(): boolean {
    const rider = this.rider;
    if (!this.shielded || !rider || !rider.spendShield(SHIELD_BOLT_COST)) return false;
    this.shieldField?.hit();
    rider.cam.shake(0.02);
    return true;
  }

  /**
   * A hit the bubble turned that was not a bolt — a swing, a blast, a burn,
   * or anything aimed at the rider on top of it (`Player.damage` routes those
   * here).
   *
   * Charged in proportion to what it would have done. Only a real blow rings
   * the field: a burn tick restarting the impact ring sixty times a second
   * reads as a strobe rather than as a shield holding.
   */
  shieldHit(amount: number): void {
    this.rider?.spendShield(amount * SHIELD_COST_PER_DAMAGE);
    if (amount < SHIELD_RING_MIN) return;
    this.shieldField?.hit();
    this.rider?.cam.shake(0.02);
  }

  /**
   * Send it under where it is (K3): no fireball, the hull goes down into the
   * lava or the sea and whoever is aboard is thrown clear. For a section's
   * set piece — a barge whose crew is gone — rather than for a crash.
   */
  sink(): void { this.destroy('sink'); }

  /** true while the horns are down (drives the HUD's charge cue) */
  get charging(): boolean { return this.chargeT > 0; }
  /** true when the charge is off cooldown and can be asked for */
  get chargeReady(): boolean { return this.chargeCd <= 0 && this.chargeT <= 0; }

  /**
   * World position of the rider's root while mounted. `rise` is how far that
   * root sits under the seat surface for this rider (`stanceRise` off its own
   * hips); left out, a rider of the canonical build.
   */
  seatWorld(out: THREE.Vector3, rise = STANCE_RISE[this.def.stance], who?: Player | Enemy | null): THREE.Vector3 {
    // K3: the pillion sits behind, at the same height over the saddle line
    if (who && who === this.pillion && this.def.pillion) {
      const q = this.def.pillion;
      return this.rideToWorld(q.x, this.seatTop - rise + (q.y - this.def.seat.y), q.z, out);
    }
    // K3: a turret's base stays put and only the gun turns (`yaw` against
    // `baseYaw`), so its seat is swung about the ring by the gun's own yaw
    // rather than through the hull, which is drawn at the base's heading
    if (this.def.turret) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      return out.set(
        this.pos.x + cos * this.seatX + sin * this.seatZ,
        this.pos.y + this.seatTop - rise,
        this.pos.z - sin * this.seatX + cos * this.seatZ,
      );
    }
    return this.rideToWorld(this.seatX, this.seatTop - rise, this.seatZ, out);
  }

  /**
   * A point in the ride's own frame (from the keel: +X its left, +Z its nose)
   * in the world — through the hull as it is drawn, so the lean into a turn
   * and the pitch at speed carry the seat, the bars and the footrests with
   * them (on a bantha the saddle is two metres up that lever), and carried
   * with a walking mount's back, when it has one.
   */
  private rideToWorld(lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    const shift = this.saddle?.shift;
    if (shift) { lx += shift.x; ly += shift.y; lz += shift.z; }
    // the hull where the ride is this frame, whether or not it has been drawn yet
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.def.turret ? this.baseYaw : this.yaw;
    this.body.updateWorldMatrix(true, false);
    return this.body.localToWorld(out.set(lx, ly, lz));
  }

  /**
   * Where a foot rests, for side 1 (the rider's left) or -1: the anchor's
   * footrest, mirrored across the seat for the right, lifted to the ankle.
   * Null for a ride with no footrest placed.
   */
  footWorld(side: -1 | 1, out: THREE.Vector3): THREE.Vector3 | null {
    const f = this.anchor?.foot;
    if (!f || !this.anchor) return null;
    const s = this.anchor.seat;
    return this.rideToWorld(this.seatX + side * (f[0] - s[0]), this.seatTop + (f[1] - s[1]) + ANKLE_OVER_SOLE,
      this.seatZ + (f[2] - s[2]), out);
  }

  /**
   * Put the rider's legs where the ride has them: each foot on its rest, the
   * knee bowed forward and out to the ride's spread, when it has footrests;
   * otherwise the clip's legs opened to the spread, when it sets one. Call it
   * after the animator has posed the frame and before the hands.
   */
  poseLegs(rig: Rig): void {
    if (!this.anchor?.foot) {
      if (this.legSpread !== null) spreadKnees(rig, this.legSpread);
      return;
    }
    rig.root.updateMatrixWorld(true);
    const spread = this.legSpread ?? 0.25;
    for (const side of [1, -1] as const) {
      if (!this.footWorld(side, _restFoot)) return;
      this.rideToWorld(this.seatX + side * spread, this.seatTop + 0.1, this.seatZ + 0.45, _restKnee);
      reachLeg(rig, side === 1 ? 'L' : 'R', _restFoot, _restKnee);
      // the sole as the anchor lays it on the rest, turned with the hull
      const turn = this.anchor.footRotation;
      if (turn) {
        this.body.getWorldQuaternion(_bodyQ);
        orientFoot(rig, side === 1 ? 'L' : 'R', footQuaternion(_bodyQ, turn, side, _soleQ));
      }
    }
  }

  /** a point in the ride's own space (as `seat`: +z the nose), in the world */
  localPoint(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    return out.set(this.pos.x + cos * x + sin * z, this.pos.y + y, this.pos.z - sin * x + cos * z);
  }

  /** Everything that has to be measured off the sculpt, the moment it lands. */
  private onModel(root: THREE.Object3D): void {
    if (this.def.turret) {
      // the sculpt brings its own moving parts (ASSETS_MODELS.md, `quad_turret`)
      const y = root.getObjectByName('yaw');
      const p = root.getObjectByName('pitch');
      if (y) this.yawNode = y;
      if (p) this.pitchNode = p;
    }
    this.footToModel(root);
    this.seatToModel(root);
    if (this.def.living) this.gaitFromModel(root);
  }

  /**
   * A mount's legs, from whatever the sculpt brought with it.
   *
   * `loadProp` hands the model its clips — the file's own if it ships any, the
   * code-authored quadruped gait otherwise — so this only has to pick the two
   * that matter and blend them by speed: standing and walking. A ride whose
   * file carries no clips at all simply stands there and slides, which is what
   * every vehicle did before this.
   */
  private gaitFromModel(root: THREE.Object3D): void {
    const clips = (root.userData.clips ?? []) as THREE.AnimationClip[];
    if (!clips.length) return;
    const pick = (re: RegExp): THREE.AnimationClip | undefined => clips.find((c) => re.test(c.name));
    const idle = pick(/idle|breath|stand/i);
    const walk = pick(/walk|amble|trot/i);
    this.mixer = new THREE.AnimationMixer(root);
    if (idle) {
      this.idleAction = this.mixer.clipAction(idle);
      this.idleAction.play();
    }
    if (walk) {
      this.walkAction = this.mixer.clipAction(walk);
      this.walkAction.play();
      this.walkAction.setEffectiveWeight(0);
      // the authored cycle covers BANTHA_STRIDE metres; a file with its own
      // clip is measured the same way, near enough to keep the feet honest
      this.walkStride = BANTHA_STRIDE / Math.max(walk.duration, 0.2);
    }
    // measured now, at rest, before the gait has taken a step
    this.saddle = new SaddleBone(root, this.group, new THREE.Vector3(this.seatX, this.seatTop, this.seatZ));
  }

  /**
   * Put the rider on the surface the sculpt actually has.
   *
   * The seat offsets in the defs are measured against the procedural
   * stand-ins, and an authored vehicle puts its saddle or its deck somewhere
   * else — so a rider tuned to a box ends up perched above the cockpit of the
   * model that replaced it. Rather than hand-tune a number per vehicle (and
   * re-tune it on every re-export), drop a ray down the seat column and take
   * the surface it finds: feet on it for a rider who stands, hips just over it
   * for one who straddles.
   */
  /**
   * Until the sculpt lands, its low-LOD stand-in is what the ride looks like:
   * sit the saddle and the rider on that rather than on the def's guess, which
   * was tuned to the hand-built stand-ins these replaced. For this instance
   * only — `seatToModel` measures the sculpt itself once it is in, and only
   * that is remembered for the kind.
   */
  private seatToStandIn(root: THREE.Object3D): void {
    let surface = this.anchor ? undefined : seatByKind.get(this.spec.kind);
    if (!this.anchor && surface === undefined) {
      const measured = measureSeatSurface(this.spec.kind, root, this.group, { x: this.seatX, z: this.seatZ });
      if (measured === null) return;
      surface = measured;
    }
    const sit = sitOnModel(this.body, surface, this.anchor);
    this.seatY = sit - STANCE_RISE[this.def.stance];
  }

  private seatToModel(root: THREE.Object3D): void {
    // A seat placed by hand in the workbench is the seat: nothing to measure
    let surface = this.anchor ? undefined : seatByKind.get(this.spec.kind);
    if (!this.anchor && surface === undefined) {
      const measured = measureSeatSurface(this.spec.kind, root, this.group, { x: this.seatX, z: this.seatZ });
      if (measured === null) return;           // nothing under the seat: keep the default
      surface = measured;
      // A sculpt that answers from somewhere the ride does not reach was
      // measured before it was placed (a cached model can land inside the
      // constructor). Use it for this instance, but do not teach it to the
      // rest of the session.
      if (Math.abs(surface) < this.def.body + 4) seatByKind.set(this.spec.kind, surface);
    }
    const sit = sitOnModel(this.body, surface, this.anchor);
    this.seatY = sit - STANCE_RISE[this.def.stance];
  }

  /**
   * How much ground the sculpt covers, so a parked ride is as solid as it
   * looks and no more. Measured square to the ride (the yaw is taken off for
   * the measurement and put back), once per kind — see `footByKind`.
   */
  private footToModel(root: THREE.Object3D): void {
    const cached = footByKind.get(this.spec.kind);
    if (cached) { this.foot = cached; return; }
    const yaw = this.group.rotation.y;
    this.group.rotation.y = 0;
    this.group.updateMatrixWorld(true);
    _foot.setFromObject(root);
    this.group.rotation.y = yaw;
    this.group.updateMatrixWorld(true);
    if (_foot.isEmpty()) return;
    const half = {
      x: Math.max(0.3, (_foot.max.x - _foot.min.x) / 2),
      z: Math.max(0.3, (_foot.max.z - _foot.min.z) / 2),
    };
    // a sculpt that answers with something the ride could not possibly be was
    // measured before it was placed; use it here, do not teach it to the rest
    if (half.x < this.def.length && half.z < this.def.length) {
      footByKind.set(this.spec.kind, half);
    }
    this.foot = half;
    if (this.parkedBox) { this.unpark(); this.park(); }
  }

  /** the height of the surface being sat on, over the keel */
  get seatTop(): number {
    return this.seatY + STANCE_RISE[this.def.stance];
  }

  /**
   * How big this ride is to a camera: the height a body of this size would
   * be, and half its widest horizontal span.
   *
   * The chase rig is tuned around a Mandalorian and already knows how to
   * frame something bigger (`ThirdPersonCamera.setSubject`, written for the
   * war beasts) — it lifts the look to the subject's own head and puts a floor
   * under the chase distance so the lens stays outside its hide. A ride is
   * exactly that problem: framed as a 1.8 m man, a bantha fills the screen and
   * a skiff is a wall you are standing on. So a mounted rider hands the camera
   * the *ride's* measurements instead of its own.
   *
   * Height is to the top of whoever is sitting on it rather than to the hull,
   * because that is what has to stay in shot; the span is the sculpt's own
   * footprint where it has been measured, the same one `park` registers.
   */
  get camSubject(): { height: number; reach: number } {
    return {
      height: Math.max(this.def.body, this.seatTop + RIDER_OVER_SEAT),
      reach: Math.max(this.foot?.x ?? this.def.radius, this.foot?.z ?? this.def.length / 2),
    };
  }

  /**
   * Where one hand goes, in world space — the grip on the far end of the
   * rider's reach. Measured off the seat surface, so it follows the sculpt
   * the seat was measured from.
   */
  gripWorld(side: -1 | 1, out: THREE.Vector3): THREE.Vector3 | null {
    const g = this.hands;
    if (!g) return null;
    return this.rideToWorld(this.seatX + side * g.x, this.seatTop + g.y, this.seatZ + g.z, out);
  }

  /** Per-frame while parked; a ridden vehicle is driven from its rider instead. */
  update(dt: number, game: Game): void {
    if (this.reformT > 0) this.reformT = Math.max(0, this.reformT - dt);
    if (!this.alive) {
      this.updateWreck(dt, game);
      return;
    }
    if (this.scripted) { this.syncMesh(dt, Math.hypot(this.vel.x, this.vel.z), game); return; }
    if (this.rider || this.hostile) return; // driven from the rider's update
    // K3: an empty turret still fights, at half rate, for whoever it belongs to
    if (this.def.turret) { this.autoTurret(dt, game); return; }
    if (this.coasting) {
      if (this.lane) this.laneCoast(dt, game);
      else this.coast(dt, game);
      return;
    }
    // settle toward hover height and idle-bob gently inside the parked box
    const target = this.groundAt(this.pos.x, this.pos.z) + this.def.hover;
    this.pos.y = damp(this.pos.y, target, 4, dt) + Math.sin(game.time * 1.7 + this.bobPhase) * 0.004;
    this.syncMesh(dt, 0, game);
  }

  /**
   * A wreck: an animal coming apart, then the wait, then the ride again.
   *
   * The dissolve is the animal's alone — a machine has already gone up in the
   * blast — and it is the body sinking into the ground it died on while the
   * ash comes off it, so what is left after a second is sand.
   */
  private updateWreck(dt: number, game: Game): void {
    if (this.sinkT > 0) {
      // K3: going under — nose first, a little roll, the lava closing over it
      this.sinkT -= dt;
      const gone = 1 - Math.max(0, this.sinkT) / SINK_TIME;
      this.body.position.y = -gone * (this.def.body + this.def.hover + 0.6);
      this.body.rotation.x = gone * 0.5;
      this.body.rotation.z += dt * 0.4;
      if (Math.random() < dt * 14) {
        game.particles.impactSparks(this.pos.clone().setY(this.pos.y - this.def.hover + 0.2), 4);
      }
      if (this.sinkT <= 0) {
        this.group.visible = false;
        game.particles.dustPuff(this.pos.clone().setY(this.pos.y - this.def.hover), 6);
      }
    }
    if (this.dissolveT > 0) {
      this.dissolveT -= dt;
      const gone = 1 - Math.max(0, this.dissolveT) / DISSOLVE_TIME;
      this.body.position.y = -gone * (this.def.body + this.def.hover + 0.4);
      if (Math.random() < dt * 18) {
        game.particles.disintegrate(
          this.pos.clone().setY(this.pos.y + this.def.body * (0.3 + Math.random() * 0.8)), 2,
        );
      }
      if (this.dissolveT <= 0) this.group.visible = false;
    }
    this.respawnIn -= dt;
    if (this.respawnIn <= 0) this.respawn();
  }

  /**
   * One frame of a riderless ride still rolling: the same drag, hover and
   * collisions the driven one gets, with nobody asking it for anything.
   */
  private coast(dt: number, game: Game): void {
    const def = this.def;
    const nx = Math.sin(this.yaw), nz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let fwd = this.vel.x * nx + this.vel.z * nz;
    let lat = this.vel.x * rx + this.vel.z * rz;
    // nothing on the pedals, so it is all drag — a shade heavier than under a
    // rider, since a driverless ride is not being held straight
    const bleed = def.drag * 1.3 * dt;
    fwd = fwd > 0 ? Math.max(0, fwd - bleed) : Math.min(0, fwd + bleed);
    lat = damp(lat, 0, def.grip, dt);
    this.vel.x = nx * fwd + rx * lat;
    this.vel.z = nz * fwd + rz * lat;
    this.applyHover(dt);

    this.crashGrace -= dt;
    const hitRide = this.collideVehicles(game);
    const before = Math.hypot(this.vel.x, this.vel.z);
    game.board.physics.moveCapsule(this.pos, def.radius, def.body, this.vel, dt);
    const after = Math.hypot(this.vel.x, this.vel.z);
    this.crashIntoWall(before - after, game, null);
    if (hitRide) this.crashGrace = 0.25;

    if (this.pos.y < game.board.physics.killY) { this.destroy(!def.living); return; }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < COAST_STOP && this.hopT <= 0) {
      // it has finished rolling — and come back down — so it is solid again,
      // where it came to rest
      this.vel.set(0, 0, 0);
      this.coasting = false;
      this.park();
    }
    this.syncMesh(dt, speed, game);
  }

  /**
   * One frame of driving, called from the rider's update so input flows the
   * same path it does on foot.
   *
   * This is still a vehicle rather than a character — the stick does not point
   * where to go, it turns the nose — but it is the *same stick*: left and
   * right steer, forward and back are the throttle and the brake, exactly
   * where they are on foot. So the state that matters is the nose direction
   * (`yaw`) plus how fast we are travelling along it and how much we are
   * sliding sideways, and the slide is what gives a hard turn its drift before
   * the grip bites.
   */
  drive(dt: number, input: FrameInput, rider: Player, game: Game): void {
    const def = this.def;
    // K3: a turret has no engine — the stick and the look are the gun's
    if (def.turret) { this.driveTurret(dt, input, rider, game); return; }
    this.boostCd -= dt;
    this.gunTick(dt);
    this.swingCd -= dt;

    // ---- the deflector (B) ----
    // The rider's own shield thrown round the hull instead of held in front of
    // their chest, over the ride and the one exposed person on top of it
    // alike. It runs on the rider's gauge — the same budget sprinting, dodging
    // and the on-foot block come out of — so it is seconds, not a state, and
    // it stops being up the moment that gauge is empty.
    this.shieldWanted = input.blockHeld && rider.alive && rider.spendShield(dt / SHIELD_SECONDS);

    // ---- the hop (A) ----
    // The same button that jumps the character, doing the nearest thing a ride
    // has to a jump: a kick off the repulsors that clears a crate line, a low
    // wall or a body in the road. It is not steering and it is not flight —
    // the arc is whatever the kick was worth, and the cooldown is what stops
    // it being a way to travel.
    this.hopCd -= dt;
    if (this.hopT > 0) this.hopT -= dt;
    if (input.jumpPressed && this.hopCd <= 0) {
      this.hopCd = HOP_COOLDOWN;
      this.hopT = HOP_TIME;
      // heft costs lift: a swoop leaps, a laden skiff barely clears the sand
      this.vel.y = Math.max(this.vel.y, HOP_VEL / (0.75 + def.mass * 0.25));
      if (def.living) audio.banthaLow(0.35);
      else audio.dash();
      rider.cam.shake(0.045);
      game.particles.dustPuff(this.pos.clone().setY(this.pos.y - def.hover), 6);
    }

    // ---- the charge (X), a mount only ----
    // The one attack a rider commands rather than improvises: the head goes
    // down and the animal runs, faster than it will ever move under the pedal,
    // and whatever is in front of it is hit by a couple of tonnes of bantha.
    // It commits — steering goes heavy for the length of it — and it is on a
    // cooldown, so it is a thing you time rather than a thing you hold.
    this.chargeCd -= dt;
    if (this.chargeT > 0) this.chargeT -= dt;
    if (def.living && input.meleePressed && this.chargeCd <= 0 && this.chargeT <= 0) {
      this.chargeT = CHARGE_TIME;
      this.chargeCd = CHARGE_TIME + CHARGE_COOLDOWN;
      audio.banthaLow(0.7);
      rider.cam.shake(0.08);
    } else if (def.living && input.meleePressed && this.chargeT <= 0) {
      // Asked for and refused. Silence here is the worst answer: the button
      // does nothing, and from the saddle there is no way to tell a cooldown
      // from being wedged against something — a playtest reported exactly that
      // uncertainty. A short grunt and a tick of the camera say "heard, not
      // yet", which is all it needs to be legible.
      audio.banthaLow(0.2);
      rider.cam.shake(0.02);
    }
    const charging = this.chargeT > 0;

    // boost: the dash button, a straight shove along the nose
    let boost = false;
    if (input.dashPressed && this.boostCd <= 0) {
      this.boostCd = 1.4;
      boost = true;
      // a mount does not have a thruster to fire: it is goaded into a charge
      if (def.living) audio.banthaLow(0.45);
      else audio.dash();
      rider.cam.shake(0.05);
    }

    // Down the sights, the stick is the gun's, not the reins'. A mount is the
    // one ride you can fight from, and while you are aiming from its back a
    // turn is a turn of the *aim* — the animal keeps the line it was on. To
    // steer it you come off the sights (the camera settles back onto the
    // nose) and then steer. Without this a rider tracking a target across
    // the flank was also hauling the bantha round under themselves, and the
    // camera trailing the nose was fighting the aim the whole time.
    const aiming = !!def.living && rider.aiming;
    let speed: number;
    if (this.lane) {
      // K3 lane: the stick is where in the lane and how fast, never which
      // way the level goes — forward is the lane's
      const band = this.lane.speed(this.laneS);
      const want = input.moveY >= 0
        ? band.cruise + (band.max - band.cruise) * input.moveY
        : band.cruise + (band.cruise - band.min) * input.moveY;
      this.sideswipe(dt, input.moveX);
      speed = this.runLane(dt, input.moveX * LANE_LEAN, want, boost, rider, game);
      if (!this.alive) return;
      // the weapons are the driver's until someone sits behind them
      if (!this.pillion) this.fight(input, rider, game);
      this.updateSwing(dt, game);
      this.laneCamera(rider, input, dt);
      audio.setEngine(rider.slot, 0.35 + (speed / Math.max(1, def.top)) * 0.85);
      return;
    }
    speed = this.run(dt, aiming ? 0 : input.moveX, input.moveY, boost, charging, rider, game);
    if (!this.alive) return;
    // K3 on a free ride: a section may still hand it a gun or a swing
    if (!this.pillion && (def.gun || def.sideSwing)) this.fight(input, rider, game);
    if (def.sideSwing) this.updateSwing(dt, game);

    // The camera trails the nose while you drive, but only when you are not
    // working the right stick — steering is the heading now, so a camera left
    // pointing where you were is a camera you have to fight. It eases rather
    // than snaps, and it never fights a look the player is actually giving it.
    // Never while aiming, where the look *is* the aim; and for a moment after
    // the sights come down it settles back onto the nose whatever the speed,
    // so leaving aim mode reads as "back to riding".
    const nx = Math.sin(this.yaw), nz = Math.cos(this.yaw);
    if (aiming) this.aimSettle = AIM_SETTLE;
    else if (this.aimSettle > 0) this.aimSettle -= dt;
    const trail = !aiming && Math.abs(input.lookX) < 1e-4
      && (this.vel.x * nx + this.vel.z * nz > 2 || this.aimSettle > 0);
    if (trail) rider.cam.yaw = dampAngle(rider.cam.yaw, this.yaw, this.aimSettle > 0 ? 4.0 : 2.0, dt);
    if (!def.living) audio.setEngine(rider.slot, 0.35 + (speed / def.top) * 0.85);
  }

  // ---------------------------------------------------------------- K3

  /**
   * One frame on a lane (K3): forward is the lane's, the stick is the lean and
   * the throttle band, and everything the free ride has — the hover, the
   * walls, the rams, the rides either side — still applies. Returns the speed
   * it ends the frame at.
   */
  private runLane(dt: number, latWant: number, speedWant: number, boost: boolean,
    rider: Player | null, game: Game): number {
    const def = this.def;
    const lane = this.lane!;
    const on = lane.project(this.pos.x, this.pos.z, this.laneS);
    this.laneS = on.s;
    this.laneLat = on.lat;
    const h = lane.heading(on.s);
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = -Math.cos(h), rz = Math.sin(h);
    let fwd = this.vel.x * fx + this.vel.z * fz;
    const band = lane.speed(on.s);
    // the throttle band: the stick picks a speed inside it, and the ride
    // pulls up to it or eases back down to it — never under the band's floor
    fwd = fwd < speedWant
      ? Math.min(speedWant, fwd + def.throttle * dt)
      : Math.max(speedWant, fwd - def.brake * 0.6 * dt);
    if (boost) fwd = Math.min(Math.max(band.max, 1) * 1.4, fwd + def.boost);
    // the end of the lane: where the band closes to nothing, it stops
    if (band.max <= 0.01 && fwd < 0.6) fwd = 0;
    this.latVel = damp(this.latVel, latWant, LANE_LEAN_BITE, dt);
    this.steer = clamp(latWant / LANE_LEAN, -1, 1);
    this.vel.x = fx * fwd + rx * this.latVel;
    this.vel.z = fz * fwd + rz * this.latVel;

    this.applyHover(dt);
    this.crashGrace -= dt;
    const hitRide = this.collideVehicles(game);
    const before = Math.hypot(this.vel.x, this.vel.z);
    game.board.physics.moveCapsule(this.pos, def.radius, def.body, this.vel, dt);
    const after = Math.hypot(this.vel.x, this.vel.z);
    this.crashIntoWall(before - after, game, rider);
    if (hitRide) this.crashGrace = 0.25;
    if (!this.alive) return 0;
    this.keepInLane(game, rider);
    if (!this.alive) return 0;

    // what the world left of the lean, and the nose turned into it
    const f2 = this.vel.x * fx + this.vel.z * fz;
    this.latVel = this.vel.x * rx + this.vel.z * rz;
    this.yaw = h - Math.atan2(this.latVel, Math.max(6, f2)) * 0.7;

    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.ram(speed, false, rider, game);
    if (!this.alive) return speed;
    this.dustTimer -= dt * speed;
    if (this.dustTimer <= 0 && speed > 3) {
      this.dustTimer = 2.2;
      game.particles.runDust(this.pos.clone().setY(this.pos.y - def.hover * 0.5));
    }
    if (this.pos.y < game.board.physics.killY) { this.destroy(true); return speed; }
    this.syncMesh(dt, speed, game);
    return speed;
  }

  /**
   * The lane's edges are walls: a hull that leans past one is set back on the
   * line, its lean bounced back off the rock, and a hard scrape costs it.
   * The far end is a wall too — the ride stops against it.
   */
  private keepInLane(game: Game, rider: Player | null): void {
    const lane = this.lane!;
    const on = lane.project(this.pos.x, this.pos.z, this.laneS);
    let s = on.s, lat = on.lat;
    let moved = false;
    if (s > lane.length - 1) { s = lane.length - 1; moved = true; }
    if (s < 0) { s = 0; moved = true; }
    const lim = Math.max(0, lane.halfWidth(s) - this.def.radius);
    if (Math.abs(lat) > lim) {
      const side = Math.sign(lat);
      const into = this.latVel * side;
      lat = side * lim;
      moved = true;
      if (into > 0) {
        if (into > 4) {
          this.damage(into * 0.9, this.pos, -1, 'crash');
          game.particles.impactSparks(this.pos.clone().setY(this.pos.y + 0.5), 10);
          audio.land(true);
          rider?.cam.shake(Math.min(0.2, into * 0.02));
        }
        this.latVel = -side * into * 0.35;
      }
    }
    if (moved) {
      const y = this.pos.y;
      lane.point(s, lat, this.pos);
      this.pos.y = y;
      const h = lane.heading(s);
      const fwd = s >= lane.length - 1 ? 0 : this.vel.x * Math.sin(h) + this.vel.z * Math.cos(h);
      this.vel.x = Math.sin(h) * fwd - Math.cos(h) * this.latVel;
      this.vel.z = Math.cos(h) * fwd + Math.sin(h) * this.latVel;
    }
    this.laneS = s;
    this.laneLat = lat;
  }

  /**
   * The sideswipe: lean, let go, lean again the same way inside a third of a
   * second, and the hull is shoved sideways into whoever is there — the
   * ride-on-ride mass rule does the rest.
   */
  private sideswipe(dt: number, lean: number): void {
    this.swipeCd -= dt;
    this.tapT -= dt;
    const side = lean > 0.7 ? 1 : lean < -0.7 ? -1 : 0;
    if (side !== 0 && this.leanWas === 0) {
      if (side === this.tapSide && this.tapT > 0 && this.swipeCd <= 0) {
        this.latVel += side * SIDESWIPE;
        this.swipeCd = 1;
        this.tapT = 0;
        audio.dash();
      } else {
        this.tapSide = side;
        this.tapT = 0.32;
      }
    }
    this.leanWas = Math.abs(lean) < 0.3 ? 0 : (side || this.leanWas);
  }

  /** a riderless hull on a lane: it runs on, drifting, and the lava has it */
  private laneCoast(dt: number, game: Game): void {
    const lane = this.lane!;
    const h = lane.heading(this.laneS);
    const fx = Math.sin(h), fz = Math.cos(h);
    let fwd = this.vel.x * fx + this.vel.z * fz;
    fwd = Math.max(0, fwd - this.def.drag * 1.6 * dt);
    this.latVel = damp(this.latVel, 0, 1.2, dt);
    this.vel.x = fx * fwd - Math.cos(h) * this.latVel;
    this.vel.z = fz * fwd + Math.sin(h) * this.latVel;
    this.applyHover(dt);
    this.crashGrace -= dt;
    const hitRide = this.collideVehicles(game);
    const before = Math.hypot(this.vel.x, this.vel.z);
    game.board.physics.moveCapsule(this.pos, this.def.radius, this.def.body, this.vel, dt);
    this.crashIntoWall(before - Math.hypot(this.vel.x, this.vel.z), game, null);
    if (hitRide) this.crashGrace = 0.25;
    if (!this.alive) return;
    this.keepInLane(game, null);
    // nobody holding it level: it noses over and goes in
    if (this.sinkIn < 0) this.sinkIn = SINK_AFTER;
    this.sinkIn -= dt;
    if (this.sinkIn <= 0 && (lane.sinks?.(this.laneS, this.laneLat) ?? false)) {
      this.destroy('sink');
      return;
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < COAST_STOP && this.hopT <= 0) {
      this.vel.set(0, 0, 0);
      this.coasting = false;
      this.sinkIn = -1;
      this.park();
    }
    this.syncMesh(dt, speed, game);
  }

  /**
   * The rider's camera on a lane: locked behind the ride along the lane's own
   * heading, firmer than the free ride's trail. The right stick nudges the
   * view a few degrees for the cannon, and it settles back when let go.
   */
  private laneCamera(p: Player, input: FrameInput, dt: number): void {
    const h = this.lane!.heading(this.laneS);
    let off = wrapAngle(p.cam.yaw - h);
    off = clamp(off, -0.24, 0.24);
    if (Math.abs(input.lookX) < 1e-4) off = damp(off, 0, 2.5, dt);
    p.cam.yaw = h + off;
    p.cam.pitch = clamp(p.cam.pitch, -0.45, 0.12);
    if (Math.abs(input.lookY) < 1e-4) p.cam.pitch = damp(p.cam.pitch, -0.17, 2, dt);
  }

  /** the driver's or the pillion's trigger and melee button, from the saddle */
  private fight(input: FrameInput, p: Player, game: Game): void {
    if (this.def.gun && input.shootHeld) {
      this.noseAim(_aimPt);
      this.fireGun(_aimPt, p.team, p.slot, game, p);
    }
    if (this.def.sideSwing && input.meleePressed) {
      this.startSwing(this.pickSide(p, input.moveX, game), p);
    }
  }

  /**
   * The pillion's frame (K3): the weapons are theirs — the cannon and both
   * flanks' swings — and the stick is the driver's. The seat, the pose and
   * the dismount are the rider's own (see `player/riding.ts`).
   */
  ridePillion(dt: number, input: FrameInput, p: Player, game: Game): void {
    if (!this.alive || this.pillion !== p) return;
    this.fight(input, p, game);
    if (this.lane) this.laneCamera(p, input, dt);
    else if (Math.abs(input.lookX) < 1e-4) p.cam.yaw = dampAngle(p.cam.yaw, this.yaw, 2, dt);
  }

  /** the point forty metres off the nose, at chest height: where an unaimed cannon goes */
  private noseAim(out: THREE.Vector3): THREE.Vector3 {
    return out.set(
      this.pos.x + Math.sin(this.yaw) * 40,
      this.pos.y + 1.3,
      this.pos.z + Math.cos(this.yaw) * 40,
    );
  }

  /** one frame of the gun's clock: the rate's wait, and the heat venting */
  private gunTick(dt: number): void {
    const g = this.def.gun;
    if (!g) return;
    this.gunCd -= dt;
    this.heat = Math.max(0, this.heat - g.cool * dt);
    if (this.overheated && this.heat <= g.resume) this.overheated = false;
  }

  /**
   * One shot, if the gun is ready: from the next muzzle, at `aimPt` — bent
   * onto a target inside the soft-lock cone — and a step of heat. True when
   * it fired.
   */
  private fireGun(aimPt: THREE.Vector3, team: number, slot: number, game: Game,
    shooter: Player | null, rate = 1): boolean {
    const g = this.def.gun;
    if (!g || !this.alive || this.overheated || this.gunCd > 0) return false;
    this.gunCd = 1 / (g.rate * rate);
    const m = g.muzzles[this.muzzleIdx++ % g.muzzles.length];
    const origin = this.muzzleWorld(m, _muzzle);
    const dir = _shot.subVectors(aimPt, origin);
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    dir.normalize();
    const lock = this.softLock(origin, dir, g, team, game);
    if (lock) dir.subVectors(lock, origin).normalize();
    game.projectiles.fire(origin, dir, g.speed, g.damage, team, slot);
    game.particles.muzzleFlash(origin, dir);
    if (shooter) {
      audio.blaster(g.voice ?? 'carbine');
      shooter.cam.shake(0.018);
      game.director.noise(game, shooter.position, 55);
    } else audio.enemyBlaster();
    this.heat = Math.min(1, this.heat + g.heat);
    if (this.heat >= 1) {
      this.overheated = true;
      audio.overheat(0.5);
      game.particles.dustPuff(origin, 4);
    }
    return true;
  }

  /**
   * A hostile rider's own blaster, turned in the saddle at `at` — behind as
   * readily as ahead. On the gun's clock and heat, from the rider's chest,
   * and not as sure as a cannon on a mount.
   */
  private fireFromSaddle(at: THREE.Vector3, e: Enemy, game: Game): boolean {
    const g = this.def.gun;
    if (!g || !this.alive || this.overheated || this.gunCd > 0) return false;
    this.gunCd = 1 / g.rate;
    const origin = _muzzle.set(e.position.x, e.position.y + 1.35, e.position.z);
    const dir = _shot.subVectors(at, origin);
    const d = dir.length();
    if (d < 1) return false;
    dir.divideScalar(d);
    dir.x += (Math.random() - 0.5) * 0.06;
    dir.y += (Math.random() - 0.5) * 0.03;
    dir.z += (Math.random() - 0.5) * 0.06;
    dir.normalize();
    game.projectiles.fire(origin, dir, g.speed, g.damage, e.team, -1);
    game.particles.muzzleFlash(origin, dir);
    audio.enemyBlaster();
    this.heat = Math.min(1, this.heat + g.heat);
    if (this.heat >= 1) this.overheated = true;
    return true;
  }

  /** a muzzle in the world; a turret's barrels pitch about its trunnion */
  private muzzleWorld(m: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 {
    const t = this.def.turret;
    if (!t) return this.localPoint(m.x, m.y, m.z, out);
    const c = Math.cos(this.aimPitch), sn = Math.sin(this.aimPitch);
    const dy = m.y - t.pivot;
    return this.localPoint(m.x, t.pivot + dy * c + m.z * sn, m.z * c - dy * sn, out);
  }

  /**
   * The soft lock: the chest of the nearest body on the other side inside the
   * gun's cone and range, or null. Nearest by angle, so the bolt goes where
   * the gun was already pointing.
   */
  private softLock(origin: THREE.Vector3, dir: THREE.Vector3, g: GunDef, team: number,
    game: Game): THREE.Vector3 | null {
    const cosCone = Math.cos(g.cone);
    let best = cosCone;
    let found = false;
    const consider = (pos: THREE.Vector3, height: number): void => {
      _lock.set(pos.x, pos.y + height * 0.6, pos.z).sub(origin);
      const d = _lock.length();
      if (d < 1 || d > g.range) return;
      const dot = _lock.dot(dir) / d;
      if (dot <= best) return;
      best = dot;
      _lockPt.set(pos.x, pos.y + height * 0.6, pos.z);
      found = true;
    };
    for (const e of game.enemies) {
      if (!e.alive || e.team === team || !e.targetable) continue;
      consider(e.position, e.height);
    }
    for (const p of game.players) {
      if (!p.alive || p.team === team || p.exited) continue;
      consider(p.position, p.height);
    }
    return found ? _lockPt : null;
  }

  /**
   * Which flank a swing goes to: the stick's lean when it is leaning, the
   * side the nearest body on the other side is on when it is not.
   */
  private pickSide(by: Player | Enemy, lean: number, game: Game): -1 | 1 {
    if (Math.abs(lean) > 0.35) return lean > 0 ? 1 : -1;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    let best = Infinity;
    let side: -1 | 1 = 1;
    const consider = (pos: THREE.Vector3): void => {
      const dx = pos.x - this.pos.x, dz = pos.z - this.pos.z;
      const along = dx * fx + dz * fz, lat = dx * rx + dz * rz;
      if (Math.abs(along) > 7 || Math.abs(lat) > 9 || Math.abs(lat) < 0.3) return;
      const d = Math.hypot(along, lat);
      if (d < best) { best = d; side = lat > 0 ? 1 : -1; }
    };
    for (const e of game.enemies) if (e.alive && e.team !== by.team) consider(e.position);
    for (const p of game.players) if (p.alive && p.team !== by.team) consider(p.position);
    return side;
  }

  /**
   * Swing from the saddle (K3). A player's swing is their own weapon and
   * their own attack clip — Din's spear, Maul's staff, a saber — turned to
   * the flank; a hostile's is a club. False when one is already in the air.
   */
  private startSwing(side: -1 | 1, by: Player | Enemy): boolean {
    if (this.swing || this.swingCd > 0 || !this.alive) return false;
    let dur = 0.55;
    let weapon: Player['weapon'] | null = null;
    if (isPlayer(by)) {
      weapon = by.weapon;
      const sabers = by.meleeKind === 'sabers';
      const step = (this.swingStep++ % 3) + 1;
      const set = sabers ? saberClipsFor(by.characterId).attack : 'melee';
      if (by.weapon !== 'gaffi') {
        by.weapon = 'gaffi';
        by.char.setWeapon('gaffi');
        if (sabers) audio.saberIgnite();
      }
      const played = by.char.attack?.() ?? by.char.animator?.playOnce('upper', `${set}${step}`, 0.05) ?? 0;
      dur = clamp(played || 0.55, 0.35, 0.9);
      audio.melee(step, sabers ? 'sabers' : 'gaffi');
    } else {
      by.char.animator?.playOnce('upper', 'melee1', 0.05);
      dur = HOSTILE_SWING;
    }
    this.swing = { side, t: 0, dur, landed: false, by, weapon };
    return true;
  }

  /** the swing's clock: it lands part-way through, then the weapon goes away */
  private updateSwing(dt: number, game: Game): void {
    const sw = this.swing;
    if (!sw) return;
    sw.t += dt;
    if (!sw.by.alive) { this.endSwing(); return; }
    // a hostile's club whooshes as it comes round, not as it is raised
    if (!isPlayer(sw.by) && sw.t - dt < sw.dur * SWING_FROM && sw.t >= sw.dur * SWING_FROM) audio.melee(1, 'gaffi');
    if (!sw.landed && sw.t >= sw.dur * SWING_FROM && sw.t <= sw.dur * SWING_TO) {
      sw.landed = this.landSwing(sw.side, sw.by, game);
    }
    if (sw.t >= sw.dur) this.endSwing();
  }

  private endSwing(): void {
    const sw = this.swing;
    if (!sw) return;
    this.swing = null;
    this.swingCd = SWING_COOLDOWN;
    if (isPlayer(sw.by) && sw.weapon && sw.weapon !== 'gaffi') {
      sw.by.weapon = sw.weapon;
      sw.by.char.setWeapon(sw.weapon);
    }
  }

  /**
   * The swing arrives: everyone on the other side inside the flank box is
   * hit. A hostile in a saddle comes *out* of it — thrown sideways off a ride
   * that runs on without them — which over lava is the end of them; a
   * player hit from a hostile's saddle takes the blow and the shove.
   */
  private landSwing(side: -1 | 1, by: Player | Enemy, game: Game): boolean {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const inBox = (pos: THREE.Vector3): boolean => {
      const dx = pos.x - this.pos.x, dz = pos.z - this.pos.z;
      const out = (dx * rx + dz * rz) * side;
      const along = dx * fx + dz * fz;
      return out >= SWING_OUT_MIN && out <= SWING_OUT_MAX && Math.abs(along) <= SWING_ALONG
        && Math.abs(pos.y - this.pos.y) < 3;
    };
    let landed = false;
    if (isPlayer(by)) {
      const dmg = Math.max(45, by.profile.meleeFinisher);
      for (const e of game.enemies) {
        if (!e.alive || e.team === by.team || !inBox(e.position)) continue;
        const ride = e.ride;
        const carry = ride ? ride.vel.clone() : null;
        if (ride) {
          ride.dropHostile();
          ride.latVel += side * 4;
        }
        // A rider is knocked *out of the saddle*, not cut down in it: the blow
        // leaves him alive and flying, and what he lands in does the rest —
        // over lava that is the end of him, on crust he gets up. A body on
        // its feet takes the full blow.
        e.damage(ride ? Math.min(dmg, Math.max(1, e.hp - 1)) : dmg, this.pos, by.slot);
        if (carry) {
          // out of the saddle, sideways, at the speed they were doing
          e.velocity.set(carry.x * 0.7 + rx * side * 8, 6.5, carry.z * 0.7 + rz * side * 8);
          e.position.y += 0.4;
          if (e.alive) e.knockdown(2.6);
        } else if (e.alive) {
          e.knockback(this.pos, 12, 0.4);
          e.knockdown(1.6);
        }
        game.particles.impactSparks(e.position.clone().setY(e.position.y + 1.1), 14);
        landed = true;
      }
      if (landed) {
        audio.meleeHit(by.meleeKind === 'sabers' ? 'sabers' : 'gaffi');
        by.cam.shake(0.12);
        game.hitMarker(by.slot);
      }
      return landed;
    }
    for (const p of game.players) {
      if (!p.alive || p.team === by.team || p.exited || !inBox(p.position)) continue;
      p.damage(14, this.pos, -1);
      const pv = p.vehicle;
      if (pv) {
        pv.latVel += side * 7;
      } else {
        p.velocity.x += rx * side * 7;
        p.velocity.z += rz * side * 7;
        p.velocity.y += 2;
      }
      p.cam.shake(0.18);
      game.particles.impactSparks(p.position.clone().setY(p.position.y + 1.1), 10);
      landed = true;
    }
    if (landed) audio.meleeHit('gaffi');
    return landed;
  }

  /**
   * Where the rider faces this frame (K3), for `player/riding.ts`: a swing
   * turns the body to its flank, and a turret's gunner turns with the gun.
   * Null leaves the rider's own rule.
   */
  riderFacing(p: Player | Enemy): number | null {
    if (this.swing && this.swing.by === p) return this.yaw - this.swing.side * 1.15;
    if (this.def.turret) return this.yaw;
    return null;
  }

  /** a swing from this saddle is in the air: the hands are off the bars */
  swinging(p: Player | Enemy): boolean {
    return !!this.swing && this.swing.by === p;
  }

  /** seconds of the side swing's cooldown left, for a HUD */
  get swingReady(): boolean { return !this.swing && this.swingCd <= 0; }

  // ---- the hostile on a lane ----

  /** a hostile's frame on a lane: the brain's order, driven the player's way */
  private hostileLane(dt: number, game: Game): void {
    const e = this.hostile!;
    this.boostCd -= dt;
    this.hopCd -= dt;
    if (this.hopT > 0) this.hopT -= dt;
    this.gunTick(dt);
    this.swingCd -= dt;
    const order = this.laneBrain ? this.laneBrain(this, dt, game) : this.laneBrainDefault(dt, game);
    let boost = false;
    if (order.boost && this.boostCd <= 0) { this.boostCd = 1.6; boost = true; }
    const latWant = clamp((order.lat - this.laneLat) * 2.2, -LANE_LEAN, LANE_LEAN);
    this.runLane(dt, latWant, order.speed, boost, null, game);
    if (!this.alive || this.hostile !== e) return;
    if (order.fire && this.def.gun) {
      if (order.aimAt) this.fireFromSaddle(order.aimAt, e, game);
      else {
        this.noseAim(_aimPt);
        this.fireGun(_aimPt, e.team, -1, game, null);
      }
    }
    if (order.swing && this.def.sideSwing) this.startSwing(order.swing, e);
    this.updateSwing(dt, game);
  }

  /**
   * The built-in lane brain (K3): pick the nearest player riding the lane,
   * then — a **swinger** comes up alongside them on the side with room, swings
   * and peels away to come again; a **gunner** sits on their tail and fires
   * while it is lined up. Both fall back and come round when they overrun.
   */
  private laneBrainDefault(dt: number, game: Game): LaneOrder {
    const b = this.brain;
    const lane = this.lane!;
    b.t -= dt;
    let markV: Vehicle | null = null;
    let best = Infinity;
    for (const p of game.players) {
      const pv = p.vehicle;
      if (!p.alive || !pv || !pv.lane) continue;
      const d = Math.abs(pv.laneS - this.laneS);
      if (d < best) { best = d; markV = pv; }
    }
    const band = lane.speed(this.laneS);
    if (!markV) return { lat: this.laneLat, speed: band.cruise };
    const ms = markV.laneS, ml = markV.laneLat;
    const mspd = Math.max(band.min * 0.8, Math.hypot(markV.vel.x, markV.vel.z));
    const hw = Math.max(1, lane.halfWidth(this.laneS) - 1.6);
    if (b.mode === 'peel') {
      if (b.t <= 0 && !this.swing) {
        b.mode = 'close';
        b.t = 9;
        b.side = Math.random() < 0.5 ? -1 : 1;
      }
      // hold station through the swing, then fall away to the far side
      if (this.swing) return { lat: this.laneLat, speed: mspd + (ms - this.laneS) };
      return { lat: clamp(ml + b.side * 9, -hw, hw), speed: mspd - 5 };
    }
    if (b.t <= 0) { b.mode = 'peel'; b.t = 2.5; }
    if (b.role === 'gunner') {
      // Out in front, weaving across the mark's line, turned in the saddle
      // and shooting back in bursts — which puts it square in the mark's own
      // nose cannons. A duel, not a tail that cannot be answered.
      const gap = ms + 16 - this.laneS;
      const weave = Math.sin(game.time * 0.7 + this.bobPhase) * 5;
      const ahead = this.laneS > ms + 4 && this.laneS < ms + 45;
      const burst = (game.time + this.bobPhase) % 2.4 < 0.9;
      const mark = markV.rider ?? markV.pillion;
      return {
        lat: clamp(ml + weave, -hw, hw),
        speed: mspd + clamp(gap * 0.9, -9, 12),
        boost: gap > 30,
        fire: ahead && burst && !!mark,
        aimAt: mark ? _brainAim.set(mark.position.x, mark.position.y + 1.1, mark.position.z) : null,
      };
    }
    let side = b.side;
    let lat = clamp(ml + side * 3.1, -hw, hw);
    if (Math.abs(lat - ml) < 2.2) {
      side = -side as -1 | 1;
      b.side = side;
      lat = clamp(ml + side * 3.1, -hw, hw);
    }
    const gap = ms + 0.3 - this.laneS;
    const off = Math.abs(this.laneLat - ml);
    const alongside = Math.abs(gap) < 2.2 && off < 4.4 && off > 1.2;
    let swing: -1 | 1 | 0 = 0;
    if (alongside && this.swingCd <= 0 && !this.swing) {
      swing = ml > this.laneLat ? 1 : -1;
      b.mode = 'peel';
      b.t = 2.4;
    }
    return { lat, speed: mspd + clamp(gap * 1.2, -8, 12), boost: gap > 26, swing };
  }

  // ---- the turret ----

  /** a turret's gunner: the look is the gun, inside its arc; RT fires */
  private driveTurret(dt: number, input: FrameInput, p: Player, game: Game): void {
    const t = this.def.turret!;
    this.gunTick(dt);
    const off = clamp(wrapAngle(p.cam.yaw - this.baseYaw), -t.yawArc, t.yawArc);
    p.cam.yaw = this.baseYaw + off;
    p.cam.pitch = clamp(p.cam.pitch, t.pitchMin, t.pitchMax);
    this.slewTo(p.cam.yaw, p.cam.pitch, dt);
    if (input.shootHeld) {
      // converge on what the sight is over: sixty metres down the barrels' line
      this.sightWorld(_sight);
      this.gunDir(_aim);
      _aimPt.copy(_sight).addScaledVector(_aim, 60);
      this.fireGun(_aimPt, p.team, p.slot, game, p);
    }
    this.syncMesh(dt, 0, game);
  }

  /** a hostile on the gun: onto the nearest of the party in the arc, in bursts */
  private hostileTurret(dt: number, game: Game): void {
    const e = this.hostile!;
    this.turretFight(dt, game, e.team, 1, true);
  }

  /** nobody on the gun: it still fights for its side, at the def's fraction of the rate */
  private autoTurret(dt: number, game: Game): void {
    const t = this.def.turret!;
    if (t.auto > 0) this.turretFight(dt, game, this.team, t.auto, false);
    else {
      this.gunTick(dt);
      this.slewTo(this.baseYaw, 0, dt * 0.4);
    }
    this.syncMesh(dt, 0, game);
  }

  /** find, lead, slew, and fire in bursts — the one brain a gun without a player has */
  private turretFight(dt: number, game: Game, team: number, rate: number, manned: boolean): void {
    const t = this.def.turret!;
    this.gunTick(dt);
    const tgt = this.turretTarget(game, team, manned ? t.autoRange * 1.2 : t.autoRange);
    if (!tgt) {
      this.slewTo(this.baseYaw, 0, dt * 0.5);
      return;
    }
    this.sightWorld(_sight);
    const dist = _sight.distanceTo(tgt.pos);
    const lead = dist / (this.def.gun?.speed ?? 80);
    _aimPt.copy(tgt.pos).addScaledVector(tgt.vel, lead * 0.85);
    _aim.subVectors(_aimPt, _sight);
    const wantYaw = Math.atan2(_aim.x, _aim.z);
    const wantPitch = Math.atan2(_aim.y, Math.hypot(_aim.x, _aim.z));
    this.slewTo(this.baseYaw + clamp(wrapAngle(wantYaw - this.baseYaw), -t.yawArc, t.yawArc),
      clamp(wantPitch, t.pitchMin, t.pitchMax), dt);
    const onIt = Math.abs(wrapAngle(wantYaw - this.yaw)) < 0.07 && Math.abs(wantPitch - this.aimPitch) < 0.08;
    // bursts: five rounds, then a breath — long enough to be read and dodged
    this.burstRest -= dt;
    if (this.burstRest > 0 || !onIt) return;
    if (this.burstLeft <= 0) this.burstLeft = 5;
    // a gun nobody is aiming by eye throws its rounds about a little
    const miss = dist * 0.035;
    _aimPt.x += (Math.random() - 0.5) * miss;
    _aimPt.y += (Math.random() - 0.5) * miss * 0.5;
    _aimPt.z += (Math.random() - 0.5) * miss;
    if (this.fireGun(_aimPt, team, -1, game, null, rate)) {
      this.burstLeft--;
      if (this.burstLeft <= 0) this.burstRest = 1.5;
    }
  }

  /** the nearest living body on the other side inside the arc and range */
  private turretTarget(game: Game, team: number, range: number): { pos: THREE.Vector3; vel: THREE.Vector3 } | null {
    const t = this.def.turret!;
    let best = range;
    let pick: { pos: THREE.Vector3; vel: THREE.Vector3 } | null = null;
    const consider = (pos: THREE.Vector3, vel: THREE.Vector3, height: number): void => {
      const dx = pos.x - this.pos.x, dz = pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= best || d < 1.5) return;
      if (Math.abs(wrapAngle(Math.atan2(dx, dz) - this.baseYaw)) > t.yawArc) return;
      best = d;
      _tgtPos.set(pos.x, pos.y + height * 0.55, pos.z);
      pick = { pos: _tgtPos, vel };
    };
    for (const e of game.enemies) if (e.alive && e.team !== team && e.targetable) consider(e.position, e.velocity, e.height);
    for (const p of game.players) if (p.alive && p.team !== team && !p.exited) consider(p.position, p.velocity, p.height);
    return pick;
  }

  /** the gun comes round at its own pace: `slew` radians a second, both axes */
  private slewTo(yaw: number, pitch: number, dt: number): void {
    const step = (this.def.turret?.slew ?? 2) * dt;
    this.yaw += clamp(wrapAngle(yaw - this.yaw), -step, step);
    this.aimPitch += clamp(pitch - this.aimPitch, -step, step);
  }

  /** the gunner's eye, over the breech, turned with the gun */
  sightWorld(out: THREE.Vector3): THREE.Vector3 {
    const s = this.def.turret?.sight ?? { x: 0, y: this.def.body, z: 0 };
    return this.localPoint(s.x, s.y, s.z, out);
  }

  /** the barrels' line, unit */
  gunDir(out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(this.aimPitch);
    return out.set(Math.sin(this.yaw) * c, Math.sin(this.aimPitch), Math.cos(this.yaw) * c);
  }

  /**
   * The gunner's sight camera (K3): after the chase camera has placed itself,
   * a turret's gunner sees down the barrels from the eye over the breech.
   * Called from `player/riding.ts` once the camera has updated.
   */
  applySight(p: Player): void {
    if (!this.def.turret || this.rider !== p) return;
    const cam = p.cam.camera;
    this.sightWorld(cam.position);
    this.gunDir(_aim);
    cam.lookAt(cam.position.x + _aim.x * 20, cam.position.y + _aim.y * 20, cam.position.z + _aim.z * 20);
    if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
  }

  /**
   * Put a scripted ride where its section has it this frame (see `scripted`):
   * the hull, its heading and the velocity it is carrying — which is what a
   * bike running into it measures the collision against.
   */
  place(x: number, y: number, z: number, yaw: number, vx = 0, vz = 0): void {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.vel.set(vx, 0, vz);
    if (this.lane) {
      const on = this.lane.project(x, z, this.laneS);
      this.laneS = on.s;
      this.laneLat = on.lat;
    }
    this.group.position.copy(this.pos);
    this.group.rotation.y = yaw;
  }

  /**
   * Stand a turret somewhere else — on a hull that is moving, say. The gun
   * keeps its aim relative to the mount, and its ring goes with it.
   */
  moveMount(x: number, y: number, z: number, baseYaw = this.baseYaw): void {
    const off = this.yaw - this.baseYaw;
    this.baseYaw = baseYaw;
    this.yaw = baseYaw + off;
    this.pos.set(x, y, z);
    if (this.parkedBox) { this.unpark(); this.park(); }
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.def.turret ? this.baseYaw : this.yaw;
  }

  /**
   * A hostile's frame of driving: the same ride, the same physics, and an AI
   * at the pedals instead of a stick. What it rams is the other side.
   */
  driveHostile(dt: number, steer: number, pedal: number, boost: boolean, charge: boolean, game: Game): void {
    const def = this.def;
    // K3: a turret with a hostile on it, and a lane with one on it, have
    // their own brains; the hostile's own steer and pedal are for free rides
    if (def.turret) { this.hostileTurret(dt, game); return; }
    if (this.scripted) {
      this.gunTick(dt);
      this.swingCd -= dt;
      this.updateSwing(dt, game);
      return;
    }
    if (this.lane) { this.hostileLane(dt, game); return; }
    this.boostCd -= dt;
    this.hopCd -= dt;
    if (this.hopT > 0) this.hopT -= dt;
    this.chargeCd -= dt;
    if (this.chargeT > 0) this.chargeT -= dt;
    if (def.living && charge && this.chargeCd <= 0 && this.chargeT <= 0) {
      this.chargeT = CHARGE_TIME;
      this.chargeCd = CHARGE_TIME + CHARGE_COOLDOWN;
      audio.banthaLow(0.7);
    }
    let kick = false;
    if (boost && this.boostCd <= 0) {
      this.boostCd = 1.4;
      kick = true;
      if (def.living) audio.banthaLow(0.45);
      else audio.dash();
    }
    this.run(dt, steer, pedal, kick, this.chargeT > 0, null, game);
  }

  /**
   * One frame of the ride itself, whoever is on it: steering, the pedals,
   * grip, hover, the world, and the ram. Returns the speed it ends the frame
   * at. `rider` is the player at the controls, or null for a hostile — and
   * that is the only thing that decides which side the hull is a weapon
   * against.
   */
  private run(dt: number, steerIn: number, pedal: number, boost: boolean, charging: boolean,
    rider: Player | null, game: Game): number {
    const def = this.def;
    // ---- steering ----
    // Screen-right is -X for a nose on +Z (see yawBasis), so a stick pushed
    // right turns the nose by *decreasing* yaw.
    //
    // How sharply it comes round depends on how fast it is going, and not
    // monotonically. A repulsor can pivot standing still — without some
    // authority at rest you can end up nosed into a wall with no way to turn
    // off it — it carves hardest at a working speed, and it goes stiff again
    // flat out, so a top-speed run is a commitment rather than a thing you can
    // pirouette out of. That last part is what makes the boost a decision.
    const speedNow = Math.hypot(this.vel.x, this.vel.z);
    const bite = 0.45 + 0.55 * Math.min(1, speedNow / (def.top * 0.35));
    const fast = clamp((speedNow - def.top * 0.55) / (def.top * 0.45), 0, 1);
    this.steer = clamp(steerIn, -1, 1);
    // a charging animal is aimed before it is launched, not steered through
    this.yaw -= this.steer * def.turn * bite * (1 - 0.32 * fast) * (charging ? 0.4 : 1) * dt;

    // the nose, and the axis it slides along
    const nx = Math.sin(this.yaw), nz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let fwd = this.vel.x * nx + this.vel.z * nz;
    let lat = this.vel.x * rx + this.vel.z * rz;

    // ---- the pedals: the stick's own forward and back ----
    // Push the stick the way you would push it walking and the ride goes that
    // way; pull it back and it hauls up, then reverses out. It is analogue,
    // like every other thing that stick does: half forward is half the ride's
    // top speed held, which is the difference between threading a camp and
    // arriving in it.
    if (charging) {
      // the charge owns the legs: the stick is worth nothing until it ends
      fwd = Math.min(def.top * CHARGE_TOP, fwd + def.throttle * 3 * dt);
    } else if (pedal > PEDAL_DEADZONE) {
      // Over the speed the stick is asking for — off a boost, down a slope —
      // it coasts back down to it rather than being clipped there, so a boost
      // is still worth something with the stick buried.
      const want = def.top * pedal;
      fwd = fwd < want
        ? Math.min(want, fwd + def.throttle * dt)
        : Math.max(want, fwd - def.drag * dt);
    } else if (pedal < -PEDAL_DEADZONE) {
      const pull = -pedal;
      fwd = fwd > REVERSE_THRESHOLD
        ? Math.max(0, fwd - def.brake * pull * dt)                            // hauling it up
        : Math.max(-def.top * REVERSE_FRACTION * pull,
          fwd - def.throttle * 0.6 * pull * dt);                              // backing off
    } else {
      // stick centred: repulsors bleed speed slowly, so momentum is worth carrying
      const bleed = def.drag * dt;
      fwd = fwd > 0 ? Math.max(0, fwd - bleed) : Math.min(0, fwd + bleed);
    }

    // boost: a straight shove along the nose
    if (boost) fwd = Math.min(def.top * 1.6, fwd + def.boost);

    // grip bleeds the slide off; what is left is the drift through a turn
    lat = damp(lat, 0, def.grip, dt);
    this.vel.x = nx * fwd + rx * lat;
    this.vel.z = nz * fwd + rz * lat;

    this.applyHover(dt);

    // integrate against the world; a wall eats velocity, and a hard stop hurts
    this.crashGrace -= dt;
    const hitRide = this.collideVehicles(game);
    const before = Math.hypot(this.vel.x, this.vel.z);
    game.board.physics.moveCapsule(this.pos, def.radius, def.body, this.vel, dt);
    const after = Math.hypot(this.vel.x, this.vel.z);
    this.crashIntoWall(before - after, game, rider);
    if (hitRide) this.crashGrace = 0.25;

    const speed = Math.hypot(this.vel.x, this.vel.z);

    this.ram(speed, charging, rider, game);

    // an animal sounds like an animal under anyone; a machine's engine is the
    // player's own mix (set by `drive`), and a hostile's is left to the world.
    // Dust or spray kicks up in the wake either way.
    if (def.living) this.mountVoice(dt, speed);
    this.dustTimer -= dt * speed;
    if (this.dustTimer <= 0 && speed > 3) {
      this.dustTimer = 2.2;
      const wake = this.pos.clone().setY(this.pos.y - def.hover * 0.5);
      if (this.board.waterY !== undefined && this.pos.y - def.hover <= this.board.waterY + 0.1) {
        game.particles.splash(wake.setY(this.board.waterY), 3);
      } else {
        game.particles.runDust(wake);
      }
    }

    // safety: past the bottom of the world the ride is simply gone
    if (this.pos.y < game.board.physics.killY) { this.destroy(!def.living); return speed; }

    this.syncMesh(dt, speed, game);
    return speed;
  }

  /**
   * Ramming: the vehicle is the weapon. Whose weapon is the one thing the
   * driver decides — a player's hull bowls hostiles over, a hostile's hull is
   * aimed at the party.
   */
  private ram(speed: number, charging: boolean, rider: Player | null, game: Game): void {
    const def = this.def;
    // ---- ramming: the vehicle is the weapon ----
    // Whose weapon is the one thing the driver decides: a player's hull bowls
    // hostiles over, a hostile's hull is what a bantha with a Tusken on it is
    // *for*, and the party on foot is what it is aimed at.
    if (speed <= 6) return;
    {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const half = def.length / 2;
      const slot = rider ? rider.slot : -1;
      const marks: readonly (Player | Enemy)[] = rider ? game.enemies : _rammable;
      if (!rider) {
        _rammable.length = 0;
        for (const p of game.players) _rammable.push(p);
        for (const a of game.allies) _rammable.push(a);
      }
      for (const e of marks) {
        if (!e.alive) continue;
        if (Math.abs(e.position.y - this.pos.y) > 2.4) continue;
        // K3 lane: two rides running side by side meet hull to hull (the mass
        // rule in `collideVehicles`), not hull to rider — a biker alongside is
        // for swinging at, not for bowling out of the saddle by brushing past
        if (this.lane && ('characterId' in e ? !!e.vehicle : !!e.ride)) continue;
        // nearest point on the hull's axis, so a long skiff hits with its bow
        const relX = e.position.x - this.pos.x, relZ = e.position.z - this.pos.z;
        const along = Math.max(-half, Math.min(half, relX * sin + relZ * cos));
        _ramPoint.set(this.pos.x + sin * along, this.pos.y, this.pos.z + cos * along);
        const d = Math.hypot(e.position.x - _ramPoint.x, e.position.z - _ramPoint.z);
        if (d > def.radius + e.radius + 0.35) continue;
        const until = this.ramMemo.get(e) ?? 0;
        if (game.time < until) continue;
        this.ramMemo.set(e, game.time + 0.5);
        // horns first: a charge lands better than twice what a shoulder does
        const dmg = Math.min(charging ? 120 : 48, speed * (charging ? 5 : 2.1));
        const wasAlive = e.alive;
        const shove = Math.min(charging ? 30 : 20, speed * (charging ? 1.6 : 0.9));
        if ('knockback' in e) {
          e.damage(dmg, this.pos, slot);
          e.knockback(this.pos, shove, 0.5, 0.3);
          e.knockdown((charging ? 2 : 1.2) + Math.random() * 0.6);
        } else {
          // a player: the hit is telegraphed by two tonnes of animal, so it
          // is never shrugged off by the hit guard, and it throws them
          e.damage(dmg, this.pos, slot, { heavy: true });
          applyKnockback(e.velocity, e.position, this.pos, shove, shove * 0.4, true);
          e.cam.shake(0.25);
        }
        game.particles.impactSparks(e.position.clone().setY(e.position.y + 1), 10);
        audio.impact();
        rider?.cam.shake(0.09);
        if (wasAlive && rider) game.hitMarker(rider.slot);
        // every body struck chips the ride — nothing is free, and the
        // deflector does not make it free either (see `DamageKind`) — though
        // an animal that meant to do it comes off better than one that did not
        this.damage(charging ? 1 : 3, e.position, -1, 'contact');
        if (!this.alive) return;
      }
    }

  }

  /**
   * What a ridden animal sounds like: a footfall every stride on the board's
   * own surface — paced off ground covered, so it slows with the beast rather
   * than running on a clock — and a low every so often under the ride.
   */
  private mountVoice(dt: number, speed: number): void {
    this.strideLeft -= speed * dt;
    if (this.strideLeft <= 0) {
      // four feet, so two footfalls to the stride the clip plays
      this.strideLeft = BANTHA_STRIDE / 2;
      audio.footstep(this.board.footstep);
    }
    this.lowIn -= dt;
    if (this.lowIn <= 0) {
      this.lowIn = 9 + Math.random() * 12;
      audio.banthaLow(0.3);
    }
  }

  /**
   * Blend the mount's gait by how fast it is actually travelling, and play the
   * walk at the rate that keeps its feet on the ground it is covering.
   */
  private updateGait(dt: number, speed: number): void {
    if (!this.mixer) return;
    const moving = Math.min(1, speed / 1.2);
    this.idleAction?.setEffectiveWeight(1 - moving);
    if (this.walkAction) {
      this.walkAction.setEffectiveWeight(moving);
      this.walkAction.timeScale = clamp(speed / Math.max(this.walkStride, 0.1), 0.25, 2.4);
    }
    this.mixer.update(dt);
    this.saddle?.update();
  }

  /**
   * Ride height, and the one thing that suspends it.
   *
   * Normally the keel is sprung toward `hover` metres over whatever is under
   * it — ground or water, whichever is higher — which is why a repulsor rides
   * the swell and cannot be flown. A **hop** takes the spring out for the
   * length of its arc: while the ride is still climbing, or still above ride
   * height, it simply falls at `HOP_GRAVITY`, and the moment it is back down
   * the repulsors catch it again. `HOP_TIME` is the ceiling on that, not its
   * length — an arc off a ledge ends when the ground comes back, not on a
   * clock.
   */
  private applyHover(dt: number): void {
    const target = this.groundAt(this.pos.x, this.pos.z) + this.def.hover;
    if (this.hopT > 0 && (this.vel.y > 0 || this.pos.y > target + HOP_CATCH)) {
      this.vel.y -= HOP_GRAVITY * dt;
      return;
    }
    // K3 lane: over a drop deeper than the repulsors reach, it flies it
    if (this.lane && this.pos.y > target + LANE_REACH) {
      this.vel.y -= HOP_GRAVITY * dt;
      return;
    }
    this.hopT = 0;
    this.vel.y += ((target - this.pos.y) * 26 - this.vel.y * 7.5) * dt;
  }

  /**
   * Putting it into a wall.
   *
   * For the big rides this is the whole of their damage model: `crashScale`
   * turns the speed the impact took away into hit points, and the heavier the
   * ride the more brutally that trades — a skiff that shrugs off a firefight
   * loses a tenth of itself every time it fetches up against a bulkhead. The
   * grace window is there so a collision with another ride, which has already
   * been billed properly on both sides, is not charged twice as a wall.
   */
  private crashIntoWall(lost: number, game: Game, rider: Player | null): void {
    if (lost <= CRASH_MIN || this.crashGrace > 0) return;
    this.damage(lost * this.def.crashScale, this.pos, -1, 'crash');
    game.particles.impactSparks(this.pos.clone().setY(this.pos.y + 0.6), 12);
    audio.land(true);
    rider?.cam.shake(Math.min(0.3, lost * 0.012));
  }

  /**
   * Two rides meeting.
   *
   * The closing speed along the line between them is the impact, and mass
   * decides who wears it: a swoop into the flank of a cargo skiff is a swoop
   * folded around a skiff that barely notices, and the same crash from the
   * skiff's point of view is a bump. Both sides are billed from the one event
   * — as crash damage, which is what the armoured hulls are vulnerable to —
   * and both are shoved apart so they do not sit inside one another grinding.
   *
   * Returns true when a collision was billed this frame, so the caller can
   * keep the wall path from charging for the same impact.
   */
  private collideVehicles(game: Game): boolean {
    if (!this.alive) return false;
    let hit = false;
    for (const other of game.vehicles) {
      if (other === this || !other.alive) continue;
      const dx = other.pos.x - this.pos.x, dz = other.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-4) continue;
      const ux = dx / d, uz = dz / d;
      // How much hull each of them has facing the other: the support width of
      // the oriented box, which is the same shape `park` registers with the
      // physics world. Measured any coarser and a ride bounces off a parked
      // hull's collision box before this ever sees the two of them touch.
      if (d > this.extentToward(ux, uz) + other.extentToward(ux, uz) + 0.6) continue;
      if (Math.abs(other.pos.y - this.pos.y) > this.def.body + other.def.body) continue;
      // closing speed along the line between the two hulls
      const closing = (this.vel.x - other.vel.x) * ux + (this.vel.z - other.vel.z) * uz;
      if (closing < VEHICLE_CRASH_MIN) continue;
      const until = this.hitMemo.get(other) ?? 0;
      if (game.time < until) continue;
      this.hitMemo.set(other, game.time + 0.5);
      other.hitMemo.set(this, game.time + 0.5);

      // Mass shares the impact, and each hull pays at its own crash rate. What
      // that works out to is the thing you would expect: the swoop is folded
      // around the skiff and the skiff needs the paint touching up.
      const total = this.def.mass + other.def.mass;
      this.damage(closing * this.def.crashScale * (other.def.mass / total) * 1.6, other.pos, -1, 'crash');
      other.damage(closing * other.def.crashScale * (this.def.mass / total) * 1.6, this.pos, -1, 'crash');

      // and they bounce apart, again by mass
      const push = closing * 1.1;
      this.vel.x -= ux * push * (other.def.mass / total);
      this.vel.z -= uz * push * (other.def.mass / total);
      other.vel.x += ux * push * (this.def.mass / total);
      other.vel.z += uz * push * (this.def.mass / total);
      if (other.parkedBox) {
        // a parked ride that has just been hit is rolling now, not parked
        other.unpark();
        other.coasting = true;
      }
      game.particles.impactSparks(
        new THREE.Vector3(this.pos.x + ux * d * 0.5, this.pos.y + 0.6, this.pos.z + uz * d * 0.5), 16,
      );
      audio.impact();
      this.rider?.cam.shake(Math.min(0.35, closing * 0.014));
      other.rider?.cam.shake(Math.min(0.35, closing * 0.014));
      hit = true;
      if (!this.alive) break;
    }
    return hit;
  }

  /**
   * Half the hull's width in a given direction — the support width of the
   * oriented box `park` uses, so a nose-on meeting measures the length and a
   * flank measures the beam.
   */
  private extentToward(ux: number, uz: number): number {
    const nx = Math.sin(this.yaw), nz = Math.cos(this.yaw);
    // the footprint `park` registers — the sculpt's where it has landed. These
    // two have to be the same shape or a ride is bounced off a parked hull's
    // collider from outside the distance this counts as a collision, and two
    // rides can never meet at all.
    const hz = this.foot?.z ?? this.def.length / 2;
    const hx = this.foot?.x ?? this.def.radius;
    return Math.abs(ux * nx + uz * nz) * hz + Math.abs(ux * nz - uz * nx) * hx;
  }

  private syncMesh(dt: number, speed: number, game: Game): void {
    this.group.position.copy(this.pos);
    if (this.def.turret) {
      // the ring stays where it was bolted; the gun turns and pitches on it
      this.group.rotation.y = this.baseYaw;
      if (this.yawNode) this.yawNode.rotation.y = this.yaw - this.baseYaw;
      if (this.pitchNode) this.pitchNode.rotation.x = -this.aimPitch;
      this.updateShield(dt, game.time);
      return;
    }
    this.group.rotation.y = this.yaw;
    // Bank into the turn — both the slide the tail is carrying and the steering
    // itself, so a ride leans as it is asked to turn rather than only once it
    // has started sliding. Nose down a touch with descent.
    const latX = Math.cos(this.yaw), latZ = -Math.sin(this.yaw);
    const lateral = (this.vel.x * latX + this.vel.z * latZ) / Math.max(1, this.def.top);
    // A mount leans a fraction of what a repulsor does — its own gait clip
    // carries the roll, and a bantha banked like a swoop reads as a toy.
    const bank = this.def.living ? 0.25 : 1;
    const lean = (-lateral * 0.4 - this.steer * 0.3 * Math.min(1, speed / (this.def.top * 0.5))) * bank;
    this.body.rotation.z = damp(this.body.rotation.z, lean, 8, dt);
    this.body.rotation.x = damp(this.body.rotation.x, (-this.vel.y * 0.02 + speed * 0.004) * bank, 8, dt);
    this.updateShield(dt, game.time);
    this.updateGait(dt, speed);
  }

  /**
   * The deflector, as a thing on screen.
   *
   * The field is built the first time one is actually raised rather than with
   * the ride: most hulls on a board are never mounted, let alone shielded, and
   * a shader and two meshes apiece for six parked rides is a cost for nothing.
   * Once built it stays — a rider who shields once will shield again.
   */
  private updateShield(dt: number, time: number): void {
    const want = this.shieldWanted && this.alive && this.rider ? 1 : 0;
    this.shieldRaise = damp(this.shieldRaise, want, 14, dt);
    if (!this.shieldField) {
      if (this.shieldRaise < 0.02) return;
      this.shieldField = createShieldField({ radius: this.shieldRadius });
      this.shieldField.root.position.y = this.shieldY;
      this.group.add(this.shieldField.root);
    }
    this.shieldField.setStrength(this.shieldRaise);
    this.shieldField.update(dt, time);
  }
}

/** Spawn every vehicle a board declares; the game owns the entities. */
export function spawnVehicles(board: Board, scene: THREE.Scene): Vehicle[] {
  const out: Vehicle[] = [];
  for (const spec of board.vehicles ?? []) {
    const v = new Vehicle(spec, board);
    scene.add(v.group);
    out.push(v);
  }
  return out;
}

// ---------- the body: the sculpt, standing on its low-LOD build until it lands ----------

function mat(color: number, rough = 0.6, metal = 0.35): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function addCyl(parent: THREE.Object3D, m: THREE.Material, r1: number, r2: number, len: number, x: number, y: number, z: number, rx: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 8), m);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function addBox(parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * The hands, from the seat: the def's, or the workbench's grip anchor turned
 * into the same seat-relative offset (the left hand's; the right mirrors it).
 */
/** how far a ride's sculpt is turned on its keel: the def's own turn, plus any the anchors add (radians) */
export const modelTurn = (kind: VehicleSpec['kind']): number =>
  (VEHICLE_DEFS[kind].modelYaw ?? 0) + THREE.MathUtils.degToRad(VEHICLE_ANCHORS[kind]?.modelYaw ?? 0);

/**
 * The back of a walking mount. The saddle is laid on the sculpt at rest, but
 * the gait moves the animal under it — the back rises and falls with each
 * step and rolls over each planted foot — so a rider pinned to the frame
 * floats still while the bantha walks beneath him.
 *
 * What carries the saddle is the skin under it, and that skin is carried by
 * whichever bones its weights name — not necessarily the bone nearest the
 * seat (on the bantha that is a mid-back vertebra the walk hardly moves, while
 * the saddle's skin is weighted back toward the hips, which do). So this reads
 * the skin: the vertices within reach of the seat, the bones they are weighted
 * to and by how much, and it carries the seat on that same blend — as if it
 * were one more vertex of the saddle. `shift` is how far that has moved it
 * from rest, in the ride's frame.
 */
export class SaddleBone {
  private holds: Array<{ bone: THREE.Object3D; onBone: THREE.Vector3; weight: number }> = [];
  private rest = new THREE.Vector3();
  /** how far the back has moved the seat from rest, in the ride's frame (m) */
  readonly shift = new THREE.Vector3();

  constructor(model: THREE.Object3D, private frame: THREE.Object3D, seat: THREE.Vector3) {
    model.updateMatrixWorld(true);
    frame.updateMatrixWorld(true);
    const seatWorld = frame.localToWorld(seat.clone());
    const weights = new Map<THREE.Object3D, number>();
    const v = new THREE.Vector3();
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.geometry.attributes.skinIndex) return;
      const idx = mesh.geometry.attributes.skinIndex, wt = mesh.geometry.attributes.skinWeight;
      const count = mesh.geometry.attributes.position.count;
      for (let i = 0; i < count; i++) {
        mesh.localToWorld(mesh.getVertexPosition(i, v));
        const d = v.distanceTo(seatWorld);
        if (d > 0.45) continue;
        // nearer skin counts for more
        const near = 1 - d / 0.45;
        for (let k = 0; k < idx.itemSize; k++) {
          const w = wt.getComponent(i, k) * near;
          const bone = mesh.skeleton.bones[idx.getComponent(i, k)];
          if (w > 0 && bone) weights.set(bone, (weights.get(bone) ?? 0) + w);
        }
      }
    });
    const total = [...weights.values()].reduce((a, b) => a + b, 0);
    if (!total) return;
    this.rest.copy(seat);
    for (const [bone, w] of weights) {
      if (w / total < 0.02) continue;
      this.holds.push({ bone, weight: w, onBone: bone.worldToLocal(seatWorld.clone()) });
    }
    const kept = this.holds.reduce((a, h) => a + h.weight, 0);
    for (const h of this.holds) h.weight /= kept;
  }

  /** read the back after the gait has posed it */
  update(): void {
    if (!this.holds.length) return;
    this.frame.updateWorldMatrix(true, false);
    this.shift.set(0, 0, 0);
    for (const h of this.holds) {
      h.bone.updateWorldMatrix(true, false);
      this.shift.addScaledVector(h.bone.localToWorld(_held.copy(h.onBone)), h.weight);
    }
    this.frame.worldToLocal(this.shift).sub(this.rest);
  }
}
const _held = new THREE.Vector3();

/**
 * How far over the keel a ride's sculpt hangs: a grounded one stands on it,
 * the rest hang off their own origin a third of the body up. Anything else
 * that carries the same sculpt in a frame of its own (the Nikto's swoop)
 * lifts an anchor out of the ride's frame by this.
 */
export const sculptLift = (def: VehicleDef): number => (def.modelGround ? 0 : def.body * 0.35);

export function handsFor(def: VehicleDef, anchor: VehicleAnchor | null): VehicleDef['hands'] {
  if (!anchor) return def.hands;
  return {
    x: anchor.grip[0] - anchor.seat[0], y: anchor.grip[1] - anchor.seat[1], z: anchor.grip[2] - anchor.seat[2],
    only: def.hands?.only,
  };
}

/**
 * The height of the surface a ride's sculpt offers at its seat, over the keel.
 *
 * A grid over the seat's footprint, not one ray down its middle. A single ray
 * takes the *topmost* thing in the column, and on a speeder that is the
 * headrest — which is how a droid ended up perched on the back of the seat
 * instead of sitting in it. `seatSurface` takes the surface most of the
 * footprint lands on instead, which is the cushion.
 *
 * @param frame the ride's own frame — its origin is the keel, its yaw the ride's
 */
export function measureSeatSurface(kind: VehicleSpec['kind'], root: THREE.Object3D, frame: THREE.Object3D,
  seat: { x: number; z: number } = VEHICLE_DEFS[kind].seat): number | null {
  const def = VEHICLE_DEFS[kind];
  // the raycaster works in world space, so the column is the seat's world column
  frame.updateMatrixWorld(true);
  frame.localToWorld(_seatFrom.set(seat.x, def.body + 3, seat.z));
  const origin = frame.localToWorld(new THREE.Vector3());
  frame.localToWorld(_fwd.set(0, 0, 1)).sub(origin).normalize();
  frame.localToWorld(_right.set(1, 0, 0)).sub(origin).normalize();
  const world = seatSurface(root, _seatFrom, _fwd, _right, def.body + 6);
  if (world === null) return null;
  return frame.worldToLocal(new THREE.Vector3(_seatFrom.x, world, _seatFrom.z)).y;
}

/**
 * Where the rider sits, over the keel, given the surface under the seat.
 *
 * The saddle is ours, not the sculpt's: sit it on the back the model actually
 * has, so a mount reads as ridden whichever build is showing — and then the
 * rider sits on the *saddle*, not on the animal under it, which is a hand's
 * depth of leather the measurement cannot see. A hand-placed seat anchor is
 * the sitting point itself, and the saddle is put under it.
 */
export function sitOnModel(body: THREE.Object3D, surface: number | undefined, anchor: VehicleAnchor | null): number {
  const saddle = body.getObjectByName('saddle');
  if (anchor) {
    if (saddle) saddle.position.y = anchor.seat[1] - SADDLE_PAD;
    return anchor.seat[1];
  }
  const top = surface ?? 0;
  if (!saddle) return top;
  saddle.position.y = top - SADDLE_SINK;
  return top - SADDLE_SINK + SADDLE_PAD;
}

/** the stance's rise for a canonical rider: how far its root sits under the seat surface */
export const riderRise = (stance: VehicleDef['stance'], hips = CANONICAL_HIPS): number => stanceRise(stance, hips);

/**
 * A ride's body, built around the keel origin (+Z forward): the kind's
 * authored .glb through `loadProp`, which stands the sculpt's own low-LOD build
 * (characters/lod.ts, measured off the same file at the same fit) in its place
 * until the file lands — the same swap the enemy swoop bike does.
 */
export function buildVehicleMesh(kind: VehicleSpec['kind'], group: THREE.Group, onModel?: (root: THREE.Object3D) => void,
  onSettle?: () => void, onStandIn?: (root: THREE.Object3D) => void): { yaw: THREE.Object3D | null; pitch: THREE.Object3D | null } {
  const def = VEHICLE_DEFS[kind];
  // the few meshes still built by hand (the turret, until a sculpt of it
  // lands), hidden the moment one does; the rides' stand-ins are low-LOD builds
  const built: THREE.Mesh[] = [];
  const track = (m: THREE.Mesh): THREE.Mesh => { built.push(m); return m; };
  const dark = mat(0x2c2f33, 0.7, 0.4);
  const parts: { yaw: THREE.Object3D | null; pitch: THREE.Object3D | null } = { yaw: null, pitch: null };
  if (kind === 'turret') {
    // K3's quad gun, to the `quad_turret` spec (ASSETS_MODELS.md): a base
    // ring, a `yaw` node that turns on it with the seat and the shield, and a
    // `pitch` node — the barrel block, pivoting at the trunnion — with four
    // barrels. The gun's own nodes are what the game drives, stand-in or sculpt.
    const iron = mat(0x4b4f52, 0.55, 0.6);
    const olive = mat(0x5d5a44, 0.7, 0.35);
    track(addCyl(group, iron, 1.35, 1.5, 0.5, 0, 0.25, 0, 0));
    const yaw = new THREE.Group();
    yaw.name = 'yaw';
    group.add(yaw);
    track(addCyl(yaw, dark, 0.9, 1.0, 0.45, 0, 0.72, 0, 0));
    track(addBox(yaw, olive, 0.42, 1.0, 0.42, 0.62, 1.25, 0.1));      // trunnion cheeks
    track(addBox(yaw, olive, 0.42, 1.0, 0.42, -0.62, 1.25, 0.1));
    track(addBox(yaw, dark, 0.75, 0.12, 0.7, 0, 0.62, -1.0));         // the seat
    track(addBox(yaw, dark, 0.75, 0.7, 0.1, 0, 0.95, -1.35));
    track(addBox(yaw, olive, 2.0, 1.1, 0.08, 0, 1.75, 0.55));         // the gunner's shield
    const pitch = new THREE.Group();
    pitch.name = 'pitch';
    pitch.position.set(0, def.turret?.pivot ?? 1.55, 0);
    yaw.add(pitch);
    track(addBox(pitch, iron, 0.9, 0.6, 1.0, 0, 0.02, 0.3));          // breech block
    for (const [bx, by] of [[0.32, 0.17], [-0.32, 0.17], [0.32, -0.13], [-0.32, -0.13]]) {
      track(addCyl(pitch, dark, 0.07, 0.09, 1.7, bx, by, 1.3, Math.PI / 2));
    }
    parts.yaw = yaw;
    parts.pitch = pitch;
  } else if (kind === 'bantha') {
    // The saddle is the ride's own dressing, not the sculpt's: it stays on
    // when the authored bantha lands, and `seatToModel` drops it onto the back
    // that model actually has.
    const saddle = new THREE.Group();
    saddle.name = 'saddle';
    saddle.position.y = 3.2;
    const cloth = mat(0x8c3f2e, 0.95, 0);
    addBox(saddle, cloth, 1.15, 0.07, 1.5, 0, 0, -0.1);
    const leather = mat(0x4a3524, 0.9, 0.05);
    addBox(saddle, leather, 0.85, 0.12, 0.85, 0, 0.07, -0.2);
    addBox(saddle, leather, 0.42, 0.2, 0.12, 0, 0.16, 0.25);     // pommel
    for (const sx of [-1, 1]) addBox(saddle, leather, 0.06, 0.5, 0.3, sx * 0.62, -0.2, -0.2); // stirrup straps
    saddle.traverse((o) => { o.castShadow = true; });
    group.add(saddle);
  }
  if (def.modelId) {
    propsUsed.add(def.modelId);   // a parked ride is part of the board's art
    const model = loadProp(def.modelId, def.modelSize ?? def.length, {
      axis: def.modelAxis,
      ground: def.modelGround,
      lod: true,
      onLoad: (root) => { for (const m of built) m.visible = false; onModel?.(root); },
      onSettle,
    });
    // a grounded sculpt stands on the keel; the rest hang off their own origin
    model.position.y = sculptLift(def);
    model.rotation.y = modelTurn(kind);
    group.add(model);
    // Still loading: the stand-in is what shows, and it is only now in the
    // ride's frame, so only now can anything be measured off it. (A sculpt
    // already in the cache has landed by here and taken the stand-in away.)
    const standIn = model.getObjectByName('lodProp');
    if (standIn) onStandIn?.(standIn);
  } else onSettle?.();
  return parts;
}
