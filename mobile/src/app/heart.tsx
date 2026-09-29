// Heart-rate device setup: find a watch or strap that broadcasts heart rate and remember it.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { askPermissions, bluetoothAvailable, scan, stopScan, type FoundDevice } from '@/sleep/heartRate';
import { loadDevice, saveDevice, type SavedDevice } from '@/sleep/tracker';
import { C, F } from '@/theme';

export default function HeartSetup() {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<SavedDevice | null>(null);
  const [found, setFound] = useState<FoundDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    loadDevice().then(setCurrent);
    return () => stopScan();
  }, []);

  const find = async () => {
    setNote('');
    if (!(await askPermissions())) {
      setNote('AuraStream needs “Nearby devices” permission to find your watch. Allow it, then try again.');
      return;
    }
    setFound([]);
    setScanning(true);
    try {
      await scan((d) => setFound((cur) => [...cur, d]));
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Scan failed. Check that Bluetooth is on.');
    }
    setScanning(false);
  };

  const pick = (d: FoundDevice) => {
    const saved = { id: d.id, name: d.name };
    saveDevice(saved);
    setCurrent(saved);
    stopScan();
    router.back();
  };

  return (
    <ScrollView style={st.screen} contentContainerStyle={[st.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }]}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
        <Text style={st.link}>‹ Back</Text>
      </Pressable>
      <Text style={st.title}>Heart rate</Text>
      <Text style={st.body}>
        AuraStream estimates your sleep stage from your heart rate and how much you move. Any watch or strap that broadcasts
        heart rate over Bluetooth works.
      </Text>

      <View style={st.steps}>
        <Text style={st.label}>Amazfit (T-Rex 3 and other Zepp OS watches)</Text>
        <Text style={st.body}>1. Turn on Heart rate broadcast (called Heart Rate Push on some models). It doesn’t need a workout running on the T-Rex 3 if it stays on at the watch face.</Text>
        <Text style={st.body}>2. Keep the watch near the phone, then tap Find devices below.</Text>
        <Text style={st.muted}>Leaving it on all night uses more watch battery. Try one night and check how much.</Text>
      </View>

      {current && (
        <View style={st.row}>
          <View style={{ flex: 1 }}>
            <Text style={st.label}>Using</Text>
            <Text style={st.body}>{current.name}</Text>
          </View>
          <Pressable
            onPress={() => {
              saveDevice(null);
              setCurrent(null);
            }}
            accessibilityRole="button">
            <Text style={st.link}>Forget</Text>
          </Pressable>
        </View>
      )}

      {bluetoothAvailable ? (
        <Pressable onPress={find} disabled={scanning} style={[st.button, scanning && { opacity: 0.6 }]} accessibilityRole="button">
          <Text style={st.buttonText}>{scanning ? 'Looking for devices…' : 'Find devices'}</Text>
        </Pressable>
      ) : (
        <Text style={st.body}>Heart rate needs the Android app; the web version can’t use Bluetooth in the background.</Text>
      )}
      {!!note && <Text style={st.body}>{note}</Text>}

      {found.map((d) => (
        <Pressable key={d.id} onPress={() => pick(d)} style={st.row} accessibilityRole="button" accessibilityLabel={`Use ${d.name}`}>
          <View style={{ flex: 1 }}>
            <Text style={st.body}>{d.name}</Text>
            <Text style={st.muted}>{d.rssi !== null ? `Signal ${d.rssi} dBm` : d.id}</Text>
          </View>
          <Text style={st.link}>Use</Text>
        </Pressable>
      ))}
      {!scanning && found.length === 0 && bluetoothAvailable && (
        <Text style={st.muted}>Nothing found yet. Make sure Heart rate broadcast is on and the watch is close to the phone.</Text>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' },
  title: { fontFamily: F.serifMedium, fontSize: 32, color: C.text1 },
  label: { fontFamily: F.sansMedium, fontSize: 11.5, letterSpacing: 1.4, textTransform: 'uppercase', color: C.text3 },
  body: { fontFamily: F.sans, fontSize: 15, color: C.text1, lineHeight: 21 },
  muted: { fontFamily: F.sans, fontSize: 13, color: C.text2, lineHeight: 18 },
  steps: { gap: 8, padding: 16, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border2 },
  button: { alignItems: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: C.amberDeep },
  buttonText: { fontFamily: F.sansBold, fontSize: 15, color: C.bg },
  link: { fontFamily: F.sansMedium, fontSize: 15, color: C.amber },
});
