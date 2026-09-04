// components/quiz/QuizChoiceCard.tsx
// The answer card with the spec'd tap rhythm: fills solid Dialed Blue with
// dark text + check, scales to 0.98, siblings dim to 45% within 100 ms. The
// hold + advance timing lives in useAnswerRhythm; this component only renders
// the state it is given. Brand accents (2a) color the label/border when
// unselected and never indicate selection.
import Ionicons from "@expo/vector-icons/Ionicons";
import React, { useEffect } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { displayFont, hexToRgba, Q, RHYTHM } from "./quizTheme";

type Props = {
  label: string;
  subtitle?: string;
  selected: boolean;
  dimmed: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Brand accent for the unselected state (2a tiles). */
  accentColor?: string;
  /** Tile variant: centered display label, fixed height (brand grid). */
  tile?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function QuizChoiceCard({
  label,
  subtitle,
  selected,
  dimmed,
  onPress,
  disabled,
  accentColor,
  tile,
  style,
  testID,
}: Props) {
  const sel = useSharedValue(selected ? 1 : 0);
  const dim = useSharedValue(dimmed ? 1 : 0);

  useEffect(() => {
    sel.value = withTiming(selected ? 1 : 0, { duration: RHYTHM.fill });
  }, [selected, sel]);
  useEffect(() => {
    dim.value = withTiming(dimmed ? 1 : 0, { duration: RHYTHM.dimSiblings });
  }, [dimmed, dim]);

  const baseBg = accentColor ? hexToRgba(accentColor, 0.08) : Q.PANEL;
  const baseBorder = accentColor ? hexToRgba(accentColor, 0.35) : Q.BORDER_STRONG;
  const baseLabel = accentColor ?? Q.TEXT;

  const cardStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], [baseBg, Q.BLUE]),
    borderColor: interpolateColor(sel.value, [0, 1], [baseBorder, Q.BLUE]),
    transform: [{ scale: 1 - 0.02 * sel.value }],
    opacity: 1 - (1 - Q.DIM_OPACITY) * dim.value,
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], [baseLabel, Q.INK]),
  }));
  const subStyle = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], [Q.STEEL, "rgba(12,13,18,0.72)"]),
  }));
  const checkStyle = useAnimatedStyle(() => ({ opacity: sel.value }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={subtitle ? `${label}. ${subtitle}` : label}
      testID={testID}
      style={style}
    >
      <Animated.View style={[styles.card, tile ? styles.tile : styles.row, cardStyle]}>
        <View style={tile ? styles.tileInner : styles.rowInner}>
          <Animated.Text
            style={[tile ? styles.tileLabel : styles.label, displayFont(tile ? "blackItalic" : "bold"), labelStyle]}
            numberOfLines={tile ? 1 : 2}
            adjustsFontSizeToFit={tile}
          >
            {label}
          </Animated.Text>
          {subtitle ? (
            <Animated.Text style={[styles.subtitle, subStyle]}>{subtitle}</Animated.Text>
          ) : null}
        </View>
        <Animated.View style={[tile ? styles.tileCheck : styles.check, checkStyle]}>
          <Ionicons name="checkmark" size={tile ? 16 : 20} color={Q.INK} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderRadius: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 18,
    minHeight: 72,
  },
  rowInner: { flex: 1, paddingRight: 12 },
  tile: {
    height: 84,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  tileInner: { alignItems: "center", justifyContent: "center", width: "100%" },
  label: { fontSize: 20, letterSpacing: 0.3, lineHeight: 24, textTransform: "uppercase" },
  tileLabel: { fontSize: 28, letterSpacing: 0.4, textTransform: "uppercase" },
  subtitle: { fontSize: 14, lineHeight: 19, marginTop: 4 },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(12,13,18,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  tileCheck: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(12,13,18,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
});
