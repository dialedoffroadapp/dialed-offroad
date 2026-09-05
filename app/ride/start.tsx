// app/ride/start.tsx — Start Riding (design/mockups/ride/01 + 02). Three
// picker cards; first ride shows dashed prompts with a dimmed CTA, a
// returning rider gets last time's picks and a live CTA. An open session
// skips straight to ride mode (persistent takeover).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet } from "../../components/v3/BottomSheet";
import { Eyebrow, Label, Small } from "../../components/v3/primitives";
import { V3 } from "../../components/v3/theme";
import { Cta, Hint, PickCard, RideH1, RideScreenBg } from "../../components/ride/ridePrimitives";
import { conditionsComplete, conditionsSummary, primarySurface } from "../../lib/rideConditions";
import { readDraft, readEndedUnarchived, readOpenSession, writeDraft, type RideDraft } from "../../lib/rideDay";
import { bikeLine, bikeSetupLine, defaultDraft, loadBikeChoices, type BikeChoice } from "../../lib/rideStart";
import { supabase } from "../../lib/supabase";

export default function RideStartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<RideDraft | null>(null);
  const [choices, setChoices] = useState<BikeChoice[]>([]);
  const [firstRide, setFirstRide] = useState(true);
  const [bikeOpen, setBikeOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const open = await readOpenSession();
        if (open) {
          router.replace("/ride/mode" as never);
          return;
        }
        if (await readEndedUnarchived()) {
          router.replace("/ride/end" as never);
          return;
        }
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth?.user?.id ?? null;
        const [d, c] = await Promise.all([readDraft(), userId ? loadBikeChoices(userId) : Promise.resolve([])]);
        if (!alive) return;
        const defaulted = await defaultDraft(d, c);
        setChoices(c);
        setFirstRide(!(defaulted.trackName || defaulted.trackId) && !primarySurface(defaulted.conditions));
        setDraft(defaulted);
        if (defaulted !== d) void writeDraft(defaulted);
      })();
      return () => {
        alive = false;
      };
    }, [router])
  );

  if (!draft) {
    return (
      <View style={[RideScreenBg({}), styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  const bikeReady = !!draft.bike && !!draft.startingVersion;
  const trackReady = !!(draft.trackName || draft.trackId);
  const condReady = conditionsComplete(draft.conditions);
  const ready = bikeReady && trackReady && condReady;
  const allSet = ready && !firstRide;

  const pickBike = (c: BikeChoice, setupId: string | null) => {
    const setup = c.setups.find((s) => s.id === setupId) ?? c.setups[0];
    if (!setup?.running) return;
    const next: RideDraft = { ...draft, bike: c.bike, setupId: setup.id, setupName: setup.name, startingVersion: setup.running, hasAirFork: c.hasAirFork };
    setDraft(next);
    void writeDraft(next);
    setBikeOpen(false);
  };

  const onBikeCard = () => {
    if (choices.length === 0) return router.push("/(tabs)/garage" as never);
    if (choices.length === 1 && choices[0].setups.length === 1) return pickBike(choices[0], choices[0].setups[0].id);
    setBikeOpen(true);
  };

  return (
    <View style={RideScreenBg({})}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={V3.steel} />
          </Pressable>
          <Eyebrow style={{ marginBottom: 0 }}>Start riding</Eyebrow>
        </View>
        <RideH1>{allSet ? "Today's ride" : "What are you on today?"}</RideH1>

        <PickCard label="Bike · setup" title={bikeReady ? bikeSetupLine(draft)! : "Pick your bike"} empty={!bikeReady} on={bikeReady} onPress={onBikeCard} />
        <PickCard label="Track" title={trackReady ? draft.trackName ?? "Track" : "Where are you riding?"} empty={!trackReady} on={trackReady} onPress={() => router.push("/ride/track" as never)} />
        <PickCard label="Conditions" title={condReady ? conditionsSummary(draft.conditions) : "What's the dirt doing?"} empty={!condReady} on={condReady} onPress={() => router.push("/ride/conditions" as never)} />

        <Hint>{allSet ? "Same as last time. Tap any card to change it." : "Three taps today. After this, it remembers."}</Hint>
        <View style={{ flex: 1 }} />
        <Cta label="Get today's setup" dim={!ready} onPress={() => router.push("/ride/today" as never)} />
      </ScrollView>

      <BottomSheet open={bikeOpen} onClose={() => setBikeOpen(false)} title="Bike · setup">
        {choices.map((c) => (
          <View key={c.bike.id} style={{ marginBottom: 10 }}>
            <Label style={{ marginBottom: 6 }}>{bikeLine(c.bike)}</Label>
            {c.setups.map((s) => (
              <PickCard
                key={s.id ?? "default"}
                title={`${s.name} v${s.running?.version_number ?? "—"}${s.isRunning ? " · running" : ""}`}
                on={draft.bike?.id === c.bike.id && draft.setupId === s.id}
                onPress={() => pickBike(c, s.id)}
              />
            ))}
            {c.setups.length === 0 ? <Small>No tune on this bike yet.</Small> : null}
          </View>
        ))}
        {choices.length === 0 ? <Small>Add a bike in the Garage first.</Small> : null}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX, flexGrow: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
});
