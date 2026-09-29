import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy, EnemyKind } from '../enemies/enemy';
import type { Player } from '../player/player';
import { addBreakable, type Breakable } from '../world/board';
import { authoredProp } from '../world/props';
import { audio } from '../core/audio';
import { deckTexture, hullTexture } from '../core/assets';
import { Interactions } from './kit/interact';
import { composeMoves } from './kit/moves';

/**
 * The Line (docs/LEVEL_SECTIONS.md §2.12) — the Refinery, between the yard
 * (stage A) and the plant (stage B).
 *
 * The yard ends at the intake ramp's blast door; this begins just inside it,
 * on the intake processing floor, with the line still running. A hall a
 * hundred and ten metres long: four conveyor belts carrying ore toward a
 * smelter at the far end, catwalks down both walls with troopers on them,
 * and the machines that make it a gauntlet.
 *
 * **The verb** is riding moving ground. The belts carry anything standing on
 * them toward the smelter at 3, 5, 5 and 7 m/s — fast if you go with them,
 * a treadmill if you fight them, and moving cover (crates) and moving bombs
 * (rhydonium barrels) ride along.
 *
 * **Why the presses are gates.** Everyone in this game flies, so a hazard
 * you can fly over is decoration. The two press rows are frames that span
 * the hall from floor to roof: the only way through is the opening over each
 * belt, and a press head is slamming into each one on its own cycle (a hiss
 * and a red strip on the belt one second before). You ride a belt through
 * when its press is up. The catwalks are cut by the frames too, so the only
 * route onward is the floor.
 *
 * **Escalation.** Station 1, the belts: learn the ride, troopers above.
 * Station 2, the presses: two press rows, the second faster. Station 3, the
 * arms: welding arms sweep the belts at waist height (jump them, or walk the
 * floor lanes, which the flametroopers hold). Station 4, the smelter: the
 * floor ends in a slag pit sixteen metres short of the smelter, the belts
 * surge, and the only ground left is the door deck by the plant door — whose
 * release has to be held for four seconds while the last squad comes down
 * the gantry.
 *
 * **Co-op.** A belt switch on the catwalk of each of the first three
 * stations throws the brake on the machines of the station ahead for 15 s
 * (25 solo): the press row locks open, or the arms park. The catwalks are
 * where the troopers are, so the switch player fights for it while the floor
 * players go through. It is never required — every press can be timed.
 *
 * **Nothing left behind.** Riding into the smelter, or dropping into the slag
 * pit, is the off-path catch: you re-form at the last station reached by a
 * living player. The fallen come back there too.
 */

// ---- the hall (local metres; x across, z along toward the smelter, y up from the floor) ----
/** half the hall's inside width */
const HW = 13;
const WALL_T = 2;
const ROOF = 14;
/** the entry vestibule runs back to here, where the intake blast door is */
const ENTRY_Z = -8;
const BELT_X = [-7.2, -2.4, 2.4, 7.2];
const BELT_W = 3.6;
const BELT_TOP = 1.2;
const BELT_Z0 = 2;
/** the belts end at the smelter's mouth */
const BELT_Z1 = 104;
const SMELTER_Z1 = 111;
/** the belts' speeds, m/s, toward the smelter */
const SPEEDS = [3, 5, 5, 7];
/** each press row's frame starts here and is `FRAME_D` deep */
const FRAMES = [30, 56];
const FRAME_D = 4;
/** the openings over the belts: from the belt top up this far */
const OPEN_H = 3.4;
/** how far the head sits above the belt when it is up */
const HEAD_UP = 2.6;
/** the floor lanes end here, at the slag pit */
const FLOOR_END = 86;
/** the door deck, by the plant door */
const DECK = { x0: 9.0, x1: HW, z0: 91, z1: BELT_Z1 };
/** the plant door in the right wall */
const DOOR = { z0: 96, z1: 101, h: 4.5 };
/** catwalks: their z spans, and their height */
const CAT_Y = 6;
const CAT_IN = 10.8;
const CATWALKS: [number, number][] = [[5.5, 29.5], [34.5, 55.5], [60.5, BELT_Z1]];
/** welding arms: base x (the wall side it stands on), z, and phase */
const ARMS: { x: number; z: number; ph: number }[] = [
  { x: 12.3, z: 64, ph: 0 }, { x: -12.3, z: 72, ph: 1.9 }, { x: 12.3, z: 80, ph: 3.6 },
];
const ARM_L = 11;
const ARM_SWING = (40 * Math.PI) / 180;
/** the arm's bar, above the belt top: waist height to anyone riding a belt */
const ARM_LO = BELT_TOP + 0.6;
const ARM_HI = BELT_TOP + 1.2;
/** the belt switches: position on the catwalks, and which machines ahead each brakes */
const SWITCHES: { x: number; z: number; what: 'press0' | 'press1' | 'arms' }[] = [
  { x: 11.9, z: 20, what: 'press0' },
  { x: -11.9, z: 46, what: 'press1' },
  { x: 11.9, z: 76, what: 'arms' },
];
/** the checkpoint stations: re-form spots, and the z a living player must pass to earn each */
const STATIONS: { at: [number, number, number]; z: number }[] = [
  { at: [4, 0, -3], z: -Infinity },
  { at: [10.3, 0, 37], z: FRAMES[0] + FRAME_D + 1.5 },
  { at: [10.3, 0, 63], z: FRAMES[1] + FRAME_D + 1.5 },
  { at: [11.2, BELT_TOP, 94], z: Infinity },   // the deck: earned by standing on it
];

type PressPhase = 'open' | 'warn' | 'slam' | 'down' | 'rise';
interface Press {
  frame: number;
  belt: number;
  /** its own clock through the cycle */
  t: number;
  open: number;
  /** the head's bottom above the belt top */
  bottom: number;
  phase: PressPhase;
  box: THREE.Object3D;
  collider: { min: THREE.Vector3; max: THREE.Vector3 };
  strip: THREE.MeshBasicMaterial;
}
const WARN = 1.0, SLAM = 0.16, DOWN = 0.7, RISE = 0.8;

interface Crate {
  belt: number;
  z: number;
  mesh: THREE.Object3D;
  box: { min: THREE.Vector3; max: THREE.Vector3 };
  /** falling into the smelter: seconds into the fall, or -1 */
  gone: number;
}
interface Barrel {
  belt: number;
  z: number;
  b: Breakable;
  mesh: THREE.Object3D;
  /** seconds until a broken barrel is back at the hopper */
  back: number;
}

function build(ctx: SectionContext): SectionInstance {
  const { game } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections['the-line'];
  const party = Math.max(1, game.players.length);
  const solo = party === 1;

  // ---- materials: the plant's interior palette (world/refinery.ts) ----
  // the very textures and tints the plant's own halls use, so the line and
  // the plant it opens into are one building (they are shared and cached)
  const floorMat = ctx.own(new THREE.MeshStandardMaterial({ map: deckTexture(), color: 0x767a80, roughness: 0.75, metalness: 0.4 }));
  const wallMat = ctx.own(new THREE.MeshStandardMaterial({ map: hullTexture(), color: 0x8a8d92, roughness: 0.65, metalness: 0.45 }));
  const darkMat = ctx.paint(0x24262c, { rough: 0.7, metal: 0.4 });
  const frameMat = ctx.own(new THREE.MeshStandardMaterial({ map: hullTexture(), color: 0x5c5f66, roughness: 0.55, metalness: 0.6 }));
  const stripeMat = ctx.paint(0xd8b02a, { rough: 0.5, emissive: 0x3a1004 });
  ctx.tile(stripeMat, 'hazard_stripe', 2, 1);
  const beltSide = ctx.paint(0x3a3d44, { rough: 0.6, metal: 0.5 });
  const catMat = ctx.paint(0x5a5e66, { rough: 0.6, metal: 0.55 });
  ctx.tile(catMat, 'metal_deck', 1, 8);
  const railMat = ctx.paint(0xb08a2a, { rough: 0.5, metal: 0.5 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  ctx.own(lampMat);

  // ---- the belt surfaces: a scrolling cleated texture, drawn here so the motion reads without art ----
  const beltCanvas = document.createElement('canvas');
  beltCanvas.width = 64; beltCanvas.height = 64;
  {
    const g = beltCanvas.getContext('2d');
    if (g) {
      g.fillStyle = '#26282c'; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#3c3f45'; g.fillRect(0, 0, 64, 10);
      g.fillStyle = '#17181b'; g.fillRect(0, 10, 64, 3);
      g.fillStyle = '#5a5044'; g.fillRect(0, 0, 4, 64); g.fillRect(60, 0, 4, 64);
    }
  }
  const beltMats = SPEEDS.map(() => {
    const tex = new THREE.CanvasTexture(beltCanvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, (BELT_Z1 - BELT_Z0) / 1.6);
    tex.colorSpace = THREE.SRGBColorSpace;
    ctx.own(tex);
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.2 });
    ctx.own(m);
    ctx.tile(m, 'conveyor_belt', 1, (BELT_Z1 - BELT_Z0) / 4);
    return m;
  });

  // ---- shell: floor, walls, roof ----
  const hallLen = SMELTER_Z1 - ENTRY_Z;
  const midZ = (SMELTER_Z1 + ENTRY_Z) / 2;
  // the floor lanes, up to the slag pit
  ctx.box(0, Y0 - 0.5, (ENTRY_Z + FLOOR_END) / 2, HW * 2, 1, FLOOR_END - ENTRY_Z, floorMat);
  // the pit's bottom (slag), well under the belts
  const PIT_Y = -6;
  ctx.box(0, Y0 + PIT_Y - 0.5, (FLOOR_END + SMELTER_Z1) / 2, HW * 2, 1, SMELTER_Z1 - FLOOR_END, darkMat);
  const wallY = Y0 + (PIT_Y + ROOF) / 2;
  const wallH = ROOF - PIT_Y;
  // left wall whole; right wall round the plant door
  ctx.box(-HW - WALL_T / 2, wallY, midZ, WALL_T, wallH, hallLen + WALL_T * 2, wallMat);
  const rx = HW + WALL_T / 2;
  ctx.box(rx, wallY, (ENTRY_Z - WALL_T + DOOR.z0) / 2, WALL_T, wallH, DOOR.z0 - ENTRY_Z + WALL_T, wallMat);
  ctx.box(rx, wallY, (DOOR.z1 + SMELTER_Z1 + WALL_T) / 2, WALL_T, wallH, SMELTER_Z1 + WALL_T - DOOR.z1, wallMat);
  const doorTop = BELT_TOP + DOOR.h;
  ctx.box(rx, Y0 + (doorTop + ROOF) / 2, (DOOR.z0 + DOOR.z1) / 2, WALL_T, ROOF - doorTop, DOOR.z1 - DOOR.z0, wallMat);
  ctx.box(rx, Y0 + (PIT_Y + BELT_TOP) / 2, (DOOR.z0 + DOOR.z1) / 2, WALL_T, BELT_TOP - PIT_Y, DOOR.z1 - DOOR.z0, wallMat);
  // the roof
  ctx.box(0, Y0 + ROOF + 0.5, midZ, HW * 2 + WALL_T * 2, 1, hallLen + WALL_T * 2, darkMat);
  // the entry wall and the intake door the party came through (shut behind them)
  ctx.box(0, Y0 + ROOF / 2, ENTRY_Z - WALL_T / 2, HW * 2, ROOF, WALL_T, wallMat);
  {
    const door = new THREE.Mesh(new THREE.BoxGeometry(8, 7, 0.4), darkMat);
    door.position.set(0, Y0 + 3.5, ENTRY_Z + 0.2);
    ctx.mesh(door);
    for (const sx of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 0.1), lampMat);
      strip.position.set(sx * 1.45, Y0 + 8.2, ENTRY_Z + 0.25);
      ctx.mesh(strip);
    }
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 7, 0.1), ctx.paint(0x111215));
    seam.position.set(0, Y0 + 3.5, ENTRY_Z + 0.45);
    ctx.mesh(seam);
  }
  // the smelter's back wall and its mouth
  ctx.box(0, wallY, SMELTER_Z1 + WALL_T / 2, HW * 2, wallH, WALL_T, wallMat);
  const moltenMat = new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a10, emissiveIntensity: 1.7, roughness: 0.5 });
  ctx.own(moltenMat);
  ctx.tile(moltenMat, 'lava_flow', 2, 1);
  {
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(20, 9), moltenMat);
    mouth.position.set(0, Y0 + 0.5, SMELTER_Z1 - 0.05);
    mouth.rotation.y = Math.PI;
    ctx.mesh(mouth);
    // the pour: a sheet of metal falling from the crucible above the mouth
    const pour = new THREE.Mesh(new THREE.PlaneGeometry(5, 12), moltenMat);
    pour.position.set(0, Y0 + 7, SMELTER_Z1 - 0.3);
    pour.rotation.y = Math.PI;
    ctx.mesh(pour);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(24, 3, 3), frameMat);
    hood.position.set(0, Y0 + 11.5, SMELTER_Z1 - 1.5);
    ctx.mesh(hood);
  }
  // the slag in the pit and the smelter trough
  const slag = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, SMELTER_Z1 - FLOOR_END), moltenMat);
  slag.rotation.x = -Math.PI / 2;
  slag.position.set(0, Y0 - 4, (FLOOR_END + SMELTER_Z1) / 2);
  ctx.mesh(slag);
  for (const x of [-8, 0, 8]) {
    for (const z of [94, 106]) {
      ctx.hazard({ center: new THREE.Vector3(x, Y0 - 4, z), radius: 7.5, kind: 'kill', yMax: Y0 - 3.2 });
    }
  }
  // the pit's lip: a hazard band where the floor lanes stop
  {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(HW * 2, 0.06, 0.6), stripeMat);
    lip.position.set(0, Y0 + 0.03, FLOOR_END - 0.3);
    ctx.mesh(lip);
  }

  // ---- the belts ----
  BELT_X.forEach((x, i) => {
    // the belt body: on the floor up to the pit, then on legs down into it
    ctx.box(x, Y0 + BELT_TOP / 2, (BELT_Z0 + FLOOR_END) / 2, BELT_W, BELT_TOP, FLOOR_END - BELT_Z0, beltSide);
    ctx.box(x, Y0 + (PIT_Y + BELT_TOP) / 2 - 0.5, (FLOOR_END + BELT_Z1) / 2, BELT_W, BELT_TOP - PIT_Y - 1, BELT_Z1 - FLOOR_END, beltSide);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(BELT_W - 0.3, BELT_Z1 - BELT_Z0), beltMats[i]);
    top.rotation.x = -Math.PI / 2;
    top.position.set(x, Y0 + BELT_TOP + 0.02, (BELT_Z0 + BELT_Z1) / 2);
    ctx.mesh(top);
    // the speed, painted on the floor at the hopper: chevrons for how fast
    for (let k = 0; k <= i; k++) {
      const chev = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.9), railMat);
      chev.position.set(x - 1.3, Y0 + BELT_TOP + 0.04, BELT_Z0 + 3 + k * 1.1);
      ctx.mesh(chev);
    }
  });
  // the hopper the belts come out of, at the near end
  ctx.box(0, Y0 + (3.4 + ROOF) / 2, BELT_Z0 + 0.8, 19, ROOF - 3.4, 2.6, frameMat);
  ctx.box(0, Y0 + 1.7, BELT_Z0 - 0.3, 19, 3.4, 0.6, frameMat);
  {
    const band = new THREE.Mesh(new THREE.BoxGeometry(19, 0.5, 0.1), stripeMat);
    band.position.set(0, Y0 + 3.65, BELT_Z0 - 0.62);
    ctx.mesh(band);
    // the chute mouths the ore drops out of, one over each belt, lit from inside
    const chuteMat = new THREE.MeshBasicMaterial({ color: 0x3a2410 });
    ctx.own(chuteMat);
    for (const x of BELT_X) {
      const mouth = new THREE.Mesh(new THREE.PlaneGeometry(BELT_W - 0.6, 1.6), chuteMat);
      mouth.position.set(x, Y0 + BELT_TOP + 1.1, BELT_Z0 - 0.61);
      mouth.rotation.y = Math.PI;
      ctx.mesh(mouth);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.1), lampMat);
      lamp.position.set(x, Y0 + BELT_TOP + 2.3, BELT_Z0 - 0.64);
      ctx.mesh(lamp);
    }
    const intakeLight = new THREE.PointLight(0xffc98a, 30, 20, 1.5);
    intakeLight.position.set(6, Y0 + 5, -3);
    ctx.mesh(intakeLight);
  }

  // ---- the door deck and the plant door ----
  const deckW = DECK.x1 - DECK.x0, deckL = DECK.z1 - DECK.z0;
  ctx.box((DECK.x0 + DECK.x1) / 2, Y0 + (PIT_Y + BELT_TOP) / 2, (DECK.z0 + DECK.z1) / 2,
    deckW, BELT_TOP - PIT_Y, deckL, catMat);
  {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, deckL), stripeMat);
    edge.position.set(DECK.x0 + 0.2, Y0 + BELT_TOP + 0.03, (DECK.z0 + DECK.z1) / 2);
    ctx.mesh(edge);
  }
  // the door: a slab that lifts into the wall
  const doorMat = ctx.paint(0x2c2f35, { rough: 0.5, metal: 0.6 });
  const doorSlab = ctx.box(HW + WALL_T / 2, Y0 + BELT_TOP + DOOR.h / 2, (DOOR.z0 + DOOR.z1) / 2,
    WALL_T * 0.6, DOOR.h, DOOR.z1 - DOOR.z0, doorMat);
  const doorLamp = new THREE.MeshBasicMaterial({ color: 0xffa020 });
  ctx.own(doorLamp);
  for (const z of [DOOR.z0 - 0.4, DOOR.z1 + 0.4]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.4, 0.3), doorLamp);
    l.position.set(HW - 0.1, Y0 + BELT_TOP + DOOR.h - 0.6, z);
    ctx.mesh(l);
  }
  {
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, DOOR.z1 - DOOR.z0 + 1.2), stripeMat);
    lintel.position.set(HW - 0.1, Y0 + BELT_TOP + DOOR.h + 0.25, (DOOR.z0 + DOOR.z1) / 2);
    ctx.mesh(lintel);
  }
  // behind it: a short lit passage into the plant (its far end is the transport)
  const VX1 = HW + WALL_T + 6;
  ctx.box((HW + WALL_T + VX1) / 2, Y0 + BELT_TOP - 0.5, (DOOR.z0 + DOOR.z1) / 2, VX1 - HW - WALL_T, 1, DOOR.z1 - DOOR.z0 + 2, floorMat);
  ctx.box((HW + WALL_T + VX1) / 2, Y0 + BELT_TOP + DOOR.h + 0.5, (DOOR.z0 + DOOR.z1) / 2, VX1 - HW - WALL_T, 1, DOOR.z1 - DOOR.z0 + 2, darkMat);
  for (const z of [DOOR.z0 - 1.5, DOOR.z1 + 1.5]) {
    ctx.box((HW + WALL_T + VX1) / 2, Y0 + BELT_TOP + DOOR.h / 2, z, VX1 - HW - WALL_T, DOOR.h, 1, wallMat);
  }
  ctx.box(VX1 + 0.5, Y0 + BELT_TOP + DOOR.h / 2, (DOOR.z0 + DOOR.z1) / 2, 1, DOOR.h, DOOR.z1 - DOOR.z0 + 2, wallMat);
  const plantGlow = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.z1 - DOOR.z0 - 1, DOOR.h - 0.6), lampMat);
  plantGlow.position.set(VX1 - 0.02, Y0 + BELT_TOP + DOOR.h / 2, (DOOR.z0 + DOOR.z1) / 2);
  plantGlow.rotation.y = -Math.PI / 2;
  ctx.mesh(plantGlow);

  // ---- catwalks ----
  const railGeo = new THREE.BoxGeometry(0.08, 0.08, 1);
  ctx.own(railGeo);
  for (const side of [-1, 1]) {
    for (const [z0, z1] of CATWALKS) {
      const cx = side * (CAT_IN + HW) / 2;
      ctx.box(cx, Y0 + CAT_Y - 0.15, (z0 + z1) / 2, HW - CAT_IN, 0.3, z1 - z0, catMat);
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.scale.z = z1 - z0;
      rail.position.set(side * (CAT_IN + 0.05), Y0 + CAT_Y + 1.0, (z0 + z1) / 2);
      ctx.mesh(rail);
      for (let z = z0 + 0.5; z < z1; z += 3) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), railMat);
        post.position.set(side * (CAT_IN + 0.05), Y0 + CAT_Y + 0.5, z);
        ctx.mesh(post);
      }
    }
  }

  // ---- lamps: sodium over the line, and the smelter's glow ----
  for (const z of [14, 44, 74]) {
    const l = new THREE.PointLight(0xffc98a, 55, 42, 1.4);
    l.position.set(0, Y0 + ROOF - 2, z);
    ctx.mesh(l);
    const fitting = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 0.8), lampMat);
    fitting.position.set(0, Y0 + ROOF - 0.2, z);
    ctx.mesh(fitting);
  }
  const smelterGlow = new THREE.PointLight(0xff6a20, 140, 70, 1.3);
  smelterGlow.position.set(0, Y0 + 3, SMELTER_Z1 - 4);
  ctx.mesh(smelterGlow);
  const plantLight = new THREE.PointLight(0xfff0d0, 25, 14, 1.5);
  plantLight.position.set(VX1 - 2, Y0 + BELT_TOP + 3.5, (DOOR.z0 + DOOR.z1) / 2);
  ctx.mesh(plantLight);

  // ---- the press rows ----
  const presses: Press[] = [];
  FRAMES.forEach((fz, f) => {
    // the frame: a beam over the openings, posts down to the floor between them
    ctx.box(0, Y0 + (BELT_TOP + OPEN_H + ROOF) / 2, fz + FRAME_D / 2, HW * 2, ROOF - BELT_TOP - OPEN_H, FRAME_D, frameMat);
    const edges = [-HW, ...BELT_X.flatMap((x) => [x - BELT_W / 2, x + BELT_W / 2]), HW];
    for (let k = 0; k < edges.length; k += 2) {
      const x0 = edges[k], x1 = edges[k + 1];
      ctx.box((x0 + x1) / 2, Y0 + (BELT_TOP + OPEN_H) / 2, fz + FRAME_D / 2, x1 - x0, BELT_TOP + OPEN_H, FRAME_D, frameMat);
    }
    // hazard banding on the face of the beam, both sides
    for (const zf of [fz - 0.02, fz + FRAME_D + 0.02]) {
      const band = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, 0.9), stripeMat);
      band.position.set(0, Y0 + BELT_TOP + OPEN_H + 0.45, zf);
      if (zf < fz) band.rotation.y = Math.PI;
      ctx.mesh(band);
    }
    // the gantry sculpt, where one lands, over each opening (the head is the game's)
    for (const x of BELT_X) {
      ctx.prop('hydraulic_press', new THREE.Vector3(x, Y0 + BELT_TOP, fz + FRAME_D / 2), {
        size: 8, fallback: () => new THREE.Group(),
      });
    }
    // Staggered so there is always an open belt somewhere in the row; the
    // second row runs shorter open windows than the first.
    const open = (f === 0 ? 2.6 : 1.9) + (solo ? 0.5 : 0);
    const cycle = open + WARN + SLAM + DOWN + RISE;
    BELT_X.forEach((x, belt) => {
      const headH = OPEN_H - HEAD_UP;
      const head = new THREE.Mesh(new THREE.BoxGeometry(BELT_W - 0.2, 1, FRAME_D - 0.4), stripeMat);
      ctx.mesh(head);
      const collider = ctx.box(x, Y0 + BELT_TOP + HEAD_UP + headH / 2, fz + FRAME_D / 2, BELT_W - 0.2, headH, FRAME_D - 0.4, null).box;
      const stripMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.12, depthWrite: false });
      ctx.own(stripMat);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(BELT_W - 0.3, 1.2), stripMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(x, Y0 + BELT_TOP + 0.05, fz - 0.6);
      ctx.mesh(strip);
      presses.push({
        frame: f, belt, t: ((belt * (f === 0 ? 0.27 : 0.61) + f * 0.13) % 1) * cycle, open,
        bottom: HEAD_UP, phase: 'open', box: head, collider, strip: stripMat,
      });
    });
  });
  const pressCycle = (p: Press): number => p.open + WARN + SLAM + DOWN + RISE;
  const pressFootprint = (p: Press) => ({
    x0: BELT_X[p.belt] - BELT_W / 2, x1: BELT_X[p.belt] + BELT_W / 2,
    z0: FRAMES[p.frame] + 0.2, z1: FRAMES[p.frame] + FRAME_D - 0.2,
  });

  // ---- the welding arms ----
  const arms = ARMS.map((a) => {
    const side = Math.sign(a.x);
    const pivot = new THREE.Group();
    pivot.position.set(a.x, Y0, a.z);
    ctx.mesh(pivot);
    const stand = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, (ARM_LO + ARM_HI) / 2 + 0.3, 12), railMat);
    base.position.y = ((ARM_LO + ARM_HI) / 2 + 0.3) / 2;
    stand.add(base);
    pivot.add(stand);
    authoredProp(pivot, [stand], 'welding_arm', 6, { axis: 'longest' });
    // the swinging part stays the game's: a boom at waist height over the belts, a torch at the tip
    const boom = new THREE.Group();
    boom.position.y = (ARM_LO + ARM_HI) / 2;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(ARM_L, ARM_HI - ARM_LO, 0.5), stripeMat);
    bar.position.x = ARM_L / 2;
    boom.add(bar);
    const torch = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9fd8ff }));
    torch.position.x = ARM_L;
    boom.add(torch);
    pivot.add(boom);
    ctx.box(a.x, Y0 + 1, a.z, 1.4, 2, 1.4, null);
    return { ...a, side, boom, torch, ang: 0, lastAng: 0, hit: new Map<object, number>() };
  });

  // ---- crates and barrels riding the belts ----
  const crateMat = ctx.paint(0x8a7454, { rough: 0.8, metal: 0.2 });
  ctx.tile(crateMat, 'crate_side', 1, 1);
  const crates: Crate[] = [];
  const CRATE = 2.2;
  [3, 2, 2, 3].forEach((n, belt) => {
    for (let k = 0; k < n; k++) {
      const z = BELT_Z0 + 8 + ((k + belt * 0.37) / n) * (BELT_Z1 - BELT_Z0 - 14);
      const { box, mesh } = ctx.box(BELT_X[belt], Y0 + BELT_TOP + CRATE / 2, z, CRATE, CRATE, CRATE, crateMat);
      crates.push({ belt, z, mesh: mesh!, box, gone: -1 });
    }
  });
  const barrelMat = ctx.paint(0x8f5a24, { rough: 0.6, metal: 0.35 });
  const barrels: Barrel[] = [];
  const breakables: Breakable[] = [];
  for (const [belt, z] of [[1, 24], [2, 50], [1, 70], [2, 82], [0, 60]] as const) {
    const group = new THREE.Group();
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.7, 12), barrelMat);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.2, 12), stripeMat);
    band.position.y = 0.35;
    group.add(drum, band);
    ctx.mesh(group);
    const box = ctx.box(BELT_X[belt], Y0 + BELT_TOP + 0.85, z, 1.2, 1.7, 1.2, null).box;
    const b = addBreakable(ctx.board, group, box, 45, { explosive: true, radius: 1.1 });
    breakables.push(b);
    barrels.push({ belt, z, b, mesh: group, back: 0 });
  }

  // ---- the switches and the door release ----
  const interactions = new Interactions();
  const holdLeft = { press0: 0, press1: 0, arms: 0 };
  const HOLD = solo ? 25 : 15;
  const switches = SWITCHES.map((s) => {
    const at = new THREE.Vector3(s.x, Y0 + CAT_Y, s.z);
    const lever = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.3, 0.9), darkMat);
    cab.position.y = 0.65;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa020 }));
    lamp.position.y = 1.45;
    lever.add(cab, lamp);
    lever.position.copy(at);
    ctx.mesh(lever);
    const it = interactions.add({
      pos: at, hold: 1.5, radius: 2.2, verb: T.brakeVerb, once: false,
      enabled: () => holdLeft[s.what] <= 0,
      onDone: () => {
        holdLeft[s.what] = HOLD;
        audio.doorCycle();
        ctx.announce(T.braked, s.what === 'arms' ? T.brakedArms : T.brakedPress);
      },
    });
    return { ...s, at, it, lamp: lamp.material as THREE.MeshBasicMaterial };
  });
  let doorOpen = 0;              // 0 shut → 1 open
  let releasing = false;
  const releaseAt = new THREE.Vector3(11.6, Y0 + BELT_TOP, DOOR.z0 - 1.2);
  {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 1.0), darkMat);
    panel.position.set(HW - 0.2, Y0 + BELT_TOP + 1.1, releaseAt.z);
    ctx.mesh(panel);
  }
  const release = interactions.add({
    pos: releaseAt, hold: solo ? 3 : 4, radius: 2.4, verb: T.releaseVerb,
    enabled: () => reached >= 3,
    onDone: () => {
      releasing = true;
      audio.doorCycle();
      ctx.announce(T.opening, T.openingSub);
      spawnLast(true);
    },
  });

  // ---- state ----
  let started = false;
  let complete = false;
  let reached = 0;
  let surging = false;
  const cursors = [0, 0, 0, 0];
  const lastPos = [0, 1, 2, 3].map(() => new THREE.Vector3());
  const hitCd = new Map<object, number>();
  ctx.checkpoint.set(...STATIONS[0].at).add(new THREE.Vector3(0, Y0, 0));
  const stationPos = (k: number): THREE.Vector3 =>
    new THREE.Vector3(STATIONS[k].at[0], Y0 + STATIONS[k].at[1], STATIONS[k].at[2]);
  const onDeck = (p: THREE.Vector3): boolean =>
    p.x > DECK.x0 && p.x < DECK.x1 && p.z > DECK.z0 && p.z < DECK.z1 && p.y > Y0 + BELT_TOP - 0.6;

  // ---- hostiles ----
  const catwalkAt = (side: number, z: number) => new THREE.Vector3(side * 11.9, Y0 + CAT_Y, z);
  const post = (kind: EnemyKind, at: THREE.Vector3, squad: number, alert = false): Enemy =>
    ctx.spawn(kind, at, { exact: true, squad, alert });
  const floorSquad = (wave: number, n: number, spots: THREE.Vector3[], squad: number, extra?: EnemyKind): void => {
    const kinds = ctx.squadFor(wave, n);
    if (extra) kinds.unshift(extra);
    kinds.forEach((k, i) => post(k, spots[i % spots.length].clone().add(new THREE.Vector3(0, 0, (i >> 1) * 1.5)), squad));
  };
  const spawnPosted = (): void => {
    // station 1: the belts — troopers above, a pair on the floor
    post('stormtrooper', catwalkAt(1, 12), 8811);
    post('stormtrooper', catwalkAt(-1, 24), 8811);
    if (party >= 3) post('stormtrooper', catwalkAt(-1, 10), 8811);
    floorSquad(ctx.wave, 1 + Math.floor(party / 2), [new THREE.Vector3(-11, Y0, 22), new THREE.Vector3(0, Y0, 26)], 8812);
    // station 2: the presses — the catwalks and a flametrooper in the lanes
    post('stormtrooper', catwalkAt(1, 44), 8821);
    post('stormtrooper', catwalkAt(-1, 50), 8821);
    if (party >= 3) post('deathtrooper', catwalkAt(1, 52), 8821);
    floorSquad(ctx.wave + 1, party, [new THREE.Vector3(0, Y0, 46), new THREE.Vector3(-11, Y0, 50)], 8822, 'flametrooper');
    // station 3: the arms — flametroopers hold the floor lanes, troopers above
    post('stormtrooper', catwalkAt(-1, 68), 8831);
    post('stormtrooper', catwalkAt(1, 86), 8831);
    post('flametrooper', new THREE.Vector3(-4.8, Y0, 76), 8832);
    if (party >= 2) post('flametrooper', new THREE.Vector3(11, Y0, 70), 8832);
    if (party >= 4) post('flametrooper', new THREE.Vector3(0, Y0, 82), 8832);
  };
  let lastWave = 0;
  const spawnLast = (second: boolean): void => {
    if (!second) {
      // the smelter gantry: troopers come along the far catwalk and down onto the deck
      for (let i = 0; i < 2 + Math.floor(party / 2); i++) post('stormtrooper', catwalkAt(1, 100 - i * 2.5), 8841, true);
      const kinds = ctx.squadFor(ctx.wave + 2, 1 + party);
      kinds.forEach((k, i) => post(k, new THREE.Vector3(11.5, Y0 + BELT_TOP, 102.5 - (i % 3) * 1.4), 8842, true));
    } else if (lastWave < 2) {
      post('flametrooper', catwalkAt(-1, 96), 8843, true);
      for (let i = 0; i < Math.ceil(party / 2); i++) post('deathtrooper', catwalkAt(1, 90 + i * 2.5), 8843, true);
    }
    lastWave++;
  };

  // ---- the golden path ----
  const path = [
    new THREE.Vector3(4, Y0, -3), new THREE.Vector3(10, Y0, 6),
    new THREE.Vector3(10, Y0, FRAMES[0] - 2.5), new THREE.Vector3(7.2, Y0 + BELT_TOP, FRAMES[0] + FRAME_D + 1),
    new THREE.Vector3(10, Y0, FRAMES[1] - 2.5), new THREE.Vector3(7.2, Y0 + BELT_TOP, FRAMES[1] + FRAME_D + 1),
    new THREE.Vector3(10, Y0, FLOOR_END - 1.5), new THREE.Vector3(7.2, Y0 + BELT_TOP, DECK.z0 + 1),
    releaseAt.clone(), new THREE.Vector3(VX1 - 2, Y0 + BELT_TOP, (DOOR.z0 + DOOR.z1) / 2),
  ];

  // ---- the machines, each frame ----
  const pressSafe = (p: Press): number => {
    if (holdLeft[p.frame === 0 ? 'press0' : 'press1'] > 0) return holdLeft[p.frame === 0 ? 'press0' : 'press1'];
    return p.phase === 'open' ? p.open - p.t : 0;
  };
  const beltSpeed = (belt: number): number => SPEEDS[belt] * (surging ? 1.5 : 1);
  const beltOf = (x: number, pad = 0): number => {
    for (let i = 0; i < BELT_X.length; i++) if (Math.abs(x - BELT_X[i]) < BELT_W / 2 - pad) return i;
    return -1;
  };

  const updatePresses = (dt: number): void => {
    for (const p of presses) {
      const held = holdLeft[p.frame === 0 ? 'press0' : 'press1'] > 0;
      const prevPhase = p.phase;
      if (held && p.phase === 'open') {
        p.t = 0;                       // held open: the cycle waits at its start
      } else {
        p.t += dt;
        const cyc = pressCycle(p);
        if (p.t >= cyc) p.t -= cyc;
      }
      const t = p.t;
      const o = p.open;
      p.phase = t < o ? 'open' : t < o + WARN ? 'warn' : t < o + WARN + SLAM ? 'slam'
        : t < o + WARN + SLAM + DOWN ? 'down' : 'rise';
      // a held row lifts whatever was coming down
      if (held && p.phase !== 'open') p.phase = 'rise';
      switch (p.phase) {
        case 'open': p.bottom = HEAD_UP; break;
        case 'warn': p.bottom = HEAD_UP - 0.35 * Math.min(1, (t - o) / 0.3); break;
        case 'slam': p.bottom = Math.max(0, (HEAD_UP - 0.35) * (1 - (t - o - WARN) / SLAM)); break;
        case 'down': p.bottom = 0; break;
        case 'rise': p.bottom = Math.min(HEAD_UP, p.bottom + (HEAD_UP / RISE) * dt); break;
      }
      // the telegraph: a red strip on the belt in front, and the hiss
      p.strip.opacity = p.phase === 'warn' ? 0.55 + 0.35 * Math.sin(game.time * 30) : p.phase === 'slam' || p.phase === 'down' ? 0.5 : 0.1;
      if (prevPhase === 'open' && p.phase === 'warn') {
        const near = nearestPlayer(new THREE.Vector3(BELT_X[p.belt], Y0, FRAMES[p.frame]));
        if (near < 30) audio.steamHiss(Math.max(0.05, Math.min(0.4, 8 / Math.max(near, 4))));
      }
      if (prevPhase !== 'down' && p.phase === 'down') slam(p);
      // the head: mesh and collider
      const headH = OPEN_H - p.bottom;
      const fz = FRAMES[p.frame] + FRAME_D / 2;
      const x = BELT_X[p.belt];
      p.box.scale.y = headH;
      p.box.position.set(x, Y0 + BELT_TOP + p.bottom + headH / 2, fz);
      p.collider.min.set(x - (BELT_W - 0.2) / 2, Y0 + BELT_TOP + p.bottom, fz - (FRAME_D - 0.4) / 2);
      p.collider.max.set(x + (BELT_W - 0.2) / 2, Y0 + BELT_TOP + OPEN_H, fz + (FRAME_D - 0.4) / 2);
    }
  };

  const nearestPlayer = (at: THREE.Vector3): number => {
    let d = Infinity;
    for (const p of game.players) if (p.alive) d = Math.min(d, p.position.distanceTo(at));
    return d;
  };

  /** the head has come down: whatever is under it pays */
  const slam = (p: Press): void => {
    const fp = pressFootprint(p);
    const top = Y0 + BELT_TOP + OPEN_H;
    const at = new THREE.Vector3(BELT_X[p.belt], Y0 + BELT_TOP + 0.3, FRAMES[p.frame] + FRAME_D / 2);
    game.particles.impactSparks(at, 16);
    game.particles.dustPuff(at, 10);
    const near = nearestPlayer(at);
    if (near < 40) audio.impact();
    for (const pl of game.players) {
      if (pl.alive && pl.position.distanceTo(at) < 12) pl.cam.shake(0.25 * (1 - pl.position.distanceTo(at) / 12));
    }
    const under = (pos: THREE.Vector3, r: number): boolean =>
      pos.x > fp.x0 - r && pos.x < fp.x1 + r && pos.z > fp.z0 - r && pos.z < fp.z1 + r && pos.y < top && pos.y > Y0 + BELT_TOP - 1;
    for (const pl of game.players) {
      if (!pl.alive || !under(pl.position, pl.radius * 0.6)) continue;
      pl.damage(solo ? 30 : 38, at, -1, { heavy: true });
      // spat back out upstream, on the belt, off balance
      pl.position.z = fp.z0 - 1.0 - pl.radius;
      pl.position.y = Math.max(pl.position.y, Y0 + BELT_TOP + 0.05);
      pl.velocity.set((Math.random() - 0.5) * 2, 4, -6);
      ctx.announce(T.crushed);
    }
    for (const e of game.enemies) {
      if (e.alive && under(e.position, e.radius * 0.6)) e.damage(400, at, -1);
    }
    for (const c of crates) {
      if (c.gone < 0 && c.belt === p.belt && c.z + CRATE / 2 > fp.z0 && c.z - CRATE / 2 < fp.z1) {
        game.particles.deathBurst(new THREE.Vector3(BELT_X[c.belt], Y0 + BELT_TOP + 1, c.z), 14);
        recycleCrate(c);
      }
    }
    for (const b of barrels) {
      if (!b.b.broken && b.belt === p.belt && b.z > fp.z0 - 0.6 && b.z < fp.z1 + 0.6) game.hurtBreakable(b.b, 999);
    }
  };

  /** is the head of the press over `belt` in the way of something `height` tall sat on the belt? */
  const blocks = (belt: number, z0: number, z1: number, height: number): boolean => {
    for (const p of presses) {
      if (p.belt !== belt) continue;
      const fp = pressFootprint(p);
      if (z1 > fp.z0 && z0 < fp.z1 && p.bottom < height + 0.05) return true;
    }
    return false;
  };

  const setCrate = (c: Crate): void => {
    const x = BELT_X[c.belt];
    const sink = c.gone >= 0 ? c.gone * c.gone * 9 : 0;
    const y = Y0 + BELT_TOP + CRATE / 2 - sink;
    c.mesh.position.set(x, y, c.z);
    c.mesh.rotation.x = c.gone >= 0 ? c.gone * 1.2 : 0;
    if (c.gone >= 0) {
      // out of the world while it falls, so nothing stands on it
      c.box.min.set(x, Y0 - 200, c.z); c.box.max.set(x, Y0 - 199.9, c.z);
    } else {
      c.box.min.set(x - CRATE / 2, y - CRATE / 2, c.z - CRATE / 2);
      c.box.max.set(x + CRATE / 2, y + CRATE / 2, c.z + CRATE / 2);
    }
  };
  const recycleCrate = (c: Crate): void => {
    c.gone = -1;
    // back out of the hopper, behind whatever is last out of it on this belt
    let z = BELT_Z0 + 1.6;
    for (const o of crates) if (o !== c && o.belt === c.belt && o.gone < 0) z = Math.min(z, o.z - CRATE - 0.6);
    c.z = z;
    c.mesh.visible = c.z > BELT_Z0 - 0.5;
  };

  const updateCargo = (dt: number): void => {
    for (const c of crates) {
      if (c.gone >= 0) {
        c.gone += dt;
        if (c.gone > 1.2) recycleCrate(c);
        setCrate(c);
        continue;
      }
      const v = beltSpeed(c.belt) * dt;
      const nz = c.z + v;
      // a crate queues behind the one ahead, and waits at a shut press
      const ahead = crates.some((o) => o !== c && o.belt === c.belt && o.gone < 0 && o.z > c.z && o.z - nz < CRATE + 0.3);
      if (!ahead && !blocks(c.belt, nz - CRATE / 2, nz + CRATE / 2, CRATE)) c.z = nz;
      c.mesh.visible = c.z > BELT_Z0 - 0.5;
      if (c.z > BELT_Z1 - 0.4) c.gone = 0;
      setCrate(c);
    }
    for (const b of barrels) {
      if (b.b.broken) {
        b.back -= dt;
        if (b.back <= -8) {
          // a fresh drum out of the hopper
          b.b.broken = false;
          b.b.hp = b.b.maxHp;
          b.z = BELT_Z0 + 1.2;
          b.back = 0;
          if (!ctx.board.physics.boxes.includes(b.b.box)) ctx.board.physics.boxes.push(b.b.box);
          b.mesh.visible = true;
        }
        continue;
      }
      const nz = b.z + beltSpeed(b.belt) * dt;
      if (!blocks(b.belt, nz - 0.6, nz + 0.6, 1.7)) b.z = nz;
      if (b.z > BELT_Z1 - 0.3) { b.z = BELT_Z0 + 1.2; }
      const x = BELT_X[b.belt];
      b.mesh.position.set(x, Y0 + BELT_TOP + 0.85, b.z);
      b.b.box.min.set(x - 0.6, Y0 + BELT_TOP, b.z - 0.6);
      b.b.box.max.set(x + 0.6, Y0 + BELT_TOP + 1.7, b.z + 0.6);
      b.b.center.set(x, Y0 + BELT_TOP + 0.85, b.z);
    }
  };

  /** the belts carry whatever is standing on them, and on the crates riding them */
  const carry = (dt: number): void => {
    const move = (pos: THREE.Vector3, grounded: boolean): void => {
      if (!grounded) return;
      if (pos.z < BELT_Z0 || pos.z > BELT_Z1 + 0.5) return;
      const belt = beltOf(pos.x, 0.05);
      if (belt < 0) return;
      const onBelt = Math.abs(pos.y - (Y0 + BELT_TOP)) < 0.3;
      const onCrate = crates.some((c) => c.gone < 0 && c.belt === belt && Math.abs(pos.z - c.z) < CRATE / 2
        && Math.abs(pos.y - (Y0 + BELT_TOP + CRATE)) < 0.3);
      if (!onBelt && !onCrate) return;
      pos.z += beltSpeed(belt) * dt;
    };
    for (const p of game.players) if (p.alive) move(p.position, p.grounded);
    for (const e of game.enemies) if (e.alive) move(e.position, true);
  };

  const updateArms = (dt: number): void => {
    const parked = holdLeft.arms > 0;
    for (const a of arms) {
      a.lastAng = a.ang;
      const want = parked ? a.side * -Math.PI / 2 * 0.98 : ARM_SWING * Math.sin(game.time * 1.7 + a.ph);
      a.ang = parked ? a.ang + (want - a.ang) * Math.min(1, dt * 2) : want;
      // the boom points inward (−side on x), turned by the swing angle
      const dirX = -a.side * Math.cos(a.ang), dirZ = Math.sin(a.ang);
      a.boom.rotation.y = Math.atan2(-dirZ, dirX);
      if (!parked && Math.random() < dt * 14) {
        const tip = new THREE.Vector3(a.x + dirX * ARM_L, Y0 + (ARM_LO + ARM_HI) / 2, a.z + dirZ * ARM_L);
        game.particles.impactSparks(tip, 3);
      }
      if (parked) continue;
      const sweep = Math.sign(a.ang - a.lastAng) || 1;
      const hitBody = (pos: THREE.Vector3, r: number): THREE.Vector3 | null => {
        // waist height over the belts: someone on the floor is under it, someone jumping over it
        if (!(pos.y + 1.3 > Y0 + ARM_LO && pos.y < Y0 + ARM_HI)) return null;
        const rx = pos.x - a.x, rz = pos.z - a.z;
        const along = rx * dirX + rz * dirZ;
        if (along < 0.5 || along > ARM_L) return null;
        const off = Math.abs(rx * -dirZ + rz * dirX);
        if (off > 0.35 + r) return null;
        // the push goes the way the boom is moving
        return new THREE.Vector3(a.side * Math.sin(a.ang) * sweep, 0, Math.cos(a.ang) * sweep);
      };
      for (const p of game.players) {
        if (!p.alive || (hitCd.get(p) ?? 0) > game.time) continue;
        const push = hitBody(p.position, p.radius);
        if (!push) continue;
        hitCd.set(p, game.time + 0.9);
        p.damage(16, new THREE.Vector3(a.x, p.position.y + 1, a.z), -1);
        p.velocity.x += push.x * 8;
        p.velocity.z += push.z * 8;
        p.velocity.y = Math.max(p.velocity.y, 4);
        game.particles.impactSparks(p.position.clone().setY(p.position.y + 1.4), 10);
        audio.impact();
      }
      for (const e of game.enemies) {
        if (!e.alive || (hitCd.get(e) ?? 0) > game.time) continue;
        const push = hitBody(e.position, e.radius);
        if (!push) continue;
        hitCd.set(e, game.time + 0.9);
        e.damage(30, new THREE.Vector3(a.x, e.position.y + 1, a.z), -1);
      }
    }
  };

  const update = (dt: number): void => {
    if (complete) return;
    if (!started) {
      started = true;
      spawnPosted();
      ctx.pickup(new THREE.Vector3(10.4, Y0, FRAMES[0] + FRAME_D + 3));
      ctx.pickup(new THREE.Vector3(10.4, Y0, FRAMES[1] + FRAME_D + 3));
      if (party >= 2) ctx.pickup(new THREE.Vector3(-10.4, Y0, FRAMES[1] + FRAME_D + 3));
      ctx.pickup(new THREE.Vector3(12, Y0 + BELT_TOP, DECK.z0 + 1.5));
      ctx.announce(T.title, T.sub);
      for (const p of game.players) {
        p.sectionMove = composeMoves({
          adjust: (pl, _dt, input) => interactions.swallow(pl.slot, pl.position, input),
        });
      }
    }
    for (const k of Object.keys(holdLeft) as (keyof typeof holdLeft)[]) holdLeft[k] = Math.max(0, holdLeft[k] - dt);
    for (const s of switches) s.lamp.color.setHex(holdLeft[s.what] > 0 ? 0x40ff70 : 0xffa020);

    updatePresses(dt);
    updateCargo(dt);
    carry(dt);
    updateArms(dt);
    interactions.update(dt, game);

    // the belts' surfaces scroll with the belts
    beltMats.forEach((m, i) => {
      const map = m.map;
      if (map) map.offset.y -= (beltSpeed(i) * dt) / ((BELT_Z1 - BELT_Z0) / map.repeat.y);
    });
    moltenMat.emissiveIntensity = 1.5 + Math.sin(game.time * 2.3) * 0.2;
    smelterGlow.intensity = 130 + Math.sin(game.time * 3.1) * 15;

    // stations reached: earned by a living player passing them (the deck by standing on it)
    for (const p of game.players) {
      if (!p.alive) continue;
      for (let k = reached + 1; k < STATIONS.length; k++) {
        const got = k === 3 ? onDeck(p.position) && p.grounded : p.position.z > STATIONS[k].z && p.position.y > Y0 - 0.5;
        if (!got) continue;
        reached = k;
        ctx.checkpoint.copy(stationPos(k));
        ctx.announce(TEXT.banners.checkpoint, T.station(k + 1));
        audio.checkpointChime();
      }
      // the last stretch: the floor gives out and the line surges
      if (!surging && p.position.z > FLOOR_END - 2) {
        surging = true;
        audio.alarm(0.4);
        ctx.announce(T.surge, T.surgeSub);
        spawnLast(false);
      }
    }

    // the door
    if (releasing && doorOpen < 1) {
      doorOpen = Math.min(1, doorOpen + dt / 2.2);
      const m = doorSlab.mesh!;
      m.position.y = Y0 + BELT_TOP + DOOR.h / 2 + doorOpen * (DOOR.h - 0.3);
      doorLamp.color.setHex(0x40ff70);
      if (doorOpen >= 1) ctx.unsolid({ box: doorSlab.box });
    }
    if (doorOpen >= 1) {
      for (const p of game.players) {
        if (p.alive && p.position.x > HW + WALL_T * 0.6 && p.position.z > DOOR.z0 - 1 && p.position.z < DOOR.z1 + 1) complete = true;
      }
    }
  };

  const objective = () => {
    if (reached < 2) {
      const f = reached;
      return { pos: new THREE.Vector3(7.2, Y0 + BELT_TOP + 1, FRAMES[f]), label: T.pressLabel, hint: T.pressHint, beacon: false };
    }
    if (reached < 3) {
      return { pos: new THREE.Vector3(11, Y0 + BELT_TOP, DECK.z0 + 2), label: T.ledgeLabel, hint: reached === 2 ? T.armsHint : T.ledgeHint, beacon: false };
    }
    if (doorOpen < 1) return { pos: releaseAt.clone(), label: T.ledgeLabel, hint: releasing ? T.opening : T.releaseHint, beacon: false };
    return { pos: new THREE.Vector3(VX1 - 2, Y0 + BELT_TOP, (DOOR.z0 + DOOR.z1) / 2), label: T.doorLabel, hint: T.doorHint, beacon: false };
  };

  const respawnSpot = (slot: number): THREE.Vector3 => ctx.defaultRespawn(slot, stationPos(reached), new THREE.Vector3(0, 0, 1));

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const bars: SectionBar[] = [];
    const heldAny = (Object.keys(holdLeft) as (keyof typeof holdLeft)[]).filter((k) => holdLeft[k] > 0);
    for (const k of heldAny) bars.push({ label: k === 'arms' ? T.armsParked : k === 'press0' ? T.row1Held : T.row2Held, value: holdLeft[k] / HOLD, tone: 'good' });
    const at = interactions.hudFor(p.position);
    if (at) bars.push(at.bar);
    if (releasing && doorOpen < 1) bars.push({ label: T.doorBar, value: doorOpen, tone: 'info' });
    return { title: T.title, bars, line: at ? at.line : T.station(reached + 1) };
  };

  // ---- the autopilot ----
  // Everyone keeps to the right side: the right walkway, the fastest belt
  // (it runs past the door deck), the right catwalk's switches. Slot 0 runs
  // the switches it passes; the rest time the presses.
  type Step =
    | { k: 'go'; at: THREE.Vector3; station: number }
    | { k: 'switch'; s: number; station: number }
    | { k: 'frame'; f: number; station: number }
    | { k: 'ride'; station: number }
    | { k: 'release'; station: number }
    | { k: 'exit'; station: number };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, Y0 + y, z);
  const program = (runner: boolean): Step[] => [
    { k: 'go', at: V(11, 0, -1), station: 0 },
    { k: 'go', at: V(10, 0, 8), station: 0 },
    ...(runner ? [{ k: 'switch', s: 0, station: 0 } as Step] : []),
    { k: 'frame', f: 0, station: 0 },
    { k: 'go', at: V(10, 0, 50), station: 1 },
    { k: 'frame', f: 1, station: 1 },
    ...(runner ? [{ k: 'switch', s: 2, station: 2 } as Step] : []),
    { k: 'go', at: V(10, 0, FLOOR_END - 2), station: 2 },
    { k: 'ride', station: 2 },
    { k: 'release', station: 3 },
    { k: 'exit', station: 3 },
  ];
  const programs = [0, 1, 2, 3].map((s) => program(s === 0));
  const phase = [0, 0, 0, 0];      // a step's own sub-stage

  const steer = (p: Player, at: THREE.Vector3, out: AutopilotInput, opts: { fly?: boolean; slow?: boolean } = {}): number => {
    const dx = at.x - p.position.x, dz = at.z - p.position.z;
    const flat = Math.hypot(dx, dz);
    out.yaw = Math.atan2(dx, dz);
    // the stick reads as a gait (0.6 and under walks at 1.4 m/s): 0.76 keeps the
    // careful pace a jog, about 5.5 m/s
    if (flat > 0.35) out.moveY = Math.min(opts.slow ? 0.76 : 1, flat / 2);
    const dy = at.y - p.position.y;
    if (dy > 0.5 || opts.fly) {
      out.jumpHeld = true;
      if (p.grounded) out.jumpPressed = true;
    }
    return flat;
  };

  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    const prog = programs[slot];
    // re-formed at a station behind the step in hand: pick the route up from there
    if (lastPos[slot].distanceTo(p.position) > 6) {
      const c = prog.findIndex((s) => s.station >= reached);
      cursors[slot] = Math.max(0, c);
      phase[slot] = 0;
    }
    lastPos[slot].copy(p.position);
    let c = cursors[slot];
    if (c >= prog.length) c = prog.length - 1;
    const step = prog[c];
    const out: AutopilotInput = { shootHeld: true };
    const next = (): AutopilotInput => { cursors[slot] = c + 1; phase[slot] = 0; return out; };
    switch (step.k) {
      case 'go': {
        const d = steer(p, step.at, out);
        if (d < 1.2 && Math.abs(step.at.y - p.position.y) < 1.5) return next();
        return out;
      }
      case 'switch': {
        const sw = switches[step.s];
        if (holdLeft[sw.what] > 0 && phase[slot] < 3) phase[slot] = 3;
        if (phase[slot] === 0) {
          // stand inboard of the catwalk, under nothing
          const d = steer(p, V(sw.x > 0 ? 10 : -10, 0, sw.z - 1), out);
          if (d < 0.8 && p.grounded) phase[slot] = 1;
        } else if (phase[slot] === 1) {
          // rise past the catwalk's edge, then step in over it
          out.yaw = Math.atan2(sw.x - p.position.x, 0.001);
          out.jumpHeld = true;
          if (p.grounded) out.jumpPressed = true;
          if (p.position.y > Y0 + CAT_Y + 1.2) phase[slot] = 2;
        } else if (phase[slot] === 2) {
          const d = steer(p, sw.at, out, { slow: true });
          if (p.position.y > Y0 + CAT_Y + 1.6) { out.jumpHeld = false; out.jumpPressed = false; }
          if (d < 1.4 && Math.abs(p.position.y - (Y0 + CAT_Y)) < 0.6) { out.interactHeld = true; delete out.moveY; }
        } else {
          // thrown: step off inboard and carry on
          const d = steer(p, V(sw.x > 0 ? 9.8 : -9.8, 0, sw.z + 2), out);
          if (d < 1.0 && p.position.y < Y0 + 0.6) return next();
        }
        return out;
      }
      case 'frame': {
        const fz = FRAMES[step.f];
        const pr = presses.find((q) => q.frame === step.f && q.belt === 3)!;
        const crateNear = crates.some((q) => q.gone < 0 && q.belt === 3 && q.z > fz - 6 && q.z < fz + FRAME_D + 2);
        if (phase[slot] === 0) {
          const d = steer(p, V(10, 0, fz - 2.2), out);
          if (d < 0.9) { delete out.moveY; if (pressSafe(pr) > 1.5 && !crateNear) phase[slot] = 1; }
        } else if (phase[slot] === 1) {
          // up onto the belt, short of the press
          steer(p, V(BELT_X[3] + 0.4, BELT_TOP, fz - 1.0), out);
          if (Math.abs(p.position.y - (Y0 + BELT_TOP)) < 0.3 && p.grounded && beltOf(p.position.x, 0.4) === 3) phase[slot] = 2;
          if (p.position.z > fz - 0.5) phase[slot] = 2;
        } else if (phase[slot] === 2) {
          steer(p, V(BELT_X[3], BELT_TOP, fz + FRAME_D + 2), out);
          if (p.position.z > fz + FRAME_D + 1) phase[slot] = 3;
        } else {
          const d = steer(p, V(10, 0, fz + FRAME_D + 3.5), out);
          if (d < 1.0 && p.position.y < Y0 + 0.5) return next();
        }
        return out;
      }
      case 'ride': {
        if (phase[slot] === 0) {
          steer(p, V(BELT_X[3] - 0.2, BELT_TOP, FLOOR_END - 0.4), out);
          if (beltOf(p.position.x, 0.3) === 3 && Math.abs(p.position.y - (Y0 + BELT_TOP)) < 0.4) phase[slot] = 1;
          // missed it and ended on the deck already: fine
          if (onDeck(p.position)) return next();
        } else {
          // let the belt carry you past the pit, then step right, onto the deck
          if (p.position.z < DECK.z0 + 0.8) { out.yaw = Math.atan2(0, 1); return out; }
          steer(p, V(11.2, BELT_TOP, p.position.z + 1), out);
          if (onDeck(p.position) && p.position.x > DECK.x0 + 1) return next();
        }
        return out;
      }
      case 'release': {
        if (releasing) return next();
        const d = steer(p, releaseAt, out);
        if (d < 1.4) { delete out.moveY; out.interactHeld = true; }
        return out;
      }
      case 'exit': {
        if (doorOpen < 1) { steer(p, releaseAt, out); if (release.inReach(p.position)) delete out.moveY; return out; }
        steer(p, V(VX1 - 1.5, BELT_TOP, (DOOR.z0 + DOOR.z1) / 2), out);
        return out;
      }
    }
    return out;
  };

  const inst: SectionInstance & { test: object } = {
    starts: [0, 1, 2, 3].map((i) => new THREE.Vector3(2.5 + (i % 2) * 2, Y0, -4.5 - Math.floor(i / 2) * 1.8)),
    floorY: Y0,
    ceilingY: Y0 + ROOF - 0.5,
    groundAt: () => Y0,
    contains: (x, z) => (Math.abs(x) < HW && z > ENTRY_Z && z < SMELTER_Z1)
      || (x >= HW - 0.5 && x < VX1 && z > DOOR.z0 - 1 && z < DOOR.z1 + 1),
    path,
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    // the slag pit and the smelter's mouth: the belts deliver you, the line re-forms you
    offPath: (pos) => pos.y < Y0 - 1.2 || (pos.z > BELT_Z1 + 0.6 && pos.y < Y0 + BELT_TOP + 1.5),
    hud,
    autopilot,
    dispose: () => {
      for (const p of game.players) p.sectionMove = null;
      if (ctx.board.breakables) ctx.board.breakables = ctx.board.breakables.filter((b) => !breakables.includes(b));
      // a barrel broken when the stage fell has its collider out of the world already
      for (const b of breakables) {
        const i = ctx.board.physics.boxes.indexOf(b.box);
        if (i >= 0) ctx.board.physics.boxes.splice(i, 1);
      }
    },
    // handles for the mechanics suite (tools/test-section-refinery.mjs)
    test: { presses, crates, arms, switches, holdLeft, beltSpeed, BELT_X, BELT_TOP, FRAMES, FRAME_D },
    debug: () => ({
      reached, surging, releasing, doorOpen: +doorOpen.toFixed(2),
      held: { ...holdLeft },
      presses: presses.map((q) => q.phase[0]).join(''),
    }),
  };
  return inst;
}

export const theLine: SectionDef = {
  id: 'the-line',
  build,
  // the plant's own air: sodium haze, the smelter a glow at the far end
  world: { fogColor: 0x16130f, fogNear: 30, fogFar: 150 },
};
