/** A low overhead prop lets a humanoid duck and walk beneath it. */
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
    p.cam.yaw = p.facingYaw = 0;
    const roof = g.board.physics.addBox(0, 1.5, -4.5, 4, 0.4, 3);
    let ducked = false;
    let movedUnder = false;
    let duckPose = false;
    for (let i = 0; i < 220; i++) {
      p.update(1 / 60, { ...base, moveY: 1 }, g);
      ducked ||= p.autoCrouching;
      movedUnder ||= p.position.z > -4.8;
      duckPose ||= p.char.animator.playing('lower') === 'crouchWalkLower';
    }
    const out = { ducked, movedUnder, duckPose, z: p.position.z, stoodUp: !p.autoCrouching };
    g.board.physics.boxes.splice(g.board.physics.boxes.indexOf(roof), 1);
    return out;
  }, blankInput());
  check('player ducks beneath low overhead geometry', result.ducked && result.duckPose, result);
  check('player passes through and stands again', result.movedUnder && result.stoodUp && result.z > -1, result);
} finally {
  await h.close();
}
check.done('low passage');
