import * as THREE from 'three';
import { authoredProp } from '../props';
import { BACKDROP_H, RIM_OVER_CEILING, STAIR_STEP } from './common';
import type { StageState } from './builder';

/**
 * Half-width as a fraction of height, at fractions of height, measured from
 * the cliff pillar reference sheets (rock and ice agree to within a few per
 * cent). The foot flare is widest just above the base, which sits 1.5 m in
 * the ground.
 */
const PILLAR_PROFILE: Array<[number, number]> = [
  [0, 0.13], [0.03, 0.145], [0.08, 0.12], [0.15, 0.098], [0.25, 0.084],
  [0.33, 0.075], [0.5, 0.062], [0.75, 0.05], [0.95, 0.025], [1, 0.004],
];
/** stacked collider cylinders: [from, to] as fractions of height, and radius / height */
const PILLAR_COLLIDERS: Array<[number, number, number]> = [
  [0, 0.08, 0.145], [0.08, 0.15, 0.12], [0.15, 0.25, 0.098],
  [0.25, 0.33, 0.084], [0.33, 0.5, 0.075], [0.5, 1, 0.062],
];

/**
 * Borders: the rock a zone, a lane or a canyon is held in by. `ridge` lays a
 * run of it — one collider slab per run and the drawn rock outside it — and
 * `rimPiece` is one column of that rock, queued for the merge in
 * `borders.ts`.
 */
export function stageRidges(b: StageState) {
  const { spec, group, rand, look, onGround, ceiling, ceilingY, groundAt, rimAt, backAt, rimGeo, backGeo, addBox, addCyl } = b;

  /**
   * One piece of a border: a noised, tapering column of rock (or a clean slab
   * of hull, by style). The mesh joins the merge list; the collider is a
   * cylinder, which is what the shape actually is — a box lies about a round
   * thing, and the mesas proved that years ago.
   */
  const rimPiece = (x: number, z: number, r: number, h: number, y0: number, backdrop: boolean): void => {
    if (backdrop) backAt.push({ x, z, r });
    else rimAt.push({ x, z, r, h });
    const geo = new THREE.CylinderGeometry(r * look.taper, r, h, look.facets, 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      // leave the base ring alone so neighbours still meet at the floor
      const grip = (py + h / 2) / h;
      // The wobble is a *fraction* of the piece, and only ever inward.
      //
      // It used to be scaled by `r` as well, which made it a fraction of the
      // square: a five-metre piece could swell to seven and a half, and since
      // `ridge` pushes a piece out by the radius it asked for, every one of
      // that extra reached back through the slab. The audit measured it from
      // inside the fighting pit and the dune gate — rock drawn four metres
      // nearer than the thing that stops you, so you walk into a cliff and
      // stand inside it.
      //
      // Inward, then, and bounded: a piece never grows past the radius it was
      // placed for, so its face never crosses the wall it is facing, and at
      // a tenth of its radius it is never more than about a metre shy of it
      // either. Craggy enough at this scale — a half-metre bite out of a
      // five-metre column, nine facets round and three rings up — and the
      // silhouette's big shape was always the taper and the backdrop row.
      const n = -Math.abs(rand() - 0.5) * look.noise * (0.35 + grip);
      pos.setX(i, pos.getX(i) * (1 + n));
      pos.setZ(i, pos.getZ(i) * (1 + n));
    }
    geo.computeVertexNormals();
    geo.translate(x, y0 + h / 2, z);
    (backdrop ? backGeo : rimGeo).push(geo);
  };

  /**
   * A gap framer: one tall pillar standing on its own, shaped like the
   * delivered reference sheets (`reference/props/cliff_pillar_*_ref.png`) so
   * the stand-in and its colliders already match the sculpt that replaces it.
   * The sheets agree between rock and ice, and between their side and front
   * views, on this profile: a flared foot, then a steady taper to a narrow
   * crown. The sculpt is scaled to `h`, so the same fractions hold for it.
   *
   * The colliders step in with the profile. One cylinder the width of the
   * foot all the way up (as before) stopped a jetpack two metres short of the
   * rock at mid-height once the slender sculpt landed.
   */
  const pillarPiece = (x: number, z: number, h: number, y0: number): void => {
    const pts = PILLAR_PROFILE.map(([f, w]) => new THREE.Vector2(Math.max(w * h, 0.05), f * h));
    const geo = new THREE.LatheGeometry(pts, look.facets);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    // Exactly as many draws as the rim piece this replaced took, so every
    // rock laid after a pillar lands where it always did.
    const draws = new THREE.CylinderGeometry(1, 1, 1, look.facets, 2).attributes.position.count;
    const wobble = Array.from({ length: draws }, () => rand());
    for (let i = 0; i < pos.count; i++) {
      // the same inward-only wobble as a rim piece, sparing the foot ring
      const grip = pos.getY(i) / h;
      const n = -Math.abs(wobble[i % draws] - 0.5) * look.noise * (grip < 0.01 ? 0 : 0.35 + grip);
      pos.setX(i, pos.getX(i) * (1 + n));
      pos.setZ(i, pos.getZ(i) * (1 + n));
    }
    geo.computeVertexNormals();
    geo.translate(x, y0, z);
    rimAt.push({ x, z, r: PILLAR_PROFILE[1][1] * h, h });
    rimGeo.push(geo);
    // a pillar stands on its own, away from any wall run, so it carries its
    // own colliders — round on every side, stepping in as the rock does
    for (const [from, to, w] of PILLAR_COLLIDERS) {
      addCyl(x, y0 + ((from + to) / 2) * h, z, w * h, (to - from) * h);
    }
  };

  /**
   * A border along a polyline, in world coordinates: overlapping pieces tall
   * enough to clear the ceiling, plus a sparser, taller row behind that is
   * mesh only — the mountains beyond, which nothing has to reach.
   *
   * **A border has a side.** `opts.inside` is a point on the playable side of
   * the line, and every rock this lays is placed *away* from it. Without that
   * the geometry and the collision disagreed twice over, and both were felt:
   *
   * - the rocks were centred on the line, so four to six metres of cliff stood
   *   inside a slab that only stops you 1.6 m in — you walked several metres
   *   into solid-looking rock before anything pushed back;
   * - the row of mountains behind was offset along a *fixed* perpendicular,
   *   which is only "behind" for half the rims in a level. The other half —
   *   every zone's right-hand wall, every front face, every lane's far side —
   *   put twenty-metre boulders with no collider at all inside the playable
   *   space. That is the "I walk through the walls" and the "why am I going
   *   around a mountain" of a run in one bug.
   */
  const ridge = (pts: [number, number][], y0: number,
    opts: { pillarAt?: [number, number][]; inside?: { x: number; z: number } } = {}): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.01) continue;
      const nx = (x1 - x0) / len, nz = (z1 - z0) / len;
      // which way is out of the level: the perpendicular that points away
      // from the playable side, where the caller says which side that is
      let ox = -nz, oz = nx;
      if (opts.inside) {
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        if ((opts.inside.x - mx) * ox + (opts.inside.z - mz) * oz > 0) { ox = -ox; oz = -oz; }
      }
      // The wall is **one box per run**, not one collider per rock.
      //
      // A rim is forty-odd pieces and a stage is a dozen rims, and every
      // collider in the world is walked by every capsule step, every ground
      // probe and every spawn validation — five hundred cylinders would be
      // paid for on every frame by every body. What a cliff owes the
      // simulation is "you cannot pass here", and a slab just inside the rock
      // line says that for the whole run at once. The rocks are what you see;
      // this is what you walk into.
      const T = 3.2;
      // The slab starts under the lowest ground the run crosses and reaches
      // past the ceiling, so a dip along a rim is never a gap you can walk
      // through and a rise is never a step you can climb over.
      let base = y0;
      if (onGround) {
        base = Infinity;
        for (let t = 0; t <= len; t += 4) base = Math.min(base, groundAt(x0 + nx * t, z0 + nz * t));
        base -= 3;
      }
      const wallH2 = ceilingY - base + RIM_OVER_CEILING;
      // One slab is the right answer for a run along an axis. A *diagonal* one
      // is not: an axis-aligned box drawn round it fills the whole bounding
      // rectangle, so a wall that leans ten metres across the level walls off
      // ten metres of ground the rock never covers. A leaning run is laid as a
      // short staircase instead — a handful of boxes, still nothing next to a
      // collider per rock, and it follows the line it is drawn along.
      const lean = Math.min(Math.abs(nx), Math.abs(nz)) * len;
      // How fine the staircase is decides how far it bulges into the lane. A
      // step is an axis-aligned box drawn round a slanted segment, so it
      // reaches past the rock line by about half the segment's length — with
      // steps sized to the slab's own thickness that is three metres, and the
      // borders audit measured exactly that standoff on every diagonal wall of
      // the Dune Sea's canyon: stopped three metres in front of the cliff you
      // are looking at. Finer steps, more of them, and the bulge comes down
      // with the segment length.
      const parts = lean <= STAIR_STEP ? 1 : Math.min(40, Math.ceil(lean / STAIR_STEP));
      const segLen = len / parts;
      for (let s = 0; s < parts; s++) {
        const tm = (s + 0.5) * segLen;
        addBox(x0 + nx * tm, base + wallH2 / 2, z0 + nz * tm,
          Math.abs(nx) * segLen + Math.abs(nz) * T, wallH2,
          Math.abs(nz) * segLen + Math.abs(nx) * T);
      }
      const r = 4 + rand() * 2;
      /** corner-to-flat midpoint of the piece's cross-section, as a fraction of r */
      const shape = (1 + Math.cos(Math.PI / look.facets)) / 2;
      // Pieces overlap rather than merely touching: a ray threading the gap
      // between two of them travels metres past the wall line before it meets
      // rock, which reads as the same standoff from inside.
      const step = r * 0.95;
      const n = Math.max(1, Math.round(len / step));
      for (let k = 0; k <= n; k++) {
        const t = (k / n) * len;
        // The rock stands *outside* the slab, not on top of it. A piece is a
        // cylinder of radius r, so a centre on the line puts r metres of it in
        // front of the collider; pushing the centre out by that much lands the
        // face of the cliff on the face of the wall, which is where a player
        // who cannot walk through it expects to be stopped. The jitter only
        // ever goes further out, for the same reason.
        // How far out the piece's centre goes, so its *face* lands on the
        // slab's face. The margin is small on purpose: every centimetre of it
        // is a centimetre you are stopped short of the rock you can see, and
        // the borders audit measured the old numbers — a quarter metre plus up
        // to one and a tenth of jitter, and the noise shrinking a base ring on
        // top of that — as a standoff of about three metres all round every
        // zone on the board. Stopping three metres in front of a cliff face is
        // an invisible wall, however honest the intent behind it.
        // …but `r` is the radius of a *polygon's corners*, and what faces the
        // wall is usually a flat between two of them. A nine-sided rock hardly
        // notices; a four-sided hull plate is a diamond whose face sits at
        // 0.707 of its corner radius, so pushing it out by the corner put its
        // face a metre and a half behind the slab — and the audit measured
        // that as a standoff on every bearing of the Storm Docks, twenty-three
        // of them. Split the difference between corner and flat: whichever of
        // the two faces the wall, it is out by half the gap rather than all of
        // it, and half of it is under a metre on every style in the table.
        const out = r * shape - T / 2 + 0.05 + rand() * 0.35;
        const px = x0 + nx * t + ox * out;
        const pz = z0 + nz * t + oz * out;
        // Every piece is seated *below* the floor it stands on, a couple of
        // metres deep, so a rise between two of them never shows daylight
        // under the rock. On the ground that is the terrain; on a plate it
        // used to be the plate top exactly, which put the cylinder's bottom
        // cap on the floor plane — and a tapering, noised cap meeting a flat
        // floor at exactly one height is a hard seam with the void behind it
        // showing through wherever the two disagree. From inside the ravine
        // that reads as a wall floating over the path rather than the side of
        // a ravine, which is what a playtest called it. The plate hides
        // whatever is under it, so sinking them costs nothing.
        const base = (onGround ? groundAt(px, pz) : y0) - 2.5;
        rimPiece(px, pz, r, ceilingY - base + RIM_OVER_CEILING, base, false);
        // the row behind — further out again, never back across the level
        if (k % 2 === 0) {
          const away = 14 + rand() * 10;
          const bx = px + ox * away, bz = pz + oz * away;
          rimPiece(bx, bz, r * (1.2 + rand() * 0.6),
            ceiling * BACKDROP_H * (0.8 + rand() * 0.5),
            (onGround ? groundAt(bx, bz) : y0) - 6, true);
        }
      }
    }
    // the gap framers: the two pieces either side of a way through, taller
    // than their neighbours, which is what the eye picks out from 80 m
    for (const [px, pz] of opts.pillarAt ?? []) {
      const ph = (ceiling + RIM_OVER_CEILING) * 1.25;
      // seated in the ground under the spire itself, not at the zone's
      // nominal floor: on rolling dunes those are metres apart, and the
      // difference is a spire hanging in the air or buried to its shoulders
      const py = (onGround ? groundAt(px, pz) : y0) - 1.5;
      pillarPiece(px, pz, ph, py);
      authoredProp(group, [], spec.ridge === 'ice' ? 'cliff_pillar_ice' : 'cliff_pillar_rock',
        ph, { x: px, y: py, z: pz, axis: 'y' });
    }
  };

  return { rimPiece, ridge };
}
