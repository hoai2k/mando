import * as THREE from 'three';
import type { Board } from '../board';
import type { StaticBox, StaticCylinder } from '../../core/physics';
import { mat } from '../../characters/builder';
import { authoredProp } from '../props';
import { loadOptionalTexture } from '../../core/assets';
import { Gate, GATE_W, type Barrier } from '../gate';

// ---------------------------------------------------------------- barriers

/**
 * An energy fence across an outdoor mouth: two pylons and a pane between them.
 *
 * Outdoors a slab of metal across a canyon reads as a mistake, but the fight
 * still has to be held in — so a mouth that seals gets this instead. It spans
 * the whole gap up to the ceiling, because a pane you can hop is not a seal.
 */
export class Fence implements Barrier {
  pos: THREE.Vector3;
  private box: StaticBox | null = null;
  private pane: THREE.Mesh;
  private caps: THREE.Mesh[] = [];
  private t = 1;
  private want = 1;
  private half: THREE.Vector3;
  private forward: { x: number; z: number };
  private cylinders: StaticCylinder[] = [];

  constructor(private board: Board, parent: THREE.Object3D, pos: THREE.Vector3,
    dir: { x: number; z: number }, width: number, height: number, accent: number) {
    this.pos = pos.clone();
    this.forward = { x: dir.x, z: dir.z };
    const across = width / 2;
    this.half = new THREE.Vector3(
      dir.x !== 0 ? 0.5 : across + 0.5, height / 2, dir.x !== 0 ? across + 0.5 : 0.5);

    const hub = new THREE.Group();
    hub.position.copy(pos);
    hub.rotation.y = Math.atan2(dir.x, dir.z);
    parent.add(hub);
    const steel = mat(0x4a5058, { rough: 0.6, metal: 0.7 });
    const glow = new THREE.MeshBasicMaterial({ color: accent });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 4.5, 10), steel);
      post.position.set(side * across, 2.25, 0);
      post.castShadow = true;
      hub.add(post);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), glow.clone());
      cap.position.set(side * across, 4.6, 0);
      hub.add(cap);
      this.caps.push(cap);
      this.cylinders.push(board.physics.addCylinder(
        pos.x + (dir.x !== 0 ? 0 : side * across), pos.y + 2.25,
        pos.z + (dir.x !== 0 ? side * across : 0), 0.5, 4.5));
      // the emitter's own sculpt, when the file lands
      authoredProp(hub, post, 'energy_pylon', 4.5, { x: side * across, y: 0, z: 0, axis: 'y' });
    }
    const paneMat = new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    // the cell grid, so the pane reads as a field rather than a coloured sheet
    loadOptionalTexture('energy_cells', (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(2, Math.round(width / 2)), Math.max(2, Math.round(height / 2)));
      paneMat.map = tex;
      paneMat.needsUpdate = true;
    }, { exts: ['png', 'jpg'] });
    this.pane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), paneMat);
    this.pane.position.set(0, height / 2, 0);
    hub.add(this.pane);
    this.closeNow();
  }

  get closed(): boolean { return this.box !== null; }
  get open_(): boolean { return this.t >= 1 && this.want >= 1; }

  private closeNow(): void {
    this.t = 0;
    this.want = 0;
    this.block(true);
    this.paint();
  }

  close(): void {
    this.want = 0;
    this.block(true);
    if (this.box) delete this.box.oneWay;
  }
  closeOneWay(): void {
    this.close();
    if (this.box) this.box.oneWay = this.forward;
  }
  open(): void { this.want = 1; }

  retire(): void {
    this.block(false);
    const cyl = this.board.physics.cylinders;
    for (const c of this.cylinders) {
      const i = cyl.indexOf(c);
      if (i >= 0) cyl.splice(i, 1);
    }
    this.cylinders.length = 0;
  }

  update(dt: number): void {
    if (this.t === this.want) return;
    const step = dt / 0.5;
    this.t = this.want > this.t ? Math.min(1, this.t + step) : Math.max(0, this.t - step);
    this.block(this.t < 0.8);
    this.paint();
  }

  private paint(): void {
    const m = this.pane.material as THREE.MeshBasicMaterial;
    m.opacity = (1 - this.t) * 0.34;
    this.pane.visible = this.t < 0.99;
    // the caps say what the pane is about to do before it does it
    for (const c of this.caps) (c.material as THREE.MeshBasicMaterial).opacity = 1;
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

/**
 * How a transport door reads. A `door` is the blast door in a pocket; a
 * `hatch` is a hole in the floor with a lid on it (the dive into the Prison
 * Rig's sea); a `ring` is a lit pool you swim up into (surfacing). All three
 * board the same way: step to the far end of the pocket.
 */
export type PortalStyle = 'door' | 'hatch' | 'ring';

/**
 * A transport door: the boundary between two stages (docs/MISSIONS_OUTDOOR.md
 * §1.9). Wider than a blast door, lit white-blue rather than in the palette's
 * accent, and with a **pocket** behind the leaves whose far end is the
 * threshold — so it is stepped through deliberately and never brushed by.
 */
export class Portal extends Gate {
  /** the far end of the pocket: crossing this is boarding */
  readonly threshold: THREE.Vector3;
  /** the pocket a player stands in to wait for the others, on the way back */
  readonly pocket: THREE.Vector3;
  readonly forward: { x: number; z: number };
  /** what the door is: a blast door, a hatch in the floor, or a lit pool ring */
  readonly style: PortalStyle;
  /** a hatch's lid, which slides off it as it opens */
  private lid: THREE.Object3D | null = null;
  private lidHome = new THREE.Vector3();

  constructor(board: Board, parent: THREE.Object3D, pos: THREE.Vector3,
    dir: { x: number; z: number }, wallH: number, depth: number, style: PortalStyle = 'door') {
    super(board, parent, pos, dir, wallH, 0xbfe6ff, { width: GATE_W + 1.6, hidden: style !== 'door' });
    this.style = style;
    this.forward = { x: dir.x, z: dir.z };
    this.threshold = new THREE.Vector3(pos.x + dir.x * depth, pos.y, pos.z + dir.z * depth);
    this.pocket = new THREE.Vector3(pos.x + dir.x * (depth * 0.5), pos.y, pos.z + dir.z * (depth * 0.5));
    // a lamp over it, so the way on is the brightest thing ahead
    const lamp = new THREE.PointLight(0xbfe6ff, 26, 22, 1.5);
    lamp.position.set(pos.x, pos.y + (style === 'door' ? wallH - 0.4 : 3.5), pos.z);
    parent.add(lamp);
    if (style === 'door') return;
    // A hatch into the water (the dive) or a lit pool ring you swim up into
    // (surfacing): the way through is a hole, not a pair of leaves.
    const at = this.threshold.clone().lerp(this.pocket, 0.35);
    const glow = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const water = new THREE.MeshBasicMaterial({ color: 0x2a6a80, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const ringAt = (y: number, r: number): THREE.Mesh => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.35, 28), glow);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(at.x, y, at.z);
      parent.add(ring);
      return ring;
    };
    ringAt(pos.y + 0.06, 2.4);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.4, 28), water);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(at.x, pos.y + 0.05, at.z);
    parent.add(pool);
    if (style === 'hatch') {
      // the lid: a steel disc over the hole while the way is shut
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.22, 24), mat(0x4a5058, { rough: 0.5, metal: 0.7 }));
      lid.position.set(at.x, pos.y + 0.12, at.z);
      parent.add(lid);
      this.lid = lid;
      this.lidHome.copy(lid.position);
    } else {
      // the pool overhead, and the light coming down through it
      ringAt(pos.y + 5.2, 2.2);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 14, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.12,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      shaft.position.set(at.x, pos.y + 7, at.z);
      parent.add(shaft);
    }
  }

  override update(dt: number): void {
    super.update(dt);
    // the lid slides aside with the opening, and back over it as it shuts
    if (this.lid) this.lid.position.set(this.lidHome.x + this.t * 5.4 * -this.forward.z, this.lidHome.y,
      this.lidHome.z + this.t * 5.4 * this.forward.x);
  }

  /** how far along the doorway's own axis this position stands */
  depthOf(p: THREE.Vector3): number {
    return (p.x - this.pos.x) * this.forward.x + (p.z - this.pos.z) * this.forward.z;
  }
}
