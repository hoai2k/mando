/**
 * The field manual's job page (the pause menu's "what does this want of me").
 *
 * In a Missions run the manual opens on "The job": a section's own guide, or
 * an ordinary stage's objective and rules. Outside a run the tab is not there.
 * With `?dev` or a `?section=` start it offers "Skip section", which plays the
 * transport on as though the section had been won.
 *
 * Run:  node tools/test-job-page.mjs
 */
import { launch } from './harness.mjs';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};
const PORT = process.env.HARNESS_PORT ?? '4173';
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;
const openManual = () => page.evaluate(() => {
  const b = [...document.querySelectorAll('.corner-btn')].find((x) => x.title === 'Controls');
  b.click();
});
const read = () => page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.fe-manual .m-tabs .menu-btn')];
  const vis = (el) => !!el && el.style.display !== 'none';
  return {
    state: window.__state,
    tabs: tabs.map((t) => t.textContent),
    open: tabs.find((t) => t.classList.contains('open'))?.textContent ?? '',
    jobShown: vis(tabs[0]),
    skipShown: vis(tabs.find((t) => t.classList.contains('m-skip'))),
    title: document.querySelector('.m-brief-title')?.textContent ?? '',
    goal: document.querySelector('.m-brief-goal')?.textContent ?? '',
    steps: document.querySelectorAll('.m-brief-steps li').length,
  };
});

// 1. the title screen: no job
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
await openManual();
let r = await read();
check('outside a run the manual opens on its usual first page', r.open === 'On foot' && !r.jobShown, JSON.stringify(r));

// 2. a section, booted with ?section= (so the dev skip is offered)
await page.goto(`http://localhost:${PORT}/?section=lights-out`);
await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
await h.startStepped('campaign', 1, 'refinery', ['din']);
await page.evaluate(() => { window.__stateBefore = window.__state; });
await openManual();
r = await read();
check('in a section the manual opens on the job', r.state === 'controls' && r.open === 'The job' && r.jobShown, JSON.stringify(r));
check('and it is that section\'s guide', r.title === 'Lights Out' && r.goal.length > 10 && r.steps >= 3, `${r.title} / ${r.goal} / ${r.steps}`);
check('a ?section= start offers Skip section', r.skipShown);
await h.shot(process.env.SHOT ?? '/tmp/job-page.png');
const before = await page.evaluate(() => window.__game.campaign.stageIdx);
await page.evaluate(() => document.querySelector('.fe-manual .menu-btn.m-skip').click());
const after = await page.evaluate(async () => {
  const g = window.__game, c = g.campaign;
  for (let f = 0; f < 900 && (c.section || c.settlingStage); f++) g.update(1 / 30, [0, 1, 2, 3].map(() => ({})));
  return { state: window.__state, idx: c.stageIdx, section: !!c.section };
});
check('Skip section plays the transport on to the next stage', after.idx === before + 1 && !after.section, JSON.stringify({ before, ...after }));
check('and goes back to the match', after.state === 'playing', after.state);

// 3. an ordinary stage: its objective, no skip
await openManual();
r = await read();
check('on an ordinary stage the job names the objective', r.open === 'The job' && /^Make for /.test(r.goal) && r.steps >= 3, JSON.stringify(r));
check('and offers no skip', !r.skipShown);

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\njob page: all checks passed');
process.exit(failures.length ? 1 : 0);
