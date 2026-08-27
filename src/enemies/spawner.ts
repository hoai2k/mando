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
      { kind: 'tusken', count: n(5, 0.7) },
      { kind: 'pyke', count: n(2, 0.5) },
    ];
    if (wave >= 2) list.push({ kind: 'pirateMelee', count: n(1, 0.4) });
    if (wave >= 3) list.push({ kind: 'nikto', count: Math.min(1 + ((wave / 3) | 0), 3), air: true });
    if (wave >= 5) list.push({ kind: 'droid', count: Math.min(1 + (((wave - 3) / 2) | 0), 3) });
    if (wave >= 6) list.push({ kind: 'stormtrooper', count: n(1, 0.5) });     // Imperial remnant arrives
    if (wave >= 8) list.push({ kind: 'deathtrooper', count: Math.min(1 + (((wave - 6) / 2) | 0), 3) });
    if (wave >= 9) list.push({ kind: 'darktrooper', count: 2, air: true });
    return list;
  }
  const list: WaveEntry[] = [
    { kind: 'pirate', count: n(5, 0.6) },
    { kind: 'pirateMelee', count: n(2, 0.4) },
  ];
  if (wave >= 2) list.push({ kind: 'jetpirate', count: Math.min(1 + ((wave / 2) | 0), 4), air: true });
  if (wave >= 4) list.push({ kind: 'pyke', count: n(1, 0.6) });
  if (wave >= 5) list.push({ kind: 'droid', count: Math.min(1 + (((wave - 3) / 2) | 0), 3) });
  if (wave >= 6) list.push({ kind: 'stormtrooper', count: n(1, 0.5) });
  if (wave >= 7) list.push({ kind: 'darktrooper', count: Math.min(1 + (((wave - 7) / 2) | 0), 3), air: true });
  if (wave >= 9) list.push({ kind: 'deathtrooper', count: 2 });
  return list;
}

/** how far apart posted enemies in one squad stand */
const SQUAD_SPREAD = 7;
/** don't post a squad closer than this to a player — they should be found, not handed over */
const MIN_PLAYER_DIST = 55;

let nextSquad = 1;

/**
 * Order posts so that each one is as far as possible from the ones already
 * taken (farthest-point sampling), starting from a different post each wave.
 * Squads then land spread over the whole board instead of bunching up.
 */
function disperse(pool: THREE.Vector3[], wave: number): THREE.Vector3[] {
  if (pool.length <= 1) return pool;
  const left = pool.slice();
  const out: THREE.Vector3[] = [left.splice(wave % left.length, 1)[0]];
  while (left.length) {
    let bestI = 0;
    let bestD = -1;
    for (let i = 0; i < left.length; i++) {
      let nearest = Infinity;
      for (const chosen of out) nearest = Math.min(nearest, left[i].distanceToSquared(chosen));
      if (nearest > bestD) { bestD = nearest; bestI = i; }
    }
    out.push(left.splice(bestI, 1)[0]);
  }
  return out;
}

/**
 * Post the wave around the board in squads.
 *
 * Enemies are not funnelled toward the player any more: each squad takes a
 * spawn point somewhere on the map — the far side included — and holds it
 * until something alerts them. Clearing a wave means going and finding them,
 * which is what the radar and the remaining-hostiles count are for.
 */
export function spawnWave(board: Board, wave: number, players: number, near: THREE.Vector3, addEnemy: (e: Enemy) => void): number {
  const comp = waveComposition(board.kind, wave, players);

  // Posts must be away from the players — hostiles should be found, not handed
  // over — and away from *each other*, or every squad ends up in the same
  // corner and the board plays as one big fight again.
  const rank = (v: THREE.Vector3) => v.distanceTo(near);
  const ground = board.groundSpawns.filter((v) => rank(v) > MIN_PLAYER_DIST);
  const pool = (ground.length >= 3 ? ground : board.groundSpawns).slice();
  const posts = disperse(pool, wave);
  const air = disperse(board.airSpawns.slice(), wave);

  // Late waves field more squads than the board has posts. On solid ground the
  // extra laps are placed on a ring around a reused post so they still hold
  // their own patch of desert; the station has no ground between platforms, so
  // there the post is reused as-is and only the per-enemy jitter separates them.
  const groundY = board.physics.heightAt;
  const hazard = board.hazard;
  const post = (i: number): THREE.Vector3 => {
    const base = posts[i % posts.length];
    const lap = Math.floor(i / posts.length);
    if (lap === 0 || !groundY) return base.clone();
    const a = i * 2.399; // golden angle: successive laps don't line up
    const r = 16 + lap * 9;
    let x = base.x + Math.cos(a) * r;
    let z = base.z + Math.sin(a) * r;
    if (hazard) {
      // never post a squad standing in the sarlacc
      const hd = Math.hypot(x - hazard.center.x, z - hazard.center.z);
      const keep = hazard.radius + 6;
      if (hd < keep && hd > 1e-3) {
        x = hazard.center.x + ((x - hazard.center.x) / hd) * keep;
        z = hazard.center.z + ((z - hazard.center.z) / hd) * keep;
      }
    }
    return new THREE.Vector3(x, groundY(x, z) + 0.3, z);
  };
  const airPost = (i: number) => air[i % air.length].clone();

  let total = 0;
  let gi = 0, ai = 0;
  const jitter = new THREE.Vector3();
  for (const entry of comp) {
    // break each kind into squads of 2–4 rather than one blob
    let left = entry.count;
    while (left > 0) {
      const size = Math.min(left, 2 + ((Math.random() * 3) | 0));
      left -= size;
      const squad = nextSquad++;
      const base = entry.air ? airPost(ai++) : post(gi++);
      for (let i = 0; i < size; i++) {
        jitter.set(
          (Math.random() - 0.5) * SQUAD_SPREAD,
          entry.air ? (Math.random() - 0.5) * 4 : 0.2,
          (Math.random() - 0.5) * SQUAD_SPREAD
        );
        const e = new Enemy(entry.kind, base.clone().add(jitter));
        e.squad = squad;
        addEnemy(e);
        total++;
      }
    }
  }
  return total;
}
