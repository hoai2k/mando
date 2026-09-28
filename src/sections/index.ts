import type { SectionId } from '../world/mission';
import type { SectionDef } from './api';
import { chimney } from './chimney';
import { holdTheForge } from './hold-the-forge';
import { covertSky } from './covert-sky';
import { SECTION_BOARD, MISSION_LAYOUTS } from '../world/mission-layouts';
import { glacierChute } from './glacier-chute';
import { lamplight } from './lamplight';
import { theLine } from './the-line';
import { lightsOut } from './lights-out';
import { theLift } from './the-lift';
import { oneWayOut } from './one-way-out';
import { markRuns } from './mark-runs';
import { squall } from './squall';
import { magmaRun } from './magma-run';
import { BUILT_SECTIONS } from './ids';

/**
 * The registry: every built section, by id (docs/SECTIONS_IMPLEMENTATION.md).
 * Add one line here and the id to `BUILT_SECTIONS` in `ids.ts`.
 */
export const SECTIONS: Partial<Record<SectionId, SectionDef>> = {
  chimney,
  'hold-the-forge': holdTheForge,
  'covert-sky': covertSky,
  'glacier-chute': glacierChute,
  lamplight,
  'the-line': theLine,
  'lights-out': lightsOut,
  'the-lift': theLift,
  'one-way-out': oneWayOut,
  'mark-runs': markRuns,
  squall,
  'magma-run': magmaRun,
};

/**
 * For the section suite (tools/test-sections.mjs): what is registered, what
 * the layouts believe is built, and which territory each is placed in.
 */
(globalThis as unknown as { __sections: unknown }).__sections = {
  registered: Object.keys(SECTIONS),
  built: [...BUILT_SECTIONS],
  boards: SECTION_BOARD,
  stageCount: Object.fromEntries(Object.entries(MISSION_LAYOUTS).map(([b, spec]) => [b, spec.stages.length])),
};
