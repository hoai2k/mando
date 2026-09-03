import * as THREE from 'three';
import { audio } from '../core/audio';
import type { Board } from './board';
import type { StaticBox } from '../core/physics';
import { mat } from '../characters/builder';
import { buildDoorFrame } from './corridor';

/**
 * The blast door, shared by both Missions level designs.
 *
 * It began in the room chain (`world/mission-legacy.ts`) and the outdoor
 * stages (`world/mission.ts`) want exactly the same thing — a doorway that is
 * shut until progress opens it, and that is never passable while it still
 * looks shut — so it lives here rather than in either of them. The outdoor
 * builder subclasses it for the wall hatches a hall's waves come out of and
 * for the transport doors between stages.
 */

/** the doorway's clear width, metres */
export const GATE_W = 3.8;
/** how long a leaf takes to run its full travel, seconds */
const GATE_SLIDE = 0.75;
/** past this much travel the doorway is clear enough to walk and shoot through */
const GATE_CLEAR = 0.82;

/**
 * Anything that can stand in the way and then get out of it: a blast door, an
 * energy fence across a canyon mouth, a crate barricade across a road. The
 * campaign drives all three through this surface alone.
 */
export interface Barrier {
  readonly closed: boolean;
  readonly open_: boolean;
  readonly pos: THREE.Vector3;
  open(): void;
  close(): void;
  update(dt: number): void;
  /**
   * Take every collider this barrier has in the world back out, now.
   *
   * `open()` is not enough for a teardown: it asks the leaves to travel and
   * the blocker only lifts once they have, so a stage disposed mid-slide
   * would leave an invisible wall standing in the next one.
   */
  retire(): void;
}

/**
 * A blast door in a doorway: a frame, two leaves that part down the middle,
 * and a physics blocker that stands while they are anything but open.
 *
 * Shut is the resting state. The doorway is a full-height gap in a real wall,
 * so a door that is only a decorative frame is a hole you can shoot and walk
 * through — which is what these were. The leaves fill the whole opening, not
 * just the frame's 3.6 m, so nothing passes over the top of them either.
 *
 * The blocker is tied to the animation rather than to the request: it goes in
 * the moment a door starts to close and only comes out once the leaves have
 * actually cleared the way, so a door is never passable while it still looks
 * shut.
 */
export class Gate implements Barrier {
  pos: THREE.Vector3;
  private box: StaticBox | null = null;
  private leaves: THREE.Mesh[] = [];
  private seam: THREE.Mesh;
  private half: THREE.Vector3;
  /** 0 = shut, 1 = fully retracted */
  private t = 0;
  private want = 0;
  private travel: number;
  private leafW: number;

  constructor(private board: Board, parent: THREE.Object3D, pos: THREE.Vector3,
    dir: { x: number; z: number }, wallH: number, accent: number,
    opts: { width?: number } = {}) {
    this.pos = pos.clone();
    const gateW = opts.width ?? GATE_W;
    const yaw = Math.atan2(dir.x, dir.z);
    buildDoorFrame(parent, pos.clone(), yaw, { leaf: false });
    // blocker half-extents: thin along the travel axis, spanning the gap
    const across = gateW / 2 + 0.5;
    this.half = new THREE.Vector3(
      dir.x !== 0 ? 0.45 : across, wallH / 2 + 0.5, dir.x !== 0 ? across : 0.45);

    // Leaves live in a group turned to the doorway, so a leaf slides along its
    // own local X whichever way the level's turtle was facing when it was built.
    const hub = new THREE.Group();
    hub.position.copy(pos);
    hub.rotation.y = yaw;
    parent.add(hub);
    const leafW = gateW / 2;
    this.leafW = leafW;
    this.travel = leafW + 0.25;
    const skin = mat(0x53585f, { rough: 0.55, metal: 0.7 });
    const trim = mat(accent, { rough: 0.4, metal: 0.6 });
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, wallH, 0.36), skin);
      leaf.position.set(side * leafW / 2, wallH / 2, 0);
      leaf.castShadow = leaf.receiveShadow = true;
      hub.add(leaf);
      this.leaves.push(leaf);
      // a band of accent near the meeting edge, so the parting reads at a
      // glance — local to the leaf, so it travels with it
      const band = new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.55, 0.22, 0.44), trim);
      band.position.set(-side * leafW * 0.18, wallH * 0.06, 0);
      leaf.add(band);
    }
    this.seam = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, wallH - 0.3),
      new THREE.MeshBasicMaterial({
        color: accent, transparent: true, opacity: 0.75,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
    this.seam.position.set(0, wallH / 2, 0.2);
    hub.add(this.seam);
    this.shutNow();
  }

  /** the doorway is not passable — shut, or still on the move */
  get closed(): boolean { return this.box !== null; }
  /** fully retracted and staying that way */
  get open_(): boolean { return this.t >= 1 && this.want >= 1; }

  /** shut without the animation, for the level's initial state */
  private shutNow(): void {
    this.t = 0;
    this.want = 0;
    this.place();
    this.block(true);
  }

  close(): void { this.want = 0; this.block(true); }
  open(): void {
    if (this.want !== 1) audio.doorCycle();   // only the transition speaks
    this.want = 1;
  }

  retire(): void { this.block(false); }

  update(dt: number): void {
    if (this.t === this.want) return;
    const step = dt / GATE_SLIDE;
    this.t = this.want > this.t
      ? Math.min(this.want, this.t + step)
      : Math.max(this.want, this.t - step);
    this.place();
    this.block(this.t < GATE_CLEAR);
  }

  private place(): void {
    // ease out, so a heavy door slams off the mark and settles into its pocket
    const e = 1 - (1 - this.t) * (1 - this.t);
    for (let i = 0; i < this.leaves.length; i++) {
      const side = i === 0 ? -1 : 1;
      this.leaves[i].position.x = side * (this.leafW / 2 + e * this.travel);
    }
    this.seam.visible = this.t < 0.05;
  }

  private block(on: boolean): void {
    if (on === (this.box !== null)) return;
    if (on) {
      this.box = this.board.physics.addBox(
        this.pos.x, this.pos.y + this.half.y, this.pos.z,
        this.half.x * 2, this.half.y * 2, this.half.z * 2);
    } else {
      const boxes = this.board.physics.boxes;
      const i = boxes.indexOf(this.box!);
      if (i >= 0) boxes.splice(i, 1);
      this.box = null;
    }
  }
}

