import * as THREE from 'three';
import type { CharacterInstance } from '../characters/builder';
import { buildMandalorian, type MandoId } from '../characters/mandalorians';
import { leanToReach, orientFoot, reachArm, reachLeg, spreadKnees } from '../anim/seating';
import { BANTHA_STRIDE } from '../anim/quadruped';
import {
  buildVehicleMesh, handsFor, measureSeatSurface, SaddleBone, sitOnModel, VEHICLE_DEFS, type VehicleDef,
} from '../game/vehicles';
import { ANKLE_OVER_SOLE, footQuaternion, handFromSeat, hipsOverFeet, stanceRise, VEHICLE_ANCHORS, type V3, type VehicleAnchor } from '../game/vehicleAnchors';
import type { VehicleSpec } from '../world/board';

/**
 * A ride on the turntable with a rider in it: the sculpt, the seat, the grips
 * and the footrests exactly as `Vehicle` puts them in the game, so what is
 * placed here by eye is what a match shows.
 *
 * The frame is the ride's own — the keel is its origin, parked `hover` over
 * the floor — and the anchors live in it: the seat the rider sits on, the grip
 * the left hand (the one that never holds the gun) takes, and the rest the
 * left foot takes. The right hand and foot mirror them across the seat on a
 * machine; on a mount the right hand stays free.
 */
export interface VehicleRig {
  kind: VehicleSpec['kind'];
  def: VehicleDef;
  /** the ride's frame: keel at the origin, +Z forward, +X to the rider's left */
  frame: THREE.Group;
  /** live anchors, frame-local — what the editor drags */
  seat: THREE.Vector3;
  grip: THREE.Vector3;
  /** the left footrest, or null for the riding clip's own legs */
  foot: THREE.Vector3 | null;
  /** what the game would use today: the data file's anchors, or the measured seat and the def's hands */
  defaults: VehicleAnchor;
  /** each knee's distance from the centre line (m), or null for the riding clip's own legs */
  legSpread: number | null;
  /** the rider turned on the seat, and the sculpt on its keel (degrees) */
  yaw: number;
  modelYaw: number;
  /**
   * The anchors turned (degrees, XYZ, Y first), or null where untouched: the
   * seat's X and Z tilt the rider here (its Y is `yaw`), the foot's lays the
   * sole on its rest, and the grip's is only a note.
   */
  seatTilt: [number, number] | null;
  footRotation: V3 | null;
  gripRotation: V3 | null;
  /** the rider's hands are on the grips this frame (a tiller with no grip placed leaves them free) */
  gripped: boolean;
  /** where the clip alone puts the knees (m from the centre line), to start a spread from */
  kneeWidth(): number;
  /** where the clip alone puts the left sole, in the ride's frame, to start a footrest from */
  soleAt(): THREE.Vector3;
  /** re-seat the rider, turn him and the sculpt, and re-pose him after an anchor moved */
  relayout(): void;
}

const _hint = new THREE.Vector3();
const _foot = new THREE.Vector3();
const _frameQ = new THREE.Quaternion();
const _soleQ = new THREE.Quaternion();

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
  // in the pose from the first frame: a workbench opened paused never runs the
  // per-frame update, and would show the rider stood in his bind pose
  rider.animator?.play('lower', lower, 0);
  rider.animator?.play('upper', upper, 0);
  rider.animator?.poseAt(0);

  const data = VEHICLE_ANCHORS[kind] ?? null;
  // until the sculpt answers, the def's own guess at the seat
  const sit0 = data ? data.seat[1] : def.seat.y + stanceRise(stance, 0.95);
  let model: THREE.Object3D | null = null;
  let saddle: SaddleBone | null = null;
  let time = 0;
  const vr: VehicleRig = {
    kind, def, frame,
    seat: new THREE.Vector3(...(data ?? defaultAnchors(def, sit0)).seat),
    grip: new THREE.Vector3(...(data ?? defaultAnchors(def, sit0)).grip),
    foot: data?.foot ? new THREE.Vector3(...data.foot) : null,
    defaults: data ?? defaultAnchors(def, sit0),
    legSpread: data?.legSpread ?? null,
    yaw: data?.yaw ?? 0,
    modelYaw: data?.modelYaw ?? 0,
    gripped: false,
    seatTilt: data?.seatRotation && (data.seatRotation[0] || data.seatRotation[2])
      ? [data.seatRotation[0], data.seatRotation[2]] : null,
    footRotation: data?.footRotation ?? null,
    gripRotation: data?.gripRotation ?? null,
    kneeWidth: () => {
      const rig = rider.rig;
      if (!rig) return 0.2;
      const thigh = new THREE.Vector3(0, -1, 0).applyQuaternion(rig.bones.upperLegL.quaternion);
      return +((rig.proportions.hipWidth + rig.proportions.upperLegLen * thigh.x) * rig.root.scale.x).toFixed(3);
    },
    soleAt: () => {
      const rig = rider.rig;
      if (!rig) return vr.seat.clone().add(new THREE.Vector3(0.2, -0.4, 0.2));
      root.updateMatrixWorld(true);
      const ankle = frame.worldToLocal(rig.bones.footL.getWorldPosition(new THREE.Vector3()));
      return ankle.setY(ankle.y - ANKLE_OVER_SOLE);
    },
    relayout: () => {
      place();
      // the sculpt turned on its keel: the def's own turn plus the anchors'
      if (model) model.rotation.y = (def.modelYaw ?? 0) + THREE.MathUtils.degToRad(vr.modelYaw);
      // a mount's saddle goes under wherever the seat is (the same as the measured placement when untouched)
      if (landed) sitOnModel(body, undefined, { seat: vr.seat.toArray() as V3, grip: vr.grip.toArray() as V3 });
      pose(0);
    },
  };
  let landed = false;

  /** the rider on the seat, turned on it, carried with a walking mount's back */
  const place = (): void => {
    const rise = stanceRise(stance, hipsOverFeet(rider));
    rider.root.position.set(vr.seat.x, vr.seat.y - rise, vr.seat.z);
    if (saddle) rider.root.position.add(saddle.shift);
    const d = THREE.MathUtils.DEG2RAD;
    rider.root.rotation.set((vr.seatTilt?.[0] ?? 0) * d, vr.yaw * d, (vr.seatTilt?.[1] ?? 0) * d, 'YXZ');
  };
  /** a point in the ride's frame, carried with the mount's back, in the world */
  const world = (x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 => {
    out.set(x, y, z);
    if (saddle) out.add(saddle.shift);
    return frame.localToWorld(out);
  };

  /**
   * The rider's frame, in the game's order: the riding clip, the legs to the
   * footrests (or opened to the spread), the hands to the grips — and only
   * then the pose carried onto the sculpt, so what the solves did is what
   * shows. Run with dt 0 after an edit, so a paused turntable shows it too.
   */
  const pose = (dt: number): void => {
    rider.animator?.play('lower', lower, dt > 0 ? 0.2 : 0);
    rider.animator?.play('upper', upper, dt > 0 ? 0.2 : 0);
    // a zero step still writes the clip back over whatever the solves left
    rider.animator?.update(dt);
    const rig = rider.rig;
    if (rig) {
      root.updateMatrixWorld(true);
      if (vr.foot) {
        const spread = vr.legSpread ?? 0.25;
        for (const side of [1, -1] as const) {
          world(vr.seat.x + side * (vr.foot.x - vr.seat.x), vr.foot.y + ANKLE_OVER_SOLE, vr.foot.z, _foot);
          world(vr.seat.x + side * spread, vr.seat.y + 0.1, vr.seat.z + 0.45, _hint);
          reachLeg(rig, side === 1 ? 'L' : 'R', _foot, _hint);
          // the sole as the footrest's rotation lays it, as the game does
          if (vr.footRotation) {
            frame.getWorldQuaternion(_frameQ);
            orientFoot(rig, side === 1 ? 'L' : 'R', footQuaternion(_frameQ, vr.footRotation, side, _soleQ));
          }
        }
      } else if (vr.legSpread !== null) {
        spreadKnees(rig, vr.legSpread);
      }
      hands();
    }
    rider.cosmetic?.(dt, time);
  };

  const hands = (): void => {
    // A ride the game gives no grip to (the skiff's tiller) keeps its hands
    // free here too, until a grip is placed for it — then it is what the
    // game will do once the anchor is exported.
    const placed = vr.grip.toArray().some((n, i) => Math.abs(n - vr.defaults.grip[i]) > 1e-6);
    vr.gripped = false;
    if (!def.hands && !VEHICLE_ANCHORS[kind] && !placed) return;
    const hold = handsFor(def, { seat: vr.seat.toArray() as V3, grip: vr.grip.toArray() as V3 });
    const rig = rider.rig;
    if (!hold || !rig) return;
    vr.gripped = true;
    root.updateMatrixWorld(true);
    const yaw = THREE.MathUtils.degToRad(vr.yaw);
    const grips: Array<{ side: 'L' | 'R'; at: THREE.Vector3; hint: THREE.Vector3 }> = [];
    for (const side of [-1, 1] as const) {
      if (hold.only === 'left' && side !== 1) continue;
      // mirrored across the rider's own midline, as the game does it
      const h = handFromSeat(hold, side, yaw, hold.only !== 'left', new THREE.Vector3());
      const at = world(vr.seat.x + h.x, vr.seat.y + h.y, vr.seat.z + h.z, new THREE.Vector3());
      // the elbow outboard of the bar and a little below it, in the rider's frame
      const hint = world(vr.seat.x + h.x + side * 0.55 * Math.cos(yaw), vr.seat.y + h.y - 0.42,
        vr.seat.z + h.z - side * 0.55 * Math.sin(yaw), new THREE.Vector3());
      grips.push({ side: side === 1 ? 'L' : 'R', at, hint });
    }
    // bend forward to a grip past arm's reach, then put the hands on it
    leanToReach(rig, grips);
    for (const { side, at, hint } of grips) reachArm(rig, side, at, hint);
  };

  // a living mount walks its own clips, blended by the speed it is given
  let mixer: THREE.AnimationMixer | null = null;
  let idle: THREE.AnimationAction | null = null;
  let walk: THREE.AnimationAction | null = null;
  let stride = BANTHA_STRIDE;
  let speed = 0;
  let settled = false;
  buildVehicleMesh(kind, body, (loaded) => {
    model = loaded.parent ?? loaded;
    if (!data) {
      // the game's own measurement: the seat column's surface, the saddle laid on it
      const surface = measureSeatSurface(kind, loaded, frame);
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
    const clips = (loaded.userData.clips ?? []) as THREE.AnimationClip[];
    const pick = (re: RegExp): THREE.AnimationClip | undefined => clips.find((c) => re.test(c.name));
    mixer = new THREE.AnimationMixer(loaded);
    const i = pick(/idle|breath|stand/i), w = pick(/walk|amble|trot/i);
    if (i) { idle = mixer.clipAction(i); idle.play(); }
    if (w) { walk = mixer.clipAction(w); walk.play(); walk.setEffectiveWeight(0); stride = BANTHA_STRIDE / Math.max(w.duration, 0.2); }
    // measured at rest, before the gait takes a step, as the game does it
    saddle = new SaddleBone(loaded, frame, vr.seat.clone());
  }, () => { settled = true; });
  vr.relayout();
  root.userData.vehicleRig = vr;

  return {
    root, rig: null, animator: null, height: Math.max(def.body, 2), baseScale: 1,
    modelReady: () => settled && (rider.modelReady?.() ?? true),
    // a ride takes a speed like a creature does: the mount walks, a machine hums
    setGait: (v: number) => { speed = v; },
    cosmetic: (dt, t) => {
      time = t;
      if (mixer) {
        const moving = Math.min(1, speed / 2);
        idle?.setEffectiveWeight(1 - moving);
        if (walk) {
          walk.setEffectiveWeight(moving);
          walk.timeScale = Math.min(2.4, Math.max(0.25, speed / Math.max(stride, 0.1)));
        }
        mixer.update(dt);
        // the back moved under the saddle: the rider goes with it
        saddle?.update();
        place();
      } else if (!def.living) {
        // a parked repulsor hull breathes on its field, harder at speed
        const run = Math.min(1, speed / 12);
        frame.position.y = def.hover + Math.sin(t * (2.2 + run * 3)) * (0.025 + run * 0.02);
        frame.rotation.x = run * 0.05;
      }
      pose(dt);
    },
  } as CharacterInstance;
}
