import type { Game } from '../game/game';
import type { Player } from '../player/player';
import { yawBasis } from '../core/math';

/**
 * Motion-tracker style radar: where the remaining hostiles are, relative to
 * you and to where you are looking.
 *
 * The boards are big enough now that hostiles have to be hunted down, so the
 * radar is the hunting tool. Contacts beyond the sweep are pinned to the rim
 * as chevrons — the bearing is always readable even when the camp is 150 m
 * away, but the distance is not, so you still have to go and look.
 */

/** metres from edge to edge of the sweep */
const RANGE = 120;
/** canvas pixels (square) */
const SIZE = 132;

const COLORS = {
  ring: 'rgba(232,220,200,0.28)',
  face: 'rgba(6,8,10,0.55)',
  wedge: 'rgba(240,208,140,0.10)',
  idle: '#c98b3a',      // posted, hasn't noticed you
  alerted: '#e8b545',   // heard something, coming to look
  engaged: '#ff4d38',   // in the fight
  ally: '#5fd08a',
  mate: '#4fb8d8',
  self: '#f0d08c',
};

export class Radar {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private count: HTMLElement;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'hud-radar';
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE * this.dpr;
    this.canvas.height = SIZE * this.dpr;
    this.canvas.style.width = `${SIZE}px`;
    this.canvas.style.height = `${SIZE}px`;
    this.count = document.createElement('div');
    this.count.className = 'radar-count';
    this.root.appendChild(this.canvas);
    this.root.appendChild(this.count);
    this.ctx = this.canvas.getContext('2d');
  }

  update(player: Player, game: Game): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const r = SIZE / 2;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    // face + rings
    ctx.beginPath();
    ctx.arc(r, r, r - 2, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.face;
    ctx.fill();

    // the slice of the world the camera is actually looking at
    ctx.beginPath();
    ctx.moveTo(r, r);
    ctx.arc(r, r, r - 3, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    ctx.closePath();
    ctx.fillStyle = COLORS.wedge;
    ctx.fill();

    ctx.strokeStyle = COLORS.ring;
    ctx.lineWidth = 1;
    for (const f of [1, 0.66, 0.33]) {
      ctx.beginPath();
      ctx.arc(r, r, (r - 2) * f, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(r, 3); ctx.lineTo(r, 10);
    ctx.moveTo(3, r); ctx.lineTo(10, r);
    ctx.moveTo(SIZE - 3, r); ctx.lineTo(SIZE - 10, r);
    ctx.moveTo(r, SIZE - 3); ctx.lineTo(r, SIZE - 10);
    ctx.stroke();

    const { fwdX, fwdZ, rightX, rightZ } = yawBasis(player.cam.yaw);
    const scale = (r - 8) / RANGE;

    const blip = (
      wx: number, wz: number, wy: number, color: string, size: number, dim: number
    ): void => {
      const dx = wx - player.position.x;
      const dz = wz - player.position.z;
      // rotate into view space: up on the radar is where the camera looks
      const fwd = dx * fwdX + dz * fwdZ;
      const right = dx * rightX + dz * rightZ;
      let px = right * scale;
      let py = -fwd * scale;
      const len = Math.hypot(px, py);
      const max = r - 7;
      const offEdge = len > max;
      if (offEdge && len > 0) {
        const k = max / len;
        px *= k; py *= k;
      }
      ctx.globalAlpha = dim;
      ctx.fillStyle = color;
      if (offEdge) {
        // out of sweep: a chevron on the rim pointing outward — bearing only
        const a = Math.atan2(py, px);
        ctx.save();
        ctx.translate(r + px, r + py);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(3, 0); ctx.lineTo(-3, -3.2); ctx.lineTo(-3, 3.2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(r + px, r + py, size, 0, Math.PI * 2);
        ctx.fill();
        // height offset tick: above or below you
        const dy = wy - player.position.y;
        if (Math.abs(dy) > 4) {
          ctx.fillRect(r + px - 1, r + py + (dy > 0 ? -size - 4 : size + 1), 2, 3);
        }
      }
      ctx.globalAlpha = 1;
    };

    // hostiles: unaware ones read dimmer, so a camp you haven't woken looks calm
    let alive = 0;
    for (const e of game.enemies) {
      if (!e.alive) continue;
      // a PvP squadmate is friendly green, not a contact
      if (e.team === player.team) {
        blip(e.position.x, e.position.z, e.position.y, COLORS.ally, 3, 0.9);
        continue;
      }
      alive++;
      const color = e.awareness === 'engaged' ? COLORS.engaged
        : e.awareness === 'alerted' ? COLORS.alerted
        : COLORS.idle;
      const dim = e.awareness === 'idle' ? 0.62 : 1;
      const size = e.awareness === 'engaged' ? 3.4 : 2.8;
      blip(e.position.x, e.position.z, e.position.y, color, size, dim);
    }
    for (const a of game.allies) {
      if (!a.alive) continue;
      blip(a.position.x, a.position.z, a.position.y, COLORS.ally, 3, 0.9);
    }
    for (const p of game.players) {
      if (p === player || !p.alive) continue;
      // in pvp a rival player is the reddest thing on the dial
      if (p.team !== player.team) {
        alive++;
        blip(p.position.x, p.position.z, p.position.y, COLORS.engaged, 3.6, 1);
      } else {
        blip(p.position.x, p.position.z, p.position.y, COLORS.mate, 3.2, 0.95);
      }
    }

    // campaign: the beacon's pip, gold, so the bearing survives fog and dunes
    const obj = game.campaign?.objectivePos;
    if (obj) blip(obj.x, obj.z, obj.y, '#ffcf6a', 3.6, 1);

    // you, at the centre, always pointing up
    ctx.fillStyle = COLORS.self;
    ctx.beginPath();
    ctx.moveTo(r, r - 5.5); ctx.lineTo(r - 4, r + 4.5); ctx.lineTo(r + 4, r + 4.5);
    ctx.closePath();
    ctx.fill();

    const hunting = game.enemies.some((e) => e.alive && e.awareness !== 'idle');
    this.count.textContent = `${alive} HOSTILE${alive === 1 ? '' : 'S'}`;
    this.count.className = hunting ? 'radar-count engaged' : 'radar-count';
  }
}
