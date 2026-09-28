import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy, EnemyKind } from '../enemies/enemy';
import type { StaticBox } from '../core/physics';
import { buildStormtrooper } from '../characters/enemies';
import { Treadmill, type ConveyorItem } from './kit/treadmill';
import { Interactions } from './kit/interact';
import { composeMoves } from './kit/moves';

/**
 * The Lift (docs/LEVEL_SECTIONS.md §2.18) — the Prison Rig, after the work
 * floor and the supervisor deck (stage C), before the top decks (stage D).
 *
 * The supervisor deck's far door is the lift. The party steps through it onto
 * a twelve-metre freight platform in the rig's central shaft, the door slides
 * away below, and two hundred metres of white panel go by: landings every
 * twenty-five metres with guards on them, jet troopers dropping from above,
 * debris coming down the shaft, and twice the guards cut the power and the
 * party has to fight onto a landing and throw the breaker. The last stretch
 * comes up under a squad holding the top, and the lift breaks out into the
 * open under the sky of the top decks — where stage D begins.
 *
 * **Built on K2, the treadmill.** The platform never moves. The shaft does:
 * the four walls, every landing and the top deck are conveyor items that go
 * down past the platform at the lift's speed, and their colliders are movers,
 * so a squad on a landing is carried down with it and a player who is still
 * on a landing when the lift restarts goes down with it too — for five
 * seconds, and then the fall catches them and they re-form on the platform.
 *
 * The plan: a 12 × 12 m platform with a waist-high rail on the west (−z) and
 * the pylon side (+x), open edges on the landing side (+z) and on the far
 * side (−x). The shaft wall stands 4 m back from the open far edge (so the
 * camera never has the wall in its face) and 7 m back on the landing side,
 * where each landing's 4.5 m deck leaves a 2.5 m gap: close enough to fire
 * across and for a guard to jump, far enough that a stop is a leap.
 */

/** half the platform, metres */
const PLAT = 6;
const RAIL_H = 1.1;
/** the open gap between the platform's landing edge and a landing's lip */
const GAP = 2.5;
/** how deep a landing's deck is, lip to wall */
const LAND_D = 4.5;
/** the shaft's inside faces */
const WALL_ZP = PLAT + GAP + LAND_D;   // the landing side
const WALL_ZN = -(PLAT + 3);           // behind the west rail
const WALL_XP = PLAT + 3;              // behind the pylon rail
const WALL_XN = -(PLAT + 4);           // the open far edge: 4 m back, per the design
const WALL_T = 2;
/** metres of shaft to the top */
const TRAVEL = 200;
/** a landing every this many metres */
const SPACING = 25;
/** the two power cuts, as odometer readings (each is a landing) */
const STOPS = [75, 150];
/** the lift's speed, metres a second */
const SPEED = 2;
/** seconds of shadow before debris lands */
const DEBRIS_WARN = 1.5;
/** seconds to get back aboard after a restart */
const BOARD_TIME = 5;
/** the top deck: how far it runs out from the shaft's mouth */
const TOP_R = 34;
/** the deck gate, the transport door onto the assembly deck */
const GATE = new THREE.Vector3(0, 0, 28);

type Phase = 'ready' | 'ride' | 'stopping' | 'stopped' | 'restart' | 'arriving' | 'top';

interface Landing {
  L: number;
  n: number;
  item: ConveyorItem;
  group: THREE.Group;
  kind: 'door' | 'squad' | 'stop' | 'top';
  guards: Enemy[];
  posted: boolean;
  leapt: number;
}

function build(ctx: SectionContext): SectionInstance {
  const { game, spec } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections['the-lift'];
  const party = Math.max(1, game.players.length);

  // ---- materials ----
  const deckMat = ctx.paint(0x5b636b, { rough: 0.55, metal: 0.6 });
  ctx.tile(deckMat, 'metal_deck', 3, 3);
  const railMat = ctx.paint(0xe0b030, { rough: 0.5, metal: 0.5 });
  const darkMat = ctx.paint(0x2c3136, { rough: 0.6, metal: 0.5 });
  const panelMat = (rx: number, ry: number): THREE.MeshStandardMaterial => {
    const m = ctx.paint(spec.palette.wall, { rough: 0.7, metal: 0.15 });
    ctx.tile(m, 'panel_white', rx, ry);
    return m;
  };
  const landingMat = ctx.paint(0x6a737c, { rough: 0.55, metal: 0.55 });
  ctx.tile(landingMat, 'metal_deck', 3, 1);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd28a });
  const accentMat = new THREE.MeshBasicMaterial({ color: spec.palette.accent });
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff4a3a });
  const topMat = ctx.paint(spec.palette.floor, { rough: 0.75, metal: 0.2 });
  ctx.tile(topMat, 'panel_white', 8, 8);
  for (const m of [glowMat, accentMat, redMat]) ctx.own(m);
  const unit = ctx.own(new THREE.BoxGeometry(1, 1, 1));
  /** a mesh in a moving group, relative to its origin */
  const slab = (g: THREE.Object3D, m: THREE.Material, cx: number, cy: number, cz: number,
    sx: number, sy: number, sz: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(unit, m);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  /** a collider (no mesh) in world space */
  const solid = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): StaticBox =>
    ctx.box(cx, cy, cz, sx, sy, sz, null).box;

  // ================================================================ the platform
  // Static, the whole ride. Deck, the two rails, the pylon, the guide rails.
  ctx.box(0, Y0 - 0.4, 0, PLAT * 2, 0.8, PLAT * 2, deckMat);
  // the underside's girders, seen from the landings
  const under = new THREE.Group();
  ctx.mesh(under);
  for (const x of [-4, 0, 4]) slab(under, darkMat, x, Y0 - 1.3, 0, 0.6, 1.2, PLAT * 2);
  slab(under, darkMat, 0, Y0 - 2.2, 0, 3, 1.2, 3);
  // the rails: waist-high on the west (−z) and pylon (+x) sides
  const railZ = -PLAT + 0.1, railX = PLAT - 0.1;
  ctx.box(0, Y0 + RAIL_H / 2, railZ, PLAT * 2, RAIL_H, 0.2, railMat);
  ctx.box(railX, Y0 + RAIL_H / 2, 0, 0.2, RAIL_H, PLAT * 2, railMat);
  for (let i = -PLAT; i <= PLAT; i += 3) {
    ctx.box(i, Y0 + RAIL_H / 2, railZ, 0.14, RAIL_H, 0.14, darkMat);
    ctx.box(railX, Y0 + RAIL_H / 2, i, 0.14, RAIL_H, 0.14, darkMat);
  }
  // hazard striping along the two open edges
  const stripe = ctx.paint(0xe0b030, { rough: 0.6 });
  ctx.tile(stripe, 'hazard_stripe', 12, 1);
  ctx.box(0, Y0 + 0.02, PLAT - 0.3, PLAT * 2, 0.06, 0.6, stripe);
  ctx.box(-PLAT + 0.3, Y0 + 0.02, 0, 0.6, 0.06, PLAT * 2, stripe);
  // the control pylon, in the rails' corner
  const pylonAt = new THREE.Vector3(PLAT - 1.1, Y0, -PLAT + 1.1);
  const pylonLight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.08), accentMat);
  ctx.prop('freight_lift_pylon', pylonAt, {
    size: 2.4,
    fallback: () => {
      const g = new THREE.Group();
      slab(g, darkMat, 0, 1.1, 0, 0.9, 2.2, 0.9);
      slab(g, railMat, 0, 2.3, 0, 1.1, 0.2, 1.1);
      pylonLight.position.set(-0.35, 1.5, 0.46);
      pylonLight.rotation.y = -Math.PI / 4;
      g.add(pylonLight);
      return g;
    },
  });
  ctx.cyl(pylonAt.x, Y0 + 1.1, pylonAt.z, 0.6, 2.2, null);
  // The guide rails: two ribbed columns the platform runs on, in the rails'
  // outer corners, running the height of the shaft. They are the one piece
  // of the shaft that never ends in view, so they are a strip (K2): a static
  // mesh whose ribs slide down.
  const guideMat = ctx.paint(0x3a4148, { rough: 0.5, metal: 0.7 });
  const guideTex = makeRibTexture();
  ctx.own(guideTex);
  guideMat.map = guideTex;
  guideMat.color.set(0xffffff);
  // Unit-tall and scaled each frame: they run from the fog below up to the
  // shaft's mouth, and end there when the mouth comes down to the platform.
  const GUIDE_BOT = -80;
  const guides: THREE.Mesh[] = [];
  for (const [x, z] of [[PLAT + 1.4, -PLAT - 1.4], [-PLAT + 1, -PLAT - 1.4], [PLAT + 1.4, PLAT - 1]] as const) {
    const col = new THREE.Mesh(unit, guideMat);
    col.position.set(x, Y0, z);
    col.castShadow = true;
    ctx.mesh(col);
    guides.push(col);
  }
  const fitGuides = (mouthY: number): void => {
    const h = Math.min(160, mouthY - (Y0 + GUIDE_BOT));
    for (const g of guides) {
      g.scale.set(0.8, h, 0.8);
      g.position.y = Y0 + GUIDE_BOT + h / 2;
    }
    guideTex.repeat.set(1, h / 2);
  };

  // ================================================================ the treadmill
  // The world goes *down* past the platform: the lift reads as rising.
  fitGuides(Y0 + TRAVEL);
  const mill = new Treadmill({ dir: new THREE.Vector3(0, -1, 0), speed: 0, ease: 2, board: ctx.board });
  mill.strip(guideTex, { metresPerRepeat: 2, axis: 'y', sign: 1 });

  // ---- the shaft walls: four panels the full height, carried down ----
  // A wall is one tall box that slides; its top edge is the shaft's mouth,
  // and it arrives at the platform's level at the end of the ride.
  const wallTop = TRAVEL - 0.05;
  const wallBot = -90;
  const wallH = wallTop - wallBot;
  const wy = (wallTop + wallBot) / 2;
  const shaft = new THREE.Group();
  shaft.position.set(0, Y0, 0);
  ctx.mesh(shaft);
  const spanX = WALL_XP - WALL_XN + WALL_T * 2;
  const midX = (WALL_XP + WALL_XN) / 2;
  const spanZ = WALL_ZP - WALL_ZN;
  const midZ = (WALL_ZP + WALL_ZN) / 2;
  const wallBoxes: StaticBox[] = [];
  const wall = (cx: number, cz: number, sx: number, sz: number, rx: number): void => {
    slab(shaft, panelMat(rx, wallH / 6), cx, wy, cz, sx, wallH, sz);
    wallBoxes.push(solid(cx, Y0 + wy, cz, sx, wallH, sz));
  };
  wall(midX, WALL_ZP + WALL_T / 2, spanX, WALL_T, spanX / 6);
  wall(midX, WALL_ZN - WALL_T / 2, spanX, WALL_T, spanX / 6);
  wall(WALL_XP + WALL_T / 2, midZ, WALL_T, spanZ, spanZ / 6);
  wall(WALL_XN - WALL_T / 2, midZ, WALL_T, spanZ, spanZ / 6);
  // The ribs: a dark structural band every 3 m and an amber light line every
  // 6 m on every face, so the climb reads in any still frame and the speed
  // reads the moment it moves. Instanced: two hundred metres of them.
  const ribs: [number, number, number, number, number, number, boolean][] = [];
  for (let y = -60; y < wallTop; y += 3) {
    const lit = Math.round(y) % 6 === 0;
    const h = lit ? 0.14 : 0.35;
    ribs.push([midX, y, WALL_ZN + 0.04, spanX - 2, h, 0.08, lit]);
    ribs.push([WALL_XN + 0.04, y, midZ, 0.08, h, spanZ - 2, lit]);
    ribs.push([WALL_XP - 0.04, y, midZ, 0.08, h, spanZ - 2, lit]);
    // the landing wall: either side of the landings' doors
    ribs.push([-9, y, WALL_ZP - 0.04, 6, h, 0.08, lit]);
    ribs.push([9, y, WALL_ZP - 0.04, 6, h, 0.08, lit]);
  }
  for (const lit of [true, false]) {
    const list = ribs.filter((r) => r[6] === lit);
    const inst = new THREE.InstancedMesh(unit, lit ? glowMat : darkMat, list.length);
    const m4 = new THREE.Matrix4();
    list.forEach(([x, y, z, sx, sy, sz], i) => {
      m4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
      inst.setMatrixAt(i, m4);
    });
    shaft.add(inst);
  }
  // service ladders and conduit on the far wall, for scale
  for (const z of [-3, 4]) slab(shaft, darkMat, WALL_XN + 0.25, wy, z, 0.3, wallH, 0.5);
  mill.conveyor(shaft, { behind: TRAVEL + 400, boxes: wallBoxes });

  // ---- the landings ----
  const landings: Landing[] = [];
  const breakerSpots: THREE.Vector3[] = [];
  for (let L = 0; L < TRAVEL; L += SPACING) {
    const n = L / SPACING;
    const kind: Landing['kind'] = L === 0 ? 'door' : STOPS.includes(L) ? 'stop' : 'squad';
    const g = new THREE.Group();
    g.position.set(0, Y0 + L, 0);
    ctx.mesh(g);
    const lipZ = PLAT + GAP;
    const dz = (lipZ + WALL_ZP) / 2;
    // the deck
    slab(g, landingMat, 0, -0.3, dz, PLAT * 2 + 2, 0.6, LAND_D);
    slab(g, darkMat, 0, -1.1, dz, PLAT * 2 + 2, 1, 0.8);
    const boxes = [solid(0, Y0 + L - 0.3, dz, PLAT * 2 + 2, 0.6, LAND_D)];
    // end rails, so a guard does not walk off the side
    for (const sx of [-1, 1]) {
      slab(g, railMat, sx * (PLAT + 0.9), RAIL_H / 2, dz, 0.15, RAIL_H, LAND_D);
      boxes.push(solid(sx * (PLAT + 0.9), Y0 + L + RAIL_H / 2, dz, 0.15, RAIL_H, LAND_D));
    }
    // the lip's light, and the level's number over the door
    slab(g, kind === 'stop' ? redMat : accentMat, 0, 0.02, lipZ + 0.15, PLAT * 2 + 2, 0.05, 0.2);
    // the door in the wall behind it: shut blast doors, lit frame
    slab(g, darkMat, 0, 2.2, WALL_ZP - 0.05, 5.4, 4.4, 0.2);
    slab(g, glowMat, 0, 4.6, WALL_ZP - 0.1, 5.8, 0.2, 0.1);
    slab(g, deckMat, -1.3, 2.1, WALL_ZP - 0.15, 2.5, 4.1, 0.12);
    slab(g, deckMat, 1.3, 2.1, WALL_ZP - 0.15, 2.5, 4.1, 0.12);
    const plate = numberPlate(n, kind === 'door' ? 'C' : null);
    ctx.own(plate.material as THREE.Material);
    ctx.own((plate.material as THREE.MeshBasicMaterial).map!);
    plate.position.set(-4.2, 3.2, WALL_ZP - 0.12);
    plate.rotation.y = Math.PI;
    g.add(plate);
    if (kind === 'stop') {
      // the breaker cabinet, beside the door, red-lit
      slab(g, darkMat, 4.2, 1.2, WALL_ZP - 0.45, 1.4, 2.4, 0.8);
      slab(g, redMat, 4.2, 1.8, WALL_ZP - 0.87, 0.9, 0.35, 0.05);
      boxes.push(solid(4.2, Y0 + L + 1.2, WALL_ZP - 0.45, 1.4, 2.4, 0.8));
      breakerSpots.push(new THREE.Vector3(4.2, Y0, WALL_ZP - 1.8));
    }
    const item = mill.conveyor(g, {
      // twelve metres under the platform it is out of the fight
      behind: 12 + L,
      boxes,
      onPass: () => {
        // gone by, far below: whoever is still on it is out of the fight
        for (const e of land.guards) if (e.alive) e.removeMe = true;
        g.visible = false;
      },
    });
    const land: Landing = { L, n, item, group: g, kind, guards: [], posted: false, leapt: 0 };
    landings.push(land);
  }

  // ---- the top deck: the open deck the shaft comes out in ----
  // A ring of deck round the shaft's mouth, running out to the rails at its
  // edge, with the deck gate on the landing side: stage D's assembly deck is
  // through it. It arrives level with the platform at the end of the ride.
  const top = new THREE.Group();
  top.position.set(0, Y0 + TRAVEL, 0);
  ctx.mesh(top);
  const topBoxes: StaticBox[] = [];
  const topSlab = (cx: number, cz: number, sx: number, sz: number): void => {
    slab(top, topMat, cx, -0.5, cz, sx, 1, sz);
    topBoxes.push(solid(cx, Y0 + TRAVEL - 0.5, cz, sx, 1, sz));
  };
  const mX0 = WALL_XN - WALL_T, mX1 = WALL_XP + WALL_T, mZ0 = WALL_ZN - WALL_T, mZ1 = WALL_ZP + WALL_T;
  topSlab(0, (mZ1 + TOP_R) / 2, TOP_R * 2, TOP_R - mZ1);
  topSlab(0, (mZ0 - TOP_R) / 2, TOP_R * 2, TOP_R + mZ0);
  topSlab((mX1 + TOP_R) / 2, (mZ0 + mZ1) / 2, TOP_R - mX1, mZ1 - mZ0);
  topSlab((mX0 - TOP_R) / 2, (mZ0 + mZ1) / 2, TOP_R + mX0, mZ1 - mZ0);
  // the mouth's lit coaming, so the edge reads from below
  for (const [cx, cz, sx, sz] of [
    [midX, mZ0 + 0.3, mX1 - mX0, 0.6], [midX, mZ1 - 0.3, mX1 - mX0, 0.6],
    [mX0 + 0.3, midZ, 0.6, mZ1 - mZ0], [mX1 - 0.3, midZ, 0.6, mZ1 - mZ0],
  ] as const) slab(top, stripe, cx, 0.05, cz, sx, 0.1, sz);
  // the deck's rail round its edge, and the sea-facing parapet
  for (const [cx, cz, sx, sz] of [
    [0, TOP_R, TOP_R * 2, 0.3], [0, -TOP_R, TOP_R * 2, 0.3], [TOP_R, 0, 0.3, TOP_R * 2], [-TOP_R, 0, 0.3, TOP_R * 2],
  ] as const) {
    slab(top, railMat, cx, RAIL_H / 2, cz, sx, RAIL_H, sz);
    topBoxes.push(solid(cx, Y0 + TRAVEL + RAIL_H / 2, cz, sx, RAIL_H, sz));
  }
  // cover on the deck: cargo blocks and a crane's foot (the deck beyond the
  // superstructure's face is walled off by it)
  for (const [cx, cz, sx, sz, h] of [
    [-14, 8, 3, 2, 1.6], [13, 12, 2.4, 2.4, 2.2], [-9, 20, 4, 1.4, 1.3], [10, -16, 3, 3, 2.6], [-18, -12, 2, 5, 1.8],
  ] as const) {
    slab(top, darkMat, cx, h / 2, cz, sx, h, sz);
    topBoxes.push(solid(cx, Y0 + TRAVEL + h / 2, cz, sx, h, sz));
  }
  // the crane: a lattice mast and a jib over the sea, the top decks' landmark
  slab(top, railMat, 22, 9, -22, 1.4, 18, 1.4);
  slab(top, railMat, 14, 18, -22, 20, 1, 1);
  topBoxes.push(solid(22, Y0 + TRAVEL + 9, -22, 1.4, 18, 1.4));
  // The deck gate: the transport door onto the assembly deck, in the face of
  // the rig's superstructure, which closes the top deck's whole far side and
  // stands well over the deck — a door into a building, not a frame on a
  // deck. The doors stay shut until the squad holding it is down.
  const gateG = new THREE.Group();
  gateG.position.set(0, 0, GATE.z + 1);
  top.add(gateG);
  const faceH = 14, sideW = TOP_R - 3;
  slab(gateG, panelMat(sideW / 5, faceH / 5), -(3 + sideW / 2), faceH / 2, 1.5, sideW, faceH, 4);
  slab(gateG, panelMat(sideW / 5, faceH / 5), 3 + sideW / 2, faceH / 2, 1.5, sideW, faceH, 4);
  slab(gateG, panelMat(1.2, (faceH - 5) / 5), 0, 5 + (faceH - 5) / 2, 1.5, 6, faceH - 5, 4);
  slab(gateG, glowMat, 0, 5.6, -0.55, 6.4, 0.25, 0.1);
  // the superstructure's windows and a gantry along its face
  for (const x of [-22, -14, 14, 22]) slab(gateG, accentMat, x, 9, -0.52, 4, 1.2, 0.05);
  slab(gateG, railMat, 0, 7.5, -1.2, TOP_R * 2 - 2, 0.25, 1.6);
  topBoxes.push(solid(-(3 + sideW / 2), Y0 + TRAVEL + faceH / 2, GATE.z + 2.5, sideW, faceH, 4));
  topBoxes.push(solid(3 + sideW / 2, Y0 + TRAVEL + faceH / 2, GATE.z + 2.5, sideW, faceH, 4));
  const doorL = slab(gateG, darkMat, -1.5, 2.5, 0, 3, 5, 0.4);
  const doorR = slab(gateG, darkMat, 1.5, 2.5, 0, 3, 5, 0.4);
  const gateBox = solid(0, Y0 + TRAVEL + 2.5, GATE.z + 1, 6, 5, 0.4);
  const gateLamp = slab(gateG, redMat, 0, 5.2, -0.6, 1.2, 0.3, 0.1);
  // behind the doors: the lit way on (the transition card names it)
  slab(gateG, glowMat, 0, 2.5, 3.2, 5.8, 4.8, 0.2);
  topBoxes.push(gateBox);
  // the sea, far below the rig's top: a wide plane under the fog
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), ctx.paint(0x1d4a5e, { rough: 0.3, metal: 0.2 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -40;
  top.add(sea);
  ctx.own(sea.geometry);
  ctx.tile(sea.material as THREE.MeshStandardMaterial, 'sea_surface', 60, 60);
  const topItem = mill.conveyor(top, { behind: TRAVEL + 400, boxes: topBoxes });
  void topItem;

  // light: a lamp on the platform, a cold sky above the shaft
  const lamp = new THREE.PointLight(0xfff0d0, 30, 26, 1.4);
  lamp.position.set(0, Y0 + 7, 0);
  ctx.mesh(lamp);
  const sky = new THREE.PointLight(0xdfefff, 0, 80, 1.2);
  sky.position.set(0, Y0 + 30, 0);
  ctx.mesh(sky);

  // ================================================================ hazards
  // Debris: a chunk of shaft furniture, telegraphed by its shadow on the deck.
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
  ctx.own(shadowMat);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.4, 20), shadowMat);
  ctx.own(shadow.geometry);
  shadow.rotation.x = -Math.PI / 2;
  ctx.mesh(shadow);
  const debrisMesh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.6), darkMat);
  ctx.own(debrisMesh.geometry);
  debrisMesh.visible = false;
  ctx.mesh(debrisMesh);
  let debris: { at: THREE.Vector3; t: number } | null = null;
  let debrisT = 0;

  // ================================================================ the breakers
  const interactions = new Interactions();
  let stopIdx = -1;          // which power cut is on (index into STOPS), -1 for none
  const breakerDone = [false, false];
  const breakers = STOPS.map((_, i) => interactions.add({
    pos: breakerSpots[i].clone(), hold: party === 1 ? 3 : 4, radius: 2.6, verb: T.breakerVerb,
    enabled: () => phase === 'stopped' && stopIdx === i,
    onDone: () => {
      breakerDone[i] = true;
      ctx.announce(T.restart, T.restartSub);
      phase = 'restart';
      restartT = 1.2;
      boardT = BOARD_TIME + 1.2;
    },
  }));

  // ================================================================ state
  let phase: Phase = 'ready';
  let readyT = 3.5;
  let restartT = 0;
  let boardT = 0;
  let started = false;
  let complete = false;
  let gateOpen = false;
  let finale: Enemy[] = [];
  let finalePosted = false;
  let dropT = 0;
  const dropping: { e: Enemy; plume: boolean }[] = [];
  const leaping: { e: Enemy; from: THREE.Vector3; to: THREE.Vector3; t: number }[] = [];
  const hovering: Enemy[] = [];
  ctx.checkpoint.set(0, Y0, 0);
  const centre = new THREE.Vector3(0, Y0, 0);
  const cursors: number[] = [0, 0, 0, 0];

  /** the stage of the ride: 0 the first stretch, 1 after the first cut, 2 after the second */
  const stretch = (): number => (mill.travelled < STOPS[0] ? 0 : mill.travelled < STOPS[1] ? 1 : 2);
  const onPlatform = (p: THREE.Vector3): boolean =>
    Math.abs(p.x) <= PLAT + 0.3 && Math.abs(p.z) <= PLAT + 0.3 && Math.abs(p.y - Y0) < 2.2;
  const landingNow = (): Landing | null => {
    let best: Landing | null = null;
    for (const l of landings) {
      const dy = l.item.pos.y - Y0;
      if (Math.abs(dy) < 3 && (!best || Math.abs(dy) < Math.abs(best.item.pos.y - Y0))) best = l;
    }
    return best;
  };

  /** re-dress a hostile as a jet trooper: the jetpack pirate's kit, trooper plate */
  const trooperSkin = (e: Enemy): void => {
    const old = e.char;
    const inst = buildStormtrooper(false);
    game.scene.remove(old.root);
    inst.root.position.copy(e.position);
    e.char = inst;
    game.scene.add(inst.root);
  };

  const postGuards = (land: Landing): void => {
    land.posted = true;
    const s = stretch();
    const stop = land.kind === 'stop';
    const budget = stop
      ? Math.min(7, 2 + s + party)
      : Math.min(5, 1 + s + Math.floor(party / 2));
    const kinds = ctx.squadFor(ctx.wave + s, budget);
    const lz = PLAT + GAP + LAND_D / 2 + 0.4;
    kinds.forEach((kind, i) => {
      const x = -PLAT + ((i + 0.5) / kinds.length) * PLAT * 2;
      const at = new THREE.Vector3(x, land.item.pos.y + 0.05, lz + ((i % 2) - 0.5) * 1.2);
      const e = ctx.spawn(kind === 'jetpirate' || kind === 'darktrooper' ? 'stormtrooper' : kind, at, { exact: true, squad: 8840 + land.n });
      land.guards.push(e);
    });
  };

  /** jet troopers dropping onto the platform: they fall on their packs from the shaft above */
  const dropTroopers = (n: number, elite: boolean): void => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const at = new THREE.Vector3(Math.cos(a) * 3.5, Y0 + 16 + i * 2.5, Math.sin(a) * 3.5);
      const kind: EnemyKind = elite && i % 2 === 0 ? 'deathtrooper' : 'stormtrooper';
      const e = ctx.spawn(kind, at, { exact: true, alert: true, squad: 8870 });
      dropping.push({ e, plume: true });
    }
    ctx.announce(T.jumpers);
  };

  /** fliers that stay up: the last stretch's jet troopers, circling the shaft */
  const launchFliers = (n: number): void => {
    for (let i = 0; i < n; i++) {
      const at = new THREE.Vector3(WALL_XN + 3, Y0 + 12 + i * 3, -2 + i * 3);
      const e = ctx.spawn('jetpirate', at, { exact: true, alert: true, squad: 8880 });
      trooperSkin(e);
      hovering.push(e);
    }
  };

  const postFinale = (): void => {
    finalePosted = true;
    const kinds = ctx.squadFor(ctx.wave + 3, Math.min(8, 3 + party), { debut: true });
    const spots = [[-8, 18], [8, 18], [-3, 22], [3, 22], [-14, 14], [14, 14], [0, 24], [-6, 24]];
    kinds.forEach((kind, i) => {
      const [x, z] = spots[i % spots.length];
      const at = new THREE.Vector3(x, top.position.y + 0.05, z);
      finale.push(ctx.spawn(kind === 'jetpirate' ? 'deathtrooper' : kind, at, { exact: true, squad: 8890 }));
    });
    const officer = ctx.spawn('officer', new THREE.Vector3(0, top.position.y + 0.05, 22), { exact: true, squad: 8890 });
    finale.push(officer);
  };

  const beginStop = (i: number): void => {
    stopIdx = i;
    phase = 'stopping';
    mill.stopAt(STOPS[i]);
    ctx.announce(T.cut, T.cutSub);
  };

  const update = (dt: number): void => {
    if (complete) return;
    if (!started) {
      started = true;
      ctx.announce(T.title, T.sub);
      for (const p of game.players) {
        // face the open landing side: the first landing is the door behind them
        p.cam.yaw = 0;
        p.sectionMove = composeMoves({
          adjust: (pl, _dt, input) => interactions.swallow(pl.slot, pl.position, input),
        });
      }
      // a canister on the platform, one on each cut's landing
      ctx.pickup(new THREE.Vector3(-4, Y0, -4));
    }

    // ---- the ride's beats ----
    switch (phase) {
      case 'ready':
        readyT -= dt;
        if (readyT <= 0) { phase = 'ride'; mill.setSpeed(SPEED); }
        break;
      case 'ride': {
        const next = STOPS.findIndex((s, i) => !breakerDone[i] && mill.travelled < s);
        if (next >= 0 && STOPS[next] - mill.travelled <= SPEED * mill.ease / 2 + 0.05) beginStop(next);
        if (mill.travelled >= TRAVEL - SPEED * mill.ease / 2 - 0.05) {
          phase = 'arriving';
          mill.stopAt(TRAVEL);
          ctx.announce(T.breakout, T.breakoutSub);
        }
        break;
      }
      case 'stopping':
        if (mill.stopped) {
          phase = 'stopped';
          dropTroopers(1 + Math.ceil(party / 2) + stopIdx, stopIdx === 1);
          // a canister on the landing, by the door
          ctx.pickup(new THREE.Vector3(-3, Y0, PLAT + GAP + LAND_D / 2));
        }
        break;
      case 'restart':
        restartT -= dt;
        if (restartT <= 0 && mill.target === 0) mill.setSpeed(SPEED);
        if (restartT <= 0) phase = 'ride';
        break;
      case 'arriving':
        if (mill.stopped) phase = 'top';
        break;
      default:
        break;
    }
    // the five seconds to get back aboard, counted through the restart
    if (boardT > 0) {
      boardT -= dt;
      if (boardT <= 0) {
        for (const p of game.players) {
          if (!p.alive || onPlatform(p.position)) continue;
          const at = respawnSpot(p.slot);
          p.position.copy(at);
          p.velocity.set(0, 0, 0);
        }
      }
    }
    mill.update(dt);

    // ---- landings: post their squads before they come into view ----
    for (const land of landings) {
      if (land.kind === 'door' || land.posted) continue;
      if (land.item.pos.y - Y0 < 16) postGuards(land);
    }
    // alert them as they come level, and some jump across
    const now = landingNow();
    if (now && now.kind !== 'door') {
      for (const e of now.guards) if (e.alive && Math.abs(now.item.pos.y - Y0) < 9) e.alert(centre, true);
      const want = now.kind === 'stop' ? 0 : Math.min(1 + stretch(), 1 + Math.floor(party / 2));
      const dy = now.item.pos.y - Y0;
      if (now.leapt < want && Math.abs(dy) < 1.2 && mill.speed > 0.2) {
        const e = now.guards.find((g) => g.alive && !leaping.some((l) => l.e === g));
        if (e) {
          now.leapt++;
          const to = new THREE.Vector3((Math.random() - 0.5) * 6, Y0, 1 + Math.random() * 3);
          leaping.push({ e, from: e.position.clone(), to, t: 0 });
          now.guards = now.guards.filter((g) => g !== e);
        }
      }
    }
    for (const l of [...leaping]) {
      l.t += dt / 0.8;
      const k = Math.min(1, l.t);
      l.e.position.lerpVectors(l.from, l.to, k);
      l.e.position.y += Math.sin(k * Math.PI) * 2.6;
      l.e.velocity.set(0, 0, 0);
      if (k >= 1 || !l.e.alive) leaping.splice(leaping.indexOf(l), 1);
    }
    // the dropping jet troopers: a slow burn down on their packs
    for (const d of [...dropping]) {
      const e = d.e;
      if (!e.alive || e.position.y <= Y0 + 0.08) { dropping.splice(dropping.indexOf(d), 1); continue; }
      e.position.y = Math.max(Y0 + 0.05, e.position.y - 6 * dt);
      e.velocity.set(0, 0, 0);
      game.particles.jetPlume(e.position.clone().setY(e.position.y + 1.0), new THREE.Vector3(0, -1, 0), dt, { power: 1 });
    }
    // anything that went over the edge is out of the fight (the shaft is deep)
    for (const e of game.enemies) {
      if (e.alive && e.position.y < Y0 - 30 && !landings.some((l) => l.guards.includes(e))) e.removeMe = true;
    }

    // ---- from above: jet troopers in the rides between the cuts ----
    if (phase === 'ride' && mill.travelled > 20) {
      dropT -= dt;
      if (dropT <= 0) {
        const s = stretch();
        dropT = s === 0 ? 30 : s === 1 ? 18 : 13;
        dropTroopers(s === 0 ? 1 + (party > 2 ? 1 : 0) : s === 1 ? 1 + Math.floor(party / 2) : 2 + Math.floor(party / 3), s === 2);
        if (s === 2 && hovering.filter((h) => h.alive).length < 1 + Math.floor(party / 2)) launchFliers(1 + Math.floor(party / 2));
      }
    }
    // the finale squad takes the top before the lift gets there
    if (!finalePosted && top.position.y - Y0 < 30) postFinale();
    if (finalePosted && !gateOpen && phase === 'top' && finale.every((e) => !e.alive)) {
      gateOpen = true;
      ctx.unsolid({ box: gateBox });
      ctx.announce(T.gateOpen);
    }
    if (gateOpen) {
      doorL.position.x = Math.max(-4.4, doorL.position.x - dt * 3);
      doorR.position.x = Math.min(4.4, doorR.position.x + dt * 3);
      gateLamp.material = accentMat;
    }
    // the sky opens as the mouth comes down
    const toTop = top.position.y - Y0;
    fitGuides(top.position.y);
    sky.intensity = toTop < 60 ? (1 - toTop / 60) * 60 : 0;
    lamp.intensity = 30;

    // ---- debris, from the second stretch ----
    if (stretch() >= 1 && (phase === 'ride' || phase === 'stopped')) {
      debrisT -= dt;
      if (!debris && debrisT <= 0) {
        debrisT = stretch() === 2 ? 5 + Math.random() * 3 : 8 + Math.random() * 4;
        const living = game.players.filter((p) => p.alive && onPlatform(p.position));
        const aim = living.length ? living[Math.floor(Math.random() * living.length)].position : centre;
        debris = {
          at: new THREE.Vector3(
            THREE.MathUtils.clamp(aim.x + (Math.random() - 0.5) * 3, -PLAT + 1.5, PLAT - 1.5), Y0,
            THREE.MathUtils.clamp(aim.z + (Math.random() - 0.5) * 3, -PLAT + 1.5, PLAT - 1.5)),
          t: 0,
        };
        if (stretch() === 1 && debrisT > 8) ctx.announce(T.debris);
      }
    }
    if (debris) {
      const b = debris;
      b.t += dt;
      shadow.position.set(b.at.x, b.at.y + 0.04, b.at.z);
      shadowMat.opacity = Math.min(0.6, (b.t / DEBRIS_WARN) * 0.6);
      shadow.scale.setScalar(0.35 + Math.min(1, b.t / DEBRIS_WARN) * 0.65);
      if (b.t > DEBRIS_WARN - 0.4) {
        const k = Math.min(1, (b.t - (DEBRIS_WARN - 0.4)) / 0.4);
        debrisMesh.visible = true;
        debrisMesh.position.set(b.at.x, THREE.MathUtils.lerp(Y0 + 18, Y0 + 0.6, k * k), b.at.z);
        debrisMesh.rotation.z += dt * 3;
      }
      if (b.t >= DEBRIS_WARN) {
        for (const p of game.players) {
          if (p.alive && Math.abs(p.position.y - Y0) < 2.5
            && Math.hypot(p.position.x - b.at.x, p.position.z - b.at.z) < 2.6) p.damage(34, b.at, -1, { heavy: true });
        }
        for (const e of game.enemies) {
          if (e.alive && Math.abs(e.position.y - Y0) < 2.5
            && Math.hypot(e.position.x - b.at.x, e.position.z - b.at.z) < 2.6) e.damage(60, b.at, -1);
        }
        game.particles.dustPuff(b.at, 20);
        game.particles.impactSparks(b.at.clone().setY(Y0 + 0.3), 14);
        debris = null;
        debrisMesh.visible = false;
        shadowMat.opacity = 0;
      }
    }

    // ---- the breaker ----
    interactions.update(dt, game);
    pylonLight.material = phase === 'stopped' ? redMat : accentMat;

    // ---- the gate: through it is the top decks ----
    if (gateOpen) {
      for (const p of game.players) {
        if (p.alive && Math.hypot(p.position.x - GATE.x, p.position.z - (GATE.z - 1)) < 3.2) complete = true;
      }
    }
  };

  const objective = () => {
    if (phase === 'stopping' || phase === 'stopped') {
      const b = breakers[stopIdx].spec.pos;
      const lnd = landingNow();
      return { pos: new THREE.Vector3(b.x, lnd ? lnd.item.pos.y : Y0, b.z), label: T.breaker, hint: T.breakerHint, beacon: false };
    }
    if (phase === 'top') {
      return {
        pos: new THREE.Vector3(GATE.x, Y0, GATE.z - 1), label: T.gate,
        hint: gateOpen ? T.gateOpen : T.gateHint, beacon: gateOpen,
      };
    }
    // the shaft's mouth, above
    const mouth = Math.max(Y0 + 4, top.position.y);
    return {
      pos: new THREE.Vector3(0, mouth, GATE.z - 1), label: T.top,
      hint: T.ride(Math.max(0, Math.round(TRAVEL - mill.travelled))), beacon: false,
    };
  };

  const respawnSpot = (slot: number): THREE.Vector3 => {
    // always the platform: the lift is the checkpoint, and it only goes up
    return ctx.defaultRespawn(slot, new THREE.Vector3(0, Y0, -2), new THREE.Vector3(0, 0, 1));
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const bars: SectionBar[] = [{
      label: T.height, value: Math.min(1, mill.travelled / TRAVEL), tone: phase === 'stopped' ? 'danger' : 'info',
    }];
    const at = interactions.hudFor(p.position);
    if (at) bars.push({ label: at.bar.label, value: at.bar.value, tone: 'good' });
    let line = at ? at.line : `${Math.round(mill.travelled)} / ${TRAVEL} m`;
    if (boardT > 0 && !onPlatform(p.position)) line = T.aboard(Math.ceil(Math.max(0, boardT - 0.01)));
    return { bars, line };
  };

  // ================================================================ autopilot
  /** where this slot holds on the platform */
  const post = (slot: number): THREE.Vector3 =>
    new THREE.Vector3(((slot % 2) - 0.5) * 4, Y0, (Math.floor(slot / 2) - 0.5) * 4 - 0.5);

  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    cursors[slot] = 0;
    let goal: THREE.Vector3;
    let hold = false;
    if (phase === 'top') {
      goal = gateOpen ? new THREE.Vector3(GATE.x, Y0, GATE.z - 1) : new THREE.Vector3(0, Y0, 10);
    } else if (phase === 'stopped' && stopIdx >= 0) {
      const b = breakers[stopIdx];
      goal = b.spec.pos.clone();
      hold = b.inReach(p.position);
    } else if (phase === 'stopping') {
      goal = post(slot);
    } else goal = post(slot);
    const out: AutopilotInput = { shootHeld: true };
    if (hold) { out.interactHeld = true; return out; }
    const dx = goal.x - p.position.x, dz = goal.z - p.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.6) {
      out.yaw = Math.atan2(dx, dz);
      out.moveY = Math.min(1, dist / 2);
    } else {
      // holding the post: look at the nearest hostile
      let best: Enemy | null = null, bd = 30;
      for (const e of game.enemies) {
        if (!e.alive || e.team !== 1) continue;
        const d = e.position.distanceTo(p.position);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) out.yaw = Math.atan2(best.position.x - p.position.x, best.position.z - p.position.z);
    }
    // the gap between the platform and a landing: jump it, either way
    const edge = PLAT, lip = PLAT + GAP;
    const crossing = (p.position.z < lip && goal.z > lip) || (p.position.z > edge && goal.z < edge);
    const nearGap = p.position.z > edge - 1.6 && p.position.z < lip + 1.6;
    if (crossing && nearGap) {
      out.moveY = 1;
      out.jumpHeld = p.position.y < Y0 + 2.2;
      if (p.grounded) out.jumpPressed = true;
    }
    // on a landing that is leaving: up and back aboard
    if (!onPlatform(p.position) && goal.z < edge && p.position.y < Y0 + 1.5 && phase !== 'top') {
      out.jumpHeld = true;
      if (p.grounded) out.jumpPressed = true;
    }
    return out;
  };

  return {
    starts: [0, 1, 2, 3].map((i) => new THREE.Vector3(((i % 2) - 0.5) * 3, Y0, 3.5 - Math.floor(i / 2) * 2.5)),
    floorY: Y0,
    ceilingY: Y0 + 22,
    groundAt: (x, z) => (Math.abs(x) <= PLAT && Math.abs(z) <= PLAT) || phase === 'top' ? Y0 : Y0 - 1000,
    contains: (x, z) => phase === 'top'
      ? Math.abs(x) < TOP_R && Math.abs(z) < TOP_R
      : x > WALL_XN && x < WALL_XP && z > WALL_ZN && z < WALL_ZP,
    path: [
      new THREE.Vector3(0, Y0, 2), new THREE.Vector3(0, Y0, -1),
      new THREE.Vector3(0, Y0, 10), new THREE.Vector3(GATE.x, Y0, GATE.z - 1),
    ],
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    // over an open edge, or carried away on a landing after a restart
    offPath: (pos) => pos.y < Y0 - 8,
    hud,
    autopilot,
    dispose: () => {
      mill.dispose();
      for (const p of game.players) p.sectionMove = null;
    },
    debug: () => ({
      phase, travelled: +mill.travelled.toFixed(2), speed: +mill.speed.toFixed(3), stopIdx,
      breakers: breakerDone, gateOpen, finale: finale.filter((e) => e.alive).length,
      wallY: +shaft.position.y.toFixed(2), topY: +top.position.y.toFixed(2),
    }),
  };
}

/** a ribbed guide-rail texture: dark metal with a bright rib every repeat */
function makeRibTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a4148'; g.fillRect(0, 0, 16, 64);
  g.fillStyle = '#6c7680'; g.fillRect(0, 0, 16, 8);
  g.fillStyle = '#e0b030'; g.fillRect(0, 30, 16, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** the level's number on the wall beside a landing's door */
function numberPlate(n: number, label: string | null): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1c2228'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#e0b030'; g.fillRect(0, 0, 128, 6); g.fillRect(0, 58, 128, 6);
  g.fillStyle = '#e8f0f4';
  g.font = 'bold 40px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label ?? `L${String(n).padStart(2, '0')}`, 64, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({ map: tex });
  return new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), m);
}

export const theLift: SectionDef = {
  id: 'the-lift',
  build,
  // the shaft's own air: white and close, the sky only at the top
  world: { fogColor: 0xd6e2ea, fogNear: 24, fogFar: 130, fill: 1.5 },
};
