// app/ride/retune.tsx — Mid-day retune (design/mockups/ride/07, OUTDOOR).
// Four tiles; "New track" routes back through the track picker in session
// mode; the others re-run the deterministic rule base against the CURRENT
// effective values and show old → new with a one-line reason. "Set it, back
// to riding" applies pending deltas (still one settled version at End ride).
import { formatSetting } from "../../lib/format";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Eyebrow, Label, Small } from "../../components/v3/primitives";
import { V3 } from "../../components/v3/theme";
import { ChoiceChip, Cta, Grid, Hint, RideH1, RideScreenBg, ValueRow } from "../../components/ride/ridePrimitives";
import { readBikeExtras, saveBikeExtras, type BikeExtras } from "../../lib/bikeExtras";
import { previewValue, RETUNE_TILES, type RetuneTile } from "../../lib/conditionsRules";
import { suggestForConditions, type SuggestResult } from "../../lib/rideEngine";
import { SayItYourWay } from "../../components/ride/SayItYourWay";
import { CIRCUIT_STEPS, type CircuitKey } from "../../lib/currentSetup";
import { conditionsSummary } from "../../lib/rideConditions";
import { applyDeltas, readOpenSession, rideEffective, type RideSession } from "../../lib/rideDay";
import { logEvent } from "../../lib/usage";

const LABEL: Record<CircuitKey, string> = { fork_comp: "Fork comp", fork_reb: "Fork reb", fork_air: "Fork air", shock_lsc: "Shock LSC", shock_hsc: "Shock HSC", shock_reb: "Shock reb", shock_sag: "Sag" };
const fmt = (v: number | null, k: CircuitKey) => formatSetting(v, k);

export default function RideRetuneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<RideSession | null>(null);
  const [extras, setExtras] = useState<BikeExtras | null>(null);
  const { tile: tileParam } = useLocalSearchParams<{ tile?: string }>();
  const [tile, setTile] = useState<RetuneTile | null>(tileParam === "new_track" ? "new_track" : null);
  const [freeText, setFreeText] = useState("");
  const [asked, setAsked] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<SuggestResult | null>(null);

  useEffect(() => {
    (async () => {
      const open = await readOpenSession();
      if (!open) return router.replace("/(tabs)" as never);
      setS(open);
      setExtras(await readBikeExtras(open.bike.id));
    })();
  }, [router]);

  const eff = useMemo(() => (s ? rideEffective(s) : null), [s]);
  useEffect(() => {
    if (!s || !eff || !tile) {
      setResult(null);
      return;
    }
    let alive = true;
    setThinking(true);
    void suggestForConditions({
      bike: s.bike,
      hasAirFork: s.hasAirFork,
      trackName: s.trackName ?? null,
      conditions: s.conditions,
      effective: eff,
      setupName: s.setupName,
      setupId: s.setupId ?? null,
      freeText,
      tile: tile === "new_track" ? null : tile,
      priorTweaks: s.pending.filter((p) => p.kind === "conditions").map((p) => ({ circuit: p.circuit, delta: p.delta })),
    }).then((r) => {
      if (!alive) return;
      setResult(r);
      setThinking(false);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, eff, tile, asked]);

  if (!s || !eff || !extras) {
    return (
      <View style={[RideScreenBg({ out: true }), styles.center]}>
        <ActivityIndicator color={V3.steel} />
      </View>
    );
  }

  const pickTile = (t: RetuneTile) => {
    if (t === "new_track") {
      router.push({ pathname: "/ride/track", params: { mode: "session" } } as never);
      return;
    }
    setTile(t);
  };

  const apply = async () => {
    if (!result) return;
    let next = s;
    if (result.deltas.length) next = await applyDeltas(s, result.deltas, "retune");
    if (result.tirePsiDelta && (typeof extras.tireFrontPsi === "number" || typeof extras.tireRearPsi === "number")) {
      await saveBikeExtras(s.bike.id, {
        tireFrontPsi: typeof extras.tireFrontPsi === "number" ? extras.tireFrontPsi + result.tirePsiDelta : extras.tireFrontPsi,
        tireRearPsi: typeof extras.tireRearPsi === "number" ? extras.tireRearPsi + result.tirePsiDelta : extras.tireRearPsi,
      });
    }
    void logEvent("retune_applied", { reason: tile, changes: result.deltas.length + (result.tirePsiDelta ? 1 : 0), after_moto: s.motos.length, source: result.source, engine_skipped: result.engineSkipped ?? null, has_free_text: !!freeText.trim() });
    setS(next);
    router.back();
  };

  const nothing = result && result.deltas.length === 0 && !result.tirePsiDelta;

  return (
    <View style={RideScreenBg({ out: true })}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={20} color={V3.steel} />
          </Pressable>
          <Eyebrow style={{ marginBottom: 0 }}>Mid-day retune</Eyebrow>
        </View>
        <RideH1 out>What changed?</RideH1>
        <Small style={{ fontSize: 14, marginTop: -4, marginBottom: 14 }}>Tap what&apos;s different since moto {Math.max(1, s.motos.length)}. We&apos;ll re-tune for it.</Small>

        <Grid cols={2} style={{ marginBottom: 14 }}>
          {RETUNE_TILES.map((t) => (
            <ChoiceChip
              key={t.id}
              out
              label={t.label}
              on={tile === t.id}
              onPress={() => pickTile(t.id)}
              icon={<Ionicons name={t.icon as any} size={22} color={tile === t.id ? V3.carbon : V3.blue} />}
              style={{ paddingVertical: 20 }}
            />
          ))}
        </Grid>

        {result ? (
          <View style={styles.callout}>
            <Label style={{ color: V3.blue, marginBottom: 6 }}>{nothing ? "Nothing to change" : result.summary || `Retuned for ${conditionsSummary(s.conditions)}`}</Label>
            {result.deltas.map((d) => (
              <ValueRow key={d.circuit} out small label={LABEL[d.circuit]} value={fmt(previewValue(eff[d.circuit], d.delta, CIRCUIT_STEPS[d.circuit].decimals), d.circuit)} old={fmt(eff[d.circuit], d.circuit)} last />
            ))}
            {result.tirePsiDelta && typeof extras.tireFrontPsi === "number" ? (
              <ValueRow out small label="Tires" value={String(extras.tireFrontPsi + result.tirePsiDelta)} old={String(extras.tireFrontPsi)} unit="psi" last />
            ) : null}
            {nothing ? <Small style={{ marginTop: 4 }}>Your numbers already fit that. Ride it.</Small> : null}
          </View>
        ) : null}
        {thinking ? <Hint>Asking the engine…</Hint> : null}
        {!thinking && result?.reasoning && !nothing ? <Hint>{result.source === "engine" ? "Engine: " : ""}{result.reasoning}</Hint> : null}
        {tile ? (
          <SayItYourWay
            value={freeText}
            onChangeText={setFreeText}
            placeholder="What changed, in your words? The engine weighs in."
            onSubmitEditing={() => setAsked((n) => n + 1)}
            style={{ marginTop: 6 }}
          />
        ) : null}

        <View style={{ flex: 1 }} />
        <Cta label="Set it, back to riding" dim={!result || !!nothing || thinking} onPress={() => void apply()} />
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ alignItems: "center", paddingVertical: 12 }}>
          <Small>Keep what I&apos;ve got</Small>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX, flexGrow: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  callout: { backgroundColor: V3.panel, borderRadius: 16, padding: 16, marginBottom: 6, borderLeftWidth: 3, borderLeftColor: V3.blue },
});
