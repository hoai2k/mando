// A probe for tuning the Mark Runs: steps the section with its autopilot and
// prints the runner, the party and the phase every few seconds.
// HARNESS_PORT=4217 CHARS=din,maul node tools/probe-mark-runs.mjs [seconds] [every]
import { launch, blankInput } from './harness.mjs';
const port = process.env.HARNESS_PORT ?? '4173';
const secs = Number(process.argv[2] ?? 180), every = Number(process.argv[3] ?? 5);
const chars = (process.env.CHARS ?? 'din,maul').split(',');
const h = await launch({ url: `http://localhost:${port}/`, sections: true });
const { page } = h;
await page.goto(`http://localhost:${port}/?section=mark-runs`);
await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
await h.startStepped('campaign', chars.length, 'ringworld', chars);
for (let t = 0; t < secs; t += every) {
  const r = await page.evaluate(async ([blank, n, cull]) => {
    const g = window.__game, c = g.campaign;
    for (let f = 0; f < n; f++) {
      const s = c.section; if (!s) return { gone: true, stage: c.stageIdx };
      const inputs = [0, 1, 2, 3].map((slot) => {
        const p = g.players[slot]; if (!p) return blank;
        const a = s.autopilot(slot) || {};
        if (typeof a.yaw === 'number') p.cam.yaw = a.yaw;
        const { yaw, ...rest } = a; return { ...blank, ...rest };
      });
      g.update(1 / 30, inputs);
      if (cull && f % 30 === 0) for (const e of g.enemies) if (e.alive && e.team === 1) e.damage(9999999, e.position, 0);
    }
    const s = c.section;
    return { d: s.debug(), ps: g.players.map((p) => [p.position.x.toFixed(1), p.position.y.toFixed(1), p.position.z.toFixed(1), p.alive, p.grounded].join(' ')), hint: s.objective().hint };
  }, [blankInput(), every * 30, process.env.CULL !== '0']);
  console.log(`t=${t + every}`, JSON.stringify(r));
  if (r.gone) break;
}
await h.close();
