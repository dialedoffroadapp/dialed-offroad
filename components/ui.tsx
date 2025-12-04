import React from "react";
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from "react-native";

export const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <Text style={s.sectionTitle}>{children}</Text>
);

export const Row = ({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) => (
  <View style={s.row}>
    <View style={{ flex: 1 }}>{left}</View>
    {right ? <View>{right}</View> : null}
  </View>
);

export const Card = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => (
  <View style={[s.card, style]}>{children}</View>
);

export const StatItem = ({ label, value }: { label: string; value: string | number }) => (
  <Row
    left={<Text style={s.statLabel}>{label}</Text>}
    right={<Text style={s.statValue}>{value}</Text>}
  />
);

export const LinkButton = ({
  title,
  onPress,
}: {
  title: string;
  onPress?: () => void;
}) => (
  <TouchableOpacity onPress={onPress} style={s.linkBtn}>
    <Text style={s.linkBtnText}>{title}</Text>
  </TouchableOpacity>
);

export const PrimaryButton = ({
  title,
  onPress,
  icon,
}: {
  title: string;
  onPress?: () => void;
  icon?: React.ReactNode;
}) => (
  <TouchableOpacity onPress={onPress} style={s.primaryBtn}>
    {icon}
    <Text style={s.primaryBtnText}>{title}</Text>
  </TouchableOpacity>
);

export const GhostButton = ({
  title,
  onPress,
}: {
  title: string;
  onPress?: () => void;
}) => (
  <TouchableOpacity onPress={onPress} style={s.ghostBtn}>
    <Text style={s.ghostBtnText}>{title}</Text>
  </TouchableOpacity>
);

export const Pill = ({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) => (
  <TouchableOpacity
    onPress={onPress}
    style={[s.pill, active ? s.pillActive : null]}
  >
    <Text style={[s.pillText, active ? s.pillTextActive : null]}>{label}</Text>
  </TouchableOpacity>
);

const s = StyleSheet.create({
  sectionTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 6,
  },
  card: {
    backgroundColor: "#121418",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#232a34",
  },
  statLabel: {
    color: "#9aa0a6",
    fontSize: 14,
  },
  statValue: {
    color: "white",
    fontWeight: "700",
    fontSize: 16,
  },
  linkBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  linkBtnText: {
    color: "#6EE7B7",
    fontWeight: "700",
    fontSize: 14,
  },
  primaryBtn: {
    backgroundColor: "#6EE7B7",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  primaryBtnText: {
    color: "#0b0c0f",
    fontWeight: "800",
    fontSize: 14,
  },
  ghostBtn: {
    backgroundColor: "#1b222c",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2c3440",
  },
  ghostBtnText: {
    color: "white",
    fontWeight: "700",
    fontSize: 14,
  },
  pill: {
    backgroundColor: "#141922",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#232a34",
  },
  pillActive: {
    backgroundColor: "#1f2937",
    borderColor: "#6EE7B7",
  },
  pillText: {
    color: "#9aa0a6",
    fontWeight: "600",
    fontSize: 13,
  },
  pillTextActive: {
    color: "#6EE7B7",
  },
});
