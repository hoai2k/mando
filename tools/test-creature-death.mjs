/**
 * Creature death regression test: the spiders tumble, and never stand on end.
 *
 * A dead krykna used to come to rest balanced on its nose or its tail, the
 * long body pointing at the sky. The rigless corpse solver fell on a BOX, and a
 * box has six faces it is happy to rest on — the two small end faces included.
 * The rounded body it stood in for has none: an egg on its end has its weight
 * as high as it can go, and the slightest lean rolls it onto its side.
 *
 * For a krykna, a broodmother and a spiderling, killed from several bearings
 * on several seeds, this checks that the corpse:
 *
 *   1. lies with its long (nose-to-tail) axis within 35° of horizontal,
 *   2. rests ON the ground — the lowest drawn vertex, skinned, sits on the
 *      terrain under it, neither floating nor sunk,
 *   3. tumbled: it was thrown clear and turned by the hit, rather than
 *      dropping on the spot in the pose it died in,
 *   4. had its legs go limp — the leg chains are not in the walk pose.
 *
 * `--shots=<dir>` also renders each kind's corpse at rest to <dir>.
 *
 * Run:  node tools/test-creature-death.mjs [--shots=dir]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, makeCheck, blankInput } from './harness.mjs';

const shotsDir = process.argv.find((a) => a.startsWith('--shots='))?.split('=')[1];
const check = makeCheck();

const h = await launch();
await h.waitForText(/WAVE BATTLE|PRESS START/i);
await h.startStepped('wave', 1, 'desert');

const KINDS = ['krykna', 'broodmother', 'spiderling'];
/** bearings the killing shot comes from, relative to the creature's facing */
const BEARINGS = [0, 90, 180, 270, 45];

const results = await h.page.evaluate(async ({ KINDS, BEARINGS, blank, wantShots }) => {
  window.__manual = true;
  const inputs = [blank, blank, blank, blank];
  const DT = 1 / 60;
  const g = window.__game;
  const run = (s) => { for (let t = 0; t < s; t += DT) g.update(DT, inputs); };
  const p = g.players[0];
  const V3 = p.position.constructor;

  /** every skinned vertex of the visible body, in world space (a stride of them) */
  const vertsOf = (root) => {
    root.updateMatrixWorld(true);
    const out = [];
    const v = new V3();
    root.traverse((o) => {
      if (!o.visible) return;
      // a hidden ancestor hides it too
      for (let a = o.parent; a; a = a.parent) if (!a.visible) return;
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      if (o.userData?.readout) return;
      const n = o.geometry.attributes.position.count;
      const step = Math.max(1, Math.floor(n / 1500));
      for (let i = 0; i < n; i += step) {
        o.getVertexPosition(i, v);
        v.applyMatrix4(o.matrixWorld);
        out.push([v.x, v.y, v.z]);
      }
    });
    return out;
  };
  /** the leg bones' local rotations — the pose the legs are holding */
  const legPose = (root) => {
    const q = {};
    root.traverse((o) => {
      if (!o.isBone || !/^leg[LR]\d(_mid|_tip)?$/.test(o.name)) return;
      for (let a = o.parent; a; a = a.parent) if (!a.visible) return;
      if (!(o.name in q)) q[o.name] = o.quaternion.clone();
    });
    return q;
  };
  /** the 3D direction of the nose-to-tail axis, from the body's own frame */
  const longAxis = (root) => new V3(0, 0, 1).applyQuaternion(root.quaternion);

  const out = {};
  const shots = {};
  for (const kind of KINDS) {
    const trials = [];
    for (let b = 0; b < BEARINGS.length; b++) {
      const spot = p.position.clone();
      spot.x += 16 + (b % 2) * 4;
      spot.z += 6 + b * 5;
      const e = g.addReinforcement(kind, spot);
      for (let t = 0; t < 15 && e.arrival; t += DT) g.update(DT, inputs);
      for (let i = 0; i < 80 && !(e.char.modelReady?.() ?? true); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      run(0.5);
      const before = new Set(g.enemies);
      // hold it still and square, so the shot's bearing is the one asked for
      e.velocity.set(0, 0, 0);
      const root = e.char.root;
      root.updateMatrixWorld(true);
      const yaw0 = Math.atan2(longAxis(root).x, longAxis(root).z);
      const bearing = yaw0 + (BEARINGS[b] * Math.PI) / 180;
      const from = e.position.clone().add(new V3(Math.sin(bearing) * 8, 1, Math.cos(bearing) * 8));
      const pos0 = root.position.clone();
      const quat0 = root.quaternion.clone();
      const legs0 = legPose(root);
      e.damage(9999, from, 0);
      e.knockback(from, 5.5, 0.2);
      // the broodmother calls her brood when hurt: clear them so they do not
      // shove the corpse about or crowd the shot
      for (const o of g.enemies) if (!before.has(o) && o !== e) o.removeMe = true;
      let settledAt = -1;
      let peakTurn = 0;
      for (let t = 0; t < 8; t += DT) {
        g.update(DT, inputs);
        peakTurn = Math.max(peakTurn, root.quaternion.angleTo(quat0));
        if (settledAt < 0 && e.settled) settledAt = t;
        if (settledAt >= 0 && t > settledAt + 0.5) break;
      }
      for (const o of g.enemies) if (!before.has(o) && o !== e) o.removeMe = true;
      root.updateMatrixWorld(true);
      const ax = longAxis(root);
      const tilt = Math.asin(Math.min(1, Math.abs(ax.y))) * 180 / Math.PI;
      // how far each of the body's own axes ended from world up
      const upY = new V3(0, 1, 0).applyQuaternion(root.quaternion).y;
      const verts = vertsOf(root);
      let low = Infinity, lx = 0, lz = 0, sx = 0, sz = 0;
      for (const [x, y, z] of verts) { if (y < low) { low = y; lx = x; lz = z; } sx += x; sz += z; }
      sx /= verts.length || 1; sz /= verts.length || 1;
      // ground under the lowest vertex, and the worst point's clearance: the
      // most-sunk vertex is the deepest anything goes into the terrain
      const gLow = g.board.physics.groundHeight(lx, lz, low + 1.5);
      let sunk = 0;
      for (let i = 0; i < verts.length; i += 3) {
        const [x, y, z] = verts[i];
        const gh = g.board.physics.groundHeight(x, z, y + 1.5);
        if (gh > -Infinity) sunk = Math.max(sunk, gh - y);
      }
      // the leg chains, against the pose they died in
      const legs1 = legPose(root);
      let legTurn = 0, legN = 0;
      for (const k of Object.keys(legs0)) {
        if (!legs1[k]) continue;
        legTurn += legs0[k].angleTo(legs1[k]);
        legN++;
      }
      trials.push({
        bearing: BEARINGS[b],
        alive: e.alive,
        settled: settledAt >= 0 ? +settledAt.toFixed(2) : null,
        tilt: +tilt.toFixed(1),
        upY: +upY.toFixed(2),
        offGround: gLow > -Infinity ? +(low - gLow).toFixed(3) : null,
        sunk: +sunk.toFixed(3),
        moved: +Math.hypot(root.position.x - pos0.x, root.position.z - pos0.z).toFixed(2),
        turned: +(peakTurn * 180 / Math.PI).toFixed(0),
        legTurn: legN ? +((legTurn / legN) * 180 / Math.PI).toFixed(0) : null,
        verts: verts.length,
      });

      // a portrait of the first corpse of each kind, at rest
      if (wantShots && b === 0) {
        const r = window.__renderer;
        const cam = p.cam.camera.clone();
        const c = new V3(sx, low, sz);
        const size = kind === 'broodmother' ? 5 : kind === 'spiderling' ? 2.2 : 3.4;
        cam.position.set(c.x + size * 0.9, c.y + size * 0.55, c.z + size * 0.9);
        cam.lookAt(c.x, c.y + size * 0.12, c.z);
        cam.aspect = 1;
        cam.fov = 50;
        cam.updateProjectionMatrix();
        const W = 640;
        r.setScissorTest(false);
        r.setViewport(0, 0, W, W);
        const hidden = [];
        for (const o of g.enemies) if (o !== e && o.char.root.visible) { o.char.root.visible = false; hidden.push(o); }
        for (const pl of g.players) if (pl.char?.root?.visible) { pl.char.root.visible = false; hidden.push(pl); }
        r.render(g.scene, cam);
        const canvas = r.domElement;
        const tmp = document.createElement('canvas');
        tmp.width = W; tmp.height = W;
        const dpr = r.getPixelRatio() || 1;
        tmp.getContext('2d').drawImage(canvas, 0, canvas.height - W * dpr, W * dpr, W * dpr, 0, 0, W, W);
        shots[kind] = tmp.toDataURL('image/png');
        for (const o of hidden) o.char.root.visible = true;
      }
      e.removeMe = true;
      run(0.2);
    }
    out[kind] = trials;
  }

  // ---- stood on its end, it does not stay there ----
  //
  // The exact pose the bug left bodies in: a krykna killed standing on its
  // nose or its tail, with no throw to help it over. A rounded body has its
  // weight as high as it can go there and must roll off onto its side.
  const onEnd = [];
  for (const pitch of [Math.PI / 2, -Math.PI / 2, Math.PI / 2 - 0.05]) {
    const spot = p.position.clone();
    spot.x -= 14;
    spot.z += 8 + onEnd.length * 5;
    const e = g.addReinforcement('krykna', spot);
    for (let t = 0; t < 15 && e.arrival; t += DT) g.update(DT, inputs);
    for (let i = 0; i < 80 && !(e.char.modelReady?.() ?? true); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    run(0.5);
    e.damage(9999, e.position.clone(), 0);
    // no throw at all: just the body, on its end, lifted clear of the sand
    e.velocity.set(0, 0, 0);
    const root = e.char.root;
    root.rotation.set(pitch, root.rotation.y, 0, 'YXZ');
    root.position.y += 1.2;
    root.updateMatrixWorld(true);
    const startTilt = Math.asin(Math.min(1, Math.abs(longAxis(root).y))) * 180 / Math.PI;
    for (let t = 0; t < 9 && !e.settled; t += DT) g.update(DT, inputs);
    const ax = longAxis(root);
    onEnd.push({
      start: +startTilt.toFixed(0),
      settled: !!e.settled,
      tilt: +(Math.asin(Math.min(1, Math.abs(ax.y))) * 180 / Math.PI).toFixed(1),
    });
    e.removeMe = true;
    run(0.2);
  }
  out.__onEnd = onEnd;
  window.__manual = false;
  return { out, shots };
}, { KINDS, BEARINGS, blank: blankInput(), wantShots: !!shotsDir });

if (shotsDir) {
  mkdirSync(shotsDir, { recursive: true });
  for (const [kind, url] of Object.entries(results.shots)) {
    const file = `${shotsDir}/${kind}.png`;
    writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`  shot ${file}`);
  }
}

const onEnd = results.out.__onEnd;
delete results.out.__onEnd;
console.log(`  stood on end: ${JSON.stringify(onEnd)}`);
check('a krykna dropped on its end rolls off it (long axis within 35° of horizontal)',
  onEnd.length > 0 && onEnd.every((t) => t.start > 60 && t.settled && t.tilt <= 35), onEnd);

for (const [kind, trials] of Object.entries(results.out)) {
  console.log(`  ${kind}:`);
  for (const t of trials) console.log(`    ${JSON.stringify(t)}`);
  check(`${kind} dies and comes to rest`, trials.every((t) => !t.alive && t.settled !== null),
    trials.map((t) => t.settled));
  // the whole complaint: never balanced on end
  check(`${kind} lies with its long axis within 35° of horizontal`,
    trials.every((t) => t.tilt <= 35), trials.map((t) => t.tilt));
  // On the ground: the lowest drawn vertex sits on the terrain, and nothing
  // goes far into it. A body draped over a dune crest has a little air under
  // its lowest point on one side, so the allowance is a hand's width.
  check(`${kind} rests on the ground (not floating)`,
    trials.every((t) => t.offGround !== null && t.offGround < 0.12), trials.map((t) => t.offGround));
  check(`${kind} is not sunk into the ground`,
    trials.every((t) => t.sunk < 0.2), trials.map((t) => t.sunk));
  // It tumbled: thrown clear by the hit and turned over by it.
  check(`${kind} is thrown by the killing hit`,
    trials.every((t) => t.moved > 0.3), trials.map((t) => t.moved));
  check(`${kind} tumbles (turns well over on the way down)`,
    trials.every((t) => t.turned >= 60), trials.map((t) => t.turned));
  check(`${kind}'s legs go limp (leave the walk pose)`,
    trials.every((t) => t.legTurn === null || t.legTurn >= 15), trials.map((t) => t.legTurn));
}

if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
check('no page errors', h.errors.length === 0, h.errors.slice(0, 2));
await h.close();
check.done('creature death');
