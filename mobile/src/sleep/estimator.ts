// Sleep-stage estimator: turns live heart rate (and, when available, beat-to-beat intervals and movement) into a stage every
// minute. It works with any heart-rate source, so each wearable only needs a small connector that calls addHeartRate/addMotion.
//
// Rules (first version, to be tuned against each morning's stages from Zepp / Health Connect):
//   awake - moving, or heart rate close to the pre-sleep level
//   deep  - heart rate near tonight's low, steady, and still
//   REM   - still, but heart rate raised and irregular, at least an hour after falling asleep
//   light - everything else
// Heart-rate levels are relative to this person tonight (pre-sleep level vs. the night's low), not fixed numbers.
// No imports, so it runs in the app, in the browser and in plain Node tests.

export type Stage = 'awake' | 'light' | 'deep' | 'rem';

export type Epoch = {
  start: number; // ms since epoch
  hr: number | null; // mean bpm in the minute
  hrSd: number | null; // spread of bpm within the minute
  rmssd: number | null; // ms, only when the source sends beat-to-beat intervals
  motion: number; // movement score for the minute (0 = still)
  stage: Stage;
  depth: number; // 0 = awake .. 100 = deepest, for the display and later for the audio
  confident: boolean; // false while the night's baseline is still being learned
};

export type EstimatorState = {
  epochs: Epoch[];
  asleepAt: number | null;
  preSleepHr: number | null;
  lowHr: number | null;
};

const EPOCH_MS = 60_000;
const MOTION_AWAKE = 3; // movement score in a minute that means awake
const MOTION_STILL = 0.8;

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

export class SleepEstimator {
  private epochs: Epoch[] = [];
  private cur: { start: number; hrs: number[]; rrs: number[]; motion: number } | null = null;
  private asleepAt: number | null = null;
  private listeners = new Set<(e: Epoch) => void>();

  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  onEpoch(fn: (e: Epoch) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  reset() {
    this.epochs = [];
    this.cur = null;
    this.asleepAt = null;
  }

  // bpm from the heart-rate source; rr = beat-to-beat intervals in ms if the source sends them
  addHeartRate(bpm: number, rr: number[] = [], at = this.now()) {
    if (!(bpm > 25 && bpm < 220)) return;
    this.bucket(at).hrs.push(bpm);
    for (const r of rr) if (r > 300 && r < 2000) this.bucket(at).rrs.push(r);
  }

  // movement magnitude above gravity (e.g. |accel| - 1 g), any rate; summed per minute
  addMotion(amount: number, at = this.now()) {
    if (amount > 0.02) this.bucket(at).motion += Math.min(amount, 2);
  }

  // Closes finished minutes. Call every few seconds (and when stopping).
  tick(at = this.now(), force = false) {
    if (this.cur && (force || at - this.cur.start >= EPOCH_MS)) this.close();
  }

  state(): EstimatorState {
    return { epochs: this.epochs, asleepAt: this.asleepAt, preSleepHr: this.preSleep(), lowHr: this.low() };
  }

  get latest(): Epoch | null {
    return this.epochs[this.epochs.length - 1] ?? null;
  }

  private bucket(at: number) {
    if (this.cur && at - this.cur.start >= EPOCH_MS) this.close();
    if (!this.cur) this.cur = { start: at - (at % EPOCH_MS), hrs: [], rrs: [], motion: 0 };
    return this.cur;
  }

  private preSleep() {
    const hrs = this.epochs.slice(0, 10).map((e) => e.hr).filter((x): x is number => x !== null);
    return hrs.length >= 3 ? median(hrs) : null;
  }

  // Tonight's low: the 10th percentile of heart rate once there's enough sleep to judge, and never above 90% of the pre-sleep
  // level (early in the night the only data is still near waking level).
  private low() {
    const pre = this.preSleep();
    const hrs = this.epochs.map((e) => e.hr).filter((x): x is number => x !== null);
    if (hrs.length < 15 || pre === null) return null;
    return Math.min(percentile(hrs, 10), pre * 0.9);
  }

  // Typical within-minute heart-rate spread while asleep tonight; REM and deep are judged against it.
  private typicalSd() {
    const sds = this.epochs.filter((e) => e.stage !== 'awake' && e.hrSd !== null).map((e) => e.hrSd as number);
    return sds.length >= 20 ? median(sds) : null;
  }

  private close() {
    const c = this.cur!;
    this.cur = null;
    const hr = c.hrs.length ? c.hrs.reduce((a, b) => a + b, 0) / c.hrs.length : null;
    const diffs = c.rrs.slice(1).map((r, i) => r - c.rrs[i]);
    const rmssd = diffs.length >= 10 ? Math.sqrt(diffs.reduce((a, d) => a + d * d, 0) / diffs.length) : null;
    const epoch = this.classify({ start: c.start, hr, hrSd: c.hrs.length >= 5 ? sd(c.hrs) : null, rmssd, motion: c.motion });
    this.epochs.push(epoch);
    for (const fn of this.listeners) fn(epoch);
  }

  private classify(e: Omit<Epoch, 'stage' | 'depth' | 'confident'>): Epoch {
    const pre = this.preSleep() ?? e.hr ?? 70;
    const low = this.low() ?? pre * 0.88;
    const range = Math.max(4, pre - low);
    const confident = this.low() !== null;
    const prev = this.epochs.slice(-3);

    if (e.hr === null) return { ...e, stage: prev.at(-1)?.stage ?? 'awake', depth: prev.at(-1)?.depth ?? 0, confident: false };

    // 0 at the pre-sleep level, 1 at tonight's low
    const drop = Math.min(1.2, Math.max(-0.5, (pre - e.hr) / range));
    const still = e.motion <= MOTION_STILL;
    const typical = this.typicalSd();
    const steady = e.hrSd === null || e.hrSd < (typical !== null ? Math.max(1, typical * 0.9) : 1.6);
    const irregular =
      (e.hrSd !== null && e.hrSd > (typical !== null ? Math.max(1.5, typical * 1.6) : 2.6)) || (e.rmssd !== null && e.rmssd > 60);
    const sinceAsleep = this.asleepAt ? (e.start - this.asleepAt) / 60_000 : 0;

    let stage: Stage;
    if (e.motion >= MOTION_AWAKE || drop < 0.15) stage = 'awake';
    else if (still && steady && drop >= 0.8) stage = 'deep';
    else if (still && irregular && sinceAsleep >= 60 && drop >= 0.2 && drop < 0.65) stage = 'rem';
    else stage = 'light';

    // one-minute blips are smoothed: deep needs the minute before to be deep or light-and-dropping
    if (stage === 'deep' && prev.length && prev[prev.length - 1].stage === 'awake') stage = 'light';

    if (stage !== 'awake' && this.asleepAt === null) {
      const lastTwo = prev.slice(-2);
      if (lastTwo.length === 2 && lastTwo.every((p) => p.stage !== 'awake')) this.asleepAt = lastTwo[0].start;
    }

    const base = { awake: 0, light: 35, rem: 45, deep: 80 }[stage];
    const depth = Math.round(Math.max(0, Math.min(100, stage === 'awake' ? drop * 30 : base + drop * 20 - Math.min(10, e.motion * 5))));
    return { ...e, stage, depth, confident };
  }
}

export const STAGE_LABEL: Record<Stage, string> = { awake: 'Awake', light: 'Light sleep', deep: 'Deep sleep', rem: 'REM' };
