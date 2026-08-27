import * as THREE from 'three';

let spriteTex: THREE.Texture | null = null;
function particleSprite(): THREE.Texture {
  if (spriteTex) return spriteTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  spriteTex = new THREE.CanvasTexture(c);
  return spriteTex;
}

/** Pooled CPU particle system rendered as THREE.Points, one pool per look. */
class Pool {
  points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;

  constructor(public capacity: number, color: number, size: number, private gravity: number, additive = true, opacity = 0.9) {
    this.pos = new Float32Array(capacity * 3).fill(1e6);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity).fill(1);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const mtl = new THREE.PointsMaterial({
      color, size, sizeAttenuation: true, transparent: true, opacity,
      map: particleSprite(), depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mtl);
    this.points.frustumCulled = false;
  }

  spawn(p: THREE.Vector3, baseVel: THREE.Vector3, spread: number, life: number, count: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.vel[i * 3] = baseVel.x + (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 1] = baseVel.y + (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 2] = baseVel.z + (Math.random() - 0.5) * spread;
      this.life[i] = life * (0.6 + Math.random() * 0.4);
      this.maxLife[i] = this.life[i];
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = 1e6; continue; }
      this.vel[i * 3 + 1] -= this.gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class ParticleFX {
  group = new THREE.Group();
  private sparks = new Pool(500, 0xffc86e, 0.09, 9);
  private flame = new Pool(600, 0xff9840, 0.14, -2.5);
  private dust = new Pool(500, 0xcbb490, 0.35, 0.6, false, 0.35);
  private boom = new Pool(400, 0xffa050, 0.5, 1.5);
  private smoke = new Pool(300, 0x555555, 0.6, -0.8, false, 0.3);

  constructor() {
    for (const p of [this.sparks, this.flame, this.dust, this.boom, this.smoke]) this.group.add(p.points);
  }

  impactSparks(p: THREE.Vector3, n = 10): void { this.sparks.spawn(p, new THREE.Vector3(0, 2, 0), 6, 0.35, n); }
  jetFlame(p: THREE.Vector3, downVel: THREE.Vector3): void { this.flame.spawn(p, downVel, 1.6, 0.28, 3); }
  dustPuff(p: THREE.Vector3, n = 8): void { this.dust.spawn(p, new THREE.Vector3(0, 1.2, 0), 2.4, 0.9, n); }
  runDust(p: THREE.Vector3): void { this.dust.spawn(p, new THREE.Vector3(0, 0.5, 0), 1, 0.5, 1); }
  explosion(p: THREE.Vector3): void {
    this.boom.spawn(p, new THREE.Vector3(0, 3, 0), 12, 0.6, 60);
    this.smoke.spawn(p, new THREE.Vector3(0, 2, 0), 4, 1.4, 25);
    this.sparks.spawn(p, new THREE.Vector3(0, 5, 0), 14, 0.5, 40);
  }
  deathBurst(p: THREE.Vector3, n = 25): void {
    this.sparks.spawn(p, new THREE.Vector3(0, 3, 0), 7, 0.4, n);
    this.smoke.spawn(p, new THREE.Vector3(0, 1.5, 0), 2, 1, 10);
  }

  update(dt: number): void {
    this.sparks.update(dt);
    this.flame.update(dt);
    this.dust.update(dt);
    this.boom.update(dt);
    this.smoke.update(dt);
  }
}
