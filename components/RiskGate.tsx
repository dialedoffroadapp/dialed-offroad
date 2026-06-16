import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

const ACCENT = "#1D9BF0";

export function RiskGate({
  visible,
  onAccept,
  onCancel,
}: {
  visible: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const bullets = [
    "Suggestions are informational only (not professional advice)",
    "You will verify against your owner's manual & torque specs",
    "You will test changes in a safe environment",
    "You are solely responsible for your own safety",
  ];

  return (
    <Modal transparent visible={visible} animationType="slide">
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Assumption of Risk</Text>
        <Text style={styles.intro}>
          Suspension changes can affect vehicle control. By continuing you agree that:
        </Text>
        <View style={styles.bulletCard}>
          {bullets.map((b, i) => (
            <View key={i} style={[styles.bulletRow, i > 0 && { marginTop: 8 }]}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>{b}</Text>
            </View>
          ))}
        </View>
        <Pressable onPress={onAccept} style={styles.btnPrimary}>
          <Text style={styles.btnPrimaryText}>I Agree</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.btnCancel}>
          <Text style={styles.btnCancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)" },
  sheet: {
    backgroundColor: "#111318",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 16,
    paddingBottom: 32,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginBottom: 14,
  },
  title: {
    color: "#F5F7FC",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  intro: {
    color: "#6B7280",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10,
  },
  bulletCard: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: ACCENT,
    marginTop: 7,
    flexShrink: 0,
  },
  bulletText: {
    color: "#9CA3AF",
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  btnPrimary: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: { color: "#fff", fontWeight: "900", fontSize: 16 },
  btnCancel: {
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  btnCancelText: { color: "#4B5563", fontSize: 14, fontWeight: "700" },
});
