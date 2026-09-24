/** A raised shield turns toward a forecast rear bolt before the camera follows. */
import { launch, blankInput, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
try {
  await h.startCoop(1, 'station');
  const result = await h.page.evaluate((base) => {
    const g = window.__game;
    const p = g.players[0];
    for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
    p.position.set(0, 0, -8);
    p.velocity.set(0, 0, 0);
    p.grounded = p.wasGrounded = true;
    p.facingYaw = p.cam.yaw = 0;
    p.energy = 1;
    const step = (n) => {
      for (let i = 0; i < n; i++) g.update(1 / 60, [{ ...base, blockHeld: true }, base, base, base]);
    };
    step(30);
    const hp = p.hp;
    let reflected = 0;
    const onDeflect = g.projectiles.onDeflect;
    g.projectiles.onDeflect = (...args) => { reflected++; onDeflect?.(...args); };
    const origin = p.position.clone();
    origin.z -= 12;
    origin.y += p.height * 0.58;
    g.projectiles.fire(origin, origin.clone().set(0, 0, 1), 36, 8, 1);
    step(1);
    const first = { body: p.facingYaw, camera: p.cam.yaw };
    step(15);
    const middle = { body: p.facingYaw, camera: p.cam.yaw };
    step(30);
    g.projectiles.onDeflect = onDeflect;
    return { first, middle, reflected, damage: hp - p.hp };
  }, blankInput());
  check('body begins the shield turn before the camera',
    Math.abs(result.first.body) > 0.2 && Math.abs(result.first.camera) < 0.05, result);
  check('camera follows and the rear bolt reflects',
    Math.abs(result.middle.camera) > 0.5 && result.reflected > 0 && result.damage === 0, result);
} finally {
  await h.close();
}
check.done('spin defense');
