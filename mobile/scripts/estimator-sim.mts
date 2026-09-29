// Simulated night to sanity-check the estimator: node scripts/estimator-sim.mts
import { SleepEstimator } from '../src/sleep/estimator.ts';

type Phase = [minutes: number, truth: string, hr: number, jitter: number, motion: number];
const night: Phase[] = [
  [15, 'awake', 68, 3, 4], [10, 'light', 64, 1.5, 0.3], [25, 'deep', 55, 0.8, 0], [20, 'light', 60, 1.5, 0.4],
  [15, 'rem', 62, 3.2, 0], [3, 'awake', 69, 3, 5], [15, 'light', 60, 1.4, 0.2], [30, 'deep', 54, 0.8, 0],
  [20, 'light', 59, 1.5, 0.3], [25, 'rem', 63, 3.4, 0], [20, 'light', 60, 1.3, 0.2], [30, 'rem', 64, 3.6, 0.1], [5, 'awake', 70, 3, 5],
];
const est = new SleepEstimator();
let t = Date.UTC(2026, 8, 28, 5, 0, 0);
const truth: string[] = [];
// roughly normal, sd 1
const rand = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.73;
for (const [mins, stage, hr, jit, mot] of night) {
  for (let m = 0; m < mins; m++) {
    truth.push(stage);
    for (let s = 0; s < 60; s++) {
      est.addHeartRate(hr + rand() * jit, [], t);
      if (mot) est.addMotion(mot / 60 * (Math.random() * 2), t);
      t += 1000;
    }
  }
}
est.tick(t, true);
const { epochs, asleepAt, preSleepHr, lowHr } = est.state();
const map: Record<string, string> = { awake: 'W', light: 'L', deep: 'D', rem: 'R' };
console.log('truth ', truth.map((x) => map[x]).join(''));
console.log('guess ', epochs.map((e) => map[e.stage]).join(''));
let ok = 0;
epochs.forEach((e, i) => { if (e.stage === truth[i]) ok++; });
console.log(`agreement ${(100 * ok / epochs.length).toFixed(0)}%  epochs ${epochs.length}  preSleep ${preSleepHr?.toFixed(1)}  low ${lowHr?.toFixed(1)}  asleep after ${asleepAt ? (asleepAt - Date.UTC(2026, 8, 28, 5)) / 60000 : '-'} min`);
for (const s of ['awake', 'light', 'deep', 'rem']) {
  const idx = truth.map((x, i) => (x === s ? i : -1)).filter((i) => i >= 0);
  const hit = idx.filter((i) => epochs[i]?.stage === s).length;
  console.log(s.padEnd(6), `${hit}/${idx.length}`);
}
