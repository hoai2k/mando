import * as THREE from 'three';

export interface GradientSkyOpts {
  top: number;
  horizon: number;
  dusk: number;
  sun1?: { dir: THREE.Vector3; color: number; size?: number };
  sun2?: { dir: THREE.Vector3; color: number; size?: number };
}

/**
 * Gradient sky dome with up to two sun discs — the desert sky generalized so
 * every outdoor board can carry its own palette (ochre Tatooine, ash-brown
 * Nevarro, bone-pale ice, the ring city's hard split).
 */
export function gradientSky(opts: GradientSkyOpts): THREE.Mesh {
  const off = new THREE.Vector3(0, -1, 0); // a sun below the floor never shows
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(opts.top) },
      horizonColor: { value: new THREE.Color(opts.horizon) },
      duskColor: { value: new THREE.Color(opts.dusk) },
      sun1Dir: { value: (opts.sun1?.dir ?? off).clone().normalize() },
      sun2Dir: { value: (opts.sun2?.dir ?? off).clone().normalize() },
      sun1Color: { value: new THREE.Color(opts.sun1?.color ?? 0x000000) },
      sun2Color: { value: new THREE.Color(opts.sun2?.color ?? 0x000000) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor, horizonColor, duskColor, sun1Dir, sun2Dir, sun1Color, sun2Color;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.55));
        // warm dusk band toward the suns' azimuth
        float sunAz = max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(sun1Dir.x, 0.0, sun1Dir.z))), 0.0);
        col = mix(col, duskColor, sunAz * (1.0 - h) * 0.55);
        // sun discs
        float d1 = dot(vDir, sun1Dir);
        float d2 = dot(vDir, sun2Dir);
        col += sun1Color * smoothstep(0.9985, 0.9995, d1) * 1.6;
        col += sun1Color * smoothstep(0.996, 0.999, d1) * 0.5;
        col += sun2Color * smoothstep(0.9988, 0.9996, d2) * 1.3;
        col += sun2Color * smoothstep(0.997, 0.9992, d2) * 0.4;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), material);
  mesh.frustumCulled = false;
  return mesh;
}

/** Twin-sun desert sky dome — the Dune Sea's original palette. */
export function tatooineSky(): THREE.Mesh {
  return gradientSky({
    top: 0x8fb0cd, horizon: 0xeacf96, dusk: 0xd99a5b,
    sun1: { dir: new THREE.Vector3(0.42, 0.38, 0.55), color: 0xfff2d1 },
    sun2: { dir: new THREE.Vector3(0.62, 0.3, 0.45), color: 0xffbf80 },
  });
}

/** Deep-space nebula + starfield + gas giant. */
export function spaceSky(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float noise(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      void main() {
        vec3 col = vec3(0.012, 0.012, 0.03);
        float n = noise(vDir * 3.0) * 0.6 + noise(vDir * 7.0) * 0.4;
        // nebula lobe
        float lobe = max(dot(vDir, normalize(vec3(-0.6, 0.25, -0.4))), 0.0);
        col += vec3(0.28, 0.1, 0.38) * pow(lobe, 2.2) * n * 1.6;
        col += vec3(0.5, 0.22, 0.08) * pow(max(dot(vDir, normalize(vec3(-0.3, 0.05, -0.75))), 0.0), 3.5) * n * 1.2;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), material);
  dome.frustumCulled = false;
  group.add(dome);

  // starfield
  const starCount = 1600;
  const pos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(850);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, depthWrite: false }));
  stars.frustumCulled = false;
  group.add(stars);

  // gas giant
  const giant = new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0xb78a52 })
  );
  giant.position.set(500, 140, -620);
  const bandMat = new THREE.MeshBasicMaterial({ color: 0x8a6238, transparent: true, opacity: 0.55 });
  for (let i = -2; i <= 2; i++) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(120 - Math.abs(i) * 9, 7 - Math.abs(i), 8, 48), bandMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = i * 30;
    giant.add(band);
  }
  group.add(giant);
  return group;
}
