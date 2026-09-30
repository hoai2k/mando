import * as THREE from 'three';
import {
  deployedFistTune, fistDefaults, fistFrames, fistKind, fistModel, fistTune, refitFists, seatFistsOnPalms, setWorkbenchFistTune,
  type FistTune,
} from '../characters/fistRig';
import { palmOf, palmPlaced } from '../characters/handAnchors';
import { FISTS_IN_PLAY } from '../characters/fists';

/**
 * The workbench's Fist section: a sculpt's fist tuned by hand (`FistTune` in
 * `fistRig.ts`) — where the added finger joints sit along the hand, how far
 * each turns, the curl's tilt, a palm flip — with a clench to hold it at and
 * guides drawn on the hand. Like the shoulder widths, an adjustment stays in
 * this page: a reload shows what is deployed (`data/fistTunes.json`), and the
 * export is how a tune gets there.
 */

interface Slider {
  key: Exclude<keyof FistTune, 'flip'>; label: string; min: number; max: number; step: number; unit: string; added?: boolean;
  title?: string;
}
const SLIDERS: Slider[] = [
  { key: 'knuckleFromPalm', label: 'Knuckle joint past the palm mark', min: -0.2, max: 0.2, step: 0.005, unit: '±%', added: true,
    title: 'How far along the hand (a share of its length, toward the fingertips) the joint the fingers bend at sits from the palm mark' },
  { key: 'knuckleAt', label: 'Knuckle joint along the hand, with no palm placed', min: 0.25, max: 0.75, step: 0.01, unit: '%', added: true },
  { key: 'middleOn', label: 'Middle joint along the fingers', min: 0.2, max: 0.8, step: 0.01, unit: '%', added: true,
    title: 'The share of the way from the knuckle joint to the fingertips' },
  { key: 'knuckle', label: 'Knuckle curl', min: 0, max: 140, step: 1, unit: '°' },
  { key: 'middle', label: 'Middle-joint curl', min: 0, max: 140, step: 1, unit: '°' },
  { key: 'thumb', label: 'Thumb swing', min: 0, max: 120, step: 1, unit: '°' },
  { key: 'thumbTwist', label: 'Thumb twist', min: -60, max: 60, step: 1, unit: '°', added: true },
  { key: 'tilt', label: 'Curl tilt about the palm', min: -45, max: 45, step: 1, unit: '°' },
];
const show = (s: Slider, v: number): string => s.unit === '%' ? `${Math.round(v * 100)}%`
  : s.unit === '±%' ? `${v > 0 ? '+' : ''}${+(v * 100).toFixed(1)}%` : `${Math.round(v)}°`;

/** the guides' colours, one per joint, as the legend names them */
const PART_COLOUR = { knuckle: 0xff8a3d, middle: 0xffd84a, thumb: 0x4ad8ff } as const;
type Part = keyof typeof PART_COLOUR;

export class FistTuning {
  /** hold every hand at this clench while `hold` is set (0 open, 1 a fist) */
  hold = false;
  clench = 1;
  guides = false;
  /** whose palms these are (the workbench's character): each hand's knuckles are seated from its palm mark */
  subject = '';
  private readonly group = new THREE.Group();
  private revision = 0;

  constructor(scene: THREE.Scene) {
    this.group.renderOrder = 999;
    scene.add(this.group);
  }

  /** the sculpt the section tunes: the first figure whose hands have fingers */
  model(roots: THREE.Object3D[]): string | null {
    for (const r of roots) { const m = fistModel(r); if (m) return m; }
    return null;
  }

  html(roots: THREE.Object3D[], open: boolean): string {
    const model = this.model(roots);
    if (!model) return '';
    const tune = fistTune(model), kind = fistKind(model) ?? 'added';
    const deployed = deployedFistTune(model);
    const tier = FISTS_IN_PLAY[model];
    const changed = (Object.keys(tune) as Array<keyof FistTune>).some((k) => tune[k] !== deployed[k]);
    return `
    <details class="fold" data-fold="fist" ${open ? 'open' : ''}><summary>Fist</summary>
    <p class="hint">${tier === 'all' ? 'The game closes these hands everywhere.' : tier === 'npc'
      ? 'The game closes these hands on its own fighters only.' : 'Not in play yet: the game leaves these hands open.'}
      ${kind === 'own' ? ' The sculpt has fingers of its own, so its joints stay where they were built.' : ''}</p>
    ${kind === 'added' ? `<p class="hint">Each hand's knuckle joint is seated from its palm mark (Edit → Weapon grips → Hand anchors):
      put the dot on the palm's skin where the fingers start, and the fingers bend there${this.palmNote(model)}. Moving a palm moves its fist.</p>` : ''}
    <label class="check"><input type="checkbox" id="fistHold" ${this.hold ? 'checked' : ''}> Hold the clench at
      <output id="fistClenchValue">${Math.round(this.clench * 100)}%</output></label>
    <input id="fistClench" type="range" min="0" max="1" step="0.01" value="${this.clench}" aria-label="Clench to hold">
    ${SLIDERS.filter((s) => kind === 'added' || !s.added).map((s) => `
    <div class="field playback">
      <label for="fist_${s.key}">${s.label} <output id="fist_${s.key}Value">${show(s, tune[s.key])}</output></label>
      <input id="fist_${s.key}" data-fist="${s.key}" type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${tune[s.key]}"${s.title ? ` title="${s.title}"` : ''}>
    </div>`).join('')}
    <label class="check" title="For a palm measured on the wrong side: the fingers curl the other way"><input type="checkbox" id="fistFlip" ${tune.flip ? 'checked' : ''}> Flip the palm side</label>
    <label class="check"><input type="checkbox" id="fistGuides" ${this.guides ? 'checked' : ''}> Show fist guides</label>
    ${this.guides ? `<p class="hint fist-legend"><span style="color:#ff8a3d">●</span> knuckle joint
      <span style="color:#ffd84a">●</span> middle joint <span style="color:#4ad8ff">●</span> thumb — dots at each pivot, a line
      through it for the axis it turns on, the skin it carries dotted in its colour; the white arrow is the side the
      palm faces, which the fingers close toward.</p>` : ''}
    <div class="row">
      <button id="fistReset" type="button" ${changed ? '' : 'disabled'}>Reset to deployed</button>
      <button id="fistExport" type="button">Export fist JSON</button>
    </div>
    </details>`;
  }

  bind(panel: HTMLElement, roots: () => THREE.Object3D[], rerender: () => void): void {
    const model = this.model(roots());
    if (!model) return;
    const set = (patch: Partial<FistTune>, refit = false): void => {
      setWorkbenchFistTune(model, { ...fistTune(model), ...patch });
      if (refit) { refitFists(model, roots()); this.revision++; }
      const reset = panel.querySelector<HTMLButtonElement>('#fistReset');
      if (reset) reset.disabled = false;
    };
    for (const s of SLIDERS) {
      const input = panel.querySelector<HTMLInputElement>(`#fist_${s.key}`);
      if (!input) continue;
      input.oninput = () => {
        const v = Number(input.value);
        set({ [s.key]: v }, !!s.added && s.key !== 'thumbTwist');
        panel.querySelector<HTMLOutputElement>(`#fist_${s.key}Value`)!.value = show(s, v);
      };
    }
    const hold = panel.querySelector<HTMLInputElement>('#fistHold');
    if (hold) hold.onchange = () => { this.hold = hold.checked; };
    const clench = panel.querySelector<HTMLInputElement>('#fistClench');
    if (clench) clench.oninput = () => {
      this.clench = Number(clench.value);
      this.hold = true;
      if (hold) hold.checked = true;
      panel.querySelector<HTMLOutputElement>('#fistClenchValue')!.value = `${Math.round(this.clench * 100)}%`;
    };
    const flip = panel.querySelector<HTMLInputElement>('#fistFlip');
    if (flip) flip.onchange = () => set({ flip: flip.checked });
    const guides = panel.querySelector<HTMLInputElement>('#fistGuides');
    if (guides) guides.onchange = () => { this.guides = guides.checked; rerender(); };
    panel.querySelector<HTMLButtonElement>('#fistReset')?.addEventListener('click', () => {
      setWorkbenchFistTune(model, null);
      refitFists(model, roots());
      this.revision++;
      rerender();
    });
    panel.querySelector<HTMLButtonElement>('#fistExport')?.addEventListener('click', () => this.export(model));
  }

  /** which hands' knuckles are seated from a placed palm, for the section's hint */
  private palmNote(model: string): string {
    if (!this.subject) return '';
    const sides = fistFrames(model).map((f) => `${f.side === 'L' ? 'left' : 'right'} ${Math.round(f.knuckleAt * 100)}%${
      palmPlaced(this.subject, f.side) ? '' : ' (no palm placed)'}`);
    return sides.length ? ` — the knuckle joints now: ${sides.join(', ')} of the way down the hand` : '';
  }

  /**
   * Each hand's knuckle and middle joints seated from its palm as it stands
   * (placed palms only), so a palm dragged moves its fist. True when a joint moved.
   */
  seatOnPalms(roots: THREE.Object3D[]): boolean {
    if (!this.subject) return false;
    const model = this.model(roots);
    if (!model || fistKind(model) !== 'added') return false;
    const root = roots.find((r) => fistModel(r) === model);
    if (!root) return false;
    const id = this.subject;
    if (!seatFistsOnPalms(model, root, (side) => palmPlaced(id, side) ? palmOf(id, side) : null)) return false;
    this.revision++;
    return true;
  }

  /** One sculpt's tune, whole, with what differs from what is deployed. */
  private export(model: string): void {
    const tune = fistTune(model), deployed = deployedFistTune(model);
    const changed = Object.fromEntries((Object.keys(tune) as Array<keyof FistTune>)
      .filter((k) => tune[k] !== deployed[k]).map((k) => [k, { deployed: deployed[k], tuned: tune[k] }]));
    const doc = {
      format: 'mando-fist-tune/1',
      exportedAt: new Date().toISOString(),
      model,
      kind: fistKind(model),
      howToApply: 'Put `tune` under this model in src/characters/data/fistTunes.json (only the keys that differ from `defaults` are needed).',
      tune, changed, defaults: fistDefaults(model),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fist-tune_${model}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- guides ----------

  private dots = new Map<THREE.SkinnedMesh, { revision: number; verts: number[]; parts: Part[]; points: THREE.Points }>();
  private marks: THREE.Object3D[] = [];

  private shown: string | null = null;

  /**
   * Redraw the guides on each figure's hands, where they are this frame. True
   * when the sculpt with fingers has changed (a model arrives a beat after its
   * figure), so the panel can offer the section for it.
   */
  update(roots: THREE.Object3D[]): boolean {
    const model = this.model(roots);
    const arrived = model !== this.shown;
    this.shown = model;
    this.draw(roots);
    return arrived;
  }

  private draw(roots: THREE.Object3D[]): void {
    this.group.visible = this.guides;
    for (const m of this.marks) {
      this.group.remove(m);
      m.traverse((c) => {
        const mesh = c as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose();
      });
    }
    this.marks = [];
    if (!this.guides) return;
    const seen = new Set<THREE.SkinnedMesh>();
    for (const root of roots) {
      const model = fistModel(root);
      if (!model) continue;
      root.updateMatrixWorld(true);
      const tune = fistTune(model);
      root.traverse((o) => {
        const curl = o.userData.fistCurl as { axis: number[]; part?: Part; palm?: number[] } | undefined;
        if (curl?.part) this.markJoint(o, curl as { axis: number[]; part: Part; palm?: number[] }, tune);
        const mesh = o as THREE.SkinnedMesh;
        if (mesh.isSkinnedMesh) { seen.add(mesh); this.dotSkin(mesh); }
      });
    }
    for (const [mesh, d] of this.dots) if (!seen.has(mesh)) { this.group.remove(d.points); d.points.geometry.dispose(); this.dots.delete(mesh); }
  }

  private markJoint(bone: THREE.Object3D, curl: { axis: number[]; part: Part; palm?: number[] }, tune: FistTune): void {
    const at = bone.getWorldPosition(new THREE.Vector3());
    // the axis lives in the frame the curl turns in: the bone's own at rest,
    // which its parent's world turn (and, for a sculpt's own finger, its rest) carries
    const frame = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    const rest = (bone.userData.fistCurl as { rest?: [number, number, number, number] }).rest;
    if (rest) frame.multiply(new THREE.Quaternion().fromArray(rest));
    const axis = new THREE.Vector3().fromArray(curl.axis);
    if (tune.tilt && curl.palm && curl.part !== 'thumb') axis.applyAxisAngle(new THREE.Vector3().fromArray(curl.palm), THREE.MathUtils.degToRad(tune.tilt));
    axis.applyQuaternion(frame).normalize();
    const colour = PART_COLOUR[curl.part];
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), new THREE.MeshBasicMaterial({ color: colour, depthTest: false }));
    ball.position.copy(at);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      at.clone().addScaledVector(axis, -0.04), at.clone().addScaledVector(axis, 0.04)]),
    new THREE.LineBasicMaterial({ color: colour, depthTest: false }));
    this.add(ball, line);
    if (curl.part === 'knuckle' && curl.palm) {
      const palm = new THREE.Vector3().fromArray(curl.palm).applyQuaternion(frame).normalize().multiplyScalar(tune.flip ? -1 : 1);
      const arrow = new THREE.ArrowHelper(palm, at, 0.07, 0xffffff, 0.02, 0.012);
      arrow.traverse((c) => { const m = (c as THREE.Mesh).material as THREE.Material | undefined; if (m) m.depthTest = false; });
      this.add(arrow);
    }
  }

  private add(...objs: THREE.Object3D[]): void {
    for (const o of objs) { o.renderOrder = 999; this.group.add(o); this.marks.push(o); }
  }

  /** the skin each finger joint carries, dotted in its colour where the skin is now */
  private dotSkin(mesh: THREE.SkinnedMesh): void {
    let d = this.dots.get(mesh);
    if (!d || d.revision !== this.revision) {
      if (d) { this.group.remove(d.points); d.points.geometry.dispose(); }
      const idx = mesh.geometry.attributes.skinIndex, wt = mesh.geometry.attributes.skinWeight;
      const verts: number[] = [], parts: Part[] = [];
      for (let v = 0; v < idx.count; v++) {
        let best: Part | null = null, bw = 0.15;
        for (let k = 0; k < idx.itemSize; k++) {
          const part = (mesh.skeleton.bones[idx.getComponent(v, k)]?.userData.fistCurl as { part?: Part } | undefined)?.part;
          const w = wt.getComponent(v, k);
          if (part && w > bw) { bw = w; best = part; }
        }
        if (best) { verts.push(v); parts.push(best); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(verts.length * 3), 3));
      const colours = new Float32Array(verts.length * 3);
      const c = new THREE.Color();
      parts.forEach((p, i) => c.setHex(PART_COLOUR[p]).toArray(colours, i * 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
      const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, depthTest: false }));
      points.renderOrder = 998;
      points.frustumCulled = false;
      this.group.add(points);
      d = { revision: this.revision, verts, parts, points };
      this.dots.set(mesh, d);
    }
    const pos = d.points.geometry.attributes.position as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    d.verts.forEach((v, i) => {
      mesh.getVertexPosition(v, p);
      p.applyMatrix4(mesh.matrixWorld);
      pos.setXYZ(i, p.x, p.y, p.z);
    });
    pos.needsUpdate = true;
  }
}
