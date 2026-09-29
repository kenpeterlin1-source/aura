// The sleep audio engine. Everything is generated live on the phone, never a looped track:
//   soundscape  - ocean, rain, stream, wind or plain noise, built from long noise buffers and slow drifts (soundscapes.ts)
//   carrier     - the beat: binaural (left/right tones a few Hz apart, for headphones) or isochronic (one tone pulsed, for a speaker)
//   ambient pad - four soft tones whose volumes and tuning drift at unrelated slow rates, so the texture never repeats
//   wake layer  - brighter tones that ramp in before the wake time, outside the sleep-timer fade
// All timing (fade-in, onset ramp, sleep-timer fade, wake ramp) is scheduled on the audio clock at start, so it keeps working
// overnight even when the app's JavaScript is paused in the background.
import { Platform } from 'react-native';
import {
  AudioContext,
  AudioManager,
  PlaybackNotificationManager,
  type AudioParam,
  type GainNode,
} from 'react-native-audio-api';

import type { Mix, Protocol } from './protocols';
import { buildSoundscape, type Soundscape } from './soundscapes';

export type CarrierMode = 'binaural' | 'isochronic';

export type SessionPlan = {
  protocol: Protocol;
  mix: Mix;
  mode: CarrierMode;
  soundscape: Soundscape;
  sleepMinutes: number | null; // null = all night
  wakeAt: Date | null; // null = no wake ramp
};

// Loudest each layer gets at 100% on its slider.
const MAX = { carrier: 0.12, noise: 0.55, ambient: 0.22 };
const FADE_IN = 45; // seconds
const OUTPUT = 2.2; // overall level at full fade-in; the phone's volume buttons do the rest
const SLEEP_FADE = 10 * 60; // the sleep timer fades out over its last 10 minutes
const WAKE_RAMP = 15 * 60; // the wake layer rises over 15 minutes, peaking at the wake time

const level = (v: number) => v * v; // sliders feel even to the ear

export class SleepEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wake: GainNode | null = null;
  private layers: { carrier: GainNode; noise: GainNode; ambient: GainNode; binaural: GainNode; iso: GainNode } | null = null;
  private startedAt = 0;
  // Survives the screen being closed and reopened (the app keeps running in the background while it plays),
  // so a reopened screen can show the session that's still going.
  startedAtWall: Date | null = null;
  current: SessionPlan | null = null;
  private listeners = new Set<(playing: boolean) => void>();
  private notifSubs: { remove: () => void }[] = [];

  get playing() {
    return this.ctx !== null;
  }

  // Tell the screen when playback starts or stops (including from the notification's Stop button).
  onChange(fn: (playing: boolean) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    for (const fn of this.listeners) fn(this.playing);
  }

  async start(plan: SessionPlan) {
    await this.stop(0);
    if (Platform.OS !== 'web') {
      AudioManager.setAudioSessionOptions({ iosCategory: 'playback', iosMode: 'default', iosOptions: [] });
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    await ctx.resume();
    const now = ctx.currentTime;
    this.startedAt = now;
    const p = plan.protocol;

    // master: fade in, then (with a sleep timer) fade out over the last 10 minutes
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(OUTPUT, now + FADE_IN);
    if (plan.sleepMinutes) {
      const end = now + plan.sleepMinutes * 60;
      master.gain.setValueAtTime(OUTPUT, Math.max(now + FADE_IN, end - SLEEP_FADE));
      master.gain.linearRampToValueAtTime(0, end);
    }
    master.connect(ctx.destination);
    this.master = master;

    // --- soundscape (the "noise" layer): ocean, rain, stream, wind or plain noise ---
    const noise = ctx.createGain();
    noise.gain.value = level(plan.mix.noise) * MAX.noise;
    buildSoundscape(plan.soundscape, {
      ctx,
      out: noise,
      start: now,
      drift: (param, hz, amount, delay) => this.drift(ctx, param, hz, amount, delay),
    });
    noise.connect(master);

    // --- carrier: binaural and isochronic both built; the mode picks which one is audible ---
    const carrier = ctx.createGain();
    carrier.gain.value = level(plan.mix.carrier) * MAX.carrier;
    const onsetEnd = now + p.onsetMinutes * 60;

    const binaural = ctx.createGain();
    const left = ctx.createOscillator();
    const right = ctx.createOscillator();
    left.frequency.value = p.carrierHz;
    right.frequency.setValueAtTime(p.carrierHz + p.beatStart, now);
    right.frequency.linearRampToValueAtTime(p.carrierHz + p.beatEnd, onsetEnd);
    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -1;
    panR.pan.value = 1;
    left.connect(panL);
    right.connect(panR);
    panL.connect(binaural);
    panR.connect(binaural);
    binaural.connect(carrier);

    const iso = ctx.createGain();
    const isoTone = ctx.createOscillator();
    isoTone.frequency.value = p.carrierHz;
    const pulse = ctx.createGain();
    pulse.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(p.beatStart, now);
    lfo.frequency.linearRampToValueAtTime(p.beatEnd, onsetEnd);
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth);
    depth.connect(pulse.gain);
    isoTone.connect(pulse);
    pulse.connect(iso);
    iso.connect(carrier);

    binaural.gain.value = plan.mode === 'binaural' ? 1 : 0;
    iso.gain.value = plan.mode === 'isochronic' ? 1 : 0;
    for (const o of [left, right, isoTone, lfo]) o.start(now);
    carrier.connect(master);

    // --- ambient pad: root, fifth, octave, tenth, each drifting on its own slow cycle ---
    const ambient = ctx.createGain();
    ambient.gain.value = level(plan.mix.ambient) * MAX.ambient;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 900;
    this.drift(ctx, padFilter.frequency, 0.007, 300);
    const ratios = [1, 1.5, 2, 2.52];
    const rates = [0.013, 0.021, 0.034, 0.047];
    ratios.forEach((r, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = p.ambientRoot * r;
      this.drift(ctx, o.detune, rates[(i + 2) % 4] / 3, 6);
      const g = ctx.createGain();
      g.gain.value = 0.18;
      this.drift(ctx, g.gain, rates[i], 0.14);
      o.connect(g);
      g.connect(padFilter);
      o.start(now);
    });
    padFilter.connect(ambient);
    ambient.connect(master);

    // --- wake layer: its own path to the speakers, so the sleep timer can't silence it ---
    const wake = ctx.createGain();
    wake.gain.value = 0;
    wake.connect(ctx.destination);
    if (plan.wakeAt) {
      const at = now + Math.max(0, (plan.wakeAt.getTime() - Date.now()) / 1000);
      wake.gain.setValueAtTime(0, Math.max(now, at - WAKE_RAMP));
      wake.gain.linearRampToValueAtTime(0.35, at);
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = 0.2;
        this.drift(ctx, g.gain, 0.09 + i * 0.037, 0.18);
        o.connect(g);
        g.connect(wake);
        o.start(now);
      });
    }
    this.wake = wake;
    this.layers = { carrier, noise, ambient, binaural, iso };

    this.startedAtWall = new Date();
    this.current = plan;
    this.emit();

    if (Platform.OS !== 'web') {
      // shows the "now playing" notification, which keeps Android playing with the screen off; its Stop/Pause end the session
      await PlaybackNotificationManager.show({ title: p.name, artist: 'AuraStream', state: 'playing' }).catch(() => {});
      await PlaybackNotificationManager.enableControl('stop', true).catch(() => {});
      await PlaybackNotificationManager.enableControl('pause', true).catch(() => {});
      if (!this.notifSubs.length) {
        const end = () => {
          this.stop().catch(() => {});
        };
        this.notifSubs = [
          PlaybackNotificationManager.addEventListener('playbackNotificationStop', end),
          PlaybackNotificationManager.addEventListener('playbackNotificationPause', end),
        ].filter(Boolean) as { remove: () => void }[];
      }
    }
  }

  // A slow sine wobble on a parameter: value ± amount at `hz` cycles per second.
  private drift(ctx: AudioContext, param: AudioParam, hz: number, amount: number, delay = Math.random() * 3) {
    const o = ctx.createOscillator();
    o.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.value = amount;
    o.connect(g);
    g.connect(param);
    o.start(ctx.currentTime + delay);
  }

  setMix(mix: Mix) {
    if (!this.ctx || !this.layers) return;
    const t = this.ctx.currentTime;
    this.layers.carrier.gain.setTargetAtTime(level(mix.carrier) * MAX.carrier, t, 0.3);
    this.layers.noise.gain.setTargetAtTime(level(mix.noise) * MAX.noise, t, 0.3);
    this.layers.ambient.gain.setTargetAtTime(level(mix.ambient) * MAX.ambient, t, 0.3);
  }

  setMode(mode: CarrierMode) {
    if (!this.ctx || !this.layers) return;
    const t = this.ctx.currentTime;
    this.layers.binaural.gain.setTargetAtTime(mode === 'binaural' ? 1 : 0, t, 0.5);
    this.layers.iso.gain.setTargetAtTime(mode === 'isochronic' ? 1 : 0, t, 0.5);
  }

  elapsed() {
    return this.ctx ? this.ctx.currentTime - this.startedAt : 0;
  }

  // Fade everything out, then close the audio and remove the notification.
  async stop(fadeSeconds = 1.5) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ctx = null;
    const t = ctx.currentTime;
    for (const g of [this.master, this.wake]) {
      if (!g) continue;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + fadeSeconds);
    }
    this.master = this.wake = this.layers = null;
    this.startedAtWall = null;
    this.current = null;
    this.emit();
    await new Promise((r) => setTimeout(r, fadeSeconds * 1000 + 100));
    await ctx.close().catch(() => {});
    if (Platform.OS !== 'web') await PlaybackNotificationManager.hide().catch(() => {});
  }
}

export const engine = new SleepEngine();
