import type { Game } from '../game/game';
import { Radar } from './radar';

/** Per-player DOM HUD, laid out per split-screen viewport. */

interface PlayerHud {
  root: HTMLElement;
  health: HTMLElement;
  fuel: HTMLElement;
  energy: HTMLElement;
  deadeye: HTMLElement;
  deadeyeBar: HTMLElement;
  coverHint: HTMLElement;
  weapon: HTMLElement;
  rocket: HTMLElement;
  wave: HTMLElement;
  kills: HTMLElement;
  banner: HTMLElement;
  bannerSub: HTMLElement;
  vignette: HTMLElement;
  crosshair: SVGElement;
  radar: Radar;
  bannerTimer: number;
  hitTimer: number;
}

const CROSSHAIR_SVG = `
<svg class="crosshair" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <g stroke="#000" stroke-opacity="0.55" stroke-width="4.5" stroke-linecap="round">
    <line x1="32" y1="9" x2="32" y2="21"/><line x1="32" y1="43" x2="32" y2="55"/>
    <line x1="9" y1="32" x2="21" y2="32"/><line x1="43" y1="32" x2="55" y2="32"/>
  </g>
  <g class="ticks" stroke="#fff" stroke-width="2.2" stroke-linecap="round">
    <line x1="32" y1="9" x2="32" y2="21"/><line x1="32" y1="43" x2="32" y2="55"/>
    <line x1="9" y1="32" x2="21" y2="32"/><line x1="43" y1="32" x2="55" y2="32"/>
  </g>
  <circle cx="32" cy="32" r="2.1" fill="#fff" stroke="#000" stroke-opacity="0.6" stroke-width="1"/>
  <circle class="lockring" cx="32" cy="32" r="13" fill="none" stroke="#ff5533" stroke-width="2.2" opacity="0"/>
  <g class="hitmark" stroke="#ffcf6a" stroke-width="3" stroke-linecap="round" opacity="0">
    <line x1="20" y1="20" x2="26" y2="26"/><line x1="44" y1="20" x2="38" y2="26"/>
    <line x1="20" y1="44" x2="26" y2="38"/><line x1="44" y1="44" x2="38" y2="38"/>
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
          <div class="bar energy"><div class="fill"></div><div class="label">ENERGY</div></div>
          <div class="bar deadeye"><div class="fill"></div><div class="label">DEAD EYE</div></div>
        </div>
        <div class="hud-wave"><div class="wave-num"></div><div class="wave-kills"></div></div>
        <div class="hud-weapon"><div class="wname"></div><div class="rocket"></div></div>
        <div class="hud-cover"></div>
        <div class="hud-banner"><div class="btext"></div><div class="bsub" style="font-size:15px;letter-spacing:0.2em;margin-top:6px;color:#bba97f"></div></div>
      `;
      this.layer.appendChild(root);
      const radar = new Radar();
      root.appendChild(radar.root);
      this.huds.push({
        root,
        radar,
        health: root.querySelector('.bar.health .fill') as HTMLElement,
        fuel: root.querySelector('.bar.fuel .fill') as HTMLElement,
        energy: root.querySelector('.bar.energy .fill') as HTMLElement,
        deadeye: root.querySelector('.bar.deadeye .fill') as HTMLElement,
        deadeyeBar: root.querySelector('.bar.deadeye') as HTMLElement,
        coverHint: root.querySelector('.hud-cover') as HTMLElement,
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
      h.energy.style.transform = `scaleX(${p.energy})`;
      h.energy.style.opacity = p.sprinting ? '1' : '0.8';
      h.deadeye.style.transform = `scaleX(${p.deadeye})`;
      h.deadeyeBar.classList.toggle('active', p.deadeyeActive);
      if (p.cover) h.coverHint.textContent = p.peeking ? 'FIRING FROM COVER' : 'IN COVER · hold aim to peek';
      else if (p.nearCover && p.alive) h.coverHint.textContent = 'C / RB — take cover';
      else h.coverHint.textContent = '';
      h.coverHint.classList.toggle('active', !!p.cover);
      h.weapon.textContent = p.alive
        ? (p.weapon === 'blaster' ? 'EE-3 Carbine' : 'Gaffi Stick')
        : `Respawn ${Math.max(0, p.respawnTimer).toFixed(1)}`;
      const rc = p.rocketCd;
      h.rocket.textContent = rc <= 0 ? '◆ ROCKET READY' : `◇ rocket ${rc.toFixed(0)}s`;
      h.rocket.className = rc <= 0 ? 'rocket' : 'rocket cooling';
      h.wave.textContent = game.state === 'victory' ? 'VICTORY' : `Wave ${Math.max(game.wave, 1)}`;
      h.kills.textContent = `${p.kills} kills · ${game.aliveEnemyCount} hostiles remaining`;
      h.radar.update(p, game);
      h.vignette.style.opacity = String(Math.min(1, p.hurtIntensity + (p.hp < 30 && p.alive ? 0.4 : 0)));

      if (h.bannerTimer > 0) {
        h.bannerTimer -= dt;
        if (h.bannerTimer <= 0) h.banner.parentElement!.classList.remove('show');
      }
      const hit = h.crosshair.querySelector('.hitmark') as SVGElement;
      if (h.hitTimer > 0) { h.hitTimer -= dt; hit.setAttribute('opacity', '1'); }
      else hit.setAttribute('opacity', '0');
      const lock = h.crosshair.querySelector('.lockring') as SVGElement;
      lock.setAttribute('opacity', p.alive && p.lockedOn ? '0.95' : '0');
      const ticks = h.crosshair.querySelector('.ticks') as SVGElement;
      ticks.setAttribute('stroke', p.lockedOn ? '#ff5533' : '#fff');
    }
  }
}
