// What AuraStream played each night, kept on the phone so the morning report can line it up with the sleep stages.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'aurastream.sessions.v1';
const KEEP = 60; // sessions

export type PlayedSession = {
  start: string; // ISO
  end: string | null; // null while playing
  protocol: string;
  soundscape: string;
  mode: 'binaural' | 'isochronic';
};

async function load(): Promise<PlayedSession[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function save(list: PlayedSession[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(-KEEP))).catch(() => {});
}

export async function logStart(s: Omit<PlayedSession, 'end'>) {
  const list = await load();
  await save([...list, { ...s, end: null }]);
}

export async function logEnd(at = new Date()) {
  const list = await load();
  const open = [...list].reverse().find((x) => x.end === null);
  if (open) open.end = at.toISOString();
  await save(list);
}

// Sessions that overlap a time range (e.g. last night's sleep).
export async function sessionsBetween(from: Date, to: Date) {
  const list = await load();
  return list.filter((x) => +new Date(x.start) < +to && (x.end === null || +new Date(x.end) > +from));
}
