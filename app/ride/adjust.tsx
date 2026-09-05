// app/ride/adjust.tsx — Adjust (design/mockups/ride/09, OUTDOOR). One change
// per screen with progress dots; old → new, the physical direction, a reason
// that references the previous change. "Done, turned it" is the only thing
// that saves and records the new ABSOLUTE value. "Different amount" opens a
// stepper for that adjuster only. "Skip" moves on. Change sets come from the
// engine (lib/rideAdjust.ts); ?manual=1 (or no signal) is the stepper list.
// On a quick refine (session.quick) Done settles ONE version on the refined
// setup and returns to its sheet instead of ride mode.
import { formatSetting } from "../../lib/format";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DecimalStepper } from "../../components/garage/GarageSheets";
import { BottomSheet } from "../../components/v3/BottomSheet";
import { Eyebrow, Label, Small } from "../../components/v3/primitives";
import { interFont, V3 } from "../../components/v3/theme";
import { Cta, Ghost, RideH1, RideScreenBg } from "../../components/ride/ridePrimitives";
import { CIRCUIT_STEPS, type CircuitKey } from "../../lib/currentSetup";
import { CIRCUIT_LABELS, directionLine, fetchAdjustResult, type AdjustChange } from "../../lib/rideAdjust";
import { SayItYourWay } from "../../components/ride/SayItYourWay";
import { readOpenSession, rideEffective, setAbsolute, type RideSession } from "../../lib/rideDay";
import { finishQuickRefine } from "../../lib/rideEnd";
import { useToast } from "../../components/Toast";
import { qualifierLabel, symptomById, type SymptomLevel } from "../../lib/rideSymptoms";
import { logEvent } from "../../lib/usage";

type Phase = "loading" | "changes" | "manual" | "error";

const fmt = (v: number, k: CircuitKey) => formatSetting(v, k);

export default function RideAdjustScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { symptom, qualifier, moto, sentiment, manual, level } = useLocalSearchParams<{ symptom?: string; qualifier?: string; moto?: string; sentiment?: string; manual?: string; level?: string }>();
  const toast = useToast();
  const [finishing, setFinishing] = useState(false);
  const [s, setS] = useState<RideSession | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [changes, setChanges] = useState<AdjustChange[]>([]);
  const [i, setI] = useState(0);
  const [custom, setCustom] = useState<{ circuit: CircuitKey; value: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freeText, setFreeText] = useState<string>("");
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const open = await readOpenSession();
      if (!open) return router.replace("/(tabs)" as never);
      if (!alive) return;
      setS(open);
      if (manual === "1" || !symptom) {
        setPhase("manual");
        return;
      }
      try {
        setPhase("loading");
        // The rider's own words: the moto's note on first load, then whatever
        // they type here and re-ask with (feedback.free_text, engine-parsed).
        const lastNote = open.motos[open.motos.length - 1]?.note ?? "";
        const text = asked > 0 ? freeText : lastNote;
        if (asked === 0 && lastNote && !freeText) setFreeText(lastNote);
        const res = await fetchAdjustResult(open, symptom as any, qualifier || null, (sentiment as any) || "worse", rideEffective(open), text, (level === "mild" || level === "bad" ? level : null) as SymptomLevel | null);
        const list = res.changes;
        if (!alive) return;
        setReasoning(res.reasoning);
        void logEvent("adjust_shown", { moto: Number(moto ?? 0), changes: list.length, symptom_id: symptom, qualifier: qualifier || null, circuits: list.map((c) => c.circuit), source: res.source, has_free_text: !!text });
        if (list.length === 0) {
          setError("The engine would leave it where it is for that one. Ride it again, or adjust by hand.");
          setPhase("error");
        } else {
          setChanges(list);
          setPhase("changes");
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message?.includes("Sign in") ? "Sign in to get suggestions." : "Suggestions need signal. Adjust by hand, or try again when you have bars.");
        setPhase("error");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, symptom, qualifier, sentiment, moto, manual, asked]);

  if (!s || phase === "loading") {
    return (
      <View style={[RideScreenBg({ out: true }), styles.center]}>
        <ActivityIndicator color={V3.steel} />
        <Small style={{ marginTop: 12 }}>Asking the engine…</Small>
      </View>
    );
  }

  const finish = () => {
    if (!s.quick) return router.replace("/ride/mode" as never);
    if (finishing) return;
    setFinishing(true);
    void finishQuickRefine(s).then((r) => {
      if (r.queued) toast.show("Saved on phone. Syncs when you have bars.", { kind: "info" });
      else if (r.version) toast.show(`Saved as v${r.version.version_number}`, { kind: "success" });
      router.replace({ pathname: "/setup-sheet", params: { bikeId: s.bike.id, setupId: s.setupId ?? "default" } } as never);
    });
  };
  const chip = symptom ? symptomById(symptom) : null;
  const forLine = chip ? `For ${chip.label.toLowerCase()}${qualifier ? ` on ${(qualifierLabel(qualifier) ?? qualifier).toLowerCase()}` : ""}` : "By hand";

  const confirm = async (c: AdjustChange, value: number, isCustom: boolean) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const next = await setAbsolute(s, c.circuit, value, "adjust", c.reason);
    setS(next);
    void logEvent("adjust_confirmed", { circuit: c.circuit, from: c.from, to: value, engine_delta: c.delta, custom: isCustom, moto: Number(moto ?? 0) });
    setCustom(null);
    if (i + 1 < changes.length) setI(i + 1);
    else finish();
  };

  if (phase === "manual" || phase === "error") {
    const eff = rideEffective(s);
    const keys = (Object.keys(CIRCUIT_STEPS) as CircuitKey[]).filter((k) => typeof eff[k] === "number" && (k !== "fork_air" || s.hasAirFork) && k !== "shock_sag");
    return (
      <View style={RideScreenBg({ out: true })}>
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }]} showsVerticalScrollIndicator={false}>
          <View style={styles.top}>
            <Pressable onPress={finish} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={20} color={V3.steel} />
            </Pressable>
            <Eyebrow style={{ marginBottom: 0 }}>Adjust</Eyebrow>
          </View>
          <RideH1 out>By hand</RideH1>
          {error ? <Small style={{ fontSize: 14, marginBottom: 14 }}>{error}</Small> : <Small style={{ fontSize: 14, marginBottom: 14 }}>{s.quick ? "Tap what you turned. Saved as one new version when you tap Done." : "Tap what you turned. Saved as you go; settled into one version at End ride."}</Small>}
          {keys.map((k) => (
            <Pressable key={k} onPress={() => setCustom({ circuit: k, value: eff[k] as number })} accessibilityRole="button" style={styles.manualRow}>
              <Text style={[styles.manualK, interFont(400)]}>{CIRCUIT_LABELS[k]}</Text>
              <Text style={[styles.manualV, interFont(800)]}>{fmt(eff[k] as number, k)}</Text>
            </Pressable>
          ))}
          <View style={{ flex: 1 }} />
          <Cta label={s.quick ? "Done" : "Back to riding"} onPress={finish} />
        </ScrollView>
        {custom ? (
          <BottomSheet open onClose={() => setCustom(null)} title={CIRCUIT_LABELS[custom.circuit]}>
            <DecimalStepper value={custom.value} onChange={(v) => setCustom({ ...custom, value: v })} step={CIRCUIT_STEPS[custom.circuit].step} min={CIRCUIT_STEPS[custom.circuit].min} max={CIRCUIT_STEPS[custom.circuit].max} unit={custom.circuit === "fork_air" ? "bar" : custom.circuit === "shock_hsc" ? "turns" : "clicks"} digits={CIRCUIT_STEPS[custom.circuit].decimals} />
            <Cta label="Done, turned it" style={{ marginTop: 18, padding: 18 }} onPress={() => void confirm({ circuit: custom.circuit, label: CIRCUIT_LABELS[custom.circuit], from: eff[custom.circuit] as number, to: custom.value, delta: custom.value - (eff[custom.circuit] as number), unit: "clicks", reason: "Set by hand" }, custom.value, true)} disabled={custom.value === eff[custom.circuit]} />
          </BottomSheet>
        ) : null}
      </View>
    );
  }

  const c = changes[i];
  const nextC = changes[i + 1];
  const reason = `${c.reason.replace(/\.?$/, ".")}${nextC ? ` Next: ${nextC.label.toLowerCase()} to match.` : ""}`;
  const eff = rideEffective(s);
  const liveFrom = typeof eff[c.circuit] === "number" ? (eff[c.circuit] as number) : c.from;

  return (
    <View style={RideScreenBg({ out: true })}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 24 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.top, { justifyContent: "space-between" }]}>
          <Eyebrow style={{ marginBottom: 0 }}>Adjust</Eyebrow>
          <View style={{ flexDirection: "row", gap: 5 }}>
            {changes.map((_, k) => (
              <View key={k} style={[styles.dot, k === i ? { backgroundColor: V3.blue } : k < i ? { backgroundColor: V3.steel } : null]} />
            ))}
          </View>
        </View>
        <RideH1 out>Change {i + 1} of {changes.length}</RideH1>
        <Small style={{ fontSize: 14, marginTop: -4, marginBottom: 30 }}>{forLine}</Small>

        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <Label style={{ marginBottom: 10 }}>{c.label}</Label>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <Text style={[styles.from, interFont(800)]}>{fmt(liveFrom, c.circuit)}</Text>
            <Ionicons name="arrow-forward" size={24} color={V3.steel} />
            <Text style={[styles.to, interFont(800)]}>{fmt(c.to, c.circuit)}</Text>
          </View>
          <Text style={[styles.dir, interFont(600)]}>
            <Ionicons name="refresh-outline" size={14} color={V3.blue} /> {directionLine({ ...c, delta: c.to - liveFrom })}
          </Text>
        </View>
        <Small style={{ textAlign: "center", lineHeight: 21, fontSize: 14, paddingHorizontal: 8 }}>{reason}</Small>
        {reasoning && reasoning !== c.reason ? (
          <Small style={{ textAlign: "center", lineHeight: 19, fontSize: 12, paddingHorizontal: 8, marginTop: 8, color: V3.muted }}>Engine: {reasoning}</Small>
        ) : null}
        <SayItYourWay
          value={freeText}
          onChangeText={setFreeText}
          placeholder="Add to it in your own words, then ask again."
          onSubmitEditing={() => setAsked((n) => n + 1)}
          style={{ marginTop: 12 }}
        />

        <View style={{ flex: 1 }} />
        <Cta huge label="Done, turned it" icon={<Ionicons name="checkmark" size={26} color={V3.carbon} />} onPress={() => void confirm(c, c.to, false)} style={{ marginBottom: 10 }} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Ghost label="Different amount" onPress={() => setCustom({ circuit: c.circuit, value: c.to })} />
          <Ghost label="Skip" dim onPress={() => (i + 1 < changes.length ? setI(i + 1) : finish())} />
        </View>
      </ScrollView>
      {custom ? (
        <BottomSheet open onClose={() => setCustom(null)} title={c.label}>
          <DecimalStepper value={custom.value} onChange={(v) => setCustom({ ...custom, value: v })} step={CIRCUIT_STEPS[c.circuit].step} min={CIRCUIT_STEPS[c.circuit].min} max={CIRCUIT_STEPS[c.circuit].max} unit={c.unit} digits={CIRCUIT_STEPS[c.circuit].decimals} />
          <Cta label="Done, turned it" style={{ marginTop: 18, padding: 18 }} onPress={() => void confirm(c, custom.value, true)} disabled={custom.value === liveFrom} />
        </BottomSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: V3.screenPadX, flexGrow: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: V3.line },
  from: { fontSize: 48, color: V3.muted, lineHeight: 50 },
  to: { fontSize: 72, color: "#FFFFFF", lineHeight: 74 },
  dir: { fontSize: 15, color: V3.blue, marginTop: 12 },
  manualRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: V3.line, minHeight: 60 },
  manualK: { fontSize: 16, color: "#FFFFFF" },
  manualV: { fontSize: 30, color: "#FFFFFF" },
});
