// components/SagSaveModal.tsx
// Optional race-sag entry in front of the session save flows (tune-results,
// tune-two-results). Sag in `sessions` is a rider MEASUREMENT (v2.4.0): the
// field is empty by default — no engine prefill, no carry-forward — and
// saving blank is normal (sag_mm null + sag_measured false downstream). The
// engine's recommended sag already lives on the setup_version.

import React, { useMemo, useState } from "react";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "../lib/theme";

// Sanity bounds so fat-finger values don't poison fleet data.
export const SAG_MIN_MM = 50;
export const SAG_MAX_MM = 150;

/** Parse the field: null = left blank (fine), number = valid measurement,
 *  "invalid" = present but outside sanity bounds / not a number. */
export function parseSagInput(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (!t.length) return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n) || n < SAG_MIN_MM || n > SAG_MAX_MM) return "invalid";
  return Math.round(n);
}

export function SagSaveModal({
  visible,
  title = "Save this setup",
  onCancel,
  onSave,
}: {
  visible: boolean;
  title?: string;
  onCancel: () => void;
  /** sagMm is null when the rider left the field blank. */
  onSave: (sagMm: number | null) => void;
}) {
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const parsed = parseSagInput(value);
    if (parsed === "invalid") {
      setError(
        `Sag is usually ${SAG_MIN_MM} to ${SAG_MAX_MM} mm. Fix the value or leave it blank.`
      );
      return;
    }
    setError(null);
    Keyboard.dismiss();
    onSave(parsed);
  };

  const cancel = () => {
    setError(null);
    Keyboard.dismiss();
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={S.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel} />
        <View style={S.card}>
          <Text style={S.title}>{title}</Text>
          <Text style={S.label}>Race sag (mm), if you measured it</Text>
          <TextInput
            value={value}
            onChangeText={(t) => {
              setValue(t);
              if (error) setError(null);
            }}
            placeholder="Optional"
            placeholderTextColor={C.MUTED}
            keyboardType="numeric"
            style={S.input}
            returnKeyType="done"
            onSubmitEditing={submit}
            accessibilityLabel="Race sag in millimeters, optional"
          />
          {error ? <Text style={S.error}>{error}</Text> : null}
          <View style={S.row}>
            <Pressable style={[S.btnGhost, { flex: 1 }]} onPress={cancel}>
              <Text style={S.btnGhostText}>Cancel</Text>
            </Pressable>
            <View style={{ width: 8 }} />
            <Pressable style={[S.btnPrimary, { flex: 1 }]} onPress={submit}>
              <Text style={S.btnPrimaryText}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (C: any) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      padding: 16,
    },
    card: {
      backgroundColor: C.CARD,
      borderColor: C.BORDER,
      borderWidth: 1,
      borderRadius: 16,
      padding: 16,
    },
    title: { color: C.TEXT, fontSize: 16, fontWeight: "900", marginBottom: 10 },
    label: { color: C.MUTED, fontSize: 13, fontWeight: "700", marginBottom: 8 },
    input: {
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INPUT_BG ?? "#0C1222",
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 10 : 8,
      fontSize: 16,
      color: C.TEXT,
      marginBottom: 8,
    },
    error: { color: "#F87171", fontSize: 12.5, fontWeight: "700", marginBottom: 8 },
    row: { flexDirection: "row", alignItems: "center", marginTop: 4 },
    btnGhost: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: "transparent",
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    btnGhostText: { color: C.TEXT, fontWeight: "800" },
    btnPrimary: {
      backgroundColor: C.ACCENT,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    btnPrimaryText: { color: "#fff", fontWeight: "900" },
  });
