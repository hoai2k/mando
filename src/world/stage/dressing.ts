import * as THREE from 'three';
import { addBreakable, type Hazard } from '../board';
import { mat } from '../../characters/builder';
import { authoredProp } from '../props';
import type { ZoneSpec } from '../mission';
import {
  RIDE_MIN_SIDE, RIDE_EDGE_CLEAR, RIDE_CLEAR, SHOCK_CYCLE, SHOCK_DPS, PIT_DPS, type Frame,
} from './common';
import type { StageState } from './builder';
import type { stagePrimitives } from './primitives';

/**
 * What a zone carries on top of its shell: the authored props it asked for,
 * the rides it parks, and its set pieces and cover.
 */
export function stageDressing(b: StageState & ReturnType<typeof stagePrimitives>) {
  const {
    board, group, rand, bare, onGround, interior, wallMat, rockMat, accentGlow, owned,
    boxes, breakables, rides, blocked, shockStrips, groundAt, removeBoxes, addBox, addCyl, addHazard,
    slab, clearOf, crate, coverRock,
  } = b;

  /** the props a zone asked for, placed in its own frame */
  const placeProps = (f: Frame, zs: ZoneSpec, top0: number): void => {
    let top = top0;
    for (const p of zs.props ?? []) {
      const x = f.x(p.u, p.v), z = f.z(p.u, p.v);
      const size = p.size ?? 4;
      top = groundAt(x, z);
      if (p.solid) {
        // cover you can hide behind: a collider under the sculpt, and a
        // stand-in cylinder so the shape is there before the file lands
        const stand = new THREE.Mesh(
          new THREE.CylinderGeometry(p.solid.r * 0.85, p.solid.r, p.solid.h, 8), rockMat);
        stand.position.set(x, top + p.solid.h / 2, z);
        stand.castShadow = stand.receiveShadow = true;
        group.add(stand);
        const disc = addCyl(x, top + p.solid.h / 2, z, p.solid.r, p.solid.h);
        // `solid` describes the *stand-in*, and the sculpt that replaces it is
        // usually nothing like a disc — a twenty-six metre sail barge stood on
        // a four-metre cylinder is a wreck you walk through the length of. So
        // the sculpt supplies its own the moment it lands (`world/collide.ts`),
        // exactly as the boards do, and the disc it replaces goes.
        authoredProp(group, stand, p.id, size, { x, y: top, z, yaw: p.yaw, axis: 'longest' }, {
          physics: board.physics,
          replace: [disc],
          maxBoxes: 24,
          ...(p.id === 'freighter' || p.id === 'raider_dropship' || p.id === 'sail_barge'
            ? { cell: 0.5, preserveOpenings: true } : {}),
          // a stage that was torn down while its art was still in flight must
          // not put colliders back into the world it has already given up
          onFit: (fitted) => { if (b.retired) removeBoxes(fitted); else boxes.push(...fitted); },
        });
        blocked.push({ x, z, r: p.solid.r + 1.2 });
      } else {
        authoredProp(group, [], p.id, size, { x, y: top, z, yaw: p.yaw, axis: 'longest' });
        blocked.push({ x, z, r: size * 0.4 });
      }
    }
  };

  /** the rides a zone parks, checked against the edges before they are taken */
  const placeRides = (f: Frame, zs: ZoneSpec, top: number): void => {
    for (const r of zs.rides ?? []) {
      const short = Math.min(zs.w, zs.l);
      if (zs.shell !== 'road' && short < RIDE_MIN_SIDE) {
        console.warn(`[mission] ${zs.label}: no room to turn a ride (${short} m)`);
        continue;
      }
      const edge = Math.min(zs.w / 2 - Math.abs(r.v), r.u, zs.l - r.u);
      if (edge < RIDE_EDGE_CLEAR) {
        console.warn(`[mission] ${zs.label}: a ride is parked ${edge.toFixed(1)} m from an edge`);
      }
      // A ride stands on the ground, never on the furniture.
      //
      // `Vehicle` finds its own hover height from the *physics* — the highest
      // surface under it — so a landspeeder authored a metre and a half from a
      // tent settles onto the tent's roof and sits there, which is what a
      // playtest found in the Tusken corral. Authored coordinates are written
      // by eye against a zone diagram and the props move; rather than trust
      // them, take the authored spot when it is clear of everything already
      // standing here (`blocked` — props, crates, pillars, other rides) and
      // otherwise walk outward in rings until it is. The ride stays in its
      // zone and near where it was meant to be; it just stops being on a roof.
      let u = r.u, v = r.v, moved = 0;
      if (!clearOf(f.x(u, v), f.z(u, v), RIDE_CLEAR)) {
        const uMin = RIDE_EDGE_CLEAR, uMax = zs.l - RIDE_EDGE_CLEAR;
        const vMax = zs.w / 2 - RIDE_EDGE_CLEAR;
        search: for (const ring of [3, 5, 7, 9, 12]) {
          for (let a = 0; a < 12; a++) {
            const th = (a / 12) * Math.PI * 2;
            const cu = r.u + Math.cos(th) * ring, cv = r.v + Math.sin(th) * ring;
            if (cu < uMin || cu > uMax || Math.abs(cv) > vMax) continue;
            if (!clearOf(f.x(cu, cv), f.z(cu, cv), RIDE_CLEAR)) continue;
            u = cu; v = cv; moved = ring;
            break search;
          }
        }
        if (!moved) console.warn(`[mission] ${zs.label}: nowhere clear to park a ${r.kind}`);
      }
      const rx = f.x(u, v), rz = f.z(u, v);
      rides.push({ kind: r.kind, x: rx, z: rz, yaw: r.yaw, y: groundAt(rx, rz) });
      blocked.push({ x: rx, z: rz, r: RIDE_CLEAR });
    }
  };

  /** the set pieces a zone carries: a pit, hazard channels, barrels, pillars */
  const setPieces = (f: Frame, zs: ZoneSpec, top: number, wallH: number): void => {
    const { w, l } = zs;
    // A building or a seabed that already exists comes with its own cover,
    // its own hazards and its own dressing. Adding crates to the Refinery's
    // barrel hall would be furnishing a furnished room.
    if (bare) return;
    // A territory has its own lava, its own shock plates and its own pit —
    // the sarlacc is *there*, forty metres off the trailhead. Laying a second
    // set over the top of them would be the level arguing with the board.
    const dressed = !onGround;
    if (dressed && zs.feature === 'pit') {
      const r = Math.min(w, l) * 0.18 + 1.4;
      const maw = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.72, 1.1, 20),
        mat(0x120c08, { rough: 1 }));
      maw.position.set(f.x(l / 2, 0), top - 0.53, f.z(l / 2, 0));
      group.add(maw);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.45, 24), accentGlow);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(f.x(l / 2, 0), top + 0.03, f.z(l / 2, 0));
      group.add(ring);
      // A pit *hurts*. It used to be `kind: 'kill'` — step on the ring and the
      // run is over with no reading of it and no way back out — which for a
      // set piece sitting in the middle of the floor you are fighting across
      // is a trap, not a hazard. The territory's own sarlacc is the thing that
      // eats you whole; the ones a zone lays are ground you must not stand on.
      addHazard({ center: f.vec(l / 2, 0, top), radius: r - 0.3, kind: 'burn', dps: PIT_DPS, yMax: top + 2.2 });
      blocked.push({ x: f.x(l / 2, 0), z: f.z(l / 2, 0), r: r + 2 });
    }
    if (dressed && (zs.feature === 'lava' || zs.feature === 'shock')) {
      const dps = zs.feature === 'lava' ? 26 : SHOCK_DPS;
      const cuts = l >= 20 ? [l * 0.38, l * 0.66] : [l * 0.5];
      cuts.forEach((cu, ci) => {
        const glow = new THREE.MeshBasicMaterial({
          color: zs.feature === 'lava' ? 0xff5a2a : 0x9fe8ff,
          transparent: zs.feature === 'shock', opacity: 1,
        });
        owned.push(glow);
        const strip: Hazard[] = [];
        for (const side of [-1, 1]) {
          const v0 = side * 1.7, v1 = side * (w / 2 - 1.2);
          slab(f, cu - 1.2, cu + 1.2, Math.min(v0, v1), Math.max(v0, v1), top + 0.02, top + 0.1, glow);
          const span = Math.abs(v1 - v0);
          for (let d = 1.2; d < span; d += 2.4) {
            strip.push(addHazard({
              center: f.vec(cu, v0 + side * d, top), radius: 1.5, kind: 'burn', dps, yMax: top + 2.2,
            }));
          }
        }
        if (zs.feature === 'shock') shockStrips.push({ hazards: strip, mat: glow, phase: ci * SHOCK_CYCLE / 2 });
        blocked.push({ x: f.x(cu, 0), z: f.z(cu, 0), r: 3 });
      });
    }
    if (zs.feature === 'barrels') {
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
          const box = addBox(x, top + 0.7, z, 1, 1.4, 1);
          addBreakable(board, mesh, box, 30, { explosive: true });
          breakables.push({ mesh });
          blocked.push({ x, z, r: 1.4 });
          break;
        }
      }
    }
    const isArena = zs.kind === 'lieutenant' || zs.kind === 'warlord';
    if (isArena) {
      // the boss stands up in the middle and the monster erupts where it fell
      blocked.push({ x: f.x(l / 2, 0), z: f.z(l / 2, 0), r: 7 });
    }
    if (zs.feature === 'pillars' || isArena) {
      const lane = isArena ? 4 : 2.4;
      const pillarH = interior || zs.shell === 'hall' ? wallH - 0.8 : 5.5 + rand() * 2;
      for (let b = 0; b < 3; b++) {
        for (let tries = 0; tries < 10; tries++) {
          const u = 4 + rand() * (l - 8);
          const v = (rand() - 0.5) * (w - 7);
          if (Math.abs(v) < lane || !clearOf(f.x(u, v), f.z(u, v), 2)) continue;
          const x = f.x(u, v), z = f.z(u, v);
          const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, pillarH, 10),
            zs.shell === 'hall' ? wallMat : rockMat);
          mesh.position.set(x, top + pillarH / 2, z);
          mesh.castShadow = mesh.receiveShadow = true;
          group.add(mesh);
          addCyl(x, top + pillarH / 2, z, 1.25, pillarH);
          blocked.push({ x, z, r: 2.6 });
          break;
        }
      }
    }
    // cover: crates indoors, rocks out
    const fights = zs.kind === 'camp' || zs.kind === 'assault' || zs.kind === 'chase' || isArena;
    if (fights) {
      const n = Math.min(7, Math.max(2, Math.round((w * l) / 150))) + (zs.feature === 'crates' ? 2 : 0);
      for (let c = 0; c < n; c++) {
        for (let tries = 0; tries < 12; tries++) {
          const u = 3 + rand() * Math.max(1, l - 6);
          const v = (rand() - 0.5) * (w - 5);
          if (Math.abs(v) < 2.1 || !clearOf(f.x(u, v), f.z(u, v), 1.6)) continue;
          const x = f.x(u, v), z = f.z(u, v);
          const y = groundAt(x, z);
          if (interior || zs.shell === 'hall' || zs.shell === 'deck' || rand() < 0.35) crate(x, y, z);
          else coverRock(x, y, z);
          break;
        }
      }
    }
  };

  return { placeProps, placeRides, setPieces };
}
