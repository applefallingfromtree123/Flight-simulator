// Procedural audio: engine/rotor/wind noise synthesised with WebAudio, warning tones,
// and GPWS / radio-altimeter voice callouts via the Web Speech API.
import { KT, clamp } from '../core/math.ts';
import type { Aircraft } from '../sim/fdm.ts';

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private eng: { osc: OscillatorNode; osc2: OscillatorNode; og: GainNode; noise: AudioBufferSourceNode; nf: BiquadFilterNode; ng: GainNode }[] = [];
  private wind!: { g: GainNode; f: BiquadFilterNode };
  private roll!: { g: GainNode; f: BiquadFilterNode };
  private rotorLfo: GainNode | null = null;
  private tone: OscillatorNode | null = null; private toneG: GainNode | null = null;
  volume = 0.7;
  muted = false;
  private lastSpeak = 0;
  private voice: SpeechSynthesisVoice | null = null;

  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = 0.98 * b + 0.02 * (Math.random() * 2 - 1); d[i] = b * 6; }
    const mkNoise = (type: BiquadFilterType, f: number) => {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(flt).connect(g).connect(this.master); src.start();
      return { g, f: flt };
    };
    this.wind = mkNoise('bandpass', 800);
    this.roll = mkNoise('lowpass', 200);
    this.toneG = ctx.createGain(); this.toneG.gain.value = 0; this.toneG.connect(this.master);
    this.tone = ctx.createOscillator(); this.tone.type = 'square'; this.tone.frequency.value = 900; this.tone.connect(this.toneG); this.tone.start();
    const voices = () => { this.voice = speechSynthesis.getVoices().find(v => /en[-_]US/i.test(v.lang) && /male|david|guy|daniel|google us/i.test(v.name)) ?? speechSynthesis.getVoices().find(v => v.lang.startsWith('en')) ?? null; };
    if ('speechSynthesis' in window) { voices(); speechSynthesis.onvoiceschanged = voices; }
  }

  setupAircraft(ac: Aircraft) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (const e of this.eng) { e.osc.stop(); e.osc2.stop(); e.noise.stop(); e.og.disconnect(); e.ng.disconnect(); }
    this.eng = [];
    if (this.rotorLfo) { this.rotorLfo.disconnect(); this.rotorLfo = null; }
    const n = Math.max(1, Math.min(ac.engines.length, 4));
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator(); const osc2 = ctx.createOscillator();
      const t = ac.def.eng.t;
      osc.type = t === 'prop' ? 'sawtooth' : t === 'tprop' || t === 'shaft' ? 'triangle' : 'sine';
      osc2.type = t === 'prop' ? 'square' : 'sine';
      const og = ctx.createGain(); og.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = t === 'prop' ? 900 : 5000;
      osc.connect(lp); osc2.connect(lp); lp.connect(og).connect(this.master);
      const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuf; noise.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.6; nf.frequency.value = 400;
      const ng = ctx.createGain(); ng.gain.value = 0;
      noise.connect(nf).connect(ng).connect(this.master);
      osc.start(); osc2.start(); noise.start();
      this.eng.push({ osc, osc2, og, noise, nf, ng });
    }
  }

  update(ac: Aircraft, cockpitView: boolean, paused: boolean, events: string[]) {
    if (!this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted || paused ? 0 : this.volume, now, 0.1);
    const inside = cockpitView ? (ac.def.cat === 'ga' || ac.def.cat === 'vintage' || ac.isRotor ? 0.8 : 0.45) : 1;
    const t = ac.def.eng.t;
    this.eng.forEach((s, i) => {
      const e = ac.engines[Math.min(i, ac.engines.length - 1)];
      if (!e) return;
      let f1 = 0, f2 = 0, tone = 0, noise = 0, nfq = 400;
      if (t === 'fan' || t === 'jet') {
        const n1 = e.n1 / 100, n2 = e.n2 / 100;
        f1 = 40 + n1 * (t === 'jet' ? 90 : 60) * 4; f2 = 2000 + n2 * 3500;
        tone = (0.03 + 0.05 * n2) * (e.n2 > 5 ? 1 : 0);
        noise = (0.05 + 0.5 * n1 * n1 + 0.5 * e.ab) * (e.n2 > 5 ? 1 : 0);
        nfq = 150 + n1 * 900 + e.ab * 400;
      } else if (t === 'prop') {
        const bp = (e.rpm / 60) * (e.def.blades ?? 2);
        f1 = Math.max(20, bp); f2 = (e.rpm / 60) * 2;
        tone = e.rpm > 100 ? 0.08 + 0.14 * (e.power / (e.def.p * 1000)) : 0;
        noise = tone * 0.8; nfq = 300 + e.rpm * 0.2;
      } else if (t === 'tprop' || t === 'shaft') {
        f1 = 120 + e.ng * 4; f2 = ac.isRotor ? 2400 + e.ng * 20 : (e.np / 100) * 1700 / 60 * (e.def.blades ?? 4) * 4;
        tone = e.ng > 5 ? 0.04 + 0.05 * (e.ng / 100) : 0;
        noise = e.ng > 5 ? 0.1 + 0.35 * e.spool : 0; nfq = 300 + e.ng * 8;
      }
      s.osc.frequency.setTargetAtTime(f1, now, 0.08);
      s.osc2.frequency.setTargetAtTime(f2, now, 0.08);
      s.og.gain.setTargetAtTime(tone * inside / Math.sqrt(this.eng.length), now, 0.1);
      s.ng.gain.setTargetAtTime(noise * inside * 0.5 / Math.sqrt(this.eng.length), now, 0.1);
      s.nf.frequency.setTargetAtTime(nfq, now, 0.1);
    });
    // rotor slap: amplitude-modulate the first engine's noise at blade-pass frequency
    if (ac.isRotor && this.eng[0]) {
      const bpf = ac.rotorRpm * (ac.def.rotor!.blades) * 6.5;
      if (!this.rotorLfo) {
        const lfo = ctx.createOscillator(); lfo.type = 'sine';
        const g = ctx.createGain(); g.gain.value = 0;
        lfo.connect(g); g.connect(this.eng[0].ng.gain); lfo.start();
        this.rotorLfo = g; (this.rotorLfo as unknown as { osc: OscillatorNode }).osc = lfo;
      }
      (this.rotorLfo as unknown as { osc: OscillatorNode }).osc.frequency.setTargetAtTime(Math.max(1, bpf), now, 0.1);
      this.rotorLfo.gain.setTargetAtTime(ac.rotorRpm * 0.35 * inside, now, 0.1);
    }
    const ias = ac.ias / KT;
    this.wind.g.gain.setTargetAtTime(clamp((ias - 30) / 300, 0, 1) * 0.35 * (cockpitView ? 0.5 : 1), now, 0.2);
    this.wind.f.frequency.setTargetAtTime(400 + ias * 4, now, 0.2);
    this.roll.g.gain.setTargetAtTime(ac.onGround ? clamp(ac.gs / 40, 0, 1) * 0.4 : 0, now, 0.1);
    // warning tones
    let beep = 0, freq = 900;
    for (const ev of events) {
      if (ev.startsWith('say:')) this.say(ev.slice(4));
      else if (ev === 'stall') { beep = Math.sin(now * 40) > 0 ? 0.25 : 0; freq = 480; }
      else if (ev === 'overspeed') { beep = Math.sin(now * 25) > 0.3 ? 0.18 : 0; freq = 1300; }
      else if (ev === 'altalert') this.chime([880, 1320], 0.25);
      else if (ev === 'master') this.chime([660, 660], 0.2);
      else if (ev === 'apoff') this.chime([1200, 900, 1200, 900], 0.12);
      else if (ev === 'touchdown') this.thump();
    }
    this.toneG!.gain.setTargetAtTime(beep, now, 0.01);
    this.tone!.frequency.setValueAtTime(freq, now);
  }
  chime(freqs: number[], dur: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      const t0 = ctx.currentTime + i * dur;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.25, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 1.5);
      o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + dur * 1.6);
    });
  }
  thump() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 120;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    src.connect(f).connect(g).connect(this.master); src.start(); src.stop(ctx.currentTime + 0.6);
  }
  say(text: string) {
    if (this.muted || !('speechSynthesis' in window)) return;
    const now = performance.now();
    if (now - this.lastSpeak < 700 && !/^\d+$/.test(text)) return;
    this.lastSpeak = now;
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = 1.15; u.pitch = 0.85; u.volume = this.volume;
    if (/^\d+$/.test(text)) speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}
