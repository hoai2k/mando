import * as THREE from 'three';
import { Enemy, type EnemyKind } from './enemy';
import { killZones, type Board, type BoardId } from '../world/board';

/** Wave composition per board — grunt-heavy early, mixed later. */

export const FINAL_WAVE = 10;

interface WaveEntry { kind: EnemyKind; count: number; air?: boolean; }

export function waveComposition(board: BoardId, wave: number, players: number): WaveEntry[] {
  const mult = players === 2 ? 1.5 : 1;
  const n = (base: number, per: number) => Math.max(1, Math.round((base + wave * per) * mult));
  const ramp = (from: number, every: number, cap: number) =>
    Math.min(1 + (((wave - from) / every) | 0), cap);
  const list: WaveEntry[] = [];
  const at = (minWave: number, kind: EnemyKind, count: number, air = false): void => {
    if (wave >= minWave && count > 0) list.push({ kind, count, air });
  };

  switch (board) {
    case 'desert':
      at(1, 'tusken', n(5, 0.7));
      at(1, 'pyke', n(2, 0.5));
      at(2, 'pirateMelee', n(1, 0.4));
      at(3, 'nikto', Math.min(1 + ((wave / 3) | 0), 3), true);
      at(5, 'droid', ramp(3, 2, 3));
      // war massiffs are an elite, not a grunt: a couple at a time, late on
      at(5, 'massiff', ramp(5, 2, 3));
      at(6, 'stormtrooper', n(1, 0.5));   // Imperial remnant arrives
      at(8, 'deathtrooper', ramp(6, 2, 3));
      at(9, 'darktrooper', 2, true);
      // the gunslinger turns up late, and alone
      at(7, 'duelist', 1);
      at(9, 'officer', 1);
      at(FINAL_WAVE, 'enforcer', 1);
      break;

    case 'station':
      at(1, 'pirate', n(5, 0.6));
      at(1, 'pirateMelee', n(2, 0.4));
      at(2, 'jetpirate', Math.min(1 + ((wave / 2) | 0), 4), true);
      at(4, 'pyke', n(1, 0.6));
      at(5, 'droid', ramp(3, 2, 3));
      at(6, 'stormtrooper', n(1, 0.5));
      at(7, 'darktrooper', ramp(7, 2, 3), true);
      at(9, 'deathtrooper', 2);
      at(8, 'duelist', 1);
      at(10, 'officer', 1);
      at(FINAL_WAVE, 'capo', 1);
      break;

    case 'nevarro':
      // pirates hold the flats; the remnant garrison walks out of the gate late
      at(1, 'pirate', n(4, 0.6));
      at(1, 'pirateMelee', n(2, 0.5));
      at(2, 'flametrooper', ramp(2, 3, 3));
      at(3, 'stormtrooper', n(1, 0.6));
      at(4, 'jetpirate', Math.min(1 + ((wave / 3) | 0), 3), true);
      at(5, 'droid', ramp(4, 2, 3));
      at(6, 'massiff', ramp(6, 2, 2));
      at(7, 'deathtrooper', ramp(7, 2, 3));
      at(8, 'duelist', 1);
      at(9, 'darktrooper', 2, true);
      at(FINAL_WAVE, 'officer', 1);
      break;

    case 'crevasse':
      // the spiders own the ice; the Pykes are just passing through, poor souls
      at(1, 'krykna', n(5, 0.9));
      at(1, 'pyke', n(2, 0.4));
      at(3, 'stormtrooper', n(1, 0.5));
      at(4, 'krykna', ramp(4, 1, 4)); // second nest opens
      at(5, 'droid', ramp(5, 2, 2));
      at(6, 'deathtrooper', ramp(6, 2, 2));
      at(7, 'darktrooper', ramp(7, 2, 2), true);
      at(8, 'duelist', 1);
      at(FINAL_WAVE, 'broodmother', 1);
      break;

    case 'trask':
      at(1, 'quarren', n(3, 0.6));
      at(1, 'pirate', n(3, 0.5));
      at(2, 'pirateMelee', n(1, 0.5));
      at(3, 'jetpirate', Math.min(1 + ((wave / 3) | 0), 3), true);
      at(4, 'pyke', n(1, 0.5));
      at(5, 'droid', ramp(5, 2, 2));
      at(6, 'stormtrooper', n(1, 0.5)); // the freighter was never carrying fish
      at(7, 'deathtrooper', ramp(7, 2, 2));
      at(8, 'duelist', 1);
      at(9, 'darktrooper', 2, true);
      at(FINAL_WAVE, 'capo', 1);
      break;

    case 'refinery':
      at(1, 'stormtrooper', n(5, 0.8));
      at(1, 'droid', n(1, 0.3));
      at(2, 'flametrooper', ramp(2, 2, 4)); // corridors are their country
      at(4, 'deathtrooper', ramp(4, 2, 3));
      at(5, 'darktrooper', ramp(5, 2, 3), true);
      at(7, 'duelist', 1);
      at(9, 'officer', 1);
      at(FINAL_WAVE, 'officer', 1);
      break;

    case 'forge':
      at(1, 'alamite', n(5, 0.9));
      at(2, 'drone', Math.min(1 + ((wave / 2) | 0), 4), true);
      at(3, 'stormtrooper', n(1, 0.6));
      at(5, 'deathtrooper', ramp(5, 2, 3));
      at(6, 'droid', ramp(6, 2, 2));
      at(7, 'darktrooper', ramp(7, 2, 3), true);
      at(8, 'duelist', 1);
      at(FINAL_WAVE, 'officer', 1);
      at(FINAL_WAVE, 'enforcer', 1);
      break;

    case 'ringworld':
      at(1, 'pirate', n(4, 0.6));
      at(1, 'pirateMelee', n(2, 0.4));
      at(2, 'ringEnforcer', ramp(2, 3, 3));
      at(3, 'pyke', n(1, 0.5));
      at(4, 'jetpirate', Math.min(1 + ((wave / 3) | 0), 3), true);
      at(5, 'droid', ramp(5, 2, 3));
      at(6, 'duelist', 1); // assassin country
      at(7, 'deathtrooper', ramp(7, 2, 2));
      at(9, 'darktrooper', 2, true);
      at(FINAL_WAVE, 'duelist', 2);
      at(FINAL_WAVE, 'ringEnforcer', 2);
      break;
  }
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
  const deadly = killZones(board);
  const post = (i: number): THREE.Vector3 => {
    const base = posts[i % posts.length];
    const lap = Math.floor(i / posts.length);
    if (lap === 0 || !groundY) return base.clone();
    const a = i * 2.399; // golden angle: successive laps don't line up
    const r = 16 + lap * 9;
    let x = base.x + Math.cos(a) * r;
    let z = base.z + Math.sin(a) * r;
    for (const hazard of deadly) {
      // never post a squad standing in the sarlacc (or any of its cousins)
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
        e.squadSize = size;
        addEnemy(e);
        total++;
      }
    }
  }
  return total;
}
