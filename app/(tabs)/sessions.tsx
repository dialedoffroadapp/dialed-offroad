// app/(tabs)/sessions.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../../components/Toast";
import type { ThemeTokens } from "../../constants/theme";
import { useOnboarding } from "../../lib/onboarding";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";

/* ---------------------------- Brand accent color --------------------------- */
const BRAND_ACCENTS: Record<string, string> = {
  KTM: "#FF7A1A",
  Kawasaki: "#46C25B",
  Yamaha: "#3F7FFF",
  Honda: "#FF4D4F",
  Husqvarna: "#294A9D",
  GasGas: "#E53131",
  Suzuki: "#F2D13D",
  Beta: "#E62B2B",
  Sherco: "#2B61FF",
  "TM Racing": "#2B9CFF",
};

const hexToRgba = (hex: string, a: number) => {
  const n = hex.replace("#", "");
  const bigint = parseInt(
    n.length === 3 ? n.split("").map((c) => c + c).join("") : n,
    16
  );
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

type SessionRow = {
  id: string;
  rode_on: string | null;
  surface: string | null;
  track: string | null;
  temp_f: number | null;
  elev_ft: number | null;
  fork_comp: number | null;
  fork_reb: number | null;
  shock_comp: number | null;
  shock_reb: number | null;
  sag_mm: number | null;
  notes: string | null;
  bikes: {
    id: string;
    make: string | null;
    model: string | null;
    year: number | null;
    nickname: string | null;
  } | null;
};

export default function SessionsScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { onboardingActive, state } = useOnboarding();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user?.id) {
        setRows([]);
        return;
      }

      const { data, error } = await supabase
        .from("sessions")
        .select(
          `
          id, rode_on, surface, track, temp_f, elev_ft,
          fork_comp, fork_reb, shock_comp, shock_reb, sag_mm, notes,
          bikes:bike_id ( id, make, model, year, nickname )
        `
        )
        .eq("user_id", user.id)
        .order("rode_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      setRows((data as any) ?? []);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load sessions", { kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const bikeTitle = (r: SessionRow) => {
    const b = r.bikes;
    if (!b) return "Bike";
    const name = [b.year, b.make, b.model].filter(Boolean).join(" ");
    return b.nickname ? `${b.nickname} · ${name}` : name || "Bike";
  };

  const confirmDelete = (id: string) => setDeletingId(id);

  const actuallyDelete = async () => {
    const id = deletingId;
    if (!id) return;
    try {
      const { error } = await supabase.from("sessions").delete().eq("id", id);
      if (error) throw error;
      setRows((x) => x.filter((r) => r.id !== id));
      toast.show("Session deleted", { kind: "success" });
    } catch (e: any) {
      toast.show(e?.message ?? "Delete failed", { kind: "error" });
    } finally {
      setDeletingId(null);
    }
  };

  const renderItem = ({ item }: { item: SessionRow }) => {
    const date = item.rode_on
      ? new Date(item.rode_on).toLocaleDateString()
      : "—";
    const accent = BRAND_ACCENTS[item.bikes?.make ?? ""] ?? "#3A3F4C";
    const subtitle = [date, item.surface ? cap(item.surface) : null]
      .filter(Boolean)
      .join(" · ");

    return (
      <Pressable
        onPress={() =>
          router.push({ pathname: "sessions/[id]", params: { id: item.id } })
        }
        style={({ pressed }) => [
          styles.card,
          pressed && { opacity: 0.94 },
        ]}
      >
        {/* Header: brand chip + title/subtitle + overflow */}
        <View style={styles.cardHeader}>
          <View
            style={[
              styles.brandChip,
              { backgroundColor: hexToRgba(accent, 0.14) },
            ]}
          >
            <Ionicons name="bicycle" size={20} color={accent} />
          </View>
          <View style={styles.cardTitleWrap}>
            <Text
              style={styles.bikeName}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {bikeTitle(item)}
            </Text>
            <Text style={styles.cardSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          <Pressable
            onPress={(e: any) => {
              e?.stopPropagation?.();
              confirmDelete(item.id);
            }}
            style={styles.overflowBtn}
            hitSlop={12}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={18}
              color={colors.MUTED}
            />
          </Pressable>
        </View>

        {/* Stat boxes */}
        <View style={styles.statsRow}>
          <StatBox label="F Comp" value={item.fork_comp} styles={styles} />
          <StatBox label="F Reb" value={item.fork_reb} styles={styles} />
          <StatBox label="S LSC" value={item.shock_comp} styles={styles} />
          <StatBox label="S Reb" value={item.shock_reb} styles={styles} />
          <StatBox
            label="Sag"
            value={item.sag_mm}
            accent={accent}
            styles={styles}
          />
        </View>

        {/* View session button */}
        <Pressable
          onPress={() =>
            router.push({ pathname: "sessions/[id]", params: { id: item.id } })
          }
          style={[styles.viewBtn, { backgroundColor: accent }]}
        >
          <Text style={styles.viewBtnText}>View session</Text>
        </Pressable>
      </Pressable>
    );
  };

  // Trial step — sessions are locked until the user subscribes.
  if (onboardingActive && state.onboardingStep === "trial") {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <Text style={styles.headerTitleSolo}>My Sessions</Text>
        <View style={styles.emptyWrap}>
          <Ionicons
            name="time-outline"
            size={40}
            color={colors.MUTED}
            style={{ marginBottom: 14 }}
          />
          <Text style={styles.emptyTitle}>Your sessions are waiting</Text>
          <Text style={styles.emptySub}>
            Start your free trial to save and revisit every tune.
          </Text>
          <View style={{ height: 20 }} />
          <Pressable
            onPress={() => router.push("/premium")}
            style={styles.btnPrimary}
          >
            <Text style={styles.btnPrimaryText}>Start Free Trial</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      {/* Header with count pill */}
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>My Sessions</Text>
        {rows.length > 0 && (
          <View style={styles.countPill}>
            <Text style={styles.countText}>{rows.length}</Text>
          </View>
        )}
      </View>

      {loading && rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={colors.TEXT} />
          <Text style={styles.emptyTitle}>Loading sessions…</Text>
          <Text style={styles.emptySub}>
            We'll show your ride history here.
          </Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No Sessions Yet</Text>
          <Text style={styles.emptySub}>
            Generate a tune and save it as a session to start your history.
          </Text>
          <View style={{ height: 12 }} />
          <Pressable
            onPress={() => router.push("/(tabs)/tune")}
            style={styles.btnPrimary}
          >
            <Text style={styles.btnPrimaryText}>Generate a Tune</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              tintColor={colors.TEXT}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          }
        />
      )}

      {/* Delete confirm modal */}
      {deletingId && (
        <View style={styles.modalWrap} pointerEvents="box-none">
          <Pressable
            style={styles.backdrop}
            onPress={() => setDeletingId(null)}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete session?</Text>
            <Text style={styles.modalSub}>This can't be undone.</Text>
            <View style={{ height: 16 }} />
            <View style={styles.modalFooter}>
              <Pressable
                onPress={() => setDeletingId(null)}
                style={styles.btnCancel}
              >
                <Text style={styles.btnCancelText}>Cancel</Text>
              </Pressable>
              <View style={{ width: 10 }} />
              <Pressable onPress={actuallyDelete} style={styles.btnDanger}>
                <Text style={styles.btnDangerText}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

/* -------------------------------- Components -------------------------------- */

function StatBox({
  label,
  value,
  accent,
  styles,
}: {
  label: string;
  value: number | null;
  accent?: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  const display = typeof value === "number" ? `${value}` : "—";
  return (
    <View
      style={[
        styles.statBox,
        accent
          ? { backgroundColor: hexToRgba(accent, 0.1) }
          : undefined,
      ]}
    >
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        style={[
          styles.statValue,
          accent ? { color: accent } : undefined,
        ]}
      >
        {display}
      </Text>
    </View>
  );
}

function cap(s: string) {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

/* --------------------------------- Styles --------------------------------- */

const makeStyles = (C: ThemeTokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: C.BG,
    },

    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginLeft: 18,
      marginBottom: 4,
      gap: 10,
    },
    headerTitle: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 22,
    },
    headerTitleSolo: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 22,
      marginLeft: 18,
      marginBottom: 4,
    },
    countPill: {
      backgroundColor: C.CHIP_BG ?? "rgba(255,255,255,0.05)",
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    countText: {
      color: C.MUTED,
      fontWeight: "800",
      fontSize: 12,
    },

    emptyWrap: {
      flex: 1,
      backgroundColor: C.BG,
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
    },
    emptyTitle: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 18,
      marginTop: 12,
    },
    emptySub: {
      color: C.MUTED,
      marginTop: 6,
      textAlign: "center",
    },

    /* ---- Card ---- */
    card: {
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 16,
      padding: 14,
    },

    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
    },
    brandChip: {
      width: 42,
      height: 42,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    cardTitleWrap: {
      flex: 1,
      marginLeft: 12,
      minWidth: 0,
    },
    bikeName: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 15,
    },
    cardSubtitle: {
      color: C.MUTED,
      fontSize: 12,
      marginTop: 2,
    },
    overflowBtn: {
      width: 34,
      height: 34,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
    },

    /* ---- Stat boxes ---- */
    statsRow: {
      flexDirection: "row",
      gap: 6,
      marginTop: 12,
    },
    statBox: {
      flex: 1,
      backgroundColor: C.CHIP_BG ?? "rgba(255,255,255,0.05)",
      borderRadius: 8,
      paddingVertical: 8,
      alignItems: "center",
    },
    statLabel: {
      color: C.MUTED,
      fontWeight: "700",
      fontSize: 10,
      marginBottom: 2,
    },
    statValue: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 14,
    },

    /* ---- View button ---- */
    viewBtn: {
      borderRadius: 10,
      paddingVertical: 11,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 12,
    },
    viewBtnText: {
      color: "#fff",
      fontWeight: "800",
      fontSize: 13,
    },

    /* ---- Primary button (empty/trial states) ---- */
    btnPrimary: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 13,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    btnPrimaryText: { color: "#fff", fontWeight: "900" },

    /* ---- Confirm modal ---- */
    modalWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "center",
      alignItems: "center",
      zIndex: 1000,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: C.OVERLAY,
    },
    modalCard: {
      width: "86%",
      backgroundColor: C.CARD,
      borderColor: C.BORDER,
      borderWidth: 1,
      borderRadius: 16,
      padding: 20,
    },
    modalTitle: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 17,
    },
    modalSub: { color: C.MUTED, marginTop: 4, fontSize: 14 },
    modalFooter: {
      flexDirection: "row",
      alignItems: "center",
    },
    btnCancel: {
      borderColor: C.BORDER,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
      flex: 1,
    },
    btnCancelText: { color: C.TEXT, fontWeight: "800" },
    btnDanger: {
      backgroundColor: C.ERROR,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    btnDangerText: { color: "#fff", fontWeight: "900" },
  });
