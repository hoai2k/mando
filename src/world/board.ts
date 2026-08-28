import * as THREE from 'three';
import { PhysicsWorld } from '../core/physics';

export interface Board {
  group: THREE.Group;
  physics: PhysicsWorld;
  playerStarts: THREE.Vector3[];
  groundSpawns: THREE.Vector3[];
  airSpawns: THREE.Vector3[];
  kind: 'desert' | 'station';
  fog: THREE.Fog | null;
  background: THREE.Color;
  /** authored equirect panorama to use as the scene background, if present */
  skyFile?: string;
  /** dims the panorama so bright skies don't flatten the geometry against them */
  skyIntensity?: number;
  /** procedural sky, hidden once the authored panorama loads */
  proceduralSky?: THREE.Object3D;
  /**
   * Gravity scale for everyone standing on this board, 1 = Tatooine. A station
   * in orbit runs light: jumps float, falls are gentle, the jetpack goes
   * further on the same fuel.
   */
  gravity?: number;
  /**
   * Below this height there is no floor left to hit, so falling becomes a slow
   * drift a jetpack tap can undo rather than a plunge. Omit for solid ground.
   */
  voidY?: number;
  /** gravity multiplier while drifting below voidY */
  voidGravity?: number;
  /** terminal downward speed while drifting, m/s */
  voidFallSpeed?: number;
  /**
   * How much ambient lift the player character gets on this board, 0–1 as a
   * fraction of his own albedo. It reaches the hero only, so a dark board can
   * keep its mood without losing him against it.
   */
  heroLight?: number;
  /** deadly zone (sarlacc pit) */
  hazard?: { center: THREE.Vector3; radius: number };
  update?: (dt: number, time: number) => void;
}
