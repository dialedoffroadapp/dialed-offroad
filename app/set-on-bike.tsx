// app/set-on-bike.tsx — "Set it on the bike" first-run walkthrough (device
// pass Garage findings, 2026-09-04). One card per adjuster in sheet order:
// the number at 72pt, WHERE it is (a photo when one is registered for the
// fork/shock family in lib/adjusterPhotos, else nothing, + copy keyed by
// family), HOW to set it (count-from-closed), a Set button that advances,
// progress segments, a full-width ghost "Skip, I know my bike". Completing
// shows a short "Bike's set" beat and lands on Home (First Steps step 2
// done there); skipping opens the plain sheet; returning riders (completed or
// skipped) never see this again (Home routes them straight to the sheet).
import { formatSetting } from "../lib/format";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Card, Eyebrow, Label, Small } from "../components/v3/primitives";
import { headingFont, interFont, useV3Fonts, V3 } from "../components/v3/theme";
import { ADJUSTERS, type AdjusterKey } from "../lib/adjusterCopy";
import { forkFamilyFor, FORK_FAMILY_LABEL, locationCopy, shockFamilyFor, WALKTHROUGH_ORDER } from "../lib/adjusterLocations";
import { adjusterPhoto } from "../lib/adjusterPhotos";
import { runningSetup } from "../lib/bikeSetups";
import { markSetOnBike, markWalkthroughSkipped } from "../lib/firstSteps";
import { loadBikePage, loadBikes, loadUserAndPro } from "../lib/garageV3";

import type { SetupVersionRow } from "../lib/setupVersions";
import { logEvent } from "../lib/usage";

type PageData = Awaited<ReturnType<typeof loadBikePage>>;

const SHEET_ROUTE = "/setup-sheet";
/** How long the "Bike's set" beat stays up before Home. */
const BEAT_MS = 1100;

type CardDef = { key: AdjusterKey; value: string; unit: string; group: "Fork" | "Shock" };

function cardsFor(v: SetupVersionRow, airFork: boolean): CardDef[] {
  const out: CardDef[] = [];
  for (const key of WALKTHROUGH_ORDER) {
    let value: string | null = null;
    const raw =
      key === "fork_air" ? (airFork ? v.fork_air_bar : null)
      : key === "fork_comp" ? v.fork_comp_clicks
      : key === "fork_reb" ? v.fork_reb_clicks
      : key === "shock_sag" ? v.sag_mm
      : key === "shock_lsc" ? v.shock_lsc_clicks
      : key === "shock_hsc" ? v.shock_hsc_turns
      : v.shock_reb_clicks;
    value = typeof raw === "number" ? formatSetting(raw, key) : null;
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
  const [done, setDone] = useState(false);

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
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // The beat, then Home: its First Steps re-reads step 2 on focus.
    setDone(true);
    setTimeout(() => router.replace("/(tabs)" as never), BEAT_MS);
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

  if (done) {
    return (
      <Animated.View entering={FadeIn.duration(220)} style={[styles.root, styles.center]} accessibilityLiveRegion="polite">
        <Ionicons name="checkmark-circle" size={44} color={V3.blue} />
        <Text style={[styles.beat, headingFont()]}>BIKE&apos;S SET.</Text>
        <Small style={{ marginTop: 8, textAlign: "center" }}>Ride it. Then tell it how it felt.</Small>
      </Animated.View>
    );
  }

  const card = cards[i];
  const meta = ADJUSTERS[card.key];
  const copy = locationCopy(card.key, card.value, card.unit, fork, shock);
  const photo = adjusterPhoto(card.key, fork, shock);
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
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 184 + insets.bottom }]} showsVerticalScrollIndicator={false}>
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
            {photo ? <Image source={photo} style={styles.photoImg} resizeMode="cover" accessibilityLabel={`${meta.label} on ${familyLabel}`} /> : null}
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
        <Button label="Skip, I know my bike" ghost onPress={() => void onSkip()} style={{ marginTop: 10 }} />
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
  beat: { color: V3.white, fontSize: 40, lineHeight: 44, marginTop: 14, textAlign: "center" },
  valueRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 6 },
  value: { color: V3.white, fontSize: 72, lineHeight: 76, letterSpacing: -1 },
  unit: { color: V3.steel, fontSize: 18 },
  photoImg: { width: "100%", height: 180, borderRadius: 12, marginBottom: 12, backgroundColor: V3.panel },
  body: { color: V3.white, fontSize: 15, lineHeight: 22 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: V3.screenPadX, paddingTop: 10, backgroundColor: V3.carbon },
});
