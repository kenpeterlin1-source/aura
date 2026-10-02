// Morning report data from Android Health Connect: last night's sleep stages, heart rate, HRV, blood oxygen and breathing
// rate, as written by Zepp (or any other wearable app). Read-only. Android only; the web build reports "not available".
import { Platform } from 'react-native';

export type HcStage = 'awake' | 'light' | 'deep' | 'rem' | 'asleep' | 'out' | 'unknown';

export type NightReport = {
  start: Date;
  end: Date;
  stale: boolean; // ended more than 20 h ago, so not last night
  source: string; // app that wrote the sleep session, e.g. com.huami.watch.hmwatchmanager (Zepp)
  stages: { start: Date; end: Date; stage: HcStage }[];
  minutes: Record<HcStage, number>;
  asleepMinutes: number;
  hr: { min: number; avg: number; max: number; samples: { t: Date; bpm: number }[] } | null;
  hrv: number | null; // average RMSSD, ms
  spo2: { avg: number; min: number } | null; // %
  breathing: number | null; // breaths per minute
};

export type HcStatus = 'web' | 'unavailable' | 'needs-permission' | 'ready';

const STAGE: Record<number, HcStage> = { 0: 'unknown', 1: 'awake', 2: 'asleep', 3: 'out', 4: 'light', 5: 'deep', 6: 'rem' };

const PERMISSIONS = [
  { accessType: 'read', recordType: 'SleepSession' },
  { accessType: 'read', recordType: 'HeartRate' },
  { accessType: 'read', recordType: 'HeartRateVariabilityRmssd' },
  { accessType: 'read', recordType: 'OxygenSaturation' },
  { accessType: 'read', recordType: 'RespiratoryRate' },
] as const;

// loaded lazily so the web build never touches the native module
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hc = () => require('react-native-health-connect') as typeof import('react-native-health-connect');

export async function status(): Promise<HcStatus> {
  if (Platform.OS !== 'android') return 'web';
  try {
    const { getSdkStatus, SdkAvailabilityStatus, initialize, getGrantedPermissions } = hc();
    if ((await getSdkStatus()) !== SdkAvailabilityStatus.SDK_AVAILABLE) return 'unavailable';
    await initialize();
    const granted = await getGrantedPermissions();
    return granted.some((p) => p.recordType === 'SleepSession') ? 'ready' : 'needs-permission';
  } catch {
    return 'unavailable';
  }
}

export async function connect() {
  const { initialize, requestPermission } = hc();
  await initialize();
  await requestPermission(PERMISSIONS as unknown as Parameters<typeof requestPermission>[0]);
  return status();
}

export function openSettings() {
  try {
    hc().openHealthConnectSettings();
  } catch {}
}

async function readAll<T>(recordType: string, startTime: Date, endTime: Date): Promise<T[]> {
  const { readRecords } = hc();
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const res = await readRecords(recordType as never, {
      timeRangeFilter: { operator: 'between', startTime: startTime.toISOString(), endTime: endTime.toISOString() },
      pageToken,
    });
    out.push(...(res.records as unknown as T[]));
    pageToken = res.pageToken || undefined;
  } while (pageToken);
  return out;
}

type SleepRec = { startTime: string; endTime: string; stages?: { startTime: string; endTime: string; stage: number }[]; metadata?: { dataOrigin?: string } };
type HrRec = { samples: { time: string; beatsPerMinute: number }[] };

// The most recent sleep session in the last 7 days (usually last night), with everything measured during it.
export async function lastNight(now = new Date()): Promise<NightReport | null> {
  const from = new Date(now.getTime() - 7 * 86400e3);
  const sessions = await readAll<SleepRec>('SleepSession', from, now);
  if (!sessions.length) return null;
  const s = sessions.sort((a, b) => +new Date(b.endTime) - +new Date(a.endTime))[0];
  const start = new Date(s.startTime);
  const end = new Date(s.endTime);

  const stages = (s.stages ?? [])
    .map((st) => ({ start: new Date(st.startTime), end: new Date(st.endTime), stage: STAGE[st.stage] ?? 'unknown' }))
    .sort((a, b) => +a.start - +b.start);
  const minutes = { awake: 0, light: 0, deep: 0, rem: 0, asleep: 0, out: 0, unknown: 0 } as Record<HcStage, number>;
  for (const st of stages) minutes[st.stage] += (+st.end - +st.start) / 60e3;
  const asleepMinutes = stages.length
    ? minutes.light + minutes.deep + minutes.rem + minutes.asleep
    : (+end - +start) / 60e3;

  const [hrRecs, hrvRecs, spo2Recs, rrRecs] = await Promise.all([
    readAll<HrRec>('HeartRate', start, end).catch(() => []),
    readAll<{ heartRateVariabilityMillis: number }>('HeartRateVariabilityRmssd', start, end).catch(() => []),
    readAll<{ percentage: number }>('OxygenSaturation', start, end).catch(() => []),
    readAll<{ rate: number }>('RespiratoryRate', start, end).catch(() => []),
  ]);
  const samples = hrRecs.flatMap((r) => r.samples.map((x) => ({ t: new Date(x.time), bpm: x.beatsPerMinute }))).sort((a, b) => +a.t - +b.t);
  const bpms = samples.map((x) => x.bpm);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  return {
    start,
    end,
    stale: +now - +end > 20 * 3600e3,
    source: s.metadata?.dataOrigin ?? '',
    stages,
    minutes,
    asleepMinutes,
    hr: bpms.length ? { min: Math.min(...bpms), avg: avg(bpms)!, max: Math.max(...bpms), samples } : null,
    hrv: avg(hrvRecs.map((r) => r.heartRateVariabilityMillis)),
    spo2: spo2Recs.length ? { avg: avg(spo2Recs.map((r) => r.percentage))!, min: Math.min(...spo2Recs.map((r) => r.percentage)) } : null,
    breathing: avg(rrRecs.map((r) => r.rate)),
  };
}
