import { TEXT } from '../text';
import * as THREE from 'three';
import type { Game } from './game';
import type { Player } from '../player/player';
import type { Board, VehicleSpec } from '../world/board';
import type { FrameInput } from '../core/input';
import type { StaticBox } from '../core/physics';
import { loadProp } from '../characters/authored';
import { propsUsed } from '../world/props';
import { crateTexture, hullTexture } from '../core/assets';
import { audio } from '../core/audio';
import { clamp, damp, dampAngle } from '../core/math';
import { BANTHA_STRIDE } from '../anim/quadruped';
import { seatSurface } from '../anim/seating';

/**
 * Pilotable vehicles (PLAN.md §17): rides with hit points parked around the
 * boards. RB near one mounts, the stick drives it camera-relative with real
 * momentum, ramming is the weapon, and sooner or later it is shot out from
 * under you or you put it into a wall — then the rider is thrown, the wreck
 * goes up at the size of the hull that made it, and twenty seconds later the
 * ride is back where the board parked it. Not transport: a toy that ends in a
 * crash.
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
    // Astern of the cargo on the flat of the deck (0.13 over the keel on the
    // sculpt) rather than out on the stern, where the hull falls away and a
    // tillerman stood on nothing.
    seat: { x: 0, y: 0.8, z: -1.6 }, stance: 'stand',
    modelId: 'skiff', modelSize: 9,
  },
};

/** a mount's charge: how long the horns are down, and the wait before another */
const CHARGE_TIME = 1.5;
const CHARGE_COOLDOWN = 5;
/** what the charge is worth as a multiple of the animal's own top speed */
const CHARGE_TOP = 1.75;

/** What hurt the ride: a shot is armoured against, a crash is not. */
export type DamageKind = 'shot' | 'crash';

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

/**
 * How far a rider's root (its feet, on the canonical rig) sits below the
 * surface it is carried on. A straddled saddle takes the weight on the thighs
 * and carries the hips a hand's width proud of it; a seat takes it on the
 * backside, so the hips sit almost on the cushion; a deck takes the feet.
 */
const STANCE_RISE: Record<VehicleDef['stance'], number> = { saddle: 0.85, seated: 0.93, stand: 0 };
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

const _ramPoint = new THREE.Vector3();
const _seatFrom = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

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
  group = new THREE.Group();
  /** who shot it last, for kill credit on the explosion */
  lastHitBy = -1;
  private body = new THREE.Group();
  private parkedBox: StaticBox | null = null;
  private bobPhase = Math.random() * Math.PI * 2;
  private boostCd = 0;
  /** last frame's steering input, for the visual bank into a turn */
  private steer = 0;
  /**
   * Height of the rider's root above the keel. Starts at the def's value,
   * which is tuned to the procedural stand-in, and is re-measured off the
   * authored sculpt the moment one lands — see `seatToModel`.
   */
  private seatY: number;
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

  constructor(public spec: VehicleSpec, private board: Board) {
    this.def = VEHICLE_DEFS[spec.kind];
    this.hp = this.maxHp = this.def.hp;
    this.yaw = spec.yaw ?? 0;
    // `y` is the deck it was parked on (a mission level's plate); without it
    // the search starts from the terrain, which on a mission board is ninety
    // metres under the floor the ride is standing on.
    if (spec.y !== undefined) this.pos.y = spec.y + this.def.hover;
    const ground = spec.y ?? this.groundAt(spec.x, spec.z);
    this.pos.set(spec.x, ground + this.def.hover, spec.z);
    this.seatY = this.def.seat.y;
    this.group.add(this.body);
    buildVehicleMesh(spec.kind, this.body, (root) => this.onModel(root));
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
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
    const s = Math.abs(Math.sin(this.yaw)), c = Math.abs(Math.cos(this.yaw));
    const w = s * this.def.length + c * this.def.radius * 2;
    const d = c * this.def.length + s * this.def.radius * 2;
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
    this.unpark();
    this.rider = rider;
    rider.vehicle = this;
    // a machine turns over; an animal complains about the weight
    if (this.def.living) audio.banthaLow(0.5);
    else audio.speederIgnite();
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
  dropRider(): void {
    const rider = this.rider;
    if (!rider) return;
    this.rider = null;
    rider.vehicle = null;
    audio.setEngine(rider.slot, 0);
    if (!this.alive) return;
    if (Math.hypot(this.vel.x, this.vel.z) > COAST_STOP) this.coasting = true;
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
    if (kind === 'shot') amount *= this.def.shotResist;
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
  private destroy(explode: boolean): void {
    if (!this.alive) return;
    this.alive = false;
    const at = this.pos.clone();
    const slot = this.rider?.slot ?? this.lastHitBy;
    if (this.rider) {
      const r = this.rider;
      this.dropRider();
      // thrown clear: the ride's momentum plus a kick up and out
      r.velocity.copy(this.vel);
      r.velocity.y = Math.max(r.velocity.y, 7.5);
      r.velocity.x += Math.sin(this.yaw + Math.PI / 2) * 3;
      r.velocity.z += Math.cos(this.yaw + Math.PI / 2) * 3;
      r.position.y += 0.6;
    }
    this.unpark();
    this.coasting = false;
    this.vel.set(0, 0, 0);
    this.respawnIn = RESPAWN_DELAY;
    if (explode) {
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
    if (this.rider) this.dropRider();
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
    this.dissolveT = 0;
    this.reformT = REFORM_TIME;
    this.hitMemo.clear();
    this.group.visible = true;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.body.position.y = 0;
    this.park();
    this.pendingReform = this.pos.clone();
  }

  /** true while the horns are down (drives the HUD's charge cue) */
  get charging(): boolean { return this.chargeT > 0; }
  /** true when the charge is off cooldown and can be asked for */
  get chargeReady(): boolean { return this.chargeCd <= 0 && this.chargeT <= 0; }

  /** World position of the rider's root while mounted. */
  seatWorld(out: THREE.Vector3): THREE.Vector3 {
    const s = this.def.seat;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    return out.set(
      this.pos.x + cos * s.x + sin * s.z,
      this.pos.y + this.seatY,
      this.pos.z - sin * s.x + cos * s.z,
    );
  }

  /** Everything that has to be measured off the sculpt, the moment it lands. */
  private onModel(root: THREE.Object3D): void {
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
  private seatToModel(root: THREE.Object3D): void {
    // The raycaster works in world space, so the column has to be the seat's
    // world column — the group carries the vehicle's yaw, and the sculpt hangs
    // under it.
    this.group.updateMatrixWorld(true);
    const s = this.def.seat;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    _seatFrom.set(
      this.pos.x + cos * s.x + sin * s.z,
      this.pos.y + this.def.body + 3,
      this.pos.z - sin * s.x + cos * s.z,
    );
    _fwd.set(sin, 0, cos);
    _right.set(cos, 0, -sin);
    // A grid over the seat's footprint, not one ray down its middle. A single
    // ray takes the *topmost* thing in the column, and on a speeder that is
    // the headrest — which is how a droid ended up perched on the back of the
    // seat instead of sitting in it. `seatSurface` takes the surface most of
    // the footprint lands on instead, which is the cushion. Once per kind:
    // see `seatByKind`.
    let surface = seatByKind.get(this.spec.kind);
    if (surface === undefined) {
      const world = seatSurface(root, _seatFrom, _fwd, _right, this.def.body + 6);
      if (world === null) return;           // nothing under the seat: keep the default
      surface = world - this.pos.y;
      // A sculpt that answers from somewhere the ride does not reach was
      // measured before it was placed (a cached model can land inside the
      // constructor). Use it for this instance, but do not teach it to the
      // rest of the session.
      if (Math.abs(surface) < this.def.body + 4) seatByKind.set(this.spec.kind, surface);
    }
    // The saddle is ours, not the sculpt's: sit it on the back the model
    // actually has, so a mount reads as ridden whichever build is showing —
    // and then the rider sits on the *saddle*, not on the animal under it,
    // which is a hand's depth of leather the measurement cannot see.
    const saddle = this.body.getObjectByName('saddle');
    let sit = surface;
    if (saddle) {
      saddle.position.y = surface - SADDLE_SINK;
      sit = surface - SADDLE_SINK + SADDLE_PAD;
    }
    this.seatY = sit - STANCE_RISE[this.def.stance];
  }

  /** the height of the surface being sat on, over the keel */
  private get seatTop(): number {
    return this.seatY + STANCE_RISE[this.def.stance];
  }

  /**
   * Where one hand goes, in world space — the grip on the far end of the
   * rider's reach. Measured off the seat surface, so it follows the sculpt
   * the seat was measured from.
   */
  gripWorld(side: -1 | 1, out: THREE.Vector3): THREE.Vector3 | null {
    const g = this.def.hands;
    if (!g) return null;
    const s = this.def.seat;
    const lx = s.x + side * g.x, lz = s.z + g.z;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    return out.set(
      this.pos.x + cos * lx + sin * lz,
      this.pos.y + this.seatTop + g.y,
      this.pos.z - sin * lx + cos * lz,
    );
  }

  /** Per-frame while parked; a ridden vehicle is driven from its rider instead. */
  update(dt: number, game: Game): void {
    if (this.reformT > 0) this.reformT = Math.max(0, this.reformT - dt);
    if (!this.alive) {
      this.updateWreck(dt, game);
      return;
    }
    if (this.rider) return;                 // driven from the rider's update
    if (this.coasting) {
      this.coast(dt, game);
      return;
    }
    // settle toward hover height and idle-bob gently inside the parked box
    const target = this.groundAt(this.pos.x, this.pos.z) + this.def.hover;
    this.pos.y = damp(this.pos.y, target, 4, dt) + Math.sin(game.time * 1.7 + this.bobPhase) * 0.004;
    this.syncMesh(dt, 0);
  }

  /**
   * A wreck: an animal coming apart, then the wait, then the ride again.
   *
   * The dissolve is the animal's alone — a machine has already gone up in the
   * blast — and it is the body sinking into the ground it died on while the
   * ash comes off it, so what is left after a second is sand.
   */
  private updateWreck(dt: number, game: Game): void {
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
    const target = this.groundAt(this.pos.x, this.pos.z) + def.hover;
    this.vel.y += ((target - this.pos.y) * 26 - this.vel.y * 7.5) * dt;

    this.crashGrace -= dt;
    const hitRide = this.collideVehicles(game);
    const before = Math.hypot(this.vel.x, this.vel.z);
    game.board.physics.moveCapsule(this.pos, def.radius, def.body, this.vel, dt);
    const after = Math.hypot(this.vel.x, this.vel.z);
    this.crashIntoWall(before - after, game, null);
    if (hitRide) this.crashGrace = 0.25;

    if (this.pos.y < game.board.physics.killY) { this.destroy(!def.living); return; }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < COAST_STOP) {
      // it has finished rolling: solid again, where it came to rest
      this.vel.set(0, 0, 0);
      this.coasting = false;
      this.park();
    }
    this.syncMesh(dt, speed);
  }

  /**
   * One frame of driving, called from the rider's update so input flows the
   * same path it does on foot.
   *
   * This is a vehicle, not a character: the stick does not point where to go,
   * it turns the nose, and speed comes off the pedals. So the state that
   * matters is the nose direction (`yaw`) plus how fast we are travelling
   * along it and how much we are sliding sideways — the slide is what gives a
   * hard turn its drift before the grip bites.
   */
  drive(dt: number, input: FrameInput, rider: Player, game: Game): void {
    const def = this.def;
    this.boostCd -= dt;

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
    }
    const charging = this.chargeT > 0;

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
    this.steer = input.moveX;
    // a charging animal is aimed before it is launched, not steered through
    this.yaw -= this.steer * def.turn * bite * (1 - 0.32 * fast) * (charging ? 0.4 : 1) * dt;

    // the nose, and the axis it slides along
    const nx = Math.sin(this.yaw), nz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let fwd = this.vel.x * nx + this.vel.z * nz;
    let lat = this.vel.x * rx + this.vel.z * rz;

    // ---- the pedals: A accelerates, B brakes and then reverses ----
    if (charging) {
      // the charge owns the legs: neither pedal is worth anything until it ends
      fwd = Math.min(def.top * CHARGE_TOP, fwd + def.throttle * 3 * dt);
    } else if (input.throttleHeld && !input.brakeHeld) {
      fwd = Math.min(def.top, fwd + def.throttle * dt);
    } else if (input.brakeHeld && !input.throttleHeld) {
      fwd = fwd > REVERSE_THRESHOLD
        ? Math.max(0, fwd - def.brake * dt)                                  // hauling it up
        : Math.max(-def.top * REVERSE_FRACTION, fwd - def.throttle * 0.6 * dt); // backing off
    } else {
      // coasting: repulsors bleed speed slowly, so momentum is worth carrying
      const bleed = def.drag * dt;
      fwd = fwd > 0 ? Math.max(0, fwd - bleed) : Math.min(0, fwd + bleed);
    }

    // boost: the dash button, a straight shove along the nose
    if (input.dashPressed && this.boostCd <= 0) {
      this.boostCd = 1.4;
      fwd = Math.min(def.top * 1.6, fwd + def.boost);
      // a mount does not have a thruster to fire: it is goaded into a charge
      if (def.living) audio.banthaLow(0.45);
      else audio.dash();
      rider.cam.shake(0.05);
    }

    // grip bleeds the slide off; what is left is the drift through a turn
    lat = damp(lat, 0, def.grip, dt);
    this.vel.x = nx * fwd + rx * lat;
    this.vel.z = nz * fwd + rz * lat;

    // hover: spring the keel toward ride height over ground or water
    const target = this.groundAt(this.pos.x, this.pos.z) + def.hover;
    this.vel.y += ((target - this.pos.y) * 26 - this.vel.y * 7.5) * dt;

    // integrate against the world; a wall eats velocity, and a hard stop hurts
    this.crashGrace -= dt;
    const hitRide = this.collideVehicles(game);
    const before = Math.hypot(this.vel.x, this.vel.z);
    game.board.physics.moveCapsule(this.pos, def.radius, def.body, this.vel, dt);
    const after = Math.hypot(this.vel.x, this.vel.z);
    this.crashIntoWall(before - after, game, rider);
    if (hitRide) this.crashGrace = 0.25;

    const speed = Math.hypot(this.vel.x, this.vel.z);

    // The camera trails the nose while you drive, but only when you are not
    // working the right stick — steering is the heading now, so a camera left
    // pointing where you were is a camera you have to fight. It eases rather
    // than snaps, and it never fights a look the player is actually giving it.
    if (fwd > 2 && Math.abs(input.lookX) < 1e-4) {
      rider.cam.yaw = dampAngle(rider.cam.yaw, this.yaw, 2.0, dt);
    }

    // ---- ramming: the vehicle is the weapon ----
    if (speed > 6) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const half = def.length / 2;
      for (const e of game.enemies) {
        if (!e.alive) continue;
        if (Math.abs(e.position.y - this.pos.y) > 2.4) continue;
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
        e.damage(dmg, this.pos, rider.slot);
        e.knockback(this.pos, Math.min(charging ? 30 : 20, speed * (charging ? 1.6 : 0.9)), 0.5, 0.3);
        e.knockdown((charging ? 2 : 1.2) + Math.random() * 0.6);
        game.particles.impactSparks(e.position.clone().setY(e.position.y + 1), 10);
        audio.impact();
        rider.cam.shake(0.09);
        if (wasAlive) game.hitMarker(rider.slot);
        // every body struck chips the ride — nothing is free, though an
        // animal that meant to do it comes off better than one that did not
        this.damage(charging ? 1 : 3, e.position, -1);
        if (!this.alive) break;
      }
    }

    // engine leans with the throttle; dust or spray kicks up in the wake
    if (def.living) this.mountVoice(dt, speed);
    else audio.setEngine(rider.slot, 0.35 + (speed / def.top) * 0.85);
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
    if (this.pos.y < game.board.physics.killY) this.destroy(false);

    this.syncMesh(dt, speed);
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
    return Math.abs(ux * nx + uz * nz) * this.def.length / 2
      + Math.abs(ux * nz - uz * nx) * this.def.radius;
  }

  private syncMesh(dt: number, speed: number): void {
    this.group.position.copy(this.pos);
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
    this.updateGait(dt, speed);
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

// ---------- procedural builds (hidden when the authored model lands) ----------

function mat(color: number, rough = 0.6, metal = 0.35): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function addBox(parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCyl(parent: THREE.Object3D, m: THREE.Material, r1: number, r2: number, len: number, x: number, y: number, z: number, rx: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 8), m);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * The stand-in geometry per kind, built around the keel origin (+Z forward).
 * When the kind's authored .glb exists it loads through `loadProp` and the
 * procedural meshes hide — the same swap the enemy swoop bike already does.
 */
function buildVehicleMesh(kind: VehicleSpec['kind'], group: THREE.Group, onModel?: (root: THREE.Object3D) => void): void {
  const def = VEHICLE_DEFS[kind];
  const built: THREE.Mesh[] = [];
  const track = (m: THREE.Mesh): THREE.Mesh => { built.push(m); return m; };
  const dark = mat(0x2c2f33, 0.7, 0.4);
  if (kind === 'swoop') {
    const body = mat(0x8a4b2f, 0.5, 0.5);
    track(addBox(group, body, 0.36, 0.26, 1.8, 0, 0.4, 0.1));
    track(addCyl(group, dark, 0.11, 0.15, 0.4, 0, 0.4, -0.85, Math.PI / 2));
    track(addCyl(group, body, 0.05, 0.1, 0.75, 0, 0.38, 1.2, Math.PI / 2));
    track(addBox(group, dark, 0.55, 0.04, 0.04, 0, 0.62, 0.55));
  } else if (kind === 'speederBike') {
    const body = mat(0x6a6f62, 0.55, 0.4);
    track(addBox(group, body, 0.34, 0.3, 1.5, 0, 0.5, -0.4));        // saddle + engine
    track(addCyl(group, body, 0.06, 0.06, 1.6, 0.14, 0.42, 0.9, Math.PI / 2)); // outrigger vanes
    track(addCyl(group, body, 0.06, 0.06, 1.6, -0.14, 0.42, 0.9, Math.PI / 2));
    track(addBox(group, dark, 0.5, 0.05, 0.05, 0, 0.68, 0.15));      // bars
    track(addBox(group, dark, 0.3, 0.35, 0.15, 0, 0.35, 1.55));      // steering fin
  } else if (kind === 'landspeeder') {
    const body = mat(0xb0a070, 0.5, 0.45);
    const hull = track(addBox(group, body, 1.8, 0.42, 3.9, 0, 0.42, 0));
    hull.receiveShadow = true;
    track(addBox(group, dark, 0.72, 0.1, 0.72, 0, 0.66, -0.45));      // seat cushion
    track(addBox(group, dark, 0.8, 0.34, 0.14, 0, 0.85, -0.95));      // seat back
    for (const sx of [-0.62, 0, 0.62]) track(addCyl(group, dark, 0.2, 0.24, 0.6, sx, 0.55, -1.95, Math.PI / 2));
    const shield = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.32),
      new THREE.MeshStandardMaterial({ color: 0xcfe4ea, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    shield.position.set(0, 0.78, 0.35);
    shield.rotation.x = -0.35;
    group.add(shield);
    built.push(shield as unknown as THREE.Mesh);
  } else if (kind === 'bantha') {
    // The camp's mount: the same stand-in the Tusken herd is built from
    // (world/tatooine.ts) so a saddled bantha and a grazing one read as the
    // same animal, plus the woven saddle that says this one is broken to ride.
    const hide = mat(0x5a4632, 1, 0);
    const horn = mat(0xb8a888, 0.8, 0);
    const barrel = track(new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 9), hide));
    barrel.scale.set(1, 1.05, 1.9);
    barrel.position.y = 1.9;
    barrel.castShadow = true;
    group.add(barrel);
    const skull = track(new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), hide));
    skull.position.set(0, 1.6, 2.7);
    skull.castShadow = true;
    group.add(skull);
    for (const sx of [-1, 1]) {
      const spiral = track(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.13, 6, 10, Math.PI * 1.3), horn));
      spiral.position.set(sx * 0.55, 2.1, 2.7);
      spiral.rotation.set(Math.PI / 2, 0, sx * 0.6);
      spiral.castShadow = true;
      group.add(spiral);
      for (const sz of [-1, 1]) track(addCyl(group, hide, 0.28, 0.34, 1.5, sx * 0.8, 0.75, sz * 1.1, 0));
    }
    // The saddle is the ride's own dressing, not the sculpt's, so it is *not*
    // tracked: it stays on when the authored bantha lands, and `seatToModel`
    // drops it onto the back that model actually has.
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
  } else {
    // skiff: flat working deck, low rails, tiller platform astern, lashed cargo
    const hullMat2 = new THREE.MeshStandardMaterial({ map: hullTexture(), color: 0xa08a60, roughness: 0.65, metalness: 0.35 });
    const deck = track(addBox(group, hullMat2, 3, 0.5, 8.6, 0, 0.55, 0));
    deck.receiveShadow = true;
    for (const sx of [-1.45, 1.45]) track(addBox(group, dark, 0.08, 0.35, 8.2, sx, 0.95, 0));
    track(addBox(group, hullMat2, 1.4, 0.3, 1.2, 0, 0.9, -3.4));     // tiller platform
    track(addCyl(group, dark, 0.04, 0.04, 1.1, 0.5, 1.5, -3.6, 0.3)); // tiller
    const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.8 });
    track(addBox(group, crateMat, 1.1, 1.1, 1.1, -0.6, 1.35, 2.9));
    track(addBox(group, crateMat, 0.9, 0.9, 0.9, 0.7, 1.25, 3.2));
  }
  if (def.modelId) {
    propsUsed.add(def.modelId);   // a parked ride is part of the board's art
    const model = loadProp(def.modelId, def.modelSize ?? def.length, {
      axis: def.modelAxis,
      ground: def.modelGround,
      onLoad: (root) => { for (const m of built) m.visible = false; onModel?.(root); },
    });
    // a grounded sculpt stands on the keel; the rest hang off their own origin
    model.position.y = def.modelGround ? 0 : def.body * 0.35;
    group.add(model);
  }
}
