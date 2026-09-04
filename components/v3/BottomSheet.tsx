// components/v3/BottomSheet.tsx
// Minimal modal sheet in the v3 palette (Panel Dark, 22 radius, handle).
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { H1 } from "./primitives";
import { V3 } from "./theme";

export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={open} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.handle} />
        {title ? <H1 style={{ fontSize: 26, lineHeight: 26, marginBottom: 12 }}>{title}</H1> : null}
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)" },
  sheet: {
    backgroundColor: V3.panel,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: "86%",
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: V3.line, marginBottom: 14 },
});
