import * as THREE from 'three';
import type { BoneName, Rig } from './skeleton';
import { cycleDistance, type ClipSet } from './clips';

/** the ground cycles `travelClip` can pick from */
export type TravelClip = 'runLower' | 'strafeLower' | 'strafeLLower' | 'backpedalLower';

/**
 * Which ground cycle fits the way a body is travelling relative to the way
 * it faces. Combat facing points the chest at the target while the feet go
 * wherever the steering says, and the forward run played for all of it —
 * legs pumping forward through a sidestep is a moonwalk. Pick by the
 * divergence instead: the forward run, a lateral shuffle (one clip and its
 * mirror), or the back-pedal cycle played in reverse (`dir` = -1).
 *
 * Shared by the player and the enemies, so a ranged trooper fanning out
 * sideways on approach stops moonwalking the way the player did.
 */
export function travelClip(vx: number, vz: number, facingYaw: number): { clip: TravelClip; dir: 1 | -1 } {
  let rel = Math.atan2(vx, vz) - facingYaw;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  const arel = Math.abs(rel);
  if (arel > 2.3) return { clip: 'backpedalLower', dir: -1 };            // > ~132°: backing up
  if (arel > 0.8) return { clip: rel > 0 ? 'strafeLLower' : 'strafeLower', dir: 1 }; // 46-132°: side-stepping
  return { clip: 'runLower', dir: 1 };
}

/** the jetpack poses `flightPose` can pick from — the four sagittal ones in thigh order (trailing → reaching), plus the lateral drift and its mirror */
export type FlightPose = 'flyRise' | 'fly' | 'flyDrift' | 'flyDriftL' | 'flyFall' | 'flyBrace';

/**
 * Which jetpack pose fits the way a body is flying.
 *
 * One flight pose cannot serve every direction of flight. The cruise (`fly`)
 * is built for forward-and-up: the chest leads and the legs stream out behind.
 * Riding it straight up made a man lying on his stomach being winched; riding
 * it down had him arrive at the ground reaching backward with his heels, and
 * then cut to a crouch. So the pose is chosen from the flight itself — the
 * climb angle, and how close the ground below has got:
 *
 *   `flyBrace`  the ground is near, or is about to be: gather for it
 *   `flyRise`   hovering, or driving near-vertically up: legs hang plumb
 *   `flyFall`   descending: legs plumb, a shade forward, body upright
 *   `flyDrift`  flying sideways: the legs swing out trailing the drift
 *   `fly`       everything else — the forward cruise
 *
 * The drift is the one that reads off *heading* rather than climb: it stands
 * in for the cruise whenever travel and facing diverge laterally, which is
 * the airborne version of the ground strafe standing in for the run. It only
 * displaces the cruise — a steep climb or descent keeps its plumb legs,
 * however sideways it is going, because at that angle the legs are hanging
 * off the pack and there is no drift left to trail. And it is a leg swing,
 * not a bank: nothing here rolls the body.
 *
 * `groundDist` is metres from the feet to whatever is under them (Infinity
 * where nothing is), and the brace triggers on the ground being either close
 * or *soon* — within `BRACE_NEAR` metres, or `BRACE_LEAD` seconds of sink at
 * the current rate — so a fast descent gathers from higher up and a slow one
 * waits until it is nearly down. `BRACE_CEIL` caps the second of those, or a
 * plunge would brace from half a board away.
 *
 * Every threshold has a second value used while that pose is already playing,
 * which is what stops a body sitting exactly on a boundary from strobing
 * between two clips. Pass what is playing now as `current`; the caller keeps
 * the answer and hands it back next frame.
 */
export function flightPose(
  vel: { x: number; y: number; z: number }, facingYaw: number,
  groundDist: number, current: FlightPose | null,
): FlightPose {
  const vy = vel.y;
  const groundSpeed = Math.hypot(vel.x, vel.z);
  // --- the ground first: it outranks whatever the flight is doing, unless
  // the flight is leaving it. Without that last clause every take-off began
  // by bracing for a landing on the ground it was pushing off. ---
  const sink = -vy;
  const climbingOut = vy > (current === 'flyBrace' ? BRACE_RISE_OUT : BRACE_RISE_IN);
  if (!climbingOut) {
    const lead = sink > 0.2 ? groundDist / sink : Infinity;
    const near = current === 'flyBrace' ? BRACE_NEAR_OUT : BRACE_NEAR_IN;
    if (groundDist <= near) return 'flyBrace';
    if (groundDist <= BRACE_CEIL && lead <= (current === 'flyBrace' ? BRACE_LEAD_OUT : BRACE_LEAD_IN)) {
      return 'flyBrace';
    }
  }
  // --- hovering: too slow for a heading to mean anything, so hang plumb ---
  const held = current === 'flyRise';
  const speed = Math.max(0, groundSpeed);
  if (speed < (held ? HOVER_SPEED_OUT : HOVER_SPEED_IN) && vy > -(held ? HOVER_SINK_OUT : HOVER_SINK_IN)) {
    return 'flyRise';
  }
  // --- otherwise the climb angle decides, in degrees above the horizon ---
  const climb = (Math.atan2(vy, Math.max(1e-3, speed)) * 180) / Math.PI;
  if (climb >= (held ? RISE_OUT : RISE_IN)) return 'flyRise';
  if (climb <= (current === 'flyFall' ? FALL_OUT : FALL_IN)) return 'flyFall';
  // --- and inside the cruise band, which way across the body is it going? ---
  //
  // Same divergence `travelClip` reads on the ground, and the same sides:
  // a positive angle is travel toward the character's own left, which is the
  // mirrored clip. Past the lateral band it is flight backward, which the
  // cruise still serves.
  let rel = Math.atan2(vel.x, vel.z) - facingYaw;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  const arel = Math.abs(rel);
  const drifting = current === 'flyDrift' || current === 'flyDriftL';
  if (arel > (drifting ? DRIFT_OUT : DRIFT_IN) && arel < DRIFT_BACK) {
    return rel > 0 ? 'flyDriftL' : 'flyDrift';
  }
  return 'fly';
}

/** brace this close to the ground however slowly you are sinking, metres */
const BRACE_NEAR_IN = 1.8;
const BRACE_NEAR_OUT = 2.9;
/** ...or this many seconds of sink from it, at the current rate */
const BRACE_LEAD_IN = 0.42;
const BRACE_LEAD_OUT = 0.62;
/** but never from higher than this, whatever the sink rate, metres */
const BRACE_CEIL = 7;
/**
 * Climbing faster than this is a take-off, not an arrival, m/s. The second,
 * higher value is what it takes to break a brace that is already on, so a
 * body bobbing on its thrust a metre off the deck stays gathered for it.
 */
const BRACE_RISE_IN = 1.5;
const BRACE_RISE_OUT = 2.4;
/** below this ground speed there is no heading to pose to, m/s */
const HOVER_SPEED_IN = 2.4;
const HOVER_SPEED_OUT = 3.4;
/** ...unless it is sinking faster than this, which is a descent, not a hover */
const HOVER_SINK_IN = 1.2;
const HOVER_SINK_OUT = 1.9;
/**
 * Climb angle that reads as going up rather than along, degrees.
 *
 * Set well above the angle a full-thrust forward flight actually makes. The
 * pack stops pushing above 7 m/s of climb and a Mandalorian's ground speed is
 * 9.2, so holding thrust *and* the stick settles at about 37° — comfortably
 * the cruise it looks like. Letting go of the stick is what hangs the legs:
 * the ground speed bleeds off, the angle stands up, and somewhere in the
 * fifties the legs swing down under the pack.
 */
const RISE_IN = 65;
const RISE_OUT = 52;
/** ...and the one that reads as going down */
const FALL_IN = -26;
const FALL_OUT = -14;
/**
 * How far travel has to diverge from facing before the legs trail sideways
 * instead of behind, radians — 52° to take it, 40° to give it back.
 *
 * Only reachable while facing and travel can diverge at all, which in flight
 * means aiming or firing: the rest of the time the body turns to face where
 * it is going and this never fires. That is the case worth having, though —
 * strafing across a rooftop with the sights up is most of the flying anyone
 * does in a fight.
 */
const DRIFT_IN = 0.9;
const DRIFT_OUT = 0.7;
/** past here it is flight backward rather than across, and the cruise serves it */
const DRIFT_BACK = 2.3;

/** the two channel clips a flight pose plays */
export function flightClips(pose: FlightPose): { lower: string; upper: string } {
  return pose === 'fly'
    ? { lower: 'flyLower', upper: 'flyUpper' }
    : { lower: `${pose}Lower`, upper: `${pose}Upper` };
}

const _addQ = new THREE.Quaternion();
const _addE = new THREE.Euler();

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
  /**
   * Additive offsets laid over the mixer's pose each update — the aim pitch
   * on the chest, the recoil kick on the arm. Keyed by bone; each is undone
   * before the next mixer update and reapplied after it, so a bone no clip
   * happens to write still ends up exactly where it was left.
   */
  private additive = new Map<BoneName, THREE.Quaternion>();
  /** seconds of hit-stop left: the mixer all but stands still while it runs */
  private frozen = 0;
  /**
   * Where in its cycle this body's idles begin. Shared cached clips all start
   * at t=0, so a squad spawned together breathed in lock-step; each animator
   * picks its own phase once and every looping idle it plays starts there.
   */
  private idlePhase = Math.random();

  constructor(public rig: Rig, public readonly clips: ClipSet) {
    this.mixer = new THREE.AnimationMixer(rig.root);
  }

  /**
   * Lay an extra rotation (radians, XYZ) over a bone on top of whatever the
   * clips put there, about its parent's axes. Zero clears it.
   */
  setAdditive(bone: BoneName, x: number, y: number, z: number): void {
    if (x === 0 && y === 0 && z === 0) { this.additive.delete(bone); return; }
    let q = this.additive.get(bone);
    if (!q) { q = new THREE.Quaternion(); this.additive.set(bone, q); }
    q.setFromEuler(_addE.set(x, y, z, 'XYZ'));
  }

  /**
   * Hang the animation on its current frame for `seconds` — the contact
   * hit-stop. Only this body's mixer feels it; the world keeps moving.
   */
  freeze(seconds: number): void {
    this.frozen = Math.max(this.frozen, seconds);
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
  /**
   * `scale` is the character's world scale (`CharacterInstance.baseScale`):
   * a bulked-up body's feet really cover scale-times the measured stride, so
   * without it every heavy ran its cycle too fast and skated a little — and
   * with it Paz gets his slower, weightier gait for free.
   */
  gaitRate(name: string, speed: number, scale = 1): number {
    const clip = this.clips[name];
    if (!clip) return 1;
    const d = cycleDistance(clip, this.rig.proportions) * Math.max(0.5, scale);
    if (d <= 1e-4) return 1;
    // the cap is set by the sprint: 14.4 m/s over the sprint clip's ~3.25 m
    // stride wants 2.66, and the old 2.4 had the feet skating a tenth short
    return Math.min(3, Math.max(0.35, (speed * clip.duration) / d));
  }

  /** Seconds between footfalls at the rate `gaitRate` returned (sign-blind, so a reversed back-pedal still steps). */
  stepInterval(name: string, rate: number): number {
    const clip = this.clips[name];
    return clip ? clip.duration / Math.max(0.05, Math.abs(rate)) / 2 : 0.3;
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
    if (/idle/i.test(name)) next.time = this.idlePhase * next.getClip().duration;
    // A zero-length fade has to be a plain cut, not a fade of duration 0: the
    // mixer's weight interpolant reads 0 at the instant it starts, so a clip
    // faded in over 0 s contributes nothing on the very next update and the
    // bones fall back to their bind pose. Harmless mid-run, where the next
    // frame carries the weight to 1 — but the workbench freezes the pose with
    // a single `update(0)` right after playing it, and got a neutral figure.
    if (fade > 0) next.fadeIn(fade); else next.setEffectiveWeight(1);
    next.play();
    if (cur) { const a = this.action(cur); if (fade > 0) a?.fadeOut(fade); else a?.stop(); }
    this.current[channel] = name;
  }

  /** Play a one-shot (melee swing, hit react, death); channel returns to normal after. */
  playOnce(channel: 'lower' | 'upper', name: string, fade = 0.06, clamp = false, timeScale = 1): number {
    const next = this.action(name);
    if (!next) return 0;
    const cur = this.current[channel];
    if (cur && cur !== name) this.action(cur)?.fadeOut(fade);
    next.reset();
    next.setLoop(THREE.LoopOnce, 1);
    // Always clamp: three disables a LoopOnce action outright the instant it
    // reaches its end, and the channel is released 50 ms before that so the
    // loop can fade back in. Unclamped, the last ~0.13 s of every swing, hit
    // react and landing had the loop at partial weight and *nothing* filling
    // the rest — the mixer pads that with the bind pose, so every one-shot
    // ended on a flick toward arms-straight. Clamped, the final frame holds
    // under the fade instead. `clamp` still decides whether the channel is
    // held (the death poses) or handed back on the clip's clock.
    next.clampWhenFinished = true;
    next.timeScale = timeScale;
    next.enabled = true;
    next.fadeIn(fade).play();
    this.current[channel] = name;
    // `timeScale` shortens the clip in wall-clock seconds, so what the caller
    // is told (and what holds the channel) is how long it will really take
    const dur = this.clips[name].duration / Math.max(0.05, timeScale);
    this.oneShotUntil[channel] = this.time + (clamp ? Infinity : dur - 0.05);
    return dur;
  }

  /** The clip currently on a channel, one-shot or loop; null when nothing has been played. */
  playing(channel: 'lower' | 'upper'): string | null {
    return this.current[channel];
  }

  /**
   * How far through its clip the one-shot holding a channel is, 0..1 — or 1
   * when no one-shot holds it (a loop, a released channel, a clamped pose
   * that has run to its end). A re-trigger of the same flinch used to snap
   * the chest back to frame 0 on every shot; callers use this to let a
   * react resolve most of the way before it is allowed to restart.
   */
  oneShotProgress(channel: 'lower' | 'upper'): number {
    if (this.time >= this.oneShotUntil[channel]) return 1;
    const name = this.current[channel];
    const clip = name ? this.clips[name] : null;
    const action = clip && this.mixer.existingAction(clip);
    if (!clip || !action || clip.duration <= 0) return 1;
    return Math.min(1, action.time / clip.duration);
  }

  /**
   * Force-release a channel from a one-shot (e.g. respawn, getting up from a
   * knockdown).
   *
   * The action has to be stopped, not just forgotten. A clamped one-shot holds
   * its last frame at full weight forever, and `play()` only fades out the clip
   * it believes is current — so clearing the bookkeeping alone left a released
   * death pose blending half-and-half against the next locomotion clip, and
   * every enemy that got up from a knockdown ran crumpled for the rest of its
   * life. Looked up rather than created: `invalidate()` releases after
   * uncaching, and re-binding a dropped clip here would put it straight back.
   */
  release(channel: 'lower' | 'upper'): void {
    const cur = this.current[channel];
    if (cur) this.actions.get(cur)?.stop();
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

  /**
   * Seek whatever is playing to an absolute time and apply that pose, without
   * disturbing the blend weights.
   *
   * For a reproducible still — the character select's posters, which have to
   * show the same pose on every regeneration or the pictures churn and the
   * handover to the live model pops. The obvious `mixer.setTime` is wrong for
   * this: it rewinds every action's clock *and* re-runs the crossfade
   * interpolants from zero, which leaves the idle at no weight at all and the
   * rig standing in its bind pose — arms out, weapon jutting. This moves the
   * clock and nothing else.
   */
  poseAt(t: number): void {
    for (const name of [this.current.lower, this.current.upper]) {
      if (!name) continue;
      const clip = this.clips[name];
      const action = clip && this.mixer.existingAction(clip);
      if (!action) continue;
      action.time = clip.duration > 0 ? t % clip.duration : 0;
      // ...and finish the crossfade, which is the half that was missing.
      //
      // `play` fades a clip in over real seconds, and a mixer update of zero
      // seconds does not spend any: an action that has never been stepped sits
      // at no weight at all, so posing it changed nothing and the rig stood in
      // its bind stance — arms flat at the sides. That is the pose every
      // character-select picture was shot in, while the live model beside it
      // stood in the idle with its arms relaxed out. This call means "be at
      // this frame of this clip", so it has to mean the clip is fully on.
      action.enabled = true;
      action.setEffectiveWeight(1);
      action.play();
    }
    this.mixer.update(0);
  }

  update(dt: number): void {
    if (this.frozen > 0) {
      this.frozen -= dt;
      dt *= 0.05;
    }
    this.time += dt;
    const bones = this.rig.bones;
    // take yesterday's offsets back off before the mixer writes today's pose
    for (const [name, q] of this.additive) {
      _addQ.copy(q).invert();
      bones[name]?.quaternion.premultiply(_addQ);
    }
    this.mixer.update(dt);
    for (const [name, q] of this.additive) bones[name]?.quaternion.premultiply(q);
  }
}
