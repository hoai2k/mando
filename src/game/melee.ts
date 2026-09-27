import * as THREE from 'three';
import type { Combatant } from '../enemies/enemy';

/**
 * Melee contact and the parry (docs/PLAN.md §20).
 *
 * **Contact is the weapon, not a radius.** A swing used to land on anything
 * whose surface was within three metres of the swinger's centre, on one frame
 * 45% into the clip. Measured against the geometry (`tools/audit-melee-reach.mjs`)
 * the weapons reach 1.0–1.3 m (sabers) to 1.5–2.0 m (staffs and spears) from
 * the body's centre, and several clips are still over the shoulder at 45% — so
 * a swing hit things a metre and a half past its tip, and an overhead chop
 * "landed" while the spear was still behind the wielder's head. Now the blade's
 * own meshes are read every frame of the swing and the hit is wherever they
 * actually meet a body.
 *
 * **Two strikes meeting is a parry.** When a blade arrives on someone who is
 * mid-strike themselves, facing it, with a weapon that can meet it, neither
 * blow lands: the blades clash, both fighters are thrown back a step and the
 * later of the two strikes turns into a parry. What can meet what:
 *
 *   - `energy` (every saber, Din's darksaber) and `beskar` (Din's spear) cut
 *     straight through `steel` — a gaffi, a club, an electrostaff. The
 *     conventional weapon's parry fails and the cutting blade's strike lands;
 *     a conventional strike into a cutting blade's swing is sheared off.
 *   - Everything else meets and parries: saber on saber, saber on beskar,
 *     steel on steel.
 *   - Fists, claws and jaws cannot parry and cannot be parried.
 */
export type Blade = 'energy' | 'beskar' | 'steel';

/** does a strike with `a` go straight through a guard made with `b`? */
export function cutsThrough(a: Blade, b: Blade): boolean {
  return a !== 'steel' && b === 'steel';
}

/** the clash's sound: any energy blade in it sizzles, metal on metal rings */
export function clashSound(a: Blade, b: Blade): 'saber' | 'steel' {
  return a === 'energy' || b === 'energy' ? 'saber' : 'steel';
}

/**
 * A strike that can still be met: what the striker is holding, when the
 * strike began (game time) and where it is going. Only returned while the
 * weapon is travelling toward its contact — a recovery cannot parry.
 */
export interface Guard {
  blade: Blade;
  startedAt: number;
  /** who the strike is aimed at, when the striker has picked someone */
  target: Combatant | null;
}

/** a combatant that can meet a blade with one of its own */
export interface Duelist extends Combatant {
  yaw: number;
  meleeGuard(): Guard | null;
  /**
   * Your strike was met: cancel it and take the shove. `react` is true for
   * the later of the two strikers, which plays its parry clip if it has one.
   */
  parried(from: THREE.Vector3, react: boolean): void;
}

export const isDuelist = (c: Combatant): c is Duelist =>
  typeof (c as Partial<Duelist>).meleeGuard === 'function';

/** how hard a parry throws each fighter apart (m/s) */
export const PARRY_SHOVE = 7;
/** a guard only answers a blade that arrives from in front of it (cos of the half-angle) */
const GUARD_FACING = 0.2;

export type ClashResult =
  | { kind: 'hit' }                                  // no blade met it: the strike lands
  | { kind: 'parry'; sound: 'saber' | 'steel' }      // both strikes cancelled
  | { kind: 'cut' }                                  // the attacker cut through the defender's guard
  | { kind: 'sheared' };                             // the defender's blade cut the attacker's strike off

/**
 * What happens when `attacker`'s strike, made with `blade`, arrives on
 * `defender`. Pure: the caller applies the outcome.
 */
export function resolveClash(attacker: Combatant, blade: Blade | null, defender: Combatant): ClashResult {
  if (!blade || !isDuelist(defender)) return { kind: 'hit' };
  const guard = defender.meleeGuard();
  if (!guard) return { kind: 'hit' };
  if (guard.target && guard.target !== attacker) return { kind: 'hit' };
  const dx = attacker.position.x - defender.position.x;
  const dz = attacker.position.z - defender.position.z;
  const len = Math.hypot(dx, dz) || 1;
  const facing = (dx * Math.sin(defender.yaw) + dz * Math.cos(defender.yaw)) / len;
  if (facing < GUARD_FACING) return { kind: 'hit' };
  if (cutsThrough(blade, guard.blade)) return { kind: 'cut' };
  if (cutsThrough(guard.blade, blade)) return { kind: 'sheared' };
  return { kind: 'parry', sound: clashSound(blade, guard.blade) };
}

// ---------------------------------------------------------------------------
// Blade geometry
// ---------------------------------------------------------------------------

/** a capsule along a weapon part, in world space */
export interface Segment { a: THREE.Vector3; b: THREE.Vector3; r: number }

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _scale = new THREE.Vector3();

/** grow `out` to `n` segments, reusing the vectors already there */
function slot(out: Segment[], n: number): Segment {
  if (!out[n]) out[n] = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0 };
  return out[n];
}

function visibleInWorld(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/**
 * One capsule per visible mesh hanging off the given weapon mounts: the
 * mesh's bounding box, run down its longest axis, as thick as the box is
 * across. A spear is its shaft and its head; a saber its hilt and its blade.
 * Returns how many were written.
 */
export function weaponSegments(mounts: readonly (THREE.Object3D | null | undefined)[], out: Segment[]): number {
  let n = 0;
  const seen = new Set<THREE.Object3D>();
  for (const mount of mounts) {
    if (!mount) continue;
    mount.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || seen.has(mesh) || !visibleInWorld(mesh)) return;
      seen.add(mesh);
      const geo = mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      _box.copy(geo.boundingBox!);
      _box.getSize(_size);
      _box.getCenter(_mid);
      mesh.updateWorldMatrix(true, false);
      _scale.setFromMatrixScale(mesh.matrixWorld);
      const lx = _size.x * _scale.x, ly = _size.y * _scale.y, lz = _size.z * _scale.z;
      const long = Math.max(lx, ly, lz);
      if (long < 0.06) return;   // a rivet, a grip wrap: nothing a swing reaches with
      let half: number, thick: number;
      if (long === lx) { _axis.set(_size.x / 2, 0, 0); thick = Math.max(ly, lz); half = lx; }
      else if (long === ly) { _axis.set(0, _size.y / 2, 0); thick = Math.max(lx, lz); half = ly; }
      else { _axis.set(0, 0, _size.z / 2); thick = Math.max(lx, ly); half = lz; }
      const s = slot(out, n++);
      s.a.copy(_mid).sub(_axis).applyMatrix4(mesh.matrixWorld);
      s.b.copy(_mid).add(_axis).applyMatrix4(mesh.matrixWorld);
      // a poleaxe head is a flat blade, not a club: half its width, capped
      s.r = Math.min(thick / 2, 0.12, half / 2);
    });
  }
  return n;
}

/**
 * Everywhere a character's melee weapon can hang: the procedural rig's hand
 * mounts, and — once the authored sculpt is in — the sculpt's own hand
 * mounts, which the weapon props are moved onto. Looked up by name once the
 * sculpt has them, and remembered.
 */
const _mounts = new WeakMap<THREE.Object3D, THREE.Object3D[]>();
export function weaponMounts(char: {
  root: THREE.Object3D; rig: { bones: Record<string, THREE.Object3D> } | null; gaffi?: THREE.Object3D;
}): THREE.Object3D[] {
  const known = _mounts.get(char.root);
  if (known) return known;
  const list: THREE.Object3D[] = [];
  const bones = char.rig?.bones;
  if (bones?.weaponR) list.push(bones.weaponR);
  if (bones?.weaponL) list.push(bones.weaponL);
  if (char.gaffi) list.push(char.gaffi);
  const r = char.root.getObjectByName('weaponMount');
  const l = char.root.getObjectByName('weaponMountL');
  if (r) list.push(r);
  if (l) list.push(l);
  // the sculpt swaps in after the build: only settle once its mounts exist
  if (r || !bones) _mounts.set(char.root, list);
  return list;
}

/** a bare-handed fighter swings its forearms and fists */
export function fistSegments(bones: Record<string, THREE.Object3D> | undefined, out: Segment[]): number {
  if (!bones) return 0;
  let n = 0;
  for (const side of ['R', 'L'] as const) {
    const fore = bones[`forearm${side}`], hand = bones[`hand${side}`];
    if (!fore || !hand) continue;
    const s = slot(out, n++);
    fore.getWorldPosition(s.a);
    hand.getWorldPosition(s.b);
    // the fist sits past the wrist
    _axis.subVectors(s.b, s.a).setLength(0.1);
    s.b.add(_axis);
    s.r = 0.07;
  }
  return n;
}

// ---- closest-point geometry ----
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** squared distance between segments p1q1 and p2q2, closest point on the first in `onFirst` */
function segSegDistSq(
  p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, onFirst: THREE.Vector3,
): number {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s: number, t: number;
  if (a <= 1e-9 && e <= 1e-9) { s = 0; t = 0; }
  else if (a <= 1e-9) { s = 0; t = clamp01(f / e); }
  else {
    const c = _d1.dot(_r);
    if (e <= 1e-9) { t = 0; s = clamp01(-c / a); }
    else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  _c1.copy(p1).addScaledVector(_d1, s);
  _c2.copy(p2).addScaledVector(_d2, t);
  onFirst.copy(_c1);
  return _c1.distanceToSquared(_c2);
}

/** the volumes a swing can strike on a body: its capsule and its extra spheres */
interface HitPart { z: number; y: number; r: number }

const _lo = new THREE.Vector3();
const _hi = new THREE.Vector3();
const _p = new THREE.Vector3();
const _cp = new THREE.Vector3();

/**
 * Does the weapon capsule `s` touch `e`? The body is the same volume a bolt
 * hits: a vertical capsule from the feet to the hit height, plus the extra
 * spheres a long creature carries. `margin` is the forgiveness every melee
 * game gives a blade that visibly grazed. Writes the contact point to `at`.
 */
export function segmentTouches(s: Segment, e: Combatant, margin: number, at: THREE.Vector3): boolean {
  const withBody = e as Combatant & {
    hitParts?: HitPart[]; yaw?: number; profile?: { hitRadius?: number; hitParts?: HitPart[] };
  };
  const radius = withBody.profile?.hitRadius ?? e.radius;
  const height = e.hitHeight ?? e.height;
  // the capsule's axis runs between the centres of its end caps
  const cap = Math.min(radius, height / 2);
  _lo.set(e.position.x, e.position.y + cap, e.position.z);
  _hi.set(e.position.x, e.position.y + height - cap, e.position.z);
  const reach = radius + s.r + margin;
  if (segSegDistSq(s.a, s.b, _lo, _hi, at) <= reach * reach) return true;
  const parts = withBody.hitParts ?? withBody.profile?.hitParts;
  if (parts?.length) {
    const yaw = withBody.yaw ?? 0;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    for (const part of parts) {
      _p.set(e.position.x + sin * part.z, e.position.y + part.y, e.position.z + cos * part.z);
      const pr = part.r + s.r + margin;
      if (segSegDistSq(s.a, s.b, _p, _p, _cp) <= pr * pr) { at.copy(_cp); return true; }
    }
  }
  return false;
}

/**
 * The swept test: the blade moved from `prev` to `cur` this frame, and at
 * speed a tip covers a quarter of a metre between frames — enough to pass
 * clean through a forearm. The in-between positions are checked too.
 */
const _sweep: Segment = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0 };
export function sweepTouches(
  prev: Segment | undefined, cur: Segment, e: Combatant, margin: number, at: THREE.Vector3,
): boolean {
  if (!prev) return segmentTouches(cur, e, margin, at);
  for (const k of [1, 0.66, 0.33]) {
    _sweep.a.lerpVectors(prev.a, cur.a, k);
    _sweep.b.lerpVectors(prev.b, cur.b, k);
    _sweep.r = cur.r;
    if (segmentTouches(_sweep, e, margin, at)) return true;
  }
  return false;
}

/** how far out in front of `from` (horizontally, inside the swing's arc) the weapon reaches */
export function forwardReach(segs: readonly Segment[], n: number, from: THREE.Vector3, yaw: number): number {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let best = 0;
  for (let i = 0; i < n; i++) {
    for (const v of [segs[i].a, segs[i].b]) {
      const dx = v.x - from.x, dz = v.z - from.z;
      const flat = Math.hypot(dx, dz);
      if (flat > best && (dx * fx + dz * fz) > 0.25 * flat) best = flat;
    }
  }
  return best;
}
