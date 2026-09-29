import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Rig } from '../anim/skeleton';
import { DEFAULT_PALM, deployedPalm, palmFrameOf, palmOf, setWorkbenchPalm, type HandSide } from '../characters/handAnchors';

/**
 * The palms, placed by eye (Weapon grips → Hand anchors): one handle on each
 * of the sculpt's hands (its palm frame), dragged onto the palm as it is
 * drawn — so it holds in every pose — or on the rig's hands for a build with
 * no sculpt (`handAnchors.ts`). Like every workbench edit it stays in the page
 * until exported.
 */
const ORIGIN = new THREE.Vector3(...DEFAULT_PALM);
const COLOUR: Record<HandSide, number> = { L: 0x6bd0ff, R: 0xffa04a };

export class PalmEditor {
  enabled = false;
  selected: HandSide | null = null;
  private id: string | null = null;
  private handles = new Map<HandSide, THREE.Object3D>();
  /** handles on a sculpt's palm frame count from the weapon point, which is that frame's origin */
  private onFrame = false;
  private gizmo: TransformControls;

  constructor(scene: THREE.Scene, camera: THREE.Camera, private orbit: OrbitControls, dom: HTMLElement,
    private onChange: () => void) {
    this.gizmo = new TransformControls(camera, dom);
    this.gizmo.setSize(0.6);
    this.gizmo.setSpace('world');
    this.gizmo.visible = false;
    scene.add(this.gizmo);
    this.gizmo.addEventListener('dragging-changed', (e) => { this.orbit.enabled = !e.value; });
    this.gizmo.addEventListener('objectChange', () => {
      const side = this.selected, h = side && this.handles.get(side);
      if (!side || !h || !this.id) return;
      setWorkbenchPalm(this.id, side, this.palmAt(h));
      this.onChange();
    });
  }

  /** a handle's palm, from the wrist */
  private palmAt(h: THREE.Object3D): THREE.Vector3 {
    return this.onFrame ? h.position.clone().add(ORIGIN) : h.position.clone();
  }
  private place(h: THREE.Object3D, palm: THREE.Vector3): void {
    h.position.copy(palm);
    if (this.onFrame) h.position.sub(ORIGIN);
  }

  /** the character whose hands these are, on this figure (null clears) */
  setTarget(id: string | null, rig: Rig | null, root: THREE.Object3D | null = null): void {
    this.gizmo.detach();
    for (const h of this.handles.values()) h.parent?.remove(h);
    this.handles.clear();
    this.id = rig ? id : null;
    if (!rig || !id) { this.gizmo.visible = false; return; }
    this.onFrame = !!(root && palmFrameOf(root, 'L') && palmFrameOf(root, 'R'));
    for (const side of ['L', 'R'] as const) {
      const h = new THREE.Object3D();
      const parent = this.onFrame ? palmFrameOf(root!, side)! : side === 'L' ? rig.bones.handL : rig.bones.handR;
      parent.add(h);
      this.place(h, palmOf(id, side));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8),
        new THREE.MeshBasicMaterial({ color: COLOUR[side], depthTest: false, depthWrite: false }));
      dot.renderOrder = 999;
      h.add(dot);
      h.visible = this.enabled;
      this.handles.set(side, h);
    }
    this.select(this.selected);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    for (const h of this.handles.values()) h.visible = on;
    if (!on) { this.gizmo.detach(); this.gizmo.visible = false; this.orbit.enabled = true; } else this.select(this.selected);
  }

  select(side: HandSide | null): void {
    this.selected = side && this.handles.has(side) ? side : side;
    this.gizmo.detach();
    const h = side && this.handles.get(side);
    if (this.enabled && h) this.gizmo.attach(h);
    this.gizmo.visible = this.enabled && !!h;
  }

  /** the selected palm, in its hand bone's frame */
  current(): [number, number, number] | null {
    const h = this.selected && this.handles.get(this.selected);
    return h ? this.palmAt(h).toArray().map((n) => +n.toFixed(4)) as [number, number, number] : null;
  }

  setPosition(p: [number, number, number]): void {
    const side = this.selected, h = side && this.handles.get(side);
    if (!side || !h || !this.id || p.some((n) => !Number.isFinite(n))) return;
    this.place(h, new THREE.Vector3(...p));
    setWorkbenchPalm(this.id, side, this.palmAt(h));
    this.onChange();
  }

  /** the handles back onto the palms as they stand (after an undo) */
  refresh(): void {
    if (!this.id) return;
    for (const [side, h] of this.handles) this.place(h, palmOf(this.id, side));
  }

  /** the selected palm back to what is deployed */
  reset(): void {
    const side = this.selected, h = side && this.handles.get(side);
    if (!side || !h || !this.id) return;
    setWorkbenchPalm(this.id, side, null);
    this.place(h, deployedPalm(this.id, side));
    this.onChange();
  }
}
