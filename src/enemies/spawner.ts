import * as THREE from 'three';
import { Enemy, type EnemyKind } from './enemy';
import type { Board } from '../world/board';

/** Wave composition per board — grunt-heavy early, mixed later. */

export const FINAL_WAVE = 10;

interface WaveEntry { kind: EnemyKind; count: number; air?: boolean; }

export function waveComposition(board: Board['kind'], wave: number, players: number): WaveEntry[] {
  const mult = players === 2 ? 1.5 : 1;
  const n = (base: number, per: number) => Math.max(1, Math.round((base + wave * per) * mult));
  if (board === 'desert') {
    const list: WaveEntry[] = [
      { kind: 'tusken', count: n(2, 0.5) },
      { kind: 'massiff', count: n(1, 0.6) },
    ];
    if (wave >= 2) list.push({ kind: 'pyke', count: n(1, 0.7) });
    if (wave >= 3) list.push({ kind: 'nikto', count: Math.min(1 + ((wave / 3) | 0), 3), air: true });
    if (wave >= 5) list.push({ kind: 'droid', count: Math.min(((wave - 3) / 2) | 0, 3) });
    if (wave >= 6) list.push({ kind: 'stormtrooper', count: n(1, 0.4) });     // Imperial remnant arrives
    if (wave >= 7) list.push({ kind: 'pirateMelee', count: n(0, 0.4) });
    if (wave >= 8) list.push({ kind: 'deathtrooper', count: Math.min(((wave - 6) / 2) | 0, 2) });
    if (wave >= 9) list.push({ kind: 'darktrooper', count: 1, air: true });
    return list;
  }
  const list: WaveEntry[] = [
    { kind: 'pirate', count: n(2, 0.5) },
    { kind: 'pirateMelee', count: n(1, 0.35) },
  ];
  if (wave >= 2) list.push({ kind: 'jetpirate', count: Math.min(1 + ((wave / 2) | 0), 4), air: true });
  if (wave >= 4) list.push({ kind: 'pyke', count: n(1, 0.5) });
  if (wave >= 5) list.push({ kind: 'droid', count: Math.min(((wave - 3) / 2) | 0, 3) });
  if (wave >= 6) list.push({ kind: 'stormtrooper', count: n(1, 0.4) });
  if (wave >= 7) list.push({ kind: 'darktrooper', count: Math.min(1 + ((wave - 7) / 2) | 0, 3), air: true });
  if (wave >= 9) list.push({ kind: 'deathtrooper', count: 1 });
  return list;
}

export function spawnWave(board: Board, wave: number, players: number, near: THREE.Vector3, addEnemy: (e: Enemy) => void): number {
  const comp = waveComposition(board.kind, wave, players);
  let total = 0;
  // prefer spawn points in a mid ring around the players: close enough for pace,
  // far enough not to pop in on top of them
  const ground = [...board.groundSpawns].sort((a, b) => {
    const da = Math.abs(a.distanceTo(near) - 35);
    const db = Math.abs(b.distanceTo(near) - 35);
    return da - db;
  }).slice(0, Math.max(4, (board.groundSpawns.length * 0.6) | 0));
  let gi = wave % ground.length;
  let ai = wave % Math.max(board.airSpawns.length, 1);
  const jitter = new THREE.Vector3();
  for (const entry of comp) {
    for (let i = 0; i < entry.count; i++) {
      const base = entry.air
        ? board.airSpawns[(ai++) % board.airSpawns.length]
        : ground[(gi++) % ground.length];
      jitter.set((Math.random() - 0.5) * 4, entry.air ? 0 : 0.2, (Math.random() - 0.5) * 4);
      const e = new Enemy(entry.kind, base.clone().add(jitter));
      addEnemy(e);
      total++;
    }
  }
  return total;
}
