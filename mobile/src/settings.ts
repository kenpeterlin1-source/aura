// What the player remembers between nights, saved on the device.
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CarrierMode } from './audio/engine';
import type { Mix } from './audio/protocols';

const KEY = 'aurastream.settings.v1';

export type Settings = {
  protocolId: string;
  mix: Mix | null; // null = the protocol's own starting mix
  mode: CarrierMode;
  sleepMinutes: number | null; // null = all night
  wakeEnabled: boolean;
  wakeMinutes: number; // minutes after midnight, e.g. 390 = 6:30 AM
};

export const DEFAULTS: Settings = {
  protocolId: 'menopause',
  mix: null,
  mode: 'binaural',
  sleepMinutes: null,
  wakeEnabled: true,
  wakeMinutes: 6 * 60 + 30,
};

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(s: Settings) {
  AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
}

// The next time the clock reads `minutes` after midnight.
export function nextWake(minutes: number, from = new Date()) {
  const d = new Date(from);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (d <= from) d.setDate(d.getDate() + 1);
  return d;
}

export function clockLabel(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
