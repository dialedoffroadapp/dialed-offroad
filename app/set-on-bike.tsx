// app/set-on-bike.tsx — "Set it on the bike" first-run walkthrough (device
// pass Garage findings, 2026-09-04). One card per adjuster in sheet order:
// the number at 72pt, WHERE it is (photo slot + copy keyed by fork/shock
// family), HOW to set it (count-from-closed), a Set button that advances,
// progress segments, "Skip, I know my bike". Completing marks First Steps
// step 2 done; skipping opens the plain sheet; returning riders (completed or
// skipped) never see this again (Home routes them straight to the sheet).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Card, Eyebrow, Label, Small } from "../components/v3/primitives";
import { headingFont, interFont, useV3Fonts, V3 } from "../components/v3/theme";
import { ADJUSTERS, type AdjusterKey } from "../lib/adjusterCopy";
import { forkFamilyFor, FORK_FAMILY_LABEL, locationCopy, shockFamilyFor, WALKTHROUGH_ORDER } from "../lib/adjusterLocations";
import { runningSetup } from "../lib/bikeSetups";
import { markSetOnBike, markWalkthroughSkipped } from "../lib/firstSteps";
import { loadBikePage, loadBikes, loadUserAndPro } from "../lib/garageV3";

type PageData = Awaited<ReturnType<typeof loadBikePage>>;
import type { SetupVersionRow } from "../lib/setupVersions";
import { logEvent } from "../lib/usage";

const SHEET_ROUTE = "/setup-sheet";

type CardDef = { key: AdjusterKey; value: string; unit: string; group: "Fork" | "Shock" };

function fmt(v: number | null | undefined, digits: number): string | null {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : null;
}

function cardsFor(v: SetupVersionRow, airFork: boolean): CardDef[] {
  const out: CardDef[] = [];
  for (const key of WALKTHROUGH_ORDER) {
    let value: string | null = null;
    if (key === "fork_air") value = airFork ? fmt(v.fork_air_bar, 1) : null;
    else if (key === "fork_comp") value = fmt(v.fork_comp_clicks, 0);
    else if (key === "fork_reb") value = fmt(v.fork_reb_clicks, 0);
    else if (key === "shock_sag") value = fmt(v.sag_mm, 0);
    else if (key === "shock_lsc") value = fmt(v.shock_lsc_clicks, 0);
    else if (key === "shock_hsc") value = fmt(v.shock_hsc_turns, 2)?.replace(/\.?0+$/, "") ?? null;
    else if (key === "shock_reb") value = fmt(v.shock_reb_clicks, 0);
    if (value === null) continue;
    out.push({ key, value, unit: ADJUSTERS[key].unit, group: key.startsWith("fork_") ? "Fork" : "Shock" });
  }
  return out;
}

export default function SetOnBikeScreen() {
  useV3Fonts();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { bikeId, setupId } = useLocalSearchParams<{ bikeId?: string; setupId?: string }>();
  const [data, setData] = useState<PageData | null>(null);
  const [version, setVersion] = useState<SetupVersionRow | null>(null);
  const [i, setI] = useState(0);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const id = String(bikeId ?? "");
      const { userId } = await loadUserAndPro();
      const bikes = userId ? await loadBikes(userId) : [];
      const bike = bikes.find((b) => b.id === id) ?? null;
      if (!bike) {
        if (alive) setMissing(true);
        return;
      }
      const page = await loadBikePage(bike);
      const setups = page.setups;
      const wanted = setupId && setupId !== "default" ? String(setupId) : null;
      const setup = (wanted ? setups.find((s) => s.id === wanted) : null) ?? runningSetup(setups) ?? setups[0] ?? null;
      if (!alive) return;
      setData(page);
      setVersion(setup?.running ?? setup?.versions[0] ?? null);
      void logEvent("home_module_viewed", { module: "set_on_bike_walkthrough", state: "opened", bike_id: bike.id });
    })();
    return () => {
      alive = false;
    };
  }, [bikeId, setupId]);

  const airFork = data ? (typeof data.specs?.has_air_fork === "boolean" ? data.specs.has_air_fork : version?.fork_air_bar !== null && version?.fork_air_bar !== undefined) : false;
  const cards = useMemo(() => (version ? cardsFor(version, airFork) : []), [version, airFork]);
  const fork = forkFamilyFor(data?.specs?.fork_type ?? null, airFork);
  const shock = shockFamilyFor(data?.specs?.shock_type ?? null);

  const toSheet = () =>
    router.replace({ pathname: SHEET_ROUTE, params: { bikeId: String(bikeId ?? ""), setupId: setupId ?? "default" } } as never);

  const onSkip = async () => {
    await markWalkthroughSkipped(String(bikeId ?? ""));
    void logEvent("home_module_viewed", { module: "set_on_bike_walkthrough", state: "skipped", bike_id: bikeId ?? null, at: i });
    toSheet();
  };

  const onSet = async () => {
    if (i + 1 < cards.length) {
      setI(i + 1);
      return;
    }
    await markSetOnBike(String(bikeId ?? ""));
    void logEvent("home_module_viewed", { module: "set_on_bike_walkthrough", state: "completed", bike_id: bikeId ?? null });
    toSheet();
  };

  if (missing) {
    return (
      <View style={[styles.root, styles.center]}>
        <Small>Bike not found.</Small>
        <Button label="Back" ghost onPress={() => router.back()} style={{ marginTop: 12 }} />
      </View>
    );
  }
  if (!data || !version || cards.length === 0) {
    if (data && (!version || cards.length === 0)) {
      // Nothing to walk through: fall through to the plain sheet.
      toSheet();
    }
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  const card = cards[i];
  const meta = ADJUSTERS[card.key];
  const copy = locationCopy(card.key, card.value, card.unit, fork, shock);
  const familyLabel = card.group === "Fork" ? FORK_FAMILY_LABEL[fork] : data.specs?.shock_type ?? "your shock";
  const bikeTitle = [data.bike.year, data.bike.make, data.bike.model].filter(Boolean).join(" ");

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={20} color={V3.steel} />
        </Pressable>
        <View style={styles.segments}>
          {cards.map((c, k) => (
            <View key={c.key} style={[styles.segment, k <= i && styles.segmentOn]} />
          ))}
        </View>
        <Pressable onPress={() => void onSkip()} hitSlop={10} accessibilityRole="button">
          <Small style={{ color: V3.steel, textDecorationLine: "underline" }}>Skip, I know my bike</Small>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <Animated.View key={card.key} entering={FadeIn.duration(180)}>
          <Eyebrow>
            {i + 1} of {cards.length} · {card.group} · {bikeTitle}
          </Eyebrow>
          <Text style={[styles.label, headingFont()]}>{meta.label.toUpperCase()}</Text>
          <View style={styles.valueRow}>
            <Text style={[styles.value, interFont(700)]}>{card.value}</Text>
            <Text style={[styles.unit, interFont(400)]}>{card.unit}</Text>
          </View>

          <Card style={{ marginTop: 18 }}>
            <Label style={{ marginBottom: 8 }}>Where it is · {familyLabel}</Label>
            <View style={styles.photo} accessibilityLabel={`Photo placeholder ${copy.photo}`}>
              <Ionicons name="camera-outline" size={22} color={V3.muted} />
              <Small style={{ color: V3.muted, marginTop: 6, fontSize: 11 }}>photo coming</Small>
            </View>
            <Text style={[styles.body, interFont(400)]}>{copy.where}</Text>
          </Card>

          <Card style={{ marginTop: 12 }}>
            <Label style={{ marginBottom: 8 }}>How to set it</Label>
            <Text style={[styles.body, interFont(400)]}>{copy.how}</Text>
            {card.unit === "clicks" || card.unit === "turns" ? (
              <Small style={{ marginTop: 10, color: V3.muted }}>Convention: numbers count OUT from fully closed. Close gently; never force the stop.</Small>
            ) : null}
          </Card>
        </Animated.View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Button label={i + 1 < cards.length ? "Set. Next" : "Set. Done"} onPress={() => void onSet()} icon={<Ionicons name="checkmark" size={18} color={V3.carbon} />} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: V3.carbon },
  center: { alignItems: "center", justifyContent: "center", padding: 24 },
  top: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: V3.screenPadX, paddingBottom: 10 },
  segments: { flex: 1, flexDirection: "row", gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.10)" },
  segmentOn: { backgroundColor: V3.blue },
  content: { paddingHorizontal: V3.screenPadX, paddingTop: 8 },
  label: { color: V3.white, fontSize: 28, lineHeight: 30, marginTop: 6 },
  valueRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 6 },
  value: { color: V3.white, fontSize: 72, lineHeight: 76, letterSpacing: -1 },
  unit: { color: V3.steel, fontSize: 18 },
  photo: { height: 150, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  body: { color: V3.white, fontSize: 15, lineHeight: 22 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: V3.screenPadX, paddingTop: 10, backgroundColor: V3.carbon },
});
