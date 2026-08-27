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
  /** deadly zone (sarlacc pit) */
  hazard?: { center: THREE.Vector3; radius: number };
  update?: (dt: number, time: number) => void;
}
