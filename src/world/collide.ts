import * as THREE from 'three';
import type { PhysicsWorld, StaticBox, StaticCylinder } from '../core/physics';

/**
 * Colliders fitted to an authored sculpt.
 *
 * Every environment model in the game replaces a procedural stand-in whose
 * colliders were placed by hand around the *stand-in*. That works while the
 * two are the same shape and stops working the moment they aren't: the station
 * crane is the case in point — a mast and a boom of hand-placed cylinders, and
 * a sculpt that also carries a slung container, a counterweight and a cab, none
 * of which you could land on. The freighter is the other case: a box drawn
 * around a cylinder-and-wings stand-in leaves the sculpted hull sitting inside
 * a collider that is looser than it looks, so you sink into the fuselage.
 *
 * So the sculpt supplies its own. The model's triangles are rasterised into a
 * coarse voxel grid, the occupied cells are merged into as few boxes as they
 * will go, and those replace whatever the board had put there. It is blunt by
 * construction — a metre-ish grid, axis-aligned, the same boxes the rest of
 * the physics runs on — but it is blunt *around the shape that is actually
 * drawn*, which is the whole complaint: you can land on anything that looks
 * solid, and you stop where the hull is.
 *
 * The fit runs once, when the model lands. A board whose sculpts never arrive
 * keeps the hand-placed colliders it always had.
 */

/**
 * What the fitting has cost this session — every prop that has been fitted, the
 * boxes it produced and the milliseconds it took. The fit runs on the main
 * thread when a model lands mid-match, so this is the number that says whether
 * it is ever felt; `tools/audit-props.mjs` reports it.
 */
export const fitStats = { props: 0, boxes: 0, ms: 0 };

export interface FitOptions {
  /**
   * Voxel size in metres. Smaller is tighter and costs more boxes; the default
   * scales with the model, about a sixteenth of its longest side.
   */
  cell?: number;
  /**
   * Colliders the board placed for the stand-in, dropped once the fitted ones
   * are in. Anything left out stays — a board can keep a collider it wants
   * (an invisible ledge, a mover's box) by simply not listing it.
   */
  replace?: (StaticBox | StaticCylinder)[];
  /** ceiling on fitted boxes; the grid coarsens until the fit is under it */
  maxBoxes?: number;
  /** called with the fitted boxes once they are in — a mover takes them to carry */
  onFit?: (boxes: StaticBox[]) => void;
  /**
   * Skip geometry below this height above the model's base, in metres. For a
   * sculpt whose skirt spreads out over ground you should still be able to
   * walk on (a tent's guy lines, a dome's apron).
   */
  skirt?: number;
}

const MAX_CELLS = 42;    // per axis, so a grid never runs away
/**
 * Samples per triangle edge. The lattice is quadratic in this, so it is a
 * small number on purpose: a triangle much larger than a cell is rare in
 * these sculpts, and one much smaller is covered by its own corners.
 */
const MAX_SAMPLES = 8;

/** A mesh that is drawn but not meant to be solid — glows, decals, FX planes. */
function isDecor(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.userData?.decor) return true;
  }
  const mesh = o as THREE.Mesh;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const m = mats[0] as THREE.Material & { transparent?: boolean; isMeshBasicMaterial?: boolean };
  if (!m) return true;
  if (m.isMeshBasicMaterial && m.transparent) return true;
  return false;
}

interface Tri { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 }

/** Every solid triangle of `model`, in world space. */
function collectTriangles(model: THREE.Object3D): Tri[] {
  const tris: Tri[] = [];
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  model.updateWorldMatrix(true, true);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || isDecor(mesh)) return;
    const pos = mesh.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const i0 = index ? index.getX(i) : i;
      const i1 = index ? index.getX(i + 1) : i + 1;
      const i2 = index ? index.getX(i + 2) : i + 2;
      va.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      vb.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      vc.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      tris.push({ a: va.clone(), b: vb.clone(), c: vc.clone() });
    }
  });
  return tris;
}

/**
 * Fit box colliders to a loaded model and install them.
 *
 * @returns the boxes added, so a caller that owns something moving (a mover's
 *   platform) can keep hold of them.
 */
export function fitColliders(
  physics: PhysicsWorld,
  model: THREE.Object3D,
  opts: FitOptions = {},
): StaticBox[] {
  const started = performance.now();
  const tris = collectTriangles(model);
  if (!tris.length) return [];

  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const t of tris) for (const p of [t.a, t.b, t.c]) { lo.min(p); hi.max(p); }
  const floor = lo.y + (opts.skirt ?? 0);

  const span = new THREE.Vector3().subVectors(hi, lo);
  const longest = Math.max(span.x, span.y, span.z);
  if (longest < 1e-3) return [];
  const maxBoxes = opts.maxBoxes ?? 24;

  let cell = opts.cell ?? Math.min(1.2, Math.max(0.35, longest / 16));
  let boxes: StaticBox[] = [];
  // Coarsen until the fit fits the budget: a tighter grid is always preferable,
  // but not at the price of a hundred boxes in everyone's collision loop.
  for (let attempt = 0; attempt < 5; attempt++) {
    boxes = fitAt(tris, lo, hi, floor, cell);
    if (boxes.length <= maxBoxes) break;
    cell *= 1.5;
  }
  if (!boxes.length) return [];

  // The stand-in's colliders go only once the sculpt's are in hand, so there is
  // never a frame where the prop is intangible.
  for (const dead of opts.replace ?? []) {
    const bi = physics.boxes.indexOf(dead as StaticBox);
    if (bi >= 0) { physics.boxes.splice(bi, 1); continue; }
    const ci = physics.cylinders.indexOf(dead as StaticCylinder);
    if (ci >= 0) physics.cylinders.splice(ci, 1);
  }
  for (const b of boxes) physics.boxes.push(b);
  fitStats.props++;
  fitStats.boxes += boxes.length;
  fitStats.ms += performance.now() - started;
  opts.onFit?.(boxes);
  return boxes;
}

/** Voxelise at `cell` and merge; the boxes are built but not installed. */
function fitAt(
  tris: Tri[],
  lo: THREE.Vector3, hi: THREE.Vector3, floorY: number,
  cell: number,
): StaticBox[] {
  const nx = Math.min(MAX_CELLS, Math.max(1, Math.ceil((hi.x - lo.x) / cell)));
  const ny = Math.min(MAX_CELLS, Math.max(1, Math.ceil((hi.y - lo.y) / cell)));
  const nz = Math.min(MAX_CELLS, Math.max(1, Math.ceil((hi.z - lo.z) / cell)));
  const sx = (hi.x - lo.x) / nx || cell;
  const sy = (hi.y - lo.y) / ny || cell;
  const sz = (hi.z - lo.z) / nz || cell;
  const grid = new Uint8Array(nx * ny * nz);
  const at = (x: number, y: number, z: number) => (y * nz + z) * nx + x;

  // ---- rasterise ----
  // Triangles are sampled rather than clipped: a barycentric lattice fine
  // enough that no sample step crosses a cell. That is exact enough for a
  // collider a metre wide and costs one loop.
  const p = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const mark = (x: number, y: number, z: number) => {
    const ix = Math.min(nx - 1, Math.max(0, Math.floor((x - lo.x) / sx)));
    const iy = Math.min(ny - 1, Math.max(0, Math.floor((y - lo.y) / sy)));
    const iz = Math.min(nz - 1, Math.max(0, Math.floor((z - lo.z) / sz)));
    if (lo.y + iy * sy + sy <= floorY) return;   // under the skirt line
    grid[at(ix, iy, iz)] = 1;
  };
  for (const t of tris) {
    e1.subVectors(t.b, t.a);
    e2.subVectors(t.c, t.a);
    const step = Math.min(sx, sy, sz) * 0.7;
    const n = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil(Math.max(e1.length(), e2.length()) / step)));
    for (let i = 0; i <= n; i++) {
      for (let j = 0; i + j <= n; j++) {
        p.copy(t.a).addScaledVector(e1, i / n).addScaledVector(e2, j / n);
        mark(p.x, p.y, p.z);
      }
    }
  }

  // ---- close thin hollows ----
  // A sculpt is a shell, so a column through it reads solid-air-solid. Small
  // gaps are the inside of the thing and are filled; a large one is a real
  // opening (an archway, the gap under a boom) and is left alone.
  for (let x = 0; x < nx; x++) {
    for (let z = 0; z < nz; z++) {
      let run = -1;
      for (let y = 0; y < ny; y++) {
        if (!grid[at(x, y, z)]) continue;
        if (run >= 0 && y - run <= 3) for (let k = run + 1; k < y; k++) grid[at(x, k, z)] = 1;
        run = y;
      }
    }
  }

  // ---- merge ----
  // Greedy: grow along x, then z, then y, claiming cells as it goes. Scan
  // order makes this a stable, boring result rather than an optimal one, which
  // is what we want — the same sculpt fits the same way every run.
  const out: StaticBox[] = [];
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        if (!grid[at(x, y, z)]) continue;
        let x1 = x;
        while (x1 + 1 < nx && grid[at(x1 + 1, y, z)]) x1++;
        let z1 = z;
        grow: while (z1 + 1 < nz) {
          for (let xi = x; xi <= x1; xi++) if (!grid[at(xi, y, z1 + 1)]) break grow;
          z1++;
        }
        let y1 = y;
        growY: while (y1 + 1 < ny) {
          for (let zi = z; zi <= z1; zi++) {
            for (let xi = x; xi <= x1; xi++) if (!grid[at(xi, y1 + 1, zi)]) break growY;
          }
          y1++;
        }
        for (let yi = y; yi <= y1; yi++) {
          for (let zi = z; zi <= z1; zi++) {
            for (let xi = x; xi <= x1; xi++) grid[at(xi, yi, zi)] = 0;
          }
        }
        out.push({
          min: new THREE.Vector3(lo.x + x * sx, lo.y + y * sy, lo.z + z * sz),
          max: new THREE.Vector3(lo.x + (x1 + 1) * sx, lo.y + (y1 + 1) * sy, lo.z + (z1 + 1) * sz),
        });
      }
    }
  }
  return out;
}
