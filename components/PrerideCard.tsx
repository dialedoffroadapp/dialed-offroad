// components/PrerideCard.tsx
// Pre-ride reminder: "Running v4 on the 2024 KTM 350 SX-F" + a compact values
// line. Tap the values to copy them; quiet link into Setup History (the Pro
// gate applies on arrival, not here). Shows at most once per 20 hours
// (AsyncStorage preride_shown_at). The host screen only renders this when the
// outcome check-in card is NOT showing — check-in always wins.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useToast } from "./Toast";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { logEvent } from "../lib/usage";

const PRERIDE_KEY = "preride_shown_at";
const WINDOW_MS = 20 * 60 * 60 * 1000;

type PrerideData = {
  bikeId: string;
  bikeTitle: string;
  versionNumber: number;
  valuesLine: string;
};

const part = (v: unknown, digits = 0): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";

function buildValuesLine(v: any): string {
  return [
    `Fork ${part(v.fork_comp_clicks)}/${part(v.fork_reb_clicks)}`,
    `Shock ${part(v.shock_lsc_clicks)}/${part(v.shock_hsc_turns, 1)}/${part(
      v.shock_reb_clicks
    )}`,
    `Sag ${part(v.sag_mm)}`,
  ].join(" · ");
}

export function PrerideCard() {
  const { colors: C } = useTheme();
  const router = useRouter();
  const toast = useToast();

  const [data, setData] = useState<PrerideData | null>(null);
  const checkedRef = useRef(false);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!data) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [data, opacity]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          if (checkedRef.current || data) return;
          checkedRef.current = true;

          const { data: auth } = await supabase.auth.getUser();
          if (!auth?.user?.id) return; // signed-in only

          const raw = await AsyncStorage.getItem(PRERIDE_KEY);
          const shownAt = raw ? Number(raw) : 0;
          if (Number.isFinite(shownAt) && Date.now() - shownAt < WINDOW_MS) {
            return;
          }

          // Newest version across all garage bikes = the most recently
          // updated bike's current setup.
          const { data: version, error } = await supabase
            .from("setup_versions")
            .select(
              "id, bike_id, version_number, fork_comp_clicks, fork_reb_clicks, shock_lsc_clicks, shock_hsc_turns, shock_reb_clicks, sag_mm"
            )
            .eq("user_id", auth.user.id)
            .not("bike_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error || !version?.bike_id || cancelled) return;

          const { data: bike } = await supabase
            .from("bikes")
            .select("make, model, year")
            .eq("id", version.bike_id)
            .maybeSingle();
          if (cancelled) return;

          const bikeTitle =
            [bike?.year, bike?.make, bike?.model].filter(Boolean).join(" ") ||
            "your bike";

          setData({
            bikeId: version.bike_id,
            bikeTitle,
            versionNumber: version.version_number,
            valuesLine: buildValuesLine(version),
          });
          AsyncStorage.setItem(PRERIDE_KEY, String(Date.now())).catch(() => {});
          void logEvent("preride_shown", {
            bike_id: version.bike_id,
            version_number: version.version_number,
          });
        } catch {
          // fail-silent — never disturb the tune flow
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [data])
  );

  const onCopy = async () => {
    if (!data) return;
    try {
      await Clipboard.setStringAsync(
        `${data.bikeTitle} — v${data.versionNumber}: ${data.valuesLine}`
      );
      toast.show("Setup copied", { kind: "success" });
      void logEvent("preride_copied", { bike_id: data.bikeId });
    } catch {
      // clipboard failure isn't worth surfacing
    }
  };

  const onHistory = () => {
    if (!data) return;
    void logEvent("preride_history_tapped", { bike_id: data.bikeId });
    router.push({
      pathname: "/setup-history",
      params: { bikeId: data.bikeId },
    } as any);
  };

  const onDismiss = () => {
    // Dismiss just resets the 20h timer.
    AsyncStorage.setItem(PRERIDE_KEY, String(Date.now())).catch(() => {});
    setData(null);
  };

  if (!data) return null;

  return (
    <Animated.View style={[styles.card, { backgroundColor: C.CARD, opacity }]}>
      <View style={styles.topRow}>
        <Text style={[styles.title, { color: C.TEXT }]} numberOfLines={1}>
          Running v{data.versionNumber} on the {data.bikeTitle}
        </Text>
        <Pressable onPress={onDismiss} hitSlop={10} style={styles.closeBtn}>
          <Ionicons name="close" size={16} color={C.MUTED} />
        </Pressable>
      </View>

      <Pressable onPress={onCopy} hitSlop={4}>
        <Text style={[styles.values, { color: C.TEXT }]}>{data.valuesLine}</Text>
      </Pressable>

      <Pressable onPress={onHistory} hitSlop={6} style={styles.historyLink}>
        <Text style={[styles.historyText, { color: C.ACCENT }]}>
          Full history →
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  closeBtn: {
    marginLeft: 8,
    padding: 2,
  },
  values: {
    fontSize: 13,
    fontWeight: "600",
    opacity: 0.85,
    marginTop: 6,
    fontVariant: ["tabular-nums"],
  },
  historyLink: {
    alignSelf: "flex-start",
    marginTop: 8,
  },
  historyText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
