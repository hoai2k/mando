/**
 * The gameplay sections suite (docs/SECTIONS_IMPLEMENTATION.md §2.5).
 *
 * For every registered section: boot its territory's Missions run **at** the
 * section (`?section=<id>`), check the build, then drive every player with
 * the section's own autopilot until the section reports itself won and the
 * run carries the party into the next stage. A section whose autopilot
 * cannot finish it is not done — if a bot cannot get through, a new player
 * may not either.
 *
 * Like test-missions this drives the *simulation* (`game.update` at 1/30 s
 * with the live loop off), so minutes of play take seconds. Hostiles are put
 * down every second, as the walk in test-missions does: this suite is about
 * the section — that its way on works, that it can be finished, that nobody
 * leaves the playable area — not about whether a bot out-fights the board.
 *
 * Run:  node tools/test-sections.mjs [id ...]      (default: every section)
 *       PLAYERS=4 node tools/test-sections.mjs     (party size; default 2)
 */
import { launch, blankInput } from './harness.mjs';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const PORT = process.env.HARNESS_PORT ?? '4173';
const PLAYERS = Number(process.env.PLAYERS ?? 2);
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;

await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__startMode && !!window.__sections, null, { timeout: 60000 });
const reg = await page.evaluate(() => window.__sections);
check('every section the layouts think is built is registered, and no other',
  JSON.stringify([...reg.built].sort()) === JSON.stringify([...reg.registered].sort()),
  `built ${reg.built.join(',')} / registered ${reg.registered.join(',')}`);

const argv = process.argv.slice(2);
const runsOnly = argv.includes('--runs-only');
const want = argv.filter((a) => !a.startsWith('--'));
const ids = runsOnly ? [] : want.length ? want : reg.registered;
// a jetpack and a super-jumper in every party, so both ways of flying are driven
const CHARS = (process.env.CHARS ?? 'din,maul,armorer,jedi').split(',');

for (const id of ids) {
  const board = reg.boards[id];
  if (!board) { check(`${id}: placed in a territory`, false); continue; }
  console.log(`\n-- ${id} (${board}, ${PLAYERS} players)`);
  await page.goto(`http://localhost:${PORT}/?section=${id}`);
  await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
  await h.startStepped('campaign', PLAYERS, board, CHARS.slice(0, PLAYERS));

  const built = await page.evaluate((id) => {
    const c = window.__game.campaign;
    const s = c.section;
    const g = window.__game;
    return {
      standing: !!s && c.stage.spec.section === id,
      stageIdx: c.stageIdx,
      starts: s ? s.starts.length : 0,
      inside: g.players.every((p) => s && s.contains(p.position.x, p.position.z)),
      objectiveAway: !!s && g.players.every((p) => p.position.distanceTo(s.objective().pos) > 3),
      path: s ? s.path.length : 0,
      hud: !!s && (s.hud ? s.hud(0) !== undefined : true),
      label: s ? s.objective().label : '',
    };
  }, id);
  check(`${id}: the run starts at the section`, built.standing, JSON.stringify(built));
  if (!built.standing) continue;
  check(`${id}: the party stands inside the section's footprint`, built.inside);
  check(`${id}: the objective is somewhere to go, not underfoot`, built.objectiveAway, built.label);
  check(`${id}: it has a golden path`, built.path >= 2, String(built.path));

  const run = await page.evaluate(async ([blank, maxSeconds]) => {
    const g = window.__game;
    const c = g.campaign;
    const from = c.stageIdx;
    const out = { seconds: 0, completed: false, advanced: false, outside: 0, deaths: 0, errors: [] };
    const wasAlive = g.players.map((p) => p.alive);
    for (let f = 0; f < maxSeconds * 30; f++) {
      const s = c.section;
      if (s?.complete) out.completed = true;
      if (c.stageIdx !== from && !c.section) { out.advanced = true; break; }
      const inputs = [0, 1, 2, 3].map((slot) => {
        const p = g.players[slot];
        const i = { ...blank };
        if (!p || !s) return i;
        let a = {};
        try { a = s.autopilot(slot) ?? {}; } catch (e) { out.errors.push(String(e)); }
        if (typeof a.yaw === 'number') { p.cam.yaw = a.yaw; }
        const { yaw, ...rest } = a;
        void yaw;
        return { ...i, ...rest };
      });
      g.update(1 / 30, inputs);
      if (f % 30 === 0) {
        for (const e of g.enemies) if (e.alive && e.team === 1) e.damage(9999999, e.position, 0);
        for (const p of g.players) {
          if (s && c.section === s && p.alive && !s.contains(p.position.x, p.position.z)) out.outside++;
        }
      }
      g.players.forEach((p, i) => { if (wasAlive[i] && !p.alive) out.deaths++; wasAlive[i] = p.alive; });
      // yield now and then so files can land
      if (f % 300 === 0) await new Promise((r) => setTimeout(r, 0));
      out.seconds = f / 30;
    }
    out.debug = c.section?.debug?.() ?? null;
    out.to = c.stageIdx;
    return out;
  }, [blankInput(), Number(process.env.SECTION_SECONDS ?? 420)]);
  check(`${id}: the autopilot finishes it`, run.completed, JSON.stringify({ s: run.seconds, debug: run.debug }));
  check(`${id}: and the run carries on into the next stage`, run.advanced, `stage ${built.stageIdx} -> ${run.to}`);
  check(`${id}: nobody ends up outside the playable area`, run.outside === 0, String(run.outside));
  check(`${id}: the autopilot ran without errors`, run.errors.length === 0, run.errors.slice(0, 3).join(' | '));
  console.log(`       ${run.seconds.toFixed(0)} s simulated, ${run.deaths} deaths`);
}

// ---------------------------------------------------------------- whole runs
//
// `RUNS=nevarro,desert node tools/test-sections.mjs --runs-only` plays each
// named territory's stages in order in **one** match: a zone stage is crossed
// by its own transport path (`enterStage`, what a door does — walking zones is
// test-missions' job), a section is played by its autopilot until it hands
// over. It proves the stages either side of each section hand over to it and
// from it, and that nothing a section put on the engine outlives it.
const RUNS = (process.env.RUNS ?? '').split(',').filter(Boolean);
for (const board of RUNS) {
  console.log(`\n-- full run: ${board}`);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
  await h.startStepped('campaign', PLAYERS, board, CHARS.slice(0, PLAYERS));
  const run = await page.evaluate(async ([blank, maxSeconds]) => {
    const g = window.__game;
    const c = g.campaign;
    const out = { order: [], played: [], stuck: null, leaked: [], errors: [] };
    const settle = async () => {
      for (let f = 0; f < 600 && c.settlingStage; f++) {
        g.update(1 / 30, [0, 1, 2, 3].map(() => blank));
        if (f % 30 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    };
    const total = window.__sections.stageCount?.[g.board.kind] ?? 99;
    for (let hop = 0; hop < 30; hop++) {
      await settle();
      const idx = c.stageIdx;
      const spec = c.stage.spec;
      out.order.push(spec.section ?? spec.kind);
      if (c.section) {
        let f = 0;
        for (; f < maxSeconds * 30 && c.stageIdx === idx; f++) {
          const s = c.section;
          const inputs = [0, 1, 2, 3].map((slot) => {
            const p = g.players[slot];
            if (!p || !s) return blank;
            let a = {};
            try { a = s.autopilot(slot) ?? {}; } catch (e) { out.errors.push(String(e)); }
            if (typeof a.yaw === 'number') p.cam.yaw = a.yaw;
            const { yaw, ...rest } = a; void yaw;
            return { ...blank, ...rest };
          });
          g.update(1 / 30, inputs);
          if (f % 30 === 0) for (const e of g.enemies) if (e.alive && e.team === 1) e.damage(9999999, e.position, 0);
          if (f % 300 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        if (c.stageIdx === idx) { out.stuck = spec.section; break; }
        out.played.push(spec.section);
        // nothing the section put on the engine outlives it
        if (!c.section) {
          if (g.sharedView) out.leaked.push(`${spec.section}: sharedView`);
          if (g.players.some((p) => p.sectionMove || p.moveYaw !== null)) out.leaked.push(`${spec.section}: player hooks`);
        }
      } else {
        // a zone stage: cross it the way its transport door would
        const next = idx + 1;
        if (next >= total) break;
        c.enterStage(next, false);
        if (c.stageIdx !== next) { out.stuck = `stage ${idx}`; break; }
      }
    }
    return out;
  }, [blankInput(), Number(process.env.SECTION_SECONDS ?? 420)]);
  const want = reg.built.filter((id) => reg.boards[id] === board);
  check(`${board}: every built section is in the run, in order`, want.every((id) => run.order.includes(id)), run.order.join(' > '));
  check(`${board}: and each one is played through and hands over`, !run.stuck && want.every((id) => run.played.includes(id)),
    JSON.stringify({ stuck: run.stuck, played: run.played }));
  check(`${board}: nothing a section set on the engine outlives it`, run.leaked.length === 0, run.leaked.join(', '));
  check(`${board}: the autopilots ran without errors`, run.errors.length === 0, run.errors.slice(0, 3).join(' | '));
}

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
