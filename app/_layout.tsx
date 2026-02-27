// app/_layout.tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

import Onboarding from "../components/Onboarding";
import { ToastProvider } from "../components/Toast";
import { OnboardingProvider, useOnboarding } from "../lib/onboarding";
import { initPurchases } from "../lib/purchases";
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
  // Overlay is just the 3 intro pages
  const [showOnboardingOverlay, setShowOnboardingOverlay] = useState(true);
  const { setOnboardingActive } = useOnboarding();

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
      {showOnboardingOverlay && (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="auto">
          <Onboarding
            onFinish={() => {
              // Hide the slides…
              setShowOnboardingOverlay(false);
              // …but keep the onboarding FLOW active (locks tabs)
              setOnboardingActive(true);
            }}
          />
        </View>
      )}
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
