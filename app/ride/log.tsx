// app/ride/log.tsx — Log moto (design/mockups/ride/08, OUTDOOR). Better /
// Same / Worse at 56pt, 4 large symptom chips + "More symptoms", a terrain
// qualifier only for the ambiguous chips (phrased per chip), an optional
// note (typed; on-device voice needs a native module — flagged). Save writes
// the moto (track_sessions via the outbox) and hands symptoms to Adjust.
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Eyebrow, Label, Small } from "../../components/v3/primitives";
import { interFont, V3 } from "../../components/v3/theme";
import { ChoiceChip, Cta, Grid, RideH1, RideScreenBg } from "../../components/ride/ridePrimitives";
import { logMoto, motoDurationMin, nextMotoNumber, readOpenSession, type MotoSymptom, type RideSession, type Sentiment } from "../../lib/rideDay";
import { BottomSheet } from "../../components/v3/BottomSheet";
import { SayItYourWay } from "../../components/ride/SayItYourWay";
import { MORE_SYMPTOMS, PRIMARY_SYMPTOMS, type SymptomChip } from "../../lib/rideSymptoms";
import { logEvent } from "../../lib/usage";

export default function RideLogScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<RideSession | null>(null);
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [picked, setPicked] = useState<SymptomChip | null>(null);
  const [qualifier, setQualifier] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [note, setNote] = useState("");
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [laps, setLaps] = useState<string>("");
  const [editTime, setEditTime] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void readOpenSession().then((open) => (open ? setS(open) : router.replace("/(tabs)" as never)));
  }, [router]);

  if (!s) {
    return (
      <View style={[RideScreenBg({ out: true }), styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  const n = nextMotoNumber(s);
  const needsQualifier = !!picked?.qualifiers?.length;
  const canSave = !!sentiment && (!needsQualifier || !!qualifier);

  const tapSymptom = (chip: SymptomChip) => {
    void Haptics.selectionAsync().catch(() => {});
    if (picked?.id === chip.id) {
      setPicked(null);
      setQualifier(null);
      return;
    }
    setPicked(chip);
    setQualifier(null);
  };

  const onSave = async () => {
    if (!canSave || saving || !sentiment) return;
    setSaving(true);
    const symptoms: MotoSymptom[] = picked ? [{ id: picked.id, qualifier, label: picked.label }] : [];
    const lapsNum = laps.trim() ? Number(laps) : null;
    const next = await logMoto(s, { sentiment, symptoms, note: note.trim() || null, durationMin: durationMin ?? motoDurationMin(s), laps: Number.isFinite(lapsNum as number) ? lapsNum : null });
    void logEvent("moto_logged", {
      moto: n,
      sentiment,
      symptom_ids: symptoms.map((x) => x.id),
      qualifiers: symptoms.map((x) => x.qualifier),
      has_note: !!note.trim(),
      duration_min: durationMin ?? motoDurationMin(s),
      laps: laps.trim() ? Number(laps) : null,
    });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSaving(false);
    if (symptoms.length) {
      router.replace({ pathname: "/ride/adjust", params: { symptom: symptoms[0].id, qualifier: qualifier ?? "", moto: String(n), sentiment } } as never);
    } else {
      router.back();
    }
    void next;
  };

  return (
    <View style={RideScreenBg({ out: true })}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={V3.steel} />
          </Pressable>
          <Pressable onPress={() => setEditTime(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit moto time and laps">
            <Eyebrow style={{ marginBottom: 0 }}>
              Moto {n} · {durationMin ?? motoDurationMin(s)} min{laps.trim() ? ` · ${laps.trim()} laps` : ""} <Ionicons name="pencil-outline" size={12} color={V3.steel} />
            </Eyebrow>
          </Pressable>
        </View>
        <RideH1 out>How was it?</RideH1>

        <Grid cols={3} style={{ marginBottom: 12 }}>
          {(["better", "same", "worse"] as Sentiment[]).map((x) => (
            <ChoiceChip key={x} out label={x[0].toUpperCase() + x.slice(1)} on={sentiment === x} dim onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); setSentiment(x); }} />
          ))}
        </Grid>

        <Grid cols={2} style={{ marginBottom: 10 }}>
          {PRIMARY_SYMPTOMS.map((c) => (
            <ChoiceChip key={c.id} out label={c.label} on={picked?.id === c.id} onPress={() => tapSymptom(c)} />
          ))}
        </Grid>
        {more ? (
          <Grid cols={2} style={{ marginBottom: 10 }}>
            {MORE_SYMPTOMS.map((c) => (
              <ChoiceChip key={c.id} out label={c.label} on={picked?.id === c.id} onPress={() => tapSymptom(c)} minHeight={48} />
            ))}
          </Grid>
        ) : (
          <ChoiceChip out label="More symptoms" dim minHeight={48} style={{ marginBottom: 10 }} onPress={() => setMore(true)} />
        )}

        {needsQualifier && picked ? (
          <View style={styles.card}>
            <Label style={{ color: V3.blue, marginBottom: 8 }}>{picked.qualifierPrompt}</Label>
            <Grid cols={2}>
              {picked.qualifiers!.map((q) => (
                <ChoiceChip key={q} out label={q} on={qualifier === q} dim minHeight={48} onPress={() => setQualifier(q)} style={qualifier === q ? undefined : { borderColor: V3.line }} />
              ))}
            </Grid>
          </View>
        ) : null}

        <SayItYourWay value={note} onChangeText={setNote} />

        <View style={{ flex: 1 }} />
        <Cta label={saving ? "Saving…" : "Save moto"} dim={!canSave} disabled={saving} onPress={() => void onSave()} />
      </ScrollView>
      <BottomSheet open={editTime} onClose={() => setEditTime(false)} title={`Moto ${n}`}>
        <Small style={{ marginBottom: 12 }}>Timed from the clock start or your last log. Fix it if you sat around.</Small>
        <Label style={{ marginBottom: 6 }}>Minutes</Label>
        <TextInput
          value={String(durationMin ?? motoDurationMin(s))}
          onChangeText={(t) => setDurationMin(t.trim() === "" ? null : Math.max(0, Math.min(600, Math.round(Number(t) || 0))))}
          keyboardType="number-pad"
          style={[styles.field, interFont(600)]}
          accessibilityLabel="Moto minutes"
        />
        <Label style={{ marginTop: 12, marginBottom: 6 }}>Laps (optional)</Label>
        <TextInput
          value={laps}
          onChangeText={(t) => setLaps(t.replace(/[^0-9]/g, "").slice(0, 3))}
          keyboardType="number-pad"
          placeholder="—"
          placeholderTextColor={V3.steel}
          style={[styles.field, interFont(600)]}
          accessibilityLabel="Lap count"
        />
        <Cta label="Done" onPress={() => setEditTime(false)} style={{ marginTop: 16 }} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX, flexGrow: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  card: { backgroundColor: V3.panel, borderRadius: 16, padding: 16, marginBottom: 12 },
  field: { backgroundColor: V3.panel, borderRadius: 12, color: "#FFFFFF", fontSize: 18, paddingHorizontal: 14, paddingVertical: 12 },
});
