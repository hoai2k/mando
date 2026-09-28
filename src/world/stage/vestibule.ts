import * as THREE from 'three';
import { GATE_W } from '../gate';
import type { ZoneSpec } from '../mission';
import { VESTIBULE, WALL_T, ROOF_H, type Frame } from './common';
import type { StageBuilder } from './builder';

/**
 * The antechamber between a stage's back door and its first zone (see
 * `VESTIBULE`). It is laid in zone 0's own frame, behind the zone's near
 * edge: the door stands at `u = -1 - VESTIBULE`, the zone begins at `u = 0`,
 * and the party re-forms in between — outside the first zone's seal and its
 * trigger line, so whatever zone 0 is, it is walked into.
 *
 * It takes the look of the zone it opens onto: a roofed lobby the height of
 * the hall's door in front of a hall, a gangway plate in front of a deck, and
 * a short lane between cliffs in front of open ground. Open ground laid over a
 * building or a sea (`bare`) builds nothing — the board's own floor is the
 * vestibule there, as it is the zones.
 *
 * Laid after the zones so the seeded dice the zones draw are drawn in the
 * order they always were. Returns where the party re-forms.
 */
export function layVestibule(b: StageBuilder, f: Frame, zs: ZoneSpec, zoneTop: number): THREE.Vector3 {
  const {
    corrW, onGround, bare, canyon, pal, floorMat, hallFloorMat, wallMat, trimMat, owned, group, rects, path,
    groundAt, solid, slab, wallV, surf, ridge,
  } = b;
  const u0 = -1 - VESTIBULE;
  const u1 = -1;
  const mid = (u0 + u1) / 2;
  const top = onGround ? groundAt(f.x(mid, 0), f.z(mid, 0)) : zoneTop;
  // the door's own pocket is this wide inside, so the lobby continues it
  const doorHalf = GATE_W / 2 + 2.6;
  let half = doorHalf;
  // a hall is built wherever it stands, the plant's included (as `layZones` does)
  if (zs.shell === 'hall' || !bare) {
    if (zs.shell === 'hall') {
      const h = Math.max(6, zs.roofH ?? ROOF_H);
      if (!onGround) solid(f, u0 - 0.5, u1, -half - 1, half + 1, top - 1, top, hallFloorMat);
      wallV(f, half + WALL_T / 2, u0, u1, [], top, h);
      wallV(f, -half - WALL_T / 2, u0, u1, [], top, h);
      solid(f, u0, u1, -half - WALL_T, half + WALL_T, top + h, top + h + 0.8, wallMat);
      slab(f, u0 + 0.5, u1 - 0.5, half - 0.22, half - 0.02, top + 0.04, top + 0.18, trimMat);
      slab(f, u0 + 0.5, u1 - 0.5, -half + 0.02, -half + 0.22, top + 0.04, top + 0.18, trimMat);
      const lamp = new THREE.PointLight(0xffd9a0, 14, VESTIBULE + 10, 1.6);
      lamp.position.set(f.x(mid, 0), top + h - 0.5, f.z(mid, 0));
      group.add(lamp);
    } else if (zs.shell === 'deck') {
      // a gangway: a plate the door's width, lit along both edges, over the void
      solid(f, u0 - 0.5, u1, -half, half, top - 1, top, floorMat);
      const edge = new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.5 });
      owned.push(edge);
      slab(f, u0, u1, half - 0.3, half, top + 0.02, top + 0.2, edge);
      slab(f, u0, u1, -half, -half + 0.3, top + 0.02, top + 0.2, edge);
    } else {
      // outdoors: a short lane between cliffs, the width of a link's
      half = Math.max(corrW, 9) / 2;
      if (!onGround) solid(f, u0 - 0.5, u1, -half - 1, half + 1, top - 1, top, floorMat);
      if (!canyon) {
        const hw = half + 1.5;
        const lane = { x: f.x(mid, 0), z: f.z(mid, 0) };
        ridge([[f.x(u0, hw), f.z(u0, hw)], [f.x(u1 - 0.5, hw), f.z(u1 - 0.5, hw)]], top, { inside: lane });
        ridge([[f.x(u0, -hw), f.z(u0, -hw)], [f.x(u1 - 0.5, -hw), f.z(u1 - 0.5, -hw)]], top, { inside: lane });
      }
    }
  }
  rects.push(f.rect(u0 - 0.5, u1 + 0.5, -half - 0.5, half + 0.5));
  // first on the golden path: the walk from the door into the zone
  path.unshift(surf(f, mid, 0));
  return surf(f, mid, 0);
}
