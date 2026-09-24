import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface PositionEntry {
  character: string;
  pose: string;
  bone: string;
  parent: string;
  baseLocal: [number, number, number];
  editedLocal: [number, number, number];
  deltaLocal: [number, number, number];
  deltaWorldMetres: [number, number, number];
}

const xyz = (v: THREE.Vector3): [number, number, number] =>
  [v.x, v.y, v.z].map((n) => Number(n.toFixed(5))) as [number, number, number];

// The driven joints, rather than Rigify's many twist and helper bones.
const EDITABLE = new Set([
  'DEF-spine', 'DEF-spine001', 'DEF-spine003', 'DEF-spine005', 'DEF-spine006',
  'DEF-shoulderL', 'DEF-shoulderR', 'DEF-upper_armL', 'DEF-upper_armR',
  'DEF-forearmL', 'DEF-forearmR', 'DEF-handL', 'DEF-handR',
  'DEF-thighL', 'DEF-thighR', 'DEF-shinL', 'DEF-shinR', 'DEF-footL', 'DEF-footR',
]);

/** Moves the actual GLB bones. The measurements are pose-specific and export-only. */
export class PositionEditor {
  enabled = false;
  selected: string | null = null;
  private bones = new Map<string, THREE.Bone>();
  private bases = new Map<string, THREE.Vector3>();
  private lastPositions = new Map<string, THREE.Vector3>();
  private entries = new Map<string, PositionEntry>();
  private markers = new Map<string, THREE.Mesh>();
  private overlay = new THREE.Group();
  private gizmo: TransformControls;
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private character = '';
  private pose = '';

  constructor(
    scene: THREE.Scene, camera: THREE.PerspectiveCamera,
    private orbit: OrbitControls, private dom: HTMLElement,
    private onChange: () => void,
  ) {
    scene.add(this.overlay);
    this.overlay.visible = false;
    this.gizmo = new TransformControls(camera, dom);
    this.gizmo.setMode('translate');
    this.gizmo.setSize(0.7);
    scene.add(this.gizmo);
    this.gizmo.visible = false;
    this.gizmo.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value;
    });
    this.gizmo.addEventListener('objectChange', () => this.record());
    dom.addEventListener('pointerdown', this.pick);
  }

  /** Called after the desired animation frame has been copied to the GLB. */
  setPose(character: string, pose: string, root: THREE.Object3D | null): void {
    this.gizmo.detach();
    this.bones.clear();
    this.bases.clear();
    this.lastPositions.clear();
    this.clearMarkers();
    this.character = character;
    this.pose = pose;
    root?.traverse((object) => {
      if (!(object as THREE.Bone).isBone || !EDITABLE.has(object.name.replace(/\./g, ''))) return;
      const bone = object as THREE.Bone;
      this.bones.set(bone.name, bone);
      this.bases.set(bone.name, bone.position.clone());
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x5cc8ee, depthTest: false, depthWrite: false }),
      );
      marker.renderOrder = 999;
      this.overlay.add(marker);
      this.markers.set(bone.name, marker);
    });
    for (const [name, bone] of this.bones) {
      const entry = this.entries.get(this.key(name));
      if (entry) bone.position.set(...entry.editedLocal);
      this.lastPositions.set(name, bone.position.clone());
    }
    this.select(this.bones.has(this.selected ?? '') ? this.selected : null);
    this.onChange();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.overlay.visible = enabled;
    this.gizmo.visible = enabled && !!this.selected;
    if (!enabled) { this.gizmo.detach(); this.orbit.enabled = true; }
    else this.select(this.selected);
  }

  names(): string[] { return [...this.bones.keys()].sort(); }
  entriesForPose(): PositionEntry[] {
    return this.entriesAll().filter((e) => e.character === this.character && e.pose === this.pose);
  }
  entriesAll(): PositionEntry[] {
    return [...this.entries.values()].sort((a, b) =>
      a.character.localeCompare(b.character) || a.pose.localeCompare(b.pose) || a.bone.localeCompare(b.bone));
  }
  current(): PositionEntry | null { return this.selected ? this.measure(this.selected) : null; }

  select(name: string | null): void {
    this.selected = name && this.bones.has(name) ? name : null;
    this.gizmo.detach();
    if (this.enabled && this.selected) this.gizmo.attach(this.bones.get(this.selected)!);
    this.gizmo.visible = this.enabled && !!this.selected;
    this.onChange();
  }

  setLocal(values: [number, number, number]): void {
    if (!this.selected || values.some((n) => !Number.isFinite(n))) return;
    this.bones.get(this.selected)!.position.set(...values);
    this.record();
  }

  resetSelected(): void {
    if (!this.selected) return;
    const base = this.bases.get(this.selected);
    if (!base) return;
    const bone = this.bones.get(this.selected)!;
    const change = base.clone().sub(bone.position);
    bone.position.copy(base);
    this.lastPositions.set(this.selected, base.clone());
    const armName = this.linkedArm(this.selected);
    const arm = armName && this.bones.get(armName);
    if (arm && armName) {
      arm.position.add(change);
      this.lastPositions.set(armName, arm.position.clone());
      this.storeMeasurement(armName);
    }
    this.entries.delete(this.key(this.selected));
    this.onChange();
  }

  restore(): void {
    for (const [name, bone] of this.bones) {
      const base = this.bases.get(name);
      if (base) bone.position.copy(base);
    }
  }

  update(camera: THREE.Camera): void {
    if (!this.enabled) return;
    const p = new THREE.Vector3();
    for (const [name, marker] of this.markers) {
      this.bones.get(name)!.getWorldPosition(p);
      marker.position.copy(p);
      marker.scale.setScalar(camera.position.distanceTo(p) * 0.005);
      (marker.material as THREE.MeshBasicMaterial).color.setHex(name === this.selected ? 0xffd479 : 0x5cc8ee);
    }
  }

  private key(name: string): string { return `${this.character}|${this.pose}|${name}`; }

  private measure(name: string): PositionEntry | null {
    const bone = this.bones.get(name);
    const base = this.bases.get(name);
    if (!bone || !base) return null;
    const delta = bone.position.clone().sub(base);
    bone.parent?.updateWorldMatrix(true, false);
    const metres = delta.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(bone.parent?.matrixWorld ?? new THREE.Matrix4()));
    return {
      character: this.character, pose: this.pose, bone: name,
      parent: bone.parent?.name ?? '', baseLocal: xyz(base), editedLocal: xyz(bone.position),
      deltaLocal: xyz(delta), deltaWorldMetres: xyz(metres),
    };
  }

  private record(): void {
    if (!this.selected) return;
    const bone = this.bones.get(this.selected)!;
    const previous = this.lastPositions.get(this.selected) ?? bone.position;
    const step = bone.position.clone().sub(previous);
    this.lastPositions.set(this.selected, bone.position.clone());
    const armName = this.linkedArm(this.selected);
    const arm = armName && this.bones.get(armName);
    if (arm && armName && step.lengthSq() > 0) {
      arm.position.add(step);
      this.lastPositions.set(armName, arm.position.clone());
      this.storeMeasurement(armName);
    }
    this.storeMeasurement(this.selected);
    this.onChange();
  }

  private linkedArm(name: string): string | null {
    return name.startsWith('DEF-shoulder') ? name.replace('DEF-shoulder', 'DEF-upper_arm') : null;
  }

  private storeMeasurement(name: string): void {
    const entry = this.measure(name);
    if (!entry) return;
    if (entry.deltaLocal.every((n) => Math.abs(n) < 0.00001)) this.entries.delete(this.key(name));
    else this.entries.set(this.key(name), entry);
  }

  private pick = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0 || this.gizmo.dragging) return;
    const rect = this.dom.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.gizmo.camera);
    const hit = this.ray.intersectObjects([...this.markers.values()], false)[0];
    if (!hit) return;
    const name = [...this.markers].find(([, marker]) => marker === hit.object)?.[0];
    if (name) this.select(name);
  };

  private clearMarkers(): void {
    for (const marker of this.markers.values()) {
      this.overlay.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }
    this.markers.clear();
  }
}
