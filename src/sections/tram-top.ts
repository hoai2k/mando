import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy, EnemyKind } from '../enemies/enemy';
import type { StaticBox } from '../core/physics';
import { Mover, addBreakable, type Breakable } from '../world/board';
import { RailCamera, type RailPose } from './kit/railcam';
import { Treadmill } from './kit/treadmill';
import { composeMoves } from './kit/moves';
import { clamp, yawBasis } from '../core/math';
import { audio } from '../core/audio';

/**
 * Tram Top (docs/LEVEL_SECTIONS.md §2.15) — the Ringworld, after the market
 * arcade, before the night-side row.
 *
 * The classic: a fight on the roof of a moving train. The arcade's way on is
 * the tram stop's platform gate; the tram is waiting, doors open. Once the
 * whole party is aboard it pulls out, and it runs the length of the ring's
 * high line to the terminus, where the next stage begins behind the
 * terminus gate.
 *
 * **Built on K2 and K1.** The tram never moves (K2, `kit/treadmill.ts`): its
 * three cars are static colliders, and the city — the towers, the pylons, the
 * street far below, every gantry, both stations and the tunnel — scrolls past
 * it. So every body on the roof walks, fights and falls by the ordinary rules.
 * One rail camera (K1, `kit/railcam.ts`) frames the whole train from its
 * flank, elevated, with the track ahead in the right of the frame; the sticks
 * are turned to the screen (stick right is along the train, stick up is
 * across it, away from the lens), because a flank camera with the rail's own
 * basis would put "up" on the screen's right.
 *
 * **The line, in five stretches**, hung on the treadmill's odometer:
 *
 * 1. **Street run** — pirates come over the front car, two swoops run
 *    alongside, jet pirates drop on.
 * 2. **Gantries** — ten sign gantries 1.4 m over the roof, 70 m apart. A horn
 *    and a red lamp three seconds out; duck (hold Y, the roof crouch) or jump
 *    it. Anything standing when it passes is swept off — enemies too.
 * 3. **The station** — the tram stops dead at a platform for 30 s: a squad
 *    boards through the doors below while snipers work from the canopy.
 * 4. **The tunnel** — one metre of clearance over the roof, so everyone drops
 *    through the roof hatches and fights *inside* the cars for its length (the
 *    camera drops to look in through the windows), then climbs back out.
 * 5. **The rival tram** — a pirate tram pulls alongside on the parallel track
 *    with gunners on its roof. Jump across and clear it, or shoot out the
 *    coupling between its cars. It peels off at the junction, and the tram
 *    rolls into the terminus.
 *
 * **Nothing is left behind.** The tram does not leave the stop until every
 * hunter is aboard. Swept or knocked off, you re-form on the rear car's roof
 * (inside the rear car while the tunnel is over it, or while a gantry is on
 * top of it). Anyone still on the pirate tram when it peels off is put back
 * aboard. The fallen come back the same way.
 */

// ---- the tram ----
const CAR_L = 14;
const CAR_W = 4;
const HALF_W = CAR_W / 2;
/** the three cars' centres, rear to front, along +x (the way the tram runs) */
const CARS = [-16, 0, 16];
const FRONT_X = 23;
const REAR_X = -23;
/** roof top over the car floor (the section floor) */
const ROOF = 3.2;
const ROOF_T = 0.4;
/** the roof hatch in each car, from its centre, and its half size */
const HATCH_DX = 3.5;
const HATCH_H = 0.95;
/** the doors, platform side (−z), from each car's centre */
const DOORS_DX = [-3.5, 3.5];
const DOOR_W = 1.5;
/** the rival's track and the platforms are on the far side (−z) */
const RIVAL_Z = -7.2;
const PLATFORM_Z0 = -HALF_W - 0.25;
const PLATFORM_Z1 = -10;

// ---- the line ----
const SPEED = 10;
const TUNNEL_SPEED = 6;
const GANTRY_FROM = 420;
const GANTRIES = 10;
const GANTRY_EVERY = 70;
/** a gantry's beam: its underside over the roof, and its depth */
const GANTRY_CLEAR = 1.4;
const GANTRY_BEAM = 0.7;
/** the horn sounds this many seconds out */
const GANTRY_WARN = 3;
const STATION_AT = 1200;
const STATION_STOP = 30;
const TUNNEL_AT = 1480;
const TUNNEL_LEN = 160;
/** the rival pulls alongside this far past the tunnel's end */
const RIVAL_AFTER = 70;
/** the terminus is this far past the point the rival peels off */
const TERMINUS_AFTER = 240;
/** a standing body's height over its feet, and a ducking one's */
const STAND_H = 1.8;
const DUCK_H = 1.05;

type Phase = 'board' | 'run' | 'station' | 'tunnel' | 'rival' | 'terminus' | 'out';

function build(ctx: SectionContext): SectionInstance & { testKit: unknown } {
  const { game, spec } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections['tram-top'];
  const party = Math.max(1, game.players.length);
  const roofY = Y0 + ROOF;
  const board = ctx.board;

  // ---- materials ----
  const hullMat = ctx.paint(0xb4bac4, { rough: 0.3, metal: 0.7 });
  const roofMat = ctx.paint(0x7c828c, { rough: 0.55, metal: 0.6 });
  ctx.tile(roofMat, 'metal_deck', 4, 1);
  const darkMat = ctx.paint(0x24272e, { rough: 0.6, metal: 0.5 });
  const floorMat = ctx.paint(0x3a3d44, { rough: 0.8, metal: 0.3 });
  const seatMat = ctx.paint(0x6a3a30, { rough: 0.85, metal: 0.05 });
  const stripe = new THREE.MeshBasicMaterial({ color: 0xff3a30 });
  ctx.own(stripe);
  const glass = new THREE.MeshStandardMaterial({
    color: 0xffd9a0, emissive: 0xffb060, emissiveIntensity: 0.35, transparent: true, opacity: 0.28,
    roughness: 0.1, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide,
  });
  ctx.own(glass);
  const concrete = ctx.paint(0x5a5e68, { rough: 0.9, metal: 0.1 });
  ctx.tile(concrete, 'street_paving', 6, 2);
  const warm = new THREE.MeshBasicMaterial({ color: 0xffb070 });
  ctx.own(warm);
  const red = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  ctx.own(red);
  const green = new THREE.MeshBasicMaterial({ color: 0x5ee08a });
  ctx.own(green);
  const trim = new THREE.MeshBasicMaterial({ color: spec.palette.accent });
  ctx.own(trim);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  ctx.own(boxGeo);
  /** a mesh box (no collider) under `parent` */
  const vbox = (parent: THREE.Object3D, x: number, y: number, z: number, sx: number, sy: number, sz: number,
    m: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(boxGeo, m);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // ================================================================ the cars
  // Three cars and two gangways: a floor, a roof with a hatch, a camera-side
  // wall that is mostly glass (so the tunnel fight can be seen from outside),
  // and a platform-side wall with two doors that open at the stops.
  type Door = { box: StaticBox | null; x: number; mesh: THREE.Mesh; open: number; want: number };
  const doors: Door[] = [];
  const hatches: THREE.Vector3[] = [];
  const carLights: THREE.PointLight[] = [];
  for (const cx of CARS) {
    const x0 = cx - CAR_L / 2, x1 = cx + CAR_L / 2;
    // floor and underframe
    ctx.box(cx, Y0 - 0.25, 0, CAR_L, 0.5, CAR_W, floorMat);
    vbox(ctx.group, cx, Y0 - 1.0, 0, CAR_L - 1, 1.0, CAR_W - 0.8, darkMat);
    // the roof, round its hatch
    const hx = cx + HATCH_DX;
    const ry = roofY - ROOF_T / 2;
    ctx.box((x0 + hx - HATCH_H) / 2, ry, 0, hx - HATCH_H - x0, ROOF_T, CAR_W, roofMat);
    ctx.box((hx + HATCH_H + x1) / 2, ry, 0, x1 - hx - HATCH_H, ROOF_T, CAR_W, roofMat);
    ctx.box(hx, ry, (HATCH_H + HALF_W) / 2, HATCH_H * 2, ROOF_T, HALF_W - HATCH_H, roofMat);
    ctx.box(hx, ry, -(HATCH_H + HALF_W) / 2, HATCH_H * 2, ROOF_T, HALF_W - HATCH_H, roofMat);
    hatches.push(new THREE.Vector3(hx, roofY, 0));
    // the hatch's lid, thrown open, and a lit rim so the way down reads
    const lid = vbox(ctx.group, hx - HATCH_H - 0.05, roofY + 0.8, 0, 0.08, 1.6, HATCH_H * 2, darkMat);
    lid.rotation.z = 0.35;
    for (const [ox, oz, sx, sz] of [[HATCH_H, 0, 0.1, HATCH_H * 2], [-HATCH_H, 0, 0.1, HATCH_H * 2],
      [0, HATCH_H, HATCH_H * 2, 0.1], [0, -HATCH_H, HATCH_H * 2, 0.1]] as const) {
      vbox(ctx.group, hx + ox, roofY + 0.03, oz, sx, 0.06, sz, warm);
    }
    // a roof unit at the rear of each car: low cover
    ctx.box(cx - 4.5, roofY + 0.3, 0, 2.2, 0.6, 2.4, darkMat);
    // camera side (+z): a low panel, glass, a header — one collider
    ctx.box(cx, Y0 + ROOF / 2, HALF_W - 0.1, CAR_L, ROOF, 0.2, null);
    vbox(ctx.group, cx, Y0 + 0.5, HALF_W - 0.1, CAR_L, 1.0, 0.22, hullMat);
    vbox(ctx.group, cx, Y0 + 2.75, HALF_W - 0.1, CAR_L, 0.5, 0.22, hullMat);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(CAR_L - 0.4, 1.7), glass);
    ctx.own(pane.geometry);
    pane.position.set(cx, Y0 + 1.85, HALF_W + 0.02);
    ctx.mesh(pane);
    for (let k = -3; k <= 3; k++) vbox(ctx.group, cx + k * 2, Y0 + 1.85, HALF_W - 0.05, 0.18, 1.7, 0.26, hullMat);
    vbox(ctx.group, cx, Y0 + 0.95, HALF_W + 0.03, CAR_L, 0.1, 0.04, stripe);
    // platform side (−z): wall segments round two doors
    const edges = [x0, ...DOORS_DX.flatMap((d) => [cx + d - DOOR_W / 2, cx + d + DOOR_W / 2]), x1];
    for (let k = 0; k < edges.length; k += 2) {
      const a = edges[k], b = edges[k + 1];
      ctx.box((a + b) / 2, Y0 + ROOF / 2, -HALF_W + 0.1, b - a, ROOF, 0.2, hullMat);
      const pz = -HALF_W - 0.02;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.2, b - a - 0.5), 1.4), glass);
      ctx.own(win.geometry);
      win.position.set((a + b) / 2, Y0 + 1.9, pz);
      ctx.mesh(win);
      vbox(ctx.group, (a + b) / 2, Y0 + 0.95, pz - 0.02, b - a, 0.1, 0.04, stripe);
    }
    for (const d of DOORS_DX) {
      const x = cx + d;
      const mesh = vbox(ctx.group, x, Y0 + 1.25, -HALF_W + 0.08, DOOR_W, 2.5, 0.12, darkMat);
      const box = ctx.box(x, Y0 + 1.25, -HALF_W + 0.1, DOOR_W, 2.5, 0.2, null).box;
      // the lintel over the door
      ctx.box(x, Y0 + 2.85, -HALF_W + 0.1, DOOR_W, 0.7, 0.2, hullMat);
      doors.push({ box, x, mesh, open: 0, want: 0 });
    }
    // end walls with a gangway opening (the front and rear ends are solid)
    for (const [ex, sgn] of [[x0, -1], [x1, 1]] as const) {
      const outer = (sgn < 0 && cx === CARS[0]) || (sgn > 0 && cx === CARS[2]);
      if (outer) {
        ctx.box(ex - sgn * 0.1, Y0 + ROOF / 2, 0, 0.2, ROOF, CAR_W, hullMat);
        // a nose (front) or a tail light bar (rear)
        vbox(ctx.group, ex + sgn * 0.12, Y0 + 2.2, 0, 0.06, 0.25, CAR_W - 0.6, sgn > 0 ? warm : red);
      } else {
        for (const s of [-1, 1]) ctx.box(ex - sgn * 0.1, Y0 + ROOF / 2, s * (HALF_W - 0.6), 0.2, ROOF, 1.2, hullMat);
      }
    }
    // seats and poles: cover inside
    for (const sx of [-5, 0.5]) for (const s of [-1, 1]) ctx.box(cx + sx, Y0 + 0.25, s * (HALF_W - 0.55), 2.4, 0.5, 0.7, seatMat);
    ctx.cyl(cx - 1.8, Y0 + ROOF / 2, 0, 0.06, ROOF, trim);
    const light = new THREE.PointLight(0xffc890, 6, 10, 1.6);
    light.position.set(cx, Y0 + 2.5, 0);
    ctx.mesh(light);
    carLights.push(light);
  }
  // the gangways: a floor, walls and a roof plate over each coupling
  for (const gx of [-8, 8]) {
    ctx.box(gx, Y0 - 0.25, 0, 2.2, 0.5, 2.4, floorMat);
    for (const s of [-1, 1]) ctx.box(gx, Y0 + ROOF / 2, s * 1.3, 2.2, ROOF, 0.2, darkMat);
    ctx.box(gx, roofY - ROOF_T / 2, 0, 2.2, ROOF_T, 2.6, roofMat);
  }

  // ---- the monorail beams under both tracks (static: the texture slides) ----
  const beamMat = ctx.paint(0x3a3e46, { rough: 0.6, metal: 0.6 });
  ctx.tile(beamMat, 'metal_deck', 120, 1);
  for (const z of [0, RIVAL_Z]) {
    const beam = vbox(ctx.group, 0, Y0 - 2.1, z, 600, 1.4, 1.6, beamMat);
    void beam;
  }

  // ================================================================ the city
  const mill = new Treadmill({ dir: new THREE.Vector3(-1, 0, 0), speed: 0, ease: 2, board });
  mill.strip(() => beamMat.map, { metresPerRepeat: 10, axis: 'x', sign: 1 });
  // the street, far below
  const streetMat = ctx.paint(0x3a3040, { rough: 0.9, metal: 0.1 });
  ctx.tile(streetMat, 'street_paving', 80, 60);
  const street = new THREE.Mesh(new THREE.PlaneGeometry(900, 700), streetMat);
  ctx.own(street.geometry);
  street.rotation.x = -Math.PI / 2;
  street.position.set(0, Y0 - 48, 0);
  ctx.mesh(street);
  mill.strip(() => streetMat.map, { metresPerRepeat: 900 / 80, axis: 'x', sign: 1 });
  // pylons under the beams, every 40 m
  for (let k = 0; k < 12; k++) {
    const g = new THREE.Group();
    vbox(g, 0, -25, 0, 1.4, 46, 1.4, darkMat);
    vbox(g, 0, -25, RIVAL_Z, 1.4, 46, 1.4, darkMat);
    vbox(g, 0, -2.6, RIVAL_Z / 2, 1.2, 0.8, Math.abs(RIVAL_Z) + 2, darkMat);
    g.position.set(-240 + k * 40, Y0, 0);
    ctx.mesh(g);
    mill.conveyor(g, { behind: 240 - (-240 + k * 40) + 20, loop: 480 });
  }
  // towers: tall on the far side, low on the camera's side so the lens sees over them
  const cityMat = ctx.paint(0x485068, { rough: 0.8, metal: 0.25 });
  ctx.tile(cityMat, 'city_facade', 3, 10, { glow: 'city_facade_glow' });
  const cityMat2 = ctx.paint(0x3a4058, { rough: 0.8, metal: 0.25 });
  ctx.tile(cityMat2, 'city_facade', 2, 14, { glow: 'city_facade_glow' });
  let seed = 4127;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 44; k++) {
    const far = k % 4 !== 0;
    const x = -300 + (k / 44) * 600 + rnd() * 10;
    const z = far ? -42 - rnd() * 110 : 34 + rnd() * 70;
    const w = 12 + rnd() * 20, d = 12 + rnd() * 20;
    const top = far ? (k % 3 === 0 ? -20 - rnd() * 16 : -4 + rnd() * 64) : -12 - rnd() * 18;
    const h = top + 48;
    const m = new THREE.Mesh(boxGeo, k % 3 ? cityMat : cityMat2);
    m.scale.set(w, h, d);
    m.position.set(x, Y0 - 48 + h / 2, z);
    ctx.mesh(m);
    mill.conveyor(m, { behind: 300 - x + 20, loop: 600 });
  }
  // the far skyline, slow: a parallax row
  for (let k = 0; k < 14; k++) {
    const h = 60 + rnd() * 110;
    const m = new THREE.Mesh(boxGeo, cityMat2);
    m.scale.set(30 + rnd() * 30, h, 30);
    const x = -420 + k * 60;
    m.position.set(x, Y0 - 48 + h / 2, -240 - rnd() * 60);
    ctx.mesh(m);
    mill.parallax(m, 0.25, 840, 420 - x + 30);
  }

  // ================================================================ the gantries
  // A sign gantry over the track every 70 m through the second stretch: two
  // posts, a beam 1.4 m over the roof, a neon sign on it and a red lamp that
  // flashes from three seconds out.
  const signMat = new THREE.MeshStandardMaterial({ color: 0x151515, emissive: 0x4ad8ff, emissiveIntensity: 1.2, side: THREE.DoubleSide });
  ctx.own(signMat);
  ctx.tile(signMat, 'neon_sign_2', 1, 1, { glow: 'neon_sign_2' });
  type Gantry = { mark: number; lamp: THREE.Mesh; warned: boolean; prevX: number };
  const gantries: Gantry[] = [];
  const beamBottom = roofY + GANTRY_CLEAR;
  for (let k = 0; k < GANTRIES; k++) {
    const mark = GANTRY_FROM + k * GANTRY_EVERY;
    const g = new THREE.Group();
    vbox(g, 0, beamBottom + GANTRY_BEAM / 2 - Y0, -0.5, GANTRY_BEAM, GANTRY_BEAM, CAR_W + 5, darkMat);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.6), signMat);
    ctx.own(sign.geometry);
    sign.position.set(0, beamBottom + GANTRY_BEAM + 0.8 - Y0, -0.5);
    sign.rotation.y = Math.PI / 2;
    g.add(sign);
    for (const z of [-3.2, 2.9]) vbox(g, 0, (beamBottom + GANTRY_BEAM - Y0 - 5) / 2 + 0.5, z, 0.35, beamBottom + GANTRY_BEAM - Y0 + 4, 0.35, darkMat);
    const lamp = vbox(g, 0, beamBottom - Y0 - 0.06, 0, GANTRY_BEAM + 0.1, 0.12, CAR_W, darkMat);
    g.position.set(FRONT_X + mark, Y0, 0);
    ctx.mesh(g);
    mill.conveyor(g, { behind: FRONT_X + mark - REAR_X + 60 });
    gantries.push({ mark, lamp, warned: false, prevX: FRONT_X + mark });
  }
  /** a gantry's beam, along x, now */
  const gantryX = (g: Gantry): number => FRONT_X + g.mark - mill.travelled;

  // ================================================================ platforms
  // The tram stop, the station and the terminus: a platform on the far side
  // at the car floor's height, a canopy over its back half, and a back wall
  // with a gate in it. Each travels with the city (its colliders are a mover,
  // so whoever stands on it is carried out of shot when the tram leaves it).
  type Platform = { group: THREE.Group; canopyTop: number; gate: THREE.Vector3; item: ReturnType<Treadmill['conveyor']> | null };
  const makePlatform = (x: number, len: number, opts: { gate: 'shut' | 'open'; sign?: string; canopy?: boolean }): Platform => {
    const g = new THREE.Group();
    const boxes: StaticBox[] = [];
    const solid = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, m: THREE.Material | null): void => {
      const { box } = ctx.box(x + cx, cy, cz, sx, sy, sz, null);
      boxes.push(box);
      if (m) vbox(g, cx, cy, cz, sx, sy, sz, m);
    };
    const pz = (PLATFORM_Z0 + PLATFORM_Z1) / 2, pw = PLATFORM_Z0 - PLATFORM_Z1;
    solid(0, Y0 - 0.5, pz, len, 1, pw, concrete);
    vbox(g, 0, Y0 + 0.02, PLATFORM_Z0 - 0.25, len, 0.04, 0.3, warm);          // the edge line
    // the back wall, with the gate in its middle
    const wz = PLATFORM_Z1 - 0.4;
    const gw = 4.2;
    solid(-(len / 2 + gw / 2) / 2, Y0 + 3.5, wz, len / 2 - gw / 2, 7, 0.8, cityMat);
    solid((len / 2 + gw / 2) / 2, Y0 + 3.5, wz, len / 2 - gw / 2, 7, 0.8, cityMat);
    solid(0, Y0 + 5.5, wz, gw, 3, 0.8, cityMat);
    const gate = new THREE.Vector3(x, Y0, PLATFORM_Z1 + 0.6);
    // the gate: shut (the tram stop's, behind the party) or open and lit (the terminus)
    if (opts.gate === 'shut') solid(0, Y0 + 2, wz + 0.1, gw, 4, 0.3, darkMat);
    else {
      vbox(g, 0, Y0 + 2, wz - 0.3, gw, 4, 0.1, new THREE.MeshBasicMaterial({ color: 0x0c0a08 }));
      const glow = new THREE.PointLight(0xffb070, 20, 12, 1.5);
      glow.position.set(0, Y0 + 2.6, wz + 1.2);
      g.add(glow);
    }
    vbox(g, 0, Y0 + 4.15, wz + 0.45, gw + 0.4, 0.14, 0.12, opts.gate === 'open' ? green : red);
    let canopyTop = Y0 + 6.6;
    if (opts.canopy !== false) {
      solid(0, Y0 + 6.4, (PLATFORM_Z1 - 5) / 2 + 0.2, len * 0.8, 0.4, 5.5, darkMat);
      canopyTop = Y0 + 6.6;
      for (const px of [-0.3, 0, 0.3]) solid(px * len, Y0 + 3.1, -8.6, 0.4, 6.2, 0.4, darkMat);
    }
    if (opts.sign) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.2), signMats(opts.sign));
      s.position.set(0, Y0 + 6.1, wz + 0.45);
      g.add(s);
    }
    // benches and a kiosk: cover on the platform
    solid(-len * 0.25, Y0 + 0.3, -7.5, 3, 0.6, 0.8, seatMat);
    solid(len * 0.2, Y0 + 0.3, -7.5, 3, 0.6, 0.8, seatMat);
    g.position.set(x, 0, 0);
    ctx.mesh(g);
    // the first box is the envelope a rider stands on; the rest ride with it
    const env = boxes[0];
    const item = mill.conveyor(g, { behind: x + len + 80, boxes: [env, ...boxes.slice(1)] });
    return { group: g, canopyTop, gate, item };
  };
  const signCache = new Map<string, THREE.Material>();
  function signMats(name: string): THREE.Material {
    let m = signCache.get(name);
    if (!m) {
      const mm = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb040, emissiveIntensity: 1.2, side: THREE.DoubleSide });
      ctx.own(mm);
      ctx.tile(mm, name, 1, 1, { glow: name });
      m = mm;
      signCache.set(name, m);
    }
    return m;
  }
  // the tram stop: the party came through its gate from the arcade
  makePlatform(0, 60, { gate: 'shut', sign: 'neon_sign' });
  const station = makePlatform(STATION_AT, 64, { gate: 'shut', sign: 'neon_sign_3' });
  let terminus: Platform | null = null;
  let terminusMark = Infinity;

  // ================================================================ the tunnel
  // A box of dark over the line: a ceiling one metre over the roof and a far
  // wall. The camera side is cut away (the lens looks in through the cars'
  // windows). Strip lights on its ceiling slide by.
  const tunnelG = new THREE.Group();
  const tunnelMat = ctx.paint(0x2a2c32, { rough: 0.9, metal: 0.2 });
  vbox(tunnelG, TUNNEL_LEN / 2, roofY + 1 + 2 - Y0, -1, TUNNEL_LEN, 4, CAR_W + 10, tunnelMat);
  vbox(tunnelG, TUNNEL_LEN / 2, 0, -5.5, TUNNEL_LEN, 16, 1, tunnelMat);
  vbox(tunnelG, -0.5, roofY + 2 - Y0, 2.5, 1, 6, 1.2, tunnelMat);   // the portal's lintel edge, camera side
  for (let k = 0; k < TUNNEL_LEN; k += 8) vbox(tunnelG, k, roofY + 0.98 - Y0, -1.5, 3, 0.05, 0.2, warm);
  const portal = vbox(tunnelG, -0.6, roofY + 1.2 - Y0, -1, 0.3, 0.4, CAR_W + 10, new THREE.MeshBasicMaterial({ color: 0xffc040 }));
  ctx.own(portal.material as THREE.Material);
  tunnelG.position.set(FRONT_X + TUNNEL_AT, Y0, 0);
  ctx.mesh(tunnelG);
  mill.conveyor(tunnelG, { behind: FRONT_X + TUNNEL_AT - REAR_X + TUNNEL_LEN + 60 });
  /** the tunnel's mouth and its far end, along x, now */
  const tunnelMouth = (): number => FRONT_X + TUNNEL_AT - mill.travelled;
  const tunnelEnd = (): number => tunnelMouth() + TUNNEL_LEN;
  const underTunnel = (x: number): boolean => x >= tunnelMouth() - 0.5 && x <= tunnelEnd() + 0.5;

  // ================================================================ the rival tram
  // Two cars on the parallel track, gunners on the roof, the coupling a live
  // conduit box between the cars. Its colliders are a mover the section
  // places itself (it is on a track of its own, not the city's scroll).
  const rivalG = new THREE.Group();
  const rivalMat = ctx.paint(0x6a2a28, { rough: 0.45, metal: 0.6 });
  const rivalBoxes: StaticBox[] = [];
  const RIVAL_CARS = [-8, 8];
  for (const cx of RIVAL_CARS) {
    vbox(rivalG, cx, ROOF / 2 - 0.2, 0, CAR_L, ROOF + 0.4, CAR_W, rivalMat);
    vbox(rivalG, cx, 1.1, HALF_W + 0.02, CAR_L, 0.12, 0.04, stripe);
    vbox(rivalG, cx, 1.9, HALF_W + 0.02, CAR_L - 1, 1.0, 0.03, glass);
    vbox(rivalG, cx - 3, ROOF + 0.35, 0.8, 1.6, 0.7, 1.2, darkMat);      // gunner cover
  }
  // the coupling: dark and cold while the pirate tram rides up, live (lit
  // cyan, and only then a target) once it is alongside
  const couplingLive = new THREE.MeshBasicMaterial({ color: 0x66e0ff });
  const couplingCold = new THREE.MeshBasicMaterial({ color: 0x1c2a30 });
  ctx.own(couplingCold);
  ctx.own(couplingLive);
  const coupling = vbox(rivalG, 0, ROOF - 0.6, 0, 2.2, 0.8, 1.2, couplingCold);
  ctx.own(coupling.material as THREE.Material);
  rivalG.position.set(-400, Y0, RIVAL_Z);
  rivalG.visible = false;
  ctx.mesh(rivalG);
  for (const cx of RIVAL_CARS) {
    rivalBoxes.push(ctx.box(-400 + cx, Y0 + ROOF / 2 - 0.2, RIVAL_Z, CAR_L, ROOF + 0.4, CAR_W, null).box);
    rivalBoxes.push(ctx.box(-400 + cx - 3, Y0 + ROOF + 0.35, RIVAL_Z + 0.8, 1.6, 0.7, 1.2, null).box);
  }
  const couplingBox = ctx.box(-400, Y0 + ROOF - 0.6, RIVAL_Z, 2.2, 0.8, 1.2, null).box;
  const rivalMover = new Mover(rivalBoxes[0], null);
  rivalMover.carry([...rivalBoxes.slice(1), couplingBox]);
  rivalMover.moveTo(-400 + RIVAL_CARS[0], Y0 + ROOF / 2 - 0.2, RIVAL_Z);
  (board.movers ??= []).push(rivalMover);
  const couplingHp = 280 + 140 * party;
  const couplingB: Breakable = addBreakable(board, coupling, couplingBox, couplingHp, {
    radius: 1.3,
    onBreak: () => peelOff('cut'),
  });
  // not a target until the pirate tram is alongside (see 'alongside' below)
  board.breakables = (board.breakables ?? []).filter((x) => x !== couplingB);
  const rival = { state: 'away' as 'away' | 'coming' | 'alongside' | 'peeling' | 'gone', t: 0, x: -400, z: RIVAL_Z, gunners: [] as Enemy[] };
  const placeRival = (x: number, z: number): void => {
    rival.x = x; rival.z = z;
    rivalG.position.set(x, Y0, z);
    rivalMover.moveTo(x + RIVAL_CARS[0], Y0 + ROOF / 2 - 0.2, z);
    couplingB.center.set(x, Y0 + ROOF - 0.6, z);
  };

  // ================================================================ the rail camera
  const lane: THREE.Vector3[] = [];
  for (let x = REAR_X + 1; x <= FRONT_X - 1 + 1e-6; x += 1) lane.push(new THREE.Vector3(x, roofY, 0));
  // a hand on the camera for the tunnel and the wide beats, eased
  let tunnelCam = 0;
  let wideCam = 0;
  const rail = new RailCamera({
    lane,
    lead: 0.5,
    span: 64,
    maxSpeed: 6,
    fov: 50,
    width: 16,
    stop: FRONT_X - REAR_X - 2,
    pose: (s: number, _zoom: number, out: RailPose) => {
      // off the flank, elevated, the track ahead in the right of the frame
      const fx = clamp(REAR_X + 1 + s, -8, 8) * 0.35 + 3;
      const w = wideCam, t = tunnelCam;
      out.eye.set(fx - 3, roofY + 6.5 + w * 3.5, 22 + w * 5);
      out.look.set(fx + 4, roofY - 0.2 - w * 1.2, -2 - w * 2.5);
      // in the tunnel: down to the windows, close
      out.eye.lerp(new THREE.Vector3(fx - 1, Y0 + 2.4, 10.5), t);
      out.look.lerp(new THREE.Vector3(fx + 3, Y0 + 1.3, -0.5), t);
    },
  });

  // ================================================================ state
  let phase: Phase = 'board';
  let started = false;
  let complete = false;
  let releasing = false;
  let t = 0;
  let aboardT = 0;
  let stationT = 0;
  let stationDone = false;
  let stationSpawned = false;
  let tunnelWarned = false;
  let tunnelStowed = false;
  let tunnelPassed = false;
  let rivalMark = Infinity;
  let jetWaves = 0;
  let climbers = false;
  let sweptNote = 0;
  const ducking = [false, false, false, false];
  const duckHeld = [false, false, false, false];
  /** sweeps taken, per slot (the tests read it) */
  const swept = [0, 0, 0, 0];
  const sweptT = [0, 0, 0, 0];
  const posted: Enemy[] = [];
  const viewDir = new THREE.Vector3();

  // ---- where things are ----
  const onTram = (p: THREE.Vector3): boolean =>
    p.x > REAR_X - 0.3 && p.x < FRONT_X + 0.3 && Math.abs(p.z) < HALF_W + 0.3 && p.y > Y0 - 0.6 && p.y < roofY + 6;
  const onRoof = (p: THREE.Vector3): boolean => onTram(p) && p.y > roofY - 0.5;
  const insideCar = (p: THREE.Vector3): boolean => onTram(p) && p.y < roofY - 0.6;
  const onRival = (p: THREE.Vector3): boolean =>
    Math.abs(p.x - rival.x) < CAR_L + 1.5 && Math.abs(p.z - rival.z) < HALF_W + 0.4 && p.y > roofY - 0.6 && rival.state !== 'away';
  const carIndex = (x: number): number => (x < -8 ? 0 : x < 8 ? 1 : 2);

  // ---- the doors ----
  const setDoors = (open: boolean): void => {
    for (const d of doors) {
      if (open && d.want === 0) {
        d.want = 1;
        if (d.box) { ctx.unsolid({ box: d.box }); d.box = null; }
      } else if (!open && d.want === 1) d.want = 0;
    }
  };
  const doorwayClear = (d: Door): boolean => game.players.every((p) => !p.alive
    || Math.abs(p.position.x - d.x) > DOOR_W / 2 + 0.6 || Math.abs(p.position.z + HALF_W) > 0.9);
  const updateDoors = (dt: number): void => {
    for (const d of doors) {
      if (d.want === 0 && !d.box && d.open <= 0.02 && doorwayClear(d)) {
        d.box = ctx.box(d.x, Y0 + 1.25, -HALF_W + 0.1, DOOR_W, 2.5, 0.2, null).box;
      }
      const goal = d.want === 1 ? 1 : (doorwayClear(d) ? 0 : d.open);
      d.open += Math.sign(goal - d.open) * Math.min(Math.abs(goal - d.open), dt / 0.7);
      d.mesh.position.x = d.x + d.open * (DOOR_W - 0.1);
    }
  };
  setDoors(true);

  // ---- hostiles ----
  const spawnAt = (kind: EnemyKind, at: THREE.Vector3): Enemy => {
    const e = ctx.spawn(kind, at, { exact: true, squad: 8840 });
    posted.push(e);
    return e;
  };
  const leadPos = (): THREE.Vector3 | null => game.players.find((p) => p.alive)?.position ?? null;
  const alertAll = (bodies: Enemy[]): void => {
    const lead = leadPos();
    if (lead) for (const e of bodies) if (e.alive) e.alert(lead, true);
  };
  /** jet pirates dropping on from ahead and above */
  const jetDrop = (n: number): void => {
    const bodies: Enemy[] = [];
    for (let i = 0; i < n; i++) {
      bodies.push(spawnAt('jetpirate', new THREE.Vector3(FRONT_X + 12 + i * 5, roofY + 9 + i, -6 + i * 3)));
    }
    alertAll(bodies);
  };

  // ---- the gantry sweep ----
  /** does a body at `pos` of height `h` meet a beam crossing x = bx this frame? */
  const inBeam = (pos: THREE.Vector3, h: number): boolean =>
    pos.y < beamBottom + GANTRY_BEAM && pos.y + h > beamBottom && Math.abs(pos.z) < HALF_W + 2.5;
  const sweep = (dt: number): void => {
    for (const g of gantries) {
      const x = gantryX(g);
      const prev = g.prevX;
      g.prevX = x;
      // the horn and the lamp, three seconds out
      const secs = (x - FRONT_X) / Math.max(1, mill.speed);
      const warn = x > REAR_X - 2 && x - FRONT_X < GANTRY_WARN * mill.speed + 2;
      g.lamp.material = warn && Math.sin(t * 16) > 0 ? red : darkMat;
      if (!g.warned && x - FRONT_X < GANTRY_WARN * SPEED && secs > 0) {
        g.warned = true;
        audio.alarm(0.35);
        if (g.mark === GANTRY_FROM) ctx.announce(T.gantryWarn, T.gantryWarnSub);
      }
      if (prev <= REAR_X - 1 || x > FRONT_X + 1) continue;
      const lo = Math.min(x, prev) - GANTRY_BEAM / 2, hi = Math.max(x, prev) + GANTRY_BEAM / 2;
      for (const p of game.players) {
        if (!p.alive || p.formT > 0) continue;
        const h = ducking[p.slot] ? DUCK_H : STAND_H;
        if (p.position.x < lo || p.position.x > hi || !inBeam(p.position, h)) continue;
        // one sweep per pass: the thrown body must not be met again by the same beam
        if (sweptT[p.slot] > 0) continue;
        sweptT[p.slot] = 1.5;
        // swept: knocked off the roof, over the side
        p.damage(party === 1 ? 12 : 16, new THREE.Vector3(x, beamBottom, p.position.z), -1);
        // thrown over the side, not along the beam's own path
        p.velocity.set(3, 5, p.position.z >= 0 ? 9 : -9);
        swept[p.slot]++;
        if (sweptNote <= 0) { sweptNote = 3; ctx.announce(T.swept, T.sweptSub); }
      }
      for (const e of game.enemies) {
        if (!e.alive || e.team !== 1) continue;
        if (e.position.x < lo || e.position.x > hi || !inBeam(e.position, e.height)) continue;
        e.damage(9999, new THREE.Vector3(x, beamBottom, e.position.z), -1);
        e.knockback(new THREE.Vector3(x + 2, beamBottom, e.position.z), 16, 0.6, 0.4);
      }
    }
    void dt;
  };

  // ---- the tunnel mouth: nothing stands on the roof inside it ----
  const tunnelSweep = (): void => {
    for (const p of game.players) {
      if (!p.alive || p.formT > 0) continue;
      if (!underTunnel(p.position.x) || p.position.y < roofY - 0.4 || !onTram(p.position)) continue;
      // clipped by the portal: dropped into the car below, bruised
      p.damage(party === 1 ? 10 : 14, new THREE.Vector3(p.position.x + 1, roofY + 1, 0), -1);
      p.position.copy(insideSpot(carIndex(p.position.x), p.slot));
      p.velocity.set(0, 0, 0);
    }
    for (const e of game.enemies) {
      if (!e.alive || e.team !== 1) continue;
      if (!underTunnel(e.position.x) || e.position.y < roofY - 0.4 || Math.abs(e.position.z) > HALF_W + 3) continue;
      e.damage(9999, e.position.clone().setX(e.position.x + 1), -1);
    }
  };

  // ---- the rival ----
  const peelOff = (how: 'cut' | 'clear'): void => {
    if (rival.state !== 'alongside') return;
    rival.state = 'peeling';
    rival.t = 0;
    ctx.announce(how === 'cut' ? T.rivalCut : T.rivalClear, T.rivalOffSub);
    audio.waveClear();
    terminusMark = mill.travelled + TERMINUS_AFTER;
    terminus = makePlatform(TERMINUS_AFTER, 64, { gate: 'open', sign: 'neon_sign', canopy: true });
  };
  const updateRival = (dt: number): void => {
    if (rival.state === 'away' && mill.travelled >= rivalMark) {
      rival.state = 'coming';
      rival.t = 0;
      rivalG.visible = true;
      placeRival(-110, RIVAL_Z);
      // its gunners ride in on its roof
      const n = 1 + party;
      for (let i = 0; i < n; i++) {
        const kind: EnemyKind = i === n - 1 && party >= 3 ? 'ringEnforcer' : i % 3 === 2 ? 'jetpirate' : 'pirate';
        const cx = RIVAL_CARS[i % 2] + (i < 2 ? 2 : -5);
        rival.gunners.push(spawnAt(kind, new THREE.Vector3(-110 + cx, roofY + 0.1, RIVAL_Z + ((i % 3) - 1) * 1.1)));
      }
      ctx.announce(T.rivalIn, T.rivalInSub);
      audio.alarm(0.4);
    }
    if (rival.state === 'coming') {
      rival.t += dt;
      const k = Math.min(1, rival.t / 9);
      const e = k * k * (3 - 2 * k);
      placeRival(-110 + 110 * e, RIVAL_Z);
      if (k >= 1) {
        rival.state = 'alongside';
        rival.t = 0;
        alertAll(rival.gunners);
        // the coupling goes live: lit, and on the board's list of things a bolt or a blast can break
        coupling.material = couplingLive;
        if (!(board.breakables ?? []).includes(couplingB)) (board.breakables ??= []).push(couplingB);
      }
      return;
    }
    if (rival.state === 'alongside') {
      rival.t += dt;
      placeRival(Math.sin(rival.t * 0.35) * 2.5, RIVAL_Z);
      if (rival.gunners.every((e) => !e.alive)) peelOff('clear');
      return;
    }
    if (rival.state === 'peeling') {
      rival.t += dt;
      const k = Math.min(1, rival.t / 7);
      placeRival(rival.x - dt * (6 + 30 * k), RIVAL_Z - 26 * k * k);
      // anyone still on it is put back aboard, before it is out of reach
      if (rival.t > 2.2) {
        for (const p of game.players) {
          if (!p.alive || !onRival(p.position)) continue;
          p.position.copy(roofSpot(p.slot));
          p.velocity.set(0, 0, 0);
          ctx.announce(T.leftBehind, T.leftBehindSub);
        }
      }
      if (k >= 1) {
        rival.state = 'gone';
        rivalG.visible = false;
        placeRival(-600, RIVAL_Z);
        for (const e of rival.gunners) if (e.alive) e.removeMe = true;
      }
    }
  };

  // ---- spots ----
  const roofSpot = (slot: number, car = 0): THREE.Vector3 => {
    const cx = CARS[car];
    return new THREE.Vector3(cx - 1.5 + (slot % 2) * 3 - Math.floor(slot / 2) * 1.2, roofY + 0.05, (slot % 2 ? 1 : -1) * 0.9);
  };
  function insideSpot(car: number, slot: number): THREE.Vector3 {
    const cx = CARS[car];
    return new THREE.Vector3(cx + 1 - (slot % 2) * 2.2 - Math.floor(slot / 2) * 0.8, Y0 + 0.05, (slot % 2 ? 0.6 : -0.6));
  }

  // ================================================================ update
  const update = (dt: number): void => {
    if (complete) return;
    t += dt;
    if (!started) {
      started = true;
      rail.engage(game, { setMove: false });
      for (const p of game.players) {
        p.sectionMove = composeMoves(rail.move, {
          adjust: (pl, _dt, input) => {
            // the roof crouch: hold Y on the roof to duck under a gantry
            const roof = onRoof(pl.position) && pl.grounded;
            duckHeld[pl.slot] = input.interactHeld;
            ducking[pl.slot] = roof && input.interactHeld;
            if (roof) {
              const k = ducking[pl.slot] ? 0.35 : 1;
              return { ...input, moveX: input.moveX * k, moveY: input.moveY * k, slamPressed: false, sprintHeld: input.sprintHeld && !ducking[pl.slot] };
            }
            return input;
          },
          crouch: (pl) => ducking[pl.slot],
        });
      }
      ctx.checkpoint.copy(roofSpot(0, 1));
      ctx.announce(T.title, T.sub);
    }
    rail.update(dt);
    // the sticks follow the screen: right is along the train, up is away from the lens
    if (!releasing) {
      rail.camera.getWorldDirection(viewDir);
      const viewYaw = Math.atan2(viewDir.x, viewDir.z);
      for (const p of game.players) p.moveYaw = viewYaw;
    }
    if (releasing) {
      if (rail.out) complete = true;
      return;
    }
    mill.update(dt);
    updateDoors(dt);
    sweptNote = Math.max(0, sweptNote - dt);
    for (let i = 0; i < 4; i++) sweptT[i] = Math.max(0, sweptT[i] - dt);
    // the camera leans in and out of the beats
    const wantWide = phase === 'station' || phase === 'rival' || phase === 'board' || phase === 'terminus' ? 1 : 0;
    wideCam += (wantWide - wideCam) * Math.min(1, dt * 1.2);
    const inside = tunnelMouth() < FRONT_X + 6 && tunnelEnd() > REAR_X - 4;
    tunnelCam += ((inside ? 1 : 0) - tunnelCam) * Math.min(1, dt * 1.5);
    for (const l of carLights) l.intensity = 6 + tunnelCam * 10;

    // ---- the beats ----
    if (phase === 'board') {
      const aboard = game.players.every((p) => !p.alive || onTram(p.position));
      aboardT = aboard && game.players.some((p) => p.alive) ? aboardT + dt : 0;
      if (aboardT > 1.2) {
        phase = 'run';
        setDoors(false);
        mill.setSpeed(SPEED, 3);
        audio.alarm(0.3);
        ctx.announce(T.departs, T.departsSub);
        // pirates come over the front of the front car, and two swoops run alongside
        const n = 1 + Math.ceil(party / 2);
        const roofers: Enemy[] = [];
        for (let i = 0; i < n; i++) roofers.push(spawnAt('pirate', new THREE.Vector3(FRONT_X - 2 - i * 2.2, roofY + 0.1, (i % 2 ? 1 : -1) * 0.8)));
        for (let i = 0; i < Math.min(2, party + 1); i++) roofers.push(spawnAt('nikto', new THREE.Vector3(10 - i * 30, roofY + 2, i ? 9 : -12)));
        alertAll(roofers);
      }
    }
    if (phase === 'run') {
      const d = mill.travelled;
      if (jetWaves === 0 && d > 160) { jetWaves = 1; jetDrop(1 + Math.floor(party / 2)); }
      if (jetWaves === 1 && d > 320 && !climbers) {
        // two more come up over the tail of the rear car
        climbers = true;
        const bodies: Enemy[] = [];
        for (let i = 0; i < 1 + Math.ceil(party / 2); i++) bodies.push(spawnAt('pirate', new THREE.Vector3(REAR_X + 1.5 + i * 2, roofY + 0.1, (i % 2 ? 1 : -1) * 0.9)));
        alertAll(bodies);
      }
      if (jetWaves === 1 && d > 620) { jetWaves = 2; jetDrop(1 + Math.floor(party / 2)); }
      if (jetWaves === 2 && d > 900) { jetWaves = 3; jetDrop(Math.ceil(party / 2)); }
      if (!stationDone && d > STATION_AT - 120 && mill.stoppingAt === null) mill.stopAt(STATION_AT);
      if (!stationDone && mill.stopped && Math.abs(d - STATION_AT) < 0.5) {
        phase = 'station';
        stationT = STATION_STOP;
        setDoors(true);
        ctx.announce(T.stationIn, T.stationInSub);
      }
      // the tunnel: slow for it, warn, then sweep the roof at its mouth
      if (stationDone && d > TUNNEL_AT - 70 && mill.target === SPEED) mill.setSpeed(TUNNEL_SPEED, 3);
      if (stationDone && !tunnelWarned && tunnelMouth() - FRONT_X < 55) {
        tunnelWarned = true;
        phase = 'tunnel';
        audio.alarm(0.45);
        ctx.announce(T.tunnelWarn, T.tunnelWarnSub);
      }
    }
    if (phase === 'station') {
      stationT -= dt;
      if (!stationSpawned) {
        stationSpawned = true;
        // a squad boards through the doors; snipers work from the canopy
        const boarders: Enemy[] = [];
        const nb = 2 + party;
        for (let i = 0; i < nb; i++) {
          const car = i % 3, d = DOORS_DX[i % 2];
          boarders.push(spawnAt(i === nb - 1 && party >= 2 ? 'pirateMelee' : 'pirate', new THREE.Vector3(CARS[car] + d, Y0 + 0.05, -0.2)));
        }
        const ns = 1 + Math.ceil(party / 2);
        for (let i = 0; i < ns; i++) {
          boarders.push(spawnAt('pirate', new THREE.Vector3(-18 + i * (36 / Math.max(1, ns - 1)), station.canopyTop + 0.05, -7.5)));
        }
        alertAll(boarders);
        audio.alarm(0.3);
      }
      if (stationT <= 0) {
        stationDone = true;
        phase = 'run';
        setDoors(false);
        mill.setSpeed(SPEED, 3);
        ctx.announce(T.stationOut, T.stationOutSub);
      }
    }
    if (phase === 'tunnel') {
      tunnelSweep();
      if (!tunnelStowed && tunnelMouth() < REAR_X) {
        tunnelStowed = true;
        // stowaways: the fight inside, whatever the station left
        const n = 1 + Math.floor(party / 2);
        const bodies: Enemy[] = [];
        for (let i = 0; i < n; i++) bodies.push(spawnAt('pirate', new THREE.Vector3(CARS[2] + 3 - i * 2.5, Y0 + 0.05, (i % 2 ? 0.6 : -0.6))));
        alertAll(bodies);
      }
      if (!tunnelPassed && tunnelEnd() < REAR_X - 2) {
        tunnelPassed = true;
        phase = 'rival';
        mill.setSpeed(SPEED, 3);
        rivalMark = mill.travelled + RIVAL_AFTER;
        ctx.announce(T.tunnelOut, T.tunnelOutSub);
      }
    }
    if (phase === 'rival') {
      updateRival(dt);
      if (rival.state === 'peeling' || rival.state === 'gone') {
        if (mill.stoppingAt === null && terminusMark - mill.travelled < 120) mill.stopAt(terminusMark);
        if (mill.stopped && Math.abs(mill.travelled - terminusMark) < 0.5) {
          phase = 'terminus';
          setDoors(true);
          ctx.announce(T.terminusIn, T.terminusInSub);
        }
      }
    }
    if (phase === 'rival' || phase === 'terminus') {
      // keep the peel running out of shot even after the tram has stopped
      if (phase === 'terminus') updateRival(dt);
    }
    if (phase === 'terminus' && terminus) {
      for (const p of game.players) {
        if (!p.alive) continue;
        const g = terminus.item!.pos;
        if (Math.hypot(p.position.x - g.x, p.position.z - (PLATFORM_Z1 + 0.6)) < 2.6 && p.position.y < Y0 + 1.5) {
          releasing = true;
          phase = 'out';
          rail.release();
          break;
        }
      }
    }
    if (phase !== 'board') sweep(dt);

    // anything left on a platform that has gone by is not coming back
    for (const e of posted) {
      if (e.alive && e.position.x < REAR_X - 45 && !onRival(e.position)) e.removeMe = true;
    }
  };

  // ================================================================ objective and HUD
  const nextEvent = (): { what: string; m: number } | null => {
    const d = mill.travelled;
    const g = gantries.find((x) => gantryX(x) > FRONT_X);
    if (!stationDone && d < STATION_AT) {
      if (g && g.mark < STATION_AT) return { what: T.gantry, m: Math.round(gantryX(g) - FRONT_X) };
      return { what: T.station, m: Math.round(STATION_AT - d) };
    }
    if (!tunnelPassed && tunnelMouth() > FRONT_X) return { what: T.tunnel, m: Math.round(tunnelMouth() - FRONT_X) };
    if (Number.isFinite(terminusMark) && d < terminusMark) return { what: T.terminus, m: Math.round(terminusMark - d) };
    return null;
  };
  const objective = () => {
    const hint = (h: string, pos: THREE.Vector3, label: string, beacon = false) => ({ pos, label, hint: h, beacon });
    const front = new THREE.Vector3(FRONT_X - 3, roofY, 0);
    switch (phase) {
      case 'board': return hint(T.hintBoard, new THREE.Vector3(0, roofY, 0), T.tram);
      case 'station': return hint(T.hintStation, new THREE.Vector3(0, Y0 + 1, -HALF_W), T.tram);
      case 'tunnel': {
        if (!tunnelPassed && tunnelEnd() > REAR_X - 2 && tunnelMouth() < FRONT_X + 60 && !(tunnelMouth() < REAR_X)) {
          // get inside: the nearest hatch to the party
          const lead = leadPos();
          const h = lead ? hatches.reduce((a, b) => (a.distanceTo(lead) < b.distanceTo(lead) ? a : b)) : hatches[1];
          return hint(T.hintInside, h.clone(), T.hatch);
        }
        return hint(T.hintTunnel, front, T.front);
      }
      case 'rival': {
        if (rival.state === 'coming' || rival.state === 'alongside') {
          return hint(T.hintRival, new THREE.Vector3(rival.x, Y0 + ROOF, rival.z), T.coupling);
        }
        if (tunnelPassed && game.players.some((p) => p.alive && insideCar(p.position))) return hint(T.hintUp, hatches[1].clone(), T.hatch);
        return hint(T.hintRoof, front, T.front);
      }
      case 'terminus':
      case 'out': {
        const g = terminus?.item?.pos ?? new THREE.Vector3(0, Y0, PLATFORM_Z1);
        return hint(T.hintOff, new THREE.Vector3(g.x, Y0, PLATFORM_Z1 + 0.6), T.gate, true);
      }
      default: {
        const g = gantries.find((x) => gantryX(x) > REAR_X && gantryX(x) - FRONT_X < GANTRY_WARN * SPEED);
        return hint(g ? T.hintDuck : T.hintRoof, front, T.front);
      }
    }
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    // the merged strip has one row for this over each hunter's bars: a line,
    // or the coupling's bar while the pirate tram is alongside
    if (rival.state === 'alongside' && !couplingB.broken) {
      const bars: SectionBar[] = [{ label: T.rivalBar, value: Math.max(0, couplingB.hp / couplingB.maxHp), tone: 'danger' }];
      return { title: T.title, bars };
    }
    let line = '';
    if (phase === 'station') line = T.stopLeft(Math.max(0, stationT));
    else if (ducking[slot]) line = T.ducking;
    else {
      const n = nextEvent();
      if (n) line = T.next(n.what, n.m);
    }
    return line ? { title: T.title, line } : null;
  };

  // ================================================================ respawn, bounds
  const respawnSpot = (slot: number): THREE.Vector3 => {
    const rearX = CARS[0];
    // the tunnel over the rear car, or a gantry over the train or about to
    // cross it (it sweeps the rear car last): inside, not on top
    const gantryComing = gantries.some((g) => { const x = gantryX(g); return x > REAR_X - 1 && x < FRONT_X + 12; });
    if (underTunnel(rearX - 7) || underTunnel(rearX + 7) || (phase !== 'board' && gantryComing)) {
      return ctx.placeAt(insideSpot(0, slot), 'pyke');
    }
    if (phase === 'board') {
      return ctx.placeAt(new THREE.Vector3(-2 + (slot % 2) * 4, Y0 + 0.05, -6 - Math.floor(slot / 2) * 1.5), 'pyke');
    }
    return ctx.placeAt(roofSpot(slot, 0), 'pyke');
  };

  // ================================================================ autopilot
  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    const pos = p.position;
    const out: AutopilotInput = {};
    const b = yawBasis(p.moveYaw ?? p.cam.yaw);
    const steer = (tx: number, tz: number, slow = 3): void => {
      const dx = tx - pos.x, dz = tz - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.35) return;
      const k = Math.min(1, dist / slow);
      out.moveY = ((dx * b.fwdX + dz * b.fwdZ) / dist) * k;
      out.moveX = ((dx * b.rightX + dz * b.rightZ) / dist) * k;
    };
    const car = slot % 3;
    const myRoof = roofSpot(slot, car);
    const climb = (to: THREE.Vector3): void => {
      // up onto a roof: to the platform's edge beside the spot, straight up
      // holding A while it lifts, and in over the roof once above it. A
      // super jump spent short of the roof is let go, not glided against the
      // wall, so the bot lands and tries again.
      const edgeZ = (pos.z < 0 ? -1 : 1) * (HALF_W + 0.9);
      if (pos.y > to.y + 0.35 || (onTram(pos) && pos.y > to.y - 0.3)) {
        if (p.profile.flight === 'jetpack' && !p.grounded && pos.y < to.y + 0.6) out.jumpHeld = true;
        steer(to.x, to.z);
        return;
      }
      const atEdge = Math.abs(pos.x - to.x) < 1.4 && Math.abs(pos.z - edgeZ) < 0.9;
      if (!atEdge && p.grounded) { steer(to.x, edgeZ, 1); return; }
      if (p.grounded) { out.jumpPressed = true; out.jumpHeld = true; }
      else if (p.profile.flight === 'jetpack' || p.velocity.y > 0.5) out.jumpHeld = true;
      steer(to.x, edgeZ, 1);
    };
    const aim = (): void => {
      let at: THREE.Vector3 | null = null;
      let nd = 36;
      for (const e of game.hostilesFor(p)) {
        if (!e.alive) continue;
        const d = e.position.distanceTo(pos);
        if (d < nd) { nd = d; at = e.position; }
      }
      if (!at && rival.state === 'alongside' && !couplingB.broken) at = couplingB.center;
      if (at) {
        const ax = at.x - pos.x, az = at.z - pos.z;
        const n = Math.hypot(ax, az) || 1;
        out.aimStickX = (ax * b.rightX + az * b.rightZ) / n;
        out.aimStickY = (ax * b.fwdX + az * b.fwdZ) / n;
        out.shootHeld = true;
      }
    };

    switch (phase) {
      case 'board':
        if (!onTram(pos) || pos.y < roofY - 0.5) climb(myRoof);
        else steer(myRoof.x, myRoof.z);
        return out;
      case 'terminus':
      case 'out': {
        const g = terminus?.item?.pos;
        if (!g) return out;
        // off the platform side of the roof, down, and through the gate
        steer(g.x, PLATFORM_Z1 + 0.6, 1.5);
        return out;
      }
      default: break;
    }
    // the tunnel: down through the hatch before the mouth, back up after
    const tunnelSoon = !tunnelPassed && stationDone && tunnelMouth() - FRONT_X < 45 && tunnelEnd() > REAR_X - 2;
    const hatch = hatches[car];
    if (tunnelSoon) {
      if (onRoof(pos)) steer(hatch.x, hatch.z, 1);   // stand on the hole: in you go
      else if (insideCar(pos)) steer(CARS[car] - 1 + (slot >> 1), (slot % 2 ? 0.7 : -0.7));
      else climb(myRoof);
      aim();
      return out;
    }
    if (insideCar(pos)) {
      // back up top: under the hatch, and rise through it
      steer(hatch.x, hatch.z, 0.8);
      if (Math.hypot(hatch.x - pos.x, hatch.z - pos.z) < 0.7 || !p.grounded) {
        out.jumpHeld = true;
        if (p.grounded) out.jumpPressed = true;
      }
      aim();
      return out;
    }
    if (!onTram(pos) || pos.y < roofY - 0.5) {
      // on a platform, or somewhere off the roof: back up onto it
      climb(myRoof);
      aim();
      return out;
    }
    // on the roof: hold the spot, duck the gantries, shoot
    if (Math.hypot(myRoof.x - pos.x, myRoof.z - pos.z) > 1.2 && !pos.equals(myRoof)) steer(myRoof.x, myRoof.z, 1.5);
    const g = gantries.find((x) => {
      const gx = gantryX(x);
      return gx > pos.x - 1.5 && gx < pos.x + 9;
    });
    if (g && p.grounded) { out.interactHeld = true; delete out.moveX; delete out.moveY; }
    aim();
    return out;
  };

  // ================================================================ the instance
  const testKit = {
    mill, rail, gantries, doors,
    get phase() { return phase; },
    get rival() { return rival; },
    coupling: couplingB,
    couplingTargetable: () => (board.breakables ?? []).includes(couplingB),
    ducking: () => ducking.slice(),
    swept: () => swept.slice(),
    gantryX: (i: number) => gantryX(gantries[i]),
    tunnelMouth, tunnelEnd,
    onRoof: (slot: number) => onRoof(game.players[slot].position),
    insideCar: (slot: number) => insideCar(game.players[slot].position),
    roofY, floorY: Y0, cars: CARS, hatches,
    get stationT() { return stationT; },
    get terminusMark() { return terminusMark; },
    get terminusGate() { return terminus?.item ? new THREE.Vector3(terminus.item.pos.x, Y0, PLATFORM_Z1 + 0.6) : null; },
    onRival: (slot: number) => onRival(game.players[slot].position),
  };

  return {
    testKit,
    starts: [0, 1, 2, 3].map((i) => new THREE.Vector3(-2.5 + (i % 2) * 5, Y0 + 0.05, -6.5 - Math.floor(i / 2) * 1.6)),
    floorY: Y0,
    ceilingY: Y0 + 26,
    groundAt: (x, z) => {
      if (Math.abs(z) < HALF_W && x > REAR_X && x < FRONT_X) return roofY;
      if (z < PLATFORM_Z0 && z > PLATFORM_Z1 && x > -32 && x < 32 && (phase === 'board' || phase === 'station' || phase === 'terminus')) return Y0;
      return Y0 - 40;
    },
    contains: (x, z) => complete || (Math.abs(x) < 34 && z > PLATFORM_Z1 - 1 && z < 9),
    path: [new THREE.Vector3(0, Y0, -6.5), new THREE.Vector3(0, roofY, 0), new THREE.Vector3(FRONT_X - 3, roofY, 0),
      new THREE.Vector3(0, Y0, PLATFORM_Z1 + 0.6)],
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    // off the tram: the drop to the street, far below
    offPath: (pos) => pos.y < Y0 - 5,
    hud,
    autopilot,
    dispose: () => {
      rail.dispose();
      mill.dispose();
      for (const p of game.players) { p.sectionMove = null; p.moveYaw = null; }
      if (board.movers) board.movers = board.movers.filter((m) => m !== rivalMover);
      if (board.breakables) board.breakables = board.breakables.filter((x) => x !== couplingB);
    },
    debug: () => ({
      phase, travelled: +mill.travelled.toFixed(1), speed: +mill.speed.toFixed(2),
      rival: rival.state, coupling: Math.round(couplingB.hp), blend: +rail.blend.toFixed(2),
      station: +stationT.toFixed(1), tunnel: +tunnelMouth().toFixed(1),
    }),
  };
}

export const tramTop: SectionDef = {
  id: 'tram-top',
  build,
  // dusk on the ring, the street a haze of light far below
  world: { fogColor: 0x6e5262, fogNear: 90, fogFar: 460, fill: 1.0 },
};
