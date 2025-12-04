// app/feedback.tsx
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../lib/theme";

export default function FeedbackScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const S = useMemo(() => makeStyles(colors), [colors]);

  const handleEmail = async () => {
    const subject = encodeURIComponent("Dialed Offroad – Feedback or Suggestion");
    const body = encodeURIComponent(
      "Hey Dialed Offroad team,\n\nHere’s my feedback or suggestion:\n\n"
    );
    const email = `mailto:support@dialedoffroad.com?subject=${subject}&body=${body}`;

    const canOpen = await Linking.canOpenURL(email);
    if (canOpen) Linking.openURL(email);
  };

  return (
    <View style={[S.container, { paddingTop: insets.top + 20 }]}>
      <Ionicons name="chatbubbles-outline" size={42} color={colors.ACCENT} />
      <Text style={S.title}>We’d love your input</Text>
      <Text style={S.subtitle}>
        Have ideas for features or improvements? Tap below to email us directly.
      </Text>

      <Pressable onPress={handleEmail} style={S.button}>
        <Text style={S.buttonText}>Send Feedback</Text>
      </Pressable>

      <Text style={S.footer}>
        Your ideas help make Dialed Offroad better for every rider 🤘
      </Text>
    </View>
  );
}

const makeStyles = (C: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: C.BG,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    title: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 22,
      marginTop: 12,
    },
    subtitle: {
      color: C.MUTED,
      fontSize: 14,
      textAlign: "center",
      marginVertical: 10,
      lineHeight: 20,
    },
    button: {
      backgroundColor: C.ACCENT,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 10,
      marginTop: 14,
    },
    buttonText: {
      color: "#fff",
      fontWeight: "800",
      fontSize: 16,
    },
    footer: {
      color: C.MUTED,
      fontSize: 12,
      textAlign: "center",
      marginTop: 16,
    },
  });
