// app/setup-history.tsx
// Setup History: the version timeline for one bike — trend chart, trigger
// quotes from ride feedback, outcome chips, adaptive-reversal callouts, and
// non-destructive restore. Pro-only (the garage entry point gates free users;
// this screen re-checks defensively).

import { showProGate } from "../lib/proGate";
import { isEntitled, resolveEntitlement } from "../lib/entitlement";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, {
  Circle as SvgCircle,
  Polyline,
  Text as SvgText,
} from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShareSetup } from "../components/ShareSetupCard";
import { useToast } from "../components/Toast";
import { SYMPTOM_PHRASES, Tune2SymptomId } from "../lib/ai";
import { deriveIsLapsed, deriveIsPro } from "../lib/proUtils";
import { hasPurchasedThisSession } from "../lib/purchases";
import {
  createRestoreVersion,
  FeedbackSymptom,
  getHistoryWithFeedback,
  VersionWithFeedback,
} from "../lib/setupVersions";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { NOTE_HINTS, reasonFromNotes } from "../lib/tuneNotes";
import { logEvent } from "../lib/usage";

/* ------------------------------ constants ------------------------------ */

const GREEN = "#34D399";
const GREEN_BG = "rgba(16,185,129,0.14)";
const AMBER = "#FBBF24";
const AMBER_BG = "rgba(245,158,11,0.14)";

type MetricKey =
  | "fork_comp_clicks"
  | "fork_reb_clicks"
  | "shock_lsc_clicks"
  | "shock_reb_clicks"
  | "sag_mm";

const METRICS: { key: MetricKey; label: string; unit: string }[] = [
  { key: "fork_comp_clicks", label: "Fork comp", unit: "clicks" },
  { key: "fork_reb_clicks", label: "Fork reb", unit: "clicks" },
  { key: "shock_lsc_clicks", label: "Shock LSC", unit: "clicks" },
  { key: "shock_reb_clicks", label: "Shock reb", unit: "clicks" },
  { key: "sag_mm", label: "Sag", unit: "mm" },
];

// Value fields shown in diffs / expanded view / restore sheet, in order.
// noteHints come from the shared map in lib/tuneNotes.ts.
const VALUE_FIELDS: {
  key: keyof VersionWithFeedback;
  label: string;
  unit: string;
  noteHints: readonly string[];
}[] = [
  { key: "fork_comp_clicks", label: "Fork comp", unit: "clicks", noteHints: NOTE_HINTS.fork_comp },
  { key: "fork_reb_clicks", label: "Fork reb", unit: "clicks", noteHints: NOTE_HINTS.fork_reb },
  { key: "fork_air_bar", label: "Fork air", unit: "bar", noteHints: NOTE_HINTS.fork_air },
  { key: "shock_lsc_clicks", label: "Shock LSC", unit: "clicks", noteHints: NOTE_HINTS.shock_lsc },
  { key: "shock_hsc_turns", label: "Shock HSC", unit: "turns", noteHints: NOTE_HINTS.shock_hsc },
  { key: "shock_reb_clicks", label: "Shock reb", unit: "clicks", noteHints: NOTE_HINTS.shock_reb },
  { key: "sag_mm", label: "Sag", unit: "mm", noteHints: NOTE_HINTS.sag },
];

const OUTCOME_LABEL: Record<string, string> = {
  improved: "Improved",
  same: "Same",
  worse: "Worse",
};

/* ------------------------------- helpers ------------------------------- */

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtVal(v: number, unit: string): string {
  if (unit === "bar") return v.toFixed(2);
  if (unit === "turns") return v.toFixed(1);
  return String(v);
}

/** Highest-severity issue entry (protect rows excluded). */
function topIssue(fb: VersionWithFeedback["feedback"]): FeedbackSymptom | null {
  const issues = (Array.isArray(fb?.symptoms) ? fb!.symptoms : []).filter(
    (s: any) => s && typeof s.id === "string" && !("protect" in s && s.protect)
  ) as FeedbackSymptom[];
  if (!issues.length) return null;
  return [...issues].sort(
    (a, b) => (Number(b.severity) || 0) - (Number(a.severity) || 0)
  )[0];
}

/** Trigger line: 'it was harsh in braking' via SYMPTOM_PHRASES. */
function triggerLine(fb: VersionWithFeedback["feedback"]): string | null {
  if (!fb) return null;
  const top = topIssue(fb);
  if (top) {
    const phrase = SYMPTOM_PHRASES[top.id as Tune2SymptomId];
    if (phrase) {
      const where =
        typeof top.where === "string" && top.where.trim().length
          ? ` in ${top.where.trim().toLowerCase()}`
          : "";
      return `${phrase}${where}`;
    }
  }
  // Feedback with no mapped issue (protect / free-text only): quote the note.
  if (typeof fb.free_text === "string" && fb.free_text.trim().length) {
    return fb.free_text.trim();
  }
  return null;
}

type DiffRow = {
  label: string;
  from: number;
  to: number;
  unit: string;
  reason: string | null;
};

function diffRows(
  v: VersionWithFeedback,
  parent: VersionWithFeedback | undefined
): DiffRow[] {
  if (!parent) return [];
  const rows: DiffRow[] = [];
  for (const f of VALUE_FIELDS) {
    const from = numOrNull(parent[f.key]);
    const to = numOrNull(v[f.key]);
    if (from === null || to === null || from === to) continue;
    rows.push({
      label: f.label,
      from,
      to,
      unit: f.unit,
      reason: reasonFromNotes(v.notes, f.noteHints),
    });
  }
  return rows;
}

/** Did `child` reverse course on any circuit `v` had moved? */
function childReversed(
  v: VersionWithFeedback,
  parent: VersionWithFeedback | undefined,
  child: VersionWithFeedback | undefined
): boolean {
  if (!child) return false;
  // The engine's adaptive reversal always leaves this note.
  if ((child.notes ?? []).some((n) => n.includes("reversing that this round"))) {
    return true;
  }
  if (!parent) return false;
  for (const f of VALUE_FIELDS) {
    const before = numOrNull(parent[f.key]);
    const at = numOrNull(v[f.key]);
    const after = numOrNull(child[f.key]);
    if (before === null || at === null || after === null) continue;
    const d1 = at - before;
    const d2 = after - at;
    if (d1 !== 0 && d2 !== 0 && Math.sign(d1) !== Math.sign(d2)) return true;
  }
  return false;
}

/** Short context summary for the baseline card. */
function baselineSummary(v: VersionWithFeedback): string {
  const ctx: any = v.context ?? {};
  const parts: string[] = [];
  const terrain = v.terrain ?? ctx.terrain;
  if (terrain) parts.push(String(terrain));
  const rider = ctx.rider ?? {};
  if (typeof rider.weight_lbs === "number") parts.push(`${rider.weight_lbs} lb`);
  if (typeof rider.skill === "string") parts.push(rider.skill);
  if (ctx.wants_air_fork) parts.push("air fork");
  return parts.length
    ? `Starting point: ${parts.join(", ")}`
    : "Starting point";
}

/* ------------------------------ trend chart ------------------------------ */

function TrendChart({
  history, // oldest → newest
  metric,
  C,
  width,
}: {
  history: VersionWithFeedback[];
  metric: { key: MetricKey; label: string; unit: string };
  C: any;
  width: number;
}) {
  const points = history
    .map((v) => ({ n: v.version_number, value: numOrNull(v[metric.key]) }))
    .filter((p): p is { n: number; value: number } => p.value !== null);

  if (points.length < 2) {
    return (
      <Text style={{ color: C.MUTED, fontSize: 12, marginTop: 12 }}>
        Not enough data for this setting yet.
      </Text>
    );
  }

  const H = 130;
  const PAD_X = 18;
  const PAD_TOP = 26; // room for value labels
  const PAD_BOTTOM = 24; // room for vN labels
  const innerW = width - PAD_X * 2;
  const innerH = H - PAD_TOP - PAD_BOTTOM;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1; // flat series → centered line

  const x = (i: number) =>
    PAD_X + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) =>
    max === min
      ? PAD_TOP + innerH / 2
      : PAD_TOP + innerH - ((v - min) / span) * innerH;

  const poly = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");

  return (
    <Svg width={width} height={H}>
      <Polyline
        points={poly}
        fill="none"
        stroke={C.ACCENT}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <React.Fragment key={p.n}>
          <SvgCircle
            cx={x(i)}
            cy={y(p.value)}
            r={i === points.length - 1 ? 4.5 : 3}
            fill={i === points.length - 1 ? C.ACCENT : C.BG}
            stroke={C.ACCENT}
            strokeWidth={2}
          />
          <SvgText
            x={x(i)}
            y={y(p.value) - 9}
            fill={C.TEXT}
            fontSize={10}
            fontWeight="700"
            textAnchor="middle"
          >
            {fmtVal(p.value, metric.unit)}
          </SvgText>
          <SvgText
            x={x(i)}
            y={H - 6}
            fill={C.MUTED}
            fontSize={10}
            textAnchor="middle"
          >
            {`v${p.n}`}
          </SvgText>
        </React.Fragment>
      ))}
    </Svg>
  );
}

/* -------------------------------- screen -------------------------------- */

export default function SetupHistoryScreen() {
  const { bikeId } = useLocalSearchParams<{ bikeId?: string }>();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);
  const { width: windowW } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [bikeTitle, setBikeTitle] = useState("Setup history");
  const [history, setHistory] = useState<VersionWithFeedback[]>([]);
  const [metric, setMetric] = useState<(typeof METRICS)[number]>(METRICS[0]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [restoreFrom, setRestoreFrom] = useState<VersionWithFeedback | null>(null);
  const [restoring, setRestoring] = useState(false);
  // Lapsed-subscriber progression view (audit R8): the timeline LIST and
  // stats strip are visible — their own data is the winback hook — but
  // clicker values, trend chart, expansion, restore, and share stay gated
  // behind the winback CTA.
  const [restricted, setRestricted] = useState(false);
  const { shareView, share, available: canShare } = useShareSetup();

  const load = useCallback(async () => {
    if (typeof bikeId !== "string" || !bikeId) {
      router.back();
      return;
    }
    try {
      setLoading(true);

      // Defensive Pro re-check — the garage entry point is the real gate.
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user?.id) {
        router.replace("/login");
        return;
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("pro_until, is_pro")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      const proNow = deriveIsPro(prof) || hasPurchasedThisSession() || isEntitled(await resolveEntitlement());
      const lapsed = deriveIsLapsed(prof);
      if (!proNow && !lapsed) {
        // Free tier (never paid): full gate, exactly as before.
        void logEvent("history_gate_hit", { source: "screen_direct", paywall_trigger_action: "setup_history" });
        showProGate({ trigger: "setup_history", bikeId: String(bikeId ?? ""), onDismiss: () => router.back() });
        return;
      }
      setRestricted(!proNow);

      const [{ data: bike }, rows] = await Promise.all([
        supabase
          .from("bikes")
          .select("make, model, year, nickname")
          .eq("id", bikeId)
          .maybeSingle(),
        getHistoryWithFeedback(bikeId),
      ]);

      if (bike) {
        setBikeTitle(
          [bike.year, bike.make, bike.model].filter(Boolean).join(" ") ||
            "Setup history"
        );
      }
      setHistory(rows);
      void logEvent("history_opened", {
        bike_id: bikeId,
        version_count: rows.length,
      });
    } catch (e: any) {
      toast.show(e?.message ?? "Couldn't load setup history", { kind: "error" });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bikeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => {
    const m = new Map<string, VersionWithFeedback>();
    for (const v of history) m.set(v.id, v);
    return m;
  }, [history]);

  const childOf = useMemo(() => {
    const m = new Map<string, VersionWithFeedback>();
    for (const v of history) {
      if (v.parent_version_id) m.set(v.parent_version_id, v);
    }
    return m;
  }, [history]);

  const chronological = useMemo(() => [...history].reverse(), [history]); // oldest → newest
  const current = history[0] ?? null;

  const improvedCount = useMemo(
    () => history.filter((v) => v.feedback?.outcome === "improved").length,
    [history]
  );
  const anyOutcome = useMemo(
    () => history.some((v) => v.feedback?.outcome != null),
    [history]
  );
  const dialedSince = chronological.length
    ? fmtDate(chronological[0].created_at)
    : null;

  const onExpand = (v: VersionWithFeedback) => {
    if (restricted) {
      // Version detail is the Pro surface — tapping a row is the winback CTA.
      void logEvent("winback_cta_tapped", { source: "history_row" });
      router.push("/winback" as any);
      return;
    }
    const next = expandedId === v.id ? null : v.id;
    setExpandedId(next);
    if (next) {
      void logEvent("history_version_expanded", {
        bike_id: bikeId,
        version_number: v.version_number,
      });
    }
  };

  const onStartRestore = (v: VersionWithFeedback) => {
    setRestoreFrom(v);
    void logEvent("restore_started", {
      bike_id: bikeId,
      from_version: v.version_number,
    });
  };

  const onConfirmRestore = async () => {
    if (!restoreFrom || !current || restoring) return;
    try {
      setRestoring(true);
      const created = await createRestoreVersion({
        bikeId: typeof bikeId === "string" ? bikeId : null,
        fromVersion: restoreFrom,
        currentVersionId: current.id,
      });
      void logEvent("restore_confirmed", {
        bike_id: bikeId,
        from_version: restoreFrom.version_number,
        new_version: created.version_number,
      });
      setRestoreFrom(null);
      setExpandedId(null);
      toast.show(`Setup restored as v${created.version_number}`, {
        kind: "success",
      });
      await load();
    } catch (e: any) {
      toast.show(e?.message ?? "Restore failed", { kind: "error" });
    } finally {
      setRestoring(false);
    }
  };

  /* ------------------------------- render ------------------------------- */

  const chartWidth = windowW - 16 * 2 - 14 * 2; // screen pad + card pad

  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
      <View style={{ height: insets.top, backgroundColor: C.BG }} />

      {/* Header */}
      <View style={S.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={S.headerBtn}>
          <Ionicons name="chevron-back-outline" size={24} color={C.TEXT} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={S.headerTitle}>Setup history</Text>
          <Text style={S.headerSub} numberOfLines={1}>
            {bikeTitle}
          </Text>
        </View>
        {current && !restricted ? (
          <Pressable
            onPress={() =>
              share(
                {
                  bikeTitle,
                  versionNumber: current.version_number,
                  date: fmtDate(current.created_at),
                  values: {
                    forkComp: numOrNull(current.fork_comp_clicks),
                    forkReb: numOrNull(current.fork_reb_clicks),
                    shockLsc: numOrNull(current.shock_lsc_clicks),
                    shockHsc: numOrNull(current.shock_hsc_turns),
                    shockReb: numOrNull(current.shock_reb_clicks),
                    sag: numOrNull(current.sag_mm),
                  },
                },
                "history"
              )
            }
            hitSlop={8}
            style={S.headerBtn}
          >
            <Ionicons name="share-outline" size={21} color={C.TEXT} />
          </Pressable>
        ) : (
          <View style={S.headerBtn} />
        )}
      </View>

      {shareView}

      {loading ? (
        <View style={S.centerFill}>
          <ActivityIndicator color={C.ACCENT} />
        </View>
      ) : history.length === 0 ? (
        <View style={S.centerFill}>
          <Text style={S.emptyText}>
            No saved versions for this bike yet. Generate a tune and save it to
            start the timeline.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        >
          {/* Winback banner — lapsed users only */}
          {restricted ? (
            <Pressable
              onPress={() => {
                void logEvent("winback_cta_tapped", { source: "history_banner" });
                router.push("/winback" as any);
              }}
              style={S.winbackBanner}
            >
              <Ionicons name="time-outline" size={18} color={C.ACCENT} />
              <Text style={S.winbackBannerText}>
                Your setup history is waiting. Pick up where you left off
              </Text>
              <Ionicons name="chevron-forward" size={16} color={C.ACCENT} />
            </Pressable>
          ) : null}

          {/* Stats strip */}
          <Text style={S.statsStrip}>
            {`${history.length} version${history.length === 1 ? "" : "s"}`}
            {anyOutcome ? ` · ${improvedCount} improved` : ""}
            {dialedSince ? ` · dialed since ${dialedSince}` : ""}
          </Text>

          {/* Trend card (clicker values — Pro surface) */}
          {history.length >= 2 && !restricted && (
            <View style={S.card}>
              <View style={S.trendHeader}>
                <Text style={S.cardTitle}>Trend</Text>
                {numOrNull(current?.[metric.key]) !== null && (
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={S.trendCurrent}>
                      {fmtVal(current![metric.key] as number, metric.unit)}
                    </Text>
                    <Text style={S.trendCurrentUnit}>
                      {metric.label.toLowerCase()} · {metric.unit}
                    </Text>
                  </View>
                )}
              </View>

              <View style={S.segmentRow}>
                {METRICS.map((m) => {
                  const on = m.key === metric.key;
                  return (
                    <Pressable
                      key={m.key}
                      onPress={() => setMetric(m)}
                      style={[S.segment, on && S.segmentOn]}
                    >
                      <Text style={[S.segmentText, on && S.segmentTextOn]}>
                        {m.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <TrendChart
                history={chronological}
                metric={metric}
                C={C}
                width={chartWidth}
              />
            </View>
          )}

          {/* Timeline */}
          {history.map((v) => {
            const parent = v.parent_version_id
              ? byId.get(v.parent_version_id)
              : undefined;
            const child = childOf.get(v.id);
            const isCurrent = current?.id === v.id;
            const isBaseline = v.source === "baseline" && !v.parent_version_id;
            const restoredFrom = v.restored_from_version_id
              ? byId.get(v.restored_from_version_id)
              : undefined;
            const trigger = triggerLine(v.feedback);
            const outcome = v.feedback?.outcome ?? null;
            const rows = diffRows(v, parent);
            const showReversal =
              outcome === "worse" && childReversed(v, parent, child);
            const expanded = expandedId === v.id;

            return (
              <Pressable key={v.id} onPress={() => onExpand(v)} style={S.card}>
                {/* Title row */}
                <View style={S.versionRow}>
                  <Text style={S.versionNum}>{`v${v.version_number}`}</Text>
                  {isCurrent && (
                    <View style={[S.badge, S.badgeAccent]}>
                      <Text style={S.badgeAccentText}>current</Text>
                    </View>
                  )}
                  {isBaseline && (
                    <View style={S.badge}>
                      <Text style={S.badgeText}>baseline</Text>
                    </View>
                  )}
                  {v.source === "restore" && (
                    <View style={S.badge}>
                      <Text style={S.badgeText}>
                        {restoredFrom
                          ? `restored from v${restoredFrom.version_number}`
                          : "restored"}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }} />
                  <Text style={S.versionDate}>{fmtDate(v.created_at)}</Text>
                </View>

                {/* Trigger quote */}
                {trigger ? (
                  <Text style={S.triggerLine} numberOfLines={2}>
                    After: “{trigger}”
                  </Text>
                ) : null}

                {/* Outcome chip */}
                {outcome ? (
                  <View
                    style={[
                      S.outcomeChip,
                      outcome === "improved" && { backgroundColor: GREEN_BG },
                      outcome === "worse" && { backgroundColor: AMBER_BG },
                      outcome === "same" && { backgroundColor: C.INK },
                    ]}
                  >
                    <Text
                      style={[
                        S.outcomeChipText,
                        outcome === "improved" && { color: GREEN },
                        outcome === "worse" && { color: AMBER },
                        outcome === "same" && { color: C.MUTED },
                      ]}
                    >
                      {OUTCOME_LABEL[outcome] ?? outcome}
                    </Text>
                  </View>
                ) : null}

                {/* Adaptive reversal callout */}
                {showReversal && child ? (
                  <View style={S.reversalCallout}>
                    <Text style={S.reversalText}>
                      ↩ Next refinement reversed this. See v
                      {child.version_number}
                    </Text>
                  </View>
                ) : null}

                {/* Body: baseline summary or diff rows. Restricted mode keeps
                    the narrative (triggers, outcomes) but locks the numbers —
                    the values are the Pro surface. */}
                {isBaseline ? (
                  <Text style={S.baselineSummary}>{baselineSummary(v)}</Text>
                ) : restricted ? (
                  rows.length ? (
                    <Text style={S.lockedValuesHint}>
                      <Ionicons name="lock-closed" size={11} color={C.MUTED} />
                      {"  "}
                      {rows.length} setting change{rows.length === 1 ? "" : "s"}:
                      values with Pro
                    </Text>
                  ) : (
                    <Text style={S.noChanges}>No setting changes.</Text>
                  )
                ) : rows.length ? (
                  <View style={{ marginTop: 8 }}>
                    {rows.map((r) => (
                      <Text key={r.label} style={S.diffRow} numberOfLines={1}>
                        <Text style={S.diffLabel}>{r.label} </Text>
                        {fmtVal(r.from, r.unit)} → {fmtVal(r.to, r.unit)}
                        {r.reason ? (
                          <Text style={S.diffReason}> · {r.reason}</Text>
                        ) : null}
                      </Text>
                    ))}
                  </View>
                ) : !expanded ? (
                  <Text style={S.noChanges}>No setting changes.</Text>
                ) : null}

                {/* Expanded: full values + restore */}
                {expanded ? (
                  <View style={S.expandedWrap}>
                    <View style={S.valuesGrid}>
                      {VALUE_FIELDS.map((f) => {
                        const val = numOrNull(v[f.key]);
                        if (val === null) return null;
                        return (
                          <View key={String(f.key)} style={S.valueCell}>
                            <Text style={S.valueLabel}>{f.label}</Text>
                            <Text style={S.valueNum}>
                              {fmtVal(val, f.unit)}{" "}
                              <Text style={S.valueUnit}>{f.unit}</Text>
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                    {!isCurrent && (
                      <Pressable
                        onPress={() => onStartRestore(v)}
                        style={S.restoreBtn}
                      >
                        <Ionicons
                          name="refresh-outline"
                          size={16}
                          color={C.ACCENT}
                        />
                        <Text style={S.restoreBtnText}>Restore this setup</Text>
                      </Pressable>
                    )}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Restore sheet */}
      <Modal
        visible={!!restoreFrom}
        transparent
        animationType="fade"
        onRequestClose={() => setRestoreFrom(null)}
      >
        <View style={S.sheetWrap}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setRestoreFrom(null)}
          />
          <View style={[S.sheet, { paddingBottom: insets.bottom + 14 }]}>
            <Text style={S.sheetTitle}>
              Restore v{restoreFrom?.version_number}
            </Text>

            {restoreFrom && current
              ? VALUE_FIELDS.map((f) => {
                  const cur = numOrNull(current[f.key]);
                  const to = numOrNull(restoreFrom[f.key]);
                  if (cur === null && to === null) return null;
                  const same = cur === to;
                  return (
                    <View key={String(f.key)} style={S.sheetRow}>
                      <Text style={[S.sheetRowLabel, same && S.sheetRowMuted]}>
                        {f.label}
                      </Text>
                      <Text style={[S.sheetRowValue, same && S.sheetRowMuted]}>
                        {same
                          ? `${cur !== null ? fmtVal(cur, f.unit) : "—"} · no change`
                          : `${cur !== null ? fmtVal(cur, f.unit) : "—"} → ${
                              to !== null ? fmtVal(to, f.unit) : "—"
                            }`}
                      </Text>
                    </View>
                  );
                })
              : null}

            <Text style={S.sheetFooterNote}>
              Saved as v{(current?.version_number ?? 0) + 1} · restored from v
              {restoreFrom?.version_number}. Nothing is deleted.
            </Text>

            <View style={S.sheetBtnRow}>
              <Pressable
                onPress={() => setRestoreFrom(null)}
                style={S.sheetBtnGhost}
              >
                <Text style={S.sheetBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onConfirmRestore}
                disabled={restoring}
                style={[S.sheetBtnPrimary, restoring && { opacity: 0.6 }]}
              >
                {restoring ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={S.sheetBtnPrimaryText}>Restore</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* -------------------------------- styles -------------------------------- */

const makeStyles = (C: any) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 4,
      paddingVertical: 6,
    },
    headerBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: { color: C.TEXT, fontSize: 16, fontWeight: "800" },
    headerSub: { color: C.MUTED, fontSize: 12, marginTop: 1 },

    centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    emptyText: { color: C.MUTED, fontSize: 14, textAlign: "center", lineHeight: 20 },

    statsStrip: {
      color: C.MUTED,
      fontSize: 13,
      fontWeight: "600",
      paddingHorizontal: 16,
      marginTop: 8,
    },

    winbackBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.ACCENT,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 13,
      marginHorizontal: 16,
      marginTop: 10,
    },
    winbackBannerText: {
      flex: 1,
      color: C.TEXT,
      fontSize: 13,
      fontWeight: "700",
      lineHeight: 18,
    },
    lockedValuesHint: {
      color: C.MUTED,
      fontSize: 12,
      fontWeight: "600",
      marginTop: 8,
    },

    card: {
      backgroundColor: C.CARD,
      borderRadius: 14,
      padding: 14,
      marginHorizontal: 16,
      marginTop: 12,
    },
    cardTitle: { color: C.TEXT, fontSize: 15, fontWeight: "800" },

    trendHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
    },
    trendCurrent: { color: C.TEXT, fontSize: 24, fontWeight: "900" },
    trendCurrentUnit: { color: C.MUTED, fontSize: 11, marginTop: 1 },

    segmentRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 10,
    },
    segment: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: "transparent",
    },
    segmentOn: { backgroundColor: "rgba(29,155,240,0.14)" },
    segmentText: { color: C.MUTED, fontSize: 12, fontWeight: "700" },
    segmentTextOn: { color: C.ACCENT },

    versionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    versionNum: { color: C.TEXT, fontSize: 16, fontWeight: "900" },
    versionDate: { color: C.MUTED, fontSize: 12 },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: C.INK,
    },
    badgeText: { color: C.MUTED, fontSize: 10, fontWeight: "800" },
    badgeAccent: { backgroundColor: "rgba(29,155,240,0.16)" },
    badgeAccentText: { color: C.ACCENT, fontSize: 10, fontWeight: "800" },

    triggerLine: {
      color: C.TEXT,
      fontSize: 13,
      fontStyle: "italic",
      opacity: 0.9,
      marginTop: 8,
    },

    outcomeChip: {
      alignSelf: "flex-start",
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 999,
      marginTop: 8,
    },
    outcomeChipText: { fontSize: 11, fontWeight: "800" },

    reversalCallout: {
      backgroundColor: "rgba(29,155,240,0.10)",
      borderLeftWidth: 3,
      borderLeftColor: C.ACCENT,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginTop: 10,
    },
    reversalText: { color: C.ACCENT, fontSize: 12, fontWeight: "700" },

    baselineSummary: { color: C.MUTED, fontSize: 13, marginTop: 8 },
    noChanges: { color: C.MUTED, fontSize: 12, marginTop: 8 },

    diffRow: { color: C.TEXT, fontSize: 13, marginTop: 5 },
    diffLabel: { fontWeight: "800" },
    diffReason: { color: C.MUTED },

    expandedWrap: { marginTop: 12 },
    valuesGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: 10,
    },
    valueCell: { width: "33.33%" },
    valueLabel: { color: C.MUTED, fontSize: 11, fontWeight: "600" },
    valueNum: { color: C.TEXT, fontSize: 15, fontWeight: "800", marginTop: 1 },
    valueUnit: { color: C.MUTED, fontSize: 11, fontWeight: "600" },

    restoreBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginTop: 14,
      paddingVertical: 11,
      borderRadius: 10,
      backgroundColor: "rgba(29,155,240,0.12)",
    },
    restoreBtnText: { color: C.ACCENT, fontWeight: "800", fontSize: 14 },

    sheetWrap: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: C.CARD,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingHorizontal: 18,
      paddingTop: 16,
    },
    sheetTitle: { color: C.TEXT, fontSize: 17, fontWeight: "800", marginBottom: 10 },
    sheetRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 7,
    },
    sheetRowLabel: { color: C.TEXT, fontSize: 13, fontWeight: "700" },
    sheetRowValue: { color: C.TEXT, fontSize: 13, fontWeight: "600" },
    sheetRowMuted: { color: C.MUTED, fontWeight: "500" },
    sheetFooterNote: {
      color: C.MUTED,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 12,
    },
    sheetBtnRow: { flexDirection: "row", gap: 10, marginTop: 14 },
    sheetBtnGhost: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: "center",
      borderWidth: 1,
      borderColor: C.BORDER,
    },
    sheetBtnGhostText: { color: C.TEXT, fontWeight: "800" },
    sheetBtnPrimary: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: "center",
      backgroundColor: C.ACCENT,
    },
    sheetBtnPrimaryText: { color: "#fff", fontWeight: "900" },
  });
