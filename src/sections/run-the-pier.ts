import * as THREE from 'three';
import { TEXT } from '../text';
import { audio } from '../core/audio';
import { clamp, yawBasis } from '../core/math';
import { addBreakable } from '../world/board';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy } from '../enemies/enemy';
import type { Player } from '../player/player';
import { RailCamera } from './kit/railcam';
import { PathFront } from './kit/front';
import { buildMamacore } from '../characters/enemies';

/**
 * Run the Pier (docs/LEVEL_SECTIONS.md §2.10) — the Storm Docks, after the
 * Squall, before the pier heads.
 *
 * The trawler has just come alongside the far pier and the party has stepped
 * ashore, and the mamacore — the harbour's monster, which they were going to
 * find in its pool at the end of the pier — breaks out early, under the pier
 * behind them. The pier comes apart into its mouth, and the only way is
 * forward: six hundred metres of pier chain to the door of the pier heads.
 *
 * **The camera is in front of them, looking back** (K1, `RailCamera` with
 * `reverse`): four hunters sprinting at the lens, the monster's mouth coming
 * through the planks behind them. That view is why the section exists.
 *
 * **The front** (K4 `PathFront`) eats the pier at a little over the party's
 * slowest running pace — a runner slowly loses ground, a sprinter gains it,
 * and the sprint gauge (six seconds) is the budget. Obstacles cost time:
 * crate stacks to hop or go round, fish racks to weave, a crane's load
 * swinging across the lane (it knocks you *back*), two jumps between the
 * pier's three sections, a warehouse the run goes through door to door, and
 * a ten-metre collapsed stretch that wants the jetpack or the super-jump.
 * Quarren surface ahead and block the lane; a dash shoulders one flat.
 *
 * **Hitting back**: fire into the mouth, and enough damage in a short window
 * staggers it — it drops back ten metres. One hunter spending their lead to
 * buy the others time is the co-op trade.
 *
 * **Caught** is not the end of the run: the caught hunter is dragged under
 * and re-forms at the leading edge of the party three seconds later, short of
 * hit points. Only when *everyone* is caught does the pier reset — to the
 * last of three gates, with the front dropped back behind it. And the front
 * never takes a hunter who has just reached a gate for two seconds: a gate
 * is breathing room.
 *
 * It ends at the pier heads: the warehouse at the end of the chain opens a
 * door, the party runs through it, the camera gives the screen back, and the
 * next stage — the pier heads camp — begins inside that door.
 */

// ---- the pier chain: world z is metres along it, x across it ----
const HALF = 5;                 // the pier is ten metres wide
const S_BACK = -44;             // the pier behind the start, which the front eats first
const S_END = 604;              // the pier heads' door
const THROAT = 10;              // the passage behind it
/** the gaps between the chain's three sections, and the collapsed stretch */
const GAPS: [number, number][] = [[196, 201], [398, 404], [472, 482]];
/** the three rail gates: the start, and the head of each later section */
const GATES = [4, 203, 406];
/** the warehouse the run goes through, door to door */
const SHED = { s0: 292, s1: 332, door: 3, h: 7 };
/** the crane over the lane, and the reach of its swinging load */
const CRANE = { s: 132, reach: 4.2, period: 3.4 };
/** a pier segment: the unit the front takes */
const SEG = 3;
/** seconds a caught hunter is under, and how much it costs them */
const UNDER = 3;
const CAUGHT_HP = 0.62;
/** metres the stagger knocks the front back, and the damage it takes in its window */
const STAGGER_BACK = 10;
const STAGGER_DMG = 110;
/** seconds of grace a hunter gets on reaching a gate */
const GATE_GRACE = 2;
/** how far behind the party's middle the front runs before it surges to close */
const BAND = 20;

/** an obstacle on the pier, in world z and x */
interface Block { s0: number; s1: number; x0: number; x1: number; h: number; kind: 'crates' | 'rack' | 'shed' }

function build(ctx: SectionContext): SectionInstance {
  const { game } = ctx;
  const Y0 = ctx.floorY;
  const SEA_Y = Y0 - 3.2;
  const T = TEXT.sections['run-the-pier'];
  const party = Math.max(1, game.players.length);

  // ---- materials ----
  const plankMat = ctx.paint(0x6a5a45, { rough: 0.9, metal: 0.05 });
  ctx.tile(plankMat, 'dock_planks', 2, 1);
  const pileMat = ctx.paint(0x2c2a26, { rough: 0.9, metal: 0.05 });
  const darkMat = ctx.paint(0x24272b, { rough: 0.6, metal: 0.6 });
  const hullMat = ctx.paint(0x5a6a64, { rough: 0.65, metal: 0.45 });
  ctx.tile(hullMat, 'rust_hull', 4, 1);
  const houseMat = ctx.paint(0xc4c8bc, { rough: 0.7, metal: 0.25 });
  ctx.tile(houseMat, 'hull_plate_large', 1.5, 1);
  const shedMat = ctx.paint(0x3e4a52, { rough: 0.8, metal: 0.3 });
  const rustMat = ctx.paint(0x7a3a24, { rough: 0.7, metal: 0.3 });
  const crateMat = ctx.paint(0x5a6a3a, { rough: 0.8, metal: 0.3 });
  const crateTints = [crateMat, ctx.paint(0x6a3a26, { rough: 0.8, metal: 0.3 }), ctx.paint(0x3a4a5a, { rough: 0.8, metal: 0.3 })];
  for (const m of crateTints) ctx.tile(m, 'metal_hull', 1, 1);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd28a });
  const doorGlow = new THREE.MeshBasicMaterial({ color: 0xbfe6ff });
  const lipMat = new THREE.MeshBasicMaterial({ color: 0xffb040 });
  for (const m of [glowMat, doorGlow, lipMat]) ctx.own(m);
  const unit = new THREE.BoxGeometry(1, 1, 1);
  ctx.own(unit);
  const block = (x: number, y: number, z: number, sx: number, sy: number, sz: number, m: THREE.Material, parent?: THREE.Object3D): THREE.Mesh => {
    const mesh = new THREE.Mesh(unit, m);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    (parent ?? ctx.group).add(mesh);
    return mesh;
  };
  const inGap = (s: number): boolean => GAPS.some(([a, b]) => s > a && s < b);

  // ---- the pier: segments the front can take, one by one ----
  interface Seg { z0: number; z1: number; box: ReturnType<typeof ctx.box>['box']; group: THREE.Group; gone: boolean; fall: number }
  const segs: Seg[] = [];
  const pileGeo = new THREE.CylinderGeometry(0.28, 0.34, 7, 7);
  ctx.own(pileGeo);
  for (let z = S_BACK; z < S_END + THROAT; z += SEG) {
    const z1 = z + SEG;
    if (GAPS.some(([a, b]) => z >= a && z1 <= b)) continue;
    const { box } = ctx.box(0, Y0 - 0.25, z + SEG / 2, HALF * 2, 0.5, SEG, null);
    const g = new THREE.Group();
    g.position.set(0, Y0, z + SEG / 2);
    block(0, -0.25, 0, HALF * 2, 0.5, SEG - 0.04, plankMat, g);
    // stringers and the edge beams, darker, so the planks read as a deck
    for (const x of [-HALF + 0.15, HALF - 0.15]) block(x, -0.1, 0, 0.3, 0.35, SEG, pileMat, g);
    if (Math.round(z) % 6 === 0) {
      for (const x of [-HALF + 0.4, 0, HALF - 0.4]) {
        const pile = new THREE.Mesh(pileGeo, pileMat);
        pile.position.set(x, -3.7, 0);
        g.add(pile);
      }
    }
    ctx.mesh(g);
    segs.push({ z0: z, z1, box, group: g, gone: false, fall: 0 });
  }
  // the gaps' lips: a painted edge and the broken plank ends hanging off
  for (const [a, b] of GAPS) {
    for (const z of [a, b]) {
      block(0, Y0 + 0.02, z + (z === a ? -0.2 : 0.2), HALF * 2 - 0.2, 0.04, 0.3, lipMat);
      for (let i = 0; i < 5; i++) {
        const splinter = block(-HALF + 1 + i * 2, Y0 - 0.5, z + (z === a ? 0.6 : -0.6), 0.25, 0.08, 1.3 + (i % 2), plankMat);
        splinter.rotation.x = (z === a ? 1 : -1) * (0.5 + (i % 3) * 0.2);
      }
    }
  }

  // ---- obstacles ----
  const blocks: Block[] = [];
  const crates = (s: number, x0: number, x1: number, h = 1.1): void => {
    const d = 1.6;
    ctx.box((x0 + x1) / 2, Y0 + h / 2, s + d / 2, x1 - x0, h, d, null);
    let k = 0;
    for (let x = x0; x < x1 - 0.3; x += 1.6) {
      const w = Math.min(1.6, x1 - x);
      const m = crateTints[Math.abs(Math.round(s * 3 + k++)) % crateTints.length];
      block(x + w / 2, Y0 + h / 2, s + d / 2, w - 0.06, h, d - 0.06, m).rotation.y = (Math.sin(x * 7 + s) * 0.06);
    }
    blocks.push({ s0: s, s1: s + d, x0, x1, h, kind: 'crates' });
  };
  const rack = (s: number, x: number): void => {
    // two posts and a pole of hanging fish: go round
    ctx.box(x, Y0 + 1.1, s, 2.4, 2.2, 0.5, null);
    const stand = (): THREE.Object3D => {
      const g = new THREE.Group();
      for (const dx of [-1.1, 1.1]) block(dx, 1.1, 0, 0.14, 2.2, 0.14, pileMat, g);
      block(0, 2.15, 0, 2.4, 0.1, 0.1, pileMat, g);
      for (let i = 0; i < 6; i++) block(-0.9 + i * 0.36, 1.6, 0, 0.12, 0.8, 0.28, ctx.paint(0x8a8f7a, { rough: 0.6 }), g);
      return g;
    };
    ctx.prop('fish_rack', new THREE.Vector3(x, Y0, s), { size: 2.4, fallback: stand });
    blocks.push({ s0: s - 0.4, s1: s + 0.4, x0: x - 1.3, x1: x + 1.3, h: 2.2, kind: 'rack' });
  };
  // section one: a slalom of crate stacks and racks, then the crane
  crates(28, -HALF, 1);
  crates(46, -1, HALF);
  rack(64, -2.4); rack(64, 2.6);
  crates(82, -HALF, -0.6); crates(82, 2.4, HALF);
  rack(100, 0.6);
  crates(116, -1.8, 1.8, 0.9);
  crates(156, -HALF, 0.4);
  rack(170, 2.8);
  crates(182, 0.8, HALF);
  // section two: stacks, the warehouse, more stacks
  crates(222, -HALF, -0.8); crates(222, 1.8, HALF);
  rack(240, -1.2);
  crates(258, 0, HALF);
  crates(272, -HALF, -1.4);
  crates(306, -HALF, -1.2, 1.2);            // inside the shed
  crates(318, 1.4, HALF, 1.2);
  crates(350, -1.5, 2.2);
  rack(366, -3); rack(366, 3);
  crates(382, -HALF, 0.2);
  // section three: the collapsed stretch, and the run to the door
  crates(428, 1, HALF);
  rack(438, 2);
  crates(448, -HALF, -1, 0.9);             // and a clear run-up to the collapsed stretch
  crates(500, -1.2, HALF);
  rack(518, -2.8); rack(518, 2.8);
  crates(536, -HALF, 0.8);
  crates(556, -0.8, HALF);
  rack(574, 0);

  // ---- the warehouse the run goes through ----
  const shedGroup = new THREE.Group();
  ctx.mesh(shedGroup);
  const roof: THREE.Mesh[] = [];
  {
    const len = SHED.s1 - SHED.s0;
    const mid = (SHED.s0 + SHED.s1) / 2;
    for (const x of [-HALF - 0.3, HALF + 0.3]) {
      ctx.box(x, Y0 + SHED.h / 2, mid, 0.6, SHED.h, len, null);
      const wall = block(x, Y0 + SHED.h / 2, mid, 0.6, SHED.h, len, shedMat, shedGroup);
      // the wall on the camera's side lifts away with the roof
      if (x > 0) roof.push(wall);
    }
    for (const z of [SHED.s0, SHED.s1]) {
      const w = HALF + 0.6 - SHED.door;
      for (const sx of [-1, 1]) {
        ctx.box(sx * (SHED.door + w / 2), Y0 + SHED.h / 2, z, w, SHED.h, 0.6, null);
        block(sx * (SHED.door + w / 2), Y0 + SHED.h / 2, z, w, SHED.h, 0.6, shedMat, shedGroup);
      }
      block(0, Y0 + SHED.h - 1, z, SHED.door * 2, 2, 0.6, shedMat, shedGroup);
      // the doorways are lit, so the way through reads from outside
      const lamp = block(0, Y0 + SHED.h - 2.2, z + (z === SHED.s0 ? -0.35 : 0.35), SHED.door * 2 - 0.4, 0.15, 0.1, glowMat, shedGroup);
      lamp.castShadow = false;
    }
    for (let z = SHED.s0; z < SHED.s1; z += 4) {
      const r = block(0, Y0 + SHED.h + 0.2, z + 2, HALF * 2 + 1.4, 0.4, 4, darkMat, shedGroup);
      roof.push(r);
    }
    const inside = new THREE.PointLight(0xffc98a, 30, 26, 1.5);
    inside.position.set(0, Y0 + SHED.h - 1.2, mid);
    shedGroup.add(inside);
    blocks.push({ s0: SHED.s0 - 0.3, s1: SHED.s0 + 0.3, x0: -HALF, x1: -SHED.door, h: SHED.h, kind: 'shed' });
    blocks.push({ s0: SHED.s0 - 0.3, s1: SHED.s0 + 0.3, x0: SHED.door, x1: HALF, h: SHED.h, kind: 'shed' });
    blocks.push({ s0: SHED.s1 - 0.3, s1: SHED.s1 + 0.3, x0: -HALF, x1: -SHED.door, h: SHED.h, kind: 'shed' });
    blocks.push({ s0: SHED.s1 - 0.3, s1: SHED.s1 + 0.3, x0: SHED.door, x1: HALF, h: SHED.h, kind: 'shed' });
  }
  const shedSegs = segs.filter((sg) => sg.z1 > SHED.s0 && sg.z0 < SHED.s1);

  // ---- the crane and its swinging load ----
  {
    ctx.cyl(HALF + 1.4, Y0 + 5, CRANE.s, 0.5, 14, null);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 14, 8), rustMat);
    mast.position.set(HALF + 1.4, Y0 + 5, CRANE.s);
    ctx.mesh(mast);
    block(0.4, Y0 + 11.8, CRANE.s, 2 * HALF + 3, 0.5, 0.6, rustMat);
  }
  const load = new THREE.Group();
  block(0, 0, 0, 1.8, 1.6, 1.8, crateMat, load);
  ctx.mesh(load);
  const cableGeo = new THREE.BufferGeometry();
  cableGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const cableMat = new THREE.LineBasicMaterial({ color: 0x15171a });
  ctx.own(cableGeo); ctx.own(cableMat);
  ctx.mesh(new THREE.LineSegments(cableGeo, cableMat));
  const loadX = (t: number): number => CRANE.reach * Math.sin((t / CRANE.period) * Math.PI * 2);

  // ---- the trawler alongside, where the Squall left the party ----
  {
    const tx = -HALF - 7.6;
    const hull = block(tx, SEA_Y + 1.6, 6, 14, 5.2, 36, hullMat);
    hull.receiveShadow = true;
    ctx.box(tx, Y0 - 0.5, 6, 14, 1, 36, null);                     // her deck
    ctx.box(tx + 6.85, Y0 + 0.55, 6, 0.3, 1.1, 36, null);          // her rail
    block(tx, Y0 - 0.02, 6, 14, 0.06, 36, darkMat);
    block(tx + 6.85, Y0 + 0.55, -2, 0.3, 1.1, 20, hullMat);
    block(tx + 6.85, Y0 + 0.55, 18.5, 0.3, 1.1, 11, hullMat);
    ctx.box(tx, Y0 + 1.5, 6, 6, 3, 9, null);
    block(tx, Y0 + 1.5, 6, 6, 3, 9, houseMat);
    block(tx, Y0 + 4.2, 8.8, 4.4, 2.4, 3.3, houseMat);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 10, 8), darkMat);
    mast.position.set(tx, Y0 + 10.4, 9);
    ctx.mesh(mast);
    // her starboard gate open onto the pier, and the gangway plank across
    block(-HALF - 0.3, Y0 + 0.02, 6.5, 1.4, 0.12, 2.6, plankMat);
    for (const x of [-2, 0, 2]) block(tx + x, Y0 + 2, 1.52, 0.8, 0.55, 0.06, glowMat);
  }

  // ---- the pier heads: a warehouse across the end, and its door ----
  const door = { open: 0, want: 0 };
  let doorLeaf: THREE.Mesh;
  let endDoorBox: ReturnType<typeof ctx.box>['box'];
  {
    const w = 18, h = 11;
    for (const sx of [-1, 1]) {
      const ww = (w - 5) / 2;
      ctx.box(sx * (2.5 + ww / 2), Y0 + h / 2, S_END, ww, h, 1, null);
      block(sx * (2.5 + ww / 2), Y0 + h / 2, S_END, ww, h, 1, shedMat);
    }
    block(0, Y0 + 4.6 + (h - 4.6) / 2, S_END, 5, h - 4.6, 1, shedMat);
    // the building behind the door: walls down the throat, and a roof
    for (const sx of [-1, 1]) {
      ctx.box(sx * 2.8, Y0 + 2.5, S_END + THROAT / 2, 0.6, 5, THROAT, null);
      block(sx * 2.8, Y0 + 2.5, S_END + THROAT / 2, 0.6, 5, THROAT, shedMat);
    }
    block(0, Y0 + h / 2, S_END + THROAT + 6, w, h, 12, shedMat);
    ctx.box(0, Y0 + 2.5, S_END + THROAT + 0.5, 6, 5, 1, null);
    block(0, Y0 + 5.2, S_END + THROAT / 2, 6.2, 0.4, THROAT, darkMat);
    // the door: a steel leaf that rises into the lintel, the white-blue lamp over it
    endDoorBox = ctx.box(0, Y0 + 2.3, S_END, 5, 4.6, 0.6, null).box;
    doorLeaf = block(0, Y0 + 2.3, S_END - 0.1, 5, 4.6, 0.3, darkMat);
    const strip = block(0, Y0 + 4.85, S_END - 0.55, 4.6, 0.18, 0.12, doorGlow);
    strip.castShadow = false;
    const lamp = new THREE.PointLight(0xbfe6ff, 30, 26, 1.5);
    lamp.position.set(0, Y0 + 4.6, S_END - 1.5);
    ctx.mesh(lamp);
  }

  // ---- lamp posts, bollards: the pier's rhythm ----
  for (let z = 10; z < S_END; z += 24) {
    if (inGap(z)) continue;
    for (const sx of [-1, 1]) {
      if ((z / 24 + (sx > 0 ? 1 : 0)) % 2 < 1) continue;
      block(sx * (HALF - 0.3), Y0 + 2.2, z, 0.14, 4.4, 0.14, darkMat);
      block(sx * (HALF - 0.6), Y0 + 4.4, z, 0.7, 0.1, 0.1, darkMat);
      block(sx * (HALF - 0.9), Y0 + 4.25, z, 0.3, 0.2, 0.3, glowMat).castShadow = false;
    }
  }
  const lights = [0, 1, 2].map(() => {
    const l = new THREE.PointLight(0xffd8a0, 38, 30, 1.4);
    ctx.mesh(l);
    return l;
  });

  // ---- the sea, under the whole chain ----
  const seaGeo = new THREE.PlaneGeometry(420, S_END - S_BACK + 400, 42, 90);
  seaGeo.rotateX(-Math.PI / 2);
  ctx.own(seaGeo);
  const seaMat = new THREE.MeshStandardMaterial({ color: 0x1c333e, roughness: 0.32, metalness: 0.15 });
  ctx.own(seaMat);
  ctx.tile(seaMat, 'sea_surface', 20, 50, { normal: true });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.position.set(0, SEA_Y, (S_BACK + S_END) / 2);
  ctx.mesh(sea);
  const seaPos = seaGeo.attributes.position as THREE.BufferAttribute;
  const seaNorm = seaGeo.attributes.normal as THREE.BufferAttribute;
  const fill = new THREE.HemisphereLight(0x8a9cb0, 0x1a2830, 0.9);
  ctx.mesh(fill);

  // ---- rain ----
  const RAIN = 1200;
  const rainSeed = new Float32Array(RAIN * 3);
  for (let i = 0; i < RAIN; i++) {
    rainSeed[i * 3] = (Math.random() - 0.5) * 80;
    rainSeed[i * 3 + 1] = Math.random() * 30;
    rainSeed[i * 3 + 2] = (Math.random() - 0.5) * 80;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN * 6), 3));
  rainGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const rainMat = new THREE.LineBasicMaterial({ color: 0xaac4d4, transparent: true, opacity: 0.45, depthWrite: false });
  ctx.own(rainGeo); ctx.own(rainMat);
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  ctx.mesh(rain);
  const RAIN_V = new THREE.Vector3(-5, -30, -4);

  // ---- the mamacore ----
  const beast = new THREE.Group();
  ctx.mesh(beast);
  const beastBody = new THREE.Group();
  beast.add(beastBody);
  const mouthAt = new THREE.Vector3();
  {
    const holder = ctx.prop('mamacore', new THREE.Vector3(0, 0, 0), {
      size: 17,
      fallback: () => {
        const c = buildMamacore();
        c.root.scale.setScalar(1.4);
        return c.root;
      },
    });
    let top: THREE.Object3D = holder;
    while (top.parent && top.parent !== ctx.group) top = top.parent;
    beastBody.attach(top);
    // the model runs along +z with its origin at its middle underside: slide
    // it back so the head is at the group's origin, the body trailing under
    top.position.z = -7;
  }
  const beastGlow = new THREE.PointLight(0x9fd8c8, 0, 18, 1.5);
  beast.add(beastGlow);
  // the mouth is what can be shot: a breakable that never breaks, read for damage
  const mouthBox = ctx.box(0, Y0 - 40, S_BACK - 40, 0.5, 0.5, 0.5, null).box;
  const mouth = addBreakable(game.board, beast, mouthBox, 1e6, { radius: 2.6 });

  // ---- the rail camera, reversed: ahead of the party, looking back ----
  const lanePts: THREE.Vector3[] = [];
  for (let z = S_BACK; z <= S_END + THROAT + 2; z += 2) lanePts.push(new THREE.Vector3(0, Y0, z));
  const rs = (z: number): number => z - S_BACK;
  const ws = (s: number): number => s + S_BACK;
  const safe = (s: number, lat: number): boolean => {
    const z = ws(s);
    if (inGap(z - 1) || inGap(z) || inGap(z + 1)) return false;
    if (Math.abs(lat) > HALF - 0.8) return false;
    // the rail's lateral is to the lane's right, which is -x here
    const x = -lat;
    return !blocks.some((b) => z > b.s0 - 0.8 && z < b.s1 + 0.8 && x > b.x0 - 0.7 && x < b.x1 + 0.7);
  };
  const rail = new RailCamera({
    lane: lanePts,
    reverse: true,
    gates: GATES.map(rs),
    // ahead of the runners, up, and off to the side of the pier away from
    // the trawler: looking back down the chain at them and the mouth
    eye: { back: 6, side: -7, up: 13, lookAhead: 4 },
    lead: 0.66,
    span: 36,
    maxSpeed: 17,
    fov: 60,
    stop: rs(S_END - 6),
    safe,
    groundAt: () => Y0,
    formation: [-1.6, 1.6, -3.2, 3.2],
    width: 14,
  });

  // ---- the front ----
  // A little over the slowest hunter's running pace: a runner loses ground,
  // a sprinter gains it (docs/sections-notes/trask.md has the numbers).
  let runMin = Infinity, sprintMin = Infinity;
  for (const p of game.players) {
    runMin = Math.min(runMin, p.profile.runSpeed);
    sprintMin = Math.min(sprintMin, p.profile.sprintSpeed);
  }
  if (!isFinite(runMin)) { runMin = 9.2; sprintMin = 14.4; }
  const FRONT_SPEED = runMin + 0.18 * (sprintMin - runMin);
  const front = new PathFront(-14, FRONT_SPEED * 0.8, 3.2);

  // ---- state ----
  let started = false;
  let complete = false;
  let releasing = false;
  let t = 0;
  let lastGate = 0;
  let staggerMeter = 0;
  let staggerCd = 0;
  let staggerT = 0;
  let staggers = 0;
  let caughtCount = 0;
  let resets = 0;
  let wiped = false;
  let biteT = 0;
  let loadHits = 0;
  let shoulders = 0;
  const underT = [0, 0, 0, 0];        // > 0: caught and coming back
  const owed = [false, false, false, false];
  const graceT = [0, 0, 0, 0];
  const gateSeen = [0, 0, 0, 0];
  const loadCd = [0, 0, 0, 0];
  const shoved = new Map<Enemy, number>();
  const dashT = [0, 0, 0, 0];
  const jumpT = [0, 0, 0, 0];

  // ---- blockers: quarren surfacing ahead, a group at a time ----
  interface Pack { s: number; n: number; sent: boolean; bodies: Enemy[] }
  const per = 1 + Math.floor(party / 2) + (party >= 4 ? 1 : 0);
  const packs: Pack[] = [70, 148, 250, 312, 356, 438, 526, 580].map((s, i) => ({ s, n: per + (i % 3 === 2 ? 1 : 0), sent: false, bodies: [] }));
  const sendPack = (pk: Pack): void => {
    pk.sent = true;
    for (let i = 0; i < pk.n; i++) {
      const x = ((i % 3) - 1) * 3 + (Math.random() - 0.5);
      const z = pk.s + (i >> 1) * 3;
      const inShed = z > SHED.s0 && z < SHED.s1;
      const e = ctx.spawn('quarren', new THREE.Vector3(x, Y0, z), { exact: true, squad: 8960 });
      if (!inShed) {
        const side = x < 0 ? -1 : 1;
        e.beginArrival('swim', new THREE.Vector3(side * (HALF + 18), SEA_Y, z + 6), e.position.clone());
      }
      pk.bodies.push(e);
    }
  };

  const leaderZ = (): number => {
    let best = -Infinity;
    for (const p of game.players) if (p.alive && underT[p.slot] <= 0) best = Math.max(best, p.position.z);
    return best;
  };
  /** where a hunter comes back: at the leading edge of the party, on a safe plank */
  const leadingEdge = (slot: number): THREE.Vector3 => {
    const lz = leaderZ();
    // nobody standing: the last gate, and the front is dropped back behind it (see update)
    const zWant = isFinite(lz) ? Math.min(lz, ws(rail.front) - 3) : GATES[lastGate];
    const lat = [-1.6, 1.6, -3.2, 3.2][slot % 4];
    let z = Math.max(zWant, front.at + 8);
    for (let k = 0; k < 40; k++) {
      if (safe(rs(z), -lat) && !segAt(z)?.gone) break;
      z += 0.75;
    }
    return new THREE.Vector3(lat, Y0, z);
  };
  const segAt = (z: number): Seg | undefined => segs.find((sg) => z >= sg.z0 && z < sg.z1);

  const catchPlayer = (p: Player): void => {
    if (!p.alive || p.formT > 0 || underT[p.slot] > 0) return;
    caughtCount++;
    biteT = 0.6;
    audio.mamacoreRoar(0.9);
    game.particles.splash(new THREE.Vector3(p.position.x, SEA_Y + 0.5, p.position.z), 30);
    underT[p.slot] = UNDER;
    owed[p.slot] = true;
    // dragged under: the body goes into the mouth, and re-forms at the leading edge
    p.damage(1e6, mouthAt, -1, { heavy: true });
    if (game.players.every((q) => !q.alive)) return;
    ctx.announce(T.caught, T.caughtSub);
  };

  const restorePier = (fromZ: number): void => {
    for (const sg of segs) {
      if (!sg.gone || sg.z1 <= fromZ) continue;
      sg.gone = false;
      sg.fall = 0;
      sg.group.visible = true;
      sg.group.position.y = Y0;
      sg.group.rotation.set(0, 0, 0);
      const phys = game.board.physics;
      if (!phys.boxes.includes(sg.box)) phys.boxes.push(sg.box);
    }
  };

  const update = (dt: number): void => {
    if (complete) return;
    t += dt;
    if (!started) {
      started = true;
      rail.engage(game);
      ctx.checkpoint.set(0, Y0, GATES[0]);
      savedWater = game.board.waterY;
      game.board.waterY = SEA_Y;
      ctx.announce(T.title, T.sub);
      audio.mamacoreRoar(1);
      game.particles.splash(new THREE.Vector3(0, SEA_Y + 1, -14), 60);
      for (const p of game.players) p.cam.shake(0.4);
      if (party >= 2) ctx.pickup(new THREE.Vector3(0, Y0, 210));
      ctx.pickup(new THREE.Vector3(0, Y0, 414));
    }
    rail.update(dt);
    if (releasing) {
      if (rail.out) complete = true;
      return;
    }

    // ---- the front: slower off the mark, and it stops at the pier heads ----
    // A rubber band: more than BAND metres behind the party's middle, it
    // surges to close — the mouth stays in shot and a stall is always costly
    // — except while it is reeling from a stagger, which is what a stagger buys.
    const cz = rail.centroid(game);
    const lag = cz === null ? 0 : ws(cz) - front.at;
    const band = staggerCd > 0 ? 0 : clamp((lag - BAND) * 0.45, 0, sprintMin * 0.45);
    front.speed = (t < 7 ? FRONT_SPEED * 0.8 : FRONT_SPEED) + band;
    front.update(dt);
    front.at = Math.min(front.at, S_END - 8);

    // the pier comes apart into the mouth, a segment at a time
    for (const sg of segs) {
      if (sg.gone) {
        if (sg.fall < 1.6) {
          sg.fall += dt;
          sg.group.position.y = Y0 - sg.fall * sg.fall * 2.2;
          sg.group.rotation.x = -sg.fall * 0.5;
          sg.group.rotation.z = Math.sin(sg.z0) * sg.fall * 0.4;
          if (sg.fall >= 1.6) sg.group.visible = false;
        }
        continue;
      }
      if (front.at < sg.z1 - 0.5) continue;
      // a hunter on their gate's grace keeps the planks under them a moment
      const held = game.players.some((p) => p.alive && graceT[p.slot] > 0 && p.position.z >= sg.z0 - 1 && p.position.z <= sg.z1 + 1);
      if (held) continue;
      sg.gone = true;
      sg.fall = 0;
      ctx.unsolid({ box: sg.box });
      game.particles.splash(new THREE.Vector3((Math.random() - 0.5) * 8, Y0 - 0.5, sg.z0 + 1.5), 10);
      if (Math.random() < 0.4) audio.iceCrack(0.35);
    }

    // ---- the mamacore rides the front ----
    staggerCd = Math.max(0, staggerCd - dt);
    staggerT = Math.max(0, staggerT - dt);
    biteT = Math.max(0, biteT - dt);
    const lunge = biteT > 0 ? Math.sin((biteT / 0.6) * Math.PI) * 3 : 0;
    const dive = staggerT > 0 ? Math.sin((staggerT / 1.6) * Math.PI) * 5 : 0;
    const headZ = front.at - 2 + lunge;
    beast.position.set(Math.sin(t * 0.7) * 1.2, SEA_Y + 2.2 + Math.sin(t * 2.3) * 0.5 - dive, headZ);
    beast.rotation.set(-0.55 - (biteT > 0 ? 0.25 : 0) + dive * 0.05, Math.sin(t * 0.7) * 0.12, Math.sin(t * 1.1) * 0.08);
    beastGlow.intensity = 30;
    beastGlow.position.set(0, 2, 2);
    mouthAt.set(beast.position.x, Y0 + 1.2 - dive, headZ + 1.5);
    mouth.center.copy(mouthAt);
    if (Math.random() < dt * 8) game.particles.splash(new THREE.Vector3((Math.random() - 0.5) * 10, SEA_Y + 0.3, front.at - Math.random() * 4), 6);
    // what it took this frame: into the stagger meter, and the breakable made whole again
    const took = mouth.maxHp - mouth.hp;
    mouth.hp = mouth.maxHp;
    mouth.broken = false;
    staggerMeter = Math.max(0, staggerMeter + took - dt * 35);
    const need = STAGGER_DMG * (0.7 + 0.15 * party);
    if (staggerMeter >= need && staggerCd <= 0) {
      staggerMeter = 0;
      staggerCd = 5;
      staggerT = 1.6;
      staggers++;
      front.pushBack(STAGGER_BACK, S_BACK);
      front.pause(0.8);
      audio.mamacoreRoar(0.6);
      game.particles.splash(mouthAt.clone(), 40);
      ctx.announce(T.stagger, T.staggerSub);
    }

    // ---- gates: a checkpoint, and breathing room ----
    if (rail.gateIdx > lastGate) {
      lastGate = rail.gateIdx;
      ctx.checkpoint.set(0, Y0, GATES[lastGate]);
      audio.checkpointChime();
      ctx.announce(TEXT.banners.checkpoint, T.gateSub(lastGate));
    }
    for (const p of game.players) {
      graceT[p.slot] = Math.max(0, graceT[p.slot] - dt);
      for (let g = gateSeen[p.slot] + 1; g < GATES.length; g++) {
        if (p.alive && p.position.z >= GATES[g]) { gateSeen[p.slot] = g; graceT[p.slot] = GATE_GRACE; }
      }
    }

    // ---- who it catches: behind the front, or in the water ----
    for (const p of game.players) {
      if (!p.alive || p.formT > 0) continue;
      const behind = p.position.z < front.at + 0.4 && graceT[p.slot] <= 0;
      const wet = p.position.y < SEA_Y + 0.3 || p.swimming;
      if (behind || wet) catchPlayer(p);
    }
    for (let i = 0; i < 4; i++) underT[i] = Math.max(0, underT[i] - dt);
    // a caught hunter who has come back comes back short of breath
    for (const p of game.players) {
      if (owed[p.slot] && p.alive && p.formT <= 0) {
        owed[p.slot] = false;
        p.hp = Math.min(p.hp, p.maxHp * CAUGHT_HP);
      }
    }
    // hostiles in the water or behind the front are the mamacore's too
    for (const e of game.enemies) {
      if (!e.alive || e.arriving || e.team !== 1) continue;
      if (e.position.y < SEA_Y + 0.3 || e.position.z < front.at) {
        game.particles.splash(new THREE.Vector3(e.position.x, SEA_Y, e.position.z), 12);
        e.damage(1e7, e.position, -1);
      }
    }

    // ---- everyone caught: the pier resets to the last gate ----
    const anyAlive = game.players.some((p) => p.alive);
    if (!anyAlive && !wiped) {
      wiped = true;
      resets++;
      const g = GATES[lastGate];
      front.resetTo(g - 24, 3);
      restorePier(g - 30);
      for (let i = 0; i < 4; i++) { underT[i] = 0; gateSeen[i] = lastGate; }
      for (const e of game.enemies) if (e.alive && e.team === 1 && e.position.z < g + 20) e.removeMe = true;
      ctx.announce(T.reset, T.resetSub);
    } else if (anyAlive) wiped = false;

    // ---- blockers surface ahead of the leader ----
    const lz = leaderZ();
    for (const pk of packs) if (!pk.sent && isFinite(lz) && lz > pk.s - 34) sendPack(pk);
    // a dash shoulders a quarren flat
    for (const p of game.players) {
      if (!p.alive) continue;
      const v = Math.hypot(p.velocity.x, p.velocity.z);
      if (v < 15) continue;
      for (const e of game.enemies) {
        if (!e.alive || e.team !== 1 || e.arriving) continue;
        if (Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z) > 1.6) continue;
        if ((shoved.get(e) ?? -9) > t - 1) continue;
        shoved.set(e, t);
        shoulders++;
        e.knockdown(2);
        e.damage(20, p.position, p.slot);
        e.velocity.x += (p.velocity.x / v) * 7 + Math.sign(e.position.x - p.position.x || 1) * 4;
        e.velocity.z += (p.velocity.z / v) * 7;
        e.velocity.y = 4;
        audio.meleeHit('gaffi');
      }
    }

    // ---- the crane's load swings across the lane ----
    const lx = loadX(t);
    load.position.set(lx, Y0 + 1.5, CRANE.s);
    load.rotation.z = -Math.cos((t / CRANE.period) * Math.PI * 2) * 0.25;
    const cp = cableGeo.attributes.position as THREE.BufferAttribute;
    cp.setXYZ(0, 0.4 * lx / CRANE.reach, Y0 + 11.6, CRANE.s);
    cp.setXYZ(1, lx, Y0 + 2.3, CRANE.s);
    cp.needsUpdate = true;
    for (const p of game.players) {
      loadCd[p.slot] = Math.max(0, loadCd[p.slot] - dt);
      if (!p.alive || loadCd[p.slot] > 0) continue;
      if (Math.abs(p.position.z - CRANE.s) > 1.4 || Math.abs(p.position.x - lx) > 1.5 || p.position.y > Y0 + 2.3) continue;
      loadCd[p.slot] = 1.2;
      loadHits++;
      p.damage(14, load.position, -1, { heavy: true });
      // knocked back — toward the mouth
      p.velocity.set(Math.sign(p.position.x - lx || 1) * 5, 4, -7);
      audio.impact();
    }

    // ---- the warehouse roof lifts away while the party is under it ----
    const inShed = isFinite(lz) && ws(rail.focus) > SHED.s0 - 6 && ws(rail.focus) < SHED.s1 + 4;
    for (const r of roof) r.visible = !inShed;
    void shedSegs;

    // ---- the end door: opens as they come, and the throat is the way out ----
    if (isFinite(lz) && lz > S_END - 60) door.want = 1;
    const was = door.open;
    door.open += Math.sign(door.want - door.open) * Math.min(Math.abs(door.want - door.open), dt / 0.9);
    doorLeaf.position.y = Y0 + 2.3 + door.open * 4.4;
    if (was < 0.95 && door.open >= 0.95) { ctx.unsolid({ box: endDoorBox }); audio.doorCycle(); }
    for (const p of game.players) {
      if (p.alive && p.position.z > S_END + 3 && door.open >= 0.95) { releasing = true; rail.release(); break; }
    }

    // ---- light, sea, rain follow the chase ----
    const fz = ws(rail.focus);
    lights.forEach((l, i) => l.position.set(i === 1 ? -HALF + 1 : HALF - 1, Y0 + 4.6, Math.round((fz - 12 + i * 16) / 8) * 8));
    for (let i = 0; i < seaPos.count; i++) {
      const x = seaPos.getX(i), z = seaPos.getZ(i);
      const a1 = x * 0.1 + t * 0.8, a2 = z * 0.06 + t * 0.5;
      seaPos.setY(i, Math.sin(a1) * 0.5 + Math.sin(a2) * 0.45);
      const dx = Math.cos(a1) * 0.05, dz = Math.cos(a2) * 0.027;
      const inv = 1 / Math.hypot(dx, 1, dz);
      seaNorm.setXYZ(i, -dx * inv, inv, -dz * inv);
    }
    seaPos.needsUpdate = true;
    seaNorm.needsUpdate = true;
    const arr = (rainGeo.attributes.position as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < RAIN; i++) {
      let x = rainSeed[i * 3] + RAIN_V.x * dt;
      let y = rainSeed[i * 3 + 1] + RAIN_V.y * dt;
      let z = rainSeed[i * 3 + 2] + RAIN_V.z * dt;
      if (y < -3) { y += 30; x = (Math.random() - 0.5) * 80; z = (Math.random() - 0.5) * 80; }
      if (x < -40) x += 80;
      if (z < -40) z += 80;
      rainSeed[i * 3] = x; rainSeed[i * 3 + 1] = y; rainSeed[i * 3 + 2] = z;
      const cz = fz + z;
      arr[i * 6] = x; arr[i * 6 + 1] = Y0 + y; arr[i * 6 + 2] = cz;
      arr[i * 6 + 3] = x - RAIN_V.x * 0.045; arr[i * 6 + 4] = Y0 + y - RAIN_V.y * 0.045; arr[i * 6 + 5] = cz - RAIN_V.z * 0.045;
    }
    (rainGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  };
  let savedWater: number | undefined;

  const respawnSpot = (slot: number): THREE.Vector3 => {
    const anyUp = game.players.some((p) => p.alive && p.slot !== slot);
    if (!anyUp) {
      const g = GATES[lastGate];
      return ctx.placeAt(new THREE.Vector3([-1.6, 1.6, -3.2, 3.2][slot % 4], Y0, g + 1.5), 'pyke');
    }
    return ctx.placeAt(leadingEdge(slot), 'pyke');
  };

  const objective = () => {
    const lz = leaderZ();
    if (isFinite(lz) && lz > S_END - 80) return { pos: new THREE.Vector3(0, Y0 + 1, S_END + 2), label: T.door, hint: T.doorHint, beacon: false };
    // Ahead is behind the lens in this view, so the marker sits on the thing
    // the party can see and must not let close: the mouth, with its distance.
    const next = GAPS.find(([a]) => a > lz - 1);
    const hint = next && next[0] - lz < 24 ? (next[1] - next[0] > 8 ? T.collapsedHint : T.gapHint) : T.run;
    return { pos: mouthAt.clone(), label: T.mamacoreLabel, hint, beacon: false };
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const gap = p.alive ? p.position.z - front.at : 0;
    const bars: SectionBar[] = [{
      label: staggerT > 0 ? T.staggered : T.mamacore,
      value: clamp(1 - gap / 30, 0, 1),
      tone: gap < 8 ? 'danger' : gap < 16 ? 'warn' : 'info',
    }, {
      label: T.staggerBar,
      value: clamp(staggerMeter / (STAGGER_DMG * (0.7 + 0.15 * party)), 0, 1),
      tone: 'good',
    }];
    let line: string;
    if (!p.alive || underT[slot] > 0) line = T.under;
    else if (graceT[slot] > 0) line = T.grace;
    else if (gap < 9) line = T.close;
    else {
      const next = GAPS.find(([a]) => a > p.position.z);
      line = next && next[0] - p.position.z < 18 ? (next[1] - next[0] > 8 ? T.collapsedHint : T.gapHint)
        : Math.abs(p.position.z - CRANE.s) < 20 && p.position.z < CRANE.s ? T.craneHint
        : T.run;
    }
    return { bars, line };
  };

  // ---- the autopilot: sprint for the door, round or over what is in the way ----
  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive || p.formT > 0 || !started) return {};
    const z = p.position.z;
    const out: AutopilotInput = { sprintHeld: true };
    let wantZ = Math.min(ws(rail.front) - 2, S_END + 8);
    let wantX = [-1.6, 1.6, -3.2, 3.2][slot % 4];
    if (releasing || z > S_END - 30) { wantZ = S_END + 8; wantX = 0; }
    // through the warehouse doors, and the pier heads' door, on the middle
    if ((z > SHED.s0 - 12 && z < SHED.s0 + 1) || (z > SHED.s1 - 12 && z < SHED.s1 + 1)) wantX = clamp(wantX, -1.4, 1.4);
    // the crane: pass on the side its load is swinging away from
    if (z > CRANE.s - 10 && z < CRANE.s + 1) wantX = loadX(t + 0.5) > 0 ? -3.4 : 3.4;
    // obstacles in the next few metres: go round on the nearer free side, or hop a low one
    let hop = false;
    for (const b of blocks) {
      if (b.kind === 'shed') continue;
      const ahead = b.s0 - z;
      if (ahead < -0.4 || ahead > 7) continue;
      if (wantX > b.x0 - 0.8 && wantX < b.x1 + 0.8) {
        const left = b.x0 - 1.1, right = b.x1 + 1.1;
        const leftOk = left > -HALF + 0.6, rightOk = right < HALF - 0.6;
        if (leftOk && (!rightOk || Math.abs(p.position.x - left) < Math.abs(p.position.x - right))) wantX = left;
        else if (rightOk) wantX = right;
        else if (b.h <= 1.25) { hop = ahead < 2.4; }
        // not yet over there: a low stack is hopped rather than run into
        if (ahead < 1.8 && b.h <= 1.25 && Math.abs(p.position.x - wantX) > 1) hop = true;
      }
    }
    const b = yawBasis(p.moveYaw ?? p.cam.yaw);
    const dx = wantX - p.position.x, dz = wantZ - z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.6) {
      const k = Math.min(1, dist / 2);
      out.moveY = ((dx * b.fwdX + dz * b.fwdZ) / dist) * k;
      out.moveX = ((dx * b.rightX + dz * b.rightZ) / dist) * k;
    }
    // dash: roll into the sprint, and shoulder a quarren in the way
    dashT[slot] = Math.max(0, dashT[slot] - 1 / 30);
    if (dashT[slot] <= 0 && p.grounded && dist > 4) { out.dashPressed = true; dashT[slot] = 2.5; }
    // the gaps: jump at the lip, and hold it across
    jumpT[slot] = Math.max(0, jumpT[slot] - 1 / 30);
    const gapAhead = GAPS.find(([a, e]) => a - z > 0 && a - z < 2.2 && wantZ > e);
    const over = inGap(z) || GAPS.some(([a, e]) => z > a - 0.5 && z < e + 0.5);
    if ((gapAhead || hop) && p.grounded) { out.jumpPressed = true; out.jumpHeld = true; jumpT[slot] = gapAhead && gapAhead[1] - gapAhead[0] > 8 ? 1.4 : 0.4; }
    else if (jumpT[slot] > 0 || (over && p.position.y < Y0 + 2)) out.jumpHeld = true;
    // aim: the mouth when it is close, else the nearest quarren ahead
    let aimAt: THREE.Vector3 | null = null;
    if (z - front.at < 12 && staggerCd <= 0) aimAt = mouthAt;
    else {
      let nd = 26;
      for (const e of game.hostilesFor(p)) {
        if (!e.alive) continue;
        const d = e.position.distanceTo(p.position);
        if (d < nd) { nd = d; aimAt = e.position; }
      }
    }
    if (aimAt) {
      const ax = aimAt.x - p.position.x, az = aimAt.z - z;
      const n = Math.hypot(ax, az) || 1;
      out.aimStickX = (ax * b.rightX + az * b.rightZ) / n;
      out.aimStickY = (ax * b.fwdX + az * b.fwdZ) / n;
      out.shootHeld = true;
    }
    return out;
  };

  const inst = {
    starts: [0, 1, 2, 3].map((i) => new THREE.Vector3((i % 2 ? 1 : -1) * 1.6 - 1, Y0, 5 + Math.floor(i / 2) * 1.8)),
    floorY: Y0,
    ceilingY: Y0 + 18,
    groundAt: () => Y0,
    contains: (x: number, z: number) => (Math.abs(x) < HALF + 0.6 && z > S_BACK && z < S_END + THROAT)
      || (x < -HALF && x > -HALF - 15 && z > -12 && z < 24),
    path: [new THREE.Vector3(0, Y0, 6), ...[60, 130, 199, 312, 401, 477, 560].map((z) => new THREE.Vector3(0, Y0, z)), new THREE.Vector3(0, Y0, S_END + 6)],
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    // the sea is the mamacore's (caught in `update`); this is for a body that got past that
    offPath: (pos: THREE.Vector3) => pos.y < SEA_Y - 6,
    hud,
    autopilot,
    dispose: () => {
      rail.dispose();
      for (const p of game.players) p.sectionMove = null;
      if (started) game.board.waterY = savedWater;
      if (game.board.breakables) game.board.breakables = game.board.breakables.filter((b) => b !== mouth);
    },
    debug: () => ({
      front: +front.at.toFixed(1), speed: +FRONT_SPEED.toFixed(2), leader: +leaderZ().toFixed(1),
      focus: +ws(rail.focus).toFixed(1), gate: lastGate, caught: caughtCount, resets, staggers,
      loadHits, shoulders, blend: +rail.blend.toFixed(2), releasing, door: +door.open.toFixed(2),
    }),
    force: {
      front: (z: number) => { front.at = z; },
      hold: (secs = 999) => { front.pause(secs); },
      stagger: (dmg = 1000) => { mouth.hp -= dmg; },
    },
    rail,
  };
  return inst as SectionInstance;
}

export const runThePier: SectionDef = {
  id: 'run-the-pier',
  build,
  // the storm's air, as the crossing had it
  world: { fogColor: 0x34414b, fogNear: 30, fogFar: 190, background: 0x3a4650 },
};
