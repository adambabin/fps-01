import { Vector3 } from 'three';

export type ShotKind = 'pistol' | 'rifle' | 'shotgun' | 'rail' | 'smg' | 'launcher';

interface NoiseOpts { gain: number; dur: number; freq: number; freqEnd?: number; q?: number; type?: BiquadFilterType; pan?: number; delay?: number; attack?: number; }
interface ToneOpts { gain: number; dur: number; freq: number; freqEnd?: number; type?: OscillatorType; pan?: number; delay?: number; attack?: number; }

/** All sound is synthesized with the Web Audio API; there are no audio files. */
export class AudioSys {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private ambient: GainNode | null = null;
  private lp = new Vector3();
  private lr = new Vector3(1, 0, 0);
  volume = 0.7;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setListener(pos: Vector3, right: Vector3) { this.lp.copy(pos); this.lr.copy(right); }

  private out(pan: number | undefined): AudioNode {
    const ctx = this.ctx!;
    if (!pan || !ctx.createStereoPanner) return this.master;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    return p;
  }

  private noise(o: NoiseOpts) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    f.Q.value = o.q ?? 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f).connect(g).connect(this.out(o.pan));
    src.start(t, Math.random() * 1.5, o.dur + 0.05);
  }

  private tone(o: ToneOpts) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g).connect(this.out(o.pan));
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }

  /** Distance attenuation and stereo pan for a world position. */
  private spatial(pos: Vector3): { g: number; pan: number } {
    const dx = pos.x - this.lp.x, dy = pos.y - this.lp.y, dz = pos.z - this.lp.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const pan = d > 0.01 ? (dx * this.lr.x + dy * this.lr.y + dz * this.lr.z) / d : 0;
    return { g: 1 / (1 + d * 0.11), pan: pan * 0.8 };
  }

  shot(kind: ShotKind) {
    if (kind === 'pistol') {
      this.noise({ gain: 0.55, dur: 0.13, freq: 5200, freqEnd: 700 });
      this.tone({ gain: 0.5, dur: 0.1, freq: 210, freqEnd: 60 });
    } else if (kind === 'rifle') {
      this.noise({ gain: 0.5, dur: 0.11, freq: 6500, freqEnd: 900 });
      this.noise({ gain: 0.25, dur: 0.22, freq: 1400, freqEnd: 300, type: 'bandpass' });
      this.tone({ gain: 0.45, dur: 0.09, freq: 170, freqEnd: 55, type: 'triangle' });
    } else if (kind === 'smg') {
      this.noise({ gain: 0.4, dur: 0.07, freq: 7800, freqEnd: 1400 });
      this.tone({ gain: 0.3, dur: 0.06, freq: 240, freqEnd: 90, type: 'triangle' });
    } else if (kind === 'launcher') {
      this.tone({ gain: 0.9, dur: 0.22, freq: 190, freqEnd: 48 });
      this.noise({ gain: 0.45, dur: 0.16, freq: 1300, freqEnd: 220 });
      this.noise({ gain: 0.2, dur: 0.05, freq: 2600, type: 'bandpass', q: 5, delay: 0.3 });
    } else if (kind === 'shotgun') {
      this.noise({ gain: 0.9, dur: 0.3, freq: 3800, freqEnd: 260 });
      this.tone({ gain: 0.8, dur: 0.22, freq: 130, freqEnd: 38 });
      this.noise({ gain: 0.2, dur: 0.08, freq: 2400, type: 'bandpass', q: 4, delay: 0.42 });
      this.noise({ gain: 0.2, dur: 0.08, freq: 1800, type: 'bandpass', q: 4, delay: 0.56 });
    } else {
      this.tone({ gain: 0.5, dur: 0.5, freq: 1900, freqEnd: 90, type: 'sawtooth' });
      this.noise({ gain: 0.7, dur: 0.45, freq: 9000, freqEnd: 400 });
      this.tone({ gain: 0.8, dur: 0.35, freq: 90, freqEnd: 30 });
    }
  }

  dryFire() { this.noise({ gain: 0.2, dur: 0.03, freq: 3000, type: 'bandpass', q: 6 }); }

  reload(dur: number) {
    this.noise({ gain: 0.22, dur: 0.05, freq: 1800, type: 'bandpass', q: 5, delay: dur * 0.18 });
    this.noise({ gain: 0.26, dur: 0.06, freq: 1200, type: 'bandpass', q: 5, delay: dur * 0.6 });
    this.noise({ gain: 0.3, dur: 0.05, freq: 2600, type: 'bandpass', q: 7, delay: dur * 0.88 });
  }

  swap() { this.noise({ gain: 0.14, dur: 0.09, freq: 900, type: 'bandpass', q: 2 }); }

  hit(crit: boolean) {
    this.tone({ gain: 0.16, dur: 0.05, freq: crit ? 1900 : 1250, type: 'square' });
    if (crit) this.tone({ gain: 0.12, dur: 0.07, freq: 2700, type: 'square', delay: 0.03 });
  }

  kill() {
    this.tone({ gain: 0.2, dur: 0.12, freq: 700, freqEnd: 1400, type: 'triangle' });
    this.tone({ gain: 0.16, dur: 0.16, freq: 1050, freqEnd: 2100, type: 'triangle', delay: 0.06 });
  }

  impact(pos: Vector3) {
    const s = this.spatial(pos);
    this.noise({ gain: 0.18 * s.g, dur: 0.05, freq: 3500, type: 'bandpass', q: 3, pan: s.pan });
  }

  enemyShot(pos: Vector3, heavy = false) {
    const s = this.spatial(pos);
    if (heavy) {
      this.noise({ gain: 0.7 * s.g, dur: 0.4, freq: 1600, freqEnd: 200, pan: s.pan });
      this.tone({ gain: 0.5 * s.g, dur: 0.3, freq: 160, freqEnd: 50, pan: s.pan, type: 'sawtooth' });
    } else {
      this.tone({ gain: 0.4 * s.g, dur: 0.14, freq: 1100, freqEnd: 240, type: 'sawtooth', pan: s.pan });
      this.noise({ gain: 0.2 * s.g, dur: 0.08, freq: 4000, freqEnd: 1000, pan: s.pan });
    }
  }

  explosion(pos: Vector3, big = true) {
    const s = this.spatial(pos), k = (big ? 1.2 : 0.6) * Math.max(0.15, s.g * 2);
    this.noise({ gain: Math.min(1.2, k), dur: big ? 0.9 : 0.45, freq: 2600, freqEnd: 90, pan: s.pan });
    this.tone({ gain: Math.min(1.1, k), dur: big ? 0.6 : 0.3, freq: 110, freqEnd: 26, pan: s.pan });
  }

  /** Rising whine while the boss charges its ground pulse. */
  charge(pos: Vector3) {
    const s = this.spatial(pos), g = Math.max(0.25, s.g * 2);
    this.tone({ gain: 0.45 * g, dur: 1.2, freq: 110, freqEnd: 880, type: 'sawtooth', pan: s.pan, attack: 0.3 });
    this.tone({ gain: 0.3 * g, dur: 1.2, freq: 164, freqEnd: 1320, type: 'square', pan: s.pan, attack: 0.5 });
  }
  alarm() {
    for (let i = 0; i < 3; i++) {
      this.tone({ gain: 0.32, dur: 0.38, freq: 520, freqEnd: 300, type: 'sawtooth', delay: i * 0.55, attack: 0.04 });
      this.tone({ gain: 0.2, dur: 0.38, freq: 780, freqEnd: 450, type: 'square', delay: i * 0.55, attack: 0.04 });
    }
  }

  robotDeath(pos: Vector3) {
    const s = this.spatial(pos);
    this.tone({ gain: 0.35 * s.g, dur: 0.35, freq: 520, freqEnd: 50, type: 'sawtooth', pan: s.pan });
    this.noise({ gain: 0.5 * s.g, dur: 0.3, freq: 3000, freqEnd: 200, pan: s.pan });
  }

  melee(pos: Vector3) {
    const s = this.spatial(pos);
    this.noise({ gain: 0.5 * s.g, dur: 0.12, freq: 900, freqEnd: 200, pan: s.pan });
  }

  step(sprint: boolean) {
    this.noise({ gain: sprint ? 0.11 : 0.07, dur: 0.07, freq: 500 + Math.random() * 250, freqEnd: 140 });
    this.tone({ gain: 0.05, dur: 0.05, freq: 95, freqEnd: 55 });
  }
  jump() { this.noise({ gain: 0.08, dur: 0.1, freq: 700, freqEnd: 300 }); }
  land(hard: number) {
    this.noise({ gain: 0.1 + hard * 0.2, dur: 0.14, freq: 600, freqEnd: 110 });
    this.tone({ gain: 0.12 + hard * 0.2, dur: 0.12, freq: 85, freqEnd: 40 });
  }
  hurt() {
    this.noise({ gain: 0.4, dur: 0.16, freq: 700, freqEnd: 150 });
    this.tone({ gain: 0.3, dur: 0.2, freq: 150, freqEnd: 70, type: 'square' });
  }
  pickup(kind: number) {
    const base = [660, 520, 440, 380][kind] || 500;
    this.tone({ gain: 0.18, dur: 0.1, freq: base, type: 'triangle' });
    this.tone({ gain: 0.18, dur: 0.16, freq: base * 1.5, type: 'triangle', delay: 0.07 });
  }
  ui() { this.tone({ gain: 0.1, dur: 0.05, freq: 880, type: 'triangle' }); }
  upgrade() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone({ gain: 0.16, dur: 0.22, freq: f, type: 'triangle', delay: i * 0.07 }));
  }
  waveStart() {
    this.tone({ gain: 0.3, dur: 0.5, freq: 220, type: 'sawtooth', attack: 0.05 });
    this.tone({ gain: 0.3, dur: 0.7, freq: 165, type: 'sawtooth', delay: 0.35, attack: 0.05 });
  }
  waveClear() {
    [392, 494, 587].forEach((f, i) => this.tone({ gain: 0.2, dur: 0.4, freq: f, type: 'triangle', delay: i * 0.12 }));
  }
  grenadeBounce(pos: Vector3) {
    const s = this.spatial(pos);
    this.tone({ gain: 0.2 * s.g, dur: 0.04, freq: 1400, type: 'square', pan: s.pan });
  }

  /** Low machinery drone under everything. */
  startAmbient() {
    const ctx = this.ctx; if (!ctx || this.ambient) return;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.5, ctx.currentTime, 1.5);
    g.connect(this.master);
    this.ambient = g;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
    lp.connect(g);
    for (const f of [41, 41.6, 62]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = 0.09;
      o.connect(og).connect(lp); o.start();
    }
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 0.5;
    const ng = ctx.createGain(); ng.gain.value = 0.035;
    n.connect(bp).connect(ng).connect(g); n.start();
  }
}
