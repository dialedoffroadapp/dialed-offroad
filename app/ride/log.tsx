// app/ride/log.tsx — Log moto (design/mockups/ride/08, OUTDOOR). Better /
// Same / Worse at 56pt, then the full symptom taxonomy grouped Front / Rear /
// Both ends with discipline labels (finding 7, 2026-09-08), a where
// qualifier only for the ambiguous chips, and a visible free-text box (voice
// needs a native module — flagged). Save writes
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
import { canSaveLog, cycleLevel, symptomGroupsFor, type LoggedSymptom, type SymptomChip, type SymptomLevel } from "../../lib/rideSymptoms";
import { disciplineForBike } from "../../lib/discipline";
import { logEvent } from "../../lib/usage";

export default function RideLogScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { quick, bikeId, setupId, versionId } = useLocalSearchParams<{ quick?: string; bikeId?: string; setupId?: string; versionId?: string }>();
  const isQuick = quick === "1";
  const [s, setS] = useState<RideSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  // Multi-select over the full taxonomy (finding 7): id → level + where.
  const [picks, setPicks] = useState<Record<string, { level: SymptomLevel; qualifier: string | null }>>({});
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
  const groups = symptomGroupsFor(disciplineForBike(s.bike));
  const chipById = new Map<string, SymptomChip>(groups.flatMap((g) => g.chips).map((c) => [c.id, c]));
  const logged: LoggedSymptom[] = Object.entries(picks).map(([id, p]) => ({ id: id as LoggedSymptom["id"], level: p.level, qualifier: p.qualifier }));
  const canSave = canSaveLog({ sentiment, symptoms: logged, text: note, quick: !!s.quick });

  // Tap once = mild, twice = bad, a third tap clears (the debrief's picker,
  // ported onto the chips).
  const tapSymptom = (chip: SymptomChip) => {
    void Haptics.selectionAsync().catch(() => {});
    setPicks((prev) => {
      const next = cycleLevel(prev[chip.id]?.level ?? null);
      const out = { ...prev };
      if (!next) delete out[chip.id];
      else out[chip.id] = { level: next, qualifier: prev[chip.id]?.qualifier ?? null };
      return out;
    });
  };
  const levelSub = (chip: SymptomChip) => (picks[chip.id] ? (picks[chip.id].level === "bad" ? "Bad" : "Mild") : undefined);

  const onBack = async () => {
    // Backing out of a quick refine before saving drops the empty session.
    if (s.quick && s.motos.length === 0) await clearOpenSession();
    router.back();
  };

  const onSave = async () => {
    if (!canSave || saving || !sentiment) return;
    setSaving(true);
    const symptoms: MotoSymptom[] = logged.map((x) => ({ id: x.id, qualifier: x.qualifier, label: chipById.get(x.id)?.label ?? x.id, level: x.level }));
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
    if (symptoms.length || note.trim()) {
      // Every chip rides to the engine; the first one heads the Adjust screen.
      // Text alone is a refine too: the engine parses feedback.free_text.
      router.replace({
        pathname: "/ride/adjust",
        params: { symptom: symptoms[0]?.id ?? "", qualifier: symptoms[0]?.qualifier ?? "", moto: String(n), sentiment, level: symptoms[0]?.level ?? "", symptoms: JSON.stringify(logged) },
      } as never);
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

        <Small style={{ marginBottom: 10, color: V3.muted, fontSize: 12 }}>Tap once for mild, twice for bad. Pick as many as you felt.</Small>
        {groups.map((g) => (
          <View key={g.end} testID={`symptom-group-${g.end}`}>
            <Label style={{ marginBottom: 8, marginTop: 4 }}>{g.title}</Label>
            <Grid cols={2} style={{ marginBottom: 8 }}>
              {g.chips.map((c) => (
                <ChoiceChip key={c.id} out label={c.label} sub={levelSub(c)} on={!!picks[c.id]} onPress={() => tapSymptom(c)} minHeight={52} />
              ))}
            </Grid>
            {g.chips
              .filter((c) => picks[c.id] && c.qualifiers?.length)
              .map((c) => (
                <View key={`${c.id}-where`} style={styles.card}>
                  <Label style={{ color: V3.blue, marginBottom: 8 }}>{c.qualifierPrompt}</Label>
                  <Grid cols={2}>
                    {c.qualifiers!.map((q) => (
                      <ChoiceChip key={q.tag} out label={q.label} on={picks[c.id]?.qualifier === q.tag} dim minHeight={48} onPress={() => setPicks((prev) => ({ ...prev, [c.id]: { level: prev[c.id]?.level ?? "mild", qualifier: q.tag } }))} style={picks[c.id]?.qualifier === q.tag ? undefined : { borderColor: V3.line }} />
                    ))}
                  </Grid>
                </View>
              ))}
          </View>
        ))}

        <SayItYourWay
          value={note}
          onChangeText={setNote}
          boxed
          placeholder="Say it your way. Harsh in the bars on braking bumps, front tucks in flat corners, whatever you noticed."
          note="Voice arrives with the next update."
          style={{ marginTop: 6, marginBottom: 12 }}
        />

        <View style={{ flex: 1 }} />
        <Cta label={saving ? "Saving…" : s.quick ? "Next: adjust" : "Save moto"} dim={!canSave} disabled={saving} onPress={() => void onSave()} />
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
