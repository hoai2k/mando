import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import anchorFile from '../game/data/vehicleAnchors.json';
import type { NiktoRiderAnchor, V3, VehicleAnchor } from '../game/vehicleAnchors';
import type { VehicleRig } from './vehicleFigure';

/**
 * Seat and hand anchors for the rides, placed by eye (Weapon grips, in edit
 * mode) and exported as `src/game/data/vehicleAnchors.json`.
 *
 * On a vehicle subject there are two handles, both in the ride's own frame:
 * the seat (where the rider sits) and the grip (where the left hand takes the
 * bars). Dragging either re-seats Din or re-reaches his hand on the spot. On
 * the Nikto swoop rider the handle is the rider himself, moved and turned in
 * the bike's frame, so he can be sat properly on his own bike.
 */

interface NiktoRig { bike: THREE.Object3D; rider: THREE.Object3D; handsToBars: () => void }

type Handle = 'seat' | 'grip' | 'rider';

const round = (n: number): number => +n.toFixed(4);
const v3 = (v: THREE.Vector3): V3 => [round(v.x), round(v.y), round(v.z)];
const deg = (e: THREE.Euler): V3 => [e.x, e.y, e.z].map((r) => round(THREE.MathUtils.radToDeg(r))) as V3;

export class VehicleAnchorEditor {
  enabled = false;
  selected: Handle | null = null;
  private vehicle: VehicleRig | null = null;
  private nikto: NiktoRig | null = null;
  /** a small object per handle for the gizmo to hold; its position is copied back into the rig */
  private handles = new Map<Handle, THREE.Object3D>();
  private markers = new Map<Handle, THREE.Mesh>();
  private overlay = new THREE.Group();
  private gizmo: TransformControls;
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  /** every ride edited this session, by kind — survives switching subjects */
  private vehicles = new Map<string, VehicleAnchor>();
  private niktoRider: NiktoRiderAnchor | null = null;
  /** where the game sits the Nikto's rider, before any edit */
  private niktoBase: NiktoRiderAnchor | null = null;

  constructor(private scene: THREE.Scene, camera: THREE.PerspectiveCamera,
    private orbit: OrbitControls, private dom: HTMLElement, private onChange: () => void) {
    scene.add(this.overlay);
    this.overlay.visible = false;
    this.gizmo = new TransformControls(camera, dom);
    this.gizmo.setSize(0.7);
    this.gizmo.visible = false;
    scene.add(this.gizmo);
    this.gizmo.addEventListener('dragging-changed', (event) => { this.orbit.enabled = !event.value; });
    this.gizmo.addEventListener('objectChange', () => this.fromHandle());
    dom.addEventListener('pointerdown', this.pick);
  }

  /** true when the figure on the turntable has anchors to edit */
  static handles(root: THREE.Object3D | null): boolean {
    return !!(root?.userData.vehicleRig || root?.userData.niktoRider);
  }

  /** Point the editor at whatever is on the turntable (null clears it). */
  setTarget(root: THREE.Object3D | null): void {
    this.gizmo.detach();
    for (const h of this.handles.values()) h.parent?.remove(h);
    for (const m of this.markers.values()) { this.overlay.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.handles.clear();
    this.markers.clear();
    this.vehicle = (root?.userData.vehicleRig as VehicleRig | undefined) ?? null;
    this.nikto = (root?.userData.niktoRider as NiktoRig | undefined) ?? null;
    if (this.vehicle) {
      const vr = this.vehicle;
      const saved = this.vehicles.get(vr.kind);
      if (saved) { vr.seat.set(...saved.seat); vr.grip.set(...saved.grip); vr.relayout(); }
      for (const name of ['seat', 'grip'] as const) {
        const h = new THREE.Object3D();
        h.position.copy(vr[name]);
        vr.frame.add(h);
        this.handles.set(name, h);
        this.marker(name, name === 'seat' ? 0x6bd0ff : 0xffc86b);
      }
    } else if (this.nikto) {
      this.niktoBase = { position: v3(this.nikto.rider.position), rotation: deg(this.nikto.rider.rotation) };
      if (this.niktoRider) {
        this.nikto.rider.position.set(...this.niktoRider.position);
        this.nikto.rider.rotation.set(...this.niktoRider.rotation.map(THREE.MathUtils.degToRad) as V3);
        this.nikto.handsToBars();
      }
      this.handles.set('rider', this.nikto.rider);
      this.marker('rider', 0x9dff8a);
    }
    this.select(this.handles.has(this.selected ?? 'seat') ? this.selected ?? 'seat' : this.names()[0] ?? null);
  }

  private marker(name: Handle, color: number): void {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8),
      new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }));
    m.renderOrder = 999;
    m.userData.baseColor = color;
    this.overlay.add(m);
    this.markers.set(name, m);
  }

  names(): Handle[] { return [...this.handles.keys()]; }
  get kind(): 'vehicle' | 'nikto' | null { return this.vehicle ? 'vehicle' : this.nikto ? 'nikto' : null; }
  get subjectName(): string { return this.vehicle ? this.vehicle.def.name : 'Nikto swoop rider'; }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.overlay.visible = enabled;
    if (!enabled) { this.gizmo.detach(); this.orbit.enabled = true; }
    else this.select(this.selected);
    this.gizmo.visible = enabled && !!this.selected;
  }

  select(name: Handle | null): void {
    this.selected = name && this.handles.has(name) ? name : null;
    this.gizmo.detach();
    // only the rider turns; a seat or a grip is a point
    if (this.selected !== 'rider') this.setMode('translate', false);
    if (this.enabled && this.selected) this.gizmo.attach(this.handles.get(this.selected)!);
    this.gizmo.visible = this.enabled && !!this.selected;
    this.onChange();
  }

  setMode(mode: 'translate' | 'rotate', notify = true): void {
    this.gizmo.setMode(mode);
    this.gizmo.setSpace(mode === 'rotate' ? 'local' : 'world');
    if (notify) this.onChange();
  }
  get mode(): 'translate' | 'rotate' { return this.gizmo.getMode() as 'translate' | 'rotate'; }

  /** the selected handle's position in the ride's (or the bike's) frame */
  current(): { position: V3; rotation: V3 | null } | null {
    const h = this.selected && this.handles.get(this.selected);
    if (!h) return null;
    return { position: v3(h.position), rotation: this.selected === 'rider' ? deg(h.rotation) : null };
  }

  setPosition(p: V3): void {
    const h = this.selected && this.handles.get(this.selected);
    if (!h || p.some((n) => !Number.isFinite(n))) return;
    h.position.set(...p);
    this.fromHandle();
  }

  setRotation(d: V3): void {
    const h = this.selected === 'rider' ? this.handles.get('rider') : null;
    if (!h || d.some((n) => !Number.isFinite(n))) return;
    h.rotation.set(...d.map(THREE.MathUtils.degToRad) as V3);
    this.fromHandle();
  }

  /** put the selected handle back where the game has it today */
  resetSelected(): void {
    if (this.vehicle && (this.selected === 'seat' || this.selected === 'grip')) {
      const vr = this.vehicle;
      this.handles.get(this.selected)!.position.set(...vr.defaults[this.selected]);
      this.fromHandle();
      const kept = this.vehicles.get(vr.kind);
      if (kept && vr.seat.toArray().every((n, i) => Math.abs(n - vr.defaults.seat[i]) < 1e-6)
        && vr.grip.toArray().every((n, i) => Math.abs(n - vr.defaults.grip[i]) < 1e-6)) this.vehicles.delete(vr.kind);
    } else if (this.nikto && this.selected === 'rider' && this.niktoBase) {
      this.nikto.rider.position.set(...this.niktoBase.position);
      this.nikto.rider.rotation.set(...this.niktoBase.rotation.map(THREE.MathUtils.degToRad) as V3);
      this.nikto.handsToBars();
      this.niktoRider = null;
      this.onChange();
    }
  }

  /** the handle moved: carry it into the rig and remember the edit */
  private fromHandle(): void {
    if (this.vehicle) {
      const vr = this.vehicle;
      vr.seat.copy(this.handles.get('seat')!.position);
      vr.grip.copy(this.handles.get('grip')!.position);
      vr.relayout();
      this.vehicles.set(vr.kind, { seat: v3(vr.seat), grip: v3(vr.grip) });
    } else if (this.nikto) {
      this.nikto.handsToBars();
      this.niktoRider = { position: v3(this.nikto.rider.position), rotation: deg(this.nikto.rider.rotation) };
    }
    this.onChange();
  }

  /** the rides edited this session, for the ledger */
  edited(): Array<{ name: string; anchor: VehicleAnchor | NiktoRiderAnchor }> {
    const out: Array<{ name: string; anchor: VehicleAnchor | NiktoRiderAnchor }> =
      [...this.vehicles].map(([name, anchor]) => ({ name, anchor }));
    if (this.niktoRider) out.push({ name: 'niktoRider', anchor: this.niktoRider });
    return out;
  }

  /**
   * The file to drop in as `src/game/data/vehicleAnchors.json`: what is
   * already committed, with this session's edits laid over it.
   */
  exportJson(): string {
    const base = anchorFile as { version: number; vehicles: Record<string, VehicleAnchor>; niktoRider: NiktoRiderAnchor | null };
    const out = {
      version: 1,
      vehicles: { ...base.vehicles, ...Object.fromEntries(this.vehicles) },
      niktoRider: this.niktoRider ?? base.niktoRider,
    };
    return `${JSON.stringify(out, null, 2)}\n`;
  }

  update(camera: THREE.Camera): void {
    if (!this.enabled) return;
    const p = new THREE.Vector3();
    for (const [name, m] of this.markers) {
      const h = this.handles.get(name)!;
      h.getWorldPosition(p);
      // the rider's handle is his root at his feet: mark his hips instead, where he sits
      if (name === 'rider') p.y += 0.9;
      m.position.copy(p);
      m.scale.setScalar(camera.position.distanceTo(p) * 0.007);
      (m.material as THREE.MeshBasicMaterial).color.setHex(name === this.selected ? 0xffffff : m.userData.baseColor);
    }
  }

  private pick = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0 || this.gizmo.dragging) return;
    const rect = this.dom.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.gizmo.camera);
    const hit = this.ray.intersectObjects([...this.markers.values()], false)[0];
    const picked = [...this.markers].find(([, m]) => m === hit?.object)?.[0];
    if (picked) this.select(picked);
  };

  dispose(): void { this.scene.remove(this.overlay, this.gizmo); }
}
