import type { Game } from '../game/game';

/** Per-player DOM HUD, laid out per split-screen viewport. */

interface PlayerHud {
  root: HTMLElement;
  health: HTMLElement;
  fuel: HTMLElement;
  weapon: HTMLElement;
  rocket: HTMLElement;
  wave: HTMLElement;
  kills: HTMLElement;
  banner: HTMLElement;
  bannerSub: HTMLElement;
  vignette: HTMLElement;
  crosshair: SVGElement;
  bannerTimer: number;
  hitTimer: number;
}

const CROSSHAIR_SVG = `
<svg class="crosshair" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
  <circle cx="22" cy="22" r="1.8" fill="rgba(232,220,200,0.9)"/>
  <g stroke="rgba(232,220,200,0.8)" stroke-width="1.6">
    <line x1="22" y1="6" x2="22" y2="13"/><line x1="22" y1="31" x2="22" y2="38"/>
    <line x1="6" y1="22" x2="13" y2="22"/><line x1="31" y1="22" x2="38" y2="22"/>
  </g>
  <g class="hitmark" stroke="#ffcf6a" stroke-width="2" opacity="0">
    <line x1="12" y1="12" x2="17" y2="17"/><line x1="32" y1="12" x2="27" y2="17"/>
    <line x1="12" y1="32" x2="17" y2="27"/><line x1="32" y1="32" x2="27" y2="27"/>
  </g>
</svg>`;

export class Hud {
  private layer: HTMLElement;
  private huds: PlayerHud[] = [];

  constructor(parent: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'layer';
    parent.appendChild(this.layer);
  }

  setLayout(playerCount: number): void {
    this.layer.innerHTML = '';
    this.huds = [];
    for (let i = 0; i < playerCount; i++) {
      const root = document.createElement('div');
      root.className = 'hud-viewport';
      if (playerCount === 1) root.style.inset = '0';
      else {
        root.style.left = '0'; root.style.right = '0';
        root.style.top = i === 0 ? '0' : '50%';
        root.style.height = '50%';
      }
      root.innerHTML = `
        <div class="visor-vignette"></div>
        <div class="damage-vignette"></div>
        ${CROSSHAIR_SVG}
        <div class="hud-bars">
          <div class="bar health"><div class="fill"></div><div class="label">HP</div></div>
          <div class="bar fuel"><div class="fill"></div><div class="label">JET</div></div>
        </div>
        <div class="hud-wave"><div class="wave-num"></div><div class="wave-kills"></div></div>
        <div class="hud-weapon"><div class="wname"></div><div class="rocket"></div></div>
        <div class="hud-banner"><div class="btext"></div><div class="bsub" style="font-size:15px;letter-spacing:0.2em;margin-top:6px;color:#bba97f"></div></div>
      `;
      this.layer.appendChild(root);
      this.huds.push({
        root,
        health: root.querySelector('.bar.health .fill') as HTMLElement,
        fuel: root.querySelector('.bar.fuel .fill') as HTMLElement,
        weapon: root.querySelector('.wname') as HTMLElement,
        rocket: root.querySelector('.rocket') as HTMLElement,
        wave: root.querySelector('.wave-num') as HTMLElement,
        kills: root.querySelector('.wave-kills') as HTMLElement,
        banner: root.querySelector('.btext') as HTMLElement,
        bannerSub: root.querySelector('.bsub') as HTMLElement,
        vignette: root.querySelector('.damage-vignette') as HTMLElement,
        crosshair: root.querySelector('.crosshair') as SVGElement,
        bannerTimer: 0,
        hitTimer: 0,
      });
      if (playerCount > 1 && i === 1) {
        const divider = document.createElement('div');
        divider.className = 'hud-divider';
        this.layer.appendChild(divider);
      }
    }
  }

  banner(text: string, sub?: string): void {
    for (const h of this.huds) {
      h.banner.textContent = text;
      h.bannerSub.textContent = sub ?? '';
      h.banner.parentElement!.classList.add('show');
      h.bannerTimer = 2.6;
    }
  }

  hitMarker(slot: number): void {
    const h = this.huds[slot];
    if (h) h.hitTimer = 0.18;
  }

  hide(): void { this.layer.style.display = 'none'; }
  show(): void { this.layer.style.display = ''; }

  update(dt: number, game: Game): void {
    for (let i = 0; i < this.huds.length; i++) {
      const h = this.huds[i];
      const p = game.players[i];
      if (!p) continue;
      h.health.style.transform = `scaleX(${Math.max(0, p.hp / p.maxHp)})`;
      h.health.style.background = p.hp < 30 ? '#e0301e' : '#c33f2e';
      h.fuel.style.transform = `scaleX(${p.fuel})`;
      h.weapon.textContent = p.alive
        ? (p.weapon === 'blaster' ? 'EE-3 Carbine' : 'Gaffi Stick')
        : `Respawn ${Math.max(0, p.respawnTimer).toFixed(1)}`;
      const rc = p.rocketCd;
      h.rocket.textContent = rc <= 0 ? '◆ ROCKET READY' : `◇ rocket ${rc.toFixed(0)}s`;
      h.rocket.className = rc <= 0 ? 'rocket' : 'rocket cooling';
      h.wave.textContent = game.state === 'victory' ? 'VICTORY' : `Wave ${Math.max(game.wave, 1)}`;
      h.kills.textContent = `${p.kills} kills · ${game.aliveEnemyCount} hostiles`;
      h.vignette.style.opacity = String(Math.min(1, p.hurtIntensity + (p.hp < 30 && p.alive ? 0.4 : 0)));

      if (h.bannerTimer > 0) {
        h.bannerTimer -= dt;
        if (h.bannerTimer <= 0) h.banner.parentElement!.classList.remove('show');
      }
      const hit = h.crosshair.querySelector('.hitmark') as SVGElement;
      if (h.hitTimer > 0) { h.hitTimer -= dt; hit.setAttribute('opacity', '1'); }
      else hit.setAttribute('opacity', '0');
    }
  }
}
