import * as THREE from 'three';

/**
 * Lightweight kinematic physics: a capsule character vs. a heightfield ground
 * plus axis-aligned boxes (platforms, crates, walls). Tuned for arcade feel,
 * not physical accuracy.
 */

export interface GroundHit { grounded: boolean; groundY: number; }
export interface RayHit { dist: number; point: THREE.Vector3; normal: THREE.Vector3; }

export interface StaticBox { min: THREE.Vector3; max: THREE.Vector3; }
/** Upright cylinder — rocks, mesas, pillars: round things a box lies about. */
export interface StaticCylinder { x: number; z: number; r: number; minY: number; maxY: number; }
/**
 * Any collection of solids that can be resolved against — the whole world, or
 * the handful of colliders near one body. The point solvers (the ragdolls)
 * resolve fifteen points seven times a substep and cannot afford to walk a
 * board's worth of boxes each time, so they hold one of these instead.
 */
export interface SolidSet { boxes: StaticBox[]; cylinders: StaticCylinder[] }

const STEP_HEIGHT = 0.55;

export class PhysicsWorld {
  /** ground height function; null = bottomless (space) */
  heightAt: ((x: number, z: number) => number) | null = null;
  boxes: StaticBox[] = [];
  cylinders: StaticCylinder[] = [];
  /** falling below this Y = out of bounds */
  killY = -60;

  addBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): StaticBox {
    const b = {
      min: new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      max: new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
    };
    this.boxes.push(b);
    return b;
  }

  /** @param cy centre Y of the cylinder, @param h its full height */
  addCylinder(cx: number, cy: number, cz: number, r: number, h: number): StaticCylinder {
    const c = { x: cx, z: cz, r, minY: cy - h / 2, maxY: cy + h / 2 };
    this.cylinders.push(c);
    return c;
  }

  /**
   * Is this point inside a solid collider? Spawn placement needs to know: a
   * squad posted inside a crate or a kiosk is ejected through the nearest face
   * on its first frame, which puts it somewhere nobody chose.
   */
  solidAt(x: number, y: number, z: number): boolean {
    for (const b of this.boxes) {
      if (x > b.min.x && x < b.max.x && y > b.min.y && y < b.max.y && z > b.min.z && z < b.max.z) return true;
    }
    for (const c of this.cylinders) {
      if (y <= c.minY || y >= c.maxY) continue;
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) return true;
    }
    return false;
  }

  /**
   * Is there room for a standing body here — feet at `feetY`, nothing touched
   * by its capsule?
   *
   * `solidAt` asks about a single point, which is not the question a spawn
   * needs to answer: the mover treats a body as a capsule and pushes it out of
   * any box it overlaps, so a point 30 cm from a wall face reads as free while
   * the body standing on it is inside the wall until that push-out fires. This
   * uses the same inflated test `stepCapsule` resolves against, so anywhere it
   * calls clear is somewhere the mover will leave alone.
   *
   * A box whose top is at or below the feet is not touched (that is ground to
   * stand on, not an obstacle), and neither is one entirely above the head.
   */
  capsuleFree(x: number, feetY: number, z: number, radius: number, height: number): boolean {
    const head = feetY + height;
    for (const b of this.boxes) {
      if (head <= b.min.y || feetY >= b.max.y) continue;
      if (x <= b.min.x - radius || x >= b.max.x + radius) continue;
      if (z <= b.min.z - radius || z >= b.max.z + radius) continue;
      return false;
    }
    for (const c of this.cylinders) {
      if (head <= c.minY || feetY >= c.maxY) continue;
      const dx = x - c.x, dz = z - c.z;
      const r = c.r + radius;
      if (dx * dx + dz * dz < r * r) return false;
    }
    return true;
  }

  /**
   * Push a loose point out of any solid it has ended up inside, through the
   * nearest face. Corpse solvers work in points rather than capsules — this is
   * what stops a body settling half inside the crate it fell against.
   *
   * @returns true if the point was moved.
   */
  pushOutPoint(p: THREE.Vector3, radius = 0, solids: SolidSet = this): boolean {
    let moved = false;
    for (const b of solids.boxes) {
      const minX = b.min.x - radius, maxX = b.max.x + radius;
      const minY = b.min.y - radius, maxY = b.max.y + radius;
      const minZ = b.min.z - radius, maxZ = b.max.z + radius;
      if (p.x <= minX || p.x >= maxX) continue;
      if (p.y <= minY || p.y >= maxY) continue;
      if (p.z <= minZ || p.z >= maxZ) continue;
      // six faces, shallowest wins — the same rule the capsule mover uses,
      // with the vertical pair included since a point has no "up". Written
      // out rather than built as a list of closures: a ragdoll runs this a
      // few hundred times a frame and the array cost more than the maths.
      const xl = p.x - minX, xh = maxX - p.x;
      const yl = p.y - minY, yh = maxY - p.y;
      const zl = p.z - minZ, zh = maxZ - p.z;
      const m = Math.min(xl, xh, yl, yh, zl, zh);
      if (m === xl) p.x = minX;
      else if (m === xh) p.x = maxX;
      else if (m === yl) p.y = minY;
      else if (m === yh) p.y = maxY;
      else if (m === zl) p.z = minZ;
      else p.z = maxZ;
      moved = true;
    }
    for (const c of solids.cylinders) {
      if (p.y <= c.minY - radius || p.y >= c.maxY + radius) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      const reach = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2) || 1e-5;
      const side = reach - d;
      const up = (c.maxY + radius) - p.y, down = p.y - (c.minY - radius);
      if (side <= up && side <= down) {
        p.x = c.x + (dx / d) * reach;
        p.z = c.z + (dz / d) * reach;
      } else if (up <= down) p.y = c.maxY + radius;
      else p.y = c.minY - radius;
      moved = true;
    }
    return moved;
  }

  /**
   * The solids whose reach overlaps a sphere, gathered into `out` — the
   * broadphase the point solvers stand on. `out`'s arrays are reused, so a
   * corpse refreshes its shortlist once a frame and allocates nothing.
   */
  solidsNear(x: number, y: number, z: number, reach: number, out: SolidSet): SolidSet {
    out.boxes.length = 0;
    out.cylinders.length = 0;
    for (const b of this.boxes) {
      if (x < b.min.x - reach || x > b.max.x + reach) continue;
      if (y < b.min.y - reach || y > b.max.y + reach) continue;
      if (z < b.min.z - reach || z > b.max.z + reach) continue;
      out.boxes.push(b);
    }
    for (const c of this.cylinders) {
      if (y < c.minY - reach || y > c.maxY + reach) continue;
      const dx = x - c.x, dz = z - c.z;
      const r = c.r + reach;
      if (dx * dx + dz * dz > r * r) continue;
      out.cylinders.push(c);
    }
    return out;
  }

  /**
   * Height of the nearest solid surface below `y` at (x, z), or -Infinity when
   * there is nothing under this spot within `maxDrop`.
   *
   * Unlike `groundHeight` this asks about the whole column rather than what a
   * standing body could step onto, which is what a local gravity field wants
   * to know: is there anything down there to fall towards?
   */
  supportBelow(x: number, y: number, z: number, maxDrop = Infinity): number {
    const floor = y - maxDrop;
    let best = -Infinity;
    if (this.heightAt) {
      const h = this.heightAt(x, z);
      if (h <= y && h >= floor) best = h;
    }
    for (const b of this.boxes) {
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
      if (b.max.y > y || b.max.y < floor || b.max.y <= best) continue;
      best = b.max.y;
    }
    for (const c of this.cylinders) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz > c.r * c.r) continue;
      if (c.maxY > y || c.maxY < floor || c.maxY <= best) continue;
      best = c.maxY;
    }
    return best;
  }

  groundHeight(x: number, z: number, feetY: number): number {
    let g = this.heightAt ? this.heightAt(x, z) : -Infinity;
    for (const b of this.boxes) {
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) {
        // box top counts as ground if it's at/below feet (+ step allowance)
        if (b.max.y <= feetY + STEP_HEIGHT && b.max.y > g) g = b.max.y;
      }
    }
    for (const c of this.cylinders) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz > c.r * c.r) continue;
      if (c.maxY <= feetY + STEP_HEIGHT && c.maxY > g) g = c.maxY;
    }
    return g;
  }

  /**
   * Move a capsule (pos = feet position, mutated) by vel*dt, resolving
   * collisions. Returns grounded state.
   */
  moveCapsule(pos: THREE.Vector3, radius: number, height: number, vel: THREE.Vector3, dt: number): GroundHit {
    // Movement is teleport-then-push-out, so it only sees a wall it ends the
    // step overlapping. At dash speed against the loop's 0.05 s frame clamp a
    // single step covers most of a metre and can cross a thin wall or platform
    // without ever touching it. Split anything longer than half a radius.
    const dist = Math.hypot(vel.x, vel.y, vel.z) * dt;
    const steps = Math.min(8, Math.max(1, Math.ceil(dist / Math.max(0.05, radius * 0.5))));
    let res: GroundHit = { grounded: false, groundY: -Infinity };
    for (let i = 0; i < steps; i++) res = this.stepCapsule(pos, radius, height, vel, dt / steps);
    return res;
  }

  private stepCapsule(pos: THREE.Vector3, radius: number, height: number, vel: THREE.Vector3, dt: number): GroundHit {
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;

    // push out of box sides
    for (const b of this.boxes) {
      const minX = b.min.x - radius, maxX = b.max.x + radius;
      const minZ = b.min.z - radius, maxZ = b.max.z + radius;
      if (pos.x <= minX || pos.x >= maxX || pos.z <= minZ || pos.z >= maxZ) continue;
      const feet = pos.y, head = pos.y + height;
      if (head <= b.min.y || feet >= b.max.y) continue;
      // steppable: box top near feet level
      if (b.max.y - feet <= STEP_HEIGHT && vel.y <= 0.01) continue; // handled as ground
      const pushLeft = pos.x - minX, pushRight = maxX - pos.x;
      const pushBack = pos.z - minZ, pushFwd = maxZ - pos.z;
      const m = Math.min(pushLeft, pushRight, pushBack, pushFwd);
      if (m === pushLeft) { pos.x = minX; if (vel.x > 0) vel.x = 0; }
      else if (m === pushRight) { pos.x = maxX; if (vel.x < 0) vel.x = 0; }
      else if (m === pushBack) { pos.z = minZ; if (vel.z > 0) vel.z = 0; }
      else { pos.z = maxZ; if (vel.z < 0) vel.z = 0; }
    }

    // push out of cylinder sides — radially, so a rock face pushes you around
    // it instead of snapping you to a box edge that isn't where the rock is
    for (const c of this.cylinders) {
      const reach = c.r + radius;
      let dx = pos.x - c.x, dz = pos.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const feet = pos.y, head = pos.y + height;
      if (head <= c.minY || feet >= c.maxY) continue;
      if (c.maxY - feet <= STEP_HEIGHT && vel.y <= 0.01) continue; // low enough to step onto
      let d = Math.sqrt(d2);
      if (d < 1e-5) { dx = 1; dz = 0; d = 1; } // dead centre: shove somewhere
      const nx = dx / d, nz = dz / d;
      pos.x = c.x + nx * reach;
      pos.z = c.z + nz * reach;
      const into = vel.x * nx + vel.z * nz;
      if (into < 0) { vel.x -= into * nx; vel.z -= into * nz; }
    }

    pos.y += vel.y * dt;
    const g = this.groundHeight(pos.x, pos.z, pos.y + STEP_HEIGHT);
    let grounded = false;
    if (g > -Infinity && pos.y <= g + 0.001 && vel.y <= 0.001) {
      pos.y = g;
      vel.y = 0;
      grounded = true;
    }
    // box ceilings
    for (const b of this.boxes) {
      if (pos.x < b.min.x - radius || pos.x > b.max.x + radius || pos.z < b.min.z - radius || pos.z > b.max.z + radius) continue;
      const head = pos.y + height;
      if (head > b.min.y && pos.y < b.min.y && vel.y > 0 && b.min.y - pos.y > STEP_HEIGHT) {
        pos.y = b.min.y - height;
        vel.y = 0;
      }
    }
    for (const c of this.cylinders) {
      const dx = pos.x - c.x, dz = pos.z - c.z, reach = c.r + radius;
      if (dx * dx + dz * dz > reach * reach) continue;
      const head = pos.y + height;
      if (head > c.minY && pos.y < c.minY && vel.y > 0 && c.minY - pos.y > STEP_HEIGHT) {
        pos.y = c.minY - height;
        vel.y = 0;
      }
    }
    return { grounded, groundY: g };
  }

  /**
   * Raycast vs boxes and cylinders only, skipping the heightfield march.
   *
   * For a ray that cannot meet the ground — anything pointed up — the march is
   * pure waste: it is a fixed 0.6 m step, so a 45 m probe runs 75 iterations of
   * a noise function that never reports a hit. The Forge's storm ran one of
   * these per combatant, several times a second, for the whole squall.
   */
  raycastSolids(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null {
    let best: RayHit | null = null;
    for (const b of this.boxes) {
      const hit = rayBox(origin, dir, b, maxDist);
      if (hit && (!best || hit.dist < best.dist)) best = hit;
    }
    for (const c of this.cylinders) {
      const hit = rayCylinder(origin, dir, c, maxDist);
      if (hit && (!best || hit.dist < best.dist)) best = hit;
    }
    return best;
  }

  /** Raycast vs boxes (analytic) and heightfield (marched). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null {
    let best: RayHit | null = null;
    // boxes: slab test
    for (const b of this.boxes) {
      const hit = rayBox(origin, dir, b, maxDist);
      if (hit && (!best || hit.dist < best.dist)) best = hit;
    }
    for (const c of this.cylinders) {
      const hit = rayCylinder(origin, dir, c, maxDist);
      if (hit && (!best || hit.dist < best.dist)) best = hit;
    }
    // heightfield: fixed-step march
    if (this.heightAt) {
      const step = 0.6;
      const p = origin.clone();
      const d = dir.clone().multiplyScalar(step);
      const limit = best ? best.dist : maxDist;
      for (let t = 0; t < limit; t += step) {
        p.add(d);
        const h = this.heightAt(p.x, p.z);
        if (p.y <= h) {
          const point = p.clone().setY(h);
          best = { dist: t + step, point, normal: this.groundNormal(p.x, p.z) };
          break;
        }
      }
    }
    return best;
  }

  groundNormal(x: number, z: number): THREE.Vector3 {
    if (!this.heightAt) return new THREE.Vector3(0, 1, 0);
    const e = 0.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return new THREE.Vector3(-hx, 2 * e, -hz).normalize();
  }
}

/** Ray vs upright finite cylinder: infinite-side quadratic, then the two caps. */
function rayCylinder(o: THREE.Vector3, d: THREE.Vector3, c: StaticCylinder, maxDist: number): RayHit | null {
  const ox = o.x - c.x, oz = o.z - c.z;
  const a = d.x * d.x + d.z * d.z;
  let best = Infinity;
  let normal: THREE.Vector3 | null = null;

  if (a > 1e-10) {
    const b = 2 * (ox * d.x + oz * d.z);
    const cc = ox * ox + oz * oz - c.r * c.r;
    const disc = b * b - 4 * a * cc;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t <= 0 || t >= best || t > maxDist) continue;
        const y = o.y + d.y * t;
        if (y < c.minY || y > c.maxY) continue;
        best = t;
        normal = new THREE.Vector3(ox + d.x * t, 0, oz + d.z * t).normalize();
      }
    }
  }
  if (Math.abs(d.y) > 1e-8) {
    for (const [capY, ny] of [[c.maxY, 1], [c.minY, -1]] as const) {
      const t = (capY - o.y) / d.y;
      if (t <= 0 || t >= best || t > maxDist) continue;
      const px = ox + d.x * t, pz = oz + d.z * t;
      if (px * px + pz * pz > c.r * c.r) continue;
      best = t;
      normal = new THREE.Vector3(0, ny, 0);
    }
  }
  if (!normal || best === Infinity) return null;
  return { dist: best, point: o.clone().addScaledVector(d, best), normal };
}

function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: StaticBox, maxDist: number): RayHit | null {
  let tmin = 0, tmax = maxDist;
  let axis = -1, sign = 0;
  const oArr = [o.x, o.y, o.z], dArr = [d.x, d.y, d.z];
  const minArr = [b.min.x, b.min.y, b.min.z], maxArr = [b.max.x, b.max.y, b.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dArr[i]) < 1e-8) {
      if (oArr[i] < minArr[i] || oArr[i] > maxArr[i]) return null;
      continue;
    }
    const inv = 1 / dArr[i];
    let t1 = (minArr[i] - oArr[i]) * inv;
    let t2 = (maxArr[i] - oArr[i]) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (axis < 0 || tmin <= 0) {
    // An origin inside the box used to report nothing at all, which reads as
    // "clear line" to every caller. The camera collision ray starts at the
    // player's head, so a head pushed into a wall let the camera swing straight
    // through the geometry. Report a contact at zero distance instead, with the
    // normal of the nearest face so the caller is pushed back out.
    const inside = o.x > b.min.x && o.x < b.max.x && o.y > b.min.y
      && o.y < b.max.y && o.z > b.min.z && o.z < b.max.z;
    if (!inside) return null;
    let bestAxis = 0, bestDepth = Infinity, bestSign = 1;
    for (let i = 0; i < 3; i++) {
      const lo = oArr[i] - minArr[i], hi = maxArr[i] - oArr[i];
      if (lo < bestDepth) { bestDepth = lo; bestAxis = i; bestSign = -1; }
      if (hi < bestDepth) { bestDepth = hi; bestAxis = i; bestSign = 1; }
    }
    const n = new THREE.Vector3();
    n.setComponent(bestAxis, bestSign);
    return { dist: 0, point: o.clone(), normal: n };
  }
  const point = o.clone().addScaledVector(d, tmin);
  const normal = new THREE.Vector3();
  normal.setComponent(axis, sign);
  return { dist: tmin, point, normal };
}
