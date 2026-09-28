import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy, EnemyKind } from '../enemies/enemy';
import type { Player } from '../player/player';
import { VEHICLE_DEFS, BIKE_CANNON, BIKE_CANNON_HOSTILE, BIKE_PILLION, type Vehicle, type GunDef } from '../game/vehicles';
import { HeadingLane, RideLedger } from './kit/mounts';
import { Mover } from '../world/board';
import { audio } from '../core/audio';
import { clamp, damp } from '../core/math';

/**
 * The Magma Run (docs/LEVEL_SECTIONS.md §2.5) — the Lava Flats, between the
 * garrison (stage B) and the Chimney.
 *
 * The magistrate court's far door lets out at the top of a ramp, down into
 * the lava tunnels under the town. A pirate crew keeps its bikes at a quay on
 * the river there; the party walks into their camp and takes them. Then two
 * kilometres of lava river, flat out: the tunnel, an open basalt canyon, and
 * the magma chamber the river pours into, where the bikes pull up at a basalt
 * landing against the energy fence that shuts the Chimney's tunnel.
 *
 * **The verb** is K3: the bikes are lane-guided (the stick is *where in the
 * lane* and *how fast*, never which way the level goes), with twin nose
 * cannons on RT and the rider's own weapon swung to a flank on X — at a pirate
 * alongside, who comes out of the saddle and goes into the lava while his bike
 * runs on without him. A second player may ride pillion and work both.
 *
 * **The escalation**, in four stretches split by gates (checkpoints, and a
 * fresh bike for anyone who went in):
 *  1. the run-in — open lava, crust islands, basalt spires, the first bikers;
 *  2. the columns — basalt columns crack at the foot and fall across the
 *     river, leaving one-bike gaps, and geysers throw up on a glow;
 *  3. the falls — the river drops two terraces (fly the lip, or bounce down
 *     the crust ramp), and swoops dive in off the ledges;
 *  4. the gun barge — a pirate lava skiff with a flak gun and a crew runs
 *     ahead of the party into the chamber and holds the mouth with a boom.
 *     Kill the gunner and the crew, or ram it; either way it goes under, and
 *     the boom with it. The landing is beyond.
 *
 * Nothing is left behind: a wreck on lava re-forms at the party's last gate on
 * a fresh bike; one thrown onto crust gets a fresh bike where they stand after
 * a breath (or a teammate's pillion, if one passes); a bike lost at the quay
 * is replaced. A wipe re-forms at the last gate with the hazards as they were.
 */

/** metres of lane from the quay to the landing's fence */
const LEN = 2000;
/** lane laid upstream of s = 0, to the vent the river comes out of */
const BEFORE = 20;
/** the gates: checkpoints, and where a fresh bike is handed out */
const GATES = [40, 500, 1000, 1500, 1700];
const TUNNEL_END = 230;
const CHAMBER = 1640;
/** the two terrace lips of the falls, and how far each drops */
const LIPS = [1130, 1330];
const DROP = 9;
/** the crust ramp beside each lip: lateral band (metres right of the line) */
const RAMPS: [number, number][] = [[3, 11], [-11, -3]];
/** the chamber mouth the barge holds with its boom */
const MOUTH = 1905;
const LANDING = 1962;
/** the throttle band: pulled back, centred, full */
const SLOW = 16;
const CRUISE = 22;
const TOP = 30;

/** the quay the pirates' bikes are moored at: left bank (negative lat) */
const QUAY_S0 = -18;
const QUAY_S1 = 42;
const QUAY_EDGE = -10;
/** the alcove the door opens into, and its ramp down to the quay */
const ALCOVE_S0 = 3;
const ALCOVE_S1 = 17;
const RAMP_TOP = -37;
const DOOR_LAT = -44.5;
const RAMP_RISE = 7.6;

const ISLANDS = [
  { s: 300, lat: -8, rs: 14, rl: 4.5 }, { s: 362, lat: 7, rs: 12, rl: 4 },
  { s: 430, lat: -2, rs: 16, rl: 5 }, { s: 1152, lat: -8, rs: 10, rl: 4 },
  { s: 1356, lat: 8, rs: 10, rl: 4 }, { s: 1712, lat: 10, rs: 14, rl: 4 },
];
const SPIRES: [number, number][] = [
  [322, 3], [388, -9.5], [448, 6], [484, -4], [1172, 2], [1216, 9.5],
  [1286, -3], [1388, -6], [1452, 8.5], [1592, -9.5], [1668, 6],
];
const COLUMNS = [
  { s: 565, side: -1 }, { s: 636, side: 1 }, { s: 706, side: -1 },
  { s: 786, side: 1 }, { s: 856, side: -1 }, { s: 936, side: 1 },
] as const;
const COLUMN_LEN = 21;
const GEYSERS: [number, number][] = [
  [540, 6], [612, -4], [672, 8], [738, -7], [822, 2], [902, -9], [962, 5],
  [1137, -1], [1250, 7], [1339, 2], [1422, -4], [1562, -5], [1702, -2], [1802, 5],
];

type Role = 'swinger' | 'gunner';
interface Wave { at: number; riders: Role[]; from: 'behind' | 'ahead'; swoops?: number }
const WAVES: Wave[] = [
  { at: 250, riders: ['swinger', 'swinger'], from: 'ahead' },
  { at: 410, riders: ['gunner', 'swinger'], from: 'behind' },
  { at: 560, riders: ['swinger', 'gunner'], from: 'ahead' },
  { at: 780, riders: ['swinger', 'swinger', 'gunner'], from: 'behind' },
  { at: 1030, riders: [], swoops: 2, from: 'ahead' },
  { at: 1180, riders: ['swinger', 'gunner'], from: 'behind' },
  { at: 1370, riders: ['swinger'], swoops: 2, from: 'ahead' },
  { at: 1540, riders: ['swinger', 'swinger'], from: 'behind' },
];

/** the barge's flak gun: a quad gun with a pirate on it, slower and lighter */
const FLAK: GunDef = {
  ...VEHICLE_DEFS.turret.gun!, rate: 4, heat: 0.07, cool: 0.4, resume: 0.3,
  damage: 6, speed: 46, cone: 0, range: 90,
};

function build(ctx: SectionContext): SectionInstance {
  const { game } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections['magma-run'];
  const party = Math.max(1, game.players.length);

  // ------------------------------------------------------------ the shape

  /** the lava's own surface at `s` (the falls drop it in two steps) */
  const lavaY = (s: number): number => {
    let y = Y0 - 0.004 * clamp(s, 0, CHAMBER);
    for (const lip of LIPS) y -= DROP * clamp((s - lip) / 3, 0, 1);
    return y;
  };
  /** the crust ramp beside lip `k`: its surface, or -Infinity off it */
  const rampY = (s: number, lat: number): number => {
    for (let k = 0; k < LIPS.length; k++) {
      const [a, b] = RAMPS[k];
      const s0 = LIPS[k] - 2, s1 = LIPS[k] + 16;
      if (lat < a || lat > b || s < s0 || s > s1) continue;
      return lavaY(s0) - DROP * ((s - s0) / (s1 - s0)) + 0.35;
    }
    return -Infinity;
  };
  const islandY = (s: number, lat: number): number => {
    let y = -Infinity;
    for (const i of ISLANDS) {
      const e = ((s - i.s) / i.rs) ** 2 + ((lat - i.lat) / i.rl) ** 2;
      if (e < 1) y = Math.max(y, lavaY(s) + 0.55 * Math.min(1, (1 - e) * 3));
    }
    return y;
  };
  /** the floor at a point on the lane: lava, or whatever crust or rock is over it */
  const floorAt = (s: number, lat: number): number => {
    let y = lavaY(s);
    y = Math.max(y, rampY(s, lat), islandY(s, lat));
    if (s > QUAY_S0 && s < QUAY_S1 && lat < QUAY_EDGE) y = Math.max(y, lavaY(s) + 1.4);
    if (s > ALCOVE_S0 && s < ALCOVE_S1 && lat < -23) {
      const t = clamp((-23 - lat) / (-23 - RAMP_TOP), 0, 1);
      y = Math.max(y, lavaY(s) + 1.4 + t * RAMP_RISE);
    }
    if (s >= LANDING) y = Math.max(y, lavaY(s) + 1.1);
    return y;
  };
  /** is there anything but lava under this point? */
  const solid = (s: number, lat: number): boolean => floorAt(s, lat) > lavaY(s) + 0.2;

  const halfWidth = (s: number): number => {
    if (s < 30) return 22;
    if (s < 70) return THREE.MathUtils.lerp(22, 13, (s - 30) / 40);
    if (s < TUNNEL_END) return 13;
    if (s < 270) return THREE.MathUtils.lerp(13, 16, (s - TUNNEL_END) / 40);
    if (s < 500) return 16;
    if (s < 1000) return 15;
    if (s < 1600) return 16;
    if (s < CHAMBER) return THREE.MathUtils.lerp(16, 18, (s - 1600) / 40);
    if (s < 1860) return 18;
    if (s < 1890) return THREE.MathUtils.lerp(18, 11, (s - 1860) / 30);
    if (s < 1945) return 11;
    if (s < LANDING) return THREE.MathUtils.lerp(11, 14, (s - 1945) / 17);
    return 14;
  };
  /** where the rock face is (a little outside the lane: the lane's edge is the wall's foot) */
  const wallLat = (s: number, side: -1 | 1): number => {
    if (s < CHAMBER) return halfWidth(s) + 1.5;
    // the chamber opens out round the lake; its walls close on the landing
    const open = clamp((s - CHAMBER) / 90, 0, 1);
    const close = clamp((s - 1930) / 60, 0, 1);
    const wide = 58 + side * 4;
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(halfWidth(s) + 1.5, wide, open), 20, close);
  };

  let barge: Barge | null = null;
  const bargeHolds = (): boolean => !!barge && barge.state !== 'gone' && barge.state !== 'sinking';

  const lane = new HeadingLane({
    origin: { x: 0, z: 0, heading: 0 },
    length: LEN,
    before: BEFORE,
    bends: [
      { at: 300, turn: -0.5, span: 150 },
      { at: 620, turn: 0.8, span: 170 },
      { at: 1050, turn: -0.7, span: 160 },
      { at: 1560, turn: 0.45, span: 150 },
    ],
    halfWidth,
    speed: (s) => {
      // the landing: the band closes, and the bikes pull up at the fence
      if (s >= 1992) return { min: 0, cruise: 0, max: 0 };
      if (s > 1935) {
        const t = (s - 1935) / 57;
        return { min: THREE.MathUtils.lerp(SLOW, 0, t), cruise: THREE.MathUtils.lerp(CRUISE, 3, t), max: THREE.MathUtils.lerp(TOP, 6, t) };
      }
      // the barge's boom across the mouth: the chamber is where you may stop
      if (bargeHolds() && s > 1770) return { min: 0, cruise: CRUISE, max: TOP };
      return { min: SLOW, cruise: CRUISE, max: TOP };
    },
    floor: floorAt,
    sinks: (s, lat) => !solid(s, lat),
    reach: 70,
  });

  // the river is the floor: the section's own ground under every body
  ctx.board.physics.heightAt = (x, z) => {
    const on = lane.project(x, z);
    return floorAt(on.s, on.lat);
  };

  const at = (s: number, lat: number, dy = 0): THREE.Vector3 => {
    const p = lane.point(s, lat, new THREE.Vector3());
    p.y += dy;
    return p;
  };

  // ------------------------------------------------------------ materials

  const rock = ctx.paint(0x3a3230, { rough: 0.95, metal: 0.05 });
  ctx.tile(rock, 'cliff_basalt', 1, 1, { normal: true });
  // the rock faces are strips seen from either side (a wall, a roof, a berm)
  rock.side = THREE.DoubleSide;
  const crust = ctx.paint(0x2a2320, { rough: 1, metal: 0 });
  ctx.tile(crust, 'basalt_albedo', 1, 1);
  crust.side = THREE.DoubleSide;
  const slab = ctx.paint(0x4a403a, { rough: 0.9, metal: 0.05 });
  ctx.tile(slab, 'ash_ground', 1, 1);
  const iron = ctx.paint(0x3c3a38, { rough: 0.55, metal: 0.7 });
  const rust = ctx.paint(0x6a3a22, { rough: 0.8, metal: 0.4 });
  const lava = new THREE.MeshStandardMaterial({
    color: 0xff6a20, emissive: 0xff4a10, emissiveIntensity: 1.5, roughness: 0.55, metalness: 0,
  });
  ctx.own(lava);
  ctx.tile(lava, 'lava_flow', 1, 1, { glow: 'lava_flow' });
  const amber = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  ctx.own(amber);
  const hot = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.0, depthWrite: false });
  ctx.own(hot);
  const fenceBeams: THREE.Mesh[] = [];
  const fenceMat = new THREE.MeshBasicMaterial({
    color: 0xff5a3a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
  });
  ctx.own(fenceMat);

  // ------------------------------------------------------------ meshes

  /**
   * A strip laid along the lane: one row of points per `step` metres, each
   * row a list of (lat, y) — a lava surface, a wall face, a roof. UVs are in
   * metres over `uvScale`, so a tileable lies on it at the same scale
   * whatever the strip's shape.
   */
  const strip = (s0: number, s1: number, step: number,
    row: (s: number) => [number, number][], material: THREE.Material, uvScale = 10,
    shadows = true): THREE.Mesh => {
    const rows: [number, number][][] = [];
    const ss: number[] = [];
    for (let s = s0; s <= s1 + 1e-6; s += step) { rows.push(row(s)); ss.push(s); }
    const cols = rows[0].length;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const p = new THREE.Vector3();
    for (let r = 0; r < rows.length; r++) {
      let across = 0;
      for (let c = 0; c < cols; c++) {
        const [lat, y] = rows[r][c];
        lane.point(ss[r], lat, p);
        pos.push(p.x, y, p.z);
        if (c > 0) {
          const [pl, py] = rows[r][c - 1];
          across += Math.hypot(lat - pl, y - py);
        }
        uv.push(across / uvScale, ss[r] / uvScale);
      }
    }
    for (let r = 0; r < rows.length - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        // counter-clockwise seen from the side the columns run rightward on:
        // a strip laid left to right faces up
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        idx.push(a, b, d, b, e, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    ctx.own(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = shadows;
    mesh.castShadow = false;
    ctx.mesh(mesh);
    return mesh;
  };

  // the lava: the whole river floor, under the walls' feet, flowing
  strip(-BEFORE, LEN + 12, 2, (s) => {
    const l = -wallLat(s, -1) - 4, r = wallLat(s, 1) + 4;
    const out: [number, number][] = [];
    for (let k = 0; k <= 10; k++) {
      const lat = THREE.MathUtils.lerp(l, r, k / 10);
      out.push([lat, lavaY(s)]);
    }
    return out;
  }, lava, 14, false);

  // the walls: rough basalt faces either side, leaning in a little, with a
  // ragged skyline in the canyon and the tunnel's own height underground
  const noise = (s: number, k: number): number =>
    Math.sin(s * 0.071 + k) * 0.5 + Math.sin(s * 0.023 + k * 2.3) * 0.35 + Math.sin(s * 0.19 + k * 5.1) * 0.15;
  const wallH = (s: number, side: number): number => {
    if (s < TUNNEL_END) return 14;
    if (s < CHAMBER) return 36 + 12 * (0.5 + 0.5 * noise(s, side * 3));
    return 48;
  };
  for (const side of [-1, 1] as const) {
    const face = (s: number): [number, number][] => {
      const w = wallLat(s, side);
      const base = lavaY(s) - 2;
      const h = wallH(s, side);
      const n = noise(s, side);
      return [
        [side * w, base],
        [side * (w + 0.4 + n * 0.8), lavaY(s) + h * 0.25],
        [side * (w + 1.2 + n * 1.4), lavaY(s) + h * 0.55],
        [side * (w + 0.8 + n * 1.6), lavaY(s) + h * 0.85],
        [side * (w + 3.5 + n * 2), lavaY(s) + h],
        [side * (w + 14), lavaY(s) + h + 2],
      ].map(([lat, y]) => [lat, y] as [number, number]);
    };
    if (side === -1) {
      // the left wall is broken by the alcove the door opens into
      strip(-BEFORE, ALCOVE_S0, 1, face, rock, 8);
      strip(ALCOVE_S1, LEN + 4, 2, face, rock, 8);
    } else strip(-BEFORE, LEN + 4, 2, face, rock, 8);
  }
  // lava pouring down the canyon faces, as in the keyframe: a glowing tongue
  // laid on the rock itself, flowing down it
  const fallMat = new THREE.MeshBasicMaterial({ color: 0xffa050, side: THREE.DoubleSide });
  ctx.own(fallMat);
  ctx.tile(fallMat as unknown as THREE.MeshStandardMaterial, 'lava_flow', 1, 1);
  const WALL_FALLS: [number, -1 | 1][] = [
    [272, 1], [395, -1], [522, 1], [664, -1], [768, 1], [884, -1], [992, 1],
    [1186, -1], [1274, 1], [1424, -1], [1546, 1], [1690, -1], [1760, 1], [1840, -1],
  ];
  for (const [fs, side] of WALL_FALLS) {
    const w0 = 1.6 + ((fs * 7) % 3);
    strip(fs - w0, fs + w0, w0 / 2, (s) => {
      const w = wallLat(s, side);
      const h = wallH(s, side);
      const n = noise(s, side);
      const t = 1 - Math.abs(s - fs) / w0;        // thicker in the middle of the tongue
      const off = -0.18 - t * 0.25;
      return [
        [side * (w + off), lavaY(s) - 0.5],
        [side * (w + 0.4 + n * 0.8 + off), lavaY(s) + h * 0.25],
        [side * (w + 1.2 + n * 1.4 + off), lavaY(s) + h * 0.55],
        [side * (w + 0.8 + n * 1.6 + off), lavaY(s) + h * 0.85],
      ];
    }, fallMat, 6, false);
  }

  // basalt columns stood along the canyon faces — the keyframe's organ pipes
  {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6);
    ctx.own(geo);
    const spots: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    let seed = 7;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let s = TUNNEL_END + 10; s < CHAMBER + 300; s += 3.2) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.25) continue;
        const r = 1.0 + rnd() * 1.1;
        const h = wallH(s, side) * (0.35 + rnd() * 0.6);
        const lat = side * (wallLat(s, side as -1 | 1) + r * 0.6 + rnd() * 1.5);
        const p = at(s, lat);
        p.y = lavaY(s) - 2 + h / 2;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
        sc.set(r, h, r);
        m.compose(p, q, sc);
        spots.push(m.clone());
      }
    }
    const inst = new THREE.InstancedMesh(geo, rock, spots.length);
    spots.forEach((mm, i) => inst.setMatrixAt(i, mm));
    inst.castShadow = false;
    inst.receiveShadow = true;
    ctx.mesh(inst);
  }
  // the tunnel's roof, the chamber's dome
  strip(-BEFORE, TUNNEL_END, 3, (s) => {
    const w = wallLat(s, 1) + 3.5;
    const out: [number, number][] = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      out.push([THREE.MathUtils.lerp(-w, w, t), lavaY(s) + 14 + Math.sin(t * Math.PI) * 3]);
    }
    return out.reverse();
  }, rock, 8);
  strip(CHAMBER - 4, LEN + 4, 4, (s) => {
    const l = wallLat(s, -1) + 6, r = wallLat(s, 1) + 6;
    const out: [number, number][] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      out.push([THREE.MathUtils.lerp(-l, r, t), lavaY(s) + 46 + Math.sin(t * Math.PI) * 22]);
    }
    return out.reverse();
  }, rock, 12);
  // the vent the river comes out of, at the tunnel's head
  {
    const p = at(-BEFORE, 0);
    const wall = ctx.box(p.x, lavaY(0) + 8, p.z - 1, 50, 20, 2, rock);
    void wall;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(30, 3), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
    glow.position.set(p.x, lavaY(0) + 0.8, p.z + 0.05);
    ctx.mesh(glow);
  }

  // colliders that keep bodies on foot in the tunnel (it runs straight down +z)
  {
    const top = lavaY(0) + 15;
    const mid = (a: number, b: number): number => (a + b) / 2;
    // the right wall, and the left either side of the alcove
    ctx.box(-24, mid(lavaY(0) - 2, top), 5, 2, top - lavaY(0) + 2, 50, null);
    ctx.box(-15, mid(lavaY(0) - 2, top), 150, 2, top - lavaY(0) + 2, 160, null);
    ctx.box(24, mid(lavaY(0) - 2, top), mid(-20, ALCOVE_S0), 2, top - lavaY(0) + 2, ALCOVE_S0 + 20, null);
    ctx.box(24, mid(lavaY(0) - 2, top), mid(ALCOVE_S1, 30), 2, top - lavaY(0) + 2, 30 - ALCOVE_S1, null);
    ctx.box(15, mid(lavaY(0) - 2, top), 150, 2, top - lavaY(0) + 2, 160, null);
    for (let k = 0; k < 4; k++) {
      const z = 30 + k * 10 + 5;
      const w = THREE.MathUtils.lerp(22, 13, (k + 0.5) / 4) + 2;
      ctx.box(w, mid(lavaY(0) - 2, top), z, 2, top - lavaY(0) + 2, 10, null);
      ctx.box(-w, mid(lavaY(0) - 2, top), z, 2, top - lavaY(0) + 2, 10, null);
    }
    // the roof, for a jetpack at the quay
    ctx.box(0, lavaY(0) + 15.5, 100, 52, 1, 240, null);
  }

  // ---- the alcove, the ramp and the door ----
  {
    const y0 = lavaY(10);
    const zc = (ALCOVE_S0 + ALCOVE_S1) / 2;
    const zl = ALCOVE_S1 - ALCOVE_S0;
    // the ramp's slab, laid at its own slope over the analytic floor
    const run = -23 - RAMP_TOP;
    const len = Math.hypot(run, RAMP_RISE);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, zl - 2), slab);
    ramp.position.set(23 + run / 2, y0 + 1.4 + RAMP_RISE / 2 - 0.3, zc);
    ramp.rotation.z = Math.atan2(RAMP_RISE, run);
    ramp.receiveShadow = true;
    ctx.mesh(ramp);
    // the landing at the top, in front of the door
    ctx.box((-RAMP_TOP + -DOOR_LAT) / 2, y0 + 1.4 + RAMP_RISE - 0.5, zc, DOOR_LAT - RAMP_TOP + 0.01, 1, zl - 2, slab);
    // the alcove's walls and roof
    const h = 16;
    ctx.box(34, y0 + h / 2, ALCOVE_S0 - 1, 22, h + 2, 2, rock);
    ctx.box(34, y0 + h / 2, ALCOVE_S1 + 1, 22, h + 2, 2, rock);
    ctx.box(34, y0 + h + 1, zc, 22, 2, zl + 4, rock);
    ctx.box(-DOOR_LAT + 1, y0 + h / 2, zc, 2, h + 2, zl + 4, rock);
    // the door the party came through: the court's transport door, shut behind them
    const doorY = y0 + 1.4 + RAMP_RISE;
    const frame = ctx.paint(0x2e2b28, { rough: 0.5, metal: 0.8 });
    const leaf = ctx.paint(0x57504a, { rough: 0.45, metal: 0.75 });
    for (const dz of [-3.4, 3.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 6, 0.8), frame);
      post.position.set(-DOOR_LAT - 0.2, doorY + 3, zc + dz);
      ctx.mesh(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 7.6), frame);
    lintel.position.set(-DOOR_LAT - 0.2, doorY + 6.2, zc);
    ctx.mesh(lintel);
    for (const dz of [-1.5, 1.5]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.6, 3), leaf);
      l.position.set(-DOOR_LAT - 0.1, doorY + 2.8, zc + dz);
      ctx.mesh(l);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3a2a }));
    lamp.position.set(-DOOR_LAT - 0.6, doorY + 6.9, zc);
    ctx.mesh(lamp);
    // the ramp's rails, so its edge reads from the top
    for (const dz of [ALCOVE_S0 + 1.2, ALCOVE_S1 - 1.2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), iron);
      rail.position.set(23 + run / 2, y0 + 1.4 + RAMP_RISE / 2 + 0.9, dz);
      rail.rotation.z = Math.atan2(RAMP_RISE, run);
      ctx.mesh(rail);
    }
  }

  // ---- the quay and the pirates' camp ----
  {
    const y0 = lavaY(10);
    const len = QUAY_S1 - QUAY_S0;
    const q = new THREE.Mesh(new THREE.BoxGeometry(24 + QUAY_EDGE, 2, len), slab);
    q.position.set((-QUAY_EDGE + 24) / 2 + 0.0, y0 + 0.4, (QUAY_S0 + QUAY_S1) / 2);
    q.receiveShadow = true;
    ctx.mesh(q);
    // a kerb of iron along the quay edge, and mooring posts
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, len), iron);
    kerb.position.set(-QUAY_EDGE + 0.15, y0 + 1.55, (QUAY_S0 + QUAY_S1) / 2);
    ctx.mesh(kerb);
    for (let z = QUAY_S0 + 4; z < QUAY_S1; z += 8) ctx.cyl(-QUAY_EDGE + 0.4, y0 + 1.9, z, 0.25, 1, iron);
    // the camp: crates, drums, an awning over a table, a weapons rack
    // the camp keeps to the back of the quay: the bikes' two lines run clear down its front
    const crates: [number, number, number][] = [[21, -12, 1.2], [22, -10.5, 1], [21.5, 24, 1.3], [21, 38, 1], [20.5, 40.5, 1.2]];
    for (const [x, z, s] of crates) ctx.box(x, y0 + 1.4 + s / 2, z, s, s, s, rust);
    for (const [x, z] of [[16, -12], [17, -11], [21, 3], [21.5, 38]]) ctx.cyl(x, y0 + 1.4 + 0.5, z, 0.4, 1, iron);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 8), ctx.paint(0x6a2a1a, { rough: 0.9 }));
    awning.position.set(19, y0 + 4.6, -4);
    awning.rotation.z = 0.1;
    ctx.mesh(awning);
    for (const [x, z] of [[16.2, -7.8], [16.2, -0.2], [21.8, -7.8], [21.8, -0.2]]) ctx.cyl(x, y0 + 1.4 + 1.6, z, 0.1, 3.2, iron);
    ctx.box(19, y0 + 2.0, -4, 2.2, 0.15, 3.5, rust);
    const lampPost = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), amber);
    lampPost.position.set(19, y0 + 4.2, -4);
    ctx.mesh(lampPost);
    const campLight = new THREE.PointLight(0xffb060, 40, 30, 1.6);
    campLight.position.set(18, y0 + 5, 4);
    ctx.mesh(campLight);
  }

  // ---- the gates: a pirate toll arch over the river at each checkpoint ----
  const gateLamps: THREE.Mesh[][] = [];
  for (const gs of GATES) {
    const w = halfWidth(gs) + 0.8;
    const h = gs < TUNNEL_END ? 11 : 13;
    const lamps: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const p = at(gs, side * w);
      ctx.cyl(p.x, lavaY(gs) + h / 2 - 1, p.z, 0.7, h + 2, iron);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 0.8, 0.8), iron);
    const c = at(gs, 0);
    beam.position.set(c.x, lavaY(gs) + h, c.z);
    beam.rotation.y = lane.heading(gs) + Math.PI / 2;
    ctx.mesh(beam);
    for (let k = -3; k <= 3; k++) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), amber.clone());
      ctx.own(lamp.material as THREE.Material);
      const lp = at(gs, (k / 3) * (w - 1.5));
      lamp.position.set(lp.x, lavaY(gs) + h - 0.7, lp.z);
      ctx.mesh(lamp);
      lamps.push(lamp);
    }
    gateLamps.push(lamps);
  }

  // ---- the falls: a curtain of lava at each lip, and the crust ramp beside it ----
  const curtainMat = new THREE.MeshBasicMaterial({ color: 0xffa040, side: THREE.DoubleSide });
  ctx.own(curtainMat);
  ctx.tile(curtainMat as unknown as THREE.MeshStandardMaterial, 'lava_flow', 1, 3);
  const curtains: THREE.Mesh[] = [];
  LIPS.forEach((lip, k) => {
    const [ra, rb] = RAMPS[k];
    // the lavafall: the full width but the ramp, a hand's breadth proud of the step
    for (const [l0, l1] of [[-wallLat(lip, -1) - 2, ra], [rb, wallLat(lip, 1) + 2]] as const) {
      const c = strip(lip - 0.2, lip + 3.2, 0.85, (s) => {
        const out: [number, number][] = [];
        for (let i = 0; i <= 6; i++) out.push([THREE.MathUtils.lerp(l0, l1, i / 6), lavaY(s) + 0.12]);
        return out;
      }, curtainMat, 3, false);
      curtains.push(c);
    }
    // the ramp: a slab of cooled crust bouncing down beside the fall
    strip(lip - 2, lip + 16, 1, (s) => {
      const out: [number, number][] = [];
      for (let i = 0; i <= 4; i++) {
        const lat = THREE.MathUtils.lerp(ra, rb, i / 4);
        const edge = i === 0 || i === 4 ? -0.25 : 0;
        out.push([lat, rampY(s, THREE.MathUtils.clamp(lat, ra + 0.01, rb - 0.01)) - 0.3 + edge]);
      }
      return out;
    }, crust, 4);
    // and the lip's own rock shelf either side of the ramp, so the step reads
    for (const [l0, l1] of [[-wallLat(lip, -1), ra], [rb, wallLat(lip, 1)]] as const) {
      strip(lip - 3, lip - 0.2, 1.4, (s) => [[l0, lavaY(s) + 0.3], [l1, lavaY(s) + 0.3]], crust, 4, false);
    }
  });

  // ---- crust islands, spires ----
  for (const i of ISLANDS) {
    const geo = new THREE.CylinderGeometry(1, 1.15, 1, 9);
    ctx.own(geo);
    const m = new THREE.Mesh(geo, crust);
    const p = at(i.s, i.lat);
    m.position.set(p.x, lavaY(i.s) + 0.05, p.z);
    m.scale.set(i.rl * 1.05, 1, i.rs * 1.05);
    m.rotation.y = lane.heading(i.s);
    m.receiveShadow = true;
    ctx.mesh(m);
  }
  for (const [s, lat] of SPIRES) {
    const p = at(s, lat);
    const h = 6 + ((s * 13) % 5);
    ctx.cyl(p.x, lavaY(s) + h / 2 - 1, p.z, 1.3, h + 2, rock);
  }

  // ---- the chamber: the landing, the far wall, the tunnel and its fence ----
  {
    const yl = lavaY(LEN);
    const hdg = lane.heading(LEN);
    const c = at((LANDING + LEN) / 2, 0);
    const land = new THREE.Mesh(new THREE.BoxGeometry(34, 2.2, LEN - LANDING + 2), slab);
    land.position.set(c.x, yl, c.z);
    land.rotation.y = hdg;
    land.receiveShadow = true;
    ctx.mesh(land);
    // the far wall and the tunnel mouth in it
    const f = at(LEN + 1, 0);
    const wall = (lat: number, y: number, w: number, h: number, d = 2): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rock);
      const p = at(LEN + 1, lat);
      m.position.set(p.x, y, p.z);
      m.rotation.y = hdg;
      ctx.mesh(m);
    };
    wall(-17.5, yl + 30, 29, 64);
    wall(17.5, yl + 30, 29, 64);
    wall(0, yl + 1.1 + 6 + 20, 6, 40);
    // the tunnel beyond: six metres wide and tall, twelve deep, to the shaft's glow
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 14), rock);
      const p = at(LEN + 8, side * 4);
      m.position.set(p.x, yl + 1.1 + 3, p.z);
      m.rotation.y = hdg;
      ctx.mesh(m);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 14), rock);
    const rp = at(LEN + 8, 0);
    roof.position.set(rp.x, yl + 1.1 + 7, rp.z);
    roof.rotation.y = hdg;
    ctx.mesh(roof);
    // the tunnel's floor, and the shaft's glow at its far end: the Chimney's
    // floor is lit by the magma below it, so the light is low and warm
    const tfloor = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 15), slab);
    const tf = at(LEN + 7.5, 0);
    tfloor.position.set(tf.x, yl + 1.1 - 0.5, tf.z);
    tfloor.rotation.y = hdg;
    ctx.mesh(tfloor);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xc8501c });
    ctx.own(glowMat);
    const shaftGlow = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), glowMat);
    const sg = at(LEN + 15, 0);
    shaftGlow.position.set(sg.x, yl + 1.1 + 3, sg.z);
    shaftGlow.rotation.y = hdg + Math.PI;
    ctx.mesh(shaftGlow);
    // the fence: two pylons, a faint pane, and the beams strung between them
    // — the Chimney opens on its far side, with this same fence behind it
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(6, 5.5), fenceMat);
    pane.position.set(f.x, yl + 1.1 + 2.8, f.z);
    pane.rotation.y = hdg;
    ctx.mesh(pane);
    for (const side of [-1, 1]) {
      const p = at(LEN + 0.6, side * 2.8);
      ctx.cyl(p.x, yl + 1.1 + 3, p.z, 0.35, 6, iron);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4a2a }));
      ctx.own(cap.geometry);
      ctx.own(cap.material as THREE.Material);
      cap.position.set(p.x, yl + 1.1 + 6.2, p.z);
      ctx.mesh(cap);
    }
    for (let k = 0; k < 7; k++) {
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xff4020, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      ctx.own(beamMat);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.06, 0.06), beamMat);
      ctx.own(beam.geometry);
      beam.position.set(f.x, yl + 1.1 + 0.5 + k * 0.75, f.z);
      beam.rotation.y = hdg;
      ctx.mesh(beam);
      fenceBeams.push(beam);
    }
    // the landing: mooring bollards along its lip, lamps by the fence, the
    // crew's gear stacked against the wall
    for (let lat = -13; lat <= 13; lat += 3.25) {
      const b = at(LANDING + 0.9, lat);
      ctx.cyl(b.x, yl + 1.1 + 0.45, b.z, 0.22, 0.9, iron);
    }
    for (const side of [-1, 1]) {
      const lp = at(LEN - 2, side * 6);
      ctx.cyl(lp.x, yl + 1.1 + 2, lp.z, 0.12, 4, iron);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), amber);
      ctx.own(bulb.geometry);
      bulb.position.set(lp.x, yl + 1.1 + 4.1, lp.z);
      ctx.mesh(bulb);
    }
    for (const [ls, lat, sz] of [[LEN - 5, 11, 1.2], [LEN - 4, 12.3, 1], [LEN - 6.5, 12, 0.9], [LEN - 4, -11.5, 1.3]] as const) {
      const cp = at(ls, lat);
      ctx.box(cp.x, yl + 1.1 + sz / 2, cp.z, sz, sz, sz, rust);
    }
    const chamberLight = new THREE.PointLight(0xff7a30, 60, 90, 1.4);
    chamberLight.position.copy(at(1880, 0, 18));
    ctx.mesh(chamberLight);
  }

  // ---- the lane's edge in the chamber: a rubble berm between river and lake ----
  for (const side of [-1, 1] as const) {
    strip(CHAMBER + 20, 1950, 3, (s) => {
      const w = halfWidth(s) + 0.9;
      const n = noise(s, side * 7);
      return [
        [side * (w - 0.4), lavaY(s) - 0.5],
        [side * (w + 0.4), lavaY(s) + 1.6 + n * 0.8],
        [side * (w + 1.6), lavaY(s) + 1.2 + n],
        [side * (w + 2.6), lavaY(s) - 0.5],
      ];
    }, crust, 4);
  }

  // ------------------------------------------------------------ hazards

  // ---- the columns ----
  type Column = {
    s: number; side: -1 | 1; state: 'stand' | 'crack' | 'fall' | 'down'; t: number;
    hinge: THREE.Group; crack: THREE.Mesh; line: THREE.Mesh; cyls: ReturnType<SectionContext['cyl']>[];
  };
  const colGeo = new THREE.CylinderGeometry(1.5, 1.6, COLUMN_LEN, 6);
  ctx.own(colGeo);
  colGeo.translate(0, COLUMN_LEN / 2, 0);
  const columns: Column[] = COLUMNS.map((c) => {
    const base = at(c.s, c.side * (halfWidth(c.s) + 1.2));
    base.y = lavaY(c.s) - 0.4;
    const root = new THREE.Group();
    root.position.copy(base);
    root.rotation.y = lane.heading(c.s);
    const hinge = new THREE.Group();
    root.add(hinge);
    const col = new THREE.Mesh(colGeo, rock);
    col.castShadow = true;
    hinge.add(col);
    // the tell: a seam of light at the foot, brightening as it cracks
    const crackMat = hot.clone();
    crackMat.blending = THREE.AdditiveBlending;
    ctx.own(crackMat);
    const crack = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.9, 1.6, 6), crackMat);
    ctx.own(crack.geometry);
    crack.position.y = 1.0;
    root.add(crack);
    // and where it will land: a shadow of heat laid across the river, so the
    // gap is readable before the column is down
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xff3a10, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    ctx.own(lineMat);
    // the root is turned to the lane, so its +x is the left bank: a column
    // on the left wall falls toward -x, one on the right toward +x
    const line = new THREE.Mesh(new THREE.PlaneGeometry(COLUMN_LEN, 3.2), lineMat);
    ctx.own(line.geometry);
    line.rotation.x = -Math.PI / 2;
    line.position.set(c.side * COLUMN_LEN / 2, 0.5, 0);
    root.add(line);
    ctx.mesh(root);
    return { s: c.s, side: c.side, state: 'stand', t: 0, hinge, crack, line, cyls: [] };
  });

  // ---- the geysers ----
  type Geyser = {
    s: number; lat: number; state: 'idle' | 'warn' | 'erupt'; t: number; wait: number;
    disc: THREE.Mesh; plume: THREE.Mesh; hit: Set<object>;
  };
  const discGeo = new THREE.CircleGeometry(3.2, 20);
  ctx.own(discGeo);
  const plumeGeo = new THREE.CylinderGeometry(1.2, 2.6, 14, 10, 1, true);
  ctx.own(plumeGeo);
  plumeGeo.translate(0, 7, 0);
  const geysers: Geyser[] = GEYSERS.map(([s, lat], i) => {
    const p = at(s, lat);
    const discMat = hot.clone();
    discMat.blending = THREE.AdditiveBlending;
    ctx.own(discMat);
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(p.x, lavaY(s) + 0.08, p.z);
    ctx.mesh(disc);
    const plumeMat = new THREE.MeshBasicMaterial({
      color: 0xff7a22, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    ctx.own(plumeMat);
    const plume = new THREE.Mesh(plumeGeo, plumeMat);
    plume.position.set(p.x, lavaY(s), p.z);
    plume.visible = false;
    ctx.mesh(plume);
    return { s, lat, state: 'idle', t: 0, wait: 0.5 + (i % 3) * 0.9, disc, plume, hit: new Set() };
  });

  // ------------------------------------------------------------ state

  const rides = new RideLedger(ctx);
  const bikeOpts = { lane, gun: BIKE_CANNON, sideSwing: true, pillion: BIKE_PILLION, respawns: false };
  const hostileBikeOpts = { lane, gun: BIKE_CANNON_HOSTILE, sideSwing: true, respawns: false };
  /** the players' bikes at the quay, by slot, and whether each has been taken */
  const quayBikes: (Vehicle | null)[] = [];
  const crewBikes: Vehicle[] = [];
  const crewRiders: Enemy[] = [];
  const campCrew: Enemy[] = [];
  let started = false;
  let complete = false;
  let finishT = 0;
  let chased = false;
  let reached = 0;             // the furthest gate a living player has passed
  let waveIdx = 0;
  let leadS = -BEFORE;
  let tailS = -BEFORE;
  let leadSpeed = CRUISE;
  let stretchSaid = -1;
  let wiped = false;
  const onFoot = [0, 0, 0, 0];
  const grace = [0, 0, 0, 0];
  const wasAlive = [true, true, true, true];
  const lastGood: THREE.Vector3[] = [0, 1, 2, 3].map(() => new THREE.Vector3());
  const lastGoodE = new WeakMap<Enemy, THREE.Vector3>();
  const cursors = [0, 0, 0, 0];
  /** what happened, for tuning and the tests */
  const stats = { lavaKills: 0, unseated: 0, playerDeaths: 0, freshBikes: 0, crushed: 0, geysered: 0, rammed: 0 };
  const riding = new WeakSet<Enemy>();
  const burning: { e: Enemy; t: number }[] = [];

  const followLight = new THREE.PointLight(0xff6a20, 55, 55, 1.4);

  ctx.mesh(followLight);

  // ------------------------------------------------------------ the barge

  interface Barge {
    hull: Vehicle; deck: Mover; deckBox: THREE.Box3 | null;
    gun: Vehicle; crew: Enemy[]; helm: Enemy; gunner: Enemy;
    s: number; lat: number; speed: number;
    state: 'running' | 'holding' | 'sinking' | 'gone'; sinkT: number;
    boom: THREE.Group; boomDrop: number; rammed: Map<Vehicle, number>;
  }
  /**
   * The barge's fighting deck over the keel. Raised on a platform over the
   * skiff's own low cargo deck: a crew stood on the cargo deck was inside the
   * hull's hit spheres, so every bolt aimed at them spent itself on the plate.
   */
  const deckTop = (): number => 1.75;
  const spawnBarge = (): void => {
    const s = Math.min(MOUTH - 60, leadS + 120);
    const p = at(s, 0);
    const hdg = lane.heading(s);
    const hull = rides.add({ kind: 'skiff', x: p.x, z: p.z, y: lavaY(s), yaw: hdg },
      { lane, respawns: false, hp: 420 });
    hull.scripted = true;
    const top = hull.pos.y + deckTop();
    // the deck the crew stands on: a moving box the engine carries them on
    const { box } = ctx.box(p.x, top - 1.2, p.z, 3.0, 2.4, 8.6, null);
    // the platform itself: plating on posts over the cargo deck, with a rail
    const plate = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.22, 8.2), rust);
    ctx.own(plate.geometry);
    plate.position.set(0, deckTop() - 0.11, 0);
    plate.castShadow = plate.receiveShadow = true;
    hull.group.add(plate);
    for (const [px, pz] of [[1.3, 3.6], [-1.3, 3.6], [1.3, -3.6], [-1.3, -3.6], [1.3, 0], [-1.3, 0]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, deckTop(), 0.18), iron);
      ctx.own(post.geometry);
      post.position.set(px, deckTop() / 2, pz);
      hull.group.add(post);
    }
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 8.0), iron);
      ctx.own(rail.geometry);
      rail.position.set(side * 1.45, deckTop() + 0.9, 0);
      hull.group.add(rail);
    }
    const deck = new Mover(box, null);
    (ctx.board.movers ??= []).push(deck);
    // a mast with a red lamp and a light on it: the barge reads across the
    // chamber, and the party knows which thing on the lava is the fight
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 5.5, 6), iron);
    ctx.own(mast.geometry);
    mast.position.set(0, deckTop() + 2.75, 2.6);
    hull.group.add(mast);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3a1a }));
    ctx.own(lamp.geometry);
    ctx.own(lamp.material as THREE.Material);
    lamp.position.set(0, deckTop() + 5.6, 2.6);
    hull.group.add(lamp);
    const bargeLight = new THREE.PointLight(0xff5a2a, 45, 38, 1.5);
    bargeLight.position.set(0, deckTop() + 4.8, 1.2);
    hull.group.add(bargeLight);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), ctx.paint(0x7a1a12, { rough: 0.9 }));
    ctx.own(banner.geometry);
    (banner.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    banner.position.set(0, deckTop() + 4.6, 2.6 - 0.85);
    banner.rotation.y = Math.PI / 2;
    hull.group.add(banner);
    const helm = ctx.spawn('pirate', hull.localPoint(0, deckTop(), -1.6, new THREE.Vector3()), { exact: true, alert: true });
    rides.seat(hull, helm);
    const gun = rides.add({ kind: 'turret', x: p.x, z: p.z, y: top, yaw: hdg + Math.PI },
      { team: 1, respawns: false, gun: FLAK, turret: { auto: 0, yawArc: Math.PI * 0.8, autoRange: 80 } });
    const gunner = ctx.spawn('pirate', gun.pos.clone(), { exact: true, alert: true });
    rides.seat(gun, gunner);
    const crew: Enemy[] = [];
    const spots: [number, number][] = [[0.9, 3.3], [-0.9, 3.0], [0.9, 1.6], [-0.9, -0.2]];
    const n = 3 + (party >= 3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const [lx, lz] = spots[i];
      crew.push(ctx.spawn('pirate', hull.localPoint(lx, deckTop() + 0.05, lz, new THREE.Vector3()), { exact: true, alert: true }));
    }
    // the boom: a red-hot chain from the barge's stern to the mouth's pylons
    const boom = new THREE.Group();
    const linkMat = new THREE.MeshBasicMaterial({ color: 0xff5020 });
    ctx.own(linkMat);
    const linkGeo = new THREE.BoxGeometry(0.35, 0.35, 1.1);
    ctx.own(linkGeo);
    for (let k = -10; k <= 10; k++) {
      const link = new THREE.Mesh(linkGeo, linkMat);
      link.position.set(0, 0, k * 1.05);
      link.rotation.z = k % 2 ? Math.PI / 4 : 0;
      boom.add(link);
    }
    const bp = at(MOUTH, 0);
    boom.position.set(bp.x, lavaY(MOUTH) + 1.2, bp.z);
    boom.rotation.y = lane.heading(MOUTH) + Math.PI / 2;
    ctx.mesh(boom);
    for (const side of [-1, 1]) {
      const pp = at(MOUTH, side * (halfWidth(MOUTH) + 0.8));
      ctx.cyl(pp.x, lavaY(MOUTH) + 2, pp.z, 0.6, 5, iron);
    }
    barge = {
      hull, deck, deckBox: null, gun, crew, helm, gunner, s, lat: 0, speed: CRUISE,
      state: 'running', sinkT: 0, boom, boomDrop: 0, rammed: new Map(),
    };
    ctx.announce(T.bargeUp, T.bargeSub);
    audio.bossHorn?.();
  };
  /** every hostile the barge carries, alive */
  const bargeCrew = (b: Barge): Enemy[] => [b.helm, b.gunner, ...b.crew].filter((e) => e.alive);

  /**
   * The barge's frame: it runs forty metres ahead of the leader down the
   * middle of the lane, raking back with the flak, and holds at the mouth
   * with the boom across it. Moved on the board's own tick, before the
   * engine carries the riders on its deck, so the crew stand on it rather
   * than a frame behind it.
   */
  const moveBarge = (dt: number): void => {
    const b = barge;
    if (!b || b.state === 'gone') return;
    if (b.state === 'sinking') {
      b.sinkT += dt;
      const y = lavaY(b.s) + VEHICLE_DEFS.skiff.hover - b.sinkT * 1.1;
      b.hull.place(b.hull.pos.x, y, b.hull.pos.z, b.hull.yaw);
      b.hull.group.rotation.z = b.sinkT * 0.12;
      if (b.sinkT > 0.8 && b.deckBox === null) {
        // the deck goes out from under the crew
        ctx.board.physics.boxes = ctx.board.physics.boxes.filter((x) => x !== b.deck.box);
        b.deckBox = new THREE.Box3();
      }
      b.boomDrop = Math.min(1, b.boomDrop + dt * 0.8);
      b.boom.position.y = lavaY(MOUTH) + 1.2 - b.boomDrop * 2.2;
      if (b.sinkT > 3) {
        b.state = 'gone';
        b.hull.group.visible = false;
        rides.drop(b.hull);
        if (b.gun.alive || b.gun.group.visible) rides.drop(b.gun);
      }
      return;
    }
    const hold = MOUTH - 9;
    const want = Math.min(hold, leadS + 40);
    b.speed = clamp(leadSpeed + (want - b.s) * 0.6, 0, 27);
    if (b.s >= hold - 0.3) { b.speed = 0; b.state = 'holding'; }
    b.s = Math.min(hold, b.s + b.speed * dt);
    b.lat = damp(b.lat, b.state === 'holding' ? 0 : Math.sin(game.time * 0.35) * 3.5, 1.5, dt);
    const p = lane.point(b.s, b.lat, new THREE.Vector3());
    const hdg = lane.heading(b.s);
    const vx = Math.sin(hdg) * b.speed, vz = Math.cos(hdg) * b.speed;
    const bob = Math.sin(game.time * 1.3) * 0.06;
    b.hull.place(p.x, lavaY(b.s) + VEHICLE_DEFS.skiff.hover + bob, p.z, hdg, vx, vz);
    const top = b.hull.pos.y + deckTop();
    b.deck.moveTo(p.x, top - 1.2, p.z);
    b.gun.moveMount(...b.hull.localPoint(0, deckTop(), 0.3, new THREE.Vector3()).toArray() as [number, number, number], hdg + Math.PI);
  };
  const boardUpdate = ctx.board.update;
  ctx.board.update = (dt, time, g) => { boardUpdate?.(dt, time, g); moveBarge(dt); };

  const updateBarge = (dt: number): void => {
    const b = barge;
    if (!b || b.state === 'gone' || b.state === 'sinking') return;
    // a bike boosting into the hull is a ram: the barge takes it, and the crew is thrown
    for (const v of rides.list) {
      const r = v.rider;
      if (!v.alive || !r || v === b.hull) continue;
      const d = Math.hypot(v.pos.x - b.hull.pos.x, v.pos.z - b.hull.pos.z);
      if (d > 5.5) continue;
      const closing = Math.hypot(v.vel.x - b.hull.vel.x, v.vel.z - b.hull.vel.z);
      const until = b.rammed.get(v) ?? 0;
      if (game.time < until || closing < 9) continue;
      b.rammed.set(v, game.time + 1.2);
      stats.rammed++;
      b.hull.damage(closing * 5, v.pos, r.slot, 'crash');
      for (const e of bargeCrew(b)) {
        if (e === b.helm || e === b.gunner) continue;
        if (Math.random() < 0.5) { e.knockback(v.pos, 10, 0.5); e.knockdown(1.5); }
      }
      game.particles.impactSparks(v.pos.clone().setY(v.pos.y + 1), 24);
      audio.explosion();
      r.cam.shake(0.3);
      game.hitMarker(r.slot);
    }
    // beaten: the hull broken, or nobody left aboard to sail it and work the gun
    const hands = bargeCrew(b);
    const gunnerDown = !b.gunner.alive && !b.gun.hostile;
    if (!b.hull.alive || hands.length === 0 || (gunnerDown && !b.helm.alive)) {
      b.state = 'sinking';
      b.sinkT = 0;
      if (b.hull.alive) b.hull.scripted = true;
      ctx.announce(T.bargeDown, T.bargeDownSub);
      audio.explosion();
      for (const e of hands) { e.knockback(b.hull.pos, 6, 0.4); }
    }
    void dt;
  };

  // ------------------------------------------------------------ helpers

  /** a living player's place on the lane: their bike's, or where they stand */
  const sOf = (p: Player): number => (p.vehicle?.lane ? p.vehicle.laneS : lane.project(p.position.x, p.position.z).s);

  const giveBike = (p: Player, s: number, lat: number, speed: number): Vehicle => {
    const hdg = lane.heading(s);
    const pt = at(s, lat);
    const v = rides.add({ kind: 'speederBike', x: pt.x, z: pt.z, y: floorAt(s, lat), yaw: hdg }, bikeOpts);
    v.vel.set(Math.sin(hdg) * speed, 0, Math.cos(hdg) * speed);
    if (p.vehicle) p.vehicle.dropRider(p);
    v.mount(p);
    p.cam.yaw = hdg;
    p.cam.pitch = -0.17;
    grace[p.slot] = 1.2;
    onFoot[p.slot] = 0;
    return v;
  };

  /** a clear lane offset at `s` — away from spires and fallen columns */
  const clearLat = (s: number, prefer: number): number => {
    const hw = halfWidth(s) - 2;
    let best = prefer, bestCost = Infinity;
    for (let lat = -hw; lat <= hw; lat += 1) {
      if (dangerAt(s, lat, 0) || dangerAt(s + 12, lat, 0)) continue;
      const cost = Math.abs(lat - prefer);
      if (cost < bestCost) { bestCost = cost; best = lat; }
    }
    return best;
  };

  const spawnRider = (role: Role, from: 'behind' | 'ahead'): void => {
    const s = from === 'ahead' ? Math.min(LEN - 200, leadS + 60) : Math.max(tailS - 45, -5);
    if (s < 45) return;
    const lat = clearLat(s, (Math.random() - 0.5) * 16);
    const kind: EnemyKind = role === 'swinger' ? 'pirateMelee' : 'pirate';
    const pt = at(s, lat);
    const hdg = lane.heading(s);
    const v = rides.add({ kind: 'speederBike', x: pt.x, z: pt.z, y: lavaY(s), yaw: hdg }, hostileBikeOpts);
    const e = ctx.spawn(kind, pt.clone().setY(pt.y + 1.2), { exact: true, alert: true });
    rides.seat(v, e);
    v.brain.role = role;
    v.brain.side = Math.random() < 0.5 ? -1 : 1;
    const speed = from === 'ahead' ? 15 : 29;
    v.vel.set(Math.sin(hdg) * speed, 0, Math.cos(hdg) * speed);
  };

  const spawnSwoop = (): void => {
    const s = Math.min(LEN - 250, leadS + 110 + Math.random() * 30);
    const side = Math.random() < 0.5 ? -1 : 1;
    const pt = at(s, side * (halfWidth(s) - 2));
    pt.y = lavaY(s) + 12;
    ctx.spawn('nikto', pt, { exact: true, alert: true });
  };

  // ------------------------------------------------------------ danger

  /**
   * Is there something at (s, lat) a bike should not be — a spire, a fallen
   * column, one about to fall across it, a geyser going up, the barge? For the
   * autopilot's line, and for placing riders clear of trouble.
   */
  const dangerAt = (s: number, lat: number, pad: number): boolean => {
    for (const [ss, sl] of SPIRES) if (Math.abs(ss - s) < 3.2 + pad && Math.abs(sl - lat) < 2.9 + pad) return true;
    for (const c of columns) {
      if (c.state === 'stand' || Math.abs(c.s - s) > 3.4 + pad) continue;
      const base = c.side * (halfWidth(c.s) + 1.2);
      const tip = base - c.side * COLUMN_LEN;
      const lo = Math.min(base, tip) - 1.8 - pad, hi = Math.max(base, tip) + 1.8 + pad;
      if (lat > lo && lat < hi) return true;
    }
    for (const g of geysers) {
      if (g.state === 'idle') continue;
      if (Math.abs(g.s - s) < 4.5 + pad && Math.abs(g.lat - lat) < 4.5 + pad) return true;
    }
    const b = barge;
    if (b && (b.state === 'running' || b.state === 'holding')) {
      if (Math.abs(b.s - s) < 7 + pad && Math.abs(b.lat - lat) < 3.2 + pad) return true;
    }
    return false;
  };

  // ------------------------------------------------------------ path

  const tz = (ALCOVE_S0 + ALCOVE_S1) / 2;
  const path: THREE.Vector3[] = [
    new THREE.Vector3(40.5, lavaY(10) + 1.4 + RAMP_RISE, tz),
    new THREE.Vector3(21, lavaY(10) + 1.4, tz),
    new THREE.Vector3(12.5, lavaY(10) + 1.4, 16),
    at(GATES[0], -4), at(GATES[1], 0), at(GATES[2], 0), at(GATES[3], 0),
    at(MOUTH, 0), at(LANDING + 20, 0, 1.1),
  ];

  // ------------------------------------------------------------ update

  const start = (): void => {
    started = true;
    const y0 = lavaY(10) + 1.4;
    // one bike per player at the quay, and the crew's own two further along
    for (let i = 0; i < party; i++) {
      quayBikes.push(rides.add({ kind: 'speederBike', x: 11.8, z: 2 + i * 5, y: y0, yaw: 0 }, bikeOpts));
    }
    for (let i = 0; i < 2; i++) {
      crewBikes.push(rides.add({ kind: 'speederBike', x: 16.5, z: 27 + i * 5.5, y: y0, yaw: 0 }, hostileBikeOpts));
    }
    // the camp: a squad from the board's own table round the awning, and the
    // two riders by their bikes
    const kinds = ctx.squadFor(ctx.wave, Math.min(6, 2 + party));
    kinds.forEach((kind, i) => {
      const spot = new THREE.Vector3(19 + (i % 2) * 2.5, y0, -8 + i * 6);
      campCrew.push(ctx.spawn(kind, spot, { exact: true, squad: 8850 }));
    });
    crewRiders.push(ctx.spawn('pirateMelee', new THREE.Vector3(19, y0, 28), { exact: true, squad: 8850 }));
    crewRiders.push(ctx.spawn('pirate', new THREE.Vector3(19.5, y0, 33.5), { exact: true, squad: 8850 }));
    // bacta on the islands, for whoever steers over it
    for (const i of [ISLANDS[1], ISLANDS[3], ISLANDS[5]]) ctx.pickup(at(i.s, i.lat, 0.95));
    ctx.pickup(new THREE.Vector3(19, y0 + 0.2, 20));
    ctx.checkpoint.copy(path[1]);
    ctx.announce(T.title, T.sub);
  };

  const updateColumns = (dt: number): void => {
    for (const c of columns) {
      if (c.state === 'down') continue;
      if (c.state === 'stand') {
        // cracks so that it lands a breath before the leader gets there
        const eta = (c.s - leadS) / Math.max(8, leadSpeed);
        if (leadS < c.s - 4 && eta < 3.3 && eta > 0) {
          c.state = 'crack';
          c.t = 0;
          audio.thunder(0.35);
          if (c === columns[0]) ctx.announce(T.columns);
        }
        continue;
      }
      c.t += dt;
      const cm = c.crack.material as THREE.MeshBasicMaterial;
      const lm = c.line.material as THREE.MeshBasicMaterial;
      if (c.state === 'crack') {
        cm.opacity = Math.min(0.95, c.t / 0.9) * (0.7 + 0.3 * Math.sin(game.time * 30));
        lm.opacity = Math.min(0.55, c.t / 1.2) * (0.75 + 0.25 * Math.sin(game.time * 12));
        c.hinge.rotation.z = -c.side * Math.sin(game.time * 40) * 0.01 * c.t;
        if (Math.random() < dt * 20) game.particles.impactSparks(c.crack.getWorldPosition(new THREE.Vector3()), 3);
        if (c.t >= 1.6) { c.state = 'fall'; c.t = 0; }
        continue;
      }
      // falling: slow off the foot, fast at the end
      const k = Math.min(1, c.t / 0.95);
      c.hinge.rotation.z = -c.side * k * k * 1.52;
      cm.opacity = 0.9 * (1 - k);
      lm.opacity = 0.6 * (1 - k * k);
      if (k >= 1) {
        c.state = 'down';
        const base = c.side * (halfWidth(c.s) + 1.2);
        const hitLat = [base - c.side * COLUMN_LEN, base];
        const lo = Math.min(...hitLat) - 1.6, hi = Math.max(...hitLat) + 1.6;
        // the column lies across the river: a hop clears it, a bike does not
        for (let d = 1; d < COLUMN_LEN; d += 2) {
          const p = at(c.s, base - c.side * d);
          c.cyls.push(ctx.cyl(p.x, lavaY(c.s) + 0.5, p.z, 1.1, 2.2, null));
        }
        const mid = at(c.s, base - c.side * COLUMN_LEN / 2);
        game.particles.dustPuff(mid.setY(lavaY(c.s) + 1), 30);
        game.particles.impactSparks(mid, 30);
        audio.explosion();
        // anything under it as it lands is crushed
        for (const v of game.vehicles) {
          if (!v.alive || v.scripted) continue;
          const on = lane.project(v.pos.x, v.pos.z, v.laneS);
          if (Math.abs(on.s - c.s) < 2.2 && on.lat > lo && on.lat < hi) { v.damage(80, mid, -1, 'crash'); stats.crushed++; }
        }
        for (const p of game.players) {
          if (!p.alive) continue;
          const on = lane.project(p.position.x, p.position.z);
          if (Math.abs(on.s - c.s) < 12) p.cam.shake(0.25);
          if (!p.vehicle && Math.abs(on.s - c.s) < 2.2 && on.lat > lo && on.lat < hi) p.damage(60, mid, -1, { heavy: true });
        }
      }
    }
  };

  const updateGeysers = (dt: number): void => {
    for (const g of geysers) {
      const near = g.s - leadS < 170 && g.s - tailS > -40;
      const dm = g.disc.material as THREE.MeshBasicMaterial;
      if (g.state === 'idle') {
        dm.opacity = damp(dm.opacity, 0.12, 3, dt);
        if (!near) continue;
        g.wait -= dt;
        if (g.wait <= 0) { g.state = 'warn'; g.t = 0; g.hit.clear(); }
        continue;
      }
      g.t += dt;
      if (g.state === 'warn') {
        dm.opacity = 0.2 + Math.min(1, g.t / 1.3) * 0.75 * (0.8 + 0.2 * Math.sin(game.time * 24));
        g.disc.scale.setScalar(0.6 + 0.4 * Math.min(1, g.t / 1.3));
        if (Math.random() < dt * 14) game.particles.impactSparks(g.disc.position, 2);
        if (g.t >= 1.3) {
          g.state = 'erupt';
          g.t = 0;
          g.plume.visible = true;
          if (Math.abs(g.s - leadS) < 80) audio.geyser(0.55);
        }
        continue;
      }
      // erupting: a column of fire, and whatever is in it is thrown up
      const k = g.t / 1.1;
      g.plume.scale.set(1 + Math.sin(game.time * 31) * 0.08, Math.min(1, g.t * 5) * (1 - Math.max(0, k - 0.75) * 4), 1);
      g.plume.rotation.y += dt * 3;
      if (Math.random() < dt * 30) {
        game.particles.impactSparks(g.plume.position.clone().setY(g.plume.position.y + 2 + Math.random() * 10), 5);
      }
      (g.plume.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - Math.max(0, k - 0.6) * 2.5);
      dm.opacity = 1;
      const c = g.disc.position;
      for (const v of game.vehicles) {
        if (!v.alive || g.hit.has(v) || v.scripted) continue;
        if (Math.hypot(v.pos.x - c.x, v.pos.z - c.z) > 3.4 || v.pos.y > c.y + 12) continue;
        g.hit.add(v);
        v.damage(38, c, -1);
        if (v.rider) stats.geysered++;
        v.vel.y = Math.max(v.vel.y, 9);
        if (v.rider) { v.rider.damage(8, c, -1); v.rider.cam.shake(0.2); }
      }
      for (const p of game.players) {
        if (!p.alive || p.vehicle || g.hit.has(p)) continue;
        if (Math.hypot(p.position.x - c.x, p.position.z - c.z) > 3.4) continue;
        g.hit.add(p);
        p.damage(50, c, -1, { heavy: true });
        p.velocity.y = 12;
      }
      for (const e of game.enemies) {
        if (!e.alive || e.ride || g.hit.has(e)) continue;
        if (Math.hypot(e.position.x - c.x, e.position.z - c.z) > 3.4) continue;
        g.hit.add(e);
        e.damage(80, c, -1);
      }
      if (g.t >= 1.1) {
        g.state = 'idle';
        g.plume.visible = false;
        g.wait = 1.8 + Math.random() * 2.2;
      }
    }
  };

  /** the lava: nothing without a bike under it lives on it */
  const updateLava = (dt: number): void => {
    for (const p of game.players) {
      grace[p.slot] = Math.max(0, grace[p.slot] - dt);
      if (!p.alive || p.vehicle || grace[p.slot] > 0) continue;
      const on = lane.project(p.position.x, p.position.z);
      if (solid(on.s, on.lat)) continue;
      if (p.position.y - lavaY(on.s) > 0.35) continue;
      game.particles.impactSparks(p.position.clone().setY(lavaY(on.s) + 0.2), 20);
      p.takenByHazard(p.position.clone().setY(lavaY(on.s) - 1));
    }
    for (const e of game.enemies) {
      if (!e.alive) continue;
      if (e.ride) { riding.add(e); continue; }
      if (riding.has(e)) { riding.delete(e); stats.unseated++; }
      if (e.kind === 'nikto') continue;
      const on = lane.project(e.position.x, e.position.z);
      if (solid(on.s, on.lat)) continue;
      if (e.position.y - lavaY(on.s) > 0.35) continue;
      const where = e.position.clone().setY(lavaY(on.s) + 0.2);
      game.particles.impactSparks(where, 30);
      game.particles.explosion(where, 0.35);
      if (Math.abs(on.s - leadS) < 60) audio.steamHiss(0.5);
      // the kill is whoever put him in: a swing, a sideswipe, a bolt
      e.damage(99999, e.position, e.lastHitBy);
      burning.push({ e, t: 0 });
      stats.lavaKills++;
    }
    // what the lava takes it keeps: the body burns away where it went in
    for (let i = burning.length - 1; i >= 0; i--) {
      const b = burning[i];
      b.t += dt;
      if (Math.random() < dt * 20) game.particles.disintegrate(b.e.position.clone().setY(b.e.position.y + 0.5), 2);
      if (b.t > 0.8) { b.e.removeMe = true; burning.splice(i, 1); }
    }
  };

  /**
   * Bikes for everyone who needs one: a fresh bike at the last gate for the
   * fallen, and — for anyone thrown onto crust — one where they stand after a
   * breath. A bike lost at the quay is replaced where it stood.
   */
  const updateBikes = (dt: number): void => {
    for (const p of game.players) {
      const i = p.slot;
      const back = p.alive && !wasAlive[i];
      if (!p.alive && wasAlive[i]) stats.playerDeaths++;
      wasAlive[i] = p.alive;
      if (!p.alive) { onFoot[i] = 0; continue; }
      if (p.vehicle) { onFoot[i] = 0; continue; }
      if (back && leadS > GATES[0] - 5) {
        const gs = GATES[reached] + 6;
        giveBike(p, gs, clearLat(gs, (i - 1.5) * 4), CRUISE * 0.7);
        stats.freshBikes++;
        ctx.announce(T.freshBike, T.freshBikeSub);
        continue;
      }
      const on = lane.project(p.position.x, p.position.z);
      const onQuay = on.s < QUAY_S1 && on.lat < QUAY_EDGE + 0.5;
      if (onQuay) { onFoot[i] = 0; continue; }
      // thrown clear onto crust (or stood up after an off-path catch)
      onFoot[i] += dt;
      if (onFoot[i] > 1.8) {
        const s = Math.max(on.s, GATES[reached]) + 3;
        giveBike(p, s, clearLat(s, clamp(on.lat, -halfWidth(s) + 2, halfWidth(s) - 2)), CRUISE * 0.6);
        ctx.announce(T.freshBike, T.freshBikeSub);
      }
    }
    // the quay: a player's bike shot to pieces before it was taken comes back
    quayBikes.forEach((v, i) => {
      if (!v || v.alive || v.rider) return;
      const p = game.players[i];
      if (!p || p.vehicle) return;
      quayBikes[i] = rides.add({ kind: 'speederBike', x: 11.8, z: 2 + i * 5, y: lavaY(10) + 1.4, yaw: 0 }, bikeOpts);
    });
  };

  /** bodies on foot stay inside the river's walls */
  const contain = (): void => {
    for (const p of game.players) {
      if (!p.alive || p.vehicle) continue;
      if (inside(p.position.x, p.position.z)) { lastGood[p.slot].copy(p.position); continue; }
      p.position.x = lastGood[p.slot].x;
      p.position.z = lastGood[p.slot].z;
      p.velocity.x = 0;
      p.velocity.z = 0;
    }
    for (const e of game.enemies) {
      if (!e.alive || e.ride || e.kind === 'nikto') continue;
      const good = lastGoodE.get(e);
      if (inside(e.position.x, e.position.z)) {
        if (good) good.copy(e.position); else lastGoodE.set(e, e.position.clone());
        continue;
      }
      if (good) { e.position.x = good.x; e.position.z = good.z; }
      e.velocity.x = 0;
      e.velocity.z = 0;
    }
  };

  /** hostiles the party has left well behind are done with: take them out */
  const cull = (): void => {
    for (const v of [...rides.list]) {
      if (!v.hostile || v === barge?.hull || v === barge?.gun) continue;
      if (crewBikes.includes(v) && !chased) continue;
      if (v.laneS < tailS - 160) rides.drop(v);
    }
    for (const e of game.enemies) {
      if (!e.alive || e.ride || campCrew.includes(e) || crewRiders.includes(e)) continue;
      const on = lane.project(e.position.x, e.position.z);
      if (on.s < tailS - 160) e.removeMe = true;
    }
  };

  const update = (dt: number): void => {
    if (complete) return;
    if (!started) start();

    // where the party is on the river
    let lead = -Infinity, tail = Infinity, lspd = CRUISE, any = false;
    for (const p of game.players) {
      if (!p.alive) continue;
      any = true;
      const s = sOf(p);
      if (s > lead) { lead = s; lspd = p.vehicle ? Math.hypot(p.vehicle.vel.x, p.vehicle.vel.z) : 0; }
      tail = Math.min(tail, s);
    }
    if (any) { leadS = lead; tailS = tail; leadSpeed = Math.max(SLOW, lspd); }

    // the quay: the camp wakes when its bikes go, and its riders give chase
    if (!chased && game.players.some((p) => p.vehicle)) {
      chased = true;
      ctx.announce(T.chase, T.chaseSub);
      crewRiders.forEach((e, i) => { if (e.alive && crewBikes[i]?.alive) e.boardRide(crewBikes[i]); });
      for (const e of campCrew) if (e.alive) e.alert(game.players.find((p) => p.alive)!.position, true);
    }

    // the gates: checkpoints, a chime, and the stretch's own name
    for (let k = reached + 1; k < GATES.length; k++) {
      if (leadS >= GATES[k]) {
        reached = k;
        ctx.checkpoint.copy(at(GATES[k] + 6, 0));
        audio.checkpointChime();
        for (const lamp of gateLamps[k]) (lamp.material as THREE.MeshBasicMaterial).color.set(0x7dffa0);
      }
    }
    const stretch = leadS >= 1500 ? 3 : leadS >= 1000 ? 2 : leadS >= 500 ? 1 : 0;
    if (stretch !== stretchSaid && leadS > GATES[0]) {
      stretchSaid = stretch;
      if (stretch > 0) ctx.announce(TEXT.banners.checkpoint, T.stretches[stretch]);
    }

    // the riders, wave by wave, scaled to the party
    while (waveIdx < WAVES.length && leadS >= WAVES[waveIdx].at) {
      const w = WAVES[waveIdx++];
      const riders = [...w.riders];
      if (party >= 3 && riders.length) riders.push('swinger');
      if (party >= 4 && riders.length >= 2) riders.push('gunner');
      for (const r of riders) spawnRider(r, w.from);
      for (let k = 0; k < (w.swoops ?? 0) + (party >= 3 && w.swoops ? 1 : 0); k++) spawnSwoop();
    }
    if (!barge && leadS >= 1530) spawnBarge();

    updateColumns(dt);
    updateGeysers(dt);
    updateBarge(dt);
    updateBikes(dt);
    updateLava(dt);
    contain();
    cull();
    rides.prune(dt);

    // a wipe: the party re-forms at the last gate (the campaign respawns them there)
    if (!any && !wiped) {
      wiped = true;
    } else if (any) wiped = false;

    // the lava's flow, and its light on whoever is leading
    for (const m of [lava.map, lava.emissiveMap]) if (m) m.offset.y = -game.time * 0.09;
    if (curtainMat.map) curtainMat.map.offset.y = -game.time * 0.9;
    if (fallMat.map) fallMat.map.offset.x = game.time * 0.35;
    fenceBeams.forEach((b, i) => {
      (b.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(game.time * 23 + i * 1.7);
    });
    // spray off the lips while the party is near them
    for (const lip of LIPS) {
      if (Math.abs(lip - leadS) < 90 && Math.random() < dt * 12) {
        game.particles.impactSparks(at(lip + 3.5, (Math.random() - 0.5) * 24, 0.4), 6);
      }
    }
    const lp = at(clamp(leadS + 6, -BEFORE, LEN), 0);
    followLight.position.set(lp.x, lavaY(leadS) + 5, lp.z);
    for (const [k, lamps] of gateLamps.entries()) {
      if (k <= reached) continue;
      for (const lamp of lamps) lamp.scale.setScalar(1 + 0.15 * Math.sin(game.time * 5 + k));
    }

    // the end: the barge sunk and everyone standing on the landing
    const living = game.players.filter((p) => p.alive);
    const landed = living.length > 0 && living.every((p) => sOf(p) >= LANDING + 8)
      && !bargeHolds();
    if (landed) {
      finishT += dt;
      if (finishT > 1.2) complete = true;
    } else finishT = 0;
  };

  // ------------------------------------------------------------ the rest

  const inside = (x: number, z: number): boolean => {
    const on = lane.project(x, z);
    if (on.s < -BEFORE + 2 || on.s > LEN) return false;
    if (Math.abs(on.lat) <= halfWidth(on.s)) return true;
    // the quay, the ramp and the landing in front of the door
    if (on.s > QUAY_S0 && on.s < QUAY_S1 && on.lat < 0 && on.lat > -23.5) return true;
    if (on.s > ALCOVE_S0 && on.s < ALCOVE_S1 && on.lat < 0 && on.lat > DOOR_LAT + 0.5) return true;
    return false;
  };

  const objective = () => {
    if (!game.players.some((p) => p.vehicle)) {
      // the quay: the nearest free bike
      let best: Vehicle | null = null;
      for (const v of quayBikes) if (v && v.alive && !v.rider && (!best || v.spec.z < best.spec.z)) best = v;
      const pos = best ? best.pos.clone() : path[2].clone();
      return { pos, label: T.bikes, hint: T.bikesHint, beacon: false };
    }
    const b = barge;
    if (b && (b.state === 'running' || b.state === 'holding')) {
      return {
        pos: b.hull.pos.clone().setY(b.hull.pos.y + 1.5), label: T.barge,
        hint: b.state === 'holding' ? T.bargeHold : T.hints[3], beacon: false,
      };
    }
    if (reached >= GATES.length - 1 && leadS > 1540) {
      return { pos: at(LANDING + 20, 0, 1.1), label: T.landing, hint: T.landingHint, beacon: false };
    }
    const next = Math.min(GATES.length - 1, reached + 1);
    const stretch = leadS >= 1500 ? 3 : leadS >= 1000 ? 2 : leadS >= 500 ? 1 : 0;
    return {
      pos: at(GATES[next], 0, 6), label: T.gate(next), hint: T.hints[stretch], beacon: false,
    };
  };

  const respawnSpot = (slot: number): THREE.Vector3 => {
    // before anyone has a bike, the fallen come back on the quay
    if (!game.players.some((p) => p.vehicle) && leadS < GATES[0]) {
      return ctx.defaultRespawn(slot, new THREE.Vector3(18, lavaY(10) + 1.4, 12), new THREE.Vector3(0, 0, 1));
    }
    // otherwise at the party's last gate, where a fresh bike is waiting
    const gs = GATES[reached] + 6;
    const lat = clearLat(gs, (slot - 1.5) * 4);
    const p = at(gs, lat, 0.05);
    grace[slot] = 1.5;
    return p;
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const v = p.vehicle;
    const s = p.alive ? sOf(p) : leadS;
    const stretch = s >= 1500 ? 3 : s >= 1000 ? 2 : s >= 500 ? 1 : 0;
    const bars: SectionBar[] = [];
    if (v && v.lane) {
      const spd = Math.hypot(v.vel.x, v.vel.z);
      bars.push({ label: T.speed, value: clamp(spd / TOP, 0, 1), tone: 'info' });
      bars.push({
        label: v.overheated ? T.venting : T.cannon, value: v.heat,
        tone: v.overheated ? 'danger' : v.heat > 0.7 ? 'warn' : 'good',
      });
    }
    const b = barge;
    if (b && (b.state === 'running' || b.state === 'holding')) {
      bars.push({ label: T.hull, value: clamp(b.hull.hp / b.hull.maxHp, 0, 1), tone: 'danger' });
    }
    return {
      title: T.stretches[stretch],
      bars,
      line: T.metres(Math.round(clamp(s, 0, LEN))),
    };
  };

  // ------------------------------------------------------------ autopilot

  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    const v = p.vehicle;
    if (!v) {
      // on foot at the quay: down the ramp to this slot's bike, and take it
      const bike = quayBikes[slot] && quayBikes[slot]!.alive && !quayBikes[slot]!.rider
        ? quayBikes[slot]
        : quayBikes.find((b) => b && b.alive && !b.rider) ?? null;
      const ways = [path[0], path[1], bike ? bike.pos.clone().setX(bike.pos.x + 1.6) : path[2]];
      let c = cursors[slot];
      const w = ways[Math.min(c, ways.length - 1)];
      const dx = w.x - p.position.x, dz = w.z - p.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.4 && c < ways.length - 1) c++;
      cursors[slot] = c;
      if (bike && Math.hypot(bike.pos.x - p.position.x, bike.pos.z - p.position.z) < 2.6) {
        return { slamPressed: game.time % 0.2 < 0.1, yaw: Math.atan2(dx, dz) };
      }
      return { moveY: Math.min(1, d / 2), yaw: Math.atan2(dx, dz), shootHeld: false };
    }
    if (v.pillion === p) return { shootHeld: true };
    const s = v.laneS;
    const out: AutopilotInput = { yaw: lane.heading(s) };
    // the line: the nearest lateral clear of everything in the next forty metres
    const hw = halfWidth(s + 20) - 2.2;
    let best = v.laneLat, bestCost = Infinity;
    for (let lat = -hw; lat <= hw; lat += 0.75) {
      let cost = Math.abs(lat - v.laneLat) * 0.6 + Math.abs(lat) * 0.05;
      for (let d = 4; d <= 40; d += 4) if (dangerAt(s + d, lat, 0.6)) { cost += 60 - d; }
      if (cost < bestCost) { bestCost = cost; best = lat; }
    }
    out.moveX = clamp((best - v.laneLat) * 0.45, -1, 1);
    out.moveY = 0.35;
    // at the barge's boom: hold back and shoot it out
    const b = barge;
    if (b && (b.state === 'holding' || b.state === 'running') && Math.abs(b.s - s) < 70) {
      // under the flak: keep moving across the lane, and put the shield up
      // in the bursts while the gauge lasts
      if (b.state === 'holding' && s > b.s - 40) out.moveY = s > b.s - 24 ? -1 : 0;
      const weave = Math.sin(game.time * 0.9 + slot * 1.7) * Math.min(7, halfWidth(s) - 3);
      out.moveX = clamp((weave - v.laneLat) * 0.35, -1, 1);
      out.blockHeld = v.hp < v.maxHp * 0.7 && game.time % 3 < 1.2;
    }
    // the gun: whenever something is ahead in the cone, and it is not venting
    let ahead = false, beside: -1 | 1 | 0 = 0;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    for (const e of game.enemies) {
      if (!e.alive || e.team === p.team) continue;
      const dx = e.position.x - v.pos.x, dz = e.position.z - v.pos.z;
      const along = dx * fx + dz * fz, lat = dx * -fz + dz * fx;
      if (along > 3 && along < 60 && Math.abs(lat) < along * 0.25) ahead = true;
      if (Math.abs(along) < 2.6 && Math.abs(lat) > 0.8 && Math.abs(lat) < 4.4 && e.ride) beside = lat > 0 ? 1 : -1;
    }
    out.shootHeld = ahead && !v.overheated;
    if (beside && v.swingReady) out.meleePressed = true;
    return out;
  };

  return {
    starts: [
      new THREE.Vector3(40.5, lavaY(10) + 1.4 + RAMP_RISE, tz - 2),
      new THREE.Vector3(40.5, lavaY(10) + 1.4 + RAMP_RISE, tz + 2),
      new THREE.Vector3(42.5, lavaY(10) + 1.4 + RAMP_RISE, tz - 2),
      new THREE.Vector3(42.5, lavaY(10) + 1.4 + RAMP_RISE, tz + 2),
    ],
    floorY: Y0,
    ceilingY: Y0 + 70,
    groundAt: (x, z) => { const on = lane.project(x, z); return floorAt(on.s, on.lat); },
    contains: inside,
    path,
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    offPath: (pos) => { const on = lane.project(pos.x, pos.z); return pos.y < lavaY(on.s) - 6; },
    hud,
    autopilot,
    dispose: () => {
      ctx.board.update = boardUpdate;
      if (barge && ctx.board.movers) ctx.board.movers = ctx.board.movers.filter((m) => m !== barge!.deck);
      rides.dispose();
      for (const p of game.players) p.sectionMove = null;
    },
    debug: () => ({
      leadS: Math.round(leadS), tailS: Math.round(tailS), reached,
      barge: barge ? barge.state : 'none', riders: rides.list.filter((v) => v.hostile).length,
      onBikes: game.players.filter((p) => p.vehicle).length,
      ...stats,
    }),
  };
}

export const magmaRun: SectionDef = {
  id: 'magma-run',
  build,
  // the tunnels' own air: ember-red and close, the canyon's sky above the walls
  world: { fogColor: 0x3a160a, fogNear: 40, fogFar: 260, fill: 0.8 },
};
