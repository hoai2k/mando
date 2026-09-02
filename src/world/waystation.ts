import * as THREE from 'three';
import { PhysicsWorld } from '../core/physics';
import { makeRng } from '../core/math';
import { crateTexture, deckTexture, hullTexture, loadOptionalTexture } from '../core/assets';
import { spaceSky } from './sky';
import { Mover, type Board } from './board';
import { authoredProp } from './props';
import { addSkyTraffic } from './traffic';
import { audio } from '../core/audio';

/**
 * Board 2 — "The Spice Run" waystation: a constellation of floating platforms
 * and gantries around a central refinery spire. The jetpack is the only road.
 */

interface Plat { x: number; y: number; z: number; w: number; d: number; }

/**
 * The station's gravity field: this board is a vacuum, not a planet, and the
 * only reason it has a down at all is that there are decks to land on.
 * `DRIFT_GRAVITY` is what acts on you anywhere with nothing beneath
 * you: barely enough to give the scene an up. `PAD_GRAVITY` is what acts
 * directly over a deck, unchanged from the flat 0.45 the board used to run, so
 * fighting on a platform feels exactly as it did. Between `GRAV_FULL` and
 * `GRAV_REACH` metres above a surface the two blend.
 */
const DRIFT_GRAVITY = 0.05;
const PAD_GRAVITY = 0.45;
const GRAV_FULL = 5;
const GRAV_REACH = 18;

export function buildWaystation(): Board {
  const group = new THREE.Group();
  const physics = new PhysicsWorld();
  physics.heightAt = null;
  physics.killY = -55;
  const rng = makeRng(66);

  const proceduralSky = spaceSky();
  group.add(proceduralSky);

  // lighting: cold key + warm sodium fill + dim ambient
  const key = new THREE.DirectionalLight(0xbdd4ff, 1.7);
  key.position.set(-70, 90, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -90;
  key.shadow.camera.right = key.shadow.camera.top = 90;
  key.shadow.camera.far = 300;
  key.shadow.bias = -0.0008;
  group.add(key);
  const sodium = new THREE.DirectionalLight(0xffb45e, 1.15);
  sodium.position.set(60, 30, -50);
  group.add(sodium);
  group.add(new THREE.HemisphereLight(0x4a5270, 0x1c1e28, 1.5));
  const padLight = new THREE.PointLight(0xffc98a, 60, 45);
  padLight.position.set(0, 9, -4);
  group.add(padLight);

  const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.7, metalness: 0.45 });
  const hullMat = new THREE.MeshStandardMaterial({ map: hullTexture(), roughness: 0.6, metalness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.7, metalness: 0.4 });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.8 });

  const platforms: Plat[] = [
    { x: 0, y: 0, z: 0, w: 30, d: 30 },        // main pad
    { x: 42, y: 6, z: 8, w: 16, d: 14 },
    { x: -38, y: 4, z: -16, w: 18, d: 12 },
    { x: 22, y: 12, z: -38, w: 14, d: 14 },
    { x: -18, y: 14, z: 42, w: 16, d: 12 },
    { x: 52, y: 20, z: -18, w: 12, d: 10 },
    { x: -52, y: 18, z: 20, w: 12, d: 12 },
    { x: 0, y: 26, z: -58, w: 14, d: 10 },
    { x: 8, y: 24, z: 60, w: 12, d: 10 },
    { x: -60, y: 30, z: -40, w: 10, d: 10 },
    { x: 62, y: 34, z: 30, w: 10, d: 10 },
    { x: 0, y: 40, z: 8, w: 12, d: 12 },       // crow's nest above spire base
  ];

  // Props that repeat share one geometry apiece. Eleven identical crate boxes
  // and twenty-eight identical posts each used to allocate their own buffers,
  // which is both memory and a missed chance for the renderer to batch them.
  const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.2, 5);
  const crateGeo = new THREE.BoxGeometry(2.6, 2.6, 2.6);
  const winGeo = new THREE.PlaneGeometry(0.7, 0.5);
  const mastGeo = new THREE.BoxGeometry(1.4, 18, 1.4);
  const armGeo = new THREE.BoxGeometry(20, 1.1, 1.1);
  const cableGeo = new THREE.CylinderGeometry(0.05, 0.05, 6, 4);
  const hookGeo = new THREE.BoxGeometry(2.4, 2.4, 2.4);
  const beaconGeo = new THREE.SphereGeometry(0.16, 6, 5);

  for (const p of platforms) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(p.w, 1.2, p.d), deckMat);
    deck.position.set(p.x, p.y - 0.6, p.z);
    deck.castShadow = deck.receiveShadow = true;
    group.add(deck);
    // underside greeble + rim lights
    const under = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.6, 2.2, p.d * 0.6), darkMat);
    under.position.set(p.x, p.y - 2.2, p.z);
    group.add(under);
    physics.addBox(p.x, p.y - 0.6, p.z, p.w, 1.2, p.d);
    // The machinery slung under each deck is the one part of a platform you
    // meet from below, and the jetpack puts you there constantly — without its
    // own collider a platform had a solid top and a hollow belly.
    physics.addBox(p.x, p.y - 2.2, p.z, p.w * 0.6, 2.2, p.d * 0.6);
    // guard posts on corners of bigger platforms
    if (p.w >= 14) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const post = new THREE.Mesh(postGeo, darkMat);
        post.position.set(p.x + sx * (p.w / 2 - 0.4), p.y + 0.6, p.z + sz * (p.d / 2 - 0.4));
        group.add(post);
      }
    }
  }

  // central refinery spire
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7.5, 60, 12), hullMat);
  spire.position.set(0, 8, 8);
  spire.castShadow = spire.receiveShadow = true;
  group.add(spire);
  // A cylinder, not a box: the spire is round, so a 12 m square collider left
  // flat sides you sank into near the base (bottom radius 7.5 vs a 6 m half
  // width) and invisible walls at the corners (8.5 m out). addCylinder exists
  // for exactly this — see the mesa note in tatooine.ts.
  physics.addCylinder(0, 8, 8, 6.5, 60);
  // glowing windows band
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffc76a });
  for (let i = 0; i < 14; i++) {
    const w = new THREE.Mesh(winGeo, winMat);
    const a = rng() * Math.PI * 2, wy = -6 + rng() * 40;
    const r = 5.6 + (7.5 - 5.5) * (0.5 - wy / 120);
    w.position.set(Math.cos(a) * r, 8 + wy, 8 + Math.sin(a) * r);
    w.lookAt(w.position.x * 2, w.position.y, 8 + (w.position.z - 8) * 2);
    group.add(w);
  }
  // antenna crown
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 12, 6), darkMat);
  antenna.position.set(0, 44, 8);
  group.add(antenna);

  // cargo cranes reaching over platforms
  for (const [cx, cy, cz, rot] of [[26, 10, -20, 0.7], [-30, 12, 20, -1.9], [40, 26, 10, 2.4]] as const) {
    const crane = new THREE.Group();
    const mast = new THREE.Mesh(mastGeo, darkMat);
    mast.position.y = 9;
    crane.add(mast);
    const arm = new THREE.Mesh(armGeo, darkMat);
    arm.position.set(7, 17, 0);
    crane.add(arm);
    const cable = new THREE.Mesh(cableGeo, darkMat);
    cable.position.set(14, 13.5, 0);
    crane.add(cable);
    const hook = new THREE.Mesh(hookGeo, crateMat);
    hook.position.set(14, 9.5, 0);
    crane.add(hook);
    crane.position.set(cx, cy - 10, cz);
    crane.rotation.y = rot;
    crane.traverse((o) => { o.castShadow = true; });
    group.add(crane);
    // Cranes were pure scenery: an 18 m mast, a 20 m arm and a hanging
    // container you flew straight through, in the middle of the airspace this
    // board is fought in. These cylinders are the stand-in's shape — mast,
    // boom, hook — and they hold the crane up until the sculpt lands, at which
    // point the fit replaces them with the crane that is actually drawn: cab,
    // counterweight, slung container and all, every one of them landable.
    // Upright cylinders take the yaw for free — the arm becomes a row of them
    // along its own axis, the way the barge hull is done.
    const ax = Math.cos(rot), az = -Math.sin(rot);
    const stand = [physics.addCylinder(cx, cy - 1, cz, 0.85, 18)];        // mast
    // The arm runs local x −3..17. Step it closer than the collider is wide
    // or the beam is a row of stepping stones with holes between them.
    for (let t = -3; t <= 17.01; t += 1.5) {
      stand.push(physics.addCylinder(cx + ax * t, cy + 7, cz + az * t, 0.85, 1.1));
    }
    stand.push(physics.addCylinder(cx + ax * 14, cy - 0.5, cz + az * 14, 1.45, 2.4)); // hook
    // the cable stays intangible — 10 cm of wire is not something to bump into
    // The mast stands from the crane's own origin up to 18 m with the boom
    // across the top, so the sculpt is measured by height and grounded there.
    // Its boom runs down +X to match the procedural arm the colliders follow.
    authoredProp(crane, [mast, arm, cable, hook], 'cargo_crane', 19, { axis: 'y', yaw: Math.PI / 2 },
      { physics, replace: stand, cell: 0.85, maxBoxes: 26 });
  }

  // spice container stacks on the main pad (cover)
  const cratePositions: [number, number, number][] = [
    [-8, 0, -6], [-8, 0, -3.4], [-6.5, 2.6, -5], [6, 0, 7], [8.7, 0, 7], [7.3, 2.6, 7],
    [10, 0, -8], [-4, 0, 10], [44, 6, 5], [-40, 4, -14], [22, 12, -34],
  ];
  for (const [cx, cy, cz] of cratePositions) {
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.set(cx, cy + 1.3, cz);
    crate.rotation.y = rng() * 0.6;
    crate.castShadow = crate.receiveShadow = true;
    group.add(crate);
    const box = physics.addBox(cx, cy + 1.3, cz, 2.6, 2.6, 2.6);
    // grounded at the crate's base, so the sculpt fills the box it is standing in
    authoredProp(group, crate, 'cargo_crate', 2.6, { x: cx, y: cy, z: cz, yaw: crate.rotation.y },
      { physics, replace: [box], maxBoxes: 4 });
  }

  // fuel barrels clustered around the pads (cover + set dressing)
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x6a6a6e, roughness: 0.7, metalness: 0.4 });
  loadOptionalTexture('barrel', (tex) => {
    tex.wrapS = THREE.RepeatWrapping;
    barrelMat.map = tex;
    barrelMat.color.setHex(0xffffff);
    barrelMat.needsUpdate = true;
  });
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.5, 14);
  for (const [bx, by, bz] of [
    [12.5, 0, 3], [13.6, 0, 4.2], [12.2, 0, 5.1],
    [-11, 0, -9], [-12.2, 0, -10.2],
    [45, 6, 10], [-36, 4, -19], [24, 12, -33],
  ] as const) {
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(bx, by + 0.75, bz);
    barrel.rotation.y = rng() * Math.PI;
    barrel.castShadow = barrel.receiveShadow = true;
    group.add(barrel);
    const box = physics.addBox(bx, by + 0.75, bz, 1.1, 1.5, 1.1);
    authoredProp(group, barrel, 'fuel_barrel', 1.5, { x: bx, y: by, z: bz, axis: 'y', yaw: barrel.rotation.y },
      { physics, replace: [box], maxBoxes: 3 });
  }

  // freighter hull, built twice: once parked on its pad, once as the working
  // ship that flies the landing cycle on the north-east pad
  const makeFreighter = (): THREE.Group => {
    const f = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 9, 8), hullMat);
    body.rotation.z = Math.PI / 2;
    body.position.y = 2.2;
    f.add(body);
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), darkMat);
    cockpit.position.set(4.6, 2.4, 0);
    f.add(cockpit);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.35, 3.2), hullMat);
      wing.position.set(-1, 1.6, s * 3);
      f.add(wing);
    }
    f.traverse((o) => { o.castShadow = true; });
    return f;
  };

  // parked freighter on a landing pad
  const ship = makeFreighter();
  ship.position.set(-38, 4, -16);
  group.add(ship);
  // The procedural ship lies nose-out along +X, which is where its colliders
  // are; the sculpt is built along +Z like every other prop, so it takes a
  // quarter turn to point down the same axis.
  // Sized to the sculpt rather than the box that fitted the procedural stand-in:
  // measured in place the ship is 11 m nose to tail and 10 m across the wings,
  // where the old 8x6 left both wingtips as something you walked through. The
  // pad is 18x12, so it still parks with room around it.
  //
  // A single box around a hull is still a lie you can feel — walking the spine
  // of the ship you stand on a lid stretched over the whole silhouette, wings
  // and canopy included. Once the sculpt lands the fit follows the hull
  // instead, and the box and blister below are only what holds the ship up
  // until then.
  const hullBox = physics.addBox(-38, 6, -16, 11, 4, 10);
  // the cockpit blister sits 2 m proud of the hull box, out over the pad edge
  const blister = physics.addCylinder(-33.4, 6.4, -16, 1.5, 3.2);
  authoredProp(ship, ship.children.slice(), 'freighter', 11, { axis: 'z', yaw: Math.PI / 2 },
    { physics, replace: [hullBox, blister], cell: 0.55, maxBoxes: 22 });

  // ---- the working landing pad (PLAN.md §16.2) ----
  // The x8 z60 outrigger is a live pad: on a ~100 s cycle a freighter comes
  // down on thruster wash, sits about twenty seconds under the pad beacons,
  // and lifts away. The hull rides a Mover, so it is real ground — land on
  // the roof and ride the takeoff for free altitude. It never crushes: any
  // body under the descending hull is shoved clear, no damage. Touchdown is
  // loud on purpose (director.noise) — cover for a loud approach.
  const PAD = { x: 8, y: 24, z: 60 };
  const CRUISE = 60;             // metres above the pad when away
  const visitor = makeFreighter();
  visitor.position.set(PAD.x, PAD.y + CRUISE, PAD.z);
  group.add(visitor);
  const visitorBox = physics.addBox(PAD.x, PAD.y + CRUISE + 2, PAD.z, 11, 4, 10);
  const visitorMover = new Mover(visitorBox, visitor);
  // The working ship gets the same treatment as the parked one, and its fitted
  // hull rides the mover: the envelope box keeps deciding who is standing on
  // the ship (and so gets carried by it), while the hull the fit found is what
  // you actually walk on.
  authoredProp(visitor, visitor.children.slice(), 'freighter', 11, { axis: 'z', yaw: Math.PI / 2 },
    {
      physics,
      replace: [visitorBox],
      cell: 0.55,
      maxBoxes: 22,
      onFit: (boxes) => visitorMover.carry(boxes),
    });
  // thruster wash: two glow planes under the hull, shown only while moving
  const washMat = new THREE.MeshBasicMaterial({ color: 0x9ac8ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  for (const sx of [-2.2, 2.2]) {
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.4), washMat);
    wash.position.set(sx, -1.4, 0);
    wash.rotation.x = Math.PI / 2;
    wash.userData.decor = true;
    visitor.add(wash);
  }
  /** the cycle: 0 away → descend → sit → climb → away; phase in seconds */
  const LANDING_PERIOD = 100;
  let landedAnnounced = false;
  let liftAnnounced = false;

  // ---- sky traffic (PLAN.md §16.1) ----
  const trafficUpdate = addSkyTraffic(group, [
    { center: new THREE.Vector3(0, 90, 0), rx: 300, rz: 260, speed: 0.016, phase: 0.4, scale: 4 },
    { center: new THREE.Vector3(40, 140, -60), rx: 380, rz: 340, speed: 0.011, phase: 2.6, scale: 6 },
    { center: new THREE.Vector3(-30, 55, 30), rx: 240, rz: 200, speed: 0.02, phase: 4.5, scale: 3, rumble: true },
  ]);

  // neon cantina sign + hazard beacons (animated)
  const neonMat = new THREE.MeshBasicMaterial({ color: 0x33ddc9, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  loadOptionalTexture('neon_sign', (tex) => {
    neonMat.map = tex;
    neonMat.color.setHex(0xffffff); // let the artwork supply the colour
    neonMat.needsUpdate = true;
  }, { exts: ['png'] }); // stays PNG: the glyphs sit on transparency
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.4), neonMat);
  neon.position.set(-4.4, 6, 8.2);
  neon.rotation.y = Math.PI;
  group.add(neon);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff4433 });
  const beacons: THREE.Mesh[] = [];
  for (const p of platforms) {
    if (p.w > 13) continue;
    const b = new THREE.Mesh(beaconGeo, beaconMat.clone());
    b.position.set(p.x + p.w / 2 - 0.5, p.y + 0.5, p.z + p.d / 2 - 0.5);
    group.add(b);
    beacons.push(b);
  }

  const plat = (i: number, dy = 0.4) => new THREE.Vector3(platforms[i].x, platforms[i].y + dy, platforms[i].z);

  return {
    group, physics, kind: 'station',
    name: 'The Spice Run',
    footstep: 'metal',
    ambience: { sample: 'amb_station', bed: 'hum' },
    music: 'station',
    // island platforms: shooters hold their spawn platform instead of chasing
    rangedLeash: true,
    background: new THREE.Color(0x05050e),
    skyFile: 'sky_space',
    // drifting between platforms should never feel like a death sentence
    gravity: 0.45,
    // Deep space pulls at almost nothing: out in the open you fly wherever you
    // point, and the pull only exists over something you could land on. It
    // comes up over a deck (or a crate, or a crane arm) and fades out again
    // within a few body-lengths of leaving it — enough to bring you down onto
    // a platform, never enough to drag you off one.
    gravityAt: (x, y, z) => {
      const top = physics.supportBelow(x, y, z, GRAV_REACH);
      if (top === -Infinity) return DRIFT_GRAVITY;
      const t = Math.min(1, Math.max(0, (GRAV_REACH - (y - top)) / (GRAV_REACH - GRAV_FULL)));
      return DRIFT_GRAVITY + (PAD_GRAVITY - DRIFT_GRAVITY) * t * t;
    },
    heroLight: 0.34,
    voidY: -3,
    voidGravity: 0.12,
    voidFallSpeed: 3.2,
    // the nebula is bright enough to silhouette the platforms against it
    skyIntensity: 0.62,
    proceduralSky,
    fog: null,
    playerStarts: [new THREE.Vector3(0, 0.5, -6), new THREE.Vector3(3, 0.5, -6)],
    // not plat(8): that is the working pad, and the freighter setting down
    // on it every hundred seconds shoves everything off the deck — a squad
    // posted there was bulldozed into the void, and the warlord's battle,
    // posted at the far side of the board, was staged on it
    groundSpawns: [plat(1), plat(2), plat(3), plat(4), plat(5), plat(6), plat(7), plat(0).add(new THREE.Vector3(10, 0, -10))],
    airSpawns: [
      new THREE.Vector3(20, 26, 20), new THREE.Vector3(-30, 30, 10), new THREE.Vector3(10, 36, -30),
      plat(9, 6), plat(10, 6), plat(11, 8),
    ],
    movers: [visitorMover],
    update: (dt, time, game) => {
      const blink = (Math.sin(time * 4) + 1) / 2;
      for (const b of beacons) (b.material as THREE.MeshBasicMaterial).color.setRGB(0.4 + blink * 0.6, 0.12, 0.1);
      (neon.material as THREE.MeshBasicMaterial).opacity = 0.72 + Math.sin(time * 11) * 0.08 + (Math.sin(time * 1.7) > 0.92 ? -0.4 : 0);

      trafficUpdate(time, game);

      // ---- the landing cycle ----
      // Height over the phase: away → an eased descent (t 8..20), twenty
      // seconds parked (20..40), an eased climb (40..52), then away again.
      const t = time % LANDING_PERIOD;
      const ease = (k: number): number => k * k * (3 - 2 * k);
      let h = CRUISE;
      let moving = 0;
      if (t >= 8 && t < 20) { h = CRUISE * (1 - ease((t - 8) / 12)); moving = 1; }
      else if (t >= 20 && t < 40) { h = 0; }
      else if (t >= 40 && t < 52) { h = CRUISE * ease((t - 40) / 12); moving = 1; }
      // the hull box's centre sits 2 m above the deck line (a 4 m tall box
      // whose underside is the landing gear); park it so the roof is standable
      visitorMover.moveTo(PAD.x, PAD.y + 4 + h, PAD.z);
      washMat.opacity = moving * (0.35 + Math.sin(time * 31) * 0.12);

      // touchdown and liftoff each announce themselves once per cycle
      if (t >= 20 && t < 40 && !landedAnnounced) {
        landedAnnounced = true;
        liftAnnounced = false;
        const p = game?.players[0];
        const dist = p ? p.position.distanceTo(new THREE.Vector3(PAD.x, PAD.y, PAD.z)) : 200;
        audio.shipLanding(Math.max(0.06, Math.min(0.7, 40 / Math.max(dist, 10))));
        game?.director.noise(game, new THREE.Vector3(PAD.x, PAD.y, PAD.z), 45);
      } else if (t >= 40 && !liftAnnounced) {
        liftAnnounced = true;
        const p = game?.players[0];
        const dist = p ? p.position.distanceTo(new THREE.Vector3(PAD.x, PAD.y, PAD.z)) : 200;
        audio.shipLanding(Math.max(0.05, Math.min(0.5, 30 / Math.max(dist, 10))));
      } else if (t < 8) {
        landedAnnounced = false;
      }

      // never crush: while the hull is coming down, anything under it is
      // shoved off the footprint — a push, not a hit
      if (moving && h < 8 && game) {
        const bodies = [...game.players, ...game.enemies];
        for (const b of bodies) {
          if (!b.alive) continue;
          const dx = b.position.x - PAD.x, dz = b.position.z - PAD.z;
          if (Math.abs(dx) > 6.5 || Math.abs(dz) > 6 || Math.abs(b.position.y - PAD.y) > 6) continue;
          const push = Math.max(Math.abs(dx), 0.5);
          b.velocity.x += (dx / push) * 12 * dt * 8;
          b.velocity.z += (dz === 0 ? 1 : Math.sign(dz)) * 10 * dt * 8;
        }
      }
    },
  };
}
