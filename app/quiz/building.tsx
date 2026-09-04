// app/quiz/building.tsx — the drumroll. Runs the real generation
// (lib/quizGenerate.ts) while a staged ~3 s reveal solves each circuit onto
// its REAL value: the clicker cycles until the engine answers, then snaps
// circuit by circuit with a haptic tick. Six checklist lines, each true for
// this bike (real spec/weight/terrain/skill facts, honest generic copy when a
// fact is unknown). Then the results_locked step + the account gate.
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { displayFont, Q } from "../../components/quiz/quizTheme";
import { useOnboarding } from "../../lib/onboarding";
import { paywallHref } from "../../lib/paywall";
import { useQuiz } from "../../lib/quizContext";
import { generateQuizTune, QuizGenerateError, type QuizGenerateResult } from "../../lib/quizGenerate";
import {
  bikeDisplayName,
  DRUMROLL_CIRCUITS,
  DRUMROLL_STAGE_MS,
  drumrollChecklist,
  formatTuneValue,
  terrainLabel,
  tuneRowValue,
} from "../../lib/quizOnboarding";

const CYCLE_MS = 55;
const SETTLE_MS = 450;

export default function QuizBuildingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { answers } = useQuiz();
  const { onboardingActive, state, setStep } = useOnboarding();

  const [result, setResult] = useState<QuizGenerateResult | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [stage, setStage] = useState(0); // circuits solved so far (0..6)
  const [cycling, setCycling] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const startedRef = useRef<number>(-1);
  const navigatedRef = useRef(false);

  const bikeName = bikeDisplayName(answers) || "Your bike";
  const terrain = answers.terrainMain
    ? terrainLabel(answers.discipline ?? "mx", answers.terrainMain)
    : null;
  const checklist = useMemo(
    () =>
      drumrollChecklist({
        forkType: result?.specs?.fork_type ?? null,
        shockType: result?.specs?.shock_type ?? null,
        weightLbs: answers.weightLbs ?? null,
        terrainLabel: terrain,
        skill: answers.skill ?? null,
      }),
    [result?.specs?.fork_type, result?.specs?.shock_type, answers.weightLbs, terrain, answers.skill]
  );

  // Generation — once per attempt.
  useEffect(() => {
    if (startedRef.current === attempt) return;
    startedRef.current = attempt;
    setError(null);
    setResult(null);
    setStage(0);
    let cancelled = false;
    (async () => {
      try {
        const r = await generateQuizTune({
          answers,
          onboardingStep: state.onboardingStep,
          onboardingActive,
          lastUpdatedAt: state.lastUpdatedAt,
        });
        if (!cancelled) setResult(r);
      } catch (e: any) {
        if (cancelled) return;
        const code = e instanceof QuizGenerateError ? e.code : "generate_failed";
        setError({ code, message: e?.message ?? "Couldn't build your tune. Try again." });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Cycling clicker for the circuit currently being solved.
  const current = DRUMROLL_CIRCUITS[Math.min(stage, DRUMROLL_CIRCUITS.length - 1)];
  useEffect(() => {
    if (error || stage >= DRUMROLL_CIRCUITS.length) return;
    const id = setInterval(() => {
      setCycling(Math.floor(Math.random() * (current.cycleMax + 1)));
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [current.cycleMax, error, stage]);

  // Staged snaps once the result is in: one circuit per DRUMROLL_STAGE_MS.
  useEffect(() => {
    if (!result || error) return;
    if (stage >= DRUMROLL_CIRCUITS.length) return;
    const t = setTimeout(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setStage((s) => s + 1);
    }, stage === 0 ? 250 : DRUMROLL_STAGE_MS);
    return () => clearTimeout(t);
  }, [result, error, stage]);

  // Done → results_locked (the state machine's own step) → account gate.
  useEffect(() => {
    if (!result || stage < DRUMROLL_CIRCUITS.length || navigatedRef.current) return;
    navigatedRef.current = true;
    const t = setTimeout(async () => {
      try {
        if (onboardingActive) await setStep("results_locked");
      } catch (e) {
        console.warn("[quiz] setStep(results_locked) failed", e);
      }
      router.replace("/quiz/gate" as never);
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [result, stage, onboardingActive, setStep, router]);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming((stage / DRUMROLL_CIRCUITS.length) * 100, { duration: 300 });
  }, [stage, progress]);
  const barStyle = useAnimatedStyle(() => ({ width: `${progress.value}%` }));

  const solvedValue = (i: number) =>
    result ? formatTuneValue(tuneRowValue(result.tune, DRUMROLL_CIRCUITS[i].key), DRUMROLL_CIRCUITS[i].key === "shock_hsc" ? "turns" : DRUMROLL_CIRCUITS[i].key === "shock_sag" ? "mm" : "clicks") : "—";
  const displayNumber =
    stage >= DRUMROLL_CIRCUITS.length ? solvedValue(DRUMROLL_CIRCUITS.length - 1) : String(cycling);
  const pct = Math.round((Math.min(stage, 6) / 6) * 100);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20 }]}>
      <Text style={[styles.eyebrow, displayFont("bold")]} numberOfLines={1}>
        {bikeName.toUpperCase()}
      </Text>

      {error ? (
        <Animated.View entering={FadeIn.duration(160)} style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={22} color={Q.TEXT} />
          <Text style={[styles.errorTitle, displayFont("bold")]}>
            {error.code === "no_trial" ? "Free tune already used" : "Couldn't build it"}
          </Text>
          <Text style={styles.errorText}>{error.message}</Text>
          {error.code === "no_trial" ? (
            <Pressable
              onPress={() => router.replace(paywallHref("second_tune", "back") as never)}
              style={styles.cta}
              accessibilityRole="button"
            >
              <Text style={[styles.ctaText, displayFont("bold")]}>Go Pro</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => {
                navigatedRef.current = false;
                setAttempt((a) => a + 1);
              }}
              style={styles.cta}
              accessibilityRole="button"
            >
              <Text style={[styles.ctaText, displayFont("bold")]}>Try again</Text>
            </Pressable>
          )}
          <Pressable onPress={() => router.back()} style={styles.linkBtn} accessibilityRole="button">
            <Text style={styles.linkText}>Back</Text>
          </Pressable>
        </Animated.View>
      ) : (
        <>
          <View style={styles.centerCard}>
            <Text style={[styles.solving, displayFont("bold")]}>
              {stage >= DRUMROLL_CIRCUITS.length ? "SOLVED" : "SOLVING"} · {current.title}
            </Text>
            <Text style={[styles.clicker, displayFont("blackItalic")]}>{displayNumber}</Text>
            <View style={styles.solvedRow}>
              {DRUMROLL_CIRCUITS.map((c, i) => (
                <View key={c.key} style={[styles.pip, i < stage && styles.pipDone]} />
              ))}
            </View>
          </View>

          <View style={styles.list}>
            {checklist.map((line, i) => {
              const done = i < stage;
              const active = i === stage && !!result;
              return (
                <View key={i} style={styles.line}>
                  {done ? (
                    <View style={styles.lineDone}>
                      <Ionicons name="checkmark" size={13} color={Q.INK} />
                    </View>
                  ) : (
                    <View style={[styles.lineOpen, active && styles.lineActive]} />
                  )}
                  <Text style={[styles.lineText, done && styles.lineTextDone]}>{line}</Text>
                </View>
              );
            })}
          </View>

          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <Text style={[styles.footerText, displayFont("bold")]}>
                TUNE {Math.min(stage + (result ? 1 : 0), 6)} OF 6 SETTINGS
              </Text>
              <Text style={[styles.footerText, displayFont("bold")]}>{pct}%</Text>
            </View>
            <View style={styles.bar}>
              <Animated.View style={[styles.barFill, barStyle]} />
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Q.BG, paddingHorizontal: 20 },
  eyebrow: { color: Q.STEEL, fontSize: 14, letterSpacing: 1, textAlign: "center" },
  centerCard: {
    marginTop: 28,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Q.BORDER,
    backgroundColor: Q.PANEL,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  solving: { color: Q.STEEL, fontSize: 14, letterSpacing: 1.2 },
  clicker: { color: Q.BLUE, fontSize: 132, lineHeight: 136, marginTop: 8, fontVariant: ["tabular-nums"] },
  solvedRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  pip: { width: 24, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.12)" },
  pipDone: { backgroundColor: Q.BLUE },
  list: { marginTop: 26, gap: 12 },
  line: { flexDirection: "row", alignItems: "center", gap: 12 },
  lineDone: { width: 20, height: 20, borderRadius: 10, backgroundColor: Q.BLUE, alignItems: "center", justifyContent: "center" },
  lineOpen: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: Q.STEEL, marginHorizontal: 2 },
  lineActive: { borderColor: Q.BLUE },
  lineText: { flex: 1, color: Q.STEEL, fontSize: 15, lineHeight: 20 },
  lineTextDone: { color: Q.TEXT },
  footer: { marginTop: "auto" },
  footerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  footerText: { color: Q.STEEL, fontSize: 13, letterSpacing: 0.8 },
  bar: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: Q.BLUE },
  errorCard: {
    marginTop: 40,
    padding: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Q.BORDER,
    backgroundColor: Q.PANEL,
    alignItems: "center",
    gap: 10,
  },
  errorTitle: { color: Q.TEXT, fontSize: 22, letterSpacing: 0.3, textTransform: "uppercase" },
  errorText: { color: Q.STEEL, fontSize: 15, lineHeight: 21, textAlign: "center" },
  cta: { marginTop: 8, alignSelf: "stretch", height: 52, borderRadius: 14, backgroundColor: Q.BLUE, alignItems: "center", justifyContent: "center" },
  ctaText: { color: Q.INK, fontSize: 18, letterSpacing: 0.4, textTransform: "uppercase" },
  linkBtn: { paddingVertical: 10 },
  linkText: { color: Q.STEEL, fontSize: 15 },
});
