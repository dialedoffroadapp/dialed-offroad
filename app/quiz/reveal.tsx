// app/quiz/reveal.tsx — "YOUR BIKE, DIALED". Eyebrow echoes the bike and the
// main terrain; full values big and readable; "Why this setup?" opens the
// existing results explanation; the dialed meter's first appearance (endowed
// 20%, reason stated, Pro rows locked); CTA "Set it on the bike" into the app.
// Interstitial world only: a rider who declined the paywall sees the locked
// card here with the trial CTA instead (old ordering preserved).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DialedMeterCard, LockedTuneCard, TuneValuesCard } from "../../components/quiz/TuneCards";
import { displayFont, Q } from "../../components/quiz/quizTheme";
import { readPendingTune, useOnboarding } from "../../lib/onboarding";
import { paywallHref } from "../../lib/paywall";
import { deriveIsPro } from "../../lib/proUtils";
import { hasPurchasedThisSession } from "../../lib/purchases";
import { useQuiz } from "../../lib/quizContext";
import { bikeDisplayName, clearQuizAnswers, logQuizEvent, type TuneLike } from "../../lib/quizOnboarding";
import { supabase } from "../../lib/supabase";
import { clearFunnelId } from "../../lib/usage";

export default function QuizRevealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { answers } = useQuiz();
  const { state } = useOnboarding();
  const [tune, setTune] = useState<TuneLike | null>(null);
  const [pendingParams, setPendingParams] = useState<{ r: string; meta: string } | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [locked, setLocked] = useState(false);
  const viewedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const { tune: pending } = await readPendingTune();
        if (!alive) return;
        if (!pending) {
          router.replace("/(tabs)" as never);
          return;
        }
        try {
          setTune(JSON.parse(decodeURIComponent(pending.r)) as TuneLike);
          setMeta(JSON.parse(decodeURIComponent(pending.meta)));
        } catch {
          setTune(null);
        }
        setPendingParams({ r: pending.r, meta: pending.meta });

        // Interstitial decliner: still gated. Action-gated riders and anyone
        // who completed onboarding see the numbers.
        let isLocked = false;
        if (state.onboardingStep === "trial" && !state.onboardingComplete && !hasPurchasedThisSession()) {
          try {
            const { data: auth } = await supabase.auth.getUser();
            const uid = auth?.user?.id;
            const { data: prof } = uid
              ? await supabase.from("profiles").select("is_pro, pro_until").eq("user_id", uid).maybeSingle()
              : { data: null };
            isLocked = !deriveIsPro(prof);
          } catch {
            isLocked = true;
          }
        }
        if (!alive) return;
        setLocked(isLocked);
        if (!viewedRef.current) {
          viewedRef.current = true;
          void logQuizEvent("quiz_reveal_viewed", { locked: isLocked });
        }
      })();
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.onboardingStep, state.onboardingComplete])
  );

  const bikeName =
    bikeDisplayName(answers) ||
    bikeDisplayName({ year: meta?.bike?.year, make: meta?.bike?.make, model: meta?.bike?.model }) ||
    "Your bike";
  const terrain: string | null = meta?.context?.terrain ?? null;

  const onWhy = () => {
    if (!pendingParams) return;
    router.push({ pathname: "/tune-results", params: pendingParams } as never);
  };

  const onSetIt = async () => {
    await clearFunnelId();
    await clearQuizAnswers();
    router.replace("/(tabs)" as never);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 20 }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <Text style={[styles.eyebrow, displayFont("bold")]} numberOfLines={1}>
          {[bikeName, terrain].filter(Boolean).join(" · ").toUpperCase()}
        </Text>
        <Text style={[styles.title, displayFont("black")]}>Your bike, dialed</Text>

        <View style={styles.card}>
          {locked || !tune ? <LockedTuneCard tune={tune} /> : <TuneValuesCard tune={tune} />}
        </View>

        {locked ? (
          <Pressable
            onPress={() => router.push(paywallHref("quiz_reveal_locked", "/quiz/reveal") as never)}
            style={styles.cta}
            accessibilityRole="button"
          >
            <Text style={[styles.ctaText, displayFont("bold")]}>Start free trial to reveal</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onWhy} accessibilityRole="link" style={styles.why}>
            <Text style={styles.whyText}>Why this setup?</Text>
            <Ionicons name="chevron-forward" size={16} color={Q.BLUE} />
          </Pressable>
        )}

        <View style={styles.meter}>
          <DialedMeterCard />
        </View>
      </ScrollView>

      {!locked ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable onPress={() => void onSetIt()} style={styles.cta} accessibilityRole="button">
            <Text style={[styles.ctaText, displayFont("bold")]}>Set it on the bike</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Q.BG },
  content: { paddingHorizontal: 20 },
  eyebrow: { color: Q.STEEL, fontSize: 13, letterSpacing: 1 },
  title: { color: Q.TEXT, fontSize: 40, lineHeight: 42, letterSpacing: 0.2, textTransform: "uppercase", marginTop: 8 },
  card: { marginTop: 22 },
  why: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 14 },
  whyText: { color: Q.BLUE, fontSize: 16, fontWeight: "700" },
  meter: { marginTop: 8 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 10, backgroundColor: Q.BG },
  cta: { height: 56, borderRadius: 16, backgroundColor: Q.BLUE, alignItems: "center", justifyContent: "center", marginTop: 6 },
  ctaText: { color: Q.INK, fontSize: 19, letterSpacing: 0.4, textTransform: "uppercase" },
});
