import * as THREE from 'three';
import { audio } from '../core/audio';
import type { Game } from '../game/game';

/**
 * Sky traffic (PLAN.md §16.1): a few ships on long looping paths far outside
 * the play space — slow parallax and blinking running lights that make the
 * sky read as a shipping lane rather than a painting. Everything here is
 * atmosphere by construction: `decor` flagged, no colliders, no radar
 * contacts, and the one gameplay-adjacent output is a distant engine wash
 * (`ship_pass`) when the low ship makes its close approach.
 *
 * The ships are procedural silhouettes on purpose. At 250–400 m a hull is a
 * shape and two lights; an authored model would spend a download on detail
 * the eye cannot resolve at lane distance. (The close-up freighter on the
 * waystation's live pad is the authored one — that ship you can stand on.)
 */

export interface SkyLane {
  /** ellipse centre and radii of the loop, in world metres */
  center: THREE.Vector3;
  rx: number;
  rz: number;
  /** radians per second around the loop */
  speed: number;
  /** starting angle, so the lane's ships don't convoy */
  phase: number;
  /** overall scale — a bigger liner for the far lanes so they still read */
  scale: number;
  /**
   * The close-pass lane: when this ship crosses its nearest point to the
   * arena centre it carries a doppler-washed rumble. At most one lane should
   * set it, or the sky turns into a drum.
   */
  rumble?: boolean;
}

interface Ship {
  node: THREE.Group;
  lane: SkyLane;
  angle: number;
  lights: THREE.Mesh[];
  /** re-armed after each rumble so a slow lane doesn't retrigger every frame */
  rumbled: boolean;
}

/** a distant liner: fuselage, engine block, swept fins — silhouette only */
function makeLiner(scale: number): { node: THREE.Group; lights: THREE.Mesh[] } {
  const hullMat = new THREE.MeshBasicMaterial({ color: 0x2c3038 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x7ac8ff });
  const node = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 14), hullMat);
  node.add(body);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 3.5), hullMat);
  bridge.position.set(0, 1.6, -3.5);
  node.add(bridge);
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.4, 4), hullMat);
    fin.position.set(s * 3.2, 0, 2);
    node.add(fin);
  }
  // engines: a warm glow astern, plus port/starboard running lights that blink
  const engine = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshBasicMaterial({
    color: 0xffb060, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  }));
  engine.position.set(0, 0, 7.1);
  node.add(engine);
  const lights: THREE.Mesh[] = [];
  const lightGeo = new THREE.SphereGeometry(0.35, 6, 5);
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(lightGeo, glowMat.clone());
    l.position.set(s * 5.4, 0.3, 2);
    node.add(l);
    lights.push(l);
  }
  node.scale.setScalar(scale);
  node.userData.decor = true;
  return { node, lights };
}

/**
 * Build the lanes into `group` and hand back a per-frame update. Call it from
 * the board's own `update` with (dt, time, game).
 */
export function addSkyTraffic(group: THREE.Group, lanes: SkyLane[]): (time: number, game?: Game) => void {
  const ships: Ship[] = lanes.map((lane) => {
    const { node, lights } = makeLiner(lane.scale);
    group.add(node);
    return { node, lane, angle: lane.phase, lights, rumbled: false };
  });

  return (time: number, game?: Game): void => {
    for (const ship of ships) {
      const { lane } = ship;
      const a = lane.phase + time * lane.speed;
      const x = lane.center.x + Math.cos(a) * lane.rx;
      const z = lane.center.z + Math.sin(a) * lane.rz;
      ship.node.position.set(x, lane.center.y, z);
      // heading: the tangent of the ellipse, so the hull leads with its nose
      ship.node.rotation.y = Math.atan2(-Math.sin(a) * lane.rx, Math.cos(a) * lane.rz) + Math.PI;
      // running lights blink on a ship-specific beat
      const blink = Math.sin(time * 2.6 + lane.phase * 7) > 0.55 ? 1 : 0.25;
      for (const l of ship.lights) (l.material as THREE.MeshBasicMaterial).opacity = blink;
      (ship.lights[0]?.material as THREE.MeshBasicMaterial).transparent = true;
      (ship.lights[1]?.material as THREE.MeshBasicMaterial).transparent = true;

      // the close pass: nearest to the arena centre around a = π/2·k — just
      // watch the distance to origin trough and fire once per lap
      if (lane.rumble && game) {
        const d2 = x * x + z * z;
        const near = d2 < (Math.min(lane.rx, lane.rz) * 0.55) ** 2;
        if (near && !ship.rumbled) {
          ship.rumbled = true;
          const p = game.players[0];
          const dist = p ? Math.hypot(x - p.position.x, z - p.position.z) : 300;
          audio.shipPass(Math.max(0.08, Math.min(0.5, 90 / dist)));
        } else if (!near) {
          ship.rumbled = false;
        }
      }
    }
  };
}
