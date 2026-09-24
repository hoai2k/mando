import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type V3 = [number, number, number];
type Q4 = [number, number, number, number];
const vec = (v: THREE.Vector3): V3 => [v.x, v.y, v.z].map((n) => +n.toFixed(6)) as V3;
const quat = (q: THREE.Quaternion): Q4 => [q.x, q.y, q.z, q.w].map((n) => +n.toFixed(7)) as Q4;

export interface WeaponAnchorEntry {
  character: string;
  pose: string;
  weapon: string;
  attachment: 'hand' | 'hip';
  side: 'right' | 'left';
  parent: string;
  sampleFraction: number;
  basePosition: V3;
  baseQuaternion: Q4;
  editedPosition: V3;
  editedQuaternion: Q4;
}

interface Target {
  object: THREE.Object3D;
  basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  attachment: 'hand' | 'hip';
  hand: 'right' | 'left';
  marker: THREE.Mesh;
}

/** Export-only adjustments to visible props on authored hand and hip mounts. */
export class WeaponAnchorEditor {
  enabled = false;
  selected: string | null = null;
  private character = '';
  private pose = '';
  private sampleFraction = 0;
  private targets = new Map<string, Target>();
  private entries = new Map<string, WeaponAnchorEntry>();
  private overlay = new THREE.Group();
  private gizmo: TransformControls;
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera,
    private orbit: OrbitControls, private dom: HTMLElement, private onChange: () => void) {
    scene.add(this.overlay);
    this.overlay.visible = false;
    this.gizmo = new TransformControls(camera, dom);
    this.gizmo.setMode('translate');
    this.gizmo.setSize(0.65);
    this.gizmo.visible = false;
    scene.add(this.gizmo);
    this.gizmo.addEventListener('dragging-changed', (event) => { this.orbit.enabled = !event.value; });
    this.gizmo.addEventListener('objectChange', () => this.record());
    dom.addEventListener('pointerdown', this.pick);
  }

  setPose(character: string, pose: string, root: THREE.Object3D | null): void {
    this.restore();
    this.gizmo.detach();
    for (const target of this.targets.values()) {
      this.overlay.remove(target.marker);
      target.marker.geometry.dispose();
      (target.marker.material as THREE.Material).dispose();
    }
    this.targets.clear();
    this.character = character;
    this.pose = pose;
    root?.traverse((mount) => {
      if (mount.name !== 'weaponMount' && mount.name !== 'weaponMountL' && mount.name !== 'holsterMount') return;
      const attachment = mount.name === 'holsterMount' ? 'hip' : 'hand';
      for (const object of mount.children) {
        // The pelvis mount may carry other accessories in the future. Only
        // named stowed weapons belong in the weapon grip editor.
        if (attachment === 'hip' && !object.name.startsWith('saberHolster')) continue;
        if (!object.visible || !this.hasVisibleMesh(object)) continue;
        const hand = attachment === 'hip'
          ? object.name.endsWith('L') ? 'left' : 'right'
          : mount.name === 'weaponMount' ? 'right' : 'left';
        const label = `${hand}: ${object.name || `weapon ${mount.children.indexOf(object) + 1}`}`;
        const name = attachment === 'hip' ? `hip ${label}` : label;
        const marker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0xffc86b, depthTest: false, depthWrite: false }));
        marker.renderOrder = 999;
        this.overlay.add(marker);
        const target: Target = {
          object, hand, attachment, marker,
          basePosition: object.position.clone(), baseQuaternion: object.quaternion.clone(),
        };
        this.targets.set(name, target);
        const saved = this.entries.get(this.key(name, attachment));
        if (saved) {
          object.position.set(...saved.editedPosition);
          object.quaternion.set(...saved.editedQuaternion);
        }
      }
    });
    this.select(this.targets.has(this.selected ?? '') ? this.selected : this.names()[0] ?? null);
  }

  private hasVisibleMesh(root: THREE.Object3D): boolean {
    let found = false;
    root.traverse((object) => {
      if ((object as THREE.Mesh).isMesh && object.visible) found = true;
    });
    return found;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.overlay.visible = enabled;
    if (!enabled) { this.gizmo.detach(); this.orbit.enabled = true; }
    else this.select(this.selected);
    this.gizmo.visible = enabled && !!this.selected;
  }

  setMode(mode: 'translate' | 'rotate'): void {
    this.gizmo.setMode(mode);
    this.gizmo.setSpace(mode === 'rotate' ? 'local' : 'world');
    this.onChange();
  }
  setSampleFraction(value: number): void { this.sampleFraction = value; }
  get mode(): 'translate' | 'rotate' { return this.gizmo.getMode() as 'translate' | 'rotate'; }
  names(): string[] { return [...this.targets.keys()]; }
  entriesAll(): WeaponAnchorEntry[] { return [...this.entries.values()].sort((a, b) =>
    a.character.localeCompare(b.character) || a.pose.localeCompare(b.pose) || a.weapon.localeCompare(b.weapon)); }
  current(): WeaponAnchorEntry | null { return this.selected ? this.measure(this.selected) : null; }

  select(name: string | null): void {
    this.selected = name && this.targets.has(name) ? name : null;
    this.gizmo.detach();
    if (this.enabled && this.selected) this.gizmo.attach(this.targets.get(this.selected)!.object);
    this.gizmo.visible = this.enabled && !!this.selected;
    this.onChange();
  }

  setPosition(position: V3): void {
    if (!this.selected || position.some((n) => !Number.isFinite(n))) return;
    this.targets.get(this.selected)!.object.position.set(...position);
    this.record();
  }

  setRotation(degrees: V3): void {
    if (!this.selected || degrees.some((n) => !Number.isFinite(n))) return;
    this.targets.get(this.selected)!.object.rotation.set(...degrees.map(THREE.MathUtils.degToRad) as V3, 'XYZ');
    this.record();
  }

  currentDegrees(): V3 | null {
    if (!this.selected) return null;
    const e = new THREE.Euler().setFromQuaternion(this.targets.get(this.selected)!.object.quaternion, 'XYZ');
    return vec(new THREE.Vector3(e.x, e.y, e.z).multiplyScalar(THREE.MathUtils.RAD2DEG));
  }

  resetSelected(): void {
    if (!this.selected) return;
    const target = this.targets.get(this.selected)!;
    target.object.position.copy(target.basePosition);
    target.object.quaternion.copy(target.baseQuaternion);
    this.entries.delete(this.key(this.selected, target.attachment));
    this.onChange();
  }

  restore(): void {
    for (const target of this.targets.values()) {
      target.object.position.copy(target.basePosition);
      target.object.quaternion.copy(target.baseQuaternion);
    }
  }

  update(camera: THREE.Camera): void {
    if (!this.enabled) return;
    const p = new THREE.Vector3();
    for (const [name, target] of this.targets) {
      target.object.getWorldPosition(p);
      target.marker.position.copy(p);
      target.marker.scale.setScalar(camera.position.distanceTo(p) * 0.005);
      (target.marker.material as THREE.MeshBasicMaterial).color.setHex(name === this.selected ? 0xffe4a0 : 0xffa650);
    }
  }

  private key(name: string, attachment: 'hand' | 'hip'): string {
    // The same hip-local transform serves rest, idle, and every other pose
    // where the weapon is stowed. Keep its edit when the preview pose changes.
    return `${this.character}|${attachment === 'hip' ? 'stowed' : this.pose}|${name}`;
  }
  private measure(name: string): WeaponAnchorEntry | null {
    const target = this.targets.get(name);
    if (!target) return null;
    return {
      character: this.character, pose: this.pose, weapon: name,
      attachment: target.attachment, side: target.hand,
      parent: target.object.parent?.name ?? '',
      sampleFraction: this.sampleFraction,
      basePosition: vec(target.basePosition), baseQuaternion: quat(target.baseQuaternion),
      editedPosition: vec(target.object.position), editedQuaternion: quat(target.object.quaternion),
    };
  }

  private record(): void {
    if (!this.selected) return;
    const entry = this.measure(this.selected)!;
    const target = this.targets.get(this.selected)!;
    if (target.object.position.distanceToSquared(target.basePosition) < 1e-12
      && target.object.quaternion.angleTo(target.baseQuaternion) < 1e-6)
      this.entries.delete(this.key(this.selected, target.attachment));
    else this.entries.set(this.key(this.selected, target.attachment), entry);
    this.onChange();
  }

  private pick = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0 || this.gizmo.dragging) return;
    const rect = this.dom.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.gizmo.camera);
    const hit = this.ray.intersectObjects([...this.targets.values()].map((t) => t.marker), false)[0];
    const picked = [...this.targets].find(([, target]) => target.marker === hit?.object)?.[0];
    if (picked) this.select(picked);
  };
}
