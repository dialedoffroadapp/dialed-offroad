// app/quiz/weight.tsx — Q5, weight (+ the optional free text). "Build my
// tune" shows the same Assumption-of-Risk sheet the Tune tab shows before
// its first generation (legal parity), then hands off to the drumroll.
import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { QuizShell } from "../../components/quiz/QuizShell";
import { displayFont, Q } from "../../components/quiz/quizTheme";
import { WeightDial, type WeightUnit } from "../../components/quiz/WeightDial";
import { RiskGate } from "../../components/RiskGate";
import { useQuiz, useQuizStepView } from "../../lib/quizContext";
import { logQuizEvent, WEIGHT_DEFAULT_LBS, nextQuizRoute } from "../../lib/quizOnboarding";
import { supabase } from "../../lib/supabase";
import { prewarmTuneLocation } from "../../lib/tuneLocation";

// Same key + version as app/(tabs)/tune.tsx so a consent given here is
// honored there (and vice versa). Bump both together.
const RISK_VER = "2025-10-05";
const riskKeyForUser = (uid: string) => `riskConsent:${uid}`;

export default function QuizWeightScreen() {
  const router = useRouter();
  const { answers, setAnswers } = useQuiz();
  useQuizStepView("weight");

  const [weightLbs, setWeightLbs] = useState<number>(answers.weightLbs ?? WEIGHT_DEFAULT_LBS);
  const [unit, setUnit] = useState<WeightUnit>(answers.weightUnit ?? "lbs");
  const [freeOpen, setFreeOpen] = useState(!!answers.freeText);
  const [freeText, setFreeText] = useState(answers.freeText ?? "");
  const [riskOpen, setRiskOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const expandedLoggedRef = useRef(!!answers.freeText);

  // Coarse tune-time location (v2.4.0): prewarm like the input screens do;
  // generateTune reads it (3 s cap) and asks permission once, ever.
  useEffect(() => {
    prewarmTuneLocation();
  }, []);

  const persist = (patch: Parameters<typeof setAnswers>[0]) => void setAnswers(patch);

  const openFreeText = () => {
    setFreeOpen(true);
    void Haptics.selectionAsync().catch(() => {});
    if (!expandedLoggedRef.current) {
      expandedLoggedRef.current = true;
      void logQuizEvent("quiz_freetext_expanded", {});
    }
  };

  const proceed = async () => {
    setBuilding(true);
    const text = freeText.trim();
    await setAnswers({ weightLbs, weightUnit: unit, freeText: text || undefined });
    await logQuizEvent("quiz_step_answered", {
      step: "weight",
      answer: { weight_lbs: weightLbs, unit, free_text: text.length > 0 },
    });
    if (text.length > 0) void logQuizEvent("quiz_freetext_filled", { len: text.length });
    router.push(nextQuizRoute("weight", answers) as never);
    setTimeout(() => setBuilding(false), 800);
  };

  const onBuild = async () => {
    if (building) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // Signed-in riders who already accepted on the Tune tab skip the sheet.
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (uid) {
        const raw = await AsyncStorage.getItem(riskKeyForUser(uid));
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.version === RISK_VER && parsed?.acceptedAt) {
          await proceed();
          return;
        }
      }
    } catch {
      // fall through to the sheet
    }
    if (answers.riskAcceptedAt) {
      await proceed();
      return;
    }
    setRiskOpen(true);
  };

  const onRiskAccept = async () => {
    setRiskOpen(false);
    const acceptedAt = new Date().toISOString();
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user?.id) {
        await AsyncStorage.setItem(
          riskKeyForUser(auth.user.id),
          JSON.stringify({ version: RISK_VER, acceptedAt })
        );
      }
    } catch (e) {
      console.warn("[quiz] risk consent save failed", e);
    }
    await setAnswers({ riskAcceptedAt: acceptedAt });
    await proceed();
  };

  return (
    <>
      <QuizShell
        step="weight"
        title="How much do you weigh, geared up?"
        subtitle="Boots, helmet, pack, all of it. Add ~15 lbs if you're guessing."
        showBack
        ghostNext={false}
        footerSlot={
          <Pressable
            onPress={onBuild}
            disabled={building}
            accessibilityRole="button"
            style={[styles.cta, building && styles.ctaDisabled]}
          >
            <Text style={[styles.ctaText, displayFont("bold")]}>Build my tune</Text>
          </Pressable>
        }
      >
        <View style={styles.trust}>
          <Ionicons name="scale-outline" size={18} color={Q.BLUE} />
          <Text style={styles.trustText}>
            Spring rates are built around rider weight. This one matters most.
          </Text>
        </View>

        <WeightDial
          valueLbs={weightLbs}
          unit={unit}
          onChangeLbs={(v) => {
            setWeightLbs(v);
            persist({ weightLbs: v });
          }}
          onChangeUnit={(u) => {
            setUnit(u);
            persist({ weightUnit: u });
          }}
        />

        {freeOpen ? (
          <Animated.View entering={FadeIn.duration(160)} style={styles.freeBox}>
            <Text style={styles.freeLabel}>Anything else about you or your bike?</Text>
            <TextInput
              value={freeText}
              onChangeText={(t) => {
                setFreeText(t);
                persist({ freeText: t.trim() || undefined });
              }}
              placeholder="Stiffer springs, a heavy pack, a bad knee..."
              placeholderTextColor={Q.STEEL}
              multiline
              maxLength={800}
              autoFocus
              style={styles.freeInput}
            />
          </Animated.View>
        ) : (
          <Pressable
            onPress={openFreeText}
            accessibilityRole="button"
            style={styles.freeCollapsed}
          >
            <Ionicons name="add" size={18} color={Q.STEEL} />
            <Text style={styles.freeCollapsedText}>Anything else about you or your bike? Optional</Text>
          </Pressable>
        )}
      </QuizShell>

      <RiskGate visible={riskOpen} onAccept={() => void onRiskAccept()} onCancel={() => setRiskOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  trust: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(29,155,240,0.35)",
    backgroundColor: "rgba(29,155,240,0.08)",
    marginBottom: 18,
  },
  trustText: { flex: 1, color: Q.TEXT, fontSize: 14, lineHeight: 19 },
  freeCollapsed: {
    marginTop: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Q.BORDER_STRONG,
  },
  freeCollapsedText: { flex: 1, color: Q.STEEL, fontSize: 14 },
  freeBox: {
    marginTop: 26,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Q.BORDER_STRONG,
    backgroundColor: Q.PANEL,
  },
  freeLabel: { color: Q.STEEL, fontSize: 13, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8 },
  freeInput: { color: Q.TEXT, fontSize: 16, minHeight: 80, textAlignVertical: "top" },
  cta: {
    height: 56,
    borderRadius: 16,
    backgroundColor: Q.BLUE,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: Q.INK, fontSize: 19, letterSpacing: 0.4, textTransform: "uppercase" },
});
