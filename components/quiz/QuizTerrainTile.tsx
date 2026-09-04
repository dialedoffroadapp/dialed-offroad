// components/quiz/QuizTerrainTile.tsx
// Q4 square tile: icon on top, label under. First tap wears the MAIN corner
// badge (the engine's terrain target); later taps wear a corner check
// (secondary terrain). Selection color is Dialed Blue, as everywhere.
import Ionicons from "@expo/vector-icons/Ionicons";
import React, { useEffect } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { displayFont, Q, RHYTHM } from "./quizTheme";

export type TerrainTileState = "none" | "main" | "secondary";

export function QuizTerrainTile({
  label,
  icon,
  state,
  onPress,
  style,
  testID,
}: {
  label: string;
  icon: (color: string) => React.ReactNode;
  state: TerrainTileState;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const sel = useSharedValue(state === "none" ? 0 : 1);
  useEffect(() => {
    sel.value = withTiming(state === "none" ? 0 : 1, { duration: RHYTHM.fill });
  }, [state, sel]);

  const tileStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], [Q.PANEL, Q.BLUE]),
    borderColor: interpolateColor(sel.value, [0, 1], [Q.BORDER_STRONG, Q.BLUE]),
    transform: [{ scale: 1 - 0.02 * sel.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], [Q.TEXT, Q.INK]),
  }));
  const iconColor = state === "none" ? Q.STEEL : Q.INK;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: state !== "none" }}
      accessibilityLabel={
        state === "main" ? `${label}, tuning for this first` : state === "secondary" ? `${label}, also selected` : label
      }
      style={style}
      testID={testID}
    >
      <Animated.View style={[styles.tile, tileStyle]}>
        <View style={styles.icon}>{icon(iconColor)}</View>
        <Animated.Text style={[styles.label, displayFont("bold"), labelStyle]} numberOfLines={2}>
          {label}
        </Animated.Text>
        {state === "main" ? (
          <View style={styles.badge}>
            <Animated.Text style={[styles.badgeText, displayFont("bold")]}>MAIN</Animated.Text>
          </View>
        ) : state === "secondary" ? (
          <View style={styles.check}>
            <Ionicons name="checkmark" size={14} color={Q.INK} />
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    aspectRatio: 1,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  icon: { marginBottom: 10 },
  label: { fontSize: 20, letterSpacing: 0.3, textAlign: "center", textTransform: "uppercase" },
  badge: {
    position: "absolute",
    top: 8,
    right: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: Q.INK,
  },
  badgeText: { color: Q.BLUE, fontSize: 11, letterSpacing: 0.8 },
  check: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(12,13,18,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
});
