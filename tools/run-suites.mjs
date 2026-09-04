/**
 * The suite runner: one preview server, one report, and a way to split the
 * work across machines.
 *
 * `npm test` used to be twenty-four `node tools/<suite>.mjs` calls chained
 * with `&&`, which cost more than it looks:
 *
 *  - **Twenty-four preview servers.** Every suite calls `launch()`, which
 *    starts `npm run preview` when nothing answers on the port and kills it on
 *    the way out. So the server came up and went down once per suite, and the
 *    next suite paid for it again.
 *  - **No report.** `&&` stops at the first failure, so one broken check hid
 *    however many were behind it. On nightly run 199 a single check in
 *    test-block failed and eight suites and two audits never ran at all —
 *    which is how a second broken check stayed hidden for a day.
 *  - **Nothing said what was slow.** The 75 minutes were one opaque block.
 *    Two suites were 60% of it and nobody could see that from the outside.
 *
 * This starts the server once, runs every suite against it, lets all of them
 * finish whatever happens, and prints what each one cost and what failed.
 * Each suite's output is buffered and flushed whole, so nothing interleaves.
 *
 * Suites run ONE AT A TIME by default, for measured reasons — see
 * `defaultJobs` below. The overlap worth having is `--shard`, across runners.
 *
 *   node tools/run-suites.mjs                 # everything, one at a time
 *   node tools/run-suites.mjs test-modes ...  # just these
 *   node tools/run-suites.mjs --shard=2/4     # CI: this quarter of the work
 *   node tools/run-suites.mjs --jobs=2        # only if the box can take it
 *   node tools/run-suites.mjs --list
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = process.env.HARNESS_PORT ?? '4173';
const URL_ = `http://localhost:${PORT}/`;

/**
 * The suites, with roughly what each costs in seconds.
 *
 * This is the same list `npm test` used to chain with `&&`, in the same
 * membership — `tools/test-missions.mjs` is a real suite and is deliberately
 * still not in it, because it never was; it has no CI history and adding it
 * here would quietly change what a green `npm test` means. Run it by hand,
 * or name it on the command line: `node tools/run-suites.mjs test-missions`.
 *
 * The weight is only ever used to order the work — longest first, so `--shard`
 * splits the list into piles that take about the same time as each other
 * rather than piles with the same number of suites in them. A stale number
 * costs a little packing efficiency and nothing else, and every run ends with
 * the real ones, so it is cheap to refresh. Measured in September 2026; the
 * two that a CI runner disagrees with a laptop about most — test-modes and
 * check-creature-gaits — carry the runner's number, since the runner is where
 * the packing has to come out even.
 */
const SUITES = [
  { name: 'test-modes', weight: 409 },
  { name: 'test-vehicles', weight: 294 },
  { name: 'test-airplay', weight: 207 },
  { name: 'test-loadperf', weight: 190 },
  { name: 'test-monsters', weight: 154 },
  { name: 'test-coop', weight: 142 },
  { name: 'test-loadout', weight: 137 },
  { name: 'test-arrivals', weight: 127 },
  { name: 'check-creature-gaits', weight: 224 },
  { name: 'test-loading', weight: 92 },
  { name: 'check-flight-poses', weight: 85 },
  { name: 'check-bots', weight: 75 },
  { name: 'test-block', weight: 56 },
  { name: 'check-airflip', weight: 44 },
  { name: 'harness', weight: 43 },
  { name: 'test-allies', weight: 38 },
  { name: 'test-station', weight: 38 },
  { name: 'test-brood', weight: 33 },
  { name: 'check-block-facing', weight: 30 },
  { name: 'check-landing', weight: 29 },
  { name: 'test-ragdoll', weight: 29 },
  { name: 'test-overheat', weight: 26 },
  { name: 'test-cover', weight: 24 },
  { name: 'test-hits', weight: 23 },
  { name: 'test-menunav', weight: 10 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- arguments ----------
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const has = (name) => args.includes(`--${name}`);
const picked = args.filter((a) => !a.startsWith('-')).map((a) => a.replace(/^tools\//, '').replace(/\.mjs$/, ''));

const jobs = Math.max(1, Number(flag('jobs') ?? process.env.JOBS ?? defaultJobs()));

/**
 * ONE AT A TIME, DELIBERATELY.
 *
 * Running the suites side by side is the obvious idea and it does not work
 * here, for two measured reasons:
 *
 *  - **There is no spare CPU to give.** SwiftShader is not one thread: a
 *    single suite already runs at about 390% on a four-core box, so a second
 *    one alongside it is dividing that, not adding to it.
 *  - **There is no spare memory either.** One Chromium renderer playing this
 *    game peaks near 4.7 GB — 245 MB of models decoded, uploaded and held.
 *    Two of them on a 16 GB box is an OOM kill, and the suite that loses
 *    reports `page.evaluate: Target crashed`, which reads like a bug in the
 *    game rather than a machine out of memory. That is a worse failure than a
 *    slow run: it is a flake with a misleading message.
 *
 * So the overlap worth having is between *runners*, not between processes on
 * one of them: `--shard=k/n`, which is what the nightly does. `--jobs=N` is
 * still here for a machine with the cores and the memory to spare.
 */
function defaultJobs() {
  return 1;
}

let chosen = picked.length
  ? picked.map((name) => SUITES.find((s) => s.name === name) ?? { name, weight: 200 })
  : SUITES.slice();

// longest first: the packing this runner depends on, for jobs and for shards
chosen.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));

// ---------- sharding ----------
// Greedy longest-processing-time: hand each suite to the shard that is least
// loaded so far. Splitting the list by index instead would put the four
// heaviest suites in the same quarter as often as not.
const shard = flag('shard');
if (shard) {
  const [k, n] = shard.split('/').map(Number);
  if (!(k >= 1 && k <= n)) throw new Error(`--shard=${shard}: want k/n with 1 <= k <= n`);
  const load = Array.from({ length: n }, () => 0);
  const bins = Array.from({ length: n }, () => []);
  for (const s of chosen) {
    const i = load.indexOf(Math.min(...load));
    bins[i].push(s);
    load[i] += s.weight;
  }
  chosen = bins[k - 1];
  console.log(`shard ${k}/${n}: ${chosen.length} suite(s), ~${Math.round(load[k - 1])}s of work`);
}

// after the shard, so `--shard=3/4 --list` answers "what is in shard 3"
if (has('list')) {
  for (const s of chosen) console.log(`${String(s.weight).padStart(4)}s  ${s.name}`);
  process.exit(0);
}

if (!chosen.length) {
  console.log('nothing to run');
  process.exit(0);
}

// ---------- the one preview server ----------
const reachable = async () => {
  try { await fetch(URL_); return true; } catch { return false; }
};

async function startServer() {
  if (await reachable()) {
    console.log(`reusing the server already answering on ${URL_}`);
    return null;
  }
  const child = spawn('npm', ['run', 'preview', '--', '--port', PORT], {
    cwd: ROOT, stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    if (await reachable()) return child;
    if (child.exitCode !== null) break;
  }
  child.kill();
  throw new Error(`preview server did not come up on ${URL_} — is dist/ built? (npm run build)`);
}

// ---------- running ----------
/**
 * A suite that never finishes must not take the run with it: without this a
 * hung browser turns `npm test` into something you notice an hour later. The
 * cap is deliberately far above the slowest suite — it is a backstop, not a
 * budget, and a suite that trips it is reported as the failure it is.
 */
const SUITE_TIMEOUT_MS = Number(flag('timeout') ?? 20 * 60_000);

function runSuite(suite) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, `${suite.name}.mjs`)], {
      cwd: ROOT,
      // HARNESS_PORT is what points every suite at the server we already
      // started; `launch()` reuses whatever answers there rather than
      // starting — and killing — one of its own.
      env: { ...process.env, HARNESS_PORT: PORT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let timedOut = false;
    const killer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, SUITE_TIMEOUT_MS);
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('close', (code) => {
      clearTimeout(killer);
      if (timedOut) out += `\n[runner] killed after ${(SUITE_TIMEOUT_MS / 1000).toFixed(0)}s\n`;
      resolve({ ...suite, code: timedOut ? 124 : code, out, seconds: (Date.now() - started) / 1000 });
    });
  });
}

const server = await startServer();
// a server we started is ours to clean up, however this process ends —
// otherwise an interrupted run leaves something holding the port and the next
// run silently tests whatever that is still serving
if (server) {
  const stop = () => { server.kill(); };
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { stop(); process.exit(130); });
  }
}
console.log(`running ${chosen.length} suite(s)${jobs > 1 ? `, ${jobs} at a time` : ''} against ${URL_}\n`);

const wall = Date.now();
const queue = chosen.slice();
const done = [];

async function worker() {
  for (;;) {
    const suite = queue.shift();
    if (!suite) return;
    // A started line as well as a finished one: the heaviest suite runs for
    // minutes and its output is held back until it ends, so without this the
    // run looks hung to whoever is watching it.
    process.stdout.write(`>>> ${suite.name} (~${suite.weight}s)\n`);
    const r = await runSuite(suite);
    done.push(r);
    // one suite's output, whole, so a parallel run reads like a serial one
    process.stdout.write(`\n${'='.repeat(70)}\n${r.code ? 'FAIL' : 'ok  '}  ${r.name}  (${r.seconds.toFixed(1)}s)  [${done.length}/${chosen.length}]\n${'='.repeat(70)}\n`);
    process.stdout.write(r.out.trimEnd() + '\n');
  }
}

await Promise.all(Array.from({ length: Math.min(jobs, chosen.length) }, worker));
server?.kill();

// ---------- the report ----------
const total = (Date.now() - wall) / 1000;
const cpu = done.reduce((a, r) => a + r.seconds, 0);
const failed = done.filter((r) => r.code);

console.log(`\n${'='.repeat(70)}\nslowest first\n${'='.repeat(70)}`);
for (const r of [...done].sort((a, b) => b.seconds - a.seconds)) {
  console.log(`${(r.code ? 'FAIL' : 'ok  ')}  ${r.seconds.toFixed(1).padStart(7)}s  ${r.name}`);
}
console.log(`\n${done.length} suite(s) in ${(total / 60).toFixed(1)} min`
  + (jobs > 1 ? ` (${(cpu / 60).toFixed(1)} min of suite time, ${(cpu / total).toFixed(2)}x overlap)` : ''));

if (failed.length) {
  // The failing checks again, at the end. A run is thousands of lines of `ok`
  // and the one line that matters was somewhere in the middle of it; whoever
  // opens a red CI job reads the bottom of the log first, so put it there.
  console.log(`\n${'='.repeat(70)}\n${failed.length} suite(s) FAILED\n${'='.repeat(70)}`);
  for (const r of failed) {
    console.log(`\n${r.name}:`);
    const lines = r.out.split('\n').filter((l) => /^\s*(FAIL|\d+ check)|Error|failed/.test(l));
    for (const l of lines.slice(0, 12)) console.log(`  ${l.trim()}`);
    if (!lines.length) console.log(`  exited ${r.code} with nothing that looks like a failing check`);
  }
  process.exit(1);
}
console.log('\nall suites passed');
