import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy } from '../enemies/enemy';
import type { Breakable } from '../world/board';
import type { Player } from '../player/player';
import { PathFront } from './kit/front';
import { slideMove, type SlideLane } from './kit/locomotion';
import { composeMoves } from './kit/moves';
import { audio } from '../core/audio';
import { loadOptionalTexture } from '../core/assets';

/**
 * The Glacier Chute (docs/LEVEL_SECTIONS.md §2.7) — the Crevasse, between the
 * nest mouth (stage A) and Lamplight.
 *
 * The nest mouth's transport door opens into an ice tunnel that tips
 * downhill. A few metres in the floor gives way, and the party goes down the
 * glacier on its boots: a bobsleigh run of blue ice a kilometre and a quarter
 * long and nearly three hundred metres deep, with no brakes, the brood
 * dropping into the lane, and the shelf they broke coming down behind them as
 * an avalanche. It ends in a snowbank in the dark at the bottom, where the
 * brood's caverns begin (Lamplight).
 *
 * **The verb is the slide** (K7, `kit/locomotion.ts`): gravity down the fall
 * line, the stick carving the heading, pull back to dig in, jump and jetpack
 * as normal, hip-fire and the slide kick. **The escalation**:
 *
 * 1. *The drop.* The floor goes, a 25° pitch, and speed arrives all at once.
 * 2. *The banked S.* Walls to ride up, spiders on the banks, one small
 *    crevasse that teaches the jump (a kicker before it, a shelf after).
 * 3. *The fork.* Left (+x) is short and steep with two wide crevasses; right
 *    is long and gentle, full of drops and webs. They rejoin.
 * 4. *The ice tunnel.* A roof, spiders dropping from it, webs in the lane.
 * 5. *The final pitch* — the climax. The steepest ice on the run, the
 *    avalanche surging, a twelve-metre crevasse at the bottom of it, then the
 *    runout into the dark and the snowbank.
 *
 * **Why a heightfield.** The run is one analytic surface (`heightAt`): each
 * lane is a centre line with a floor, a bank that rises as a parabola, and an
 * ice wall above it; the fork is two lanes and the surface is the lower of
 * them. The same function draws the ice, stands the bodies, and tells the
 * slide which way is down. The walls are rails (`SlideLane`): a body riding
 * up a bank is turned back along the channel, and nothing crosses the wall
 * top, so the edges are the ice and never an invisible line in the open.
 *
 * **Nothing is left behind.** A crevasse or the avalanche re-forms you at the
 * next flag gate ahead of it (eight on the run), never behind the party; the
 * dead come back the same way; the regroup is the snowbank.
 */

// ---- the run's shape (metres; z runs downhill) ----
/** where the run ends: the back of the snowbank cave */
const Z_END = 1320;
/** the snowbank: arriving past here is arriving */
const Z_SNOW = 1262;
/** the fork: split and rejoin */
const FORK0 = 330;
const FORK1 = 640;
/** the ice tunnel's roof, and the cave's over the snowbank */
const TUNNEL: [number, number] = [700, 884];
const CAVE: [number, number] = [1196, Z_END + 4];
/** the start tunnel's roof, and the slabs that give way */
const START_ROOF = 34;
const SLABS: [number, number] = [8, 26];
/** the bank's rise, the wall above it, and how far the glacier runs out past the wall */
const BANK_H = 3.5;
const WALL_H = 20;
const WALL_W = 3;
const PLATEAU = 22;
/** the floor under a crevasse, below its rim */
const DEEP = 60;
/** the avalanche closes up to this far behind the last of the party, then holds its own pace */
const LOOM = 70;
/** the flag gates, by z (a branch gate stands on both branches) */
const GATES = [130, 312, 472, 602, 690, 892, 1040, 1162];

type LaneId = 'main' | 'a' | 'b';
interface Crevasse { z: number; w: number; lane: LaneId }
const CREVASSES: Crevasse[] = [
  { z: 270, w: 6, lane: 'main' },
  { z: 430, w: 8, lane: 'a' },
  { z: 540, w: 10, lane: 'a' },
  { z: 1100, w: 12, lane: 'main' },
];

/** the grade (drop per metre of z) down the run */
const GRADES: [number, number][] = [
  [0, 0], [8, 0.47], [40, 0.3], [150, 0.2], [640, 0.15], [700, 0.18], [884, 0.25], [1000, 0.4],
  [1160, 0.1], [1228, 0], [Z_END + 40, 0],
];
/** the main line's plan, as (z, x) control points */
const PLAN: [number, number][] = [
  [-40, 0], [0, 0], [40, 0], [100, 2], [170, 20], [230, -16], [290, 6], [330, 0], [400, -8], [480, 0],
  [560, 8], [640, 0], [700, -8], [780, 10], [860, -6], [940, 0], [1020, 18], [1100, 6], [1180, -8],
  [1240, 0], [Z_END + 40, 0],
];

/** Catmull-Rom through the plan's control points, at z */
function planX(z: number): number {
  const P = PLAN;
  let i = 0;
  while (i < P.length - 2 && P[i + 1][0] < z) i++;
  const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
  const t = Math.max(0, Math.min(1, (z - p1[0]) / Math.max(1e-6, p2[0] - p1[0])));
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
    + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
}

/** the grade at z, eased over ten metres either side of each change */
function gradeAt(z: number): number {
  let g = 0;
  for (let i = 0; i < GRADES.length - 1; i++) {
    const [za, ga] = GRADES[i];
    const [zb] = GRADES[i + 1];
    if (z >= za && z < zb) { g = ga; break; }
  }
  return g;
}

interface LaneTable {
  id: LaneId;
  z0: number;
  z1: number;
  cx: Float32Array;
  /** cos of the heading off +z */
  cos: Float32Array;
  /** tan of the heading (dx/dz) */
  tan: Float32Array;
  /** floor height, with crevasse shelves, without the crevasses */
  y: Float32Array;
  half: Float32Array;
  bank: Float32Array;
  crev: Crevasse[];
}

function build(ctx: SectionContext): SectionInstance {
  const { game } = ctx;
  const T = TEXT.sections['glacier-chute'];
  const party = Math.max(1, game.players.length);
  const Y0 = ctx.floorY;

  // ---- the vertical profile: base(z), integrated from the grades and smoothed ----
  const ZA = -40, ZB = Z_END + 40;
  const NZ = ZB - ZA + 1;
  const rawY = new Float32Array(NZ);
  for (let i = 1; i < NZ; i++) rawY[i] = rawY[i - 1] - gradeAt(ZA + i - 0.5);
  // ease the kinks (a sudden change of grade throws a body off the ice)
  const base = new Float32Array(NZ);
  for (let i = 0; i < NZ; i++) {
    let s = 0, n = 0;
    for (let k = -6; k <= 6; k++) { const j = i + k; if (j >= 0 && j < NZ) { s += rawY[j]; n++; } }
    base[i] = s / n;
  }
  // flat at the top where the party stands, whatever the smoothing did
  for (let i = 0; i < NZ; i++) if (ZA + i <= SLABS[0] + 0.5) base[i] = 0;
  const DROP = -base[Z_END - ZA];
  const YT = Y0 + DROP;               // the top of the run, absolute
  const baseAt = (z: number): number => {
    const f = Math.max(0, Math.min(NZ - 1.001, z - ZA));
    const i = Math.floor(f), t = f - i;
    return YT + base[i] * (1 - t) + base[i + 1] * t;
  };

  // ---- the lanes ----
  const forkOff = (z: number): number => {
    const t = (z - FORK0) / (FORK1 - FORK0);
    return t <= 0 || t >= 1 ? 0 : 23 * Math.sin(Math.PI * t) ** 2;
  };
  const wiggle = (z: number): number => {
    const t = (z - FORK0) / (FORK1 - FORK0);
    return t <= 0 || t >= 1 ? 0 : 9 * Math.sin((2 * Math.PI * (z - FORK0)) / 78) * Math.sin(Math.PI * t);
  };
  const laneCx: Record<LaneId, (z: number) => number> = {
    main: planX,
    // left of the fall line is +x (the right of +z is -x, see `yawBasis`)
    a: (z) => planX(z) + forkOff(z) + 0.15 * wiggle(z),
    b: (z) => planX(z) - forkOff(z) - wiggle(z),
  };
  const laneHalf = (id: LaneId, z: number): number => {
    if (id !== 'main') return 5.5;
    if (z < 40) return 4;                 // the start tunnel
    if (z < 60) return 4 + (z - 40) / 20 * 3;
    if (z > 1180) return 9;               // the runout and the snowbank
    return 7;
  };
  const laneBank = (id: LaneId, z: number): number => (id === 'main' && z < 40 ? 2.2 : id === 'main' ? 5 : 4);

  const makeLane = (id: LaneId, z0: number, z1: number): LaneTable => {
    const n = z1 - z0 + 1;
    const t: LaneTable = {
      id, z0, z1, cx: new Float32Array(n), cos: new Float32Array(n), tan: new Float32Array(n),
      y: new Float32Array(n), half: new Float32Array(n), bank: new Float32Array(n),
      crev: CREVASSES.filter((c) => c.lane === id),
    };
    const f = laneCx[id];
    for (let i = 0; i < n; i++) {
      const z = z0 + i;
      t.cx[i] = f(z);
      const tan = (f(z + 0.5) - f(z - 0.5));
      t.tan[i] = tan;
      t.cos[i] = 1 / Math.sqrt(1 + tan * tan);
      t.half[i] = laneHalf(id, z);
      t.bank[i] = laneBank(id, z);
      let y = baseAt(z);
      for (const c of t.crev) {
        const rim = baseAt(c.z);
        // a kicker to the lip, and a shelf on the far side at the lip's height
        if (z > c.z - 7 && z <= c.z) y += 0.55 * ((z - (c.z - 7)) / 7) ** 2;
        const shelfEnd = c.z + c.w + 8;
        if (z > c.z && z <= shelfEnd) y = Math.max(y, rim - 0.4);
        else if (z > shelfEnd && z < shelfEnd + 22) {
          const lift = (rim - 0.4) - baseAt(shelfEnd);
          y = Math.max(y, baseAt(z) + lift * (1 - (z - shelfEnd) / 22));
        }
      }
      t.y[i] = y;
    }
    return t;
  };
  const lanes: LaneTable[] = [
    makeLane('main', 0, FORK0 + 1),
    makeLane('a', FORK0 - 1, FORK1 + 1),
    makeLane('b', FORK0 - 1, FORK1 + 1),
    makeLane('main', FORK1 - 1, Z_END),
  ];

  /** a lane's numbers at z (linearly between table rows), or null outside its span */
  const sample = (L: LaneTable, z: number) => {
    if (z < L.z0 || z > L.z1) return null;
    const f = Math.min(L.cx.length - 1.001, z - L.z0);
    const i = Math.floor(f), t = f - i;
    const mix = (a: Float32Array): number => a[i] * (1 - t) + a[i + 1] * t;
    return { cx: mix(L.cx), cos: mix(L.cos), tan: mix(L.tan), y: mix(L.y), half: mix(L.half), bank: mix(L.bank) };
  };
  const inCrevasse = (L: LaneTable, z: number): boolean => L.crev.some((c) => z > c.z && z < c.z + c.w);

  /** the lateral profile: floor, a parabolic bank, the ice wall, the glacier beyond */
  const profile = (d: number, half: number, bank: number): number => {
    const a = Math.abs(d);
    if (a <= half) return 0;
    if (a <= half + bank) { const t = (a - half) / bank; return BANK_H * t * t; }
    if (a <= half + bank + WALL_W) {
      const t = (a - half - bank) / WALL_W;
      return BANK_H + WALL_H * (t * t * (3 - 2 * t));
    }
    return BANK_H + WALL_H + Math.min(2, (a - half - bank - WALL_W) * 0.05);
  };

  /** the ice under (x, z); `rim` ignores the crevasses (their lips' height) */
  const surface = (x: number, z: number, rim = false): number => {
    let h = Infinity;
    for (const L of lanes) {
      const s = sample(L, z);
      if (!s) continue;
      const side = (x - s.cx) * s.cos;
      if (!rim && inCrevasse(L, z) && Math.abs(side) < s.half + s.bank) h = Math.min(h, s.y - DEEP);
      else h = Math.min(h, s.y + profile(side, s.half, s.bank));
    }
    if (h === Infinity) h = baseAt(Math.max(ZA, Math.min(ZB, z))) + BANK_H + WALL_H + 2;
    return h;
  };

  /** the lane a body at (x, z) is in (the one it is most inside), for the rail and the bots */
  const laneAt = (x: number, z: number): { L: LaneTable; side: number; s: NonNullable<ReturnType<typeof sample>> } | null => {
    let best: { L: LaneTable; side: number; s: NonNullable<ReturnType<typeof sample>> } | null = null;
    let bestOver = Infinity;
    for (const L of lanes) {
      const s = sample(L, z);
      if (!s) continue;
      const side = -(x - s.cx) * s.cos;          // signed: + is right of the fall line
      const over = Math.abs(side) - (s.half + s.bank);
      if (over < bestOver) { bestOver = over; best = { L, side, s }; }
    }
    return best;
  };
  const slideLane = (x: number, z: number): SlideLane | null => {
    const at = laneAt(x, z);
    if (!at) return null;
    const { s, side } = at;
    // the axis: (dx/dz, 1), normalised
    return { ax: s.tan * s.cos, az: s.cos, side, half: s.half, bank: s.bank };
  };

  // the ice is the ground while the stage stands (the context gives the
  // territory's back at teardown)
  game.board.physics.heightAt = (x, z) => surface(x, z);
  const killY = game.board.physics.killY;
  game.board.physics.killY = Y0 - DEEP - 40;

  // ---- materials ----
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.35, metalness: 0.05 });
  ctx.own(iceMat);
  let chuteTex = false;
  let gone = false;
  const applyIce = (tex: THREE.Texture, main: boolean): void => {
    if (gone || (chuteTex && !main)) return;
    if (main) chuteTex = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    iceMat.map = tex;
    iceMat.needsUpdate = true;
  };
  // the requested slide surface (skid grooves) when it lands; the territory's ice until then
  loadOptionalTexture('glacier_chute', (t) => applyIce(t, true), { exts: ['jpg', 'png'] });
  loadOptionalTexture('ice_albedo', (t) => applyIce(t, false), { exts: ['jpg', 'png'] });
  const wallMat = ctx.paint(0x6f9ab8, { rough: 0.5, metal: 0.05 });
  ctx.tile(wallMat, 'cliff_ice', 2, 2, { normal: true });
  const darkMat = ctx.paint(0x10202c, { rough: 0.9, metal: 0 });
  const metal = ctx.paint(0x4a5662, { rough: 0.5, metal: 0.7 });
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xc8402c, emissive: 0x80200e, emissiveIntensity: 0.6, side: THREE.DoubleSide, roughness: 0.8 });
  ctx.own(flagMat);
  const markMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
  ctx.own(markMat);
  const snowMat = ctx.paint(0xf2f6fa, { rough: 0.95, metal: 0 });
  ctx.tile(snowMat, 'snow_albedo', 4, 4);

  // ---- the ice: one mesh, sampled from the surface itself ----
  {
    const rows: number[] = [];
    for (let z = ZA; z <= ZB; z += 1.5) rows.push(z);
    for (const c of CREVASSES) rows.push(c.z - 0.02, c.z + 0.02, c.z + c.w - 0.02, c.z + c.w + 0.02);
    rows.sort((a, b) => a - b);
    const COLS = 64;
    const pos = new Float32Array(rows.length * COLS * 3);
    const col = new Float32Array(rows.length * COLS * 3);
    const uv = new Float32Array(rows.length * COLS * 2);
    const cIce = new THREE.Color(0xe4f2fb), cBank = new THREE.Color(0xbcd8ea), cWall = new THREE.Color(0x7aa4c2);
    const cTop = new THREE.Color(0xf4f8fb), cDeep = new THREE.Color(0x02070d);
    const c = new THREE.Color();
    rows.forEach((z, r) => {
      let lo = Infinity, hi = -Infinity, floor = Infinity;
      for (const L of lanes) {
        const s = sample(L, z);
        if (!s) continue;
        const reach = (s.half + s.bank + WALL_W + PLATEAU) / s.cos;
        lo = Math.min(lo, s.cx - reach);
        hi = Math.max(hi, s.cx + reach);
        floor = Math.min(floor, s.y);
      }
      if (lo === Infinity) { lo = -40; hi = 40; floor = baseAt(z); }
      for (let k = 0; k < COLS; k++) {
        const x = lo + ((hi - lo) * k) / (COLS - 1);
        let y = surface(x, z);
        const rimY = surface(x, z, true);
        const deep = y < rimY - 5;
        if (deep) y = rimY - 26;          // the dark is enough; the mesh need not go all the way down
        const o = (r * COLS + k) * 3;
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
        const up = y - floor;
        if (deep) c.copy(cDeep);
        else if (up < 0.3) c.copy(cIce);
        else if (up < BANK_H + 0.5) c.copy(cIce).lerp(cBank, up / BANK_H);
        else if (up < BANK_H + WALL_H - 1) c.copy(cBank).lerp(cWall, Math.min(1, (up - BANK_H) / 6));
        else c.copy(cTop);
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
        uv[(r * COLS + k) * 2] = (x + up * 0.6) / 9;
        uv[(r * COLS + k) * 2 + 1] = (z + up * 0.3) / 9;
      }
    });
    const idx: number[] = [];
    for (let r = 0; r < rows.length - 1; r++) {
      for (let k = 0; k < COLS - 1; k++) {
        const a = r * COLS + k, b = a + 1, d = a + COLS, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    ctx.own(geo);
    const ice = new THREE.Mesh(geo, iceMat);
    ice.receiveShadow = true;
    ctx.mesh(ice);
  }

  // ---- seracs along the glacier's top: the silhouette of the keyframe ----
  {
    const spire = (): THREE.Object3D => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.ConeGeometry(3.2, 14, 6), wallMat);
      m.position.y = 7;
      m.rotation.z = 0.12;
      g.add(m);
      return g;
    };
    let k = 0;
    for (let z = 40; z < 1180; z += 46 + ((k * 17) % 23)) {
      k++;
      const at = laneAt(planX(z), z);
      if (!at) continue;
      const sideOut = at.s.half + at.s.bank + WALL_W + 6 + (k % 3) * 4;
      for (const sgn of [-1, 1]) {
        if ((k + (sgn > 0 ? 1 : 0)) % 2) continue;
        const x = at.s.cx + (sgn * sideOut) / at.s.cos;
        const y = surface(x, z);
        ctx.prop('cliff_pillar_ice', new THREE.Vector3(x, y - 1, z), { size: 12 + (k % 4) * 3, yaw: k, fallback: spire });
      }
    }
  }

  // ---- the start: the tunnel inside the nest mouth's door ----
  // The door the party came through, set in the glacier face behind them
  // (z = 0 is the face: the surface runs up to the glacier top behind it).
  {
    const y = YT;
    // the door leaf, shut behind them: frame to frame and up to the lintel,
    // so no slot of the ice behind shows over it
    ctx.box(0, y + 2.3, 0.25, 3.6, 4.6, 0.5, metal);
    ctx.box(-2.1, y + 2.4, 0.4, 0.6, 4.8, 0.8, darkMat);             // the frame
    ctx.box(2.1, y + 2.4, 0.4, 0.6, 4.8, 0.8, darkMat);
    ctx.box(0, y + 4.9, 0.4, 4.8, 0.6, 0.8, darkMat);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0x63d0ff }));
    strip.position.set(0, y + 3.6, 0.52);
    ctx.mesh(strip);
    ctx.own(strip.geometry); ctx.own(strip.material as THREE.Material);
    // the tunnel's roof: rock-hard ice, following the tip of the floor
    for (let z = 0; z < START_ROOF; z += 4) {
      const s = sample(lanes[0], z + 2)!;
      ctx.box(s.cx, s.y + 6.2, z + 2, (s.half + s.bank + WALL_W) * 2 + 2, 1.6, 4.2, wallMat);
    }
    // a lamp in the tunnel so the door and the first metres read
    const lamp = new THREE.PointLight(0x9fd8ff, 14, 26, 1.4);
    lamp.position.set(0, y + 4.5, 6);
    ctx.mesh(lamp);
  }
  // the slabs over the first pitch: floor until it gives way
  const slabs: { box: ReturnType<SectionContext['box']>; vy: number; spin: number }[] = [];
  for (let z = SLABS[0]; z < SLABS[1]; z += 4.5) {
    const b = ctx.box(0, YT - 0.4, z + 2.25, 8, 0.8, 4.4, wallMat);
    slabs.push({ box: b, vy: 0, spin: (Math.random() - 0.5) * 2 });
  }

  // ---- roofs: the ice tunnel, and the cave over the snowbank ----
  const icicleGeo = new THREE.ConeGeometry(0.35, 2.4, 5);
  ctx.own(icicleGeo);
  const roof = (z0: number, z1: number, rise: number, mat: THREE.Material): void => {
    for (let z = z0; z < z1; z += 5) {
      const at = laneAt(planX(z + 2.5), z + 2.5);
      if (!at) continue;
      const w = ((at.s.half + at.s.bank + WALL_W) * 2 + 3) / at.s.cos;
      ctx.box(at.s.cx, at.s.y + rise + 1, z + 2.5, w, 2, 5.2, mat);
      for (let k = 0; k < 3; k++) {
        const ic = new THREE.Mesh(icicleGeo, wallMat);
        ic.rotation.x = Math.PI;
        ic.position.set(at.s.cx + (Math.random() - 0.5) * at.s.half * 2.4, at.s.y + rise - 1.1, z + Math.random() * 5);
        ctx.mesh(ic);
      }
    }
  };
  roof(TUNNEL[0], TUNNEL[1], 10, darkMat);
  roof(CAVE[0], CAVE[1], 11, darkMat);
  // the snowbank: a drift heaped against the back of the cave
  {
    const drift = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), snowMat);
    drift.scale.set(16, 3.2, 12);
    drift.position.set(planX(Z_END - 6), baseAt(Z_END - 6) - 0.4, Z_END - 6);
    ctx.mesh(drift);
    ctx.own(drift.geometry);
    ctx.box(drift.position.x, drift.position.y + 1.2, Z_END - 4, 20, 2.4, 6, null);
    // cold light off the ice in the cave, just enough to find each other by
    const glow = new THREE.PointLight(0x6fb8ff, 10, 40, 1.5);
    glow.position.set(planX(1270), baseAt(1270) + 6, 1270);
    ctx.mesh(glow);
  }

  // ---- crevasse marks: orange wands on the banks at every lip ----
  const wandGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.2, 5);
  ctx.own(wandGeo);
  for (const c of CREVASSES) {
    const L = lanes.find((l) => l.id === c.lane && c.z > l.z0 && c.z < l.z1)!;
    for (const dz of [-10, -1]) {
      const s = sample(L, c.z + dz)!;
      for (const sgn of [-1, 1]) {
        const x = s.cx + (sgn * (s.half + 0.8)) / s.cos;
        const w = new THREE.Mesh(wandGeo, markMat);
        w.position.set(x, surface(x, c.z + dz) + 1.1, c.z + dz);
        ctx.mesh(w);
      }
    }
  }

  // ---- the flag gates ----
  interface Gate { k: number; z: number; spots: { lane: LaneTable; at: THREE.Vector3 }[] }
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 7, 6);
  ctx.own(poleGeo);
  const gates: Gate[] = GATES.map((z, i) => {
    const spots: Gate['spots'] = [];
    for (const L of lanes) {
      const s = sample(L, z);
      if (!s || z < L.z0 + 2 || z > L.z1 - 2) continue;
      if (spots.some((sp) => Math.abs(sp.at.x - s.cx) < 2)) continue;
      spots.push({ lane: L, at: new THREE.Vector3(s.cx, s.y, z) });
      const reach = (s.half + s.bank * 0.5) / s.cos;
      for (const sgn of [-1, 1]) {
        const x = s.cx + sgn * reach;
        const pole = new THREE.Mesh(poleGeo, metal);
        const gy = surface(x, z);
        pole.position.set(x, gy + 3.5, z);
        ctx.mesh(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), flagMat);
        flag.position.set(x - sgn * 0.8, gy + 6.3, z);
        ctx.mesh(flag);
        ctx.own(flag.geometry);
      }
      // the banner across the lane
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(reach * 2, 0.7), flagMat);
      banner.position.set(s.cx, s.y + 6.8 + BANK_H * 0.25, z);
      ctx.mesh(banner);
      ctx.own(banner.geometry);
    }
    return { k: i + 1, z, spots };
  });

  // ---- the avalanche ----
  const front = new PathFront(-50, party === 1 ? 14 : 15.5, 1e9);
  const snowCloud = new THREE.MeshStandardMaterial({ color: 0xf4f8fc, roughness: 1, metalness: 0, transparent: true, opacity: 0.92 });
  ctx.own(snowCloud);
  const puffGeo = new THREE.IcosahedronGeometry(1, 1);
  ctx.own(puffGeo);
  const puffs = Array.from({ length: 16 }, (_, i) => {
    const m = new THREE.Mesh(puffGeo, snowCloud);
    m.visible = false;
    ctx.mesh(m);
    return { m, u: (i / 15) * 2 - 1, h: 3 + (i % 4) * 3.5, r: 5 + (i % 3) * 2.5, ph: i * 1.7 };
  });
  let avalancheOn = false;
  let rumble = 0;

  // ---- webs and drops, placed on the first update ----
  const webGeo = new THREE.CircleGeometry(2.4, 14);
  ctx.own(webGeo);
  const webMat = new THREE.MeshBasicMaterial({ color: 0xe8eef2, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
  ctx.own(webMat);
  loadOptionalTexture('web_sheet', (tex) => { if (gone) return; webMat.map = tex; webMat.alphaMap = null; webMat.needsUpdate = true; }, { exts: ['png'] });
  interface Web { pos: THREE.Vector3; b: Breakable; mesh: THREE.Mesh }
  const webs: Web[] = [];
  const breakables: Breakable[] = [];
  const addWeb = (L: LaneTable, z: number, side = 0): void => {
    const s = sample(L, z);
    if (!s) return;
    const x = s.cx + side / s.cos;
    const y = surface(x, z);
    const pos = new THREE.Vector3(x, y, z);
    const mesh = new THREE.Mesh(webGeo, webMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.06, z);
    ctx.mesh(mesh);
    // strands up to the walls either side, so a web reads from a distance
    const b: Breakable = {
      mesh, center: new THREE.Vector3(x, y + 0.9, z), radius: 2.4, hp: 16, maxHp: 16,
      box: { min: new THREE.Vector3(x - 2.4, y, z - 2.4), max: new THREE.Vector3(x + 2.4, y + 0.3, z + 2.4) },
    };
    (game.board.breakables ??= []).push(b);
    breakables.push(b);
    webs.push({ pos, b, mesh });
  };
  interface Drop { z: number; lane: LaneTable; side: number; n: number; state: 'wait' | 'shadow' | 'done'; t: number; at: THREE.Vector3; shadow: THREE.Mesh }
  const drops: Drop[] = [];
  const shadowGeo = new THREE.CircleGeometry(1.6, 16);
  ctx.own(shadowGeo);
  const addDrop = (L: LaneTable, z: number, side: number, n: number): void => {
    const s = sample(L, z);
    if (!s) return;
    const x = s.cx + side / s.cos;
    const at = new THREE.Vector3(x, surface(x, z), z);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
    ctx.own(mat);
    const shadow = new THREE.Mesh(shadowGeo, mat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(at.x, at.y + 0.08, at.z);
    ctx.mesh(shadow);
    drops.push({ z, lane: L, side, n, state: 'wait', t: 0, at, shadow });
  };
  const laneOf = (id: LaneId, z: number): LaneTable => lanes.find((l) => l.id === id && z >= l.z0 && z <= l.z1)!;

  // ---- the slide ----
  const webDrag = (p: Player): number => {
    for (const w of webs) {
      if (w.b.broken) continue;
      if (Math.abs(p.position.x - w.pos.x) < 2.6 && Math.abs(p.position.z - w.pos.z) < 2.6 && Math.abs(p.position.y - w.pos.y) < 1.2) return 3.2;
    }
    return 0;
  };
  const slide = slideMove({
    lane: slideLane,
    drag: webDrag,
    onKick: (_p, at) => {
      for (const w of webs) if (!w.b.broken && w.pos.distanceTo(at) < 3.4) game.hurtBreakable(w.b, 99);
    },
  });

  // ---- state ----
  let started = false;
  let complete = false;
  let collapseT = -1;         // counts up once the floor has started to go
  let collapsed = false;
  let startT = 0;
  const progress = [0, 0, 0, 0];     // the furthest z each player has reached
  let gateReached = 0;               // the furthest gate any living player has passed
  const botLane: LaneId[] = ['a', 'b', 'a', 'b'];
  const kickCue = [0, 0, 0, 0];
  const wallKrykna: Enemy[] = [];

  /** a standing spot on gate `k`'s line (1-based; 9 = the snowbank), for slot */
  const gateSpot = (k: number, slot: number, lane?: LaneId): THREE.Vector3 => {
    if (k > gates.length) {
      const z = Z_SNOW + 8 + Math.floor(slot / 2) * 2;
      const x = planX(z) + ((slot % 2) * 2 - 1) * 2;
      return new THREE.Vector3(x, surface(x, z) + 0.1, z);
    }
    const g = gates[k - 1];
    const spot = g.spots.find((s) => s.lane.id === lane) ?? g.spots[slot % g.spots.length];
    const z = g.z + 3;
    const s = sample(spot.lane, z)!;
    const x = s.cx + ((slot % 2) * 2 - 1) * 1.6 / s.cos;
    return new THREE.Vector3(x, surface(x, z) + 0.1, z);
  };
  /** the first gate at or after z */
  const gateAfter = (z: number): number => {
    for (const g of gates) if (g.z > z) return g.k;
    return gates.length + 1;
  };
  const leaderZ = (): number => {
    let z = -Infinity;
    for (const p of game.players) if (p.alive) z = Math.max(z, p.position.z);
    return z;
  };
  /** where someone who has to be put back comes back: the next gate ahead of them and of the avalanche, never past the leader's */
  const reformGate = (slot: number): number => {
    const own = gateAfter(Math.max(progress[slot], 0));
    const safe = gateAfter(front.at + 55);
    const lead = gateAfter(leaderZ() - 1);
    return Math.min(gates.length + 1, Math.max(own, safe, Math.min(lead, own)));
  };

  const spawnEnemies = (): void => {
    const extra = party >= 3 ? 1 : 0;
    // on the banks of the S, waiting
    const main0 = lanes[0];
    for (const [z, side] of [[182, 8.5], [214, -8.5], [248, 8], [300, -8]] as const) {
      const s = sample(main0, z)!;
      const x = s.cx - side / s.cos;
      const e = ctx.spawn('krykna', new THREE.Vector3(x, surface(x, z), z), { exact: true });
      wallKrykna.push(e);
    }
    const mainEnd = lanes[3];
    for (const [z, side] of [[1012, 9], [1046, -9], [1068, 8.5]] as const) {
      const s = sample(mainEnd, z)!;
      const x = s.cx - side / s.cos;
      wallKrykna.push(ctx.spawn('krykna', new THREE.Vector3(x, surface(x, z), z), { exact: true }));
    }
    // drops: the long branch, the tunnel, the final pitch
    for (const z of [372, 418, 466, 516, 586]) addDrop(laneOf('b', z), z, (z % 3) - 1, 1 + extra);
    addDrop(laneOf('a', 492), 492, 0, 1);
    for (const z of [724, 768, 812, 852]) addDrop(laneOf('main', z), z, ((z / 4) % 3) - 1, 1 + (z > 800 ? extra : 0));
    addDrop(laneOf('main', 1128), 1128, 1.5, 1 + extra);
    addDrop(laneOf('main', 1140), 1140, -2, 1);
    // webs
    addWeb(laneOf('main', 202), 202, -1.5);
    for (const z of [398, 452, 504, 568]) addWeb(laneOf('b', z), z, (z % 5) - 2);
    addWeb(laneOf('a', 470), 470, 2);
    for (const z of [742, 790, 836]) addWeb(laneOf('main', z), z, (z % 3) - 1);
    addWeb(laneOf('main', 1024), 1024, 0);
  };

  const collapse = (): void => {
    collapsed = true;
    for (const sl of slabs) ctx.unsolid({ box: sl.box.box });
    ctx.announce(T.avalanche, T.avalancheSub);
    audio.iceCrack(1);
    audio.explosion();
    avalancheOn = true;
    front.resetTo(-50, 4);
    for (const p of game.players) p.cam.shake(0.35);
  };

  const caught = { avalanche: 0, crevasse: 0 };
  const catchUp = (p: Player, title: string, sub: string, force = false): void => {
    if (title === T.caught) caught.avalanche++; else caught.crevasse++;
    const k = reformGate(p.slot);
    const at = gateSpot(k, p.slot, botLane[p.slot]);
    p.position.copy(at);
    const lane = slideLane(at.x, at.z);
    p.velocity.set(lane ? lane.ax * 8 : 0, 0, lane ? lane.az * 8 : 8);
    progress[p.slot] = Math.max(progress[p.slot], at.z);
    if (force) ctx.announce(title, sub);
  };

  const update = (dt: number): void => {
    if (complete) return;
    startT += dt;
    if (!started) {
      started = true;
      spawnEnemies();
      ctx.announce(T.title, T.sub);
      for (const p of game.players) {
        p.sectionMove = composeMoves(slide.move());
        p.cam.yaw = 0;
      }
    }

    // ---- the floor going ----
    const lead = leaderZ();
    if (!collapsed) {
      if (collapseT < 0 && (lead > SLABS[0] + 3 || startT > 7)) {
        collapseT = 0;
        ctx.announce(T.cracking, T.gone);
        audio.iceCrack(0.8);
      }
      if (collapseT >= 0) {
        collapseT += dt;
        for (const sl of slabs) {
          const m = sl.box.mesh!;
          m.position.x = (Math.random() - 0.5) * 0.08 * collapseT;
          if (Math.random() < dt * 6) game.particles.dustPuff(m.position.clone().setY(YT), 2);
        }
        if (collapseT > 1.3) collapse();
      }
    } else {
      for (const sl of slabs) {
        const m = sl.box.mesh!;
        if (!m.visible) continue;
        sl.vy -= 20 * dt;
        m.position.y += sl.vy * dt;
        m.rotation.x += sl.spin * dt;
        if (m.position.y < YT - 60) m.visible = false;
      }
    }

    // ---- progress, the gates, the fallen ----
    for (const p of game.players) {
      if (!p.alive) continue;
      progress[p.slot] = Math.max(progress[p.slot], p.position.z);
      for (const g of gates) {
        if (g.k > gateReached && p.position.z > g.z) {
          gateReached = g.k;
          ctx.checkpoint.copy(gateSpot(g.k, 0));
          audio.checkpointChime();
          ctx.announce(TEXT.banners.checkpoint, T.gate(g.k));
        }
      }
      // down a crevasse: out before the fall is over
      const rim = surface(p.position.x, p.position.z, true);
      if (p.position.y < rim - 7) catchUp(p, T.fell, T.fellSub, true);
    }

    // ---- the avalanche ----
    if (avalancheOn) {
      // A fixed speed a little under the cruise, so only a body that stalls
      // meets it — but never so far back that it stops being there: more than
      // `LOOM` metres behind the last of the party it gathers pace to close
      // up, and it surges down the final pitch. It dies in the cave mouth.
      let rear = Infinity;
      for (const p of game.players) if (p.alive) rear = Math.min(rear, p.position.z);
      const cruise = front.at > 960 ? (party === 1 ? 17.5 : 19) : (party === 1 ? 14 : 15.5);
      front.speed = isFinite(rear) && rear - front.at > LOOM ? 21 : cruise;
      front.update(dt);
      front.at = Math.min(front.at, CAVE[0] + 20);
      for (const p of game.players) {
        if (!p.alive || p.position.z > front.at + 1.5) continue;
        if (front.at >= CAVE[0] + 19) continue;      // spent against the cave: nobody is behind it now
        catchUp(p, T.caught, T.caughtSub, true);
      }
      // the brood it rolls over is gone
      for (const e of game.enemies) if (e.alive && e.team === 1 && e.position.z < front.at - 4) e.damage(9999, e.position, -1);
      // the look: a boiling wall of snow across whatever lanes stand at the front
      const z = front.at;
      const across = lanes.map((L) => sample(L, z)).filter((s): s is NonNullable<typeof s> => !!s);
      puffs.forEach((pf, i) => {
        const s = across[i % Math.max(1, across.length)];
        if (!s || z < -20) { pf.m.visible = false; return; }
        pf.m.visible = true;
        const w = (s.half + s.bank) / s.cos;
        const t = game.time * 1.3 + pf.ph;
        pf.m.position.set(s.cx + pf.u * w, s.y + pf.h + Math.sin(t) * 1.2, z - 2 + Math.cos(t * 0.7) * 2.5);
        pf.m.scale.setScalar(pf.r * (1 + 0.15 * Math.sin(t * 1.9)));
        pf.m.rotation.set(t * 0.4, t * 0.3, 0);
        if (Math.random() < dt * 3) game.particles.dustPuff(pf.m.position, 3);
      });
      // the rumble grows as it closes on the nearest body
      let gap = Infinity;
      for (const p of game.players) if (p.alive) gap = Math.min(gap, p.position.z - front.at);
      rumble = Math.max(0, Math.min(1, 1 - gap / 140));
      audio.setBurrowRumble(front.at >= CAVE[0] + 19 ? 0 : rumble);
      if (rumble > 0.6) for (const p of game.players) p.cam.shake(0.02 * rumble);
    }

    // ---- drops from above: a shadow, then the spider ----
    for (const d of drops) {
      if (d.state === 'done') continue;
      if (d.state === 'wait') {
        const near = game.players.some((p) => p.alive && d.z - p.position.z < 38 && d.z - p.position.z > 8);
        if (near) { d.state = 'shadow'; d.t = 0; }
        else if (lead > d.z + 20) d.state = 'done';     // everyone is past it
        continue;
      }
      d.t += dt;
      const m = d.shadow.material as THREE.MeshBasicMaterial;
      m.opacity = Math.min(0.6, d.t * 0.5);
      d.shadow.scale.setScalar(0.5 + Math.min(1, d.t / 1.1) * 0.8);
      if (d.t >= 1.1) {
        d.state = 'done';
        m.opacity = 0;
        for (let i = 0; i < d.n; i++) {
          const at = d.at.clone().add(new THREE.Vector3((i - (d.n - 1) / 2) * 1.8, 7, 0));
          ctx.spawn('krykna', at, { exact: true, alert: true });
        }
        audio.bark('spider_chitter', 0.6);
      }
    }
    // the ones on the banks wake as the first body comes over the rise
    for (const e of wallKrykna) {
      if (!e.alive || e.awareness !== 'idle') continue;
      const near = game.players.find((p) => p.alive && e.position.z - p.position.z < 45 && e.position.z > p.position.z - 5);
      if (near) e.alert(near.position, true);
    }
    // a web the ice has swallowed stays gone
    for (const w of webs) if (w.b.broken && w.mesh.visible) w.mesh.visible = false;
    for (let i = 0; i < 4; i++) kickCue[i] = Math.max(0, kickCue[i] - dt);

    // ---- the snowbank: everyone still standing down is the end of it ----
    // The fallen do not hold the party at the finish: they come back with it
    // on the next stage. Anyone alive and still sliding does.
    const alive = game.players.filter((p) => p.alive);
    if (alive.length && alive.every((p) => p.position.z > Z_SNOW)) {
      complete = true;
      audio.setBurrowRumble(0);
    }
  };

  const nextGateFor = (z: number): number => gateAfter(z);

  const objective = () => {
    // the party's rear: whoever is furthest back is who the marker is for
    let rear = Infinity;
    for (const p of game.players) if (p.alive) rear = Math.min(rear, p.position.z);
    if (!isFinite(rear)) rear = 0;
    const k = nextGateFor(rear);
    const pos = k > gates.length ? gateSpot(gates.length + 1, 0) : gates[k - 1].spots[0].at.clone();
    let hint: string = T.hintSlide;
    if (!collapsed) hint = T.hintStart;
    else if (rear > Z_SNOW) hint = T.hintEnd;
    else if (CREVASSES.some((c) => c.z - rear > 0 && c.z - rear < 45)) hint = T.hintJump;
    else if (rear > FORK0 - 60 && rear < FORK0 + 10) hint = T.fork;
    return {
      pos,
      label: k > gates.length ? T.snowbank : T.gateLabel(k),
      hint,
      // a sixty-metre column is no guide down a chute; the gate's banner is
      beacon: false,
    };
  };

  const respawnSpot = (slot: number): THREE.Vector3 => {
    const lead = leaderZ();
    if (lead > Z_SNOW) return gateSpot(gates.length + 1, slot);
    if (!collapsed) return ctx.defaultRespawn(slot, new THREE.Vector3(0, YT, 4));
    return gateSpot(reformGate(slot), slot, botLane[slot]);
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const st = slide.state[slot];
    const bars: SectionBar[] = [{
      label: T.speed(Math.round(st.speed)), value: Math.min(1, st.speed / 26),
      tone: st.speed > 20 ? 'good' : 'info',
    }];
    if (avalancheOn && front.at < CAVE[0] + 19) {
      const gap = Math.max(0, p.position.z - front.at);
      bars.push({ label: T.avalanche, value: Math.max(0, Math.min(1, 1 - gap / 140)), tone: gap < 40 ? 'danger' : gap < 80 ? 'warn' : 'info' });
      return { bars, line: st.crashed < 1.2 ? T.crash : st.kicked < 0.6 ? T.kick : T.behind(Math.round(gap)) };
    }
    const alive = game.players.filter((q) => q.alive);
    const left = alive.filter((q) => q.position.z <= Z_SNOW).length;
    return { bars, line: p.position.z > Z_SNOW && left ? T.regroup(left) : st.crashed < 1.2 ? T.crash : T.hintSlide };
  };

  // ---- the autopilot: ride the lane, jump the crevasses, shoot, kick ----
  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    const z = p.position.z;
    const want: LaneId = z >= FORK0 - 2 && z <= FORK1 ? botLane[slot] : 'main';
    const cur = laneAt(p.position.x, z);
    const L = (want === 'main' ? lanes.find((l) => l.id === 'main' && z >= l.z0 && z <= l.z1) : laneOf(want, Math.max(FORK0, Math.min(FORK1, z)))) ?? cur?.L;
    if (!L) return {};
    const s = sample(L, Math.max(L.z0, Math.min(L.z1, z)));
    if (!s) return {};
    const side = -(p.position.x - s.cx) * s.cos;
    // look down the lane, a little way ahead
    const la = Math.min(L.z1, z + 14);
    const ahead = sample(L, la) ?? s;
    const yaw = Math.atan2(ahead.cx - p.position.x, la - z);
    // hold the sights level (a bot does not fight the recoil the way a thumb does)
    const out: AutopilotInput = { yaw, shootHeld: true, lookY: (-0.2 - p.cam.pitch) * 0.3 };
    if (!collapsed || z < 6 || slide.state[slot].speed < 4) out.moveY = 1;
    // steer onto the centre: stick right is right of travel (the camera looks down the lane)
    const vx = p.velocity.x, vz = p.velocity.z;
    const lat = -(vx * s.cos - vz * s.tan * s.cos);      // velocity toward the right of the axis
    out.moveX = Math.max(-1, Math.min(1, -side * 0.35 - lat * 0.12));
    // a crevasse ahead on this lane: jump at the lip, burn or rise over the gap
    const crev = L.crev.find((c) => c.z - z < 5 && c.z + c.w + 3 > z);
    if (crev) {
      const beforeLip = crev.z - z;
      if (p.grounded && beforeLip < 3.2 && beforeLip > -0.5) { out.jumpPressed = true; out.jumpHeld = true; }
      else if (!p.grounded && z < crev.z + crev.w + 2) {
        const rim = s.y + 0.2;
        if (p.position.y < rim + 1.5) out.jumpHeld = true;
        out.moveY = 1;
      }
    }
    // a spider or a web right in front: kick it
    const reach = 3 + slide.state[slot].speed * 0.12;
    const inReach = (q: THREE.Vector3): boolean => {
      const d = q.distanceTo(p.position);
      return d < reach && (q.z - p.position.z > -0.5 || d < 1.6);
    };
    const near = game.enemies.some((e) => e.alive && e.team === 1 && !e.downed && inReach(e.position));
    const web = webs.some((w) => !w.b.broken && inReach(w.pos));
    if ((near || web) && kickCue[slot] <= 0) { out.meleePressed = true; kickCue[slot] = 0.6; }
    return out;
  };

  const inst: SectionInstance = {
    starts: [0, 1, 2, 3].map((i) => new THREE.Vector3(((i % 2) * 2 - 1) * 1.4, YT, 3 + Math.floor(i / 2) * 1.8)),
    floorY: Y0,
    ceilingY: YT + 34,
    groundAt: (x, z) => surface(x, z, true),
    contains: (x, z) => {
      if (z < 0.5 || z > Z_END) return false;
      const at = laneAt(x, z);
      return !!at && Math.abs(at.side) <= at.s.half + at.s.bank + 0.6;
    },
    path: [new THREE.Vector3(0, YT, 3), ...gates.map((g) => g.spots[0].at.clone()), gateSpot(gates.length + 1, 0)],
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    // the crevasses are caught in `update`; this is the backstop under all of it
    offPath: (pos) => pos.y < surface(pos.x, pos.z, true) - DEEP * 0.5,
    hud,
    autopilot,
    dispose: () => {
      gone = true;
      audio.setBurrowRumble(0);
      game.board.physics.killY = killY;
      if (game.board.breakables) game.board.breakables = game.board.breakables.filter((b) => !breakables.includes(b));
      for (const p of game.players) p.sectionMove = null;
    },
    debug: () => ({
      front: Math.round(front.at), gate: gateReached, collapsed, caught: { ...caught }, t: Math.round(startT),
      z: game.players.map((p) => Math.round(p.position.z)),
      speed: slide.state.map((s) => Math.round(s.speed)),
    }),
  };
  // for the mechanics suite (tools/test-section-crevasse.mjs): the kit and the numbers it runs on
  (inst as unknown as { kit: unknown }).kit = { slide, front, gates: GATES, crevasses: CREVASSES, surface, laneAt, webs, Z_SNOW };
  return inst;
}

export const glacierChute: SectionDef = {
  id: 'glacier-chute',
  build,
  // snow haze down the glacier: the far end of the run is lost in it
  world: { fogColor: 0xcfdeea, fogNear: 50, fogFar: 300, traction: 0.55 },
};
