import * as THREE from 'three';
import type { SaberLightMode } from '../config';
import type { SaberLightSpec } from '../characters/builder';

/**
 * The lights player sabers cast, lent from a pool that never changes size.
 *
 * Three.js compiles a material for the number of lights in the scene, so a
 * light that comes or goes recompiles every material there is. When each
 * blade carried its own light, drawing a pair of sabers, stowing them or
 * throwing one changed that number, and the first time any given number came
 * up the next frame froze for about a second while everything recompiled
 * (measured: 0.9-1.2 s under software GL, a visible hitch on real hardware).
 * Two players with sabers walked through most of the possible counts in the
 * first minutes of a match.
 *
 * So the pool is made once, when the match is: one light for every blade the
 * players can hold out at once, all in the scene from the start. A light no
 * blade needs is left at intensity zero rather than taken away — the count is
 * what costs, not the brightness — and every frame the lights are moved onto
 * whichever blades are out: in a hand, or in flight.
 *
 * Only player blades get one. A rival's saber is drawn exactly as brightly,
 * but it does not light the ground under it; hostiles come and go all match,
 * and a pool sized for them would be lights every fragment pays for whether
 * there is a rival on the board or not.
 *
 * `auto` (the default setting) gives the lights up for the rest of the session
 * if frames run long for a sustained stretch. They are a nicety, and on a
 * machine that is already struggling the four lights a two-saber pair asks
 * every lit surface to evaluate are the first thing worth handing back.
 */
export class SaberLights {
  readonly lights: THREE.PointLight[] = [];
  /** why the pool is empty, when it is: a setting, or the frame rate */
  disabledBy: 'setting' | 'framerate' | null = null;
  private slowFor = 0;

  constructor(private scene: THREE.Scene, private size: number, mode: SaberLightMode) {
    if (mode === 'off') this.disabledBy = 'setting';
    else this.build();
  }

  private build(): void {
    for (let i = 0; i < this.size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 5.5, 2);
      light.castShadow = false;
      this.scene.add(light);
      this.lights.push(light);
    }
  }

  private clear(): void {
    for (const light of this.lights) {
      this.scene.remove(light);
      light.dispose();
    }
    this.lights.length = 0;
  }

  /**
   * Follow a change of setting mid-match. Turning the lights on or off is the
   * one time the count moves, and so the one recompile: once, at the player's
   * asking, rather than every time a blade is drawn.
   */
  setMode(mode: SaberLightMode): void {
    if (mode === 'off') {
      if (this.lights.length) this.clear();
      this.disabledBy = 'setting';
    } else if (mode === 'on' || this.disabledBy === 'setting') {
      if (!this.lights.length) this.build();
      this.disabledBy = null;
      this.slowFor = 0;
    }
  }

  /**
   * Watch the real frame time for `auto`. Half a second of frames slower than
   * 25 a second is noise — a spawn, a stage raising behind its veil — but four
   * seconds of it is a machine that is not keeping up, and the pool goes.
   */
  watch(realDt: number, mode: SaberLightMode): void {
    if (mode !== 'auto' || !this.lights.length) return;
    this.slowFor = realDt > 1 / 25 ? this.slowFor + realDt : Math.max(0, this.slowFor - realDt * 2);
    if (this.slowFor > 4) {
      this.clear();
      this.disabledBy = 'framerate';
      console.info('saber lights: off for this session — frames were running slow');
    }
  }

  /** Put the pool on the blades that are out, and dim the rest to nothing. */
  sync(blades: readonly THREE.Object3D[]): void {
    let used = 0;
    for (const blade of blades) {
      if (used >= this.lights.length) break;
      const spec = blade.userData.saberLight as SaberLightSpec | undefined;
      if (!spec || !shownInScene(blade, this.scene)) continue;
      const light = this.lights[used++];
      blade.updateWorldMatrix(true, false);
      light.position.set(0, spec.y, 0).applyMatrix4(blade.matrixWorld);
      light.color.setHex(spec.color);
      // a charging strike brightens the blade (src/game/chargeAttack.ts)
      light.intensity = spec.intensity * (1 + ((blade.userData.chargeGlow as number | undefined) ?? 0));
    }
    for (let i = used; i < this.lights.length; i++) this.lights[i].intensity = 0;
  }

  dispose(): void {
    this.clear();
  }
}

/** visible all the way up to the scene, and attached to it at all */
function shownInScene(o: THREE.Object3D, scene: THREE.Scene): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (!p.visible) return false;
    if (p === scene) return true;
  }
  return false;
}

/** every blade under `root` that asks for a light, whether or not it is out */
export function collectLitBlades(root: THREE.Object3D, out: THREE.Object3D[]): void {
  root.traverse((o) => { if (o.userData.saberLight) out.push(o); });
}
