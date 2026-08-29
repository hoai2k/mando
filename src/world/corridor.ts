import * as THREE from 'three';
import type { Board } from './board';
import { mat } from '../characters/builder';

/**
 * Campaign corridor segments (docs/LEVEL_DESIGN.md §3): a procedurally
 * assembled interior lane — floor, walls, ceiling, staggered cover crates and
 * a wider mid-lane pocket — grafted onto an existing board's scene and
 * physics, floating high above the territory so it reads as its own interior.
 * Doors teleport the party in and out; the geometry itself never moves.
 *
 * All procedural (dark hull materials); the corridor art round in
 * docs/ASSETS_IMAGES.md / ASSETS_MODELS.md upgrades the surfaces and the door
 * when those files land.
 */

export interface CorridorSpot {
  pos: THREE.Vector3;
  /** where this defender should face (toward the entrance leg) */
  toward: THREE.Vector3;
}

export interface CorridorSpec {
  /** where the party lands when it comes through the entry door */
  entry: THREE.Vector3;
  /** walking into this region ends the corridor (the exit door) */
  exit: THREE.Vector3;
  /** validated defender posts, behind cover, facing the advance */
  enemySpots: CorridorSpot[];
  /** wider pocket centres, for hint text and pickups */
  pockets: THREE.Vector3[];
}

const WIDTH = 7;
const WALL_H = 4.2;
const LEG_MIN = 18;
const LEG_MAX = 26;

/** deterministic-ish rng so a level replays the same corridor */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Build one corridor at `origin` (its entry mouth), running roughly along
 * +X with alternating Z bends. Adds meshes to board.group and colliders to
 * board.physics. Returns the spec the campaign controller wires doors to.
 */
export function buildCorridor(board: Board, origin: THREE.Vector3, seed: number, legs = 3): CorridorSpec {
  const rand = rng(seed);
  const wall = mat(0x2c3038, { rough: 0.7, metal: 0.5 });
  const floorMat = mat(0x383c44, { rough: 0.85, metal: 0.3 });
  const crateMat = mat(0x4a4436, { rough: 0.8, metal: 0.2 });
  const trim = mat(0x8a6a2a, { rough: 0.5, metal: 0.4, emissive: 0x2a1f08 });
  const group = new THREE.Group();
  group.name = 'corridor';
  board.group.add(group);

  const spots: CorridorSpot[] = [];
  const pockets: THREE.Vector3[] = [];
  const y = origin.y;

  const solid = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, m: THREE.Material): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.set(cx, cy, cz);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
    board.physics.addBox(cx, cy, cz, sx, sy, sz);
  };

  // Legs alternate heading: +X, then ±Z, then +X... Each leg is floor + two
  // side walls + ceiling; corners get a cap wall so no seam leaks the sky.
  let px = origin.x;
  let pz = origin.z;
  let dirX = 1, dirZ = 0;
  let lastLen = 0;
  const legEnds: Array<{ x: number; z: number; dx: number; dz: number }> = [];

  for (let leg = 0; leg < legs; leg++) {
    const len = LEG_MIN + rand() * (LEG_MAX - LEG_MIN);
    const midX = px + dirX * len / 2;
    const midZ = pz + dirZ * len / 2;
    const alongX = dirX !== 0;
    // a wider pocket on the middle leg: the advance-under-fire set piece
    const wide = leg === Math.floor(legs / 2) ? WIDTH + 6 : WIDTH;
    const sx = alongX ? len + WIDTH : wide;
    const sz = alongX ? wide : len + WIDTH;

    // floor and ceiling
    solid(midX, y - 0.5, midZ, sx + 2, 1, sz + 2, floorMat);
    solid(midX, y + WALL_H + 0.5, midZ, sx + 2, 1, sz + 2, wall);
    // side walls flanking the travel axis
    if (alongX) {
      solid(midX, y + WALL_H / 2, midZ - sz / 2 - 0.5, sx + 2, WALL_H, 1, wall);
      solid(midX, y + WALL_H / 2, midZ + sz / 2 + 0.5, sx + 2, WALL_H, 1, wall);
    } else {
      solid(midX - sx / 2 - 0.5, y + WALL_H / 2, midZ, 1, WALL_H, sz + 2, wall);
      solid(midX + sx / 2 + 0.5, y + WALL_H / 2, midZ, 1, WALL_H, sz + 2, wall);
    }
    // hazard-stripe skirting to catch the eye down the lane
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.2, 0.25, alongX ? 0.2 : len), trim);
    stripe.position.set(midX, y + 0.25, midZ - (alongX ? wide / 2 - 0.35 : 0) + (alongX ? 0 : 0));
    group.add(stripe);

    if (wide > WIDTH) pockets.push(new THREE.Vector3(midX, y, midZ));

    // cover crates: staggered pairs down the leg, defenders behind the far ones
    const crates = Math.floor(len / 9);
    for (let c = 0; c < crates; c++) {
      const t = (c + 0.7) / (crates + 0.4);
      const cx = px + dirX * len * t;
      const cz = pz + dirZ * len * t;
      const side = (c % 2 === 0 ? 1 : -1) * (wide / 2 - 1.6);
      const bx = cx + (alongX ? 0 : side);
      const bz = cz + (alongX ? side : 0);
      const cw = 1.6 + rand() * 0.8;
      solid(bx, y + 0.65, bz, cw, 1.3, cw * 0.8, crateMat);
      // defender post on the exit side of the crate, facing back down the leg
      if (c >= 1) {
        const back = 1.4;
        spots.push({
          pos: new THREE.Vector3(bx + dirX * back, y + 0.1, bz + dirZ * back),
          toward: new THREE.Vector3(px, y, pz),
        });
      }
    }

    // interior work light per leg (no shadows — perf budget)
    const light = new THREE.PointLight(0xffd9a0, 10, len + 14, 1.6);
    light.position.set(midX, y + WALL_H - 0.6, midZ);
    group.add(light);

    legEnds.push({ x: px + dirX * len, z: pz + dirZ * len, dx: dirX, dz: dirZ });
    px += dirX * len;
    pz += dirZ * len;
    lastLen = len;

    // turn: X legs alternate with Z legs, bend side alternating with a coin flip
    if (dirX !== 0) { dirZ = rand() > 0.5 ? 1 : -1; dirX = 0; }
    else { dirX = 1; dirZ = 0; }
  }
  void lastLen;

  // end caps at the mouth and the tail so the lane is sealed
  const first = legEnds[0];
  solid(origin.x - first.dx * 1.5, y + WALL_H / 2, origin.z - first.dz * 1.5,
    first.dx ? 1 : WIDTH + 4, WALL_H, first.dx ? WIDTH + 4 : 1, wall);
  const tail = legEnds[legEnds.length - 1];
  solid(tail.x + tail.dx * 1.5, y + WALL_H / 2, tail.z + tail.dz * 1.5,
    tail.dx ? 1 : WIDTH + 4, WALL_H, tail.dx ? WIDTH + 4 : 1, wall);

  const entry = new THREE.Vector3(origin.x + first.dx * 2.5, y + 0.2, origin.z + first.dz * 2.5);
  const exit = new THREE.Vector3(tail.x - tail.dx * 2.5, y + 0.2, tail.z - tail.dz * 2.5);

  // keep only defender posts a capsule actually fits in (a crate roll can crowd one)
  const ok = spots.filter((s) => board.physics.capsuleFree(s.pos.x, s.pos.y, s.pos.z, 0.55, 2.0));
  return { entry, exit, enemySpots: ok, pockets };
}

/**
 * A door: an emissive-trimmed frame the guide beacon can sit on. Purely
 * visual — the campaign controller owns the trigger radius and the teleport.
 * Upgrades to `blast_door.glb` when the model lands (ASSETS_MODELS.md).
 */
export function buildDoorFrame(parent: THREE.Object3D, pos: THREE.Vector3, yaw: number): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(pos);
  g.rotation.y = yaw;
  const frame = mat(0x3a3e46, { rough: 0.6, metal: 0.5 });
  const glowM = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  const post = new THREE.BoxGeometry(0.5, 3.6, 0.5);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(post, frame);
    p.position.set(side * 1.6, 1.8, 0);
    g.add(p);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.5, 0.5), frame);
  lintel.position.y = 3.55;
  g.add(lintel);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 3.1), new THREE.MeshBasicMaterial({
    color: 0x63b4ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  }));
  glow.position.y = 1.75;
  g.add(glow);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.12, 0.12), glowM);
  strip.position.y = 3.24;
  g.add(strip);
  parent.add(g);
  return g;
}
