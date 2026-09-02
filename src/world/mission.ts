import * as THREE from 'three';
import type { Board } from './board';
import type { StaticBox } from '../core/physics';
import { addBreakable, hazardAt } from './board';
import { mat } from '../characters/builder';
import { authoredProp } from './props';
import { loadOptionalTexture } from '../core/assets';
import { buildDoorFrame } from './corridor';
import type { BoardId } from './board';

/**
 * Mission levels (docs/LEVEL_DESIGN.md): each territory's Missions run plays
 * out in a purpose-built level — a hand-authored chain of walled fight rooms
 * joined by real, walkable corridor pinches — rather than across the open
 * wave arena. The genre spine is Gauntlet's chamber chain and Minecraft
 * Dungeons' golden path: wide pockets for fights, pinches between them, one
 * readable way forward, gates that seal an arena while its waves run.
 *
 * The level is raised high above the territory (the same altitude trick the
 * old corridor segments proved out), so every board gets clean, intentional
 * geometry while keeping its own sky, fog, ambience, gravity and wave tables.
 * Everything here is geometry + data; `game/campaign.ts` owns the flow.
 */

export type RoomKind = 'start' | 'camp' | 'assault' | 'champion' | 'warlord';
export type RoomFeature = 'pit' | 'lava' | 'shock' | 'barrels' | 'pillars' | 'crates';

export interface RoomSpec {
  kind: RoomKind;
  /** flavour name, used by banners and the HUD hint */
  label: string;
  /** inner width (across the travel axis) and length (along it), metres */
  w: number;
  l: number;
  /** assault rooms: how many sealed waves the room runs */
  waves?: number;
  /** set-piece dressing (hazard strips, a pit, cover, explosives) */
  feature?: RoomFeature;
  /** a bacta niche off one side wall */
  alcove?: boolean;
}

export interface LinkSpec {
  /** first leg length along the current heading */
  len: number;
  /** optional 90° bend (+1 left toward +v, -1 right), then a second leg */
  turn?: -1 | 1;
  len2?: number;
}

export interface MissionSpec {
  palette: { wall: number; floor: number; trim: number; accent: number };
  /** corridor width; rooms always take their own w */
  corrW?: number;
  wallH?: number;
  /** ground grip inside the level (the Crevasse's ice), 1 = normal */
  traction?: number;
  rooms: RoomSpec[];
  /** connectors, one per pair of adjacent rooms */
  links: LinkSpec[];
}

/** the level floor's altitude over the territory */
export const MISSION_Y = 90;
const WALL_T = 1;
const GATE_W = 3.8;
const CORR_H = 3.8;
const WALL_H = 5.5;
/** adjacent floor plates get staggered lifts so coplanar tops never shimmer */
const EPS = 0.013;

/** crate proportions, matched to corridor_crate.glb (see world/corridor.ts history) */
const CRATE_H_MIN = 1.15;
const CRATE_H_VAR = 0.35;
const CRATE_W_PER_H = 1.18;
const CRATE_D_PER_H = 1.42;

interface Rect { minX: number; maxX: number; minZ: number; maxZ: number; }

/** how long a leaf takes to run its full travel, seconds */
const GATE_SLIDE = 0.75;
/** past this much travel the doorway is clear enough to walk and shoot through */
const GATE_CLEAR = 0.82;

/**
 * A blast door in a doorway: a frame, two leaves that part down the middle,
 * and a physics blocker that stands while they are anything but open.
 *
 * Shut is the resting state. The doorway is a full-height gap in a real wall,
 * so a door that is only a decorative frame is a hole you can shoot and walk
 * through — which is what these were. The leaves fill the whole opening, not
 * just the frame's 3.6 m, so nothing passes over the top of them either.
 *
 * The blocker is tied to the animation rather than to the request: it goes in
 * the moment a door starts to close and only comes out once the leaves have
 * actually cleared the way, so a door is never passable while it still looks
 * shut.
 */
export class Gate {
  pos: THREE.Vector3;
  private box: StaticBox | null = null;
  private leaves: THREE.Mesh[] = [];
  private seam: THREE.Mesh;
  private half: THREE.Vector3;
  /** 0 = shut, 1 = fully retracted */
  private t = 0;
  private want = 0;
  private travel: number;

  constructor(private board: Board, parent: THREE.Object3D, pos: THREE.Vector3,
    dir: { x: number; z: number }, wallH: number, accent: number) {
    this.pos = pos.clone();
    const yaw = Math.atan2(dir.x, dir.z);
    buildDoorFrame(parent, pos.clone(), yaw, { leaf: false });
    // blocker half-extents: thin along the travel axis, spanning the gap
    const across = GATE_W / 2 + 0.5;
    this.half = new THREE.Vector3(
      dir.x !== 0 ? 0.45 : across, wallH / 2 + 0.5, dir.x !== 0 ? across : 0.45);

    // Leaves live in a group turned to the doorway, so a leaf slides along its
    // own local X whichever way the level's turtle was facing when it was built.
    const hub = new THREE.Group();
    hub.position.copy(pos);
    hub.rotation.y = yaw;
    parent.add(hub);
    const leafW = GATE_W / 2;
    this.travel = leafW + 0.25;
    const skin = mat(0x53585f, { rough: 0.55, metal: 0.7 });
    const trim = mat(accent, { rough: 0.4, metal: 0.6 });
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, wallH, 0.36), skin);
      leaf.position.set(side * leafW / 2, wallH / 2, 0);
      leaf.castShadow = leaf.receiveShadow = true;
      hub.add(leaf);
      this.leaves.push(leaf);
      // a band of accent near the meeting edge, so the parting reads at a
      // glance — local to the leaf, so it travels with it
      const band = new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.55, 0.22, 0.44), trim);
      band.position.set(-side * leafW * 0.18, wallH * 0.06, 0);
      leaf.add(band);
    }
    this.seam = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, wallH - 0.3),
      new THREE.MeshBasicMaterial({
        color: accent, transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
    this.seam.position.set(0, wallH / 2, 0.2);
    hub.add(this.seam);
    this.shutNow();
  }

  /** the doorway is not passable — shut, or still on the move */
  get closed(): boolean { return this.box !== null; }
  /** fully retracted and staying that way */
  get open_(): boolean { return this.t >= 1 && this.want >= 1; }

  /** shut without the animation, for the level's initial state */
  private shutNow(): void {
    this.t = 0;
    this.want = 0;
    this.place();
    this.block(true);
  }

  close(): void { this.want = 0; this.block(true); }
  open(): void { this.want = 1; }

  update(dt: number): void {
    if (this.t === this.want) return;
    const step = dt / GATE_SLIDE;
    this.t = this.want > this.t
      ? Math.min(this.want, this.t + step)
      : Math.max(this.want, this.t - step);
    this.place();
    this.block(this.t < GATE_CLEAR);
  }

  private place(): void {
    // ease out, so a heavy door slams off the mark and settles into its pocket
    const e = 1 - (1 - this.t) * (1 - this.t);
    for (let i = 0; i < this.leaves.length; i++) {
      const side = i === 0 ? -1 : 1;
      this.leaves[i].position.x = side * (GATE_W / 4 + e * this.travel);
    }
    this.seam.visible = this.t < 0.05;
  }

  private block(on: boolean): void {
    if (on === (this.box !== null)) return;
    if (on) {
      this.box = this.board.physics.addBox(
        this.pos.x, this.pos.y + this.half.y, this.pos.z,
        this.half.x * 2, this.half.y * 2, this.half.z * 2);
    } else {
      const boxes = this.board.physics.boxes;
      const i = boxes.indexOf(this.box!);
      if (i >= 0) boxes.splice(i, 1);
      this.box = null;
    }
  }
}

export interface MissionRoom {
  spec: RoomSpec;
  /** floor-level points: just inside the entry gate, the middle, just short of the exit */
  entry: THREE.Vector3;
  center: THREE.Vector3;
  exit: THREE.Vector3;
  rect: Rect;
  entryGate: Gate | null;
  exitGate: Gate | null;
  /** validated wave-spawn spots along the walls (assault rooms) */
  vents: THREE.Vector3[];
  /** validated standing posts in the far half (camp squads) */
  posts: THREE.Vector3[];
}

export interface DefenderPost { pos: THREE.Vector3; toward: THREE.Vector3; }

export interface MissionLevel {
  rooms: MissionRoom[];
  /** corridor defender posts; defenders[i] guard the link out of rooms[i] */
  defenders: DefenderPost[][];
  /** bacta canister positions (alcoves + corridor middles) */
  pickups: THREE.Vector3[];
  /** party spawn points in the start room */
  starts: THREE.Vector3[];
  floorY: number;
  /** is this x,z over the level's walkable footprint? */
  contains(x: number, z: number): boolean;
}

/** the walkable frame of one space: entry point + travel direction on the floor plan */
class Frame {
  px: number; pz: number;
  constructor(public ex: number, public ez: number, public dx: number, public dz: number) {
    // "left" across the travel axis: +v
    this.px = -dz;
    this.pz = dx;
  }
  x(u: number, v: number): number { return this.ex + this.dx * u + this.px * v; }
  z(u: number, v: number): number { return this.ez + this.dz * u + this.pz * v; }
  vec(u: number, v: number, y: number): THREE.Vector3 {
    return new THREE.Vector3(this.x(u, v), y, this.z(u, v));
  }
  rect(u0: number, u1: number, v0: number, v1: number): Rect {
    const xs = [this.x(u0, v0), this.x(u1, v0), this.x(u0, v1), this.x(u1, v1)];
    const zs = [this.z(u0, v0), this.z(u1, v0), this.z(u0, v1), this.z(u1, v1)];
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minZ: Math.min(...zs), maxZ: Math.max(...zs),
    };
  }
}

/** deterministic rng so a territory's level is the same one every run */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function buildMission(board: Board, spec: MissionSpec): MissionLevel {
  const pal = spec.palette;
  const corrW = spec.corrW ?? 6;
  const baseWallH = spec.wallH ?? WALL_H;
  const rand = rng(spec.rooms.length * 7919 + spec.palette.wall);

  // `mat()` caches by colour and shares with the rest of the game, so the
  // level takes its own copies before tiling textures onto them
  const wallMat = mat(pal.wall, { rough: 0.75, metal: 0.25 }).clone();
  const floorMat = mat(pal.floor, { rough: 0.85, metal: 0.15 }).clone();
  const crateMat = mat(0x4a4436, { rough: 0.8, metal: 0.2 }).clone();
  const trimMat = mat(pal.trim, { rough: 0.5, metal: 0.4, emissive: pal.trim }).clone();
  const accentGlow = new THREE.MeshBasicMaterial({ color: pal.accent });
  const tile = (m: THREE.MeshStandardMaterial, name: string, rx: number, ry: number): void => {
    loadOptionalTexture(name, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rx, ry);
      m.map = tex;
      // keep the palette tint over the tileable — it is what tells the nine
      // territories' interiors apart when they share one texture set
      m.needsUpdate = true;
    }, { exts: ['png', 'jpg'] });
  };
  tile(wallMat, 'corridor_wall', 6, 2);
  tile(floorMat, 'corridor_floor', 8, 8);
  tile(crateMat, 'corridor_wall', 1, 1);

  const group = new THREE.Group();
  group.name = 'mission';
  board.group.add(group);

  const rects: Rect[] = [];
  const pickups: THREE.Vector3[] = [];
  const defenders: DefenderPost[][] = [];
  /** circles (world x,z,r) that crates and props must stay out of */
  const blocked: { x: number; z: number; r: number }[] = [];
  let spaceN = 0;

  /** a floor/ceiling/wall box: mesh + collider in one */
  const solid = (f: Frame, u0: number, u1: number, v0: number, v1: number,
    y0: number, y1: number, m: THREE.Material): THREE.Mesh => {
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const along = Math.abs(u1 - u0), across = Math.abs(v1 - v0);
    const cx = f.x(cu, cv), cz = f.z(cu, cv), cy = (y0 + y1) / 2;
    const sx = f.dx !== 0 ? along : across;
    const sz = f.dx !== 0 ? across : along;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, y1 - y0, sz), m);
    mesh.position.set(cx, cy, cz);
    mesh.receiveShadow = true;
    group.add(mesh);
    board.physics.addBox(cx, cy, cz, sx, y1 - y0, sz);
    return mesh;
  };

  /** mesh-only slab (trim, glow strips) — no collider */
  const slab = (f: Frame, u0: number, u1: number, v0: number, v1: number,
    y0: number, y1: number, m: THREE.Material): THREE.Mesh => {
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const along = Math.abs(u1 - u0), across = Math.abs(v1 - v0);
    const sx = f.dx !== 0 ? along : across;
    const sz = f.dx !== 0 ? across : along;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, y1 - y0, sz), m);
    mesh.position.set(f.x(cu, cv), (y0 + y1) / 2, f.z(cu, cv));
    group.add(mesh);
    return mesh;
  };

  /** a wall plane perpendicular to travel at u=uc, spanning v0..v1 minus gaps */
  const wallU = (f: Frame, uc: number, v0: number, v1: number,
    gaps: { c: number; w: number }[], top: number, h: number): void => {
    const edges = gaps.map((g) => [g.c - g.w / 2, g.c + g.w / 2]).sort((a, b) => a[0] - b[0]);
    let at = v0;
    for (const [a, b] of edges) {
      if (a > at) solid(f, uc - WALL_T / 2, uc + WALL_T / 2, at, a, top, top + h, wallMat);
      at = Math.max(at, b);
    }
    if (v1 > at) solid(f, uc - WALL_T / 2, uc + WALL_T / 2, at, v1, top, top + h, wallMat);
  };

  /** a wall running along travel at v=vc, spanning u0..u1 minus gaps */
  const wallV = (f: Frame, vc: number, u0: number, u1: number,
    gaps: { c: number; w: number }[], top: number, h: number): void => {
    const edges = gaps.map((g) => [g.c - g.w / 2, g.c + g.w / 2]).sort((a, b) => a[0] - b[0]);
    let at = u0;
    for (const [a, b] of edges) {
      if (a > at) solid(f, at, a, vc - WALL_T / 2, vc + WALL_T / 2, top, top + h, wallMat);
      at = Math.max(at, b);
    }
    if (u1 > at) solid(f, at, u1, vc - WALL_T / 2, vc + WALL_T / 2, top, top + h, wallMat);
  };

  const clearOf = (x: number, z: number, r: number): boolean =>
    blocked.every((b) => Math.hypot(x - b.x, z - b.z) > b.r + r);

  /** one cover crate: collider + stand-in + authored sculpt */
  const crate = (x: number, y: number, z: number, ch = CRATE_H_MIN + rand() * CRATE_H_VAR): void => {
    const sx = ch * CRATE_W_PER_H, sz = ch * CRATE_D_PER_H;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, ch, sz), crateMat);
    mesh.position.set(x, y + ch / 2, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    board.physics.addBox(x, y + ch / 2, z, sx, ch, sz);
    authoredProp(group, mesh, 'corridor_crate', ch, { x, y, z, axis: 'y' });
    blocked.push({ x, z, r: Math.max(sx, sz) * 0.7 });
  };

  // ---- walk the chain: rooms and their links, on a turtle of Frames ----
  let frame = new Frame(-70, -30, 1, 0);
  const rooms: MissionRoom[] = [];
  const last = spec.rooms.length - 1;

  for (let i = 0; i <= last; i++) {
    const rs = spec.rooms[i];
    const f = frame;
    const { w, l } = rs;
    const top = MISSION_Y + (spaceN++ % 3) * EPS;
    const wallH = rs.kind === 'warlord' ? baseWallH + 2.5 : baseWallH;

    // floor, walls (gate gaps front and back), no roof — the sky is the ceiling
    solid(f, -1, l + 1, -w / 2 - 1, w / 2 + 1, top - 1, top, floorMat);
    const entryGaps = i > 0 ? [{ c: 0, w: GATE_W }] : [];
    const exitGaps = i < last ? [{ c: 0, w: GATE_W }] : [];
    wallU(f, -WALL_T / 2, -w / 2 - WALL_T, w / 2 + WALL_T, entryGaps, top, wallH);
    wallU(f, l + WALL_T / 2, -w / 2 - WALL_T, w / 2 + WALL_T, exitGaps, top, wallH);
    const alcoveGap = rs.alcove ? [{ c: l / 2, w: 3.2 }] : [];
    wallV(f, w / 2 + WALL_T / 2, -WALL_T, l + WALL_T, alcoveGap, top, wallH);
    wallV(f, -w / 2 - WALL_T / 2, -WALL_T, l + WALL_T, [], top, wallH);
    // accent skirting along both side walls — the eye follows the trim forward
    slab(f, 1, l - 1, w / 2 - 0.22, w / 2 - 0.02, top + 0.04, top + 0.18, trimMat);
    slab(f, 1, l - 1, -w / 2 + 0.02, -w / 2 + 0.22, top + 0.04, top + 0.18, trimMat);
    rects.push(f.rect(-0.5, l + 0.5, -w / 2 - 0.5, w / 2 + 0.5));

    // the bacta niche: a pocket beyond the side wall's gap, prize in the middle
    if (rs.alcove) {
      const p0 = w / 2 + WALL_T;
      solid(f, l / 2 - 2.4, l / 2 + 2.4, p0 - 0.5, p0 + 3.4, top - 1, top, floorMat);
      // the 5 cm inset keeps these faces off the room wall's plane (no shimmer)
      wallU(f, l / 2 - 2.4 - WALL_T / 2, p0 + 0.05, p0 + 3.4 + WALL_T, [], top, wallH);
      wallU(f, l / 2 + 2.4 + WALL_T / 2, p0 + 0.05, p0 + 3.4 + WALL_T, [], top, wallH);
      wallV(f, p0 + 3.4 + WALL_T / 2, l / 2 - 2.4 - WALL_T, l / 2 + 2.4 + WALL_T, [], top, wallH);
      pickups.push(f.vec(l / 2, p0 + 1.8, top + 0.2));
      rects.push(f.rect(l / 2 - 2.4, l / 2 + 2.4, p0, p0 + 3.4));
    }

    // gates in the doorways
    const dir = { x: f.dx, z: f.dz };
    const entryGate = i > 0 ? new Gate(board, group, f.vec(0, 0, top), dir, wallH, pal.accent) : null;
    const exitGate = i < last ? new Gate(board, group, f.vec(l, 0, top), dir, wallH, pal.accent) : null;

    // ---- set pieces ----
    // gates and the travel lane stay clear of everything placed below
    blocked.push({ x: f.x(0, 0), z: f.z(0, 0), r: 3 }, { x: f.x(l, 0), z: f.z(l, 0), r: 3 });
    if (rs.feature === 'pit') {
      // a maw in the floor: fight around it, never over it
      const r = Math.min(w, l) * 0.18 + 1.4;
      const maw = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.72, 1.1, 20),
        mat(0x120c08, { rough: 1 }));
      maw.position.set(f.x(l / 2, 0), top - 0.53, f.z(l / 2, 0));
      group.add(maw);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.45, 24), accentGlow);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(f.x(l / 2, 0), top + 0.03, f.z(l / 2, 0));
      group.add(ring);
      (board.hazards ??= []).push({
        center: f.vec(l / 2, 0, top), radius: r - 0.3, kind: 'kill', yMax: top + 2.2,
      });
      blocked.push({ x: f.x(l / 2, 0), z: f.z(l / 2, 0), r: r + 2 });
    }
    if (rs.feature === 'lava' || rs.feature === 'shock') {
      // channels across the room with a narrow safe bridge on the centre line
      const glow = new THREE.MeshBasicMaterial({
        color: rs.feature === 'lava' ? 0xff5a2a : 0x9fe8ff,
      });
      const dps = rs.feature === 'lava' ? 26 : 15;
      const cuts = l >= 20 ? [l * 0.38, l * 0.66] : [l * 0.5];
      for (const cu of cuts) {
        for (const side of [-1, 1]) {
          const v0 = side * 1.7, v1 = side * (w / 2 - 1.2);
          slab(f, cu - 1.2, cu + 1.2, Math.min(v0, v1), Math.max(v0, v1), top + 0.02, top + 0.1, glow);
          const span = Math.abs(v1 - v0);
          for (let d = 1.2; d < span; d += 2.4) {
            (board.hazards ??= []).push({
              center: f.vec(cu, v0 + side * d, top), radius: 1.5, kind: 'burn', dps, yMax: top + 2.2,
            });
          }
        }
        blocked.push({ x: f.x(cu, 0), z: f.z(cu, 0), r: 3 });
      }
    }
    if (rs.feature === 'barrels') {
      // rhydonium in the fight: cover that shoots back
      for (let b = 0; b < 4; b++) {
        for (let tries = 0; tries < 8; tries++) {
          const u = 3 + rand() * (l - 6);
          const v = (rand() - 0.5) * (w - 5);
          if (Math.abs(v) < 2 || !clearOf(f.x(u, v), f.z(u, v), 1.2)) continue;
          const x = f.x(u, v), z = f.z(u, v);
          const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1.4, 10),
            mat(0x7a3a24, { rough: 0.6, metal: 0.4, emissive: 0x200a04 }));
          mesh.position.set(x, top + 0.7, z);
          group.add(mesh);
          const box = board.physics.addBox(x, top + 0.7, z, 1, 1.4, 1);
          addBreakable(board, mesh, box, 30, { explosive: true });
          blocked.push({ x, z, r: 1.4 });
          break;
        }
      }
    }
    if (rs.feature === 'pillars') {
      // hard cover you can circle: pillars carry the melee dance
      for (let b = 0; b < 3; b++) {
        for (let tries = 0; tries < 8; tries++) {
          const u = 4 + rand() * (l - 8);
          const v = (rand() - 0.5) * (w - 7);
          if (Math.abs(v) < 2.4 || !clearOf(f.x(u, v), f.z(u, v), 2)) continue;
          const x = f.x(u, v), z = f.z(u, v);
          const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, wallH - 0.8, 10), wallMat);
          mesh.position.set(x, top + (wallH - 0.8) / 2, z);
          group.add(mesh);
          board.physics.addCylinder(x, top + (wallH - 0.8) / 2, z, 1.25, wallH - 0.8);
          blocked.push({ x, z, r: 2.6 });
          break;
        }
      }
    }

    // scattered cover crates in every fight room (feature 'crates' doubles up)
    if (rs.kind === 'camp' || rs.kind === 'assault') {
      const n = Math.min(5, Math.max(2, Math.round((w * l) / 110))) + (rs.feature === 'crates' ? 2 : 0);
      for (let c = 0; c < n; c++) {
        for (let tries = 0; tries < 10; tries++) {
          const u = 3 + rand() * (l - 6);
          const v = (rand() - 0.5) * (w - 5);
          if (Math.abs(v) < 2.1 || !clearOf(f.x(u, v), f.z(u, v), 1.3)) continue;
          crate(f.x(u, v), top, f.z(u, v));
          break;
        }
      }
    }

    // spawn vents (wall-adjacent) and camp posts (far half), validated later
    const vents: THREE.Vector3[] = [];
    for (const [u, v] of [
      [2.5, w / 2 - 2.5], [2.5, -(w / 2 - 2.5)],
      [l - 2.5, w / 2 - 2.5], [l - 2.5, -(w / 2 - 2.5)],
      [l / 2, w / 2 - 2], [l / 2, -(w / 2 - 2)],
    ]) vents.push(f.vec(u, v, top + 0.2));
    const posts: THREE.Vector3[] = [];
    for (const [u, v] of [
      [l * 0.6, w * 0.28], [l * 0.6, -w * 0.28], [l * 0.75, 0],
      [l * 0.82, w * 0.2], [l * 0.82, -w * 0.2],
    ]) posts.push(f.vec(u, v, top + 0.2));

    rooms.push({
      spec: rs,
      entry: f.vec(1.8, 0, top + 0.2),
      center: f.vec(l / 2, 0, top + 0.2),
      exit: f.vec(l - 1.8, 0, top + 0.2),
      rect: f.rect(0, l, -w / 2, w / 2),
      entryGate, exitGate, vents, posts,
    });

    // ---- the link to the next room: a walkable pinch, maybe with a bend ----
    if (i === last) break;
    const link = spec.links[i] ?? { len: 14 };
    const linkPosts: DefenderPost[] = [];
    let g = new Frame(f.x(l, 0), f.z(l, 0), f.dx, f.dz);

    const leg = (lf: Frame, len: number, withCrates: boolean): void => {
      const ltop = MISSION_Y + (spaceN++ % 3) * EPS;
      solid(lf, -1, len + 1, -corrW / 2 - 1, corrW / 2 + 1, ltop - 1, ltop, floorMat);
      solid(lf, -1, len + 1, -corrW / 2 - 1, corrW / 2 + 1, ltop + CORR_H, ltop + CORR_H + 1, wallMat);
      // The lane walls sit 5 cm proud (never exactly on a neighbouring wall's
      // plane, so no shimmer) and run only the lane's own span: the room and
      // junction walls at either end already seal the corners, and a wall that
      // overshot into the junction left a notch bodies wedged into at every
      // bend — found by the walkthrough audit, not by luck.
      wallV(lf, corrW / 2 + WALL_T / 2 + 0.05, 0.05, len - 0.05, [], ltop, CORR_H);
      wallV(lf, -corrW / 2 - WALL_T / 2 - 0.05, 0.05, len - 0.05, [], ltop, CORR_H);
      slab(lf, 0.5, len - 0.5, -corrW / 2 + 0.02, -corrW / 2 + 0.2, ltop + 0.04, ltop + 0.16, trimMat);
      rects.push(lf.rect(-0.5, len + 0.5, -corrW / 2 - 0.5, corrW / 2 + 0.5));
      if (withCrates && len >= 12) {
        // A staggered pair butted flush against the walls: tuck, peek, advance
        // — the cover beat in ten metres. Flush matters: a crate floating off
        // the wall leaves a gap too narrow for a body, and that pocket catches
        // anyone hugging the wall (the walkthrough audit wedged in it).
        for (const [t, side] of [[0.42, 1], [0.68, -1]] as const) {
          const ch = CRATE_H_MIN + rand() * CRATE_H_VAR;
          const across = (lf.dx !== 0 ? CRATE_D_PER_H : CRATE_W_PER_H) * ch;
          const v = side * (corrW / 2 + 0.03 - across / 2);
          crate(lf.x(len * t, v), ltop, lf.z(len * t, v), ch);
          linkPosts.push({
            pos: lf.vec(len * t + 1.5, v, ltop + 0.2),
            toward: lf.vec(0, 0, ltop),
          });
        }
      }
      // a work light per leg, so the pinch reads as interior
      const light = new THREE.PointLight(0xffd9a0, 9, len + 12, 1.6);
      light.position.set(lf.x(len / 2, 0), ltop + CORR_H - 0.5, lf.z(len / 2, 0));
      group.add(light);
    };

    leg(g, link.len, true);
    if (link.turn && link.len2) {
      // the junction: a small square, open on the incoming and outgoing sides
      const jf = new Frame(g.x(link.len, 0), g.z(link.len, 0), g.dx, g.dz);
      const jtop = MISSION_Y + (spaceN++ % 3) * EPS;
      solid(jf, -1, corrW + 1, -corrW / 2 - 1, corrW / 2 + 1, jtop - 1, jtop, floorMat);
      solid(jf, -1, corrW + 1, -corrW / 2 - 1, corrW / 2 + 1, jtop + CORR_H, jtop + CORR_H + 1, wallMat);
      wallU(jf, corrW + WALL_T / 2, -corrW / 2 - WALL_T, corrW / 2 + WALL_T, [], jtop, CORR_H);
      wallV(jf, -link.turn * (corrW / 2 + WALL_T / 2), -WALL_T, corrW + WALL_T, [], jtop, CORR_H);
      rects.push(jf.rect(0, corrW, -corrW / 2, corrW / 2));
      // turn the turtle and run the second leg from the junction's open side
      const ndx = link.turn > 0 ? jf.px : -jf.px;
      const ndz = link.turn > 0 ? jf.pz : -jf.pz;
      const g2 = new Frame(
        jf.x(corrW / 2, link.turn * (corrW / 2)),
        jf.z(corrW / 2, link.turn * (corrW / 2)), ndx, ndz);
      leg(g2, link.len2, false);
      g = g2;
      frame = new Frame(g2.x(link.len2, 0), g2.z(link.len2, 0), ndx, ndz);
    } else {
      frame = new Frame(g.x(link.len, 0), g.z(link.len, 0), g.dx, g.dz);
    }
    // bacta midway down every other pinch — the attrition beat pays for itself
    // on the side the first crate is not on — at v = +1.4 the canister sat
    // inside the crate at t = 0.42 on every straight link
    if (i % 2 === 1) pickups.push(g.vec(6, -1.4, MISSION_Y + 0.2));
    defenders.push(linkPosts);
  }

  // ---- validation: keep only spots a body actually fits in ----
  // ...and not standing in the room's own lava or shock strip: a vent on the
  // channel wall put a third of every drop into live floor
  const fits = (p: THREE.Vector3): boolean => {
    if (!board.physics.capsuleFree(p.x, p.y, p.z, 0.6, 2.1)) return false;
    const hz = hazardAt(board, p);
    return !hz.kill && hz.dps <= 0;
  };
  for (const room of rooms) {
    room.vents = room.vents.filter(fits);
    if (!room.vents.length) room.vents.push(room.center.clone());
    room.posts = room.posts.filter(fits);
    if (!room.posts.length) room.posts.push(room.center.clone());
  }
  for (let i = 0; i < defenders.length; i++) defenders[i] = defenders[i].filter((d) => fits(d.pos));

  const startRoom = rooms[0];
  const starts = [
    startRoom.center.clone().add(new THREE.Vector3(0.9, 0, 0.9)),
    startRoom.center.clone().add(new THREE.Vector3(-0.9, 0, -0.9)),
    startRoom.center.clone().add(new THREE.Vector3(0.9, 0, -0.9)),
    startRoom.center.clone().add(new THREE.Vector3(-0.9, 0, 0.9)),
  ];

  const level: MissionLevel = {
    rooms, defenders, pickups, starts,
    floorY: MISSION_Y,
    contains: (x, z) => rects.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ),
  };

  // the Crevasse's ice comes with the level: grip only fades over its footprint
  if (spec.traction !== undefined) {
    const prev = board.tractionAt;
    const grip = spec.traction;
    board.tractionAt = (x, z) => level.contains(x, z) ? grip : prev ? prev(x, z) : 1;
  }

  return level;
}

/**
 * The nine authored layouts (docs/LEVEL_DESIGN.md §5). Every territory keeps
 * its own enemy tables, sky and mood; what changes here is the shape of the
 * run: room sizes, bend patterns, set pieces, and where the sealed fights sit.
 * The champion's arena is always mid-chain, the warlord's ends it — sized up
 * on monster boards for the thing that comes out of the floor afterwards.
 */
export const MISSION_LAYOUTS: Record<BoardId, MissionSpec> = {
  desert: {
    palette: { wall: 0xa8824f, floor: 0xbf9a5e, trim: 0x8a6a2a, accent: 0xffb347 },
    rooms: [
      { kind: 'start', label: 'the trailhead', w: 12, l: 10 },
      { kind: 'camp', label: 'the outpost yard', w: 20, l: 16, feature: 'crates' },
      { kind: 'assault', label: 'the cistern court', w: 20, l: 18, waves: 2, feature: 'pit', alcove: true },
      { kind: 'camp', label: 'the caravan graves', w: 24, l: 14, feature: 'crates' },
      { kind: 'champion', label: 'the fighting pit', w: 26, l: 22 },
      { kind: 'assault', label: 'the spice cellars', w: 18, l: 16, waves: 3 },
      { kind: 'camp', label: 'the dune gate', w: 20, l: 14, alcove: true },
      { kind: 'warlord', label: "the Old One's hollow", w: 40, l: 34 },
    ],
    links: [
      { len: 16 }, { len: 14, turn: 1, len2: 12 }, { len: 16 },
      { len: 12, turn: -1, len2: 14 }, { len: 18 }, { len: 14, turn: 1, len2: 12 }, { len: 16 },
    ],
  },
  station: {
    palette: { wall: 0x2c3040, floor: 0x353a4a, trim: 0x8a6a2a, accent: 0x63b4ff },
    corrW: 5,
    rooms: [
      { kind: 'start', label: 'the docking bay', w: 12, l: 10 },
      { kind: 'assault', label: 'the cargo deck', w: 18, l: 16, waves: 2, feature: 'crates' },
      { kind: 'camp', label: 'the smuggler den', w: 20, l: 14, alcove: true },
      { kind: 'assault', label: 'the spice vault', w: 20, l: 18, waves: 2, feature: 'barrels' },
      { kind: 'champion', label: 'the loading gantry', w: 24, l: 20 },
      { kind: 'camp', label: 'the crew quarters', w: 18, l: 14, feature: 'crates', alcove: true },
      { kind: 'assault', label: 'the reactor ring', w: 20, l: 16, waves: 3 },
      { kind: 'warlord', label: 'the hold of the prize', w: 34, l: 30 },
    ],
    links: [
      { len: 14 }, { len: 12, turn: -1, len2: 12 }, { len: 14 },
      { len: 12, turn: 1, len2: 12 }, { len: 16 }, { len: 12, turn: -1, len2: 12 }, { len: 14 },
    ],
  },
  nevarro: {
    palette: { wall: 0x4a3a34, floor: 0x33241e, trim: 0x6a2a1a, accent: 0xff5a2a },
    rooms: [
      { kind: 'start', label: 'the ash flats', w: 12, l: 10 },
      { kind: 'camp', label: 'the lava trench', w: 18, l: 18, feature: 'lava' },
      { kind: 'assault', label: 'the garrison yard', w: 22, l: 16, waves: 2, feature: 'crates', alcove: true },
      { kind: 'camp', label: 'the glass fields', w: 24, l: 14 },
      { kind: 'champion', label: 'the magistrate court', w: 24, l: 22 },
      { kind: 'assault', label: 'the crossing', w: 20, l: 20, waves: 3, feature: 'lava' },
      { kind: 'camp', label: 'the cantina row', w: 18, l: 14, feature: 'crates', alcove: true },
      { kind: 'warlord', label: 'the rancor pen', w: 38, l: 32 },
    ],
    links: [
      { len: 16 }, { len: 12, turn: 1, len2: 14 }, { len: 14 },
      { len: 14, turn: -1, len2: 12 }, { len: 16 }, { len: 12, turn: 1, len2: 14 }, { len: 16 },
    ],
  },
  crevasse: {
    palette: { wall: 0xa9c4d6, floor: 0x8fb0c4, trim: 0x3a6484, accent: 0x63d0ff },
    traction: 0.55,
    rooms: [
      { kind: 'start', label: 'the rim shelf', w: 12, l: 10 },
      { kind: 'camp', label: 'the frozen gallery', w: 18, l: 16, feature: 'pillars' },
      { kind: 'assault', label: 'the nest mouth', w: 20, l: 18, waves: 2, alcove: true },
      { kind: 'camp', label: 'the cracked lake', w: 26, l: 16 },
      { kind: 'champion', label: 'the queen tunnel', w: 24, l: 20 },
      { kind: 'assault', label: 'the hatchery', w: 20, l: 18, waves: 3, feature: 'pillars' },
      { kind: 'camp', label: 'the ice chimney', w: 16, l: 14, feature: 'crates', alcove: true },
      { kind: 'warlord', label: 'the breaker deep', w: 36, l: 32 },
    ],
    links: [
      { len: 14 }, { len: 12, turn: -1, len2: 14 }, { len: 16 },
      { len: 12, turn: 1, len2: 12 }, { len: 16 }, { len: 14, turn: -1, len2: 12 }, { len: 14 },
    ],
  },
  trask: {
    palette: { wall: 0x3e4a52, floor: 0x4a3f30, trim: 0x2a4a44, accent: 0x63d0a8 },
    rooms: [
      { kind: 'start', label: 'the quay steps', w: 12, l: 10 },
      { kind: 'assault', label: 'the fish market', w: 20, l: 16, waves: 2, feature: 'crates' },
      { kind: 'camp', label: 'the net lofts', w: 18, l: 14, alcove: true },
      { kind: 'camp', label: 'the trawler deck', w: 24, l: 16, feature: 'crates' },
      { kind: 'champion', label: 'the freighter hold', w: 24, l: 20 },
      { kind: 'assault', label: 'the cold stores', w: 18, l: 16, waves: 2, feature: 'barrels' },
      { kind: 'camp', label: 'the pier heads', w: 20, l: 14, alcove: true },
      { kind: 'warlord', label: 'the mamacore pool', w: 38, l: 32 },
    ],
    links: [
      { len: 14 }, { len: 14, turn: 1, len2: 12 }, { len: 16 },
      { len: 12, turn: -1, len2: 14 }, { len: 14 }, { len: 12, turn: 1, len2: 12 }, { len: 16 },
    ],
  },
  refinery: {
    palette: { wall: 0x3a3f48, floor: 0x2c3036, trim: 0x6a4a12, accent: 0xffb347 },
    corrW: 5,
    rooms: [
      { kind: 'start', label: 'the intake hall', w: 12, l: 10 },
      { kind: 'assault', label: 'the barrel stores', w: 18, l: 16, waves: 2, feature: 'barrels' },
      { kind: 'camp', label: 'the pipe gallery', w: 16, l: 18, feature: 'crates', alcove: true },
      { kind: 'assault', label: 'the pump hall', w: 20, l: 16, waves: 2, feature: 'crates' },
      { kind: 'champion', label: 'the furnace floor', w: 22, l: 20 },
      { kind: 'assault', label: 'the rhydonium line', w: 18, l: 18, waves: 3, feature: 'barrels', alcove: true },
      { kind: 'camp', label: 'the control deck', w: 18, l: 14 },
      { kind: 'warlord', label: 'the reactor shaft', w: 34, l: 30 },
    ],
    links: [
      { len: 12, turn: 1, len2: 12 }, { len: 14 }, { len: 12, turn: -1, len2: 12 },
      { len: 14 }, { len: 12, turn: 1, len2: 12 }, { len: 14 }, { len: 12, turn: -1, len2: 12 },
    ],
  },
  forge: {
    palette: { wall: 0x6a7468, floor: 0x4a544c, trim: 0x8a6a2a, accent: 0xffd090 },
    rooms: [
      { kind: 'start', label: 'the shattered gate', w: 12, l: 10 },
      { kind: 'camp', label: 'the ruined concourse', w: 22, l: 16, feature: 'pillars' },
      { kind: 'assault', label: 'the dome undercroft', w: 20, l: 18, waves: 2, feature: 'crates', alcove: true },
      { kind: 'camp', label: 'the glassed court', w: 24, l: 14 },
      { kind: 'champion', label: 'the rockfall den', w: 24, l: 22 },
      { kind: 'assault', label: 'the armoury vault', w: 20, l: 16, waves: 3, feature: 'pillars' },
      { kind: 'camp', label: 'the forge steps', w: 18, l: 14, feature: 'crates', alcove: true },
      { kind: 'warlord', label: 'the sleeper cavern', w: 40, l: 34 },
    ],
    links: [
      { len: 16 }, { len: 14, turn: -1, len2: 12 }, { len: 16 },
      { len: 12, turn: 1, len2: 14 }, { len: 18 }, { len: 14, turn: -1, len2: 12 }, { len: 16 },
    ],
  },
  ringworld: {
    // long straight avenues under the terminator: fewer bends, longer sightlines
    palette: { wall: 0x3a4458, floor: 0x2e3648, trim: 0x2a3a5a, accent: 0x9fd0ff },
    rooms: [
      { kind: 'start', label: 'the tram stop', w: 12, l: 10 },
      { kind: 'camp', label: 'the market arcade', w: 16, l: 24, feature: 'crates' },
      { kind: 'assault', label: 'the plaza', w: 22, l: 18, waves: 2, alcove: true },
      { kind: 'camp', label: 'the night-side row', w: 16, l: 24, feature: 'crates' },
      { kind: 'champion', label: 'the sentinel walk', w: 22, l: 22 },
      { kind: 'assault', label: 'the terminus', w: 20, l: 18, waves: 3, feature: 'crates' },
      { kind: 'camp', label: 'the service spine', w: 14, l: 20, alcove: true },
      { kind: 'warlord', label: 'the high street', w: 34, l: 30 },
    ],
    links: [
      { len: 18 }, { len: 16 }, { len: 12, turn: 1, len2: 14 },
      { len: 18 }, { len: 16 }, { len: 12, turn: -1, len2: 14 }, { len: 18 },
    ],
  },
  narkina: {
    palette: { wall: 0xd8e2e8, floor: 0xc8d4dc, trim: 0x4a90a8, accent: 0x63d0ff },
    corrW: 5,
    rooms: [
      { kind: 'start', label: 'the intake lift', w: 12, l: 10 },
      { kind: 'assault', label: 'the work floor', w: 20, l: 16, waves: 2, feature: 'shock' },
      { kind: 'camp', label: 'the cell block', w: 18, l: 16, feature: 'crates', alcove: true },
      { kind: 'assault', label: 'the assembly line', w: 20, l: 18, waves: 2, feature: 'crates' },
      { kind: 'champion', label: 'the supervisor deck', w: 22, l: 20 },
      { kind: 'camp', label: 'the maintenance bay', w: 18, l: 14, alcove: true },
      { kind: 'assault', label: 'the discharge hall', w: 20, l: 18, waves: 3, feature: 'shock' },
      { kind: 'warlord', label: 'the warden bridge', w: 34, l: 30 },
    ],
    links: [
      { len: 14 }, { len: 12, turn: -1, len2: 12 }, { len: 14 },
      { len: 12, turn: 1, len2: 12 }, { len: 14 }, { len: 12, turn: -1, len2: 12 }, { len: 14 },
    ],
  },
};
