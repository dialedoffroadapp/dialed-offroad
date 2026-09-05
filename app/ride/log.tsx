// app/ride/log.tsx — Log moto (design/mockups/ride/08, OUTDOOR). Better /
// Same / Worse at 56pt, 4 large symptom chips + "More symptoms", a terrain
// qualifier only for the ambiguous chips (phrased per chip), an optional
// note (typed; on-device voice needs a native module — flagged). Save writes
// the moto (track_sessions via the outbox) and hands symptoms to Adjust.
// Chips carry the debrief's severity: tap once = mild, twice = bad, again
// clears. ?quick=1 (setup sheet "Refine after ride", the retired debrief's
// redirect) opens the same screen on a quick session: no clock, no track,
// Done on Adjust settles ONE version on that setup and returns to its sheet.
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Eyebrow, Label, Small } from "../../components/v3/primitives";
import { interFont, V3 } from "../../components/v3/theme";
import { ChoiceChip, Cta, Grid, RideH1, RideScreenBg } from "../../components/ride/ridePrimitives";
import { clearOpenSession, logMoto, motoDurationMin, nextMotoNumber, readOpenSession, type MotoSymptom, type RideSession, type Sentiment } from "../../lib/rideDay";
import { finishQuickRefine } from "../../lib/rideEnd";
import { startQuickRefine } from "../../lib/rideRefine";
import { BottomSheet } from "../../components/v3/BottomSheet";
import { SayItYourWay } from "../../components/ride/SayItYourWay";
import { MORE_SYMPTOMS, PRIMARY_SYMPTOMS, type SymptomChip, type SymptomLevel } from "../../lib/rideSymptoms";
import { logEvent } from "../../lib/usage";

export default function RideLogScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { quick, bikeId, setupId, versionId } = useLocalSearchParams<{ quick?: string; bikeId?: string; setupId?: string; versionId?: string }>();
  const isQuick = quick === "1";
  const [s, setS] = useState<RideSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [picked, setPicked] = useState<SymptomChip | null>(null);
  const [level, setLevel] = useState<SymptomLevel>("mild");
  const [qualifier, setQualifier] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [note, setNote] = useState("");
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [laps, setLaps] = useState<string>("");
  const [editTime, setEditTime] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isQuick) {
      void readOpenSession().then((open) => (open ? setS(open) : router.replace("/(tabs)" as never)));
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const open = await readOpenSession();
        // A real ride day owns the log; the sheet's button is not reachable
        // during one, but a deep link is.
        if (open && !open.quick) return router.replace("/ride/mode" as never);
        if (open?.quick && open.bike.id !== String(bikeId ?? "")) await clearOpenSession();
        const session = open?.quick && open.bike.id === String(bikeId ?? "") ? open : await startQuickRefine({ bikeId: String(bikeId ?? ""), setupId: setupId ?? null, versionId: versionId ?? null });
        if (alive) setS(session);
      } catch (e: any) {
        if (alive) setLoadError(e?.message ?? "Couldn't load that setup.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [router, isQuick, bikeId, setupId, versionId]);

  const sheetRoute = (session: RideSession) => ({ pathname: "/setup-sheet", params: { bikeId: session.bike.id, setupId: session.setupId ?? "default" } });

  if (loadError) {
    return (
      <View style={[RideScreenBg({ out: true }), styles.center, { padding: 24 }]}>
        <Small style={{ textAlign: "center", fontSize: 15 }}>{loadError}</Small>
        <Cta label="Back" onPress={() => router.back()} style={{ marginTop: 18, alignSelf: "stretch" }} />
      </View>
    );
  }
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

  // Tap once = mild, twice = bad, a third tap clears (the debrief's picker,
  // ported onto the chips).
  const tapSymptom = (chip: SymptomChip) => {
    void Haptics.selectionAsync().catch(() => {});
    if (picked?.id === chip.id) {
      if (level === "mild") {
        setLevel("bad");
        return;
      }
      setPicked(null);
      setQualifier(null);
      setLevel("mild");
      return;
    }
    setPicked(chip);
    setLevel("mild");
    setQualifier(null);
  };
  const levelSub = (chip: SymptomChip) => (picked?.id === chip.id ? (level === "bad" ? "Bad" : "Mild") : undefined);

  const onBack = async () => {
    // Backing out of a quick refine before saving drops the empty session.
    if (s.quick && s.motos.length === 0) await clearOpenSession();
    router.back();
  };

  const onSave = async () => {
    if (!canSave || saving || !sentiment) return;
    setSaving(true);
    const symptoms: MotoSymptom[] = picked ? [{ id: picked.id, qualifier, label: picked.label, level }] : [];
    const lapsNum = laps.trim() ? Number(laps) : null;
    const next = await logMoto(s, { sentiment, symptoms, note: note.trim() || null, durationMin: durationMin ?? motoDurationMin(s), laps: Number.isFinite(lapsNum as number) ? lapsNum : null });
    void logEvent("moto_logged", {
      moto: n,
      sentiment,
      symptom_ids: symptoms.map((x) => x.id),
      qualifiers: symptoms.map((x) => x.qualifier),
      levels: symptoms.map((x) => x.level ?? null),
      quick: !!s.quick,
      has_note: !!note.trim(),
      duration_min: durationMin ?? motoDurationMin(s),
      laps: laps.trim() ? Number(laps) : null,
    });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setSaving(false);
    if (symptoms.length) {
      router.replace({ pathname: "/ride/adjust", params: { symptom: symptoms[0].id, qualifier: qualifier ?? "", moto: String(n), sentiment, level } } as never);
    } else if (next.quick) {
      // Nothing to adjust: the feedback row is queued; no version is made.
      await finishQuickRefine(next);
      router.replace(sheetRoute(next) as never);
    } else {
      router.back();
    }
  };

  return (
    <View style={RideScreenBg({ out: true })}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => void onBack()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={V3.steel} />
          </Pressable>
          {s.quick ? (
            <Eyebrow style={{ marginBottom: 0 }}>Refine · {s.setupName}</Eyebrow>
          ) : (
            <Pressable onPress={() => setEditTime(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit moto time and laps">
              <Eyebrow style={{ marginBottom: 0 }}>
                Moto {n} · {durationMin ?? motoDurationMin(s)} min{laps.trim() ? ` · ${laps.trim()} laps` : ""} <Ionicons name="pencil-outline" size={12} color={V3.steel} />
              </Eyebrow>
            </Pressable>
          )}
        </View>
        <RideH1 out>{s.quick ? "How did it feel?" : "How was it?"}</RideH1>

        <Grid cols={3} style={{ marginBottom: 12 }}>
          {(["better", "same", "worse"] as Sentiment[]).map((x) => (
            <ChoiceChip key={x} out label={x[0].toUpperCase() + x.slice(1)} on={sentiment === x} dim onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); setSentiment(x); }} />
          ))}
        </Grid>

        <Grid cols={2} style={{ marginBottom: 6 }}>
          {PRIMARY_SYMPTOMS.map((c) => (
            <ChoiceChip key={c.id} out label={c.label} sub={levelSub(c)} on={picked?.id === c.id} onPress={() => tapSymptom(c)} />
          ))}
        </Grid>
        <Small style={{ marginBottom: 10, color: V3.muted, fontSize: 12 }}>Tap once for mild, twice for bad.</Small>
        {more ? (
          <Grid cols={2} style={{ marginBottom: 10 }}>
            {MORE_SYMPTOMS.map((c) => (
              <ChoiceChip key={c.id} out label={c.label} sub={levelSub(c)} on={picked?.id === c.id} onPress={() => tapSymptom(c)} minHeight={48} />
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
        <Cta label={saving ? "Saving…" : s.quick ? (picked ? "Next: adjust" : "Save") : "Save moto"} dim={!canSave} disabled={saving} onPress={() => void onSave()} />
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
