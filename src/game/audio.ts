/* Fully synthesized WebAudio sound engine — no assets. */

type Ctx = AudioContext;

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private ambNodes: AudioNode[] = [];
  private clangTimer: number | null = null;
  private unlocked = false;

  unlock() {
    if (this.unlocked) {
      if (this.ctx?.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.unlocked = true;
  }

  get ready() {
    return !!this.ctx;
  }

  private out(): GainNode | null {
    return this.ctx ? this.master : null;
  }

  private noise(dur: number, vol: number, filterType: BiquadFilterType, f0: number, f1: number, q = 1, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(Math.max(20, f0), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    when = 0,
    lfoHz = 0,
    lfoDepth = 0
  ) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (lfoHz > 0) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const lg = this.ctx.createGain();
      lg.gain.value = lfoDepth;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur);
    }
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /* ---------- weapons ---------- */
  shot() {
    this.noise(0.34, 0.95, "lowpass", 3200, 160, 0.8);
    this.noise(0.12, 0.7, "bandpass", 1400, 500, 1.4);
    this.tone("sine", 130, 38, 0.3, 0.85);
    this.noise(0.5, 0.22, "lowpass", 900, 120, 0.7, 0.02); // cave echo tail
  }
  pump() {
    this.noise(0.045, 0.5, "highpass", 1800, 2400, 2);
    this.noise(0.05, 0.55, "highpass", 1200, 1800, 2, 0.13);
  }
  reloadShell() {
    this.noise(0.03, 0.4, "highpass", 2200, 2600, 3);
    this.tone("square", 320, 180, 0.05, 0.12, 0.01);
  }
  reloadClose() {
    this.noise(0.05, 0.5, "highpass", 900, 1400, 2);
    this.tone("square", 210, 120, 0.07, 0.14, 0.02);
  }
  dry() {
    this.noise(0.035, 0.35, "highpass", 2400, 2800, 4);
  }
  eject() {
    this.noise(0.06, 0.2, "highpass", 3000, 2000, 2, 0.05);
    this.tone("sine", 900, 400, 0.08, 0.06, 0.12);
  }

  /* ---------- combat ---------- */
  hitFlesh() {
    this.noise(0.09, 0.5, "lowpass", 1600, 300, 1);
    this.tone("sine", 240, 90, 0.08, 0.25);
  }
  hitStone() {
    this.noise(0.06, 0.4, "bandpass", 900, 500, 2);
  }
  hurt() {
    this.tone("sawtooth", 190, 60, 0.28, 0.4);
    this.noise(0.2, 0.4, "lowpass", 700, 120, 1);
  }
  kill() {
    this.tone("sawtooth", 160, 30, 0.5, 0.4, 0, 9, 60);
    this.noise(0.4, 0.5, "lowpass", 900, 90, 1);
  }
  growl(big = false) {
    const base = big ? 62 : 95;
    this.tone("sawtooth", base, base * 0.72, 0.55, 0.22, 0, 7, 18);
    this.tone("sawtooth", base * 1.5, base, 0.45, 0.12, 0.03, 11, 30);
  }
  skitter() {
    for (let i = 0; i < 5; i++) this.noise(0.03, 0.16, "highpass", 2600, 3200, 3, i * 0.055);
  }
  lunge() {
    this.noise(0.18, 0.4, "bandpass", 500, 1600, 1.5);
  }
  heartbeat() {
    this.tone("sine", 58, 40, 0.16, 0.5);
    this.tone("sine", 52, 36, 0.14, 0.4, 0.22);
  }
  step() {
    this.noise(0.07, 0.14, "lowpass", 500, 140, 1);
  }
  pickupShell() {
    this.tone("triangle", 620, 880, 0.09, 0.22);
    this.tone("triangle", 880, 1240, 0.1, 0.2, 0.07);
  }
  pickupTonic() {
    this.tone("sine", 300, 560, 0.14, 0.22);
    this.tone("sine", 560, 840, 0.16, 0.18, 0.09);
  }
  uiClick() {
    this.noise(0.04, 0.2, "highpass", 1600, 2200, 2);
  }

  /* ---------- mine ---------- */
  cageUnlock() {
    this.tone("square", 140, 140, 0.1, 0.16);
    this.tone("square", 187, 187, 0.12, 0.16, 0.12);
    this.tone("square", 235, 235, 0.2, 0.16, 0.24);
    this.noise(0.7, 0.16, "lowpass", 500, 150, 1, 0.05);
  }
  cageRide() {
    if (!this.ctx) return;
    for (let i = 0; i < 14; i++) {
      this.noise(0.05, 0.4, "highpass", 700, 1100, 2, i * 0.14);
      this.tone("square", 90 + (i % 3) * 12, 70, 0.1, 0.2, i * 0.14);
    }
    this.noise(2.2, 0.3, "lowpass", 300, 90, 1, 0.1);
    this.tone("sine", 55, 34, 2.2, 0.3, 0.1);
  }
  collapseRumble() {
    this.noise(1.4, 0.5, "lowpass", 240, 50, 0.8);
    this.tone("sine", 48, 26, 1.3, 0.4);
  }

  startAmbience() {
    if (!this.ctx || this.ambNodes.length) return;
    const t = this.ctx.currentTime;
    // deep drone
    const o1 = this.ctx.createOscillator();
    o1.type = "sawtooth";
    o1.frequency.value = 41;
    const o2 = this.ctx.createOscillator();
    o2.type = "sawtooth";
    o2.frequency.value = 41.7;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 130;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.055, t + 4);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = this.ctx.createGain();
    lg.gain.value = 0.028;
    lfo.connect(lg).connect(g.gain);
    o1.connect(f);
    o2.connect(f);
    f.connect(g).connect(this.master);
    o1.start();
    o2.start();
    lfo.start();
    // wind hiss
    const wsrc = this.ctx.createBufferSource();
    wsrc.buffer = this.noiseBuf;
    wsrc.loop = true;
    const wf = this.ctx.createBiquadFilter();
    wf.type = "bandpass";
    wf.frequency.value = 420;
    wf.Q.value = 0.6;
    const wg = this.ctx.createGain();
    wg.gain.value = 0.014;
    const wlfo = this.ctx.createOscillator();
    wlfo.frequency.value = 0.13;
    const wlg = this.ctx.createGain();
    wlg.gain.value = 0.01;
    wlfo.connect(wlg).connect(wg.gain);
    wsrc.connect(wf).connect(wg).connect(this.master);
    wsrc.start();
    wlfo.start();
    this.ambNodes.push(o1, o2, lfo, wsrc, wlfo);
    // distant random clangs / moans
    const loop = () => {
      this.clangTimer = window.setTimeout(() => {
        if (Math.random() < 0.5) {
          this.tone("triangle", 220 + Math.random() * 140, 90, 0.9, 0.05, 0, 5, 30);
          this.noise(0.5, 0.03, "lowpass", 800, 200, 1, 0.1);
        } else {
          this.tone("sawtooth", 70, 48, 1.4, 0.03, 0, 3, 10);
        }
        loop();
      }, 5000 + Math.random() * 9000);
    };
    loop();
  }

  stopAmbience() {
    if (this.clangTimer) {
      clearTimeout(this.clangTimer);
      this.clangTimer = null;
    }
    this.ambNodes.forEach((n) => {
      try {
        (n as OscillatorNode).stop();
      } catch {
        /* already stopped */
      }
      n.disconnect();
    });
    this.ambNodes = [];
  }
}
