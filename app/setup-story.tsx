// app/setup-story.tsx — setup history (design/mockups/06), Pro only. Chip
// row selects the circuits on the graph (two lit by default: the two that
// changed most), then the timeline: name, date, exact change, outcome if
// logged, Compare on old versions, Restore on the oldest, running badge on
// the current. Free users never reach it (the bike page shows the locked
// "already recording" row and gates to the paywall).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../components/Toast";
import { circuitValue, GRAPH_LABELS, mostChangedCircuits, VersionGraph, type GraphCircuit } from "../components/garage/VersionGraph";
import { BottomSheet } from "../components/v3/BottomSheet";
import { Badge, Button, Card, Chip, Eyebrow, H1, Label, Row, Small, Sub } from "../components/v3/primitives";
import { interFont, useV3Fonts, V3 } from "../components/v3/theme";
import { runningSetup, type SetupWithVersions } from "../lib/bikeSetups";
import { loadBikePage, loadBikes, loadUserAndPro, type BikePageData } from "../lib/garageV3";
import { shortDate } from "../lib/homeCopy";
import { paywallHref } from "../lib/paywall";
import { hasPurchasedThisSession } from "../lib/purchases";
import { deltaChangeLine, outcomeWord } from "../lib/setupStory";
import { createRestoreVersion, type VersionWithFeedback } from "../lib/setupVersions";
import { logEvent } from "../lib/usage";

const SOURCE_WORD: Record<string, string> = { baseline: "baseline", refinement: "refine", restore: "restored", manual: "by hand" };

export default function SetupStoryScreen() {
  useV3Fonts();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { bikeId, setupId } = useLocalSearchParams<{ bikeId?: string; setupId?: string }>();
  const [data, setData] = useState<BikePageData | null>(null);
  const [circuits, setCircuits] = useState<GraphCircuit[] | null>(null);
  const [compare, setCompare] = useState<VersionWithFeedback | null>(null);
  const [restore, setRestore] = useState<VersionWithFeedback | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const id = String(bikeId ?? "");
    const { userId, isPro } = await loadUserAndPro();
    if (!userId) return router.replace("/login" as never);
    if (!isPro && !hasPurchasedThisSession()) {
      void logEvent("history_gate_hit", { bike_id: id, source: "story_direct" });
      router.replace(paywallHref("setup_history", "back") as never);
      return;
    }
    const bike = (await loadBikes(userId)).find((b) => b.id === id);
    if (!bike) return router.back();
    const page = await loadBikePage(bike);
    setData({ userId, isPro, ...page });
    void logEvent("story_opened", { bike_id: id, versions: page.versions.length, source: "story_screen" });
    void logEvent("history_opened", { bike_id: id, version_count: page.versions.length });
  }, [bikeId, router]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return undefined;
    }, [load])
  );

  const setup: SetupWithVersions | null = useMemo(() => {
    if (!data) return null;
    const wanted = setupId && setupId !== "default" ? String(setupId) : null;
    return data.setups.find((s) => s.id === wanted) ?? data.setups[0] ?? null;
  }, [data, setupId]);

  if (!data || !setup) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  const { bike, story } = data;
  const desc = setup.versions;
  const asc = [...desc].reverse();
  const lit = circuits ?? mostChangedCircuits(asc, 2);
  const runningV = runningSetup(data.setups)?.running ?? null;
  const current = desc[0] ?? null;
  const allCircuits = (Object.keys(GRAPH_LABELS) as GraphCircuit[]).filter((c) => c !== "fork_air" || asc.some((v) => circuitValue(v, c) !== null));
  const storyText = (v: VersionWithFeedback) => story.find((s) => s.id === v.id)?.text ?? "";

  const toggle = (c: GraphCircuit) => {
    const next = lit.includes(c) ? lit.filter((x) => x !== c) : [...lit, c].slice(-3);
    setCircuits(next.length ? next : lit);
  };

  const onRestore = async () => {
    if (!restore || !current) return;
    setBusy(true);
    try {
      void logEvent("restore_started", { bike_id: bike.id, from_version: restore.version_number });
      const created = await createRestoreVersion({ bikeId: bike.id, fromVersion: restore, currentVersionId: current.id });
      void logEvent("restore_confirmed", { bike_id: bike.id, from_version: restore.version_number, new_version: created.version_number });
      toast.show(`Saved as v${created.version_number} · restored from v${restore.version_number}`, { kind: "success" });
      setRestore(null);
      await load();
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't restore that.", { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 10, paddingBottom: 40 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={V3.steel} />
          </Pressable>
          <Eyebrow style={{ marginBottom: 0 }}>{bike.model ?? "Bike"} · {setup.name}</Eyebrow>
        </View>
        <H1>Setup story</H1>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ paddingVertical: 2 }}>
          {allCircuits.map((c) => {
            const idx = lit.indexOf(c);
            return <Chip key={c} label={GRAPH_LABELS[c]} on={idx === 0} alt={idx > 0} onPress={() => toggle(c)} />;
          })}
        </ScrollView>

        <Card>
          {asc.length >= 2 ? (
            <VersionGraph versionsAsc={asc} circuits={lit} height={130} axes runningId={current?.id} />
          ) : (
            <Sub style={{ marginTop: 0 }}>One version so far. The graph draws itself from the first refinement.</Sub>
          )}
        </Card>

        {desc.map((v, i) => {
          const parent = v.parent_version_id ? desc.find((x) => x.id === v.parent_version_id) ?? null : desc[i + 1] ?? null;
          const change = v.source === "baseline" ? (i === desc.length - 1 ? "from the quiz" : "regenerated · no change") : deltaChangeLine(v, parent) ?? "no change";
          const ridden = data.feedback.find((f) => f.setup_version_id === v.id);
          const before = v.feedback ? outcomeWord(data.feedback.find((f) => f.setup_version_id === v.feedback!.setup_version_id)?.outcome) : null;
          const after = outcomeWord(ridden?.outcome);
          const outcome = after ? (before ? `${before} → ${after}` : after) : null;
          const isCurrent = i === 0;
          const isOldest = i === desc.length - 1;
          return (
            <Card key={v.id} variant={isCurrent ? "callout" : undefined} style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
              <Row>
                <Text style={[styles.vTitle, interFont(600)]} numberOfLines={1}>
                  v{v.version_number} · {storyText(v)}
                </Text>
                {isCurrent ? (
                  <Badge label="running" />
                ) : isOldest ? (
                  <Pressable onPress={() => setRestore(v)} hitSlop={8} accessibilityRole="button">
                    <Small style={{ color: V3.blue }}>Restore</Small>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => {
                      void logEvent("history_version_expanded", { bike_id: bike.id, version: v.version_number });
                      setCompare(v);
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Small style={{ color: V3.blue }}>Compare</Small>
                  </Pressable>
                )}
              </Row>
              <Sub style={{ fontSize: 12 }}>
                {[shortDate(new Date(v.created_at)), SOURCE_WORD[v.source] ?? v.source, change, outcome].filter(Boolean).join(" · ")}
              </Sub>
            </Card>
          );
        })}
      </ScrollView>

      <BottomSheet open={!!compare} onClose={() => setCompare(null)} title={compare ? `v${compare.version_number} vs running` : undefined}>
        {compare && runningV ? (
          <View>
            {(
              [
                ["Fork comp", "fork_comp_clicks", 0],
                ["Fork reb", "fork_reb_clicks", 0],
                ["Fork air", "fork_air_bar", 1],
                ["Shock LSC", "shock_lsc_clicks", 0],
                ["Shock HSC", "shock_hsc_turns", 1],
                ["Shock reb", "shock_reb_clicks", 0],
                ["Sag", "sag_mm", 0],
              ] as [string, keyof VersionWithFeedback, number][]
            )
              .filter(([, f]) => compare[f] !== null || runningV[f] !== null)
              .map(([label, f, digits]) => {
                const a = compare[f] as number | null;
                const b = runningV[f] as number | null;
                const same = a === b;
                return (
                  <Row key={f} style={styles.cmpRow}>
                    <Text style={[styles.cmpLabel, interFont(400)]}>{label}</Text>
                    <Text style={[styles.cmpVal, interFont(700), same && { color: V3.steel }]}>
                      {a === null ? "—" : digits ? a.toFixed(digits) : a} <Text style={[styles.cmpArrow, interFont(400)]}>→</Text> {b === null ? "—" : digits ? b.toFixed(digits) : b}
                      {same ? <Text style={[styles.cmpArrow, interFont(400)]}>  same</Text> : null}
                    </Text>
                  </Row>
                );
              })}
            <Small style={{ marginTop: 12 }}>Left is v{compare.version_number}; right is what&apos;s running now.</Small>
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet open={!!restore} onClose={() => setRestore(null)} title={restore ? `Restore v${restore.version_number}?` : undefined}>
        {restore && current ? (
          <View>
            <Sub style={{ marginTop: 0 }}>Saved as v{current.version_number + 1} · restored from v{restore.version_number}. Nothing is deleted.</Sub>
            <Button label={busy ? "Restoring…" : "Restore this setup"} disabled={busy} style={{ marginTop: 18 }} onPress={() => void onRestore()} />
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: V3.carbon },
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX },
  vTitle: { fontSize: 14, color: V3.white, flex: 1, paddingRight: 10 },
  cmpRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: V3.hair },
  cmpLabel: { fontSize: 14, color: V3.steel },
  cmpVal: { fontSize: 16, color: V3.white },
  cmpArrow: { fontSize: 12, color: V3.steel },
  _l: { ...({} as any) },
});
