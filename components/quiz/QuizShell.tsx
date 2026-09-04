// components/quiz/QuizShell.tsx
// Screen chrome shared by every question: top row (back arrow + progress),
// display headline, sub-line, scrolling body with clear bottom padding, and a
// fixed footer that shows the Q1-only hint or the confirmation echo.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { quizStepIndex, type QuizStepId } from "../../lib/quizOnboarding";
import { QuizProgress } from "./QuizProgress";
import { displayFont, Q } from "./quizTheme";

type Props = {
  step: QuizStepId;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Instructional hint (Q1 only per spec). Hidden once an echo is set. */
  hint?: string;
  /** Confirmation echo shown after an answer ("Track it is"). */
  echo?: string | null;
  ghostNext?: boolean;
  showBack?: boolean;
  onBack?: () => void;
  /** Extra footer content above the echo line (e.g. Q4's Continue). */
  footerSlot?: React.ReactNode;
  children: React.ReactNode;
};

export function QuizShell({
  step,
  title,
  subtitle,
  hint,
  echo,
  ghostNext,
  showBack,
  onBack,
  footerSlot,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
      <View style={styles.topRow}>
        {showBack ? (
          <Pressable
            onPress={goBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={Q.TEXT} />
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
        <QuizProgress current={quizStepIndex(step)} ghostNext={ghostNext} style={styles.progress} />
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: 48 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, displayFont("black")]} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={styles.body}>{children}</View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {footerSlot}
        <View style={styles.echoRow}>
          {echo ? (
            <Animated.Text
              key={echo}
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(120)}
              style={[styles.echo, displayFont("bold")]}
            >
              {echo}
            </Animated.Text>
          ) : hint ? (
            <Animated.Text key="hint" exiting={FadeOut.duration(120)} style={styles.hint}>
              {hint}
            </Animated.Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Q.BG },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  progress: { flex: 1, marginHorizontal: 6 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20 },
  title: {
    color: Q.TEXT,
    fontSize: 34,
    lineHeight: 36,
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  subtitle: {
    color: Q.STEEL,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 10,
  },
  body: { marginTop: 22 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    backgroundColor: Q.BG,
  },
  echoRow: { minHeight: 28, justifyContent: "center", alignItems: "center" },
  hint: { color: Q.STEEL, fontSize: 13, letterSpacing: 0.6, textTransform: "uppercase" },
  echo: { color: Q.BLUE, fontSize: 18, letterSpacing: 0.4, textTransform: "uppercase" },
});
