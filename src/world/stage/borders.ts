import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadOptionalTexture } from '../../core/assets';
import { RIM_BARE_MIN, RIM_SOLID_FRACTION, PATH_CLEAR, PATH_WALKABLE } from './common';
import type { Portal } from './barriers';
import type { StageBuilder } from './builder';

/**
 * The end of the border work, once everything that might stand in its way
 * has been laid: every piece of rim rock is backed by a collider or taken off
 * the way through, the backdrop row is cleared off the level's floor, and
 * both are merged into a few draw calls by neighbourhood.
 */
export function settleBorders(b: StageBuilder, exitPortal: Portal | null, backPortal: Portal | null): void {
  const {
    stage, rockMat, backdropMat, group, boxes, cylinders, rects, path, lanes, rimGeo, rimAt, backGeo, backAt,
    groundAt, addCyl,
  } = b;

  // A single merged rim made every cliff on a stage share one frustum bound:
  // seeing one nearby rock drew the entire chain, including its shadow pass.
  // Merge nearby pieces instead, so Three can skip sections behind the camera.
  const mergeInto = (geos: THREE.BufferGeometry[], m: THREE.Material,
    shadow: boolean, tag: 'facing' | 'decor' | null): void => {
    if (!geos.length) return;
    const cells = new Map<string, THREE.BufferGeometry[]>();
    for (const geo of geos) {
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const key = `${Math.floor((box.min.x + box.max.x) / 96)},${Math.floor((box.min.z + box.max.z) / 96)}`;
      const cell = cells.get(key);
      if (cell) cell.push(geo);
      else cells.set(key, [geo]);
    }
    for (const cell of cells.values()) {
      const merged = mergeGeometries(cell, false);
      for (const geo of cell) geo.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = shadow;
      if (tag) mesh.userData[tag] = true;
      group.add(mesh);
    }
  };
  // The rim rock is the border's *facing*, not the border. `ridge()` says it
  // outright: the wall is one slab per run, and the rock is laid outward from
  // that slab so its inward face lands on the slab's face — "the rocks are
  // what you see; this is what you walk into". A five-metre boulder set into a
  // 3.2 m slab therefore has most of its surface outside its own collider by
  // construction, which is not a hole and cannot be told apart from one by
  // looking at the mesh. `facing` says which it is; the slab behind it is
  // checked by test-missions (every run, clearing the ceiling) and by this
  // audit's own pass for colliders with nothing on them.
  // ---- a border piece never stands on the floor the level laid ----
  //
  // `ridge` pushes its rock outward from the collider slab so the face of the
  // cliff lands on the face of the wall. That holds along a run and fails at
  // its ends: where a lane turns, or where a stage's own doorway cuts the rim,
  // the pieces closing one run reach across the next one's floor — and the
  // slab under them follows the run they belong to, not the one they are
  // standing in. What that is, standing in it, is a wall drawn across the way
  // on with nothing to stop you: the golden path goes through it, the floor
  // arrow points at it, and you walk through it. Reported from the ravine, and
  // true at the mouth of nearly every stage on the other eight boards.
  const onFloor = (x: number, z: number): boolean =>
    rects.some((rc) => x > rc.minX && x < rc.maxX && z > rc.minZ && z < rc.maxZ);
  /** the nearest point of any laid floor to `(x, z)`, and how far off it is */
  const nearestFloor = (x: number, z: number): number => {
    let best = Infinity;
    for (const rc of rects) {
      const cx = Math.min(Math.max(x, rc.minX), rc.maxX);
      const cz = Math.min(Math.max(z, rc.minZ), rc.maxZ);
      best = Math.min(best, Math.hypot(x - cx, z - cz));
    }
    return best;
  };
  /**
   * Is something solid here, at the height a body walks?
   *
   * The height is the whole of it. Asked a third of the way up a fifty-metre
   * cliff, the rock over a doorway answers yes — that lintel *is* solid, and
   * the doorway under it is not, which is the one place rock gets drawn across
   * a way through. A wall is only a wall where you would walk into it.
   */
  const backedAt = (x: number, z: number): boolean => {
    const y = groundAt(x, z) + 1;
    return boxes.some((b) => x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z
      && y > b.min.y && y < b.max.y)
      || cylinders.some((c) => y > c.minY && y < c.maxY && (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r);
  };
  /** how near the golden path — or a runner's lane — a piece may stand before it is in the way */
  const segments: [THREE.Vector3, THREE.Vector3][] = [];
  for (const line of [path, ...lanes]) {
    for (let i = 0; i + 1 < line.length; i++) segments.push([line[i], line[i + 1]]);
  }
  const pathNear = (x: number, z: number): number => {
    let best = Infinity;
    for (const [a2, b2] of segments) {
      const dx = b2.x - a2.x, dz = b2.z - a2.z;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 1e-6
        ? Math.max(0, Math.min(1, ((x - a2.x) * dx + (z - a2.z) * dz) / len2)) : 0;
      best = Math.min(best, Math.hypot(x - (a2.x + dx * t), z - (a2.z + dz * t)));
    }
    return best;
  };

  /**
   * Is a solid of this reach standing in one of the stage's doorways?
   *
   * `PORTAL_CLEAR` is the widest capsule the game walks around (a playable war
   * beast, clamped to 0.6 in `roster.ts`) and a hand's width over, so a body
   * can stand in the opening rather than merely not quite touch the rock.
   */
  const PORTAL_CLEAR = 0.95;
  const blocksADoorway = (x: number, z: number, r: number): boolean =>
    [exitPortal, backPortal].some((p) =>
      p !== null && Math.hypot(x - p.pos.x, z - p.pos.z) < r + PORTAL_CLEAR);

  // ---- a border piece is either solid or it is not there ----
  //
  // `ridge` pushes its rock outward from the collider slab so the face of the
  // cliff lands on the face of the wall. That holds along a run and fails at
  // its ends: where a lane turns, or where a stage's doorway cuts the rim, the
  // pieces closing one run reach across the next one's floor, and the slab
  // under them follows the run they belong to. Standing in it, that is a wall
  // drawn across the way on with nothing to stop you.
  //
  // The first answer here was to delete those pieces, and it was the wrong
  // one: judged by whether any part of them was over unbacked floor, it
  // deleted the rim itself — eighty-five pieces in the ravine, two hundred on
  // the far side — leaving a lane with the sky showing through where the wall
  // should be, and the rim pillars' fifty-five-metre colliders standing in the
  // open with no rock on them.
  //
  // So: **back it, unless it is in the way.** A piece standing over the
  // level's own floor with nothing under it gets a collider of its own, sized
  // to the rock that is drawn — which is what "a wall always has a collider"
  // means. Only a piece actually standing on the golden path is removed, since
  // a collider there would be a wall across the way through.
  let culled = 0;
  let backed = 0;
  const keptRim = rimGeo.filter((geo, i) => {
    const at = rimAt[i];
    if (!at) return true;
    if (nearestFloor(at.x, at.z) > at.r) return true;          // nowhere near a floor
    let bare = 0;
    for (let dx = -at.r; dx <= at.r; dx += 1) {
      for (let dz = -at.r; dz <= at.r; dz += 1) {
        if (dx * dx + dz * dz > at.r * at.r) continue;
        const px = at.x + dx, pz = at.z + dz;
        // Walkable ground is the floors the level registered *and* the golden
        // path itself. A path can run over ground no rect covers — a doorway's
        // threshold, the mouth of a link — and rock leaning over one of those
        // is still rock a player walks into: the Crevasse and the Storm Docks
        // each kept a wall there through three goes at this, invisible to a
        // test that only knew about rects.
        if (!onFloor(px, pz) && pathNear(px, pz) > PATH_WALKABLE) continue;
        if (!backedAt(px, pz)) bare++;
      }
    }
    if (bare < RIM_BARE_MIN) {
      // A lean, not a stand — it is not holding up any of the level's own
      // floor, so it does not need a collider *of its own*. It does still
      // need one if it has nothing behind it.
      //
      // `bare` only counts ground the level registered as a floor rect, or
      // ground within `PATH_WALKABLE` of the golden path. On an open zone
      // standing on the territory's own terrain, neither covers the ground a
      // player can actually walk: the Great Forge's glassed plain is 44x50 m
      // of registered rect in the middle of an open plain, and its border
      // stands forty metres out on ordinary ground. Every piece of it counted
      // zero bare samples — not because it was backed, but because nothing
      // under it was *looked at* — and so was kept, drawn, and hollow. The
      // borders audit has been reporting that as two edges you walk through
      // since the stage chain landed.
      //
      // Backed by the slab is the normal case and stays free. Backed by
      // nothing is a wall that is not there, and gets its own collider sized
      // to the rock that is drawn — the same collider the branch below would
      // have given it. Nothing extra is *removed* here, deliberately: culling
      // near a path is what put two holes in the Prison Rig's floor earlier
      // today, and adding a collider where a rock is drawn cannot open one.
      if (!backedAt(at.x, at.z)) {
        const leanFoot = groundAt(at.x, at.z) - 1;
        addCyl(at.x, leanFoot + at.h / 2, at.z, at.r * RIM_SOLID_FRACTION, at.h);
        backed++;
      }
      return true;
    }
    // Measured against the rock's own reach, not its middle: a six-metre
    // boulder whose centre is eight metres off the path still has its face in
    // it, and backing that is how a piece that should have been removed became
    // a two-and-a-half-metre wall across the way on instead.
    if (pathNear(at.x, at.z) < at.r + PATH_CLEAR) { culled++; return false; }
    // ...and nothing at all stands in a doorway.
    //
    // A transport door is the one piece of ground on a stage that has to be
    // walkable: it is the way on, or the way home, and there is no way round it.
    // The golden path does not cover it — `path` runs from the first zone's
    // entry to the last one's exit, and only the *exit* portal's threshold is
    // appended to it — so a rim piece beside the door at the other end is
    // measured against nothing and gets a collider like any other.
    //
    // Two of them did, either side of the Refinery's last stage, and put their
    // faces a third of a metre inside the doorway: a transport door with no
    // way through it on the run's way home. `test-cover` caught it as 13 of 14
    // doorways passable.
    //
    // Measured against the door itself rather than by putting the door on the
    // path. The path rule clears `at.r + PATH_CLEAR` either side of a *line*,
    // which for a five-metre rock is a corridor several metres wide; drawn
    // through a doorway it takes out border rock doing real work well away
    // from it, and the Prison Rig's top decks came back with two holes in the
    // floor when it did. This asks the narrow question instead — is the rock
    // in the opening? — and so takes only what is actually in the way.
    if (blocksADoorway(at.x, at.z, at.r * RIM_SOLID_FRACTION)) { culled++; return false; }
    // solid, from the floor under it to the top of the rock that is drawn
    const foot = groundAt(at.x, at.z) - 1;
    addCyl(at.x, foot + at.h / 2, at.z, at.r * RIM_SOLID_FRACTION, at.h);
    backed++;
    return true;
  });
  for (const geo of rimGeo) if (!keptRim.includes(geo)) geo.dispose();
  if (culled || backed) {
    console.warn(`[mission] ${stage.label}: border rock — ${backed} piece(s) given a collider, ${culled} removed from the path`);
  }
  mergeInto(keptRim, rockMat, true, 'facing');
  // The row behind never gets a collider — it is the horizon, not a wall — so
  // a piece of it standing over the level's own floor, or leaning into the
  // way through, is simply not there. Its reach is its radius: the noise only
  // ever bites inward.
  let culledBack = 0;
  const keptBack = backGeo.filter((geo, i) => {
    const at = backAt[i];
    if (!at) return true;
    if (nearestFloor(at.x, at.z) < at.r + PATH_CLEAR || pathNear(at.x, at.z) < at.r + PATH_WALKABLE) {
      culledBack++;
      geo.dispose();
      return false;
    }
    return true;
  });
  if (culledBack) console.warn(`[mission] ${stage.label}: backdrop — ${culledBack} piece(s) removed from the level's floor`);
  // The backdrop row is the mountains beyond — `ridge()` says so in as many
  // words: "mesh only, which nothing has to reach". It stands fourteen to
  // twenty-four metres further out again than a border that is itself outside
  // its own collider, so it is scenery by construction, and saying so is what
  // stops `tools/audit-collision` reporting a hundred and seventy metres of
  // horizon as a wall you can walk through.
  mergeInto(keptBack, backdropMat, false, 'decor');
}

/** the horizon strip beyond the backdrop row, where the ridge style has one */
export function raiseHorizon(b: StageBuilder): void {
  const { pal, ceiling, interior, owned, look, group, floorY } = b;

  // The horizon: an alpha strip standing well behind the backdrop row, in the
  // fog's own colour. The rims and the row behind them give the level its
  // walls and its depth; this is what puts a country beyond them, and it
  // costs one billboard ring per stage.
  if (look.sil && !interior) {
    const silMat = new THREE.MeshBasicMaterial({
      color: pal.backdrop, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide,
    });
    owned.push(silMat);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(520, 520, ceiling * 3.4, 48, 1, true), silMat);
    ring.position.set(0, floorY + ceiling * 1.1, 0);
    ring.frustumCulled = false;
    group.add(ring);
    loadOptionalTexture(look.sil, (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.repeat.set(9, 1);
      silMat.map = tex;
      silMat.alphaTest = 0.35;
      silMat.color.set(0xffffff);
      silMat.needsUpdate = true;
    }, { exts: ['png', 'jpg'] });
  }
}
