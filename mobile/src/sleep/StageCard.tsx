// The live sleep-stage card on the session screen: heart rate, tonight's estimated stage, and the night so far.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { C, F } from '@/theme';

import { STAGE_LABEL, type Epoch, type Stage } from './estimator';
import { loadDevice, tracker, type SavedDevice, type TrackerView } from './tracker';

export function useTracker() {
  const [view, setView] = useState<TrackerView>(tracker.view);
  useEffect(() => tracker.subscribe(setView), []);
  return view;
}

const STAGE_COLOR: Record<Stage, string> = { awake: '#B89660', rem: '#8C6BB0', light: '#3A6080', deep: '#1F3F5C' };
const STAGE_ROW: Record<Stage, number> = { awake: 0, rem: 1, light: 2, deep: 3 };

const STATUS: Record<TrackerView['status'], string> = {
  off: 'Starts with your session',
  'no-device': 'No heart-rate device set up',
  connecting: 'Connecting…',
  connected: 'Connected',
  lost: 'Signal lost · reconnecting',
};

export function StageCard() {
  const v = useTracker();
  const [device, setDevice] = useState<SavedDevice | null>(null);
  useEffect(() => {
    loadDevice().then(setDevice);
  }, [v.status]);
  const e = v.latest;

  return (
    <View style={st.card}>
      <View style={st.top}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={st.label}>Sleep stage · estimate</Text>
          <Text style={st.stage}>{e ? STAGE_LABEL[e.stage] : '—'}</Text>
          <Text style={st.muted}>
            {device ? `${device.name} · ${STATUS[v.status]}` : STATUS['no-device']}
            {v.motionOn ? ' · motion on' : ''}
          </Text>
        </View>
        <View style={st.bpmBox}>
          <Text style={st.bpm}>{v.bpm ?? '—'}</Text>
          <Text style={st.muted}>bpm</Text>
        </View>
      </View>

      {e && (
        <View style={st.depthTrack} accessibilityLabel={`Depth ${e.depth} of 100`}>
          <View style={[st.depthFill, { width: `${Math.max(3, e.depth)}%` }]} />
        </View>
      )}
      {e && !e.confident && <Text style={st.muted}>Learning tonight’s baseline (first 15 minutes).</Text>}

      {v.epochs.length > 1 && <Hypnogram epochs={v.epochs} />}

      <Pressable onPress={() => router.push('/heart')} style={st.link} accessibilityRole="button">
        <Text style={st.linkText}>{device ? 'Change heart-rate device' : 'Set up heart rate'}</Text>
      </Pressable>
    </View>
  );
}

// The night so far: one thin bar per minute, higher = more awake.
function Hypnogram({ epochs }: { epochs: Epoch[] }) {
  const recent = epochs.slice(-480);
  return (
    <View style={st.hyp}>
      <View style={st.hypRows}>
        {(['awake', 'rem', 'light', 'deep'] as Stage[]).map((s) => (
          <Text key={s} style={st.hypLabel}>{s === 'rem' ? 'REM' : s[0].toUpperCase() + s.slice(1)}</Text>
        ))}
      </View>
      <View style={st.hypBars}>
        {recent.map((ep) => (
          <View key={ep.start} style={[st.hypBar, { marginTop: STAGE_ROW[ep.stage] * 14, backgroundColor: STAGE_COLOR[ep.stage] }]} />
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: { gap: 12, padding: 18, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontFamily: F.sansMedium, fontSize: 11.5, letterSpacing: 1.4, textTransform: 'uppercase', color: C.text3 },
  stage: { fontFamily: F.serif, fontSize: 30, color: C.text1 },
  muted: { fontFamily: F.sans, fontSize: 13, color: C.text2, lineHeight: 18 },
  bpmBox: { alignItems: 'center', minWidth: 70 },
  bpm: { fontFamily: F.serif, fontSize: 40, color: C.amber, fontVariant: ['tabular-nums'] },
  depthTrack: { height: 6, borderRadius: 3, backgroundColor: C.border2, overflow: 'hidden' },
  depthFill: { height: 6, borderRadius: 3, backgroundColor: C.amberDeep },
  hyp: { flexDirection: 'row', gap: 8, height: 60 },
  hypRows: { justifyContent: 'space-between', paddingVertical: 1 },
  hypLabel: { fontFamily: F.sans, fontSize: 10, color: C.text3, height: 12 },
  hypBars: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  hypBar: { flex: 1, height: 6, minWidth: 1 },
  link: { alignSelf: 'flex-start', paddingVertical: 4 },
  linkText: { fontFamily: F.sansMedium, fontSize: 14, color: C.amber },
});
