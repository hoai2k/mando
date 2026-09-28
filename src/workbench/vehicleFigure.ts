import * as THREE from 'three';
import type { CharacterInstance } from '../characters/builder';
import { buildMandalorian, type MandoId } from '../characters/mandalorians';
import { reachArm } from '../anim/seating';
import { BANTHA_STRIDE } from '../anim/quadruped';
import { buildVehicleMesh, handsFor, measureSeatSurface, sitOnModel, VEHICLE_DEFS, type VehicleDef } from '../game/vehicles';
import { hipsOverFeet, stanceRise, VEHICLE_ANCHORS, type V3, type VehicleAnchor } from '../game/vehicleAnchors';
import type { VehicleSpec } from '../world/board';

/**
 * A ride on the turntable with a rider in it: the sculpt, the seat and the
 * grips exactly as `Vehicle` puts them in the game, so what is placed here by
 * eye is what a match shows.
 *
 * The frame is the ride's own — the keel is its origin, parked `hover` over
 * the floor — and the two anchors live in it: the seat the rider sits on, and
 * the grip the left hand (the one that never holds the gun) takes. The right
 * hand mirrors it across the seat on a machine; on a mount it stays free.
 */
export interface VehicleRig {
  kind: VehicleSpec['kind'];
  def: VehicleDef;
  /** the ride's frame: keel at the origin, +Z forward, +X to the rider's left */
  frame: THREE.Group;
  /** live anchors, frame-local — what the editor drags */
  seat: THREE.Vector3;
  grip: THREE.Vector3;
  /** what the game would use today: the data file's anchors, or the measured seat and the def's hands */
  defaults: VehicleAnchor;
  /** re-seat the rider and re-reach the hands after the anchors moved */
  relayout(): void;
}

const _grip = new THREE.Vector3();
const _hint = new THREE.Vector3();

/** the anchors a ride would have with nothing placed by hand: the def's seat on the measured surface */
function defaultAnchors(def: VehicleDef, sit: number): VehicleAnchor {
  const g = def.hands ?? { x: 0.25, y: 0.3, z: 0.3 };
  return {
    seat: [def.seat.x, sit, def.seat.z],
    grip: [def.seat.x + g.x, sit + g.y, def.seat.z + g.z],
  };
}

export function buildVehicleFigure(kind: VehicleSpec['kind'], riderId: MandoId = 'din'): CharacterInstance {
  const def = VEHICLE_DEFS[kind];
  const root = new THREE.Group();
  const frame = new THREE.Group();
  frame.position.y = def.hover;
  root.add(frame);
  const body = new THREE.Group();
  frame.add(body);

  const rider = buildMandalorian(riderId);
  rider.setWeapon('none');
  frame.add(rider.root);
  const stance = def.stance;
  const lower = stance === 'stand' ? 'idleLower' : stance === 'seated' ? 'driveLower' : 'rideLower';
  const upper = stance === 'stand' ? 'idleUpper' : stance === 'seated' ? 'driveUpper' : 'rideUpper';

  const data = VEHICLE_ANCHORS[kind] ?? null;
  // until the sculpt answers, the def's own guess at the seat
  const sit0 = data ? data.seat[1] : def.seat.y + stanceRise(stance, 0.95);
  const vr: VehicleRig = {
    kind, def, frame,
    seat: new THREE.Vector3(...(data ?? defaultAnchors(def, sit0)).seat),
    grip: new THREE.Vector3(...(data ?? defaultAnchors(def, sit0)).grip),
    defaults: data ?? defaultAnchors(def, sit0),
    relayout: () => {
      const rise = stanceRise(stance, hipsOverFeet(rider));
      rider.root.position.set(vr.seat.x, vr.seat.y - rise, vr.seat.z);
      // a mount's saddle goes under wherever the seat is (the same as the measured placement when untouched)
      if (landed) sitOnModel(body, undefined, { seat: vr.seat.toArray() as V3, grip: vr.grip.toArray() as V3 });
    },
  };
  let landed = false;

  // a living mount walks its own clips, blended by the speed it is given
  let mixer: THREE.AnimationMixer | null = null;
  let idle: THREE.AnimationAction | null = null;
  let walk: THREE.AnimationAction | null = null;
  let stride = BANTHA_STRIDE;
  let speed = 0;
  let settled = false;
  buildVehicleMesh(kind, body, (model) => {
    if (!data) {
      // the game's own measurement: the seat column's surface, the saddle laid on it
      const surface = measureSeatSurface(kind, model, frame);
      if (surface !== null) {
        const sit = sitOnModel(body, surface, null);
        vr.defaults = defaultAnchors(def, sit);
        vr.seat.set(...vr.defaults.seat);
        vr.grip.set(...vr.defaults.grip);
      }
    }
    landed = true;
    vr.relayout();
    if (!def.living) return;
    const clips = (model.userData.clips ?? []) as THREE.AnimationClip[];
    const pick = (re: RegExp): THREE.AnimationClip | undefined => clips.find((c) => re.test(c.name));
    mixer = new THREE.AnimationMixer(model);
    const i = pick(/idle|breath|stand/i), w = pick(/walk|amble|trot/i);
    if (i) { idle = mixer.clipAction(i); idle.play(); }
    if (w) { walk = mixer.clipAction(w); walk.play(); walk.setEffectiveWeight(0); stride = BANTHA_STRIDE / Math.max(w.duration, 0.2); }
  }, () => { settled = true; });
  vr.relayout();
  root.userData.vehicleRig = vr;

  const hands = (): void => {
    // A ride the game gives no grip to (the skiff's tiller) keeps its hands
    // free here too, until a grip is placed for it — then it is what the
    // game will do once the anchor is exported.
    const placed = vr.grip.toArray().some((n, i) => Math.abs(n - vr.defaults.grip[i]) > 1e-6);
    if (!def.hands && !VEHICLE_ANCHORS[kind] && !placed) return;
    const hold = handsFor(def, { seat: vr.seat.toArray() as V3, grip: vr.grip.toArray() as V3 });
    const rig = rider.rig;
    if (!hold || !rig) return;
    root.updateMatrixWorld(true);
    for (const side of [-1, 1] as const) {
      if (hold.only === 'left' && side !== 1) continue;
      frame.localToWorld(_grip.set(vr.seat.x + side * hold.x, vr.seat.y + hold.y, vr.seat.z + hold.z));
      // the elbow outboard of the bar and a little below it, as the game does it
      frame.localToWorld(_hint.set(vr.seat.x + side * (hold.x + 0.55), vr.seat.y + hold.y - 0.42, vr.seat.z + hold.z));
      reachArm(rig, side === 1 ? 'L' : 'R', _grip, _hint);
    }
  };

  return {
    root, rig: null, animator: null, height: Math.max(def.body, 2), baseScale: 1,
    modelReady: () => settled && (rider.modelReady?.() ?? true),
    // a ride takes a speed like a creature does: the mount walks, a machine hums
    setGait: (v: number) => { speed = v; },
    cosmetic: (dt, time) => {
      rider.animator?.play('lower', lower, 0.2);
      rider.animator?.play('upper', upper, 0.2);
      rider.animator?.update(dt);
      rider.cosmetic?.(dt, time);
      if (mixer) {
        const moving = Math.min(1, speed / 2);
        idle?.setEffectiveWeight(1 - moving);
        if (walk) {
          walk.setEffectiveWeight(moving);
          walk.timeScale = Math.min(2.4, Math.max(0.25, speed / Math.max(stride, 0.1)));
        }
        mixer.update(dt);
      } else if (!def.living) {
        // a parked repulsor hull breathes on its field, harder at speed
        const run = Math.min(1, speed / 12);
        frame.position.y = def.hover + Math.sin(time * (2.2 + run * 3)) * (0.025 + run * 0.02);
        frame.rotation.x = run * 0.05;
      }
      hands();
    },
  } as CharacterInstance;
}
