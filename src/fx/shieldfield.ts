import * as THREE from 'three';

/**
 * The force field, as anything that raises one draws it.
 *
 * A field, not a pane with a border: the body of the dome carries the effect
 * and the edge falls out of it. A Fresnel term brightens the surface where it
 * turns away from the eye, which is what makes a curved field read as a
 * volume; a hex interference pattern drifts across it so it looks energised
 * rather than painted; and a hit sends a ring out from the point of impact.
 * An early version let a bright torus rim do all the work and left the middle
 * empty, so the whole thing read as an outline.
 *
 * Two things raise one: a fighter's block shield — a forward dome off the
 * chest, or a closed bubble for a carrier who has one — and a ride's
 * deflector, which is the same field at hull scale (PLAN.md §17). They differ
 * only in how big the sphere is and how much of it there is, so the shader,
 * the rim and the impact ring live here once.
 */
export interface ShieldField {
  /**
   * Parent this where the field belongs. Its own scale is untouched — the
   * grow-into-place scale rides an inner group — so a caller may stretch the
   * root to fit a body that is not a ball.
   */
  root: THREE.Group;
  /** 0 = down, 1 = fully up: visibility, the grow-in and the shader's strength */
  setStrength(t: number): void;
  /** something landed on it: a ring runs out from the centre */
  hit(): void;
  /** per-frame cosmetic tick — drives the drift, the shimmer and the ring */
  update(dt: number, time: number): void;
}

export interface ShieldFieldOpts {
  /** sphere radius, in metres */
  radius: number;
  /**
   * How much of the sphere there is, as the polar sweep: `Math.PI` is a closed
   * bubble, less than that a cap opening forward along +Z.
   */
  arc?: number;
  color?: number;
  hot?: number;
}

/** Build one field. Nothing is added to a scene — parent `root` yourself. */
export function createShieldField(opts: ShieldFieldOpts): ShieldField {
  const radius = opts.radius;
  const arc = opts.arc ?? Math.PI;
  const closed = arc >= Math.PI - 1e-3;
  const root = new THREE.Group();
  // The grow-in scale rides an inner group so the root stays the caller's to
  // place, and to stretch over a hull that is longer than it is wide.
  const inner = new THREE.Group();
  root.add(inner);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uStrength: { value: 0 },
      uFlash: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(opts.color ?? 0x63b4ff) },
      uHot: { value: new THREE.Color(opts.hot ?? 0xdcefff) },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormalV;
      varying vec3 vViewV;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalMatrix * normal;
        vViewV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uStrength;
      uniform float uFlash;
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uHot;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      varying vec2 vUv;

      // distance to the nearest hex cell edge, for the interference lattice
      float hexEdge(vec2 p) {
        p.x *= 1.1547;
        p.y += mod(floor(p.x), 2.0) * 0.5;
        p = abs(fract(p) - 0.5);
        return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
      }

      void main() {
        if (uStrength <= 0.001) discard;
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewV);
        // grazing angles glow: the dome gains a body instead of a border
        float fres = pow(1.0 - abs(dot(n, v)), 2.4);

        // lattice drifting across the surface — kept faint, it is a texture on
        // the field, not the field itself
        vec2 hp = vec2(vUv.x * 15.0 + uTime * 0.10, vUv.y * 15.0 - uTime * 0.04);
        float cells = smoothstep(0.09, 0.0, hexEdge(hp)) * 0.14;

        // slow standing ripple so an idle field still breathes
        float shimmer = sin(vUv.y * 34.0 - uTime * 2.4) * 0.5 + 0.5;

        // impact ring travelling out from the centre of the dome
        float r = vUv.y / 0.46;
        float ring = smoothstep(0.16, 0.0, abs(r - (1.0 - uFlash))) * uFlash;

        // the dome is double-sided, so a head-on look adds the far wall to the
        // near one; the halved total keeps the middle see-through
        float a = (0.05 + fres * 0.8 + cells + shimmer * 0.05 + ring * 1.0) * uStrength * 0.62;
        vec3 col = mix(uColor, uHot, clamp(fres * 0.55 + ring, 0.0, 1.0));
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const skin = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 30, 16, 0, Math.PI * 2, 0, arc), material);
  skin.rotation.x = Math.PI / 2;   // the cap opens forward, along +Z
  inner.add(skin);

  // A faint edge, sitting exactly on the dome's lip so it reads as the field
  // ending rather than as a frame drawn around it. A closed bubble has no lip,
  // so the ring becomes its equator.
  const rimMat = new THREE.MeshBasicMaterial({
    color: 0x9fd0ff, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius * (closed ? 1 : Math.sin(arc)), radius * 0.017, 8, 40), rimMat);
  if (closed) rim.rotation.x = Math.PI / 2;
  else rim.position.z = radius * Math.cos(arc);
  inner.add(rim);
  root.visible = false;

  let flash = 0;
  let strength = 0;

  return {
    root,
    setStrength: (t) => {
      strength = t;
      root.visible = t > 0.02;
      // it grows into place rather than popping, and sits flat until it is up
      inner.scale.setScalar(0.55 + t * 0.45);
      material.uniforms.uStrength.value = t;
      rimMat.opacity = 0.22 * t;
    },
    hit: () => { flash = 1; },
    update: (dt, time) => {
      material.uniforms.uTime.value = time;
      if (flash > 0) {
        // the ring runs out from the centre and the lip lifts with it
        flash = Math.max(0, flash - dt * 3);
        rimMat.opacity = 0.22 * strength + flash * 0.3;
      }
      material.uniforms.uFlash.value = flash;
    },
  };
}
