// app/garage/[bikeId]/sag.tsx
// Sag page per bike, redesigned after the 2026-09-08 device pass (finding
// 1): rear sag only. Order: header, the riding target big with its window
// and source, the three inputs A B C one line each, the result as the hero
// the moment A and C exist (colored by state, one sentence from a small rule
// set, the spring rule with a link to the spring card), a sticky Save
// enabled on A and C, history collapsed, then "Why it matters", "How to
// measure" (open on the first visit, closed after the first save) and "What
// about the front?" at the bottom. Each measurement is a sag_measurements
// row linked to the running version; versions stay immutable.
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
import { canSaveSag, rangeLabel, readSagHistory, resultSentence, ridingState, ridingVerdict, SAG_SOURCE_LABEL, sagIntroOpen, sagMath, saveSagMeasurement, staticVerdict, type SagMeasurement, type SagResultState, type SagSourceKind } from "../../../lib/sag";
import { platformSagBounds, resolveSagBounds } from "../../../lib/sagBounds";

const WHY = [
  "Sag sets where the bike sits in the stroke, so every clicker works from the right place.",
  "It drifts: the spring settles, gear weight changes, the preload ring moves.",
  "Factory teams check it before every moto. Five minutes with a helper.",
];
const HOW = "Measure from the rear axle to a fixed point on the fender, the same two points every time. A with the wheel hanging on a stand, B on its wheels unloaded and settled, C with you seated in full gear, feet on the pegs, a helper holding the bike upright. On a Yamaha use the fender dimple.";
const FRONT = "Fork sag is checked, not set: most forks have no preload adjuster. Front static sag lands around 35 to 50 mm; if yours is outside that, it is a spring rate or, on an air fork, an air pressure question, and the app handles both.";

const INPUTS: { key: "a" | "b" | "c"; label: string; text: string; placeholder: string }[] = [
  { key: "a", label: "A", text: "Wheel hanging, on a stand", placeholder: "615" },
  { key: "b", label: "B", text: "On its wheels, nobody on it", placeholder: "580" },
  { key: "c", label: "C", text: "Seated in full gear", placeholder: "510" },
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState<boolean>(true);
  const [whyOpen, setWhyOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [frontOpen, setFrontOpen] = useState(false);
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
    const [page, rows, intro] = await Promise.all([loadBikePage(bike), readSagHistory(id), sagIntroOpen(id)]);
    setData({ userId, isPro, ...page });
    setHistory(rows);
    setIntroOpen(intro);
    setWhyOpen(intro);
    setHowOpen(intro);
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
  const inputs = { a: num(a), b: num(b), c: num(c) };
  const { staticMm, ridingMm } = sagMath(inputs);
  const state: SagResultState = ridingState(ridingMm, bounds);
  const sentence = resultSentence({ ridingMm, staticMm, bounds, staticTarget });
  const active = data ? runningSetup(data.setups)?.running ?? data.versions[0] ?? null : null;
  const saveEnabled = canSaveSag(inputs) && !saving;

  if (!data) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  const onSave = async () => {
    if (!saveEnabled) return;
    setSaving(true);
    try {
      const saved = await saveSagMeasurement({ bikeId: data.bike.id, versionId: active?.id ?? null, a: inputs.a as number, b: inputs.b, c: inputs.c as number, bounds, fromRecheck: from === "recheck" });
      setHistory((h) => [saved, ...h].slice(0, 10));
      setIntroOpen(false);
      setWhyOpen(false);
      setHowOpen(false);
      toast.show(`Saved: ${saved.riding_mm} mm riding${inputs.b !== null ? `, ${saved.static_mm} mm static` : ""}.`, { kind: "success" });
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't save that.", { kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  const tone = state === "in_range" ? V3.blue : state === "close" ? "#F2A33A" : state === "out" ? "#E5484D" : V3.steel;
  const springLink = hasSourcedRanges(specs);
  const sheet = (expand: "fork_air" | "fork_spring" | undefined) => router.push({ pathname: "/setup-sheet", params: { bikeId: data.bike.id, ...(expand ? { expand } : {}) } } as never);

  const Collapsible = ({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) => (
    <Card style={{ marginTop: 10, paddingVertical: 12 }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.collapseHead}>
        <Label style={{ marginBottom: 0 }}>{title}</Label>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={V3.steel} />
      </Pressable>
      {open ? <View style={{ marginTop: 8 }}>{children}</View> : null}
    </Card>
  );

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 110 + insets.bottom }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* header */}
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
        <H1>SAG</H1>

        {/* target */}
        <Card accessibilityLabel="Sag target">
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 18 }}>
            <View>
              <Label style={{ marginBottom: 2 }}>Riding sag target</Label>
              <Text style={[styles.targetBig, interFont(700)]}>{bounds.target}<Text style={styles.unit}> mm</Text></Text>
              <Small style={{ color: V3.white }}>{bounds.min} to {bounds.max} mm, {rangeLabel(verified)}</Small>
            </View>
            {staticTarget !== null ? (
              <View style={{ marginBottom: 4 }}>
                <Label style={{ marginBottom: 2 }}>Static</Label>
                <Text style={[styles.targetSmall, interFont(700)]}>{staticTarget}<Text style={styles.unit}> mm</Text></Text>
              </View>
            ) : null}
          </View>
          <Small style={{ marginTop: 8, fontSize: 11 }}>{SAG_SOURCE_LABEL[sourceKind]}</Small>
        </Card>

        {/* inputs */}
        <Card style={{ marginTop: 10, paddingVertical: 8 }}>
          {INPUTS.map((it, idx) => {
            const value = it.key === "a" ? a : it.key === "b" ? b : c;
            const set = it.key === "a" ? setA : it.key === "b" ? setB : setC;
            return (
              <View key={it.key} style={[styles.inputRow, idx < INPUTS.length - 1 && styles.inputBorder]}>
                <Text style={[styles.inputLetter, interFont(700)]}>{it.label}</Text>
                <Small style={{ flex: 1, color: V3.white }}>{it.text}</Small>
                <TextInput
                  value={value}
                  onChangeText={set}
                  keyboardType="number-pad"
                  placeholder={it.placeholder}
                  placeholderTextColor={V3.muted}
                  style={[styles.input, interFont(700)]}
                  maxLength={4}
                  accessibilityLabel={`Measurement ${it.label} in millimeters`}
                />
              </View>
            );
          })}
        </Card>

        {/* result: the hero once A and C exist */}
        {ridingMm !== null ? (
          <Card style={[{ marginTop: 10, borderColor: tone, borderWidth: 1 }]} accessibilityLabel="Sag result">
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 18 }}>
              <View>
                <Label style={{ marginBottom: 2 }}>Riding</Label>
                <Text style={[styles.resultBig, interFont(700), { color: tone }]}>{ridingMm}<Text style={styles.unit}> mm</Text></Text>
              </View>
              {staticMm !== null ? (
                <View style={{ marginBottom: 4 }}>
                  <Label style={{ marginBottom: 2 }}>Static</Label>
                  <Text style={[styles.targetSmall, interFont(700), { color: staticVerdict(staticMm, staticTarget) === "in_range" ? V3.blue : V3.white }]}>{staticMm}<Text style={styles.unit}> mm</Text></Text>
                </View>
              ) : null}
            </View>
            <Sub style={{ marginTop: 6, color: V3.white }}>{sentence.text}</Sub>
            {sentence.springRule && springLink ? (
              <Pressable onPress={() => sheet("fork_spring")} accessibilityRole="button" style={{ marginTop: 8 }}>
                <Small style={{ color: V3.blue }}>See the spring check for this bike</Small>
              </Pressable>
            ) : null}
          </Card>
        ) : null}

        {/* history, collapsed */}
        <Collapsible title={`History${history.length ? ` · ${history.length}` : ""}`} open={historyOpen} onToggle={() => setHistoryOpen((o) => !o)}>
          {history.length === 0 ? (
            <Sub style={{ marginTop: 0 }}>No measurements yet.</Sub>
          ) : (
            history.map((m, i) => (
              <View key={m.id} style={[styles.historyRow, i < history.length - 1 && styles.historyBorder]}>
                <Small style={{ flex: 1, color: V3.white }}>{new Date(m.measured_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Small>
                <Small style={{ color: V3.white }}>{m.riding_mm} riding</Small>
                <Small style={{ marginLeft: 12 }}>{m.static_mm ? `${m.static_mm} static` : ""}</Small>
              </View>
            ))
          )}
        </Collapsible>

        {/* why, how, front */}
        <Collapsible title="Why it matters" open={whyOpen} onToggle={() => setWhyOpen((o) => !o)}>
          {WHY.map((line) => (
            <Sub key={line} style={{ marginTop: 4 }}>{line}</Sub>
          ))}
        </Collapsible>
        <Collapsible title="How to measure" open={howOpen} onToggle={() => setHowOpen((o) => !o)}>
          <Sub style={{ marginTop: 0 }}>{HOW}</Sub>
          <Sub style={{ marginTop: 6 }}>Static is A minus B. Riding is A minus C.</Sub>
        </Collapsible>
        <Collapsible title="What about the front?" open={frontOpen} onToggle={() => setFrontOpen((o) => !o)}>
          <Sub style={{ marginTop: 0 }}>{FRONT}</Sub>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
            <Pressable onPress={() => sheet("fork_spring")} accessibilityRole="button">
              <Small style={{ color: V3.blue }}>Spring check</Small>
            </Pressable>
            <Pressable onPress={() => sheet("fork_air")} accessibilityRole="button">
              <Small style={{ color: V3.blue }}>Air pressure</Small>
            </Pressable>
          </View>
        </Collapsible>
        {introOpen ? <Small style={{ marginTop: 10, fontSize: 11 }}>These close after your first save.</Small> : null}
      </ScrollView>

      {/* sticky save */}
      <View style={[styles.saveBar, { paddingBottom: 12 + insets.bottom }]}>
        <Button
          label={saving ? "Saving…" : active ? `Save to ${runningSetup(data.setups)?.name ?? "the running setup"}` : "Save"}
          onPress={() => void onSave()}
          disabled={!saveEnabled}
        />
        {!saveEnabled && ridingMm === null ? <Small style={{ marginTop: 6, textAlign: "center" }}>Enter A and C to save.</Small> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: V3.carbon },
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16 },
  targetBig: { color: V3.white, fontSize: 44, lineHeight: 48 },
  targetSmall: { color: V3.white, fontSize: 24, lineHeight: 28 },
  resultBig: { fontSize: 44, lineHeight: 48 },
  unit: { fontSize: 13, color: V3.steel },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  inputBorder: { borderBottomWidth: 1, borderBottomColor: V3.line },
  inputLetter: { color: V3.white, fontSize: 16, width: 20 },
  input: { width: 84, color: V3.white, fontSize: 20, borderWidth: 1, borderColor: V3.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, textAlign: "right", backgroundColor: V3.panel },
  collapseHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  historyRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  historyBorder: { borderBottomWidth: 1, borderBottomColor: V3.line },
  saveBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, backgroundColor: V3.carbon, borderTopWidth: 1, borderTopColor: V3.line },
});
