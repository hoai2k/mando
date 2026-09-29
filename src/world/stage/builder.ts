import * as THREE from 'three';
import type { Board, Hazard, VehicleSpec } from '../board';
import type { StaticBox, StaticCylinder } from '../../core/physics';
import { mat } from '../../characters/builder';
import { loadOptionalTexture } from '../../core/assets';
import type { MissionSpec, DefenderPost } from '../mission';
import { MISSION_Y, WALL_H, RIDGE_LOOK, rng, stageFloorTexture, type Rect } from './common';
import { stagePrimitives } from './primitives';
import { stageRidges } from './ridge';
import { stageDressing } from './dressing';

/**
 * The state every phase of a stage's build shares.
 *
 * `buildStage` used to be one function of seventeen hundred lines whose
 * phases — the zones, the links between them, the canyon, the transport
 * doors, the border merge, validation, the teardown — shared everything
 * through closures. They are separate modules now, and this is what they
 * share instead: the stage's derived flags, its materials and group, the
 * lists of everything it adds to the world (so `dispose` can take it back),
 * where it stands, and the placing helpers, which close over the same object.
 *
 * It is **one object**, deliberately, and grown in place by
 * `createStageBuilder` rather than spread into copies: `spaceN` and `retired`
 * are read live — a sculpt that lands after the stage was torn down checks
 * `retired` when it lands — and a copy would read the value it was made with.
 *
 * The build is a pure move of the old function: the phases run in the same
 * order, and the seeded dice (`rand`) are drawn in the same order, so a
 * territory's level comes out identical.
 */
export function beginStage(board: Board, spec: MissionSpec, index: number, beat0: number) {
  const stage = spec.stages[index];
  const pal = spec.palette;
  const corrW = spec.corrW ?? 6;
  const baseWallH = spec.wallH ?? WALL_H;
  const ceiling = stage.ceiling ?? spec.ceiling;
  const interior = stage.kind === 'interior';
  /** this stage stands on ground the board already has, not on plates */
  const onGround = stage.kind === 'territory' || stage.kind === 'plant' || stage.kind === 'sea';
  // Built stages stand on their own plates. The territory's analytic terrain
  // continues beyond its visible mesh; on the Dune Sea it climbs through the
  // last boss floor, making everyone walk up an invisible slope. Let the
  // plates alone supply ground until this stage is disposed.
  const worldHeightAt = board.physics.heightAt;
  if (!onGround) board.physics.heightAt = null;
  /** a `plant` adds fights to a building that is already built; it lays no geometry */
  const bare = stage.kind === 'plant' || stage.kind === 'sea';
  const wantRim = stage.rim ?? (stage.kind === 'territory');
  /**
   * One canyon down the whole chain, in place of a rim per zone. Only ground
   * stages that build their own geometry can have one: a `plant` and a `sea`
   * are held in by the building and the water they stand in.
   */
  const canyon = bare ? undefined : stage.canyon;
  const terrainAt = (x: number, z: number): number =>
    worldHeightAt ? worldHeightAt(x, z) : 0;
  const rand = rng(index * 104729 + stage.zones.length * 7919 + pal.wall);

  // ---- materials (own copies: mat() caches by colour and shares game-wide) ----
  const wallMat = mat(pal.wall, { rough: 0.75, metal: 0.25 }).clone();
  const floorMat = mat(pal.floor, { rough: 0.85, metal: 0.15 }).clone();
  /**
   * The floor of anything roofed — a hall, a corridor, a closet, a door's
   * pocket. Chosen by the shell rather than by the stage: a hall on a built
   * stage used to take the stage's sand (the Dune Sea's cistern court read as
   * a sand-floored steel room), and an open zone on an interior stage took
   * the corridor plate (the Crevasse's cracked lake was diamond plate).
   */
  const hallFloorMat = mat(pal.floor, { rough: 0.85, metal: 0.15 }).clone();
  const rockMat = mat(pal.rock, { rough: 0.92, metal: 0.05 }).clone();
  const backdropMat = mat(pal.backdrop, { rough: 1, metal: 0 }).clone();
  const crateMat = mat(0x4a4436, { rough: 0.8, metal: 0.2 }).clone();
  const trimMat = mat(pal.trim, { rough: 0.5, metal: 0.4, emissive: pal.trim }).clone();
  const accentGlow = new THREE.MeshBasicMaterial({ color: pal.accent });
  const owned: { dispose(): void }[] = [wallMat, floorMat, hallFloorMat, rockMat, backdropMat, crateMat, trimMat, accentGlow];
  /**
   * Dress a material with its tileable, and with the normal and emissive maps
   * that came with it where they exist.
   *
   * The cliff set ships `<name>_normal.png` alongside each face, and that is
   * most of what sells a cliff at 30 m: the albedo carries the strata, the
   * normal carries the fact that they stick out. Both are optional — a
   * missing file leaves the palette colour standing, as everywhere else in
   * this game.
   */
  const tile = (m: THREE.MeshStandardMaterial, name: string, rx: number, ry: number,
    opts: { normal?: boolean; glow?: string } = {}): void => {
    loadOptionalTexture(name, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rx, ry);
      m.map = tex;
      // the tileables are dark; with the surface detail carried by the map the
      // tint's job is hue, not value
      m.color.lerp(new THREE.Color(0xffffff), 0.7);
      m.needsUpdate = true;
    }, { exts: ['jpg', 'png'] });
    if (opts.normal) {
      loadOptionalTexture(`${name}_normal`, (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(rx, ry);
        m.normalMap = tex;
        m.needsUpdate = true;
      }, { exts: ['png', 'jpg'] });
    }
    if (opts.glow) {
      loadOptionalTexture(opts.glow, (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(rx, ry);
        m.emissiveMap = tex;
        m.emissive = new THREE.Color(0xffffff);
        m.emissiveIntensity = 0.85;
        m.needsUpdate = true;
      }, { exts: ['jpg', 'png'] });
    }
  };
  const look = RIDGE_LOOK[spec.ridge];
  tile(wallMat, 'corridor_wall', 6, 2);
  tile(floorMat, stageFloorTexture(spec.ridge), 8, 8);
  tile(hallFloorMat, 'corridor_floor', 8, 8);
  tile(crateMat, 'corridor_wall', 1, 1);
  tile(rockMat, look.tex, 2, 1, { normal: true, glow: look.glow });
  tile(backdropMat, look.tex, 3, 1);

  const group = new THREE.Group();
  group.name = `mission-stage-${index}`;
  board.group.add(group);

  // ---- what this stage added, for the swap ----
  const boxes: StaticBox[] = [];
  const cylinders: StaticCylinder[] = [];
  const hazards: Hazard[] = [];
  const breakables: { mesh: THREE.Object3D }[] = [];
  const rects: Rect[] = [];
  const pickups: THREE.Vector3[] = [];
  const defenders: DefenderPost[][] = [];
  const rides: VehicleSpec[] = [];
  const path: THREE.Vector3[] = [];
  const blocked: { x: number; z: number; r: number }[] = [];
  const shockStrips: { hazards: Hazard[]; mat: THREE.MeshBasicMaterial; phase: number }[] = [];
  /** rim faces, merged per stage into one draw call each */
  const rimGeo: THREE.BufferGeometry[] = [];
  /**
   * Where each piece of border rock stands, parallel to `rimGeo`, so the merge
   * at the end of the build can throw out the ones that turned out to be in
   * the way. Nothing earlier can judge them: a rim is laid zone by zone, and
   * the floor it might be standing on — the link out of that zone, the pocket
   * behind a door — is not built until later.
   */
  const rimAt: { x: number; z: number; r: number; h: number }[] = [];
  const backGeo: THREE.BufferGeometry[] = [];
  /**
   * Where each backdrop piece stands, parallel to `backGeo`. The row behind
   * is scenery — mesh only, "which nothing has to reach" — and that is true
   * of a border seen from the one side it was laid for. A chain that bends
   * puts the *next* lane behind this one's wall, fourteen to twenty-four
   * metres away, exactly where the row is laid: a twenty-metre boulder with
   * no collider standing in the middle of a ravine. The floor audit measured
   * a hundred and twenty such points in the Dune Sea's ravine and six hundred
   * on its far side, and both older audits skipped every one of them as
   * "decor, said so". So the merge checks the row against the floors too.
   */
  const backAt: { x: number; z: number; r: number }[] = [];
  /**
   * Ways through that are not the golden path but must stay just as clear —
   * a runner pass's gully and the notch it comes through. The border merge
   * treats them as it treats the path; the guidance never sees them.
   */
  const lanes: THREE.Vector3[][] = [];
  /** the slick discs the zones lay: centre and radius */
  const slicks: { x: number; z: number; r: number }[] = [];

  const removeBoxes = (bs: StaticBox[]): void => {
    const gone = new Set<StaticBox>(bs);
    board.physics.boxes = board.physics.boxes.filter((b) => !gone.has(b));
  };
  const addBox = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): StaticBox => {
    const b = board.physics.addBox(cx, cy, cz, sx, sy, sz);
    boxes.push(b);
    return b;
  };
  const addCyl = (cx: number, cy: number, cz: number, r: number, h: number): StaticCylinder => {
    const c = board.physics.addCylinder(cx, cy, cz, r, h);
    cylinders.push(c);
    return c;
  };
  const addHazard = (h: Hazard): Hazard => {
    (board.hazards ??= []).push(h);
    hazards.push(h);
    return h;
  };

  // A plate stage floats at a fixed altitude; a ground stage takes the height
  // of the ground it was anchored to. The ceiling is measured off the *highest*
  // ground the chain crosses, so a lid never comes down on someone standing on
  // a rise — the ceiling is meant to be unfelt, and a dune is no exception.
  const raw = stage.anchor ?? { x: 0, z: 0, dx: 1, dz: 0 };
  // The turtle steps by `dx`/`dz` directly, so a heading that is not unit
  // length silently scales every zone and every link along with it — a
  // diagonal written as (1, -1) walks the whole chain √2 too far.
  const aLen = Math.hypot(raw.dx, raw.dz) || 1;
  const anchor = { x: raw.x, z: raw.z, dx: raw.dx / aLen, dz: raw.dz / aLen };
  const floorY = onGround ? terrainAt(anchor.x, anchor.z) : MISSION_Y;
  /**
   * Floor raised off a plate stage's one height: a deck's upper plate, a
   * hall's gallery. Filled in as the zones are laid and read live, so every
   * spot placed afterwards — posts, vents, cover, the party's inside test —
   * stands on it rather than inside it.
   */
  const raised: { minX: number; maxX: number; minZ: number; maxZ: number; y: number }[] = [];
  const groundAt = (x: number, z: number): number => {
    if (onGround) return terrainAt(x, z);
    for (const r of raised) if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.y;
    return floorY;
  };
  let highest = floorY;
  if (onGround) {
    // Sample the ground the chain actually crosses — its zones and the links
    // between them, plus a little margin. Overshooting is not harmless: on a
    // bowl-shaped board the terrain climbs steeply once you are past the
    // playable area, so sampling fifty metres beyond the last zone measured
    // the rim the party never reaches and lifted the ceiling twenty metres
    // over where it was authored.
    let reach = 12;
    for (const zs of stage.zones) reach += zs.l;
    for (const link of stage.links) reach += link.len + (link.len2 ?? 0);
    for (let t = 0; t <= reach; t += 8) {
      for (let side = -40; side <= 40; side += 20) {
        const x = anchor.x + anchor.dx * t - anchor.dz * side;
        const z = anchor.z + anchor.dz * t + anchor.dx * side;
        highest = Math.max(highest, terrainAt(x, z));
      }
    }
  }
  const ceilingY = (onGround ? highest : floorY) + ceiling;

  // ---- lighting ----
  // Outdoors the territory's own sun does most of the work and the fill only
  // has to keep a cliff face in shadow off black; an interior has no sky at
  // all and carries the whole of its own light.
  const hemi = new THREE.HemisphereLight(pal.accent, pal.floor,
    stage.world?.fill ?? (interior ? 1.5 : 0.8));
  hemi.position.set(0, floorY + 40, 0);
  group.add(hemi);

  return {
    board, spec, stage, index, beat0,
    pal, corrW, baseWallH, ceiling, interior, onGround, worldHeightAt, bare, wantRim, canyon,
    terrainAt, rand,
    wallMat, floorMat, hallFloorMat, rockMat, backdropMat, crateMat, trimMat, accentGlow, owned, look,
    group,
    boxes, cylinders, hazards, breakables, rects, pickups, defenders, rides, path, blocked,
    shockStrips, rimGeo, rimAt, backGeo, backAt, lanes, slicks,
    /** a counter for staggering adjacent floor plates (see `EPS`) */
    spaceN: 0,
    /**
     * Whether this stage has been torn down. A sculpt lands frames — sometimes
     * seconds — after it is asked for, and a stage swap can happen in between:
     * the fit that arrives late has to be dropped rather than installed into a
     * world the stage no longer owns.
     */
    retired: false,
    removeBoxes, addBox, addCyl, addHazard,
    anchor, floorY, groundAt, raised, ceilingY,
  };
}

export type StageState = ReturnType<typeof beginStage>;
export type StageBuilder = StageState
  & ReturnType<typeof stagePrimitives>
  & ReturnType<typeof stageRidges>
  & ReturnType<typeof stageDressing>;

/** raise the shared state, then hang the placing helpers off the same object */
export function createStageBuilder(board: Board, spec: MissionSpec, index: number, beat0: number): StageBuilder {
  const state = beginStage(board, spec, index, beat0);
  const withPrimitives = Object.assign(state, stagePrimitives(state));
  const withRidges = Object.assign(withPrimitives, stageRidges(withPrimitives));
  return Object.assign(withRidges, stageDressing(withRidges));
}
