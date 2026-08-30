import * as THREE from 'three';
import { makeBladeTrail, makeSaber, mat } from '../characters/builder';
import { audio } from '../core/audio';
import type { Combatant, Enemy } from '../enemies/enemy';
import type { Game } from '../game/game';
import type { Player } from './player';

/**
 * A lightsaber in flight (Ventress's RT). The blade leaves the hand spinning
 * flat like a thrown disc, sails out for as long as the trigger stays down,
 * and comes home the moment it is released. Two of these exist at most — one
 * per hand — and while one is out that hand is empty, which the Player feeds
 * back into melee and deflection.
 */

/** outbound flight speed */
const THROW_SPEED = 26;
/** homing speed on the way back — faster than out, so a recall feels eager */
const RETURN_SPEED = 32;
/** metres of travel before an out blade stalls and hovers instead */
const MAX_RANGE = 30;
/** spin, rad/s — a touch over three revolutions a second */
const SPIN_RATE = 21;
/** reach of the spinning blade circle around its centre */
const BLADE_RADIUS = 1.05;
/** seconds between cuts on the same target, so a pass slices rather than liquefies */
const HIT_CD = 0.4;
/** how close to the hand the blade must come to be caught */
const CATCH_RADIUS = 1.3;

export type ThrowState = 'held' | 'out' | 'return';

export class ThrownSaber {
  /** 'held' = back in (or never left) the hand; the spinner is hidden */
  state: ThrowState = 'held';
  private spinner = new THREE.Group();
  private saber: THREE.Group;
  private trail: (dt: number, active: boolean) => void;
  private dir = new THREE.Vector3();
  private traveled = 0;
  /** true once the blade has met a wall or its range and hovers in place */
  private stalled = false;
  private spin = 0;
  /** per-target cut spacing */
  private hitCd = new Map<Combatant, number>();
  private toHand = new THREE.Vector3();

  /**
   * @param host scene-level container at identity — the trail converts world
   *   samples into the host's space, so the host must not move
   * @param opts.light one point light per wielder is the budget; the main
   *   hand's throw carries it, the off-hand's flies unlit (same rule as the
   *   blades in hand)
   */
  constructor(host: THREE.Group, opts: { light?: boolean } = {}) {
    const silver = mat(0x9aa0a2, { rough: 0.35, metal: 0.7 });
    const dark = mat(0x232323, { rough: 0.6, metal: 0.3 });
    this.saber = makeSaber(silver, dark, { light: opts.light });
    // lay the blade flat and centre it on the spin axis, so the whole thing
    // wheels about its middle rather than swinging around the hilt
    const len = (this.saber.userData.bladeLen as number) ?? 0.9;
    this.saber.rotation.z = Math.PI / 2;   // blade +Y now points along -X
    this.saber.position.x = len * 0.5;
    this.spinner.add(this.saber);
    this.spinner.visible = false;
    host.add(this.spinner);
    this.trail = makeBladeTrail(host, this.saber);
  }

  launch(from: THREE.Vector3, dir: THREE.Vector3): void {
    this.state = 'out';
    this.spinner.position.copy(from);
    this.dir.copy(dir).normalize();
    this.traveled = 0;
    this.stalled = false;
    this.spinner.visible = true;
    this.hitCd.clear();
  }

  /** turn for home; a blade already returning stays returning */
  recall(): void {
    if (this.state === 'out') this.state = 'return';
  }

  /** snap straight back into the hand with no flight (respawn cleanup) */
  reset(): void {
    this.state = 'held';
    this.spinner.visible = false;
  }

  /**
   * Fly, cut whatever the blade circle sweeps through, and come home.
   * Returns true on the frame the owner's hand closes around it again.
   */
  update(dt: number, game: Game, owner: Player, catchPoint: THREE.Vector3): boolean {
    if (this.state === 'held') return false;
    this.spin += dt * SPIN_RATE;
    this.spinner.rotation.y = this.spin;

    if (this.state === 'out') {
      if (!this.stalled) {
        const step = THROW_SPEED * dt;
        // world geometry stops the advance: the blade hovers there, spinning,
        // until the trigger lets it come home
        const hit = game.board.physics.raycast(this.spinner.position, this.dir, step + 0.5);
        if (hit) {
          this.stalled = true;
          this.spinner.position.copy(hit.point).addScaledVector(this.dir, -0.5);
        } else {
          this.spinner.position.addScaledVector(this.dir, step);
          this.traveled += step;
          if (this.traveled >= MAX_RANGE) this.stalled = true;
        }
      }
    } else {
      // homing back to the hand — pulled through anything in the way
      this.toHand.copy(catchPoint).sub(this.spinner.position);
      const d = this.toHand.length();
      if (d <= Math.max(CATCH_RADIUS, RETURN_SPEED * dt)) {
        this.state = 'held';
        this.spinner.visible = false;
        this.trail(dt, false);
        return true;
      }
      this.spinner.position.addScaledVector(this.toHand.normalize(), RETURN_SPEED * dt);
    }
    this.trail(dt, true);

    // the sweep: hostiles inside the blade circle take a cut on a per-target
    // beat, out and back alike
    for (const [k, v] of this.hitCd) {
      const nv = v - dt;
      if (nv <= 0) this.hitCd.delete(k); else this.hitCd.set(k, nv);
    }
    for (const e of game.hostilesFor(owner)) {
      if (!e.alive || this.hitCd.has(e)) continue;
      const dx = e.position.x - this.spinner.position.x;
      const dy = e.position.y + e.height * 0.5 - this.spinner.position.y;
      const dz = e.position.z - this.spinner.position.z;
      const r = BLADE_RADIUS + e.radius;
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      this.hitCd.set(e, HIT_CD);
      const wasAlive = e.alive;
      e.damage(owner.profile.meleeDamage, this.spinner.position, owner.slot);
      (e as Partial<Enemy> & typeof e).knockback?.(this.spinner.position, 7, 0.25);
      audio.meleeHit('sabers');
      game.hitMarker(owner.slot);
      // a saber kill is a melee kill: same fuel refund as a landed swing
      if (wasAlive && !e.alive) owner.fuel = Math.min(1, owner.fuel + 0.4);
    }
    return false;
  }
}
