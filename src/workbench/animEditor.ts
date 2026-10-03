import * as THREE from 'three';
import type { ClipSet } from '../anim/clips';
import { BONES } from '../anim/skeleton';
import { MANDO_ROSTER, meleeKinds, PLAYABLE_MANDO_IDS, saberClipsFor, type MandoId } from '../characters/mandalorians';
import { styleMoves } from '../characters/styleClips';
import { AnimEdits, kindOf, SAME_KEY, type AnimSnapshot, type KeyRef } from './animEdits';
import { ATTACK_ALTERNATES } from './combatStudies';
import type { GizmoSpace, PoseEditor } from './poseEdit';
import { POSES } from './poses';
import { findSubject, GROUPS } from './roster';

/**
 * The animation editor — /workbench/?edit=pose
 *
 * The model workbench's turntable with a keyframe editor wired to it: every
 * animation the game plays in a list on the left, each opening on a character
 * that plays it in game (any other can be swapped in); a dope sheet under the
 * viewport with a row per joint and a diamond per key; and an inspector on
 * the right for the joint and keys picked.
 *
 * The workflow it is built for: pick an animation, watch it, pause on the
 * frame that looks wrong, click its key (or scrub to it), turn the joint in
 * the viewport, play it back — joints hidden, to see it clean — move, add or
 * delete keys until it reads right, try it on someone else, and export. The
 * export holds every animation edited this session.
 *
 * Edits are kept as whole tracks (`animEdits.ts`), keyed by clip name, so an
 * edit made on one character plays on every character that runs the clip.
 */

/** what the editor needs from the workbench it sits on (`main.ts`) */
export interface AnimHost {
  panel: HTMLElement;
  list: HTMLElement;
  timeline: HTMLElement;
  editor: PoseEditor;
  edits: AnimEdits;
  subjectId(): string;
  /** the character the subject plays as */
  characterId(): string;
  poseId(): string;
  alternate(): string;
  /** Put a character in an animation. False (and nothing changed) when it cannot play it. */
  show(subjectId: string, poseId: string, alternate: string): boolean;
  clipNames(): { lower: string | null; upper: string | null };
  clips(): ClipSet | null;
  rigBone(name: string): THREE.Object3D | null;
  /** the clip that owns a joint in this animation — where its keys live */
  clipFor(bone: string): string | null;
  duration(): number;
  time(): number;
  paused(): boolean;
  setPaused(paused: boolean): void;
  /** pause, and hold the pose at `t` seconds */
  seek(t: number): void;
  speed(): number;
  setSpeed(speed: number): void;
  /** write the edits into the clips and re-pose */
  refresh(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** close an undo step — for edits made from the keyboard */
  checkpoint(): void;
  loading(): boolean;
}

export interface AnimEntry {
  /** `pose`, or `pose:alternate` */
  id: string;
  pose: string;
  alternate: string;
  name: string;
  group: string;
  /** who it opens on */
  character: string;
}

const FPS = 60;
const DEG = 180 / Math.PI;
const round = (v: number, n: number): number => Math.round(v * 10 ** n) / 10 ** n;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ---------- the animation list ----------
const GROUP_OF: Array<[string, string[]]> = [
  ['Locomotion', ['idle', 'walk', 'run', 'sprint', 'strafe', 'strafeL', 'backpedal', 'crouch', 'crouchWalk', 'slide', 'swim']],
  ['Shooting', ['aim', 'runaim', 'crouchPeek', 'enemyAim']],
  ['Air & jetpack', ['air', 'land', 'landHard', 'tuck', 'tuckSaber', 'fly', 'flyRise', 'flyDrift', 'flyDriftL', 'flyFall', 'flyBrace']],
  ['Staff & spear', ['melee1', 'melee2', 'melee3', 'chargeStaff', 'block', 'airSlash', 'plunge', 'plungeSmash', 'enemySwing']],
  ['Sabers', ['saberIdle', 'saberRun', 'flourish', 'saber1', 'saber2', 'saber3', 'parry', 'throwR', 'throwL', 'catchR', 'catchL', 'chargeSaber', 'chargeSaberRun']],
  ['Unarmed', ['unarmed1', 'unarmed2', 'unarmed3', 'chargeFists']],
  ['Hit & death', ['hit', 'hitL', 'hitR', 'death']],
  ['Riding', ['drive', 'ride']],
];
const SABER_POSES = new Set(['saberIdle', 'saberRun', 'flourish', 'saber1', 'saber2', 'saber3', 'throwR', 'catchR', 'chargeSaber', 'chargeSaberRun', 'tuckSaber']);
const STAFF_POSES = new Set(['melee1', 'melee2', 'melee3']);
const TWIN_BLADES = new Set(['ventress', 'jedi', 'maris']);
/** Din's staff variants the game rolls one hit in four (player.ts DIN_STAFF_VARIANTS) */
const DIN_VARIANTS: Record<string, string> = { melee1: 'spearTest2', melee2: 'staffRise', melee3: 'staffDiagonal' };
/** subjects that are never on our biped rig */
const NOT_BIPED = new Set(['drone']);

/** a saber fighter who plays the shared saber clips, rather than a blade of their own */
const SABER_DEFAULT = PLAYABLE_MANDO_IDS.find((id) => meleeKinds(id).includes('sabers')
  && saberClipsFor(id).attack === 'saber' && saberClipsFor(id).stance === 'saber') ?? 'din';

function defaultCharacter(poseId: string): string {
  if (poseId.startsWith('unarmed') || poseId === 'chargeFists') return 'paz';
  if (poseId === 'parry' || poseId === 'throwL' || poseId === 'catchL') return 'ventress';
  if (poseId === 'enemyAim') return 'stormtrooper';
  if (poseId === 'enemySwing') return 'tusken';
  if (SABER_POSES.has(poseId)) return SABER_DEFAULT;
  return 'din';
}

const slotPose = (slot: string | number): string =>
  slot === 'flourish' ? 'flourish' : slot === 'idle' ? 'saberIdle' : `saber${slot}`;

export function animEntries(): AnimEntry[] {
  const out: AnimEntry[] = [];
  const humanoid = POSES.filter((p) => p.rig === 'humanoid' && p.id !== 'rest');
  const grouped = new Set(GROUP_OF.flatMap(([, ids]) => ids));
  const groups: Array<[string, string[]]> = [...GROUP_OF, ['Other', humanoid.filter((p) => !grouped.has(p.id)).map((p) => p.id)]];
  for (const [group, ids] of groups) {
    for (const id of ids) {
      const p = humanoid.find((x) => x.id === id);
      if (!p) continue;
      out.push({ id, pose: id, alternate: 'none', name: p.name, group, character: defaultCharacter(id) });
      // the other unarmed moves of the step, which the fist fighters throw at random
      if (id.startsWith('unarmed')) {
        for (const alt of ATTACK_ALTERNATES[id] ?? []) {
          out.push({ id: `${id}:${alt.id}`, pose: id, alternate: alt.id, name: `${p.name.split(' — ')[0]} — ${alt.name}`, group, character: 'paz' });
        }
      }
    }
  }
  for (const [poseId, altId] of Object.entries(DIN_VARIANTS)) {
    const alt = ATTACK_ALTERNATES[poseId]?.find((a) => a.id === altId);
    if (alt) out.push({ id: `${poseId}:${altId}`, pose: poseId, alternate: altId, name: `Din — ${alt.name}`, group: 'Signature moves', character: 'din' });
  }
  for (const id of Object.keys(MANDO_ROSTER)) {
    for (const m of styleMoves(id)) {
      out.push({
        id: `${slotPose(m.slot)}:${m.id}`, pose: slotPose(m.slot), alternate: m.id,
        name: `${MANDO_ROSTER[id as MandoId].name} — ${m.name}`, group: 'Signature moves', character: id,
      });
    }
  }
  return out;
}

/** The characters that can be offered for an animation, by the workbench's own rules (`available` in main.ts). */
function canPlay(subjectId: string, entry: AnimEntry): boolean {
  const subject = findSubject(subjectId);
  const id = subject.character ?? subject.id;
  const kinds = id in MANDO_ROSTER ? meleeKinds(id as MandoId) : [];
  if (entry.alternate !== 'none') {
    const own = Object.keys(MANDO_ROSTER).find((m) => styleMoves(m).some((s) => s.id === entry.alternate));
    if (own) return own === id;
    if (DIN_VARIANTS[entry.pose] === entry.alternate) return kinds.includes('gaffi');
  }
  if (STAFF_POSES.has(entry.pose)) return kinds.includes('gaffi');
  if (SABER_POSES.has(entry.pose) && entry.pose !== 'tuckSaber') return kinds.includes('sabers');
  if (entry.pose === 'parry') return id === 'ventress' || id === 'jedi';
  if (entry.pose === 'throwL' || entry.pose === 'catchL') return TWIN_BLADES.has(id);
  if (entry.pose === 'enemySwing') return kinds.length === 0;
  return true;
}

/** characters on the biped rig, by the roster's groups */
const CAST = GROUPS.filter((g) => ['Playable', 'Benched', 'Allies', 'Enemies'].includes(g.label))
  .map((g) => ({ label: g.label, subjects: g.subjects.filter((s) => !NOT_BIPED.has(s.id)) }));

// ---------- the dope sheet ----------
interface Row {
  /** the joint the row turns, or '' for a track with no joint handle */
  bone: string;
  label: string;
  clip: string;
  track: string;
  times: number[];
  /** which channel the clip plays on */
  channel: 'lower' | 'upper';
}

const keyId = (r: KeyRef): string => `${r.clip}|${r.track}|${Math.round(r.t * 1000)}`;
const MIRROR: Record<string, string> = {};
for (const b of BONES) if (/[LR]$/.test(b)) MIRROR[b] = b.slice(0, -1) + (b.endsWith('L') ? 'R' : 'L');

export class AnimEditorUI {
  readonly entries = animEntries();
  private filter = '';
  /** the character picked for each animation, once it is not the default */
  private chosen = new Map<string, string>();
  /** characters found unable to play an animation, by trying */
  private refused = new Set<string>();
  private selected: KeyRef[] = [];
  private showJoints = true;
  private hideWhilePlaying = true;
  private onlyAnimated = true;
  private hidden = new Set<string>(['jetpack', 'capeRoot']);
  private loopClosed = true;
  private clipboard: Array<{ track: string; value: number[] }> | null = null;
  private notice = '';
  /** who each clip was edited on, and who it was played on, for the export */
  private editedOn = new Map<string, Set<string>>();
  private lastSelected: string | null = null;
  private lastPaused: boolean | null = null;
  private lastJointState = '';
  private lastLoading: boolean | null = null;
  private drag: {
    x0: number; width: number; base: AnimSnapshot; refs: KeyRef[]; anchor: KeyRef; moved: boolean;
  } | null = null;
  private scrubbing: { lane: HTMLElement } | null = null;
  /**
   * The last press on a row, for a double-click: the lanes are redrawn by the
   * first press, so the browser's own dblclick never reaches the second.
   */
  private lastPress: { lane: string; x: number; at: number } | null = null;

  constructor(private host: AnimHost) {
    host.editor.setSpace('camera');
    addEventListener('keydown', this.onKey);
    addEventListener('pointermove', this.onPointerMove);
    addEventListener('pointerup', this.onPointerUp);
    host.timeline.addEventListener('pointerdown', this.onTimelineDown);
    host.timeline.addEventListener('click', this.onTimelineClick);
    host.timeline.addEventListener('change', (e) => {
      const speed = e.target as HTMLSelectElement;
      if (speed.id === 'tlSpeed') { this.host.setSpeed(Number(speed.value)); speed.blur(); }
    });
    host.list.addEventListener('click', this.onListClick);
    host.list.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.id !== 'animFilter') return;
      this.filter = input.value.toLowerCase();
      this.renderList(false);
    });
  }

  // ---------- state ----------
  private get entry(): AnimEntry {
    const id = this.host.alternate() === 'none' ? this.host.poseId() : `${this.host.poseId()}:${this.host.alternate()}`;
    return this.entries.find((e) => e.id === id)
      ?? { id, pose: this.host.poseId(), alternate: this.host.alternate(), name: id, group: 'Other', character: this.host.subjectId() };
  }

  /** timeline length: the longer of the two clips */
  private get span(): number { return Math.max(1e-3, this.host.duration()); }

  /** a timeline time in a clip's own clock (a shorter clip loops under a longer one) */
  private local(clip: string, t = this.host.time()): number {
    const dur = this.host.edits.duration(clip);
    return dur > 0 && t >= dur ? t % dur : t;
  }

  private rows(): Row[] {
    const { lower, upper } = this.host.clipNames();
    const edits = this.host.edits;
    const out: Row[] = [];
    const seen = new Set<string>();
    const channel = (clip: string): 'lower' | 'upper' => (clip === lower ? 'lower' : 'upper');
    for (const bone of BONES) {
      if (bone === 'weaponL' || bone === 'weaponR') continue;
      const clip = this.host.clipFor(bone);
      if (!clip) continue;
      const track = `${bone}.quaternion`;
      const keys = edits.keys(clip, track);
      seen.add(`${clip}|${track}`);
      if (!keys?.times.length && this.onlyAnimated) continue;
      out.push({ bone, label: bone, clip, track, times: keys?.times ?? [], channel: channel(clip) });
    }
    // anything else the clips key: the hips' travel, a weapon turned in the hand
    for (const clip of [lower, upper]) {
      if (!clip) continue;
      for (const track of edits.tracksOf(clip)) {
        if (seen.has(`${clip}|${track}`)) continue;
        // a joint keyed by the other clip as well plays from the one that owns it
        const [bone, prop] = track.split('.');
        if (prop === 'quaternion' && (BONES as readonly string[]).includes(bone) && bone !== 'weaponL' && bone !== 'weaponR') continue;
        seen.add(`${clip}|${track}`);
        out.push({
          bone: prop === 'position' ? bone : '', label: prop === 'position' ? `${bone} · move` : `${bone} · turn`,
          clip, track, times: edits.keys(clip, track)?.times ?? [], channel: channel(clip),
        });
      }
    }
    return out;
  }

  private isSelected(r: KeyRef): boolean {
    const id = keyId(r);
    return this.selected.some((s) => keyId(s) === id);
  }

  /** every key time in the animation, on the timeline's clock */
  private allTimes(rows = this.rows()): number[] {
    const times: number[] = [];
    for (const r of rows) for (const t of r.times) if (!times.some((x) => Math.abs(x - t) < SAME_KEY)) times.push(t);
    return times.sort((a, b) => a - b);
  }

  private dropStaleSelection(): void {
    const rows = this.rows();
    this.selected = this.selected.filter((s) => rows.some((r) => r.clip === s.clip && r.track === s.track
      && r.times.some((t) => Math.abs(t - s.t) < SAME_KEY)));
  }

  // ---------- hooks from the workbench ----------
  onSpawn(): void {
    this.host.editor.setEnabled(true);
    this.lastJointState = '';
    this.syncJoints();
    this.render();
  }

  /** a turn finished in the viewport: key it at the playhead */
  commitBone(bone: string): void {
    const clip = this.host.clipFor(bone);
    const joint = this.host.rigBone(bone);
    if (!clip || !joint) return;
    this.setKey(clip, `${bone}.quaternion`, this.local(clip), joint.quaternion.toArray());
    this.host.refresh();
    this.render();
  }

  onEditorChange(): void {
    const sel = this.host.editor.selected;
    if (sel !== this.lastSelected) {
      this.lastSelected = sel;
      this.render();
      return;
    }
    this.syncJointFields();
  }

  /** per frame: the playhead, and the joints shown or hidden as playback starts and stops */
  tick(): void {
    const paused = this.host.paused();
    const loading = this.host.loading();
    if (paused !== this.lastPaused || loading !== this.lastLoading) {
      this.lastPaused = paused;
      this.lastLoading = loading;
      this.syncJoints();
      this.renderPanel();
      this.renderTransport();
    }
    const f = Math.min(1, this.host.time() / this.span);
    const rows = this.host.timeline.querySelector<HTMLElement>('.tl-rows');
    rows?.style.setProperty('--f', String(f));
    const readout = this.host.timeline.querySelector<HTMLElement>('#tlTime');
    if (readout) readout.textContent = this.timeText();
  }

  private syncJoints(): void {
    const paused = this.host.paused();
    const shown = this.showJoints && !(this.hideWhilePlaying && !paused);
    const state = `${shown}|${paused}|${[...this.hidden].join()}`;
    if (state === this.lastJointState) return;
    this.lastJointState = state;
    this.host.editor.setJointDisplay(shown, this.hidden);
    this.host.editor.setInteractive(paused && shown);
  }

  private timeText(): string {
    const t = this.host.time();
    const frame = Math.round(t * FPS);
    return `${t.toFixed(2)} / ${this.host.duration().toFixed(2)} s · frame ${frame}`;
  }

  // ---------- edits ----------
  private setKey(clip: string, track: string, t: number, value: number[]): void {
    this.host.edits.setKey(clip, track, t, value, this.loopClosed);
    this.noteEdit(clip);
  }

  private noteEdit(clip: string): void {
    const who = this.host.characterId();
    if (!this.editedOn.has(clip)) this.editedOn.set(clip, new Set());
    this.editedOn.get(clip)!.add(who);
  }

  /** after a change to the clips: into the figure, the pose held, everything redrawn */
  private changed(): void {
    this.host.refresh();
    this.dropStaleSelection();
    this.render();
  }

  /** key the picked joint (or, with none picked, the whole pose) where the playhead is */
  keyJoint(): void {
    const bone = this.host.editor.selected;
    if (!bone) { this.keyPose(); return; }
    const clip = this.host.clipFor(bone);
    const joint = this.host.rigBone(bone);
    if (!clip || !joint) return;
    this.host.setPaused(true);
    this.setKey(clip, `${bone}.quaternion`, this.local(clip), joint.quaternion.toArray());
    if (bone === 'hips') {
      const row = this.rows().find((r) => r.track === 'hips.position');
      if (row) this.setKey(row.clip, row.track, this.local(row.clip), joint.position.toArray());
    }
    this.changed();
  }

  /** a key on every animated track at the playhead, holding the pose as it plays there */
  keyPose(): void {
    this.host.setPaused(true);
    for (const r of this.rows()) {
      if (!r.times.length) continue;
      const t = this.local(r.clip);
      this.setKey(r.clip, r.track, t, this.host.edits.sample(r.clip, r.track, t));
    }
    this.changed();
  }

  deleteSelected(): void {
    if (!this.selected.length) return;
    for (const s of this.selected) this.noteEdit(s.clip);
    this.host.edits.deleteKeys(this.selected);
    this.selected = [];
    this.changed();
  }

  /** slide the selected keys by whole frames */
  nudge(frames: number): void {
    if (!this.selected.length) return;
    const dt = frames / FPS;
    this.host.edits.moveKeys(this.selected, dt);
    this.selected = this.selected.map((s) => ({ ...s, t: round(Math.min(this.host.edits.duration(s.clip), Math.max(0, s.t + dt)), 3) }));
    for (const s of this.selected) this.noteEdit(s.clip);
    this.host.refresh();
    if (this.selected[0]) this.host.seek(this.selected[0].t);
    this.render();
  }

  /** put the one selected key at an exact time */
  retime(t: number): void {
    if (this.selected.length !== 1 || !Number.isFinite(t)) return;
    const s = this.selected[0];
    const dt = Math.min(this.host.edits.duration(s.clip), Math.max(0, t)) - s.t;
    this.host.edits.moveKeys([s], dt);
    this.selected = [{ ...s, t: round(s.t + dt, 3) }];
    this.noteEdit(s.clip);
    this.host.refresh();
    this.host.seek(this.selected[0].t);
    this.render();
  }

  copyPose(): void {
    this.clipboard = this.rows().filter((r) => r.times.length)
      .map((r) => ({ track: r.track, value: this.host.edits.sample(r.clip, r.track, this.local(r.clip)) }));
    this.notice = `Copied the pose at ${this.host.time().toFixed(2)} s (${this.clipboard.length} tracks).`;
    this.render();
  }

  pastePose(): void {
    if (!this.clipboard) return;
    this.host.setPaused(true);
    const rows = this.rows();
    for (const c of this.clipboard) {
      const row = rows.find((r) => r.track === c.track);
      const clip = row?.clip ?? (c.track.endsWith('.quaternion') ? this.host.clipFor(c.track.split('.')[0]) : null);
      if (clip) this.setKey(clip, c.track, this.local(clip), c.value);
    }
    this.notice = 'Pasted the copied pose at the playhead.';
    this.changed();
  }

  /** the picked joint's turn copied onto its twin on the other side, mirrored */
  mirrorJoint(): void {
    const bone = this.host.editor.selected;
    const other = bone ? MIRROR[bone] : null;
    const joint = bone ? this.host.rigBone(bone) : null;
    const clip = other ? this.host.clipFor(other) : null;
    if (!other || !joint || !clip) return;
    this.host.setPaused(true);
    // the rig's sides mirror across X: keep X, flip Y and Z (clipKit `mir`)
    const e = new THREE.Euler().setFromQuaternion(joint.quaternion, 'XYZ');
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x, -e.y, -e.z, 'XYZ'));
    this.setKey(clip, `${other}.quaternion`, this.local(clip), q.toArray());
    this.notice = `${bone} mirrored onto ${other} at ${this.host.time().toFixed(2)} s.`;
    this.changed();
  }

  revertJoint(): void {
    const bone = this.host.editor.selected;
    const clip = bone ? this.host.clipFor(bone) : null;
    if (!bone || !clip) return;
    this.host.edits.revert(clip, `${bone}.quaternion`);
    if (bone === 'hips') for (const c of Object.values(this.host.clipNames())) if (c) this.host.edits.revert(c, 'hips.position');
    this.changed();
  }

  revertAnimation(): void {
    for (const c of Object.values(this.host.clipNames())) if (c) this.host.edits.revert(c);
    this.selected = [];
    this.changed();
  }

  /** step the playhead by frames, wrapping round the loop */
  step(frames: number): void {
    const dur = this.host.duration();
    if (dur <= 0) return;
    const frame = Math.round(this.host.time() * FPS) + frames;
    const last = Math.max(0, Math.ceil(dur * FPS) - 1);
    this.host.seek(Math.max(0, Math.min(last, ((frame % (last + 1)) + last + 1) % (last + 1))) / FPS);
    this.render();
  }

  /** jump to the previous or next key in the animation (the picked joint's, when one is picked) */
  jumpKey(dir: 1 | -1): void {
    const bone = this.host.editor.selected;
    const rows = this.rows();
    const own = bone ? rows.filter((r) => r.bone === bone && r.times.length) : [];
    const times = this.allTimes(own.length ? own : rows).filter((t) => t < this.host.duration() - 1e-3);
    if (!times.length) return;
    const now = this.host.time();
    const next = dir > 0 ? times.find((t) => t > now + 1e-3) ?? times[0]
      : [...times].reverse().find((t) => t < now - 1e-3) ?? times[times.length - 1];
    this.host.seek(next);
    this.render();
  }

  togglePlay(): void {
    this.host.setPaused(!this.host.paused());
    this.syncJoints();
    this.render();
  }

  /** pick an animation from the list: on the character last chosen for it, or its default */
  open(entry: AnimEntry): void {
    const who = this.chosen.get(entry.id) ?? entry.character;
    this.selected = [];
    this.notice = '';
    if (!this.host.show(who, entry.pose, entry.alternate)) {
      this.refused.add(`${who}|${entry.id}`);
      if (who !== entry.character && this.host.show(entry.character, entry.pose, entry.alternate)) {
        this.chosen.delete(entry.id);
      } else {
        this.notice = `Couldn't open ${entry.name} on ${findSubject(who).name}.`;
      }
    }
    this.render();
  }

  setCharacter(subjectId: string): void {
    const entry = this.entry;
    if (this.host.show(subjectId, entry.pose, entry.alternate)) {
      if (subjectId === entry.character) this.chosen.delete(entry.id); else this.chosen.set(entry.id, subjectId);
      this.notice = '';
    } else {
      this.refused.add(`${subjectId}|${entry.id}`);
      this.notice = `${findSubject(subjectId).name} can't play ${entry.name}.`;
    }
    this.selected = [];
    this.render();
  }

  // ---------- rendering ----------
  render(): void {
    this.syncJoints();
    this.renderList(true);
    this.renderTimeline();
    this.renderPanel();
  }

  private renderList(full: boolean): void {
    const list = this.host.list;
    const current = this.entry.id;
    const edited = (e: AnimEntry): boolean => {
      const pose = POSES.find((p) => p.id === e.pose);
      const alt = e.alternate === 'none' ? null : [...(ATTACK_ALTERNATES[e.pose] ?? [])].find((a) => a.id === e.alternate);
      const style = e.alternate === 'none' ? null : Object.keys(MANDO_ROSTER).flatMap((m) => styleMoves(m)).find((m) => m.id === e.alternate);
      const names = e.id === current ? Object.values(this.host.clipNames())
        : [alt?.lower ?? style?.lower ?? pose?.lower, alt?.upper ?? style?.upper ?? pose?.upper];
      return names.some((n) => n && this.host.edits.isEdited(n));
    };
    const items = this.entries.filter((e) => !this.filter
      || `${e.name} ${e.group} ${e.id}`.toLowerCase().includes(this.filter));
    let html = '';
    let group = '';
    for (const e of items) {
      if (e.group !== group) { group = e.group; html += `<div class="al-group">${esc(group)}</div>`; }
      html += `<button class="al-item${e.id === current ? ' current' : ''}${edited(e) ? ' edited' : ''}" data-entry="${esc(e.id)}"
        title="${esc(e.name)} — opens on ${esc(findSubject(this.chosen.get(e.id) ?? e.character).name)}">${esc(e.name)}</button>`;
    }
    if (!items.length) html = '<p class="hint">No animation matches.</p>';
    if (full || !list.querySelector('.al-items')) {
      list.innerHTML = `<h1>Animations</h1>
        <input id="animFilter" type="search" placeholder="Filter…" value="${esc(this.filter)}" autocomplete="off">
        <div class="al-items">${html}</div>
        <p class="al-key"><span class="dot"></span> edited this session</p>`;
      // keep the open animation in view
      list.querySelector('.al-item.current')?.scrollIntoView({ block: 'nearest' });
    } else {
      list.querySelector('.al-items')!.innerHTML = html;
    }
  }

  private renderTransport(): void {
    const bar = this.host.timeline.querySelector<HTMLElement>('.tl-transport');
    if (!bar) return;
    const play = bar.querySelector<HTMLButtonElement>('[data-act="play"]');
    if (play) {
      play.textContent = this.host.paused() ? '▶' : '❚❚';
      play.title = this.host.paused() ? 'Play (Space)' : 'Pause (Space)';
      play.setAttribute('aria-pressed', String(!this.host.paused()));
    }
  }

  private renderTimeline(): void {
    const tl = this.host.timeline;
    const rows = this.rows();
    const span = this.span;
    const pct = (t: number): string => `${(Math.min(1, t / span) * 100).toFixed(3)}%`;
    const sel = this.host.editor.selected;
    const { lower, upper } = this.host.clipNames();
    const step = [0.05, 0.1, 0.25, 0.5, 1, 2].find((s) => span / s <= 12) ?? 5;
    let ruler = '';
    for (let t = 0; t <= span + 1e-6; t += step) ruler += `<span class="tick" style="left:${pct(t)}">${round(t, 2)}</span>`;
    const keys = (row: Row, i: number): string => row.times.map((t, j) => {
      const ref = { clip: row.clip, track: row.track, t };
      return `<i class="k${this.isSelected(ref) ? ' sel' : ''}" data-key="${i}:${j}" style="left:${pct(t)}" title="${row.label} · ${t.toFixed(3)} s"></i>`;
    }).join('');
    const out = (row: Row): string => {
      const dur = this.host.edits.duration(row.clip);
      return dur > 0 && dur < span - 1e-3 ? `<span class="tl-out" style="left:${pct(dur)}"></span>` : '';
    };
    const summary = this.allTimes(rows).map((t) => {
      const refs = this.refsAt(t, rows);
      const all = refs.length > 0 && refs.every((r) => this.isSelected(r));
      return `<i class="k sum${all ? ' sel' : ''}" data-sum="${t}" style="left:${pct(t)}" title="every key at ${t.toFixed(3)} s"></i>`;
    }).join('');
    const scroll = tl.querySelector('.tl-scroll')?.scrollTop ?? 0;
    tl.innerHTML = `
      <div class="tl-transport">
        <button data-act="start" title="First frame (Home)">⏮</button>
        <button data-act="prevKey" title="Previous key (Shift+←)">◆‹</button>
        <button data-act="prevFrame" title="Previous frame (←)">‹</button>
        <button data-act="play" class="play"></button>
        <button data-act="nextFrame" title="Next frame (→)">›</button>
        <button data-act="nextKey" title="Next key (Shift+→)">›◆</button>
        <button data-act="end" title="Last frame (End)">⏭</button>
        <span id="tlTime" class="tl-time">${this.timeText()}</span>
        <label class="tl-speed">Speed
          <select id="tlSpeed">${[0.1, 0.25, 0.5, 0.75, 1, 1.5, 2].map((v) =>
            `<option value="${v}"${Math.abs(v - this.host.speed()) < 1e-3 ? ' selected' : ''}>${v}×</option>`).join('')}</select></label>
        <span class="tl-clips">${lower ? `<b>legs</b> ${esc(lower)}` : ''}${upper ? ` · <b>body</b> ${esc(upper)}` : ''}</span>
        <button data-history="undo"${this.host.canUndo() ? '' : ' disabled'} title="Undo (Ctrl/Cmd+Z)">↶</button>
        <button data-history="redo"${this.host.canRedo() ? '' : ' disabled'} title="Redo (Ctrl/Cmd+Shift+Z)">↷</button>
        <button data-act="export" class="export"${this.host.edits.editedClips.length ? '' : ' disabled'}
          title="Every clip edited this session, in one JSON">Export${this.host.edits.editedClips.length ? ` (${this.host.edits.editedClips.length})` : ''}</button>
      </div>
      <div class="tl-rows" style="--f:${Math.min(1, this.host.time() / span)}">
        <div class="tl-scroll">
          <div class="tl-row tl-ruler"><div class="tl-label">Time (s)</div><div class="tl-lane" data-lane="ruler">${ruler}</div></div>
          <div class="tl-row tl-summary"><div class="tl-label">All keys</div><div class="tl-lane" data-lane="sum">${summary}</div></div>
          ${rows.map((row, i) => `<div class="tl-row${row.bone && row.bone === sel ? ' picked' : ''}${this.host.edits.isEdited(row.clip, row.track) ? ' edited' : ''}${this.hidden.has(row.bone) ? ' hidden' : ''}">
            <div class="tl-label" data-bone="${row.bone}" title="${row.clip} · ${row.track}">
              ${row.bone && row.track.endsWith('.quaternion') ? `<button class="eye" data-eye="${row.bone}" title="${this.hidden.has(row.bone) ? 'Show' : 'Hide'} this joint">${this.hidden.has(row.bone) ? '○' : '●'}</button>` : '<span class="eye"></span>'}
              <span class="name">${esc(row.label)}</span><span class="ch ${row.channel}">${row.channel === 'lower' ? 'L' : 'U'}</span>
            </div>
            <div class="tl-lane" data-lane="${i}">${out(row)}${keys(row, i)}</div>
          </div>`).join('')}
          ${rows.length ? '' : '<p class="hint tl-empty">No keyed joints — this pose plays no clip.</p>'}
        </div>
      </div>`;
    tl.querySelector('.tl-scroll')!.scrollTop = scroll;
    this.renderTransport();
  }

  /** every key at one time, across the rows */
  private refsAt(t: number, rows = this.rows()): KeyRef[] {
    const out: KeyRef[] = [];
    for (const r of rows) for (const k of r.times) if (Math.abs(k - t) < SAME_KEY) out.push({ clip: r.clip, track: r.track, t: k });
    return out;
  }

  private renderPanel(): void {
    const host = this.host;
    const panel = host.panel;
    // typing into a field: the numbers update in place, the field keeps focus
    if (panel.contains(document.activeElement) && (document.activeElement as HTMLElement).matches('input[type="number"]')) {
      this.syncJointFields();
      return;
    }
    const entry = this.entry;
    const subjectId = host.subjectId();
    const paused = host.paused();
    const bone = host.editor.selected;
    const clip = bone ? host.clipFor(bone) : null;
    const joint = bone ? host.rigBone(bone) : null;
    const track = bone ? `${bone}.quaternion` : '';
    const keyed = !!(clip && host.edits.keyAt(clip, track, this.local(clip)) >= 0);
    const deg = joint ? new THREE.Euler().setFromQuaternion(joint.quaternion, 'XYZ').toArray().slice(0, 3).map((v) => (v as number) * DEG) : null;
    const hipRow = bone === 'hips' ? this.rows().find((r) => r.track === 'hips.position') : null;
    const castOptions = CAST.map((g) => `<optgroup label="${g.label}">${g.subjects.map((s) => {
      const ok = canPlay(s.id, entry) && !this.refused.has(`${s.id}|${entry.id}`);
      return `<option value="${s.id}"${s.id === subjectId ? ' selected' : ''}${ok ? '' : ' disabled'}>${esc(s.name)}${s.id === entry.character ? ' — default' : ''}${ok ? '' : ' (can’t play)'}</option>`;
    }).join('')}</optgroup>`).join('');
    const clips = Object.entries(host.clipNames()).filter(([, n]) => n) as Array<[string, string]>;
    const editedClips = host.edits.editedClips;
    const nSel = this.selected.length;
    const one = nSel === 1 ? this.selected[0] : null;

    panel.innerHTML = `
      <h1>Animation editor</h1>
      <p class="sub">Game clips, keyframe by keyframe. <a href="?edit=models">Model workbench</a></p>

      <div class="field">
        <label>Animation</label>
        <div class="anim-name">${esc(entry.name)}</div>
        <div class="anim-clips">${clips.map(([ch, n]) => `<div><span class="ch ${ch}">${ch === 'lower' ? 'L' : 'U'}</span> ${esc(n)}
          <span class="dur">${host.edits.duration(n).toFixed(2)} s</span>${host.edits.isEdited(n) ? ' <span class="changed-tag">edited</span>' : ''}</div>`).join('')}</div>
      </div>

      <div class="field">
        <label for="animCharacter">Character</label>
        <select id="animCharacter">${castOptions}</select>
        ${subjectId !== entry.character ? `<button id="animDefaultCharacter" class="link">Back to ${esc(findSubject(entry.character).name)} (default)</button>` : ''}
        ${host.loading() ? '<p class="hint">Loading the model…</p>' : ''}
        ${this.notice ? `<p class="hint warn-soft">${esc(this.notice)}</p>` : ''}
      </div>

      <div class="field">
        <label>Joints</label>
        <label class="check"><input type="checkbox" id="showJoints" ${this.showJoints ? 'checked' : ''}> Show joints <span class="kbd">H</span></label>
        <label class="check"><input type="checkbox" id="hidePlaying" ${this.hideWhilePlaying ? 'checked' : ''}> Hide them while playing</label>
        <label class="check"><input type="checkbox" id="onlyAnimated" ${this.onlyAnimated ? 'checked' : ''}> Timeline: keyed joints only</label>
        ${this.hidden.size ? `<div class="row"><button id="showHidden">Show hidden joints (${this.hidden.size})</button></div>` : ''}
      </div>

      <div class="editbox">
        <div class="field">
          <label for="animBone">Joint</label>
          <select id="animBone">
            <option value=""${bone ? '' : ' selected'}>— click a joint or a timeline row —</option>
            ${BONES.filter((b) => b !== 'weaponL' && b !== 'weaponR').map((b) => `<option value="${b}"${b === bone ? ' selected' : ''}>${b}</option>`).join('')}
          </select>
        </div>
        ${bone && deg && clip ? `
          <p class="hint">${!paused ? 'Pause to edit — the clip is playing.'
            : keyed ? `On a key at ${this.local(clip).toFixed(2)} s in <span class="clip">${esc(clip)}</span>: turning the joint changes it.`
              : `No key here for ${bone}: turning it adds one at ${this.local(clip).toFixed(2)} s in <span class="clip">${esc(clip)}</span>.`}</p>
          <div class="field">
            <label>Rotate about</label>
            <div class="seg" id="animSpace">
              ${(['camera', 'local', 'world'] as GizmoSpace[]).map((s) => `<button data-space="${s}" aria-pressed="${host.editor.space === s}">${s[0].toUpperCase()}${s.slice(1)}</button>`).join('')}
            </div>
          </div>
          <div class="field">
            <label>Local rotation — degrees, XYZ</label>
            <div class="xyz">${deg.map((v, i) => `<input type="number" step="1" data-rot="${i}" value="${v.toFixed(1)}"${paused ? '' : ' disabled'}>`).join('')}</div>
          </div>
          ${hipRow && joint ? `<div class="field">
            <label>Hips position — metres, XYZ</label>
            <div class="xyz">${joint.position.toArray().map((v, i) => `<input type="number" step="0.01" data-pos="${i}" value="${v.toFixed(3)}"${paused ? '' : ' disabled'}>`).join('')}</div>
          </div>` : ''}
          <div class="row">
            <button id="keyJoint" title="K">Key ${bone}</button>
            ${MIRROR[bone] ? `<button id="mirrorJoint" title="Copy this turn onto ${MIRROR[bone]}, mirrored">Mirror → ${MIRROR[bone]}</button>` : ''}
          </div>
          <div class="row">
            <button id="hideJoint">${this.hidden.has(bone) ? 'Show' : 'Hide'} joint</button>
            <button id="revertJoint"${host.edits.isEdited(clip, track) ? '' : ' disabled'}>Revert ${bone}</button>
          </div>
          <p class="hint" id="animDrag">${this.dragHint()}</p>`
        : '<p class="hint">Pick a joint to turn it. Pause on the frame to change, then drag a ring; Shift snaps to 5°.</p>'}
      </div>

      <div class="field keys-box">
        <label>Keyframes</label>
        <p class="hint">${nSel ? `${nSel} key${nSel > 1 ? 's' : ''} selected${one ? ` — ${one.track.replace('.quaternion', '')} in ${esc(one.clip)}` : ''}.`
          : 'Click a diamond to select it (Shift adds), drag to move it, double-click a row to add one.'}</p>
        ${one ? `<div class="field inline"><label for="keyTime">Time (s)</label>
          <input id="keyTime" type="number" step="${(1 / FPS).toFixed(4)}" min="0" max="${host.edits.duration(one.clip)}" value="${one.t.toFixed(3)}"></div>` : ''}
        <div class="row">
          <button id="nudgeLeft"${nSel ? '' : ' disabled'} title="Alt+←">◂ 1 frame</button>
          <button id="nudgeRight"${nSel ? '' : ' disabled'} title="Alt+→">1 frame ▸</button>
          <button id="deleteKeys"${nSel ? '' : ' disabled'} title="Delete">Delete</button>
        </div>
        <div class="row">
          <button id="keyPose" title="Shift+K">Key whole pose</button>
          <button id="selectFrame" title="Select every key at the playhead">Select keys here</button>
        </div>
        <div class="row">
          <button id="copyPose" title="Ctrl/Cmd+C">Copy pose</button>
          <button id="pastePose"${this.clipboard ? '' : ' disabled'} title="Ctrl/Cmd+V">Paste pose</button>
        </div>
        <label class="check" title="A key on the first or last frame of a cycle that starts and ends on the same pose is written to both ends"><input type="checkbox" id="loopClosed" ${this.loopClosed ? 'checked' : ''}> Keep loops closed</label>
      </div>

      <div class="editbox session">
        <div class="row history">
          <button data-history="undo"${host.canUndo() ? '' : ' disabled'} title="Ctrl/Cmd+Z">↶ Undo</button>
          <button data-history="redo"${host.canRedo() ? '' : ' disabled'} title="Ctrl/Cmd+Shift+Z">↷ Redo</button>
        </div>
        ${editedClips.length ? `<div class="ledger">${editedClips.map((c) => `<div class="edit"><span>${esc(c)}</span>
          <code>${this.trackCount(c)} track${this.trackCount(c) > 1 ? 's' : ''}</code>
          <button data-revert-clip="${esc(c)}" title="revert ${esc(c)}">×</button></div>`).join('')}</div>` : ''}
        <div class="row">
          <button id="revertAnim"${clips.some(([, n]) => host.edits.isEdited(n)) ? '' : ' disabled'}>Revert this animation</button>
        </div>
        <div class="row">
          <button id="animExport" class="primary"${editedClips.length ? '' : ' disabled'}>Export${editedClips.length ? ` ${editedClips.length} edited clip${editedClips.length > 1 ? 's' : ''}` : ''}</button>
        </div>
        <p class="hint">Edits stay for the session and play on every character that runs the clip. Export sends them all in one JSON.</p>
      </div>

      <details class="fold"><summary>Shortcuts</summary>
        <p class="note shortcuts">
          <b>Space</b> play / pause · <b>← →</b> step a frame · <b>Shift+← →</b> previous / next key ·
          <b>Home End</b> first / last frame · <b>K</b> key the joint (the whole pose with none picked) ·
          <b>Shift+K</b> key the whole pose · <b>Delete</b> delete selected keys · <b>Alt+← →</b> nudge them a frame ·
          <b>H</b> show / hide joints · <b>Esc</b> clear the selection · <b>Ctrl+C / V</b> copy / paste the pose ·
          <b>Ctrl+Z</b> undo · <b>Ctrl+Shift+Z</b> redo.<br><br>
          Drag a diamond to move keys (snaps to 60 fps frames; Alt drags freely). Each row's <b>L</b> or <b>U</b>
          is the clip that keys it: the legs' clip or the body's. Shaded lane ends are past a shorter clip's loop.
        </p>
      </details>`;

    this.bindPanel();
  }

  private trackCount(clip: string): number {
    return this.host.edits.tracksOf(clip).filter((t) => this.host.edits.isEdited(clip, t)).length
      || 1;
  }

  private dragHint(): string {
    const ed = this.host.editor;
    return ed.dragAxis ? `${ed.dragAxis.toUpperCase()} ring · ${ed.dragAngle.toFixed(1)}°` : 'Drag a ring to turn; Shift snaps to 5°.';
  }

  /** the numbers only, while a ring is dragged */
  private syncJointFields(): void {
    const joint = this.host.editor.selected ? this.host.rigBone(this.host.editor.selected) : null;
    const panel = this.host.panel;
    if (joint) {
      const e = new THREE.Euler().setFromQuaternion(joint.quaternion, 'XYZ');
      [e.x, e.y, e.z].forEach((v, i) => {
        const input = panel.querySelector<HTMLInputElement>(`[data-rot="${i}"]`);
        if (input && document.activeElement !== input) input.value = (v * DEG).toFixed(1);
      });
    }
    const drag = panel.querySelector('#animDrag');
    if (drag) drag.textContent = this.dragHint();
  }

  private bindPanel(): void {
    const panel = this.host.panel;
    const $ = <T extends HTMLElement>(sel: string): T | null => panel.querySelector<T>(sel);
    const click = (sel: string, fn: () => void): void => { $(sel)?.addEventListener('click', fn); };
    $<HTMLSelectElement>('#animCharacter')!.onchange = (e) => this.setCharacter((e.target as HTMLSelectElement).value);
    click('#animDefaultCharacter', () => this.setCharacter(this.entry.character));
    $<HTMLInputElement>('#showJoints')!.onchange = (e) => { this.showJoints = (e.target as HTMLInputElement).checked; this.syncJoints(); };
    $<HTMLInputElement>('#hidePlaying')!.onchange = (e) => { this.hideWhilePlaying = (e.target as HTMLInputElement).checked; this.syncJoints(); };
    $<HTMLInputElement>('#onlyAnimated')!.onchange = (e) => { this.onlyAnimated = (e.target as HTMLInputElement).checked; this.renderTimeline(); };
    $<HTMLInputElement>('#loopClosed')!.onchange = (e) => { this.loopClosed = (e.target as HTMLInputElement).checked; };
    click('#showHidden', () => { this.hidden.clear(); this.render(); });
    $<HTMLSelectElement>('#animBone')!.onchange = (e) => this.host.editor.select((e.target as HTMLSelectElement).value || null);
    panel.querySelectorAll<HTMLButtonElement>('#animSpace [data-space]').forEach((b) => {
      b.onclick = () => { this.host.editor.setSpace(b.dataset.space as GizmoSpace); this.renderPanel(); };
    });
    const rot = [...panel.querySelectorAll<HTMLInputElement>('[data-rot]')];
    for (const input of rot) {
      input.onchange = () => {
        if (rot.some((f) => !f.value.trim())) return;
        this.host.setPaused(true);
        this.host.editor.setSelectedEuler(rot.map((f) => Number(f.value)) as [number, number, number]);
      };
    }
    const pos = [...panel.querySelectorAll<HTMLInputElement>('[data-pos]')];
    for (const input of pos) {
      input.onchange = () => {
        const row = this.rows().find((r) => r.track === 'hips.position');
        if (!row || pos.some((f) => !f.value.trim())) return;
        this.host.setPaused(true);
        this.setKey(row.clip, row.track, this.local(row.clip), pos.map((f) => Number(f.value)));
        this.changed();
      };
    }
    click('#keyJoint', () => this.keyJoint());
    click('#mirrorJoint', () => this.mirrorJoint());
    click('#hideJoint', () => {
      const bone = this.host.editor.selected;
      if (!bone) return;
      if (this.hidden.has(bone)) this.hidden.delete(bone); else this.hidden.add(bone);
      this.render();
    });
    click('#revertJoint', () => this.revertJoint());
    const keyTime = $<HTMLInputElement>('#keyTime');
    if (keyTime) keyTime.onchange = () => this.retime(Number(keyTime.value));
    click('#nudgeLeft', () => this.nudge(-1));
    click('#nudgeRight', () => this.nudge(1));
    click('#deleteKeys', () => this.deleteSelected());
    click('#keyPose', () => this.keyPose());
    click('#selectFrame', () => { this.host.setPaused(true); this.selected = this.refsAt(this.host.time()); this.render(); });
    click('#copyPose', () => this.copyPose());
    click('#pastePose', () => this.pastePose());
    click('[data-history="undo"]', () => this.host.undo());
    click('[data-history="redo"]', () => this.host.redo());
    panel.querySelectorAll<HTMLButtonElement>('[data-revert-clip]').forEach((b) => {
      b.onclick = () => { this.host.edits.revert(b.dataset.revertClip!); this.changed(); };
    });
    click('#revertAnim', () => this.revertAnimation());
    click('#animExport', () => this.exportJson());
  }

  // ---------- input ----------
  private onListClick = (e: MouseEvent): void => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-entry]');
    const entry = item && this.entries.find((x) => x.id === item.dataset.entry);
    if (entry) this.open(entry);
  };

  private laneTime(lane: HTMLElement, clientX: number, free = false): number {
    const r = lane.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * this.span;
    return free ? round(t, 3) : Math.round(t * FPS) / FPS;
  }

  private onTimelineClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) {
      if (act === 'play') this.togglePlay();
      else if (act === 'start') { this.host.seek(0); this.render(); }
      else if (act === 'end') this.step(-1 - Math.round(this.host.time() * FPS));
      else if (act === 'prevFrame') this.step(-1);
      else if (act === 'nextFrame') this.step(1);
      else if (act === 'prevKey') this.jumpKey(-1);
      else if (act === 'nextKey') this.jumpKey(1);
      else if (act === 'export') this.exportJson();
      return;
    }
    const history = target.closest<HTMLElement>('[data-history]')?.dataset.history;
    if (history === 'undo') { this.host.undo(); return; }
    if (history === 'redo') { this.host.redo(); return; }
    const eye = target.closest<HTMLElement>('[data-eye]');
    if (eye) {
      const bone = eye.dataset.eye!;
      if (this.hidden.has(bone)) this.hidden.delete(bone); else this.hidden.add(bone);
      this.render();
      return;
    }
    const label = target.closest<HTMLElement>('.tl-label[data-bone]');
    if (label?.dataset.bone) this.host.editor.select(label.dataset.bone);
  };

  private onTimelineDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const lane = target.closest<HTMLElement>('.tl-lane');
    if (!lane) return;
    const key = target.closest<HTMLElement>('.k');
    const rows = this.rows();
    if (key) {
      e.preventDefault();
      let refs: KeyRef[];
      let anchor: KeyRef;
      if (key.dataset.sum !== undefined) {
        const t = Number(key.dataset.sum);
        refs = this.refsAt(t, rows);
        anchor = refs[0];
      } else {
        const [i, j] = key.dataset.key!.split(':').map(Number);
        const row = rows[i];
        anchor = { clip: row.clip, track: row.track, t: row.times[j] };
        refs = [anchor];
        if (row.bone && row.track.endsWith('.quaternion')) this.host.editor.select(row.bone);
      }
      if (!anchor) return;
      if (e.shiftKey) {
        const all = refs.every((r) => this.isSelected(r));
        this.selected = all ? this.selected.filter((s) => !refs.some((r) => keyId(r) === keyId(s)))
          : [...this.selected, ...refs.filter((r) => !this.isSelected(r))];
      } else if (!refs.every((r) => this.isSelected(r))) {
        this.selected = refs;
      }
      this.host.seek(anchor.t);
      this.drag = {
        x0: e.clientX, width: lane.getBoundingClientRect().width, base: this.host.edits.snapshot(),
        refs: [...this.selected], anchor, moved: false,
      };
      this.render();
      return;
    }
    const laneId = lane.dataset.lane ?? '';
    const last = this.lastPress;
    this.lastPress = { lane: laneId, x: e.clientX, at: performance.now() };
    if (last && last.lane === laneId && /^\d+$/.test(laneId) && performance.now() - last.at < 400 && Math.abs(last.x - e.clientX) < 6) {
      this.lastPress = null;
      this.addKeyAt(rows[Number(laneId)], this.laneTime(lane, e.clientX, e.altKey));
      return;
    }
    // a press on a lane (or the ruler) is a scrub; on a row it also clears the pick
    if (lane.dataset.lane !== 'ruler' && lane.dataset.lane !== 'sum' && !e.shiftKey) this.selected = [];
    const row = /^\d+$/.test(lane.dataset.lane ?? '') ? rows[Number(lane.dataset.lane)] : null;
    if (row?.bone && row.track.endsWith('.quaternion')) this.host.editor.select(row.bone);
    this.scrubbing = { lane };
    this.host.seek(this.laneTime(lane, e.clientX, e.altKey));
    this.render();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.scrubbing) {
      const lane = this.host.timeline.querySelector<HTMLElement>('.tl-ruler .tl-lane') ?? this.scrubbing.lane;
      this.host.seek(this.laneTime(lane, e.clientX, e.altKey));
      this.tick();
      return;
    }
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    const raw = (dx / d.width) * this.span;
    const dt = e.altKey ? round(raw, 3) : Math.round(raw * FPS) / FPS;
    this.host.edits.restoreSnapshot(d.base);
    this.host.edits.moveKeys(d.refs, dt);
    const moved = (r: KeyRef): KeyRef => ({ ...r, t: round(Math.min(this.host.edits.duration(r.clip), Math.max(0, r.t + dt)), 3) });
    this.selected = d.refs.map(moved);
    for (const r of d.refs) this.noteEdit(r.clip);
    this.host.refresh();
    this.host.seek(moved(d.anchor).t);
    this.renderTimeline();
  };

  private onPointerUp = (): void => {
    if (this.scrubbing) { this.scrubbing = null; this.renderPanel(); }
    if (this.drag) {
      const moved = this.drag.moved;
      this.drag = null;
      if (moved) { this.dropStaleSelection(); this.render(); }
    }
  };

  /** a key on one row at `t`, holding the value the row plays there */
  private addKeyAt(row: Row | undefined, at: number): void {
    if (!row) return;
    const t = Math.min(this.host.edits.duration(row.clip), at);
    this.setKey(row.clip, row.track, t, this.host.edits.sample(row.clip, row.track, t));
    this.selected = [{ clip: row.clip, track: row.track, t: round(t, 3) }];
    this.host.refresh();
    this.host.seek(t);
    this.render();
  }

  private onKey = (e: KeyboardEvent): void => {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'range') return;
    if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    let handled = true;
    if (mod && k.toLowerCase() === 'c') this.copyPose();
    else if (mod && k.toLowerCase() === 'v') { this.pastePose(); this.host.checkpoint(); }
    else if (mod) handled = false;
    else if (k === ' ') this.togglePlay();
    else if (k === 'ArrowLeft' && e.altKey) { this.nudge(-1); this.host.checkpoint(); }
    else if (k === 'ArrowRight' && e.altKey) { this.nudge(1); this.host.checkpoint(); }
    else if (k === 'ArrowLeft') { if (e.shiftKey) this.jumpKey(-1); else this.step(-1); }
    else if (k === 'ArrowRight') { if (e.shiftKey) this.jumpKey(1); else this.step(1); }
    else if (k === 'Home') { this.host.seek(0); this.render(); }
    else if (k === 'End') this.step(-1 - Math.round(this.host.time() * FPS));
    else if (k === 'Delete' || k === 'Backspace') { this.deleteSelected(); this.host.checkpoint(); }
    else if (k === 'k' || k === 'K') { if (e.shiftKey) this.keyPose(); else this.keyJoint(); this.host.checkpoint(); }
    else if (k === 'h' || k === 'H') { this.showJoints = !this.showJoints; this.render(); }
    else if (k === 'Escape') { this.selected = []; this.host.editor.select(null); this.render(); }
    else handled = false;
    if (!handled) return;
    e.preventDefault();
    // a shortcut is not also a press of the button that had focus (Space clicks it on keyup)
    if (el instanceof HTMLButtonElement) el.blur();
  };

  // ---------- export ----------
  /**
   * Every clip edited this session, in the units of `qt()` in clips.ts: for
   * each touched track, the keys the clip has today and the keys it should
   * have, with what was added, removed and changed spelled out.
   */
  exportJson(): void {
    const edits = this.host.edits;
    const toKeys = (track: string, keys: { times: number[]; values: number[] } | null, dur: number):
      Array<{ t: number; share: number; deg?: number[]; pos?: number[] }> | null => {
      if (!keys) return null;
      const quat = kindOf(track) === 'quaternion';
      const n = quat ? 4 : 3;
      return keys.times.map((t, i) => {
        const v = keys.values.slice(i * n, i * n + n);
        const share = dur > 0 ? round(t / dur, 3) : 0;
        if (!quat) return { t: round(t, 3), share, pos: v.map((x) => round(x, 4)) };
        const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(v[0], v[1], v[2], v[3]), 'XYZ');
        return { t: round(t, 3), share, deg: [e.x, e.y, e.z].map((x) => round(x * DEG, 2)) };
      });
    };
    const same = (a: number[] | undefined, b: number[] | undefined): boolean =>
      !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < 0.05);
    const clips: Record<string, unknown> = {};
    for (const clip of edits.editedClips) {
      const dur = edits.duration(clip);
      const tracks: Record<string, unknown> = {};
      for (const track of new Set([...edits.tracksOf(clip), ...this.removedTracks(clip)])) {
        if (!edits.isEdited(clip, track)) continue;
        const before = toKeys(track, edits.original(clip, track), dur);
        const after = toKeys(track, edits.keys(clip, track), dur);
        const at = (list: typeof before, t: number) => list?.find((k) => Math.abs(k.t - t) < SAME_KEY);
        tracks[track] = {
          bone: track.split('.')[0],
          kind: kindOf(track),
          currentKeys: before,
          newKeys: after,
          added: (after ?? []).filter((k) => !at(before, k.t)).map((k) => k.t),
          removed: (before ?? []).filter((k) => !at(after, k.t)).map((k) => k.t),
          changed: (after ?? []).filter((k) => { const b = at(before, k.t); return b && !same(b.deg ?? b.pos, k.deg ?? k.pos); }).map((k) => k.t),
        };
      }
      clips[clip] = {
        duration: round(dur, 3),
        playedBy: this.entries.filter((e) => this.clipsOf(e).includes(clip)).map((e) => e.name),
        originalKeysFrom: edits.sourceOf(clip),
        editedOn: [...(this.editedOn.get(clip) ?? [])],
        tracks,
      };
    }
    const doc = {
      format: 'mando-anim-edit/1',
      exportedAt: new Date().toISOString(),
      units: 'rotations: local-space Euler XYZ in degrees — the argument order of qt() in src/anim/clips.ts; positions: metres',
      howToApply: [
        'Each clip is an AnimationClip by name (src/anim/clips.ts, clipKit specs, styleClips.ts, combatStudies.ts …); each track is `<bone>.quaternion` or `<bone>.position` on the canonical rig (src/anim/skeleton.ts).',
        '`newKeys` is the finished track: its times (`t` seconds, `share` of the clip) and values replace the clip\'s keys for that bone. `newKeys: null` means the track was removed.',
        '`currentKeys` is the clip as the workbench built it (on `originalKeysFrom`); `currentKeys: null` means it had no track for that bone.',
        '`added`, `removed` and `changed` list key times (seconds) that differ — a moved key shows as one removed and one added.',
        'Keys at time 0 and at the clip\'s end of a looping cycle were kept equal when "Keep loops closed" was on.',
        'Remember the splay sign convention documented at the top of clips.ts.',
      ],
      clips,
    };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'animation-edits.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** tracks the clip had and an edit removed entirely */
  private removedTracks(clip: string): string[] {
    return BONES.flatMap((b) => [`${b}.quaternion`, `${b}.position`])
      .filter((t) => this.host.edits.isEdited(clip, t) && !this.host.edits.keys(clip, t));
  }

  /** the clips an entry plays, by its static names (a fighter's own blade aside) */
  private clipsOf(e: AnimEntry): string[] {
    const pose = POSES.find((p) => p.id === e.pose);
    const alt = e.alternate === 'none' ? null
      : ATTACK_ALTERNATES[e.pose]?.find((a) => a.id === e.alternate)
        ?? Object.keys(MANDO_ROSTER).flatMap((m) => styleMoves(m)).find((m) => m.id === e.alternate);
    const names = [alt?.lower ?? pose?.lower, alt?.upper ?? pose?.upper];
    if (e.id === this.entry.id) names.push(...Object.values(this.host.clipNames()));
    return names.filter((n): n is string => !!n);
  }
}
