// components/GarageCoachmark.tsx
// One-time wayfinding card for the Bike Home restructure: setups moved into
// the Garage. Styled as a compact feature card (icon chip + title + line),
// not a system message. Shows once per install (AsyncStorage flag).

import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

const SEEN_KEY = "garage_home_coachmark_v1";

export function GarageCoachmark() {
  const { colors: C } = useTheme();
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(SEEN_KEY);
        if (mounted && !seen) setVisible(true);
      } catch {
        // fail-silent
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const markSeen = () => {
    setVisible(false);
    AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {});
  };

  if (!visible) return null;

  return (
    <View style={[styles.card, { backgroundColor: C.CARD }]}>
      <View
        style={[styles.iconCircle, { backgroundColor: "rgba(29,155,240,0.14)" }]}
      >
        <Ionicons name="bicycle" size={18} color={C.ACCENT} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: C.TEXT }]}>
          Setups live in your Garage now
        </Text>
        <Text style={[styles.body, { color: C.MUTED }]}>
          Tap your bike to refine, see history, and manage tunes.
        </Text>
        <Pressable
          onPress={() => {
            markSeen();
            router.push("/(tabs)/garage" as any);
          }}
          hitSlop={6}
          style={styles.actionLink}
        >
          <Text style={[styles.actionText, { color: C.ACCENT }]}>
            Go to Garage →
          </Text>
        </Pressable>
      </View>

      <Pressable onPress={markSeen} hitSlop={10} style={styles.closeBtn}>
        <Ionicons name="close" size={16} color={C.MUTED} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 14,
    fontWeight: "800",
  },
  body: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  actionLink: {
    alignSelf: "flex-start",
    marginTop: 8,
  },
  actionText: {
    fontSize: 12,
    fontWeight: "800",
  },
  closeBtn: {
    padding: 2,
  },
});
