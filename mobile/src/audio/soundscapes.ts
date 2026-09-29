// Soundscapes: the bed under the beat tone. All generated on the phone from noise, with slow oscillators shaping it, so nothing
// repeats and nothing needs downloading. Ocean, rain, stream and wind; plain pink and brown noise as before.
import type { AudioContext, AudioNode, AudioParam } from 'react-native-audio-api';

export type Soundscape = 'pink' | 'brown' | 'ocean' | 'rain' | 'stream' | 'wind';

export const SOUNDSCAPES: [Soundscape, string][] = [
  ['pink', 'Pink noise'],
  ['brown', 'Brown noise'],
  ['ocean', 'Ocean'],
  ['rain', 'Rain'],
  ['stream', 'Stream'],
  ['wind', 'Wind'],
];

export const soundscapeLabel = (s: Soundscape) => SOUNDSCAPES.find(([k]) => k === s)?.[1] ?? s;

type Color = 'pink' | 'brown' | 'white';

function fill(data: Float32Array, color: Color) {
  if (color === 'white') {
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
  } else if (color === 'pink') {
    // Paul Kellet's pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
  }
}

// Soften the loop seam so a repeating buffer never clicks.
function softEdges(data: Float32Array, rate: number) {
  const edge = Math.floor(rate * 0.5);
  for (let i = 0; i < edge; i++) {
    const g = i / edge;
    data[i] *= g;
    data[data.length - 1 - i] *= g;
  }
}

function buffer(ctx: AudioContext, seconds: number, make: (data: Float32Array, rate: number) => void) {
  const rate = ctx.sampleRate;
  const buf = ctx.createBuffer(2, Math.floor(seconds * rate), rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = new Float32Array(buf.length);
    make(data, rate);
    softEdges(data, rate);
    buf.copyToChannel(data, ch);
  }
  return buf;
}

// Raindrops: short bright ticks scattered at random over quiet time.
function drops(data: Float32Array, rate: number) {
  const perSecond = 38;
  const count = Math.floor((data.length / rate) * perSecond);
  for (let n = 0; n < count; n++) {
    const at = Math.floor(Math.random() * data.length);
    const len = Math.floor(rate * (0.004 + Math.random() * 0.012));
    const amp = 0.05 + Math.random() ** 3 * 0.35;
    for (let i = 0; i < len && at + i < data.length; i++) {
      data[at + i] += (Math.random() * 2 - 1) * amp * Math.exp((-6 * i) / len);
    }
  }
}

// Brook bubbles: tiny rising blips, dense and uneven.
function bubbles(data: Float32Array, rate: number) {
  const perSecond = 22;
  const count = Math.floor((data.length / rate) * perSecond);
  for (let n = 0; n < count; n++) {
    const at = Math.floor(Math.random() * data.length);
    const len = Math.floor(rate * (0.02 + Math.random() * 0.05));
    const f0 = 300 + Math.random() * 700;
    const f1 = f0 * (1.4 + Math.random() * 0.8);
    const amp = 0.02 + Math.random() ** 2 * 0.09;
    let phase = 0;
    for (let i = 0; i < len && at + i < data.length; i++) {
      const t = i / len;
      phase += (2 * Math.PI * (f0 + (f1 - f0) * t)) / rate;
      data[at + i] += Math.sin(phase) * amp * Math.sin(Math.PI * t);
    }
  }
}

type Build = {
  ctx: AudioContext;
  out: AudioNode; // everything ends up here (the soundscape volume)
  start: number;
  drift: (param: AudioParam, hz: number, amount: number, delay?: number) => void;
};

function loop(b: Build, seconds: number, make: (d: Float32Array, r: number) => void, gain: number, to: AudioNode) {
  const src = b.ctx.createBufferSource();
  src.buffer = buffer(b.ctx, seconds, make);
  src.loop = true;
  const g = b.ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(to);
  src.start(b.start);
  return g;
}

const noise = (c: Color) => (d: Float32Array) => fill(d, c);

// Builds the chosen soundscape into `b.out`. Buffer lengths are different primes, so the layers never line up the same way twice.
export function buildSoundscape(kind: Soundscape, b: Build) {
  const { ctx, out, drift } = b;

  if (kind === 'pink' || kind === 'brown') {
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = kind === 'pink' ? 2400 : 1200;
    tone.Q.value = 0.3;
    drift(tone.frequency, 0.011, kind === 'pink' ? 700 : 350);
    loop(b, 29, noise(kind), 0.7, tone);
    loop(b, 37, noise(kind), 0.5, tone);
    tone.connect(out);
    return;
  }

  if (kind === 'ocean') {
    // Swells: the low roar rises and falls with two slow, unrelated wave cycles (about 12 s and 21 s).
    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 650;
    body.Q.value = 0.5;
    const swell = ctx.createGain();
    swell.gain.value = 0.55;
    loop(b, 31, noise('brown'), 0.8, body);
    loop(b, 41, noise('pink'), 0.35, body);
    drift(body.frequency, 0.083, 420);
    drift(body.frequency, 0.047, 220);
    drift(swell.gain, 0.083, 0.35);
    drift(swell.gain, 0.047, 0.15);
    body.connect(swell);
    swell.connect(out);
    // Wash: the hiss of water running back, peaking a couple of seconds after each swell.
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'highpass';
    hissFilter.frequency.value = 2500;
    const hiss = ctx.createGain();
    hiss.gain.value = 0.09;
    loop(b, 23, noise('white'), 0.6, hissFilter);
    drift(hiss.gain, 0.083, 0.08, 2.5);
    hissFilter.connect(hiss);
    hiss.connect(out);
    return;
  }

  if (kind === 'rain') {
    // Steady rainfall hiss plus scattered drops, with a gentle ebb as showers come and go.
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3200;
    band.Q.value = 0.35;
    const fall = ctx.createGain();
    fall.gain.value = 0.7;
    loop(b, 29, noise('pink'), 0.9, band);
    loop(b, 37, noise('white'), 0.35, band);
    drift(fall.gain, 0.021, 0.18);
    band.connect(fall);
    fall.connect(out);
    const dropTone = ctx.createBiquadFilter();
    dropTone.type = 'highpass';
    dropTone.frequency.value = 1500;
    loop(b, 23, drops, 0.9, dropTone);
    loop(b, 31, drops, 0.6, dropTone);
    dropTone.connect(out);
    return;
  }

  if (kind === 'stream') {
    // Running water: a mid-band rush whose centre wanders quickly, plus bubbling.
    const rush = ctx.createBiquadFilter();
    rush.type = 'bandpass';
    rush.frequency.value = 1100;
    rush.Q.value = 0.9;
    const flow = ctx.createGain();
    flow.gain.value = 0.8;
    loop(b, 29, noise('pink'), 1, rush);
    drift(rush.frequency, 0.71, 260);
    drift(rush.frequency, 1.37, 180);
    drift(rush.frequency, 0.19, 300);
    drift(flow.gain, 0.53, 0.12);
    rush.connect(flow);
    flow.connect(out);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 400;
    loop(b, 37, noise('brown'), 0.45, low);
    low.connect(out);
    loop(b, 17, bubbles, 0.9, out);
    loop(b, 23, bubbles, 0.7, out);
    return;
  }

  // wind: two resonant bands drifting slowly, gusting in and out
  const moan = ctx.createBiquadFilter();
  moan.type = 'bandpass';
  moan.frequency.value = 520;
  moan.Q.value = 3.5;
  const gust = ctx.createGain();
  gust.gain.value = 0.9;
  loop(b, 31, noise('pink'), 1.4, moan);
  drift(moan.frequency, 0.051, 220);
  drift(moan.frequency, 0.031, 140);
  drift(gust.gain, 0.067, 0.5);
  drift(gust.gain, 0.023, 0.3);
  moan.connect(gust);
  gust.connect(out);
  const whistle = ctx.createBiquadFilter();
  whistle.type = 'bandpass';
  whistle.frequency.value = 1350;
  whistle.Q.value = 7;
  const whistleGain = ctx.createGain();
  whistleGain.gain.value = 0.35;
  loop(b, 41, noise('white'), 1.2, whistle);
  drift(whistle.frequency, 0.037, 380);
  drift(whistleGain.gain, 0.043, 0.3, 4);
  whistle.connect(whistleGain);
  whistleGain.connect(out);
  const bed = ctx.createBiquadFilter();
  bed.type = 'lowpass';
  bed.frequency.value = 300;
  loop(b, 37, noise('brown'), 0.5, bed);
  bed.connect(out);
}
