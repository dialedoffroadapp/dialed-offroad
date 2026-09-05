// app/ride/today.tsx — Today's setup (design/mockups/ride/05): the running
// setup adjusted for conditions by the deterministic rule base. Plain list,
// 32pt numbers, changed rows old → new with a blue arrow, one sentence under
// the headline. Tapping a changed row shows the reason. Applying creates no
// version: the tweaks become the day's starting pending deltas.
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet } from "../../components/v3/BottomSheet";
import { Eyebrow, Label, Small, Sub } from "../../components/v3/primitives";
import { V3 } from "../../components/v3/theme";
import { Cta, RideH1, RideScreenBg, RowSet, ValueRow } from "../../components/ride/ridePrimitives";
import { readBikeExtras, saveBikeExtras, type BikeExtras } from "../../lib/bikeExtras";
import { previewValue, tirePressureForToday } from "../../lib/conditionsRules";
import { suggestForConditions, type SuggestResult } from "../../lib/rideEngine";
import { SayItYourWay } from "../../components/ride/SayItYourWay";
import { CIRCUIT_STEPS, snapshotFromVersion, type CircuitKey } from "../../lib/currentSetup";
import { conditionsSummary, surfaceLabel, primarySurface } from "../../lib/rideConditions";
import { applyDeltas, readDraft, readOpenSession, startSession, type RideDraft } from "../../lib/rideDay";
import { startRideActivity } from "../../lib/rideLiveActivity";
import { supabase } from "../../lib/supabase";
import { logEvent } from "../../lib/usage";

const ROWS: { group: "Fork" | "Shock"; key: CircuitKey; label: string; unit?: string; air?: boolean }[] = [
  { group: "Fork", key: "fork_air", label: "Air", unit: "bar", air: true },
  { group: "Fork", key: "fork_comp", label: "Compression" },
  { group: "Fork", key: "fork_reb", label: "Rebound" },
  { group: "Shock", key: "shock_lsc", label: "Low speed" },
  { group: "Shock", key: "shock_hsc", label: "High speed", unit: "turns" },
  { group: "Shock", key: "shock_reb", label: "Rebound" },
];

const fmt = (v: number | null, k: CircuitKey) => (typeof v === "number" ? v.toFixed(k === "fork_air" ? 1 : k === "shock_hsc" ? 1 : 0) : "—");

export default function RideTodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [draft, setDraft] = useState<RideDraft | null>(null);
  const [extras, setExtras] = useState<BikeExtras | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [asked, setAsked] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [rules, setRules] = useState<SuggestResult | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const open = await readOpenSession();
      if (open) return router.replace("/ride/mode" as never);
      const d = await readDraft();
      if (!d.bike || !d.startingVersion) return router.replace("/ride/start" as never);
      const e = await readBikeExtras(d.bike.id);
      if (!alive) return;
      setDraft(d);
      setExtras(e);
    })();
    return () => {
      alive = false;
    };
  }, [router, from]);

  const base = useMemo(() => (draft?.startingVersion ? snapshotFromVersion(draft.startingVersion) : null), [draft]);
  // Engine when online (free text is what it can act on), rules otherwise.
  useEffect(() => {
    if (!draft || !base || !draft.bike) return;
    let alive = true;
    setThinking(true);
    void suggestForConditions({
      bike: draft.bike,
      hasAirFork: draft.hasAirFork,
      trackName: draft.trackName ?? null,
      conditions: draft.conditions,
      effective: base,
      setupName: draft.setupName ?? "setup",
      freeText,
    }).then((r) => {
      if (!alive) return;
      setRules(r);
      setThinking(false);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, base, asked]);

  if (!draft || !base || !rules || !extras) {
    return (
      <View style={[RideScreenBg({}), styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  const deltaFor = (k: CircuitKey) => rules.deltas.find((d) => d.circuit === k) ?? null;
  const rows = ROWS.filter((r) => !r.air || draft.hasAirFork || typeof base.fork_air === "number");
  const tiresF = extras.tireFrontPsi;
  const tiresR = extras.tireRearPsi;
  // Always a tire pressure: saved value (plus any rule delta), else the
  // per-surface default, shown as a changed row with its reason.
  const tires = tirePressureForToday(draft.conditions, { front: tiresF, rear: tiresR }, rules.tirePsiDelta);

  const onStart = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      let s = await startSession(draft, auth?.user?.id ?? null);
      s = { ...s, suggestionShown: rules.deltas.length > 0 || tires.changed, suggestionApplied: rules.deltas.length > 0 || tires.changed };
      if (rules.deltas.length) s = await applyDeltas(s, rules.deltas, "conditions");
      if (tires.changed && (typeof tires.front === "number" || typeof tires.rear === "number")) {
        await saveBikeExtras(draft.bike!.id, { tireFrontPsi: tires.front, tireRearPsi: tires.rear });
      }
      void startRideActivity({ startedAt: s.startedAt, track: s.trackName });
      void logEvent("ride_day_started", {
        bike_id: draft.bike!.id,
        setup_id: draft.setupId,
        track_id: draft.trackId,
        track_named: !!draft.trackName,
        entry: "start_riding_button",
        suggestion_shown: s.suggestionShown,
        suggestion_applied: s.suggestionApplied,
        tweaks: rules.deltas.length,
        conditions: draft.conditions,
        source: rules.source,
        engine_skipped: rules.engineSkipped ?? null,
        tire_source: tires.source,
      });
      router.replace("/ride/mode" as never);
    } finally {
      setStarting(false);
    }
  };

  return (
    <View style={RideScreenBg({})}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <Eyebrow>{[draft.trackName, conditionsSummary(draft.conditions)].filter(Boolean).join(" · ")}</Eyebrow>
        <RideH1>Set this before moto 1</RideH1>
        <Small style={{ fontSize: 14, marginTop: -4, marginBottom: 6 }}>{thinking ? "Asking the engine…" : rules.summary}</Small>
        {!thinking && rules.reasoning ? (
          <Small style={{ fontSize: 12, color: V3.muted, marginBottom: 12 }}>{rules.source === "engine" ? "Engine: " : "Rules: "}{rules.reasoning}</Small>
        ) : (
          <View style={{ height: 8 }} />
        )}

        {(["Fork", "Shock"] as const).map((group) => {
          const gr = rows.filter((r) => r.group === group);
          return (
            <View key={group}>
              <Label style={{ marginBottom: 6 }}>{group}</Label>
              <RowSet>
                {gr.map((r, i) => {
                  const d = deltaFor(r.key);
                  const cur = base[r.key];
                  const next = d ? previewValue(cur, d.delta, CIRCUIT_STEPS[r.key].decimals) : cur;
                  return (
                    <ValueRow
                      key={r.key}
                      label={r.label}
                      value={fmt(next, r.key)}
                      old={d ? fmt(cur, r.key) : null}
                      unit={r.unit}
                      last={i === gr.length - 1}
                      onPress={d ? () => setReason(d.reason) : undefined}
                    />
                  );
                })}
              </RowSet>
            </View>
          );
        })}

        <RowSet>
          <ValueRow
            label="Tires"
            value={`${typeof tires.front === "number" ? String(tires.front) : "—"} / ${typeof tires.rear === "number" ? String(tires.rear) : "—"}`}
            old={tires.changed ? `${typeof tiresF === "number" ? tiresF : "—"} / ${typeof tiresR === "number" ? tiresR : "—"}` : null}
            unit="psi"
            last
            onPress={tires.reason ? () => setReason(tires.reason) : undefined}
          />
        </RowSet>

        <SayItYourWay
          value={freeText}
          onChangeText={setFreeText}
          placeholder="Anything about today? Say it your way and the engine weighs in."
          onSubmitEditing={() => setAsked((n) => n + 1)}
          style={{ marginTop: 6 }}
        />

        <View style={{ flex: 1 }} />
        <Cta label={starting ? "Starting…" : "Bike's set. Start the clock"} onPress={() => void onStart()} disabled={starting || thinking} />
      </ScrollView>

      <BottomSheet open={!!reason} onClose={() => setReason(null)} title="Why">
        <Sub style={{ marginTop: 0, fontSize: 15, color: V3.white }}>{reason}</Sub>
        <Small style={{ marginTop: 10 }}>{surfaceLabel(primarySurface(draft.conditions)) ?? "Today"} · {rules.source === "engine" ? "the engine, from your words" : "rule base, deterministic"}. One change at a time; re-test after moto 1.</Small>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX, flexGrow: 1 },
});
