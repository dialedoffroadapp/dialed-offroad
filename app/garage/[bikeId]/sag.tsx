// app/garage/[bikeId]/sag.tsx
// Sag page per bike (River, 2026-09-07). Entry: the Sag row on the bike
// page, the link beside the sag target on the reveal, and the ride-mode
// recheck card (?from=recheck). Uses resolveSagBounds and the catalog's
// stock_sag_mm / sag_min / sag_max / stock_static_sag_mm /
// sag_window_verified from the Sep 7 migration. Supersedes the measure-sag
// walkthrough that sat in the design queue.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../../../components/Toast";
import { Button, Card, Eyebrow, H1, Label, Row, Small, Sub } from "../../../components/v3/primitives";
import { interFont, V3 } from "../../../components/v3/theme";
import { runningSetup } from "../../../lib/bikeSetups";
import { loadBikePage, loadBikes, loadUserAndPro, type BikePageData } from "../../../lib/garageV3";
import { hasSourcedRanges } from "../../../lib/modelSpecs";
import { rangeLabel, readSagHistory, ridingVerdict, SAG_SOURCE_LABEL, sagMath, saveSagMeasurement, SPRING_RULE_LINE, springRuleApplies, staticVerdict, verdictLine, type SagMeasurement, type SagSourceKind } from "../../../lib/sag";
import { platformSagBounds, resolveSagBounds } from "../../../lib/sagBounds";

const WHY = [
  "Sag sets where the bike sits in the stroke, so every clicker works from the right place.",
  "It drifts: the spring settles, gear weight changes, the preload ring moves.",
  "Factory teams check it before every moto. Five minutes with a helper.",
];

const STEPS: { key: "a" | "b" | "c"; label: string; text: string }[] = [
  { key: "a", label: "A", text: "Wheel hanging, bike on a stand. Axle to a fixed point on the fender." },
  { key: "b", label: "B", text: "On its wheels, nobody on it, bounced and settled. Same two points." },
  { key: "c", label: "C", text: "Rider seated in full gear, feet on the pegs, a helper holding the bike upright." },
];

function num(s: string): number | null {
  const n = Number(s.replace(",", "."));
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
}

export default function SagScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { bikeId, from } = useLocalSearchParams<{ bikeId?: string; from?: string }>();
  const [data, setData] = useState<BikePageData | null>(null);
  const [history, setHistory] = useState<SagMeasurement[]>([]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const id = String(bikeId ?? "");
    const { userId, isPro } = await loadUserAndPro();
    if (!userId) return;
    const bike = (await loadBikes(userId)).find((x) => x.id === id);
    if (!bike) return;
    const [page, rows] = await Promise.all([loadBikePage(bike), readSagHistory(id)]);
    setData({ userId, isPro, ...page });
    setHistory(rows);
  }, [bikeId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return undefined;
    }, [load])
  );

  const specs = data?.specs ?? null;
  const platform = data ? platformSagBounds(data.bike.make, data.bike.model) : null;
  const bounds = useMemo(() => resolveSagBounds(specs, platform), [specs, platform]);
  const sourceKind: SagSourceKind = specs?.stock_sag_mm != null ? "model" : platform ? "platform" : "default";
  const verified = specs?.sag_window_verified === true;
  const staticTarget = specs?.stock_static_sag_mm ?? null;
  const { staticMm, ridingMm } = sagMath({ a: num(a), b: num(b), c: num(c) });
  const rv = ridingVerdict(ridingMm, bounds);
  const sv = staticVerdict(staticMm, staticTarget);
  const active = data ? runningSetup(data.setups)?.running ?? data.versions[0] ?? null : null;

  if (!data) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  const onSave = async () => {
    if (saving) return;
    const A = num(a), B = num(b), C = num(c);
    if (A === null || B === null || C === null) {
      toast.show("Enter all three measurements.", { kind: "error" });
      return;
    }
    setSaving(true);
    try {
      const saved = await saveSagMeasurement({ bikeId: data.bike.id, versionId: active?.id ?? null, a: A, b: B, c: C, bounds, fromRecheck: from === "recheck" });
      setHistory((h) => [saved, ...h].slice(0, 10));
      toast.show(`Saved: ${saved.riding_mm} mm riding, ${saved.static_mm} mm static.`, { kind: "success" });
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't save that.", { kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  const tone = (v: "in_range" | "low" | "high" | "unknown") => (v === "in_range" ? V3.blue : v === "unknown" ? V3.steel : "#F2A33A");

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 32 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <Row style={{ marginBottom: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={20} color={V3.steel} />
            </Pressable>
            <Eyebrow brand={data.bike.make} style={{ marginBottom: 0 }}>
              {[data.bike.year, data.bike.make, data.bike.model].filter(Boolean).join(" ")}
            </Eyebrow>
          </View>
        </Row>
        <H1>Sag</H1>

        {/* 1. Why sag matters */}
        <Card>
          <Label style={{ marginBottom: 8 }}>Why it matters</Label>
          {WHY.map((line) => (
            <Sub key={line} style={{ marginTop: 4 }}>{line}</Sub>
          ))}
        </Card>

        {/* 2. Measure it */}
        <Label style={{ marginTop: 18, marginBottom: 8 }}>Measure it</Label>
        <Card>
          <Sub style={{ marginTop: 0, marginBottom: 10 }}>Shock first, then fork. Measure from the axle to a fixed point on the fender, the same two points every time. On a Yamaha use the fender dimple.</Sub>
          {STEPS.map((st) => {
            const value = st.key === "a" ? a : st.key === "b" ? b : c;
            const set = st.key === "a" ? setA : st.key === "b" ? setB : setC;
            return (
              <View key={st.key} style={styles.step}>
                <View style={styles.stepBadge}>
                  <Text style={[styles.stepBadgeText, interFont(700)]}>{st.label}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Small style={{ color: V3.white }}>{st.text}</Small>
                </View>
                <View style={styles.inputWrap}>
                  <TextInput
                    value={value}
                    onChangeText={set}
                    keyboardType="number-pad"
                    placeholder="mm"
                    placeholderTextColor={V3.steel}
                    style={[styles.input, interFont(700)]}
                    maxLength={4}
                    accessibilityLabel={`Measurement ${st.label} in millimeters`}
                  />
                </View>
              </View>
            );
          })}
          <View style={styles.live}>
            <View style={{ flex: 1 }}>
              <Small>Static (A minus B)</Small>
              <Text style={[styles.liveNum, interFont(700), { color: tone(sv) }]}>{staticMm ?? "—"}<Text style={styles.liveUnit}> mm</Text></Text>
            </View>
            <View style={{ flex: 1 }}>
              <Small>Riding (A minus C)</Small>
              <Text style={[styles.liveNum, interFont(700), { color: tone(rv) }]}>{ridingMm ?? "—"}<Text style={styles.liveUnit}> mm</Text></Text>
            </View>
          </View>
        </Card>

        {/* 3. Your numbers vs target */}
        <Label style={{ marginTop: 18, marginBottom: 8 }}>Your numbers vs target</Label>
        <Card>
          <Row>
            <Small style={{ color: V3.white }}>Riding sag, {rangeLabel(verified)}</Small>
            <Text style={[styles.target, interFont(700)]}>{bounds.target}<Text style={styles.liveUnit}> mm</Text></Text>
          </Row>
          <Sub style={{ marginTop: 4 }}>{verdictLine("riding", rv, bounds)}</Sub>
          <View style={styles.window}>
            <View style={[styles.windowFill, { left: `${Math.max(0, Math.min(100, ((bounds.min - 80) / 60) * 100))}%`, width: `${Math.max(2, ((bounds.max - bounds.min) / 60) * 100)}%` }]} />
            {ridingMm !== null ? <View style={[styles.marker, { left: `${Math.max(0, Math.min(100, ((ridingMm - 80) / 60) * 100))}%`, backgroundColor: tone(rv) }]} /> : null}
          </View>
          <Row style={{ marginTop: 14 }}>
            <Small style={{ color: V3.white }}>Static sag{staticTarget !== null ? `, ${rangeLabel(verified)}` : ""}</Small>
            <Text style={[styles.target, interFont(700)]}>{staticTarget ?? "—"}<Text style={styles.liveUnit}> mm</Text></Text>
          </Row>
          <Sub style={{ marginTop: 4 }}>{staticTarget !== null ? verdictLine("static", sv, undefined, staticTarget) : "No static target on this catalog row yet. Typical: 30 to 40 mm."}</Sub>
          <Small style={{ marginTop: 10, fontSize: 11 }}>{SAG_SOURCE_LABEL[sourceKind]}{specs?.sag_window_source ? ` ${specs.sag_window_source}.` : ""}</Small>
        </Card>

        {/* 4. Save */}
        <Button label={saving ? "Saving…" : active ? `Save to ${runningSetup(data.setups)?.name ?? "the running setup"}` : "Save"} style={{ marginTop: 16 }} onPress={() => void onSave()} disabled={saving} />
        {!active ? <Small style={{ marginTop: 6, textAlign: "center" }}>No setup yet: the measurement is kept on the bike, not on a version.</Small> : null}

        {/* 5. History */}
        <Label style={{ marginTop: 18, marginBottom: 8 }}>History</Label>
        <Card style={{ paddingVertical: 4 }}>
          {history.length === 0 ? (
            <Sub style={{ paddingVertical: 10 }}>No measurements yet.</Sub>
          ) : (
            history.map((m, i) => (
              <View key={m.id} style={[styles.historyRow, i < history.length - 1 && styles.historyBorder]}>
                <Small style={{ flex: 1, color: V3.white }}>{new Date(m.measured_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Small>
                <Small style={{ color: V3.white }}>{m.riding_mm} riding</Small>
                <Small style={{ marginLeft: 12 }}>{m.static_mm} static</Small>
              </View>
            ))
          )}
        </Card>

        {/* 6. Spring rule */}
        <Card style={[{ marginTop: 18 }, springRuleApplies(sv, rv) ? styles.ruleHot : null]}>
          <Label style={{ marginBottom: 6 }}>Spring rule</Label>
          <Sub style={{ marginTop: 0, color: V3.white }}>{SPRING_RULE_LINE}</Sub>
          {hasSourcedRanges(specs) ? (
            <Pressable onPress={() => router.push({ pathname: "/setup-sheet", params: { bikeId: data.bike.id } } as never)} accessibilityRole="button" style={{ marginTop: 10 }}>
              <Small style={{ color: V3.blue }}>See the spring check for this bike</Small>
            </Pressable>
          ) : null}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: V3.carbon },
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16 },
  step: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  stepBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: V3.panel2, alignItems: "center", justifyContent: "center" },
  stepBadgeText: { color: V3.white, fontSize: 13 },
  inputWrap: { width: 78 },
  input: { color: V3.white, fontSize: 18, borderWidth: 1, borderColor: V3.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, textAlign: "right", backgroundColor: V3.panel },
  live: { flexDirection: "row", gap: 12, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: V3.line },
  liveNum: { fontSize: 28, marginTop: 2 },
  liveUnit: { fontSize: 12, color: V3.steel },
  target: { color: V3.white, fontSize: 24 },
  window: { height: 8, borderRadius: 4, backgroundColor: V3.panel2, marginTop: 10, position: "relative", overflow: "visible" },
  windowFill: { position: "absolute", top: 0, height: 8, borderRadius: 4, backgroundColor: V3.blueDim },
  marker: { position: "absolute", top: -3, width: 4, height: 14, borderRadius: 2, marginLeft: -2 },
  historyRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  historyBorder: { borderBottomWidth: 1, borderBottomColor: V3.line },
  ruleHot: { borderColor: "#F2A33A", borderWidth: 1 },
});
