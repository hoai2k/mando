/**
 * Before/after renders of a re-rig: the original model and its re-rigged
 * copies side by side, held in the same extreme pose (set on the canonical
 * rig, retargeted to each skin exactly as the game does), shot through one
 * orthographic camera so nothing but the rig differs between them.
 *
 * Driven by tools/asset-pipeline/pose-compare.mjs through `window.__poseCompare`.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildMandalorian, type MandoId } from '../../src/characters/mandalorians';
import type { ModelId } from '../../src/characters/authored';

const W = 1500, H = 900;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setClearColor(0x15171b);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.4;
const key = new THREE.DirectionalLight(0xfff1dd, 2.6);
key.position.set(2, 4, 3);
scene.add(key, new THREE.HemisphereLight(0xc8d4e6, 0x2a2622, 0.6));

type Pose = Record<string, [number, number, number]>;
const D = THREE.MathUtils.DEG2RAD;

function waitFrames(n: number): Promise<void> {
  return new Promise((r) => { const tick = () => (--n <= 0 ? r() : requestAnimationFrame(tick)); tick(); });
}

/**
 * @param id       the character
 * @param files    model files to show, left to right (the original first)
 * @param shots    per shot: the pose, the camera direction (from the target), the target and the half-height in metres
 */
async function poseCompare(id: MandoId, files: ModelId[], shots: Array<{ pose: Pose; dir: [number, number, number]; at: [number, number, number]; half: number }>): Promise<string[]> {
  const figures = files.map((f) => buildMandalorian(id, { modelFile: f }));
  const gap = 1.1;
  figures.forEach((c, i) => {
    c.setWeapon('none');
    c.root.position.x = (i - (files.length - 1) / 2) * gap;
    scene.add(c.root);
  });
  const t0 = performance.now();
  while (!figures.every((c) => c.modelReady()) && performance.now() - t0 < 60000) await waitFrames(5);
  const rest = figures.map((c) => Object.fromEntries(Object.entries(c.rig!.bones).map(([n, b]) => [n, b.quaternion.clone()])));
  const out: string[] = [];
  for (const shot of shots) {
    figures.forEach((c, i) => {
      for (const [n, q] of Object.entries(rest[i])) c.rig!.bones[n as keyof typeof c.rig.bones].quaternion.copy(q);
      for (const [n, [x, y, z]] of Object.entries(shot.pose)) {
        c.rig!.bones[n as keyof typeof c.rig.bones].quaternion.setFromEuler(new THREE.Euler(x * D, y * D, z * D));
      }
      c.cosmetic?.(0, 0);
    });
    await waitFrames(2);
    figures.forEach((c) => c.cosmetic?.(0, 0));
    // the camera looks along `dir` at each figure's own target; one frame per figure, tiled
    const aspect = (W / files.length) / H;
    const cam = new THREE.OrthographicCamera(-shot.half * aspect, shot.half * aspect, shot.half, -shot.half, 0.01, 50);
    const dir = new THREE.Vector3(...shot.dir).normalize();
    renderer.setScissorTest(true);
    figures.forEach((c, i) => {
      const at = new THREE.Vector3(...shot.at).add(c.root.position);
      cam.position.copy(at).addScaledVector(dir, 10);
      cam.lookAt(at);
      const x = (W / files.length) * i;
      renderer.setViewport(x, 0, W / files.length, H);
      renderer.setScissor(x, 0, W / files.length, H);
      // only this figure in its tile
      figures.forEach((o, j) => { o.root.visible = j === i; });
      renderer.render(scene, cam);
    });
    figures.forEach((o) => { o.root.visible = true; });
    renderer.setScissorTest(false);
    out.push(renderer.domElement.toDataURL('image/png'));
  }
  return out;
}

(window as unknown as { __poseCompare: typeof poseCompare }).__poseCompare = poseCompare;
