// components/GarageCoachmark.tsx
// One-time wayfinding banner for the Bike Home restructure: setups moved into
// the Garage, and users coming from older builds need one pointer. Shows once
// per install (AsyncStorage flag), dismissible.

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
    <View style={[styles.banner, { backgroundColor: C.CARD, borderLeftColor: C.ACCENT }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.text, { color: C.TEXT }]}>
          Your setups now live in your Garage — tap your bike to refine, view
          history, and manage tunes.
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
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 12,
    borderLeftWidth: 3,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  text: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
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
    marginLeft: 8,
    padding: 2,
  },
});
