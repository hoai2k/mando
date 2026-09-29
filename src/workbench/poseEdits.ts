import * as THREE from 'three';
import type { ClipSet } from '../anim/clips';

/**
 * The workbench's edit ledger.
 *
 * Every pose edit is stored as one per-bone delta against the clip's *original*
 * keyframes, and written straight into the live AnimationClips. That is what
 * lets an edit survive leaving edit mode — the animation plays back adjusted —
 * and it is what the export describes, so what you watch and what you paste
 * into `clips.ts` are the same numbers.
 *
 * Deltas are euler XYZ degrees added component-wise to every key of the bone's
 * track, which is exactly the hand edit the export asks for. A bone the clip
 * never animated gets a new constant track.
 *
 * An edit can instead be pinned to one moment of the clip. That is a key at
 * that time — the key already there, or a new one — turned by the delta from
 * what the clip plays at that moment, so the correction eases in from the key
 * before and out to the key after and leaves the rest of the motion alone. A
 * moment is measured against the clip with its whole-clip edits but without
 * the other moments, so moments never depend on each other.
 */

export type Euler3 = [number, number, number];
export interface KeyFrame { t: number; deg: Euler3 }

export interface EditEntry {
  clip: string;
  bone: string;
  /** seconds into the clip for an edit pinned to a moment; absent for the whole clip */
  at?: number;
  delta: Euler3;
  /** the clip's value the edit was made against: its first key, or its value at the moment */
  base: Euler3;
  edited: Euler3;
  /** the original keys, and the same keys with the delta applied */
  keys: KeyFrame[] | null;
  newKeys: KeyFrame[];
}

const DEG = 180 / Math.PI;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const key = (clip: string, bone: string): string => `${clip} ${bone}`;
/** a moment's ledger key: the clip and bone, then the time in whole milliseconds */
const momentKey = (clip: string, bone: string, at: number): string => `${clip} ${bone} ${Math.round(at * 1000)}`;
/** keys closer than half a 60 fps frame are the same key */
const SAME_KEY = 0.5 / 60;

function quatOf(deg: Euler3): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(deg[0] / DEG, deg[1] / DEG, deg[2] / DEG, 'XYZ'));
}
export function eulerOf(q: THREE.Quaternion): Euler3 {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [round2(e.x * DEG), round2(e.y * DEG), round2(e.z * DEG)];
}
export const eulerAdd = (a: Euler3, b: Euler3): Euler3 =>
  [round2(a[0] + b[0]), round2(a[1] + b[1]), round2(a[2] + b[2])];
export const eulerSub = (a: Euler3, b: Euler3): Euler3 =>
  [round2(a[0] - b[0]), round2(a[1] - b[1]), round2(a[2] - b[2])];
const isZero = (d: Euler3): boolean => d.every((v) => Math.abs(v) < 0.02);

/** a track's value at time t, the way the mixer plays it: slerped between keys */
function sample(keys: KeyFrame[], t: number): Euler3 {
  if (t <= keys[0].t) return keys[0].deg;
  for (let i = 1; i < keys.length; i++) {
    if (t > keys[i].t) continue;
    const a = keys[i - 1], b = keys[i];
    const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    return eulerOf(quatOf(a.deg).slerp(quatOf(b.deg), k));
  }
  return keys[keys.length - 1].deg;
}

interface Step { key: string; before: Euler3 | null; after: Euler3 | null }

export class PoseEdits {
  /** clip+bone to the keys the clip shipped with; null when it had no track */
  private pristine = new Map<string, KeyFrame[] | null>();
  /** whole-clip edits under `clip bone`, moments under `clip bone ms` */
  private deltas = new Map<string, Euler3>();
  private durations = new Map<string, number>();
  private undoStack: Step[][] = [];
  private redoStack: Step[][] = [];

  get size(): number { return this.deltas.size; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** Record the untouched keyframes of a freshly built clip set (once). */
  capture(clips: ClipSet): void {
    for (const [name, clip] of Object.entries(clips)) {
      if (!this.durations.has(name)) this.durations.set(name, clip.duration);
      for (const track of clip.tracks) {
        const [bone, prop] = track.name.split('.');
        if (prop !== 'quaternion') continue;
        const k = key(name, bone);
        if (!this.pristine.has(k)) this.pristine.set(k, this.readKeys(track as THREE.QuaternionKeyframeTrack));
      }
    }
  }

  private readKeys(track: THREE.QuaternionKeyframeTrack): KeyFrame[] {
    const q = new THREE.Quaternion();
    const v = track.values;
    return Array.from(track.times, (t, i) => {
      q.set(v[i * 4], v[i * 4 + 1], v[i * 4 + 2], v[i * 4 + 3]);
      return { t: Math.round(t * 1000) / 1000, deg: eulerOf(q) };
    });
  }

  /** The clip's original keys for a bone, or null if it never animated it. */
  keysOf(clip: string, bone: string): KeyFrame[] | null {
    const k = key(clip, bone);
    if (!this.pristine.has(k)) this.pristine.set(k, null);
    return this.pristine.get(k)!;
  }

  baseOf(clip: string, bone: string): Euler3 {
    return this.keysOf(clip, bone)?.[0]?.deg ?? [0, 0, 0];
  }

  deltaOf(clip: string, bone: string, at?: number): Euler3 | null {
    return this.deltas.get(at === undefined ? key(clip, bone) : momentKey(clip, bone, at)) ?? null;
  }

  /** the keys the clip plays with its whole-clip edit, before any moment */
  private edited(clip: string, bone: string): KeyFrame[] {
    const delta = this.deltas.get(key(clip, bone)) ?? [0, 0, 0];
    const dur = this.durations.get(clip) ?? 1;
    const keys = this.keysOf(clip, bone) ?? [{ t: 0, deg: [0, 0, 0] as Euler3 }, { t: dur, deg: [0, 0, 0] as Euler3 }];
    return keys.map((f) => ({ t: f.t, deg: eulerAdd(f.deg, delta) }));
  }

  /**
   * Where a moment edited at `at` is keyed: on the clip's own key when one is
   * within half a frame, so the frame shown is the frame changed.
   */
  snap(clip: string, bone: string, at: number): number {
    const near = this.edited(clip, bone).find((f) => Math.abs(f.t - at) < SAME_KEY);
    return near ? near.t : Math.round(at * 1000) / 1000;
  }

  /** What a moment is measured against: the clip with its whole-clip edit, at that time. */
  baseAt(clip: string, bone: string, at: number): Euler3 {
    return sample(this.edited(clip, bone), at);
  }

  /** the finished track: the whole-clip edit, then each moment keyed in */
  private finalKeys(clip: string, bone: string): KeyFrame[] {
    const base = this.edited(clip, bone);
    const keys = base.map((f) => ({ ...f }));
    for (const at of this.momentsOf(clip, bone)) {
      const deg = eulerAdd(sample(base, at), this.deltas.get(momentKey(clip, bone, at))!);
      const near = keys.find((f) => Math.abs(f.t - at) < SAME_KEY);
      if (near) near.deg = deg;
      else keys.push({ t: Math.round(at * 1000) / 1000, deg });
    }
    return keys.sort((a, b) => a.t - b.t);
  }

  private momentsOf(clip: string, bone: string): number[] {
    const prefix = `${key(clip, bone)} `;
    return [...this.deltas.keys()].filter((k) => k.startsWith(prefix))
      .map((k) => Number(k.slice(prefix.length)) / 1000).sort((a, b) => a - b);
  }

  /** Record an edit, or clear it when the delta rounds away. Undoable. */
  set(clip: string, bone: string, delta: Euler3, at?: number): void {
    const k = at === undefined ? key(clip, bone) : momentKey(clip, bone, at);
    const before = this.deltas.get(k) ?? null;
    const after = isZero(delta) ? null : (delta.map(round2) as Euler3);
    if (!before && !after) return;
    if (before && after && before.every((v, i) => v === after[i])) return;
    this.write(k, after);
    this.push([{ key: k, before, after }]);
  }

  clear(clip: string, bone: string, at?: number): void {
    this.set(clip, bone, [0, 0, 0], at);
  }

  /** Drop every edit in one undoable step. */
  clearAll(): void {
    const step: Step[] = [];
    for (const [k, before] of this.deltas) step.push({ key: k, before, after: null });
    if (!step.length) return;
    this.deltas.clear();
    this.push(step);
  }

  private write(k: string, delta: Euler3 | null): void {
    if (delta) this.deltas.set(k, delta);
    else this.deltas.delete(k);
  }

  private push(step: Step[]): void {
    this.undoStack.push(step);
    this.redoStack.length = 0;
  }

  /** the edits as they stand, for the workbench's undo (which calls `restoreSnapshot` and `apply`) */
  snapshot(): Array<[string, Euler3]> { return [...this.deltas].map(([k, d]) => [k, [...d] as Euler3]); }
  restoreSnapshot(snap: Array<[string, Euler3]>): void {
    this.deltas = new Map(snap.map(([k, d]) => [k, [...d] as Euler3]));
  }

  undo(): boolean {
    const step = this.undoStack.pop();
    if (!step) return false;
    for (const s of step) this.write(s.key, s.before);
    this.redoStack.push(step);
    return true;
  }

  redo(): boolean {
    const step = this.redoStack.pop();
    if (!step) return false;
    for (const s of step) this.write(s.key, s.after);
    this.undoStack.push(step);
    return true;
  }

  /**
   * Rewrite the clips from the pristine keys plus the current deltas. Values
   * are recomputed from the originals rather than nudged, so undoing an edit
   * really restores the clip.
   *
   * Where the track already has the right shape its sample values are written
   * *in place*: a playing action holds an interpolant over the track's own
   * `values` array, so writing into that array is seen immediately, while
   * swapping in a fresh track would leave the action reading the old numbers
   * until the mixer re-bound. Returns true only when a track was added or
   * removed, which does need the actions rebuilt (`Animator.invalidate`).
   */
  apply(clips: ClipSet): boolean {
    let structural = false;
    for (const [k, keys] of this.pristine) {
      const [clipName, bone] = k.split(' ');
      const clip = clips[clipName];
      if (!clip) continue;
      const touched = [...this.deltas.keys()].some((d) => d === k || d.startsWith(`${k} `));
      const name = `${bone}.quaternion`;
      const at = clip.tracks.findIndex((t) => t.name === name);
      if (!keys && !touched) {
        // a bone the clip never animated, with nothing left on it: no track
        if (at >= 0) { clip.tracks.splice(at, 1); structural = true; }
        continue;
      }
      if (keys && at < 0) continue;
      const final = this.finalKeys(clipName, bone);
      const values: number[] = [];
      for (const frame of final) {
        const q = quatOf(frame.deg);
        values.push(q.x, q.y, q.z, q.w);
      }
      const track = at >= 0 ? clip.tracks[at] : null;
      const sameTimes = track && track.times.length === final.length
        && final.every((f, i) => Math.abs(track.times[i] - f.t) < 1e-4);
      if (track && sameTimes) {
        track.values.set(values);
      } else {
        // a key added or dropped: a new track, and the actions re-bound to it
        const fresh = new THREE.QuaternionKeyframeTrack(name, final.map((f) => f.t), values);
        if (at >= 0) clip.tracks[at] = fresh; else clip.tracks.push(fresh);
        structural = true;
      }
    }
    return structural;
  }

  /** Everything edited, ready for the export. */
  entries(): EditEntry[] {
    const out: EditEntry[] = [];
    for (const [k, delta] of this.deltas) {
      const [clip, bone, ms] = k.split(' ');
      const at = ms === undefined ? undefined : Number(ms) / 1000;
      const base = at === undefined ? this.baseOf(clip, bone) : this.baseAt(clip, bone, at);
      out.push({
        clip, bone, at, delta, base, edited: eulerAdd(base, delta),
        keys: this.keysOf(clip, bone), newKeys: this.finalKeys(clip, bone),
      });
    }
    return out.sort((a, b) => a.clip.localeCompare(b.clip) || a.bone.localeCompare(b.bone)
      || (a.at ?? -1) - (b.at ?? -1));
  }
}
