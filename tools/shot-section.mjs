// shot-section.mjs <id> <board> <out-prefix> <seconds...>  (the brief's look-at-it script)
import { launch, blankInput } from './harness.mjs';
const [id, board, prefix, ...times] = process.argv.slice(2);
const port = process.env.HARNESS_PORT ?? '4173';
const h = await launch({ url: `http://localhost:${port}/`, sections: true });
const { page } = h;
await page.goto(`http://localhost:${port}/?section=${id}`);
await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
const chars = (process.env.CHARS ?? 'din').split(',');
await h.startStepped('campaign', chars.length, board, chars);
let at = 0;
for (const t of times.map(Number)) {
  const dbg = await page.evaluate(async ([blank, n]) => {
    const g = window.__game, c = g.campaign;
    for (let f = 0; f < n; f++) {
      const s = c.section; if (!s) break;
      const inputs = [0, 1, 2, 3].map((slot) => {
        const p = g.players[slot]; if (!p) return blank;
        const a = s.autopilot(slot) || {};
        if (typeof a.yaw === 'number') p.cam.yaw = a.yaw;
        const { yaw, ...r } = a; return { ...blank, ...r };
      });
      g.update(1 / 30, inputs);
      if (f % 30 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const s = c.section;
    return { dbg: s?.debug?.() ?? null, pos: g.players.map((p) => [p.position.x.toFixed(1), p.position.y.toFixed(1), p.position.z.toFixed(1), p.hp | 0]) };
  }, [blankInput(), Math.round((t - at) * 30)]);
  at = t;
  console.log(t, JSON.stringify(dbg));
  await page.evaluate(() => window.__stepFrame(1 / 30));
  await h.shot(`${prefix}-${t}.png`);
}
await h.close();
