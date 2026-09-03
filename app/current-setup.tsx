// app/current-setup.tsx
// Offline-first Current Setup screen (ride-day plan 4.2, Phase 1 spine item).
// Renders the running setup from the local cache instantly — NEVER a spinner —
// and refreshes the base from setup_versions in the background when online.
// +/- taps log deltas to the local pending queue (lib/currentSetup.ts);
// syncing pending deltas to a `manual` setup_versions row is a later slice.
//
// Row policy (RIVER-Q 7): common clickers + sag always; shock HSC behind the
// collapsed Advanced row; fork air only when the bike has an air fork
// (verified bike_models.has_air_fork, else the rider's persisted toggle, else
// the running setup's own air value).

import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SettingStepperRow from "../components/SettingStepperRow";
import {
  adjust,
  CIRCUIT_STEPS,
  effectiveSettings,
  loadCachedSetup,
  refreshSetupFromServer,
  resolveShowsAir,
  undoLast,
  type CircuitKey,
  type CurrentSetupState,
} from "../lib/currentSetup";
import { fetchModelSpecs } from "../lib/modelSpecs";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { logEvent } from "../lib/usage";

// Offline-first bike title: cached beside the setup so the header never needs
// the network. (Same dialed_*_v1 key convention as the rest of the app.)
const titleKey = (bikeId: string) => `current_setup_title_v1:${bikeId}`;

const ROWS: { circuit: CircuitKey; label: string; unit: string }[] = [
  { circuit: "fork_comp", label: "Fork comp", unit: "clicks" },
  { circuit: "fork_reb", label: "Fork reb", unit: "clicks" },
  { circuit: "fork_air", label: "Fork air", unit: "bar" },
  { circuit: "shock_lsc", label: "Shock LSC", unit: "clicks" },
  { circuit: "shock_reb", label: "Shock reb", unit: "clicks" },
  { circuit: "shock_sag", label: "Sag", unit: "mm" },
];

export default function CurrentSetupScreen() {
  const { bikeId } = useLocalSearchParams<{ bikeId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: C } = useTheme();

  const [setup, setSetup] = useState<CurrentSetupState | null>(null);
  const [title, setTitle] = useState<string>("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [cacheChecked, setCacheChecked] = useState(false);
  // The live state ref keeps rapid taps ordered without waiting on setState.
  const setupRef = useRef<CurrentSetupState | null>(null);
  const openLogged = useRef(false);

  const applyState = (s: CurrentSetupState | null) => {
    setupRef.current = s;
    setSetup(s);
  };

  const load = useCallback(async () => {
    if (typeof bikeId !== "string" || !bikeId) {
      router.back();
      return;
    }

    // 1. Cache first: values on screen before any network is attempted.
    const cached = await loadCachedSetup(bikeId);
    if (cached) applyState(cached);
    setCacheChecked(true);
    try {
      const t = await AsyncStorage.getItem(titleKey(bikeId));
      if (t) setTitle(t);
    } catch {}

    if (!openLogged.current) {
      openLogged.current = true;
      void logEvent("heard_card_shown", {
        surface: "current_setup_open",
        cached: !!cached,
      });
    }

    // 2. Background refresh — every step is allowed to fail quietly offline.
    void (async () => {
      let hasAirFork = cached?.hasAirFork ?? false;
      try {
        const { data: bike } = await supabase
          .from("bikes")
          .select("make, model, year, nickname, model_id")
          .eq("id", bikeId)
          .maybeSingle();
        if (bike) {
          const t =
            [bike.year, bike.make, bike.model].filter(Boolean).join(" ") ||
            "Bike";
          setTitle(t);
          void AsyncStorage.setItem(titleKey(bikeId), t).catch(() => {});

          // Fork type: verified spec is authoritative; else the rider's
          // persisted air toggle; else fall through to the setup's own value.
          let modelAir: boolean | null = null;
          try {
            const specs = await fetchModelSpecs({
              id: bikeId,
              model_id: bike.model_id,
              make: bike.make,
              model: bike.model,
              year: bike.year,
            });
            if (typeof specs?.has_air_fork === "boolean") {
              modelAir = specs.has_air_fork;
            }
          } catch {}
          if (modelAir === null) {
            try {
              const raw = await AsyncStorage.getItem(
                `bike_specifics_v1_${bikeId}`
              );
              const parsed = raw ? JSON.parse(raw) : null;
              if (typeof parsed?.wantsAirFork === "boolean") {
                modelAir = parsed.wantsAirFork;
              }
            } catch {}
          }
          const base = setupRef.current?.base;
          hasAirFork = resolveShowsAir(
            modelAir,
            base ?? {
              fork_comp: null,
              fork_reb: null,
              fork_air: null,
              shock_lsc: null,
              shock_hsc: null,
              shock_reb: null,
              shock_sag: null,
            }
          );
        }
      } catch {}

      const fresh = await refreshSetupFromServer(bikeId, hasAirFork);
      if (fresh) applyState(fresh);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bikeId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onAdjust = useCallback(
    (circuit: CircuitKey, direction: 1 | -1) => {
      const cur = setupRef.current;
      if (!cur) return;
      void adjust(cur, circuit, direction).then((next) => {
        if (next !== cur) {
          applyState(next);
          void logEvent("heard_card_shown", {
            surface: "current_setup_adjust",
            circuit,
            direction,
          });
        }
      });
    },
    []
  );

  const onUndo = useCallback(() => {
    const cur = setupRef.current;
    if (!cur?.pending.length) return;
    void undoLast(cur).then(applyState);
  }, []);

  const effective = useMemo(
    () => (setup ? effectiveSettings(setup) : null),
    [setup]
  );

  const pendingBy = useMemo(() => {
    const by: Partial<Record<CircuitKey, number>> = {};
    for (const p of setup?.pending ?? []) {
      by[p.circuit] = (by[p.circuit] ?? 0) + p.delta;
    }
    return by;
  }, [setup]);

  const showsAir = setup
    ? resolveShowsAir(setup.hasAirFork ? true : null, setup.base)
    : false;
  const visibleRows = ROWS.filter(
    (r) => r.circuit !== "fork_air" || showsAir
  );
  const pendingCount = setup?.pending.length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
      <View style={{ height: insets.top, backgroundColor: C.BG }} />

      {/* Header */}
      <View style={S.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={S.headerBtn}>
          <Ionicons name="chevron-back-outline" size={24} color={C.TEXT} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={[S.headerTitle, { color: C.TEXT }]} numberOfLines={1}>
            {title || "Current Setup"}
          </Text>
          <Text style={[S.headerSub, { color: C.MUTED }]} numberOfLines={1}>
            {setup?.baseVersionNumber
              ? `Running v${setup.baseVersionNumber}` +
                (pendingCount
                  ? ` · ${pendingCount} unsynced change${pendingCount === 1 ? "" : "s"}`
                  : "")
              : "Current Setup"}
          </Text>
        </View>
        <View style={S.headerBtn} />
      </View>

      {setup && effective ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
        >
          {visibleRows.map((r) => (
            <SettingStepperRow
              key={r.circuit}
              label={r.label}
              unit={r.unit}
              value={effective[r.circuit]}
              decimals={CIRCUIT_STEPS[r.circuit].decimals}
              pendingDelta={pendingBy[r.circuit] ?? 0}
              onAdjust={(d) => onAdjust(r.circuit, d)}
            />
          ))}

          {/* Advanced: collapsed row holding shock HSC */}
          <Pressable
            onPress={() => setAdvancedOpen((v) => !v)}
            style={[S.advancedRow, { borderColor: C.BORDER }]}
            accessibilityRole="button"
          >
            <Text style={[S.advancedLabel, { color: C.MUTED }]}>ADVANCED</Text>
            <Ionicons
              name={advancedOpen ? "chevron-up" : "chevron-down"}
              size={16}
              color={C.MUTED}
            />
          </Pressable>
          {advancedOpen ? (
            <SettingStepperRow
              label="Shock HSC"
              unit="turns"
              value={effective.shock_hsc}
              decimals={CIRCUIT_STEPS.shock_hsc.decimals}
              pendingDelta={pendingBy.shock_hsc ?? 0}
              onAdjust={(d) => onAdjust("shock_hsc", d)}
            />
          ) : null}

          {pendingCount > 0 ? (
            <Pressable
              onPress={onUndo}
              style={[S.undoBtn, { borderColor: C.BORDER, backgroundColor: C.CARD }]}
              accessibilityRole="button"
            >
              <Ionicons name="arrow-undo-outline" size={16} color={C.TEXT} />
              <Text style={[S.undoText, { color: C.TEXT }]}>Undo last</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : cacheChecked ? (
        // Nothing cached and nothing fetched (yet): honest empty state, still
        // no spinner. First tune creates the version this screen runs on.
        <View style={S.centerFill}>
          <Text style={[S.emptyTitle, { color: C.TEXT }]}>No setup yet</Text>
          <Text style={[S.emptyBody, { color: C.MUTED }]}>
            Generate a tune for this bike and it will live here, readable with
            no signal.
          </Text>
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/(tabs)/tune",
                params: { bikeId: String(bikeId) },
              } as any)
            }
            style={[S.emptyCta, { backgroundColor: C.ACCENT }]}
          >
            <Text style={S.emptyCtaText}>Generate a tune</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const S = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontWeight: "800" },
  headerSub: { fontSize: 12, fontWeight: "600", marginTop: 1 },
  advancedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  advancedLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 1.2 },
  undoBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 20,
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  undoText: { fontSize: 15, fontWeight: "700" },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle: { fontSize: 20, fontWeight: "900" },
  emptyBody: { fontSize: 14, textAlign: "center", marginTop: 8, lineHeight: 20 },
  emptyCta: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 },
  emptyCtaText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
