import * as THREE from 'three';
import type { Game } from '../game/game';
import type { Board, Hazard, VehicleSpec } from '../world/board';
import type { MissionSpec, StageSpec } from '../world/mission';
import type { StaticBox, StaticCylinder } from '../core/physics';
import type { EnemyKind } from '../enemies/enemy';
import { Enemy, enemyBody } from '../enemies/enemy';
import { mat } from '../characters/builder';
import { loadOptionalTexture } from '../core/assets';
import { disposeSubtree } from '../core/dispose';
import { authoredProp } from '../world/props';
import { MISSION_Y } from '../world/stage/common';

/**
 * Everything a section may touch, and the ledger that gives it all back.
 *
 * A section builds its own world — plates, walls, shafts, a lava river — and
 * a stage swap has to take every piece of it out again: meshes, colliders,
 * hazards, spawned bodies, lights. Going through this is what makes that
 * automatic. Anything made with `box`, `cyl`, `hazard`, `prop` or added to
 * `group` is recorded; `own` takes anything else with a `dispose()`.
 *
 * The campaign's own helpers (squads by the board's wave tables, placement
 * against the stage) come in through `hooks`, so a section draws the same
 * enemies at the same place in the ramp that a zone there would have.
 */
export interface SectionHooks {
  squadFor(wave: number, budget: number, opts?: { debut?: boolean; air?: boolean }): EnemyKind[];
  placeNear(pos: THREE.Vector3, kind: EnemyKind): THREE.Vector3;
  /** a bacta canister (+45 HP), collected by walking into it */
  pickup(pos: THREE.Vector3): void;
  /** park these rides in the section (retiring any from the last stage) */
  rides(specs: VehicleSpec[]): void;
}

export interface SectionContext {
  game: Game;
  board: Board;
  spec: MissionSpec;
  stageSpec: StageSpec;
  /** this stage's index in the run */
  index: number;
  /** how many zone beats come before it — its place in the difficulty ramp */
  beat: number;
  /** the wave-table row a zone at this point would draw from */
  wave: number;
  /** a plate stage's floor height: the section builds round (0, floorY, 0) */
  floorY: number;
  /** under the board: every mesh the section adds goes in here */
  group: THREE.Group;
  /** the last safe ground the party earned; `defaultRespawn` stands them round it */
  checkpoint: THREE.Vector3;

  /** a solid box: collider + mesh (mesh omitted with `mat: null`) */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number,
    material?: THREE.Material | null): { box: StaticBox; mesh: THREE.Mesh | null };
  /** a solid upright cylinder: collider + mesh */
  cyl(cx: number, cy: number, cz: number, r: number, h: number,
    material?: THREE.Material | null): { cyl: StaticCylinder; mesh: THREE.Mesh | null };
  /** remove colliders this section added (a collapsing ledge, a door opening) */
  unsolid(what: { box?: StaticBox; cyl?: StaticCylinder }): void;
  /** a circular kill or burn zone */
  hazard(h: Hazard): Hazard;
  unhazard(h: Hazard): void;
  /** add a mesh (or anything) under the section's group */
  mesh<T extends THREE.Object3D>(obj: T): T;
  /** anything else that needs `dispose()` on teardown */
  own<T extends { dispose(): void }>(thing: T): T;
  /**
   * An authored sculpt with a procedural stand-in. The stand-in (`fallback()`)
   * is built and shown at once; the model replaces it when it lands. `solid`
   * stands a collider under it — sized to the stand-in, and refitted to the
   * sculpt when the sculpt arrives.
   */
  prop(id: string, at: THREE.Vector3, opts?: {
    size?: number; yaw?: number; fallback?: () => THREE.Object3D;
    solid?: { r: number; h: number } | 'fit';
  }): THREE.Group;
  /** a palette-coloured material, cloned (so it may be tinted or animated) */
  paint(color: number, opts?: { rough?: number; metal?: number; emissive?: number }): THREE.MeshStandardMaterial;
  /** dress a material with a tileable from public/assets/textures, where it exists */
  tile(m: THREE.MeshStandardMaterial, name: string, rx: number, ry: number, opts?: { normal?: boolean; glow?: string }): void;

  /**
   * Put a hostile in the section: placed, squad-tagged, added to the match.
   * `exact` keeps `at`'s own height (a ledge, an upper floor) and only looks
   * sideways for room; without it the body is stood on `groundAt`.
   */
  spawn(kind: EnemyKind, at: THREE.Vector3, opts?: { squad?: number; alert?: boolean; exact?: boolean }): Enemy;
  /** the board's wave table at this point in the ramp, `budget` bodies */
  squadFor(wave: number, budget: number, opts?: { debut?: boolean; air?: boolean }): EnemyKind[];
  placeNear(pos: THREE.Vector3, kind: EnemyKind): THREE.Vector3;
  /**
   * Room for a body of `kind` at `pos`'s own height — the ground under it is
   * whatever collider it is standing on, not `groundAt`. For stacked floors,
   * ledges and decks, where one height per column does not describe the place.
   */
  placeAt(pos: THREE.Vector3, kind: EnemyKind): THREE.Vector3;
  /** a carrier pass that drops `kinds` at `spots`; `onLand` gets the bodies */
  drop(kinds: EnemyKind[], spots: THREE.Vector3[], onLand?: (bodies: Enemy[]) => void): void;
  announce(title: string, sub?: string): void;
  /** a bacta canister (+45 HP) at `pos` */
  pickup(pos: THREE.Vector3): void;
  /**
   * Park rides in the section — `game.vehicles` is rebuilt from these. Call it
   * once from `update`'s first frame, not from `build` (see `SectionDef.build`).
   */
  rides(specs: VehicleSpec[]): void;
  /**
   * Stand player `slot` round the checkpoint, the way the campaign does. The
   * section's `respawnSpot` can return this, or its own forward spot.
   */
  defaultRespawn(slot: number, at?: THREE.Vector3, facing?: THREE.Vector3): THREE.Vector3;
}

/** the context plus the teardown only the campaign calls */
export interface SectionContextHandle { ctx: SectionContext; teardown(): void }

export function createSectionContext(game: Game, spec: MissionSpec, index: number, beat: number,
  wave: number, hooks: SectionHooks): SectionContextHandle {
  const board = game.board;
  const stageSpec = spec.stages[index];
  const group = new THREE.Group();
  group.name = `mission-section-${stageSpec.section ?? index}`;
  board.group.add(group);

  // A section is a plate stage: its own ground, raised clear of the
  // territory. The territory's analytic terrain would otherwise stand up
  // through the section's floor, so it is set aside until teardown.
  const worldHeightAt = board.physics.heightAt;
  board.physics.heightAt = null;

  const boxes = new Set<StaticBox>();
  const cylinders = new Set<StaticCylinder>();
  const hazards = new Set<Hazard>();
  const owned: { dispose(): void }[] = [];
  const spawned: Enemy[] = [];
  let retired = false;

  const add = <T extends THREE.Object3D>(o: T): T => { group.add(o); return o; };
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  owned.push(boxGeo);

  const ctx: SectionContext = {
    game, board, spec, stageSpec, index, beat, wave,
    floorY: MISSION_Y,
    group,
    checkpoint: new THREE.Vector3(0, MISSION_Y, 0),

    box(cx, cy, cz, sx, sy, sz, material) {
      const b = board.physics.addBox(cx, cy, cz, sx, sy, sz);
      boxes.add(b);
      let mesh: THREE.Mesh | null = null;
      if (material !== null) {
        mesh = new THREE.Mesh(boxGeo, material ?? ctx.paint(spec.palette.wall));
        mesh.scale.set(sx, sy, sz);
        mesh.position.set(cx, cy, cz);
        mesh.castShadow = mesh.receiveShadow = true;
        add(mesh);
      }
      return { box: b, mesh };
    },
    cyl(cx, cy, cz, r, h, material) {
      const c = board.physics.addCylinder(cx, cy, cz, r, h);
      cylinders.add(c);
      let mesh: THREE.Mesh | null = null;
      if (material !== null) {
        const geo = new THREE.CylinderGeometry(r, r, h, 16);
        owned.push(geo);
        mesh = new THREE.Mesh(geo, material ?? ctx.paint(spec.palette.rock));
        mesh.position.set(cx, cy, cz);
        mesh.castShadow = mesh.receiveShadow = true;
        add(mesh);
      }
      return { cyl: c, mesh };
    },
    unsolid({ box, cyl }) {
      const phys = board.physics;
      if (box) { phys.boxes = phys.boxes.filter((b) => b !== box); boxes.delete(box); }
      if (cyl) { phys.cylinders = phys.cylinders.filter((c) => c !== cyl); cylinders.delete(cyl); }
    },
    hazard(h) {
      (board.hazards ??= []).push(h);
      hazards.add(h);
      return h;
    },
    unhazard(h) {
      if (board.hazards) board.hazards = board.hazards.filter((x) => x !== h);
      hazards.delete(h);
    },
    mesh: add,
    own(thing) { owned.push(thing); return thing; },
    prop(id, at, opts = {}) {
      const size = opts.size ?? 4;
      const stand = opts.fallback ? opts.fallback() : null;
      const holderParent = new THREE.Group();
      add(holderParent);
      if (stand) {
        stand.position.copy(at);
        stand.rotation.y = opts.yaw ?? 0;
        holderParent.add(stand);
      }
      let disc: StaticCylinder | null = null;
      if (opts.solid && opts.solid !== 'fit') {
        disc = ctx.cyl(at.x, at.y + opts.solid.h / 2, at.z, opts.solid.r, opts.solid.h, null).cyl;
      }
      const fit = !!opts.solid;
      return authoredProp(holderParent, stand ? [stand] : [], id, size,
        { x: at.x, y: at.y, z: at.z, yaw: opts.yaw, axis: 'longest' },
        fit ? {
          physics: board.physics,
          replace: disc ? [disc] : [],
          maxBoxes: 24,
          onFit: (fitted) => {
            if (retired) {
              const gone = new Set(fitted);
              board.physics.boxes = board.physics.boxes.filter((b) => !gone.has(b));
            } else for (const b of fitted) boxes.add(b);
          },
        } : undefined);
    },
    paint(color, opts = {}) {
      const m = mat(color, { rough: opts.rough ?? 0.8, metal: opts.metal ?? 0.2,
        ...(opts.emissive !== undefined ? { emissive: opts.emissive } : {}) }).clone();
      owned.push(m);
      return m;
    },
    tile(m, name, rx, ry, opts = {}) {
      const apply = (key: 'map' | 'normalMap' | 'emissiveMap') => (tex: THREE.Texture): void => {
        if (retired) return;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(rx, ry);
        m[key] = tex;
        if (key === 'map') m.color.lerp(new THREE.Color(0xffffff), 0.7);
        if (key === 'emissiveMap') { m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0.85; }
        m.needsUpdate = true;
      };
      loadOptionalTexture(name, apply('map'), { exts: ['jpg', 'png'] });
      if (opts.normal) loadOptionalTexture(`${name}_normal`, apply('normalMap'), { exts: ['png', 'jpg'] });
      if (opts.glow) loadOptionalTexture(opts.glow, apply('emissiveMap'), { exts: ['jpg', 'png'] });
    },

    spawn(kind, at, opts = {}) {
      const where = opts.exact ? ctx.placeAt(at.clone(), kind) : hooks.placeNear(at.clone(), kind);
      const e = new Enemy(kind, where, 1, { silent: true });
      e.squad = opts.squad ?? 8800 + index;
      e.squadSize = 1;
      game.addEnemy(e);
      spawned.push(e);
      if (opts.alert) {
        const lead = game.players.find((p) => p.alive) ?? game.players[0];
        if (lead) e.alert(lead.position, true);
      }
      return e;
    },
    squadFor: (w, budget, opts) => hooks.squadFor(w, budget, opts),
    placeNear: (pos, kind) => hooks.placeNear(pos, kind),
    placeAt(pos, kind) {
      const body = enemyBody(kind);
      const phys = board.physics;
      const free = (x: number, z: number): boolean => phys.capsuleFree(x, pos.y + 0.2, z, body.radius, body.height);
      if (free(pos.x, pos.z)) return new THREE.Vector3(pos.x, pos.y + 0.2, pos.z);
      for (let ring = 1; ring <= 5; ring++) {
        const r = ring * 1.2;
        const steps = 8 + ring * 4;
        for (let k = 0; k < steps; k++) {
          const a = (k / steps) * Math.PI * 2 + ring;
          const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
          if (free(x, z)) return new THREE.Vector3(x, pos.y + 0.2, z);
        }
      }
      return new THREE.Vector3(pos.x, pos.y + 0.2, pos.z);
    },
    drop(kinds, spots, onLand) {
      const placed = spots.map((s, i) => hooks.placeNear(s.clone(), kinds[i % kinds.length]));
      game.dropReinforcements(kinds, placed, 8900 + index, (bodies) => {
        spawned.push(...bodies);
        onLand?.(bodies);
      });
    },
    announce: (title, sub) => game.announce(title, sub),
    pickup: (pos) => hooks.pickup(pos),
    rides: (specs) => hooks.rides(specs),
    defaultRespawn(slot, at, facing) {
      const base = (at ?? ctx.checkpoint).clone();
      const f = facing ? facing.clone().setY(0).normalize() : new THREE.Vector3(0, 0, 1);
      const side = (slot % 2) * 1.6 - 0.8;
      const back = Math.floor(slot / 2) * 1.6;
      base.x += f.z * side - f.x * back;
      base.z += -f.x * side - f.z * back;
      return ctx.placeAt(base, 'pyke');
    },
  };

  const teardown = (): void => {
    retired = true;
    board.physics.heightAt = worldHeightAt;
    board.group.remove(group);
    disposeSubtree(group);
    for (const o of owned) o.dispose();
    const phys = board.physics;
    phys.boxes = phys.boxes.filter((b) => !boxes.has(b));
    phys.cylinders = phys.cylinders.filter((c) => !cylinders.has(c));
    if (board.hazards) board.hazards = board.hazards.filter((h) => !hazards.has(h));
    for (const e of spawned) e.removeMe = true;
  };

  return { ctx, teardown };
}
