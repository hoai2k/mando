import { TEXT } from '../text';
import type { BoardId } from './board';
import type { MissionSpec, ZoneSpec, StageSpec, SectionId } from './mission';
import { BUILT_SECTIONS } from '../sections/ids';

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
    // rather than on a clean copy of them raised over the top.
    //
    // And it opens *inside one canyon*, not inside a row of walled boxes. The
    // sandstone stands seventy-eight metres to either side at the trailhead —
    // far enough to be scenery rather than a corridor, high enough to hold the
    // run in — and closes to thirty by the far end, so the ride down the road
    // is a place shutting around you. It ends against a cliff with a sixteen-
    // metre slot cut into it: the gorge is what the guidance points at from a
    // hundred metres out, what the barricade is set into, and what the run
    // walks into to reach the ravine. Constrained after the open ground, not
    // tight.
    //
    // The lane is laid a little north of the bowl's middle so the slot clears
    // the board's east mesa, and it is shorter than a plate stage would be
    // because the real bowl is only so wide: past d ≈ 150 the ground climbs out.
    kind: 'territory',
    label: TEXT.missions.stages.desert[0],
    anchor: { x: -85, z: 2, dx: 1, dz: 0 },
    canyon: { from: 78, to: 30, gorge: { w: 16, len: 26 } },
    zones: [
      // The trailhead parks nothing. A run that opens with the whole motor
      // pool standing on the spawn hands the ride over before it has asked
      // for anything — you sit on a swoop in the first five seconds and the
      // walk out is skipped entirely. What is out here is the horizon and the
      // camp's tents in it.
      z('desert', 0, { shell: 'open', kind: 'start', w: 44, l: 44, air: true }),
      // The corral: the Tuskens' own camp, and where the rides *are*. It is a
      // held position with a squad posted in it, so mounting up is something
      // you take off them rather than something the level leaves lying about.
      z('desert', 1, {
        shell: 'open', kind: 'camp', w: 44, l: 40, air: true,
        props: [
          { id: 'tusken_tent', u: 26, v: 9, size: 5.2, solid: { r: 1.9, h: 2.6 } },
          { id: 'tusken_tent', u: 32, v: -7, size: 5.2, solid: { r: 1.9, h: 2.6 } },
          { id: 'tusken_tent', u: 21, v: -13, size: 5.2, solid: { r: 1.9, h: 2.6 } },
        ],
        rides: [
          { kind: 'swoop', u: 12, v: 9, yaw: 0 },
          { kind: 'swoop', u: 16, v: 13, yaw: 0 },
          { kind: 'bantha', u: 13, v: -11, yaw: 1.6 },
          // 1.4 m from the tent at (21, -13) is a landspeeder parked on a
          // yurt: the hull settles onto whatever the physics finds under it.
          { kind: 'landspeeder', u: 30, v: -15, yaw: 0 },
          { kind: 'skiff', u: 30, v: 12, yaw: 0 },
        ],
      }),
      // The road parks nothing. It used to keep a skiff at its mouth and a
      // swoop halfway down "for whoever came out of the corral on foot" — which
      // is a ride with no owner standing in the middle of nowhere, the exact
      // thing the corral exists to prevent. Everything with a saddle on this
      // stage is the Tuskens', and it is in their camp.
      z('desert', 2, {
        shell: 'road', kind: 'chase', w: 26, l: 70,
        marks: [0.36, 0.72], barricade: 'crates', air: true,
      }),
    ],
    links: [{ len: 16, kind: 'trek' }, { len: 14, kind: 'trek' }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.desert[1],
    zones: [
      // The ravine is one long held canyon, ending at a door in its far face.
      // It used to be two — a camp and then a "cistern approach" that was the
      // same width, the same rock and the same posted fight, whose only
      // content was the door — so the second is folded into the first. The
      // S through the rock is still there: it is the tunnel behind the door,
      // twisting down to the cistern (a zone cannot bend, so the bends live
      // on the link).
      z('desert', 3, {
        shell: 'canyon', kind: 'camp', w: 14, l: 88, alcove: true, deadEnd: true,
        props: [
          // solid, like the corral's: a 5 m tent you walk through is the
          // "rock walls we walked right through" report, and these two were
          // the only props on the run that had been left decorative.
          { id: 'tusken_tent', u: 36, v: 4, size: 5.2, solid: { r: 1.9, h: 2.6 } },
          { id: 'tusken_tent', u: 44, v: -4, size: 5.2, solid: { r: 1.9, h: 2.6 } },
          { id: 'tusken_tent', u: 66, v: 4.2, size: 5.2, solid: { r: 1.9, h: 2.6 } },
        ],
      }),
      // The cistern court is where the run first meets a war massiff, and a
      // war massiff wants room: the hall is sized for a beast to come out of
      // a hatch and be fought round the pit, not for a squad to hold a door.
      z('desert', 4, {
        shell: 'hall', kind: 'assault', w: 28, l: 24, waves: 2, feature: 'pit', alcove: true,
      }),
    ],
    links: [
      { len: 14, turn: 1, len2: 12, legs: [{ turn: -1, len: 12 }], kind: 'corridor' },
    ],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.desert[2],
    zones: [
      z('desert', 5, { shell: 'open', kind: 'lieutenant', w: 56, l: 50, air: true }),
      // The gate is a garrison fight in a slot, not the run's third long canyon
      // assault: forty metres, and no pass — its notch overlapped the way on
      // and no runner ever came through it.
      z('desert', 6, { shell: 'canyon', kind: 'assault', w: 16, l: 40, garrison: 3 }),
      z('desert', 7, {
        // A twenty-six metre barge nine metres off a lane twenty-two metres
        // wide is a barge lying across the lane: the golden path ran through
        // its hull, so the arrow pointed into it and the way on was a wreck
        // you had to be told to walk around. The graves are wider now and it
        // is beached along the north side, where it is a landmark instead.
        shell: 'open', kind: 'camp', w: 60, l: 40, feature: 'crates',
        props: [{ id: 'sail_barge', u: 24, v: 19, size: 20, yaw: 0.5, solid: { r: 4.4, h: 5 } }],
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
      // The cargo gantries are three plates with void between them, the
      // middle one four metres up: the jetpack's first real verb at 0.45 g.
      // (One flat plate, as it was, asked nothing of the low gravity at all.)
      z('station', 1, {
        shell: 'deck', kind: 'camp', w: 18, l: 72, feature: 'crates',
        plates: { n: 3, gap: 15, rise: [0, 4, 0] },
      }),
      z('station', 2, {
        shell: 'deck', kind: 'assault', w: 44, l: 36, waves: 2, air: true, feature: 'crates',
        props: [
          // solid, like every other prop in this file: `solid` is only the
          // stand-in's shape — the sculpt fits its own colliders the moment it
          // lands, so a gantry keeps the gap between its legs. Left off, these
          // were two eighteen-metre cranes you walked straight through, which
          // is the Spice Run half of the walk-through-walls report.
          { id: 'cargo_crane', u: 10, v: 19, size: 18, solid: { r: 3.2, h: 12 } },
          { id: 'cargo_crane', u: 28, v: -19, size: 18, solid: { r: 3.2, h: 12 } },
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
      z('station', 3, { shell: 'hall', kind: 'assault', w: 28, l: 24, waves: 2, feature: 'barrels', alcove: true }),
      // The gunslinger's duel wants two levels: a fourteen-metre roof and a
      // gallery along one wall, with steps up at its far end.
      z('station', 4, { shell: 'hall', kind: 'lieutenant', w: 30, l: 26, feature: 'pillars', roofH: 14, gallery: 6 }),
    ],
    // a quiet corridor between the two rooms: the breath before the duel
    links: [{ len: 18, turn: -1, len2: 14, kind: 'corridor', quiet: true }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.station[2],
    zones: [
      // the crew catwalks: three plates strung off the hull, the middle one
      // raised, arrived at in front of the hull you left the station by
      z('station', 5, {
        shell: 'deck', kind: 'camp', w: 14, l: 60, alcove: true,
        plates: { n: 3, gap: 12, rise: [0, 4, 0] },
      }),
      z('station', 6, {
        shell: 'deck', kind: 'assault', w: 40, l: 32, waves: 3, air: true,
        props: [{ id: 'reactor_core', u: 16, v: 11, size: 16, solid: { r: 5.5, h: 16 } }],
      }),
      z('station', 7, {
        // containers for the mudhorn's charges to have something to hit
        shell: 'deck', kind: 'warlord', w: 60, l: 50, feature: 'crates',
        props: [
          { id: 'raider_dropship', u: 40, v: 20, size: 14, yaw: 2.4, solid: { r: 3, h: 3 } },
          { id: 'cargo_crate', u: 14, v: -16, size: 2.4, solid: { r: 1.5, h: 2.4 } },
          { id: 'cargo_crate', u: 17, v: -12, size: 2.4, solid: { r: 1.5, h: 2.4 } },
          { id: 'cargo_crate', u: 34, v: -18, size: 2.4, solid: { r: 1.5, h: 2.4 } },
          { id: 'cargo_crate', u: 30, v: 11, size: 2.4, yaw: 0.6, solid: { r: 1.5, h: 2.4 } },
        ],
      }),
    ],
    links: [{ len: 16, kind: 'trek' }, { len: 18, kind: 'trek' }],
  },
];

// ---------------------------------------------------------------- Lava Flats

const nevarro: StageSpec[] = [
  {
    // Nevarro's own basalt, on the band south of both lava rivers — close
    // enough that the flats glow, far enough that the run is never cut in
    // half by one. The board's rivers are the lava here; the zone lays none
    // of its own.
    kind: 'territory',
    label: TEXT.missions.stages.nevarro[0],
    anchor: { x: -72, z: -80, dx: 1, dz: 0 },
    zones: [
      z('nevarro', 0, { shell: 'open', kind: 'start', w: 40, l: 48 }),
      // The bike pool: the remnant's own, with a squad posted round it. Every
      // ride on a run is somebody's — you take it off them, or you walk.
      z('nevarro', 1, {
        shell: 'open', kind: 'camp', w: 44, l: 40, air: true, feature: 'crates',
        rides: [
          { kind: 'speederBike', u: 14, v: 8, yaw: 0 },
          { kind: 'speederBike', u: 18, v: 12, yaw: 0 },
          { kind: 'speederBike', u: 22, v: -10, yaw: 0 },
          // a fourth, so a party of four can all ride the causeway: the
          // riders rule claims up to half the camp's rides for its own crew
          { kind: 'speederBike', u: 26, v: -14, yaw: 0 },
        ],
      }),
      // The crust causeway: a road with live lava down both edges — the one
      // idea that makes it Nevarro's rather than the Great Forge's highway.
      z('nevarro', 2, {
        shell: 'road', kind: 'chase', w: 26, l: 72, feature: 'lava',
        marks: [0.34, 0.7], barricade: 'fence', air: true,
      }),
      // The lieutenant holds the town gate, under the sky. A promoted massiff
      // is a leaper, and it used to be fought in the pillared 30 x 26 box
      // that seven other territories fight theirs in; out here the pounce has
      // room, and the gate is the officer's to hold.
      z('nevarro', 3, { shell: 'open', kind: 'lieutenant', w: 44, l: 40, feature: 'crates' }),
    ],
    links: [{ len: 18, kind: 'trek' }, { len: 14, kind: 'trek' }, { len: 14, kind: 'trek' }],
  },
  {
    kind: 'interior',
    label: TEXT.missions.stages.nevarro[1],
    world: { fogColor: 0x1a120e, fogNear: 10, fogFar: 80, background: 0x0d0806, roofed: true, fill: 1.4 },
    zones: [
      z('nevarro', 4, { shell: 'hall', kind: 'assault', w: 28, l: 24, waves: 2, feature: 'crates', alcove: true }),
      // The court after the yard is a breather, not a second sealed room: the
      // magistrate is gone, a couple of lookouts are left, and its far door is
      // the way down to the lava tunnels.
      z('nevarro', 5, { shell: 'hall', kind: 'trek', w: 30, l: 26, feature: 'pillars', lookouts: 2 }),
    ],
    links: [{ len: 14, turn: 1, len2: 12, kind: 'corridor' }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.nevarro[2],
    zones: [
      // The run's wave battle. Fifty metres of black glass cut by lava, the
      // last big piece of open ground before the warlord's, and the one place
      // a Nevarro run watches ships come in and put squads on the floor.
      z('nevarro', 6, {
        shell: 'open', kind: 'assault', w: 50, l: 44, waves: 3,
        feature: 'lava', pass: true, air: true, siege: true,
      }),
      z('nevarro', 7, { shell: 'canyon', kind: 'camp', w: 16, l: 50, alcove: true }),
      z('nevarro', 8, { shell: 'open', kind: 'warlord', w: 76, l: 66, feature: 'barrels' }),
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
      // One long gallery that ends at the glacier door (the nest mouth). It
      // used to hand over to a second, narrower canyon of forty metres whose
      // only content was that door; its last stretch is now this one's.
      z('crevasse', 1, { shell: 'canyon', kind: 'camp', w: 12, l: 108, feature: 'pillars', alcove: true, deadEnd: true }),
    ],
    links: [{ len: 20, turn: -1, len2: 16, kind: 'trek' }],
  },
  {
    kind: 'interior',
    label: TEXT.missions.stages.crevasse[1],
    world: { fogColor: 0x16303e, fogNear: 8, fogFar: 70, background: 0x08161e, roofed: true, traction: 0.55, fill: 1.6 },
    zones: [
      z('crevasse', 2, { shell: 'hall', kind: 'assault', w: 28, l: 24, waves: 2, feature: 'pillars', alcove: true }),
      z('crevasse', 3, { shell: 'hall', kind: 'lieutenant', w: 30, l: 26, feature: 'pillars' }),
      // The other one: the ice shelf under the open sky, out of the halls and
      // before the last camp. Two in the game, and this is the second.
      // a disc of bare ice at its heart, where the grip goes (and a cavern
      // roof over it, as over all the deep's open ground)
      z('crevasse', 4, { shell: 'open', kind: 'assault', w: 50, l: 46, waves: 3, pass: true, siege: true, slick: 10 }),
      z('crevasse', 5, { shell: 'canyon', kind: 'camp', w: 14, l: 50, alcove: true }),
      z('crevasse', 6, { shell: 'open', kind: 'warlord', w: 72, l: 62 }),
    ],
    links: [
      { len: 18, turn: -1, len2: 14, kind: 'corridor', quiet: true }, { len: 16, kind: 'corridor' },
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
        shell: 'open', kind: 'start', w: 60, l: 40, water: ['right'],
        props: [{ id: 'dock_shed', u: 12, v: 22, size: 10, yaw: 1.6, solid: { r: 3.4, h: 7 } }],
      }),
      // The fish market is a pier: ten metres of planking over the harbour,
      // racks down both sides, the sea either hand, and the freighter's cargo
      // door at the far end (the net lofts that used to stand between them
      // were the fifth dead-end canyon fight). It was built as the standard
      // 44 x 40 box with a skiff that had nowhere to go; a pier is no place to
      // park one, so it went.
      z('trask', 1, {
        shell: 'open', kind: 'camp', w: 10, l: 70, alcove: true, water: ['left', 'right'], deadEnd: true,
        props: [
          { id: 'fish_rack', u: 14, v: 3.2, size: 2, solid: { r: 0.9, h: 2 } },
          { id: 'fish_rack', u: 26, v: -3.2, size: 2, solid: { r: 0.9, h: 2 } },
          { id: 'fish_rack', u: 38, v: 3.2, size: 2, solid: { r: 0.9, h: 2 } },
          { id: 'fish_rack', u: 50, v: -3.2, size: 2, solid: { r: 0.9, h: 2 } },
          { id: 'fish_rack', u: 60, v: 3.2, size: 2, solid: { r: 0.9, h: 2 } },
        ],
      }),
      z('trask', 2, { shell: 'hall', kind: 'assault', w: 28, l: 24, waves: 2, feature: 'barrels', alcove: true }),
      // a breather between the hold's fight and the deck's: the cold stores
      // are walked, past a couple of lookouts, not fought
      z('trask', 3, { shell: 'hall', kind: 'trek', w: 30, l: 26, feature: 'pillars', lookouts: 2 }),
      z('trask', 4, {
        // the officer on the trawler's deck: the Storm Docks' lieutenant,
        // fought under the squall rather than in a second sealed room
        // — the sea both sides, and the wheelhouse door in the far wall
        shell: 'open', kind: 'lieutenant', w: 52, l: 44, air: true, feature: 'crates', water: ['left', 'right'],
        props: [{ id: 'trawler', u: 26, v: 14, size: 16, yaw: 0.2, solid: { r: 3.5, h: 4 } }],
      }),
      z('trask', 5, {
        // the pier heads are a pier, with water both sides
        shell: 'canyon', kind: 'camp', w: 10, l: 50, alcove: true, water: ['left', 'right'],
        props: [{ id: 'fish_rack', u: 30, v: 3, size: 2, solid: { r: 0.9, h: 2 } }],
      }),
      z('trask', 6, { shell: 'open', kind: 'warlord', w: 70, l: 60, feature: 'pit' }),
    ],
    links: [
      { len: 16, kind: 'trek' }, { len: 14, kind: 'corridor' },
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
      }),
      // The pipe run is the lane it was designed as: twelve metres between
      // racks, held by the yard's crew, ending at the intake's blast door. It
      // used to be the standard 44 x 40 box with a landspeeder that had
      // nowhere to go, and then a forty-metre dead-end canyon whose only
      // content was that door; the door is this lane's now, and the ride is
      // gone — a lane is no place to turn one.
      z('refinery', 1, {
        shell: 'canyon', kind: 'camp', w: 12, l: 60, feature: 'barrels', alcove: true, deadEnd: true,
        props: [
          { id: 'pipe_rack', u: 8, v: 4.3, size: 6, solid: { r: 1.2, h: 4 } },
          { id: 'pipe_rack', u: 20, v: -4.3, size: 6, solid: { r: 1.2, h: 4 } },
          { id: 'pipe_rack', u: 32, v: 4.3, size: 6, solid: { r: 1.2, h: 4 } },
          { id: 'pipe_rack', u: 44, v: -4.3, size: 6, solid: { r: 1.2, h: 4 } },
          { id: 'pipe_rack', u: 54, v: 4.3, size: 6, solid: { r: 1.2, h: 4 } },
        ],
      }),
    ],
    links: [{ len: 18, kind: 'trek' }],
  },
  {
    // The Refinery board *is* the plant: a ring of walled work halls under a
    // low ceiling around a forty-metre reactor shaft, already built, already
    // lit, already audited, with its own barrels and alarm consoles and
    // catwalks. Laying a lesser copy of it over the top would be the one
    // place in this design where a stage argued with its own territory. So
    // this stage builds nothing but its rooms — it walks the south side of the
    // ring and turns in to the reactor, and says where the fights are.
    kind: 'plant',
    label: TEXT.missions.stages.refinery[1],
    // The lane starts along z = -46, south of the partition walls: those span
    // z -42..-18, so passing below them is passing through the doorways the
    // board left at their ends rather than through the walls themselves. It
    // starts at x = -35 so the vestibule and the back door behind it still
    // stand inside the plant's west wall (x = -49).
    anchor: { x: -35, z: -46, dx: 1, dz: 0 },
    zones: [
      // Rooms, and declared as rooms. The barrel stores sit *inside* the
      // plant, between its tanks and partition walls, 18 m on a side: the
      // borders audit measures five to eleven metres to the nearest wall all
      // round, which is a hall's number, not open ground's. Calling it `open`
      // was the muddle a playtest asked about — the fight reads as a room
      // whatever the layout says, so the layout should say it, and then the
      // room behaviour that goes with it (the party gathers, the doors seal,
      // the cover is crates rather than boulders) follows.
      z('refinery', 2, { shell: 'hall', kind: 'assault', w: 18, l: 18, waves: 2 }),
      // The reactor floor is the reactor floor: the lieutenant is fought in
      // the board's forty-metre atrium, round the core, with the three catwalk
      // rings as high ground — the one space in the game built for jetpack
      // combat, which the run used to walk straight past to fight in a third
      // 18 m slot of the south strip (audit finding 6). The room is walled
      // and roofed at the atrium's own edges and just under its roof, so it
      // seals like any lieutenant's hall; its far door, in the north wall, is
      // the plant's rear airlock.
      z('refinery', 3, { shell: 'hall', kind: 'lieutenant', w: 40, l: 40, roofH: 38 }),
    ],
    // East out of the stores, north between the partitions at x = -22 and
    // x = -7, east again above the short partition at z = -30, and north into
    // the atrium's south door at x = 0.
    // (quiet: the walk in to the reactor is the breath between two sealed rooms)
    links: [{ len: 2, turn: 1, len2: 15.5, legs: [{ turn: -1, len: 6 }, { turn: 1, len: 1.5 }], kind: 'corridor', quiet: true }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.refinery[2],
    zones: [
      z('refinery', 4, {
        shell: 'open', kind: 'camp', w: 50, l: 44, alcove: true,
        props: [{ id: 'reactor_core', u: 22, v: 15, size: 40, solid: { r: 5.5, h: 40 } }],
      }),
      z('refinery', 5, { shell: 'open', kind: 'warlord', w: 70, l: 60, feature: 'barrels' }),
    ],
    links: [{ len: 18, kind: 'trek' }],
  },
];

// ---------------------------------------------------------------- Great Forge

const forge: StageSpec[] = [
  {
    // Mandalore's actual glassed plain, on the band south of the civic dome
    // and well clear of the Living Waters. Emptiness is this board's whole
    // personality, and fused ground under a ride is the argument for standing
    // the run on it rather than on a plate that only looks like it.
    //
    // And it opens in a glassed valley, the way the Dune Sea opens in its
    // canyon, rather than in the row of rimmed boxes the Lava Flats open in:
    // two walls of fused ruin a long way off, closing as the run goes, and a
    // gorge through the dome's broken footing at the far end with the vault
    // door at the back of it. The two runs were the same beat for beat; this
    // is the opening that tells them apart (audit item 15).
    kind: 'territory',
    label: TEXT.missions.stages.forge[0],
    anchor: { x: -74, z: -62, dx: 1, dz: 0 },
    canyon: { from: 70, to: 28, gorge: { w: 16, len: 22 } },
    zones: [
      z('forge', 0, { shell: 'open', kind: 'start', w: 44, l: 50 }),
      // The corral on the glass: the pirates' rides, and the pirates.
      z('forge', 1, {
        shell: 'open', kind: 'camp', w: 44, l: 40, air: true,
        rides: [
          { kind: 'speederBike', u: 14, v: 8, yaw: 0 },
          { kind: 'speederBike', u: 18, v: 12, yaw: 0 },
          { kind: 'swoop', u: 24, v: 10, yaw: 0 },
          { kind: 'landspeeder', u: 20, v: -12, yaw: 0 },
        ],
      }),
      z('forge', 2, {
        shell: 'road', kind: 'chase', w: 28, l: 78,
        marks: [0.34, 0.7], barricade: 'fence', air: true,
      }),
      z('forge', 3, { shell: 'open', kind: 'assault', w: 38, l: 32, garrison: 2, feature: 'pillars' }),
    ],
    links: [{ len: 18, kind: 'trek' }, { len: 14, kind: 'trek' }, { len: 14, kind: 'trek' }],
  },
  {
    kind: 'interior',
    label: TEXT.missions.stages.forge[1],
    world: { fogColor: 0x1b1e1a, fogNear: 10, fogFar: 80, background: 0x0c0e0b, roofed: true, fill: 1.4 },
    zones: [
      z('forge', 4, { shell: 'hall', kind: 'assault', w: 28, l: 24, waves: 2, feature: 'pillars', alcove: true }),
      z('forge', 5, { shell: 'hall', kind: 'lieutenant', w: 30, l: 26, feature: 'pillars' }),
    ],
    links: [{ len: 18, turn: -1, len2: 14, kind: 'corridor', quiet: true }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.forge[2],
    zones: [
      z('forge', 6, {
        shell: 'open', kind: 'assault', w: 54, l: 48, garrison: 3, air: true, feature: 'pillars',
        // v: 0 is the lane's own centreline, which is where the golden path
        // runs and where the floor arrow points — a brazier there is a thing
        // the guidance sends you into. Off to one side it is a landmark.
        props: [{ id: 'forge_brazier', u: 24, v: 9, size: 3.5, solid: { r: 1.6, h: 1.6 } }],
      }),
      z('forge', 7, { shell: 'canyon', kind: 'camp', w: 14, l: 50, alcove: true }),
      z('forge', 8, {
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
      }),
      // The market arcade is a street: sixteen metres between lit facades,
      // eighty long, kiosks down both sides — the Ringworld's signature shape,
      // where the Storm Docks' is a pier. Two swoops stand at the tram stop's
      // end with their riders at the first kiosks — the tavern steal — and a
      // street is somewhere a swoop has to go. Its far end is the tram
      // platform.
      z('ringworld', 1, {
        shell: 'canyon', kind: 'camp', w: 16, l: 80, feature: 'crates', alcove: true,
        props: [
          { id: 'street_kiosk', u: 14, v: 5.6, size: 3.2, solid: { r: 1.7, h: 2.4 } },
          { id: 'street_kiosk', u: 24, v: -5.6, size: 3.2, solid: { r: 1.7, h: 2.4 } },
          { id: 'street_kiosk', u: 36, v: 5.6, size: 3.2, solid: { r: 1.7, h: 2.4 } },
          { id: 'street_kiosk', u: 46, v: -5.6, size: 3.2, solid: { r: 1.7, h: 2.4 } },
          { id: 'street_kiosk', u: 58, v: 5.6, size: 3.2, solid: { r: 1.7, h: 2.4 } },
          { id: 'street_kiosk', u: 68, v: -5.6, size: 3.2, solid: { r: 1.7, h: 2.4 } },
        ],
        rides: [{ kind: 'swoop', u: 7, v: 2, yaw: 0 }, { kind: 'swoop', u: 7, v: -2, yaw: 0 }],
      }),
      // The night-side row was the run's fifth dead-end canyon assault. It is
      // not folded into the arcade before it, because the Tram Top section is
      // cut in between the two (SECTION_PLACEMENT) and delivers the party
      // here; so it keeps its place and its name and becomes what the run
      // lacked instead — a breather: a dark street with lookouts in it, who
      // raise the terminus rather than hold the row.
      z('ringworld', 2, { shell: 'canyon', kind: 'trek', w: 12, l: 44, lookouts: 2 }),
      z('ringworld', 3, { shell: 'hall', kind: 'assault', w: 28, l: 24, waves: 2, feature: 'crates', alcove: true }),
      // a covered walkway is a lane, not a room: held, but not sealed
      z('ringworld', 4, { shell: 'canyon', kind: 'camp', w: 12, l: 44, alcove: true }),
      z('ringworld', 5, {
        // the enforcer is fought in the plaza, among the kiosks, and the
        // Ringworld has one hall instead of two
        shell: 'open', kind: 'lieutenant', w: 50, l: 44, air: true,
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
      { len: 12, turn: -1, len2: 12, kind: 'corridor' }, { len: 14, kind: 'trek' },
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
        // the rig's landing deck, with the sea on both sides of it
        shell: 'open', kind: 'start', w: 56, l: 44, water: ['left', 'right'],
        props: [{ id: 'troop_carrier', u: 14, v: 18, size: 14, yaw: 1.2, solid: { r: 3, h: 3 } }],
      }),
      z('narkina', 1, { shell: 'canyon', kind: 'camp', w: 12, l: 60, feature: 'shock', alcove: true }),
    ],
    links: [{ len: 18, kind: 'trek' }],
  },
  {
    // The board's best half is under the water — a kelp forest, a reef, a
    // wreck you swim through, a moon pool that surfaces inside the facility —
    // and a level raised into the sky could never reach it. So the run goes
    // down: the gantry ends at a dive hatch, and the next map is the sea
    // itself. No rim (the reef holds it), no hazards laid (the sea is the
    // hazard), and air is the clock: under a minute of it, and more trapped
    // in the sunken transport off the kelp forest's north edge, with a bacta
    // canister — worth the detour, and a detour.
    kind: 'sea',
    label: TEXT.missions.stages.narkina[1],
    anchor: { x: -70, z: 26, dx: 1, dz: 0 },
    ceiling: 14,
    air: { seconds: 55, pockets: [{ x: -52, z: 48, r: 4.5 }] },
    zones: [
      z('narkina', 2, { shell: 'open', kind: 'trek', w: 40, l: 40 }),
      z('narkina', 3, { shell: 'canyon', kind: 'trek', w: 20, l: 26 }),
    ],
    links: [{ len: 18, kind: 'trek' }],
  },
  {
    kind: 'interior',
    label: TEXT.missions.stages.narkina[2],
    world: { fogColor: 0xdde8ee, fogNear: 14, fogFar: 90, background: 0xc8d4dc, roofed: true, fill: 1.7 },
    zones: [
      z('narkina', 4, {
        shell: 'hall', kind: 'assault', w: 28, l: 24, waves: 2, feature: 'shock', alcove: true, roofH: 7,
        props: [{ id: 'alarm_console', u: 3, v: 7, size: 2.6, solid: { r: 1, h: 2.6 } }],
      }),
      z('narkina', 5, { shell: 'hall', kind: 'lieutenant', w: 30, l: 26, roofH: 7, feature: 'pillars' }),
    ],
    links: [{ len: 18, turn: -1, len2: 14, kind: 'corridor', quiet: true }],
  },
  {
    kind: 'built',
    label: TEXT.missions.stages.narkina[3],
    world: { waterDrop: 4 },
    zones: [
      z('narkina', 6, {
        shell: 'open', kind: 'assault', w: 50, l: 44, garrison: 3, feature: 'shock', air: true, water: ['left', 'right'],
        props: [{ id: 'sunken_transport', u: 30, v: 18, size: 15, yaw: 0.4, solid: { r: 4, h: 4 } }],
      }),
      // The discharge gantry that stood here repeated the gantry run minus its
      // shock strips, and existed only to hold Fennec's cache. The cache now
      // comes down in the stage's vestibule (campaign `bossAhead`), so the
      // assembly deck hands straight on to the moon pool.
      z('narkina', 7, { shell: 'open', kind: 'warlord', w: 66, l: 56, feature: 'pit', water: ['left'] }),
    ],
    links: [{ len: 18, kind: 'trek' }],
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
 * Where the gameplay sections go (docs/SECTIONS_IMPLEMENTATION.md §1).
 *
 * Each entry puts section stages in front of the territory's stage `before`
 * (an index into the list as authored above), so the authored runs stay
 * exactly as they are and the sections are inserted between them. A section's
 * two ends are built to match the doors either side of it: the stage before
 * leaves by a transport door, the section begins just inside it, and it ends
 * in whatever the next stage begins with.
 *
 * A section stage has no zones and no links — its module in `src/sections/`
 * builds and runs the whole of it — and its boundaries are one-way.
 */
interface SectionPlace {
  /** insert the sections in front of this authored stage */
  before?: number;
  /**
   * …or cut authored stage `stage` in two after zone `after` (its transport
   * door is laid at that zone's far end) and put the sections in the cut. The
   * second half is labelled `label` on the transition card. A single-stage run
   * — the Storm Docks, the Ringworld — has nowhere else for a section to go.
   * The cut is only made when a section that goes in it is built, so with
   * sections off the run is exactly the authored one.
   */
  split?: { stage: number; after: number; label: string };
  ids: SectionId[];
}

const SECTION_PLACEMENT: Record<BoardId, SectionPlace[]> = {
  // the cistern's far airlock → a skiff landing, the barge → grounded in worm country → the pit
  desert: [{ before: 2, ids: ['barge-run', 'worm-sign'] }],
  // the outer yard's collar door → the frigate's hull → docks at the vault;
  // the loading gantry's airlock → the ring's hull → the crew catwalks
  station: [{ before: 1, ids: ['frigate-guns'] }, { before: 2, ids: ['ring-walk'] }],
  // the magistrate court → the lava tunnels → the magma chamber → up to the glass fields
  nevarro: [{ before: 2, ids: ['magma-run', 'chimney'] }],
  // the frozen gallery's far door (the nest mouth) → the chute → the dark at the bottom → the queen tunnel
  crevasse: [{ before: 1, ids: ['glacier-chute', 'lamplight'] }],
  // one stage, cut after the trawler deck: the trawler casts off into the
  // squall, and the far pier is where the mamacore wakes and chases you in
  // (zone 4 since the net lofts were folded into the fish market)
  trask: [{ split: { stage: 0, after: 4, label: TEXT.missions.stages.trask[1] }, ids: ['squall', 'run-the-pier'] }],
  // the pipe run's intake door → the processing line → the plant; the reactor
  // floor's rear airlock → the tank farm
  refinery: [{ before: 1, ids: ['the-line'] }, { before: 2, ids: ['lights-out'] }],
  // the armoury vault → the covert forge → up its shaft into the sky → the dome's breach
  forge: [{ before: 2, ids: ['hold-the-forge', 'covert-sky'] }],
  // one stage, cut twice: the arcade's far end is a tram platform, and the
  // plaza's way on is the fire stair the mark bolts up
  ringworld: [
    { split: { stage: 0, after: 1, label: TEXT.missions.stages.ringworld[1] }, ids: ['tram-top'] },
    { split: { stage: 0, after: 5, label: TEXT.missions.stages.ringworld[2] }, ids: ['mark-runs'] },
  ],
  // surfacing into the cell blocks → the stair core → the work floor; the lift → the top decks
  narkina: [{ before: 2, ids: ['one-way-out'] }, { before: 3, ids: ['the-lift'] }],
};

/** which territory each section is placed in, for the tests and the `?section=` flag */
export const SECTION_BOARD: Partial<Record<SectionId, BoardId>> = Object.fromEntries(
  (Object.entries(SECTION_PLACEMENT) as [BoardId, { ids: SectionId[] }[]][])
    .flatMap(([board, places]) => places.flatMap((pl) => pl.ids.map((id) => [id, board]))));

/** a section stage: no zones, no links — its module builds and runs it */
function section(id: SectionId): StageSpec {
  return { kind: 'section', section: id, label: TEXT.sections[id].stage, zones: [], links: [] };
}

/**
 * Which section stages a run carries.
 *
 * A section stays out of the run until its module is built and registered
 * (`sections/ids.ts`), so the placement can hold the whole plan while the
 * work is in progress. `?sections=off` leaves every section out — the runs as
 * they were before sections, which the older suites test, and the way back if
 * a section misbehaves in play.
 */
function sectionsOff(): boolean {
  try {
    // the older test suites set this before the page loads (tools/harness.mjs)
    if ((window as unknown as { __sectionsOff?: boolean }).__sectionsOff) return true;
    return new URLSearchParams(window.location.search).get('sections') === 'off';
  } catch { return false; }
}
{
  const off = sectionsOff();
  for (const [board, spec] of Object.entries(MISSION_LAYOUTS) as [BoardId, MissionSpec][]) {
    if (off) continue;
    const places = SECTION_PLACEMENT[board];
    const built = (pl: SectionPlace): SectionId[] => pl.ids.filter((id) => BUILT_SECTIONS.has(id));
    const out: StageSpec[] = [];
    spec.stages.forEach((stage, i) => {
      for (const place of places) {
        if (place.before === i) for (const id of built(place)) out.push(section(id));
      }
      // cut the chain wherever a built section goes into it
      const cuts = places.filter((pl) => pl.split?.stage === i && built(pl).length)
        .sort((a, b) => a.split!.after - b.split!.after);
      let from = 0;
      let label = stage.label;
      for (const cut of cuts) {
        const after = cut.split!.after;
        out.push({ ...stage, label, zones: stage.zones.slice(from, after + 1), links: stage.links.slice(from, after) });
        for (const id of built(cut)) out.push(section(id));
        from = after + 1;
        label = cut.split!.label;
      }
      out.push(from === 0 ? stage : { ...stage, label, zones: stage.zones.slice(from), links: stage.links.slice(from) });
    });
    spec.stages = out;
  }
}

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
    if (stage.kind === 'section') continue;
    for (const zs of stage.zones) {
      // open ground that is not a siege calls no waves (campaign `supplied`)
      const open = zs.shell === 'open' || zs.shell === 'canyon' || zs.shell === 'road';
      if (open && !zs.siege && zs.waves !== undefined) {
        console.warn(`[mission] ${board} "${zs.label}": \`waves\` on open ground that is not a siege calls nothing — use \`garrison\``);
      }
    }
    if (stage.links.length !== stage.zones.length - 1) {
      console.warn(`[mission] ${board} stage "${stage.label}": ${stage.zones.length} zones want ${stage.zones.length - 1} links, has ${stage.links.length}`);
    }
  }
}
