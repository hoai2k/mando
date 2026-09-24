/** Spice Run station entrance, deck gravity and traversable ship collision. */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
try {
  await h.page.evaluate(() => {
    window.__manual = false;
    window.__quitToTitle?.();
    window.__startMode('campaign', 1, 'station', ['din']);
  });
  await h.page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
  await h.page.waitForFunction(() => {
    let ship = null;
    window.__game.board.group.traverse((o) => { if (o.userData?.prop === 'freighter') ship = o; });
    return !!ship && ship.children.length > 0;
  }, null, { timeout: 30000 });
  await h.page.waitForFunction(() => {
    let frigate = null;
    window.__game.board.group.traverse((o) => {
      if (o.userData?.skyTraffic === 'spice_run_frigate') frigate = o;
    });
    return !!frigate && frigate.getObjectByName('spice_run_frigate')?.children.length > 0;
  }, null, { timeout: 30000 });

  const result = await h.page.evaluate(() => {
    const g = window.__game;
    const portal = g.campaign.stage.exitPortal;
    const { x: dx, z: dz } = portal.forward;
    const point = (depth, side, rise) => ({
      x: portal.pos.x + dx * depth - dz * side,
      y: portal.pos.y + rise,
      z: portal.pos.z + dz * depth + dx * side,
    });
    const inside = ({ x, y, z }) => g.board.physics.boxes.some((b) =>
      x >= b.min.x && x <= b.max.x && y >= b.min.y && y <= b.max.y && z >= b.min.z && z <= b.max.z);
    let ship = null;
    g.board.group.traverse((o) => { if (o.userData?.prop === 'freighter') ship = o; });
    let frigate = null;
    g.board.group.traverse((o) => {
      if (o.userData?.skyTraffic === 'spice_run_frigate') frigate = o;
    });
    const shipBoxes = ship ? g.board.physics.boxes.filter((b) =>
      b.max.x >= ship.position.x - 7 && b.min.x <= ship.position.x + 7
      && b.max.z >= ship.position.z - 7 && b.min.z <= ship.position.z + 7
      && b.max.y > ship.position.y + 0.3 && b.min.y < ship.position.y + 12) : [];
    const standInCylinders = ship ? g.board.physics.cylinders.filter((c) =>
      Math.hypot(c.x - ship.position.x, c.z - ship.position.z) < 1) : [];
    let lowGaps = 0;
    if (ship) for (const rise of [0, 0.4, 0.8]) {
      for (let x = -6; x <= 6; x += 0.4) for (let z = -6; z <= 6; z += 0.4) {
        const px = ship.position.x + x, py = ship.position.y + rise, pz = ship.position.z + z;
        if (!g.board.physics.capsuleFree(px, py, pz, 0.42, 1.75)
          && g.board.physics.capsuleFree(px, py, pz, 0.42, 1.19)) lowGaps++;
      }
    }
    return {
      wall: [12, 30, 60].every((side) => inside(point(-1, side, 3)) && inside(point(-1, -side, 3))),
      above: inside(point(-1, 0, 30)),
      door: inside(point(0, 0, 3)),
      pocket: !inside(point(2, 0, 3)),
      overCeiling: inside(point(-1, 0, g.ceilingY - portal.pos.y + 2)),
      highGravity: g.board.gravityAt(portal.pos.x - dx * 5, portal.pos.y + 40, portal.pos.z - dz * 5),
      voidGravity: g.board.gravityAt(300, 130, 300),
      shipLoaded: !!ship && ship.children.length > 0,
      shipColliderCount: shipBoxes.length,
      standInCylinders: standInCylinders.length,
      lowGaps,
      frigateLoaded: !!frigate?.getObjectByName('spice_run_frigate')?.children.length,
      frigateFallbackHidden: frigate?.children[0]?.visible === false,
      frigatePrefetched: window.__propsUsed().includes('spice_run_frigate')
        && window.__boardProps().station.includes('spice_run_frigate'),
    };
  });
  check('a broad station hull closes both sides of the door', result.wall, result);
  check('hull closes the flight path above the door', result.above && result.overCeiling, result);
  check('the closed door blocks entry and the pocket remains walkable', result.door && result.pocket, result);
  check('gravity pulls down over a deck at flight height and nowhere in empty space',
    result.highGravity > 0.4 && result.voidGravity === 0, result);
  check('the freighter has fitted colliders in place of its solid stand-in',
    result.shipLoaded && result.shipColliderCount > 3 && result.shipColliderCount < 220
      && result.standInCylinders === 0, result);
  check('the freighter retains duckable space beneath its fitted hull', result.lowGaps > 20, result);
  check('the authored frigate replaces the distant traffic silhouette',
    result.frigateLoaded && result.frigateFallbackHidden && result.frigatePrefetched, result);
} finally {
  await h.close();
}
check.done('Spice Run');
