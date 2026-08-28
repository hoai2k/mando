import * as THREE from 'three';
import type { Rig } from './skeleton';
import { cycleDistance, type ClipSet } from './clips';

/**
 * Two-channel layered animator: 'lower' (locomotion) and 'upper' (actions).
 * Clip track sets are disjoint between channels, so both channels play
 * simultaneously — fire the blaster mid-run or mid-flight.
 */
export class Animator {
  mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: { lower: string | null; upper: string | null } = { lower: null, upper: null };
  private oneShotUntil = { lower: 0, upper: 0 };
  private time = 0;

  constructor(public rig: Rig, public readonly clips: ClipSet) {
    this.mixer = new THREE.AnimationMixer(rig.root);
  }

  private action(name: string): THREE.AnimationAction | null {
    let a = this.actions.get(name);
    if (!a) {
      const clip = this.clips[name];
      if (!clip) return null;
      a = this.mixer.clipAction(clip);
      this.actions.set(name, a);
    }
    return a;
  }

  /** Cross-fade to a looping clip on a channel (no-op if already playing). */
  /**
   * Playback rate for a locomotion clip that keeps its feet on the ground at
   * `speed` m/s: the clip is advanced exactly as far as the character moves.
   * The clamp is a legibility floor/ceiling — below it a crawl would freeze,
   * above it the legs blur — not a substitute for the measurement.
   */
  gaitRate(name: string, speed: number): number {
    const clip = this.clips[name];
    if (!clip) return 1;
    const d = cycleDistance(clip, this.rig.proportions);
    if (d <= 1e-4) return 1;
    return Math.min(2.4, Math.max(0.35, (speed * clip.duration) / d));
  }

  /** Seconds between footfalls at the rate `gaitRate` returned. */
  stepInterval(name: string, rate: number): number {
    const clip = this.clips[name];
    return clip ? clip.duration / Math.max(0.05, rate) / 2 : 0.3;
  }

  play(channel: 'lower' | 'upper', name: string, fade = 0.18, timeScale = 1): void {
    if (this.time < this.oneShotUntil[channel]) return; // one-shot in progress
    const cur = this.current[channel];
    if (cur === name) {
      const a = this.action(name);
      if (a) a.timeScale = timeScale;
      return;
    }
    const next = this.action(name);
    if (!next) return;
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.timeScale = timeScale;
    next.enabled = true;
    next.fadeIn(fade).play();
    if (cur) this.action(cur)?.fadeOut(fade);
    this.current[channel] = name;
  }

  /** Play a one-shot (melee swing, hit react, death); channel returns to normal after. */
  playOnce(channel: 'lower' | 'upper', name: string, fade = 0.06, clamp = false): number {
    const next = this.action(name);
    if (!next) return 0;
    const cur = this.current[channel];
    if (cur && cur !== name) this.action(cur)?.fadeOut(fade);
    next.reset();
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = clamp;
    next.enabled = true;
    next.fadeIn(fade).play();
    this.current[channel] = name;
    const dur = this.clips[name].duration;
    this.oneShotUntil[channel] = this.time + (clamp ? Infinity : dur - 0.05);
    return dur;
  }

  /** Force-release a channel from a one-shot (e.g. respawn). */
  release(channel: 'lower' | 'upper'): void {
    this.oneShotUntil[channel] = 0;
    this.current[channel] = null;
  }

  /**
   * Drop the cached actions so clips whose tracks were rewritten (the
   * workbench's pose editor does this) are re-bound on the next play.
   */
  invalidate(): void {
    this.mixer.stopAllAction();
    for (const a of this.actions.values()) this.mixer.uncacheClip(a.getClip());
    this.actions.clear();
    this.release('lower');
    this.release('upper');
  }

  releaseAll(): void {
    this.mixer.stopAllAction();
    this.actions.forEach((a) => a.stop());
    this.release('lower');
    this.release('upper');
  }

  update(dt: number): void {
    this.time += dt;
    this.mixer.update(dt);
  }
}
