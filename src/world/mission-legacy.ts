import { TEXT } from '../text';
import { audio } from '../core/audio';
import * as THREE from 'three';
import type { Board, Hazard } from './board';
import type { StaticBox } from '../core/physics';
import { addBreakable, hazardAt } from './board';
import { mat } from '../characters/builder';
export { Gate } from './gate';
import { authoredProp } from './props';
import { loadOptionalTexture } from '../core/assets';
import { Gate } from './gate';
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
 * Everything here is geometry + data; `game/campaign-legacy.ts` owns the flow.
 *
 * **This is the previous design**, kept whole behind `?backup=missions` — see
 * docs/MISSIONS_OUTDOOR.md, which supersedes it, and `world/mission.ts`,
 * which builds the outdoor stages that replaced it. Only the `Gate` class has
 * moved out (to `world/gate.ts`, shared with the new builder); everything
 * else is untouched, so the way back is exact.
 */

export type RoomKind = 'start' | 'camp' | 'assault' | 'lieutenant' | 'warlord';
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
  /** hemisphere fill over the whole level (accent sky, floor ground); default 1.5 */
  fill?: number;
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

/**
 * The shock rooms' strips cycle like the Prison Rig's own plates (a shorter
 * beat, since a room is crossed in seconds): dark, a charging flicker, then
 * live — rather than the constant tax they were (audit L13).
 */
const SHOCK_CYCLE = 9;
const SHOCK_CHARGE_AT = 5.2;
const SHOCK_LIVE_AT = 6.4;
const SHOCK_DPS = 22;

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

export interface MissionRoom {
  spec: RoomSpec;
  /** floor-level points: just inside the entry gate, the middle, just short of the exit */
  entry: THREE.Vector3;
  center: THREE.Vector3;
  exit: THREE.Vector3;
  rect: Rect;
  /**
   * The rect a body has to be in to count as *through the door* — `rect`
   * pulled 1.2 m back from both doorways. A gate seals the moment a room
   * decides its party is in, and the door slab is part of `rect`, so the
   * last player through could be counted inside while still standing in the
   * doorway and be shut out of the room by the leaves closing on them.
   */
  sealRect: Rect;
  entryGate: Gate | null;
  exitGate: Gate | null;
  /** every validated wave-spawn spot (assault rooms): the far wall's and the sides' */
  vents: THREE.Vector3[];
  /** vents along the far wall — where a sealed room's first wave lands */
  farVents: THREE.Vector3[];
  /** vents along the side walls — where the later waves flank from */
  sideVents: THREE.Vector3[];
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
      // The tileables are dark (the wall plate averages ~22% grey), and a
      // palette tint multiplied over them left the walls at under a tenth of
      // white — a void no fill light could lift, with enemies invisible in it.
      // With the surface detail carried by the map, the tint's job is hue,
      // not value: lift it most of the way to white and let the map set the
      // brightness.
      m.color.lerp(new THREE.Color(0xffffff), 0.7);
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

  // ---- lighting ----
  // The level sits ninety metres over the territory, above whatever lit the
  // ground (Nevarro's lava glow, the docks' lamps), under a sun the walls
  // shade out of most of the floor. The dark palettes rendered as a void —
  // walls, floor and the hostiles standing on them all black (audit L1). So
  // the level carries its own light: a hemisphere fill in the palette's own
  // colours for the whole chain, and a work lamp per room at its feature.
  const hemi = new THREE.HemisphereLight(pal.accent, pal.floor, spec.fill ?? 1.5);
  hemi.position.set(0, MISSION_Y + 40, 0);
  group.add(hemi);

  const rects: Rect[] = [];
  /** the shock rooms' strips, cycled by the level's update hook below */
  const shockStrips: { hazards: Hazard[]; mat: THREE.MeshBasicMaterial; phase: number }[] = [];
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

    // the room's lamp: warm work light high on the centre line, tinted by the
    // set piece where there is one (the lava's glow, the shock strip's arc)
    const lampColor = rs.feature === 'lava' ? 0xffa070 : rs.feature === 'shock' ? 0xc8f0ff
      : rs.feature === 'pit' ? pal.accent : 0xffd9a0;
    const lamp = new THREE.PointLight(lampColor, 40 + (w * l) / 8, Math.max(w, l) * 1.7, 1.4);
    lamp.position.set(f.x(l / 2, 0), top + wallH - 0.3, f.z(l / 2, 0));
    group.add(lamp);

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
      const dps = rs.feature === 'lava' ? 26 : SHOCK_DPS;
      const cuts = l >= 20 ? [l * 0.38, l * 0.66] : [l * 0.5];
      cuts.forEach((cu, ci) => {
        // a shock strip gets its own sheet, since its glow follows its cycle
        const glow = new THREE.MeshBasicMaterial({
          color: rs.feature === 'lava' ? 0xff5a2a : 0x9fe8ff,
          transparent: rs.feature === 'shock', opacity: 1,
        });
        const strip: Hazard[] = [];
        for (const side of [-1, 1]) {
          const v0 = side * 1.7, v1 = side * (w / 2 - 1.2);
          slab(f, cu - 1.2, cu + 1.2, Math.min(v0, v1), Math.max(v0, v1), top + 0.02, top + 0.1, glow);
          const span = Math.abs(v1 - v0);
          for (let d = 1.2; d < span; d += 2.4) {
            const h: Hazard = {
              center: f.vec(cu, v0 + side * d, top), radius: 1.5, kind: 'burn', dps, yMax: top + 2.2,
            };
            (board.hazards ??= []).push(h);
            strip.push(h);
          }
        }
        // the two strips of a room run half a cycle apart, so one is always
        // the one to cross — the hop rhythm, not a constant tax
        if (rs.feature === 'shock') shockStrips.push({ hazards: strip, mat: glow, phase: ci * SHOCK_CYCLE / 2 });
        blocked.push({ x: f.x(cu, 0), z: f.z(cu, 0), r: 3 });
      });
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
    const isArena = rs.kind === 'lieutenant' || rs.kind === 'warlord';
    if (isArena) {
      // The boss stands up in the middle and the monster erupts where the
      // warlord fell, so the centre stays open; cover goes round it.
      blocked.push({ x: f.x(l / 2, 0), z: f.z(l / 2, 0), r: 7 });
    }
    if (rs.feature === 'pillars' || isArena) {
      // hard cover you can circle: pillars carry the melee dance — and give a
      // ranged boss's arena something other than a stand-and-trade fight
      // (audit L6: the arenas were empty boxes)
      const lane = isArena ? 4 : 2.4;
      for (let b = 0; b < 3; b++) {
        for (let tries = 0; tries < 10; tries++) {
          const u = 4 + rand() * (l - 8);
          const v = (rand() - 0.5) * (w - 7);
          if (Math.abs(v) < lane || !clearOf(f.x(u, v), f.z(u, v), 2)) continue;
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
    if (isArena) {
      for (let c = 0; c < 2; c++) {
        for (let tries = 0; tries < 10; tries++) {
          const u = 4 + rand() * (l - 8);
          const v = (rand() - 0.5) * (w - 6);
          if (Math.abs(v) < 4 || !clearOf(f.x(u, v), f.z(u, v), 1.3)) continue;
          crate(f.x(u, v), top, f.z(u, v));
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

    // Spawn vents, validated later: along the far wall (the first wave of a
    // sealed room comes at you from the front) and along the sides (later
    // waves flank). None beside the entry gate — two of the old six sat there,
    // and half a squad landed behind the party seven metres from the door.
    const farVents: THREE.Vector3[] = [];
    for (const [u, v] of [
      [l - 2.5, w / 2 - 2.5], [l - 2.5, -(w / 2 - 2.5)],
      [l - 2.5, w * 0.17], [l - 2.5, -w * 0.17],
    ]) farVents.push(f.vec(u, v, top + 0.2));
    const sideVents: THREE.Vector3[] = [];
    for (const [u, v] of [
      [l * 0.5, w / 2 - 2], [l * 0.5, -(w / 2 - 2)],
      [l * 0.32, w / 2 - 2.5], [l * 0.32, -(w / 2 - 2.5)],
      [l * 0.7, w / 2 - 2.5], [l * 0.7, -(w / 2 - 2.5)],
    ]) sideVents.push(f.vec(u, v, top + 0.2));
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
      sealRect: f.rect(1.2, l - 1.2, -w / 2, w / 2),
      entryGate, exitGate, farVents, sideVents, vents: [], posts,
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
    room.farVents = room.farVents.filter(fits);
    room.sideVents = room.sideVents.filter(fits);
    room.vents = [...room.farVents, ...room.sideVents];
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

  // The shock strips' clock rides the board's own update. Validation above ran
  // with every strip live, so no vent or post stands on one; from here the
  // strips only bite in their live phase, and the sheet says which that is.
  if (shockStrips.length) {
    const prev = board.update;
    board.update = (dt, time, game) => {
      prev?.(dt, time, game);
      for (const s of shockStrips) {
        const t = (time + s.phase) % SHOCK_CYCLE;
        const live = t >= SHOCK_LIVE_AT;
        const charging = !live && t >= SHOCK_CHARGE_AT;
        for (const h of s.hazards) h.dps = live ? SHOCK_DPS : 0;
        s.mat.opacity = live ? 0.85 + Math.sin(time * 30) * 0.12
          : charging ? 0.2 + ((t - SHOCK_CHARGE_AT) / (SHOCK_LIVE_AT - SHOCK_CHARGE_AT)) * 0.4 * (Math.sin(time * 14) * 0.5 + 0.5)
            : 0.12;
      }
    };
  }

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
 * The lieutenant's arena is always mid-chain, the warlord's ends it — sized up
 * on monster boards for the thing that comes out of the floor afterwards.
 */
const ROOMS = TEXT.missions.rooms;

export const MISSION_LAYOUTS: Record<BoardId, MissionSpec> = {
  desert: {
    palette: { wall: 0xa8824f, floor: 0xbf9a5e, trim: 0x8a6a2a, accent: 0xffb347 },
    rooms: [
      { kind: 'start', label: ROOMS.desert[0], w: 12, l: 10 },
      { kind: 'camp', label: ROOMS.desert[1], w: 20, l: 16, feature: 'crates' },
      { kind: 'assault', label: ROOMS.desert[2], w: 20, l: 18, waves: 2, feature: 'pit', alcove: true },
      { kind: 'camp', label: ROOMS.desert[3], w: 24, l: 14, feature: 'crates' },
      { kind: 'lieutenant', label: ROOMS.desert[4], w: 26, l: 22 },
      { kind: 'assault', label: ROOMS.desert[5], w: 18, l: 16, waves: 3 },
      { kind: 'camp', label: ROOMS.desert[6], w: 20, l: 14, alcove: true },
      { kind: 'warlord', label: ROOMS.desert[7], w: 40, l: 34 },
    ],
    links: [
      { len: 16 }, { len: 14, turn: 1, len2: 12 }, { len: 16 },
      { len: 12, turn: -1, len2: 14 }, { len: 18 }, { len: 14, turn: 1, len2: 12 }, { len: 16 },
    ],
  },
  station: {
    palette: { wall: 0x3d4359, floor: 0x4a5168, trim: 0x8a6a2a, accent: 0x63b4ff },
    corrW: 5,
    rooms: [
      { kind: 'start', label: ROOMS.station[0], w: 12, l: 10 },
      { kind: 'assault', label: ROOMS.station[1], w: 18, l: 16, waves: 2, feature: 'crates' },
      { kind: 'camp', label: ROOMS.station[2], w: 20, l: 14, alcove: true },
      { kind: 'assault', label: ROOMS.station[3], w: 20, l: 18, waves: 2, feature: 'barrels' },
      { kind: 'lieutenant', label: ROOMS.station[4], w: 24, l: 20 },
      { kind: 'camp', label: ROOMS.station[5], w: 18, l: 14, feature: 'crates', alcove: true },
      { kind: 'assault', label: ROOMS.station[6], w: 20, l: 16, waves: 3 },
      { kind: 'warlord', label: ROOMS.station[7], w: 34, l: 30 },
    ],
    links: [
      { len: 14 }, { len: 12, turn: -1, len2: 12 }, { len: 14 },
      { len: 12, turn: 1, len2: 12 }, { len: 16 }, { len: 12, turn: -1, len2: 12 }, { len: 14 },
    ],
  },
  nevarro: {
    palette: { wall: 0x68514a, floor: 0x47322a, trim: 0x6a2a1a, accent: 0xff5a2a },
    rooms: [
      { kind: 'start', label: ROOMS.nevarro[0], w: 12, l: 10 },
      { kind: 'camp', label: ROOMS.nevarro[1], w: 18, l: 18, feature: 'lava' },
      { kind: 'assault', label: ROOMS.nevarro[2], w: 22, l: 16, waves: 2, feature: 'crates', alcove: true },
      { kind: 'camp', label: ROOMS.nevarro[3], w: 24, l: 14 },
      { kind: 'lieutenant', label: ROOMS.nevarro[4], w: 24, l: 22 },
      { kind: 'assault', label: ROOMS.nevarro[5], w: 20, l: 20, waves: 3, feature: 'lava' },
      { kind: 'camp', label: ROOMS.nevarro[6], w: 18, l: 14, feature: 'crates', alcove: true },
      { kind: 'warlord', label: ROOMS.nevarro[7], w: 38, l: 32 },
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
      { kind: 'start', label: ROOMS.crevasse[0], w: 12, l: 10 },
      { kind: 'camp', label: ROOMS.crevasse[1], w: 18, l: 16, feature: 'pillars' },
      { kind: 'assault', label: ROOMS.crevasse[2], w: 20, l: 18, waves: 2, alcove: true },
      { kind: 'camp', label: ROOMS.crevasse[3], w: 26, l: 16 },
      { kind: 'lieutenant', label: ROOMS.crevasse[4], w: 24, l: 20 },
      { kind: 'assault', label: ROOMS.crevasse[5], w: 20, l: 18, waves: 3, feature: 'pillars' },
      { kind: 'camp', label: ROOMS.crevasse[6], w: 16, l: 14, feature: 'crates', alcove: true },
      { kind: 'warlord', label: ROOMS.crevasse[7], w: 36, l: 32 },
    ],
    links: [
      { len: 14 }, { len: 12, turn: -1, len2: 14 }, { len: 16 },
      { len: 12, turn: 1, len2: 12 }, { len: 16 }, { len: 14, turn: -1, len2: 12 }, { len: 14 },
    ],
  },
  trask: {
    palette: { wall: 0x576873, floor: 0x685843, trim: 0x2a4a44, accent: 0x63d0a8 },
    rooms: [
      { kind: 'start', label: ROOMS.trask[0], w: 12, l: 10 },
      { kind: 'assault', label: ROOMS.trask[1], w: 20, l: 16, waves: 2, feature: 'crates' },
      { kind: 'camp', label: ROOMS.trask[2], w: 18, l: 14, alcove: true },
      { kind: 'camp', label: ROOMS.trask[3], w: 24, l: 16, feature: 'crates' },
      { kind: 'lieutenant', label: ROOMS.trask[4], w: 24, l: 20 },
      { kind: 'assault', label: ROOMS.trask[5], w: 18, l: 16, waves: 2, feature: 'barrels' },
      { kind: 'camp', label: ROOMS.trask[6], w: 20, l: 14, alcove: true },
      { kind: 'warlord', label: ROOMS.trask[7], w: 38, l: 32 },
    ],
    links: [
      { len: 14 }, { len: 14, turn: 1, len2: 12 }, { len: 16 },
      { len: 12, turn: -1, len2: 14 }, { len: 14 }, { len: 12, turn: 1, len2: 12 }, { len: 16 },
    ],
  },
  refinery: {
    palette: { wall: 0x515864, floor: 0x3d434b, trim: 0x6a4a12, accent: 0xffb347 },
    corrW: 5,
    rooms: [
      { kind: 'start', label: ROOMS.refinery[0], w: 12, l: 10 },
      { kind: 'assault', label: ROOMS.refinery[1], w: 18, l: 16, waves: 2, feature: 'barrels' },
      { kind: 'camp', label: ROOMS.refinery[2], w: 16, l: 18, feature: 'crates', alcove: true },
      { kind: 'assault', label: ROOMS.refinery[3], w: 20, l: 16, waves: 2, feature: 'crates' },
      { kind: 'lieutenant', label: ROOMS.refinery[4], w: 22, l: 20 },
      { kind: 'assault', label: ROOMS.refinery[5], w: 18, l: 18, waves: 3, feature: 'barrels', alcove: true },
      { kind: 'camp', label: ROOMS.refinery[6], w: 18, l: 14 },
      { kind: 'warlord', label: ROOMS.refinery[7], w: 34, l: 30 },    ],
    links: [
      { len: 12, turn: 1, len2: 12 }, { len: 14 }, { len: 12, turn: -1, len2: 12 },
      { len: 14 }, { len: 12, turn: 1, len2: 12 }, { len: 14 }, { len: 12, turn: -1, len2: 12 },
    ],
  },
  forge: {
    palette: { wall: 0x6a7468, floor: 0x4a544c, trim: 0x8a6a2a, accent: 0xffd090 },
    rooms: [
      { kind: 'start', label: ROOMS.forge[0], w: 12, l: 10 },
      { kind: 'camp', label: ROOMS.forge[1], w: 22, l: 16, feature: 'pillars' },
      { kind: 'assault', label: ROOMS.forge[2], w: 20, l: 18, waves: 2, feature: 'crates', alcove: true },
      { kind: 'camp', label: ROOMS.forge[3], w: 24, l: 14 },
      { kind: 'lieutenant', label: ROOMS.forge[4], w: 24, l: 22 },
      { kind: 'assault', label: ROOMS.forge[5], w: 20, l: 16, waves: 3, feature: 'pillars' },
      { kind: 'camp', label: ROOMS.forge[6], w: 18, l: 14, feature: 'crates', alcove: true },
      { kind: 'warlord', label: ROOMS.forge[7], w: 40, l: 34 },
    ],
    links: [
      { len: 16 }, { len: 14, turn: -1, len2: 12 }, { len: 16 },
      { len: 12, turn: 1, len2: 14 }, { len: 18 }, { len: 14, turn: -1, len2: 12 }, { len: 16 },
    ],
  },
  ringworld: {
    // long straight avenues under the terminator: fewer bends, longer sightlines
    palette: { wall: 0x515f7b, floor: 0x404b64, trim: 0x2a3a5a, accent: 0x9fd0ff },
    rooms: [
      { kind: 'start', label: ROOMS.ringworld[0], w: 12, l: 10 },
      { kind: 'camp', label: ROOMS.ringworld[1], w: 16, l: 24, feature: 'crates' },
      { kind: 'assault', label: ROOMS.ringworld[2], w: 22, l: 18, waves: 2, alcove: true },
      { kind: 'camp', label: ROOMS.ringworld[3], w: 16, l: 24, feature: 'crates' },
      { kind: 'lieutenant', label: ROOMS.ringworld[4], w: 22, l: 22 },
      { kind: 'assault', label: ROOMS.ringworld[5], w: 20, l: 18, waves: 3, feature: 'crates' },
      { kind: 'camp', label: ROOMS.ringworld[6], w: 14, l: 20, alcove: true },
      { kind: 'warlord', label: ROOMS.ringworld[7], w: 34, l: 30 },    ],
    links: [
      { len: 18 }, { len: 16 }, { len: 12, turn: 1, len2: 14 },
      { len: 18 }, { len: 16 }, { len: 12, turn: -1, len2: 14 }, { len: 18 },
    ],
  },
  narkina: {
    palette: { wall: 0xd8e2e8, floor: 0xc8d4dc, trim: 0x4a90a8, accent: 0x63d0ff },
    corrW: 5,
    rooms: [
      { kind: 'start', label: ROOMS.narkina[0], w: 12, l: 10 },
      { kind: 'assault', label: ROOMS.narkina[1], w: 20, l: 16, waves: 2, feature: 'shock' },
      { kind: 'camp', label: ROOMS.narkina[2], w: 18, l: 16, feature: 'crates', alcove: true },
      { kind: 'assault', label: ROOMS.narkina[3], w: 20, l: 18, waves: 2, feature: 'crates' },
      { kind: 'lieutenant', label: ROOMS.narkina[4], w: 22, l: 20 },
      { kind: 'camp', label: ROOMS.narkina[5], w: 18, l: 14, alcove: true },
      { kind: 'assault', label: ROOMS.narkina[6], w: 20, l: 18, waves: 3, feature: 'shock' },
      { kind: 'warlord', label: ROOMS.narkina[7], w: 34, l: 30 },    ],
    links: [
      { len: 14 }, { len: 12, turn: -1, len2: 12 }, { len: 14 },
      { len: 12, turn: 1, len2: 12 }, { len: 14 }, { len: 12, turn: -1, len2: 12 }, { len: 14 },
    ],
  },
};

// A room the layout has and the text does not would be announced to the player
// as "undefined" — the sort of thing that reaches a build because nobody walks
// every room of every territory. Caught here instead, at load, by name.
for (const [board, spec] of Object.entries(MISSION_LAYOUTS)) {
  for (const [i, room] of spec.rooms.entries()) {
    if (!room.label) console.warn(`[mission] ${board} room ${i} has no name in TEXT.missions.rooms`);
  }
}
