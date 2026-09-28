import type { SectionId } from '../world/mission';

/**
 * The sections that are built and registered (`index.ts`).
 *
 * Kept dependency-free on purpose: `world/mission-layouts.ts` reads it at
 * load to leave a planned section's stage out of a run until its module
 * exists, and importing the registry itself from there would pull every
 * section's game code into the layout module's import graph (and a cycle
 * through `game/campaign.ts`). `tools/test-sections.mjs` checks this list
 * against the registry, so the two cannot drift.
 */
export const BUILT_SECTIONS: ReadonlySet<SectionId> = new Set<SectionId>([
  'chimney',
  'hold-the-forge',
  'covert-sky',
  'glacier-chute',
  'lamplight',
  'the-line',
  'lights-out',
  'the-lift',
  'one-way-out',
  'mark-runs',
  'squall',
  'run-the-pier',
  'magma-run',
  'ring-walk',
]);

/**
 * Model ids each section asks `loadProp` for, so a stage's art can be warmed
 * before the party reaches its door (`core/prefetch.ts`). A wrong or missing
 * name costs one wasted fetch, as everywhere else in the prefetcher.
 */
export const SECTION_ASSETS: Partial<Record<SectionId, string[]>> = {
  chimney: ['valve_wheel'],
  'hold-the-forge': ['forge_brazier', 'beskar_barricade'],
  'covert-sky': ['forge_brazier', 'flak_tower'],
  'glacier-chute': ['cliff_pillar_ice'],
  lamplight: ['forge_brazier'],
  'the-line': ['hydraulic_press', 'welding_arm'],
  'lights-out': ['searchlight_tower', 'pipe_rack', 'alarm_console', 'reactor_core', 'fuel_barrel'],
  'the-lift': ['freight_lift'],
  'one-way-out': ['alarm_console'],
  squall: ['cargo_crate', 'fuel_barrel', 'trawler'],
  'run-the-pier': ['mamacore', 'fish_rack'],
  'magma-run': ['speeder_bike', 'skiff', 'quad_turret', 'nikto_swoop'],
};
