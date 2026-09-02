import * as THREE from 'three';
import { loadSkinFix, setSkinFixes, type SkinFix, type SkinFixDoc } from '../characters/skinfix';

/**
 * Skinning review — the workbench's second job.
 *
 * `tools/skin-audit.mjs` finds skin weights that leak across limb chains and
 * writes a fix per leak; the ones it is sure of are already on in the game,
 * the rest wait here as `pending`. This panel puts the authored figure into a
 * pose that exercises every chain at once, paints where each bone's weight
 * sits, and lets each fix be switched on and off, approved or discarded. The
 * decisions export as one JSON, which `tools/skin-decide.mjs` folds back into
 * the fix files.
 */

/** what the panel needs of a figure on the turntable */
export interface SkinFigure {
  root: THREE.Object3D;
  bones: Record<string, THREE.Object3D> | null;
  rest: Array<{ bone: THREE.Object3D; quaternion: THREE.Quaternion; position: THREE.Vector3 }>;
}

type Heat = 'none' | 'armL' | 'armR' | 'legs' | 'lower' | 'torso' | 'head' | 'fixed' | `fix:${string}`;
const HEATS: Array<[Heat, string]> = [
  ['none', 'Off'], ['fixed', 'Vertices the fixes touch'],
  ['armL', 'Left arm weight'], ['armR', 'Right arm weight'], ['legs', 'Leg weight'],
  ['lower', 'Hips + abdomen weight'], ['torso', 'Chest + shoulder weight'], ['head', 'Neck + head weight'],
];

/**
 * A pose every chain takes part in: left arm up and forward, right arm out,
 * left leg striding, head turned. Nothing in the clip set holds all of that
 * at once, and a leak only shows when its chain moves.
 */
const D = Math.PI / 180;
const TEST_POSE: Record<string, [number, number, number]> = {
  upperArmL: [-70 * D, 0, 60 * D], forearmL: [-50 * D, 0, 0],
  upperArmR: [-30 * D, 0, -85 * D], forearmR: [-20 * D, 0, 0],
  upperLegL: [-45 * D, 0, 0], lowerLegL: [50 * D, 0, 0], upperLegR: [20 * D, 0, 0],
  neck: [0, 20 * D, 0], head: [0, 50 * D, 0],
};

const KIND_HELP: Record<string, string> = {
  'arm-drives-lower': 'Skirt, belt or thigh vertices carry hand / forearm weight and lift when the arm swings.',
  'lower-drives-arm': 'Hand / sleeve vertices carry thigh or hip weight and twitch with the stride.',
  'arm-drives-head': 'Helmet / head vertices carry arm weight and dent when the arm rises.',
  'arm-drives-other-arm': 'Vertices of one arm carry the other arm’s weight.',
  'head-drives-lower': 'Lower-body vertices carry neck / head weight.',
  'lower-drives-head': 'Head vertices carry leg / hip weight.',
  'arm-drives-torso': 'Chest / back vertices carry arm weight — a deliberate deltoid blend near the shoulder, a leak further away.',
  'torso-drives-arm': 'Arm vertices carry chest weight — normal at the shoulder, a drag further down the arm.',
  'head-drives-torso': 'Cowl / pauldron / collar vertices carry neck or head weight and turn with the head.',
  'torso-drives-head': 'Helmet / head vertices carry chest weight and lag behind a head turn.',
};

const STORE = 'workbench.skinfix.decisions';

function bandName([lo, hi]: [number, number]): string {
  const at = (f: number) => (f > 0.86 ? 'head' : f > 0.72 ? 'shoulders' : f > 0.58 ? 'chest' : f > 0.46 ? 'hips'
    : f > 0.3 ? 'thighs' : f > 0.14 ? 'shins' : 'feet');
  const a = at(hi), b = at(lo);
  return a === b ? a : `${a} → ${b}`;
}

export class SkinPanel {
  private doc: SkinFixDoc | null = null;
  private modelId: string | null = null;
  private figures: SkinFigure[] = [];
  /** the authored model, once its skinned mesh is on the turntable */
  private model: THREE.Object3D | null = null;
  private enabled = new Set<string>();
  private decisions: Record<string, 'approve' | 'discard'> = {};
  private heat: Heat = 'none';
  private heatMats = new Map<THREE.SkinnedMesh, THREE.Material | THREE.Material[]>();
  private open = false;
  /** hold the test pose on the bones each frame */
  holding = false;

  constructor(private host: HTMLElement, private onChange: () => void) {
    try { this.decisions = JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { this.decisions = {}; }
  }

  /** a new subject is on the turntable; its model may still be loading */
  setSubject(modelId: string | null, figures: SkinFigure[]): void {
    this.clearHeat();
    this.modelId = modelId;
    this.figures = figures;
    this.model = null;
    this.doc = null;
    this.enabled.clear();
    if (modelId) {
      void loadSkinFix(modelId).then((doc) => {
        if (this.modelId !== modelId) return;
        this.doc = doc;
        for (const f of doc?.fixes ?? []) if (this.showByDefault(f)) this.enabled.add(f.id);
        this.render();
      });
    }
    this.render();
  }

  /** what a fix looks like on the turntable before anyone touches it */
  private showByDefault(f: SkinFix): boolean {
    const d = this.decisions[f.id];
    if (d) return d === 'approve';
    return f.status === 'applied';
  }

  /** once per frame: bind the model when it lands, hold the pose */
  frame(): void {
    if (!this.model) {
      for (const f of this.figures) {
        f.root.traverse((o) => { if (!this.model && (o as THREE.SkinnedMesh).isSkinnedMesh) this.model = o; });
      }
      if (this.model) {
        // the figure's model root: walk up to the child of the rig root
        let m: THREE.Object3D = this.model;
        while (m.parent && !this.figures.some((f) => f.root === m.parent)) m = m.parent;
        this.model = m;
        this.applyFixes();
        this.paint();
        this.render();
      }
    }
    if (this.holding) {
      for (const f of this.figures) {
        if (!f.bones) continue;
        for (const r of f.rest) { r.bone.quaternion.copy(r.quaternion); r.bone.position.copy(r.position); }
        for (const [name, e] of Object.entries(TEST_POSE)) f.bones[name]?.rotation.set(e[0], e[1], e[2]);
      }
    }
  }

  private applyFixes(): void {
    if (!this.model || !this.doc) return;
    setSkinFixes(this.model, this.doc.fixes.filter((f) => this.enabled.has(f.id)));
  }

  // ---------- heat ----------
  private clearHeat(): void {
    for (const [mesh, mat] of this.heatMats) {
      mesh.material = mat;
      mesh.geometry.deleteAttribute('color');
    }
    this.heatMats.clear();
  }

  private paint(): void {
    this.clearHeat();
    if (this.heat === 'none' || !this.model) return;
    const heat = this.heat;
    const strip = (n: string) => n.replace(/^DEF-/, '').replace(/[.\s:[\]]/g, '');
    const match = (n: string): boolean => {
      const b = strip(n);
      switch (heat) {
        case 'armL': return /^(upper_arm|forearm|hand)L/.test(b);
        case 'armR': return /^(upper_arm|forearm|hand)R/.test(b);
        case 'legs': return /^(thigh|shin|foot|toe)/.test(b);
        case 'lower': return /^(spine|spine001|spine002|pelvis)/.test(b) && !/spine00[3-6]/.test(b);
        case 'torso': return /^(spine003|spine004|shoulder)/.test(b);
        case 'head': return /^(spine005|spine006)$/.test(b);
        default: return false;
      }
    };
    const fixVerts = new Set<number>();
    if (heat === 'fixed' || heat.startsWith('fix:')) {
      const want = heat === 'fixed'
        ? (this.doc?.fixes ?? []).filter((f) => this.enabled.has(f.id))
        : (this.doc?.fixes ?? []).filter((f) => f.id === heat.slice(4));
      for (const f of want) for (const v of f.vertices) fixVerts.add(v);
    }
    this.model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const g = mesh.geometry;
      const idx = g.attributes.skinIndex;
      const w = g.attributes.skinWeight;
      const names = mesh.skeleton.bones.map((b) => b.name);
      const col = new Float32Array(idx.count * 3);
      for (let i = 0; i < idx.count; i++) {
        let s = 0;
        if (fixVerts.size) s = fixVerts.has(i) ? 1 : 0;
        else for (let k = 0; k < idx.itemSize; k++) if (match(names[idx.getComponent(i, k)])) s += w.getComponent(i, k);
        if (s <= 0.02) { col[i * 3] = 0.22; col[i * 3 + 1] = 0.24; col[i * 3 + 2] = 0.3; continue; }
        const t = Math.min(1, s / 0.6);
        col[i * 3] = 0.2 + t * 0.8; col[i * 3 + 1] = 0.75 - t * 0.6; col[i * 3 + 2] = 0.08;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.heatMats.set(mesh, mesh.material);
      mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    });
  }

  // ---------- decisions ----------
  private decide(id: string, d: 'approve' | 'discard' | null): void {
    if (d) this.decisions[id] = d; else delete this.decisions[id];
    try { localStorage.setItem(STORE, JSON.stringify(this.decisions)); } catch { /* private mode */ }
    const fix = this.doc?.fixes.find((f) => f.id === id);
    if (fix) {
      if (this.showByDefault(fix)) this.enabled.add(id); else this.enabled.delete(id);
      this.applyFixes();
      this.paint();
    }
    this.render();
  }

  private exportDecisions(): void {
    const doc = {
      format: 'mando-skinfix-decisions/1',
      exportedAt: new Date().toISOString(),
      howToApply: 'node tools/skin-decide.mjs <this file> — approve = status applied, discard = status discarded.',
      decisions: this.decisions,
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'skinfix-decisions.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- panel ----------
  render(): void {
    const decided = Object.keys(this.decisions).length;
    if (!this.open) {
      this.host.innerHTML = `
        <button id="skinOpen" class="toggle" aria-pressed="false">Skinning review${decided ? ` · ${decided} decided` : ''}</button>`;
      this.host.querySelector<HTMLButtonElement>('#skinOpen')!.onclick = () => { this.open = true; this.render(); };
      return;
    }
    const fixes = this.doc?.fixes ?? [];
    const pending = fixes.filter((f) => f.status === 'pending' && !this.decisions[f.id]).length;
    const rows = fixes.map((f) => {
      const on = this.enabled.has(f.id);
      const d = this.decisions[f.id];
      const state = d ? (d === 'approve' ? 'approved' : 'discarded') : f.status;
      return `
        <div class="fix ${f.confidence}">
          <div class="fixhead">
            <label class="check"><input type="checkbox" data-show="${f.id}" ${on ? 'checked' : ''}> <b>${f.title}</b></label>
            <span class="badge ${state}">${state}</span>
          </div>
          <div class="fixmeta">
            ${f.stats.vertices} verts · ${bandName(f.stats.heightBand)} · drag up to ${f.stats.maxDragCm} cm
            ${f.stats.donors ? ` · ${f.stats.donors} re-weighted` : ''}
            · <span class="conf">${f.confidence === 'high' ? 'confident' : 'needs a look'}</span>
          </div>
          <div class="fixhelp">${KIND_HELP[f.kind] ?? ''} Drops: ${f.removeBones.join(', ')}.</div>
          <div class="row">
            <button data-hl="${f.id}" aria-pressed="${this.heat === `fix:${f.id}`}">Highlight</button>
            <button data-approve="${f.id}" aria-pressed="${d === 'approve'}">Approve</button>
            <button data-discard="${f.id}" aria-pressed="${d === 'discard'}">Discard</button>
          </div>
        </div>`;
    }).join('');

    this.host.innerHTML = `
      <button id="skinOpen" class="toggle" aria-pressed="true">Skinning review</button>
      <div class="editbox skin">
        <label class="check"><input type="checkbox" id="skinHold" ${this.holding ? 'checked' : ''}> Hold the skin-test pose</label>
        <div class="field">
          <label for="skinHeat">Paint weights</label>
          <select id="skinHeat">${HEATS.map(([v, l]) => `<option value="${v}"${this.heat === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <p class="hint">${!this.modelId ? 'No authored model here — nothing to review.'
          : !this.doc ? (this.model ? 'This model has no skin-weight fixes.' : 'Waiting for the model…')
          : `${fixes.length} fix${fixes.length === 1 ? '' : 'es'} for <code>${this.modelId}.glb</code>${pending ? `, <b>${pending}</b> waiting for a decision` : ''}.
             Tick a fix to see it on the figure; Highlight paints its vertices.`}</p>
        <div class="fixes">${rows}</div>
        <div class="row">
          <button id="skinExport" class="primary"${decided ? '' : ' disabled'}>Export decisions (${decided})</button>
          <button id="skinForget"${decided ? '' : ' disabled'} title="drop every decision made in this browser">Clear</button>
        </div>
        <p class="note">Approve / Discard are remembered in this browser across characters. Export hands back one JSON
          for every model you looked at; <code>node tools/skin-decide.mjs</code> folds it into the fix files.</p>
      </div>`;

    const q = <T extends Element>(sel: string) => this.host.querySelector<T>(sel);
    q<HTMLButtonElement>('#skinOpen')!.onclick = () => { this.open = false; this.render(); };
    q<HTMLInputElement>('#skinHold')!.onchange = (e) => {
      this.holding = (e.target as HTMLInputElement).checked;
      this.onChange();
    };
    q<HTMLSelectElement>('#skinHeat')!.onchange = (e) => {
      this.heat = (e.target as HTMLSelectElement).value as Heat;
      this.paint();
      this.render();
    };
    for (const el of this.host.querySelectorAll<HTMLInputElement>('input[data-show]')) {
      el.onchange = () => {
        if (el.checked) this.enabled.add(el.dataset.show!); else this.enabled.delete(el.dataset.show!);
        this.applyFixes();
        this.paint();
      };
    }
    for (const el of this.host.querySelectorAll<HTMLButtonElement>('button[data-hl]')) {
      el.onclick = () => {
        const id = `fix:${el.dataset.hl!}` as Heat;
        this.heat = this.heat === id ? 'none' : id;
        this.paint();
        this.render();
      };
    }
    for (const el of this.host.querySelectorAll<HTMLButtonElement>('button[data-approve]')) {
      el.onclick = () => this.decide(el.dataset.approve!, this.decisions[el.dataset.approve!] === 'approve' ? null : 'approve');
    }
    for (const el of this.host.querySelectorAll<HTMLButtonElement>('button[data-discard]')) {
      el.onclick = () => this.decide(el.dataset.discard!, this.decisions[el.dataset.discard!] === 'discard' ? null : 'discard');
    }
    q<HTMLButtonElement>('#skinExport')!.onclick = () => this.exportDecisions();
    q<HTMLButtonElement>('#skinForget')!.onclick = () => {
      this.decisions = {};
      try { localStorage.removeItem(STORE); } catch { /* private mode */ }
      this.enabled = new Set(fixes.filter((f) => f.status === 'applied').map((f) => f.id));
      this.applyFixes();
      this.paint();
      this.render();
    };
  }
}
