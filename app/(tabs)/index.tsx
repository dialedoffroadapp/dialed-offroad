// app/(tabs)/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useToast } from "../../components/Toast";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  pro_until: string | null;
};

type LastSession = {
  id: string;
  created_at: string;
  rode_on: string | null;
  surface: string | null;
  track: string | null;
  temp_f: number | null;
  elev_ft: number | null;
  bike_id: string | null;
  notes: string | null;
  fork_comp: number | null;
  fork_reb: number | null;
  shock_comp: number | null;
  shock_reb: number | null;
  sag_mm: number | null;
  bikes: {
    make: string;
    model: string;
    year: number | null;
    nickname: string | null;
  } | null;
};

type UserPreset = {
  id: string;
  created_at: string;
  name: string;
  track_name: string | null;
  terrain: string[] | null;
  bike_hint?: { year: number | null; make: string | null; model: string | null } | null;
  tune: any;
};

export default function HomeScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();

  // Adapt the old T shim to our new tokens so we don't rewrite every style line
  const t = useMemo(() => {
    return {
      BG: colors.BG,
      CARD: colors.CARD,
      TEXT: colors.TEXT,
      SUBTEXT: colors.MUTED,
      ACCENT: colors.ACCENT,
      ACCENT2: colors.ACCENT,
      ACCENT3: colors.SUCCESS ?? colors.ACCENT,
      BORDER: colors.BORDER,
      BORDER_SUBTLE: colors.BORDER,
      SURFACE_ALT: (colors as any).SURFACE_ALT ?? (colors.INPUT_BG ?? colors.CARD),
      CHIP_BG: "rgba(255,255,255,0.08)",
      TRACK: "rgba(255,255,255,0.10)",
      SUCCESS: colors.SUCCESS,
      ERROR: colors.ERROR,
    };
  }, [colors]);

  const styles = useMemo(() => makeStyles(t), [t]);

  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string>("");

  const [planLabel, setPlanLabel] = useState<"Free" | "Pro">("Free");
  const [isPro, setIsPro] = useState<boolean>(false); // 👈 track Pro for gating

  const [bikeCount, setBikeCount] = useState<number>(0);
  const [lastSession, setLastSession] = useState<LastSession | null>(null);

  // Presets row
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presets, setPresets] = useState<UserPreset[]>([]);
  const [presetsError, setPresetsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setPresetsLoading(true);
      setPresetsError(null);

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user?.id) {
        setDisplayName("");
        setBikeCount(0);
        setLastSession(null);
        setPresets([]);
        setPlanLabel("Free");
        setIsPro(false);
        setLoading(false);
        setPresetsLoading(false);
        return;
      }

      // Profile
      const { data: profile, error: profErr } = await supabase
        .from("profiles")
        .select("display_name, avatar_url, pro_until")
        .eq("user_id", user.id)
        .maybeSingle<ProfileRow>();

      if (profErr) throw profErr;
      setDisplayName(profile?.display_name ?? "");

      const proUntil = profile?.pro_until ? new Date(profile.pro_until).getTime() : 0;
      const isProNow = proUntil > Date.now();
      setPlanLabel(isProNow ? "Pro" : "Free");
      setIsPro(isProNow);

      // Bikes count
      const { count: bikesCount } = await supabase
        .from("bikes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      setBikeCount(bikesCount ?? 0);

      // Last session
      const { data: sessions } = await supabase
        .from("sessions")
        .select(
          "id, created_at, rode_on, surface, track, temp_f, elev_ft, bike_id, notes, fork_comp, fork_reb, shock_comp, shock_reb, sag_mm, bikes:bike_id ( make, model, year, nickname )"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      setLastSession((sessions?.[0] as unknown as LastSession) ?? null);

      // Presets
      const { data: presetRows, error: pErr } = await supabase
        .from("user_presets")
        .select("id, created_at, name, track_name, terrain, bike_hint, tune")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8);

      if (pErr) throw pErr;
      setPresets((presetRows as UserPreset[]) ?? []);
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load dashboard", { kind: "error" });
      setPresetsError(e?.message ?? "Failed to load presets");
    } finally {
      setLoading(false);
      setPresetsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const firstName = displayName?.trim().split(" ")[0] || "Rider";

  // Local subcomponents so they can see `t`/`styles`
  function SectionHeader({
    icon,
    title,
    right,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    right?: React.ReactNode;
  }) {
    return (
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name={icon} size={16} color={t.SUBTEXT} />
          <Text style={styles.h2}>{title}</Text>
        </View>
        {right ? <View>{right}</View> : null}
      </View>
    );
  }

  function Action({
    title,
    icon,
    onPress,
    accent,
  }: {
    title: string;
    icon: any;
    onPress: () => void;
    accent?: boolean;
  }) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.action,
          accent ? styles.actionAccent : null,
          pressed && { opacity: 0.95 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <Ionicons name={icon} size={20} color={accent ? "#fff" : t.ACCENT2} />
        <Text style={[styles.actionText, accent ? { color: "#fff" } : null]} numberOfLines={1}>
          {title}
        </Text>
      </Pressable>
    );
  }

  function Meter({
    label,
    value,
    max,
  }: {
    label: string;
    value: number | null | undefined;
    max: number;
  }) {
    const pct = Math.max(0, Math.min(1, (Number(value ?? 0) || 0) / max));
    return (
      <View style={{ flex: 1 }}>
        <Text style={styles.meterLabel}>{label}</Text>
        <View style={styles.meterBarOuter}>
          <View style={[styles.meterBarFill, { width: `${pct * 100}%` }]} />
        </View>
        <Text style={styles.meterValue}>{value ?? "—"}</Text>
      </View>
    );
  }

  // Small helper to gate presets
  const handlePresetGate = (cb: () => void) => {
    if (!isPro) {
      toast.show("Pro feature: save and use presets anytime.", { kind: "info" });
      router.push("/premium");
      return;
    }
    cb();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.BG }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            {/* BRAND ROW */}
            <View style={styles.brandRow} accessible accessibilityRole="header">
              <Image
                source={require("../../assets/images/icon.png")}
                style={styles.brandLogo}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
              <Text style={styles.brandWordmark}>
                <Text style={styles.brandDialed}>DIALED</Text>
                <Text style={styles.brandOff}>OFFROAD</Text>
              </Text>
            </View>

            <Text style={styles.hi}>Welcome back, {firstName}</Text>
            <Text style={styles.subtle}>Dial in a setup, then go ride.</Text>
          </View>

          <View style={styles.planBadge}>
            <Text style={styles.planText}>{planLabel}</Text>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.card}>
          <SectionHeader icon="flash-outline" title="Quick Actions" />

          <View style={styles.actionsRow}>
            <Action
              title="Generate Tune"
              icon="flash-outline"
              onPress={() => router.push("/(tabs)/tune")}
              accent
            />
            <Action
              title="Add Bike"
              icon="bicycle-outline"
              onPress={() => router.push("/(tabs)/garage")}
            />
            <Action
              title="View Sessions"
              icon="albums-outline"
              onPress={() => router.push("/(tabs)/sessions")}
            />
          </View>
        </View>

        {/* My Presets */}
        <View style={styles.card}>
          <SectionHeader
            icon="bookmarks-outline"
            title="My Presets"
            right={
              <Pressable
                onPress={() =>
                  handlePresetGate(() => {
                    router.push("/my-presets");
                  })
                }
                style={styles.allBtn}
              >
                <Text style={styles.allBtnText}>View All</Text>
                <Ionicons name="chevron-forward" size={14} color={t.ACCENT2} />
              </Pressable>
            }
          />

          {presetsLoading ? (
            <View style={styles.centerInline}>
              <ActivityIndicator color={t.TEXT} />
              <Text style={styles.muted}>Loading…</Text>
            </View>
          ) : presetsError ? (
            <>
              <Text style={styles.body}>{presetsError}</Text>
              <View style={{ height: 8 }} />
              <Pressable style={styles.btnOutline} onPress={load}>
                <Text style={styles.btnOutlineText}>Retry</Text>
              </Pressable>
            </>
          ) : presets.length === 0 ? (
            <Text style={styles.body}>
              No presets yet. Save a tune as a preset to see it here.
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingRight: 4 }}
            >
              {presets.map((p) => (
                <Pressable
                  key={p.id}
                  style={styles.presetCard}
                  onPress={() =>
                    handlePresetGate(() => {
                      router.navigate({
                        pathname: "/(tabs)/tune",
                        params: {
                          preset: encodeURIComponent(
                            JSON.stringify({
                              id: p.id,
                              name: p.name,
                              track_name: p.track_name,
                              terrain: p.terrain,
                              bike_hint: p.bike_hint ?? null,
                              tune: p.tune,
                            })
                          ),
                          t: String(Date.now()),
                          from: "home",
                        },
                      });
                    })
                  }
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="bookmark" size={14} color={t.TEXT} />
                    <Text style={styles.presetTitle} numberOfLines={1}>
                      {p.name || "Preset"}
                    </Text>
                  </View>
                  <Text style={styles.presetSub} numberOfLines={1}>
                    {p.track_name ? p.track_name : "Custom"}
                    {p.terrain?.[0] ? ` • ${p.terrain[0]}` : ""}
                  </Text>
                  <View style={styles.applyPill}>
                    <Ionicons name="flash" size={12} color="#fff" />
                    <Text style={styles.applyPillText}>Apply</Text>
                  </View>
                </Pressable>
              ))}

              <Pressable
                style={[styles.presetCard, styles.viewAllCard]}
                onPress={() =>
                  handlePresetGate(() => {
                    router.push("/my-presets");
                  })
                }
              >
                <Ionicons name="grid" size={16} color={t.ACCENT2} />
                <Text style={[styles.presetTitle, { color: t.ACCENT2 }]}>All Presets</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>

        {/* Garage Summary */}
        <View style={styles.card}>
          <SectionHeader icon="bicycle-outline" title="Your Garage" />
          <Text style={styles.body}>
            {bikeCount === 0
              ? "Add your first bike for model-aware tuning."
              : bikeCount === 1
              ? "You have 1 bike saved."
              : `You have ${bikeCount} bikes saved.`}
          </Text>
          <Pressable style={styles.btnGhost} onPress={() => router.push("/(tabs)/garage")}>
            <Text style={styles.btnGhostText}>{bikeCount === 0 ? "Add a Bike" : "Manage Garage"}</Text>
            <Ionicons name="chevron-forward" size={18} color={t.ACCENT2} />
          </Pressable>
        </View>

        {/* Last Session */}
        <View style={styles.card}>
          <SectionHeader icon="time-outline" title="Last Session" />

          {loading ? (
            <View style={styles.centerInline}>
              <ActivityIndicator color={t.TEXT} />
              <Text style={styles.muted}>Loading…</Text>
            </View>
          ) : !lastSession ? (
            <Text style={styles.body}>
              No sessions yet. Generate a tune and hit “Save as Session” to build your history.
            </Text>
          ) : (
            <>
              <View style={styles.sessionHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sessionTitle}>
                    {displayBike(lastSession?.bikes) ?? "Custom Bike"}
                  </Text>
                  <Text style={styles.sessionMeta}>
                    {formatDate(lastSession.rode_on || lastSession.created_at)} · {cap(lastSession.surface || "mixed")}
                  </Text>
                </View>
                <View style={styles.sessionChip}>
                  <Ionicons name="sparkles-outline" color="#fff" size={14} />
                  <Text style={styles.sessionChipText}>Saved</Text>
                </View>
              </View>

              <View style={styles.meterRow}>
                <Meter label="Fork Comp" value={lastSession.fork_comp} max={30} />
                <Meter label="Fork Reb" value={lastSession.fork_reb} max={30} />
              </View>
              <View style={{ height: 10 }} />
              <View style={styles.meterRow}>
                <Meter label="Shock Comp" value={lastSession.shock_comp} max={30} />
                <Meter label="Shock Reb" value={lastSession.shock_reb} max={30} />
              </View>
              <View style={{ height: 10 }} />
              <View style={styles.meterRow}>
                <Meter label="Sag (mm)" value={lastSession.sag_mm} max={140} />
              </View>

              {lastSession.notes ? (
                <>
                  <View style={{ height: 12 }} />
                  <Text style={styles.noteLabel}>Notes</Text>
                  <Text style={styles.noteText} numberOfLines={3}>
                    {lastSession.notes}
                  </Text>
                </>
              ) : null}

              <View style={{ height: 14 }} />
              <View style={styles.row}>
                <Pressable style={[styles.btnPrimary, { flex: 1 }]} onPress={() => router.push("/(tabs)/sessions")}>
                  <Text style={styles.btnPrimaryText}>View Session</Text>
                </Pressable>
                <View style={{ width: 12 }} />
                <Pressable style={[styles.btnOutline, { flex: 1 }]} onPress={() => router.push("/(tabs)/tune")}>
                  <Text style={styles.btnOutlineText}>Generate New</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>

        {/* Tips */}
        <View style={styles.tipCard}>
          <Ionicons name="information-circle-outline" size={18} color={t.SUCCESS} />
          <Text style={styles.tipText}>
            Tip: For WP AER forks, start at the suggested air pressure, then adjust ±0.2 bar after
            your first moto if the front feels harsh (↑) or vague (↓).
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Helpers */
function cap(s: string) {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}
function displayBike(b?: LastSession["bikes"] | null) {
  if (!b) return null;
  const parts = [b.year, b.make, b.model].filter(Boolean);
  return parts.join(" ");
}
function formatDate(iso?: string | null) {
  if (!iso) return "Today";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Today";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Styles */
const makeStyles = (T: {
  BG: string;
  CARD: string;
  TEXT: string;
  SUBTEXT: string;
  ACCENT: string;
  ACCENT2: string;
  ACCENT3: string;
  BORDER: string;
  BORDER_SUBTLE: string;
  SURFACE_ALT: string;
  CHIP_BG: string;
  TRACK: string;
  SUCCESS: string;
  ERROR: string;
}) =>
  StyleSheet.create({
    hero: { flexDirection: "row", alignItems: "center", marginBottom: 18 },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
    brandLogo: { width: 28, height: 28, borderRadius: 6 },
    brandWordmark: { fontSize: 16, fontWeight: "900", letterSpacing: 1 },
    brandDialed: { color: "#FFFFFF" },
    brandOff: { color: T.ACCENT, marginLeft: 6 },
    hi: { color: T.TEXT, fontSize: 22, fontWeight: "800", letterSpacing: 0.2 },
    subtle: { color: T.SUBTEXT, marginTop: 2, fontSize: 13 },
    planBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: T.ACCENT2,
      backgroundColor: "transparent",
      minWidth: 48,
      alignItems: "center",
      marginLeft: 12,
    },
    planText: { color: T.ACCENT2, fontWeight: "800", fontSize: 11 },
    card: {
      backgroundColor: T.CARD,
      borderWidth: 1,
      borderColor: T.BORDER,
      borderRadius: 14,
      padding: 16,
      marginBottom: 12,
    },
    sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    h2: { color: T.TEXT, fontWeight: "800", fontSize: 18 },
    body: { color: T.TEXT, opacity: 0.92, lineHeight: 20 },
    row: { flexDirection: "row", alignItems: "center" },
    actionsRow: { flexDirection: "row", alignItems: "stretch", gap: 12 },
    action: {
      flex: 1,
      borderWidth: 1,
      borderColor: T.BORDER,
      borderRadius: 14,
      paddingVertical: 16,
      paddingHorizontal: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: T.SURFACE_ALT,
      gap: 6,
      minHeight: 92,
    },
    actionAccent: { backgroundColor: T.ACCENT, borderColor: T.BORDER_SUBTLE },
    actionText: { color: T.ACCENT2, fontWeight: "800" },
    allBtn: { flexDirection: "row", gap: 4, alignItems: "center" },
    allBtnText: { color: T.ACCENT2, fontWeight: "800" },
    presetCard: {
      width: 180,
      backgroundColor: T.BG,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: T.BORDER,
      padding: 12,
      gap: 6,
    },
    viewAllCard: { alignItems: "center", justifyContent: "center", gap: 8 },
    presetTitle: { color: T.TEXT, fontWeight: "900" },
    presetSub: { color: T.SUBTEXT, fontSize: 12 },
    applyPill: {
      marginTop: 8,
      alignSelf: "flex-start",
      flexDirection: "row",
      gap: 6,
      backgroundColor: T.ACCENT,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    applyPillText: { color: "#fff", fontWeight: "900", fontSize: 12 },
    sessionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 },
    sessionTitle: { color: T.TEXT, fontWeight: "900" },
    sessionMeta: { color: T.SUBTEXT, marginTop: 2, fontSize: 13 },
    sessionChip: {
      flexDirection: "row",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: T.CHIP_BG,
      borderWidth: 1,
      borderColor: T.BORDER,
    },
    sessionChipText: { color: T.TEXT, fontWeight: "800", fontSize: 12 },
    meterRow: { flexDirection: "row", gap: 12 },
    meterLabel: { color: T.SUBTEXT, fontSize: 12, marginBottom: 6 },
    meterBarOuter: { height: 8, borderRadius: 999, backgroundColor: T.TRACK, overflow: "hidden" },
    meterBarFill: { height: "100%", backgroundColor: T.ACCENT3, borderRadius: 999 },
    meterValue: { color: T.TEXT, marginTop: 6, fontWeight: "800" },
    btnPrimary: {
      backgroundColor: T.ACCENT,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    btnPrimaryText: { color: "#fff", fontWeight: "900" },
    btnOutline: {
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: T.ACCENT2,
    },
    btnOutlineText: { color: T.ACCENT2, fontWeight: "900" },
    btnGhost: {
      marginTop: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: T.ACCENT2,
      paddingVertical: 10,
      paddingHorizontal: 12,
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    btnGhostText: { color: T.ACCENT2, fontWeight: "900" },
    tipCard: {
      backgroundColor: T.CARD,
      borderColor: T.BORDER,
      borderWidth: 1,
      borderRadius: 14,
      padding: 12,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    tipText: { color: T.TEXT, flex: 1, lineHeight: 20 },
    noteLabel: { color: T.SUBTEXT, fontSize: 12, fontWeight: "800" },
    noteText: { color: T.TEXT, lineHeight: 20 },
    muted: { color: T.SUBTEXT },
    centerInline: { flexDirection: "row", alignItems: "center", gap: 8 },
  });
