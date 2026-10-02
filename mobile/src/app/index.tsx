// The sleep session screen: pick a protocol, set the mix, timer and wake time, press play and put the phone down.
import Slider from '@react-native-community/slider';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { engine, resolveMode, type CarrierMode, type ModeChoice } from '@/audio/engine';
import { bandName, beatAt, PROTOCOLS, protocolById, type Mix } from '@/audio/protocols';
import { SOUNDSCAPES, soundscapeLabel } from '@/audio/soundscapes';
import { StageCard } from '@/sleep/StageCard';
import { tracker } from '@/sleep/tracker';
import { clockLabel, DEFAULTS, loadSettings, nextWake, saveSettings, type Settings } from '@/settings';
import { C, F } from '@/theme';

const TIMERS: [number | null, string][] = [[30, '30 min'], [60, '1 hour'], [90, '90 min'], [null, 'All night']];
const MIX_ROWS: [keyof Mix, string][] = [['carrier', 'Beat tone'], ['noise', 'Soundscape'], ['ambient', 'Ambient pad']];

const hz = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));
const clock = (sec: number) => {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

export default function Session() {
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<Settings>(DEFAULTS);
  // start from the engine's state: after the screen is closed and reopened, a session may still be playing
  const [playing, setPlaying] = useState(engine.playing);
  const [busy, setBusy] = useState(false);
  // what the sound is actually using right now (Auto resolves to one of these)
  const [activeMode, setActiveMode] = useState<CarrierMode | null>(engine.current?.mode ?? null);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<Date | null>(engine.startedAtWall);
  const loaded = useRef(false);

  useEffect(() => {
    loadSettings().then((saved) => {
      loaded.current = true;
      setS(saved);
    });
  }, []);
  useEffect(() => {
    if (loaded.current) saveSettings(s);
  }, [s]);
  // follow the engine, so a Stop from the notification (or a reopened screen) shows the right state
  useEffect(
    () =>
      engine.onChange((on) => {
        setPlaying(on);
        setStartedAt(engine.startedAtWall);
        if (on) setElapsed(engine.elapsed());
        else tracker.stop();
      }),
    [],
  );
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setElapsed(engine.elapsed()), 1000);
    return () => clearInterval(id);
  }, [playing]);

  const protocol = protocolById(s.protocolId);
  const mix = s.mix ?? protocol.mix;
  const scape = s.soundscape ?? protocol.noise;
  const beat = beatAt(protocol, playing ? elapsed : 0);
  const from = startedAt ?? new Date();
  const wakeAt = s.wakeEnabled ? nextWake(s.wakeMinutes, from) : null;

  const plan = async (over: Partial<Settings> = {}) => {
    const n = { ...s, ...over };
    const p = protocolById(n.protocolId);
    const mode = await resolveMode(n.mode);
    setActiveMode(mode);
    return {
      protocol: p,
      mix: n.mix ?? p.mix,
      mode,
      soundscape: n.soundscape ?? p.noise,
      sleepMinutes: n.sleepMinutes,
      wakeAt: n.wakeEnabled ? nextWake(n.wakeMinutes) : null,
    };
  };

  const start = async (over: Partial<Settings> = {}) => {
    setBusy(true);
    try {
      await engine.start(await plan(over));
      if (!tracker.running) tracker.start();
      setStartedAt(new Date());
      setElapsed(0);
      setPlaying(true);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    await engine.stop();
    await tracker.stop();
    setPlaying(false);
    setStartedAt(null);
    setBusy(false);
  };

  // Changes that alter the whole session (protocol, timer, wake) restart it; mix and mode change live.
  const change = (over: Partial<Settings>, restart: boolean) => {
    setS((cur) => ({ ...cur, ...over }));
    if (playing && restart) start(over);
  };
  const setMix = (key: keyof Mix, v: number) => {
    const next = { ...mix, [key]: v };
    setS((cur) => ({ ...cur, mix: next }));
    engine.setMix(next);
  };
  const setMode = async (choice: ModeChoice) => {
    setS((cur) => ({ ...cur, mode: choice }));
    const mode = await resolveMode(choice);
    setActiveMode(mode);
    engine.setMode(mode);
  };

  const onsetEnd = new Date(from.getTime() + protocol.onsetMinutes * 60e3);
  const fadeEnd = s.sleepMinutes ? new Date(from.getTime() + s.sleepMinutes * 60e3) : null;

  return (
    <ScrollView style={st.screen} contentContainerStyle={[st.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}>
      <View style={st.header}>
        <Text style={st.brand}>AuraStream</Text>
        <Text style={st.muted}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
      </View>

      <View style={st.chips}>
        {PROTOCOLS.map((p) => (
          <Chip key={p.id} label={p.name} on={p.id === s.protocolId} onPress={() => change({ protocolId: p.id, mix: null }, true)} />
        ))}
      </View>

      <View style={st.hero}>
        <Text style={st.label}>{playing ? 'Tonight’s protocol · playing' : 'Tonight’s protocol'}</Text>
        <Text style={st.protocolName}>{protocol.name}</Text>
        <Text style={st.muted}>{protocol.summary}</Text>
        <Text style={st.muted}>with {soundscapeLabel(scape).toLowerCase()}</Text>
        <View style={st.beatRow}>
          <Text style={st.beat}>{hz(beat)}</Text>
          <Text style={st.beatUnit}>Hz {bandName(beat)}</Text>
        </View>
        <Pressable
          onPress={playing ? stop : () => start()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Stop session' : 'Start session'}
          style={({ pressed }) => [st.play, playing && st.playOn, (pressed || busy) && { opacity: 0.6 }]}>
          <Text style={[st.playIcon, playing && { color: C.bg }]}>{playing ? '■' : '▶'}</Text>
        </Pressable>
        <Text style={st.timer}>{playing ? clock(elapsed) : 'Press play, then put the phone down'}</Text>
      </View>

      <StageCard />

      <Section title="Soundscape">
        <View style={st.chips}>
          {SOUNDSCAPES.map(([k, label]) => (
            <Chip key={k} label={label} on={scape === k} onPress={() => change({ soundscape: k === protocol.noise ? null : k }, true)} />
          ))}
        </View>
      </Section>

      <Section title="Sound">
        <View style={st.segment}>
          {(['auto', 'binaural', 'isochronic'] as ModeChoice[]).map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[st.segBtn, s.mode === m && st.segOn]}>
              <Text style={[st.segText, s.mode === m && { color: C.amber }]}>{m === 'auto' ? 'Auto' : m === 'binaural' ? 'Headphones' : 'Speaker'}</Text>
              <Text style={st.segSub}>
                {m === 'auto'
                  ? activeMode
                    ? `now: ${activeMode === 'binaural' ? 'headphones' : 'speaker'}`
                    : 'detects headphones'
                  : m === 'binaural'
                    ? 'binaural beat'
                    : 'pulsed tone'}
              </Text>
            </Pressable>
          ))}
        </View>
        {MIX_ROWS.map(([key, label]) => (
          <View key={key} style={st.mixRow}>
            <View style={st.mixHead}>
              <Text style={st.body}>{label}</Text>
              <Text style={st.muted}>{Math.round(mix[key] * 100)}%</Text>
            </View>
            <Slider
              value={mix[key]}
              onValueChange={(v) => setMix(key, v)}
              minimumValue={0}
              maximumValue={1}
              step={0.01}
              minimumTrackTintColor={C.amberDeep}
              maximumTrackTintColor={C.border2}
              thumbTintColor={C.amber}
              accessibilityLabel={`${label} volume`}
            />
          </View>
        ))}
      </Section>

      <Section title="Sleep timer">
        <View style={st.chips}>
          {TIMERS.map(([m, label]) => (
            <Chip key={label} label={label} on={s.sleepMinutes === m} onPress={() => change({ sleepMinutes: m }, true)} />
          ))}
        </View>
      </Section>

      <Section title="Wake">
        <View style={st.wakeRow}>
          <Chip label={s.wakeEnabled ? 'On' : 'Off'} on={s.wakeEnabled} onPress={() => change({ wakeEnabled: !s.wakeEnabled }, true)} />
          <View style={[st.stepper, !s.wakeEnabled && { opacity: 0.4 }]}>
            <Step label="−15" onPress={() => change({ wakeMinutes: (s.wakeMinutes + 1440 - 15) % 1440, wakeEnabled: true }, true)} />
            <Text style={st.wakeTime}>{clockLabel(nextWake(s.wakeMinutes))}</Text>
            <Step label="+15" onPress={() => change({ wakeMinutes: (s.wakeMinutes + 15) % 1440, wakeEnabled: true }, true)} />
          </View>
        </View>
        <Text style={st.muted}>Brighter tones rise over the 15 minutes before this time.</Text>
      </Section>

      <Section title="Tonight’s schedule">
        <Row time={`${clockLabel(from)} – ${clockLabel(onsetEnd)}`} what={`Onset · ${hz(protocol.beatStart)} Hz ${bandName(protocol.beatStart)} easing to ${hz(protocol.beatEnd)} Hz ${bandName(protocol.beatEnd)}`} />
        <Row time={`from ${clockLabel(onsetEnd)}`} what={`Settled · ${hz(protocol.beatEnd)} Hz ${bandName(protocol.beatEnd)}`} />
        <Row time={fadeEnd ? clockLabel(fadeEnd) : '—'} what={fadeEnd ? 'Fades to silence over the last 10 minutes' : 'Plays all night'} />
        {wakeAt && <Row time={`${clockLabel(new Date(wakeAt.getTime() - 15 * 60e3))} – ${clockLabel(wakeAt)}`} what="Wake ramp" />}
      </Section>

      <Text style={st.footnote}>
        {s.mode === 'binaural' ? 'Binaural beats need headphones. ' : ''}
        Keep the phone plugged in overnight. AuraStream is a relaxation aid, not a medical treatment.
      </Text>
    </ScrollView>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={[st.chip, on && st.chipOn]}>
      <Text style={[st.chipText, on && { color: C.amber }]}>{label}</Text>
    </Pressable>
  );
}

function Step({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={st.step} accessibilityRole="button" accessibilityLabel={`${label} minutes`}>
      <Text style={st.stepText}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={st.section}>
      <Text style={st.label}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ time, what }: { time: string; what: string }) {
  return (
    <View style={st.schedRow}>
      <Text style={st.schedTime}>{time}</Text>
      <Text style={[st.body, { flex: 1 }]}>{what}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, gap: 22, maxWidth: 560, width: '100%', alignSelf: 'center' },
  header: { gap: 2 },
  brand: { fontFamily: F.serifMedium, fontSize: 30, color: C.text1 },
  muted: { fontFamily: F.sans, fontSize: 13.5, color: C.text2, lineHeight: 19 },
  body: { fontFamily: F.sans, fontSize: 15, color: C.text1, lineHeight: 21 },
  label: { fontFamily: F.sansMedium, fontSize: 11.5, letterSpacing: 1.4, textTransform: 'uppercase', color: C.text3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.border2, backgroundColor: C.surface },
  chipOn: { borderColor: C.amberDeep, backgroundColor: C.card2 },
  chipText: { fontFamily: F.sansMedium, fontSize: 14, color: C.text2 },
  hero: { alignItems: 'center', gap: 6, paddingVertical: 26, paddingHorizontal: 18, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  protocolName: { fontFamily: F.serif, fontSize: 34, color: C.text1, textAlign: 'center' },
  beatRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 },
  beat: { fontFamily: F.serif, fontSize: 64, color: C.amber, fontVariant: ['tabular-nums'] },
  beatUnit: { fontFamily: F.sansMedium, fontSize: 15, color: C.text2 },
  play: { width: 84, height: 84, borderRadius: 42, borderWidth: 1.5, borderColor: C.amberDeep, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  playOn: { backgroundColor: C.amber, borderColor: C.amber },
  playIcon: { fontSize: 28, color: C.amber, marginLeft: 3 },
  timer: { fontFamily: F.sans, fontSize: 14, color: C.text2, marginTop: 6, fontVariant: ['tabular-nums'] },
  section: { gap: 12 },
  segment: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border2, backgroundColor: C.surface },
  segOn: { borderColor: C.amberDeep, backgroundColor: C.card2 },
  segText: { fontFamily: F.sansMedium, fontSize: 15, color: C.text2 },
  segSub: { fontFamily: F.sans, fontSize: 12.5, color: C.text3 },
  mixRow: { gap: 2 },
  mixHead: { flexDirection: 'row', justifyContent: 'space-between' },
  wakeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.border2 },
  stepText: { fontFamily: F.sansMedium, fontSize: 14, color: C.text2 },
  wakeTime: { fontFamily: F.serif, fontSize: 28, color: C.text1, minWidth: 110, textAlign: 'center', fontVariant: ['tabular-nums'] },
  schedRow: { flexDirection: 'row', gap: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  schedTime: { fontFamily: F.sansMedium, fontSize: 13.5, color: C.amberDeep, width: 128, fontVariant: ['tabular-nums'] },
  footnote: { fontFamily: F.sans, fontSize: 12.5, color: C.text3, lineHeight: 18 },
});
