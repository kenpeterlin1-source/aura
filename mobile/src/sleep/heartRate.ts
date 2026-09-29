// Bluetooth heart-rate connector: any device that speaks the standard Heart Rate profile - chest straps (Polar, Wahoo) and
// watches that broadcast heart rate (Amazfit "Heart Rate Push", Garmin "Broadcast Heart Rate").
// Android app only; the web build shows a note instead.
import { PermissionsAndroid, Platform } from 'react-native';
import type { BleManager, Device, Subscription } from 'react-native-ble-plx';

export const HR_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
const HR_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';

export const bluetoothAvailable = Platform.OS !== 'web';

export type HrReading = { bpm: number; rr: number[]; at: number };
export type FoundDevice = { id: string; name: string; rssi: number | null };

let manager: BleManager | null = null;
function ble() {
  if (!manager) {
    // loaded lazily so the web build never touches the native module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BleManager: Manager } = require('react-native-ble-plx') as typeof import('react-native-ble-plx');
    manager = new Manager();
  }
  return manager;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function fromBase64(s: string) {
  const clean = s.replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return out;
}

// Heart Rate Measurement (0x2A37): flags, bpm (8 or 16 bit), optional energy, optional RR intervals in 1/1024 s.
export function parseHeartRate(bytes: number[]): { bpm: number; rr: number[] } | null {
  if (bytes.length < 2) return null;
  const flags = bytes[0];
  let i = 1;
  let bpm: number;
  if (flags & 0x01) {
    bpm = bytes[i] | (bytes[i + 1] << 8);
    i += 2;
  } else {
    bpm = bytes[i];
    i += 1;
  }
  if (flags & 0x08) i += 2; // energy expended
  const rr: number[] = [];
  if (flags & 0x10) {
    for (; i + 1 < bytes.length; i += 2) rr.push(((bytes[i] | (bytes[i + 1] << 8)) * 1000) / 1024);
  }
  return { bpm, rr };
}

export async function askPermissions() {
  if (Platform.OS !== 'android') return true;
  const wanted =
    Number(Platform.Version) >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

// Looks for heart-rate devices for `seconds`, calling onFound for each new one.
export async function scan(onFound: (d: FoundDevice) => void, seconds = 12) {
  const m = ble();
  const seen = new Set<string>();
  await m.startDeviceScan([HR_SERVICE], null, (error, d) => {
    if (error || !d || seen.has(d.id)) return;
    seen.add(d.id);
    onFound({ id: d.id, name: d.name ?? d.localName ?? 'Heart-rate device', rssi: d.rssi ?? null });
  });
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await m.stopDeviceScan();
}

export function stopScan() {
  manager?.stopDeviceScan().catch(() => {});
}

// A live connection that reconnects by itself if the watch drops out during the night.
export class HeartRateLink {
  private device: Device | null = null;
  private subs: Subscription[] = [];
  private stopped = false;

  constructor(
    private readonly deviceId: string,
    private readonly onReading: (r: HrReading) => void,
    private readonly onStatus: (s: 'connecting' | 'connected' | 'lost') => void,
  ) {}

  async start() {
    this.stopped = false;
    await this.connect();
  }

  private async connect() {
    if (this.stopped) return;
    this.onStatus('connecting');
    try {
      const m = ble();
      const d = await m.connectToDevice(this.deviceId, { autoConnect: false, timeout: 15000 });
      await d.discoverAllServicesAndCharacteristics();
      this.device = d;
      this.subs.push(
        d.monitorCharacteristicForService(HR_SERVICE, HR_MEASUREMENT, (error, c) => {
          if (error || !c?.value) return;
          const parsed = parseHeartRate(fromBase64(c.value));
          if (parsed) this.onReading({ ...parsed, at: Date.now() });
        }),
        m.onDeviceDisconnected(this.deviceId, () => {
          this.onStatus('lost');
          this.clear();
          if (!this.stopped) setTimeout(() => this.connect(), 5000);
        }),
      );
      this.onStatus('connected');
    } catch {
      this.onStatus('lost');
      if (!this.stopped) setTimeout(() => this.connect(), 10000);
    }
  }

  private clear() {
    for (const s of this.subs) s.remove();
    this.subs = [];
  }

  async stop() {
    this.stopped = true;
    this.clear();
    if (this.device) await this.device.cancelConnection().catch(() => {});
    this.device = null;
  }
}
