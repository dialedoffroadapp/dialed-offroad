// app/my-presets.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ThemeTokens } from "../constants/theme";
import { RADIUS, SPACING } from "../constants/theme";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";

type MyPreset = {
  id: string;
  name: string;
  track_name: string | null;
  terrain: string[] | null;
  tune: any;
  created_at: string;
};

export default function MyPresetsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [items, setItems] = useState<MyPreset[]>([]);

  const load = async () => {
    const { data, error } = await supabase
      .from("user_presets")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) setItems((data as MyPreset[]) || []);
  };

  useEffect(() => {
    load();
  }, []);

  const onDelete = async (id: string) => {
    Alert.alert("Delete preset?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await supabase.from("user_presets").delete().eq("id", id);
          load();
        },
      },
    ]);
  };

  const onLoadToTune = (p: MyPreset) => {
    router.push({
      pathname: "/(tabs)/tune",
      params: {
        preset: encodeURIComponent(
          JSON.stringify({ slug: p.id, tune: p.tune })
        ),
      },
    });
  };

  const Item = ({ p }: { p: MyPreset }) => (
    <View style={styles.card}>
      <Text style={styles.name}>{p.name}</Text>
      <Text style={styles.meta}>
        {p.track_name ? p.track_name : "No track"}
        {p.terrain?.length ? ` • ${p.terrain.join(" / ")}` : ""}
      </Text>
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={() => onLoadToTune(p)}>
          <Text style={styles.btnText}>Load to Tune</Text>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </Pressable>
        <Pressable style={styles.btnDanger} onPress={() => onDelete(p.id)}>
          <Ionicons name="trash-outline" size={16} color="#fff" />
          <Text style={styles.btnDangerText}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: insets.top + 6,
        },
      ]}
    >
      {/* Header with back button */}
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={18} color={colors.TEXT} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>My Presets</Text>
        {/* spacer to balance the row */}
        <View style={{ width: 56 }} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        renderItem={({ item }) => <Item p={item} />}
        contentContainerStyle={{ paddingBottom: 40, gap: 12 }}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.BG,
      paddingHorizontal: 16,
    },

    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 10,
      justifyContent: "space-between",
    },
    backBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.BORDER,
      backgroundColor: colors.CHIP_BG ?? "rgba(0,0,0,0.04)",
    },
    backText: { color: colors.TEXT, fontWeight: "800" },

    title: { color: colors.TEXT, fontSize: 22, fontWeight: "800" },

    card: {
      backgroundColor: colors.CARD,
      borderWidth: 1,
      borderColor: colors.BORDER,
      borderRadius: RADIUS.lg,
      padding: SPACING.md,
    },
    name: { color: colors.TEXT, fontWeight: "900", fontSize: 16 },
    meta: { color: colors.MUTED, marginTop: 4, fontSize: 12 },
    row: { flexDirection: "row", gap: 10, marginTop: 10 },

    btn: {
      flex: 1,
      backgroundColor: colors.ACCENT,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    btnText: { color: "#fff", fontWeight: "900" },

    // Red delete button
    btnDanger: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: colors.ERROR,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: colors.BORDER_SUBTLE ?? "rgba(255,255,255,0.10)",
    },
    btnDangerText: { color: "#fff", fontWeight: "900" },
  });
