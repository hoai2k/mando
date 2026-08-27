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
  mesh: THREE.Mesh;
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
  private matPlayer = new THREE.MeshBasicMaterial({ color: 0xff3222 });
  private matEnemy = new THREE.MeshBasicMaterial({ color: 0x66ff55 });
  onImpact: ((p: THREE.Vector3, hitTarget: boolean) => void) | null = null;

  constructor() {
    const geo = new THREE.BoxGeometry(0.055, 0.055, 0.85);
    for (let i = 0; i < CAPACITY; i++) {
      const mesh = new THREE.Mesh(geo, this.matPlayer);
      mesh.visible = false;
      this.group.add(mesh);
      this.bolts.push({ mesh, vel: new THREE.Vector3(), life: 0, damage: 0, team: 0, active: false });
    }
  }

  fire(origin: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, team: number): void {
    const b = this.bolts.find((x) => !x.active);
    if (!b) return;
    b.active = true;
    b.mesh.visible = true;
    b.mesh.material = team === 0 ? this.matPlayer : this.matEnemy;
    b.mesh.position.copy(origin);
    b.vel.copy(dir).normalize().multiplyScalar(speed);
    b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    b.life = 2.2;
    b.damage = damage;
    b.team = team;
  }

  update(dt: number, physics: PhysicsWorld, targets: BoltTarget[]): void {
    const step = new THREE.Vector3();
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.mesh.visible = false; continue; }
      step.copy(b.vel).multiplyScalar(dt);
      const stepLen = step.length();
      const from = b.mesh.position;

      // hit targets: segment vs sphere
      let hit = false;
      for (const t of targets) {
        if (!t.alive || t.team === b.team) continue;
        if (segSphere(from, step, stepLen, t.position, t.radius)) {
          t.onHit(b.damage, from);
          this.onImpact?.(t.position.clone(), true);
          hit = true;
          break;
        }
      }
      if (!hit) {
        // world hit
        const dir = step.clone().normalize();
        const worldHit = physics.raycast(from, dir, stepLen);
        if (worldHit) {
          this.onImpact?.(worldHit.point, false);
          hit = true;
        }
      }
      if (hit) { b.active = false; b.mesh.visible = false; continue; }
      from.add(step);
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
