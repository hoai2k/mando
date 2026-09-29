import * as THREE from 'three';
import { loadProp } from '../../characters/authored';
import type { SectionContext } from '../context';

/**
 * A sculpt with parts the game moves — a press head, a welding arm's joints,
 * a searchlight's lamp drum.
 *
 * The procedural stand-in is built to the reference sheet's proportions and
 * shows at once; its moving parts are the game's own meshes. When the model
 * lands the stand-in is hidden and `onNodes` is handed the model's named
 * nodes, so the section drives *those* instead of doubling them up. `metres`
 * converts a world distance into the node's local units (the sculpt is
 * scaled by one dimension on load), for anything the section translates.
 */
export interface DrivenNode {
  node: THREE.Object3D;
  /** the node's own rest pose, to drive relative to */
  rest: { position: THREE.Vector3; rotation: THREE.Euler };
  /** local units per world metre along the node's parent's axes */
  metres: number;
}

export function drivenProp(ctx: SectionContext, id: string, at: THREE.Vector3, opts: {
  size: number;
  axis?: 'x' | 'y' | 'z' | 'longest';
  yaw?: number;
  /** everything procedural to hide when the model lands (the stand-in and its moving parts) */
  hide: THREE.Object3D[];
  /** node names to look for (matched case-insensitively) */
  nodes: string[];
  onNodes: (found: Record<string, DrivenNode | undefined>) => void;
}): THREE.Group {
  const want = opts.nodes.map((n) => n.toLowerCase());
  const holder = loadProp(id, opts.size, {
    axis: opts.axis ?? 'longest', ground: true,
    onLoad: (root) => {
      for (const o of opts.hide) o.visible = false;
      root.updateMatrixWorld(true);
      const found: Record<string, DrivenNode | undefined> = {};
      const s = new THREE.Vector3();
      root.traverse((o) => {
        const i = want.indexOf(o.name.toLowerCase());
        if (i < 0 || found[opts.nodes[i]]) return;
        (o.parent ?? o).getWorldScale(s);
        found[opts.nodes[i]] = {
          node: o,
          rest: { position: o.position.clone(), rotation: o.rotation.clone() },
          metres: 1 / Math.max(1e-6, s.y),
        };
      });
      opts.onNodes(found);
    },
  });
  holder.position.copy(at);
  holder.rotation.y = opts.yaw ?? 0;
  ctx.mesh(holder);
  return holder;
}
