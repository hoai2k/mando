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
 */

export type Euler3 = [number, number, number];
export interface KeyFrame { t: number; deg: Euler3 }

export interface EditEntry {
  clip: string;
  bone: string;
  delta: Euler3;
  /** the clip's original value at its first key (zeroes if it had no track) */
  base: Euler3;
  edited: Euler3;
  /** the original keys, and the same keys with the delta applied */
  keys: KeyFrame[] | null;
  newKeys: KeyFrame[];
}

const DEG = 180 / Math.PI;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const key = (clip: string, bone: string): string => `${clip} ${bone}`;

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

interface Step { key: string; before: Euler3 | null; after: Euler3 | null }

export class PoseEdits {
  /** clip+bone to the keys the clip shipped with; null when it had no track */
  private pristine = new Map<string, KeyFrame[] | null>();
  private deltas = new Map<string, Euler3>();
  private undoStack: Step[][] = [];
  private redoStack: Step[][] = [];

  get size(): number { return this.deltas.size; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** Record the untouched keyframes of a freshly built clip set (once). */
  capture(clips: ClipSet): void {
    for (const [name, clip] of Object.entries(clips)) {
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

  deltaOf(clip: string, bone: string): Euler3 | null {
    return this.deltas.get(key(clip, bone)) ?? null;
  }

  /** Record an edit, or clear it when the delta rounds away. Undoable. */
  set(clip: string, bone: string, delta: Euler3): void {
    const k = key(clip, bone);
    const before = this.deltas.get(k) ?? null;
    const after = isZero(delta) ? null : (delta.map(round2) as Euler3);
    if (!before && !after) return;
    if (before && after && before.every((v, i) => v === after[i])) return;
    this.write(k, after);
    this.push([{ key: k, before, after }]);
  }

  clear(clip: string, bone: string): void {
    this.set(clip, bone, [0, 0, 0]);
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
   * Rewrite the clips from the pristine keys plus the current deltas. Tracks
   * are rebuilt rather than nudged, so undoing an edit really restores the
   * clip. Returns true when a track was added or removed — the mixer binds its
   * actions when a clip is first played, and has to be rebuilt after that.
   */
  apply(clips: ClipSet): boolean {
    let structural = false;
    for (const [k, keys] of this.pristine) {
      const [clipName, bone] = k.split(' ');
      const clip = clips[clipName];
      if (!clip) continue;
      const delta = this.deltas.get(k) ?? null;
      const name = `${bone}.quaternion`;
      const at = clip.tracks.findIndex((t) => t.name === name);
      if (!keys) {
        // a bone the clip never animated: the edit adds a constant track
        if (!delta) {
          if (at >= 0) { clip.tracks.splice(at, 1); structural = true; }
          continue;
        }
        const q = quatOf(delta);
        const track = new THREE.QuaternionKeyframeTrack(name, [0, clip.duration],
          [q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w]);
        if (at >= 0) {
          clip.tracks[at] = track;
        } else {
          clip.tracks.push(track);
          structural = true;
        }
        continue;
      }
      if (at < 0) continue;
      const values: number[] = [];
      for (const frame of keys) {
        const q = quatOf(delta ? eulerAdd(frame.deg, delta) : frame.deg);
        values.push(q.x, q.y, q.z, q.w);
      }
      clip.tracks[at] = new THREE.QuaternionKeyframeTrack(name, keys.map((f) => f.t), values);
    }
    return structural;
  }

  /** Everything edited, ready for the export. */
  entries(): EditEntry[] {
    const out: EditEntry[] = [];
    for (const [k, delta] of this.deltas) {
      const [clip, bone] = k.split(' ');
      const keys = this.keysOf(clip, bone);
      const base = this.baseOf(clip, bone);
      out.push({
        clip, bone, delta, base, edited: eulerAdd(base, delta), keys,
        newKeys: (keys ?? [{ t: 0, deg: [0, 0, 0] as Euler3 }]).map((f) => ({ t: f.t, deg: eulerAdd(f.deg, delta) })),
      });
    }
    return out.sort((a, b) => a.clip.localeCompare(b.clip) || a.bone.localeCompare(b.bone));
  }
}
