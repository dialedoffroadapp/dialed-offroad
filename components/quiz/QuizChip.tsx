// components/quiz/QuizChip.tsx
// Small selectable chip (year chips on 2b). Same fill/dim language as the
// cards: Dialed Blue fill + dark text when selected, 45% when a sibling won.
import React, { useEffect } from "react";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { displayFont, Q, RHYTHM } from "./quizTheme";

export function QuizChip({
  label,
  selected,
  dimmed,
  onPress,
  disabled,
  style,
}: {
  label: string;
  selected: boolean;
  dimmed: boolean;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const sel = useSharedValue(selected ? 1 : 0);
  const dim = useSharedValue(dimmed ? 1 : 0);
  useEffect(() => {
    sel.value = withTiming(selected ? 1 : 0, { duration: RHYTHM.fill });
  }, [selected, sel]);
  useEffect(() => {
    dim.value = withTiming(dimmed ? 1 : 0, { duration: RHYTHM.dimSiblings });
  }, [dimmed, dim]);

  const chipStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], [Q.INK, Q.BLUE]),
    borderColor: interpolateColor(sel.value, [0, 1], [Q.BORDER_STRONG, Q.BLUE]),
    transform: [{ scale: 1 - 0.02 * sel.value }],
    opacity: 1 - (1 - Q.DIM_OPACITY) * dim.value,
  }));
  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], [Q.TEXT, Q.INK]),
  }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      style={style}
    >
      <Animated.View style={[styles.chip, chipStyle]}>
        <Animated.Text style={[styles.text, displayFont("bold"), textStyle]}>{label}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minWidth: 68,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { fontSize: 18, letterSpacing: 0.3 },
});
