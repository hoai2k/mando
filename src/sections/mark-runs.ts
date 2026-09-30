import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy, EnemyKind } from '../enemies/enemy';
import type { Player } from '../player/player';
import { Runner, type RunNode } from './kit/pursuit';
import { composeMoves } from './kit/moves';
import { audio } from '../core/audio';

/**
 * The Mark Runs (docs/LEVEL_SECTIONS.md §2.16) — the Ringworld, after the
 * plaza, before the service spine.
 *
 * The plaza's fight flushes the warlord's paymaster, and he bolts up a fire
 * stair onto the roofs. The party comes out of the stair head behind him. He
 * has a jetpack and a head start; they have to keep him in reach across
 * twelve rooftops and bring him in — alive is worth more.
 *
 * **The chase** is K8 (`kit/pursuit.ts`): he runs a route of his own, sprints
 * when you close and jogs when you drop back, so the gap is always about to
 * change. More than 60 m ahead of every hunter for 8 s (75 m / 10 s alone)
 * and he is gone: the chase restarts from the last checkpoint roof with him a
 * fixed lead ahead. Blaster hits stagger him (his lead drops by about ten
 * metres) but every one costs bounty value, at any range; a melee blow (a
 * hand on him) staggers him for free, and a net stops him longer for free.
 *
 * **Escalation.** The first roofs teach it (the net launcher rack is by the
 * stair door; his first call brings two pirates up). The middle adds his
 * tricks: two **forks** where he takes the way with the fewest hunters on it
 * (so a party that spreads out keeps someone on his line), a **crate stack**
 * he kicks down behind him twice, pirates he has paid on four roofs. The end
 * is the **sign**: he shoots a neon sign loose over the last gap as he lands
 * on the pad, and it drops across the gap, live, so the last crossing is over
 * it — and then there is nowhere left to run. On the landing pad he turns and
 * fights: a duelist who jet-hops out of reach. Wear him under half and a net
 * takes him; so does beating him down by hand. Shoot him dead and it is still
 * a clear, at half the bounty.
 *
 * **Both ends are real.** It starts at the top of the fire stair — a stair
 * head with its door shut behind the party (one-way) — and it ends at the
 * pad's own stair down, which is the way into the service spine.
 *
 * **Nothing is left behind.** Roof edges and the long drop to the street are
 * the boundary: falling re-forms you on the most advanced roof a living
 * hunter stands on (or the last checkpoint roof). The launcher's nets refill
 * at every checkpoint roof and on every respawn; anyone who ran past the rack
 * is handed one by the first resupply crate. A wipe holds him, and the party
 * re-forms on the last checkpoint with him a lead ahead.
 */

type Rect = { x0: number; x1: number; z0: number; z1: number };
interface Roof extends Rect {
  name: string;
  /** roof top, over the section floor */
  y: number;
  /** route order (the two fork roofs share one) */
  rank: number;
  checkpoint?: { spot: [number, number]; facing: [number, number]; markNode: number; crate: [number, number] };
}

/**
 * The route as the diagram draws it (docs/sections/16-the-mark-runs.svg, 3 px
 * = 1 m): out along the near row, down round the corner, and back along the
 * far row to the pad. Plan metres here; `OX`/`OZ` centre it on the stage.
 */
const ROOFS: Roof[] = [
  { name: 'R1', x0: 0, x1: 40, z0: -13, z1: 13, y: 0, rank: 0,
    checkpoint: { spot: [13, 0], facing: [1, 0], markNode: 0, crate: [9, 8] } },
  { name: 'R2', x0: 52, x1: 90, z0: -14, z1: 14, y: 2, rank: 1 },
  { name: 'R3a', x0: 102, x1: 137, z0: -43, z1: -23, y: 7, rank: 2 },
  { name: 'R3b', x0: 102, x1: 137, z0: -10, z1: 10, y: -3, rank: 2 },
  { name: 'R4', x0: 149, x1: 189, z0: -12, z1: 12, y: 1, rank: 3,
    checkpoint: { spot: [154, 4], facing: [1, 0], markNode: 12, crate: [152, 9] } },
  { name: 'R5', x0: 203, x1: 243, z0: -14, z1: 14, y: 5, rank: 4 },
  { name: 'R6', x0: 206, x1: 246, z0: 30, z1: 70, y: -2, rank: 5,
    checkpoint: { spot: [228, 37], facing: [0, 1], markNode: 17, crate: [241, 36] } },
  { name: 'R7', x0: 155, x1: 195, z0: 38, z1: 62, y: 2, rank: 6 },
  { name: 'R8a', x0: 108, x1: 143, z0: 40, z1: 60, y: 0, rank: 7 },
  { name: 'R8b', x0: 106, x1: 141, z0: 70, z1: 90, y: 6, rank: 7 },
  { name: 'R9', x0: 54, x1: 94, z0: 38, z1: 62, y: 3, rank: 8,
    checkpoint: { spot: [89, 48], facing: [-1, 0], markNode: 26, crate: [90, 40] } },
  { name: 'R10', x0: 0, x1: 38, z0: 31, z1: 69, y: 6, rank: 9 },
];
const PAD = 11;

/**
 * His route: [x, z, roof index, next ids, leap in?, tag]. Ids are the array
 * order, and the order is route order (branch a, then branch b, then on),
 * which is what lets a restart re-arm "every trick after this node".
 */
type NodeDef = [number, number, number, number[], boolean, string?];
const ROUTE: NodeDef[] = [
  /* 0 */ [32, 0, 0, [1], false],
  /* 1 */ [38.5, 0, 0, [2], false, 'call-0'],
  /* 2 */ [53.5, 0, 1, [3], true],
  /* 3 */ [88.5, -6, 1, [4, 7], false, 'fork-0'],
  /* 4 */ [103.5, -25, 2, [5], true],
  /* 5 */ [120, -33, 2, [6], false],
  /* 6 */ [135.5, -25, 2, [10], false],
  /* 7 */ [103.5, -2, 3, [8], true],
  /* 8 */ [120, 0, 3, [9], false],
  /* 9 */ [135.5, -2, 3, [10], false],
  /* 10 */ [150.5, -3, 4, [11], true],
  /* 11 */ [158, -1, 4, [12], false, 'kick-0'],
  /* 12 */ [187.5, 0, 4, [13], false, 'call-1'],
  /* 13 */ [204.5, 0, 5, [14], true],
  /* 14 */ [228, 12.5, 5, [15], false],
  /* 15 */ [228, 31.5, 6, [16], true],
  /* 16 */ [226, 50, 6, [17], false],
  /* 17 */ [207.5, 50, 6, [18], false, 'call-2'],
  /* 18 */ [193.5, 50, 7, [19], true],
  /* 19 */ [180, 50, 7, [20], false, 'kick-1'],
  /* 20 */ [157, 57, 7, [21, 23], false, 'fork-1'],
  /* 21 */ [141, 52, 8, [22], true],
  /* 22 */ [110, 50, 8, [25], false, 'call-3'],
  /* 23 */ [137, 74, 9, [24], true],
  /* 24 */ [107.5, 72, 9, [25], false, 'call-3'],
  /* 25 */ [92.5, 52, 10, [26], true],
  /* 26 */ [55.5, 50, 10, [27], false],
  /* 27 */ [36.5, 50, 11, [28], true, 'sign'],
  /* 28 */ [19, 50, 11, [], false, 'end'],
];

/** plan metres to stage metres: the route's middle over the stage origin */
const OX = -123;
const OZ = -25;
/** the long drop: bodies below this (over the section floor) are off the roofs */
const DROP = -14;
/** the street haze, far below */
const STREET = -58;

/** pirates he has paid, by roof: [roof, [x, z] posts] */
const POSTS: [number, [number, number][]][] = [
  [1, [[74, -10], [78, 6], [63, -9], [84, 10]]],
  [5, [[217, -9], [222, -4], [236, -3], [212, 9]]],
  [8, [[124, 45], [131, 57], [118, 44], [136, 46]]],
  [10, [[67, 43], [75, 44], [80, 58], [61, 42]]],
];
/** which squad a call wakes */
const CALLS: Record<string, number> = { 'call-0': 0, 'call-1': 1, 'call-2': 2, 'call-3': 3 };

/**
 * Bounty value a blaster hit costs: per 34 damage in the chase (a bolt), and
 * on the pad as a share of his health (wearing him to half by blaster alone
 * costs 15%; hands and nets cost nothing)
 */
const CHASE_COST = 0.04;
const DUEL_COST = 0.3;
/** at or over this he is worth the full bounty (the bonus) */
const FULL_BOUNTY = 0.85;
/** a net takes him on the pad at or below this share of his health */
const NET_TAKES = 0.5;
/** nets a launcher holds */
const NETS = 3;
/** hits at or over this are no weapon in the game — a scripted removal, and he is not removed */
const NOT_A_HIT = 5000;

type Phase = 'intro' | 'chase' | 'duel' | 'taken' | 'dead';

function build(ctx: SectionContext): SectionInstance & { testKit: unknown } {
  const { game, spec } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections['mark-runs'];
  const party = Math.max(1, game.players.length);
  const P = (x: number, z: number, y = 0): THREE.Vector3 => new THREE.Vector3(x + OX, Y0 + y, z + OZ);

  // ---- materials ----
  const roofMat = ctx.paint(0x7a7f8a, { rough: 0.9, metal: 0.1 });
  ctx.tile(roofMat, 'rooftop', 6, 6);
  const facadeMat = ctx.paint(spec.palette.wall, { rough: 0.8, metal: 0.25 });
  ctx.tile(facadeMat, 'city_facade', 4, 10, { glow: 'city_facade_glow' });
  const metalMat = ctx.paint(0x5a5f66, { rough: 0.5, metal: 0.7 });
  ctx.tile(metalMat, 'metal_hull', 1, 1);
  const darkMat = ctx.paint(0x23262c, { rough: 0.7, metal: 0.4 });
  const crateMat = ctx.paint(0x8a6a3a, { rough: 0.85, metal: 0.1 });
  const padMat = ctx.paint(0x5a606c, { rough: 0.7, metal: 0.35 });
  ctx.tile(padMat, 'metal_deck', 5, 5);
  const trim = new THREE.MeshBasicMaterial({ color: spec.palette.accent });
  ctx.own(trim);
  const warm = new THREE.MeshBasicMaterial({ color: 0xffb070 });
  ctx.own(warm);
  const checkGlow = new THREE.MeshBasicMaterial({ color: 0x7bd389 });
  ctx.own(checkGlow);

  // ---- the roofs, and the towers under them ----
  // Each roof is the top of a tower that goes down into the haze: a slab to
  // stand on, a glowing lip at the edge (the edge is the boundary, and it has
  // to read as one from a run), and the facade below it.
  const roofAt = (x: number, z: number, y?: number): number => {
    for (let i = 0; i < ROOFS.length; i++) {
      const r = ROOFS[i];
      if (x >= r.x0 + OX && x <= r.x1 + OX && z >= r.z0 + OZ && z <= r.z1 + OZ) {
        if (y === undefined || Math.abs(y - (Y0 + r.y)) < 2.6) return i;
      }
    }
    return -1;
  };
  for (const r of ROOFS) {
    const cx = (r.x0 + r.x1) / 2 + OX, cz = (r.z0 + r.z1) / 2 + OZ;
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const top = Y0 + r.y;
    ctx.box(cx, top - 0.5, cz, w, 1, d, r.name === 'R10' ? padMat : roofMat);
    // the tower, stepped in a little under the roof's cornice
    const towerH = top - 1 - (Y0 + STREET);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w - 1.2, towerH, d - 1.2), facadeMat);
    tower.position.set(cx, top - 1 - towerH / 2, cz);
    tower.receiveShadow = true;
    ctx.mesh(tower);
    ctx.own(tower.geometry);
    // the lip: a knee-high parapet line that glows, all the way round
    for (const [x, z, sx, sz] of [
      [cx, r.z0 + OZ + 0.15, w, 0.3], [cx, r.z1 + OZ - 0.15, w, 0.3],
      [r.x0 + OX + 0.15, cz, 0.3, d], [r.x1 + OX - 0.15, cz, 0.3, d],
    ] as const) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.35, sz), darkMat);
      lip.position.set(x, top + 0.17, z);
      ctx.mesh(lip);
      ctx.own(lip.geometry);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(sx === 0.3 ? 0.32 : sx, 0.06, sz === 0.3 ? 0.32 : sz), r.checkpoint ? checkGlow : trim);
      glow.position.set(x, top + 0.37, z);
      ctx.mesh(glow);
      ctx.own(glow.geometry);
    }
  }

  // ---- the city: towers that are not on the route, the street far below ----
  // The route's towers stand among others, taller and shorter, all the way
  // to the fog; the street is a haze of light sixty metres down.
  const rng = (() => { let s = 9127; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const cityMat = ctx.paint(0x3a4258, { rough: 0.85, metal: 0.2 });
  ctx.tile(cityMat, 'city_facade', 3, 12, { glow: 'city_facade_glow' });
  const clear = (x: number, z: number, r: number): boolean => {
    for (const f of ROOFS) {
      if (x + r > f.x0 + OX - 8 && x - r < f.x1 + OX + 8 && z + r > f.z0 + OZ - 8 && z - r < f.z1 + OZ + 8) return false;
    }
    return true;
  };
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2;
    const dist = 40 + rng() * 260;
    const x = Math.cos(a) * dist * 1.3, z = Math.sin(a) * dist;
    const w = 14 + rng() * 22, d = 14 + rng() * 22;
    if (!clear(x, z, Math.max(w, d) / 2)) continue;
    // near ones stay under the roofs, so the route's tops read as the tops;
    // far ones climb into the skyline
    const h = (dist < 140 ? -6 - rng() * 20 : -10 + rng() * 70) - STREET;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cityMat);
    m.position.set(x, Y0 + STREET + h / 2, z);
    ctx.mesh(m);
    ctx.own(m.geometry);
  }
  const streetMat = new THREE.MeshBasicMaterial({ color: 0x2a1e2e, transparent: true, opacity: 0.92, depthWrite: false });
  ctx.own(streetMat);
  const street = new THREE.Mesh(new THREE.PlaneGeometry(900, 700), streetMat);
  street.rotation.x = -Math.PI / 2;
  street.position.set(0, Y0 + STREET + 2, 0);
  ctx.mesh(street);
  ctx.own(street.geometry);
  // traffic lanes down there: long streaks of light, the only thing to see of the street
  const laneMat = new THREE.MeshBasicMaterial({ color: 0xffa860, transparent: true, opacity: 0.55 });
  ctx.own(laneMat);
  for (const [z, len] of [[-2, 600], [44, 600], [-70, 500], [110, 500]] as const) {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.2), laneMat);
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, Y0 + STREET + 2.3, z + OZ + 25);
    ctx.mesh(lane);
    ctx.own(lane.geometry);
  }

  // ---- dressing and obstacles: vents, tanks, masts, signs ----
  const vent = (x: number, z: number, y: number, sx = 2.2, sz = 2.2): void => {
    ctx.box(P(x, z).x, Y0 + y + 0.6, P(x, z).z, sx, 1.2, sz, metalMat);
  };
  const tank = (x: number, z: number, y: number): void => {
    const at = P(x, z, y);
    ctx.cyl(at.x, at.y + 2.9, at.z, 2.1, 5.8, metalMat);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(2.1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), metalMat);
    cap.position.set(at.x, at.y + 5.8, at.z);
    ctx.mesh(cap);
    ctx.own(cap.geometry);
  };
  const mast = (x: number, z: number, y: number, h = 11): void => {
    const at = P(x, z, y);
    ctx.cyl(at.x, at.y + h / 2, at.z, 0.22, h, darkMat);
    const blink = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3a2a }));
    blink.position.set(at.x, at.y + h + 0.2, at.z);
    ctx.mesh(blink);
    ctx.own(blink.geometry);
    ctx.own(blink.material as THREE.Material);
  };
  const signMats = ['neon_sign', 'neon_sign_2', 'neon_sign_3'].map((name, i) => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x222222, emissive: [0xff4ad0, 0x4ad8ff, 0xffb040][i], emissiveIntensity: 1.3,
      transparent: true, side: THREE.DoubleSide,
    });
    ctx.own(m);
    ctx.tile(m, name, 1, 1, { glow: name });
    return m;
  });
  /** a roof-edge neon sign on two posts, facing out along (fx, fz) */
  const neon = (x: number, z: number, y: number, yaw: number, k: number, w = 6): void => {
    const at = P(x, z, y);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.42), signMats[k % 3]);
    panel.position.set(at.x, at.y + 3 + w * 0.21, at.z);
    panel.rotation.y = yaw;
    ctx.mesh(panel);
    ctx.own(panel.geometry);
    for (const s of [-1, 1]) {
      const px = at.x + Math.cos(yaw) * s * (w / 2 - 0.3);
      const pz = at.z - Math.sin(yaw) * s * (w / 2 - 0.3);
      ctx.cyl(px, at.y + 1.5 + w * 0.21, pz, 0.12, 3 + w * 0.42, darkMat);
    }
  };
  vent(26, -8, 0); vent(22, 8, 0, 3, 1.6);
  tank(67, 8, 2); vent(80, 9, 2); vent(60, -6, 2, 1.6, 3);
  neon(86, -13.6, 2, 0, 0); neon(20, 12.6, 0, 0, 2, 8);
  tank(130, -37.5, 7); vent(112, -38, 7);
  mast(126, 6, -3); vent(112, -7, -3);
  tank(183, 8, 1); vent(170, 7, 1);
  mast(237, 7, 5, 13); vent(214, -9, 5); vent(230, -9, 5, 3, 2);
  tank(217, 63, -2); vent(238, 42, -2); vent(212, 39, -2); neon(245.6, 52, -2, Math.PI / 2, 1, 8);
  neon(190, 38.4, 2, 0, 1); vent(168, 42, 2);
  vent(118, 57, 0); mast(140, 43, 0, 9);
  tank(125, 86, 6); vent(132, 76, 6);
  tank(63, 57, 3); neon(74, 61.6, 3, 0, 0, 7);

  // ---- the stair head he came up, and the door shut behind the party ----
  // The plaza's way on was a fire-stair door in the tower facades; this is
  // the top of that stair. Its door is shut behind you: one way.
  const hutAt = P(4, 0, 0);
  ctx.box(hutAt.x - 1.4, Y0 + 1.8, hutAt.z, 3.2, 3.6, 6.4, facadeMat);         // back of the stair head
  ctx.box(hutAt.x + 0.6, Y0 + 1.8, hutAt.z - 2.6, 1.2, 3.6, 1.2, facadeMat);   // jambs
  ctx.box(hutAt.x + 0.6, Y0 + 1.8, hutAt.z + 2.6, 1.2, 3.6, 1.2, facadeMat);
  ctx.box(hutAt.x - 0.4, Y0 + 3.9, hutAt.z, 5.2, 0.6, 6.8, darkMat);             // its roof
  // the door, shut: jamb to jamb and up to the roof, no slot over it
  ctx.box(hutAt.x + 0.9, Y0 + 1.8, hutAt.z, 0.2, 3.6, 4, metalMat);
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.4), warm);
  exitSign.position.set(hutAt.x + 1.02, Y0 + 3.45, hutAt.z);
  exitSign.rotation.y = Math.PI / 2;
  ctx.mesh(exitSign);
  ctx.own(exitSign.geometry);

  // ---- the landing pad, and its stair down to the service spine ----
  const pad = ROOFS[PAD];
  const padY = Y0 + pad.y;
  const padC = P(19, 50, pad.y);
  const ring = new THREE.Mesh(new THREE.RingGeometry(9, 9.6, 48), warm);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(padC.x, padY + 0.03, padC.z);
  ctx.mesh(ring);
  ctx.own(ring.geometry);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.25, 8), trim);
    lamp.position.set(padC.x + Math.cos(a) * 15.5, padY + 0.12, padC.z + Math.sin(a) * 15.5);
    ctx.mesh(lamp);
    ctx.own(lamp.geometry);
  }
  // the stair down: a hatch-house on the pad's far edge, open, lit from below
  const stairAt = P(4.5, 50, pad.y);
  ctx.box(stairAt.x - 1.6, padY + 1.8, stairAt.z, 2.8, 3.6, 6.4, facadeMat);
  ctx.box(stairAt.x + 0.4, padY + 1.8, stairAt.z - 2.6, 1.2, 3.6, 1.2, facadeMat);
  ctx.box(stairAt.x + 0.4, padY + 1.8, stairAt.z + 2.6, 1.2, 3.6, 1.2, facadeMat);
  ctx.box(stairAt.x - 0.6, padY + 3.9, stairAt.z, 5.2, 0.6, 6.8, darkMat);
  const well = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4), new THREE.MeshBasicMaterial({ color: 0x0c0a0a }));
  ctx.own(well.geometry);
  ctx.own(well.material as THREE.Material);
  well.rotation.x = -Math.PI / 2;
  well.position.set(stairAt.x - 0.9, padY + 0.03, stairAt.z);
  ctx.mesh(well);
  const stairGlow = new THREE.PointLight(0xffb070, 18, 14, 1.6);
  stairGlow.position.set(stairAt.x + 0.5, padY + 2.4, stairAt.z);
  ctx.mesh(stairGlow);
  const spineSign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.7), signMats[1]);
  spineSign.position.set(stairAt.x + 1.05, padY + 4.6, stairAt.z);
  spineSign.rotation.y = Math.PI / 2;
  ctx.mesh(spineSign);
  ctx.own(spineSign.geometry);
  const stairDoor = new THREE.Vector3(stairAt.x + 1.6, padY, stairAt.z);

  // ---- light: the low sun, and the pad's lamps ----
  const padLight = new THREE.PointLight(0xffc890, 24, 40, 1.4);
  padLight.position.set(padC.x, padY + 8, padC.z);
  ctx.mesh(padLight);

  // ---- the net launcher rack, and the resupply crates on the checkpoint roofs ----
  const rackAt = P(9, -8, 0);
  const rack = new THREE.Group();
  const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 0.6), darkMat);
  rackFrame.position.y = 0.55;
  const launcherMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.9, 10), metalMat);
  launcherMesh.rotation.z = Math.PI / 2;
  launcherMesh.position.y = 1.25;
  const rackGlow = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.7), new THREE.MeshBasicMaterial({ color: 0xb48cff }));
  rackGlow.position.y = 1.12;
  rack.add(rackFrame, launcherMesh, rackGlow);
  for (const m of [rackFrame, launcherMesh, rackGlow]) ctx.own(m.geometry);
  ctx.own(rackGlow.material as THREE.Material);
  rack.position.copy(rackAt);
  ctx.mesh(rack);
  const crates = ROOFS.filter((r) => r.checkpoint).map((r) => {
    const [cx, cz] = r.checkpoint!.crate;
    const at = P(cx, cz, r.y);
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.8), crateMat);
    box.position.y = 0.4;
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.1, 0.85), rackGlow.material as THREE.Material);
    band.position.y = 0.62;
    g.add(box, band);
    ctx.own(box.geometry);
    ctx.own(band.geometry);
    g.position.copy(at);
    ctx.mesh(g);
    return { at, roof: ROOFS.indexOf(r) };
  });

  // ---- his route ----
  const nodes: RunNode[] = ROUTE.map(([x, z, roof, next, leap, tag]) => ({
    at: P(x, z, ROOFS[roof].y), next, leap, tag,
  }));
  const nodeRoof = ROUTE.map((n) => n[2]);

  // ---- the crate stacks he kicks down behind him ----
  // A stack stands beside his line. As he passes it he kicks it: it wobbles
  // for a second (the telegraph), then goes over *back along his line*, at
  // whoever is following, and the crates lie where they fall as cover and
  // clutter. A restart from a checkpoint behind it stands it back up.
  type Stack = {
    node: number; base: THREE.Vector3; dir: THREE.Vector3; meshes: THREE.Mesh[];
    state: 'standing' | 'wobble' | 'falling' | 'down'; t: number;
    fallen: { box: import('../core/physics').StaticBox }[]; hit: Set<number>;
  };
  const crateGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
  ctx.own(crateGeo);
  const makeStack = (node: number, x: number, z: number, dx: number): Stack => {
    const base = P(x, z, ROOFS[nodeRoof[node]].y);
    const meshes = [0, 1, 2, 3, 4].map(() => {
      const m = new THREE.Mesh(crateGeo, crateMat);
      m.castShadow = true;
      ctx.mesh(m);
      return m;
    });
    const s: Stack = { node, base, dir: new THREE.Vector3(dx, 0, 0), meshes, state: 'standing', t: 0, fallen: [], hit: new Set() };
    return s;
  };
  const stackPose = (s: Stack): void => {
    // a pyramid: three on the roof, two on top
    const slots: [number, number, number][] = [[0, 0.7, -0.75], [0, 0.7, 0.75], [0.1, 2.1, 0], [-0.8, 0.7, 0], [0.8, 2.1, 0.2]];
    s.meshes.forEach((m, i) => {
      const [ox, oy, oz] = slots[i];
      m.position.set(s.base.x + ox, s.base.y + oy, s.base.z + oz);
      m.rotation.set(0, i * 0.3, 0);
    });
  };
  const stacks = [makeStack(11, 154.5, -6.5, -1), makeStack(19, 186, 46.5, 1)];
  const stackBoxes = stacks.map((s) => ctx.box(s.base.x, s.base.y + 1.4, s.base.z, 2.6, 2.8, 2.6, null).box);
  const resetStack = (s: Stack, i: number): void => {
    for (const f of s.fallen) ctx.unsolid({ box: f.box });
    s.fallen = [];
    s.state = 'standing';
    s.t = 0;
    s.hit.clear();
    stackPose(s);
    if (!game.board.physics.boxes.includes(stackBoxes[i])) {
      stackBoxes[i] = ctx.box(s.base.x, s.base.y + 1.4, s.base.z, 2.6, 2.8, 2.6, null).box;
    }
  };
  stacks.forEach(resetStack);

  // ---- the sign over the last gap ----
  // A big neon sign hangs from a gantry over the gap between the last roof and
  // the pad, well over any jump. As he lands on the pad he shoots its hangers:
  // it sparks and sags for a second and a half, then drops into the gap and
  // hangs there, live, from the pad's height to seven metres above it. The
  // last crossing goes over it.
  const gapX = (ROOFS[10].x0 + ROOFS[PAD].x1) / 2 + OX;
  const gapZ = 50 + OZ;
  for (const s of [-1, 1]) ctx.cyl(gapX, Y0 + 8, gapZ + s * 10.5, 0.3, 22, darkMat);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 21.6), darkMat);
  beam.position.set(gapX, Y0 + 18.8, gapZ);
  ctx.mesh(beam);
  ctx.own(beam.geometry);
  const SIGN_W = 18, SIGN_H = 5.5;
  const signMesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, SIGN_H, SIGN_W), signMats[0]);
  ctx.own(signMesh.geometry);
  ctx.mesh(signMesh);
  const signUp = Y0 + 15.5;              // its centre, hanging
  const signDown = padY + SIGN_H / 2 - 1; // its centre, dropped into the gap
  const sign = { state: 'up' as 'up' | 'sparking' | 'falling' | 'down', t: 0, live: 0, box: null as import('../core/physics').StaticBox | null };
  const resetSign = (): void => {
    sign.state = 'up';
    sign.t = 0;
    sign.live = 0;
    if (sign.box) { ctx.unsolid({ box: sign.box }); sign.box = null; }
    signMesh.position.set(gapX, signUp, gapZ);
    signMesh.rotation.set(0, 0, 0);
  };
  resetSign();

  // ---- the mark ----
  let mark: Enemy | null = null;
  let runner: Runner | null = null;
  let phase: Phase = 'intro';
  let introT = 0;
  let value = 1;
  let complete = false;
  let checkpoint = 0;      // index into ROOFS of the last checkpoint roof
  let reached = 0;         // highest roof rank a living hunter has stood on
  let wiped = false;
  let restartT = 0;        // the pause before he runs again after a restart
  let forkNote = 0;
  /** the full-bounty banner follows the result banner after this long */
  let fullBountyT = 0;
  const squads: Enemy[][] = POSTS.map(() => []);
  const called = POSTS.map(() => false);
  // the pack on his back: the jetpack pirate's kit on the gunslinger
  const pack = new THREE.Group();
  const tankGeo = new THREE.CylinderGeometry(0.1, 0.11, 0.5, 10);
  ctx.own(tankGeo);
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(tankGeo, metalMat);
    t.position.set(s * 0.12, 0, 0);
    pack.add(t);
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 8), darkMat);
    nozzle.position.set(s * 0.12, -0.3, 0);
    nozzle.rotation.x = Math.PI;
    ctx.own(nozzle.geometry);
    pack.add(nozzle);
  }
  pack.position.set(0, 1.28, -0.24);
  // the net that wraps him when one lands
  const wrapMat = new THREE.MeshBasicMaterial({ color: 0xd8e0b0, wireframe: true, transparent: true, opacity: 0.85 });
  ctx.own(wrapMat);
  const wrap = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), wrapMat);
  ctx.own(wrap.geometry);
  wrap.visible = false;
  ctx.mesh(wrap);
  let wrapT = 0;
  // the duel's evasive hop, and a snare on the pad
  const hop = { t: 0, dur: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), cd: 4 };
  let snareT = 0;
  /** the next hit on him is a melee blow (set by `meleeHit`, spent by `hurt`) */
  let handPending = false;
  let duelHp0 = 0;

  // ---- the net launcher, per hunter ----
  const armed = [false, false, false, false];
  const nets = [0, 0, 0, 0];
  const netCd = [0, 0, 0, 0];
  const wasAlive = [true, true, true, true];
  type Net = { pos: THREE.Vector3; vel: THREE.Vector3; life: number; slot: number; mesh: THREE.Mesh };
  const flying: Net[] = [];
  const netGeo = new THREE.IcosahedronGeometry(0.4, 0);
  ctx.own(netGeo);

  const hunters = (): THREE.Vector3[] => game.players.filter((p) => p.alive).map((p) => p.position);
  const living = (): Player[] => game.players.filter((p) => p.alive);
  const markCentre = (): THREE.Vector3 => mark!.position.clone().setY(mark!.position.y + 1.0);

  const arm = (p: Player, note: boolean): void => {
    const first = !armed[p.slot];
    armed[p.slot] = true;
    nets[p.slot] = NETS;
    if (first && note) ctx.announce(T.armed, T.armedSub);
  };

  const fireNet = (p: Player): void => {
    nets[p.slot]--;
    netCd[p.slot] = 0.9;
    const dir = p.cam.aimDir(new THREE.Vector3());
    const from = p.position.clone();
    from.y += 1.5;
    from.addScaledVector(dir, 0.8);
    const mesh = new THREE.Mesh(netGeo, wrapMat);
    ctx.mesh(mesh);
    flying.push({ pos: from, vel: dir.multiplyScalar(30).add(new THREE.Vector3(0, 1.5, 0)), life: 1.3, slot: p.slot, mesh });
    audio.rocket();
  };

  const updateNets = (dt: number): void => {
    for (let i = flying.length - 1; i >= 0; i--) {
      const n = flying[i];
      n.life -= dt;
      n.vel.y -= 5 * dt;
      // a net launcher is a forgiving weapon: it bends onto the mark from a
      // generous cone, and it is short-ranged for it
      if (mark && mark.alive && (phase === 'chase' || phase === 'duel' || phase === 'intro')) {
        const to = markCentre().sub(n.pos);
        const d = to.length();
        if (d < 36) {
          const v = n.vel.length();
          const ang = n.vel.angleTo(to);
          if (ang < 0.45) n.vel.lerp(to.normalize().multiplyScalar(v), Math.min(1, dt * 7));
        }
      }
      n.pos.addScaledVector(n.vel, dt);
      n.mesh.position.copy(n.pos);
      n.mesh.rotation.x += dt * 9;
      n.mesh.scale.setScalar(1 + (1.3 - n.life) * 1.6);
      let done = n.life <= 0 || n.pos.y < Y0 + DROP;
      if (!done && mark && mark.alive && n.pos.distanceTo(markCentre()) < 1.5) {
        netHit(n.slot);
        done = true;
      }
      if (!done) {
        for (const e of game.enemies) {
          if (e === mark || !e.alive || e.team !== 1) continue;
          if (n.pos.distanceTo(e.position.clone().setY(e.position.y + 1)) < 1.3) {
            e.knockdown(2.6);
            e.knockback(n.pos, 4, 0.4);
            done = true;
            break;
          }
        }
      }
      if (done) {
        game.particles.impactSparks(n.pos, 6);
        n.mesh.removeFromParent();
        flying.splice(i, 1);
      }
    }
  };

  const netHit = (slot: number): void => {
    if (!mark || !runner) return;
    void slot;
    wrapT = phase === 'duel' ? 2.6 : 2.4;
    if (phase === 'duel') {
      if (mark.hp <= mark.maxHp * NET_TAKES) { take('net'); return; }
      snareT = 2.6;
      hop.t = 0;
      ctx.announce(T.netted, T.nettedSub);
      return;
    }
    if (runner.hit('net', 2.4)) ctx.announce(T.netted, T.nettedSub);
  };

  const take = (how: 'net' | 'hand'): void => {
    if (!mark || phase === 'taken' || phase === 'dead') return;
    phase = 'taken';
    wrapT = how === 'net' ? Infinity : 0;
    mark.team = 0;           // nobody's target now: the bolts go elsewhere
    const anim = mark.char.animator;
    if (anim) {
      anim.release('lower'); anim.release('upper');
      anim.playOnce('lower', 'deathLower', 0.08, true);
      anim.playOnce('upper', 'deathUpper', 0.08, true);
    }
    mark.scripted = {
      drive: (e) => { e.velocity.set(0, 0, 0); return 'still'; },
      hurt: () => 0,
    };
    finish(true);
  };

  const finish = (alive: boolean): void => {
    const worth = alive ? value : value * 0.5;
    const pct = Math.round(worth * 100);
    ctx.announce(alive ? T.taken(pct) : T.killed(pct), T.takenSub);
    audio.waveClear();
    if (alive && value >= FULL_BOUNTY) {
      for (const p of game.players) p.rocketCd = 0;
      fullBountyT = 2.2;
    }
  };

  /** what a hit on him does: the chase turns it into a stagger, the pad into health */
  const hurt = (amount: number, from: THREE.Vector3, bySlot: number): number => {
    if (amount >= NOT_A_HIT || !mark) return 0;
    // a hand on him is a melee blow (a swing, a lunge), flagged by the
    // player's own melee pipeline just before it lands; gunfire at any range is not
    const hand = handPending && bySlot >= 0;
    handPending = false;
    void from;
    if (phase === 'intro' || phase === 'chase') {
      if (hand) runner?.hit('melee');
      else {
        runner?.hit('bolt');
        if (bySlot >= 0) value = Math.max(0, value - CHASE_COST * Math.min(3, amount / 34));
      }
      return 0;
    }
    if (phase === 'duel') {
      const cap = Math.min(amount, mark.maxHp * 0.2);
      if (hand) {
        if (mark.hp - cap <= 0) { take('hand'); return 0; }
        return cap;
      }
      if (bySlot >= 0) value = Math.max(0, value - DUEL_COST * (cap / mark.maxHp));
      return cap;
    }
    return 0;
  };

  // ---- checkpoints, restarts and the fallen ----
  const cpRoof = (): Roof => ROOFS[checkpoint];
  const cpSpot = (): THREE.Vector3 => {
    const c = cpRoof().checkpoint!;
    return P(c.spot[0], c.spot[1], cpRoof().y);
  };
  const cpFacing = (): THREE.Vector3 => {
    const c = cpRoof().checkpoint!;
    return new THREE.Vector3(c.facing[0], 0, c.facing[1]);
  };

  /**
   * He got away (or the party wiped): everyone back on the last checkpoint
   * roof, him a lead ahead on his route, every trick after that point stood
   * back up, and a breath before he runs again.
   */
  const restart = (why: 'escaped' | 'wiped'): void => {
    if (!runner || !mark) return;
    const c = cpRoof().checkpoint!;
    for (const p of game.players) {
      if (!p.alive) continue;
      p.position.copy(ctx.defaultRespawn(p.slot, cpSpot(), cpFacing()));
      p.velocity.set(0, 0, 0);
    }
    for (let s = 0; s < 4; s++) if (armed[s]) nets[s] = NETS;
    runner.placeAt(c.markNode, true);
    stacks.forEach((s, i) => { if (s.node > c.markNode) resetStack(s, i); });
    if (27 > c.markNode) resetSign();
    restartT = 2.5;
    wrapT = 0;
    if (why === 'escaped') ctx.announce(T.escaped, T.escapedSub);
    else ctx.announce(T.regroup, T.regroupSub);
  };

  const onNode = (id: number, node: RunNode): void => {
    const tag = node.tag;
    if (!tag) return;
    if (tag in CALLS) callSquad(CALLS[tag]);
    if (tag.startsWith('kick-')) {
      const s = stacks[Number(tag.slice(5))];
      if (s && s.state === 'standing') { s.state = 'wobble'; s.t = 0; }
    }
    if (tag === 'sign' && sign.state === 'up') { sign.state = 'sparking'; sign.t = 0; }
    if (tag.startsWith('fork-') && forkNote <= 0) {
      forkNote = 20;
    }
    void id;
  };

  const callSquad = (k: number): void => {
    if (called[k]) return;
    called[k] = true;
    const lead = living()[0];
    for (const e of squads[k]) if (e.alive && lead) e.alert(lead.position, true);
    if (k === 0) ctx.announce(T.called, T.calledSub);
  };

  const startDuel = (): void => {
    if (!mark || phase !== 'chase') return;
    phase = 'duel';
    // a duelist: the gunslinger promoted — he turns hits aside, he flashes
    // when one lands — with a pack to hop with, but no leap off his own pad
    mark.hp = 190;
    mark.promoteBoss(T.markName, 4 + 1.5 * (party - 1), party === 1 ? 0.85 : 1, 1.08);
    mark.superJumpCd = Infinity;
    duelHp0 = mark.hp;
    mark.scripted = { drive: (e, dt) => duelDrive(e, dt), hurt };
    const lead = living()[0];
    if (lead) mark.alert(lead.position, true);
    ctx.announce(T.turns, T.turnsSub);
    audio.bossHorn(false);
  };

  /** the pad duel: the AI fights, except while he hops or is netted */
  const duelDrive = (e: Enemy, dt: number): 'ground' | 'air' | 'still' | false => {
    if (snareT > 0) {
      snareT -= dt;
      e.velocity.set(0, 0, 0);
      return 'ground';
    }
    // over the pad's edge: he catches himself on the pack and lands back on it
    if (e.position.y < padY - 3 && hop.t <= 0) startHop(e, padC.clone());
    if (hop.t > 0 || hop.dur > 0) {
      hop.t += dt;
      const k = Math.min(1, hop.t / hop.dur);
      const y = THREE.MathUtils.lerp(hop.from.y, hop.to.y, k) + 4 * 3.2 * k * (1 - k);
      e.position.set(THREE.MathUtils.lerp(hop.from.x, hop.to.x, k), y, THREE.MathUtils.lerp(hop.from.z, hop.to.z, k));
      e.velocity.set(0, 0, 0);
      const back = new THREE.Vector3(e.position.x - Math.sin(e.facingYaw) * 0.3, e.position.y + 1.15, e.position.z - Math.cos(e.facingYaw) * 0.3);
      game.particles.jetPlume(back, new THREE.Vector3(0, -1, 0), dt, { power: k < 0.5 ? 1 : 0.4, scale: 1.1 });
      if (k >= 1) { hop.t = 0; hop.dur = 0; hop.cd = 4.5 + Math.random() * 2.5; }
      return 'air';
    }
    hop.cd -= dt;
    // a hunter in his face: he jets away across the pad
    let near: Player | null = null;
    for (const p of living()) {
      if (Math.hypot(p.position.x - e.position.x, p.position.z - e.position.z) < 7) { near = p; break; }
    }
    if (hop.cd <= 0 && near) {
      const away = e.position.clone().sub(near.position).setY(0);
      if (away.lengthSq() < 0.01) away.set(1, 0, 0);
      away.normalize().multiplyScalar(11);
      const to = e.position.clone().add(away);
      // keep it on the pad, well in from the lip
      to.x = THREE.MathUtils.clamp(to.x, pad.x0 + OX + 5, pad.x1 + OX - 5);
      to.z = THREE.MathUtils.clamp(to.z, pad.z0 + OZ + 5, pad.z1 + OZ - 5);
      to.y = padY;
      startHop(e, to);
      return 'air';
    }
    return false;
  };
  const startHop = (e: Enemy, to: THREE.Vector3): void => {
    hop.from.copy(e.position);
    hop.to.copy(to).setY(padY);
    hop.t = 1e-3;
    hop.dur = 0.9;
    game.particles.jetIgnite(e.position.clone().setY(e.position.y + 1.1), new THREE.Vector3(0, -1, 0), 1.1);
  };

  const spawnAll = (): void => {
    // the mark, on the first roof's far side, looking back
    mark = ctx.spawn('gunslinger', nodes[0].at.clone(), { exact: true, squad: 8870 });
    mark.position.copy(nodes[0].at);
    mark.char.root.add(pack);
    mark.bossName = T.markName;
    runner = new Runner(mark, nodes, {
      sprint: party === 1 ? 12 : 12.5, run: party === 1 ? 8.6 : 9.0, jog: 6.4,
      close: 14, far: 38,
      stamina: 3, staminaRegen: 0.35,
      leapSpeed: 12, leapLift: 2.4,
      escape: party === 1 ? { dist: 75, secs: 10 } : { dist: 60, secs: 8 },
      stagger: 1.1, staggerGuard: 1.4,
      breather: 2.2, breatherCd: 8,
      shotEvery: 3.4, shotRange: 32, shotDamage: party === 1 ? 5 : 7,
      hunters,
      onNode,
      onFork: () => { ctx.announce(T.fork, T.forkSub); },
      onEscape: () => restart('escaped'),
      onEnd: () => startDuel(),
    }, game);
    mark.scripted = { ...mark.scripted, hurt };

    // his pirates, posted on four roofs
    POSTS.forEach(([roof, spots], k) => {
      const n = Math.min(spots.length, 2 + Math.ceil(party / 2));
      for (let i = 0; i < n; i++) {
        const kind: EnemyKind = i === n - 1 && party > 1 && (k === 1 || k === 3) ? 'jetpirate'
          : i === 2 && k === 2 ? 'pirateMelee' : 'pirate';
        const [x, z] = spots[i];
        squads[k].push(ctx.spawn(kind, P(x, z, ROOFS[roof].y), { exact: true, squad: 8880 + k }));
      }
    });
    // bacta on the checkpoint roofs, beside the resupply crates
    for (const c of crates) {
      if (c.roof === 0) continue;
      ctx.pickup(c.at.clone().add(new THREE.Vector3(2, 0, 0)));
    }
    if (party > 2) ctx.pickup(P(20, 58, ROOFS[PAD].y));

    ctx.announce(T.title, T.sub);
    for (const p of game.players) {
      p.sectionMove = composeMoves({
        meleeHit: (_pl, target, amount) => {
          if (target === mark) handPending = true;
          return amount;
        },
        adjust: (pl, _dt, input) => {
          if (armed[pl.slot] && nets[pl.slot] > 0 && input.rocketPressed && pl.alive) {
            if (netCd[pl.slot] <= 0) fireNet(pl);
            return { ...input, rocketPressed: false };
          }
          return input;
        },
      });
    }
  };

  const update = (dt: number): void => {
    if (complete) return;
    if (!mark || !runner) spawnAll();
    const m = mark!, run = runner!;
    for (let s = 0; s < 4; s++) netCd[s] = Math.max(0, netCd[s] - dt);
    forkNote = Math.max(0, forkNote - dt);
    if (fullBountyT > 0 && (fullBountyT -= dt) <= 0) ctx.announce(T.fullBounty, T.fullBountySub);

    // ---- the start: he waits at the far side of the first roof, then bolts ----
    if (phase === 'intro') {
      introT += dt;
      const close = run.gap < 22;
      if (introT > 3.2 || (close && introT > 1)) { phase = 'chase'; run.go(); }
    }
    if (restartT > 0) {
      restartT -= dt;
      if (restartT <= 0 && phase === 'chase') run.go();
    }

    // ---- the players: arming, resupply, respawn refills, checkpoints ----
    for (const p of game.players) {
      if (!p.alive) { wasAlive[p.slot] = false; continue; }
      if (!wasAlive[p.slot]) { wasAlive[p.slot] = true; if (armed[p.slot]) nets[p.slot] = NETS; }
      if (p.position.distanceTo(rackAt) < 2.6) arm(p, true);
      for (const c of crates) {
        if (p.position.distanceTo(c.at) < 2.8 && (!armed[p.slot] || nets[p.slot] < NETS)) {
          const was = armed[p.slot];
          arm(p, !was);
          if (was) ctx.announce(TEXT.banners.checkpoint, T.resupply);
        }
      }
      const r = roofAt(p.position.x, p.position.z, p.position.y);
      if (r >= 0 && p.grounded) {
        reached = Math.max(reached, ROOFS[r].rank);
        if (ROOFS[r].checkpoint && ROOFS[r].rank > cpRoof().rank) {
          checkpoint = r;
          ctx.checkpoint.copy(cpSpot());
          audio.checkpointChime();
          ctx.announce(TEXT.banners.checkpoint, ROOFS[r].name === 'R9' ? T.cpLast : T.cpNets);
          for (const q of game.players) if (armed[q.slot]) nets[q.slot] = NETS;
        }
      }
    }

    // ---- a wipe: he holds; the party re-forms on the checkpoint roof ----
    const anyAlive = game.players.some((p) => p.alive);
    if (!anyAlive && !wiped && (phase === 'chase' || phase === 'intro')) { wiped = true; run.hold(); }
    else if (anyAlive && wiped) { wiped = false; if (phase === 'chase' || phase === 'intro') { phase = 'chase'; restart('wiped'); } }

    // pirates wake when a hunter comes close, called or not
    POSTS.forEach(([roof], k) => {
      if (called[k]) return;
      const r = ROOFS[roof];
      const c = P((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, r.y);
      if (living().some((p) => p.position.distanceTo(c) < 34)) callSquad(k);
    });

    updateNets(dt);
    updateStacks(dt);
    updateSign(dt);

    // the net over him
    if (wrapT > 0) {
      wrapT -= dt;
      wrap.visible = true;
      wrap.position.copy(m.position).setY(m.position.y + (phase === 'taken' ? 0.4 : 1.0));
      wrap.rotation.y += dt * 0.6;
    } else wrap.visible = false;

    // ---- the pad ----
    if (phase === 'duel' && !m.alive) { phase = 'dead'; finish(false); }
    if (phase === 'duel' && m.alive) {
      // he never leaves the pad: a lip he is knocked over, he jets back from
      if (m.position.y < padY - 6) { m.position.copy(padC); m.velocity.set(0, 0, 0); }
    }
    if (phase === 'taken' || phase === 'dead') {
      for (const p of living()) {
        if (Math.hypot(p.position.x - stairDoor.x, p.position.z - stairDoor.z) < 2.8 && Math.abs(p.position.y - padY) < 2.5) complete = true;
      }
    }
  };

  // ---- the crates ----
  const updateStacks = (dt: number): void => {
    stacks.forEach((s, i) => {
      if (s.state === 'standing' || s.state === 'down') return;
      s.t += dt;
      if (s.state === 'wobble') {
        const k = Math.sin(s.t * 26) * 0.06 * Math.min(1, s.t * 2);
        s.meshes.forEach((m, j) => { m.rotation.z = k * (j % 2 ? 1 : -1); m.rotation.x = k * 0.5; });
        if (s.t >= 1.0) {
          s.state = 'falling';
          s.t = 0;
          ctx.unsolid({ box: stackBoxes[i] });
          ctx.announce(T.kick);
          audio.impact();
        }
        return;
      }
      // falling: each crate tumbles back along his line, at the hunters
      const k = Math.min(1, s.t / 0.9);
      s.meshes.forEach((m, j) => {
        const reach = 3 + j * 1.6;
        const side = (j - 2) * 0.9;
        const hFrom = j >= 2 && j !== 3 ? 2.1 : 0.7;
        m.position.set(
          s.base.x + s.dir.x * reach * k,
          s.base.y + 0.7 + (hFrom - 0.7) * (1 - k) + Math.sin(k * Math.PI) * 0.8,
          s.base.z + side * k,
        );
        m.rotation.z = -s.dir.x * k * (2.5 + j * 0.4);
      });
      // whoever is in the lane is knocked flat, once per fall
      for (const p of living()) {
        if (s.hit.has(p.slot)) continue;
        const along = (p.position.x - s.base.x) * s.dir.x;
        if (along > 0.5 && along < 3 + 4 * 1.6 * k + 1 && Math.abs(p.position.z - s.base.z) < 3.4 && Math.abs(p.position.y - s.base.y) < 2.5) {
          s.hit.add(p.slot);
          p.damage(party === 1 ? 14 : 18, s.base, -1);
          p.velocity.x += s.dir.x * 9;
          p.velocity.y += 3;
        }
      }
      if (k >= 1) {
        s.state = 'down';
        // they lie where they fell: low cover, and something to hop
        for (const m of s.meshes) {
          m.position.y = s.base.y + 0.7;
          m.rotation.set(0, m.rotation.y, 0);
          s.fallen.push({ box: ctx.box(m.position.x, m.position.y, m.position.z, 1.4, 1.4, 1.4, null).box });
        }
      }
    });
  };

  // ---- the sign ----
  const signBox = { x0: gapX - 0.6, x1: gapX + 0.6, z0: gapZ - SIGN_W / 2, z1: gapZ + SIGN_W / 2 };
  const updateSign = (dt: number): void => {
    if (sign.state === 'up' || sign.state === 'down' && sign.live <= 0) return;
    sign.t += dt;
    if (sign.state === 'sparking') {
      // the telegraph: sparks off both hangers, the panel shivering and flickering
      if (Math.random() < dt * 14) {
        const s = Math.random() < 0.5 ? -1 : 1;
        game.particles.impactSparks(new THREE.Vector3(gapX, Y0 + 18.4, gapZ + s * 8), 5);
      }
      signMesh.rotation.x = Math.sin(sign.t * 30) * 0.02;
      signMats[0].emissiveIntensity = 0.4 + Math.random() * 1.2;
      if (sign.t >= 1.5) { sign.state = 'falling'; sign.t = 0; ctx.announce(T.sign, T.signSub); }
      return;
    }
    if (sign.state === 'falling') {
      const k = Math.min(1, sign.t / 0.55);
      signMesh.position.y = THREE.MathUtils.lerp(signUp, signDown, k * k);
      signMesh.rotation.x = 0;
      if (k >= 1) {
        sign.state = 'down';
        sign.live = 10;
        sign.box = ctx.box(gapX, signDown, gapZ, 0.5, SIGN_H, SIGN_W, null).box;
        game.particles.impactSparks(new THREE.Vector3(gapX, signDown, gapZ), 24);
        audio.explosion();
      }
      return;
    }
    // down and live: it bites whoever touches it, for a while
    sign.live -= dt;
    signMats[0].emissiveIntensity = sign.live > 0 ? 0.9 + Math.sin(sign.t * 40) * 0.5 : 1.3;
    if (Math.random() < dt * 8) game.particles.impactSparks(new THREE.Vector3(gapX, signDown + (Math.random() - 0.5) * SIGN_H, gapZ + (Math.random() - 0.5) * SIGN_W), 3);
    for (const p of living()) {
      const x = p.position.x, z = p.position.z, y = p.position.y;
      if (x > signBox.x0 - 0.5 && x < signBox.x1 + 0.5 && z > signBox.z0 && z < signBox.z1
        && y < signDown + SIGN_H / 2 && y + 1.8 > signDown - SIGN_H / 2) {
        p.damage(party === 1 ? 8 : 12, new THREE.Vector3(gapX, y + 1, z), -1);
        p.velocity.x += (x < gapX ? -1 : 1) * 8;
        p.velocity.y = Math.max(p.velocity.y, 2);
      }
    }
  };

  // ---- the objective, the HUD ----
  const objective = () => {
    if (phase === 'taken' || phase === 'dead') {
      return { pos: stairDoor.clone(), label: T.stair, hint: T.hintStair, beacon: true };
    }
    const at = mark ? mark.position.clone() : nodes[0].at.clone();
    let hint: string = T.hintChase;
    if (phase === 'duel') hint = mark && mark.hp <= mark.maxHp * NET_TAKES ? T.hintNetNow : T.hintDuel;
    else if (!armed.some(Boolean) && reached === 0) hint = T.hintRack;
    else if (runner && runner.escapeT > 0.5) hint = T.hintEscaping;
    else if (forkNote > 14) hint = T.hintFork;
    // a light column on a man running across the roofs is wrong: the marker locks on him
    return { pos: at, label: T.mark, hint, beacon: false };
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p || !runner || !mark) return null;
    const bars: SectionBar[] = [];
    const netLine = armed[slot] ? T.nets(nets[slot]) : T.noLauncher;
    if (phase === 'intro' || phase === 'chase') {
      const esc = runner.opts.escape;
      const gap = Number.isFinite(runner.gap) ? runner.gap : esc.dist;
      const escaping = runner.escapeT > 0.05;
      bars.push({
        label: escaping ? T.escaping(Math.max(0, esc.secs - runner.escapeT)) : T.lead(Math.round(gap)),
        value: Math.min(1, gap / esc.dist),
        tone: escaping ? 'danger' : gap > esc.dist * 0.66 ? 'warn' : 'good',
      });
      bars.push({ label: T.bounty, value, tone: value >= FULL_BOUNTY ? 'info' : 'warn' });
      return { title: T.his, bars, line: escaping ? T.hintEscaping : netLine };
    }
    if (phase === 'duel') {
      bars.push({ label: T.fight, value: Math.max(0, mark.hp / Math.max(1, duelHp0)), tone: mark.hp <= mark.maxHp * NET_TAKES ? 'good' : 'danger' });
      bars.push({ label: T.bounty, value, tone: value >= FULL_BOUNTY ? 'info' : 'warn' });
      return { title: T.his, bars, line: mark.hp <= mark.maxHp * NET_TAKES && nets[slot] > 0 ? T.hintNetNow : netLine };
    }
    const worth = phase === 'taken' ? value : value * 0.5;
    bars.push({ label: T.bounty, value: worth, tone: 'good' });
    return { title: T.his, bars, line: phase === 'taken' ? T.taken(Math.round(worth * 100)) : T.killed(Math.round(worth * 100)) };
  };

  // ---- where the fallen come back: the most advanced roof a living hunter stands on ----
  const safeSpots: THREE.Vector3[] = ROOFS.map((r, i) => {
    if (r.checkpoint) return P(r.checkpoint.spot[0], r.checkpoint.spot[1], r.y);
    // the landing of his leap onto this roof is clear ground on every roof
    const n = ROUTE.findIndex((d) => d[2] === i && d[4]);
    const d = ROUTE[n >= 0 ? n : 0];
    return P(d[0], d[1], r.y);
  });
  const respawnSpot = (slot: number): THREE.Vector3 => {
    let best = -1;
    let bestRank = cpRoof().rank;
    for (const p of living()) {
      if (p.slot === slot || !p.grounded) continue;
      const r = roofAt(p.position.x, p.position.z, p.position.y);
      if (r >= 0 && ROOFS[r].rank > bestRank && r !== PAD) { best = r; bestRank = ROOFS[r].rank; }
    }
    if (best < 0) return ctx.defaultRespawn(slot, cpSpot(), cpFacing());
    return ctx.defaultRespawn(slot, safeSpots[best]);
  };

  // ---- the golden path: his route, fork a, for guidance and the walker ----
  const path: THREE.Vector3[] = [cpSpot(), rackAt.clone()];
  {
    let id = 0;
    for (;;) {
      path.push(nodes[id].at.clone());
      if (!nodes[id].next.length) break;
      id = nodes[id].next[0];
    }
    path.push(stairDoor.clone());
  }

  // ---- the autopilot: chase his line, net him on the pad, take the stair ----
  const routes: number[][] = [0, 1].map((branch) => {
    const out: number[] = [];
    let id = 0;
    for (;;) {
      out.push(id);
      const nx = nodes[id].next;
      if (!nx.length) break;
      id = nx[Math.min(branch, nx.length - 1)];
    }
    return out;
  });
  const cursors = [0, 0, 0, 0];
  const swingT = [0, 0, 0, 0];
  const launchY = [Y0, Y0, Y0, Y0];
  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive || !mark || !runner) return {};
    const route = routes[slot % 2];
    const yawTo = (t: THREE.Vector3): number => Math.atan2(t.x - p.position.x, t.z - p.position.z);
    const flat = (t: THREE.Vector3): number => Math.hypot(t.x - p.position.x, t.z - p.position.z);
    const myRoof = roofAt(p.position.x, p.position.z, p.position.y);

    // after the capture: the stair down
    if (phase === 'taken' || phase === 'dead') {
      if (myRoof === PAD) return { yaw: yawTo(stairDoor), moveY: 1, sprintHeld: true };
    }
    // the rack first, on the first roof
    if (!armed[slot] && myRoof === 0 && flat(rackAt) < 30) {
      return { yaw: yawTo(rackAt), moveY: 1 };
    }
    // on the pad with him: the duel, by hand (free) and net (free) — no
    // gunfire, so the bot earns the full bounty the way a player can
    if (myRoof === PAD && (phase === 'duel' || phase === 'chase')) {
      const d = flat(mark.position);
      const out: AutopilotInput = { yaw: yawTo(mark.position) };
      if (phase !== 'duel') return { ...out, moveY: d > 9 ? 1 : 0 };
      const weak = mark.hp <= mark.maxHp * NET_TAKES;
      if (weak && nets[slot] > 0 && d < 22) {
        if (netCd[slot] <= 0) out.rocketPressed = true;
        return out;
      }
      // close in at a run (the gait reads a full stick as a run) and swing
      if (d > 1.7) { out.moveY = 1; out.sprintHeld = d > 5; }
      swingT[slot] = Math.max(0, swingT[slot] - 1 / 30);
      if (d < 2.8 && swingT[slot] <= 0) { swingT[slot] = 0.35; out.meleePressed = true; }
      return out;
    }

    // re-sync the cursor to the roof underfoot (a respawn or a fall moves
    // you): aim no further than this roof's way off, no earlier than its way on
    let c = cursors[slot];
    if (myRoof >= 0 && p.grounded) {
      const rank = ROOFS[myRoof].rank;
      let first = route.findIndex((id) => nodeRoof[id] === myRoof);
      let last = first;
      while (last >= 0 && last + 1 < route.length && nodeRoof[route[last + 1]] === myRoof) last++;
      if (first < 0) {
        // the other fork's roof: head for the first roof past it
        first = last = route.findIndex((id) => ROOFS[nodeRoof[id]].rank > rank) - 1;
      }
      if (first >= 0 && (c < first || c > last + 1)) c = first;
      launchY[slot] = p.position.y;
    }
    c = Math.min(c, route.length - 1);
    const id = route[c];
    const w = nodes[id];
    const onTarget = myRoof === nodeRoof[id];
    const out: AutopilotInput = { yaw: yawTo(w.at), moveY: 1, sprintHeld: true };
    if (w.leap && !onTarget) {
      // over the gap: hold height over both ends until over the far roof,
      // then come down on it, aiming a few metres past his landing so the
      // lip is cleared (the sign over the last gap wants more height)
      const prev = nodes[route[Math.max(0, c - 1)]].at;
      const aim = w.at.clone().add(w.at.clone().sub(prev).setY(0).normalize().multiplyScalar(4));
      out.yaw = yawTo(aim);
      const clearance = (id === 27 ? 7 : 2.8) + (p.profile.flight === 'superjump' ? 2 : 0);
      const r = ROOFS[nodeRoof[id]];
      const over = p.position.x > r.x0 + OX + 1 && p.position.x < r.x1 + OX - 1
        && p.position.z > r.z0 + OZ + 1 && p.position.z < r.z1 + OZ - 1;
      const want = Math.max(w.at.y, over ? w.at.y : launchY[slot]) + clearance;
      if (p.position.y < want && !(over && p.position.y > w.at.y + 0.5)) {
        out.jumpHeld = true;
        if (p.grounded) out.jumpPressed = true;
      }
      // a jetpack on the ground with a dry tank waits for it
      if (p.profile.flight === 'jetpack' && p.grounded && p.fuel < 0.6) return { yaw: out.yaw };
    } else if (flat(w.at) < 1.8 || (onTarget && w.leap)) {
      c++;
    }
    // the next waypoint is a leap: take off from the edge, not the middle
    cursors[slot] = Math.min(c, route.length - 1);
    // don't overrun him: hold back when he is right in front and still running
    if (phase === 'intro') out.moveY = flat(nodes[0].at) > 18 ? 1 : 0;
    return out;
  };

  // for tools/test-section-mark-runs.mjs: the section's own parts, in the page
  const testKit = {
    get runner() { return runner; },
    get mark() { return mark; },
    get phase() { return phase; },
    get value() { return value; },
    set value(v: number) { value = v; },
    get checkpoint() { return ROOFS[checkpoint].name; },
    nodes,
    roofAt,
    fireNet: (slot: number) => { const p = game.players[slot]; if (p && armed[slot] && nets[slot] > 0) fireNet(p); },
    arm: (slot: number) => { const p = game.players[slot]; if (p) arm(p, false); },
    nets: () => nets.slice(),
    netHit,
    stackStates: () => stacks.map((s) => s.state),
    signState: () => sign.state,
  };

  return {
    testKit,
    starts: [0, 1, 2, 3].map((i) => {
      const s = cpSpot();
      return new THREE.Vector3(s.x - 2 + Math.floor(i / 2) * -1.6, s.y, s.z + ((i % 2) * 2 - 1) * 1.2);
    }),
    floorY: Y0,
    ceilingY: Y0 + 34,
    groundAt: (x, z) => {
      const r = roofAt(x, z);
      return r >= 0 ? Y0 + ROOFS[r].y : Y0 + STREET;
    },
    contains: (x, z) => {
      // won: the run is carrying the party on into the next stage
      if (complete) return true;
      // a body straddling a roof's lip is still on the roof (off it, the drop catches it)
      for (const r of ROOFS) {
        if (x >= r.x0 + OX - 0.8 && x <= r.x1 + OX + 0.8 && z >= r.z0 + OZ - 0.8 && z <= r.z1 + OZ + 0.8) return true;
      }
      // the air over each leap is in play: the gaps are crossed, not left
      for (let i = 0; i < nodes.length; i++) {
        for (const n of nodes[i].next) {
          if (!nodes[n].leap) continue;
          const a = nodes[i].at, b = nodes[n].at;
          const abx = b.x - a.x, abz = b.z - a.z;
          const t = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
          if (Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)) < 9) return true;
        }
      }
      return false;
    },
    path,
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    offPath: (pos) => pos.y < Y0 + DROP,
    hud,
    autopilot,
    dispose: () => {
      for (const p of game.players) p.sectionMove = null;
      if (mark) mark.scripted = null;
      for (const n of flying) n.mesh.removeFromParent();
    },
    debug: () => ({
      phase, value: Math.round(value * 100) / 100, checkpoint: ROOFS[checkpoint].name,
      runner: runner ? { state: runner.state, from: runner.from, to: runner.to, gap: Math.round(runner.gap), escape: runner.escapeT } : null,
      markHp: mark ? Math.round(mark.hp) : null, nets: nets.slice(0, party), armed: armed.slice(0, party),
    }),
  };
}

export const markRuns: SectionDef = {
  id: 'mark-runs',
  build,
  // dusk over the ring: a warm haze that swallows the street far below
  world: { fogColor: 0x6e5262, fogNear: 80, fogFar: 430, fill: 1.0 },
};
