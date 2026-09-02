import type { Game } from '../game/game';
import { Radar } from './radar';
import { splitLayout } from '../core/layout';
import { yawBasis } from '../core/math';

/** Per-player DOM HUD, laid out per split-screen viewport. */

interface PlayerHud {
  root: HTMLElement;
  health: HTMLElement;
  fuel: HTMLElement;
  fuelBar: HTMLElement;
  energy: HTMLElement;
  heat: HTMLElement;
  heatBar: HTMLElement;
  coverHint: HTMLElement;
  hpNum: HTMLElement;
  healthBar: HTMLElement;
  hurtArc: HTMLElement;
  weapon: HTMLElement;
  rocket: HTMLElement;
  wave: HTMLElement;
  kills: HTMLElement;
  banner: HTMLElement;
  bannerSub: HTMLElement;
  contacts: HTMLElement;
  contactNames: HTMLElement;
  boss: HTMLElement;
  bossName: HTMLElement;
  bossFill: HTMLElement;
  vignette: HTMLElement;
  crosshair: SVGElement;
  radar: Radar;
  bannerTimer: number;
  contactsTimer: number;
  hitTimer: number;
}

const CROSSHAIR_SVG = `
<svg class="crosshair" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <g class="reticle">
    <g stroke="#000" stroke-opacity="0.55" stroke-width="4.5" stroke-linecap="round">
      <line x1="32" y1="9" x2="32" y2="21"/><line x1="32" y1="43" x2="32" y2="55"/>
      <line x1="9" y1="32" x2="21" y2="32"/><line x1="43" y1="32" x2="55" y2="32"/>
    </g>
    <g class="ticks" stroke="#fff" stroke-width="2.2" stroke-linecap="round">
      <line x1="32" y1="9" x2="32" y2="21"/><line x1="32" y1="43" x2="32" y2="55"/>
      <line x1="9" y1="32" x2="21" y2="32"/><line x1="43" y1="32" x2="55" y2="32"/>
    </g>
    <circle cx="32" cy="32" r="2.1" fill="#fff" stroke="#000" stroke-opacity="0.6" stroke-width="1"/>
  </g>
  <circle class="lockring" cx="32" cy="32" r="13" fill="none" stroke="#ff5533" stroke-width="2.2" opacity="0"/>
  <circle class="lowring" cx="32" cy="32" r="17" fill="none" stroke="#ff3a2a" stroke-width="2.6"/>
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
    // the same rectangles the renderer sets its viewports from, so a player's
    // bars always sit inside that player's picture — every mode splits the
    // screen the same way now that Missions gives each player their own camera
    const rects = splitLayout(playerCount);
    for (let i = 0; i < playerCount; i++) {
      const root = document.createElement('div');
      root.className = 'hud-viewport';
      const r = rects[i];
      root.style.left = `${r.x * 100}%`;
      root.style.top = `${r.y * 100}%`;
      root.style.width = `${r.w * 100}%`;
      root.style.height = `${r.h * 100}%`;
      root.classList.toggle('compact', r.h < 0.9 && r.w < 0.9);
      root.innerHTML = `
        <div class="visor-vignette"></div>
        <div class="damage-vignette"></div>
        ${CROSSHAIR_SVG}
        <div class="hud-bars">
          <div class="bar health"><div class="fill"></div><div class="hpnum"></div><div class="label">HP</div></div>
          <div class="bar fuel"><div class="fill"></div><div class="label">JET</div></div>
          <div class="bar energy"><div class="fill"></div><div class="label">ENERGY</div></div>
          <div class="bar heat"><div class="fill"></div><div class="label">HEAT</div></div>
        </div>
        <div class="hud-wave"><div class="wave-num"></div><div class="wave-kills"></div></div>
        <div class="hud-weapon"><div class="wname"></div><div class="rocket"></div></div>
        <div class="hud-cover"></div>
        <div class="hurt-arc"><svg viewBox="0 0 120 120"><path d="M60 6 A54 54 0 0 1 98 22" fill="none" stroke="#ff4a36" stroke-width="8" stroke-linecap="round" transform="rotate(-22 60 60)"/></svg></div>
        <div class="hud-boss"><div class="bossname"></div><div class="bossbar"><div class="bossfill"></div></div></div>
        <div class="hud-banner"><div class="btext"></div><div class="bsub" style="font-size:15px;letter-spacing:0.2em;margin-top:6px;color:#bba97f"></div></div>
        <div class="hud-contacts"><div class="nc-kicker">◢ New contact</div><div class="nc-names"></div></div>
      `;
      this.layer.appendChild(root);
      const radar = new Radar();
      root.appendChild(radar.root);
      this.huds.push({
        root,
        radar,
        health: root.querySelector('.bar.health .fill') as HTMLElement,
        fuel: root.querySelector('.bar.fuel .fill') as HTMLElement,
        fuelBar: root.querySelector('.bar.fuel') as HTMLElement,
        energy: root.querySelector('.bar.energy .fill') as HTMLElement,
        heat: root.querySelector('.bar.heat .fill') as HTMLElement,
        heatBar: root.querySelector('.bar.heat') as HTMLElement,
        coverHint: root.querySelector('.hud-cover') as HTMLElement,
        hpNum: root.querySelector('.bar.health .hpnum') as HTMLElement,
        healthBar: root.querySelector('.bar.health') as HTMLElement,
        hurtArc: root.querySelector('.hurt-arc') as HTMLElement,
        weapon: root.querySelector('.wname') as HTMLElement,
        rocket: root.querySelector('.rocket') as HTMLElement,
        wave: root.querySelector('.wave-num') as HTMLElement,
        kills: root.querySelector('.wave-kills') as HTMLElement,
        banner: root.querySelector('.btext') as HTMLElement,
        bannerSub: root.querySelector('.bsub') as HTMLElement,
        contacts: root.querySelector('.hud-contacts') as HTMLElement,
        contactNames: root.querySelector('.nc-names') as HTMLElement,
        boss: root.querySelector('.hud-boss') as HTMLElement,
        bossName: root.querySelector('.bossname') as HTMLElement,
        bossFill: root.querySelector('.bossfill') as HTMLElement,
        vignette: root.querySelector('.damage-vignette') as HTMLElement,
        crosshair: root.querySelector('.crosshair') as SVGElement,
        bannerTimer: 0,
        contactsTimer: 0,
        hitTimer: 0,
      });
      // A rule along each internal edge of this viewport, so neighbours read
      // apart — spanning only that viewport's own edge, never the full window:
      // three players side by side have a tall picture next to two short ones,
      // and a rule drawn all the way across would cut the tall one in half.
      const rule = (cls: string, style: Partial<CSSStyleDeclaration>) => {
        const el = document.createElement('div');
        el.className = cls;
        Object.assign(el.style, style);
        this.layer.appendChild(el);
      };
      if (r.y > 0) rule('hud-divider', { top: `${r.y * 100}%`, left: `${r.x * 100}%`, width: `${r.w * 100}%` });
      if (r.x > 0) rule('hud-divider-v', { left: `${r.x * 100}%`, top: `${r.y * 100}%`, height: `${r.h * 100}%` });
    }
  }

  /**
   * The boss introduction card: letterbox bars and a name plate across the
   * whole window, over the game's slow-motion reveal (game.ts drives that
   * side). Built fresh per showing and removed after, so it survives layout
   * rebuilds and never leaves a stray node behind.
   */
  bossIntro(title: string, sub: string): void {
    const card = document.createElement('div');
    card.className = 'boss-intro';
    card.innerHTML = `
      <div class="bi-bar top"></div>
      <div class="bi-plate">
        <div class="bi-kicker">— ${sub.startsWith('Champion') ? 'Champion' : 'Warlord'} —</div>
        <div class="bi-name">${title}</div>
        <div class="bi-rule"></div>
        <div class="bi-sub">${sub}</div>
      </div>
      <div class="bi-bar bottom"></div>`;
    this.layer.appendChild(card);
    window.setTimeout(() => card.classList.add('out'), 2800);
    window.setTimeout(() => card.remove(), 3500);
  }

  banner(text: string, sub?: string): void {
    for (const h of this.huds) {
      h.banner.textContent = text;
      h.bannerSub.textContent = sub ?? '';
      h.banner.parentElement!.classList.add('show');
      h.bannerTimer = 2.6;
    }
  }

  /**
   * The little intel card under the wave banner, naming enemy kinds making
   * their first appearance this wave. Held longer than the banner — it is
   * the one piece worth reading twice.
   */
  newContacts(names: string[]): void {
    for (const h of this.huds) {
      h.contacts.querySelector('.nc-kicker')!.textContent =
        names.length > 1 ? '◢ New contacts' : '◢ New contact';
      h.contactNames.textContent = names.join(' · ');
      h.contacts.classList.add('show');
      h.contactsTimer = 6;
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
      h.hpNum.textContent = p.alive ? String(Math.max(0, Math.ceil(p.hp))) : '';
      const low = p.alive && p.hp < 30;
      h.healthBar.classList.toggle('low', low);
      h.crosshair.classList.toggle('low', low);
      // where the last hit came from, as an arc on the reticle ring: up is
      // the way the camera looks, so an arc on the right means "to your
      // right". Fades with the hurt flash it belongs to.
      const hurt = p.hurtIntensity;
      if (hurt > 0.12 && p.alive) {
        const { fwdX, fwdZ, rightX, rightZ } = yawBasis(p.cam.yaw);
        const d = p.lastDamageDir;
        const a = Math.atan2(d.x * rightX + d.z * rightZ, d.x * fwdX + d.z * fwdZ);
        h.hurtArc.style.transform = `rotate(${(a * 180) / Math.PI}deg)`;
        h.hurtArc.style.opacity = String(Math.min(1, hurt * 1.4));
      } else h.hurtArc.style.opacity = '0';
      // only a jetpack burns fuel — a super jumper's gauge would sit full
      // forever, so the bar only earns its row on a Mandalorian
      h.fuelBar.style.display = p.profile.flight === 'jetpack' ? '' : 'none';
      h.fuel.style.transform = `scaleX(${p.fuel})`;
      h.energy.style.transform = `scaleX(${p.energy})`;
      h.energy.style.opacity = p.sprinting ? '1' : '0.8';
      // the heat bar is only worth screen space on a character who carries
      // something to overheat
      h.heatBar.style.display = p.weapon === 'blaster' ? '' : 'none';
      h.heat.style.transform = `scaleX(${p.heat})`;
      h.heatBar.classList.toggle('overheated', p.overheated);
      if (p.vehicle) h.coverHint.textContent = `${p.vehicle.def.name.toUpperCase()} ${Math.max(0, Math.ceil(p.vehicle.hp))}/${p.vehicle.maxHp} · A gas · B brake · RB off`;
      else if (p.nearVehicle && p.alive) h.coverHint.textContent = `C / RB — ride the ${p.nearVehicle.def.name.toLowerCase()}`;
      else if (p.cover) h.coverHint.textContent = p.peeking ? 'FIRING FROM COVER' : 'IN COVER · hold aim to peek';
      else if (p.nearCover && p.alive) h.coverHint.textContent = 'C / RB — take cover';
      else h.coverHint.textContent = '';
      h.coverHint.classList.toggle('active', !!p.cover || !!p.vehicle);
      // the wait is a performance now, not a countdown: the body burns away
      // and re-forms at the next spawn, so the label narrates rather than ticks
      h.weapon.textContent = p.alive
        ? p.formT > 0 ? 'RE-FORMING' : p.weaponLabel()
        : p.dissolving ? 'DISINTEGRATING' : 'DOWN';
      // Y is the rocket for gun carriers; for a blades-only fighter or a war
      // beast it is the heavy lunge, and the HUD should call it what it is
      const rc = p.rocketCd;
      if (p.profile.special === 'layEgg') {
        // the clutch is the readout: Y lays, RT throws, eggs charge on the clock
        const n = p.eggClutch;
        h.rocket.textContent = n > 0 ? `◆ EGGS ×${n}` : '◇ egg charging';
        h.rocket.className = n > 0 ? 'rocket' : 'rocket cooling';
      } else {
        const ord = p.profile.rangedName === null ? 'LUNGE' : 'ROCKET';
        h.rocket.textContent = rc <= 0 ? `◆ ${ord} READY` : `◇ ${ord.toLowerCase()} ${rc.toFixed(0)}s`;
        h.rocket.className = rc <= 0 ? 'rocket' : 'rocket cooling';
      }
      // the boss bar carries the boss's name; the top line does not need to
      // say it a second time directly above it
      const top = game.hudTopLine(p);
      h.wave.textContent = game.boss?.alive && top === game.boss.bossName ? '' : top;
      h.kills.textContent = game.hudScoreLine(p);
      // the boss bar rides every viewport while a warlord stands
      const boss = game.boss;
      if (boss && boss.alive) {
        h.boss.classList.add('show');
        h.boss.classList.toggle('ph1', game.bossPhaseLevel === 1);
        h.boss.classList.toggle('ph2', game.bossPhaseLevel === 2);
        h.bossName.textContent = boss.bossName;
        h.bossFill.style.transform = `scaleX(${Math.max(0, boss.hp / boss.maxHp)})`;
      } else {
        h.boss.classList.remove('show');
      }
      h.radar.update(p, game);
      h.vignette.style.opacity = String(Math.min(1, p.hurtIntensity + (p.hp < 30 && p.alive ? 0.4 : 0)));

      if (h.bannerTimer > 0) {
        h.bannerTimer -= dt;
        if (h.bannerTimer <= 0) h.banner.parentElement!.classList.remove('show');
      }
      if (h.contactsTimer > 0) {
        h.contactsTimer -= dt;
        if (h.contactsTimer <= 0) h.contacts.classList.remove('show');
      }
      // the reticle belongs to ADS only — hip fire reads off the muzzle. The
      // hit marker and lock ring stay live either way: they are feedback about
      // the world, not an aiming aid.
      const reticle = h.crosshair.querySelector('.reticle') as SVGElement;
      reticle.setAttribute('opacity', p.alive && p.aiming ? '1' : '0');
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
