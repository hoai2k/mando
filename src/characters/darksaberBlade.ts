import * as THREE from 'three';
import { markShared } from '../core/dispose';

/** A pointed blade with a straight spine and one edge curving into its tip. */
export function makeDarksaberBlade(length: number): THREE.Group {
  const blade = new THREE.Group();
  const spine = -0.047;
  const edge = (t: number): number => t < 0.7 ? 0.052
    : 0.052 - 0.099 * Math.pow((t - 0.7) / 0.3, 2);
  const outline = [new THREE.Vector2(spine, 0), new THREE.Vector2(edge(0), 0)];
  for (let i = 1; i <= 24; i++) outline.push(new THREE.Vector2(edge(i / 24), length * i / 24));
  const shape = new THREE.Shape(outline);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: false, curveSegments: 1 });
  geometry.translate(0, 0, -0.009);
  // Shape/extrude UVs use world-space XY. Fit the texture across the blade's
  // face so its fine grain and the white marks land on the curved edge.
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - spine) / 0.099, uv.getY(i) / length);
  uv.needsUpdate = true;
  const face = new THREE.MeshBasicMaterial({ map: bladeTexture(), side: THREE.DoubleSide });
  const side = new THREE.MeshBasicMaterial({ color: 0x090b0f });
  const core = new THREE.Mesh(geometry, [face, side]);
  core.castShadow = false;
  blade.add(core);

  // Two fine white rims give the flat black face its silhouette from either
  // side. The broader, faint rim is the reference's soft energy fringe.
  const path = new THREE.CatmullRomCurve3(outline.map((p) => new THREE.Vector3(p.x, p.y, 0)), true, 'centripetal');
  const halos: THREE.MeshBasicMaterial[] = [];
  for (const z of [-0.01, 0.01]) {
    for (const [radius, opacity] of [[0.011, 0.2], [0.0034, 0.96]] as const) {
      const material = new THREE.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false });
      if (radius > 0.01) halos.push(material);
      const rim = new THREE.Mesh(new THREE.TubeGeometry(path, 64, radius, 5, true), material);
      rim.position.z = z;
      rim.castShadow = false;
      blade.add(rim);
    }
  }
  blade.userData.haloMaterials = halos;
  return blade;
}

let texture: THREE.CanvasTexture | null = null;
function bladeTexture(): THREE.CanvasTexture {
  if (texture) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#090b10';
  ctx.fillRect(0, 0, 128, 1024);
  let seed = 0x5abec7;
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  // Uneven graphite grain on the black field, kept subtle so it still reads
  // black at gameplay distance. The fine diagonal scratches imply facets.
  for (let i = 0; i < 950; i++) {
    const x = rand() * 128, y = rand() * 1024;
    ctx.strokeStyle = `rgba(135,145,160,${(0.012 + rand() * 0.065).toFixed(3)})`;
    ctx.lineWidth = 0.3 + rand() * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 1 + rand() * 13, y - 2 - rand() * 19);
    ctx.stroke();
  }
  // Short, broken white licks rise from the curved edge into the black face.
  // Keep the straight spine clear, as in the supplied reference.
  for (let i = 0; i < 110; i++) {
    const y = 32 + rand() * 965;
    const depth = 4 + Math.pow(rand(), 2) * 27;
    const x = 123 - rand() * 7;
    ctx.strokeStyle = `rgba(235,243,255,${(0.45 + rand() * 0.5).toFixed(3)})`;
    ctx.lineWidth = 0.5 + rand() * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - depth * 0.33, y - 2 - rand() * 5);
    ctx.lineTo(x - depth * 0.62, y + rand() * 6);
    ctx.lineTo(x - depth, y - rand() * 7);
    ctx.stroke();
  }
  texture = markShared(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
