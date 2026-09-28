/**
 * K4 — the hazard front (docs/SECTIONS_IMPLEMENTATION.md §3).
 *
 * Something that advances on a clock and will kill you if you let it: magma
 * rising up a chimney, a pier collapsing behind you, an avalanche down a
 * chute. Two shapes of it: a `RisingPlane` (a height) and a `PathFront` (a
 * distance along a route). Both only *move*; what they do to a body that
 * meets them, and what they look like, is the section's.
 *
 * Every front can be paused (a valve, a stagger), surged (the finale),
 * pushed back (a hit that makes it recoil) and reset (a wipe returns it to a
 * point below the last checkpoint, so the retry starts with breathing room).
 */
export class RisingPlane {
  /** the surface height now */
  y: number;
  private pauseT = 0;
  private surgeT = 0;
  private surgeRate = 0;
  private startT: number;

  /**
   * @param y0    where it starts
   * @param rate  metres a second it rises at
   * @param delay seconds before it starts to move
   */
  constructor(y0: number, public rate: number, delay = 0) {
    this.y = y0;
    this.startT = delay;
  }

  get paused(): boolean { return this.pauseT > 0; }
  get surging(): boolean { return this.surgeT > 0; }
  /** seconds of pause left */
  get pauseLeft(): number { return this.pauseT; }
  /** the rate it is moving at right now, metres a second */
  get speed(): number {
    if (this.startT > 0 || this.pauseT > 0) return 0;
    return this.surgeT > 0 ? this.surgeRate : this.rate;
  }

  update(dt: number): void {
    if (this.startT > 0) { this.startT -= dt; return; }
    if (this.pauseT > 0) { this.pauseT -= dt; return; }
    this.y += this.speed * dt;
    if (this.surgeT > 0) this.surgeT -= dt;
  }

  /** hold still for `secs` (stacks with what is left, capped at twice it) */
  pause(secs: number): void { this.pauseT = Math.min(secs * 2, this.pauseT + secs); }
  /** rise at `rate` for `secs` */
  surge(rate: number, secs: number): void { this.surgeRate = rate; this.surgeT = secs; }
  /** sink by `m` (never below `floor`) */
  pushBack(m: number, floor = -Infinity): void { this.y = Math.max(floor, this.y - m); }
  /** back to `y`, with `delay` seconds before it moves again */
  resetTo(y: number, delay = 3): void {
    this.y = y;
    this.pauseT = 0;
    this.surgeT = 0;
    this.startT = delay;
  }
}

/**
 * A front advancing along a route, measured as distance along it. The route
 * itself (a pier chain, a chute) is the section's; this is just the clock
 * that eats it.
 */
export class PathFront {
  /** metres along the route the front has reached */
  at: number;
  private pauseT = 0;
  private startT: number;

  constructor(at0: number, public speed: number, delay = 0) {
    this.at = at0;
    this.startT = delay;
  }

  update(dt: number): void {
    if (this.startT > 0) { this.startT -= dt; return; }
    if (this.pauseT > 0) { this.pauseT -= dt; return; }
    this.at += this.speed * dt;
  }

  pause(secs: number): void { this.pauseT = Math.max(this.pauseT, secs); }
  pushBack(m: number, floor = 0): void { this.at = Math.max(floor, this.at - m); }
  resetTo(at: number, delay = 3): void { this.at = at; this.pauseT = 0; this.startT = delay; }
}
