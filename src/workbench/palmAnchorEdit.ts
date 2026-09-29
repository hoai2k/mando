import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Rig } from '../anim/skeleton';
import { deployedPalm, palmOf, setWorkbenchPalm, type HandSide } from '../characters/handAnchors';

/**
 * The palms, placed by eye (Weapon grips → Hand anchors): one handle in each
 * of the rig's hands, dragged onto the palm of the model as it is drawn, kept
 * in the hand bone's own frame (`handAnchors.ts`). Like every workbench edit
 * it stays in the page until exported.
 */
const COLOUR: Record<HandSide, number> = { L: 0x6bd0ff, R: 0xffa04a };

export class PalmEditor {
  enabled = false;
  selected: HandSide | null = null;
  private id: string | null = null;
  private handles = new Map<HandSide, THREE.Object3D>();
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
      setWorkbenchPalm(this.id, side, h.position.clone());
      this.onChange();
    });
  }

  /** the character whose hands these are, on this rig (null clears) */
  setTarget(id: string | null, rig: Rig | null): void {
    this.gizmo.detach();
    for (const h of this.handles.values()) h.parent?.remove(h);
    this.handles.clear();
    this.id = rig ? id : null;
    if (!rig || !id) { this.gizmo.visible = false; return; }
    for (const side of ['L', 'R'] as const) {
      const h = new THREE.Object3D();
      h.position.copy(palmOf(id, side));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8),
        new THREE.MeshBasicMaterial({ color: COLOUR[side], depthTest: false, depthWrite: false }));
      dot.renderOrder = 999;
      h.add(dot);
      h.visible = this.enabled;
      (side === 'L' ? rig.bones.handL : rig.bones.handR).add(h);
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
    return h ? h.position.toArray().map((n) => +n.toFixed(4)) as [number, number, number] : null;
  }

  setPosition(p: [number, number, number]): void {
    const side = this.selected, h = side && this.handles.get(side);
    if (!side || !h || !this.id || p.some((n) => !Number.isFinite(n))) return;
    h.position.set(...p);
    setWorkbenchPalm(this.id, side, h.position.clone());
    this.onChange();
  }

  /** the selected palm back to what is deployed */
  reset(): void {
    const side = this.selected, h = side && this.handles.get(side);
    if (!side || !h || !this.id) return;
    setWorkbenchPalm(this.id, side, null);
    h.position.copy(deployedPalm(this.id, side));
    this.onChange();
  }
}
