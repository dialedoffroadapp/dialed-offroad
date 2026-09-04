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
import { logMoto, nextMotoNumber, readOpenSession, type MotoSymptom, type RideSession, type Sentiment } from "../../lib/rideDay";
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
    const next = await logMoto(s, { sentiment, symptoms, note: note.trim() || null });
    void logEvent("moto_logged", {
      moto: n,
      sentiment,
      symptom_ids: symptoms.map((x) => x.id),
      qualifiers: symptoms.map((x) => x.qualifier),
      has_note: !!note.trim(),
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
          <Eyebrow style={{ marginBottom: 0 }}>Log moto {n}</Eyebrow>
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

        <View style={styles.noteRow}>
          <Ionicons name="create-outline" size={18} color={V3.steel} />
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Say it your way (optional). Voice arrives with the next update."
            placeholderTextColor={V3.steel}
            style={[styles.note, interFont(400)]}
            multiline
            maxLength={400}
          />
        </View>

        <View style={{ flex: 1 }} />
        <Cta label={saving ? "Saving…" : "Save moto"} dim={!canSave} disabled={saving} onPress={() => void onSave()} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX, flexGrow: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  card: { backgroundColor: V3.panel, borderRadius: 16, padding: 16, marginBottom: 12 },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10 },
  note: { flex: 1, color: "#FFFFFF", fontSize: 14, minHeight: 40, paddingTop: 0 },
});
