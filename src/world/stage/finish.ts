import * as THREE from 'three';
import { hazardAt } from '../board';
import { loadOptionalTexture } from '../../core/assets';
import { disposeSubtree } from '../../core/dispose';
import type { MissionZone } from '../mission';
import type { Portal } from './barriers';
import type { StageBuilder } from './builder';

/**
 * Validation: keep only spots a body actually fits in, now that every
 * collider on the stage is standing. Returns the party's starts.
 */
export function validateSpots(b: StageBuilder, zones: MissionZone[]): THREE.Vector3[] {
  const { board, defenders, groundAt } = b;

  // ---- validation: keep only spots a body actually fits in ----
  const fits = (p: THREE.Vector3): boolean => {
    if (!board.physics.capsuleFree(p.x, p.y, p.z, 0.6, 2.1)) return false;
    const hz = hazardAt(board, p);
    return !hz.kill && hz.dps <= 0;
  };
  for (const zone of zones) {
    zone.farVents = zone.farVents.filter(fits);
    zone.sideVents = zone.sideVents.filter(fits);
    zone.vents = [...zone.farVents, ...zone.sideVents];
    if (!zone.vents.length) zone.vents.push(zone.center.clone());
    zone.posts = zone.posts.filter(fits);
    if (!zone.posts.length) zone.posts.push(zone.center.clone());
    if (zone.runnerPost && !fits(zone.runnerPost)) zone.runnerPost = null;
    for (const h of zone.hatches) if (!fits(h.post)) h.post.copy(zone.center);
  }
  for (let i = 0; i < defenders.length; i++) defenders[i] = defenders[i].filter((d) => fits(d.pos));

  const startZone = zones[0];
  const starts = [[0.9, 0.9], [-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9]].map(([dx, dz]) => {
    const x = startZone.entry.x + dx, z = startZone.entry.z + dz;
    return new THREE.Vector3(x, groundAt(x, z) + 0.2, z);
  });
  return starts;
}

/** the stage's own water plane, where it has one; returns its height */
export function layWater(b: StageBuilder): number | undefined {
  const { stage, pal, owned, group, floorY } = b;

  // ---- the stage's own water, where it has one ----
  let waterY: number | undefined;
  if (stage.world?.waterDrop !== undefined) {
    waterY = floorY - stage.world.waterDrop;
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshStandardMaterial({
        color: pal.backdrop, roughness: 0.28, metalness: 0.1,
        transparent: true, opacity: 0.85,
      }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, waterY, 0);
    group.add(sea);
    owned.push(sea.material as THREE.Material);
    const seaMat = sea.material as THREE.MeshStandardMaterial;
    loadOptionalTexture('sea_surface', (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(60, 60);
      seaMat.map = tex;
      seaMat.color.set(0xffffff);
      seaMat.needsUpdate = true;
    }, { exts: ['jpg', 'png'] });
    loadOptionalTexture('sea_surface_normal', (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(60, 60);
      seaMat.normalMap = tex;
      seaMat.needsUpdate = true;
    }, { exts: ['png', 'jpg'] });
  }
  return waterY;
}

/** teardown: a stage swap has to give all of this back */
export function stageTeardown(b: StageBuilder, zones: MissionZone[],
  exitPortal: Portal | null, backPortal: Portal | null): () => void {
  const { board, worldHeightAt, owned, group, boxes, cylinders, hazards, breakables } = b;

  // ---- teardown: a stage swap has to give all of this back ----
  const dispose = (): void => {
    b.retired = true;
    board.physics.heightAt = worldHeightAt;
    board.group.remove(group);
    // `disposeSubtree`, not a hand-rolled traverse: a stage is full of authored
    // sculpts, and a loaded .glb is cached once and *cloned* per instance, so
    // a clone shares its original's geometries and textures. Disposing those by
    // hand would free art every future instance of that prop still needs —
    // which is exactly the kind of thing that shows up three stage swaps later
    // as a renderer that has run out of memory. The shared ones are tagged;
    // this is what respects the tag.
    disposeSubtree(group);
    for (const r of owned) r.dispose();
    const phys = board.physics;
    // A barrier's blocker comes and goes with its animation, so it may be
    // standing in the world right now under a reference nothing else holds:
    // retire them before the recorded lists are swept.
    for (const p of [exitPortal, backPortal]) p?.retire();
    for (const z of zones) {
      for (const b of [z.entryBarrier, z.exitBarrier]) b?.retire();
      for (const h of z.hatches) h.gate.retire();
    }
    const boxSet = new Set(boxes);
    const cylSet = new Set(cylinders);
    phys.boxes = phys.boxes.filter((b) => !boxSet.has(b));
    phys.cylinders = phys.cylinders.filter((c) => !cylSet.has(c));
    if (board.hazards) board.hazards = board.hazards.filter((h) => !hazards.includes(h));
    if (board.breakables) {
      const meshes = breakables.map((b) => b.mesh);
      board.breakables = board.breakables.filter((b) => !meshes.includes(b.mesh));
    }
  };
  return dispose;
}
