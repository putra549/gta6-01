// All sound is synthesised with WebAudio — there are no audio files. One AudioEngine
// owns the context, a master gain and a mute flag, and exposes one method per sound:
// the car engine (an oscillator whose pitch follows speed), the police siren, a
// gunshot, UI clicks, pickup and reward chimes, a busted sting, and a slow sunset
// music loop (bass + pad chords) scheduled a step ahead. The context only starts on
// the first user gesture, as browsers require.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenLfo = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.started = false;
  }

  /** Create the context and start the ambient loop; call from a user gesture. */
  start() {
    if (this.started) return;
    this.started = true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      this.ctx = null;
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this._startMusic();
  }

  /** Mute toggle (M key). */
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  _now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** A short enveloped tone; the building block for clicks and chimes. */
  _tone(freq, dur, type = 'sine', vol = 0.2, when = 0, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t = this._now() + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Filtered noise burst; the building block for gunshots, impacts and surf. */
  _noise(dur, vol = 0.3, freq = 1200, when = 0, q = 0.8) {
    if (!this.ctx || this.muted) return;
    const t = this._now() + when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
  }

  /** Menu / HUD click. */
  click() {
    this._tone(660, 0.07, 'triangle', 0.16);
  }

  /** Stepping into a mission marker. */
  pickup() {
    this._tone(523, 0.12, 'sine', 0.22);
    this._tone(784, 0.18, 'sine', 0.22, 0.09);
  }

  /** Cash reward fanfare: a quick rising arpeggio. */
  reward() {
    [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.2, i * 0.08));
  }

  /** Mission failed thud. */
  fail() {
    this._tone(196, 0.35, 'sawtooth', 0.16, 0, 98);
  }

  /** Busted / wasted sting. */
  sting() {
    this._tone(392, 0.3, 'triangle', 0.2);
    this._tone(311, 0.3, 'triangle', 0.2, 0.22);
    this._tone(233, 0.55, 'triangle', 0.22, 0.44);
  }

  /** Pistol shot: crack plus body. */
  gunshot() {
    this._noise(0.14, 0.5, 2600, 0, 0.5);
    this._noise(0.3, 0.25, 300, 0.01, 0.6);
    this._tone(150, 0.1, 'square', 0.12, 0, 60);
  }

  /** Dry click of an empty magazine. */
  emptyClick() {
    this._tone(1200, 0.04, 'square', 0.1);
  }

  /** Reload foley: two mechanical clicks. */
  reload() {
    this._noise(0.05, 0.2, 2000);
    this._noise(0.05, 0.24, 1500, 0.16);
    this._tone(880, 0.05, 'square', 0.08, 0.3);
  }

  /** Traffic horn: two detuned squares, short and annoyed. */
  horn() {
    this._tone(370, 0.16, 'square', 0.07);
    this._tone(466, 0.16, 'square', 0.06);
  }

  /** Car door slam when entering or leaving a car. */
  door() {
    this._noise(0.09, 0.3, 240, 0, 0.7);
    this._tone(90, 0.1, 'sine', 0.2, 0, 55);
  }

  /** Collision thud, scaled by impact 0..1. */
  crash(strength) {
    const s = Math.min(1, Math.max(0.1, strength));
    this._noise(0.22, 0.42 * s, 500, 0, 0.5);
    this._tone(70, 0.2, 'sine', 0.3 * s, 0, 40);
  }

  /** Start the engine loop (call when the player gets into a car). */
  engineStart() {
    if (!this.ctx || this.engineOsc) return;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
  }

  /** Feed the engine loop: rpm 0..1 and load (throttle) shape pitch and growl. */
  engineUpdate(rpm, load) {
    if (!this.ctx || !this.engineOsc) return;
    const t = this._now();
    this.engineOsc.frequency.setTargetAtTime(52 + rpm * 168, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(320 + rpm * 900 + load * 260, t, 0.08);
    this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.05 + rpm * 0.075, t, 0.09);
  }

  /** Stop the engine loop (player leaves the car). */
  engineStop() {
    if (!this.engineOsc) return;
    try {
      this.engineOsc.stop();
    } catch {
      /* already stopped */
    }
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
  }

  /** Police siren on/off; a two-tone wail that carries across the map. */
  siren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 720;
      this.sirenLfo = this.ctx.createOscillator();
      this.sirenLfo.type = 'square';
      this.sirenLfo.frequency.value = 0.55;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 165;
      this.sirenLfo.connect(lfoGain).connect(this.sirenOsc.frequency);
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain).connect(this.master);
      this.sirenOsc.start();
      this.sirenLfo.start();
    }
    if (this.sirenGain) {
      this.sirenGain.gain.setTargetAtTime(on && !this.muted ? 0.028 : 0, this._now(), 0.25);
    }
    if (!on && this.sirenOsc) {
      const osc = this.sirenOsc;
      const lfo = this.sirenLfo;
      window.setTimeout(() => {
        try {
          osc.stop();
          lfo.stop();
        } catch {
          /* already stopped */
        }
      }, 900);
      this.sirenOsc = null;
      this.sirenLfo = null;
      this.sirenGain = null;
    }
  }

  /** The sunset loop: a four-chord pad with a soft bass, one bar every 2.4 s. */
  _startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const chords = [
      [110.0, 220.0, 261.6, 329.6], // Am
      [87.3, 174.6, 220.0, 261.6], // F
      [98.0, 196.0, 246.9, 293.7], // G
      [82.4, 164.8, 207.7, 246.9], // E
    ];
    const playBar = () => {
      if (!this.ctx) return;
      const chord = chords[this.musicStep % chords.length];
      this.musicStep += 1;
      if (this.muted) return;
      this._tone(chord[0], 2.3, 'sine', 0.16);
      for (let i = 1; i < chord.length; i += 1) this._tone(chord[i], 2.3, 'triangle', 0.045);
      this._tone(chord[1] * 2, 0.5, 'sine', 0.03, 1.2);
    };
    playBar();
    this.musicTimer = window.setInterval(playBar, 2400);
  }
}
