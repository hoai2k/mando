import * as THREE from 'three';
import { PhysicsWorld, type StaticBox } from '../core/physics';
import type { Game } from '../game/game';

/**
 * A board is a self-contained arena: geometry + physics + lighting + the data
 * that used to hang off a two-way `kind` switch (banner text, footstep
 * surface, ambience) now travels with the board itself, so adding a board is
 * additive rather than another branch in every system.
 */

export type BoardId =
  | 'desert' | 'station'
  | 'nevarro' | 'crevasse' | 'trask' | 'refinery' | 'forge' | 'ringworld'
  | 'narkina';

/** ground the footsteps land on (each maps to a sample + synth voice) */
export type Surface = 'sand' | 'metal' | 'snow' | 'stone';

/**
 * A circular danger zone. `kill` zones (the sarlacc, the mamacore pool) end
 * anyone inside instantly; `burn` zones tick damage per second — survivable,
 * but not somewhere to stand.
 */
export interface Hazard {
  center: THREE.Vector3;
  radius: number;
  kind: 'kill' | 'burn';
  /** burn zones only: damage per second while inside */
  dps?: number;
  /** the zone only bites below this height; default center.y + 3 */
  yMax?: number;
}

/**
 * A platform that travels: the physics box is re-placed every frame and the
 * frame's displacement is recorded, so the game can carry whoever is standing
 * on it. The AABB never rotates — visual roll/pitch stays on the mesh.
 */
export class Mover {
  /** world displacement applied this frame; riders are carried by it */
  delta = new THREE.Vector3();
  private half = new THREE.Vector3();
  private center = new THREE.Vector3();

  constructor(public box: StaticBox, public node: THREE.Object3D | null) {
    this.half.subVectors(box.max, box.min).multiplyScalar(0.5);
    this.center.addVectors(box.min, box.max).multiplyScalar(0.5);
  }

  get top(): number { return this.box.max.y; }

  moveTo(x: number, y: number, z: number): void {
    this.delta.set(x - this.center.x, y - this.center.y, z - this.center.z);
    this.center.set(x, y, z);
    this.box.min.set(x - this.half.x, y - this.half.y, z - this.half.z);
    this.box.max.set(x + this.half.x, y + this.half.y, z + this.half.z);
    if (this.node) this.node.position.set(x, y, z);
  }
}

/**
 * A prop that can be shot apart: it registers as a bolt target, takes
 * explosion splash, and on death loses its collision box (and optionally
 * explodes itself — rhydonium chains).
 */
export interface Breakable {
  mesh: THREE.Object3D;
  box: StaticBox;
  center: THREE.Vector3;
  radius: number;
  hp: number;
  maxHp: number;
  /** detonates on death: full explosion, chains into its neighbours */
  explosive?: boolean;
  broken?: boolean;
  /** flourish on death (extra FX, board bookkeeping) */
  onBreak?: (game: Game) => void;
}

/** Where a pilotable vehicle sits parked when the match starts. */
export interface VehicleSpec {
  kind: 'swoop' | 'speederBike' | 'landspeeder' | 'skiff';
  x: number;
  z: number;
  /** resting facing, radians (0 = +Z) */
  yaw?: number;
}

export interface Board {
  group: THREE.Group;
  physics: PhysicsWorld;
  playerStarts: THREE.Vector3[];
  groundSpawns: THREE.Vector3[];
  airSpawns: THREE.Vector3[];
  kind: BoardId;
  /** banner headline when the board loads */
  name: string;
  /** banner sub-line; defaults to the survive-10-waves objective */
  objective?: string;
  /** what footfalls sound like here */
  footstep: Surface;
  /** ambience: authored sample name to try, and which synth bed backs it */
  ambience: { sample: string; bed: 'wind' | 'hum' };
  /** which streamed playlist / combat loop fits this board */
  music: 'desert' | 'station';
  fog: THREE.Fog | null;
  background: THREE.Color;
  /** authored equirect panorama to use as the scene background, if present */
  skyFile?: string;
  /** dims the panorama so bright skies don't flatten the geometry against them */
  skyIntensity?: number;
  /** procedural sky, hidden once the authored panorama loads */
  proceduralSky?: THREE.Object3D;
  /**
   * Gravity scale for everyone standing on this board, 1 = Tatooine. A station
   * in orbit runs light: jumps float, falls are gentle, the jetpack goes
   * further on the same fuel.
   */
  gravity?: number;
  /**
   * The sea's surface height. Below it the water rules apply: the player
   * wades where the bottom is within standing depth and swims where it
   * isn't, bolts die at the surface in both directions, hostiles all but
   * lose sight of a submerged target, and anything not aquatic drowns if
   * its head goes under for long. Omit for dry boards.
   */
  waterY?: number;
  /**
   * Below this height there is no floor left to hit, so falling becomes a slow
   * drift a jetpack tap can undo rather than a plunge. Omit for solid ground.
   */
  voidY?: number;
  /** gravity multiplier while drifting below voidY */
  voidGravity?: number;
  /** terminal downward speed while drifting, m/s */
  voidFallSpeed?: number;
  /**
   * How much ambient lift the player character gets on this board, 0–1 as a
   * fraction of his own albedo. It reaches the hero only, so a dark board can
   * keep its mood without losing him against it.
   */
  heroLight?: number;
  /** deadly and damaging zones (sarlacc pit, lava pools, open water) */
  hazards?: Hazard[];
  /**
   * Irregular damage fields a circle can't describe — lava rivers, the sea
   * between the docks. Returns damage per second at a position, 0 if safe.
   */
  burnAt?: (x: number, z: number, y: number) => number;
  /**
   * Ground grip multiplier, 1 = normal. Ice returns a fraction and running
   * turns into a drift; only voluntary steering is scaled, so knockbacks and
   * momentum carry exactly as far as they should.
   */
  tractionAt?: (x: number, z: number) => number;
  /**
   * How lit a position is, 0 = full dark to 1 = daylight. Enemy sight range
   * scales with the light on their *target*, so a board with a moving
   * terminator makes the dark side genuinely safer to move through.
   */
  lightAt?: (x: number, z: number) => number;
  /** platforms that travel and carry their riders (boats, trams, cranes) */
  movers?: Mover[];
  /** props that can be shot apart (ice plates, fuel barrels, consoles) */
  breakables?: Breakable[];
  /** rides parked around the board — spawned as entities by the game */
  vehicles?: VehicleSpec[];
  /**
   * Ranged hostiles stay leashed near their spawn instead of chasing firing
   * angles — for boards where the walkable world is islands (station platforms,
   * dock fingers) and a wandering shooter ends up in the void or the sea.
   */
  rangedLeash?: boolean;
  update?: (dt: number, time: number, game?: Game) => void;
}

const _out = { kill: false, dps: 0 };

/**
 * What the board does to whoever stands at `pos`: instant death (kill zone) or
 * damage per second (burn zones and the board's burnAt field). One shared
 * answer for players and enemies both.
 */
export function hazardAt(board: Board, pos: THREE.Vector3): { kill: boolean; dps: number } {
  _out.kill = false;
  _out.dps = 0;
  if (board.hazards) {
    for (const h of board.hazards) {
      const yMax = h.yMax ?? h.center.y + 3;
      if (pos.y > yMax) continue;
      const dx = pos.x - h.center.x, dz = pos.z - h.center.z;
      if (dx * dx + dz * dz > h.radius * h.radius) continue;
      if (h.kind === 'kill') { _out.kill = true; return _out; }
      _out.dps += h.dps ?? 10;
    }
  }
  if (board.burnAt) _out.dps += board.burnAt(pos.x, pos.z, pos.y);
  return _out;
}

/** the nearest kill zone, for spawn placement that keeps squads out of pits */
export function killZones(board: Board): Hazard[] {
  return (board.hazards ?? []).filter((h) => h.kind === 'kill');
}

/**
 * Register a mesh + box as a breakable on the board. The box must already be
 * in the board's physics world; breaking removes it.
 */
export function addBreakable(
  board: { physics: PhysicsWorld; breakables?: Breakable[] },
  mesh: THREE.Object3D,
  box: StaticBox,
  hp: number,
  opts: { explosive?: boolean; radius?: number; onBreak?: (game: Game) => void } = {}
): Breakable {
  const center = new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
  const size = new THREE.Vector3().subVectors(box.max, box.min);
  const b: Breakable = {
    mesh, box, center, hp, maxHp: hp,
    radius: opts.radius ?? Math.max(size.x, size.y, size.z) * 0.62,
    explosive: opts.explosive,
    onBreak: opts.onBreak,
  };
  (board.breakables ??= []).push(b);
  return b;
}
