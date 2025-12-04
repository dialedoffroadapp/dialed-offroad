import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS, RADIUS } from "../constants/theme";

export function RiskGate({
  visible,
  onAccept,
  onCancel,
}: {
  visible: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade">
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.card}>
        <Text style={styles.title}>Assumption of Risk</Text>
        <Text style={styles.body}>
          Suspension changes can affect vehicle control. By continuing you agree that:
          {"\n"}• Suggestions are informational only (not professional advice)
          {"\n"}• You will verify against your owner’s manual & torque specs
          {"\n"}• You will test changes in a safe environment
          {"\n"}• You are solely responsible for your own safety
        </Text>

        <View style={{ height: 12 }} />
        <Pressable onPress={onAccept} style={styles.btnPrimary}>
          <Text style={styles.btnPrimaryText}>I Agree</Text>
        </Pressable>
        <View style={{ height: 8 }} />
        <Pressable onPress={onCancel} style={styles.btnGhost}>
          <Text style={styles.btnGhostText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: COLORS.OVERLAY },
  card: {
    position: "absolute",
    left: "7%",
    right: "7%",
    top: "22%",
    backgroundColor: COLORS.CARD,
    borderColor: COLORS.BORDER,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: 16,
  },
  title: { color: COLORS.TEXT, fontWeight: "900", fontSize: 18, marginBottom: 6 },
  body: { color: COLORS.TEXT, lineHeight: 20 },
  btnPrimary: {
    backgroundColor: COLORS.ACCENT,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnPrimaryText: { color: "#fff", fontWeight: "900" },
  btnGhost: {
    borderColor: COLORS.BORDER,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnGhostText: { color: COLORS.TEXT, fontWeight: "800" },
});
