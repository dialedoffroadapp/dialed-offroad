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
import React, { useEffect, useMemo, useState } from "react";
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
import { readOpenSession, recordSkipped, rideEffective, setAbsolute, type RideSession } from "../../lib/rideDay";
import { symptomReason } from "../../lib/symptomReasons";
import { forkFamilyFor, shockFamilyFor, shortLocation, type ForkFamily, type ShockFamily } from "../../lib/adjusterLocations";
import { fetchModelSpecs } from "../../lib/modelSpecs";
import { disciplineForBike } from "../../lib/discipline";
import { finishQuickRefine } from "../../lib/rideEnd";
import { isEntitled, resolveEntitlement } from "../../lib/entitlement";
import { showProGate } from "../../lib/proGate";
import { useToast } from "../../components/Toast";
import { symptomLabelFor, type LoggedSymptom, type SymptomLevel } from "../../lib/rideSymptoms";
import { logEvent } from "../../lib/usage";

type Phase = "loading" | "changes" | "manual" | "error";

const fmt = (v: number, k: CircuitKey) => formatSetting(v, k);

export default function RideAdjustScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { symptom, qualifier, moto, sentiment, manual, level, symptoms: symptomsParam } = useLocalSearchParams<{ symptom?: string; qualifier?: string; moto?: string; sentiment?: string; manual?: string; level?: string; symptoms?: string }>();
  const loggedSymptoms = useMemo<LoggedSymptom[]>(() => {
    try {
      const parsed = symptomsParam ? JSON.parse(symptomsParam) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x.id === "string") : [];
    } catch {
      return [];
    }
  }, [symptomsParam]);
  const toast = useToast();
  const [finishing, setFinishing] = useState(false);
  const [s, setS] = useState<RideSession | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [changes, setChanges] = useState<AdjustChange[]>([]);
  const [i, setI] = useState(0);
  const [custom, setCustom] = useState<{ circuit: CircuitKey; value: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freeText, setFreeText] = useState<string>("");
  // The engine's own summary line stays out of the screen (finding 8); it
  // still travels with the change reason into the version notes.
  const [, setReasoning] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  // The adjuster's place on this bike (finding 8): the catalog's fork and
  // shock types, fail-open to the generic families.
  const [families, setFamilies] = useState<{ fork: ForkFamily; shock: ShockFamily } | null>(null);
  const [wordsOpen, setWordsOpen] = useState(false);
  // "Different amount" opens the stepper inline under the values.
  const [inlineStepper, setInlineStepper] = useState(false);
  // Server-counted free refinements left after this call (null = not said).
  const [allowanceRemaining, setAllowanceRemaining] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const open = await readOpenSession();
      if (!open) return router.replace("/(tabs)" as never);
      if (!alive) return;
      setS(open);
      void fetchModelSpecs({ id: open.bike.id, model_id: open.bike.model_id, make: open.bike.make, model: open.bike.model, year: open.bike.year })
        .then((specs) => {
          if (alive) setFamilies({ fork: forkFamilyFor(specs?.fork_type ?? null, open.hasAirFork), shock: shockFamilyFor(specs?.shock_type ?? null) });
        })
        .catch(() => {
          if (alive) setFamilies({ fork: forkFamilyFor(null, open.hasAirFork), shock: shockFamilyFor(null) });
        });
      // The rider's own words: the moto's note on first load, then whatever
      // they type here and re-ask with (feedback.free_text, engine-parsed).
      const lastNote = open.motos[open.motos.length - 1]?.note ?? "";
      if (manual === "1" || (!symptom && !loggedSymptoms.length && !lastNote.trim())) {
        setPhase("manual");
        return;
      }
      try {
        setPhase("loading");
        const text = asked > 0 ? freeText : lastNote;
        if (asked === 0 && lastNote && !freeText) setFreeText(lastNote);
        const res = await fetchAdjustResult(open, (symptom || null) as any, qualifier || null, (sentiment as any) || "worse", rideEffective(open), text, (level === "mild" || level === "bad" ? level : null) as SymptomLevel | null, loggedSymptoms);
        const list = res.changes;
        if (!alive) return;
        setReasoning(res.reasoning);
        setAllowanceRemaining(res.allowanceRemaining);
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
        if (typeof e?.message === "string" && e.message.includes("no_trial")) {
          // The server counted a refinement this device had not seen: the
          // free one is used. The gate names the action; back to the sheet.
          showProGate({ trigger: "refine", bikeId: open.bike.id, onDismiss: () => router.back() });
          setError("Your free refinement is used. Refining again is Pro.");
          setPhase("error");
          return;
        }
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
    void finishQuickRefine(s).then(async (r) => {
      if (r.queued) toast.show("Saved on phone. Syncs when you have bars.", { kind: "info" });
      else if (r.version) toast.show(`Saved as v${r.version.version_number}`, { kind: "success" });
      // A free rider's completed refinement consumed the allowance the server
      // reported; the sheet shows the one line when none is left.
      let freeUsed = false;
      if ((r.version || r.queued) && allowanceRemaining !== null) {
        const entitled = isEntitled(await resolveEntitlement().catch(() => null));
        if (!entitled) {
          freeUsed = allowanceRemaining === 0;
          void logEvent("free_refine_used", { bike_id: s.bike.id, setup_id: s.setupId, remaining: allowanceRemaining });
        }
      }
      router.replace({ pathname: "/setup-sheet", params: { bikeId: s.bike.id, setupId: s.setupId ?? "default", ...(freeUsed ? { freeRefineUsed: "1" } : {}) } } as never);
    });
  };
  const headSymptom = (symptom || loggedSymptoms[0]?.id || null) as LoggedSymptom["id"] | null;
  const headQualifier = qualifier || loggedSymptoms[0]?.qualifier || null;
  const discipline = disciplineForBike(s.bike);
  const forLine = headSymptom ? `For ${symptomLabelFor(headSymptom, discipline).toLowerCase()}${headQualifier ? ` on ${headQualifier.toLowerCase()}` : ""}` : freeText.trim() ? "For what you wrote" : "By hand";

  const confirm = async (c: AdjustChange, value: number, isCustom: boolean) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const next = await setAbsolute(s, c.circuit, value, "adjust", c.reason);
    setS(next);
    void logEvent("adjust_confirmed", { circuit: c.circuit, from: c.from, to: value, engine_delta: c.delta, custom: isCustom, moto: Number(moto ?? 0) });
    setCustom(null);
    setInlineStepper(false);
    if (i + 1 < changes.length) setI(i + 1);
    else finish();
  };

  // Skip records the suggestion as skipped on the session (never applied), so
  // the settle and the version notes leave it out.
  const liveFromOf = (c: AdjustChange) => {
    const cur = rideEffective(s)[c.circuit];
    return typeof cur === "number" ? cur : c.from;
  };
  const skip = async (c: AdjustChange) => {
    const next = await recordSkipped(s, { circuit: c.circuit, delta: c.delta, reason: c.reason });
    setS(next);
    // No new event type (the events CHECK is a frozen superset): the skip
    // rides adjust_confirmed's meta as outcome: "skipped".
    void logEvent("adjust_confirmed", { circuit: c.circuit, from: liveFromOf(c), to: liveFromOf(c), engine_delta: c.delta, custom: false, moto: Number(moto ?? 0), outcome: "skipped" });
    setInlineStepper(false);
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
  // The reason is the symptom table's row for what was logged (never the
  // LLM's wording); the engine's note stands in for a text-only ask.
  const rowReason = symptomReason(headSymptom, headQualifier) ?? c.reason;
  const reason = `${rowReason.replace(/\.?$/, ".")}${nextC ? ` Next: ${nextC.label.toLowerCase()} to match.` : ""}`;
  const eff = rideEffective(s);
  const liveFrom = typeof eff[c.circuit] === "number" ? (eff[c.circuit] as number) : c.from;
  const location = families && c.circuit !== "shock_sag" ? shortLocation(c.circuit, families.fork, families.shock, { make: s.bike.make, year: s.bike.year }) : null;
  const stepperValue = custom?.circuit === c.circuit ? custom.value : c.to;

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
        <Small style={{ fontSize: 14, marginTop: -4, marginBottom: 4 }} testID="adjust-for-line">{forLine}</Small>
        <Small style={{ fontSize: 14, lineHeight: 20, marginBottom: 22, color: V3.steel }} testID="adjust-reason-line">{reason}</Small>

        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <Label style={{ marginBottom: 10 }}>{c.label}</Label>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <Text style={[styles.from, interFont(800)]}>{fmt(liveFrom, c.circuit)}</Text>
            <Ionicons name="arrow-forward" size={24} color={V3.steel} />
            <Text style={[styles.to, interFont(800)]}>{fmt(c.to, c.circuit)}</Text>
          </View>
          <Text style={[styles.dir, interFont(600)]}>
            <Ionicons name="refresh-outline" size={14} color={V3.blue} /> {directionLine({ ...c, delta: (inlineStepper ? stepperValue : c.to) - liveFrom })}
          </Text>
          {location ? (
            <Text style={[styles.loc, interFont(500)]} testID="adjust-location-line">
              <Ionicons name="locate-outline" size={13} color={V3.steel} /> {location}
            </Text>
          ) : null}
        </View>
        {inlineStepper ? (
          <View style={styles.inline} testID="adjust-inline-stepper">
            <DecimalStepper value={stepperValue} onChange={(v) => setCustom({ circuit: c.circuit, value: v })} step={CIRCUIT_STEPS[c.circuit].step} min={CIRCUIT_STEPS[c.circuit].min} max={CIRCUIT_STEPS[c.circuit].max} unit={c.unit} digits={CIRCUIT_STEPS[c.circuit].decimals} />
          </View>
        ) : null}

        <View style={{ flex: 1 }} />
        <Cta huge label="Done, turned it" icon={<Ionicons name="checkmark" size={26} color={V3.carbon} />} onPress={() => void confirm(c, inlineStepper ? stepperValue : c.to, inlineStepper && stepperValue !== c.to)} disabled={inlineStepper && stepperValue === liveFrom} style={{ marginBottom: 10 }} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Ghost label={inlineStepper ? "Engine's amount" : "Different amount"} onPress={() => { setCustom({ circuit: c.circuit, value: c.to }); setInlineStepper((v) => !v); }} />
          <Ghost label="Skip" dim onPress={() => void skip(c)} />
        </View>
        <Pressable onPress={() => setWordsOpen((v) => !v)} accessibilityRole="button" hitSlop={8} style={styles.wordsLink} testID="adjust-words-link">
          <Text style={[styles.wordsLinkText, interFont(500)]}>Add to it in your own words, then ask again.</Text>
        </Pressable>
        {wordsOpen ? (
          <SayItYourWay value={freeText} onChangeText={setFreeText} boxed placeholder="What else did it do?" onSubmitEditing={() => setAsked((n) => n + 1)} note="Return asks the engine again with your words." style={{ marginTop: 6 }} />
        ) : null}
      </ScrollView>
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
  loc: { fontSize: 13, color: V3.steel, marginTop: 8 },
  inline: { backgroundColor: V3.panel, borderRadius: 16, padding: 14, marginBottom: 12 },
  wordsLink: { alignSelf: "center", paddingVertical: 12 },
  wordsLinkText: { fontSize: 13, color: V3.blue },
  manualRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: V3.line, minHeight: 60 },
  manualK: { fontSize: 16, color: "#FFFFFF" },
  manualV: { fontSize: 30, color: "#FFFFFF" },
});
