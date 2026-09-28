import type { SectionId } from '../world/mission';
import type { SectionDef } from './api';
import { chimney } from './chimney';
import { squall } from './squall';
import { SECTION_BOARD } from '../world/mission-layouts';
import { BUILT_SECTIONS } from './ids';

/**
 * The registry: every built section, by id (docs/SECTIONS_IMPLEMENTATION.md).
 * Add one line here and the id to `BUILT_SECTIONS` in `ids.ts`.
 */
export const SECTIONS: Partial<Record<SectionId, SectionDef>> = {
  chimney,
  squall,
};

/**
 * For the section suite (tools/test-sections.mjs): what is registered, what
 * the layouts believe is built, and which territory each is placed in.
 */
(globalThis as unknown as { __sections: unknown }).__sections = {
  registered: Object.keys(SECTIONS),
  built: [...BUILT_SECTIONS],
  boards: SECTION_BOARD,
};
