// components/garage/GarageV3.tsx
// The v3 Garage tab (design/mockups/03): the bike list exists only with 2+
// bikes; one bike lands straight on its page (rendered inline); none shows
// the dashed Add a bike. Adding is Pro-gated on the ADD action once a bike
// exists (grandfathered multi-bike free accounts keep everything).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../Toast";
import { Big, Card, Eyebrow, H1, Small } from "../v3/primitives";
import { headingFont, useV3Fonts, V3 } from "../v3/theme";
import { BikePage } from "./BikePage";
import { AddBikeSheet } from "./GarageSheets";
import { createBike, normalizeBikeStrings, resolveModelId } from "../../lib/bikes";
import { loadBikeList, loadUserAndPro, type BikeListItem } from "../../lib/garageV3";
import { supabase } from "../../lib/supabase";
import { showProGate } from "../../lib/proGate";
import { logEvent } from "../../lib/usage";
import { Text } from "react-native";

export function GarageV3() {
  useV3Fonts();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<{ userId: string | null; isPro: boolean; bikes: BikeListItem[] } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

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

  const onAddPress = () => {
    if (!state?.userId) return router.push("/login" as never);
    if (state.bikes.length >= 1 && !state.isPro) {
      showProGate({ trigger: "second_bike" });
      return;
    }
    setAddOpen(true);
  };

  const onAdd = async (p: { make: string; model: string; year: number }) => {
    setAddOpen(false);
    try {
      const { make, model } = normalizeBikeStrings(p.make, p.model);
      const bike = await createBike({ make, model, year: p.year, is_primary: (state?.bikes.length ?? 0) === 0 });
      const model_id = await resolveModelId(make, model, p.year);
      if (model_id) void supabase.from("bikes").update({ model_id }).eq("id", bike.id);
      void logEvent("bike_created", { bike_id: bike.id, make, model, year: p.year, source: "garage_v3" });
      toast.show("Bike added", { kind: "success" });
      await load();
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't add the bike.", { kind: "error" });
    }
  };

  if (!state) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  if (state.bikes.length === 1) return <BikePage bikeId={state.bikes[0].id} inTab />;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: 40 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <Eyebrow>Garage</Eyebrow>
        <H1>Your bikes</H1>
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
        <Card variant="dashed" style={{ alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }} onPress={onAddPress} accessibilityLabel="Add a bike">
          <Ionicons name="add" size={16} color={V3.blue} />
          <Small style={{ fontSize: 13 }}>Add a bike</Small>
          {state.bikes.length >= 1 && !state.isPro ? <Ionicons name="lock-closed" size={12} color={V3.steel} /> : null}
        </Card>
        {state.bikes.length === 0 ? (
          <Small style={{ textAlign: "center", marginTop: 16, color: V3.muted, fontSize: 11 }}>Your first bike lands straight on its own page.</Small>
        ) : null}
      </ScrollView>
      <AddBikeSheet key={`add-${addOpen}`} open={addOpen} onClose={() => setAddOpen(false)} onAdd={onAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: V3.carbon },
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  model: { fontSize: 26, lineHeight: 26, color: V3.white },
});
