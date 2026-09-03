import { TEXT } from '../text';
import * as THREE from 'three';
import type { Game } from './game';
import { addBreakable, type Breakable } from '../world/board';
import { Enemy, ENEMY_NAME, type EnemyKind } from '../enemies/enemy';
import { audio } from '../core/audio';

/**
 * The covert's supply cache (the ally crate): a glowing crate dropped on the
 * old ally-milestone waves. It sits on the field as a breakable — a couple of
 * bolts, a couple of swings, a rocket or a ground slam spring it — and on
 * opening its side panels blow
 * outward and fall away, revealing a squad of allies who walk out and fight
 * beside the players for the rest of the wave. This replaces the single ally
 * who used to walk in from the covert on those waves: the backup is bigger,
 * but it has to be earned with an action and it does not stay.
 */

/** how many allies a cache holds */
export const CRATE_ALLY_COUNT = 5;

/**
 * What it takes to spring the cache. A Mandalorian's bolt is 34 and a swing is
 * 32, so this is two of either — near enough that no build is the one that
 * cannot open it, far enough that a stray bolt from a firefight does not.
 */
export const CRATE_HP = 60;

/** crate footprint (m) — wide enough to read as holding a squad */
const W = 2.6;
const H = 2.3;
const PANEL_T = 0.12;

interface Panel {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  /** per-axis tumble, rad/s */
  spin: THREE.Vector3;
}

export class AllyCrate {
  /** everything the crate adds to the scene, removed when it retires */
  private group = new THREE.Group();
  private panels: Panel[] = [];
  private glow: THREE.Mesh;
  private glowMat: THREE.MeshBasicMaterial;
  private beaconMat: THREE.MeshBasicMaterial;
  private breakable: Breakable;
  private panelMat: THREE.MeshStandardMaterial;
  pos: THREE.Vector3;
  opened = false;
  /** the squad that came out, so the wave's end can call them home */
  allies: Enemy[] = [];
  private openT = 0;

  /**
   * `near` is where the party stands; the crate lands a stone's throw off on
   * a random bearing. A mission passes `at` instead — the room's own floor,
   * where a random bearing would as often as not be the far side of a wall.
   */
  constructor(private game: Game, public kind: EnemyKind, near: THREE.Vector3, at?: THREE.Vector3) {
    const board = game.board;
    // a clear patch of ground a stone's throw from where the party stands —
    // judged with a big body so the crate never wedges into a doorway
    const a = Math.random() * Math.PI * 2;
    const want = at?.clone() ?? near.clone().add(new THREE.Vector3(Math.cos(a) * 14, 0.2, Math.sin(a) * 14));
    this.pos = game.groundSpot(want, 'enforcer');
    this.group.position.copy(this.pos);
    board.group.add(this.group);

    this.panelMat = new THREE.MeshStandardMaterial({
      color: 0x4a5258, roughness: 0.55, metalness: 0.6, emissive: 0x0e2a38,
    });
    const seamMat = new THREE.MeshBasicMaterial({
      color: 0x63d0ff, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    // base stays put; four walls and a lid are the panels that fall away
    const base = new THREE.Mesh(new THREE.BoxGeometry(W, PANEL_T, W), this.panelMat);
    base.position.y = PANEL_T / 2;
    this.group.add(base);
    const wall = new THREE.BoxGeometry(W, H, PANEL_T);
    for (let i = 0; i < 4; i++) {
      const yaw = (i * Math.PI) / 2;
      const out = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const m = new THREE.Mesh(wall, this.panelMat);
      m.position.copy(out).multiplyScalar((W - PANEL_T) / 2).setY(H / 2 + PANEL_T);
      m.rotation.y = yaw;
      this.group.add(m);
      // the fall is scripted on open: out and up, then gravity and a tumble
      this.panels.push({
        mesh: m,
        vel: out.clone().multiplyScalar(3.5 + Math.random()).setY(2.2),
        spin: new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, 2.5 + Math.random()),
      });
    }
    const lid = new THREE.Mesh(new THREE.BoxGeometry(W, PANEL_T, W), this.panelMat);
    lid.position.y = H + PANEL_T * 1.5;
    this.group.add(lid);
    this.panels.push({
      mesh: lid,
      vel: new THREE.Vector3((Math.random() - 0.5) * 2, 5.5, (Math.random() - 0.5) * 2),
      spin: new THREE.Vector3(2 + Math.random() * 2, 1, 2 + Math.random() * 2),
    });

    // the glow: a light-leak core between the seams, pulsing so it reads as
    // "this one is special" from across the board, plus a soft beacon shaft
    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0x63d0ff, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.glow = new THREE.Mesh(new THREE.BoxGeometry(W * 1.02, H * 1.02, W * 1.02), this.glowMat);
    this.glow.position.y = H / 2 + PANEL_T;
    this.group.add(this.glow);
    this.beaconMat = seamMat;
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 26, 10, 1, true), this.beaconMat);
    beacon.position.y = H + 13;
    beacon.frustumCulled = false;
    this.group.add(beacon);

    // The crate blocks movement and takes hits like any prop until it opens.
    // Its hit points are set so that any way a player has of dealing damage
    // opens it in about two goes — two bolts, two swings — rather than the one
    // point it used to carry, which only a bolt was ever going to spend.
    const box = board.physics.addBox(this.pos.x, this.pos.y + (H + PANEL_T) / 2, this.pos.z, W, H + PANEL_T, W);
    this.breakable = addBreakable(board, this.glow, box, CRATE_HP, {
      radius: W * 0.8,
      onBreak: (g) => this.open(g),
    });
  }

  /** Spring the cache: panels blow outward, the squad walks out. */
  open(game: Game): void {
    if (this.opened) return;
    this.opened = true;
    // opened by hand (tests, future triggers) rather than through a hit:
    // retire the breakable exactly as a break would — no second "break" from
    // a later bolt, and the collision box goes with the walls
    this.breakable.broken = true;
    const boxes = game.board.physics.boxes;
    const bi = boxes.indexOf(this.breakable.box);
    if (bi >= 0) boxes.splice(bi, 1);
    this.glow.visible = false;
    this.beaconMat.opacity = 0;
    game.particles.dustPuff(this.pos, 14);
    audio.uiConfirm();

    for (let i = 0; i < CRATE_ALLY_COUNT; i++) {
      const a = (i / CRATE_ALLY_COUNT) * Math.PI * 2;
      const want = this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 2.2, 0.2, Math.sin(a) * 2.2));
      const at = game.groundSpot(want, this.kind);
      const ally = new Enemy(this.kind, at, 0);
      this.allies.push(ally);
      game.addAlly(ally, 8);
    }
    game.announce(TEXT.banners.reinforcements, TEXT.banners.reinforcementsSub(ENEMY_NAME[this.kind], CRATE_ALLY_COUNT));
  }

  update(dt: number): void {
    if (!this.opened) {
      // breathe: the pulse is what says "shoot me" without a tutorial
      const pulse = 0.45 + 0.25 * Math.sin(this.game.time * 3.4);
      this.glowMat.opacity = pulse;
      this.beaconMat.opacity = 0.25 + 0.2 * Math.sin(this.game.time * 3.4);
      this.panelMat.emissiveIntensity = 0.6 + 0.5 * Math.sin(this.game.time * 3.4);
      return;
    }
    // panels tumble out and away, then sink through the ground and vanish
    this.openT += dt;
    for (const panel of this.panels) {
      panel.vel.y -= 12 * dt;
      panel.mesh.position.addScaledVector(panel.vel, dt);
      panel.mesh.rotation.x += panel.spin.x * dt;
      panel.mesh.rotation.y += panel.spin.y * dt;
      panel.mesh.rotation.z += panel.spin.z * dt;
    }
    if (this.openT > 2.2) {
      for (const panel of this.panels) panel.mesh.visible = false;
    }
  }

  /**
   * The wave is decided: the squad melts back into the covert and the crate
   * leaves the field (unopened, the chance simply passes). Corpse cleanup is
   * the wave's own business — only the living leave through here.
   */
  retire(game: Game): void {
    for (const ally of this.allies) {
      if (!ally.alive) continue;
      game.particles.dustPuff(ally.position, 10);
      ally.removeMe = true;
    }
    if (!this.opened) {
      // the collision box goes with the crate, exactly as a break would take it
      this.breakable.broken = true;
      const boxes = game.board.physics.boxes;
      const bi = boxes.indexOf(this.breakable.box);
      if (bi >= 0) boxes.splice(bi, 1);
    }
    game.board.group.remove(this.group);
  }
}
