import { TEXT } from '../text';
import type { BoardId } from './board';
import type { MissionSpec, ZoneSpec, StageSpec } from './mission';

/**
 * The nine authored runs (docs/MISSIONS_OUTDOOR.md §3).
 *
 * **Ceilings are measured, not guessed.** One full jetpack burn from the floor
 * climbs about 28 m at Tatooine gravity, so every lid here sits clear above
 * that — the ceiling's jobs are stopping a border being flown over and cutting
 * the playable sky from the ambient one, and a player who meets it in ordinary
 * free flight would be feeling a rule that is not meant to be felt. The Spice
 * Run runs highest because its 0.45 g takes the same burn much further.
 *
 * Every territory keeps its own enemy tables, sky and mood; what changes here
 * is the shape of the run — where it is open and where it pinches, what holds
 * it in, which beats are indoors, where the rides are parked, and where the
 * run crosses a transport door into a stage with different world rules.
 *
 * Two rules the layouts are written to. **Every territory begins outdoors**,
 * in a space that shows the theme's personality in the first ten seconds —
 * the Refinery, the one interior wave board, starts in its tanker yard and
 * *enters* the plant. And **the shape varies**: open ground, a ravine, a hall
 * behind a door, back out into something bigger, so the tempo resets by
 * geometry rather than only by doors.
 *
 * Labels come from `TEXT.missions.rooms` by position across the whole run —
 * stage after stage — and the count is checked at load.
 */

const ROOMS = TEXT.missions.rooms;

/** a beat's label, taken from the flat per-territory list by its index in the run */
function label(board: BoardId, beat: number): string {
  return ROOMS[board][beat] ?? `beat ${beat + 1}`;
}

/**
 * A little sugar so a layout reads as the run does: `z(board, beat, …)` takes
 * the beat's label by position, which is what keeps nine flat name lists and
 * nine staged layouts from drifting apart.
 */
function z(board: BoardId, beat: number, spec: Omit<ZoneSpec, 'label'>): ZoneSpec {
  return { ...spec, label: label(board, beat) };
}

// ---------------------------------------------------------------- Dune Sea

const desert: StageSpec[] = [
  {
    // The run opens on the Dune Sea itself — its dunes, its mesas, its sky —
    // rather than on a clean copy of them raised over the top. The chain is
    // laid along a clear lane between the board's own landmarks and rimmed
    // with sandstone, and it is shorter than a plate stage would be because
    // the real bowl is only so wide: past d ≈ 150 the ground climbs out.
    kind: 'territory',
    label: TEXT.missions.stages.desert[0],
    anchor: { x: -85, z: -5, dx: 1, dz: 0 },
    zones: [
      z('desert', 0, {
        shell: 'open', kind: 'start', w: 44, l: 56, air: true,
        rides: [
          { kind: 'swoop', u: 16, v: 6, yaw: 0 },
          { kind: 'swoop', u: 16, v: 10, yaw: 0 },
          { kind: 'bantha', u: 12, v: -8, yaw: 1.6 },
        ],
      }),
      z('desert', 1, {
        shell: 'road', kind: 'chase', w: 26, l: 90,
        marks: [0.36, 0.72], barricade: 'crates', air: true,
        rides: [
          { kind: 'landspeeder', u: 8, v: -6, yaw: 0 },
          { kind: 'swoop', u: 8, v: 3, yaw: 0 },
          { kind: 'swoop', u: 12, v: 6, yaw: 0 },
          { kind: 'skiff', u: 14, v: -8, yaw: 0 },
          { kind: 'swoop', u: 40, v: 7, yaw: 0 },
        ],
      }),
    ],
    links: [{ len: 24, kind: 'trek' }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.desert[1],
    zones: [
      z('desert', 2, {
        shell: 'canyon', kind: 'camp', w: 14, l: 70, alcove: true,
        props: [
          { id: 'tusken_tent', u: 44, v: 4, size: 5.2 },
          { id: 'tusken_tent', u: 52, v: -4, size: 5.2 },
        ],
      }),
      z('desert', 3, { shell: 'canyon', kind: 'assault', w: 12, l: 50, waves: 2, deadEnd: true }),
      z('desert', 4, {
        shell: 'hall', kind: 'assault', w: 20, l: 18, waves: 2, feature: 'pit', alcove: true,
      }),
    ],
    links: [{ len: 16, turn: 1, len2: 14, kind: 'trek' }, { len: 14, turn: -1, len2: 12, kind: 'corridor' }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.desert[2],
    zones: [
      z('desert', 5, { shell: 'open', kind: 'lieutenant', w: 56, l: 50, air: true }),
      z('desert', 6, { shell: 'canyon', kind: 'assault', w: 16, l: 60, waves: 3, pass: true }),
      z('desert', 7, {
        shell: 'open', kind: 'camp', w: 44, l: 40, feature: 'crates',
        props: [{ id: 'sail_barge', u: 22, v: 9, size: 26, yaw: 0.5, solid: { r: 4.4, h: 5 } }],
      }),
      z('desert', 8, {
        shell: 'open', kind: 'warlord', w: 80, l: 70, air: true,
        props: [{ id: 'troop_carrier', u: 20, v: 28, size: 14, yaw: 2.2, solid: { r: 3, h: 3 } }],
        rides: [{ kind: 'swoop', u: 10, v: 22, yaw: 0 }, { kind: 'skiff', u: 12, v: -24, yaw: 0 }],
      }),
    ],
    links: [{ len: 18, kind: 'trek' }, { len: 16, kind: 'trek' }, { len: 20, kind: 'trek' }],
  },
];

// ---------------------------------------------------------------- Spice Run

const station: StageSpec[] = [
  {
    kind: 'built',
    label: TEXT.missions.stages.station[0],
    zones: [
      z('station', 0, {
        shell: 'deck', kind: 'start', w: 40, l: 30,
        props: [{ id: 'freighter', u: 8, v: 13, size: 11, yaw: 1.1, solid: { r: 3.4, h: 4 } }],
      }),
      z('station', 1, { shell: 'deck', kind: 'camp', w: 26, l: 40, feature: 'crates' }),
      z('station', 2, {
        shell: 'deck', kind: 'assault', w: 44, l: 36, waves: 2, air: true, feature: 'crates',
        props: [
          { id: 'cargo_crane', u: 10, v: 19, size: 18 },
          { id: 'cargo_crane', u: 28, v: -19, size: 18 },
        ],
      }),
    ],
    links: [{ len: 16, kind: 'trek' }, { len: 16, kind: 'trek' }],
  },
  {
    kind: 'interior',
    label: TEXT.missions.stages.station[1],
    world: { fogColor: 0x14181f, fogNear: 12, fogFar: 90, background: 0x0b0d12, roofed: true, gravity: 0.45, fill: 1.5 },
    zones: [
      z('station', 3, { shell: 'hall', kind: 'assault', w: 20, l: 18, waves: 2, feature: 'barrels', alcove: true }),
      z('station', 4, { shell: 'hall', kind: 'lieutenant', w: 24, l: 20, feature: 'pillars' }),
    ],
    links: [{ len: 14, turn: -1, len2: 12, kind: 'corridor' }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.station[2],
    zones: [
      z('station', 5, { shell: 'deck', kind: 'camp', w: 24, l: 38, alcove: true }),
      z('station', 6, {
        shell: 'deck', kind: 'assault', w: 40, l: 32, waves: 3, air: true,
        props: [{ id: 'reactor_core', u: 16, v: 0, size: 16, solid: { r: 5.5, h: 16 } }],
      }),
      z('station', 7, {
        shell: 'deck', kind: 'warlord', w: 60, l: 50,
        props: [{ id: 'raider_dropship', u: 40, v: 20, size: 14, yaw: 2.4, solid: { r: 3, h: 3 } }],
      }),
    ],
    links: [{ len: 16, kind: 'trek' }, { len: 18, kind: 'trek' }],
  },
];

// ---------------------------------------------------------------- Lava Flats

const nevarro: StageSpec[] = [
  {
    kind: 'built',
    label: TEXT.missions.stages.nevarro[0],
    zones: [
      z('nevarro', 0, {
        shell: 'open', kind: 'start', w: 64, l: 56, feature: 'lava',
        props: [{ id: 'survey_crawler', u: 12, v: -20, size: 10, yaw: 0.9, solid: { r: 2.4, h: 3.4 } }],
        rides: [{ kind: 'speederBike', u: 10, v: 6, yaw: 0 }, { kind: 'speederBike', u: 10, v: 10, yaw: 0 }],
      }),
      z('nevarro', 1, {
        shell: 'road', kind: 'chase', w: 26, l: 140,
        marks: [0.36, 0.7], barricade: 'fence', air: true,
        rides: [
          { kind: 'speederBike', u: 8, v: -5, yaw: 0 },
          { kind: 'speederBike', u: 8, v: 0, yaw: 0 },
          { kind: 'speederBike', u: 8, v: 5, yaw: 0 },
          { kind: 'speederBike', u: 48, v: 6, yaw: 0 },
        ],
      }),
      z('nevarro', 2, {
        shell: 'open', kind: 'assault', w: 44, l: 36, waves: 2, feature: 'crates',
        props: [
          { id: 'adobe_tower', u: 30, v: 12, size: 11, solid: { r: 3.6, h: 11 } },
          { id: 'adobe_tower', u: 30, v: -12, size: 11, solid: { r: 3.6, h: 11 } },
        ],
      }),
    ],
    links: [{ len: 20, kind: 'trek' }, { len: 16, kind: 'trek' }],
  },
  {
    kind: 'interior',
    label: TEXT.missions.stages.nevarro[1],
    world: { fogColor: 0x1a120e, fogNear: 10, fogFar: 80, background: 0x0d0806, roofed: true, fill: 1.4 },
    zones: [
      z('nevarro', 3, { shell: 'hall', kind: 'assault', w: 22, l: 16, waves: 2, feature: 'crates', alcove: true }),
      z('nevarro', 4, { shell: 'hall', kind: 'lieutenant', w: 24, l: 22, feature: 'pillars' }),
    ],
    links: [{ len: 14, turn: 1, len2: 12, kind: 'corridor' }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.nevarro[2],
    zones: [
      z('nevarro', 5, { shell: 'open', kind: 'assault', w: 50, l: 44, waves: 3, feature: 'lava', pass: true, air: true }),
      z('nevarro', 6, { shell: 'canyon', kind: 'camp', w: 16, l: 50, alcove: true }),
      z('nevarro', 7, { shell: 'open', kind: 'warlord', w: 76, l: 66, feature: 'barrels' }),
    ],
    links: [{ len: 16, kind: 'trek' }, { len: 18, kind: 'trek' }],
  },
];

// ---------------------------------------------------------------- Crevasse

const crevasse: StageSpec[] = [
  {
    kind: 'built',
    label: TEXT.missions.stages.crevasse[0],
    world: { traction: 0.55 },
    zones: [
      z('crevasse', 0, {
        shell: 'open', kind: 'start', w: 60, l: 50,
        props: [{ id: 'survey_crawler', u: 16, v: 18, size: 10, yaw: 2.1, solid: { r: 2.4, h: 3.4 } }],
      }),
      z('crevasse', 1, { shell: 'canyon', kind: 'camp', w: 12, l: 80, feature: 'pillars', alcove: true }),
      z('crevasse', 2, { shell: 'canyon', kind: 'assault', w: 10, l: 40, waves: 2, deadEnd: true }),
    ],
    links: [{ len: 20, turn: -1, len2: 16, kind: 'trek' }, { len: 16, turn: 1, len2: 12, kind: 'trek' }],
  },
  {
    kind: 'interior',
    label: TEXT.missions.stages.crevasse[1],
    world: { fogColor: 0x16303e, fogNear: 8, fogFar: 70, background: 0x08161e, roofed: true, traction: 0.55, fill: 1.6 },
    zones: [
      z('crevasse', 3, { shell: 'hall', kind: 'assault', w: 20, l: 18, waves: 2, feature: 'pillars', alcove: true }),
      z('crevasse', 4, { shell: 'hall', kind: 'lieutenant', w: 24, l: 20, feature: 'pillars' }),
      z('crevasse', 5, { shell: 'open', kind: 'assault', w: 50, l: 46, waves: 3, pass: true }),
      z('crevasse', 6, { shell: 'canyon', kind: 'camp', w: 14, l: 50, alcove: true }),
      z('crevasse', 7, { shell: 'open', kind: 'warlord', w: 72, l: 62 }),
    ],
    links: [
      { len: 14, turn: -1, len2: 12, kind: 'corridor' }, { len: 16, kind: 'corridor' },
      { len: 16, kind: 'trek' }, { len: 18, kind: 'trek' },
    ],
  },
];

// ---------------------------------------------------------------- Storm Docks

const trask: StageSpec[] = [
  {
    kind: 'built',
    label: TEXT.missions.stages.trask[0],
    world: { waterDrop: 3 },
    zones: [
      z('trask', 0, {
        shell: 'open', kind: 'start', w: 60, l: 40,
        props: [{ id: 'dock_shed', u: 12, v: 22, size: 10, yaw: 1.6, solid: { r: 3.4, h: 7 } }],
        rides: [{ kind: 'skiff', u: 20, v: -14, yaw: 0 }],
      }),
      z('trask', 1, {
        shell: 'canyon', kind: 'camp', w: 12, l: 70, alcove: true,
        props: [
          { id: 'fish_rack', u: 22, v: 3, size: 2, solid: { r: 0.9, h: 2 } },
          { id: 'fish_rack', u: 40, v: -3, size: 2, solid: { r: 0.9, h: 2 } },
        ],
      }),
      z('trask', 2, { shell: 'canyon', kind: 'assault', w: 12, l: 46, waves: 2, deadEnd: true }),
      z('trask', 3, { shell: 'hall', kind: 'assault', w: 20, l: 18, waves: 2, feature: 'barrels', alcove: true }),
      z('trask', 4, { shell: 'hall', kind: 'lieutenant', w: 24, l: 20, feature: 'pillars' }),
      z('trask', 5, {
        shell: 'open', kind: 'assault', w: 52, l: 44, waves: 3, air: true, feature: 'crates',
        props: [{ id: 'trawler', u: 26, v: 14, size: 16, yaw: 0.2, solid: { r: 3.5, h: 4 } }],
      }),
      z('trask', 6, {
        shell: 'canyon', kind: 'camp', w: 10, l: 50, alcove: true,
        props: [{ id: 'fish_rack', u: 30, v: 3, size: 2, solid: { r: 0.9, h: 2 } }],
      }),
      z('trask', 7, { shell: 'open', kind: 'warlord', w: 70, l: 60, feature: 'pit' }),
    ],
    links: [
      { len: 16, kind: 'trek' }, { len: 14, kind: 'trek' }, { len: 14, kind: 'corridor' },
      { len: 12, turn: 1, len2: 12, kind: 'corridor' }, { len: 14, kind: 'corridor' },
      { len: 16, kind: 'trek' }, { len: 18, kind: 'trek' },
    ],
  },
];

// ---------------------------------------------------------------- Refinery

const refinery: StageSpec[] = [
  {
    kind: 'built',
    label: TEXT.missions.stages.refinery[0],
    zones: [
      z('refinery', 0, {
        shell: 'open', kind: 'start', w: 60, l: 50,
        props: [{ id: 'pipe_rack', u: 30, v: 22, size: 6, solid: { r: 1.2, h: 4 } }],
        rides: [{ kind: 'landspeeder', u: 14, v: -8, yaw: 0 }],
      }),
      z('refinery', 1, {
        shell: 'canyon', kind: 'camp', w: 12, l: 60, feature: 'barrels', alcove: true,
        props: [
          { id: 'pipe_rack', u: 18, v: 5, size: 6, solid: { r: 1.2, h: 4 } },
          { id: 'pipe_rack', u: 42, v: -5, size: 6, solid: { r: 1.2, h: 4 } },
        ],
      }),
      z('refinery', 2, { shell: 'canyon', kind: 'assault', w: 12, l: 40, waves: 2, deadEnd: true }),
    ],
    links: [{ len: 18, kind: 'trek' }, { len: 14, kind: 'trek' }],
  },
  {
    kind: 'interior',
    label: TEXT.missions.stages.refinery[1],
    world: { fogColor: 0x101216, fogNear: 10, fogFar: 70, background: 0x080a0d, roofed: true, fill: 1.4 },
    zones: [
      z('refinery', 3, { shell: 'hall', kind: 'assault', w: 18, l: 16, waves: 2, feature: 'barrels', alcove: true }),
      z('refinery', 4, {
        shell: 'hall', kind: 'lieutenant', w: 22, l: 20, roofH: 14, feature: 'pillars',
        props: [{ id: 'alarm_console', u: 4, v: 8, size: 2.6, solid: { r: 1, h: 2.6 } }],
      }),
      z('refinery', 5, { shell: 'hall', kind: 'assault', w: 20, l: 16, waves: 2, feature: 'crates' }),
    ],
    links: [{ len: 12, turn: 1, len2: 12, kind: 'corridor' }, { len: 14, kind: 'corridor' }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.refinery[2],
    zones: [
      z('refinery', 6, {
        shell: 'open', kind: 'camp', w: 50, l: 44, alcove: true,
        props: [{ id: 'reactor_core', u: 22, v: 0, size: 40, solid: { r: 5.5, h: 40 } }],
      }),
      z('refinery', 7, { shell: 'open', kind: 'warlord', w: 70, l: 60, feature: 'barrels' }),
    ],
    links: [{ len: 18, kind: 'trek' }],
  },
];

// ---------------------------------------------------------------- Great Forge

const forge: StageSpec[] = [
  {
    kind: 'built',
    label: TEXT.missions.stages.forge[0],
    zones: [
      z('forge', 0, {
        shell: 'open', kind: 'start', w: 70, l: 60,
        rides: [
          { kind: 'speederBike', u: 12, v: 4, yaw: 0 },
          { kind: 'speederBike', u: 12, v: 8, yaw: 0 },
          { kind: 'landspeeder', u: 16, v: -8, yaw: 0 },
        ],
      }),
      z('forge', 1, {
        shell: 'road', kind: 'chase', w: 30, l: 180,
        marks: [0.35, 0.68], barricade: 'fence', air: true,
        rides: [{ kind: 'speederBike', u: 60, v: 6, yaw: 0 }, { kind: 'swoop', u: 62, v: -6, yaw: 0 }],
      }),
      z('forge', 2, { shell: 'open', kind: 'assault', w: 44, l: 40, waves: 2, feature: 'pillars' }),
    ],
    links: [{ len: 20, kind: 'trek' }, { len: 16, kind: 'trek' }],
  },
  {
    kind: 'interior',
    label: TEXT.missions.stages.forge[1],
    world: { fogColor: 0x1b1e1a, fogNear: 10, fogFar: 80, background: 0x0c0e0b, roofed: true, fill: 1.4 },
    zones: [
      z('forge', 3, { shell: 'hall', kind: 'assault', w: 20, l: 18, waves: 2, feature: 'pillars', alcove: true }),
      z('forge', 4, { shell: 'hall', kind: 'lieutenant', w: 22, l: 20, feature: 'pillars' }),
    ],
    links: [{ len: 14, turn: -1, len2: 12, kind: 'corridor' }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.forge[2],
    zones: [
      z('forge', 5, {
        shell: 'open', kind: 'assault', w: 54, l: 48, waves: 3, pass: true, air: true, feature: 'pillars',
        props: [{ id: 'forge_brazier', u: 24, v: 0, size: 3.5, solid: { r: 1.6, h: 1.6 } }],
      }),
      z('forge', 6, { shell: 'canyon', kind: 'camp', w: 14, l: 50, alcove: true }),
      z('forge', 7, {
        shell: 'open', kind: 'warlord', w: 80, l: 70,
        props: [{ id: 'mythosaur_skull', u: 14, v: 26, size: 8, yaw: 0.6, solid: { r: 2.6, h: 3 } }],
        rides: [{ kind: 'swoop', u: 10, v: 22, yaw: 0 }, { kind: 'skiff', u: 12, v: -24, yaw: 0 }],
      }),
    ],
    links: [{ len: 16, kind: 'trek' }, { len: 20, kind: 'trek' }],
  },
];

// ---------------------------------------------------------------- Ringworld

const ringworld: StageSpec[] = [
  {
    kind: 'built',
    label: TEXT.missions.stages.ringworld[0],
    zones: [
      z('ringworld', 0, {
        shell: 'open', kind: 'start', w: 56, l: 48,
        props: [{ id: 'tram', u: 12, v: 18, size: 12.2, yaw: 0, solid: { r: 1.9, h: 3.4 } }],
        rides: [{ kind: 'swoop', u: 20, v: -8, yaw: 0 }, { kind: 'swoop', u: 20, v: -12, yaw: 0 }],
      }),
      z('ringworld', 1, {
        shell: 'canyon', kind: 'camp', w: 16, l: 80, feature: 'crates', alcove: true,
        props: [
          { id: 'street_kiosk', u: 20, v: 5, size: 3.2, solid: { r: 1.7, h: 2.4 } },
          { id: 'street_kiosk', u: 42, v: -5, size: 3.2, solid: { r: 1.7, h: 2.4 } },
          { id: 'street_kiosk', u: 62, v: 5, size: 3.2, solid: { r: 1.7, h: 2.4 } },
        ],
      }),
      z('ringworld', 2, { shell: 'canyon', kind: 'assault', w: 12, l: 50, waves: 2, deadEnd: true }),
      z('ringworld', 3, { shell: 'hall', kind: 'assault', w: 22, l: 18, waves: 2, feature: 'crates', alcove: true }),
      z('ringworld', 4, { shell: 'hall', kind: 'lieutenant', w: 22, l: 22, feature: 'pillars' }),
      z('ringworld', 5, {
        shell: 'open', kind: 'assault', w: 50, l: 44, waves: 3, pass: true, air: true,
        props: [
          { id: 'street_kiosk', u: 16, v: 14, size: 3.2, solid: { r: 1.7, h: 2.4 } },
          { id: 'street_kiosk', u: 30, v: -14, size: 3.2, solid: { r: 1.7, h: 2.4 } },
        ],
      }),
      z('ringworld', 6, { shell: 'canyon', kind: 'camp', w: 14, l: 60, alcove: true }),
      z('ringworld', 7, { shell: 'open', kind: 'warlord', w: 64, l: 56 }),
    ],
    links: [
      { len: 16, kind: 'trek' }, { len: 16, kind: 'trek' }, { len: 14, kind: 'corridor' },
      { len: 12, turn: -1, len2: 12, kind: 'corridor' }, { len: 14, kind: 'corridor' },
      { len: 16, kind: 'trek' }, { len: 18, kind: 'trek' },
    ],
  },
];

// ---------------------------------------------------------------- Prison Rig

const narkina: StageSpec[] = [
  {
    kind: 'built',
    label: TEXT.missions.stages.narkina[0],
    world: { waterDrop: 4 },
    zones: [
      z('narkina', 0, {
        shell: 'open', kind: 'start', w: 56, l: 44,
        props: [{ id: 'troop_carrier', u: 14, v: 18, size: 14, yaw: 1.2, solid: { r: 3, h: 3 } }],
      }),
      z('narkina', 1, { shell: 'canyon', kind: 'camp', w: 12, l: 60, feature: 'shock', alcove: true }),
      z('narkina', 2, { shell: 'canyon', kind: 'assault', w: 10, l: 40, waves: 2, deadEnd: true }),
    ],
    links: [{ len: 18, kind: 'trek' }, { len: 14, kind: 'trek' }],
  },
  {
    kind: 'interior',
    label: TEXT.missions.stages.narkina[1],
    world: { fogColor: 0xdde8ee, fogNear: 14, fogFar: 90, background: 0xc8d4dc, roofed: true, fill: 1.7 },
    zones: [
      z('narkina', 3, {
        shell: 'hall', kind: 'assault', w: 20, l: 16, waves: 2, feature: 'shock', alcove: true, roofH: 7,
        props: [{ id: 'alarm_console', u: 3, v: 7, size: 2.6, solid: { r: 1, h: 2.6 } }],
      }),
      z('narkina', 4, { shell: 'hall', kind: 'lieutenant', w: 22, l: 20, roofH: 7, feature: 'pillars' }),
    ],
    links: [{ len: 14, turn: -1, len2: 12, kind: 'corridor' }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.narkina[2],
    world: { waterDrop: 4 },
    zones: [
      z('narkina', 5, {
        shell: 'open', kind: 'assault', w: 50, l: 44, waves: 3, feature: 'shock', air: true,
        props: [{ id: 'sunken_transport', u: 30, v: 18, size: 15, yaw: 0.4, solid: { r: 4, h: 4 } }],
      }),
      z('narkina', 6, { shell: 'canyon', kind: 'camp', w: 12, l: 50, alcove: true }),
      z('narkina', 7, { shell: 'open', kind: 'warlord', w: 66, l: 56, feature: 'pit' }),
    ],
    links: [{ len: 16, kind: 'trek' }, { len: 18, kind: 'trek' }],
  },
];

// ---------------------------------------------------------------- the roster

export const MISSION_LAYOUTS: Record<BoardId, MissionSpec> = {
  desert: {
    palette: { wall: 0xa8824f, floor: 0xbf9a5e, trim: 0x8a6a2a, accent: 0xffb347, rock: 0xa8763f, backdrop: 0xc7a678 },
    ridge: 'rock', ceiling: 38, stages: desert,
  },
  station: {
    palette: { wall: 0x3d4359, floor: 0x4a5168, trim: 0x8a6a2a, accent: 0x63b4ff, rock: 0x4a5262, backdrop: 0x2a3040 },
    ridge: 'hull', ceiling: 60, corrW: 5, stages: station,
  },
  nevarro: {
    palette: { wall: 0x68514a, floor: 0x47322a, trim: 0x6a2a1a, accent: 0xff5a2a, rock: 0x36302c, backdrop: 0x554a44 },
    ridge: 'basalt', ceiling: 38, stages: nevarro,
  },
  crevasse: {
    palette: { wall: 0xa9c4d6, floor: 0x8fb0c4, trim: 0x3a6484, accent: 0x63d0ff, rock: 0x9fc0d4, backdrop: 0xc9dcea },
    ridge: 'ice', ceiling: 38, stages: crevasse,
  },
  trask: {
    palette: { wall: 0x576873, floor: 0x685843, trim: 0x2a4a44, accent: 0x63d0a8, rock: 0x4f5c60, backdrop: 0x3a4650 },
    ridge: 'warehouse', ceiling: 34, stages: trask,
  },
  refinery: {
    palette: { wall: 0x515864, floor: 0x3d434b, trim: 0x6a4a12, accent: 0xffb347, rock: 0x59606a, backdrop: 0x3a4048 },
    ridge: 'tank', ceiling: 36, corrW: 5, stages: refinery,
  },
  forge: {
    palette: { wall: 0x6a7468, floor: 0x4a544c, trim: 0x8a6a2a, accent: 0xffd090, rock: 0x77806f, backdrop: 0x8d9686 },
    ridge: 'ruin', ceiling: 40, stages: forge,
  },
  ringworld: {
    palette: { wall: 0x515f7b, floor: 0x404b64, trim: 0x2a3a5a, accent: 0x9fd0ff, rock: 0x3d4760, backdrop: 0x28304a },
    ridge: 'panel', ceiling: 34, stages: ringworld,
  },
  narkina: {
    palette: { wall: 0xd8e2e8, floor: 0xc8d4dc, trim: 0x4a90a8, accent: 0x63d0ff, rock: 0xcfdae2, backdrop: 0xa8bcc8 },
    ridge: 'panel', ceiling: 34, stages: narkina,
  },
};

/**
 * Every beat needs a name, and the two lists are written in different files:
 * a beat the layout has and the text does not would be announced to the
 * player as "beat 7". Caught here, at load, by walking both.
 */
for (const [board, spec] of Object.entries(MISSION_LAYOUTS)) {
  const beats = spec.stages.reduce((n, s) => n + s.zones.length, 0);
  const names = ROOMS[board as BoardId]?.length ?? 0;
  if (beats !== names) {
    console.warn(`[mission] ${board}: ${beats} beats but ${names} names in TEXT.missions.rooms`);
  }
  for (const stage of spec.stages) {
    if (stage.links.length !== stage.zones.length - 1) {
      console.warn(`[mission] ${board} stage "${stage.label}": ${stage.zones.length} zones want ${stage.zones.length - 1} links, has ${stage.links.length}`);
    }
  }
}
