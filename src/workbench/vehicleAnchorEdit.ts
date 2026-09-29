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
 * the bike's frame, so he can be sat properly on his own bike. Both carry a
 * leg spread too: how far each knee sits out from the centre line. A ride
 * also has a footrest handle (the left foot; the right mirrors it), and can
 * turn its rider on the seat or its sculpt on its keel.
 */

interface NiktoRig {
  bike: THREE.Object3D; rider: THREE.Object3D; handsToBars: () => void;
  readonly legSpread: number | null; setLegSpread: (knee: number | null) => void; kneeWidth: () => number;
  useSwoop: (anchor: VehicleAnchor) => void;
}

type Handle = 'seat' | 'grip' | 'foot' | 'rider';

const round = (n: number): number => +n.toFixed(4);
const v3 = (v: THREE.Vector3): V3 => [round(v.x), round(v.y), round(v.z)];
const deg = (e: THREE.Euler): V3 => [e.x, e.y, e.z].map((r) => round(THREE.MathUtils.radToDeg(r))) as V3;
const rad = (d: V3): V3 => d.map(THREE.MathUtils.degToRad) as V3;
/** an anchor's rotation, or null when it is square (nothing to record) */
const turned = (e: THREE.Euler): V3 | null => { const d = deg(e); return d.some((n) => Math.abs(n) > 1e-3) ? d : null; };

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
    this.gizmo.addEventListener('objectChange', () => this.fromHandle(this.selected === 'foot'));
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
    if (root) this.restore(root);
    if (this.vehicle) {
      const vr = this.vehicle;
      const colours = { seat: 0x6bd0ff, grip: 0xffc86b, foot: 0x8aff9d } as const;
      for (const name of ['seat', 'grip', 'foot'] as const) {
        const h = new THREE.Object3D();
        // a ride with no footrest yet shows the handle where the clip has the sole
        h.position.copy(name === 'foot' ? vr.foot ?? vr.soleAt() : vr[name]);
        // turned the way the anchor is: Y first, so the seat's Y is the rider's own turn
        h.rotation.order = 'YXZ';
        const d = THREE.MathUtils.DEG2RAD;
        if (name === 'seat') h.rotation.set((vr.seatTilt?.[0] ?? 0) * d, vr.yaw * d, (vr.seatTilt?.[1] ?? 0) * d);
        else if (name === 'grip' && vr.gripRotation) h.rotation.set(...rad(vr.gripRotation));
        else if (name === 'foot' && vr.footRotation) h.rotation.set(...rad(vr.footRotation));
        // which way it faces: red X (the rider's left), green up, blue forward
        const axes = new THREE.AxesHelper(0.14);
        (axes.material as THREE.Material).depthTest = false;
        axes.renderOrder = 998;
        axes.visible = this.enabled;
        axes.userData.anchorAxes = true;
        h.add(axes);
        vr.frame.add(h);
        this.handles.set(name, h);
        this.marker(name, colours[name]);
      }
    } else if (this.nikto) {
      this.handles.set('rider', this.nikto.rider);
      this.marker('rider', 0x9dff8a);
    }
    this.select(this.handles.has(this.selected ?? 'seat') ? this.selected ?? 'seat' : this.names()[0] ?? null);
  }

  /**
   * Put this session's edits on a freshly built figure — a ride's anchors on
   * its rig, and on the Nikto both his own and the swoop's (he rides the same
   * bike) — so switching subjects, in edit mode or out of it, shows what was
   * placed rather than what is committed.
   */
  restore(root: THREE.Object3D): void {
    const vr = root.userData.vehicleRig as VehicleRig | undefined;
    const nikto = root.userData.niktoRider as NiktoRig | undefined;
    if (vr) {
      const saved = this.vehicles.get(vr.kind);
      if (!saved) return;
      vr.seat.set(...saved.seat); vr.grip.set(...saved.grip);
      vr.legSpread = saved.legSpread ?? null;
      vr.foot = saved.foot ? new THREE.Vector3(...saved.foot) : null;
      vr.yaw = saved.yaw ?? 0;
      vr.modelYaw = saved.modelYaw ?? 0;
      vr.seatTilt = saved.seatRotation && (saved.seatRotation[0] || saved.seatRotation[2])
        ? [saved.seatRotation[0], saved.seatRotation[2]] : null;
      vr.gripRotation = saved.gripRotation ?? null;
      vr.footRotation = saved.footRotation ?? null;
      vr.relayout();
    } else if (nikto) {
      if (!this.niktoBase || this.nikto !== nikto) {
        this.niktoBase = { position: v3(nikto.rider.position), rotation: deg(nikto.rider.rotation) };
      }
      const swoop = this.vehicles.get('swoop');
      if (swoop) nikto.useSwoop(swoop);
      if (this.niktoRider) {
        nikto.rider.position.set(...this.niktoRider.position);
        nikto.rider.rotation.set(...this.niktoRider.rotation.map(THREE.MathUtils.degToRad) as V3);
        nikto.setLegSpread(this.niktoRider.legSpread ?? nikto.legSpread);
        nikto.handsToBars();
      }
    }
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
    for (const h of this.handles.values()) for (const c of h.children) if (c.userData.anchorAxes) c.visible = enabled;
    if (!enabled) { this.gizmo.detach(); this.orbit.enabled = true; }
    else this.select(this.selected);
    this.gizmo.visible = enabled && !!this.selected;
  }

  select(name: Handle | null): void {
    this.selected = name && this.handles.has(name) ? name : null;
    this.gizmo.detach();
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

  /** each knee's distance from the centre line (m), or null for the pose's own legs */
  get legSpread(): number | null { return this.vehicle?.legSpread ?? this.nikto?.legSpread ?? null; }
  /** where the pose alone puts the knees, to start a spread from */
  kneeWidth(): number { return this.vehicle?.kneeWidth() ?? this.nikto?.kneeWidth() ?? 0.2; }

  /** the rider turned on the seat, and the sculpt on its keel (degrees) — a ride's only */
  get turns(): { yaw: number; modelYaw: number } | null {
    return this.vehicle ? { yaw: this.vehicle.yaw, modelYaw: this.vehicle.modelYaw } : null;
  }
  setTurn(which: 'yaw' | 'modelYaw', degrees: number): void {
    if (!this.vehicle || !Number.isFinite(degrees)) return;
    this.vehicle[which] = +degrees.toFixed(2);
    // the rider's turn is the seat's own Y
    if (which === 'yaw') this.handles.get('seat')!.rotation.y = THREE.MathUtils.degToRad(this.vehicle.yaw);
    this.fromHandle();
  }

  setLegSpread(knee: number | null): void {
    if (knee !== null && !Number.isFinite(knee)) return;
    const k = knee === null ? null : round(knee);
    if (this.vehicle) this.vehicle.legSpread = k;
    else if (this.nikto) this.nikto.setLegSpread(k);
    this.fromHandle();
  }

  /** the selected handle's position in the ride's (or the bike's) frame */
  current(): { position: V3; rotation: V3 } | null {
    const h = this.selected && this.handles.get(this.selected);
    if (!h) return null;
    return { position: v3(h.position), rotation: deg(h.rotation) };
  }

  setPosition(p: V3): void {
    const h = this.selected && this.handles.get(this.selected);
    if (!h || p.some((n) => !Number.isFinite(n))) return;
    h.position.set(...p);
    this.fromHandle(this.selected === 'foot');
  }

  setRotation(d: V3): void {
    const h = this.selected && this.handles.get(this.selected);
    if (!h || d.some((n) => !Number.isFinite(n))) return;
    h.rotation.set(...rad(d));
    this.fromHandle(this.selected === 'foot');
  }

  /** put the selected handle back where the game has it today */
  resetSelected(): void {
    if (this.vehicle && this.selected === 'foot') {
      // no footrest: the clip's own legs, and the handle back at the clip's sole
      this.vehicle.foot = null;
      this.vehicle.footRotation = null;
      this.handles.get('foot')!.position.copy(this.vehicle.soleAt());
      this.handles.get('foot')!.rotation.set(0, 0, 0);
      this.fromHandle();
    } else if (this.vehicle && (this.selected === 'seat' || this.selected === 'grip')) {
      const vr = this.vehicle;
      const h = this.handles.get(this.selected)!;
      h.position.set(...vr.defaults[this.selected]);
      const d = THREE.MathUtils.DEG2RAD;
      if (this.selected === 'seat') {
        const r = vr.defaults.seatRotation;
        h.rotation.set((r?.[0] ?? 0) * d, (vr.defaults.yaw ?? r?.[1] ?? 0) * d, (r?.[2] ?? 0) * d);
      } else h.rotation.set(...rad(vr.defaults.gripRotation ?? [0, 0, 0]));
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

  /**
   * A handle moved: carry it into the rig and remember the edit. `footMoved`
   * is set only when the footrest itself was dragged or typed in, which is
   * what places one on a ride that had none.
   */
  private fromHandle(footMoved = false): void {
    if (this.vehicle) {
      const vr = this.vehicle;
      vr.seat.copy(this.handles.get('seat')!.position);
      vr.grip.copy(this.handles.get('grip')!.position);
      // the footrest counts once it has been moved (or was placed before)
      const foot = this.handles.get('foot');
      if (foot && (footMoved || vr.foot)) {
        vr.foot = foot.position.clone();
        vr.footRotation = turned(foot.rotation);
      }
      // the seat's Y turns the rider (the game's `yaw`); X and Z tilt him here
      const seat = this.handles.get('seat')!.rotation;
      vr.yaw = round(THREE.MathUtils.radToDeg(seat.y));
      vr.seatTilt = Math.abs(seat.x) > 1e-5 || Math.abs(seat.z) > 1e-5
        ? [round(THREE.MathUtils.radToDeg(seat.x)), round(THREE.MathUtils.radToDeg(seat.z))] : null;
      vr.gripRotation = turned(this.handles.get('grip')!.rotation);
      vr.relayout();
      this.vehicles.set(vr.kind, {
        seat: v3(vr.seat), grip: v3(vr.grip),
        ...(vr.legSpread === null ? {} : { legSpread: vr.legSpread }),
        ...(vr.foot ? { foot: v3(vr.foot) } : {}),
        ...(vr.yaw ? { yaw: vr.yaw } : {}),
        ...(vr.modelYaw ? { modelYaw: vr.modelYaw } : {}),
        ...(vr.seatTilt ? { seatRotation: [vr.seatTilt[0], vr.yaw, vr.seatTilt[1]] as V3 } : {}),
        ...(vr.gripRotation ? { gripRotation: vr.gripRotation } : {}),
        ...(vr.foot && vr.footRotation ? { footRotation: vr.footRotation } : {}),
      });
    } else if (this.nikto) {
      this.nikto.handsToBars();
      const knee = this.nikto.legSpread;
      this.niktoRider = {
        position: v3(this.nikto.rider.position), rotation: deg(this.nikto.rider.rotation),
        ...(knee === null ? {} : { legSpread: knee }),
      };
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
    const base = anchorFile as unknown as { version: number; vehicles: Record<string, VehicleAnchor>; niktoRider: NiktoRiderAnchor | null };
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
