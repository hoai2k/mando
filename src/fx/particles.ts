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

let flameTex: THREE.Texture | null = null;
/**
 * Puff sprite for the flame pool: a dense core inside a very soft skirt. The
 * soft edge is what makes overlapping puffs merge into one plume instead of
 * reading as a string of separate dots.
 */
function flameSprite(): THREE.Texture {
  if (flameTex) return flameTex;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - size / 2) / (size / 2);
      const dy = (y + 0.5 - size / 2) / (size / 2);
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const falloff = 1 - d;
      const a = Math.pow(falloff, 1.45);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(img, 0, 0);
  flameTex = new THREE.CanvasTexture(c);
  flameTex.colorSpace = THREE.NoColorSpace;
  return flameTex;
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

/** One emitter's burn shape. Everything is per-particle so pools can mix. */
interface JetSpec {
  /** particles per second */
  rate: number;
  /** exhaust speed at the nozzle, m/s */
  speed: number;
  /** velocity damping per second — high drag is what keeps the jet short */
  drag: number;
  /** seconds a puff burns for */
  life: number;
  /** nozzle mouth radius */
  radius: number;
  /** cone divergence as a fraction of exhaust speed */
  spread: number;
  sizeStart: number;
  sizeEnd: number;
  /** upward drift of the cooling gas */
  buoyancy: number;
  /** swirl strength, gives the plume its live edge */
  turbulence: number;
  /** 0..1 brightness of the burn */
  heat: number;
  /** per-puff opacity — low, so overlap (not one bright dot) makes the core */
  opacity: number;
  /** fraction of the emitter's own velocity the exhaust rides along with */
  carrier?: THREE.Vector3;
}

/**
 * Temperature ramp. Each puff is a translucent orange, not a white dot: the
 * white-hot core is what you get where many puffs stack up additively, which
 * is how a real flame gets its bright centre and soft coloured edge.
 */
const RAMP: number[][] = [
  [1.00, 0.80, 0.42],  // freshly burnt gas at the nozzle
  [1.00, 0.58, 0.20],
  [1.00, 0.34, 0.08],
  [0.60, 0.14, 0.03],
  [0.14, 0.03, 0.01],  // cooling ember
];

/**
 * Flame pool: per-particle size, colour and alpha driven by a temperature
 * ramp, so a burn shrinks and cools along its own length rather than being a
 * line of identical dots. Sized per particle, so one pool covers jetpacks,
 * thrusters and rocket exhaust at different scales.
 */
class FlamePool {
  points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private drag: Float32Array;
  private buoy: Float32Array;
  private turb: Float32Array;
  private heat: Float32Array;
  private alpha: Float32Array;
  private seed: Float32Array;
  private sizeA: Float32Array;
  private sizeB: Float32Array;
  private aSize: Float32Array;
  private aColor: Float32Array;
  private aAlpha: Float32Array;
  private cursor = 0;
  private geo = new THREE.BufferGeometry();
  private time = 0;

  constructor(public capacity: number) {
    const n = capacity;
    this.pos = new Float32Array(n * 3).fill(1e6);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.drag = new Float32Array(n);
    this.buoy = new Float32Array(n);
    this.turb = new Float32Array(n);
    this.heat = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.seed = new Float32Array(n);
    this.sizeA = new Float32Array(n);
    this.sizeB = new Float32Array(n);
    this.aSize = new Float32Array(n);
    this.aColor = new Float32Array(n * 3);
    this.aAlpha = new Float32Array(n);

    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 3));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.aAlpha, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

    const mtl = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: flameSprite() },
        // matches PointsMaterial's attenuation: half the drawing buffer height
        uScale: { value: 400 },
      },
      vertexShader: /* glsl */`
        attribute float aSize;
        attribute vec3 aColor;
        attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (uScale / max(0.001, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geo, mtl);
    this.points.frustumCulled = false;
    const bufSize = new THREE.Vector2();
    this.points.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(bufSize);
      mtl.uniforms.uScale.value = bufSize.y * 0.5;
    };
  }

  /**
   * Burn for one frame. Puffs are spread across `dt` and stepped forward by
   * their own sub-frame age, so the plume stays continuous at any framerate
   * and any emitter speed instead of beading up once per frame.
   */
  emit(origin: THREE.Vector3, dir: THREE.Vector3, dt: number, s: JetSpec): void {
    const want = s.rate * dt;
    let count = Math.floor(want);
    if (Math.random() < want - count) count++;
    if (count <= 0) return;

    // nozzle frame: any two axes perpendicular to the exhaust direction
    const d = _d.copy(dir).normalize();
    const up = Math.abs(d.y) > 0.9 ? _up.set(1, 0, 0) : _up.set(0, 1, 0);
    const rx = _rx.crossVectors(up, d).normalize();
    const rz = _rz.crossVectors(d, rx).normalize();

    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;

      // sit the puff somewhere across the nozzle mouth, biased to the centre
      const ang = Math.random() * Math.PI * 2;
      const rad = s.radius * Math.sqrt(Math.random());
      const ox = Math.cos(ang) * rad, oz = Math.sin(ang) * rad;

      // exhaust speed falls off toward the nozzle wall, so the jet has a fast
      // core inside a slower sheath rather than one flat front
      const core = 1 - 0.35 * (rad / Math.max(1e-4, s.radius));
      const sp = s.speed * core * (0.85 + Math.random() * 0.3);
      const sx = (Math.random() - 0.5) * s.spread * s.speed;
      const sz = (Math.random() - 0.5) * s.spread * s.speed;

      let vx = d.x * sp + rx.x * sx + rz.x * sz;
      let vy = d.y * sp + rx.y * sx + rz.y * sz;
      let vz = d.z * sp + rx.z * sx + rz.z * sz;
      if (s.carrier) { vx += s.carrier.x; vy += s.carrier.y; vz += s.carrier.z; }

      let px = origin.x + rx.x * ox + rz.x * oz;
      let py = origin.y + rx.y * ox + rz.y * oz;
      let pz = origin.z + rx.z * ox + rz.z * oz;

      // stagger the puff back in time across the frame and catch it up
      const age = ((n + Math.random()) / count) * dt;
      px += vx * age; py += vy * age; pz += vz * age;

      this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.maxLife[i] = s.life * (0.75 + Math.random() * 0.5);
      this.life[i] = this.maxLife[i] - age;
      this.drag[i] = s.drag;
      this.buoy[i] = s.buoyancy;
      this.turb[i] = s.turbulence;
      this.heat[i] = s.heat * (0.85 + Math.random() * 0.3);
      this.alpha[i] = s.opacity * (0.8 + Math.random() * 0.4);
      this.seed[i] = Math.random() * 100;
      this.sizeA[i] = s.sizeStart * (0.8 + Math.random() * 0.4);
      this.sizeB[i] = s.sizeEnd * (0.8 + Math.random() * 0.4);
    }
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = 1e6; this.aAlpha[i] = 0; continue; }

      const age = 1 - this.life[i] / this.maxLife[i];
      const i3 = i * 3;

      // drag bleeds the exhaust off fast — that, not a short life alone, is
      // what makes it a stubby jet instead of a long streak
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= k; this.vel[i3 + 1] *= k; this.vel[i3 + 2] *= k;
      this.vel[i3 + 1] += this.buoy[i] * age * dt;

      const sd = this.seed[i];
      const turb = this.turb[i] * age;
      this.vel[i3] += Math.sin(t * 21 + sd * 6.3) * turb * dt;
      this.vel[i3 + 2] += Math.cos(t * 17 + sd * 4.9) * turb * dt;

      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      // temperature ramp: white core, orange body, dark cooling tail
      const f = Math.min(0.9999, age) * (RAMP.length - 1);
      const c0 = RAMP[Math.floor(f)], c1 = RAMP[Math.floor(f) + 1];
      const m = f - Math.floor(f);
      const h = this.heat[i];
      this.aColor[i3] = (c0[0] + (c1[0] - c0[0]) * m) * h;
      this.aColor[i3 + 1] = (c0[1] + (c1[1] - c0[1]) * m) * h;
      this.aColor[i3 + 2] = (c0[2] + (c1[2] - c0[2]) * m) * h;

      this.aSize[i] = this.sizeA[i] + (this.sizeB[i] - this.sizeA[i]) * Math.pow(age, 0.55);
      this.aAlpha[i] = this.alpha[i] * Math.min(1, age / 0.05) * Math.pow(1 - age, 1.4);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

const _d = new THREE.Vector3();
const _up = new THREE.Vector3();
const _rx = new THREE.Vector3();
const _rz = new THREE.Vector3();
const _carrier = new THREE.Vector3();

export class ParticleFX {
  group = new THREE.Group();
  private sparks = new Pool(500, 0xffc86e, 0.09, 9);
  private dust = new Pool(500, 0xcbb490, 0.35, 0.6, false, 0.35);
  private boom = new Pool(400, 0xffa050, 0.5, 1.5);
  private smoke = new Pool(300, 0x555555, 0.6, -0.8, false, 0.3);
  private flash = new Pool(120, 0xffe0a0, 0.55, 0);
  /** white water thrown up by a splash — falls back down */
  private spray = new Pool(300, 0xdceaf4, 0.3, 8, false, 0.55);
  /** air bubbles — negative gravity, they rise */
  private bubble = new Pool(300, 0xbfe4ff, 0.1, -2.4, true, 0.4);
  private jet = new FlamePool(2600);

  constructor() {
    for (const p of [this.sparks, this.dust, this.boom, this.smoke, this.flash, this.spray, this.bubble]) this.group.add(p.points);
    this.group.add(this.jet.points);
  }

  /** Bright puff at the gun barrel so firing has a visible source. */
  muzzleFlash(p: THREE.Vector3, dir: THREE.Vector3): void {
    this.flash.spawn(p, dir.clone().multiplyScalar(6), 3, 0.07, 5);
    this.sparks.spawn(p, dir.clone().multiplyScalar(9), 4, 0.12, 4);
  }

  impactSparks(p: THREE.Vector3, n = 10): void { this.sparks.spawn(p, new THREE.Vector3(0, 2, 0), 6, 0.35, n); }

  /**
   * Continuous thruster burn — call every frame a nozzle is lit.
   *
   * `carrier` is the emitter's own velocity: feeding most of it back in is
   * what keeps the burn a short jet stuck to the pack. Without it the exhaust
   * is left behind in world space and reads as a long trail.
   */
  jetPlume(origin: THREE.Vector3, dir: THREE.Vector3, dt: number, opts: {
    power?: number; scale?: number; carrier?: THREE.Vector3;
  } = {}): void {
    const power = Math.max(0, Math.min(1, opts.power ?? 1));
    if (power <= 0.01) return;
    const s = opts.scale ?? 1;
    // almost all of the emitter's motion is inherited; the small slip left
    // over is what a real exhaust does when you strafe hard
    if (opts.carrier) _carrier.copy(opts.carrier).multiplyScalar(0.92);
    this.jet.emit(origin, dir, dt, {
      // dense and slow-moving: the puffs have to overlap heavily or the burn
      // reads as a string of dots instead of a body of flame
      rate: 900 * power,
      speed: (3.4 + 2.2 * power) * s,
      drag: 16 / s,
      life: (0.12 + 0.05 * power) * s,
      radius: 0.028 * s,
      spread: 0.09,
      sizeStart: 0.13 * s,
      sizeEnd: 0.3 * s,
      buoyancy: 0.6,
      turbulence: 1.1,
      heat: 0.6 + 0.4 * power,
      opacity: 0.22,
      carrier: opts.carrier ? _carrier : undefined,
    });
  }

  /** Kick of flame when a jetpack lights up. */
  jetIgnite(origin: THREE.Vector3, dir: THREE.Vector3, scale = 1): void {
    this.jet.emit(origin, dir, 1, {
      rate: 70, speed: 6 * scale, drag: 14 / scale, life: 0.2 * scale,
      radius: 0.045 * scale, spread: 0.45, sizeStart: 0.12 * scale, sizeEnd: 0.34 * scale,
      buoyancy: 1, turbulence: 2, heat: 1, opacity: 0.3,
    });
    this.sparks.spawn(origin, dir.clone().normalize().multiplyScalar(4), 3, 0.25, 5);
  }

  /** Rocket motor: same burn, but it is meant to hang in the air as a trail. */
  rocketExhaust(origin: THREE.Vector3, dir: THREE.Vector3, dt: number): void {
    this.jet.emit(origin, dir, dt, {
      rate: 700, speed: 2.5, drag: 9, life: 0.3, radius: 0.05, spread: 0.22,
      sizeStart: 0.15, sizeEnd: 0.55, buoyancy: 0.6, turbulence: 1.5, heat: 0.9,
      opacity: 0.22,
    });
    if (Math.random() < dt * 30) this.smoke.spawn(origin, new THREE.Vector3(0, 0.5, 0), 1, 0.7, 1);
  }

  /** water thrown up where something met the surface */
  splash(p: THREE.Vector3, n = 14): void {
    this.spray.spawn(p, new THREE.Vector3(0, 3.2, 0), 3.4, 0.7, n);
    this.bubble.spawn(p, new THREE.Vector3(0, 0.6, 0), 1.2, 0.8, Math.ceil(n / 2));
  }

  /** a swimmer's exhaust: a few bubbles a frame, rising off the pack */
  bubbleTrail(p: THREE.Vector3, dt: number): void {
    if (Math.random() < dt * 14) this.bubble.spawn(p, new THREE.Vector3(0, 1.4, 0), 0.7, 1.4, 1);
  }

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
    this.dust.update(dt);
    this.boom.update(dt);
    this.smoke.update(dt);
    this.flash.update(dt);
    this.spray.update(dt);
    this.bubble.update(dt);
    this.jet.update(dt);
  }
}
