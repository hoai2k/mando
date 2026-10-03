/**
 * Boss arenas seal one way: the way in lets bodies through forward and never
 * back. Players, allies and enemies who are still outside when it seals can
 * always come in after the fight; nobody inside can leave by it.
 *
 * For every boss arena (lieutenant and warlord) on the boards named (default:
 * all of them), with the seal shut:
 *   - a player behind it walks forward through it,
 *   - and cannot walk back out,
 *   - an ally behind it follows its hunter in,
 *   - and an enemy stopped in the doorway finishes the crossing inward
 *     (a body wedged in a seal used to be pushed out of the nearest face,
 *     which could be the outside).
 *
 * Run:  node tools/test-seals.mjs [board ...]
 */
import { launch, blankInput, makeCheck } from './harness.mjs';

const check = makeCheck();
const PORT = process.env.HARNESS_PORT ?? '4173';
const BOARDS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['desert', 'station', 'nevarro', 'crevasse', 'trask', 'refinery', 'forge', 'ringworld', 'narkina'];

const h = await launch({ url: `http://localhost:${PORT}/` });
const { page } = h;

for (const board of BOARDS) {
  console.log(`\n-- ${board}`);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
  await h.startStepped('campaign', 2, board, ['din', 'maul']);
  const res = await page.evaluate(async ([blank]) => {
    const g = window.__game, c = g.campaign;
    const idle = [blank, blank, blank, blank];
    const out = [];
    const [p, q] = g.players;
    p.maxHp = q.maxHp = 1e6; p.hp = q.hp = 1e6;
    for (let si = 0; si < 12; si++) {
      if (si !== c.stageIdx) {
        try { c.enterStage(si, false); } catch { break; }
        for (let i = 0; i < 600 && c.settlingStage; i++) {
          g.update(1 / 30, idle);
          if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (c.stageIdx !== si) break;
      const zones = c.stage.zones;
      for (let zi = 0; zi < zones.length; zi++) {
        const z = zones[zi];
        if (z.spec.kind !== 'lieutenant' && z.spec.kind !== 'warlord') continue;
        const bar = z.entryBarrier;
        const name = `${c.stage.spec.label} / ${z.spec.label}`;
        if (!bar) { out.push({ name, none: true }); continue; }
        c.idx = zi; c.phase = 'travel';
        for (const e of g.enemies) e.removeMe = true;
        g.update(1 / 30, idle);
        c.enterZone(z);
        // the boss's entrance plays first, and nobody moves through it
        for (let i = 0; i < 300; i++) {
          g.update(1 / 30, idle);
          if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        // keep the boss out of it: this is about the door
        for (const e of g.enemies) if (e.alive && e.team === 1) e.removeMe = true;
        g.update(1 / 30, idle);
        const dir = bar.entryDirection ?? bar.forward;
        const at = (k) => ({ x: bar.pos.x + dir.x * k, z: bar.pos.z + dir.z * k });
        const side = (b) => (b.position.x - bar.pos.x) * dir.x + (b.position.z - bar.pos.z) * dir.z;
        const put = (b, k) => { const a = at(k); b.position.set(a.x, bar.pos.y + 0.1, a.z); b.velocity.set(0, 0, 0); };
        const walk = (b, k, n) => {
          for (let i = 0; i < n; i++) {
            const to = at(k);
            b.cam.yaw = Math.atan2(to.x - b.position.x, to.z - b.position.z);
            const inp = [blank, blank, blank, blank];
            inp[b.slot] = { ...blank, moveY: 1 };
            g.update(1 / 30, inp);
          }
        };
        const r = { name, sealed: !!bar.box?.oneWay };
        put(q, 9);
        put(p, -3);
        walk(p, 7, 70);
        r.playerIn = side(p);
        walk(p, -7, 70);
        r.playerBack = side(p);
        r.stillSealed = !!bar.box?.oneWay;
        // an ally behind the seal follows its hunter in
        const Ctor = g.enemies.find((e) => e)?.constructor ?? null;
        if (Ctor) {
          const o = at(-4);
          const ally = new Ctor('fennec', p.position.clone().set(o.x, bar.pos.y + 0.2, o.z), 0);
          g.addAlly(ally);
          ally.setOwner(q);
          for (let i = 0; i < 200; i++) { put(q, 9); put(p, 10); g.update(1 / 30, idle); }
          r.allyIn = side(ally);
          ally.removeMe = true;
          // an enemy stopped in the doorway finishes the crossing inward
          const e = new Ctor('pirate', p.position.clone().set(at(-0.2).x, bar.pos.y + 0.2, at(-0.2).z), 1);
          g.addEnemy(e);
          e.position.set(at(-0.2).x, bar.pos.y + 0.2, at(-0.2).z);
          e.velocity.set(0, 0, 0);
          e.knockdown(2);   // lying still in it
          for (let i = 0; i < 20; i++) { put(q, 9); put(p, 10); g.update(1 / 30, idle); }
          r.enemyIn = side(e);
          e.removeMe = true;
        }
        out.push(r);
      }
    }
    return out;
  }, [blankInput()]);
  for (const r of res) {
    if (r.none) { console.log(`  (no seal) ${r.name}`); continue; }
    check(`${board} · ${r.name}: the seal is one-way`, r.sealed && r.stillSealed);
    check(`${board} · ${r.name}: a player walks in through it`, r.playerIn > 1.5, r.playerIn.toFixed(1));
    check(`${board} · ${r.name}: and cannot walk back out`, r.playerBack > 0, r.playerBack.toFixed(1));
    if (r.allyIn !== undefined) check(`${board} · ${r.name}: an ally follows its hunter in`, r.allyIn > 1.5, r.allyIn.toFixed(1));
    if (r.enemyIn !== undefined) check(`${board} · ${r.name}: an enemy stopped in the doorway ends up inside`, r.enemyIn > 0, r.enemyIn.toFixed(1));
  }
}

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
check.done('seals');
