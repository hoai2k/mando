/**
 * Hitbox audit: does what a fighter is shot as match what it renders as?
 *
 * Every hostile is hit as a small set of spheres — one on the capsule's
 * midpoint, plus a Def's authored `hitParts` for anything too long to cover
 * with one — while what the player sees is an authored .glb at its own size.
 * Those two numbers are set in different files by different reasoning and
 * nothing has ever held them against each other.
 *
 * This builds one of everything (hostiles and the PvP-playable roster),
 * waits for the authored models to swap in over the procedural stand-ins,
 * samples the geometry that actually renders, and asks two questions of each:
 *
 *   covered  — the fraction of the body a bolt can actually hit. Low means
 *              shots visibly pass through the model.
 *   slack    — how far the spheres reach past the body, in metres. High means
 *              bolts hit a target's empty air.
 *
 *   node tools/audit-hitboxes.mjs            # everything
 *   node tools/audit-hitboxes.mjs massiff    # one kind
 *
 * Exits non-zero if anything is outside tolerance, so it can gate a build.
 */
import { launch } from './harness.mjs';

/**
 * What gates the exit code, and what is only reported.
 *
 * Coverage is *reported*, never gated. One sphere on a biped tops out around
 * 45-50% no matter how well it is placed — arms, legs and helmet leave a ball
 * behind whatever you do — so a low number is a prompt to go and look, not a
 * failure. Comparing a body against its peers is what the column is for.
 *
 * These two are gated, because both are unambiguously wrong however the hit
 * volume is shaped:
 */
/** spheres reaching this far past the head or under the feet hit empty air */
const MAX_SLACK = 0.9;
/** below this, the volume is plainly built for a different body than the model */
const MIN_COVERED = 0.12;

const only = process.argv[2] ?? null;
const h = await launch();

// The bench builds characters outside a match, so nothing has to be played to
// reach a kind that only shows up on wave 9 of one board.
const ids = await h.page.evaluate(() => {
  const kinds = window.__enemyKinds ?? [];
  return { kinds, playables: window.__pvpRoster };
});

const rows = await h.page.evaluate(async ([kinds, playables, minCovered, maxSlack]) => {
  const all = [...kinds.map((k) => ['enemy', k]), ...playables.map((p) => ['playable', p])];
  const bench = all.map(([, id]) => window.__buildBody(id));

  // Authored models land asynchronously over the procedural stand-in, and a
  // body measured before the swap is the wrong body. Wait for the node counts
  // to stop moving — and require several consecutive quiet polls, not one:
  // sixty models stream in bursts, and a single 500 ms lull midway through
  // reads exactly like "finished". That false stable measured a broodmother
  // at 3.0 m in one run and 4.3 m in the next.
  const STABLE = 6;
  let prev = '', quiet = 0;
  for (let t = 0; t < 240; t++) {
    await new Promise((r) => setTimeout(r, 500));
    const sig = bench.map((i) => window.__bodySize(i)?.nodes ?? 0).join(',');
    quiet = sig === prev ? quiet + 1 : 0;
    prev = sig;
    if (quiet >= STABLE) break;
  }

  return all.map(([side, id], n) => {
    const size = window.__bodySize(bench[n]);
    const decl = window.__bodyDecl(id);
    if (!size) return { side, id, error: 'nothing rendered' };

    // The spheres the game actually fires bolts against (src/game/game.ts).
    const hitR = side === 'enemy' ? decl.radius : decl.hitRadius;
    const hitH = side === 'enemy' ? decl.height : decl.hitHeight;
    const spheres = [
      { z: 0, y: hitH * 0.5, r: hitR + 0.35 },
      ...(decl.hitParts ?? []),
    ];

    const pts = size.pts, wts = size.wts;
    let inside = 0, total = 0, topCovered = -Infinity;
    for (let k = 0, n = 0; k < pts.length; k += 3, n++) {
      const x = pts[k], y = pts[k + 1], z = pts[k + 2];
      const w = wts[n];
      total += w;
      let best = Infinity;
      for (const s of spheres) {
        const d = Math.hypot(x, y - s.y, z - s.z) - s.r;
        if (d < best) best = d;
      }
      if (best <= 0) { inside += w; if (y > topCovered) topCovered = y; }
    }

    // Slack is measured vertically only. A round sphere around a body that is
    // thin front-to-back always over-covers in z — that is what a sphere is,
    // not a bug anyone can fix without switching to capsules. Reach above the
    // head or below the feet is the part that plays as wrong: bolts landing
    // on empty air over someone's helmet.
    let slack = 0;
    for (const s of spheres) {
      slack = Math.max(slack,
        s.y + s.r - size.max[1],       // above the head
        size.min[1] - (s.y - s.r));    // below the feet
    }

    return {
      side, id,
      covered: total ? inside / total : 0,
      modelH: size.max[1] - size.min[1],
      modelTop: size.max[1],
      topCovered: topCovered === -Infinity ? 0 : topCovered,
      declH: hitH, declR: hitR,
      parts: (decl.hitParts ?? []).length,
      slack,
      ok: total > 0 && inside / total >= minCovered && slack <= maxSlack,
      volume: JSON.stringify(spheres.map((s) => [+s.z.toFixed(2), +s.y.toFixed(2), +s.r.toFixed(2)])),
    };
  });
}, [ids.kinds, ids.playables, MIN_COVERED, MAX_SLACK]);

const shown = only ? rows.filter((r) => r.id === only || r.id === `npc:${only}`) : rows;
const bad = [];
const pct = (v) => `${(v * 100).toFixed(0)}%`;

console.log('side      id                    model h   decl h   parts  covered  top hit  slack');
console.log('-'.repeat(88));
for (const r of shown.sort((a, b) => a.covered - b.covered)) {
  if (r.error) { console.log(`${r.side.padEnd(9)} ${r.id.padEnd(21)} ${r.error}`); continue; }
  const flag = r.ok ? ' ' : '!';
  console.log(
    `${flag}${r.side.padEnd(8)} ${r.id.padEnd(21)} ` +
    `${r.modelH.toFixed(2).padStart(6)}m ${r.declH.toFixed(2).padStart(7)}m ` +
    `${String(r.parts).padStart(6)}  ${pct(r.covered).padStart(6)}  ` +
    `${r.topCovered.toFixed(2).padStart(6)}m ${r.slack.toFixed(2).padStart(6)}m`);
  if (!r.ok) bad.push(r);
}

// Parity: a kind you can play and the same kind standing next to you as a
// hostile must be shot as the same creature. They were not — a playable NPC's
// collider is clamped so a war beast fits the boards' doorways, and the hit
// volume used to be read off that clamp.
const byId = new Map(rows.map((r) => [r.id, r]));
const parity = [];
for (const r of rows) {
  if (r.side !== 'playable' || !r.id.startsWith('npc:')) continue;
  const asEnemy = byId.get(r.id.slice(4));
  if (asEnemy && asEnemy.volume !== r.volume) {
    parity.push(`  ${r.id}: shot as ${r.volume} when played, ${asEnemy.volume} as a hostile`);
  }
}

console.log('-'.repeat(88));
console.log(`${shown.length} bodies. Gated: slack <= ${MAX_SLACK} m, covered >= ${pct(MIN_COVERED)}.`);
console.log(`${bad.length} outside tolerance; ${parity.length} playable/hostile mismatches.`);
if (parity.length) {
  console.log('\nplayable vs hostile — same creature, different target:');
  for (const line of parity) console.log(line);
}
for (const r of bad) {
  const why = [];
  if (r.covered < MIN_COVERED) {
    why.push(`only ${pct(r.covered)} of it can be hit; the model tops out at ` +
      `${r.modelTop.toFixed(2)} m and the spheres stop at ${r.topCovered.toFixed(2)} m`);
  }
  if (r.slack > MAX_SLACK) why.push(`spheres reach ${r.slack.toFixed(2)} m past the body`);
  console.log(`  ${r.side}/${r.id}: ${why.join('; ')}`);
}

await h.close();
process.exit(bad.length + parity.length ? 1 : 0);
