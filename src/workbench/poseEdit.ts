import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Pose editing for the model workbench.
 *
 * Edit mode freezes whatever the animator last wrote, draws the rig on top of
 * the figure as clickable joints, and hangs a rotation gizmo off the joint you
 * pick. Rotations are applied to every figure on the turntable at once, so the
 * authored skin and the procedural build stay the same pose while you work.
 *
 * The gizmo rings can be oriented three ways (`space`):
 *   local  — the bone's own axes, which is what the clip keyframes are in
 *   world  — the stage axes
 *   camera — the axes you are looking down: the red ring tumbles the bone
 *            about screen-right, green about screen-up, blue rolls it in the
 *            screen plane. This is the one you want for "swing the elbow out
 *            a bit more from where I'm standing".
 * In local and world space an extra outer ring rolls the bone about the view
 * direction, so camera-relative roll is always a drag away.
 *
 * Nothing here writes to the clips: edits live on the rig until you export
 * them, and leaving edit mode puts the clips back in charge.
 */

export interface EditTarget {
  label: string;
  /** canonical bone name -> rig bone; all targets share the bone names */
  bones: Record<string, THREE.Object3D>;
}

export type GizmoSpace = 'local' | 'world' | 'camera';

export interface BoneChange {
  /** local euler XYZ in degrees when edit mode was entered */
  base: [number, number, number];
  /** local euler XYZ in degrees now */
  edited: [number, number, number];
  /** edited - base, per axis, in degrees */
  delta: [number, number, number];
}

const DEG = 180 / Math.PI;
const RING_COLORS: Record<string, number> = { x: 0xff6b6b, y: 0x86e07a, z: 0x6aa8ff, screen: 0xffd479 };
const JOINT_IDLE = 0x93a3bb;
const JOINT_HOVER = 0xffd479;
const JOINT_SELECTED = 0xd8a04a;

/** bones the editor never offers: they carry no pose, only attachments */
const SKIP = new Set(['weaponL', 'weaponR']);

function eulerDeg(q: THREE.Quaternion): [number, number, number] {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x * DEG, e.y * DEG, e.z * DEG];
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

interface Handle {
  mesh: THREE.Mesh;
  bone: THREE.Object3D;
  name: string;
  target: EditTarget;
}

export class PoseEditor {
  enabled = false;
  space: GizmoSpace = 'camera';
  /** degrees per snap step while shift is held */
  snap = 5;
  selected: string | null = null;
  /** live angle of the drag in progress, degrees — for the panel read-out */
  dragAngle = 0;
  dragAxis: string | null = null;

  private targets: EditTarget[] = [];
  private overlay = new THREE.Group();
  private handles: Handle[] = [];
  private lines: Array<{ line: THREE.LineSegments; pairs: Array<[THREE.Object3D, THREE.Object3D]> }> = [];
  private gizmo = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private screenRing!: THREE.Mesh;
  /** bone that the gizmo sits on (the one whose handle was clicked) */
  private anchor: THREE.Object3D | null = null;
  private baseline = new Map<THREE.Object3D, THREE.Quaternion>();
  private edited = new Set<string>();

  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hovered: THREE.Object3D | null = null;
  private drag: {
    axis: THREE.Vector3;      // world-space rotation axis
    plane: THREE.Plane;
    from: THREE.Vector3;      // world vector origin -> grab point
    applied: number;          // radians already written to the bones
    ring: THREE.Mesh;
  } | null = null;
  /** press that may still turn out to be an orbit rather than a joint pick */
  private click: { x: number; y: number; handle: Handle | null } | null = null;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
    private dom: HTMLElement,
    private onChange: () => void,
  ) {
    this.overlay.visible = false;
    this.overlay.renderOrder = 998;
    scene.add(this.overlay);

    this.buildGizmo();
    this.setSpace(this.space);
    this.gizmo.visible = false;
    scene.add(this.gizmo);

    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerdown', this.onPointerDown);
    addEventListener('pointerup', this.onPointerUp);
  }

  // ---------- construction ----------

  private buildGizmo(): void {
    const ring = (axis: THREE.Vector3, colour: number, radius: number, key: string): THREE.Mesh => {
      const geo = new THREE.TorusGeometry(radius, 0.022, 8, 72);
      const mat = new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      // a torus lies in XY with its normal on +Z; turn it to face `axis`
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
      mesh.userData = { axis: axis.clone(), key, colour };
      mesh.renderOrder = 1000;
      this.gizmo.add(mesh);
      return mesh;
    };

    this.rings = [
      ring(new THREE.Vector3(1, 0, 0), RING_COLORS.x, 1, 'x'),
      ring(new THREE.Vector3(0, 1, 0), RING_COLORS.y, 1, 'y'),
      ring(new THREE.Vector3(0, 0, 1), RING_COLORS.z, 1, 'z'),
    ];
    // the always-camera-facing roll ring, kept outside the axis rings
    this.screenRing = ring(new THREE.Vector3(0, 0, 1), RING_COLORS.screen, 1.3, 'screen');
    this.rings.push(this.screenRing);

    // a dot at the pivot, so the gizmo reads as attached to the joint
    const pip = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.6 }),
    );
    pip.renderOrder = 1000;
    this.gizmo.add(pip);
  }

  /** Rebuild the joint overlay for a new set of figures. Clears any edits. */
  setTargets(targets: EditTarget[]): void {
    this.clearOverlay();
    this.targets = targets;
    this.baseline.clear();
    this.edited.clear();
    this.select(null);

    for (const t of targets) {
      const pairs: Array<[THREE.Object3D, THREE.Object3D]> = [];
      for (const [name, bone] of Object.entries(t.bones)) {
        if (SKIP.has(name)) continue;
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(1, 10, 8),
          new THREE.MeshBasicMaterial({ color: JOINT_IDLE, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 }),
        );
        mesh.renderOrder = 999;
        this.overlay.add(mesh);
        this.handles.push({ mesh, bone, name, target: t });
        if (bone.parent && Object.values(t.bones).includes(bone.parent)) pairs.push([bone, bone.parent]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pairs.length * 6), 3));
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: 0x5f7c93, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false,
      }));
      line.renderOrder = 998;
      line.frustumCulled = false;
      this.overlay.add(line);
      this.lines.push({ line, pairs });
    }
  }

  private clearOverlay(): void {
    for (const h of this.handles) {
      h.mesh.geometry.dispose();
      (h.mesh.material as THREE.Material).dispose();
      this.overlay.remove(h.mesh);
    }
    for (const l of this.lines) {
      l.line.geometry.dispose();
      (l.line.material as THREE.Material).dispose();
      this.overlay.remove(l.line);
    }
    this.handles = [];
    this.lines = [];
  }

  // ---------- mode ----------

  /** Put every bone back where the clips left it (used on leaving edit mode). */
  restoreBaseline(): void {
    for (const [bone, q] of this.baseline) bone.quaternion.copy(q);
    this.edited.clear();
    this.onChange();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.overlay.visible = on;
    if (!on) {
      this.select(null);
      this.baseline.clear();
      this.edited.clear();
      this.controls.enabled = true;
    } else {
      this.captureBaseline();
    }
  }

  /** Remember the frozen pose, so edits can be expressed as deltas and undone. */
  captureBaseline(): void {
    this.baseline.clear();
    this.edited.clear();
    for (const t of this.targets) {
      for (const [name, bone] of Object.entries(t.bones)) {
        if (SKIP.has(name)) continue;
        this.baseline.set(bone, bone.quaternion.clone());
      }
    }
  }

  setSpace(space: GizmoSpace): void {
    this.space = space;
    this.screenRing.visible = space !== 'camera';
  }

  select(name: string | null): void {
    this.selected = name;
    this.anchor = null;
    if (name) {
      const hit = this.handles.find((h) => h.name === name);
      this.anchor = hit ? hit.bone : null;
    }
    this.gizmo.visible = !!this.anchor && this.enabled;
    this.onChange();
  }

  // ---------- edits ----------

  /** Local euler of the selected bone, degrees, or null. */
  selectedEuler(): [number, number, number] | null {
    return this.anchor ? eulerDeg(this.anchor.quaternion) : null;
  }

  /** Set the selected bone's local euler outright (panel number fields). */
  setSelectedEuler(deg: [number, number, number]): void {
    if (!this.selected) return;
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(deg[0] / DEG, deg[1] / DEG, deg[2] / DEG, 'XYZ'),
    );
    for (const bone of this.bonesNamed(this.selected)) bone.quaternion.copy(q);
    this.edited.add(this.selected);
    this.onChange();
  }

  private bonesNamed(name: string): THREE.Object3D[] {
    return this.targets.map((t) => t.bones[name]).filter(Boolean);
  }

  /** Rotate every figure's copy of `name` by `angle` radians about a world axis. */
  private rotateWorld(name: string, axis: THREE.Vector3, angle: number): void {
    const dq = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const parentQ = new THREE.Quaternion();
    const worldQ = new THREE.Quaternion();
    for (const bone of this.bonesNamed(name)) {
      bone.getWorldQuaternion(worldQ);
      if (bone.parent) bone.parent.getWorldQuaternion(parentQ);
      else parentQ.identity();
      bone.quaternion.copy(parentQ.invert().multiply(dq).multiply(worldQ));
    }
    this.edited.add(name);
  }

  resetBone(name: string): void {
    for (const bone of this.bonesNamed(name)) {
      const base = this.baseline.get(bone);
      if (base) bone.quaternion.copy(base);
    }
    this.edited.delete(name);
    this.onChange();
  }

  resetAll(): void {
    for (const name of [...this.edited]) this.resetBone(name);
    this.onChange();
  }

  editedBones(): string[] {
    return [...this.edited].sort();
  }

  /** What changed, keyed by bone name — the payload of the JSON export. */
  changes(): Record<string, BoneChange> {
    const out: Record<string, BoneChange> = {};
    for (const name of this.editedBones()) {
      const bone = this.bonesNamed(name)[0];
      const base = this.baseline.get(bone);
      if (!bone || !base) continue;
      const b = eulerDeg(base).map(round2) as [number, number, number];
      const e = eulerDeg(bone.quaternion).map(round2) as [number, number, number];
      out[name] = {
        base: b,
        edited: e,
        delta: [round2(e[0] - b[0]), round2(e[1] - b[1]), round2(e[2] - b[2])],
      };
    }
    return out;
  }

  // ---------- picking ----------

  private setPointer(ev: PointerEvent): void {
    const r = this.dom.getBoundingClientRect();
    this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
  }

  private pickRing(): THREE.Mesh | null {
    if (!this.gizmo.visible) return null;
    const hits = this.ray.intersectObjects(this.rings.filter((r) => r.visible), false);
    return hits.length ? (hits[0].object as THREE.Mesh) : null;
  }

  private pickHandle(): Handle | null {
    const hits = this.ray.intersectObjects(this.handles.map((h) => h.mesh), false);
    if (!hits.length) return null;
    return this.handles.find((h) => h.mesh === hits[0].object) ?? null;
  }

  private onPointerMove = (ev: PointerEvent): void => {
    if (!this.enabled) return;
    this.setPointer(ev);

    if (this.drag) {
      const hit = new THREE.Vector3();
      if (!this.ray.ray.intersectPlane(this.drag.plane, hit)) return;
      const to = hit.sub(this.gizmo.position);
      const from = this.drag.from;
      let angle = Math.atan2(from.clone().cross(to).dot(this.drag.axis), from.dot(to));
      if (ev.shiftKey && this.snap > 0) {
        const step = this.snap / DEG;
        angle = Math.round(angle / step) * step;
      }
      this.rotateWorld(this.selected!, this.drag.axis, angle - this.drag.applied);
      this.drag.applied = angle;
      this.dragAngle = angle * DEG;
      this.onChange();
      return;
    }

    // hover: highlight, and hand the pointer to the gizmo before OrbitControls
    // can claim the drag (it reads `enabled` when the button goes down)
    const ring = this.pickRing();
    const handle = ring ? null : this.pickHandle();
    const next = ring ?? handle?.mesh ?? null;
    if (next !== this.hovered) {
      this.paintHover(next);
      this.hovered = next;
      // a ring is dragged, a joint is clicked — say which under the pointer
      this.dom.style.cursor = ring ? 'grab' : next ? 'pointer' : '';
    }
    // only a ring takes the drag off OrbitControls; joints are picked on a
    // click that didn't turn into an orbit, so the camera stays free to move
    this.controls.enabled = !ring;
  };

  private paintHover(next: THREE.Object3D | null): void {
    for (const r of this.rings) {
      const m = r.material as THREE.MeshBasicMaterial;
      m.opacity = r === next ? 1 : 0.75;
      m.color.setHex(r === next ? 0xffffff : r.userData.colour);
    }
    for (const h of this.handles) {
      const m = h.mesh.material as THREE.MeshBasicMaterial;
      const sel = h.name === this.selected;
      m.color.setHex(h.mesh === next ? JOINT_HOVER : sel ? JOINT_SELECTED : JOINT_IDLE);
    }
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (!this.enabled || ev.button !== 0) return;
    this.setPointer(ev);

    const ring = this.pickRing();
    if (ring && this.anchor) {
      const axis = ring.userData.axis.clone().applyQuaternion(this.gizmo.quaternion).normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, this.gizmo.position);
      const hit = new THREE.Vector3();
      if (!this.ray.ray.intersectPlane(plane, hit)) return;
      this.drag = { axis, plane, from: hit.sub(this.gizmo.position), applied: 0, ring };
      this.dragAngle = 0;
      this.dragAxis = ring.userData.key;
      this.controls.enabled = false;
      this.dom.setPointerCapture?.(ev.pointerId);
      this.dom.style.cursor = 'grabbing';
      this.onChange();
      return;
    }

    this.click = { x: ev.clientX, y: ev.clientY, handle: this.pickHandle() };
  };

  private onPointerUp = (ev: PointerEvent): void => {
    const click = this.click;
    this.click = null;
    if (!this.drag) {
      // a press that didn't become an orbit is a pick (or a click into space)
      if (click && Math.hypot(ev.clientX - click.x, ev.clientY - click.y) < 4) {
        this.select(click.handle ? click.handle.name : null);
        if (click.handle) this.paintHover(click.handle.mesh);
      }
      return;
    }
    this.drag = null;
    this.dragAxis = null;
    this.dragAngle = 0;
    this.controls.enabled = true;
    this.dom.releasePointerCapture?.(ev.pointerId);
    this.dom.style.cursor = '';
    this.onChange();
  };

  // ---------- per-frame ----------

  update(): void {
    if (!this.enabled) return;
    const camPos = this.camera.position;
    const p = new THREE.Vector3();

    for (const h of this.handles) {
      h.bone.getWorldPosition(p);
      h.mesh.position.copy(p);
      h.mesh.scale.setScalar(camPos.distanceTo(p) * 0.006);
    }
    for (const { line, pairs } of this.lines) {
      const arr = (line.geometry.getAttribute('position') as THREE.BufferAttribute);
      pairs.forEach(([a, b], i) => {
        a.getWorldPosition(p); arr.setXYZ(i * 2, p.x, p.y, p.z);
        b.getWorldPosition(p); arr.setXYZ(i * 2 + 1, p.x, p.y, p.z);
      });
      arr.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }

    if (!this.anchor || !this.gizmo.visible) return;
    this.anchor.getWorldPosition(p);
    this.gizmo.position.copy(p);
    // hold the gizmo the same size on screen whatever the zoom
    this.gizmo.scale.setScalar(camPos.distanceTo(p) * 0.065);
    if (!this.drag) {
      if (this.space === 'local') this.anchor.getWorldQuaternion(this.gizmo.quaternion);
      else if (this.space === 'world') this.gizmo.quaternion.identity();
      else this.camera.getWorldQuaternion(this.gizmo.quaternion);
    }
    // the roll ring always faces the viewer, in whichever space
    if (this.screenRing.visible && !this.drag) {
      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        camPos.clone().sub(this.gizmo.position).normalize().applyQuaternion(this.gizmo.quaternion.clone().invert()),
      );
      this.screenRing.quaternion.copy(q);
      this.screenRing.userData.axis.set(0, 0, 1).applyQuaternion(q);
    }
  }
}
