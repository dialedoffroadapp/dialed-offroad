// app/_layout.tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { Platform } from "react-native";

// Toast
import { ToastProvider } from "../components/Toast";

// RevenueCat init
import { initPurchases } from "../lib/purchases";

// Supabase (to read auth + listen for changes)
import { supabase } from "../lib/supabase";

// THEME: new provider + hook
import { ThemeProvider, useTheme } from "../lib/theme";

function ThemedStatusBar() {
  const { colors } = useTheme();
  // Heuristic: our dark BG is very dark; use light status text there
  const isDark = colors.BG === "#0B1220";
  return (
    <StatusBar
      style={isDark ? "light" : "dark"}
      backgroundColor={colors.BG}
    />
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
      <Stack.Screen
        name="auth-callback"
        options={{ headerShown: false }}
      />

      {/* Private app (your tab navigator lives here: app/(tabs)/_layout.tsx) */}
      <Stack.Screen
        name="(tabs)"
        options={{ headerShown: false }}
      />

      {/* Modal/screen outside tabs */}
      <Stack.Screen
        name="tune-results"
        options={{ headerShown: false, presentation: "card" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === "web") return;

    // 1) On app start, configure Purchases with the current user (if any)
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id ?? undefined;
        await initPurchases(userId);
      } catch {
        // optional: log/ignore
      }
    })();

    // 2) Re-run initPurchases whenever auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const userId = session?.user?.id ?? undefined;
        initPurchases(userId).catch(() => {
          // optional: log/ignore
        });
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <ThemeProvider>
      <ToastProvider>
        <ThemedStatusBar />
        <AppStack />
      </ToastProvider>
    </ThemeProvider>
  );
}
