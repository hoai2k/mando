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

/**
 * Pilotable vehicles (PLAN.md §17): rides with hit points parked around the
 * boards. RB near one mounts, the stick drives it camera-relative with real
 * momentum, ramming is the weapon, and the hull soaks the fire aimed at the
 * rider until it gives out — then the rider is thrown and the wreck explodes.
 * Not transport: a toy that ends in a crash.
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
  /** saddle straddle or standing at a tiller */
  stance: 'saddle' | 'stand';
  /** authored .glb to swap in when present */
  modelId?: string;
  modelSize?: number;
}

export const VEHICLE_DEFS: Record<VehicleSpec['kind'], VehicleDef> = {
  swoop: {
    name: 'Swoop', hp: 100, top: 24, throttle: 15, brake: 24, drag: 4.5,
    turn: 2.3, grip: 4.5, boost: 9,
    radius: 0.85, body: 1.1, hover: 0.55, length: 2.8,
    seat: { x: 0, y: -0.38, z: -0.15 }, stance: 'saddle',
    modelId: 'nikto_swoop', modelSize: 2.6,
  },
  speederBike: {
    name: 'Speeder bike', hp: 90, top: 27, throttle: 18, brake: 22, drag: 4,
    turn: 2.6, grip: 3.8, boost: 10,
    radius: 0.8, body: 1.15, hover: 0.6, length: 3.0,
    seat: { x: 0, y: -0.34, z: -0.3 }, stance: 'saddle',
    modelId: 'speeder_bike', modelSize: 3.0,
  },
  landspeeder: {
    name: 'Landspeeder', hp: 150, top: 22, throttle: 11, brake: 18, drag: 3.5,
    turn: 1.7, grip: 5.5, boost: 8,
    radius: 1.15, body: 1.1, hover: 0.45, length: 4.4,
    seat: { x: 0, y: -0.32, z: -0.5 }, stance: 'saddle',
    modelId: 'landspeeder', modelSize: 4.5,
  },
  skiff: {
    name: 'Cargo skiff', hp: 220, top: 15, throttle: 6.5, brake: 10, drag: 2.4,
    turn: 1.0, grip: 6.5, boost: 6,
    radius: 1.7, body: 1.3, hover: 0.9, length: 9,
    seat: { x: 0, y: 1.05, z: -3.1 }, stance: 'stand',
    modelId: 'skiff', modelSize: 9,
  },
};

/** how much of top speed reverse is worth */
const REVERSE_FRACTION = 0.35;
/** below this forward speed the brake stops stopping and starts reversing */
const REVERSE_THRESHOLD = 0.4;

const _ramPoint = new THREE.Vector3();
const _seatRay = new THREE.Raycaster();
const _seatFrom = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

export class Vehicle {
  def: VehicleDef;
  /** the keel point: hovers `def.hover` over the ground */
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw: number;
  hp: number;
  maxHp: number;
  alive = true;
  removeMe = false;
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

  constructor(public spec: VehicleSpec, private board: Board) {
    this.def = VEHICLE_DEFS[spec.kind];
    this.hp = this.maxHp = this.def.hp;
    this.yaw = spec.yaw ?? 0;
    const ground = this.groundAt(spec.x, spec.z);
    this.pos.set(spec.x, ground + this.def.hover, spec.z);
    this.seatY = this.def.seat.y;
    this.group.add(this.body);
    buildVehicleMesh(spec.kind, this.body, (root) => this.seatToModel(root));
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
    audio.speederIgnite();
  }

  /**
   * Let the rider off (RB, a jump, death, destruction). The vehicle parks
   * where it stands and can be remounted — unless it is already dead.
   */
  dropRider(): void {
    const rider = this.rider;
    if (!rider) return;
    this.rider = null;
    rider.vehicle = null;
    audio.setEngine(rider.slot, 0);
    if (this.alive) this.park();
  }

  damage(amount: number, from: THREE.Vector3, bySlot = -1): void {
    if (!this.alive || amount <= 0) return;
    this.hp -= amount;
    if (bySlot >= 0) this.lastHitBy = bySlot;
    if (this.rider) {
      this.rider.cam.shake(Math.min(0.12, amount * 0.006));
      this.rider.noteVehicleHit(from);
    }
    if (this.hp <= 0) this.destroy(true);
  }

  /** The end of the ride: throw the rider clear and blow the wreck. */
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
    this.group.visible = false;
    this.removeMe = true;
    if (explode) this.pendingExplosion = { at: at.setY(at.y + 0.5), slot };
  }

  /** set by destroy(); the game detonates it on its next update pass */
  pendingExplosion: { at: THREE.Vector3; slot: number } | null = null;

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
    _seatRay.set(_seatFrom, _down);
    const hit = _seatRay.intersectObject(root, true)[0];
    if (!hit) return;                       // nothing under the seat: keep the default
    const surface = hit.point.y - this.pos.y;
    // a straddled saddle carries the hips a hand's width above it; a standing
    // rider's feet go straight onto the deck
    this.seatY = this.def.stance === 'stand' ? surface : surface - 0.85;
  }

  /** Per-frame while parked; a ridden vehicle is driven from its rider instead. */
  update(dt: number, game: Game): void {
    if (!this.alive || this.rider) return;
    // settle toward hover height and idle-bob gently inside the parked box
    const target = this.groundAt(this.pos.x, this.pos.z) + this.def.hover;
    this.pos.y = damp(this.pos.y, target, 4, dt) + Math.sin(game.time * 1.7 + this.bobPhase) * 0.004;
    this.syncMesh(dt, 0);
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
    this.yaw -= this.steer * def.turn * bite * (1 - 0.32 * fast) * dt;

    // the nose, and the axis it slides along
    const nx = Math.sin(this.yaw), nz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let fwd = this.vel.x * nx + this.vel.z * nz;
    let lat = this.vel.x * rx + this.vel.z * rz;

    // ---- the pedals: A accelerates, B brakes and then reverses ----
    if (input.throttleHeld && !input.brakeHeld) {
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
      audio.dash();
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
    const before = Math.hypot(this.vel.x, this.vel.z);
    game.board.physics.moveCapsule(this.pos, def.radius, def.body, this.vel, dt);
    const after = Math.hypot(this.vel.x, this.vel.z);
    const lost = before - after;
    if (lost > 7) {
      this.damage(lost * 2.2, this.pos, -1);
      game.particles.impactSparks(this.pos.clone().setY(this.pos.y + 0.6), 12);
      audio.land(true);
      rider.cam.shake(Math.min(0.3, lost * 0.012));
    }

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
        const dmg = Math.min(48, speed * 2.1);
        const wasAlive = e.alive;
        e.damage(dmg, this.pos, rider.slot);
        e.knockback(this.pos, Math.min(20, speed * 0.9), 0.5, 0.3);
        e.knockdown(1.2 + Math.random() * 0.6);
        game.particles.impactSparks(e.position.clone().setY(e.position.y + 1), 10);
        audio.impact();
        rider.cam.shake(0.09);
        if (wasAlive) game.hitMarker(rider.slot);
        // every body struck chips the ride — nothing is free
        this.damage(3, e.position, -1);
        if (!this.alive) break;
      }
    }

    // engine leans with the throttle; dust or spray kicks up in the wake
    audio.setEngine(rider.slot, 0.35 + (speed / def.top) * 0.85);
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

  private syncMesh(dt: number, speed: number): void {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    // Bank into the turn — both the slide the tail is carrying and the steering
    // itself, so a ride leans as it is asked to turn rather than only once it
    // has started sliding. Nose down a touch with descent.
    const latX = Math.cos(this.yaw), latZ = -Math.sin(this.yaw);
    const lateral = (this.vel.x * latX + this.vel.z * latZ) / Math.max(1, this.def.top);
    const lean = -lateral * 0.4 - this.steer * 0.3 * Math.min(1, speed / (this.def.top * 0.5));
    this.body.rotation.z = damp(this.body.rotation.z, lean, 8, dt);
    this.body.rotation.x = damp(this.body.rotation.x, -this.vel.y * 0.02 + speed * 0.004, 8, dt);
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
      onLoad: (root) => { for (const m of built) m.visible = false; onModel?.(root); },
    });
    model.position.y = def.body * 0.35;
    group.add(model);
  }
}
