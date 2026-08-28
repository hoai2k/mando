import * as THREE from 'three';
import type { PhysicsWorld } from '../core/physics';

export interface BoltTarget {
  position: THREE.Vector3;   // center of hit sphere
  radius: number;
  team: number;              // 0 = players, 1 = enemies
  onHit: (damage: number, from: THREE.Vector3) => void;
  alive: boolean;
}

interface Bolt {
  mesh: THREE.Mesh;   // bright core
  glow: THREE.Mesh;   // additive halo, makes the bolt readable against any sky
  vel: THREE.Vector3;
  life: number;
  damage: number;
  team: number;
  active: boolean;
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

  fire(origin: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, team: number): void {
    const b = this.bolts.find((x) => !x.active);
    if (!b) return;
    b.active = true;
    b.mesh.visible = b.glow.visible = true;
    b.mesh.material = team === 0 ? this.matPlayer : this.matEnemy;
    b.glow.material = team === 0 ? this.glowPlayer : this.glowEnemy;
    b.mesh.position.copy(origin);
    b.vel.copy(dir).normalize().multiplyScalar(speed);
    b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
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

  update(dt: number, physics: PhysicsWorld, targets: BoltTarget[]): void {
    const step = new THREE.Vector3();
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.mesh.visible = b.glow.visible = false; continue; }
      step.copy(b.vel).multiplyScalar(dt);
      const stepLen = step.length();
      const from = b.mesh.position;

      // hit targets: segment vs sphere
      let hit = false;
      for (const t of targets) {
        if (!t.alive || t.team === b.team) continue;
        if (segSphere(from, step, stepLen, t.position, t.radius)) {
          t.onHit(b.damage, from);
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

const tmp = new THREE.Vector3();
function segSphere(from: THREE.Vector3, step: THREE.Vector3, stepLen: number, center: THREE.Vector3, radius: number): boolean {
  tmp.subVectors(center, from);
  const t = Math.max(0, Math.min(stepLen, tmp.dot(step) / (stepLen || 1)));
  const cx = from.x + (step.x / (stepLen || 1)) * t - center.x;
  const cy = from.y + (step.y / (stepLen || 1)) * t - center.y;
  const cz = from.z + (step.z / (stepLen || 1)) * t - center.z;
  return cx * cx + cy * cy + cz * cz <= radius * radius;
}
