// app/quiz/_layout.tsx
// Quiz onboarding route group (feat/quiz-onboarding, behind
// EXPO_PUBLIC_QUIZ_ONBOARDING). Owns the Barlow Condensed load, the answers
// provider, and the slide-from-right stack every question advances through.
// Q1 (index) has no back gesture; every later screen supports swipe + arrow.
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Q, QUIZ_FONT_MAP } from "../../components/quiz/quizTheme";
import { QuizProvider } from "../../lib/quizContext";

const FONT_WAIT_MS = 1500;

export default function QuizLayout() {
  const [fontsLoaded, fontError] = useFonts(QUIZ_FONT_MAP);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), FONT_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  const ready = fontsLoaded || !!fontError || timedOut;

  return (
    <QuizProvider>
      <View style={{ flex: 1, backgroundColor: Q.BG }}>
        {ready ? (
          <Stack
            screenOptions={{
              headerShown: false,
              animation: "slide_from_right",
              gestureEnabled: true,
              contentStyle: { backgroundColor: Q.BG },
            }}
          >
            <Stack.Screen name="index" options={{ gestureEnabled: false }} />
            {/* Forward-only from the build on: no swiping back into a
                half-built tune or out of the results_locked gate. */}
            <Stack.Screen name="building" options={{ gestureEnabled: false }} />
            <Stack.Screen name="gate" options={{ gestureEnabled: false }} />
            <Stack.Screen name="reveal" options={{ gestureEnabled: false }} />
          </Stack>
        ) : null}
      </View>
    </QuizProvider>
  );
}
