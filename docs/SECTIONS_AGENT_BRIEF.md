# Gameplay Sections — brief for an agent building one

You are building one territory's gameplay sections (or a kit) for **Bounty
Hunters**, a Three.js + TypeScript + Vite fan game inspired by *The
Mandalorian*. This brief is the same for every agent on the work. Your own
assignment (which sections, which kits, the doors either side) is in the
message that started you, and in
[`SECTIONS_IMPLEMENTATION.md`](SECTIONS_IMPLEMENTATION.md) §1 and §4.

## Read first, in this order

1. [`LEVEL_SECTIONS.md`](LEVEL_SECTIONS.md): the design of your sections, and
   the diagram for each in `docs/sections/<nn>-<id>.svg`.
2. The painted keyframe for each, in `reference/sections/<nn>-<id>.png`. Look at
   it with the Read tool: it is the mood and the moment the section exists for.
3. [`SECTIONS_IMPLEMENTATION.md`](SECTIONS_IMPLEMENTATION.md): §0 the rules (not
   negotiable), §1 where your section goes and how it joins the stages either
   side, §2 the framework (read **§2.6 As built** closely), §3 the kits, §4 your
   sections' build notes.
4. `src/sections/chimney.ts`: the reference section. Copy its shape: build,
   first-update spawn, objective, respawn, HUD, autopilot.
5. `src/sections/api.ts`, `context.ts` and `kit/*.ts`: the contract and the tools.
6. `docs/MISSIONS_OUTDOOR.md` §1 and §4, and the stages either side of yours in
   `src/world/mission-layouts.ts`, so your two ends match what the player just
   left and is about to enter. Boot them to look (see Tools below).

## The bar

- **It is its own game.** Its own verb, an escalation (the start, middle and end
  play differently) and a climax. Fun solo and at four players. Tune it until it
  would be worth playing on its own, then tune it again. Numbers in the design
  doc are starting points, not specs; change them when play says so, and write
  down why.
- **The §0 rules.** Nothing can be left behind (one-way, everything it needs is
  inside it, lost tools come back, the fallen return forward, no soft-lock). The
  way forward and the edges read from the scene. Both ends are a believable
  continuation of the doors either side. Stand-ins first for every sculpt.
- **Every character works.** Mandalorians jetpack (about 28 m a burn, refilling
  on the ground). The others super-jump (rise while A is held, no fuel). Test
  with both (`CHARS=din,maul,...`).
- **Readable.** Short HUD hints (about 34 characters at most). Use
  `beacon: false` where a sixty-metre light column would be wrong. Hazards
  telegraph before they hurt.

## Rules of the road

- **Branch.** Work on the branch you were given (`claude/sections-<team>`),
  created from `claude/level-design-gameplay-sections-koa6ye`. Commit often, with
  clear messages, and push to your branch. **Never** push to `main` or to the
  working branch, and do not open a pull request. The orchestrating session
  merges.
- **Files you own:** `src/sections/<your ids>.ts` (or a folder), any
  `src/sections/kit/<kit>.ts` assigned to you, your `TEXT.sections.<id>` blocks
  in `src/text.ts`, your lines in `src/sections/index.ts` and `ids.ts`, and your
  own tests `tools/test-section-<name>.mjs`.
- **Shared files** (`player.ts`, `game.ts`, `vehicles.ts`, `hud.ts`, `campaign.ts`,
  `enemy.ts`): only when your kit truly needs it. Keep each change to a small,
  commented block, prefer adding a hook to rewriting logic, and list every such
  change in your notes file. Other agents are editing in parallel. `vehicles.ts`
  is K3's owner's alone.
- **Do not edit** `docs/SECTIONS_STATUS.md` (the orchestrator keeps it). Write
  your state to **`docs/sections-notes/<team>.md`** instead: what is built, what
  it plays like, the tuning numbers and why, the shared-file changes, known
  issues, and what is left. Keep it current as you go, so the work can be paused
  and picked up by someone else.
- **Assets.** Model ids requested for your sections are in `ASSETS_MODELS.md`
  ("Gameplay sections — props and a prisoner") and textures in `ASSETS_IMAGES.md`
  ("Gameplay sections — supporting images"). Use `ctx.prop(id, at, { fallback })`
  with a procedural stand-in of the specified size and pivot (built to the proportions
  measured from its reference sheet: [`ASSETS_MODELS.md`](ASSETS_MODELS.md#stand-in-proportions-measured-from-the-sheets-2026-09-28)), and
  `ctx.tile(mat, name, …)` for textures. A missing file must look right.
  If you need an image that is not requested, add a row to `ASSETS_IMAGES.md`'s
  gameplay-sections table in your commit.

## Tools

- `npm ci` once, then `npm run build` (this runs `tsc` too). It must stay clean.
- `CHROMIUM_PATH=/opt/pw-browsers/chromium HARNESS_PORT=<port> node tools/test-sections.mjs <id> ...`,
  with `PLAYERS=1`, `2` (default) and `4`, and `CHARS=...`. **It must pass at 1, 2
  and 4 players.** It boots each section with `?section=<id>`, culls hostiles once
  a second, and drives every player with your `autopilot` until the section
  completes and the next stage is raised.
- To look at it: boot `http://localhost:<port>/?section=<id>` with the harness
  (`launch({ sections: true })`, `h.startStepped('campaign', n, board, chars)`),
  step `window.__game.update(1/30, inputs)` with your autopilot's inputs, then
  `window.__stepFrame(1/30)` once, and `h.shot(path)`. Read the PNG. Do this
  several times across the section and fix what looks wrong. A copy of this
  script is below.
- If you change a shared file, also run the suites that cover it: for example
  `test-vehicles` for `vehicles.ts`, `test-modes` for `game.ts` or `player.ts`, and
  `test-missions` for `campaign.ts`. The older suites run with sections off
  automatically.

```js
// shot-section.mjs <id> <board> <out-prefix> <seconds...>
import { launch, blankInput } from './tools/harness.mjs';
const [id, board, prefix, ...times] = process.argv.slice(2);
const port = process.env.HARNESS_PORT ?? '4173';
const h = await launch({ url: `http://localhost:${port}/`, sections: true });
const { page } = h;
await page.goto(`http://localhost:${port}/?section=${id}`);
await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
await h.startStepped('campaign', 1, board, [process.env.CHAR ?? 'din']);
let at = 0;
for (const t of times.map(Number)) {
  await page.evaluate(async ([blank, n]) => {
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
  }, [blankInput(), Math.round((t - at) * 30)]);
  at = t;
  await page.evaluate(() => window.__stepFrame(1 / 30));
  await h.shot(`${prefix}-${t}.png`);
}
await h.close();
```

## Done means

Your sections are registered and in their runs. `npm run build` is clean.
`test-sections` passes at 1, 2 and 4 players with mixed characters, and your own
mechanic tests pass. You have looked at screenshots across each section and they
read right. Your notes file is complete. Everything is pushed to your branch.
End with a short report: what you built, how it plays, the shared-file changes,
and anything left.
