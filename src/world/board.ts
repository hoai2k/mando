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
  /** deadly zone (sarlacc pit) */
  hazard?: { center: THREE.Vector3; radius: number };
  update?: (dt: number, time: number) => void;
}
