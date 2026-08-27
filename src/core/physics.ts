import * as THREE from 'three';

/**
 * Lightweight kinematic physics: a capsule character vs. a heightfield ground
 * plus axis-aligned boxes (platforms, crates, walls). Tuned for arcade feel,
 * not physical accuracy.
 */

export interface GroundHit { grounded: boolean; groundY: number; }
export interface RayHit { dist: number; point: THREE.Vector3; normal: THREE.Vector3; }

export interface StaticBox { min: THREE.Vector3; max: THREE.Vector3; }

const STEP_HEIGHT = 0.55;

export class PhysicsWorld {
  /** ground height function; null = bottomless (space) */
  heightAt: ((x: number, z: number) => number) | null = null;
  boxes: StaticBox[] = [];
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

  groundHeight(x: number, z: number, feetY: number): number {
    let g = this.heightAt ? this.heightAt(x, z) : -Infinity;
    for (const b of this.boxes) {
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) {
        // box top counts as ground if it's at/below feet (+ step allowance)
        if (b.max.y <= feetY + STEP_HEIGHT && b.max.y > g) g = b.max.y;
      }
    }
    return g;
  }

  /**
   * Move a capsule (pos = feet position, mutated) by vel*dt, resolving
   * collisions. Returns grounded state.
   */
  moveCapsule(pos: THREE.Vector3, radius: number, height: number, vel: THREE.Vector3, dt: number): GroundHit {
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
    return { grounded, groundY: g };
  }

  /** Raycast vs boxes (analytic) and heightfield (marched). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null {
    let best: RayHit | null = null;
    // boxes: slab test
    for (const b of this.boxes) {
      const hit = rayBox(origin, dir, b, maxDist);
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
  if (axis < 0 || tmin <= 0) return null;
  const point = o.clone().addScaledVector(d, tmin);
  const normal = new THREE.Vector3();
  normal.setComponent(axis, sign);
  return { dist: tmin, point, normal };
}
