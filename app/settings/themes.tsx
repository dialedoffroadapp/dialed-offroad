import Ionicons from "@expo/vector-icons/Ionicons";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS } from "../../constants/theme";
import { supabase } from "../../lib/supabase";
import { applyTheme, listThemes, ThemeKey } from "../../lib/themeManager";

export default function ThemesScreen() {
  const [isPro, setIsPro] = useState(false);
  const [active, setActive] = useState<ThemeKey>("default");

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return;
      const { data } = await supabase
        .from("profiles")
        .select("pro_until, theme_key")
        .eq("user_id", uid)
        .maybeSingle<{ pro_until: string | null; theme_key: ThemeKey | null }>();
      const pro = !!data?.pro_until && new Date(data.pro_until).getTime() > Date.now();
      setIsPro(pro);
      if (data?.theme_key) {
        setActive(data.theme_key);
        applyTheme(data.theme_key);
      }
    })();
  }, []);

  const onPick = async (key: ThemeKey) => {
    if (!isPro) return;
    setActive(key);
    applyTheme(key);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (uid) {
      await supabase.from("profiles").update({ theme_key: key }).eq("user_id", uid);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.BG, padding: 16 }}>
      <Text style={styles.title}>Themes {isPro ? "" : "(Pro)"}</Text>
      <View style={styles.grid}>
        {listThemes().map((t) => {
          const locked = !isPro;
          const selected = active === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => (locked ? null : onPick(t.key))}
              style={[
                styles.card,
                selected && { borderColor: COLORS.ACCENT },
                locked && { opacity: 0.6 },
              ]}
            >
              <View style={styles.swatchRow}>
                <View style={[styles.swatch, { backgroundColor: COLORS.ACCENT }]} />
                <View style={[styles.swatch, { backgroundColor: COLORS.CARD }]} />
                <View style={[styles.swatch, { backgroundColor: COLORS.ACCENT2 || COLORS.ACCENT }]} />
              </View>
              <View style={styles.row}>
                <Text style={styles.name}>{t.label}</Text>
                {locked ? (
                  <Ionicons name="lock-closed-outline" color={COLORS.MUTED} size={16} />
                ) : selected ? (
                  <Ionicons name="checkmark-circle" color={COLORS.ACCENT} size={18} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {!isPro && (
        <Pressable onPress={() => (window as any).router?.push?.("/premium")} style={styles.upgrade}>
          <Text style={styles.upgradeText}>Unlock Themes with Pro</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: COLORS.TEXT, fontSize: 22, fontWeight: "900", marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: {
    width: "47%",
    backgroundColor: COLORS.CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    padding: 12,
  },
  swatchRow: { flexDirection: "row", gap: 6, marginBottom: 10 },
  swatch: { height: 16, borderRadius: 4, flex: 1 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { color: COLORS.TEXT, fontWeight: "800" },
  upgrade: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.ACCENT,
    paddingVertical: 12,
    alignItems: "center",
  },
  upgradeText: { color: COLORS.ACCENT, fontWeight: "900" },
});
