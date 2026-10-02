// "Last night": the morning report. Sleep stages, heart rate, HRV, blood oxygen and breathing from Health Connect (written by
// Zepp or another wearable app), lined up with what AuraStream played.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { soundscapeLabel, type Soundscape } from '@/audio/soundscapes';
import { sessionsBetween, type PlayedSession } from '@/sessionLog';
import { connect, lastNight, openSettings, status, type HcStage, type HcStatus, type NightReport } from '@/sleep/healthConnect';
import { C, F } from '@/theme';

const ROW: Partial<Record<HcStage, number>> = { awake: 0, rem: 1, light: 2, asleep: 2, deep: 3 };
const COLOR: Partial<Record<HcStage, string>> = { awake: '#B89660', rem: '#8C6BB0', light: '#3A6080', asleep: '#3A6080', deep: '#1F3F5C' };
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;

export default function Morning() {
  const insets = useSafeAreaInsets();
  const [hc, setHc] = useState<HcStatus | 'loading'>('loading');
  const [night, setNight] = useState<NightReport | null | 'loading'>('loading');
  const [played, setPlayed] = useState<PlayedSession[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const st = await status();
    setError('');
    setHc(st);
    if (st !== 'ready') return;
    setNight('loading');
    try {
      const n = await lastNight();
      setNight(n);
      if (n) setPlayed(await sessionsBetween(n.start, n.end));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read Health Connect.');
      setNight(null);
    }
  }, []);

  useEffect(() => {
    // run after mount (async), so no state is set during the effect itself
    Promise.resolve().then(load);
  }, [load]);

  return (
    <ScrollView style={st.screen} contentContainerStyle={[st.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
        <Text style={st.link}>‹ Back</Text>
      </Pressable>
      <Text style={st.title}>Last night</Text>

      {hc === 'loading' && <ActivityIndicator color={C.amber} />}
      {hc === 'web' && <Text style={st.body}>The morning report reads Health Connect, so it needs the Android app.</Text>}
      {hc === 'unavailable' && (
        <Text style={st.body}>Health Connect isn&apos;t available on this phone. It&apos;s built into Android 14 and newer.</Text>
      )}
      {hc === 'needs-permission' && (
        <View style={st.card}>
          <Text style={st.body}>
            AuraStream reads last night&apos;s sleep stages, heart rate, HRV, blood oxygen and breathing from Health Connect.
            It only reads; nothing is written or sent anywhere.
          </Text>
          <Text style={st.muted}>
            For Amazfit: in Zepp, Profile → 3rd-party account linking → Health Connect, and allow Sleep and Heart rate.
          </Text>
          <Pressable onPress={() => connect().then(load)} style={st.button} accessibilityRole="button">
            <Text style={st.buttonText}>Connect Health Connect</Text>
          </Pressable>
        </View>
      )}

      {hc === 'ready' && night === 'loading' && <ActivityIndicator color={C.amber} />}
      {hc === 'ready' && night === null && (
        <View style={st.card}>
          <Text style={st.body}>No sleep found in the last 20 hours.</Text>
          <Text style={st.muted}>Open Zepp so it syncs last night, then come back. {error}</Text>
          <Pressable onPress={load} style={st.button} accessibilityRole="button">
            <Text style={st.buttonText}>Check again</Text>
          </Pressable>
        </View>
      )}

      {hc === 'ready' && night && night !== 'loading' && <Report night={night} played={played} />}

      {hc === 'ready' && (
        <Pressable onPress={openSettings} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
          <Text style={st.link}>Health Connect permissions</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function Report({ night, played }: { night: NightReport; played: PlayedSession[] }) {
  const span = +night.end - +night.start;
  const x = (d: Date) => `${Math.max(0, Math.min(100, ((+d - +night.start) / span) * 100))}%`;
  const w = (a: Date, b: Date) => `${Math.max(0.3, ((+b - +a) / span) * 100)}%`;
  const zepp = /huami|zepp/i.test(night.source);

  return (
    <>
      <View style={st.card}>
        <Text style={st.label}>{zepp ? 'From Zepp' : night.source ? `From ${night.source}` : 'From Health Connect'}</Text>
        <Text style={st.big}>{hm(night.asleepMinutes)}</Text>
        <Text style={st.muted}>
          asleep · {time(night.start)} – {time(night.end)}
        </Text>

        {night.stages.length > 0 && (
          <>
            <View style={st.hyp}>
              {night.stages.map((s, i) => (
                <View
                  key={i}
                  style={[st.hypBar, { left: x(s.start) as never, width: w(s.start, s.end) as never, top: (ROW[s.stage] ?? 2) * 16, backgroundColor: COLOR[s.stage] ?? C.border2 }]}
                />
              ))}
            </View>
            <View style={st.legend}>
              {(['deep', 'light', 'rem', 'awake'] as HcStage[]).map((k) => (
                <View key={k} style={st.legendItem}>
                  <View style={[st.dot, { backgroundColor: COLOR[k] }]} />
                  <Text style={st.muted}>
                    {k === 'rem' ? 'REM' : k[0].toUpperCase() + k.slice(1)} {hm(night.minutes[k] + (k === 'light' ? night.minutes.asleep : 0))}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </View>

      <View style={st.tiles}>
        <Tile label="Heart rate" value={night.hr ? `${Math.round(night.hr.min)}–${Math.round(night.hr.max)}` : '—'} unit={night.hr ? `bpm · avg ${Math.round(night.hr.avg)}` : 'no data'} />
        <Tile label="HRV" value={night.hrv ? `${Math.round(night.hrv)}` : '—'} unit={night.hrv ? 'ms average' : 'no data'} />
        <Tile label="Blood oxygen" value={night.spo2 ? `${Math.round(night.spo2.avg)}%` : '—'} unit={night.spo2 ? `low ${Math.round(night.spo2.min)}%` : 'no data'} />
        <Tile label="Breathing" value={night.breathing ? night.breathing.toFixed(1) : '—'} unit={night.breathing ? 'breaths/min' : 'no data'} />
      </View>

      <View style={st.card}>
        <Text style={st.label}>What AuraStream played</Text>
        {played.length === 0 && <Text style={st.muted}>Nothing played during this sleep.</Text>}
        {played.map((p, i) => {
          const s = new Date(p.start);
          const e = p.end ? new Date(p.end) : night.end;
          return (
            <View key={i} style={{ gap: 6 }}>
              <Text style={st.body}>
                {p.protocol} · {soundscapeLabel(p.soundscape as Soundscape)} · {p.mode === 'binaural' ? 'headphones' : 'speaker'}
              </Text>
              <Text style={st.muted}>
                {time(s)} – {p.end ? time(e) : 'still playing'}
              </Text>
              <View style={st.track}>
                <View style={[st.trackFill, { left: x(s) as never, width: w(s < night.start ? night.start : s, e > night.end ? night.end : e) as never }]} />
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

function Tile({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={st.tile}>
      <Text style={st.label}>{label}</Text>
      <Text style={st.tileValue}>{value}</Text>
      <Text style={st.muted}>{unit}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' },
  title: { fontFamily: F.serifMedium, fontSize: 32, color: C.text1 },
  label: { fontFamily: F.sansMedium, fontSize: 11.5, letterSpacing: 1.4, textTransform: 'uppercase', color: C.text3 },
  body: { fontFamily: F.sans, fontSize: 15, color: C.text1, lineHeight: 21 },
  muted: { fontFamily: F.sans, fontSize: 13, color: C.text2, lineHeight: 18 },
  link: { fontFamily: F.sansMedium, fontSize: 15, color: C.amber },
  big: { fontFamily: F.serif, fontSize: 44, color: C.text1 },
  card: { gap: 10, padding: 18, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  button: { alignItems: 'center', paddingVertical: 13, borderRadius: 14, backgroundColor: C.amberDeep },
  buttonText: { fontFamily: F.sansBold, fontSize: 15, color: C.bg },
  hyp: { height: 70, marginTop: 6, position: 'relative' },
  hypBar: { position: 'absolute', height: 10, borderRadius: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '45%', gap: 2, padding: 14, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  tileValue: { fontFamily: F.serif, fontSize: 30, color: C.amber, fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, backgroundColor: C.border2, position: 'relative', overflow: 'hidden' },
  trackFill: { position: 'absolute', top: 0, bottom: 0, backgroundColor: C.amberDeep },
});
