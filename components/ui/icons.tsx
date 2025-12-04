// components/ui/icons.tsx
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { TextStyle, ViewStyle } from "react-native";

const ionByName = {
  // keep only what you actually use; extras are fine
  "chevron-up": "chevron-up-outline",
  "chevron-down": "chevron-down-outline",
  settings: "settings-outline",
  stats: "stats-chart-outline",
  tune: "construct-outline",
  alert: "alert-circle-outline",
  primary: "star-outline",
  bicycle: "bicycle-outline",
  link: "link-outline",
} as const;

export type IconName = keyof typeof ionByName;

export function Icon({
  name,
  size = 20,
  color = "#0F172A",
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: ViewStyle | TextStyle;
}) {
  const ion = ionByName[name] ?? "ellipse-outline";
  return <Ionicons name={ion as any} size={size} color={color} style={style} />;
}
