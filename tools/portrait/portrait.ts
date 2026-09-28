/**
 * Portrait shot: renders a playable fighter's authored model as a select-grid
 * portrait — 512×614, head and shoulders, warm key light from the upper left
 * on a near-black warm backdrop, the house style of every painted portrait in
 * public/assets/textures/portrait_*.jpg. Used where image generation cannot be
 * trusted with a character (see docs/ASSETS_IMAGES.md).
 *
 * Dev-only page, driven by tools/portraits.mjs through `window.__portrait`.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildMandalorian, type MandoId } from '../../src/characters/mandalorians';

const W = 512, H = 614;

export interface PortraitOpts {
  /** fraction of the frame above the top of the head */
  headroom?: number;
  /** metres of body shown, from the top of the head down */
  span?: number;
  /** turn of the body toward camera-left, radians (three-quarter view) */
  turn?: number;
  /** camera height relative to the top of the head, metres (negative = below) */
  eye?: number;
  /** 'none' hides whatever is held */
  weapon?: 'none' | 'blaster' | 'gaffi';
  exposure?: number;
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W * 2, H * 2);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.28;

// Warm key from the upper left, a low cool fill from the right, and a warm
// rim from behind so the silhouette separates from the black.
const key = new THREE.DirectionalLight(0xffc98f, 3.6);
key.position.set(-2.4, 3.2, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.camera.left = key.shadow.camera.bottom = -1.5;
key.shadow.camera.right = key.shadow.camera.top = 1.5;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0x8fa6c8, 0.35);
fill.position.set(2.5, 1.2, 1.5);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffb070, 1.6);
rim.position.set(1.8, 2.6, -2.8);
scene.add(rim);
scene.add(new THREE.AmbientLight(0x2a2018, 0.4));

const camera = new THREE.PerspectiveCamera(22, W / H, 0.05, 50);

/** world height of the highest rendered pixel of whatever is in the scene, seen flat-on */
const PROBE = 256;
function silhouetteTop(at: THREE.Vector3): number {
  const probe = new THREE.OrthographicCamera(-2, 2, 4, 0, 0.1, 20);
  probe.position.set(at.x, 0, at.z + 8);
  probe.lookAt(at.x, 0, at.z);
  const target = new THREE.WebGLRenderTarget(PROBE, PROBE);
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, probe);
  const px = new Uint8Array(PROBE * PROBE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, PROBE, PROBE, px);
  renderer.setRenderTarget(null);
  target.dispose();
  // rows run bottom-up in a render target
  for (let row = PROBE - 1; row >= 0; row--) {
    for (let x = 0; x < PROBE; x++) if (px[(row * PROBE + x) * 4 + 3] > 20) return ((row + 1) / PROBE) * 4;
  }
  return at.y + 0.2;
}

function waitFrames(n: number): Promise<void> {
  return new Promise((r) => { const tick = () => (--n <= 0 ? r() : requestAnimationFrame(tick)); tick(); });
}

/** the near-black warm backdrop the painted portraits sit on */
function backdrop(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#050302';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * 0.36, H * 0.22, 10, W * 0.42, H * 0.34, W * 0.9);
  g.addColorStop(0, 'rgba(92, 64, 40, 0.85)');
  g.addColorStop(0.45, 'rgba(40, 27, 16, 0.7)');
  g.addColorStop(1, 'rgba(5, 3, 2, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

async function shoot(id: MandoId, opts: PortraitOpts = {}): Promise<string> {
  const headroom = opts.headroom ?? 0.06;
  const span = opts.span ?? 0.64;
  renderer.toneMappingExposure = opts.exposure ?? 1.05;
  const char = buildMandalorian(id);
  scene.add(char.root);
  char.setWeapon(opts.weapon ?? 'none');
  char.root.rotation.y = opts.turn ?? 0.28;
  const t0 = performance.now();
  while (!char.modelReady() && performance.now() - t0 < 30000) await waitFrames(5);
  const anim = char.animator;
  anim?.play('lower', 'idleLower');
  anim?.play('upper', 'idleUpper');
  for (let i = 0; i < 90; i++) {
    anim?.update(1 / 60);
    char.cosmetic?.(1 / 60, i / 60);
  }
  char.root.updateMatrixWorld(true);
  // Freeze the pose: the render below should not move under the camera.
  char.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });

  // The top of the head is the top of the visible body, read off a flat
  // front-on silhouette: a bounding box over the meshes is not to be trusted
  // (a skinned mesh's box is its bind pose, wherever the skeleton has put it).
  const head = new THREE.Vector3();
  (char.rig?.bones.head ?? char.root).getWorldPosition(head);
  const top = silhouetteTop(head);
  // fit `span` metres below the head's top, with `headroom` of the frame above it
  const frameH = span / (1 - headroom);
  const centreY = top + headroom * frameH - frameH / 2;
  const dist = frameH / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(head.x, top + (opts.eye ?? -0.12), head.z + dist);
  camera.lookAt(head.x, centreY, head.z);
  key.target.position.set(head.x, centreY, head.z);

  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d')!;
  backdrop(ctx);
  ctx.drawImage(renderer.domElement, 0, 0, W, H);
  scene.remove(char.root);
  return out.toDataURL('image/jpeg', 0.92);
}

(window as unknown as { __portrait: typeof shoot }).__portrait = shoot;
