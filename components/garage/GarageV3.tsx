// components/garage/GarageV3.tsx
// The v3 Garage tab (design/mockups/03). Revised 2026-09-04: Garage ALWAYS
// opens to the bike list, single-bike riders included (one card plus "Add a
// bike"), and taps into the bike page. Adding is Pro-gated on the ADD action
// once a bike exists (grandfathered multi-bike free accounts keep everything).
// 3.0 relocates the Tune flow into Garage: "Add a bike" creates the bike and
// lands in the Tune flow to build its baseline; "New tune" in the header is
// the direct door.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Big, Card, Eyebrow, H1, Small } from "../v3/primitives";
import { headingFont, useV3Fonts, V3 } from "../v3/theme";
import { loadBikeList, loadUserAndPro, type BikeListItem } from "../../lib/garageV3";
import { startGarageQuizFlow } from "../../lib/quizOnboarding";
import { showProGate } from "../../lib/proGate";
import { logEvent } from "../../lib/usage";
import { Text } from "react-native";

const TUNE_ROUTE = "/(tabs)/tune";

export function GarageV3() {
  useV3Fonts();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<{ userId: string | null; isPro: boolean; bikes: BikeListItem[] } | null>(null);

  const load = useCallback(async () => {
    const { userId, isPro } = await loadUserAndPro();
    const bikes = userId ? await loadBikeList(userId) : [];
    setState({ userId, isPro, bikes });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      return undefined;
    }, [load])
  );

  const onAddPress = async () => {
    if (!state?.userId) return router.push("/login" as never);
    if (state.bikes.length >= 1 && !state.isPro) {
      showProGate({ trigger: "second_bike" });
      return;
    }
    // The quiz's bike picker (brand grid, model list with inline years,
    // search), then the drumroll and reveal build the new bike's baseline.
    void logEvent("bike_created", { source: "garage_v3_quiz_flow_started" });
    const first = await startGarageQuizFlow("add_bike", {});
    router.push(first as never);
  };

  if (!state) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: 40 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <Eyebrow>Garage</Eyebrow>
        <View style={styles.headerRow}>
          <H1 style={{ marginBottom: 0 }}>Your bikes</H1>
          {state.bikes.length > 0 ? (
            <Pressable
              onPress={() => router.push({ pathname: TUNE_ROUTE, params: { bikeId: state.bikes[0].id } } as never)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="New tune"
              style={styles.headerAction}
            >
              <Ionicons name="flash" size={14} color={V3.blue} />
              <Small style={{ color: V3.blue, fontSize: 13 }}>New tune</Small>
            </Pressable>
          ) : null}
        </View>
        {state.bikes.map((b) => (
          <Card key={b.id} stripe={b.make} style={{ paddingVertical: 18 }} onPress={() => router.push({ pathname: "/garage-bike", params: { bikeId: b.id } } as never)} accessibilityLabel={`${b.year ?? ""} ${b.make ?? ""} ${b.model ?? ""}`}>
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.model, headingFont()]} numberOfLines={1}>{(b.model ?? b.nickname ?? "Bike").toUpperCase()}</Text>
                <Small style={{ marginTop: 6 }}>
                  {[[b.year, b.make].filter(Boolean).join(" "), b.hours !== null ? `${b.hours.toFixed(1)} hrs` : null].filter(Boolean).join(" · ")}
                </Small>
              </View>
              <Big size="lg" style={{ fontSize: 40, lineHeight: 42 }}>{b.pct}%</Big>
            </View>
          </Card>
        ))}
        <Card variant="dashed" style={{ alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }} onPress={() => void onAddPress()} accessibilityLabel="Add a bike">
          <Ionicons name="add" size={16} color={V3.blue} />
          <Small style={{ fontSize: 13 }}>Add a bike</Small>
          {state.bikes.length >= 1 && !state.isPro ? <Ionicons name="lock-closed" size={12} color={V3.steel} /> : null}
        </Card>
        {state.bikes.length === 0 ? (
          <Small style={{ textAlign: "center", marginTop: 16, color: V3.muted, fontSize: 11 }}>Add your bike, then build its baseline tune.</Small>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: V3.carbon },
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 },
  headerAction: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: "rgba(29,155,240,0.35)" },
  model: { fontSize: 26, lineHeight: 26, color: V3.white },
});
