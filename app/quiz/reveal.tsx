// app/quiz/reveal.tsx — "YOUR BIKE, DIALED". Eyebrow echoes the bike and the
// main terrain; full values big and readable; "Why this setup?" expands the
// engine's explanation INLINE (text only, never the legacy results screen,
// which re-derived values); the dialed meter's first appearance (endowed
// 20%, reason stated, Pro rows locked); CTA "Set it on the bike" into the app.
// Interstitial world only: a rider who declined the paywall sees the locked
// card here with the trial CTA instead (old ordering preserved).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DialedMeterCard, LockedTuneCard, TuneValuesCard } from "../../components/quiz/TuneCards";
import { displayFont, Q } from "../../components/quiz/quizTheme";
import { readPendingTune, useOnboarding } from "../../lib/onboarding";
import { paywallHref } from "../../lib/paywall";
import { deriveIsPro } from "../../lib/proUtils";
import { hasPurchasedThisSession } from "../../lib/purchases";
import { useQuiz } from "../../lib/quizContext";
import { bikeDisplayName, defaultSetupTerrainLabel, logQuizEvent, nextQuizRoute, resetQuizForNextRun, type TuneLike } from "../../lib/quizOnboarding";
import { autoCreateBaselineFromPendingTune } from "../../lib/autoBaseline";
import { createNamedSetup, defaultSetupName } from "../../lib/bikeSetups";
import { supabase } from "../../lib/supabase";
import { clearFunnelId, logEvent } from "../../lib/usage";
import { startReverseTrial } from "../../lib/entitlement";
import { emitLifecycleEvent } from "../../lib/lifecycle";

export default function QuizRevealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { answers } = useQuiz();
  const { state } = useOnboarding();
  const [tune, setTune] = useState<TuneLike | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [whyOpen, setWhyOpen] = useState(false);
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
          const raw = JSON.parse(decodeURIComponent(pending.r));
          setTune(raw as TuneLike);
          // The engine's own explanation (ai-tune notes), shown verbatim.
          setNotes(Array.isArray(raw?.notes) ? raw.notes.filter((n: unknown) => typeof n === "string" && n.trim()) : []);
          setMeta(JSON.parse(decodeURIComponent(pending.meta)));
        } catch {
          setTune(null);
          setNotes([]);
        }

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
          void logQuizEvent("quiz_reveal_viewed", { locked: isLocked, flow: answers.flow ?? "onboarding" });
          if (!isLocked && !answers.flow) {
            // Conversion model: the reveal is where a new account's usage-
            // anchored reverse trial starts (idempotent server-side).
            void startReverseTrial("reveal");
            void emitLifecycleEvent("account_created", { bike: bikeDisplayName(answers) || null });
          }
          if (!isLocked && answers.flow) {
            // Garage flows (signed in, onboarding long done): persist the
            // version NOW so backing out never loses the numbers.
            void saveFlowVersion();
          }
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
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !whyOpen;
    setWhyOpen(next);
    // No dedicated event type (the events CHECK is a frozen superset): ride
    // heard_card_shown's meta, the documented carrier precedent.
    if (next) {
      void logEvent(
        "heard_card_shown",
        { surface: "reveal_why_opened", source_route: "/quiz/reveal", notes: notes.length },
        { allowAnonymous: true, queueIfAnonymous: true }
      );
    }
  };

  const savedRef = useRef(false);
  const saveFlowVersion = async () => {
    if (savedRef.current) return;
    savedRef.current = true;
    try {
      if (answers.flow === "add_bike") {
        await autoCreateBaselineFromPendingTune();
      } else if (answers.flow === "new_setup" && answers.flowBikeId) {
        const label = defaultSetupTerrainLabel(answers);
        const created = await createNamedSetup({ bikeId: answers.flowBikeId, name: defaultSetupName(label), terrain: label, from: null });
        await autoCreateBaselineFromPendingTune({
          setupId: created.setup.id,
          parentVersionId: answers.flowFromVersionId ?? null,
          allowExisting: true,
        });
      }
    } catch (e) {
      console.warn("[quiz] flow version save failed", e);
      savedRef.current = false;
    }
  };

  const onSetIt = async () => {
    if (answers.flow) await saveFlowVersion();
    const target = nextQuizRoute("reveal", answers);
    if (!answers.flow) await clearFunnelId();
    // Keep the rider facts for the next Garage flow; clear bike/terrain/flow.
    await resetQuizForNextRun();
    router.replace(target as never);
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
          <View>
            <Pressable
              onPress={onWhy}
              accessibilityRole="button"
              accessibilityState={{ expanded: whyOpen }}
              style={styles.why}
            >
              <Text style={styles.whyText}>Why this setup?</Text>
              <Ionicons name={whyOpen ? "chevron-up" : "chevron-down"} size={16} color={Q.BLUE} />
            </Pressable>
            {whyOpen ? (
              <Animated.View entering={FadeIn.duration(160)} style={styles.whyBox}>
                {notes.length > 0 ? (
                  notes.map((n, i) => (
                    <View key={i} style={styles.whyRow}>
                      <View style={styles.whyDot} />
                      <Text style={styles.whyLine}>{n}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.whyLine}>
                    Built from your weight, your riding, and this bike&apos;s stock settings. Ride it, then tell us what it did.
                  </Text>
                )}
              </Animated.View>
            ) : null}
          </View>
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
  whyBox: { backgroundColor: Q.PANEL, borderWidth: 1, borderColor: Q.BORDER, borderRadius: 14, padding: 14, gap: 10, marginBottom: 6 },
  whyRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  whyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Q.BLUE, marginTop: 7 },
  whyLine: { color: Q.TEXT, fontSize: 15, lineHeight: 21, flex: 1 },
  meter: { marginTop: 8 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 10, backgroundColor: Q.BG },
  cta: { height: 56, borderRadius: 16, backgroundColor: Q.BLUE, alignItems: "center", justifyContent: "center", marginTop: 6 },
  ctaText: { color: Q.INK, fontSize: 19, letterSpacing: 0.4, textTransform: "uppercase" },
});
