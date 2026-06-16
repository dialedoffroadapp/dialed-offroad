// app/_layout.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

import Onboarding from "../components/Onboarding";
import { ToastProvider } from "../components/Toast";
import TrialPromptModal, {
  TRIAL_MODAL_DISMISS_KEY,
  TRIAL_MODAL_MAX_DISMISSALS,
} from "../components/TrialPromptModal";
import { OnboardingProvider, useOnboarding } from "../lib/onboarding";
import { initPurchases } from "../lib/purchases";
import { deriveIsPro } from "../lib/proUtils";
import { supabase } from "../lib/supabase";
import { ThemeProvider, useTheme } from "../lib/theme";

function ThemedStatusBar() {
  const { colors } = useTheme();
  const isDark = colors.BG === "#0B1220";
  return (
    <StatusBar style={isDark ? "light" : "dark"} backgroundColor={colors.BG} />
  );
}

function AppStack() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "fade",
        contentStyle: { backgroundColor: colors.BG },
      }}
    >
      {/* Public routes */}
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen
        name="reset-password"
        options={{ headerShown: false, presentation: "card" }}
      />
      <Stack.Screen name="auth-callback" options={{ headerShown: false }} />

      {/* Private app (tabs live here) */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

      {/* Modal/screen outside tabs */}
      <Stack.Screen
        name="tune-results"
        options={{ headerShown: false, presentation: "card" }}
      />
    </Stack>
  );
}

/**
 * This inner component lets us call useOnboarding()
 * (provider has to wrap it first).
 */
function RootInner() {
  const pathname = usePathname();
  const router = useRouter();
  const [showOnboardingOverlay, setShowOnboardingOverlay] = useState(true);
  const { setOnboardingActive, state, hydrated, markIntroSeen, setStep } = useOnboarding();
  const isRecoveryRoute =
    pathname === "/auth-callback" || pathname === "/reset-password";
  const shouldShowOnboardingOverlay =
    showOnboardingOverlay && pathname === "/" && !isRecoveryRoute;

  // ——— Trial prompt modal for existing signed-in non-pro users ———
  const [showTrialModal, setShowTrialModal] = useState(false);
  const [trialBikeTitle, setTrialBikeTitle] = useState("");

  useEffect(() => {
    if (!hydrated) return;

    let mounted = true;
    (async () => {
      try {
        // Check dismiss count first (fast local check)
        const raw = await AsyncStorage.getItem(TRIAL_MODAL_DISMISS_KEY);
        const dismissCount = raw ? parseInt(raw, 10) : 0;
        if (dismissCount >= TRIAL_MODAL_MAX_DISMISSALS) return;

        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user?.id) return;

        // Check Pro status
        const { data: prof } = await supabase
          .from("profiles")
          .select("is_pro, pro_until")
          .eq("user_id", auth.user.id)
          .maybeSingle();

        if (deriveIsPro(prof)) {
          setShowTrialModal(false);
          return;
        }

        // Check has at least one bike
        const { data: bikes } = await supabase
          .from("bikes")
          .select("id, make, model, year, nickname")
          .eq("user_id", auth.user.id)
          .order("created_at", { ascending: true })
          .limit(1);

        if (!mounted) return;
        if (!bikes || bikes.length === 0) return;

        const b = bikes[0] as any;
        const fallback = [b.year, b.make, b.model].filter(Boolean).join(" ");
        setTrialBikeTitle(b.nickname || fallback);
        setShowTrialModal(true);
      } catch {
        // Silently ignore — modal is non-critical
      }
    })();

    return () => {
      mounted = false;
    };
  }, [hydrated]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id ?? undefined;
        await initPurchases(userId);
      } catch (e) {
        console.warn("[RC] initPurchases error:", e);
      }
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const userId = session?.user?.id ?? undefined;
        initPurchases(userId).catch((e) => {
          console.warn("[RC] initPurchases error (auth change):", e);
        });
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <>
      <ThemedStatusBar />

      {/* Router + normal app tree ALWAYS mounts so splash can hide */}
      <AppStack />

      {/* Onboarding overlay on TOP */}
      {shouldShowOnboardingOverlay && (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="auto">
          <Onboarding
            onFinish={async () => {
              // Persist state before navigating so cold-start resume lands correctly.
              await markIntroSeen();
              await setStep("garage_locked");
              // Activate onboarding explicitly before navigation so Garage sees
              // onboardingActive=true on its first render, avoiding a race with
              // the OnboardingProvider auto-activation effect.
              setOnboardingActive(true);
              // Navigate first, then remove the overlay — both are synchronous
              // calls after the awaits so React 18 batches them in one render.
              // This means the overlay never disappears before the new screen
              // is committed, eliminating the blank "/" flash.
              router.replace("/(tabs)/garage");
              setShowOnboardingOverlay(false);
            }}
          />
        </View>
      )}

      {/* Trial prompt for existing signed-in non-pro users */}
      <TrialPromptModal
        visible={showTrialModal}
        bikeTitle={trialBikeTitle}
        onRequestClose={() => setShowTrialModal(false)}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ToastProvider>
        {/* Provider controls whether tabs are locked */}
        <OnboardingProvider initialActive={false}>
          <RootInner />
        </OnboardingProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
