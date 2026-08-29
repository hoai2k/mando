/**
 * WebAudio engine. Short sounds are synthesized procedurally unless an authored file
 * exists at assets/audio/<name>.mp3 (see docs/ASSETS_AUDIO.md); board background music
 * is streamed from public/music/ as a playlist (see ./music.ts).
 */

import { ASSET_ROOT } from './assets';
import { config } from '../config';
import { playlistFor } from './music';
import type { BoardId } from '../world/board';

type SampleName =
  | 'blaster_shot' | 'enemy_blaster' | 'blaster_impact' | 'melee_whoosh' | 'melee_hit'
  | 'rocket_launch' | 'explosion' | 'hit_marker' | 'kill_confirm' | 'player_hurt'
  | 'jetpack_loop' | 'jetpack_ignite' | 'dash' | 'land_hard' | 'land_soft'
  | 'footstep_sand' | 'footstep_metal' | 'footstep_snow' | 'footstep_stone'
  | 'ui_move' | 'ui_confirm' | 'ui_back' | 'wave_start' | 'wave_clear'
  | 'tusken_cry' | 'pyke_chatter' | 'pyke_death' | 'pirate_taunt' | 'pirate_death'
  | 'droid_death' | 'swoop_pass' | 'massiff_growl' | 'massiff_yelp'
  | 'imperial_bark' | 'imperial_death'
  | 'spider_chitter' | 'quarren_bark' | 'alamite_shriek' | 'drone_whine' | 'flame_burst'
  | 'thunder_crack' | 'geyser_blast' | 'alarm_klaxon' | 'ice_crack' | 'mythosaur_call'
  | 'splash_in' | 'splash_out' | 'mamacore_roar' | 'floor_charge'
  | 'amb_desert' | 'amb_station' | 'amb_lava' | 'amb_ice' | 'amb_rain'
  | 'amb_refinery' | 'amb_forge' | 'amb_city' | 'amb_sea'
  | 'crossbow_shot' | 'longrifle_shot' | 'saber_swing' | 'saber_ignite' | 'saber_hum'
  | 'music_title' | 'music_combat_desert' | 'music_combat_station' | 'music_victory' | 'music_defeat';

/** Enemy voice bark names — flavor sounds with no synth fallback. */
export type BarkName =
  | 'tusken_cry' | 'pyke_chatter' | 'pyke_death' | 'pirate_taunt' | 'pirate_death'
  | 'droid_death' | 'swoop_pass'
  | 'imperial_bark' | 'imperial_death'
  | 'spider_chitter' | 'quarren_bark' | 'alamite_shriek' | 'drone_whine';

/** Footfall surfaces, one per board flavor. */
export type FootSurface = 'sand' | 'metal' | 'snow' | 'stone';

/** one wielder's looping blade hum */
interface SaberVoice {
  sample: AudioBuffer | null;
  set: (level: number) => void;
  stop: () => void;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private samples = new Map<string, AudioBuffer>();
  /** per-player looping jetpack voice; `sample` is what it was built around */
  private jetpackNodes: ({
    gain: GainNode; filter: BiquadFilterNode; src: AudioBufferSourceNode; sample: AudioBuffer | null;
  } | undefined)[] = [];
  /** per-player looping blade hum, built the same way */
  private saberNodes: (SaberVoice | undefined)[] = [];
  private ambientStop: (() => void) | null = null;
  private musicStop: (() => void) | null = null;
  private noiseBuf: AudioBuffer | null = null;

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) { this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.connect(this.master);
    this.music = this.ctx.createGain();
    this.music.connect(this.master);
    this.applyConfig();
    this.noiseBuf = this.makeNoise();
    this.tryLoadSamples();
    this.watchVisibility();
  }

  get ready(): boolean { return !!this.ctx; }

  /**
   * Go silent while the tab is in the background. Suspending the context (not
   * just muting) also stops the loops and the scheduler burning CPU behind a
   * tab nobody is looking at; a hidden tab is never resumed by mistake because
   * the resume is gated on the tab being visible again.
   */
  private watchVisibility(): void {
    if (this.visibilityHooked) return;
    this.visibilityHooked = true;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }
  private visibilityHooked = false;

  private async tryLoadSamples(): Promise<void> {
    const names: SampleName[] = [
      'blaster_shot', 'enemy_blaster', 'blaster_impact', 'melee_whoosh', 'melee_hit',
      'rocket_launch', 'explosion', 'hit_marker', 'kill_confirm', 'player_hurt',
      'jetpack_loop', 'jetpack_ignite', 'dash', 'land_hard', 'land_soft',
      'footstep_sand', 'footstep_metal', 'footstep_snow', 'footstep_stone',
      'ui_move', 'ui_confirm', 'ui_back', 'wave_start', 'wave_clear',
      'tusken_cry', 'pyke_chatter', 'pyke_death', 'pirate_taunt', 'pirate_death',
      'droid_death', 'swoop_pass', 'massiff_growl', 'massiff_yelp',
      'imperial_bark', 'imperial_death',
      'spider_chitter', 'quarren_bark', 'alamite_shriek', 'drone_whine', 'flame_burst',
      'thunder_crack', 'geyser_blast', 'alarm_klaxon', 'ice_crack', 'mythosaur_call',
      'splash_in', 'splash_out', 'mamacore_roar', 'floor_charge',
      'amb_desert', 'amb_station', 'amb_lava', 'amb_ice', 'amb_rain',
      'amb_refinery', 'amb_forge', 'amb_city', 'amb_sea',
      'crossbow_shot', 'longrifle_shot', 'saber_swing', 'saber_ignite', 'saber_hum',
      'music_title', 'music_combat_desert', 'music_combat_station', 'music_victory', 'music_defeat',
    ];
    await Promise.all(names.map(async (n) => {
      // mp3 first: that's what tools/generate-sfx.mjs ships, so the common
      // case is one request instead of a 404 probe per sample.
      for (const ext of ['mp3', 'ogg']) {
        try {
          const res = await fetch(`${ASSET_ROOT}assets/audio/${n}.${ext}`);
          if (!res.ok) continue;
          const buf = await res.arrayBuffer();
          const audio = await this.ctx!.decodeAudioData(buf);
          this.samples.set(n, audio);
          return;
        } catch { /* try next ext / fall back to synth */ }
      }
    }));
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private playSample(name: SampleName, gain = 1, rate = 1, bus: GainNode = this.sfx): boolean {
    const s = this.samples.get(name);
    if (!s || !this.ctx) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = s;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus);
    src.start();
    return true;
  }

  private env(peak: number, attack: number, decay: number, when = 0): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime + when;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.sfx);
    return g;
  }

  private zap(f0: number, f1: number, dur: number, type: OscillatorType, peak: number, when = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + when;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    o.connect(this.env(peak, 0.004, dur, when));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, peak: number, filterFreq: number, when = 0, q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterFreq;
    f.Q.value = q;
    src.connect(f).connect(this.env(peak, 0.003, dur, when));
    const t = ctx.currentTime + when;
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /**
   * War-massiff voice. Unlike the other creature barks this one synthesizes
   * when the sample is missing — the beast is big enough on screen that a
   * silent charge reads as broken, and its two mp3s were retired when the
   * old small massiff was cut.
   */
  beastGrowl(gain = 0.55): void {
    if (!this.ctx || this.playSample('massiff_growl', gain, 0.95 + Math.random() * 0.1)) return;
    // low rasping snarl: detuned growl over a filtered noise rumble
    this.zap(110, 62, 0.5, 'sawtooth', 0.3 * gain);
    this.zap(76, 47, 0.55, 'square', 0.18 * gain);
    this.burst(0.5, 0.22 * gain, 340, 0, 2.5);
  }

  beastYelp(gain = 0.6): void {
    if (!this.ctx || this.playSample('massiff_yelp', gain, 0.95 + Math.random() * 0.1)) return;
    this.zap(430, 90, 0.34, 'sawtooth', 0.32 * gain);
    this.burst(0.26, 0.2 * gain, 900, 0.02, 1.4);
  }

  /** Hero ranged shot, voiced per weapon; the carbine is the classic zap. */
  blaster(kind: 'carbine' | 'crossbow' | 'longrifle' = 'carbine'): void {
    if (!this.ctx) return;
    if (kind === 'crossbow') {
      if (this.playSample('crossbow_shot', 0.7)) return;
      // string release then a bright bolt: pluck transient, high short zap
      this.burst(0.03, 0.25, 1600, 0, 3);
      this.zap(2600, 700, 0.09, 'square', 0.22, 0.015);
      return;
    }
    if (kind === 'longrifle') {
      if (this.playSample('longrifle_shot', 0.75)) return;
      // heavier, slower report with a low barrel resonance
      this.zap(950, 140, 0.22, 'sawtooth', 0.4);
      this.burst(0.1, 0.22, 1400, 0, 1.2);
      this.zap(180, 70, 0.28, 'sine', 0.2, 0.02);
      return;
    }
    if (this.playSample('blaster_shot', 0.7)) return;
    this.zap(1900, 260, 0.13, 'sawtooth', 0.35);
    this.burst(0.06, 0.16, 3400);
  }
  enemyBlaster(): void {
    if (!this.ctx || this.playSample('enemy_blaster', 0.5)) return;
    this.zap(720, 190, 0.16, 'square', 0.16);
  }
  impact(): void {
    if (!this.ctx || this.playSample('blaster_impact', 0.5)) return;
    this.burst(0.09, 0.22, 2400, 0, 2);
  }
  melee(step: number, kind: 'gaffi' | 'sabers' = 'gaffi'): void {
    if (!this.ctx) return;
    if (kind === 'sabers') {
      if (this.playSample('saber_swing', 0.65, 0.92 + step * 0.1)) return;
      // an energy blade sweep is a hum with doppler, not moving air: a tonal
      // sweep with a fifth above it, plus only a whisper of whoosh
      this.zap(340 + step * 40, 130, 0.22, 'sawtooth', 0.2);
      this.zap(510 + step * 60, 195, 0.22, 'triangle', 0.12);
      this.burst(0.14, 0.08, 700 + step * 150, 0, 0.5);
      return;
    }
    if (this.playSample('melee_whoosh', 0.6, 0.9 + step * 0.12)) return;
    this.burst(0.16, 0.22, 500 + step * 200, 0, 0.7);
  }
  /** Twin blades snapping alive when the assassin draws them. */
  saberIgnite(): void {
    if (!this.ctx || this.playSample('saber_ignite', 0.6)) return;
    this.burst(0.04, 0.3, 2400, 0, 2);
    this.zap(90, 260, 0.16, 'sawtooth', 0.22, 0.02);
    this.zap(140, 390, 0.16, 'triangle', 0.12, 0.02);
  }
  meleeHit(kind: 'gaffi' | 'sabers' = 'gaffi'): void {
    if (!this.ctx) return;
    if (kind === 'sabers') {
      // an energy blade biting does not clang: it cracks and sizzles
      this.zap(880, 120, 0.14, 'sawtooth', 0.34);
      this.burst(0.16, 0.26, 3200, 0, 1.2);
      this.burst(0.09, 0.18, 700, 0.01, 2);
      return;
    }
    if (this.playSample('melee_hit', 0.8)) return;
    this.zap(160, 55, 0.12, 'triangle', 0.5);
    this.burst(0.08, 0.3, 900, 0, 1.5);
  }
  rocket(): void {
    if (!this.ctx || this.playSample('rocket_launch', 0.7)) return;
    this.burst(0.45, 0.3, 1000, 0, 0.6);
    this.zap(300, 900, 0.4, 'sawtooth', 0.1);
  }
  explosion(): void {
    if (!this.ctx || this.playSample('explosion', 0.9)) return;
    this.zap(120, 30, 0.7, 'sine', 0.8);
    this.burst(0.6, 0.5, 400, 0, 0.4);
    this.burst(0.35, 0.25, 1800, 0.03, 0.8);
  }
  hitMarker(): void {
    if (!this.ctx || this.playSample('hit_marker', 0.35)) return;
    this.zap(2600, 2100, 0.035, 'square', 0.08);
  }
  killConfirm(): void {
    if (!this.ctx || this.playSample('kill_confirm', 0.5)) return;
    this.zap(1300, 900, 0.07, 'square', 0.12);
    this.zap(900, 600, 0.09, 'square', 0.12, 0.07);
  }
  hurt(): void {
    if (!this.ctx || this.playSample('player_hurt', 0.7)) return;
    this.zap(240, 90, 0.2, 'sawtooth', 0.3);
  }
  dash(): void {
    if (!this.ctx || this.playSample('dash', 0.6)) return;
    this.burst(0.22, 0.3, 1400, 0, 0.5);
  }
  land(hard: boolean): void {
    if (!this.ctx) return;
    if (this.playSample(hard ? 'land_hard' : 'land_soft', hard ? 0.7 : 0.4)) return;
    if (!hard && this.playSample('land_hard', 0.3, 1.15)) return;
    this.zap(hard ? 150 : 110, 45, hard ? 0.16 : 0.09, 'sine', hard ? 0.5 : 0.2);
    this.burst(0.07, hard ? 0.2 : 0.09, 700, 0, 0.8);
  }
  /** Footstep on the board's surface, with slight pitch variation. */
  footstep(surface: FootSurface): void {
    if (!this.ctx) return;
    const rate = 0.9 + Math.random() * 0.25;
    if (this.playSample(`footstep_${surface}` as SampleName, 0.3, rate)) return;
    // authored fallbacks that read close enough until real files land
    if (surface === 'snow' && this.playSample('footstep_sand', 0.24, rate * 0.8)) return;
    if (surface === 'stone' && this.playSample('footstep_metal', 0.24, rate * 0.85)) return;
    const freq: Record<FootSurface, number> = { sand: 900, metal: 500, snow: 1200, stone: 650 };
    this.burst(0.05, 0.07, freq[surface], 0, 1.2);
  }
  /** Thunder over the docks: a deep crack rolling off into rumble. */
  thunder(gain = 0.7): void {
    if (!this.ctx || this.playSample('thunder_crack', gain)) return;
    this.burst(0.12, 0.4 * gain, 1800, 0, 0.6);
    this.zap(90, 28, 1.6, 'sine', 0.5 * gain, 0.05);
    this.burst(1.4, 0.22 * gain, 180, 0.1, 0.4);
  }
  /** Lava geyser letting go under someone's feet. */
  geyser(gain = 0.6): void {
    if (!this.ctx || this.playSample('geyser_blast', gain)) return;
    this.burst(0.5, 0.35 * gain, 700, 0, 0.5);
    this.zap(160, 480, 0.4, 'sawtooth', 0.12 * gain);
  }
  /** Refinery alarm: two-tone klaxon, one cycle per call. */
  alarm(gain = 0.5): void {
    if (!this.ctx || this.playSample('alarm_klaxon', gain)) return;
    this.zap(620, 610, 0.28, 'square', 0.1 * gain);
    this.zap(470, 460, 0.28, 'square', 0.1 * gain, 0.3);
  }
  /** Ice plate splitting: a sharp snap over a deep groan. */
  iceCrack(gain = 0.7): void {
    if (!this.ctx || this.playSample('ice_crack', gain)) return;
    this.burst(0.08, 0.35 * gain, 2600, 0, 2.2);
    this.zap(220, 60, 0.5, 'triangle', 0.25 * gain, 0.02);
  }
  /** Flame projector burst — one squeeze of the trigger. */
  flame(gain = 0.5): void {
    if (!this.ctx || this.playSample('flame_burst', gain)) return;
    this.burst(0.45, 0.2 * gain, 500, 0, 0.35);
    this.burst(0.3, 0.12 * gain, 1600, 0.05, 0.8);
  }
  /** Body meeting water — in (deeper whump) or out (lighter shed). */
  splash(entering: boolean, gain = 0.55): void {
    if (!this.ctx || this.playSample(entering ? 'splash_in' : 'splash_out', gain)) return;
    if (entering) {
      this.zap(300, 70, 0.18, 'sine', 0.3 * gain);
      this.burst(0.3, 0.28 * gain, 1100, 0.01, 0.5);
      this.burst(0.25, 0.14 * gain, 3200, 0.04, 0.8);
    } else {
      this.burst(0.22, 0.2 * gain, 1600, 0, 0.6);
      this.burst(0.3, 0.1 * gain, 700, 0.05, 0.7);
    }
  }
  /** The mamacore surfacing for a grab: a wet bellow with teeth in it. */
  mamacoreRoar(gain = 0.7): void {
    if (!this.ctx || this.playSample('mamacore_roar', gain)) return;
    this.zap(160, 45, 0.7, 'sawtooth', 0.35 * gain);
    this.zap(95, 38, 0.8, 'square', 0.2 * gain, 0.05);
    this.burst(0.7, 0.25 * gain, 500, 0, 0.5);
  }
  /** Electrified floor charging up — the prison rig's warning tone. */
  floorCharge(gain = 0.45): void {
    if (!this.ctx || this.playSample('floor_charge', gain)) return;
    this.zap(220, 900, 0.9, 'sawtooth', 0.08 * gain);
    this.zap(440, 1800, 0.9, 'sine', 0.05 * gain, 0.05);
  }
  /** Something colossal, far below the water. Felt more than heard. */
  mythosaur(gain = 0.5): void {
    if (!this.ctx || this.playSample('mythosaur_call', gain)) return;
    this.zap(55, 34, 2.4, 'sine', 0.4 * gain);
    this.zap(82, 40, 2.0, 'triangle', 0.16 * gain, 0.25);
  }
  /** Voice/flavor bark — sample only, silent if the file isn't present. */
  bark(name: BarkName, gain = 0.55): void {
    if (!this.ctx) return;
    this.playSample(name as SampleName, gain, 0.95 + Math.random() * 0.1);
  }
  jetpackIgnite(): void {
    if (!this.ctx || this.playSample('jetpack_ignite', 0.5)) return;
    this.burst(0.2, 0.25, 900, 0, 0.5);
  }
  uiMove(): void { if (this.ctx && !this.playSample('ui_move', 0.4)) this.zap(900, 850, 0.03, 'square', 0.06); }
  uiConfirm(): void { if (this.ctx && !this.playSample('ui_confirm', 0.5)) { this.zap(700, 1050, 0.08, 'square', 0.12); this.zap(1050, 1400, 0.09, 'square', 0.1, 0.07); } }
  uiBack(): void { if (this.ctx && !this.playSample('ui_back', 0.5)) this.zap(500, 300, 0.09, 'square', 0.1); }
  waveStart(): void {
    if (!this.ctx || this.playSample('wave_start', 0.7)) return;
    this.zap(190, 170, 0.55, 'sawtooth', 0.28);
    this.zap(95, 85, 0.55, 'sawtooth', 0.22);
  }
  waveClear(): void {
    if (!this.ctx || this.playSample('wave_clear', 0.7)) return;
    [440, 550, 660].forEach((f, i) => this.zap(f, f * 0.995, 0.28, 'triangle', 0.2, i * 0.14));
  }

  /** Per-player jetpack loop; thrust 0..1. */
  setJetpackThrust(slot: number, thrust: number): void {
    if (!this.ctx) return;
    let node = this.jetpackNodes[slot];
    const sample = this.samples.get('jetpack_loop') ?? null;
    // Samples decode asynchronously after init, so a player who jets in the
    // first seconds used to build this node around the synth fallback and keep
    // it for the whole browser session. Rebuild once the real loop lands.
    if (node && node.sample !== sample) {
      node.src.stop();
      node.gain.disconnect();
      node = undefined;
    }
    if (!node) {
      const src = this.ctx.createBufferSource();
      src.buffer = sample ?? this.noiseBuf;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.sfx);
      src.start();
      node = { gain, filter, src, sample };
      this.jetpackNodes[slot] = node;
    }
    const t = this.ctx.currentTime;
    node.gain.gain.setTargetAtTime(thrust * 0.34, t, 0.05);
    node.filter.frequency.setTargetAtTime(300 + thrust * 1700, t, 0.06);
  }

  /**
   * The idle hum of a drawn energy blade. Level 0 stows it; above that it is
   * the blade's presence, and callers push it up with swing speed so the hum
   * leans into a movement the way the real thing does.
   *
   * Synthesized when no sample is present: two detuned saws an octave apart
   * through a lowpass, which is what gives it the beating, alive quality a
   * single tone lacks.
   */
  setSaberHum(slot: number, level: number): void {
    if (!this.ctx) return;
    let node = this.saberNodes[slot];
    const sample = this.samples.get('saber_hum') ?? null;
    // same rebuild rule as the jetpack: a voice built around the synth
    // fallback must be replaced once the authored loop decodes
    if (node && node.sample !== sample) {
      node.stop();
      node = undefined;
    }
    if (!node) node = this.saberNodes[slot] = this.makeSaberVoice(sample);
    node.set(level);
  }

  private makeSaberVoice(sample: AudioBuffer | null): SaberVoice {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 1.4;
    filter.connect(gain).connect(this.sfx);
    const parts: Array<{ stop: () => void }> = [];
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.loop = true;
      src.connect(filter);
      src.start();
      parts.push({ stop: () => { try { src.stop(); } catch { /* already stopped */ } } });
    } else {
      for (const [freq, detune, type] of [[104, -6, 'sawtooth'], [208, 7, 'sawtooth'], [52, 0, 'triangle']] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.detune.value = detune;
        o.connect(filter);
        o.start();
        parts.push({ stop: () => { try { o.stop(); } catch { /* already stopped */ } } });
      }
    }
    return {
      sample,
      set: (level: number) => {
        const t = ctx.currentTime;
        gain.gain.setTargetAtTime(Math.min(level, 1.6) * 0.16, t, 0.08);
        filter.frequency.setTargetAtTime(700 + Math.min(level, 1.6) * 900, t, 0.1);
      },
      stop: () => { for (const p of parts) p.stop(); gain.disconnect(); },
    };
  }

  /** Tear down the saber voices — same lifetime problem as the jetpacks. */
  stopSabers(): void {
    for (let slot = 0; slot < this.saberNodes.length; slot++) {
      this.saberNodes[slot]?.stop();
      this.saberNodes[slot] = undefined;
    }
  }

  /**
   * Tear down the looping jetpack voices. They run forever once started — at
   * gain 0 between flights, but still a live source and filter in the graph for
   * every match the tab ever plays.
   */
  stopJetpacks(): void {
    for (let slot = 0; slot < this.jetpackNodes.length; slot++) {
      const node = this.jetpackNodes[slot];
      if (!node) continue;
      try { node.src.stop(); } catch { /* already stopped */ }
      node.gain.disconnect();
      this.jetpackNodes[slot] = undefined;
    }
  }

  /** Loop a decoded sample into the music bus; returns a stop fn. */
  private loopSample(name: SampleName, gain: number): (() => void) | null {
    const s = this.samples.get(name);
    if (!s || !this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = s;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.music);
    src.start();
    return () => src.stop();
  }

  /**
   * Ambient bed: the board's authored loop if present, else a synth bed —
   * `wind` (outdoor boards) or `hum` (industrial interiors and stations).
   */
  startAmbient(sample: string, bed: 'wind' | 'hum' = 'wind'): void {
    if (!this.ctx) return;
    this.stopAmbient();
    const kind = bed === 'wind' ? 'desert' : 'station';
    const sampled = this.loopSample(sample as SampleName, 0.4)
      ?? this.loopSample(kind === 'desert' ? 'amb_desert' : 'amb_station', 0.4);
    if (sampled) { this.ambientStop = sampled; return; }
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = kind === 'desert' ? 500 : 160;
    const g = ctx.createGain();
    g.gain.value = kind === 'desert' ? 0.055 : 0.05;
    // slow wind swell LFO
    const lfo = ctx.createOscillator();
    lfo.frequency.value = kind === 'desert' ? 0.13 : 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = kind === 'desert' ? 0.03 : 0.012;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(f).connect(g).connect(this.music);
    let hum: OscillatorNode | null = null;
    if (kind === 'station') {
      hum = ctx.createOscillator();
      hum.type = 'sawtooth';
      hum.frequency.value = 55;
      const hg = ctx.createGain();
      hg.gain.value = 0.02;
      hum.connect(hg).connect(this.music);
      hum.start();
    }
    src.start();
    lfo.start();
    this.ambientStop = () => { src.stop(); lfo.stop(); hum?.stop(); };
  }
  stopAmbient(): void { this.ambientStop?.(); this.ambientStop = null; }

  /**
   * Board music: streamed playlist if one exists for the board, else an
   * authored single loop, else a dark synth drone.
   */
  startMusic(kind: 'title' | 'desert' | 'station', board?: BoardId): void {
    if (!this.ctx) return;
    this.stopMusic();
    if (kind !== 'title') {
      // The board's signature track opens; its playlist is what follows.
      const { urls, hasLead } = playlistFor(kind, board);
      if (this.startPlaylist(urls, kind, hasLead ? 0 : -1)) return;
    }
    const name: SampleName = kind === 'title' ? 'music_title' : kind === 'desert' ? 'music_combat_desert' : 'music_combat_station';
    const sampled = this.loopSample(name, 0.5);
    if (sampled) { this.musicStop = sampled; return; }
    this.startSynthMusic(kind);
  }

  /**
   * Stream `urls` through the music bus on repeat, starting at `first` (any
   * index outside the list means start on a random track) and choosing at
   * random from there on. Returns false if the element can't be wired up at
   * all; if the files themselves fail to load we drop back to the synth drone
   * once every track has been tried.
   */
  private startPlaylist(urls: string[], kind: 'desert' | 'station', first = -1): boolean {
    const ctx = this.ctx!;
    if (!urls.length || typeof Audio === 'undefined') return false;
    const el = new Audio();
    el.preload = 'auto';
    let node: MediaElementAudioSourceNode;
    try { node = ctx.createMediaElementSource(el); } catch { return false; }
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.75, ctx.currentTime + 1.5);
    node.connect(g).connect(this.music);

    /** any track but the one playing, so nothing repeats back to back */
    const nextIndex = (): number => {
      if (urls.length < 2) return 0;
      const pick = Math.floor(Math.random() * (urls.length - 1));
      return pick >= index ? pick + 1 : pick;
    };
    let index = first >= 0 && first < urls.length ? first : Math.floor(Math.random() * urls.length);
    let failures = 0;
    let stopped = false;
    const teardown = () => {
      stopped = true;
      el.pause();
      el.removeAttribute('src');
      el.load();
      node.disconnect();
      g.disconnect();
    };
    const play = () => {
      el.src = urls[index];
      el.play().catch(() => { /* autoplay blocked; init() runs from a gesture */ });
    };
    el.addEventListener('ended', () => {
      if (stopped) return;
      failures = 0;
      index = nextIndex();
      play();
    });
    el.addEventListener('error', () => {
      if (stopped) return;
      if (++failures >= urls.length) { teardown(); this.musicStop = null; this.startSynthMusic(kind); return; }
      // Step on failure, so a dead file can't be re-picked forever.
      index = (index + 1) % urls.length;
      play();
    });
    el.addEventListener('canplay', () => { failures = 0; });
    play();
    this.musicStop = teardown;
    return true;
  }

  /** Last-resort music bed: a slow detuned drone, pitched per board. */
  private startSynthMusic(kind: 'title' | 'desert' | 'station'): void {
    const root = kind === 'station' ? 49 : 55;
    const ctx = this.ctx!;
    const stops: (() => void)[] = [];
    for (const [mult, gainV, type] of [[1, 0.045, 'sawtooth'], [1.5, 0.02, 'triangle'], [2.02, 0.014, 'sine']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = root * mult;
      const g = ctx.createGain();
      g.gain.value = gainV;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 700;
      o.connect(f).connect(g).connect(this.music);
      o.start();
      stops.push(() => o.stop());
    }
    this.musicStop = () => stops.forEach((s) => s());
  }
  stopMusic(): void { this.musicStop?.(); this.musicStop = null; }

  /**
   * Victory/defeat sting (sample only; wave sounds already cover fallback).
   * On the music bus, as its name says: on the SFX bus it played at SFX volume
   * — a third of the intended level with the shipped defaults — and ignored the
   * Music slider it should answer to.
   */
  sting(victory: boolean): void {
    this.playSample(victory ? 'music_victory' : 'music_defeat', 0.7, 1, this.music);
  }

  /**
   * Push `config.audio` onto the three buses. Called on init, and again by
   * anything that changes a volume at runtime.
   */
  applyConfig(): void {
    if (!this.ctx) return;
    this.master.gain.value = config.audio.master;
    this.sfx.gain.value = config.audio.sfx;
    this.music.gain.value = config.audio.music;
  }

  /** live bus gains, for a settings screen or a console tweak to read back */
  get volumes(): { master: number; sfx: number; music: number } {
    return this.ctx
      ? { master: this.master.gain.value, sfx: this.sfx.gain.value, music: this.music.gain.value }
      : { ...config.audio };
  }

  setMasterVolume(v: number): void { config.audio.master = v; this.applyConfig(); }
  setSfxVolume(v: number): void { config.audio.sfx = v; this.applyConfig(); }
  setMusicVolume(v: number): void { config.audio.music = v; this.applyConfig(); }
}

export const audio = new AudioEngine();
