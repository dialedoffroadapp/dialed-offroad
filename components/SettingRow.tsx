import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

/**
 * A single setting row used in tune-results screens.
 *
 * With `icon`: renders 32×32 icon chip + label/hint + large value/unit + optional chevron.
 * Without `icon`: same layout minus the chip — just label/hint + value/unit.
 *
 * `trailingAction` renders a text button (e.g. "Edit") in place of the default chevron.
 */
export function SettingRow({
  icon,
  label,
  hint,
  value,
  unit,
  onPress,
  trailingAction,
}: {
  icon?: string;
  label: string;
  hint?: string;
  value?: string;
  unit?: string;
  onPress?: () => void;
  trailingAction?: { label: string; onPress: () => void };
}) {
  const { colors: C } = useTheme();
  const S = React.useMemo(() => makeStyles(C), [C]);

  const trailing = trailingAction ? (
    <Pressable onPress={trailingAction.onPress} hitSlop={10} style={S.trailingBtn}>
      <Text style={S.trailingBtnText}>{trailingAction.label}</Text>
    </Pressable>
  ) : onPress ? (
    <Ionicons name="chevron-forward" size={14} color={C.MUTED} style={{ marginLeft: 4 }} />
  ) : null;

  return (
    <Pressable onPress={onPress} disabled={!onPress && !trailingAction} style={S.row}>
      {icon ? (
        <View style={S.iconChip}>
          <Ionicons name={icon as any} size={16} color={C.ACCENT} />
        </View>
      ) : null}
      <View style={S.middle}>
        <Text style={S.label}>{label}</Text>
        {hint ? <Text style={S.hint}>{hint}</Text> : null}
      </View>
      {value != null ? (
        <View style={S.right}>
          <Text style={S.value}>{value}</Text>
          {unit ? <Text style={S.unit}>{unit}</Text> : null}
        </View>
      ) : null}
      {trailing}
    </Pressable>
  );
}

const makeStyles = (C: {
  ACCENT: string;
  TEXT: string;
  MUTED: string;
  BORDER: string;
}) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: C.BORDER,
    },
    iconChip: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: C.ACCENT + "18",
      marginRight: 10,
      flexShrink: 0,
    },
    middle: { flex: 1 },
    label: { color: C.TEXT, fontSize: 14, fontWeight: "700" },
    hint: { color: C.MUTED, fontSize: 11, marginTop: 1 },
    right: { alignItems: "flex-end", marginLeft: 8 },
    value: {
      color: C.TEXT,
      fontSize: 20,
      fontWeight: "900",
      letterSpacing: -0.5,
    },
    unit: { color: C.MUTED, fontSize: 11, marginTop: 1 },
    trailingBtn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: "rgba(29,155,240,0.08)",
      borderWidth: 1,
      borderColor: "rgba(29,155,240,0.2)",
      marginLeft: 8,
      minHeight: 36,
      justifyContent: "center" as const,
    },
    trailingBtnText: {
      color: "#60A5FA",
      fontWeight: "800" as const,
      fontSize: 13,
    },
  });
