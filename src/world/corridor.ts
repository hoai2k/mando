import * as THREE from 'three';
import { mat } from '../characters/builder';
import { authoredProp } from './props';
import type { PhysicsWorld, StaticBox } from '../core/physics';

/**
 * The frame's own dimensions, in its local frame — read by both the meshes
 * below and the colliders that back them, so the two cannot drift apart.
 *
 * The posts stand *inside* the wall's opening (a mission doorway is a 3.8 m
 * gap, and these sit at 1.35–1.85 m out from its middle), which is what makes
 * them the obvious thing to tuck behind in a firefight.
 */
const POST = { x: 1.6, w: 0.5, h: 3.6 };
/** the lintel, plus the light strip immediately under it, as one head piece */
const HEAD = { w: 3.7, d: 0.5, y0: 3.18, y1: 3.8 };
/**
 * The frame's clear opening — between the posts, under the head. It is what a
 * body actually walks through (the posts and head are solid), so it is also
 * what a door's leaves have to fill, and nothing more.
 */
export const DOOR_CLEAR = { w: 2 * (POST.x - POST.w / 2), h: HEAD.y0 };
/** how deep the collar round a frame runs: deeper than a leaf, so a retracted leaf is hidden in it */
const COLLAR_D = 0.7;

/**
 * A door: an emissive-trimmed frame around a lit pane, standing in a mission
 * gateway (world/mission.ts hangs its energy gates on these). The gate owns
 * the blocker across the opening and the campaign owns the flow; the frame
 * owns the posts and the head, which are solid.
 *
 * They were not, for as long as this file existed — it was written as pure
 * decoration and said so. But a doorway's posts are the cover a player
 * actually reaches for, and standing behind one stopped nothing: fire went
 * through the post, the wall's opening being 3.8 m of clear air with a
 * frame drawn inside it. If it is visible it is solid.
 *
 * `blast_door.glb` replaces the whole of it, pane included: the sculpt is a
 * closed door in its own frame with hazard striping and a status lamp, which is
 * what the pane and the emissive strip were standing in for. Finding the door
 * does not depend on either — the campaign's beacon sits on it and the HUD
 * names the distance.
 */
/**
 * @param opts.leaf  false = surround only, no door in it.
 *
 * A gate supplies its own leaves and slides them apart, so it wants the posts
 * and the lintel and nothing across the opening. The `blast_door` sculpt is
 * one mesh of a *shut* door — there is no separable panel in the file — so a
 * gate that used it could only ever look closed, whatever it was doing. Until
 * a re-export splits the leaves out, an animated door has to be built rather
 * than loaded (see docs/ASSETS_MODELS.md).
 */
/**
 * @param opts.opening  the hole the wall actually has cut for this doorway,
 *   width and height (metres, from the floor). A wall's opening is usually
 *   bigger than the frame — a transport door's face is cut 6.4 m wide and up
 *   to 8 m tall for a frame 3.7 m across and 3.8 m high — and whatever lies
 *   between the two was a see-through rim round the door: slits beside the
 *   posts and an open band over the head, into the pocket and the sky behind
 *   it. The collar fills it, solid, so the door is set flush into its wall.
 */
export function buildDoorFrame(parent: THREE.Object3D, pos: THREE.Vector3, yaw: number,
  opts: { leaf?: boolean; physics?: PhysicsWorld; opening?: { w: number; h: number } } = {}): { group: THREE.Group; solids: StaticBox[] } {
  const leaf = opts.leaf !== false;
  const g = new THREE.Group();
  g.position.copy(pos);
  g.rotation.y = yaw;
  const frame = mat(0x3a3e46, { rough: 0.6, metal: 0.5 });
  const glowM = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  const post = new THREE.BoxGeometry(POST.w, POST.h, POST.w);
  // The frame is turned to the doorway, so its members have to be placed in
  // the world by hand: colliders are axis-aligned and know nothing of the
  // group's rotation. A doorway always stands on a cardinal bearing, where a
  // square post keeps its footprint and the head simply swaps its two spans.
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const solids: StaticBox[] = [];
  const box = (lx: number, cy: number, sx: number, sy: number, sz: number): void => {
    if (!opts.physics) return;
    solids.push(opts.physics.addBox(
      pos.x + cos * lx, pos.y + cy, pos.z - sin * lx, sx, sy, sz));
  };
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(post, frame);
    p.position.set(side * POST.x, POST.h / 2, 0);
    g.add(p);
    box(side * POST.x, POST.h / 2, POST.w, POST.h, POST.w);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(HEAD.w, 0.5, HEAD.d), frame);
  lintel.position.y = 3.55;
  g.add(lintel);
  box(0, (HEAD.y0 + HEAD.y1) / 2,
    Math.abs(cos) * HEAD.w + Math.abs(sin) * HEAD.d, HEAD.y1 - HEAD.y0,
    Math.abs(sin) * HEAD.w + Math.abs(cos) * HEAD.d);
  if (leaf) {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 3.1), new THREE.MeshBasicMaterial({
      color: 0x63b4ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    glow.position.y = 1.75;
    g.add(glow);
  }
  // covered by the head collider above rather than carrying its own: it is a
  // light fixture, and one box for the whole head of the frame beats two
  const strip = new THREE.Mesh(new THREE.BoxGeometry(HEAD.w, 0.12, 0.12), glowM);
  strip.position.y = 3.24;
  g.add(strip);
  // ---- the collar: the wall's opening filled round the frame ----
  const outer = POST.x + POST.w / 2;
  if (opts.opening) {
    const { w: ow, h: oh } = opts.opening;
    // a hair past the cut on every side, so the collar meets the wall with no seam of sky
    const half = ow / 2 + 0.05;
    const piece = (x0: number, x1: number, y0: number, y1: number): void => {
      if (x1 - x0 < 0.02 || y1 - y0 < 0.02) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, COLLAR_D), frame);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      box((x0 + x1) / 2, (y0 + y1) / 2,
        Math.abs(cos) * (x1 - x0) + Math.abs(sin) * COLLAR_D, y1 - y0,
        Math.abs(sin) * (x1 - x0) + Math.abs(cos) * COLLAR_D);
    };
    const top = oh + 0.05;
    // beside the posts, floor to the top of the cut
    if (half > outer) { piece(outer, half, 0, top); piece(-half, -outer, 0, top); }
    // over the head, across the whole cut
    if (top > HEAD.y1) piece(-Math.max(half, outer), Math.max(half, outer), HEAD.y1, top);
  }
  // Everything built above is the stand-in. Quarter turn because this sculpt is
  // wide along its own Z where the frame is wide along X — without it the door
  // stands edge-on to everyone walking up to it.
  // the sculpt is the whole door; only a surround-less doorway can take it
  if (leaf) authoredProp(g, [...g.children], 'blast_door', 3.8, { axis: 'y', yaw: Math.PI / 2 });
  parent.add(g);
  return { group: g, solids };
}
