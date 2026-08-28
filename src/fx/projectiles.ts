import * as THREE from 'three';
import type { PhysicsWorld } from '../core/physics';

export interface BoltTarget {
  position: THREE.Vector3;   // center of hit sphere
  radius: number;
  team: number;              // 0 = players, 1 = enemies (2 = props, hit by both)
  onHit: (damage: number, from: THREE.Vector3, tag?: string) => void;
  alive: boolean;
  /**
   * A raised block shield. Bolts arriving from the front of `normal` bounce
   * off it and fly on as the blocker's own fire; the sphere is tested before
   * the body, so a shield up is a shield that works.
   */
  shield?: { center: THREE.Vector3; radius: number; normal: THREE.Vector3 } | null;
}

interface Bolt {
  mesh: THREE.Mesh;   // bright core
  glow: THREE.Mesh;   // additive halo, makes the bolt readable against any sky
  vel: THREE.Vector3;
  life: number;
  damage: number;
  team: number;
  active: boolean;
  /** special payloads ride along with the bolt (e.g. 'net' snares on hit) */
  tag?: string;
}

const CAPACITY = 160;

export class ProjectileSystem {
  group = new THREE.Group();
  private bolts: Bolt[] = [];
  // near-white cores read as "hot"; the additive halo carries the colour
  private matPlayer = new THREE.MeshBasicMaterial({ color: 0xffd8c0 });
  private matEnemy = new THREE.MeshBasicMaterial({ color: 0xd8ffd0 });
  private glowPlayer = new THREE.MeshBasicMaterial({ color: 0xff4a22, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  private glowEnemy = new THREE.MeshBasicMaterial({ color: 0x55ff44, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  onImpact: ((p: THREE.Vector3, hitTarget: boolean, team: number) => void) | null = null;
  onDeflect: ((p: THREE.Vector3, normal: THREE.Vector3) => void) | null = null;

  constructor() {
    // unit-length along Z so each bolt can be stretched to cover the distance
    // it travels in a frame — a short bolt at speed leaves visible gaps
    const core = new THREE.BoxGeometry(0.1, 0.1, 1);
    const halo = new THREE.BoxGeometry(0.34, 0.34, 1);
    for (let i = 0; i < CAPACITY; i++) {
      const mesh = new THREE.Mesh(core, this.matPlayer);
      const glow = new THREE.Mesh(halo, this.glowPlayer);
      mesh.visible = glow.visible = false;
      mesh.frustumCulled = glow.frustumCulled = false;
      this.group.add(mesh);
      this.group.add(glow);
      this.bolts.push({ mesh, glow, vel: new THREE.Vector3(), life: 0, damage: 0, team: 0, active: false });
    }
  }

  fire(origin: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, team: number, tag?: string): void {
    const b = this.bolts.find((x) => !x.active);
    if (!b) return;
    b.active = true;
    b.tag = tag;
    b.mesh.visible = b.glow.visible = true;
    b.mesh.material = team === 0 ? this.matPlayer : this.matEnemy;
    b.glow.material = team === 0 ? this.glowPlayer : this.glowEnemy;
    b.mesh.position.copy(origin);
    b.vel.copy(dir).normalize().multiplyScalar(speed);
    b.mesh.quaternion.setFromUnitVectors(FORWARD, dir.clone().normalize());
    // player bolts are longer and fatter so you can actually track your own fire
    const len = team === 0 ? 2.6 : 1.8;
    b.mesh.scale.set(1, 1, len);
    b.glow.scale.set(1, 1, len * 0.9);
    b.glow.quaternion.copy(b.mesh.quaternion);
    b.glow.position.copy(origin);
    b.life = 2.2;
    b.damage = damage;
    b.team = team;
  }

  /** fired when a bolt meets the water's surface (splash FX hook) */
  onWaterHit: ((p: THREE.Vector3) => void) | null = null;

  update(dt: number, physics: PhysicsWorld, targets: BoltTarget[], waterY?: number): void {
    const step = new THREE.Vector3();
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.mesh.visible = b.glow.visible = false; continue; }
      step.copy(b.vel).multiplyScalar(dt);
      const stepLen = step.length();
      const from = b.mesh.position;

      // the sea swallows bolts, both ways: fire doesn't reach a diver, and a
      // diver's fire doesn't reach the surface world — surface to fight
      if (waterY !== undefined) {
        const y0 = from.y, y1 = from.y + step.y;
        if ((y0 > waterY) !== (y1 > waterY)) {
          const t = (waterY - y0) / (y1 - y0 || 1);
          const hit = from.clone().addScaledVector(step, t);
          this.onWaterHit?.(hit);
          b.active = false;
          b.mesh.visible = b.glow.visible = false;
          continue;
        }
      }

      // deflection first: a shield in the way is what the bolt meets, and it
      // has to be tested before the body it is covering
      let deflected = false;
      for (const t of targets) {
        if (!t.alive || t.team === b.team || !t.shield) continue;
        const sh = t.shield;
        // only the outward face blocks — you cannot shelter behind your own back
        if (b.vel.dot(sh.normal) >= 0) continue;
        if (!segSphere(from, step, stepLen, sh.center, sh.radius)) continue;
        // bounce: mirror the velocity about the shield normal and hand the
        // bolt to the blocker's team, so a good block is also a counterattack
        b.vel.reflect(sh.normal);
        b.team = t.team;
        b.damage *= 0.75;
        b.life = Math.min(b.life, 1.6);
        b.mesh.material = t.team === 0 ? this.matPlayer : this.matEnemy;
        b.glow.material = t.team === 0 ? this.glowPlayer : this.glowEnemy;
        const dir = b.vel.clone().normalize();
        b.mesh.quaternion.setFromUnitVectors(FORWARD, dir);
        b.glow.quaternion.copy(b.mesh.quaternion);
        from.copy(sh.center).addScaledVector(dir, sh.radius * 0.6);
        b.glow.position.copy(from);
        this.onDeflect?.(from.clone(), sh.normal);
        deflected = true;
        break;
      }
      if (deflected) continue;

      // hit targets: segment vs sphere
      let hit = false;
      for (const t of targets) {
        if (!t.alive || t.team === b.team) continue;
        if (segSphere(from, step, stepLen, t.position, t.radius)) {
          t.onHit(b.damage, from, b.tag);
          this.onImpact?.(t.position.clone(), true, b.team);
          hit = true;
          break;
        }
      }
      if (!hit) {
        // world hit
        const dir = step.clone().normalize();
        const worldHit = physics.raycast(from, dir, stepLen);
        if (worldHit) {
          this.onImpact?.(worldHit.point, false, b.team);
          hit = true;
        }
      }
      if (hit) { b.active = false; b.mesh.visible = b.glow.visible = false; continue; }
      from.add(step);
      b.glow.position.copy(from);
    }
  }
}

const FORWARD = new THREE.Vector3(0, 0, 1);
const tmp = new THREE.Vector3();
function segSphere(from: THREE.Vector3, step: THREE.Vector3, stepLen: number, center: THREE.Vector3, radius: number): boolean {
  tmp.subVectors(center, from);
  const t = Math.max(0, Math.min(stepLen, tmp.dot(step) / (stepLen || 1)));
  const cx = from.x + (step.x / (stepLen || 1)) * t - center.x;
  const cy = from.y + (step.y / (stepLen || 1)) * t - center.y;
  const cz = from.z + (step.z / (stepLen || 1)) * t - center.z;
  return cx * cx + cy * cy + cz * cz <= radius * radius;
}
