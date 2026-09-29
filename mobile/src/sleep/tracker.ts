// Runs the night: feeds heart rate (Bluetooth) and phone movement (accelerometer) into the estimator, saves every minute's
// stage for the morning comparison, and tells the screen what's happening. Doesn't change the audio yet.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Accelerometer } from 'expo-sensors';
import { Platform } from 'react-native';

import { SleepEstimator, type Epoch } from './estimator';
import { HeartRateLink } from './heartRate';

export type TrackerStatus = 'off' | 'connecting' | 'connected' | 'lost' | 'no-device' | 'no-hr';

export type TrackerView = {
  status: TrackerStatus;
  bpm: number | null;
  lastReadingAt: number | null;
  latest: Epoch | null;
  epochs: Epoch[];
  motionOn: boolean;
};

const DEVICE_KEY = 'aurastream.hrDevice.v1';
const NIGHT_PREFIX = 'aurastream.night.';

export type SavedDevice = { id: string; name: string };

export async function loadDevice(): Promise<SavedDevice | null> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function saveDevice(d: SavedDevice | null) {
  (d ? AsyncStorage.setItem(DEVICE_KEY, JSON.stringify(d)) : AsyncStorage.removeItem(DEVICE_KEY)).catch(() => {});
}

// Nights are stored by the date the night started, e.g. aurastream.night.2026-09-28
const nightKey = (d: Date) => {
  const local = new Date(d.getTime() - 12 * 3600e3); // before noon counts as the previous night
  return `${NIGHT_PREFIX}${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
};

class Tracker {
  private est = new SleepEstimator();
  private link: HeartRateLink | null = null;
  private motionSub: { remove: () => void } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(v: TrackerView) => void>();
  private key = '';
  private lastMag: number | null = null;
  view: TrackerView = { status: 'off', bpm: null, lastReadingAt: null, latest: null, epochs: [], motionOn: false };

  subscribe(fn: (v: TrackerView) => void) {
    this.listeners.add(fn);
    fn(this.view);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(patch: Partial<TrackerView>) {
    this.view = { ...this.view, ...patch };
    for (const fn of this.listeners) fn(this.view);
  }

  get running() {
    return this.timer !== null;
  }

  async start() {
    await this.stop();
    this.est.reset();
    this.key = nightKey(new Date());
    this.est.onEpoch((e) => {
      this.emit({ latest: e, epochs: [...this.est.state().epochs] });
      AsyncStorage.setItem(this.key, JSON.stringify(this.est.state())).catch(() => {});
    });
    this.emit({ status: 'no-device', bpm: null, lastReadingAt: null, latest: null, epochs: [] });

    const device = await loadDevice();
    if (device && Platform.OS !== 'web') {
      this.link = new HeartRateLink(
        device.id,
        (r) => {
          this.est.addHeartRate(r.bpm, r.rr, r.at);
          this.emit({ bpm: r.bpm, lastReadingAt: r.at });
        },
        (s) => this.emit({ status: s }),
      );
      this.link.start();
    }

    try {
      if (await Accelerometer.isAvailableAsync()) {
        Accelerometer.setUpdateInterval(200);
        this.motionSub = Accelerometer.addListener(({ x, y, z }) => {
          const mag = Math.sqrt(x * x + y * y + z * z);
          // change in overall force between readings: turning over, not the steady pull of gravity
          if (this.lastMag !== null) this.est.addMotion(Math.abs(mag - this.lastMag));
          this.lastMag = mag;
        });
        this.emit({ motionOn: true });
      }
    } catch {
      this.emit({ motionOn: false });
    }

    this.timer = setInterval(() => this.est.tick(), 5000);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.est.tick(Date.now(), true);
    this.motionSub?.remove();
    this.motionSub = null;
    this.lastMag = null;
    await this.link?.stop();
    this.link = null;
    if (this.view.status !== 'off') this.emit({ status: 'off' });
  }
}

export const tracker = new Tracker();

export async function loadNight(date: Date) {
  try {
    const raw = await AsyncStorage.getItem(nightKey(date));
    return raw ? (JSON.parse(raw) as ReturnType<SleepEstimator['state']>) : null;
  } catch {
    return null;
  }
}
