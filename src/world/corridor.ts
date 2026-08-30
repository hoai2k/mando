import * as THREE from 'three';
import { mat } from '../characters/builder';
import { authoredProp } from './props';

/**
 * A door: an emissive-trimmed frame around a lit pane, standing in a mission
 * gateway (world/mission.ts hangs its energy gates on these). Purely visual —
 * the gate owns the blocker box, the campaign owns the flow.
 *
 * `blast_door.glb` replaces the whole of it, pane included: the sculpt is a
 * closed door in its own frame with hazard striping and a status lamp, which is
 * what the pane and the emissive strip were standing in for. Finding the door
 * does not depend on either — the campaign's beacon sits on it and the HUD
 * names the distance.
 */
export function buildDoorFrame(parent: THREE.Object3D, pos: THREE.Vector3, yaw: number): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(pos);
  g.rotation.y = yaw;
  const frame = mat(0x3a3e46, { rough: 0.6, metal: 0.5 });
  const glowM = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  const post = new THREE.BoxGeometry(0.5, 3.6, 0.5);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(post, frame);
    p.position.set(side * 1.6, 1.8, 0);
    g.add(p);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.5, 0.5), frame);
  lintel.position.y = 3.55;
  g.add(lintel);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 3.1), new THREE.MeshBasicMaterial({
    color: 0x63b4ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  }));
  glow.position.y = 1.75;
  g.add(glow);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.12, 0.12), glowM);
  strip.position.y = 3.24;
  g.add(strip);
  // Everything built above is the stand-in. Quarter turn because this sculpt is
  // wide along its own Z where the frame is wide along X — without it the door
  // stands edge-on to everyone walking up to it.
  authoredProp(g, [...g.children], 'blast_door', 3.8, { axis: 'y', yaw: Math.PI / 2 });
  parent.add(g);
  return g;
}
