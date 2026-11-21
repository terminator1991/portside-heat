// Portside Heat — all sound is synthesized with WebAudio: an engine loop, a police
// siren, gunshots, punches, pickup blips, a reward chime and a slow harbour pad.
// Nothing is loaded; the graph is built on the first user gesture.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let engine = null;
  let siren = null;
  let nextChordAt = 0;
  let chordIndex = 0;

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    nextChordAt = ctx.currentTime + 0.2;
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  /** A short enveloped tone. */
  function blip(freqFrom, freqTo, seconds, type, volume, when = 0) {
    if (!ctx) return;
    const t = now() + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t + seconds);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }

  /** A burst of filtered noise (gunshots, impacts). */
  function noiseBurst(seconds, volume, filterFreq) {
    if (!ctx) return;
    const t = now();
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
  }

  function ensureEngine() {
    if (engine || !ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start();
    engine = { osc, filter, gain };
  }

  /** Called every frame: ratio is 0..1 of the car's top speed. */
  function setEngine(active, ratio) {
    if (!ctx) return;
    if (active) ensureEngine();
    if (!engine) return;
    const t = now();
    const target = active ? 0.05 + ratio * 0.035 : 0;
    engine.gain.gain.setTargetAtTime(target, t, 0.09);
    engine.osc.frequency.setTargetAtTime(52 + ratio * 165, t, 0.08);
    engine.filter.frequency.setTargetAtTime(260 + ratio * 950, t, 0.1);
  }

  function ensureSiren() {
    if (siren || !ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 960;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.4;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 330;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    lfo.start();
    siren = { gain };
  }

  /** Called every frame: level is 0..1 by the nearest police car's distance. */
  function setSiren(level) {
    if (!ctx) return;
    if (level > 0.01) ensureSiren();
    if (!siren) return;
    siren.gain.gain.setTargetAtTime(level * 0.045, now(), 0.15);
  }

  /** The ambient pad: a slow four-chord loop, scheduled a little ahead. */
  const CHORDS = [
    [110.0, 164.8, 261.6],
    [87.3, 130.8, 220.0],
    [98.0, 146.8, 246.9],
    [130.8, 196.0, 329.6],
  ];
  function scheduleChord(freqs, at) {
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 620;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.028, at + 1.4);
      gain.gain.setValueAtTime(0.028, at + 3.4);
      gain.gain.linearRampToValueAtTime(0, at + 5.2);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      osc.start(at);
      osc.stop(at + 5.4);
    }
  }

  /** Called every frame; keeps the pad loop going. */
  function step() {
    if (!ctx) return;
    while (nextChordAt < now() + 0.3) {
      scheduleChord(CHORDS[chordIndex % CHORDS.length], Math.max(nextChordAt, now()));
      chordIndex += 1;
      nextChordAt += 4.6;
    }
  }

  return {
    unlock,
    step,
    setEngine,
    setSiren,
    shot() {
      noiseBurst(0.14, 0.32, 2600);
      blip(220, 55, 0.1, 'square', 0.12);
    },
    punch() {
      blip(130, 45, 0.13, 'sine', 0.4);
      noiseBurst(0.06, 0.1, 700);
    },
    crash(power) {
      noiseBurst(0.22, Math.min(0.4, 0.12 + power * 0.3), 900);
    },
    pickup() {
      blip(660, 660, 0.07, 'sine', 0.16);
      blip(990, 990, 0.1, 'sine', 0.16, 0.07);
    },
    reward() {
      blip(523, 523, 0.11, 'triangle', 0.2);
      blip(659, 659, 0.11, 'triangle', 0.2, 0.1);
      blip(784, 784, 0.2, 'triangle', 0.22, 0.2);
    },
    denied() {
      blip(160, 110, 0.16, 'square', 0.12);
    },
    sting() {
      blip(392, 392, 0.18, 'triangle', 0.2);
      blip(330, 330, 0.18, 'triangle', 0.2, 0.17);
      blip(262, 262, 0.34, 'triangle', 0.22, 0.34);
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.9;
      return muted;
    },
    isMuted() {
      return muted;
    },
  };
}
