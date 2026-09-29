import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy, EnemyKind } from '../enemies/enemy';
import type { Player } from '../player/player';
import type { StaticCylinder } from '../core/physics';
import type { FrameInput } from '../core/input';
import { audio } from '../core/audio';
import { Interactions, type Interactable } from './kit/interact';
import { composeMoves } from './kit/moves';
import { DetectionField } from './kit/detection';
import { buildGroundedBarge } from './barge-hull';
import { loadProp } from '../characters/authored';
import { mesaWall, buttes, crag, rockColumn } from './dune-dressing';

/**
 * Worm Sign (docs/LEVEL_SECTIONS.md §2.2) — the Dune Sea, after the Barge
 * Run, before the fighting pit (stage C).
 *
 * The sail barge the party took in the Barge Run has run itself aground on a
 * sandbank; the party comes down off it onto open sand at the edge of worm
 * country. Ahead is two hundred metres of deep dune between two mesa walls,
 * broken by rock islands, and at the far end the rim rocks of the fighting
 * pit. Under the sand is the thing the pit is named for — **the same worm
 * the party fights as stage C's lieutenant**, so this is where it learns
 * their sound. It is driven here by its own controller (`Enemy.scripted`),
 * because its job in this section is not to fight but to hunt by ear, and it
 * cannot be hurt: the pit is where it bleeds.
 *
 * **The verb is moving quietly.** Every player has a noise meter (K6, the
 * noise half): walking on sand adds a little, sprinting a lot, a blaster shot
 * a lot, a jetpack burn or a super-jump more, a hard landing a spike. Rock
 * adds nothing — every island is safe ground — and the meter drains after a
 * moment's quiet. The party's meters **summed** are the worm's hunger. Past
 * the threshold it comes for the loudest player on the sand: a ring of
 * rippling sand forms under them and follows them (a little faster than a
 * run, slower than a sprint) for the telegraph, then the worm comes up
 * through it. Anyone in the ring and off the rock is thrown and badly hurt;
 * the hunger halves; the worm goes back down. If everyone is on rock when
 * the hunger crosses, it circles and waits — the next body on the sand gets
 * the ring at once — which is what makes waiting on an island for the
 * meters to drain a real choice rather than a formality.
 *
 * **Thumpers.** The Tuskens' thumper posts stand on the checkpoint islands.
 * Hold Y to pull one: your hands are full (no gun) until you plant it on
 * the sand (hold Y, one second). It pounds for fifteen seconds and nothing
 * else on the sand is worth hearing — the worm circles it and, when it
 * stops, eats it. Plant one out on a flank and run the straight route while
 * it is busy. A spent or dropped thumper is back on its post a few seconds
 * later.
 *
 * **Three routes, braided.** A straight line down the middle with long sand
 * gaps (fast and loud), and a winding route down each flank with short gaps
 * (quiet and slow). They meet at the checkpoint islands at the 65 m and
 * 128 m marks, so the choice is made three times over.
 *
 * **Escalation.** The first third teaches: the worm is patient and slow to
 * track. The middle third has a Tusken camp on each flank — posted garrisons
 * in the winding routes' biggest islands. Melee is quiet; blaster fire is
 * not, and the camp's own fire makes whoever it is shooting at on the sand
 * louder. The worm is hungrier. The last third is the **apron**: thirty
 * metres of open sand between the last island and the pit rim with nothing to
 * stand on, a worm that tracks at a sprint's edge and a shorter telegraph. The
 * last island has two thumper posts. The crossing ends when a player reaches
 * the rim, and the worm breaches behind them and is gone — into the pit.
 *
 * Nothing left behind: the fallen come back on the furthest checkpoint
 * island a living player has stood on (the entry, the two braids' meeting
 * islands and the last island), and every thumper comes back to its post.
 */

// ---- the field (local metres: x across, z along from the barge to the rim) ----
const HX = 55;
const Z0 = -8;
const RIM_Z = 190;
/** island shelves are a step up from the sand, so walking onto rock is quiet */
const SHELF = 0.5;
/** how high over the sand the worm's lunge still reaches; the ceiling is just above */
const REACH = 16;
/** seconds of pounding a planted thumper gives */
const THUMP_SECS = 15;
const PLANT_HOLD = 1;
const PULL_HOLD = 0.6;
/** a spent thumper is back on its post after this */
const POST_BACK = 6;

type IslandKind = 'check' | 'route' | 'camp';
interface IslandSpec { id: string; x: number; z: number; r: number; kind: IslandKind; posts?: number }

/** the rock islands — three braided routes (see the file header) */
const ISLANDS: IslandSpec[] = [
  { id: 'E', x: 0, z: 2, r: 9, kind: 'check', posts: 1 },
  { id: 'S1', x: 0, z: 35, r: 3.5, kind: 'route' },
  { id: 'L1', x: -20, z: 18, r: 6, kind: 'route' },
  { id: 'L2', x: -32, z: 34, r: 7, kind: 'route' },
  { id: 'L3', x: -20, z: 52, r: 6, kind: 'route' },
  { id: 'R1', x: 20, z: 18, r: 6, kind: 'route' },
  { id: 'R2', x: 32, z: 34, r: 7, kind: 'route' },
  { id: 'R3', x: 20, z: 52, r: 6, kind: 'route' },
  { id: 'C1', x: 0, z: 66, r: 8, kind: 'check', posts: 1 },
  { id: 'S2', x: 0, z: 97, r: 4, kind: 'route' },
  { id: 'L4', x: -18, z: 80, r: 5, kind: 'route' },
  { id: 'LC', x: -34, z: 98, r: 10, kind: 'camp' },
  { id: 'L5', x: -18, z: 114, r: 5, kind: 'route' },
  { id: 'R4', x: 18, z: 80, r: 5, kind: 'route' },
  { id: 'RC', x: 34, z: 98, r: 10, kind: 'camp' },
  { id: 'R5', x: 18, z: 114, r: 5, kind: 'route' },
  { id: 'C2', x: 0, z: 128, r: 8, kind: 'check', posts: 1 },
  { id: 'X', x: 0, z: 150, r: 7, kind: 'check', posts: 2 },
];
/** the routes' links, for keeping crags off the lines between islands */
const LINKS: [string, string][] = [
  ['E', 'S1'], ['S1', 'C1'], ['E', 'L1'], ['L1', 'L2'], ['L2', 'L3'], ['L3', 'C1'],
  ['E', 'R1'], ['R1', 'R2'], ['R2', 'R3'], ['R3', 'C1'],
  ['C1', 'S2'], ['S2', 'C2'], ['C1', 'L4'], ['L4', 'LC'], ['LC', 'L5'], ['L5', 'C2'],
  ['C1', 'R4'], ['R4', 'RC'], ['RC', 'R5'], ['R5', 'C2'], ['C2', 'X'], ['X', 'RIM'],
];
/** the autopilot's two ways through (even slots left, odd right) */
const ROUTE_L = ['E', 'L1', 'L2', 'L3', 'C1', 'L4', 'LC', 'L5', 'C2', 'X', 'RIM'];
const ROUTE_R = ['E', 'R1', 'R2', 'R3', 'C1', 'R4', 'RC', 'R5', 'C2', 'X', 'RIM'];
/** the pit rim's gap, the way on */
const GAP_W = 7;

/** noise, in meter per second (continuous) or per event — see the tuning notes */
const NOISE = { fire: 0.07, jet: 0.5, sprint: 0.42, walk: 0.16, land: 0.05, hardLand: 0.25 };

/** by third of the crossing: how hungry, how quick, how wide */
const TIERS = [
  { hunger: 1.0, warn: 2.0, track: 9.5, ringR: 5, rest: 3.0 },
  { hunger: 0.85, warn: 1.8, track: 11, ringR: 5.5, rest: 2.4 },
  { hunger: 0.7, warn: 1.6, track: 12.5, ringR: 6, rest: 1.8 },
];

type WormState = 'roam' | 'stalk' | 'drawn' | 'ring' | 'rise' | 'up' | 'sink' | 'gone';

interface Island extends IslandSpec { top: number; post: THREE.Vector3[] }
interface Thumper {
  post: THREE.Vector3;
  /** where it is: on its post, in someone's hands, pounding the sand, or eaten */
  state: 'post' | 'carried' | 'planted' | 'gone';
  by: number;
  at: THREE.Vector3;
  t: number;
  mesh: THREE.Group;
  hammer: THREE.Object3D;
  /** the hammer's resting height in its own parent's frame, and metres → that frame */
  hammerY: number;
  hammerScale: number;
  /** its collider while it stands (on its post or planted); null while carried or gone */
  solid: StaticCylinder | null;
  pull: Interactable;
}

function build(ctx: SectionContext): SectionInstance {
  const { game, spec } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections['worm-sign'];
  const party = Math.max(1, game.players.length);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, Y0 + y, z);
  const hungerBase = 0.35 + 0.27 * party;

  // ---- materials ----
  const sandMat = ctx.paint(spec.palette.floor, { rough: 1, metal: 0 });
  ctx.tile(sandMat, 'sand_albedo', 40, 44, { normal: true });
  const rockMat = ctx.paint(spec.palette.rock, { rough: 0.95, metal: 0.02 });
  ctx.tile(rockMat, 'cliff_sandstone', 1, 1, { normal: true });
  const mesaMat = ctx.paint(spec.palette.wall, { rough: 0.95, metal: 0.02 });
  ctx.tile(mesaMat, 'cliff_sandstone', 1, 1, { normal: true });
  const woodMat = ctx.paint(0x5a4028, { rough: 0.9 });
  const ironMat = ctx.paint(0x4a4038, { rough: 0.55, metal: 0.7 });
  const clothMat = ctx.paint(0x8a3a24, { rough: 0.95 });
  ctx.tile(clothMat, 'tent_cloth', 1, 1);
  const boneMat = ctx.paint(0xd8ccb0, { rough: 0.8 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  ctx.own(glowMat);

  // ---- the sand: one flat floor, the whole field and a margin past the walls ----
  ctx.box(0, Y0 - 1, (Z0 + RIM_Z) / 2, HX * 2 + 60, 2, RIM_Z - Z0 + 80, null);
  {
    const geo = new THREE.PlaneGeometry(HX * 2 + 60, RIM_Z - Z0 + 80, 60, 60);
    // a little swell in the mesh only, well under a step, so the sand reads
    // as dune rather than a floor without anyone's feet sinking into it
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i, Math.sin(x * 0.07 + y * 0.03) * 0.03 + Math.sin(y * 0.11) * 0.02);
    }
    geo.computeVertexNormals();
    ctx.own(geo);
    const sand = new THREE.Mesh(geo, sandMat);
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, Y0 + 0.02, (Z0 + RIM_Z) / 2);
    sand.receiveShadow = true;
    ctx.mesh(sand);
  }

  // ---- the mesa walls: the flanks of the field, up past the ceiling ----
  const rng = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (const side of [-1, 1]) {
    mesaWall(ctx, mesaMat, rockMat, side, HX, Z0 - 24, RIM_Z + 30, Y0, rng);
    buttes(ctx, mesaMat, side, HX + 40, Z0 - 40, RIM_Z + 60, Y0, rng);
  }

  // ---- the islands ----
  const islands: Island[] = ISLANDS.map((s) => ({ ...s, top: Y0 + SHELF, post: [] }));
  const byId = new Map(islands.map((i) => [i.id, i]));
  const rimPoint = new THREE.Vector3(0, Y0, RIM_Z);
  const centreOf = (id: string): THREE.Vector3 => {
    if (id === 'RIM') return rimPoint.clone();
    const i = byId.get(id)!;
    return new THREE.Vector3(i.x, i.top, i.z);
  };
  /** metres from (x,z) to the nearest link between two islands */
  const nearLink = (x: number, z: number): number => {
    let best = Infinity;
    for (const [a, b] of LINKS) {
      const A = centreOf(a), B = centreOf(b);
      const abx = B.x - A.x, abz = B.z - A.z;
      const t = Math.max(0, Math.min(1, ((x - A.x) * abx + (z - A.z) * abz) / (abx * abx + abz * abz)));
      best = Math.min(best, Math.hypot(x - (A.x + abx * t), z - (A.z + abz * t)));
    }
    return best;
  };
  const shelfGeo = (r: number): THREE.BufferGeometry => {
    const geo = new THREE.CylinderGeometry(r * 0.94, r * 1.04, SHELF + 0.6, 14, 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      const a = Math.atan2(z, x);
      const k = 1 + Math.sin(a * 3 + r) * 0.05 + Math.sin(a * 7 + r * 2) * 0.03;
      pos.setX(i, x * k);
      pos.setZ(i, z * k);
      if (y > 0) pos.setY(i, y + Math.sin(a * 5 + r) * 0.04);
    }
    // world-scaled strata round the rim, and the top at about the same grain
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * 2 * r) / 6, uv.getY(i) * 0.25);
    geo.computeVertexNormals();
    ctx.own(geo);
    return geo;
  };
  for (const isl of islands) {
    ctx.cyl(isl.x, isl.top - (SHELF + 0.6) / 2, isl.z, isl.r, SHELF + 0.6, null);
    const shelf = new THREE.Mesh(shelfGeo(isl.r), rockMat);
    shelf.position.set(isl.x, isl.top - (SHELF + 0.6) / 2 + 0.01, isl.z);
    shelf.castShadow = shelf.receiveShadow = true;
    ctx.mesh(shelf);
    // crags: standing rock on the island's rim, clear of every line between islands
    const n = isl.kind === 'route' && isl.r < 5 ? 1 : isl.kind === 'camp' ? 3 : 2;
    let placed = 0;
    for (let k = 0; k < 16 && placed < n; k++) {
      const a = rng() * Math.PI * 2;
      const cr = 1.1 + rng() * (isl.r > 7 ? 1.8 : 1.0);
      const d = isl.r - cr - 0.3;
      const x = isl.x + Math.cos(a) * d, z = isl.z + Math.sin(a) * d;
      if (nearLink(x, z) < cr + 2.2) continue;
      // and clear of the island's middle, where the party stands and re-forms
      if (Math.hypot(x - isl.x, z - isl.z) < 3.5 + cr) continue;
      const h = 2.2 + rng() * (isl.kind === 'camp' ? 5 : 3.5);
      ctx.cyl(x, isl.top + h / 2, z, cr * 0.85, h, null);
      crag(ctx, rockMat, x, isl.top - 0.2, z, cr, h + 0.2, rng() * 10);
      placed++;
    }
  }

  // ---- the grounded barge: behind the party, the way they came ----
  // Aground on its sandbank across the south end, listing, sails slack. It
  // and the dune it ploughed up are the south edge of the field.
  const barge = buildGroundedBarge(ctx, V(4, 0, Z0 - 7), 0.06);
  void barge;
  ctx.box(0, Y0 + 12, Z0 - 13, HX * 2 + 40, 24, 2, null);
  for (const side of [-1, 1]) {
    // the ploughed-up sandbank either side of the hull
    const bank = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), sandMat);
    bank.scale.set(26, 7, 8);
    bank.position.set(side * 40, Y0 - 0.2, Z0 - 17);
    ctx.mesh(bank);
  }
  // a boarding plank the party came down, off the lower deck onto the entry island
  {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 7), woodMat);
    plank.position.set(-3, Y0 + 2.4, Z0 - 0.6);
    plank.rotation.x = 0.55;
    ctx.mesh(plank);
  }

  // ---- the fighting pit's rim: the way on ----
  const rimRock = (x: number, h: number, z: number, w: number, d: number): void => {
    ctx.box(x, Y0 + h / 2 - 0.5, z, w, h, d, null);
    const m = new THREE.Mesh(rockColumn(Math.min(w, d) * 0.42, Math.max(w, d) * 0.58, h, 6, x + z, 7), rockMat);
    ctx.own(m.geometry);
    m.position.set(x, Y0 + h / 2 - 0.5, z);
    m.castShadow = m.receiveShadow = true;
    ctx.mesh(m);
  };
  // A ridge of rim rock across the north end with one gap in it, framed by
  // the Tuskens' pit banners, and the pit's old watchtower standing up beyond
  // it: the brightest, most framed thing ahead from anywhere on the field.
  for (let x = -HX - 6; x < HX + 6; x += 6) {
    if (Math.abs(x + 3) < GAP_W + 2) continue;
    const h = 3.5 + rng() * 4 + Math.abs(x) * 0.05;
    rimRock(x + 3, h, RIM_Z + 3 + rng() * 1.5, 6.4, 6);
  }
  ctx.box(0, Y0 + 12, RIM_Z + 12, HX * 2 + 20, 24, 2, null);
  for (const sx of [-1, 1]) {
    // the gap's two cheek rocks, taller, so the gap reads as a gate
    rimRock(sx * (GAP_W + 2.2), 9, RIM_Z + 3, 4.2, 6);
    // a banner pole on each cheek
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 8, 6), woodMat);
    pole.position.set(sx * (GAP_W + 1.2), Y0 + 13, RIM_Z + 1.5);
    ctx.mesh(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.2), clothMat);
    flag.position.set(sx * (GAP_W + 1.2) + sx * 1.15, Y0 + 15, RIM_Z + 1.5);
    flag.material.side = THREE.DoubleSide;
    ctx.mesh(flag);
  }
  // the pit beyond: its floor dropping away through the gap, and the tower
  {
    const drop = new THREE.Mesh(new THREE.BoxGeometry(GAP_W * 2, 0.4, 10), sandMat);
    drop.position.set(0, Y0 - 1.2, RIM_Z + 8);
    drop.rotation.x = 0.25;
    ctx.mesh(drop);
    const tower = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 30, 8), ironMat);
    trunk.position.y = 15;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(3, 2.4, 3, 8), ironMat);
    cap.position.y = 31;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), glowMat);
    lamp.position.y = 33;
    tower.add(trunk, cap, lamp);
    tower.position.set(6, Y0 - 4, RIM_Z + 34);
    ctx.mesh(tower);
    const beam = new THREE.PointLight(0xffb347, 30, 40, 1.4);
    beam.position.set(0, Y0 + 5, RIM_Z + 2);
    ctx.mesh(beam);
  }
  // the old bones in the sand at the rim's west end: a krayt's ribs, for scale
  for (let k = 0; k < 7; k++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(5 - Math.abs(k - 3) * 0.5, 0.35, 5, 12, Math.PI), boneMat);
    rib.position.set(-38 + k * 2.4, Y0 - 0.5, RIM_Z - 8);
    rib.rotation.y = Math.PI / 2;
    ctx.mesh(rib);
  }

  // ---- checkpoint markers: a Tusken pole with a rag on each checkpoint island ----
  const markers = new Map<string, THREE.Mesh>();
  for (const isl of islands) {
    if (isl.kind !== 'check') continue;
    const x = isl.x - isl.r * 0.55, z = isl.z + isl.r * 0.35;
    ctx.cyl(x, isl.top + 1.8, z, 0.14, 3.6, woodMat);
    const rag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), ctx.paint(0x6a5a44, { rough: 1 }));
    (rag.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    rag.position.set(x + 0.5, isl.top + 3, z);
    ctx.mesh(rag);
    markers.set(isl.id, rag);
  }

  // ---- thumpers ----
  // The thumper, to its sheet (docs/ASSETS_MODELS.md, `thumper`): 2.0 × 1.8 ×
  // 2.4 m, scaled by the height. A tripod of three spiked legs (the feet a
  // 1.8 m triangle), a crank lever across the top with a netted stone
  // counterweight on its −x end, and the `hammer` — the node the game drives —
  // hanging from the +x end 0.7 m off the centre, bottoming out 0.5 m above the
  // ground. Pivot at the ground under the tripod's centre.
  const buildThumper = (): { g: THREE.Group; hammer: THREE.Object3D } => {
    const g = new THREE.Group();
    const apex = new THREE.Vector3(0, 2.25, 0);
    const R = 1.8 / Math.sqrt(3);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const foot = new THREE.Vector3(Math.cos(a) * R, 0.22, Math.sin(a) * R);
      const len = foot.distanceTo(apex);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, len, 5), woodMat);
      leg.position.copy(foot).add(apex).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), apex.clone().sub(foot).normalize());
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 5), ironMat);
      spike.rotation.x = Math.PI;
      spike.position.set(foot.x, 0.12, foot.z);
      g.add(leg, spike);
    }
    // the crank lever across the top, its wheel at the apex
    const lever = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.1, 0.1), woodMat);
    lever.position.set(-0.08, 2.3, 0);
    const crank = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 4, 10), ironMat);
    crank.position.set(0, 2.25, 0.12);
    // the counterweight: stones in a net on the −x end
    const stones = new THREE.Mesh(new THREE.DodecahedronGeometry(0.26, 0), ctx.paint(0x6a5a48, { rough: 1 }));
    stones.position.set(-0.86, 1.98, 0);
    const net = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 5), new THREE.MeshBasicMaterial({ color: 0x3a2c1c, wireframe: true }));
    net.position.copy(stones.position);
    const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.7), clothMat);
    ribbon.position.set(-0.2, 1.9, 0.08);
    g.add(lever, crank, stones, net, ribbon);
    // the hammer: its own node, at rest bottomed out (its foot 0.5 m up)
    const hammer = new THREE.Group();
    hammer.name = 'hammer';
    hammer.position.set(0.7, 0, 0);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.5, 8), ironMat);
    head.position.y = 0.75;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), ironMat);
    rod.position.y = 1.65;
    hammer.add(head, rod);
    g.add(hammer);
    return { g, hammer };
  };
  /** how far the hammer rides up its stroke, metres */
  const HAMMER_LIFT = 0.45;
  /** the thumper's collider: planted or on its post, a 0.9 m cylinder; none while carried */
  const THUMP_R = 0.9, THUMP_H = 2.4;
  const interactions = new Interactions();
  const thumpers: Thumper[] = [];
  for (const isl of islands) {
    for (let k = 0; k < (isl.posts ?? 0); k++) {
      const a = k === 0 ? 0.5 : -0.9;
      const post = new THREE.Vector3(isl.x + Math.cos(a) * isl.r * 0.55, isl.top, isl.z + Math.sin(a) * isl.r * 0.55);
      isl.post.push(post);
      // the post itself: a stake and a lashing where the thumper hangs
      ctx.cyl(post.x - 1.4, isl.top + 0.9, post.z, 0.1, 1.8, woodMat);
      // a pivot of its own, so it can be carried, planted and spun about its foot
      const { g, hammer } = buildThumper();
      const pivot = new THREE.Group();
      pivot.position.copy(post);
      pivot.add(g);
      const th: Thumper = {
        post, state: 'post', by: -1, at: post.clone(), t: 0, mesh: pivot, hammer, hammerY: 0, hammerScale: 1,
        solid: ctx.cyl(post.x, post.y + THUMP_H / 2, post.z, THUMP_R, THUMP_H, null).cyl,
        pull: null as unknown as Interactable,
      };
      th.pull = interactions.add({
        pos: post, hold: PULL_HOLD, radius: 2.6, verb: T.pullVerb, once: false,
        enabled: () => th.state === 'post',
        onDone: (slot) => {
          if (carrying[slot] !== null) return;
          th.state = 'carried';
          th.by = slot;
          carrying[slot] = th;
          ctx.announce(T.carryTitle, T.carrySub);
        },
      });
      thumpers.push(th);
      pivot.add(loadProp('thumper', 2.4, {
        axis: 'y', ground: true,
        onLoad: (root) => {
          g.visible = false;
          // the sculpt's own hammer is driven instead (the stand-in's is hidden with it);
          // its stroke is in its parent's units, which the fit has scaled
          root.traverse((o) => {
            if (o.name !== 'hammer' || o === hammer) return;
            th.hammer = o;
            th.hammerY = o.position.y;
            o.parent?.updateWorldMatrix(true, false);
            const sc = o.parent ? o.parent.getWorldScale(new THREE.Vector3()).y : 1;
            th.hammerScale = sc > 1e-6 ? 1 / sc : 1;
          });
        },
      }));
      ctx.mesh(pivot);
    }
  }
  // who is carrying what, by slot
  const carrying: (Thumper | null)[] = [null, null, null, null];
  const plantHold = [0, 0, 0, 0];
  const interactHeld = [false, false, false, false];

  // ---- the ring: the worm's telegraph, a ground decal ----
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x3a220c, transparent: true, opacity: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2 });
  ctx.own(ringMat);
  const ripples: THREE.Mesh[] = [];
  const ringGroup = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), ringMat);
    m.rotation.x = -Math.PI / 2;
    ringGroup.add(m);
    ripples.push(m);
  }
  const boilMat = new THREE.MeshBasicMaterial({ color: 0x7a5428, transparent: true, opacity: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1 });
  ctx.own(boilMat);
  const boil = new THREE.Mesh(new THREE.CircleGeometry(1, 40), boilMat);
  boil.rotation.x = -Math.PI / 2;
  ringGroup.add(boil);
  ringGroup.visible = false;
  ctx.mesh(ringGroup);
  // the wake: a low hump of sand over the worm while it is under
  const hump = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), sandMat);
  hump.scale.set(2.2, 0.7, 4.5);
  hump.visible = false;
  ctx.mesh(hump);

  // ---- the noise field (K6) ----
  const islandAt = (x: number, z: number): Island | null => {
    for (const i of islands) if (Math.hypot(x - i.x, z - i.z) <= i.r) return i;
    return null;
  };
  /** over sand — the column under a body is not rock (the rim counts as rock) */
  const onSand = (pos: THREE.Vector3): boolean => !islandAt(pos.x, pos.z) && pos.z < RIM_Z - 1;
  const field = new DetectionField(game, {
    noise: NOISE,
    hold: 0.8,
    decay: 0.22,
    noiseGate: (p) => (onSand(p.position) && p.position.y < Y0 + REACH + 4 ? 1 : 0),
  });
  // The camps' own fire is heard too: every hostile shot adds to whoever is
  // standing on the sand near the shooter. The projectile system has no event
  // for it, so the section wraps `fire` while it stands (and puts it back).
  const projectiles = game.projectiles;
  const baseFire = projectiles.fire;
  projectiles.fire = function (this: typeof projectiles, origin, dir, speed, damage, team, bySlot, tag) {
    if (team === 1 && !complete) {
      for (const p of game.players) {
        if (p.alive && onSand(p.position) && p.position.distanceTo(origin) < 34) field.noise(p.slot, 0.06);
      }
    }
    return baseFire.call(this, origin, dir, speed, damage, team, bySlot, tag);
  } as typeof projectiles.fire;

  // ---- state ----
  let started = false;
  let complete = false;
  let finale = 0;          // seconds since a player reached the rim
  let worm: Enemy | null = null;
  let wstate: WormState = 'roam';
  let wT = 0;              // seconds in the current state
  let rest = 2;            // seconds before the hunger can call it again
  let prey: { slot: number; thumper: Thumper | null } | null = null;
  const ringAt = new THREE.Vector3();
  let ringR = 5;
  let warn = 2;
  let track = 8;
  const wormPos = V(0, 0, 90);
  const roamTo = V(0, 0, 90);
  let strikes = 0;
  let hits = 0;
  let furthest = 0;        // metres along the field the party has reached
  let reached = 0;         // index into CHECKS of the furthest checkpoint island stood on
  const CHECKS = islands.filter((i) => i.kind === 'check');
  ctx.checkpoint.copy(centreOf('E'));
  let wiped = false;

  const tier = () => TIERS[furthest < 66 ? 0 : furthest < 128 ? 1 : 2];
  const threshold = () => hungerBase * tier().hunger;
  const hunger = (): number => {
    let h = 0;
    for (const p of game.players) if (p.alive) h += field.level(p.slot);
    return h;
  };
  const planted = (): Thumper | null => thumpers.find((t) => t.state === 'planted') ?? null;

  const spawnCamps = (): void => {
    for (const id of ['LC', 'RC']) {
      const isl = byId.get(id)!;
      // tents on the outer half of the island, and the camp's fire between them
      for (const a of [0.3, 2.2]) {
        const side = Math.sign(isl.x);
        const at = V(isl.x + side * Math.cos(a) * 5.5, SHELF, isl.z + Math.sin(a) * 5.5 - 2);
        ctx.prop('tusken_tent', at, { size: 5.2, yaw: a, solid: { r: 1.9, h: 2.6 }, fallback: () => {
          const g = new THREE.Group();
          const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.8, 7), clothMat);
          cone.position.y = 1.4;
          g.add(cone);
          return g;
        } });
      }
      const fire = new THREE.PointLight(0xff8a3a, 12, 12, 1.6);
      fire.position.set(isl.x, isl.top + 1, isl.z + 2);
      ctx.mesh(fire);
      const n = 2 + Math.ceil(party / 2);
      const kinds: EnemyKind[] = [];
      for (let k = 0; k < n; k++) kinds.push(k % 3 === 1 ? 'pyke' : 'tusken');
      if (party >= 3) kinds.push('pyke');
      kinds.forEach((kind, k) => {
        const a = (k / kinds.length) * Math.PI * 2;
        ctx.spawn(kind, V(isl.x + Math.cos(a) * 4, SHELF, isl.z + Math.sin(a) * 4), { squad: id === 'LC' ? 8811 : 8812 });
      });
    }
  };

  const spawnWorm = (): void => {
    const e = ctx.spawn('sandworm', wormPos.clone(), { squad: 8819 });
    e.scripted = {
      // it cannot be hurt here; a hit on it while it is up sends it down sooner
      hurt: () => { if (wstate === 'up') wT += 0.25; return 0; },
      drive: (body, dt) => { driveWorm(body, dt); return 'still'; },
    };
    worm = e;
  };

  /** the worm's body, placed where the controller says, at its depth */
  const driveWorm = (e: Enemy, dt: number): void => {
    let depth = 1;
    if (wstate === 'rise') { const k = Math.min(1, wT / 0.45); depth = 1 - k * k; }
    else if (wstate === 'up') depth = 0;
    else if (wstate === 'sink') { const k = Math.min(1, wT / 0.8); depth = k * k; }
    const prev = e.position.clone();
    e.position.set(wormPos.x, Y0, wormPos.z);
    e.velocity.set((wormPos.x - prev.x) / Math.max(dt, 1e-3), 0, (wormPos.z - prev.z) / Math.max(dt, 1e-3));
    const moving = Math.hypot(e.velocity.x, e.velocity.z);
    if (depth > 0.5 && moving > 0.5) e.facingYaw = Math.atan2(e.velocity.x, e.velocity.z);
    else if (prey) {
      const tp = preyPos();
      if (tp) e.facingYaw = Math.atan2(tp.x - wormPos.x, tp.z - wormPos.z);
    }
    e.burrowDepth = depth;
    e.burrow = depth >= 1 ? 'under' : wstate === 'sink' ? 'sinking' : wstate === 'rise' ? 'rising' : 'up';
    e.char.setBurrow?.(depth);
    // fully under, the animal is not drawn — its wake is (the hump and the dust),
    // so a forty-metre body never ploughs up through an island's rock
    e.char.root.visible = depth < 0.98;
  };

  const preyPos = (): THREE.Vector3 | null => {
    if (!prey) return null;
    if (prey.thumper) return prey.thumper.at;
    const p = game.players[prey.slot];
    return p && p.alive ? p.position : null;
  };

  /** the loudest player on the sand this moment, or -1 */
  const loudestOnSand = (): number => {
    let best = -1, v = -1;
    for (const p of game.players) {
      if (!p.alive || !onSand(p.position) || p.position.y > Y0 + REACH) continue;
      const l = field.level(p.slot) + field.heard[p.slot] * 4;
      if (l > v) { v = l; best = p.slot; }
    }
    return best;
  };

  const beginRing = (slot: number, th: Thumper | null): void => {
    prey = { slot, thumper: th };
    const at = th ? th.at : game.players[slot].position;
    ringAt.set(at.x, Y0, at.z);
    const t = tier();
    ringR = t.ringR;
    warn = th ? 2 : t.warn;
    track = th ? 0 : t.track;
    wstate = 'ring';
    wT = 0;
    ringGroup.visible = true;
    audio.setBurrowRumble(0.6);
    if (!th) ctx.announce(T.wormSign, T.wormSignSub);
  };

  const strike = (): void => {
    strikes++;
    wormPos.copy(ringAt);
    game.particles.explosion(ringAt.clone().setY(Y0 + 1), 1.4);
    game.particles.dustPuff(ringAt.clone().setY(Y0 + 0.5), 50);
    audio.land(true);
    audio.monster('sandworm', 'roar', 1);
    audio.setBurrowRumble(0);
    for (const p of game.players) {
      const d = Math.hypot(p.position.x - ringAt.x, p.position.z - ringAt.z);
      if (d < 30) p.groundShake(0.5 * (1 - d / 30));
      if (!p.alive || d > ringR || !onSand(p.position) || p.position.y > Y0 + REACH) continue;
      hits++;
      p.damage(party === 1 ? 38 : 45, ringAt, -1, { heavy: true });
      const push = p.position.clone().sub(ringAt).setY(0);
      if (push.lengthSq() > 1e-4) push.normalize(); else push.set(0, 0, 1);
      p.velocity.addScaledVector(push, 10);
      p.velocity.y = Math.max(p.velocity.y, 11);
    }
    for (const e of game.enemies) {
      if (e === worm || !e.alive) continue;
      if (Math.hypot(e.position.x - ringAt.x, e.position.z - ringAt.z) > ringR || !onSand(e.position)) continue;
      e.damage(200, ringAt, -1);
    }
    // it eats a thumper it came up under
    for (const th of thumpers) {
      if (th.state === 'planted' && Math.hypot(th.at.x - ringAt.x, th.at.z - ringAt.z) < ringR + 1) {
        th.state = 'gone';
        th.t = 0;
        th.mesh.visible = false;
      }
    }
    // the hunger halves
    for (let s = 0; s < 4; s++) field.meters[s] *= 0.5;
    ringGroup.visible = false;
    wstate = 'rise';
    wT = 0;
  };

  /** the controller: one state machine over the hunger, the thumpers and the party */
  const updateWorm = (dt: number): void => {
    wT += dt;
    rest -= dt;
    const tNow = tier();
    const th = planted();
    const lead = centroid();
    switch (wstate) {
      case 'roam':
      case 'stalk':
      case 'drawn': {
        // where it swims while nothing has called it: loose loops ahead of the
        // party, on the sand; drawn by a thumper, tight circles round it
        let speed = 10;
        if (th) {
          wstate = 'drawn';
          const a = game.time * 1.4;
          roamTo.set(th.at.x + Math.cos(a) * 7, Y0, th.at.z + Math.sin(a) * 7);
          speed = 24;
          // the pounding stops: it comes up under the post and takes it
          if (th.t >= THUMP_SECS - 2) { beginRing(th.by, th); break; }
        } else {
          const h = hunger(), limit = threshold();
          if (wstate === 'drawn') wstate = 'roam';
          if (rest <= 0 && h >= limit) {
            const slot = loudestOnSand();
            if (slot >= 0) { beginRing(slot, null); break; }
            wstate = 'stalk';
          } else if (wstate === 'stalk' && h < limit * 0.7) wstate = 'roam';
          if (wstate === 'stalk' && lead) {
            // circling the rock they are standing on, waiting
            const a = game.time * 0.9;
            roamTo.set(lead.x + Math.cos(a) * 16, Y0, lead.z + Math.sin(a) * 16);
            speed = 16;
          } else if (wormPos.distanceTo(roamTo) < 4 || wT > 9) {
            wT = 0;
            const ahead = (lead ? lead.z : 20) + 25 + Math.random() * 30;
            roamTo.set((Math.random() - 0.5) * HX * 1.4, Y0, Math.min(RIM_Z - 10, ahead));
          }
        }
        const to = roamTo.clone().sub(wormPos).setY(0);
        const d = to.length();
        if (d > 0.01) wormPos.addScaledVector(to.normalize(), Math.min(d, speed * dt));
        break;
      }
      case 'ring': {
        const tp = preyPos();
        // the ring follows its prey on the sand for most of the telegraph, then sets
        if (tp && track > 0 && wT < warn - 0.5 && onSand(tp)) {
          const to = new THREE.Vector3(tp.x - ringAt.x, 0, tp.z - ringAt.z);
          const d = to.length();
          if (d > 0.01) ringAt.addScaledVector(to.normalize(), Math.min(d, track * dt));
        }
        // the worm rushes in under it
        const to = ringAt.clone().sub(wormPos).setY(0);
        const d = to.length();
        if (d > 0.01) wormPos.addScaledVector(to.normalize(), Math.min(d, 40 * dt));
        audio.setBurrowRumble(Math.min(1, 0.4 + wT / warn * 0.6));
        for (const p of game.players) {
          const dd = Math.hypot(p.position.x - ringAt.x, p.position.z - ringAt.z);
          if (dd < ringR + 6) p.groundShake(0.06 * (wT / warn));
        }
        if (Math.random() < dt * 22) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * ringR;
          game.particles.dustPuff(new THREE.Vector3(ringAt.x + Math.cos(a) * r, Y0 + 0.2, ringAt.z + Math.sin(a) * r), 2);
        }
        if (wT >= warn) strike();
        void tNow;
        break;
      }
      case 'rise':
        if (wT >= 0.45) { wstate = 'up'; wT = 0; }
        break;
      case 'up':
        if (wT >= 1.6) { wstate = 'sink'; wT = 0; game.particles.dustPuff(wormPos.clone(), 20); }
        break;
      case 'sink':
        if (wT >= 0.8) {
          wstate = 'roam';
          wT = 0;
          prey = null;
          rest = tier().rest;
          roamTo.copy(wormPos).add(new THREE.Vector3((Math.random() - 0.5) * 30, 0, 20));
        }
        break;
      case 'gone':
        break;
    }
    // the ring decal
    if (ringGroup.visible) {
      const k = Math.min(1, wT / warn);
      ringGroup.position.set(ringAt.x, Y0 + 0.12, ringAt.z);
      ripples.forEach((m, i) => {
        const ph = (game.time * 1.6 + i / ripples.length) % 1;
        m.scale.setScalar(ringR * (0.25 + ph * 0.75));
      });
      ripples[0].scale.setScalar(ringR);
      ringMat.opacity = 0.35 + k * 0.5;
      boil.scale.setScalar(ringR * (0.3 + k * 0.7));
      boilMat.opacity = 0.15 + k * 0.35;
    }
    // the wake: hump and dust over it while it swims under the sand
    // (in a ring the ring is the telegraph; the hump would only hide it)
    const under = wstate === 'roam' || wstate === 'stalk' || wstate === 'drawn';
    const showWake = under && onSand(wormPos) && Math.abs(wormPos.x) < HX - 3;
    hump.visible = showWake;
    if (showWake) {
      hump.position.set(wormPos.x, Y0 - 0.25, wormPos.z);
      if (worm) hump.rotation.y = worm.facingYaw;
      if (Math.random() < dt * 14) game.particles.runDust(wormPos.clone().setY(Y0 + 0.3));
      const near = lead ? lead.distanceTo(wormPos) : 99;
      if (wstate !== 'ring') audio.setBurrowRumble(Math.max(0, Math.min(0.6, 18 / Math.max(near, 10) - 0.4)));
    }
  };

  const centroid = (): THREE.Vector3 | null => {
    const c = new THREE.Vector3();
    let n = 0;
    for (const p of game.players) if (p.alive) { c.add(p.position); n++; }
    return n ? c.multiplyScalar(1 / n) : null;
  };

  // ---- the hands-full rule and the plant, through each player's input ----
  const handsFull = (p: Player, _dt: number, input: FrameInput): FrameInput => {
    interactHeld[p.slot] = input.interactHeld;
    if (!carrying[p.slot]) return input;
    // a thumper in both hands: no gun, no blade, no shield
    return { ...input, shootHeld: false, aimHeld: false, rocketPressed: false, meleePressed: false,
      blockHeld: false, slamPressed: false };
  };

  const updateCarry = (dt: number): void => {
    for (const p of game.players) {
      const th = carrying[p.slot];
      if (!th) { plantHold[p.slot] = 0; continue; }
      if (!p.alive) {
        // dropped: it goes back to its post
        carrying[p.slot] = null;
        th.state = 'gone';
        th.t = POST_BACK - 1.5;
        th.mesh.visible = false;
        continue;
      }
      // carried over the shoulder, head down
      const yaw = p.facingYaw;
      th.mesh.visible = true;
      th.mesh.position.set(
        p.position.x - Math.cos(yaw) * 0.45 - Math.sin(yaw) * 0.25,
        p.position.y + 0.2,
        p.position.z + Math.sin(yaw) * 0.45 - Math.cos(yaw) * 0.25);
      th.mesh.rotation.set(0.35, yaw, 0.3);
      // on the sand, feet on it (a landing counts; a hover does not)
      const canPlant = onSand(p.position) && p.position.y < Y0 + 0.6;
      if (canPlant && interactHeld[p.slot]) {
        plantHold[p.slot] += dt;
        if (plantHold[p.slot] >= PLANT_HOLD) {
          plantHold[p.slot] = 0;
          carrying[p.slot] = null;
          th.state = 'planted';
          th.t = 0;
          th.by = p.slot;
          th.at.set(p.position.x + Math.sin(yaw) * 1.6, Y0, p.position.z + Math.cos(yaw) * 1.6);
          th.mesh.position.copy(th.at);
          th.mesh.rotation.set(0, yaw, 0);
          ctx.announce(T.planted, T.plantedSub);
        }
      } else plantHold[p.slot] = Math.max(0, plantHold[p.slot] - dt * 2);
    }
    for (const th of thumpers) {
      // it is solid where it stands (on its post or planted), and not in someone's hands
      const standing = th.state === 'post' || th.state === 'planted';
      if (standing && !th.solid) th.solid = ctx.cyl(th.at.x, th.at.y + THUMP_H / 2, th.at.z, THUMP_R, THUMP_H, null).cyl;
      else if (!standing && th.solid) { ctx.unsolid({ cyl: th.solid }); th.solid = null; }
      if (th.state === 'planted') {
        th.t += dt;
        // the hammer: wound up the stroke on the crank, then dropped
        const ph = (th.t * 1.7) % 1;
        const lift = ph < 0.8 ? (ph / 0.8) * HAMMER_LIFT : ((1 - ph) / 0.2) * HAMMER_LIFT;
        th.hammer.position.y = th.hammerY + lift * th.hammerScale;
        if (ph < dt * 1.7) {
          const yaw = th.mesh.rotation.y;
          game.particles.dustPuff(new THREE.Vector3(th.at.x + Math.cos(yaw) * 0.7, Y0 + 0.3, th.at.z - Math.sin(yaw) * 0.7), 6);
          audio.land(false);
        }
        if (th.t > THUMP_SECS + 3) { th.state = 'gone'; th.t = 0; th.mesh.visible = false; }
      } else if (th.state === 'gone') {
        th.t += dt;
        if (th.t >= POST_BACK) {
          th.state = 'post';
          th.at.copy(th.post);
          th.mesh.visible = true;
          th.mesh.position.copy(th.post);
          th.mesh.rotation.set(0, 0, 0);
          th.hammer.position.y = th.hammerY;
        }
      }
    }
  };

  // ---- the golden path: the left braid, for guidance and the walker ----
  const path = ROUTE_L.map(centreOf);

  const update = (dt: number): void => {
    if (!started) {
      started = true;
      spawnCamps();
      spawnWorm();
      for (const id of ['C1', 'C2', 'X']) {
        const c = centreOf(id);
        for (let k = 0; k < (id === 'X' ? 1 + Math.ceil(party / 2) : 1); k++) ctx.pickup(c.clone().add(new THREE.Vector3(-2 + k * 1.5, 0, -3)));
      }
      ctx.announce(T.title, T.sub);
      for (const p of game.players) {
        p.sectionMove = composeMoves({
          adjust: (pl, d, input) => interactions.swallow(pl.slot, pl.position, handsFull(pl, d, input)),
        });
      }
    }
    if (complete) return;

    field.update(dt);
    interactions.update(dt, game);
    updateCarry(dt);

    // progress, checkpoints
    for (const p of game.players) {
      if (!p.alive) continue;
      furthest = Math.max(furthest, p.position.z);
      const isl = islandAt(p.position.x, p.position.z);
      if (isl && isl.kind === 'check' && p.grounded) {
        const k = CHECKS.indexOf(isl);
        if (k > reached) {
          reached = k;
          ctx.checkpoint.copy(centreOf(isl.id));
          ctx.announce(TEXT.banners.checkpoint, T.checkSub(k, CHECKS.length - 1));
          audio.checkpointChime();
          const rag = markers.get(isl.id);
          if (rag) rag.material = clothMat;
        }
      }
      // the rim
      if (p.position.z > RIM_Z - 2 && Math.abs(p.position.x) < GAP_W + 1 && finale === 0) {
        finale = 0.001;
        ctx.announce(T.rimTitle, T.rimSub);
        // it comes up behind them, all the way out, and goes under toward the pit
        ringAt.set(p.position.x * 0.5, Y0, RIM_Z - 18);
        ringR = 7;
        ringGroup.visible = false;
        strike();
      }
    }
    if (finale > 0) {
      finale += dt;
      if (finale > 2.2) {
        complete = true;
        wstate = 'gone';
        audio.setBurrowRumble(0);
      }
    }

    // a wipe: the worm loses them, and the sand goes quiet
    const anyAlive = game.players.some((p) => p.alive);
    if (!anyAlive && !wiped) {
      wiped = true;
      field.reset();
      wstate = 'roam';
      prey = null;
      ringGroup.visible = false;
      rest = 5;
      wormPos.set(0, Y0, Math.min(RIM_Z - 20, ctx.checkpoint.z + 50));
    } else if (anyAlive) wiped = false;

    updateWorm(dt);
  };

  const objective = () => {
    const next = CHECKS[reached + 1];
    const ringOnMe = wstate === 'ring' && prey && !prey.thumper;
    const hint = ringOnMe ? T.hintRing
      : planted() ? T.hintDrawn
      : wstate === 'stalk' ? T.hintStalk
      : reached >= CHECKS.length - 1 ? T.hintApron
      : T.hint;
    if (!next) return { pos: V(0, 2, RIM_Z + 1), label: T.rim, hint, beacon: true };
    return { pos: centreOf(next.id).add(new THREE.Vector3(0, 1.5, 0)), label: T.island(reached + 1), hint, beacon: true };
  };

  const respawnSpot = (slot: number): THREE.Vector3 => ctx.defaultRespawn(slot, centreOf(CHECKS[reached].id).add(new THREE.Vector3(0, 0, -1)));

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const lvl = field.level(slot);
    const h = Math.min(1, hunger() / threshold());
    const bars: SectionBar[] = [
      { label: T.noise, value: lvl, tone: lvl > 0.5 ? 'danger' : lvl > 0.25 ? 'warn' : 'info' },
      { label: wstate === 'drawn' ? T.drawn : T.hunger, value: wstate === 'drawn' ? 1 - (planted()?.t ?? 0) / THUMP_SECS : h,
        tone: wstate === 'drawn' ? 'good' : h > 0.8 ? 'danger' : h > 0.5 ? 'warn' : 'info' },
    ];
    let line: string;
    const th = carrying[slot];
    if (th) {
      if (onSand(p.position)) {
        bars.push({ label: T.plantVerb, value: plantHold[slot] / PLANT_HOLD, tone: 'good' });
        line = `Hold Y — ${T.plantVerb}`;
      } else line = T.carryLine;
    } else {
      const at = interactions.hudFor(p.position);
      if (at) { bars.push(at.bar); line = at.line; }
      else if (wstate === 'ring' && prey && !prey.thumper && prey.slot === slot) line = T.lineRing;
      else line = onSand(p.position) ? T.lineSand : T.lineRock;
    }
    return { bars, line };
  };

  // ---- the autopilot: hop the winding braid, walk the sand, wait out the hunger ----
  const cursors = [0, 0, 0, 0];
  const waited = [0, 0, 0, 0];
  const route = (slot: number) => (slot % 2 === 0 ? ROUTE_L : ROUTE_R);
  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    const r = route(slot);
    // re-sync forward: never aim back at an island behind the feet
    let c = cursors[slot];
    const here = islandAt(p.position.x, p.position.z);
    if (here) { const k = r.indexOf(here.id); if (k > c) c = k; }
    const steer = (to: THREE.Vector3, run = true, sprint = false): AutopilotInput => {
      const dx = to.x - p.position.x, dz = to.z - p.position.z;
      const d = Math.hypot(dx, dz);
      return { yaw: Math.atan2(dx, dz), moveY: d > 0.6 ? (run ? 1 : 0.5) : 0, sprintHeld: sprint };
    };
    // a ring under me: run for the nearest rock
    if (wstate === 'ring' && prey && !prey.thumper && prey.slot === slot && onSand(p.position)) {
      let best: Island | null = null, bd = Infinity;
      for (const i of islands) {
        const d = Math.hypot(i.x - p.position.x, i.z - p.position.z) - i.r;
        if (d < bd && i.z > p.position.z - 20) { bd = d; best = i; }
      }
      return best ? steer(new THREE.Vector3(best.x, 0, best.z), true, true) : { moveY: 1, sprintHeld: true };
    }
    const X = byId.get('X')!;
    // the thumper play at the last island, by the first slot
    if (slot === 0 && r[c] === 'X' && here?.id === 'X' || carrying[slot]) {
      const th = carrying[slot];
      if (th) {
        // out onto the east flank of the apron, and plant
        const spot = new THREE.Vector3(X.x + 14, 0, X.z + 8);
        if (onSand(p.position) && Math.hypot(spot.x - p.position.x, spot.z - p.position.z) < 2.5) {
          cursors[slot] = c;
          return { interactHeld: true };
        }
        return steer(spot);
      }
      const post = thumpers.find((t) => t.state === 'post' && X.post.some((q) => q.distanceTo(t.post) < 0.1));
      if (post && !planted()) {
        if (post.pull.inReach(p.position)) return { interactHeld: true };
        return steer(post.post);
      }
    }
    const nextId = r[c + 1] ?? 'RIM';
    const target = centreOf(r[c]);
    const onIt = Math.hypot(target.x - p.position.x, target.z - p.position.z);
    if (onIt > 2.5 && !(here && r.indexOf(here.id) >= c)) {
      cursors[slot] = c;
      return steer(target);
    }
    // standing on the island: wait for the sand to go quiet before stepping off it
    const quiet = hunger() < threshold() * 0.4 && wstate !== 'ring' && wstate !== 'stalk';
    const apron = nextId === 'RIM';
    const decoyed = !!planted() && (planted()!.t < THUMP_SECS - 5);
    waited[slot] += 1 / 30;
    const go = apron ? (decoyed || waited[slot] > 25) : (quiet || waited[slot] > 12);
    if (!go) { cursors[slot] = c; return { yaw: p.cam.yaw }; }
    waited[slot] = 0;
    cursors[slot] = Math.min(r.length - 1, c + 1);
    return steer(centreOf(nextId), true, apron);
  };

  const inst: SectionInstance & { test: object } = {
    starts: [0, 1, 2, 3].map((i) => V((i % 2) * 3 - 1.5, SHELF, -3 + Math.floor(i / 2) * 2)),
    floorY: Y0,
    ceilingY: Y0 + REACH + 1,
    groundAt: (x, z) => (islandAt(x, z) ? Y0 + SHELF : Y0),
    contains: (x, z) => Math.abs(x) < HX && z > Z0 - 4 && z < RIM_Z + 6,
    path,
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    hud,
    autopilot,
    dispose: () => {
      projectiles.fire = baseFire;
      audio.setBurrowRumble(0);
      for (const p of game.players) p.sectionMove = null;
    },
    debug: () => ({
      worm: wstate, hunger: +hunger().toFixed(2), threshold: +threshold().toFixed(2), strikes, hits,
      reached, furthest: Math.round(furthest), thumpers: thumpers.map((t) => t.state).join(','),
    }),
    // handles for the mechanics suite (tools/test-section-desert.mjs)
    test: {
      field, thumpers, islands, carrying,
      get worm() { return worm; },
      get state() { return wstate; },
      get prey() { return prey; },
      get ringAt() { return ringAt; },
      get ringR() { return ringR; },
      get strikes() { return strikes; },
      get hits() { return hits; },
      get reached() { return reached; },
      hunger, threshold, onSand, centreOf,
      /** skip the between-strikes rest */
      ready: () => { rest = 0; },
    },
  };
  return inst;
}

export const wormSign: SectionDef = {
  id: 'worm-sign',
  build,
  // the Dune Sea's own air: hot, bright, the mesas hazed
  world: { fogColor: 0xd9bf8e, fogNear: 90, fogFar: 420, fill: 1.1 },
};
