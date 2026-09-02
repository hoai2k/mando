import * as THREE from 'three';
import { Enemy, enemyBody, type EnemyKind } from './enemy';
import { hazardAt, killZones, type Board, type BoardId } from '../world/board';

/** Wave composition per board — grunt-heavy early, mixed later. */

/**
 * The board runs seven waves of squads. Two boss battles interleave them —
 * after wave MID_BOSS_WAVE the board's champion walks out (modes.ts
 * MID_BOSS), and clearing wave FINAL_WAVE rings in the territory's warlord
 * (modes.ts BOSS_KIND). The ramp keeps the enemies themselves as they are:
 * waves grow by adding bodies and debuting new kinds sooner, never by
 * making anyone individually harder.
 */
export const FINAL_WAVE = 7;
/** clearing this wave rings in the mid-board boss battle */
export const MID_BOSS_WAVE = 4;

/**
 * Which ally kind the covert's supply cache holds on which wave. Nobody walks
 * in on their own any more: these waves drop a glowing crate near the party
 * instead (game/allycrate.ts), and cracking it open frees a squad of this
 * kind for the rest of that wave.
 *
 * It lives beside the wave tables rather than in the match, because two other
 * things read it: the match warms an ally's model before its cache lands, and
 * the prefetcher counts allies among the models a territory will eventually
 * want. The beats bracket the boss battles: one before the champion, one
 * right after it, one for the final wave before the warlord.
 */
export const ALLY_WAVES: Record<number, EnemyKind> = { 3: 'marshal', 5: 'ig11', 7: 'fennec' };

interface WaveEntry { kind: EnemyKind; count: number; air?: boolean; }

export function waveComposition(board: BoardId, wave: number, players: number): WaveEntry[] {
  // each extra body on the team adds half a wave's worth of trouble
  const mult = 1 + (Math.max(1, players) - 1) * 0.5;
  const n = (base: number, per: number) => Math.max(1, Math.round((base + wave * per) * mult));
  const ramp = (from: number, every: number, cap: number) =>
    Math.min(1 + (((wave - from) / every) | 0), cap);
  const list: WaveEntry[] = [];
  const at = (minWave: number, kind: EnemyKind, count: number, air = false): void => {
    if (wave >= minWave && count > 0) list.push({ kind, count, air });
  };

  switch (board) {
    case 'desert':
      at(1, 'tusken', n(5, 1.0));
      at(1, 'pyke', n(2, 0.7));
      at(2, 'pirateMelee', n(1, 0.55));
      at(2, 'nikto', Math.min(1 + ((wave / 2) | 0), 3), true);
      at(4, 'droid', ramp(4, 1, 3));
      // war massiffs are an elite, not a grunt: a couple at a time, late on
      at(4, 'massiff', ramp(4, 2, 3));
      at(4, 'stormtrooper', n(1, 0.7));   // Imperial remnant arrives
      at(6, 'deathtrooper', ramp(5, 1, 3));
      at(6, 'darktrooper', 2, true);
      // the gunslinger turns up late, and alone
      at(5, 'duelist', 1);
      at(6, 'officer', 1);
      at(FINAL_WAVE, 'enforcer', 1);
      break;

    case 'station':
      at(1, 'pirate', n(5, 0.85));
      at(1, 'pirateMelee', n(2, 0.55));
      at(2, 'jetpirate', Math.min(1 + ((wave / 2) | 0), 4), true);
      at(3, 'pyke', n(1, 0.85));
      at(4, 'droid', ramp(4, 1, 3));
      at(4, 'stormtrooper', n(1, 0.7));
      at(5, 'darktrooper', ramp(5, 1, 3), true);
      at(6, 'deathtrooper', 2);
      at(6, 'duelist', 1);
      at(7, 'officer', 1);
      at(FINAL_WAVE, 'capo', 1);
      break;

    case 'nevarro':
      // pirates hold the flats; the remnant garrison walks out of the gate late
      at(1, 'pirate', n(4, 0.85));
      at(1, 'pirateMelee', n(2, 0.7));
      at(2, 'flametrooper', ramp(2, 2, 3));
      at(2, 'stormtrooper', n(1, 0.85));
      at(3, 'jetpirate', Math.min(1 + ((wave / 2) | 0), 3), true);
      at(4, 'droid', ramp(3, 1, 3));
      at(4, 'massiff', ramp(4, 2, 2));
      at(5, 'deathtrooper', ramp(5, 1, 3));
      at(6, 'duelist', 1);
      at(6, 'darktrooper', 2, true);
      at(FINAL_WAVE, 'officer', 1);
      break;

    case 'crevasse':
      // the spiders own the ice; the Pykes are just passing through, poor souls
      at(1, 'krykna', n(5, 1.3));
      at(1, 'pyke', n(2, 0.55));
      at(2, 'stormtrooper', n(1, 0.7));
      at(3, 'krykna', ramp(3, 1, 4)); // second nest opens
      at(4, 'droid', ramp(4, 2, 2));
      at(4, 'deathtrooper', ramp(4, 2, 2));
      at(5, 'darktrooper', ramp(5, 2, 2), true);
      at(6, 'duelist', 1);
      at(FINAL_WAVE, 'broodmother', 1);
      break;

    case 'trask':
      at(1, 'quarren', n(3, 0.85));
      at(1, 'pirate', n(3, 0.7));
      at(2, 'pirateMelee', n(1, 0.7));
      at(2, 'jetpirate', Math.min(1 + ((wave / 2) | 0), 3), true);
      at(3, 'pyke', n(1, 0.7));
      at(4, 'droid', ramp(4, 2, 2));
      at(4, 'stormtrooper', n(1, 0.7)); // the freighter was never carrying fish
      at(5, 'deathtrooper', ramp(5, 2, 2));
      at(6, 'duelist', 1);
      at(6, 'darktrooper', 2, true);
      at(FINAL_WAVE, 'capo', 1);
      break;

    case 'refinery':
      at(1, 'stormtrooper', n(5, 1.15));
      at(1, 'droid', n(1, 0.4));
      at(2, 'flametrooper', ramp(2, 1, 4)); // corridors are their country
      at(3, 'deathtrooper', ramp(3, 1, 3));
      at(4, 'darktrooper', ramp(4, 1, 3), true);
      at(5, 'duelist', 1);
      at(6, 'officer', 1);
      at(FINAL_WAVE, 'officer', 1);
      break;

    case 'forge':
      at(1, 'alamite', n(5, 1.3));
      at(2, 'drone', Math.min(1 + ((wave / 2) | 0), 4), true);
      at(2, 'stormtrooper', n(1, 0.85));
      at(4, 'deathtrooper', ramp(4, 1, 3));
      at(4, 'droid', ramp(4, 2, 2));
      at(5, 'darktrooper', ramp(5, 1, 3), true);
      at(6, 'duelist', 1);
      at(FINAL_WAVE, 'officer', 1);
      at(FINAL_WAVE, 'enforcer', 1);
      break;

    case 'narkina':
      // a prison garrison: troopers and droids in numbers, elites late
      at(1, 'stormtrooper', n(5, 1.15));
      at(1, 'droid', n(1, 0.55));
      at(2, 'deathtrooper', ramp(2, 1, 3));
      at(3, 'darktrooper', ramp(3, 1, 3), true);
      at(4, 'flametrooper', ramp(4, 2, 2));
      at(5, 'duelist', 1);
      at(6, 'officer', 1);
      at(FINAL_WAVE, 'officer', 1);
      break;

    case 'ringworld':
      at(1, 'pirate', n(4, 0.85));
      at(1, 'pirateMelee', n(2, 0.55));
      at(2, 'ringEnforcer', ramp(2, 2, 3));
      at(2, 'pyke', n(1, 0.7));
      at(3, 'jetpirate', Math.min(1 + ((wave / 2) | 0), 3), true);
      at(4, 'droid', ramp(4, 1, 3));
      at(4, 'duelist', 1); // assassin country
      at(5, 'deathtrooper', ramp(5, 2, 2));
      at(6, 'darktrooper', 2, true);
      at(FINAL_WAVE, 'duelist', 2);
      at(FINAL_WAVE, 'ringEnforcer', 2);
      break;
  }
  return list;
}

const _probe = new THREE.Vector3();

/** the body used to judge a squad's post, before the kinds standing on it are known */
const POST_BODY = { radius: 0.6, height: 2.1 };

/**
 * Room for a capsule is necessary but not sufficient: a spot also has to be
 * somewhere the game can be played from. Three failure modes all passed the
 * bare capsule test and all produced the "enemy in a wall / nowhere reachable"
 * reports — a ring sample landing in empty air past a platform edge (free by
 * definition: there is nothing there, including a floor), one landing in a
 * burn pool or a kill zone, and one landing on ground metres below the post it
 * was displaced from (the far side of a wall, reached by sampling *through*
 * it). So a candidate must also have real ground under its feet, close enough
 * beneath to be the ground it was aimed at, and no hazard cooking it.
 */
function standable(board: Board, x: number, y: number, z: number, body: { radius: number; height: number }): boolean {
  if (!board.physics.capsuleFree(x, y, z, body.radius, body.height)) return false;
  const g = board.physics.groundHeight(x, z, y + 0.4);
  if (!isFinite(g) || y - g > 3) return false;
  const hz = hazardAt(board, _probe.set(x, y, z));
  return !hz.kill && hz.dps <= 0;
}

/**
 * Find somewhere a body of this size actually fits, at or near `p`.
 *
 * Several boards place posts on coordinates that are also a prop's centre —
 * the Ringworld's plaza kiosks are the clearest case — and the jitter that
 * spreads a squad out can drop a body into the wall beside its post. The test
 * is `standable` above: what the mover asks (`capsuleFree`), plus ground and
 * hazards. Returns null when nothing within reach passes, so the caller can
 * fall back to ground the board itself vouches for.
 */
function freeSpot(board: Board, p: THREE.Vector3, body: { radius: number; height: number }): THREE.Vector3 | null {
  const phys = board.physics;
  if (standable(board, p.x, p.y, p.z, body)) return p;
  // out to ~14 m: a body can start well inside a cluster of colliders (the
  // barge's hull cylinders, a stack of crates, a refinery hall) and a short
  // search never clears it. Rings get denser as they widen, so a corridor
  // board's one open bearing is not missed for want of samples.
  for (let ring = 1; ring <= 6; ring++) {
    const r = ring * 2.3;
    const steps = 8 + ring * 4;
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2 + ring;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      const y = phys.heightAt ? phys.heightAt(x, z) + 0.3 : p.y;
      if (!isFinite(y)) continue;
      if (standable(board, x, y, z, body)) return new THREE.Vector3(x, y, z);
    }
  }
  return null;
}

/**
 * Somewhere a flier of this size fits, at or near `p`. Same idea as
 * `freeSpot`, but altitude is the flier's own business: the ring is searched
 * at the height asked for, then a little above it, rather than being dropped
 * onto the ground.
 */
function freeAir(board: Board, p: THREE.Vector3, body: { radius: number; height: number }): THREE.Vector3 | null {
  const phys = board.physics;
  for (const lift of [0, 3, 7, 12]) {
    const y = p.y + lift;
    if (phys.capsuleFree(p.x, y, p.z, body.radius, body.height)) return new THREE.Vector3(p.x, y, p.z);
    for (let ring = 1; ring <= 3; ring++) {
      const r = ring * 3;
      const steps = 8 + ring * 4;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2 + ring;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (phys.capsuleFree(x, y, z, body.radius, body.height)) return new THREE.Vector3(x, y, z);
      }
    }
  }
  return null;
}

/**
 * The last word on where a body goes: the spot it wanted, else anywhere near
 * it, else the first of `fallbacks` (its squad's post, then the board's own
 * authored spawn points) that a body this size fits in.
 *
 * The board's spawn points are the level designer's own ground, so the chain
 * runs out of options only on a board with nowhere at all to stand — hence the
 * spawn audit (`tools/audit-spawns.mjs`), which fails a build where any of
 * this ends up inside geometry.
 */
function placeBody(
  board: Board,
  wanted: THREE.Vector3,
  body: { radius: number; height: number },
  air: boolean,
  fallbacks: THREE.Vector3[],
): THREE.Vector3 {
  const find = air ? freeAir : freeSpot;
  const spot = find(board, wanted, body);
  if (spot) return spot;
  for (const f of fallbacks) {
    if (board.physics.capsuleFree(f.x, f.y, f.z, body.radius, body.height)) return f.clone();
    const near = find(board, f.clone(), body);
    if (near) return near;
  }
  // Nothing anywhere fits — a board bug, but the choice of failure matters:
  // returning `wanted` put the body inside whatever scenery `wanted` named,
  // and the push-out threw it somewhere nobody chose (this was the last way a
  // spawn could still end up in a wall). Authored ground is where the level
  // designer said a body can stand; even crowded, it beats a wall.
  return (fallbacks[fallbacks.length - 1] ?? wanted).clone();
}

/** how far apart posted enemies in one squad stand */
const SQUAD_SPREAD = 7;
/** don't post a squad closer than this to a player — they should be found, not handed over */
const MIN_PLAYER_DIST = 55;
/**
 * The garrison of wave one posts closer. At 55 m the board opened on nine
 * chevrons at the radar's rim and nothing in sight, and the first fight was
 * a walk (audit U8/L8); the reinforcement waves keep the full distance.
 */
const FIRST_WAVE_DIST = 35;

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
 * Somewhere a body of `kind` can stand, at or near `pos`.
 *
 * The mid-wave spawns go through here for the same reason the wave itself
 * does: a broodmother's hatchling, dropped two metres from her on a random
 * bearing, lands in the ice wall she happens to be backed against about as
 * often as the geometry allows.
 */
export function standingSpot(board: Board, pos: THREE.Vector3, kind: EnemyKind): THREE.Vector3 {
  return placeBody(board, pos.clone(), enemyBody(kind), false, board.groundSpawns);
}

/**
 * Somewhere a body of `kind` can stand 30–40 m out from `from`, inside the
 * ±60° arc of the camera yaw `yaw` — where a boss battle posts its warlord.
 *
 * `farPost` put both bosses at the authored spawn farthest from player one,
 * often a hundred metres off, so the slow-motion reveal panned onto a dot on
 * the horizon and the player walked for a minute to find it (audit B10). A
 * ring of bearings across the arc is tried first, nearest the centre line
 * first; failing that (islands, water, a wall) the board's own posts inside
 * the arc; null when nothing in view will do, so the caller can fall back.
 */
export function postInView(board: Board, from: THREE.Vector3, yaw: number, kind: EnemyKind): THREE.Vector3 | null {
  const body = enemyBody(kind);
  const phys = board.physics;
  let extent = 0;
  for (const p of board.groundSpawns) extent = Math.max(extent, Math.hypot(p.x, p.z));
  extent += 12;
  const ok = (x: number, y: number, z: number): boolean =>
    isFinite(y) && Math.hypot(x, z) <= extent
    && !(board.waterY !== undefined && y < board.waterY + 0.3)
    && standable(board, x, y, z, body);
  for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
    for (const dist of [35, 31, 39]) {
      const a = yaw + off;
      const x = from.x + Math.sin(a) * dist;
      const z = from.z + Math.cos(a) * dist;
      // ground under the spot: the heightfield where there is one, else the
      // highest deck at or below the player's own level (the station)
      const y = phys.heightAt ? phys.heightAt(x, z) + 0.3 : phys.groundHeight(x, z, from.y + 4) + 0.3;
      if (ok(x, y, z)) return new THREE.Vector3(x, y, z);
    }
  }
  // the board's own posts, inside the arc and within reach
  let best: THREE.Vector3 | null = null;
  let bestScore = Infinity;
  for (const p of board.groundSpawns) {
    const d = Math.hypot(p.x - from.x, p.z - from.z);
    if (d < 22 || d > 55) continue;
    let da = Math.atan2(p.x - from.x, p.z - from.z) - yaw;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) > Math.PI / 3) continue;
    const spot = freeSpot(board, p.clone(), body);
    if (!spot) continue;
    const score = Math.abs(d - 35) + Math.abs(da) * 10;
    if (score < bestScore) { bestScore = score; best = spot; }
  }
  return best;
}

/** One planned body: where it goes and which squad it belongs to. */
export interface Placement {
  kind: EnemyKind;
  pos: THREE.Vector3;
  squad: number;
  squadSize: number;
  /** placed at an air post — a flier, which arrives flying rather than dropped */
  air?: boolean;
}

/**
 * Work out where a wave stands, without building anything.
 *
 * Enemies are not funnelled toward the player any more: each squad takes a
 * spawn point somewhere on the map — the far side included — and holds it
 * until something alerts them. Clearing a wave means going and finding them,
 * which is what the radar and the remaining-hostiles count are for.
 *
 * Split out from `spawnWave` so the spawn audit can check a hundred waves per
 * board without building a hundred waves of character meshes.
 */
export function planWave(board: Board, wave: number, players: number, near: THREE.Vector3): Placement[] {
  const comp = waveComposition(board.kind, wave, players);

  // Posts must be away from the players — hostiles should be found, not handed
  // over — and away from *each other*, or every squad ends up in the same
  // corner and the board plays as one big fight again.
  const rank = (v: THREE.Vector3) => v.distanceTo(near);
  const minDist = wave <= 1 ? FIRST_WAVE_DIST : MIN_PLAYER_DIST;
  const ground = board.groundSpawns.filter((v) => rank(v) > minDist);
  const pool = (ground.length >= 3 ? ground : board.groundSpawns).slice();
  // Authored ground, in the order the board lists it: the last resort for a
  // body that fits nowhere near where it was sent.
  const authored = board.groundSpawns.map((v) => v.clone());
  const posts = disperse(pool, wave).map((p) => placeBody(board, p.clone(), POST_BODY, false, authored));
  const air = disperse(board.airSpawns.slice(), wave);

  // Late waves field more squads than the board has posts. On solid ground the
  // extra laps are placed on a ring around a reused post so they still hold
  // their own patch of desert; the station has no ground between platforms, so
  // there the post is reused as-is and only the per-enemy jitter separates them.
  const groundY = board.physics.heightAt;
  const deadly = killZones(board);

  /**
   * Is this somewhere a squad can actually stand and be fought?
   *
   * A ring position is a guess, and on several boards the guess lands
   * somewhere the wave can never be resolved from: outside a sealed board's
   * walls (an enclosed refinery whose kill plane is unreachable, so the
   * hostiles behind the wall are alive and unkillable forever), in water or
   * lava that drowns or cooks the squad before the player ever sees it, or
   * inside a prop, from which the physics ejects it somewhere nobody chose.
   * `extent` is the board's own authored reach — the outermost post the level
   * designer picked — so nothing is posted meaningfully beyond the level.
   */
  const valid = (x: number, y: number, z: number, extent: number): boolean => {
    if (!isFinite(y)) return false;
    if (Math.hypot(x, z) > extent) return false;
    if (!board.physics.capsuleFree(x, y, z, POST_BODY.radius, POST_BODY.height)) return false;
    // The sea is not a hazard zone, so it has to be asked about by name: the
    // Prison Rig's heightAt is the sea bed, and a ring point over open water
    // stood a squad 8-22 m under it — dropped in by carrier, drowned offscreen
    // to a run of kill chimes nobody earned. Trask's version stood them
    // chest-deep in the harbour.
    if (board.waterY !== undefined && y < board.waterY + 0.3) return false;
    const hz = hazardAt(board, _probe.set(x, y, z));
    return !hz.kill && hz.dps <= 0;
  };

  // the level's own reach, plus a little slack for the ring to breathe in
  let extent = 0;
  for (const p of board.groundSpawns) extent = Math.max(extent, Math.hypot(p.x, p.z));
  extent += 12;

  // The 35 m rule is only a filter on the authored posts, and on most boards
  // the nearest of those is 75 m from the start — so the opening was still a
  // walk. Wave one's first squad is placed for real: a validated ring point
  // 34-40 m from the party, on the bearing of the nearest authored post so
  // the fight sits between the party and the rest of the garrison.
  if (wave <= 1 && groundY && posts.length && rank(posts[0]) > 45) {
    const nearest = board.groundSpawns.reduce((a, b) => (rank(b) < rank(a) ? b : a), board.groundSpawns[0]);
    const base = Math.atan2(nearest.x - near.x, nearest.z - near.z);
    outer: for (const r of [36, 40, 32]) {
      for (const off of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2, Math.PI]) {
        const x = near.x + Math.sin(base + off) * r;
        const z = near.z + Math.cos(base + off) * r;
        const y = groundY(x, z) + 0.3;
        if (Math.abs(y - near.y) > 12) continue;   // a cliff or a chasm away
        if (valid(x, y, z, extent)) { posts[0] = new THREE.Vector3(x, y, z); break outer; }
      }
    }
  }

  const post = (i: number): THREE.Vector3 => {
    const base = posts[i % posts.length];
    const lap = Math.floor(i / posts.length);
    if (lap === 0 || !groundY) return base.clone();
    const r = 16 + lap * 9;
    // Try the golden-angle bearing first, then walk around the circle: the
    // point is to spread squads out, and any bearing that stands up does that.
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = i * 2.399 + attempt * (Math.PI / 4);
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
      const y = groundY(x, z) + 0.3;
      if (valid(x, y, z, extent)) return new THREE.Vector3(x, y, z);
    }
    // nowhere on the ring works: reuse the post itself, which is known good
    return base.clone();
  };
  const airPost = (i: number) => air[i % air.length].clone();

  const out: Placement[] = [];
  let gi = 0, ai = 0;
  const jitter = new THREE.Vector3();
  for (const entry of comp) {
    const body = enemyBody(entry.kind);
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
        // Every body is placed for its own size: the post was judged against a
        // nominal one, and a massiff or a broodmother needs a metre more room
        // than the trooper the post was cleared for.
        const wanted = base.clone().add(jitter);
        const fallbacks = entry.air ? [base] : [base, ...authored];
        out.push({ kind: entry.kind, pos: placeBody(board, wanted, body, !!entry.air, fallbacks), squad, squadSize: size, air: !!entry.air });
      }
    }
  }
  return out;
}

/** Post the wave around the board, building an enemy per planned placement. */
export function spawnWave(board: Board, wave: number, players: number, near: THREE.Vector3, addEnemy: (e: Enemy) => void): number {
  const plan = planWave(board, wave, players, near);
  for (const p of plan) {
    const e = new Enemy(p.kind, p.pos);
    e.squad = p.squad;
    e.squadSize = p.squadSize;
    addEnemy(e);
  }
  return plan.length;
}
