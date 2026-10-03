import * as THREE from 'three';
import type { ClipSet } from '../anim/clips';

/**
 * The animation editor's ledger (`/workbench/?edit=pose`).
 *
 * Where the model workbench's `PoseEdits` stores a rotation offset per bone,
 * this keeps whole tracks: every track the user has touched is held as its
 * finished list of keys — times and values — so keys can be moved, added and
 * deleted as well as re-posed. Untouched tracks are left exactly as the clip
 * built them.
 *
 * A clip is captured the first time it is seen, which is what the export
 * measures against and what "revert" goes back to. Edits are stored by clip
 * name, so an edit made on one character plays on every character that runs
 * the same clip — that is how an edit is tried on the rest of the cast.
 */

export interface TrackKeys {
  times: number[];
  /** 4 numbers a key for a quaternion track, 3 for a position */
  values: number[];
}
export type TrackKind = 'quaternion' | 'position';
export interface KeyRef { clip: string; track: string; t: number }

/** keys closer than half a 60 fps frame are the same key */
export const SAME_KEY = 0.5 / 60;
const round3 = (t: number): number => Math.round(t * 1000) / 1000;
export const kindOf = (track: string): TrackKind => (track.endsWith('.quaternion') ? 'quaternion' : 'position');
const sizeOf = (track: string): number => (kindOf(track) === 'quaternion' ? 4 : 3);

function makeTrack(name: string, keys: TrackKeys): THREE.KeyframeTrack {
  return kindOf(name) === 'quaternion'
    ? new THREE.QuaternionKeyframeTrack(name, keys.times, keys.values)
    : new THREE.VectorKeyframeTrack(name, keys.times, keys.values);
}

const readTrack = (t: THREE.KeyframeTrack): TrackKeys => ({
  times: Array.from(t.times, round3), values: Array.from(t.values),
});

/** a track's value at `t`, the way the mixer plays it */
export function sampleKeys(name: string, keys: TrackKeys, t: number): number[] {
  if (!keys.times.length) return kindOf(name) === 'quaternion' ? [0, 0, 0, 1] : [0, 0, 0];
  const track = makeTrack(name, keys);
  return Array.from(track.createInterpolant().evaluate(t) as ArrayLike<number>);
}

export interface AnimSnapshot { tracks: Array<[string, TrackKeys | null]> }

export class AnimEdits {
  /** `clip|track` -> the keys the clip shipped with, on the first character it was seen on */
  private pristine = new Map<string, TrackKeys | null>();
  /** which character each clip was first captured on — the export's "original" */
  private capturedOn = new Map<string, string>();
  /**
   * Each built clip set's own tracks as built. Clips are built to a body's
   * proportions, so another character's copy of a clip can differ: a track
   * nobody edited is put back from its own set, never from another's.
   */
  private own = new WeakMap<ClipSet, Map<string, TrackKeys>>();
  /** the tracks `apply` last wrote into each set, so a revert can put them back */
  private applied = new WeakMap<ClipSet, Set<string>>();
  /** the clip set on the turntable, whose own tracks unedited keys are read from */
  active: ClipSet | null = null;
  private durations = new Map<string, number>();
  /** `clip|track` -> the finished keys; null removes the track from the clip */
  private edited = new Map<string, TrackKeys | null>();

  /** Record the untouched tracks of a freshly built clip set, made for `who`. */
  capture(clips: ClipSet, who: string): void {
    if (this.own.has(clips)) return;
    const own = new Map<string, TrackKeys>();
    for (const [name, clip] of Object.entries(clips)) {
      if (!this.durations.has(name)) this.durations.set(name, clip.duration);
      if (!this.capturedOn.has(name)) this.capturedOn.set(name, who);
      for (const track of clip.tracks) {
        const k = `${name}|${track.name}`;
        const keys = readTrack(track);
        own.set(k, keys);
        if (!this.pristine.has(k)) this.pristine.set(k, keys);
      }
    }
    this.own.set(clips, own);
  }

  /** the character a clip's original keys were read from */
  sourceOf(clip: string): string | null { return this.capturedOn.get(clip) ?? null; }

  /** a track as built: on the turntable's own clips where it has them */
  private base(k: string): TrackKeys | null {
    const own = this.active ? this.own.get(this.active) : undefined;
    if (own && own.has(k)) return own.get(k)!;
    if (own && this.pristine.has(k) && [...own.keys()].some((o) => o.startsWith(`${k.split('|')[0]}|`))) return null;
    return this.pristine.get(k) ?? null;
  }

  duration(clip: string): number { return this.durations.get(clip) ?? 0; }

  /** The keys as they play now: edited, or as built. */
  keys(clip: string, track: string): TrackKeys | null {
    const k = `${clip}|${track}`;
    if (this.edited.has(k)) return this.edited.get(k)!;
    return this.base(k);
  }

  original(clip: string, track: string): TrackKeys | null { return this.pristine.get(`${clip}|${track}`) ?? null; }

  isEdited(clip: string, track?: string): boolean {
    if (track) return this.edited.has(`${clip}|${track}`);
    return [...this.edited.keys()].some((k) => k.startsWith(`${clip}|`));
  }

  get editedClips(): string[] {
    return [...new Set([...this.edited.keys()].map((k) => k.split('|')[0]))].sort();
  }

  get size(): number { return this.edited.size; }

  /** every track of a clip that has keys now, in the order the clip lists them */
  tracksOf(clip: string): string[] {
    const out: string[] = [];
    const own = this.active ? this.own.get(this.active) : undefined;
    for (const k of new Set([...(own?.keys() ?? this.pristine.keys()), ...this.edited.keys()])) {
      const [c, track] = k.split('|');
      if (c === clip && this.keys(c, track)?.times.length) out.push(track);
    }
    return out;
  }

  private write(clip: string, track: string, keys: TrackKeys | null): void {
    const k = `${clip}|${track}`;
    const orig = this.base(k);
    const empty = !keys || !keys.times.length;
    // back to what the clip shipped with: no longer an edit
    if ((empty && !orig) || (!empty && orig && sameKeys(orig, keys!))) this.edited.delete(k);
    else this.edited.set(k, empty ? null : keys);
  }

  private copyKeys(clip: string, track: string): TrackKeys {
    const now = this.keys(clip, track);
    return { times: [...(now?.times ?? [])], values: [...(now?.values ?? [])] };
  }

  /** the index of the key at `t`, within half a frame, or -1 */
  keyAt(clip: string, track: string, t: number): number {
    const keys = this.keys(clip, track);
    return keys ? keys.times.findIndex((k) => Math.abs(k - t) < SAME_KEY) : -1;
  }

  /** the value the track plays at `t` */
  sample(clip: string, track: string, t: number): number[] {
    return sampleKeys(track, this.keys(clip, track) ?? { times: [], values: [] }, t);
  }

  /**
   * Set (or create) the key at `t`. With `loop`, a key on either end of a clip
   * whose first and last keys were the same pose is written to both ends, so
   * a looping cycle stays closed.
   */
  setKey(clip: string, track: string, t: number, value: number[], loop = true): void {
    const keys = this.copyKeys(clip, track);
    const n = sizeOf(track);
    const put = (at: number): void => {
      const i = keys.times.findIndex((k) => Math.abs(k - at) < SAME_KEY);
      if (i >= 0) { keys.values.splice(i * n, n, ...value); return; }
      let j = keys.times.findIndex((k) => k > at);
      if (j < 0) j = keys.times.length;
      keys.times.splice(j, 0, round3(at));
      keys.values.splice(j * n, 0, ...value);
    };
    put(t);
    if (loop) {
      const twin = this.loopTwin(clip, track, t);
      if (twin !== null) put(twin);
    }
    this.write(clip, track, keys);
  }

  /**
   * For a key on one end of a closed loop, the time of the key at the other
   * end — the one that has to match it for the cycle to close.
   */
  loopTwin(clip: string, track: string, t: number): number | null {
    const dur = this.duration(clip);
    const keys = this.keys(clip, track);
    if (!keys || keys.times.length < 2 || dur <= 0) return null;
    const first = keys.times[0], last = keys.times[keys.times.length - 1];
    if (Math.abs(first) > SAME_KEY || Math.abs(last - dur) > SAME_KEY) return null;
    const n = sizeOf(track);
    const a = keys.values.slice(0, n), b = keys.values.slice(-n);
    if (!a.every((v, i) => Math.abs(v - b[i]) < 1e-3)) return null;
    if (Math.abs(t - first) < SAME_KEY) return last;
    if (Math.abs(t - last) < SAME_KEY) return first;
    return null;
  }

  /** Delete keys; a track left with none is dropped from the clip. */
  deleteKeys(refs: KeyRef[]): void {
    for (const [clip, track] of groupTracks(refs)) {
      const keys = this.copyKeys(clip, track);
      const n = sizeOf(track);
      const drop = refs.filter((r) => r.clip === clip && r.track === track).map((r) => r.t);
      const kept: TrackKeys = { times: [], values: [] };
      keys.times.forEach((t, i) => {
        if (drop.some((d) => Math.abs(d - t) < SAME_KEY)) return;
        kept.times.push(t);
        kept.values.push(...keys.values.slice(i * n, i * n + n));
      });
      this.write(clip, track, kept.times.length ? kept : null);
    }
  }

  /**
   * Slide keys by `dt` seconds, kept inside their clip. A key landing on one
   * that is not moving replaces it.
   */
  moveKeys(refs: KeyRef[], dt: number): void {
    for (const [clip, track] of groupTracks(refs)) {
      const keys = this.copyKeys(clip, track);
      const n = sizeOf(track);
      const dur = this.duration(clip);
      const moving = refs.filter((r) => r.clip === clip && r.track === track).map((r) => r.t);
      const still: Array<{ t: number; v: number[] }> = [];
      const moved: Array<{ t: number; v: number[] }> = [];
      keys.times.forEach((t, i) => {
        const v = keys.values.slice(i * n, i * n + n);
        if (moving.some((m) => Math.abs(m - t) < SAME_KEY)) moved.push({ t: round3(Math.min(dur, Math.max(0, t + dt))), v });
        else still.push({ t, v });
      });
      const all = [...still.filter((s) => !moved.some((m) => Math.abs(m.t - s.t) < SAME_KEY)), ...moved]
        .sort((a, b) => a.t - b.t);
      this.write(clip, track, { times: all.map((k) => k.t), values: all.flatMap((k) => k.v) });
    }
  }

  /** Put tracks — or a whole clip — back as built. */
  revert(clip: string, track?: string): void {
    for (const k of [...this.edited.keys()]) {
      const [c, tr] = k.split('|');
      if (c === clip && (!track || tr === track)) this.edited.delete(k);
    }
  }

  revertAll(): void { this.edited.clear(); }

  snapshot(): AnimSnapshot {
    return { tracks: [...this.edited].map(([k, v]) => [k, v && { times: [...v.times], values: [...v.values] }]) };
  }

  restoreSnapshot(snap: AnimSnapshot): void {
    this.edited = new Map(snap.tracks.map(([k, v]) => [k, v && { times: [...v.times], values: [...v.values] }]));
  }

  /**
   * Write the clips from what was captured plus the edits. Returns true when
   * a track was added, removed or re-timed — the animator's actions then need
   * re-binding (`Animator.invalidate`); a change of values alone is written
   * into the track's own array, which a playing action reads directly.
   */
  apply(clips: ClipSet): boolean {
    let structural = false;
    const own = this.own.get(clips);
    const touched = new Set([...(this.applied.get(clips) ?? []), ...this.edited.keys()]);
    this.applied.set(clips, new Set(this.edited.keys()));
    for (const k of touched) {
      const [clipName, name] = k.split('|');
      const clip = clips[clipName];
      if (!clip) continue;
      const want = this.edited.has(k) ? this.edited.get(k)! : own?.get(k) ?? null;
      const at = clip.tracks.findIndex((t) => t.name === name);
      if (!want || !want.times.length) {
        if (at >= 0) { clip.tracks.splice(at, 1); structural = true; }
        continue;
      }
      const track = at >= 0 ? clip.tracks[at] : null;
      if (track && track.times.length === want.times.length
        && want.times.every((t, i) => Math.abs(track.times[i] - t) < 1e-4)) {
        if (!want.values.every((v, i) => track.values[i] === v)) track.values.set(want.values);
        continue;
      }
      const fresh = makeTrack(name, want);
      if (at >= 0) clip.tracks[at] = fresh; else clip.tracks.push(fresh);
      structural = true;
    }
    return structural;
  }
}

function sameKeys(a: TrackKeys, b: TrackKeys): boolean {
  return a.times.length === b.times.length
    && a.times.every((t, i) => Math.abs(t - b.times[i]) < 1e-4)
    && a.values.every((v, i) => Math.abs(v - b.values[i]) < 1e-6);
}

function groupTracks(refs: KeyRef[]): Array<[string, string]> {
  const seen = new Map<string, [string, string]>();
  for (const r of refs) seen.set(`${r.clip}|${r.track}`, [r.clip, r.track]);
  return [...seen.values()];
}
