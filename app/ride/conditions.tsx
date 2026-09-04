// app/ride/conditions.tsx — Conditions (design/mockups/ride/04): surface,
// track state, temperature band, watered. Rider-tapped only.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chip, Eyebrow, Label, Small } from "../../components/v3/primitives";
import { V3 } from "../../components/v3/theme";
import { ChoiceChip, Cta, Grid, RideH1, RideScreenBg } from "../../components/ride/ridePrimitives";
import { conditionsComplete, EMPTY_CONDITIONS, SURFACES, TEMP_BANDS, TRACK_STATES, type RideConditions } from "../../lib/rideConditions";
import { readDraft, readOpenSession, writeDraft, writeSession } from "../../lib/rideDay";

export default function RideConditionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const sessionMode = mode === "session";
  const [c, setC] = useState<RideConditions>({ ...EMPTY_CONDITIONS });

  useEffect(() => {
    if (sessionMode) void readOpenSession().then((o) => o && setC(o.conditions));
    else void readDraft().then((d) => setC(d.conditions));
  }, [sessionMode]);

  const set = (patch: Partial<RideConditions>) => {
    const next = { ...c, ...patch };
    setC(next);
    if (sessionMode) void readOpenSession().then((o) => o && writeSession({ ...o, conditions: next }));
    else void readDraft().then((d) => writeDraft({ ...d, conditions: next }));
  };

  const onDone = () => {
    if (sessionMode) router.replace({ pathname: "/ride/retune", params: { tile: "new_track" } } as never);
    else router.replace("/ride/today" as never);
  };

  return (
    <View style={RideScreenBg({})}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={V3.steel} />
          </Pressable>
          <Eyebrow style={{ marginBottom: 0 }}>Conditions</Eyebrow>
        </View>
        <RideH1>What&apos;s the dirt doing?</RideH1>

        <Label style={{ marginBottom: 8 }}>Surface</Label>
        <Grid cols={2} style={{ marginBottom: 14 }}>
          {SURFACES.map((s) => (
            <ChoiceChip key={s.id} label={s.label} on={c.surface === s.id} onPress={() => set({ surface: s.id })} />
          ))}
        </Grid>

        <Label style={{ marginBottom: 8 }}>Track state</Label>
        <Grid cols={3} style={{ marginBottom: 14 }}>
          {TRACK_STATES.map((s) => (
            <ChoiceChip key={s.id} label={s.label} on={c.state === s.id} onPress={() => set({ state: s.id })} />
          ))}
        </Grid>

        <Label style={{ marginBottom: 8 }}>Temperature</Label>
        <Grid cols={3} style={{ marginBottom: 8 }}>
          {TEMP_BANDS.map((t) => (
            <ChoiceChip key={t.id} label={t.label} sub={t.sub} on={c.temp === t.id} onPress={() => set({ temp: t.id })} />
          ))}
        </Grid>
        <Small style={{ marginBottom: 12 }}>Heat thins oil and raises air fork pressure. We account for it.</Small>

        <View style={styles.watered}>
          <Small style={{ fontSize: 14 }}>
            <Ionicons name="water-outline" size={13} color={V3.steel} /> Watered today?
          </Small>
          <View style={{ flexDirection: "row" }}>
            <Chip label="Yes" on={c.watered === true} onPress={() => set({ watered: true })} />
            <Chip label="No" on={c.watered === false} onPress={() => set({ watered: false })} />
          </View>
        </View>

        <View style={{ flex: 1 }} />
        <Cta label={sessionMode ? "Retune for it" : "Get today's setup"} dim={!conditionsComplete(c)} onPress={onDone} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: V3.screenPadX, flexGrow: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  watered: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12, minHeight: 44 },
});
