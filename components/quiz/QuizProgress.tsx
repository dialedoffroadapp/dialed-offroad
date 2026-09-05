// components/quiz/QuizProgress.tsx
// Five segments, always visible, always honest: done + current are filled,
// the NEXT segment ghosts in (35%) the moment an answer is tapped, the rest
// stay idle.
import React, { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { QUIZ_TOTAL_STEPS } from "../../lib/quizOnboarding";
import { Q } from "./quizTheme";

type SegmentState = "done" | "active" | "ghost" | "idle";

function Segment({ state }: { state: SegmentState }) {
  const fill = useSharedValue(state === "done" || state === "active" ? 1 : 0);
  const ghost = useSharedValue(state === "ghost" ? 1 : 0);
  useEffect(() => {
    fill.value = withTiming(state === "done" || state === "active" ? 1 : 0, { duration: 200 });
    ghost.value = withTiming(state === "ghost" ? 1 : 0, { duration: 220 });
  }, [state, fill, ghost]);
  const style = useAnimatedStyle(() => ({
    opacity: fill.value > 0 ? 1 : 0.35 * ghost.value + 0.12 * (1 - ghost.value),
    backgroundColor: fill.value > 0 || ghost.value > 0 ? Q.BLUE : "#FFFFFF",
  }));
  return <Animated.View style={[styles.segment, style]} />;
}

export function QuizProgress({
  current,
  ghostNext,
  total,
  style,
}: {
  /** 1-based index of the question on screen. */
  current: number;
  /** True once an answer is tapped on this screen. */
  ghostNext?: boolean;
  /** Segment count: the onboarding's five, or a garage flow's own question count. */
  total?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const count = Math.max(1, total ?? QUIZ_TOTAL_STEPS);
  return (
    <View
      style={[styles.row, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={`Question ${current} of ${count}`}
    >
      {Array.from({ length: count }, (_, i) => {
        const n = i + 1;
        const state: SegmentState =
          n < current ? "done" : n === current ? "active" : n === current + 1 && ghostNext ? "ghost" : "idle";
        return <Segment key={n} state={state} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, alignItems: "center" },
  segment: { flex: 1, height: 4, borderRadius: 2 },
});
