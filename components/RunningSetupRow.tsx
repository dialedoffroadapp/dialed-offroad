// components/RunningSetupRow.tsx
// Compact pointer under the tune tab's bike selector: "Running v4 · Refine
// after ride →". One line, one tap, routes to Bike Home — the tune tab is for
// generating; managing setups lives in the garage.

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { isUuid } from "../lib/uuid";

export function RunningSetupRow({ bikeId }: { bikeId: string }) {
  const { colors: C } = useTheme();
  const router = useRouter();
  const [versionNumber, setVersionNumber] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          if (!isUuid(bikeId)) {
            if (!cancelled) setVersionNumber(null);
            return;
          }
          const { data } = await supabase
            .from("setup_versions")
            .select("version_number")
            .eq("bike_id", bikeId)
            .order("version_number", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!cancelled) {
            setVersionNumber(
              typeof data?.version_number === "number"
                ? data.version_number
                : null
            );
          }
        } catch {
          if (!cancelled) setVersionNumber(null);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [bikeId])
  );

  if (versionNumber === null) return null;

  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: "/bike-home", params: { bikeId } } as any)
      }
      style={[styles.row, { backgroundColor: C.CARD }]}
    >
      <Ionicons name="speedometer-outline" size={15} color={C.ACCENT} />
      <Text style={[styles.text, { color: C.TEXT }]} numberOfLines={1}>
        Running v{versionNumber}
        <Text style={{ color: C.MUTED }}> · </Text>
        <Text style={{ color: C.ACCENT }}>Refine after ride →</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
  },
});
