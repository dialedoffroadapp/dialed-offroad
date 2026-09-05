// app/setup-sheet.tsx — the clicker sheet (design/mockups/05) and the
// non-running setup page (07). Collapsed rows are numbers only: no stock
// values, no delta chips vs stock, no steppers. Tapping a number expands the
// row: range bar only when the model's total click range is verified, end
// labels, "What it does", "Why N for you", history line, tap-to-fix. One row
// expanded at a time. A non-running setup shows deltas vs the RUNNING setup
// (our own data) and "Run this setup".
import { startGarageQuizFlow } from "../lib/quizOnboarding";
import { formatValue } from "../lib/format";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShareSetup } from "../components/ShareSetupCard";
import { useToast } from "../components/Toast";
import { FixNumberSheet } from "../components/garage/GarageSheets";
import { mostChangedCircuits, VersionGraph } from "../components/garage/VersionGraph";
import { Accent, Button, Card, Chip, Eyebrow, H1, Label, Row, Small } from "../components/v3/primitives";
import { headingFont, interFont, useV3Fonts, V3 } from "../components/v3/theme";
import { ADJUSTERS, whyForYou, type AdjusterKey } from "../lib/adjusterCopy";
import { saveBikeExtras } from "../lib/bikeExtras";
import { createManualVersion, runningSetup, switchRunningSetup, type SetupWithVersions } from "../lib/bikeSetups";
import { loadBikePage, loadBikes, loadUserAndPro, type BikePageData } from "../lib/garageV3";
import { shortDate } from "../lib/homeCopy";
import { buildRefineParams } from "../lib/refineFlow";
import { primarySymptom } from "../lib/setupStory";
import { SYMPTOM_PHRASES } from "../lib/ai";
import type { SetupVersionRow, VersionWithFeedback } from "../lib/setupVersions";
import { logEvent } from "../lib/usage";

type RowDef = {
  key: AdjusterKey;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  field: keyof SetupVersionRow | null; // null = bike attribute
  digits: number;
  step: number;
  min: number;
  max: number;
  rangeKey?: "fork_comp" | "fork_reb" | "shock_lsc" | "shock_reb" | "shock_hsc";
};

const FORK_ROWS: RowDef[] = [
  { key: "fork_comp", icon: "swap-vertical-outline", field: "fork_comp_clicks", digits: 0, step: 1, min: 0, max: 40, rangeKey: "fork_comp" },
  { key: "fork_reb", icon: "return-up-back-outline", field: "fork_reb_clicks", digits: 0, step: 1, min: 0, max: 40, rangeKey: "fork_reb" },
];
const SHOCK_ROWS: RowDef[] = [
  { key: "shock_spring", icon: "reload-outline", field: null, digits: 1, step: 0.5, min: 30, max: 80 },
  { key: "shock_sag", icon: "resize-outline", field: "sag_mm", digits: 0, step: 1, min: 80, max: 130 },
  { key: "shock_lsc", icon: "pulse-outline", field: "shock_lsc_clicks", digits: 0, step: 1, min: 0, max: 40, rangeKey: "shock_lsc" },
  { key: "shock_hsc", icon: "flash-outline", field: "shock_hsc_turns", digits: 2, step: 0.25, min: 0, max: 5, rangeKey: "shock_hsc" },
  { key: "shock_reb", icon: "return-up-back-outline", field: "shock_reb_clicks", digits: 0, step: 1, min: 0, max: 40, rangeKey: "shock_reb" },
];

const fmt = (v: number | null, digits: number) => formatValue(v, digits);

export default function SetupSheetScreen() {
  useV3Fonts();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { bikeId, setupId } = useLocalSearchParams<{ bikeId?: string; setupId?: string }>();
  const { shareView, share, available: canShare } = useShareSetup();
  const [data, setData] = useState<BikePageData | null>(null);
  const [expanded, setExpanded] = useState<AdjusterKey | null>(null);
  const [fix, setFix] = useState<RowDef | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const id = String(bikeId ?? "");
    const { userId, isPro } = await loadUserAndPro();
    if (!userId) return;
    const bike = (await loadBikes(userId)).find((b) => b.id === id);
    if (!bike) return;
    const page = await loadBikePage(bike);
    setData({ userId, isPro, ...page });
  }, [bikeId]);

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
  const runningS = data ? runningSetup(data.setups) : null;
  const v = setup?.running ?? null;
  const rv = runningS?.running ?? null;
  const isRunning = !!setup?.isRunning;

  if (!data || !setup) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  const { bike, specs, ranges, extras } = data;
  const airFork = typeof specs?.has_air_fork === "boolean" ? specs.has_air_fork : v?.fork_air_bar !== null && v?.fork_air_bar !== undefined;
  const forkSpring: RowDef = airFork
    ? { key: "fork_air", icon: "speedometer-outline", field: "fork_air_bar", digits: 2, step: 0.1, min: 5, max: 15 }
    : { key: "fork_spring", icon: "reload-outline", field: null, digits: 1, step: 0.1, min: 3, max: 7 };
  const rows: { title: string; icon: React.ComponentProps<typeof Ionicons>["name"]; defs: RowDef[] }[] = [
    { title: `Fork${specs?.fork_type ? ` · ${specs.fork_type}` : ""}`, icon: "arrow-down-outline", defs: [forkSpring, ...FORK_ROWS] },
    { title: `Shock${specs?.shock_type ? ` · ${specs.shock_type}` : ""}`, icon: "arrow-up-outline", defs: SHOCK_ROWS },
  ];
  const bikeTitle = [bike.year, bike.make, bike.model].filter(Boolean).join(" ");
  const asc = [...setup.versions].reverse();

  const valueOf = (d: RowDef, ver: SetupVersionRow | null): number | null => {
    if (d.field) return ver ? ((ver[d.field] as number | null) ?? null) : null;
    if (d.key === "fork_spring") return extras.forkSpringRate;
    if (d.key === "shock_spring") return extras.shockSpringRate;
    return null;
  };

  const historyFor = (d: RowDef) => {
    if (!d.field || asc.length < 2) return null;
    const first = asc[0];
    const firstVal = first[d.field] as number | null;
    let lastChange: { ver: VersionWithFeedback; from: number; to: number } | null = null;
    for (let i = 1; i < asc.length; i++) {
      const a = asc[i - 1][d.field] as number | null;
      const b = asc[i][d.field] as number | null;
      if (typeof a === "number" && typeof b === "number" && a !== b) lastChange = { ver: asc[i], from: a, to: b };
    }
    if (typeof firstVal !== "number" || !lastChange) return null;
    const sym = primarySymptom(lastChange.ver.feedback);
    return { fromVersion: first.version_number, fromValue: firstVal, toVersion: lastChange.ver.version_number, toValue: lastChange.to, reason: sym ? SYMPTOM_PHRASES[sym] : null };
  };

  const onExpand = (d: RowDef) => {
    void Haptics.selectionAsync().catch(() => {});
    const next = expanded === d.key ? null : d.key;
    setExpanded(next);
    if (next) void logEvent("sheet_row_expanded", { adjuster: d.key, setup_id: setup.id, bike_id: bike.id });
  };

  const onFix = async (d: RowDef, value: number) => {
    setFix(null);
    setBusy(true);
    try {
      if (!d.field) {
        await saveBikeExtras(bike.id, d.key === "fork_spring" ? { forkSpringRate: value } : { shockSpringRate: value });
        toast.show("Spring rate saved", { kind: "success" });
      } else {
        const created = await createManualVersion({ bikeId: bike.id, setupId: setup.id, from: v, patch: { [d.field]: value } as any, note: `Fixed ${ADJUSTERS[d.key].label.toLowerCase()} to ${value}` });
        toast.show(`Saved as v${created.version_number}`, { kind: "success" });
      }
      await load();
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't save that.", { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const onRun = async () => {
    setBusy(true);
    const ok = await switchRunningSetup(bike.id, setup.id);
    setBusy(false);
    toast.show(ok ? `${setup.name} is running` : `${setup.name} set on this phone. Syncs after the next update.`, { kind: ok ? "success" : "info" });
    await load();
  };

  const onRefine = () => {
    if (!v) return;
    router.push({ pathname: "/tune-feedback", params: buildRefineParams(v, bikeTitle) } as any);
  };

  const onShare = () => {
    if (!v) return;
    void share(
      {
        bikeTitle,
        versionNumber: v.version_number,
        date: shortDate(new Date(v.created_at)),
        values: { forkComp: v.fork_comp_clicks, forkReb: v.fork_reb_clicks, shockLsc: v.shock_lsc_clicks, shockHsc: v.shock_hsc_turns, shockReb: v.shock_reb_clicks, sag: v.sag_mm },
      },
      "history"
    );
  };

  const lineage = setup.createdFromVersionId ? data.versions.find((x) => x.id === setup.createdFromVersionId) : null;
  const rides = data.feedback.filter((f) => setup.versions.some((x) => x.id === f.setup_version_id)).length;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 10, paddingBottom: 40 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <Row style={{ marginBottom: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={20} color={V3.steel} />
            </Pressable>
            <Eyebrow brand={isRunning ? bike.make : null} style={{ marginBottom: 0 }}>
              {bike.model ?? "Bike"} · {isRunning ? "running" : "setup"}
            </Eyebrow>
          </View>
          <View style={{ flexDirection: "row", gap: 16 }}>
            <Pressable onPress={() => router.push({ pathname: "/setup-story", params: { bikeId: bike.id, setupId: setup.id ?? "default" } } as never)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Compare versions">
              <Ionicons name="swap-horizontal-outline" size={18} color={V3.steel} />
            </Pressable>
            {canShare ? (
              <Pressable onPress={onShare} hitSlop={10} accessibilityRole="button" accessibilityLabel="Share setup">
                <Ionicons name="share-outline" size={18} color={V3.steel} />
              </Pressable>
            ) : null}
          </View>
        </Row>
        <H1 style={{ marginBottom: 8 }}>
          {setup.name} {v ? isRunning ? <Accent>V{v.version_number}</Accent> : <Text style={{ color: V3.steel, fontSize: 22 }}>V{v.version_number}</Text> : null}
        </H1>
        {isRunning ? (
          <View style={styles.convention}>
            <Ionicons name="refresh-outline" size={13} color={V3.steel} />
            <Small>Clicks out from closed</Small>
            <Small style={{ color: V3.muted }}>·</Small>
            <Ionicons name="hand-left-outline" size={13} color={V3.steel} />
            <Small>tap a number to learn it</Small>
          </View>
        ) : (
          <View style={{ flexDirection: "row", marginBottom: 14 }}>
            {setup.terrain ? <Chip label={setup.terrain} icon={<Ionicons name="leaf-outline" size={12} color={V3.blue} />} /> : null}
            <Chip label={`${rides} ${rides === 1 ? "ride" : "rides"}`} />
            {lineage ? <Chip label={`from ${runningS?.name ?? "setup"} v${lineage.version_number}`} /> : null}
          </View>
        )}

        {rows.map((group) => (
          <View key={group.title}>
            <Label style={{ marginBottom: 8, flexDirection: "row" }}>
              <Ionicons name={group.icon} size={13} color={V3.steel} /> {group.title}
            </Label>
            <View style={styles.sheet}>
              {group.defs.map((d, i) => {
                const meta = ADJUSTERS[d.key];
                const val = valueOf(d, v);
                const runVal = !isRunning ? valueOf(d, rv) : null;
                const delta = !isRunning && typeof val === "number" && typeof runVal === "number" && val !== runVal ? val - runVal : null;
                const open = expanded === d.key;
                const rangeMax = d.rangeKey && ranges.verified ? ranges[d.rangeKey] : null;
                const pct = rangeMax && typeof val === "number" ? Math.max(0, Math.min(100, (val / rangeMax) * 100)) : null;
                const history = historyFor(d);
                return (
                  <View key={d.key} style={[styles.srow, i === group.defs.length - 1 && { borderBottomWidth: 0 }]}>
                    <Pressable onPress={() => onExpand(d)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.srowHead}>
                      <View style={styles.name}>
                        <Ionicons name={d.icon} size={17} color={open ? V3.blue : V3.muted} />
                        <Text style={[styles.nameText, interFont(open ? 600 : 400)]}>{meta.label}</Text>
                      </View>
                      <Text style={[styles.num, interFont(700), open && { color: V3.blue }]}>
                        {fmt(val, d.digits)}
                        {meta.unit !== "clicks" || delta !== null ? (
                          <Text style={[styles.unit, interFont(400)]}>
                            {meta.unit !== "clicks" ? ` ${meta.unit === "turns" ? "t" : meta.unit}` : ""}
                            {delta !== null ? `${meta.unit !== "clicks" ? " · " : " "}${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta), d.digits)}${!isRunning && d.key === "fork_air" ? " vs " + (runningS?.name ?? "running") : ""}` : ""}
                          </Text>
                        ) : null}
                      </Text>
                    </Pressable>
                    {open ? (
                      <View style={styles.expanded}>
                        {pct !== null ? (
                          <>
                            <View style={styles.range}>
                              <View style={[styles.knob, { left: `${pct}%` }]} />
                            </View>
                            {meta.ends ? (
                              <View style={styles.ends}>
                                <Text style={styles.endText}>{meta.ends[0]}</Text>
                                <Text style={styles.endText}>{meta.ends[1]}</Text>
                              </View>
                            ) : null}
                          </>
                        ) : null}
                        <View style={styles.block}>
                          <Label style={{ marginBottom: 4 }}>What it does</Label>
                          <Text style={[styles.blockText, interFont(400)]}>{meta.what}</Text>
                        </View>
                        <View style={[styles.block, styles.blockWhy]}>
                          <Label style={{ marginBottom: 4, color: V3.blue }}>Why {fmt(val, d.digits)} for you</Label>
                          <Text style={[styles.blockText, interFont(400)]}>
                            {whyForYou(d.key, val, {
                              riderWeightLbs: (v?.context as any)?.rider?.weight_lbs ?? (v?.recommended_settings as any)?.context?.rider_weight_lbs ?? null,
                              terrain: v?.terrain ?? null,
                              skill: (v?.context as any)?.rider?.skill ?? null,
                              history,
                            })}
                          </Text>
                        </View>
                        <Row>
                          <Small>
                            <Ionicons name="time-outline" size={11} color={V3.steel} />{" "}
                            {history ? `v${history.fromVersion} ${history.fromValue} → v${history.toVersion} ${history.toValue}` : v ? `v${v.version_number} ${fmt(val, d.digits)}` : "—"}
                          </Small>
                          <Pressable onPress={() => setFix(d)} accessibilityRole="button" hitSlop={8}>
                            <Small>
                              <Ionicons name="pencil-outline" size={11} color={V3.steel} /> fix number
                            </Small>
                          </Pressable>
                        </Row>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <Card style={{ paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }} onPress={() => router.push({ pathname: "/garage-bike", params: { bikeId: bike.id } } as never)} accessibilityLabel="Tires">
          <View style={styles.name}>
            <Ionicons name="ellipse-outline" size={17} color={V3.muted} />
            <Text style={[styles.nameText, interFont(400)]}>Tires</Text>
          </View>
          <Text style={[styles.num, { fontSize: 24 }, interFont(700)]}>
            {extras.tireFrontPsi !== null ? fmt(extras.tireFrontPsi, 1).replace(/\.0$/, "") : "—"}
            <Text style={[styles.unit, interFont(400)]}> / </Text>
            {extras.tireRearPsi !== null ? fmt(extras.tireRearPsi, 1).replace(/\.0$/, "") : "—"}
            <Text style={[styles.unit, interFont(400)]}> psi</Text>
          </Text>
        </Card>

        {isRunning ? (
          <>
            <Button label="Refine after ride" onPress={onRefine} icon={<Ionicons name="sparkles-outline" size={18} color={V3.carbon} />} disabled={!v} />
            {/* Free door into the relocated Tune flow: regenerate this bike's
                baseline (replaces the running one, no history). */}
            <Button
              label="Update my baseline"
              ghost
              onPress={() =>
                void startGarageQuizFlow("regenerate", { bikeId: bike.id, make: bike.make ?? undefined, model: bike.model ?? undefined, year: bike.year ?? undefined }).then((first) =>
                  router.push(first as never)
                )
              }
              style={{ marginTop: 10 }}
            />
          </>
        ) : (
          <>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              <Button label="Run this setup" onPress={onRun} compact style={{ flex: 1 }} disabled={busy} />
              <Button label="Refine" onPress={onRefine} ghost compact style={{ flex: 1 }} disabled={!v} />
            </View>
            {asc.length ? (
              <Card onPress={() => router.push({ pathname: "/setup-story", params: { bikeId: bike.id, setupId: setup.id ?? "default" } } as never)} accessibilityLabel="Setup story">
                <Row style={{ marginBottom: 8 }}>
                  <Label>Setup story · {asc.length} {asc.length === 1 ? "version" : "versions"}</Label>
                  <Ionicons name="chevron-forward" size={16} color={V3.steel} />
                </Row>
                <VersionGraph versionsAsc={asc} circuits={mostChangedCircuits(asc, 1)} height={50} runningId={v?.id} />
              </Card>
            ) : null}
            <Small style={{ textAlign: "center", color: V3.muted, fontSize: 11, marginTop: 4 }}>Deltas here are against the running setup. One running setup per bike; switching is explicit.</Small>
          </>
        )}
      </ScrollView>
      {shareView}
      {fix ? (
        <FixNumberSheet
          open
          onClose={() => setFix(null)}
          label={ADJUSTERS[fix.key].label}
          value={valueOf(fix, v) ?? fix.min}
          unit={ADJUSTERS[fix.key].unit}
          step={fix.step}
          min={fix.min}
          max={fix.max}
          digits={fix.digits}
          onSave={(val) => void onFix(fix, val)}
        />
      ) : null}
      {busy ? (
        <View style={styles.busy} pointerEvents="none">
          <ActivityIndicator color={V3.blue} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: V3.carbon },
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX },
  convention: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 18 },
  sheet: { backgroundColor: V3.panel, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 2, marginBottom: 12 },
  srow: { borderBottomWidth: 1, borderBottomColor: V3.hair },
  srowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 15, minHeight: 56 },
  name: { flexDirection: "row", alignItems: "center", gap: 10 },
  nameText: { fontSize: 15, color: V3.white },
  num: { fontSize: 26, lineHeight: 28, color: V3.white },
  unit: { fontSize: 12, color: V3.steel },
  expanded: { paddingBottom: 14 },
  range: { position: "relative", backgroundColor: V3.panel2, borderRadius: 999, height: 6, marginTop: 4, marginBottom: 8 },
  knob: { position: "absolute", top: -4, marginLeft: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: V3.blue, borderWidth: 3, borderColor: V3.panel },
  ends: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  endText: { fontSize: 11, color: V3.muted },
  block: { backgroundColor: V3.carbon, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8 },
  blockWhy: { borderLeftWidth: 2, borderLeftColor: V3.blue },
  blockText: { fontSize: 13, lineHeight: 19, color: V3.white },
  busy: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(11,12,16,0.5)" },
  _h: { ...headingFont() },
});
