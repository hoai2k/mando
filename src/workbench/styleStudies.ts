import type * as THREE from 'three';
import type { ClipSet } from '../anim/clips';
import type { Proportions } from '../anim/skeleton';
import { aim, aimL, build, hipsAt, legs, LUNGE, mir, SET } from '../anim/clipKit';
import type { Alternate } from './combatStudies';

/**
 * Saber-style studies still on the bench. The approved ones live in
 * `characters/styleClips.ts` and are drawn in play; these are offered here
 * only, dimmed as not in game, until they are approved or dropped.
 */

interface Study { alt: Alternate; pose: string; upper: THREE.AnimationClip; lower: THREE.AnimationClip }

function ventress(p: Proportions): Study[] {
  const out: Study[] = [];
  const guardR = aim([-0.3, -0.5, 0.8]), guardL = aimL([-0.35, -0.2, 0.9]);

  // Scissor: both blades drawn wide behind the shoulders, then brought across
  // together so they cross in front of her — and snapped apart off the cross.
  {
    const at = [0, 0.22, 0.45, 0.6, 1];
    const upper = build('ventressScissorUpper', { dur: 0.62, at, bones: {
      chest: [[2, 0, 0], [-8, 0, 0], [10, 0, 0], [8, 0, 0], [3, 0, 0]],
      upperArmR: [guardR, aim([-1, 0.15, -0.25]), aim([0.35, 0, 1]), aim([-0.5, 0.05, 0.9]), guardR],
      forearmR: [[-40, 0, 0], [-20, 0, 0], [-6, 0, 0], [-10, 0, 0], [-40, 0, 0]],
      handR: [[0, 0, 0], [30, 0, 0], [-20, 0, 0], [-35, 0, 0], [0, 0, 0]],
      upperArmL: [guardL, aimL([-1, 0.15, -0.25]), aimL([0.35, 0, 1]), aimL([-0.5, 0.05, 0.9]), guardL],
      forearmL: [mir([-40, 0, 0]), mir([-20, 0, 0]), mir([-6, 0, 0]), mir([-10, 0, 0]), mir([-40, 0, 0])],
      handL: [mir([0, 0, 0]), mir([30, 0, 0]), mir([-20, 0, 0]), mir([-35, 0, 0]), mir([0, 0, 0])],
      head: [[0, 0, 0], [-4, 0, 0], [6, 0, 0], [4, 0, 0], [0, 0, 0]],
    } });
    const lower = build('ventressScissorLower', { dur: 0.62, at, bones: {
      hips: [[3, 0, 0], [0, 0, 0], [8, 0, 0], [7, 0, 0], [3, 0, 0]],
      ...legs(SET, SET, LUNGE, LUNGE, SET),
    }, hips: hipsAt(p, [0.03, 0], [0.02, -0.02], [0.1, 0.08], [0.1, 0.08], [0.03, 0]) });
    out.push({ pose: 'saber1', upper, lower,
      alt: { id: 'ventressScissor', name: 'Scissor — cross and open', lower: lower.name, upper: upper.name, reference: 'saber' } });
  }

  // Serpent: three quick cuts off alternating hands, each driven by the wrist
  // more than the shoulder, finishing on a straight lunge — Makashi precision
  // in both hands at once.
  {
    const at = [0, 0.2, 0.33, 0.45, 0.58, 0.72, 1];
    const upper = build('ventressSerpentUpper', { dur: 0.8, at, bones: {
      chest: [[4, -22, 0], [6, 20, 0], [5, 4, 0], [6, -24, 0], [5, -8, 0], [6, 10, 0], [4, -8, 0]],
      upperArmR: [aim([-0.7, 0.55, 0.45]), aim([0.3, -0.3, 1]), guardR, guardR, guardR, aim([-0.1, 0.02, 1]), guardR],
      forearmR: [[-55, 0, 0], [-10, 0, 0], [-40, 0, 0], [-40, 0, 0], [-40, 0, 0], [-4, 0, 0], [-40, 0, 0]],
      handR: [[30, 0, 0], [-30, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [-10, 0, 0], [0, 0, 0]],
      upperArmL: [guardL, guardL, aimL([-0.7, 0.55, 0.45]), aimL([0.3, -0.3, 1]), guardL, guardL, guardL],
      forearmL: [mir([-40, 0, 0]), mir([-40, 0, 0]), mir([-55, 0, 0]), mir([-10, 0, 0]), mir([-40, 0, 0]), mir([-40, 0, 0]), mir([-40, 0, 0])],
      handL: [mir([0, 0, 0]), mir([0, 0, 0]), mir([30, 0, 0]), mir([-30, 0, 0]), mir([0, 0, 0]), mir([0, 0, 0]), mir([0, 0, 0])],
      head: [[0, 16, 0], [0, -10, 0], [0, 0, 0], [0, 14, 0], [0, 4, 0], [0, -4, 0], [0, 6, 0]],
    } });
    const lower = build('ventressSerpentLower', { dur: 0.8, at, bones: {
      hips: [[3, -14, 0], [4, 12, 0], [3, 2, 0], [4, -14, 0], [3, -4, 0], [6, 6, 0], [3, -6, 0]],
      ...legs(SET, SET, SET, SET, SET, LUNGE, SET),
    }, hips: hipsAt(p, [0.03, 0], [0.04, 0.01], [0.04, 0.01], [0.05, 0.02], [0.05, 0.02], [0.12, 0.1], [0.03, 0]) });
    out.push({ pose: 'saber2', upper, lower,
      alt: { id: 'ventressSerpent', name: 'Serpent — three cuts and a lunge', lower: lower.name, upper: upper.name, reference: 'saber' } });
  }
  return out;
}

const BUILDERS: Record<string, (p: Proportions) => Study[]> = { ventress };
const offered = new Map<string, Study[]>();

/** The character's bench studies, fresh per figure since the workbench edits clips in place. */
export function styleStudyClips(character: string, p: Proportions): ClipSet {
  const studies = BUILDERS[character]?.(p) ?? [];
  offered.set(character, studies);
  const clips: ClipSet = {};
  for (const s of studies) {
    clips[s.upper.name] = s.upper;
    clips[s.lower.name] = s.lower;
  }
  return clips;
}

/** Bench studies offered on a workbench pose. */
export function styleStudyAlternates(character: string, poseId: string): Alternate[] {
  return (offered.get(character) ?? []).filter((s) => s.pose === poseId).map((s) => s.alt);
}
