/**
 * WebAudio engine. Short sounds are synthesized procedurally unless an authored file
 * exists at assets/audio/<name>.mp3 (see docs/ASSETS_AUDIO.md); board background music
 * is streamed from public/music/ as a playlist (see MUSIC_PLAYLISTS below).
 */

type SampleName =
  | 'blaster_shot' | 'enemy_blaster' | 'blaster_impact' | 'melee_whoosh' | 'melee_hit'
  | 'rocket_launch' | 'explosion' | 'hit_marker' | 'kill_confirm' | 'player_hurt'
  | 'jetpack_loop' | 'jetpack_ignite' | 'dash' | 'land_hard' | 'land_soft'
  | 'footstep_sand' | 'footstep_metal'
  | 'ui_move' | 'ui_confirm' | 'ui_back' | 'wave_start' | 'wave_clear'
  | 'tusken_cry' | 'pyke_chatter' | 'pyke_death' | 'pirate_taunt' | 'pirate_death'
  | 'droid_death' | 'swoop_pass'
  | 'imperial_bark' | 'imperial_death'
  | 'amb_desert' | 'amb_station'
  | 'music_title' | 'music_combat_desert' | 'music_combat_station' | 'music_victory' | 'music_defeat';

/** Enemy voice bark names — flavor sounds with no synth fallback. */
export type BarkName =
  | 'tusken_cry' | 'pyke_chatter' | 'pyke_death' | 'pirate_taunt' | 'pirate_death'
  | 'droid_death' | 'swoop_pass'
  | 'imperial_bark' | 'imperial_death';

/**
 * Authored background-music playlists, streamed rather than decoded up front:
 * these are multi-megabyte tracks, so they play through an <audio> element fed
 * into the music bus instead of a fully-decoded AudioBuffer. Each board picks a
 * random starting track and then cycles through the list forever.
 */
const MUSIC_PLAYLISTS: Record<'desert' | 'station', string[]> = {
  desert: ['music/bone-totem-march-1.mp3', 'music/bone-totem-march-2.mp3'],
  station: ['music/dust-beyond-orbit-1.mp3', 'music/dust-beyond-orbit-2.mp3'],
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private samples = new Map<string, AudioBuffer>();
  private jetpackNodes: { gain: GainNode; filter: BiquadFilterNode }[] = [];
  private ambientStop: (() => void) | null = null;
  private musicStop: (() => void) | null = null;
  private noiseBuf: AudioBuffer | null = null;

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) { this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.connect(this.master);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.4;
    this.music.connect(this.master);
    this.noiseBuf = this.makeNoise();
    this.tryLoadSamples();
  }

  get ready(): boolean { return !!this.ctx; }

  private async tryLoadSamples(): Promise<void> {
    const names: SampleName[] = [
      'blaster_shot', 'enemy_blaster', 'blaster_impact', 'melee_whoosh', 'melee_hit',
      'rocket_launch', 'explosion', 'hit_marker', 'kill_confirm', 'player_hurt',
      'jetpack_loop', 'jetpack_ignite', 'dash', 'land_hard', 'land_soft',
      'footstep_sand', 'footstep_metal',
      'ui_move', 'ui_confirm', 'ui_back', 'wave_start', 'wave_clear',
      'tusken_cry', 'pyke_chatter', 'pyke_death', 'pirate_taunt', 'pirate_death',
      'droid_death', 'swoop_pass',
      'imperial_bark', 'imperial_death',
      'amb_desert', 'amb_station',
      'music_title', 'music_combat_desert', 'music_combat_station', 'music_victory', 'music_defeat',
    ];
    await Promise.all(names.map(async (n) => {
      // mp3 first: that's what tools/generate-sfx.mjs ships, so the common
      // case is one request instead of a 404 probe per sample.
      for (const ext of ['mp3', 'ogg']) {
        try {
          const res = await fetch(`assets/audio/${n}.${ext}`);
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

  private playSample(name: SampleName, gain = 1, rate = 1): boolean {
    const s = this.samples.get(name);
    if (!s || !this.ctx) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = s;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.sfx);
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

  blaster(): void {
    if (!this.ctx || this.playSample('blaster_shot', 0.7)) return;
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
  melee(step: number): void {
    if (!this.ctx || this.playSample('melee_whoosh', 0.6, 0.9 + step * 0.12)) return;
    this.burst(0.16, 0.22, 500 + step * 200, 0, 0.7);
  }
  meleeHit(): void {
    if (!this.ctx || this.playSample('melee_hit', 0.8)) return;
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
  footstep(surface: 'sand' | 'metal'): void {
    if (!this.ctx) return;
    const rate = 0.9 + Math.random() * 0.25;
    if (this.playSample(surface === 'sand' ? 'footstep_sand' : 'footstep_metal', 0.3, rate)) return;
    this.burst(0.05, 0.07, surface === 'sand' ? 900 : 500, 0, 1.2);
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
    if (!node) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.samples.get('jetpack_loop') ?? this.noiseBuf;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.sfx);
      src.start();
      node = { gain, filter };
      this.jetpackNodes[slot] = node;
    }
    const t = this.ctx.currentTime;
    node.gain.gain.setTargetAtTime(thrust * 0.34, t, 0.05);
    node.filter.frequency.setTargetAtTime(300 + thrust * 1700, t, 0.06);
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

  /** Ambient bed: authored loop if present, else synth wind/hum. */
  startAmbient(kind: 'desert' | 'station'): void {
    if (!this.ctx) return;
    this.stopAmbient();
    const sampled = this.loopSample(kind === 'desert' ? 'amb_desert' : 'amb_station', 0.4);
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
  startMusic(kind: 'title' | 'desert' | 'station'): void {
    if (!this.ctx) return;
    this.stopMusic();
    if (kind !== 'title' && this.startPlaylist(MUSIC_PLAYLISTS[kind], kind)) return;
    const name: SampleName = kind === 'title' ? 'music_title' : kind === 'desert' ? 'music_combat_desert' : 'music_combat_station';
    const sampled = this.loopSample(name, 0.5);
    if (sampled) { this.musicStop = sampled; return; }
    this.startSynthMusic(kind);
  }

  /**
   * Stream `urls` through the music bus, one after another on repeat. Returns
   * false if the element can't be wired up at all; if the files themselves fail
   * to load we drop back to the synth drone once every track has been tried.
   */
  private startPlaylist(urls: string[], kind: 'desert' | 'station'): boolean {
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

    let index = Math.floor(Math.random() * urls.length);
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
      index = (index + 1) % urls.length;
      play();
    });
    el.addEventListener('error', () => {
      if (stopped) return;
      if (++failures >= urls.length) { teardown(); this.musicStop = null; this.startSynthMusic(kind); return; }
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

  /** Victory/defeat sting (sample only; wave sounds already cover fallback). */
  sting(victory: boolean): void {
    this.playSample(victory ? 'music_victory' : 'music_defeat', 0.7);
  }

  setMasterVolume(v: number): void { if (this.master) this.master.gain.value = v; }
}

export const audio = new AudioEngine();
