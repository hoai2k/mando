import * as THREE from 'three';
import { audio } from '../core/audio';
import { authoredCached, loadProp } from '../characters/authored';
import type { Board, BoardId } from '../world/board';
import type { EnemyKind } from './enemy';

/**
 * How a wave gets onto the board (waves 2+; the first wave is the garrison
 * that was already standing there).
 *
 * Nothing simply appears any more: a squad is dropped by a carrier streaking
 * over its post, or it swims up from the open sea, flies in over the edge, or
 * runs in from the surrounding country. Besides looking like an invasion
 * instead of a spawn, this closes the placement question for good — a body
 * that descends from the open sky onto a validated post, or walks in from the
 * edge, cannot start inside a wall.
 *
 *  - `drop`  — released from a carrier pass; most members fall fast, some ride
 *              a parachute down (slower, shootable, and shooting back).
 *  - `run`   — enters at the board edge on foot and closes on its post.
 *  - `fly`   — an air squad crosses the edge at altitude and takes its post.
 *  - `swim`  — surfaces from the sea beyond the platforms and hauls out.
 *  - `post`  — the old instant placement; the fallback when a board can offer
 *              none of the above for this squad (a roofed post with no
 *              walkable edge), so a wave can never fail to arrive.
 */
export type ArrivalMode = 'drop' | 'run' | 'fly' | 'swim' | 'post';

export interface SquadArrival {
  mode: ArrivalMode;
  /** where the members of an edge squad enter (per-member jitter on top) */
  from: THREE.Vector3 | null;
}

/** kinds that arrive out of the water when the board has any */
const SWIMMERS = new Set<EnemyKind>(['quarren']);
/** locals and beasts, who come in overland rather than by transport */
const RUNNERS = new Set<EnemyKind>(['tusken', 'massiff', 'alamite', 'krykna', 'pirateMelee']);

/** how high over the post a carrier flies, and releases */
export const DROP_HEIGHT = 38;

/**
 * Which transport drops troops on which territory: Imperial garrisons fly the
 * boxy `troop_carrier`, the outlaw boards a scabbed-together `raider_dropship`.
 * Both are requested assets (docs/ASSETS_MODELS.md); until a file lands the
 * pass flies as a jet blur, and once it is cached it slows to a real flyby —
 * the file arriving is the whole integration.
 */
const RAIDER_BOARDS = new Set<BoardId>(['station', 'trask', 'ringworld', 'forge']);
export function carrierShipId(board: BoardId): string {
  return RAIDER_BOARDS.has(board) ? 'raider_dropship' : 'troop_carrier';
}

const _down = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();

/** the level's authored reach — beyond this is the surrounding country */
function boardExtent(board: Board): number {
  let extent = 0;
  for (const p of board.groundSpawns) extent = Math.max(extent, Math.hypot(p.x, p.z));
  return extent;
}

/** a point on the board's edge, on the bearing from the centre through `target` */
function edgePoint(target: THREE.Vector3, extent: number, slack: number): THREE.Vector3 {
  const len = Math.hypot(target.x, target.z) || 1;
  const r = extent + slack;
  return new THREE.Vector3((target.x / len) * r, target.y, (target.z / len) * r);
}

/** nothing between the open sky and the post — a drop can actually reach it */
function dropClear(board: Board, target: THREE.Vector3): boolean {
  _o.set(target.x, target.y + DROP_HEIGHT, target.z);
  const hit = board.physics.raycast(_o, _down, DROP_HEIGHT - 2.5);
  return !hit;
}

/**
 * Pick how one squad arrives, and where from.
 *
 * The choice is flavour first, feasibility second: quarren surface from the
 * sea on any board that has one, the boards' own locals and beasts come in
 * overland where the terrain runs to the edge, air squads always fly in, and
 * everyone else rides a carrier — unless the post has a roof over it, in
 * which case the squad walks in instead, or failing even that, stands up in
 * place exactly as waves always used to.
 */
export function squadArrival(board: Board, kind: EnemyKind, air: boolean, target: THREE.Vector3): SquadArrival {
  const extent = boardExtent(board);
  if (air) {
    const from = edgePoint(target, extent, 22);
    from.y = target.y + 12;
    return { mode: 'fly', from };
  }
  if (board.waterY !== undefined && SWIMMERS.has(kind)) {
    const from = edgePoint(target, extent, 14);
    from.y = board.waterY - 0.45;
    return { mode: 'swim', from };
  }
  const runFrom = (): THREE.Vector3 | null => {
    if (!board.physics.heightAt) return null;
    const from = edgePoint(target, extent, 14);
    from.y = board.physics.heightAt(from.x, from.z) + 0.3;
    // a cliff or a sea between the edge and the post is not a road
    if (!isFinite(from.y) || Math.abs(from.y - target.y) > 14) return null;
    if (board.waterY !== undefined && from.y < board.waterY + 0.3) return null;
    return from;
  };
  if (RUNNERS.has(kind)) {
    const from = runFrom();
    if (from) return { mode: 'run', from };
  }
  if (dropClear(board, target)) return { mode: 'drop', from: null };
  const from = runFrom();
  if (from) return { mode: 'run', from };
  return { mode: 'post', from: null };
}

/**
 * A troop carrier pass: a jet blur that streaks over the drop point, lets the
 * squad go as it crosses it, and runs off the far side of the sky.
 *
 * Deliberately a blur rather than a ship — at 85 m/s and forty metres up, a
 * hull is a dark shape and a light streak, and that is exactly what is built:
 * a stretched hull, two engine glows, and a pair of crossed additive streak
 * planes doing the work a motion-blur pass would.
 */
export class Carrier {
  group = new THREE.Group();
  private t = 0;
  private delay: number;
  private released = false;
  private start = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private dropT: number;
  private life: number;
  private owned: Array<{ dispose(): void }> = [];

  constructor(drop: THREE.Vector3, delay: number, shipId: string, private onRelease: (at: THREE.Vector3, along: THREE.Vector3) => void) {
    const a = Math.random() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    // with a real hull in hand the ship earns a slower, watchable pass;
    // without one it stays a streak the eye reads as speed instead of shape
    const modeled = authoredCached(shipId);
    const SPEED = modeled ? 46 : 85;
    const LEAD = modeled ? 170 : 280;
    const TAIL = modeled ? 220 : 320;
    this.start.copy(drop).addScaledVector(dir, -LEAD);
    this.start.y = drop.y + DROP_HEIGHT;
    this.vel.copy(dir).multiplyScalar(SPEED);
    this.dropT = LEAD / SPEED;
    this.life = (LEAD + TAIL) / SPEED;
    this.delay = delay;

    const keep = <T extends { dispose(): void }>(r: T): T => { this.owned.push(r); return r; };
    const hullMat = keep(new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.55, metalness: 0.6 }));
    const hull = new THREE.Mesh(keep(new THREE.BoxGeometry(2.6, 1.2, 12)), hullMat);
    this.group.add(hull);
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(keep(new THREE.BoxGeometry(3.4, 0.18, 2.2)), hullMat);
      wing.position.set(sx * 2.6, 0.1, -2.4);
      wing.rotation.z = sx * -0.18;
      this.group.add(wing);
      const glow = new THREE.Mesh(
        keep(new THREE.SphereGeometry(0.42, 8, 6)),
        keep(new THREE.MeshBasicMaterial({ color: 0x8fd0ff })),
      );
      glow.position.set(sx * 0.9, 0, -6.2);
      this.group.add(glow);
    }
    // the blur: long faint streaks trailing the hull, crossed so they read
    // from every camera angle
    const streakGeo = keep(new THREE.PlaneGeometry(1.9, 34));
    const streakMat = keep(new THREE.MeshBasicMaterial({
      color: 0x9fc8ff, transparent: true, opacity: 0.28, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    for (const roll of [0, Math.PI / 2]) {
      const streak = new THREE.Mesh(streakGeo, streakMat);
      streak.rotation.x = Math.PI / 2;
      streak.rotation.y = roll;
      streak.position.z = -14;
      this.group.add(streak);
    }
    // The authored transport, when it exists: the procedural hull and the
    // blur streaks hide behind it, exactly the prop-swap contract everywhere
    // else. Sculpts are long along Z like the stand-in.
    const standIn = [...this.group.children];
    this.group.add(loadProp(shipId, 15, {
      axis: 'z',
      onLoad: () => { for (const c of standIn) c.visible = false; },
    }));
    this.group.rotation.y = Math.atan2(dir.x, dir.z);
    this.group.position.copy(this.start);
    this.group.visible = false;
  }

  /** advance the pass; false once it has left the sky and can be removed */
  update(dt: number): boolean {
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay > 0) return true;
      this.group.visible = true;
      audio.shipPass(0.4);
    }
    this.t += dt;
    this.group.position.copy(this.start).addScaledVector(this.vel, this.t);
    if (!this.released && this.t >= this.dropT) {
      this.released = true;
      this.onRelease(this.group.position, this.vel);
    }
    return this.t < this.life;
  }

  dispose(): void {
    for (const r of this.owned) r.dispose();
    this.owned.length = 0;
  }
}
