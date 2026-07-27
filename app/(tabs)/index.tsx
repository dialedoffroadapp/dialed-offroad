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
import { ActiveSetupCard } from "../../components/ActiveSetupCard";
import { OutcomeCheckinCard } from "../../components/OutcomeCheckinCard";
import { useToast } from "../../components/Toast";
import { TrialMomentCard } from "../../components/TrialMomentCard";
import { readPendingTune, useOnboarding } from "../../lib/onboarding";
import { deriveIsPaywallDecliner } from "../../lib/paywallDecliner";
import { hasPurchasedThisSession } from "../../lib/purchases";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { reconcileTrialReminder } from "../../lib/trialReminder";
import { getTrialStatus, TrialStatus } from "../../lib/trialStatus";
import { logEvent } from "../../lib/usage";

/* --------------------------------- Types ---------------------------------- */

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

type GarageBike = {
  id: string;
  make: string;
  model: string;
  year: number;
  nickname: string | null;
};

type BikeLastSession = Record<string, { rode_on: string; surface: string | null }>;

/* ----------------------------- Brand accents ------------------------------ */

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
  Stark: "#E6342A",
};

function hexToRgba(hex: string, alpha: number) {
  const n = hex.replace("#", "");
  const r = parseInt(n.substring(0, 2), 16) || 0;
  const g = parseInt(n.substring(2, 4), 16) || 0;
  const b = parseInt(n.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

/* -------------------------------- Screen ---------------------------------- */

// decliner_home_landed fires once per app session, across remounts.
let declinerLandingLoggedThisSession = false;

export default function HomeScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const { state: onbState, hydrated: onbHydrated } = useOnboarding();

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
      CHIP_BG: (colors as any).CHIP_BG ?? "rgba(255,255,255,0.05)",
      TRACK: (colors as any).TRACK ?? "rgba(255,255,255,0.06)",
      SUCCESS: colors.SUCCESS,
      ERROR: colors.ERROR,
    };
  }, [colors]);

  const styles = useMemo(() => makeStyles(t), [t]);

  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string>("");

  const [planLabel, setPlanLabel] = useState<"Free" | "Pro">("Free");
  const [isPro, setIsPro] = useState<boolean>(false);

  const [bikes, setBikes] = useState<GarageBike[]>([]);
  const [bikeLastSession, setBikeLastSession] = useState<BikeLastSession>({});
  const [lastSession, setLastSession] = useState<LastSession | null>(null);
  // Which bike the ActiveSetupCard is showing (null = hidden). Used to drop
  // the redundant Last Session card when both would show the same bike.
  const [activeSetupBikeId, setActiveSetupBikeId] = useState<string | null>(null);

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
        setBikes([]);
        setBikeLastSession({});
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

      // Bikes (full details instead of just count)
      const { data: bikeRows, error: bikeErr } = await supabase
        .from("bikes")
        .select("id, make, model, year, nickname")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (bikeErr) throw bikeErr;
      setBikes((bikeRows as GarageBike[]) ?? []);

      // Batched last-session-per-bike for state lines
      if (bikeRows && bikeRows.length > 0) {
        try {
          const bikeIds = bikeRows.map((b: GarageBike) => b.id);
          const { data: sessionRows } = await supabase
            .from("sessions")
            .select("bike_id, rode_on, surface")
            .eq("user_id", user.id)
            .in("bike_id", bikeIds)
            .order("rode_on", { ascending: false });

          if (sessionRows) {
            const map: BikeLastSession = {};
            for (const s of sessionRows as { bike_id: string; rode_on: string | null; surface: string | null }[]) {
              if (s.bike_id && s.rode_on && !map[s.bike_id]) {
                map[s.bike_id] = { rode_on: s.rode_on, surface: s.surface };
              }
            }
            setBikeLastSession(map);
          }
        } catch {
          // Non-critical — state line just won't show
        }
      }

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

  // Trial awareness (WS1): session-cached RevenueCat read, refreshed on
  // focus so a conversion mid-session drops the trial UI immediately.
  const [trialStatus, setTrialStatus] = useState<TrialStatus | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getTrialStatus({ refresh: true })
        .then((s) => {
          if (!cancelled) setTrialStatus(s);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const firstName = displayName?.trim().split(" ")[0] || "Rider";

  // The first / default bike for the garage card
  const primaryBike = bikes.length > 0 ? bikes[0] : null;

  // Keep the day-5 trial notification honest against observed state:
  // schedules for the auto-renew-off cohort, cancels on conversion/expiry/
  // auto-renew-on. Idempotent; never asks for permission.
  useEffect(() => {
    if (!trialStatus) return;
    const bikeName = primaryBike
      ? primaryBike.nickname || `${primaryBike.make} ${primaryBike.model}`
      : "bike";
    void reconcileTrialReminder(trialStatus, bikeName);
  }, [trialStatus, primaryBike]);

  // Paywall decliner: finished the funnel (signup, bike, generated tune) but
  // dismissed the paywall — persisted onboarding state parked at "trial".
  // Reactive to conversion, never cached: the onboarding provider flips step
  // to "complete" at purchase, isPro refreshes on every focus, and
  // hasPurchasedThisSession() covers the gap before the profile write lands.
  const isPaywallDecliner = deriveIsPaywallDecliner({
    hydrated: onbHydrated,
    onboardingStep: onbState.onboardingStep,
    onboardingComplete: onbState.onboardingComplete,
    isPro,
    purchasedThisSession: hasPurchasedThisSession(),
  });

  // Recovery-funnel landing metric — once per app session.
  useEffect(() => {
    if (isPaywallDecliner && !declinerLandingLoggedThisSession) {
      declinerLandingLoggedThisSession = true;
      void logEvent("decliner_home_landed", {});
    }
  }, [isPaywallDecliner]);

  // The onboarding tune (blurred results) stays reachable while it lives in
  // pending storage (24h TTL) — the banner body taps through to it.
  const [hasPendingTune, setHasPendingTune] = useState(false);
  useEffect(() => {
    if (!isPaywallDecliner) return;
    let mounted = true;
    readPendingTune()
      .then(({ tune: pending }) => {
        if (mounted) setHasPendingTune(!!pending);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [isPaywallDecliner]);

  // One handler for both banner targets so every tap logs decliner_banner_tapped
  // exactly once (target distinguishes the CTA pill from the banner body). Body
  // and CTA are siblings (no nested Pressable), so this can't double-fire.
  const onDeclinerTap = (target: "body" | "cta") => {
    void logEvent("decliner_banner_tapped", {
      target,
      has_pending_tune: hasPendingTune,
    });
    if (target === "cta") {
      // /premium auto-presents the RevenueCat paywall.
      router.push("/premium");
      return;
    }
    // Body tap: back to the blurred results while the pending tune survives
    // (tune-results renders correctly for a signed-in non-pro at the trial
    // step); otherwise straight to the paywall.
    if (hasPendingTune) {
      router.push("/tune-results" as any);
    } else {
      router.push("/premium");
    }
  };

  // Local subcomponents
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
          <Ionicons name={icon} size={15} color={t.SUBTEXT} />
          <Text style={styles.h2}>{title}</Text>
        </View>
        {right ? <View>{right}</View> : null}
      </View>
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
        {/* ── Decliner unlock banner ── top of Home, above everything, not
            dismissible. The single conversion surface for paywall decliners;
            disappears reactively the moment they convert. */}
        {isPaywallDecliner && (
          <View style={styles.declinerBanner}>
            <Pressable
              onPress={() => onDeclinerTap("body")}
              style={styles.declinerRow}
              accessibilityRole="button"
              accessibilityLabel="Your tune is ready. Start your free trial to reveal it"
            >
              <View style={styles.declinerIconTile}>
                <Ionicons name="lock-closed" size={19} color={t.ACCENT} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.declinerTitle} numberOfLines={1}>
                  {primaryBike
                    ? `Your ${primaryBike.make} ${primaryBike.model} tune is ready`
                    : "Your tune is ready"}
                </Text>
                <Text style={styles.declinerSub} numberOfLines={1}>
                  Start your free trial to reveal it
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => onDeclinerTap("cta")}
              style={styles.declinerCta}
            >
              <Ionicons name="lock-open-outline" size={16} color="#fff" />
              <Text style={styles.declinerCtaText}>Reveal My Setup</Text>
            </Pressable>
          </View>
        )}

        {/* ── Header ── */}
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
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
            {/* Subtle trial status — the countdown card takes over at day 5
                (daysRemaining <= 2), so this line only shows before that. */}
            {trialStatus?.isInTrial && (trialStatus.daysRemaining ?? 0) > 2 ? (
              <Text style={styles.trialLine}>
                Trial · {trialStatus.daysRemaining} days left
              </Text>
            ) : null}
          </View>

          <View style={styles.planBadge}>
            <Text style={styles.planText}>{planLabel}</Text>
          </View>
        </View>

        {/* ── Quick Actions — asymmetric layout ── */}
        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => router.push("/(tabs)/tune")}
            style={({ pressed }) => [
              styles.actionPrimary,
              pressed && { opacity: 0.92 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Generate Tune"
          >
            <Ionicons name="flash" size={24} color="#fff" />
            <Text style={styles.actionPrimaryText}>Generate{"\n"}Tune</Text>
          </Pressable>

          <View style={styles.actionStack}>
            <Pressable
              onPress={() => router.push("/(tabs)/garage")}
              style={({ pressed }) => [
                styles.actionSecondary,
                pressed && { opacity: 0.92 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add Bike"
            >
              <Ionicons name="bicycle-outline" size={18} color={t.ACCENT} />
              <Text style={styles.actionSecondaryText}>Add Bike</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push("/(tabs)/sessions")}
              style={({ pressed }) => [
                styles.actionSecondary,
                pressed && { opacity: 0.92 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="View Sessions"
            >
              <Ionicons name="albums-outline" size={18} color={t.ACCENT} />
              <Text style={styles.actionSecondaryText}>View Sessions</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Ride check-in ── outcome or first-ride prompt; Home is the
            initial tab, so this is the loop's primary surface. First content
            block, above the presets rail: 11 impressions produced 0 answers
            while it sat below the fold. Renders only when eligible (max one
            instance per session across Home + Tune). Paywall decliners are
            excluded — they have no revealed setup to ride on, and the unlock
            banner owns their Home real estate. */}
        {!isPaywallDecliner && (
          <OutcomeCheckinCard
            surface="home"
            style={{ marginHorizontal: 0, marginTop: 0, marginBottom: 12 }}
          />
        )}

        {/* ── My Presets ── */}
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
                <Ionicons name="chevron-forward" size={13} color={t.ACCENT} />
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
              nestedScrollEnabled
              contentContainerStyle={{ gap: 10, paddingRight: 4 }}
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
                    <Ionicons name="bookmark" size={13} color={t.SUBTEXT} />
                    <Text style={styles.presetTitle} numberOfLines={1}>
                      {p.name || "Preset"}
                    </Text>
                  </View>
                  <Text style={styles.presetSub} numberOfLines={1}>
                    {p.track_name ? p.track_name : "Custom"}
                    {p.terrain?.[0] ? ` · ${p.terrain[0]}` : ""}
                  </Text>
                  <View style={styles.applyPill}>
                    <Ionicons name="flash" size={11} color="#fff" />
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
                <Ionicons name="grid" size={16} color={t.ACCENT} />
                <Text style={[styles.presetTitle, { color: t.ACCENT }]}>All Presets</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>

        {/* ── Trial moments ── day-5 countdown recap or day-2 value card;
            pickTrialCard guarantees at most one renders. */}
        <TrialMomentCard status={trialStatus} />

        {/* ── Your Garage ── merged setup card when a current version exists;
            otherwise the classic garage card below renders unchanged. */}
        {activeSetupBikeId ? (
          <View style={styles.mergedHeaderRow}>
            <Text style={styles.mergedMicroLabel}>YOUR GARAGE</Text>
            <Pressable
              onPress={() => router.push("/(tabs)/garage")}
              hitSlop={8}
            >
              <Text style={styles.mergedManageLink}>Manage →</Text>
            </Pressable>
          </View>
        ) : null}
        <ActiveSetupCard onBikeResolved={setActiveSetupBikeId} />

        {!activeSetupBikeId && (
        <View style={styles.card}>
          <SectionHeader icon="bicycle-outline" title="Your Garage" />

          {bikes.length === 0 ? (
            <Text style={styles.body}>
              Add your first bike for model-aware tuning.
            </Text>
          ) : (
            <>
              {/* Show primary (first) bike with brand chip + state line */}
              {primaryBike && (() => {
                const accent = BRAND_ACCENTS[primaryBike.make] ?? "#3A3F4C";
                const session = bikeLastSession[primaryBike.id];
                return (
                  <View style={styles.garageBikeRow}>
                    <View style={[styles.garageBikeChip, { backgroundColor: hexToRgba(accent, 0.14) }]}>
                      <Ionicons name="bicycle" size={18} color={accent} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.garageBikeName} numberOfLines={1}>
                        {primaryBike.make} {primaryBike.model}
                      </Text>
                      <Text style={styles.garageBikeMeta} numberOfLines={1}>
                        {session
                          ? `Last tuned ${relativeDate(session.rode_on)}${session.surface ? ` · ${cap(session.surface)}` : ""}`
                          : "No tune yet"}
                      </Text>
                    </View>
                  </View>
                );
              })()}
              {bikes.length > 1 && (
                <Text style={styles.garageExtra}>
                  +{bikes.length - 1} more bike{bikes.length > 2 ? "s" : ""} in your garage
                </Text>
              )}
            </>
          )}

          <Pressable style={styles.garageBtn} onPress={() => router.push("/(tabs)/garage")}>
            <Text style={styles.garageBtnText}>
              {bikes.length === 0 ? "Add a Bike" : "Manage Garage"}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={t.ACCENT} />
          </Pressable>
        </View>
        )}

        {/* ── Last Session — dropped when the setup card shows the same bike ── */}
        {activeSetupBikeId && lastSession?.bike_id === activeSetupBikeId ? null : (
        <View style={styles.card}>
          <SectionHeader icon="time-outline" title="Last Session" />

          {loading ? (
            <View style={styles.centerInline}>
              <ActivityIndicator color={t.TEXT} />
              <Text style={styles.muted}>Loading…</Text>
            </View>
          ) : !lastSession ? (
            <Text style={styles.body}>
              No sessions yet. Generate a tune and hit "Save as Session" to build your history.
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
                  <Ionicons name="sparkles-outline" color="#fff" size={13} />
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
                <View style={{ width: 10 }} />
                <Pressable style={[styles.btnOutline, { flex: 1 }]} onPress={() => router.push("/(tabs)/tune")}>
                  <Text style={styles.btnOutlineText}>Generate New</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
        )}

        {/* ── Tip (footnote weight) ── */}
        <View style={styles.tipCard}>
          <Ionicons name="bulb-outline" size={13} color={t.SUCCESS} />
          <Text style={styles.tipText}>
            <Text style={styles.tipPrefix}>Tip · </Text>
            For WP AER forks, start at the suggested air pressure, then adjust ±0.2 bar after
            your first moto if the front feels harsh (↑) or vague (↓).
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* -------------------------------- Helpers --------------------------------- */

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff}d ago`;
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
  if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
  return `${Math.floor(diff / 365)}y ago`;
}

/* -------------------------------- Styles ---------------------------------- */

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
    // ── Header ──
    hero: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginBottom: 20,
    },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 12,
    },
    brandLogo: { width: 28, height: 28, borderRadius: 6 },
    brandWordmark: { fontSize: 16, fontWeight: "900", letterSpacing: 1 },
    brandDialed: { color: T.TEXT },
    brandOff: { color: T.ACCENT, marginLeft: 6 },
    hi: {
      color: T.TEXT,
      fontSize: 27,
      fontWeight: "800",
      letterSpacing: -0.3,
    },
    subtle: {
      color: T.SUBTEXT,
      marginTop: 4,
      fontSize: 14,
      lineHeight: 19,
    },
    trialLine: {
      color: T.ACCENT,
      marginTop: 5,
      fontSize: 12,
      fontWeight: "700",
    },
    planBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: T.ACCENT,
      backgroundColor: hexToRgba(
        // extract hex from T.ACCENT (may already be hex)
        T.ACCENT.startsWith("#") ? T.ACCENT : "#1D9BF0",
        0.1
      ),
      marginLeft: 12,
      marginTop: 4,
    },
    planText: { color: T.ACCENT, fontWeight: "800", fontSize: 11 },

    // ── Quick Actions — asymmetric ──
    actionsRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 12,
    },
    actionPrimary: {
      flex: 1,
      backgroundColor: T.ACCENT,
      borderRadius: 16,
      padding: 20,
      justifyContent: "flex-end",
      gap: 10,
      minHeight: 110,
    },
    actionPrimaryText: {
      color: "#fff",
      fontWeight: "800",
      fontSize: 17,
      lineHeight: 22,
    },
    actionStack: {
      width: 130,
      gap: 10,
    },
    actionSecondary: {
      flex: 1,
      backgroundColor: T.CARD,
      borderWidth: 1,
      borderColor: T.BORDER,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    actionSecondaryText: {
      color: T.TEXT,
      fontWeight: "700",
      fontSize: 13,
      flexShrink: 1,
    },

    // ── Cards (shared) ──
    card: {
      backgroundColor: T.CARD,
      borderWidth: 1,
      borderColor: T.BORDER,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    h2: { color: T.TEXT, fontWeight: "700", fontSize: 15 },
    body: { color: T.SUBTEXT, lineHeight: 20, fontSize: 14 },
    row: { flexDirection: "row", alignItems: "center" },

    // ── Presets ──
    allBtn: { flexDirection: "row", gap: 4, alignItems: "center" },
    allBtnText: { color: T.ACCENT, fontWeight: "600", fontSize: 13 },
    presetCard: {
      width: 170,
      backgroundColor: T.BG,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: T.BORDER,
      padding: 12,
      gap: 5,
    },
    viewAllCard: { alignItems: "center", justifyContent: "center", gap: 8 },
    presetTitle: { color: T.TEXT, fontWeight: "800", fontSize: 13 },
    presetSub: { color: T.SUBTEXT, fontSize: 12 },
    applyPill: {
      marginTop: 6,
      alignSelf: "flex-start",
      flexDirection: "row",
      gap: 5,
      backgroundColor: T.ACCENT,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    applyPillText: { color: "#fff", fontWeight: "800", fontSize: 11 },

    // ── Garage (alive) ──
    garageBikeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 6,
    },
    garageBikeChip: {
      width: 40,
      height: 40,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    garageBikeName: {
      color: T.TEXT,
      fontWeight: "800",
      fontSize: 15,
    },
    garageBikeMeta: {
      color: T.SUBTEXT,
      fontSize: 12,
      marginTop: 2,
    },
    garageExtra: {
      color: T.SUBTEXT,
      fontSize: 12,
      marginTop: 4,
      marginBottom: 2,
    },
    garageBtn: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    garageBtnText: {
      color: T.ACCENT,
      fontWeight: "700",
      fontSize: 13,
    },

    // ── Last Session ──
    sessionHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 10,
      gap: 8,
    },
    sessionTitle: { color: T.TEXT, fontWeight: "800", fontSize: 14 },
    sessionMeta: { color: T.SUBTEXT, marginTop: 2, fontSize: 13 },
    sessionChip: {
      flexDirection: "row",
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: T.CHIP_BG,
      borderWidth: 1,
      borderColor: T.BORDER,
    },
    sessionChipText: { color: T.TEXT, fontWeight: "700", fontSize: 11 },
    meterRow: { flexDirection: "row", gap: 12 },
    meterLabel: { color: T.SUBTEXT, fontSize: 12, marginBottom: 6 },
    meterBarOuter: {
      height: 6,
      borderRadius: 999,
      backgroundColor: T.TRACK,
      overflow: "hidden",
    },
    meterBarFill: { height: "100%", backgroundColor: T.ACCENT3, borderRadius: 999 },
    meterValue: { color: T.TEXT, marginTop: 5, fontWeight: "800", fontSize: 13 },

    // ── Buttons ──
    btnPrimary: {
      backgroundColor: T.ACCENT,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    btnPrimaryText: { color: "#fff", fontWeight: "800" },
    btnOutline: {
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: T.BORDER,
    },
    btnOutlineText: { color: T.ACCENT, fontWeight: "700" },

    // ── Tip ──
    tipCard: {
      backgroundColor: T.CARD,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 9,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    tipPrefix: { color: T.SUBTEXT, fontWeight: "700" },
    tipText: { color: T.SUBTEXT, flex: 1, lineHeight: 17, fontSize: 12 },

    // ── Merged garage/setup header ──
    mergedHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    mergedMicroLabel: {
      color: T.SUBTEXT,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1.6,
    },
    mergedManageLink: {
      color: T.ACCENT,
      fontSize: 12,
      fontWeight: "800",
    },

    // ── Decliner unlock banner ──
    declinerBanner: {
      backgroundColor: T.CARD,
      borderWidth: 1,
      borderColor: T.ACCENT,
      borderRadius: 16,
      padding: 14,
      marginBottom: 12,
    },
    declinerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
    },
    declinerIconTile: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: "rgba(29,155,240,0.14)",
      alignItems: "center",
      justifyContent: "center",
    },
    declinerTitle: {
      color: T.TEXT,
      fontSize: 15,
      fontWeight: "800",
    },
    declinerSub: {
      color: T.SUBTEXT,
      fontSize: 12,
      marginTop: 2,
    },
    declinerCta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      backgroundColor: T.ACCENT,
      borderRadius: 12,
      paddingVertical: 13,
      marginTop: 12,
    },
    declinerCtaText: { color: "#fff", fontWeight: "900", fontSize: 14 },

    // ── Utility ──
    noteLabel: { color: T.SUBTEXT, fontSize: 12, fontWeight: "700" },
    noteText: { color: T.TEXT, lineHeight: 20, fontSize: 13 },
    muted: { color: T.SUBTEXT },
    centerInline: { flexDirection: "row", alignItems: "center", gap: 8 },
  });
