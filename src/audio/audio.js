// Prozedurale Sounds (Web Audio API): Motor nach Drehzahl, Wind, Schritte, Zombies, Schüsse, Hupe …
import { clamp } from '../core/rng.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.ready = false;
    this.horn = null;
    this.engine = null;
    this.wind = null;
    this.noiseBuf = null;
    this.fire = null;
    this.radio = { station: 0, next: 0, step: 0, out: null };
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      // Rauschpuffer (2 s)
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._buildWind();
      this._buildEngine();
      this._buildFire();
      this.ready = true;
    } catch (e) {
      console.warn('Audio nicht verfügbar', e);
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  _noise(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = loop;
    return s;
  }

  _buildWind() {
    const c = this.ctx;
    const src = this._noise();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.6;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start();
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.18;
    const lg = c.createGain();
    lg.gain.value = 180;
    lfo.connect(lg);
    lg.connect(bp.frequency);
    lfo.start();
    this.wind = { g, bp };
  }

  _buildFire() {
    const c = this.ctx;
    const src = this._noise();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(hp);
    hp.connect(g);
    g.connect(this.master);
    src.start();
    this.fire = { g };
  }

  _buildEngine() {
    const c = this.ctx;
    const o1 = c.createOscillator();
    o1.type = 'sawtooth';
    const o2 = c.createOscillator();
    o2.type = 'square';
    const o3 = c.createOscillator();
    o3.type = 'sawtooth';
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.Q.value = 2.5;
    const g1 = c.createGain();
    g1.gain.value = 0.5;
    const g2 = c.createGain();
    g2.gain.value = 0.22;
    const g3 = c.createGain();
    g3.gain.value = 0.18;
    const out = c.createGain();
    out.gain.value = 0;
    const pan = c.createStereoPanner();
    o1.connect(g1);
    o2.connect(g2);
    o3.connect(g3);
    g1.connect(lp);
    g2.connect(lp);
    g3.connect(lp);
    // Rumpelrauschen
    const n = this._noise();
    const nlp = c.createBiquadFilter();
    nlp.type = 'lowpass';
    nlp.frequency.value = 300;
    const ng = c.createGain();
    ng.gain.value = 0.35;
    n.connect(nlp);
    nlp.connect(ng);
    ng.connect(lp);
    lp.connect(out);
    out.connect(pan);
    pan.connect(this.master);
    o1.start();
    o2.start();
    o3.start();
    n.start();
    this.engine = { o1, o2, o3, lp, out, pan, ng };
    // Reifenquietschen / Sand
    const sk = this._noise();
    const skf = c.createBiquadFilter();
    skf.type = 'bandpass';
    skf.frequency.value = 1100;
    skf.Q.value = 1.5;
    const skg = c.createGain();
    skg.gain.value = 0;
    sk.connect(skf);
    skf.connect(skg);
    skg.connect(this.master);
    sk.start();
    this.skid = { g: skg, f: skf };
  }

  // ------------------------------------------------------------ Autoradio
  static STATIONS = ['Aus', 'Dust FM 88.1', 'Roadkill Rock 101.7', 'Rauschen 1620 AM'];

  setStation(n) {
    this.radio.station = n % AudioEngine.STATIONS.length;
    this.radio.step = 0;
    if (this.ready) this.radio.next = this.ctx.currentTime + 0.1;
    return AudioEngine.STATIONS[this.radio.station];
  }

  _radioOut() {
    if (!this.radio.out) {
      const c = this.ctx;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 140;
      const g = c.createGain();
      g.gain.value = 0;
      lp.connect(hp);
      hp.connect(g);
      g.connect(this.master);
      this.radio.out = { in: lp, g };
    }
    return this.radio.out;
  }

  _note(dest, f, t, dur, type, gain) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _radioTick(on, inCar) {
    const R = this.radio;
    const out = this._radioOut();
    const c = this.ctx;
    out.g.gain.setTargetAtTime(on && R.station ? (inCar ? 0.5 : 0.12) : 0, c.currentTime, 0.1);
    if (!on || !R.station) return;
    const A = (m) => 220 * Math.pow(2, m / 12);
    while (R.next < c.currentTime + 0.35) {
      const t = Math.max(R.next, c.currentTime);
      const i = R.step++;
      if (R.station === 1) {
        // ruhiger Wüsten-Arpeggio-Sound in A-Moll-Pentatonik
        const scale = [0, 3, 7, 10, 12, 15, 19];
        const prog = [0, -2, -4, -5];
        const bar = Math.floor(i / 8) % 4;
        const n = scale[[0, 2, 4, 2, 5, 4, 2, 1][i % 8]] + prog[bar];
        this._note(out.in, A(n + 12), t, 0.9, 'triangle', 0.22);
        if (i % 8 === 0) {
          this._note(out.in, A(prog[bar] - 12), t, 3.2, 'sine', 0.35);
          this._note(out.in, A(prog[bar] + 7), t, 3.2, 'triangle', 0.1);
        }
        R.next += 0.42;
      } else if (R.station === 2) {
        // Rock-Riff: Bass + Powerchords + Hi-Hat
        const riff = [0, 0, 3, 0, 5, 3, 0, -2];
        const n = riff[i % 8];
        this._note(out.in, A(n - 24), t, 0.2, 'sawtooth', 0.4);
        if (i % 2 === 0) {
          this._note(out.in, A(n - 12), t, 0.28, 'square', 0.12);
          this._note(out.in, A(n - 5), t, 0.28, 'square', 0.1);
        }
        if (i % 4 === 0) this._tone(out.in, { f0: 150, f1: 45, dur: 0.18, gain: 0.7, delay: t - c.currentTime });
        else if (i % 4 === 2) this._burst(out.in, { dur: 0.12, f0: 2500, f1: 900, type: 'bandpass', gain: 0.45, delay: t - c.currentTime });
        this._burst(out.in, { dur: 0.04, f0: 9000, f1: 7000, type: 'highpass', gain: 0.18, delay: t - c.currentTime });
        R.next += 0.25;
      } else {
        // Rauschen mit gelegentlichem Zahlenfunk-Piepen
        this._burst(out.in, { dur: 0.5, f0: 1500 + Math.random() * 1500, f1: 800, type: 'bandpass', q: 0.4, gain: 0.35, delay: t - c.currentTime });
        if (i % 6 === 3) for (let k = 0; k < 3; k++) this._note(out.in, 880 + (i % 4) * 110, t + k * 0.22, 0.12, 'sine', 0.3);
        R.next += 0.5;
      }
    }
  }

  /** Dauerhafte Klänge. s: {car:{on,rpm,load,speed,skid,dist,inCar}, storm, speed, fire, night} */
  update(dt, s) {
    if (!this.ready) return;
    const c = this.ctx;
    const t = c.currentTime;
    // Hörer
    const L = c.listener;
    if (L.positionX) {
      L.positionX.value = s.pos.x;
      L.positionY.value = s.pos.y;
      L.positionZ.value = s.pos.z;
      L.forwardX.value = s.fwd.x;
      L.forwardY.value = s.fwd.y;
      L.forwardZ.value = s.fwd.z;
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    }
    this._radioTick(!!s.radioOk, !!s.inCar);
    // Wind
    const w = clamp(0.05 + s.storm * 0.55 + Math.min(1, (s.carSpeed || 0) / 40) * (s.inCar ? 0.12 : 0.2), 0, 0.8);
    this.wind.g.gain.setTargetAtTime(w * 0.35, t, 0.4);
    this.wind.bp.frequency.setTargetAtTime(380 + s.storm * 700 + (s.carSpeed || 0) * 12, t, 0.5);
    // Feuer
    this.fire.g.gain.setTargetAtTime(clamp(s.fire || 0, 0, 1) * 0.07, t, 0.3);
    // Motor
    const car = s.car;
    const e = this.engine;
    if (car && car.on) {
      const rpm = Math.max(car.rpm, 700);
      const f = (rpm / 60) * 4;
      e.o1.frequency.setTargetAtTime(f, t, 0.04);
      e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
      e.o3.frequency.setTargetAtTime(f * 2.01, t, 0.04);
      const cutoff = (s.inCar ? 380 : 700) + rpm * (s.inCar ? 0.35 : 0.55) + car.load * 500;
      e.lp.frequency.setTargetAtTime(cutoff, t, 0.05);
      const dist = car.dist || 0;
      const att = s.inCar ? 1 : clamp(1 / (1 + dist / 14), 0, 1) * (dist > 160 ? 0 : 1);
      e.out.gain.setTargetAtTime((0.06 + 0.1 * car.load + 0.05 * (rpm / 6000)) * att * (s.inCar ? 0.8 : 1), t, 0.08);
      e.pan.pan.setTargetAtTime(s.inCar ? 0 : clamp(car.pan || 0, -1, 1), t, 0.1);
    } else {
      e.out.gain.setTargetAtTime(0, t, 0.15);
    }
    // Reifen
    if (car) {
      const sk = clamp(car.skid || 0, 0, 1) * clamp((car.speedAbs || 0) / 8, 0, 1);
      const att = s.inCar ? 1 : clamp(1 / (1 + (car.dist || 0) / 12), 0, 1);
      this.skid.g.gain.setTargetAtTime(sk * 0.14 * att, t, 0.08);
      this.skid.f.frequency.setTargetAtTime(700 + (car.speedAbs || 0) * 18, t, 0.1);
    }
  }

  _out(pos, vol = 1) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = vol;
    if (pos && c.createPanner) {
      const p = c.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 5;
      p.rolloffFactor = 1.3;
      p.maxDistance = 400;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      }
      g.connect(p);
      p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  _burst(out, { dur = 0.2, f0 = 3000, f1 = 300, type = 'lowpass', q = 0.7, gain = 1, delay = 0 }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const s = this._noise(false);
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(out);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  _tone(out, { f0, f1, dur, type = 'sine', gain = 0.5, delay = 0 }) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name, opts = {}) {
    if (!this.ready) return;
    const c = this.ctx;
    const pos = opts.pos;
    const v = opts.vol ?? 1;
    try {
      switch (name) {
        case 'step': {
          const o = this._out(null, 0.5 * v);
          const rock = opts.surf === 1;
          this._burst(o, { dur: 0.09, f0: rock ? 2400 : 1400, f1: rock ? 600 : 300, type: 'bandpass', q: 0.8, gain: 0.8 });
          this._tone(o, { f0: 110, f1: 60, dur: 0.08, gain: 0.25 });
          break;
        }
        case 'jump':
          this._burst(this._out(null, 0.3 * v), { dur: 0.12, f0: 900, f1: 200, gain: 0.6 });
          break;
        case 'land':
          this._burst(this._out(null, 0.6 * v), { dur: 0.18, f0: 1200, f1: 120, gain: 1 });
          this._tone(this._out(null, 0.5 * v), { f0: 90, f1: 40, dur: 0.2, gain: 0.6 });
          break;
        case 'pickup':
          this._tone(this._out(pos, 0.3 * v), { f0: 600, f1: 900, dur: 0.07, type: 'triangle', gain: 0.5 });
          this._tone(this._out(pos, 0.3 * v), { f0: 900, f1: 1200, dur: 0.07, type: 'triangle', gain: 0.4, delay: 0.06 });
          break;
        case 'drop':
          this._burst(this._out(pos, 0.5 * v), { dur: 0.12, f0: 1500, f1: 150, gain: 0.8 });
          this._tone(this._out(pos, 0.4 * v), { f0: 160, f1: 70, dur: 0.12, gain: 0.5 });
          break;
        case 'click':
          this._tone(this._out(null, 0.25 * v), { f0: 800, f1: 500, dur: 0.04, type: 'square', gain: 0.4 });
          break;
        case 'eat': {
          const o = this._out(null, 0.6 * v);
          for (let i = 0; i < 4; i++) this._burst(o, { dur: 0.07, f0: 1800, f1: 500, type: 'bandpass', gain: 0.7, delay: i * 0.16 });
          break;
        }
        case 'drink': {
          const o = this._out(null, 0.5 * v);
          for (let i = 0; i < 3; i++) this._tone(o, { f0: 300 + i * 80, f1: 500 + i * 120, dur: 0.14, gain: 0.35, delay: i * 0.2 });
          this._burst(o, { dur: 0.5, f0: 3000, f1: 2500, type: 'highpass', gain: 0.15 });
          break;
        }
        case 'heal':
          this._tone(this._out(null, 0.4 * v), { f0: 500, f1: 900, dur: 0.4, type: 'triangle', gain: 0.5 });
          break;
        case 'fuel':
          this._burst(this._out(pos, 0.4 * v), { dur: 0.25, f0: 1200, f1: 800, type: 'bandpass', q: 0.5, gain: 0.8 });
          break;
        case 'install': {
          const o = this._out(pos, 0.7 * v);
          this._tone(o, { f0: 220, f1: 90, dur: 0.15, type: 'square', gain: 0.4 });
          this._burst(o, { dur: 0.1, f0: 4000, f1: 1000, type: 'highpass', gain: 0.7, delay: 0.05 });
          this._tone(o, { f0: 440, f1: 880, dur: 0.15, type: 'triangle', gain: 0.4, delay: 0.18 });
          break;
        }
        case 'wrench': {
          const o = this._out(pos, 0.5 * v);
          for (let i = 0; i < 3; i++) this._tone(o, { f0: 1400, f1: 900, dur: 0.05, type: 'square', gain: 0.25, delay: i * 0.12 });
          break;
        }
        case 'crank': {
          const o = this._out(pos, 0.8 * v);
          for (let i = 0; i < 9; i++) {
            this._tone(o, { f0: 90 + i * 4, f1: 60, dur: 0.07, type: 'sawtooth', gain: 0.5, delay: i * 0.1 });
            this._burst(o, { dur: 0.05, f0: 800, f1: 300, gain: 0.4, delay: i * 0.1 });
          }
          break;
        }
        case 'start':
          this._burst(this._out(pos, 0.9 * v), { dur: 0.5, f0: 1500, f1: 200, gain: 1 });
          break;
        case 'stall': {
          const o = this._out(pos, 0.8 * v);
          this._tone(o, { f0: 140, f1: 30, dur: 0.6, type: 'sawtooth', gain: 0.6 });
          this._burst(o, { dur: 0.3, f0: 700, f1: 100, gain: 0.5 });
          break;
        }
        case 'crash': {
          const o = this._out(pos, clamp(0.4 + v * 0.1, 0.4, 1.4));
          this._burst(o, { dur: 0.45, f0: 4000, f1: 120, gain: 1.2 });
          this._tone(o, { f0: 120, f1: 35, dur: 0.4, gain: 1 });
          this._burst(o, { dur: 0.3, f0: 6000, f1: 1500, type: 'highpass', gain: 0.5, delay: 0.03 });
          break;
        }
        case 'pistol': {
          const o = this._out(pos, 0.9 * v);
          this._burst(o, { dur: 0.22, f0: 5000, f1: 300, gain: 1.2 });
          this._tone(o, { f0: 220, f1: 50, dur: 0.18, gain: 0.9 });
          break;
        }
        case 'shotgun': {
          const o = this._out(pos, 1.2 * v);
          this._burst(o, { dur: 0.45, f0: 4000, f1: 120, gain: 1.6 });
          this._tone(o, { f0: 140, f1: 30, dur: 0.35, gain: 1.2 });
          break;
        }
        case 'reload': {
          const o = this._out(null, 0.5 * v);
          this._tone(o, { f0: 1800, f1: 900, dur: 0.04, type: 'square', gain: 0.3 });
          this._tone(o, { f0: 1400, f1: 700, dur: 0.05, type: 'square', gain: 0.3, delay: 0.5 });
          this._tone(o, { f0: 2200, f1: 1200, dur: 0.05, type: 'square', gain: 0.3, delay: 0.9 });
          break;
        }
        case 'empty':
          this._tone(this._out(null, 0.3 * v), { f0: 1500, f1: 1000, dur: 0.03, type: 'square', gain: 0.3 });
          break;
        case 'swing':
          this._burst(this._out(null, 0.4 * v), { dur: 0.2, f0: 700, f1: 2500, type: 'bandpass', q: 0.8, gain: 0.6 });
          break;
        case 'hit': {
          const o = this._out(pos, 0.7 * v);
          this._tone(o, { f0: 150, f1: 60, dur: 0.12, gain: 0.8 });
          this._burst(o, { dur: 0.1, f0: 1500, f1: 200, gain: 0.7 });
          break;
        }
        case 'hurt':
          this._tone(this._out(null, 0.6 * v), { f0: 200, f1: 100, dur: 0.25, type: 'sawtooth', gain: 0.6 });
          this._burst(this._out(null, 0.4 * v), { dur: 0.15, f0: 800, f1: 200, gain: 0.8 });
          break;
        case 'groan': {
          const o = this._out(pos, (opts.aggro ? 0.9 : 0.6) * v);
          const t = c.currentTime;
          const dur = 0.9 + Math.random() * 0.7;
          const base = 70 + Math.random() * 50;
          const osc = c.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(base, t);
          osc.frequency.linearRampToValueAtTime(base * (opts.aggro ? 1.6 : 0.8), t + dur);
          const vib = c.createOscillator();
          vib.frequency.value = 6 + Math.random() * 3;
          const vg = c.createGain();
          vg.gain.value = 8;
          vib.connect(vg);
          vg.connect(osc.frequency);
          const bp = c.createBiquadFilter();
          bp.type = 'bandpass';
          bp.Q.value = 3;
          bp.frequency.setValueAtTime(450, t);
          bp.frequency.linearRampToValueAtTime(opts.aggro ? 1100 : 700, t + dur);
          const g = c.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.9, t + 0.15);
          g.gain.linearRampToValueAtTime(0, t + dur);
          osc.connect(bp);
          bp.connect(g);
          g.connect(o);
          osc.start(t);
          vib.start(t);
          osc.stop(t + dur + 0.05);
          vib.stop(t + dur + 0.05);
          break;
        }
        case 'zdie': {
          const o = this._out(pos, 0.8 * v);
          this._tone(o, { f0: 180, f1: 40, dur: 0.7, type: 'sawtooth', gain: 0.6 });
          this._burst(o, { dur: 0.3, f0: 700, f1: 100, gain: 0.5 });
          break;
        }
        case 'thud':
          this._tone(this._out(pos, 0.5 * v), { f0: 120, f1: 50, dur: 0.12, gain: 0.7 });
          break;
        case 'door':
          this._tone(this._out(pos, 0.5 * v), { f0: 300, f1: 120, dur: 0.15, type: 'square', gain: 0.4 });
          this._burst(this._out(pos, 0.4 * v), { dur: 0.1, f0: 1200, f1: 200, gain: 0.6 });
          break;
        case 'flame':
          this._burst(this._out(pos, 0.4 * v), { dur: 0.4, f0: 3000, f1: 800, type: 'highpass', gain: 0.8 });
          break;
        case 'chat':
          this._tone(this._out(null, 0.3 * v), { f0: 700, f1: 900, dur: 0.08, type: 'triangle', gain: 0.4 });
          break;
        case 'beep':
          this._tone(this._out(null, 0.25 * v), { f0: 1200, f1: 1200, dur: 0.12, type: 'square', gain: 0.3 });
          break;
        default:
      }
    } catch (e) {
      /* ignorieren */
    }
  }

  hornStart(pos) {
    if (!this.ready || this.horn) return;
    const c = this.ctx;
    const o1 = c.createOscillator();
    o1.type = 'square';
    o1.frequency.value = 392;
    const o2 = c.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 494;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = c.createGain();
    g.gain.value = 0;
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    g.gain.setTargetAtTime(0.16, c.currentTime, 0.01);
    o1.start();
    o2.start();
    this.horn = { o1, o2, g };
  }

  hornStop() {
    if (!this.horn) return;
    const c = this.ctx;
    const h = this.horn;
    h.g.gain.setTargetAtTime(0, c.currentTime, 0.03);
    h.o1.stop(c.currentTime + 0.2);
    h.o2.stop(c.currentTime + 0.2);
    this.horn = null;
  }
}
