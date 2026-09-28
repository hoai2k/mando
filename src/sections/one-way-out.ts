import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import { Enemy, type EnemyKind } from '../enemies/enemy';
import type { StaticBox } from '../core/physics';
import { addBox, addSphere, buildBiped, mat, type CharacterInstance } from '../characters/builder';
import { Interactions, type Interactable } from './kit/interact';
import { composeMoves } from './kit/moves';

/**
 * One Way Out (docs/LEVEL_SECTIONS.md §2.17) — the Prison Rig, after the sea
 * (stage B), before the work floor (stage C).
 *
 * The sea stage's last beat is the swim up the moon pool shaft, and surfacing
 * is the transport: the party climbs out of the moon pool's opening in the
 * floor of the **cell blocks**. It is a white hall, 48 × 36 m under a 10 m
 * roof, whose floor is a grid of 4 m shock tiles; six cell blocks stand along
 * the side walls behind shutters, gantries run round three sides six metres
 * up with the guards on them, and at the far end is the **stair core**, which
 * climbs to the work floor where stage C begins.
 *
 * The verb is *leading a crowd over a live floor*:
 *
 * - **The grid.** The floor runs shock patterns — row sweeps, a checkerboard,
 *   a ring closing inward — and every step of a pattern flashes 1.5 s before
 *   it goes live. A live tile is heavy damage and a stagger. A control desk
 *   on each gantry runs one third of the floor; take a desk (get up there,
 *   hold Y) and that third goes dead for good.
 * - **The blocks.** Each block's release panel (hold Y, 2 s) opens its
 *   shutter and lets out four or five prisoners: allies on the escort AI,
 *   unarmed, punching, following whichever of you is nearest — so the path
 *   *you* walk over the grid is the path they walk. A guard who goes down
 *   drops his rifle, and the nearest prisoner with empty hands runs for it.
 * - **The stair core** opens once two desks are down (one, solo). Opening it
 *   is the climax: the guards' last squad comes down the stairs, and the
 *   whole floor that is still live overloads — faster patterns — while you
 *   bring the crowd across. The headcount at the stairs is the score; ten or
 *   more and they hold the stairwell behind you.
 *
 * No fail: whoever goes down re-forms beside a living player (or at the pool,
 * if nobody is standing). Prisoners who die are gone.
 */

/** the hall: x ∈ ±HX, z ∈ ±HZ */
const HX = 24;
const HZ = 18;
const ROOF = 10;
const TILE = 4;
const COLS = 12;
/** rows 1..8 are the grid; row 0 is the pool apron, which is never live */
const ROWS = 9;
const GANTRY_Y = 6;
const GANTRY_D = 3;
const RAIL_H = 1.1;
/** the gap in each gantry's rail where you come up to its desk */
const GAP_W = 4;
/** telegraph, live, and the rest between patterns (seconds, before the solo stretch) */
const TELE = 1.5;
const LIVE = 2.2;
const REST = 2.6;
/** one shock per beat while a tile is live */
const BEAT = 0.5;
/** the cell blocks: side (−1 west, +1 east) and z */
const BLOCKS: { side: number; z: number }[] = [
  { side: -1, z: -9 }, { side: -1, z: 0 }, { side: -1, z: 9 },
  { side: 1, z: -9 }, { side: 1, z: 0 }, { side: 1, z: 9 },
];
const BLOCK_W = 6;
const BLOCK_D = 6;
/** the stair core's mouth in the north wall */
const STAIR_W = 6;

type Side = 'west' | 'east' | 'north';
/** which third of the floor a column belongs to (the desk that runs it) */
const sideOf = (col: number): Side => (col < 4 ? 'west' : col >= 8 ? 'east' : 'north');
const tileX = (col: number): number => -HX + TILE * col + TILE / 2;
const tileZ = (row: number): number => -HZ + TILE * row + TILE / 2;
const colAt = (x: number): number => Math.floor((x + HX) / TILE);
const rowAt = (z: number): number => Math.floor((z + HZ) / TILE);

/** a pattern: a list of steps, each a test of which tiles go live */
type Pattern = { name: string; steps: ((c: number, r: number) => boolean)[] };
const PATTERNS: Pattern[] = [
  // a two-row band sweeping from the pool to the stairs
  { name: 'rows', steps: [0, 1, 2, 3].map((k) => (_c: number, r: number) => r === 1 + 2 * k || r === 2 + 2 * k) },
  // the checkerboard, flipping
  { name: 'checker', steps: [0, 1, 0, 1].map((k) => (c: number, r: number) => (c + r) % 2 === k) },
  // a ring closing in from the walls
  {
    name: 'ring', steps: [0, 1, 2, 3].map((k) => (c: number, r: number) =>
      Math.min(c, COLS - 1 - c, r - 1, ROWS - 1 - r) === k),
  },
  // column bands sweeping across, west to east
  { name: 'cols', steps: [0, 1, 2, 3, 4, 5].map((k) => (c: number) => c === 2 * k || c === 2 * k + 1) },
];

interface Block {
  side: number;
  z: number;
  open: boolean;
  shutter: { box: StaticBox; mesh: THREE.Mesh };
  panel: Interactable;
  lamp: THREE.Mesh;
  slide: number;
}

interface Desk {
  side: Side;
  pos: THREE.Vector3;
  taken: boolean;
  it: Interactable;
  screen: THREE.Mesh;
  /** where you step up onto the gantry: the gap in the rail */
  gap: THREE.Vector3;
}

interface Prisoner {
  e: Enemy; armed: boolean; going: THREE.Vector3 | null; n: number;
  /** seconds on a hot tile, the reaction before it scrambles, and the scramble's cooldown */
  onHot: number; react: number;
  /** the quiet spot it is scrambling to, if it is */
  flee: THREE.Vector3 | null;
  /** where it last stood on quiet floor, and whether that was last frame */
  last: THREE.Vector2; lastOk: boolean;
}

function build(ctx: SectionContext): SectionInstance {
  const { game, spec } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections['one-way-out'];
  const party = Math.max(1, game.players.length);
  const solo = party === 1;
  const need = solo ? 1 : 2;
  const pace = solo ? 1.35 : 1;

  // ---- materials ----
  const wallMat = ctx.paint(spec.palette.wall, { rough: 0.7, metal: 0.15 });
  ctx.tile(wallMat, 'panel_white', 8, 2);
  const floorMat = ctx.paint(0xdfe6ea, { rough: 0.5, metal: 0.2 });
  const gridTex = makeGridTexture();
  ctx.own(gridTex);
  gridTex.repeat.set(COLS, ROWS);
  floorMat.map = gridTex;
  ctx.tile(floorMat, 'shock_tile', COLS, ROWS);
  const apronMat = ctx.paint(0x9aa6ae, { rough: 0.6, metal: 0.3 });
  ctx.tile(apronMat, 'metal_deck', 6, 1);
  const steelMat = ctx.paint(0x4d565e, { rough: 0.5, metal: 0.6 });
  const gantryMat = ctx.paint(0x6a747c, { rough: 0.5, metal: 0.6 });
  ctx.tile(gantryMat, 'metal_deck', 10, 1);
  const railMat = ctx.paint(0x3a8ab0, { rough: 0.5, metal: 0.5 });
  const shutterMat = ctx.paint(0x8a949c, { rough: 0.45, metal: 0.7 });
  const cellMat = ctx.paint(0x9aa4aa, { rough: 0.8 });
  const glow = (color: number): THREE.MeshBasicMaterial => ctx.own(new THREE.MeshBasicMaterial({ color }));
  const lampRed = glow(0xff4a3a), lampGreen = glow(0x5aff9a), lampBlue = glow(spec.palette.accent), lampWarm = glow(0xfff0d0);
  const unit = ctx.own(new THREE.BoxGeometry(1, 1, 1));
  const deco = (m: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(unit, m);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(cx, cy, cz);
    ctx.mesh(mesh);
    return mesh;
  };

  // ================================================================ the hall
  // The floor, round the moon pool's opening at the south end.
  const POOL_W = 6, POOL_Z0 = -HZ + 0.8, POOL_Z1 = -HZ + 3.4;
  const slabT = 1;
  const fy = Y0 - slabT / 2;
  // the grid proper (rows 1..8)
  ctx.box(0, fy, (-HZ + TILE + HZ) / 2, HX * 2, slabT, HZ * 2 - TILE, floorMat);
  // the apron (row 0), cut round the pool
  const aw = (HX * 2 - POOL_W) / 2;
  ctx.box(-(POOL_W / 2 + aw / 2), fy, -HZ + TILE / 2, aw, slabT, TILE, apronMat);
  ctx.box(POOL_W / 2 + aw / 2, fy, -HZ + TILE / 2, aw, slabT, TILE, apronMat);
  ctx.box(0, fy, (POOL_Z1 - HZ + TILE) / 2 + 0.0, POOL_W, slabT, -HZ + TILE - POOL_Z1, apronMat);
  ctx.box(0, fy, (-HZ + POOL_Z0) / 2, POOL_W, slabT, POOL_Z0 + HZ, apronMat);
  // the pool: a shaft of dark water, the way the party came up
  const poolD = 6;
  for (const sx of [-1, 1]) ctx.box(sx * (POOL_W / 2 + 0.25), Y0 - poolD / 2, (POOL_Z0 + POOL_Z1) / 2, 0.5, poolD, POOL_Z1 - POOL_Z0, steelMat);
  ctx.box(0, Y0 - poolD / 2, POOL_Z0 - 0.25, POOL_W, poolD, 0.5, steelMat);
  ctx.box(0, Y0 - poolD / 2, POOL_Z1 + 0.25, POOL_W, poolD, 0.5, steelMat);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(POOL_W, POOL_Z1 - POOL_Z0),
    ctx.own(new THREE.MeshStandardMaterial({ color: 0x0e3a4a, roughness: 0.15, metalness: 0.3, emissive: 0x06303c, emissiveIntensity: 0.6 })));
  ctx.own(water.geometry);
  ctx.tile(water.material as THREE.MeshStandardMaterial, 'sea_surface', 1, 1, { normal: true });
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, Y0 - 0.7, (POOL_Z0 + POOL_Z1) / 2);
  ctx.mesh(water);
  // the pool's rim: hazard coaming and a ladder out on its north side
  for (const [cx, cz, sx, sz] of [
    [0, POOL_Z0 - 0.1, POOL_W + 1, 0.2], [0, POOL_Z1 + 0.1, POOL_W + 1, 0.2],
    [-POOL_W / 2 - 0.1, (POOL_Z0 + POOL_Z1) / 2, 0.2, POOL_Z1 - POOL_Z0], [POOL_W / 2 + 0.1, (POOL_Z0 + POOL_Z1) / 2, 0.2, POOL_Z1 - POOL_Z0],
  ] as const) deco(lampBlue, cx, Y0 + 0.03, cz, sx, 0.06, sz);
  for (const lx of [-1.2, 1.2]) {
    deco(steelMat, lx, Y0 + 0.4, POOL_Z1 - 0.1, 0.08, 1.8, 0.08);
    for (let k = 0; k < 4; k++) deco(steelMat, 0, Y0 - 1 + k * 0.45, POOL_Z1 - 0.1, 2.4, 0.06, 0.06);
  }

  // the walls: south solid, north round the stair core, east and west round the blocks
  const wallT = 1;
  const wy = Y0 + ROOF / 2;
  ctx.box(0, wy, -HZ - wallT / 2, HX * 2 + 2, ROOF, wallT, wallMat);
  const nW = HX - STAIR_W / 2;
  ctx.box(-(STAIR_W / 2 + nW / 2), wy, HZ + wallT / 2, nW, ROOF, wallT, wallMat);
  ctx.box(STAIR_W / 2 + nW / 2, wy, HZ + wallT / 2, nW, ROOF, wallT, wallMat);
  ctx.box(0, Y0 + 5 + (ROOF - 5) / 2, HZ + wallT / 2, STAIR_W, ROOF - 5, wallT, wallMat);
  for (const side of [-1, 1]) {
    const x = side * (HX + wallT / 2);
    // wall segments between and round the block openings
    const edges = [-HZ, ...BLOCKS.filter((b) => b.side === side).flatMap((b) => [b.z - BLOCK_W / 2, b.z + BLOCK_W / 2]), HZ];
    for (let k = 0; k < edges.length; k += 2) {
      const z0 = edges[k], z1 = edges[k + 1];
      ctx.box(x, wy, (z0 + z1) / 2, wallT, ROOF, z1 - z0, wallMat);
    }
    // over each opening, to the roof
    for (const b of BLOCKS.filter((bb) => bb.side === side)) ctx.box(x, Y0 + 4 + (ROOF - 4) / 2, b.z, wallT, ROOF - 4, BLOCK_W, wallMat);
  }
  // the roof, and its light strips
  ctx.box(0, Y0 + ROOF + 0.5, 0, HX * 2 + 2, 1, HZ * 2 + 2, wallMat);
  for (const z of [-12, -4, 4, 12]) deco(lampWarm, 0, Y0 + ROOF - 0.05, z, HX * 1.4, 0.08, 0.5);
  const lights: THREE.PointLight[] = [];
  for (const [x, z] of [[-10, -8], [10, -8], [-10, 8], [10, 8]] as const) {
    const l = new THREE.PointLight(0xf2f6ff, 22, 34, 1.3);
    l.position.set(x, Y0 + ROOF - 1, z);
    ctx.mesh(l);
    lights.push(l);
  }

  // ================================================================ the cell blocks
  const blocks: Block[] = [];
  const interactions = new Interactions();
  BLOCKS.forEach((b, bi) => {
    const x0 = b.side * HX;
    const xIn = b.side * (HX + BLOCK_D);
    // the cell: floor, back wall, side walls, low roof, bunks
    ctx.box((x0 + xIn) / 2, fy, b.z, BLOCK_D + 1, slabT, BLOCK_W, cellMat);
    ctx.box(xIn + b.side * 0.5, Y0 + 2.5, b.z, 1, 5, BLOCK_W + 2, wallMat);
    for (const sz of [-1, 1]) ctx.box((x0 + xIn) / 2 + b.side * 0.5, Y0 + 2.5, b.z + sz * (BLOCK_W / 2 + 0.5), BLOCK_D + 1, 5, 1, wallMat);
    ctx.box((x0 + xIn) / 2 + b.side * 0.5, Y0 + 4.5, b.z, BLOCK_D + 1, 1, BLOCK_W, wallMat);
    for (const bz of [-2, 2]) deco(steelMat, xIn - b.side * 0.8, Y0 + 0.9, b.z + bz, 1.4, 0.15, 1.8);
    const cellLight = new THREE.PointLight(0xffe0b0, 6, 9, 1.5);
    cellLight.position.set((x0 + xIn) / 2, Y0 + 3.4, b.z);
    ctx.mesh(cellLight);
    // the shutter: a barred slab across the opening
    const { box, mesh } = ctx.box(x0 + b.side * 0.1, Y0 + 2, b.z, 0.3, 4, BLOCK_W, shutterMat);
    for (let k = -2; k <= 2; k++) deco(steelMat, x0 - b.side * 0.1, Y0 + 2, b.z + k * 1.1, 0.12, 3.8, 0.12);
    // the block's number over the door, and its state lamp
    const plate = numberPlate(`B${bi + 1}`);
    ctx.own(plate.material as THREE.Material);
    ctx.own((plate.material as THREE.MeshBasicMaterial).map!);
    plate.position.set(x0 - b.side * 0.55, Y0 + 4.6, b.z);
    plate.rotation.y = -b.side * Math.PI / 2;
    ctx.mesh(plate);
    const panelAt = new THREE.Vector3(x0 - b.side * 1.1, Y0, b.z + BLOCK_W / 2 + 0.9);
    const post = deco(steelMat, x0 - b.side * 0.35, Y0 + 0.8, panelAt.z, 0.5, 1.6, 0.8);
    void post;
    const lamp = deco(lampRed, x0 - b.side * 0.62, Y0 + 1.35, panelAt.z, 0.06, 0.35, 0.5);
    const block: Block = {
      side: b.side, z: b.z, open: false, shutter: { box, mesh: mesh! }, lamp, slide: 0,
      panel: interactions.add({
        pos: panelAt, hold: 2, radius: 2.2, verb: T.blockVerb,
        onDone: () => openBlock(block),
      }),
    };
    blocks.push(block);
  });

  // ================================================================ the gantries
  const gy = Y0 + GANTRY_Y;
  const desks: Desk[] = [];
  const gantry = (cx: number, cz: number, sx: number, sz: number): void => {
    ctx.box(cx, gy - 0.25, cz, sx, 0.5, sz, gantryMat);
    deco(lampBlue, cx, gy - 0.52, cz, sx * 0.96, 0.04, sz * 0.2);
  };
  const W_X = -HX + GANTRY_D / 2, E_X = HX - GANTRY_D / 2, N_Z = HZ - GANTRY_D / 2;
  gantry(W_X, 0, GANTRY_D, HZ * 2);
  gantry(E_X, 0, GANTRY_D, HZ * 2);
  gantry(0, N_Z, HX * 2 - GANTRY_D * 2, GANTRY_D);
  // struts down to the floor
  for (const z of [-15, -4.5, 4.5, 15]) for (const sx of [-1, 1]) ctx.box(sx * (HX - GANTRY_D + 0.3), Y0 + GANTRY_Y / 2, z, 0.4, GANTRY_Y - 0.5, 0.4, steelMat);
  for (const x of [-12, 12]) ctx.box(x, Y0 + GANTRY_Y / 2, HZ - GANTRY_D + 0.3, 0.4, GANTRY_Y - 0.5, 0.4, steelMat);
  // the rails, with a lit gap in front of each desk
  const rail = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.2) return;
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    ctx.box((x0 + x1) / 2, gy + RAIL_H / 2, (z0 + z1) / 2, along ? len : 0.12, RAIL_H, along ? 0.12 : len, railMat);
  };
  const deskSpots: { side: Side; pos: THREE.Vector3; gap: THREE.Vector3; face: number }[] = [
    { side: 'west', pos: new THREE.Vector3(-HX + 1.2, gy, 3), gap: new THREE.Vector3(-HX + GANTRY_D, gy, 3), face: 1 },
    { side: 'east', pos: new THREE.Vector3(HX - 1.2, gy, -3), gap: new THREE.Vector3(HX - GANTRY_D, gy, -3), face: -1 },
    { side: 'north', pos: new THREE.Vector3(10, gy, HZ - 1.2), gap: new THREE.Vector3(10, gy, HZ - GANTRY_D), face: 0 },
  ];
  const wIn = -HX + GANTRY_D, eIn = HX - GANTRY_D, nIn = HZ - GANTRY_D;
  rail(wIn, -HZ, wIn, 3 - GAP_W / 2); rail(wIn, 3 + GAP_W / 2, wIn, nIn);
  rail(eIn, -HZ, eIn, -3 - GAP_W / 2); rail(eIn, -3 + GAP_W / 2, eIn, nIn);
  rail(wIn, nIn, 10 - GAP_W / 2, nIn); rail(10 + GAP_W / 2, nIn, eIn, nIn);
  for (const d of deskSpots) {
    // the gap's lit sill, so the way up reads from the floor
    const along = d.side === 'north';
    deco(lampGreen, d.gap.x, gy + 0.03, d.gap.z, along ? GAP_W : 0.3, 0.06, along ? 0.3 : GAP_W);
    // the desk: a console with a screen facing into the hall
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), lampRed);
    ctx.own(screen.geometry);
    const holder = ctx.prop('alarm_console', d.pos, {
      size: 2.2, yaw: d.side === 'north' ? Math.PI : d.face > 0 ? Math.PI / 2 : -Math.PI / 2,
      fallback: () => {
        const g = new THREE.Group();
        const body = new THREE.Mesh(unit, steelMat);
        body.scale.set(1.8, 1.1, 0.8);
        body.position.y = 0.55;
        g.add(body);
        screen.position.set(0, 1.35, 0.1);
        screen.rotation.x = -0.35;
        g.add(screen);
        return g;
      },
      solid: { r: 0.8, h: 1.2 },
    });
    void holder;
    const standAt = d.side === 'north'
      ? new THREE.Vector3(d.pos.x, gy, d.pos.z - 1.4)
      : new THREE.Vector3(d.pos.x + d.face * 1.4, gy, d.pos.z);
    const desk: Desk = {
      side: d.side, pos: standAt, taken: false, screen, gap: d.gap,
      it: interactions.add({
        pos: standAt, hold: solo ? 3.5 : 4.5, radius: 2.2, verb: T.deskVerb,
        // fight up to it: nobody takes a desk its gantry's guards still hold
        enabled: () => !deskHeld(desk),
        onDone: () => takeDesk(desk),
      }),
    };
    desks.push(desk);
  }

  // ================================================================ the stair core
  // A white stairwell behind the north wall, climbing north out of sight to
  // the work floor. Its shutter lifts when enough desks are down.
  const coreZ0 = HZ + wallT, coreLen = 14;
  // the core's floor, from the doorway in the wall to the first step
  ctx.box(0, fy, (HZ + coreZ0 + 4) / 2, STAIR_W + 2, slabT, coreZ0 + 4 - HZ, apronMat);
  for (const sx of [-1, 1]) ctx.box(sx * (STAIR_W / 2 + 0.5), Y0 + 6, coreZ0 + coreLen / 2, 1, 14, coreLen, wallMat);
  ctx.box(0, Y0 + 6, coreZ0 + coreLen + 0.5, STAIR_W + 2, 14, 1, wallMat);
  const steps = 14;
  for (let k = 0; k < steps; k++) {
    const h = (k + 1) * 0.5;
    ctx.box(0, Y0 + h / 2, coreZ0 + 4 + k * 0.7 + 0.35, STAIR_W, h, 0.7, apronMat);
  }
  deco(lampWarm, 0, Y0 + 9.5, coreZ0 + 8, 3, 0.1, 6);
  const coreLight = new THREE.PointLight(0xfff4e0, 16, 20, 1.4);
  coreLight.position.set(0, Y0 + 5, coreZ0 + 6);
  ctx.mesh(coreLight);
  const stairShutter = ctx.box(0, Y0 + 2.5, HZ + 0.2, STAIR_W, 5, 0.4, shutterMat);
  const stairLamp = deco(lampRed, 0, Y0 + 5.3, HZ - 0.1, 2.4, 0.3, 0.1);
  // the door's frame: lit jambs and a sign, the brightest thing at the far end
  for (const sx of [-1, 1]) deco(lampWarm, sx * (STAIR_W / 2 + 0.15), Y0 + 2.6, HZ - 0.08, 0.25, 5.2, 0.1);
  deco(lampWarm, 0, Y0 + 5.05, HZ - 0.08, STAIR_W + 0.55, 0.2, 0.1);
  const stairSign = numberPlate('STAIRS ↑');
  ctx.own(stairSign.material as THREE.Material);
  ctx.own((stairSign.material as THREE.MeshBasicMaterial).map!);
  stairSign.scale.set(1.6, 1.6, 1);
  stairSign.position.set(0, Y0 + 6.2, HZ - 0.06);
  stairSign.rotation.y = Math.PI;
  ctx.mesh(stairSign);
  let stairOpen = false;
  /** the squad that comes down the stairs when they open: the way out counts once it is down */
  const stairSquad: Enemy[] = [];
  let stairSlide = 0;
  const stairMouth = new THREE.Vector3(0, Y0, HZ - 1.5);

  // ================================================================ the grid
  // One overlay per floor tile, instanced. Off, it is hidden and the white
  // panel shows; charging, the panel pulses a warning blue; live, it goes
  // dark as glass under the arcs — the floor opening up, as in the keyframe.
  const nTiles = COLS * (ROWS - 1);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  ctx.own(glowMat);
  const tileGeo = ctx.own(new THREE.PlaneGeometry(TILE - 0.25, TILE - 0.25));
  const tiles = new THREE.InstancedMesh(tileGeo, glowMat, nTiles);
  tiles.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const tileIndex = (c: number, r: number): number => (r - 1) * COLS + c;
  const showTile = (c: number, r: number, on: boolean): void => {
    const k = on ? 1 : 0;
    m4.compose(new THREE.Vector3(tileX(c), Y0 + 0.03, tileZ(r)), q, new THREE.Vector3(k, k, k));
    tiles.setMatrixAt(tileIndex(c, r), m4);
  };
  const shown = new Uint8Array(COLS * (ROWS - 1));
  for (let r = 1; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    showTile(c, r, false);
    tiles.setColorAt(tileIndex(c, r), new THREE.Color(0));
  }
  ctx.mesh(tiles);
  // the arcs over live tiles: jagged segments re-struck on the flicker
  const MAX_ARCS = 480;
  const arcPos = new Float32Array(MAX_ARCS * 2 * 3);
  const arcGeo = ctx.own(new THREE.BufferGeometry());
  arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
  const arcMat = ctx.own(new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }));
  const arcs = new THREE.LineSegments(arcGeo, arcMat);
  arcs.frustumCulled = false;
  ctx.mesh(arcs);

  /** tile state: 0 off, 1 charging, 2 live */
  const state = new Uint8Array(nTiles);
  const dead: Record<Side, boolean> = { west: false, east: false, north: false };
  let patternIdx = 0, stepIdx = 0, gridT = 0;
  let resting = true;
  let overload = false;
  const gridPhase = (): 'rest' | 'tele' | 'live' => (resting ? 'rest' : gridT < TELE * pace ? 'tele' : 'live');
  const stepFn = (): ((c: number, r: number) => boolean) => PATTERNS[patternIdx].steps[stepIdx];
  const advanceGrid = (dt: number): void => {
    const speed = overload ? 1.25 : 1;
    gridT += dt * speed;
    if (resting) {
      if (gridT >= REST * pace) { resting = false; gridT = 0; stepIdx = 0; }
      return;
    }
    if (gridT >= (TELE + LIVE) * pace) {
      gridT = 0;
      stepIdx++;
      if (stepIdx >= PATTERNS[patternIdx].steps.length) {
        // the ring and the columns only join once a block is open: the start is gentler
        const pool = blocks.some((b) => b.open) ? PATTERNS.length : 2;
        patternIdx = (patternIdx + 1) % pool;
        resting = true;
      }
    }
  };
  const tileLive = (c: number, r: number): boolean => r >= 1 && r < ROWS && c >= 0 && c < COLS && state[tileIndex(c, r)] === 2;
  const tileHot = (c: number, r: number): boolean => r >= 1 && r < ROWS && c >= 0 && c < COLS && state[tileIndex(c, r)] >= 1;
  /** is a body standing on a live tile (feet on the floor, not on a gantry or in the air)? */
  const onLive = (p: THREE.Vector3): boolean =>
    Math.abs(p.x) < HX && Math.abs(p.z) < HZ && p.y < Y0 + 1.1 && p.y > Y0 - 0.6 && tileLive(colAt(p.x), rowAt(p.z));

  // ================================================================ state
  let started = false;
  let complete = false;
  let beatT = 0;
  let allyShock = 0;
  let arcT = 0;
  let released = 0;
  let broughtOut = 0;
  let deskCount = 0;
  let armedNote = false;
  const prisoners: Prisoner[] = [];
  const guards: Enemy[] = [];
  const dropped = new Set<Enemy>();
  const rifles: { at: THREE.Vector3; mesh: THREE.Object3D; claimed: Prisoner | null }[] = [];
  const cursors: number[] = [0, 0, 0, 0];
  ctx.checkpoint.set(0, Y0, POOL_Z1 + 1.5);
  let prisonerNo = 1100 + Math.floor(Math.random() * 800);

  const aliveCount = (): number => prisoners.filter((p) => p.e.alive).length;

  function openBlock(b: Block): void {
    if (b.open) return;
    b.open = true;
    ctx.unsolid({ box: b.shutter.box });
    b.lamp.material = lampGreen;
    const n = party <= 2 ? 4 + (Math.random() < 0.5 ? 1 : 0) : 5;
    for (let i = 0; i < n; i++) {
      const at = new THREE.Vector3(b.side * (HX + 1.5 + (i % 3) * 1.3), Y0 + 0.2, b.z - 2 + Math.floor(i / 3) * 2.4 + (i % 2) * 0.4);
      const e = makePrisoner(at, prisonerNo++);
      game.addAlly(e, 6);
      prisoners.push({ e, armed: false, going: null, n: prisonerNo, onHot: 0, react: 0.35 + Math.random() * 0.8, flee: null, last: new THREE.Vector2(at.x, at.z), lastOk: false });
    }
    if (released === 0) pressureT = 14;
    released += n;
    ctx.announce(T.blockOpen(n), T.blockOpenSub);
    // a block opening is noise: the guards on that side turn on it
    for (const g of guards) if (g.alive) g.alert(new THREE.Vector3(b.side * HX, Y0, b.z), true);
  }

  function takeDesk(d: Desk): void {
    if (d.taken) return;
    d.taken = true;
    dead[d.side] = true;
    deskCount++;
    d.screen.material = lampGreen;
    ctx.announce(T.deskTaken, T.deskTakenSub(T.sides[d.side]));
    ctx.checkpoint.copy(d.pos);
    if (!stairOpen && deskCount >= need) openStairs();
    else reinforce(d.side);
  }

  /**
   * The gantry doors the guards come in by: two in the south wall at the ends
   * of the side gantries, two in the north wall at the ends of the north one.
   */
  const doors = [
    new THREE.Vector3(W_X, gy, -HZ + 1.6), new THREE.Vector3(E_X, gy, -HZ + 1.6),
    new THREE.Vector3(-HX + 6, gy, N_Z), new THREE.Vector3(HX - 6, gy, N_Z),
  ];
  for (const d of doors) {
    const north = d.z > 0;
    const wz = north ? HZ - 0.06 : -HZ + 0.06;
    deco(steelMat, d.x, gy + 1.5, wz, 2.4, 3, 0.1);
    deco(lampRed, d.x, gy + 3.2, wz, 1.2, 0.2, 0.12);
  }
  const guardsAlive = (): number => guards.filter((g) => g.alive).length;
  /** the posted guards still standing near a desk on its gantry */
  function deskHeld(d: Desk): boolean {
    return guards.some((g) => g.alive && Math.abs(g.position.y - gy) < 1.5 && g.position.distanceTo(d.pos) < 11);
  }
  const stairHeld = (): boolean => stairSquad.some((g) => g.alive);
  /** `n` guards through the door furthest from the party */
  function reinforceAt(n: number, extraWave: number, squad: number): void {
    if (n <= 0) return;
    let door = doors[0], far = -1;
    for (const d of doors) {
      let near = Infinity;
      for (const p of game.players) if (p.alive) near = Math.min(near, p.position.distanceTo(d));
      if (near > far) { far = near; door = d; }
    }
    const kinds = ctx.squadFor(ctx.wave + extraWave, n);
    const along = door.z > 0 ? new THREE.Vector3(door.x < 0 ? 1.6 : -1.6, 0, 0) : new THREE.Vector3(0, 0, 1.6);
    kinds.forEach((k, i) => {
      guards.push(ctx.spawn(groundKind(k), door.clone().addScaledVector(along, i), { exact: true, alert: true, squad }));
    });
  }
  /** a desk taken: the rig answers with a squad */
  function reinforce(_side: Side): void {
    reinforceAt(Math.min(5, 1 + deskCount + Math.floor(party / 2)), deskCount, 8850 + deskCount);
  }
  /**
   * The riot's pressure: once the first block is open, guards keep coming
   * through the doors, sooner and more of them the bigger the crowd gets —
   * the headcount is what the rig is reacting to. It stops when the stairs
   * open (the last squad is the one on the stairs).
   */
  let pressureT = 0;
  let pressureWave = 0;
  const pressure = (dt: number): void => {
    if (stairOpen || released === 0) return;
    pressureT -= dt;
    if (pressureT > 0) return;
    const n = aliveCount();
    pressureT = Math.max(12, 24 - n * 0.6) * (solo ? 1.25 : 1);
    if (guardsAlive() >= 4 + party * 2) return;
    pressureWave++;
    reinforceAt(Math.min(5, 1 + Math.floor(n / 7) + Math.floor(party / 2)), Math.min(3, Math.floor(pressureWave / 2)), 8860 + pressureWave);
  };

  function openStairs(): void {
    stairOpen = true;
    ctx.unsolid({ box: stairShutter.box });
    stairLamp.material = lampGreen;
    overload = true;
    ctx.announce(T.stairOpened, T.stairOpenedSub);
    ctx.checkpoint.copy(stairMouth);
    // the guards' last squad comes down the stairs
    const kinds = ctx.squadFor(ctx.wave + 2, Math.min(5, 1 + party), { debut: true });
    kinds.forEach((k, i) => {
      const at = new THREE.Vector3(((i % 3) - 1) * 1.6, Y0 + 0.2, coreZ0 + 1.5 + Math.floor(i / 3) * 1.2);
      stairSquad.push(ctx.spawn(groundKind(k) === 'stormtrooper' && i % 3 === 0 ? 'deathtrooper' : groundKind(k), at, { exact: true, alert: true, squad: 8859 }));
    });
    stairSquad.push(ctx.spawn('officer', new THREE.Vector3(0, Y0 + 0.2, coreZ0 + 3.5), { exact: true, alert: true, squad: 8859 }));
    guards.push(...stairSquad);
  }

  /** the posted guards: on the gantries, a deathtrooper by the north desk */
  const postGuards = (): void => {
    const per = 1 + Math.ceil(party / 2);
    const kinds = ctx.squadFor(ctx.wave, per * 3);
    const spots: THREE.Vector3[] = [];
    for (let i = 0; i < per; i++) {
      spots.push(new THREE.Vector3(W_X, gy, -10 + i * 7));
      spots.push(new THREE.Vector3(E_X, gy, 10 - i * 7));
      spots.push(new THREE.Vector3(-8 + i * 7, gy, N_Z));
    }
    kinds.forEach((k, i) => guards.push(ctx.spawn(groundKind(k), spots[i % spots.length], { exact: true, squad: 8845 })));
    guards.push(ctx.spawn('deathtrooper', new THREE.Vector3(14, gy, N_Z), { exact: true, squad: 8845 }));
    // and two on the floor by the first blocks
    for (const z of [-6, 4]) guards.push(ctx.spawn(solo && z > 0 ? 'stormtrooper' : 'stormtrooper', new THREE.Vector3(z < 0 ? -12 : 12, Y0, z), { exact: true, squad: 8846 }));
  };

  // ---- a dropped rifle, and who goes for it ----
  const rifleMesh = (): THREE.Group => {
    const g = new THREE.Group();
    addBox(g, mat(0x2a2a2a, { rough: 0.5, metal: 0.5 }), 0.07, 0.1, 0.62, 0, 0, 0);
    addBox(g, mat(0x2a2a2a, { rough: 0.5, metal: 0.5 }), 0.03, 0.03, 0.4, 0, 0.02, 0.45);
    return g;
  };
  const dropRifle = (at: THREE.Vector3): void => {
    const pos = new THREE.Vector3(at.x, Y0 + 0.06, at.z);
    // a guard shot off a gantry drops it to the floor below, inside the hall
    pos.x = THREE.MathUtils.clamp(pos.x, -HX + 1, HX - 1);
    pos.z = THREE.MathUtils.clamp(pos.z, -HZ + 1, HZ - 1);
    const mesh = rifleMesh();
    mesh.position.copy(pos);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    ctx.mesh(mesh);
    rifles.push({ at: pos, mesh, claimed: null });
  };
  const arm = (pr: Prisoner): void => {
    pr.armed = true;
    pr.going = null;
    pr.e.owner = null;
    pr.e.def = { ...pr.e.def, style: 'ranged', damage: 7, attackRange: 26, attackCd: 2.2, boltSpeed: 27, volley: 2 };
    const rig = pr.e.char.rig;
    if (rig) {
      const g = rifleMesh();
      g.rotation.x = Math.PI / 2;
      rig.bones.weaponR.add(g);
      const muzzle = new THREE.Group();
      muzzle.position.set(0, 0.02, 0.62);
      g.add(muzzle);
      pr.e.char.muzzle = muzzle;
    }
    if (!armedNote) { armedNote = true; ctx.announce(T.armed); }
  };

  /** the crowd and the floor: see the comment inside */
  const herd = (dt: number): void => {
    // A prisoner on a charging or live tile scrambles for the nearest quiet
    // one — after a moment's reaction, so the path you lead the crowd along
    // still decides who gets hurt. While it scrambles its own steering is
    // held off (a stagger), or the escort AI would walk it straight back onto
    // the tile under the player it follows.
    for (const pr of prisoners) {
      const e = pr.e;
      const onFloor = e.alive && e.position.y < Y0 + 1.1 && Math.abs(e.position.x) < HX && Math.abs(e.position.z) < HZ;
      const hot = onFloor && tileHot(colAt(e.position.x), rowAt(e.position.z));
      if (pr.flee) {
        const dx = pr.flee.x - e.position.x, dz = pr.flee.z - e.position.z;
        const d = Math.hypot(dx, dz);
        if (!e.alive || d < 0.6 || (!hot && d < 2.2) || tileHot(colAt(pr.flee.x), rowAt(pr.flee.z))) { pr.flee = null; pr.onHot = 0; continue; }
        const k = Math.min(1, (5.5 * dt) / d);
        e.position.x += dx * k;
        e.position.z += dz * k;
        e.velocity.x = e.velocity.z = 0;
        e.knockback(new THREE.Vector3(e.position.x - dx / d, e.position.y, e.position.z - dz / d), 0.01, 0.12, 0);
        continue;
      }
      if (!hot) { pr.onHot = 0; pr.last.set(e.position.x, e.position.z); pr.lastOk = true; continue; }
      // it will not step onto a charging or live tile: a walk that just took
      // it from quiet floor onto hot floor is undone, so it waits at the edge
      // — fly across the live floor and the crowd stays behind
      if (pr.lastOk && pr.onHot === 0 && !tileHot(colAt(pr.last.x), rowAt(pr.last.y))) {
        e.position.x = pr.last.x;
        e.position.z = pr.last.y;
        e.velocity.x = e.velocity.z = 0;
        continue;
      }
      pr.lastOk = false;
      pr.onHot += dt;
      if (pr.onHot < pr.react) continue;
      const c0 = colAt(e.position.x), r0 = rowAt(e.position.z);
      let bx = 0, bz = 0, bd = Infinity;
      for (let r = Math.max(0, r0 - 2); r <= Math.min(ROWS - 1, r0 + 2); r++) {
        for (let c = Math.max(0, c0 - 2); c <= Math.min(COLS - 1, c0 + 2); c++) {
          if (tileHot(c, r)) continue;
          // somewhere on the quiet tile, not its exact centre, so a crowd spreads out
          const tx = tileX(c) + (Math.random() - 0.5) * 2.4, tz = tileZ(r) + (Math.random() - 0.5) * 2.4;
          const d = Math.hypot(tx - e.position.x, tz - e.position.z);
          if (d < bd) { bd = d; bx = tx; bz = tz; }
        }
      }
      if (bd < Infinity) pr.flee = new THREE.Vector3(bx, Y0, bz);
    }
  };

  const update = (dt: number): void => {
    if (complete) return;
    if (!started) {
      started = true;
      ctx.announce(T.title, T.sub);
      postGuards();
      ctx.pickup(new THREE.Vector3(-8, Y0, -HZ + 2));
      ctx.pickup(new THREE.Vector3(HX - 1.5, gy, 12));
      ctx.pickup(new THREE.Vector3(-HX + 1.5, gy, -12));
      for (const p of game.players) {
        // up out of the pool, facing the hall
        p.cam.yaw = 0;
        p.sectionMove = composeMoves({
          adjust: (pl, _dt, input) => interactions.swallow(pl.slot, pl.position, input),
        });
      }
    }

    // ---- the grid ----
    advanceGrid(dt);
    const ph = gridPhase();
    const fn = resting ? null : stepFn();
    const flick = Math.sin(game.time * 40) * 0.5 + 0.5;
    const pulse = Math.sin(game.time * 12) * 0.5 + 0.5;
    const col = new THREE.Color();
    let moved = false;
    for (let r = 1; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const i = tileIndex(c, r);
      const on = fn && !dead[sideOf(c)] ? fn(c, r) : false;
      state[i] = on ? (ph === 'live' ? 2 : 1) : 0;
      const vis = state[i] > 0 ? 1 : 0;
      if (vis !== shown[i]) { shown[i] = vis; showTile(c, r, vis === 1); moved = true; }
      if (state[i] === 2) col.setRGB(0.03 + flick * 0.06, 0.07 + flick * 0.1, 0.16 + flick * 0.16);
      else if (state[i] === 1) {
        const ramp = Math.min(1, gridT / (TELE * pace));
        const k = 0.35 + pulse * 0.35 + ramp * 0.3;
        col.setRGB(0.55 - k * 0.35, 0.75 - k * 0.25, 1.0);
      } else col.setRGB(0, 0, 0);
      tiles.setColorAt(i, col);
    }
    if (moved) tiles.instanceMatrix.needsUpdate = true;
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
    // re-strike the arcs
    arcT -= dt;
    if (arcT <= 0) {
      arcT = 0.07;
      let n = 0;
      for (let r = 1; r < ROWS && n < MAX_ARCS; r++) for (let c = 0; c < COLS && n < MAX_ARCS; c++) {
        const s = state[tileIndex(c, r)];
        if (s === 0 || (s === 1 && Math.random() < 0.7)) continue;
        const cx = tileX(c), cz = tileZ(r);
        const segs = s === 2 ? 9 : 2;
        let px = cx + (Math.random() - 0.5) * TILE * 0.9, pz = cz + (Math.random() - 0.5) * TILE * 0.9;
        for (let k = 0; k < segs && n < MAX_ARCS; k++, n++) {
          const qx = THREE.MathUtils.clamp(px + (Math.random() - 0.5) * 1.6, cx - TILE / 2, cx + TILE / 2);
          const qz = THREE.MathUtils.clamp(pz + (Math.random() - 0.5) * 1.6, cz - TILE / 2, cz + TILE / 2);
          arcPos.set([px, Y0 + 0.08 + Math.random() * 0.15, pz, qx, Y0 + 0.08 + Math.random() * 0.15, qz], n * 6);
          px = qx; pz = qz;
        }
      }
      arcGeo.setDrawRange(0, n * 2);
      arcGeo.attributes.position.needsUpdate = true;
    }
    // the crowd steps off (and will not step onto) hot floor before the beat lands
    herd(dt);
    // the shocks, on the beat
    beatT -= dt;
    if (beatT <= 0) {
      beatT = BEAT;
      for (const p of game.players) {
        if (!p.alive || !onLive(p.position)) continue;
        p.damage(solo ? 11 : 13, p.position.clone().setY(p.position.y - 1), -1, { dot: true });
        p.snareTimer = Math.max(p.snareTimer, 0.6);
        game.particles.impactSparks(p.position.clone().setY(p.position.y + 0.3), 8);
      }
      for (const list of [game.enemies, game.allies]) for (const e of list) {
        if (!e.alive || !onLive(e.position)) continue;
        if (e.team === 0) allyShock += 9;
        e.damage(e.team === 0 ? 9 : 22, e.position.clone().setY(e.position.y - 1), -1);
        e.suppress(0.5);
        game.particles.impactSparks(e.position.clone().setY(e.position.y + 0.3), 6);
      }
    }

    // ---- shutters, desks, the stair ----
    interactions.update(dt, game);
    for (const b of blocks) {
      if (!b.open || b.slide >= 1) continue;
      b.slide = Math.min(1, b.slide + dt / 1.1);
      b.shutter.mesh.position.y = Y0 + 2 + b.slide * 3.9;
    }
    if (stairOpen && stairSlide < 1) {
      stairSlide = Math.min(1, stairSlide + dt / 1.6);
      stairShutter.mesh!.position.y = Y0 + 2.5 + stairSlide * 4.8;
    }
    for (const d of desks) if (!d.taken) d.screen.visible = Math.sin(game.time * 6) > -0.6;

    pressure(dt);

    // ---- the guards: a fallen one drops his rifle ----
    for (const g of guards) {
      if (g.alive || dropped.has(g)) continue;
      dropped.add(g);
      if (g.def.style === 'ranged') dropRifle(g.position);
    }
    for (const r of [...rifles]) {
      if (r.claimed && (!r.claimed.e.alive || r.claimed.armed)) r.claimed = null;
      if (!r.claimed) {
        let best: Prisoner | null = null, bd = 16;
        for (const pr of prisoners) {
          if (!pr.e.alive || pr.armed || pr.going) continue;
          const d = pr.e.position.distanceTo(r.at);
          if (d < bd) { bd = d; best = pr; }
        }
        if (best) {
          r.claimed = best;
          best.going = r.at;
          // the escort AI walks toward its owner: for a moment, the rifle is it
          best.e.owner = { position: r.at, alive: true, team: 0 };
        }
      }
      const c = r.claimed;
      if (c && c.e.position.distanceTo(r.at) < 1.6) {
        arm(c);
        r.mesh.visible = false;
        rifles.splice(rifles.indexOf(r), 1);
      }
    }
    // a prisoner that gave up on a rifle (it was taken) follows again
    for (const pr of prisoners) {
      if (pr.going && !rifles.some((r) => r.claimed === pr)) { pr.going = null; pr.e.owner = null; }
    }

    // ---- the way out ----
    if (stairOpen && !stairHeld()) {
      for (const p of game.players) {
        if (!p.alive || p.position.z < coreZ0 + 3 || Math.abs(p.position.x) > STAIR_W / 2) continue;
        complete = true;
        broughtOut = prisoners.filter((pr) => pr.e.alive && pr.e.position.distanceTo(stairMouth) < 22).length;
        ctx.announce(broughtOut >= 10 ? T.scoreBonus(broughtOut) : T.score(broughtOut), T.scoreSub);
      }
    }
  };

  const objective = () => {
    if (stairOpen) {
      return { pos: new THREE.Vector3(0, Y0, coreZ0 + 3), label: T.stair, hint: stairHeld() ? T.stairHeld : T.stairOpen, beacon: false };
    }
    // the nearest desk not yet taken to the party, else the nearest shut block
    const lead = game.players.find((p) => p.alive)?.position ?? ctx.checkpoint;
    const open = desks.filter((d) => !d.taken);
    open.sort((a, b) => a.pos.distanceTo(lead) - b.pos.distanceTo(lead));
    const d = open[0];
    return {
      pos: d ? d.pos.clone() : stairMouth.clone(), label: T.desk,
      hint: released === 0 ? T.free : T.stairShut(Math.max(0, need - deskCount)), beacon: false,
    };
  };

  const respawnSpot = (slot: number): THREE.Vector3 => {
    // forward, with the party: beside a living player who is standing somewhere
    const buddy = game.players.find((p) => p.alive && p.slot !== slot && p.grounded);
    if (buddy) return ctx.defaultRespawn(slot, buddy.position.clone(), new THREE.Vector3(0, 0, 1));
    return ctx.defaultRespawn(slot, new THREE.Vector3(0, Y0, POOL_Z1 + 1.8), new THREE.Vector3(0, 0, 1));
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const n = aliveCount();
    const ph = gridPhase();
    const bars: SectionBar[] = [
      { label: T.headcount, value: Math.min(1, n / 10), tone: n >= 10 ? 'good' : 'info' },
      {
        label: T.grid, value: ph === 'live' ? 1 : ph === 'tele' ? gridT / (TELE * pace) : 0,
        tone: ph === 'live' ? 'danger' : ph === 'tele' ? 'warn' : 'info',
      },
    ];
    const at = interactions.hudFor(p.position);
    if (at) bars.push({ label: at.bar.label, value: at.bar.value, tone: 'good' });
    const guarded = desks.find((d) => !d.taken && d.it.inReach(p.position) && deskHeld(d));
    return {
      title: `${T.headcount} ${n}`,
      bars,
      line: at ? at.line : guarded ? T.deskGuarded
        : ph === 'live' ? T.gridLive : ph === 'tele' ? T.gridCharging : T.headline(n),
    };
  };

  // ================================================================ autopilot
  // Each slot has a route: its side's blocks, its side's desk, then the
  // stairs. Solo walks the west side and then the east blocks on the way.
  type Task = { kind: 'panel'; block: Block } | { kind: 'desk'; desk: Desk } | { kind: 'stair' };
  const routeFor = (slot: number): Task[] => {
    const west = blocks.filter((b) => b.side < 0);
    const east = blocks.filter((b) => b.side > 0);
    const wDesk = desks.find((d) => d.side === 'west')!;
    const eDesk = desks.find((d) => d.side === 'east')!;
    const side = party === 1 ? 0 : slot % 2;
    const mine = side === 0 ? west : east;
    const route: Task[] = mine.map((b) => ({ kind: 'panel', block: b } as Task));
    route.push({ kind: 'desk', desk: side === 0 ? wDesk : eDesk });
    if (party === 1) for (const b of east.slice(0, 1)) route.push({ kind: 'panel', block: b });
    route.push({ kind: 'stair' });
    return route;
  };
  const routes = [0, 1, 2, 3].map(routeFor);
  const done = (t: Task): boolean =>
    t.kind === 'panel' ? t.block.open : t.kind === 'desk' ? t.desk.taken || stairOpen : complete;

  /** the yaw to the nearest hostile within `r` of `p`, if any */
  const aimAt = (p: THREE.Vector3, r: number): number | undefined => {
    let best: Enemy | null = null, bd = r;
    for (const e of game.enemies) {
      if (!e.alive || e.team !== 1) continue;
      const d = e.position.distanceTo(p);
      if (d < bd) { bd = d; best = e; }
    }
    return best ? Math.atan2(best.position.x - p.x, best.position.z - p.z) : undefined;
  };

  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    const route = routes[slot];
    let c = cursors[slot];
    while (c < route.length - 1 && done(route[c])) c++;
    cursors[slot] = c;
    let task = route[c];
    // the stair is only a goal once it is open: until then, hold near the last desk's floor
    if (task.kind === 'stair' && !stairOpen) {
      const other = desks.find((d) => !d.taken && (d.side === 'west' || d.side === 'east'));
      if (other) task = { kind: 'desk', desk: other };
    }
    const out: AutopilotInput = { shootHeld: true };
    let goal: THREE.Vector3;
    let up = false;
    if (task.kind === 'panel') {
      goal = task.block.panel.spec.pos;
      if (task.block.panel.inReach(p.position)) return { ...out, interactHeld: true };
    } else if (task.kind === 'desk') {
      const d = task.desk;
      if (d.it.inReach(p.position) && p.position.y > gy - 0.5 && p.grounded) {
        // a desk its guards still hold: shoot them first
        return deskHeld(d) ? { ...out, yaw: aimAt(p.position, 30) } : { ...out, interactHeld: true };
      }
      // on the gantry already: walk to the desk; else go below the gap and climb
      if (p.position.y > gy - 0.5) goal = d.pos;
      else {
        const inward = d.side === 'west' ? new THREE.Vector3(2.2, 0, 0) : d.side === 'east' ? new THREE.Vector3(-2.2, 0, 0) : new THREE.Vector3(0, 0, -2.2);
        goal = d.gap.clone().add(inward).setY(Y0);
        const below = Math.hypot(goal.x - p.position.x, goal.z - p.position.z) < 1.2;
        if (below || p.position.y > Y0 + 1.5) { up = true; goal = p.position.y > gy + 0.6 ? d.pos : goal; }
      }
    } else if (stairHeld()) {
      // the stairwell squad: stand off in front of the door and shoot
      goal = new THREE.Vector3(((slot % 2) - 0.5) * 6, Y0, HZ - 7);
      if (Math.hypot(goal.x - p.position.x, goal.z - p.position.z) < 1.5) {
        const y = aimAt(p.position, 40);
        return y === undefined ? out : { ...out, yaw: y };
      }
    } else goal = new THREE.Vector3(0, Y0, coreZ0 + 4);

    const dx = goal.x - p.position.x, dz = goal.z - p.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.5) { out.yaw = Math.atan2(dx, dz); out.moveY = Math.min(1, dist / 2); }
    if (up) {
      // a pack fired from hovers rather than climbs: hold fire on the way up,
      // and a jetpack rests to a full tank on the floor before it goes
      out.shootHeld = false;
      const jet = p.profile.flight === 'jetpack';
      if (jet && p.grounded && p.fuel < 0.9 && !onLive(p.position)) return { shootHeld: true, yaw: out.yaw };
      out.jumpHeld = p.position.y < gy + 1.2;
      if (p.grounded) out.jumpPressed = true;
      if (p.position.y < gy + 0.6) out.moveY = 0;
    }
    // the grid: on a live tile, get off the floor; never step onto a hot one
    if (onLive(p.position)) {
      out.jumpHeld = true;
      if (p.grounded) out.jumpPressed = true;
    } else if (p.grounded && p.position.y < Y0 + 1 && dist > 0.5) {
      const ax = p.position.x + (dx / dist) * 1.8, az = p.position.z + (dz / dist) * 1.8;
      const here = tileHot(colAt(p.position.x), rowAt(p.position.z));
      if (!here && tileHot(colAt(ax), rowAt(az))) out.moveY = 0;
    }
    return out;
  };

  return {
    starts: [0, 1, 2, 3].map((i) => new THREE.Vector3(((i % 2) - 0.5) * 3.2, Y0, POOL_Z1 + 1.2 + Math.floor(i / 2) * 1.4)),
    floorY: Y0,
    ceilingY: Y0 + ROOF - 0.5,
    groundAt: (x, z) => (Math.abs(x) <= POOL_W / 2 && z > POOL_Z0 && z < POOL_Z1 ? Y0 - poolD : Y0),
    contains: (x, z) => (Math.abs(x) < HX && Math.abs(z) < HZ)
      || (Math.abs(x) < HX + BLOCK_D && BLOCKS.some((b) => Math.abs(z - b.z) < BLOCK_W / 2))
      || (Math.abs(x) < STAIR_W / 2 && z >= HZ && z < coreZ0 + coreLen),
    path: [
      new THREE.Vector3(0, Y0, POOL_Z1 + 1.2), blocks[0].panel.spec.pos.clone(),
      desks[0].pos.clone(), stairMouth.clone(), new THREE.Vector3(0, Y0, coreZ0 + 4),
    ],
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    // back down the moon pool is the only way off the floor
    offPath: (pos) => pos.y < Y0 - 2.5,
    hud,
    autopilot,
    dispose: () => {
      for (const p of game.players) p.sectionMove = null;
      for (const pr of prisoners) pr.e.removeMe = true;
    },
    debug: () => ({
      prisoners: aliveCount(), released, desks: deskCount, stairOpen, broughtOut,
      armed: prisoners.filter((p) => p.armed && p.e.alive).length,
      pattern: PATTERNS[patternIdx].name, grid: gridPhase(),
      open: blocks.filter((b) => b.open).length, allyShock,
    }),
  };
}

/** a hostile kind that walks: the gantries have no room for fliers */
function groundKind(k: EnemyKind): EnemyKind {
  return k === 'jetpirate' || k === 'darktrooper' || k === 'drone' || k === 'nikto' ? 'stormtrooper' : k;
}

// ================================================================ the prisoner
// The `prisoner` model is requested (docs/ASSETS_MODELS.md) and not yet
// delivered. The stand-in is the canonical biped re-skinned pale: a work
// jumpsuit, a grey padded vest, cropped hair and a numbered patch. It fights
// on the escort AI as an unarmed brawler — the pirate brawler's numbers with
// the club taken away and the reach of a fist.

const patchCache = new Map<number, THREE.MeshBasicMaterial>();
function patchMat(n: number): THREE.MeshBasicMaterial {
  const key = n % 12;
  let m = patchCache.get(key);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 32;
    const g = c.getContext('2d')!;
    g.fillStyle = '#e8ecee'; g.fillRect(0, 0, 64, 32);
    g.strokeStyle = '#2a3a48'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 61, 29);
    g.fillStyle = '#1a2630'; g.font = 'bold 20px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(1100 + key * 67), 32, 17);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshBasicMaterial({ map: tex });
    patchCache.set(key, m);
  }
  return m;
}

function buildPrisoner(n: number): CharacterInstance {
  const suit = mat(0xd9d4c4, { rough: 0.95 });
  const vest = mat(0x8a8f92, { rough: 0.9 });
  const skinTones = [0xc89a78, 0x8c5f44, 0xe0b898, 0x6b4630, 0xb08060];
  const skin = mat(skinTones[n % skinTones.length], { rough: 0.8 });
  const { inst, rig } = buildBiped({ skin: suit, torso: vest, scale: 0.98 });
  const b = rig.bones;
  addSphere(b.head, skin, 0.12, 0, 0.05, 0.01, 10, 8, 1.12, 1);
  addSphere(b.head, mat(0x2a2420, { rough: 0.9 }), 0.118, 0, 0.1, -0.01, 10, 6, 0.6, 1.02);   // cropped hair
  for (const h of [b.handL, b.handR]) addSphere(h, skin, 0.05, 0, -0.02, 0, 8, 6);
  // the numbered patches: chest and left shoulder
  const pm = patchMat(n);
  const chest = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), pm);
  chest.position.set(0.08, 0.14, 0.135);
  b.chest.add(chest);
  const arm = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.045), pm);
  arm.position.set(-0.058, -0.06, 0);
  arm.rotation.y = -Math.PI / 2;
  b.upperArmL.add(arm);
  addBox(b.hips, mat(0x4a4038, { rough: 0.9 }), 0.36, 0.05, 0.24, 0, 0.1, 0);                 // belt
  return inst;
}

/**
 * A prisoner: an ally on the escort AI (team 0), built on the pirate
 * brawler's kind and re-dressed. Unarmed, it punches; the section arms it
 * when it picks up a guard's rifle.
 */
function makePrisoner(at: THREE.Vector3, n: number): Enemy {
  const e = new Enemy('pirateMelee', at, 0, { silent: true });
  // the brawler's own club and skin never go on: this body is the prisoner
  e.char = buildPrisoner(n);
  e.char.root.position.copy(at);
  e.def = { ...e.def, hp: 110, speed: 5.6, damage: 9, attackRange: 1.2, attackCd: 1.1, notice: 40 };
  e.hp = e.maxHp = 110;
  return e;
}

/** a block's number over its door */
function numberPlate(label: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1c2a34'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#63d0ff'; g.fillRect(0, 0, 128, 5); g.fillRect(0, 59, 128, 5);
  g.fillStyle = '#e8f0f4'; g.font = `bold ${label.length > 4 ? 26 : 38}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 64, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: tex }));
}

/** the floor's tile grid: off-white panels, dark seams, a copper electrode strip */
function makeGridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e4e9ec'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#b9c2c8'; g.fillRect(10, 10, 108, 108);
  g.fillStyle = '#dde3e7'; g.fillRect(12, 12, 104, 104);
  g.fillStyle = '#2a3238'; g.fillRect(0, 0, 128, 4); g.fillRect(0, 0, 4, 128);
  g.fillStyle = '#b87333'; g.fillRect(0, 4, 128, 2); g.fillRect(4, 0, 2, 128);
  g.fillStyle = '#e0b030';
  for (const [x, y] of [[8, 8], [112, 8], [8, 112], [112, 112]]) g.fillRect(x, y, 8, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const oneWayOut: SectionDef = {
  id: 'one-way-out',
  build,
  // the cell blocks' own air: the white, lit interior stage C carries on in
  world: { fogColor: 0xdde8ee, fogNear: 22, fogFar: 110, background: 0xc8d4dc, roofed: true, fill: 1.6 },
};
