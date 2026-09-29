// Sleep protocols: the four presets from the web mock-up. Each one eases the beat (the pulse you hear in the carrier tone)
// from a relaxed-awake rate down to its sleep rate over the onset window, over a noise bed and a slow ambient pad.
// Wording stays to relaxation and sleep; no treatment claims.

import type { Soundscape } from './soundscapes';

export type Mix = { carrier: number; noise: number; ambient: number }; // 0..1 each

export type Protocol = {
  id: string;
  name: string;
  summary: string;
  beatStart: number; // Hz at the start of the onset window
  beatEnd: number; // Hz once settled
  onsetMinutes: number;
  carrierHz: number; // pitch of the tone that carries the beat
  noise: Soundscape; // default soundscape
  ambientRoot: number; // Hz, root note of the ambient pad
  mix: Mix; // starting mix
};

export const PROTOCOLS: Protocol[] = [
  {
    id: 'deep-sleep',
    name: 'Deep Sleep N3',
    summary: '2 Hz Delta · deep sleep focus',
    beatStart: 8,
    beatEnd: 2,
    onsetMinutes: 25,
    carrierHz: 150,
    noise: 'brown',
    ambientRoot: 98,
    mix: { carrier: 0.7, noise: 0.7, ambient: 0.35 },
  },
  {
    id: 'recovery',
    name: 'High Performance',
    summary: 'Theta → 1 Hz Delta · recovery',
    beatStart: 6,
    beatEnd: 1,
    onsetMinutes: 30,
    carrierHz: 200,
    noise: 'pink',
    ambientRoot: 123.5,
    mix: { carrier: 0.75, noise: 0.5, ambient: 0.5 },
  },
  {
    id: 'glp1',
    name: 'GLP-1 Recovery',
    summary: 'Theta 4 Hz → Delta 2 Hz · settle',
    beatStart: 7,
    beatEnd: 2,
    onsetMinutes: 30,
    carrierHz: 170,
    noise: 'brown',
    ambientRoot: 104,
    mix: { carrier: 0.6, noise: 0.65, ambient: 0.55 },
  },
  {
    id: 'menopause',
    name: 'Menopause Protocol',
    summary: '1.5 Hz Delta · deep, steady masking',
    beatStart: 10,
    beatEnd: 1.5,
    onsetMinutes: 20,
    carrierHz: 180,
    noise: 'pink',
    ambientRoot: 110,
    mix: { carrier: 0.85, noise: 0.6, ambient: 0.4 },
  },
];

export const protocolById = (id: string) => PROTOCOLS.find((p) => p.id === id) ?? PROTOCOLS[0]; // first = default

// Beat rate at a point in the session (eased, matches the engine's ramp).
export function beatAt(p: Protocol, elapsedSec: number) {
  const t = Math.min(1, elapsedSec / (p.onsetMinutes * 60));
  return p.beatStart + (p.beatEnd - p.beatStart) * t;
}

// Brainwave band name for a beat rate.
export function bandName(hz: number) {
  if (hz >= 8) return 'Alpha';
  if (hz >= 4) return 'Theta';
  return 'Delta';
}
