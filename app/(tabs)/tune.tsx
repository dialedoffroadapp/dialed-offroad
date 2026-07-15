// app/(tabs)/tune.tsx
// Zero-based Tune flow + Garage selector -> navigates to a dedicated results page
// Adds: 1-tune trial gate, My Presets link, preset param banner + "Use Preset Now"
// (This version adds safe-area top spacer, sticky Generate bar, compact weight input)
// (Polish pass: cleaned top hero, outline actions, solid accent header (no gradient), blur sticky bar (iOS), haptics, 44pt tap targets)
//
// ✅ UPDATE (Onboarding carry-over):
// - Accepts onboarding param from Garage: params { bikeId, onboarding: "1" }
// - In onboarding mode, Tune auto-selects that bike and locks bike selection + bike fields
// - Avoids fallback-to-primary race when onboarding bikeId exists
// - Header copy switches to "Step 2 of 2" in onboarding mode
//
// ✅ UPDATE (Guest onboarding tuning):
// - In onboarding mode ONLY, allow generating a tune while signed out (guest)
// - Skip claim_free_tune RPC when guest
// - Pass meta.guest to results so we can blur + "Unlock for free" later

import Ionicons from "@expo/vector-icons/Ionicons";
// import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Circle as SvgCircle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GarageCoachmark } from "../../components/GarageCoachmark";
import { OnboardingProgress } from "../../components/OnboardingProgress";
import { OutcomeCheckinCard } from "../../components/OutcomeCheckinCard";
import { RiskGate } from "../../components/RiskGate";
import { RunningSetupRow } from "../../components/RunningSetupRow";
import { SettingRow } from "../../components/SettingRow";
import { useToast } from "../../components/Toast";
import { generateTune, ZeroTuneInput, ZeroTuneResult } from "../../lib/ai";
import { computeSpringCheck, fetchModelSpecs } from "../../lib/modelSpecs";
import { resolveSagBounds } from "../../lib/sagBounds";
import {
  readPendingTune,
  useOnboarding,
  writePendingTune,
  type PendingTunePayload,
} from "../../lib/onboarding";
// 🔻 Removed direct RevenueCat gating – Tune now trusts Supabase profile only
// import { getCustomerInfo, isPro as isProEntitlement } from "../../lib/purchases";
import { isProfane } from "../../lib/profanity";
import { deriveIsPro } from "../../lib/proUtils";
import { supabase } from "../../lib/supabase";
import { lightTheme } from "../../constants/theme";
import { useTheme } from "../../lib/theme";
import type { UsageEvent } from "../../lib/usage";
import { isUuid } from "../../lib/uuid";
import { getOrCreateFunnelId, logEvent } from "../../lib/usage";

/* --------------------------------- Types ---------------------------------- */
type Bike = {
  id: string;
  make: string;
  model: string;
  year: number;
  nickname: string | null;
  is_primary: boolean | null;
};

type ProfileMeta = {
  is_pro: boolean | null;
  pro_until: string | null;
  trial_tunes_used: number | null;
};

type PresetMeta =
  | {
      id?: string;
      name?: string;
      track_name?: string | null;
      terrain?: string[] | null;
      bike_hint?: { year: number | null; make: string | null; model: string | null } | null;
    }
  | null;

/* ----------------------------- Local constants ---------------------------- */
const DEFAULT_GOALS = ["stability", "comfort", "playfulness", "grip", "jump support"] as const;
const normalizeGoal = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// bump this if you update RiskGate text/content to invalidate old consent
const RISK_VER = "2025-10-05";

// trial: 1 free AI tune (server gate via Supabase)
const TRIAL_LIMIT = 1;

// height for sticky footer spacing
const STICKY_FOOTER_HEIGHT = 96;

// TS-safe event names for analytics
const AI_TUNE_GENERATED_ZERO: UsageEvent = "ai_tune_generated_zero" as UsageEvent;
const PRESET_APPLIED: UsageEvent = "preset_applied" as UsageEvent;

// Local storage keys (per-user)
const riskKeyForUser = (uid: string) => `riskConsent:${uid}`;
const riderProfileKey = (uid: string) => `rider_profile_v1_${uid}`;
const bikeSpecsKey = (bikeId: string) => `bike_specifics_v1_${bikeId}`;
const customGoalsKey = (uid: string) => `custom_goals_v1_${uid}`;
const TEMP_MIN = 30;
const TEMP_MAX = 115;

type StoredRisk = {
  version: string;
  acceptedAt: string;
};

/* ------------------------------- Bike Sheet ------------------------------- */
function BikePickerSheet({
  open,
  bikes,
  selectedId,
  onSelect,
  onClose,
  C,
  S,
}: {
  open: boolean;
  bikes: Bike[];
  selectedId: string | null;
  onSelect: (b: Bike | null) => void; // null => Custom
  onClose: () => void;
  C: ReturnType<typeof useTheme>["colors"];
  S: ReturnType<typeof makeStyles>;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bikes;
    return bikes.filter((b) => {
      const label = `${b.year} ${b.make} ${b.model} ${b.nickname ?? ""}`.toLowerCase();
      return label.includes(q);
    });
  }, [bikes, query]);

  if (!open) return null;

  return (
    <View style={S.sheetWrap} pointerEvents="box-none">
      <Pressable style={S.sheetOverlay} onPress={onClose} />
      <View style={S.sheet}>
        <View style={S.sheetHeader}>
          <Text style={S.sheetTitle}>Your Bikes</Text>
          <Pressable onPress={onClose} hitSlop={10} style={S.sheetClose}>
            <Ionicons name="close" size={18} color={C.MUTED} />
          </Pressable>
        </View>

        <TextInput
          placeholder="Search bikes…"
          placeholderTextColor={C.MUTED}
          style={S.input}
          value={query}
          onChangeText={setQuery}
          autoCorrect
          returnKeyType="done"
          onSubmitEditing={Keyboard.dismiss}
        />

        <ScrollView style={{ maxHeight: 380, marginTop: 8 }}>
          <Pressable
            style={[S.optionRow, { marginBottom: 8 }]}
            onPress={() => {
              onSelect(null); // Custom
              onClose();
              Haptics.selectionAsync();
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="sparkles-outline" size={16} color={C.ACCENT} />
              <Text style={[S.optionText, { color: C.ACCENT }]}>Custom</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.MUTED} />
          </Pressable>

          {filtered.map((b) => {
            const active = selectedId === b.id;
            return (
              <Pressable
                key={b.id}
                style={[
                  S.optionRow,
                  active && { backgroundColor: C.INPUT_BG, borderColor: C.ACCENT + "80" },
                ]}
                onPress={() => {
                  onSelect(b);
                  onClose();
                  Haptics.selectionAsync();
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[S.optionText, { fontWeight: "900" }]}>
                    {b.year} {b.make} {b.model} {b.nickname ? `— ${b.nickname}` : ""}
                    {b.is_primary ? "  ★" : ""}
                  </Text>
                  <Text style={S.muted}>{b.make}</Text>
                </View>
                {active ? (
                  <Ionicons name="checkmark-circle" size={18} color="#EAF2FF" />
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={C.MUTED} />
                )}
              </Pressable>
            );
          })}

          {filtered.length === 0 && (
            <Text style={[S.muted, { marginTop: 8 }]}>No matches. Try a different search.</Text>
          )}
        </ScrollView>

        <View style={{ height: 8 }} />
        <Pressable
          onPress={onClose}
          style={[S.btnSmall, { alignSelf: "center", paddingHorizontal: 18 }]}
        >
          <Text style={S.btnSmallText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------- TempSlider ------------------------------- */
function TempSlider({
  value,
  onChange,
  C,
}: {
  value: number | null;
  onChange: (v: number) => void;
  C: ReturnType<typeof useTheme>["colors"];
}) {
  const [trackW, setTrackW] = useState(0);
  const trackWidthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const isDraggingRef = useRef(false);

  const updateFromX = (x: number) => {
    const clamped = Math.max(0, Math.min(trackWidthRef.current, x));
    const pct = trackWidthRef.current > 0 ? clamped / trackWidthRef.current : 0;
    onChangeRef.current(Math.round(TEMP_MIN + pct * (TEMP_MAX - TEMP_MIN)));
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > Math.abs(gs.dy) && Math.abs(gs.dx) > 4,
      onPanResponderGrant: (e) => {
        isDraggingRef.current = true;
        updateFromX(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e) => updateFromX(e.nativeEvent.locationX),
      // Don't let ScrollView steal the gesture mid-drag
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => { isDraggingRef.current = false; },
      onPanResponderTerminate: () => { isDraggingRef.current = false; },
    })
  ).current;

  const thumbLeft =
    trackW > 0 && value != null
      ? Math.max(
          0,
          Math.min(
            trackW - 24,
            ((value - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * trackW - 12
          )
        )
      : 0;
  const celsius = value != null ? Math.round(((value - 32) * 5) / 9) : null;

  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <Text style={{ color: C.MUTED, fontSize: 12, fontWeight: "700" }}>
          Temperature (optional)
        </Text>
        {value != null ? (
          <Text style={{ color: C.TEXT, fontSize: 14, fontWeight: "800" }}>
            {value}°F · {celsius}°C
          </Text>
        ) : (
          <Text style={{ color: C.MUTED, fontSize: 12 }}>Drag to set</Text>
        )}
      </View>
      <View
        style={{ height: 44, justifyContent: "center" }}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          trackWidthRef.current = w;
          setTrackW(w);
        }}
        onTouchEnd={(e) => {
          // Tap-to-set only — skip if we just finished a drag so the thumb
          // doesn't jump on release.
          if (isDraggingRef.current) return;
          updateFromX(e.nativeEvent.locationX);
        }}
        {...panResponder.panHandlers}
      >
        {/* Track background */}
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: "rgba(255,255,255,0.08)",
          }}
        >
          {/* Fill */}
          {value != null && trackW > 0 && (
            <View
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: ((value - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * trackW,
                backgroundColor: C.ACCENT,
                borderRadius: 3,
              }}
            />
          )}
        </View>
        {/* Thumb */}
        {value != null && trackW > 0 && (
          <View
            style={{
              position: "absolute",
              left: thumbLeft,
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: C.ACCENT,
              top: 10,
              shadowColor: "#000",
              shadowOpacity: 0.3,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 2 },
              elevation: 4,
            }}
          />
        )}
      </View>
      <View
        style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}
      >
        <Text style={{ color: C.MUTED, fontSize: 11 }}>{TEMP_MIN}°F</Text>
        <Text style={{ color: C.MUTED, fontSize: 11 }}>{TEMP_MAX}°F</Text>
      </View>
    </View>
  );
}

/* -------------------------------- Component -------------------------------- */
export default function TuneScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const router = useRouter();
  const {
    preset,
    t,
    bikeId,
    onboarding,
    make: makeParam,
    model: modelParam,
    year: yearParam,
    nickname: nicknameParam,
    prefill,
  } = useLocalSearchParams<{
    preset?: string;
    t?: string;
    bikeId?: string;
    onboarding?: string; // ✅ from Garage: onboarding:"1"
    make?: string;
    model?: string;
    year?: string;
    nickname?: string;
    prefill?: string;
  }>();
  const { onboardingActive, state, setStep } = useOnboarding();

  // ✅ onboarding mode supports either legacy t=onboarding OR onboarding=1
  const hasLegacyOnboardingParams = useMemo(
    () => t === "onboarding" || onboarding === "1",
    [t, onboarding]
  );
  const isTuneOnboarding =
    onboardingActive && state.onboardingStep === "tune";
  const isOnboarding = isTuneOnboarding
    ? true
    : hasLegacyOnboardingParams;

  // ——— Trial-locked state (step === "trial") ———
  const isTrialLocked = onboardingActive && state.onboardingStep === "trial";
  const [trialPending, setTrialPending] = useState<PendingTunePayload | null>(null);
  const [trialPendingLoaded, setTrialPendingLoaded] = useState(false);

  useEffect(() => {
    if (!isTrialLocked) {
      setTrialPendingLoaded(true);
      return;
    }
    readPendingTune()
      .then(({ tune }) => {
        setTrialPending(tune);
        setTrialPendingLoaded(true);
      })
      .catch(() => setTrialPendingLoaded(true));
  }, [isTrialLocked]);

  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);

  // ——— Garage bikes ———
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [bikeLoading, setBikeLoading] = useState(true);
  const [selectedBikeId, setSelectedBikeId] = useState<string | null>(null);
  const [bikeSheetOpen, setBikeSheetOpen] = useState(false);

  // ——— Free text bike fields (can override selection) ———
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState<string>("");

  // ✅ Onboarding carry-over: if Garage passed bike details, apply them immediately.
  // This makes the Tune screen show the right bike even before Supabase bikes load (or for guests).
  useEffect(() => {
    if (!isOnboarding) return;

    if (bikeId && !selectedBikeId) setSelectedBikeId(bikeId);

    if (typeof makeParam === "string" && makeParam.trim().length) setMake(makeParam);
    if (typeof modelParam === "string" && modelParam.trim().length) setModel(modelParam);
    if (typeof yearParam === "string" && yearParam.trim().length) setYear(yearParam);

    // nicknameParam currently not used on this screen (kept for future use)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnboarding]);

  // ——— Persistence state ———
  const [userId, setUserId] = useState<string | null>(null);
  const [riderProfileLoaded, setRiderProfileLoaded] = useState(false);
  const [riderExpanded, setRiderExpanded] = useState(true);
  const [bikeSpecsExpanded, setBikeSpecsExpanded] = useState(true);

  // ——— Conditions / rider ———
  const [terrainTags, setTerrainTags] = useState<string[]>(["hardpack"]);
  const [terrainOther, setTerrainOther] = useState("");
  const [track, setTrack] = useState("");
  const [tempFahr, setTempFahr] = useState<number | null>(null);
  const [elevBucket, setElevBucket] = useState<"sea_level" | "moderate" | "high" | null>(null);

  const [weight, setWeight] = useState("185");
  const [skill, setSkill] = useState<"beginner" | "intermediate" | "pro">("intermediate");
  const [rideStyle, setRideStyle] = useState<"short_motos" | "long_enduro">("short_motos");

  const [goals, setGoals] = useState<string[]>(["stability", "comfort"]);
  const [goalInput, setGoalInput] = useState("");

  const updateGoals = (newGoals: string[]) => {
    setGoals(newGoals);
    if (userId) {
      AsyncStorage.setItem(customGoalsKey(userId), JSON.stringify(newGoals)).catch(() => {});
    }
  };

  const addGoal = () => {
    const raw = goalInput;
    const g = normalizeGoal(raw);
    if (!g) return;
    const exists = goals.some((x) => normalizeGoal(x) === g);
    if (!exists) updateGoals([...goals, g]);
    setGoalInput("");
    Haptics.selectionAsync();
  };
  const removeCustomGoal = (g: string) => {
    updateGoals(goals.filter((x) => x !== g));
    Haptics.selectionAsync();
  };
  const [issues, setIssues] = useState("");

  const terrainLabel = useMemo(() => {
    const base = terrainTags.map((t) => cap(t));
    const extra = terrainOther.trim() ? [terrainOther.trim()] : [];
    return [...base, ...extra].join(", ");
  }, [terrainTags, terrainOther]);

  // ——— Toggles ———
  const [wantsAirFork, setWantsAirFork] = useState(false);
  const [zeroed, setZeroed] = useState(true); // default on — unchecking no longer blocks generate
  const [generating, setGenerating] = useState(false);

  // ——— Safety consent (RiskGate) ———
  const [riskOpen, setRiskOpen] = useState(false);
  const [hasRiskConsent, setHasRiskConsent] = useState(false);
  const riskResolveRef = useRef<((ok: boolean) => void) | null>(null);

  // ——— Zero-based help sheet ———
  const [zeroInfoOpen, setZeroInfoOpen] = useState(false);

  // ——— Monetization state (trial/pro) ———
  const [trialUsed, setTrialUsed] = useState<number>(0);
  const [isPro, setIsPro] = useState<boolean>(false);
  // Until the profile fetch resolves, pro/trial status is UNKNOWN — render a
  // neutral CTA rather than flashing free-tier copy at Pro users.
  const [proStatusResolved, setProStatusResolved] = useState(false);

  // --- CTA logic for main button ---
  const hasFreeTrialTune = !isPro && trialUsed < TRIAL_LIMIT;
  const trialExhausted = proStatusResolved && !isPro && !hasFreeTrialTune;
  const primaryCtaLabel = isOnboarding
    ? isPro || hasFreeTrialTune || !proStatusResolved
      ? "Generate my first tune"
      : "Go Pro for unlimited tunes"
    : !proStatusResolved || isPro
    ? "Generate tune"
    : hasFreeTrialTune
    ? "Use 1 free tune credit"
    : "Go Pro for unlimited tunes";

  const ctaDisabled = generating;

  // ——— Loaded preset + meta ———
  const [loadedPreset, setLoadedPreset] = useState<ZeroTuneResult | null>(null);
  const [loadedPresetMeta, setLoadedPresetMeta] = useState<PresetMeta>(null);
  const lastPresetRef = useRef<string | undefined>(undefined);

  // ✅ track whether we already applied the onboarding bikeId so we don’t bounce
  const onboardingAppliedRef = useRef(false);

  // Ref-based guard: prevents double-tap from firing onGenerate twice
  const generatingRef = useRef(false);

  // Cancel handle for the generating overlay — lets timeout or manual cancel abort the flow
  const cancelGenerateRef = useRef<(() => void) | null>(null);

  // ——— Prefill rider context from retention loop (tune-results "Try again") ———
  // Uses useFocusEffect so it fires even when the Tune tab is already mounted.
  // lastPrefillRef prevents re-applying the same payload on subsequent focuses.
  const lastPrefillRef = useRef<string | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      if (!prefill || prefill === lastPrefillRef.current || isOnboarding) return;
      lastPrefillRef.current = prefill;
      try {
        const p = JSON.parse(decodeURIComponent(prefill));
        if (typeof p.rider_weight_lbs === "number") setWeight(String(p.rider_weight_lbs));
        // "terrain" mode: skip goals so the user picks their intent fresh
        if (p.mode !== "terrain" && Array.isArray(p.goals) && p.goals.length > 0) {
          setGoals(p.goals);
        }
        if (typeof p.issues === "string" && p.issues.length > 0) setIssues(p.issues);
      } catch {
        // ignore bad payload
      }
    }, [prefill, isOnboarding])
  );

  // risk + monetization:
  //  - Risk: stored locally in AsyncStorage (per user)
  //  - Trial + Pro: from Supabase profile (account-based, not device-based)
  //  - Refreshed on every tab focus so post-paywall Pro status is always current.
  const refreshProAndTrial = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;

      if (!user?.id) {
        setIsPro(false);
        setTrialUsed(0);
        return;
      }

      // Load local Risk consent (only needed on first mount, but safe to re-run)
      try {
        const rawRisk = await AsyncStorage.getItem(riskKeyForUser(user.id));
        if (rawRisk) {
          const parsed: StoredRisk = JSON.parse(rawRisk);
          if (parsed.version === RISK_VER && parsed.acceptedAt) {
            setHasRiskConsent(true);
          }
        }
      } catch (e) {
        console.warn("Tune: failed to load local risk consent", e);
      }

      // 🔑 Pro + trial usage from Supabase profile (server-driven)
      try {
        const { data: prof, error: profErr } = await supabase
          .from("profiles")
          .select("is_pro, pro_until, trial_tunes_used")
          .eq("user_id", user.id)
          .maybeSingle<ProfileMeta>();

        if (profErr) {
          console.warn("Tune: profiles select failed", profErr);
          setIsPro(false);
          setTrialUsed(0);
        } else if (!prof) {
          setIsPro(false);
          setTrialUsed(0);
        } else {
          setIsPro(deriveIsPro(prof));
          setTrialUsed(prof.trial_tunes_used ?? 0);
        }
      } catch (e) {
        console.warn("Tune: profiles select threw", e);
        setIsPro(false);
        setTrialUsed(0);
      }
    } catch (e) {
      console.warn("Tune: init failed", e);
      setIsPro(false);
      setTrialUsed(0);
    } finally {
      // Status is now known (even if it resolved to "free") — the CTA can
      // stop showing the neutral label.
      setProStatusResolved(true);
    }
  }, []);

  useEffect(() => {
    refreshProAndTrial();
  }, [refreshProAndTrial]);

  useFocusEffect(
    useCallback(() => {
      refreshProAndTrial();
    }, [refreshProAndTrial])
  );

  // ——— Load persisted rider profile + custom goals on mount ———
  useEffect(() => {
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id ?? null;
        setUserId(uid);

        if (!uid) {
          setRiderExpanded(true);
          setRiderProfileLoaded(true);
          return;
        }

        const hasPrefill = typeof prefill === "string" && prefill.length > 0;

        if (!hasPrefill && !isOnboarding) {
          // Load rider profile
          try {
            const rawProfile = await AsyncStorage.getItem(riderProfileKey(uid));
            if (rawProfile) {
              const p = JSON.parse(rawProfile);
              if (typeof p.weight === "string" && p.weight) setWeight(p.weight);
              if (p.skill === "beginner" || p.skill === "intermediate" || p.skill === "pro")
                setSkill(p.skill);
              if (p.rideStyle === "short_motos" || p.rideStyle === "long_enduro")
                setRideStyle(p.rideStyle);
              setRiderExpanded(false);
            } else {
              setRiderExpanded(true);
            }
          } catch {
            setRiderExpanded(true);
          }

          // Load custom goals
          try {
            const rawGoals = await AsyncStorage.getItem(customGoalsKey(uid));
            if (rawGoals) {
              const saved: string[] = JSON.parse(rawGoals);
              if (Array.isArray(saved) && saved.length > 0) setGoals(saved);
            }
          } catch {}
        } else {
          // prefill param present or onboarding — don't collapse (prefill handles values)
          setRiderExpanded(false);
        }
      } catch {
        setRiderExpanded(true);
      } finally {
        setRiderProfileLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- bikes helper + live updates ----------
  const applySelected = async (b: Bike) => {
    setSelectedBikeId(b.id);
    setMake(b.make ?? "");
    setModel(b.model ?? "");
    setYear(b.year ? String(b.year) : "");
    // Load persisted bike specifics (wantsAirFork / zeroed)
    try {
      const raw = await AsyncStorage.getItem(bikeSpecsKey(b.id));
      if (raw) {
        const specs = JSON.parse(raw);
        if (typeof specs.wantsAirFork === "boolean") setWantsAirFork(specs.wantsAirFork);
        if (typeof specs.zeroed === "boolean") setZeroed(specs.zeroed);
        setBikeSpecsExpanded(false);
      } else {
        setBikeSpecsExpanded(true);
      }
    } catch {
      setBikeSpecsExpanded(true);
    }
  };
  const clearSelected = () => {
    setSelectedBikeId(null);
    setBikeSpecsExpanded(true);
  };

  // ✅ In onboarding, never allow clearing/changing the selected bike from Tune UI
  const canEditBikeInTune = !isOnboarding;

  const loadBikes = useCallback(async () => {
    try {
      setBikeLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user?.id) {
        setBikes([]);
        // ✅ In onboarding, keep the bikeId we were passed from Garage so the UI can stay locked.
        if (!isOnboarding) setSelectedBikeId(null);
        return;
      }

      const { data, error } = await supabase
        .from("bikes")
        .select("id, make, model, year, nickname, is_primary")
        .eq("user_id", user.id)
        .order("is_primary", { ascending: false })
        .order("updated_at", { ascending: false });

      if (error) throw error;
      const rows = (data || []) as Bike[];
      setBikes(rows);

      // ✅ ONBOARDING: force the bikeId selection, and do NOT fall back to primary
      if (isOnboarding && bikeId) {
        const match = rows.find((b) => b.id === bikeId);
        if (match) {
          applySelected(match);
          onboardingAppliedRef.current = true;
        } else {
          // keep waiting — the row may appear after insert/realtime
          // do NOT override with primary
        }
        return;
      }

      // normal mode: if we came from Garage with bikeId, prefer that
      if (bikeId) {
        const match = rows.find((b) => b.id === bikeId);
        if (match) {
          applySelected(match);
          return;
        }
      }

      // normal mode: if nothing is selected yet, fall back to primary
      if (!selectedBikeId) {
        const primary = rows.find((b) => b.is_primary);
        if (primary) applySelected(primary);
      }
    } catch (e: any) {
      toastRef.current.show(e?.message ?? "Failed to load Garage", { kind: "error" });
    } finally {
      setBikeLoading(false);
    }
  }, [bikeId, isOnboarding, selectedBikeId]);

  // initial load
  useEffect(() => {
    loadBikes();
  }, [loadBikes]);

  // refetch whenever the Tune tab/screen gains focus
  useFocusEffect(
    useCallback(() => {
      loadBikes();
    }, [loadBikes])
  );

  // realtime subscribe to bikes changes for this user
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return;

      channel = supabase
        .channel("bikes-for-user")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "bikes", filter: `user_id=eq.${uid}` },
          () => loadBikes()
        )
        .subscribe();
    })();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [loadBikes]);
  // --------------------------------------------------------------

  // React to incoming preset while the tab stays mounted
  useFocusEffect(
    useCallback(() => {
      const raw = preset as string | undefined;
      if (!raw || raw === lastPresetRef.current) return;

      lastPresetRef.current = raw;
      try {
        const parsed = JSON.parse(decodeURIComponent(raw));

        if (parsed && typeof parsed === "object" && parsed.tune) {
          setLoadedPreset(parsed.tune as ZeroTuneResult);
          setLoadedPresetMeta({
            id: parsed.id,
            name: parsed.name,
            track_name: parsed.track_name ?? null,
            terrain: parsed.terrain ?? null,
            bike_hint: parsed.bike_hint ?? null,
          });
        } else {
          setLoadedPreset(parsed as ZeroTuneResult);
          setLoadedPresetMeta(null);
        }

        router.replace("/(tabs)/tune");
      } catch {
        // ignore bad payloads
      }
    }, [preset, router])
  );

  const ensureRiskAccepted = (): Promise<boolean> => {
    if (hasRiskConsent) return Promise.resolve(true);
    setRiskOpen(true);
    return new Promise<boolean>((resolve) => {
      riskResolveRef.current = resolve;
    });
  };

  const toggleTerrain = (tTag: string) => {
    setTerrainTags((cur) => {
      if (cur.includes(tTag)) {
        // always keep at least one
        if (cur.length === 1) return cur;
        return cur.filter((x) => x !== tTag);
      }
      // limit to 3 tags, drop the oldest if needed
      if (cur.length >= 3) {
        const [, ...rest] = cur;
        return [...rest, tTag];
      }
      return [...cur, tTag];
    });
  };

  // ——— Generate with AI (gated by Supabase RPC when signed-in) ———
  const onGenerate = async () => {
    // Ref-based re-entry guard — blocks double-tap before async state updates
    if (generatingRef.current) return;
    generatingRef.current = true;

    const ok = await ensureRiskAccepted();
    if (!ok) {
      generatingRef.current = false;
      return;
    }

    // Set when claim_free_tune actually consumed the trial credit (reason
    // "trial", not "pro") so a failed/timed-out generation can refund it.
    let claimedTrialCredit = false;

    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;

      // ✅ Guest allowed ONLY during onboarding
      const isGuest = !user?.id;

      if (isGuest && !isOnboarding) {
        toast.show("Sign in to generate a tune", { kind: "info" });
        router.push("/signup");
        return;
      }

      // 🔐 Only run claim_free_tune when we actually have a signed-in user
      if (!isGuest && !isPro) {
        const { data: claim, error: claimErr } = await supabase.rpc("claim_free_tune").single();

        if (claimErr) {
          console.warn("Tune: claim_free_tune failed", claimErr);
          toast.show("Couldn’t check your free tune. Try again.", { kind: "error" });
          return;
        }

        if (!claim?.ok && claim?.reason === "no_trial") {
          // No trial left – do NOT call AI
          toast.show("Your free AI tune is used. Go Pro for unlimited tunes.", {
            kind: "info",
          });
          router.push("/premium");
          return;
        }

        if (!claim?.ok) {
          // Catch-all: any other non-ok reason (rate_limited, error, unknown shape)
          console.warn("Tune: claim_free_tune denied", claim);
          toast.show("Couldn't claim your tune right now. Try again.", { kind: "error" });
          return;
        }

        // claim.reason is 'trial' or 'pro'
        claimedTrialCredit = (claim as any)?.reason === "trial";
        const trialCountFromServer = (claim as any)?.trial_tunes_used;

        if (typeof trialCountFromServer === "number") {
          setTrialUsed(trialCountFromServer);
        }

        if (claim?.reason === "pro") {
          setIsPro(true); // server says they’re Pro now
        }
      }

      if (track.trim() && isProfane(track)) {
        toast.show("Please choose a different track name.", { kind: "error" });
        generatingRef.current = false;
        return;
      }

      setGenerating(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const elevFt =
        elevBucket == null
          ? undefined
          : elevBucket === "sea_level"
          ? 0
          : elevBucket === "moderate"
          ? 3000
          : 8000;

      const input: ZeroTuneInput = {
        make: make.trim() || undefined,
        model: model.trim() || undefined,
        year: year ? Number(year) : undefined,
        terrain: terrainLabel,
        track: track.trim() || undefined,
        temp_f: tempFahr ?? undefined,
        elev_ft: elevFt,
        rider: {
          weight_lbs: weight ? Number(weight) : undefined,
          skill,
          style: rideStyle,
          goals,
          issues: issues.trim() || undefined,
        },
        has_zeroed_clickers: !!zeroed,

        // NEW: pass the AER / air-fork toggle through to the Edge Function
        wants_air_fork: wantsAirFork,
      };

      // Per-model specs (verified bike_models row or null) drive the sag bounds
      // sent in guardrails + the spring-rate check. Fail-open: null => DEFAULT_SAG
      // and no spring card; never blocks generation.
      const modelSpecs = await fetchModelSpecs({
        id: selectedBikeId ?? null,
        make: input.make ?? null,
        model: input.model ?? null,
        year: input.year ?? null,
      });
      const sagBounds = resolveSagBounds(modelSpecs);
      const springCheck = computeSpringCheck(modelSpecs, input.rider.weight_lbs);

      const GENERATE_TIMEOUT_MS = 30_000;
      const s: ZeroTuneResult = await Promise.race([
        generateTune(input, sagBounds),
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("This is taking longer than expected — try again")),
            GENERATE_TIMEOUT_MS
          );
          cancelGenerateRef.current = () => {
            clearTimeout(timer);
            reject(new Error("Generation cancelled"));
          };
        }),
      ]);
      cancelGenerateRef.current = null;
      // Carry the client-computed spring check on the result so it renders on
      // tune-results and is captured in the setup_version context.
      if (springCheck) s.spring_check = springCheck;

      // Persist rider profile after successful generation
      if (user?.id) {
        AsyncStorage.setItem(
          riderProfileKey(user.id),
          JSON.stringify({ weight, skill, rideStyle })
        ).catch(() => {});
      }

      // Persist bike specifics (only for garage bikes with a stable ID)
      if (selectedBikeId && user?.id) {
        AsyncStorage.setItem(
          bikeSpecsKey(selectedBikeId),
          JSON.stringify({ wantsAirFork, zeroed })
        ).catch(() => {});
      }

      await logEvent(AI_TUNE_GENERATED_ZERO, {
        terrain: terrainLabel,
        track: input.track,
        weight,
        skill,
        rideStyle,
        goals,
        zeroed,
        wantsAirFork,
        make: input.make,
        model: input.model,
        year: input.year,
        selectedBikeId,
        onboarding: isOnboarding ? 1 : 0,
        guest: !user?.id ? 1 : 0,
        spring_check_status: springCheck?.status ?? "unknown",
      });

      const encodedResult = encodeURIComponent(JSON.stringify(s));
      const encodedMeta = encodeURIComponent(
        JSON.stringify({
          bike: {
            year: input.year,
            make: input.make,
            model: input.model,
            selectedBikeId,
          },
          context: {
            terrain: terrainLabel,
            track: input.track,
            temp_f: input.temp_f,
            elev_ft: input.elev_ft,
            wants_air_fork: wantsAirFork,
            rider_weight_lbs: weight ? Number(weight) : undefined,
            goals,
            issues: issues.trim() || undefined,
          },
          // Engine-context capture: the resolved model + sag inputs, carried to
          // the setup_version's recommended_settings.context on save.
          spec: {
            model_id: modelSpecs?.id ?? null,
            spec_verified: modelSpecs?.spec_verified ?? false,
            sag_target_mm: sagBounds.target,
            sag_bounds: [sagBounds.min, sagBounds.max],
          },
          onboarding: isOnboarding ? true : false,
          guest: !user?.id,
        })
      );

      if (isTuneOnboarding) {
        await setStep("results_locked");
        if (user?.id) {
          const { error: stepErr } = await supabase.from("profiles").upsert(
            { user_id: user.id, onboarding_step: "results_locked" },
            { onConflict: "user_id" }
          );
          if (stepErr) console.warn("[Tune] onboarding_step upsert failed:", stepErr);
        }
        await writePendingTune({
          r: encodedResult,
          meta: encodedMeta,
          bikeId: selectedBikeId ?? null,
          savedAt: Date.now(),
        });
        const funnelId = await getOrCreateFunnelId();
        const ageMinutesSinceLastStep = Math.round(
          Math.max(0, Date.now() - Date.parse(state.lastUpdatedAt || "")) / 60000
        );
        await logEvent(
          "onboarding_tune_generated",
          {
            funnel_id: funnelId,
            onboarding_step: "results_locked",
            signed_in: !!user?.id,
            bike_id: selectedBikeId ?? null,
            pending_tune_exists: true,
            resume: ageMinutesSinceLastStep >= 5,
            age_minutes_since_last_step: ageMinutesSinceLastStep,
            source_route: "/(tabs)/tune",
            spring_check_status: springCheck?.status ?? "unknown",
          },
          { allowAnonymous: true, queueIfAnonymous: true }
        );
      }

      router.push({
        pathname: "/tune-results",
        params: {
          r: encodedResult,
          meta: encodedMeta,
        },
      });
    } catch (e: any) {
      // The credit was claimed before the engine ran (deliberate — claiming
      // after generation would allow race abuse). Nothing was delivered, so
      // give the credit back. Fire-and-forget: refund failure must not mask
      // the generation error the rider needs to see.
      if (claimedTrialCredit) {
        void (async () => {
          try {
            const { data, error: refundErr } = await supabase
              .rpc("refund_free_tune")
              .single();
            if (refundErr) {
              console.error("refund_free_tune failed", refundErr);
              return;
            }
            const used = (data as any)?.trial_tunes_used;
            if (typeof used === "number") setTrialUsed(used);
          } catch (refundErr) {
            console.error("refund_free_tune failed", refundErr);
          }
        })();
      }
      toast.show(e?.message ?? "AI tune failed", { kind: "error" });
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  // ——— Apply loaded preset (no AI, no trial impact) ———
  const applyPresetNow = async () => {
    if (!loadedPreset) return;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user?.id) throw new Error("Please sign in");

      const s: ZeroTuneResult = loadedPreset;

      await logEvent(PRESET_APPLIED, { track, terrain: terrainLabel, selectedBikeId });
      Haptics.selectionAsync();

      router.push({
        pathname: "/tune-results",
        params: {
          r: encodeURIComponent(JSON.stringify(s)),
          meta: encodeURIComponent(
            JSON.stringify({
              preset: {
                id: loadedPresetMeta?.id,
                name: loadedPresetMeta?.name,
              },
              bike_hint:
                loadedPresetMeta?.bike_hint ??
                {
                  year: year ? Number(year) : null,
                  make: make || null,
                  model: model || null,
                },
              context: {
                track: loadedPresetMeta?.track_name ?? (track || null),
                terrain: loadedPresetMeta?.terrain ?? (terrainLabel ? [terrainLabel] : []),
                wants_air_fork: wantsAirFork,
                rider_weight_lbs: weight ? Number(weight) : undefined,
                goals,
                issues: issues.trim() || undefined,
              },
              onboarding: isOnboarding ? true : false,
            })
          ),
        },
      });
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to apply preset", { kind: "error" });
    }
  };

  /* ------------------------------- UI helpers ------------------------------ */
  const Pill = ({
    label,
    active,
    onPress,
  }: {
    label: string;
    active: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={() => {
        onPress();
        Haptics.selectionAsync();
      }}
      style={[S.pill, active && S.pillActive]}
    >
      <Text style={[S.pillText, active && S.pillTextActive]}>{label}</Text>
    </Pressable>
  );

  const selectedBike = useMemo(() => {
    if (!selectedBikeId) return null;
    return bikes.find((b) => b.id === selectedBikeId) ?? null;
  }, [bikes, selectedBikeId]);

  /* ——— Trial-locked render (onboardingStep === "trial") ———
   * Shows the pending tune blurred with an unlock CTA, or a simple lock
   * screen if the pending tune has expired.
   */
  if (isTrialLocked && trialPendingLoaded) {
    const pendingResult = trialPending?.r
      ? (() => {
          try {
            return JSON.parse(decodeURIComponent(trialPending.r)) as {
              fork: { comp_clicks: number; reb_clicks: number };
              shock: { lsc_clicks: number; hsc_turns: number; reb_clicks: number; sag_mm: number };
            };
          } catch {
            return null;
          }
        })()
      : null;

    const MetricRow = ({
      label,
      value,
    }: {
      label: string;
      value: string;
    }) => (
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.BORDER }}>
        <Text style={{ color: C.MUTED, fontSize: 14 }}>{label}</Text>
        <Text style={{ color: C.TEXT, fontSize: 14, fontWeight: "700" }}>{value}</Text>
      </View>
    );

    return (
      <View style={{ flex: 1, backgroundColor: C.BG }}>
        <View style={{ height: insets.top }} />
        {/* Accent header */}
        <View style={[S.headerSolid, { paddingBottom: 16 }]}>
          <Text style={S.heroTitle}>Your First Tune</Text>
          <Text style={S.heroSubtitle}>
            Your tune is ready — start your free trial to unlock it.
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 140 + insets.bottom }}
          showsVerticalScrollIndicator={false}
        >
          {pendingResult ? (
            <>
              {/* Blurred fork card */}
              <View style={[S.card, { marginBottom: 12, overflow: "hidden" }]}>
                <Text style={[S.h1, { marginBottom: 8 }]}>Fork</Text>
                <MetricRow label="Compression" value={`${pendingResult.fork.comp_clicks} clicks`} />
                <MetricRow label="Rebound" value={`${pendingResult.fork.reb_clicks} clicks`} />
                {/* Blur overlay */}
                <BlurView
                  intensity={Platform.OS === "ios" ? 28 : 60}
                  tint="dark"
                  style={{ ...StyleSheet.absoluteFillObject, borderRadius: 14, zIndex: 2 }}
                />
                <View style={{ ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 3 }}>
                  <Ionicons name="lock-closed" size={20} color={C.MUTED} />
                </View>
              </View>

              {/* Blurred shock card */}
              <View style={[S.card, { marginBottom: 12, overflow: "hidden" }]}>
                <Text style={[S.h1, { marginBottom: 8 }]}>Shock</Text>
                <MetricRow label="Low-Speed Comp" value={`${pendingResult.shock.lsc_clicks} clicks`} />
                <MetricRow label="High-Speed Comp" value={`${pendingResult.shock.hsc_turns?.toFixed(1) ?? "—"} turns`} />
                <MetricRow label="Rebound" value={`${pendingResult.shock.reb_clicks} clicks`} />
                <MetricRow label="Sag" value={`${pendingResult.shock.sag_mm} mm`} />
                <BlurView
                  intensity={Platform.OS === "ios" ? 28 : 60}
                  tint="dark"
                  style={{ ...StyleSheet.absoluteFillObject, borderRadius: 14, zIndex: 2 }}
                />
                <View style={{ ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 3 }}>
                  <Ionicons name="lock-closed" size={20} color={C.MUTED} />
                </View>
              </View>
            </>
          ) : (
            /* Pending tune expired — no blurred preview available */
            <View style={[S.card, { alignItems: "center", paddingVertical: 32 }]}>
              <Ionicons name="flash-outline" size={36} color={C.MUTED} style={{ marginBottom: 12 }} />
              <Text style={[S.h1, { textAlign: "center" }]}>Your tune is waiting</Text>
              <Text style={[S.muted, { textAlign: "center", marginTop: 6 }]}>
                Start your free trial to generate and reveal your personalized setup.
              </Text>
            </View>
          )}

          {/* Lock info card */}
          <View style={[S.card, { marginBottom: 12, alignItems: "center", paddingVertical: 20 }]}>
            <Ionicons name="lock-closed" size={28} color={C.ACCENT} style={{ marginBottom: 10 }} />
            <Text style={[S.h1, { textAlign: "center" }]}>Unlock your first tune</Text>
            <Text style={[S.muted, { textAlign: "center", marginTop: 6 }]}>
              Your exact compression, rebound, and sag numbers are ready. Start your free trial to reveal them.
            </Text>
          </View>
        </ScrollView>

        {/* Sticky CTA */}
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 16,
            paddingTop: 12,
            backgroundColor: C.BG,
            borderTopWidth: 1,
            borderTopColor: C.BORDER,
          }}
        >
          <Pressable
            onPress={async () => {
              if (!trialPending) {
                // Expired — reset to tune step in both stores
                await setStep("tune");
                const { data: auth } = await supabase.auth.getUser();
                if (auth?.user?.id) {
                  void supabase.from("profiles").upsert(
                    { user_id: auth.user.id, onboarding_step: "tune" },
                    { onConflict: "user_id" }
                  );
                }
                return;
              }
              router.push("/premium");
            }}
            style={{
              backgroundColor: C.ACCENT,
              borderRadius: 999,
              paddingVertical: 16,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>
              {trialPending ? "Unlock Your First Tune" : "Generate Your First Tune"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  /* --------------------------------- Render -------------------------------- */
  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", android: undefined })}
        style={{ flex: 1, backgroundColor: C.BG }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
      {/* gap under the notch/time so the accent header never clashes */}
      <View style={[S.topSafeSpacer, { height: insets.top }]} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          // give room for sticky footer + big center tab bubble + bottom inset
          paddingBottom: STICKY_FOOTER_HEIGHT + insets.bottom + 100,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      >
        {/* Header (solid dark, no gradient) */}
        <View style={S.headerSolid}>
          <OnboardingProgress />
          <Text style={S.heroTitle}>{"Suggested setup"}</Text>
          <Text style={S.heroSubtitle}>
            {isOnboarding
              ? state.hasSeenIntro
                ? "Your bike is ready — generate your tune."
                : "Confirm today’s conditions, then generate your first tune."
              : "Dial in a zero-based tune for today’s conditions."}
          </Text>

          {/* Actions */}
          <View style={S.headerActions}>
            {!isOnboarding && (
              <Pressable
                onPress={() => {
                  router.push("/(tabs)/garage");
                  Haptics.selectionAsync();
                }}
                hitSlop={8}
                style={S.manageLink}
              >
                <Ionicons name="bicycle" size={14} color={C.MUTED} />
                <Text style={S.manageLinkText}>Manage Garage</Text>
                <Ionicons name="chevron-forward" size={14} color={C.MUTED} />
              </Pressable>
            )}

            {!isOnboarding && (
              <Pressable
                onPress={() => {
                  router.push("/my-presets");
                  Haptics.selectionAsync();
                }}
                hitSlop={8}
                style={S.manageLink}
              >
                <Ionicons name="bookmarks" size={14} color={C.MUTED} />
                <Text style={S.manageLinkText}>My Presets</Text>
                <Ionicons name="chevron-forward" size={14} color={C.MUTED} />
              </Pressable>
            )}
          </View>

          {/* One-time wayfinding for the Bike Home restructure */}
          {!isOnboarding && <GarageCoachmark />}

          {/* Ride check-in: outcome ("did the last refinement help?") or
              first-ride prompt. Home hosts the primary instance; the session
              flag inside the card guarantees only one shows per session. */}
          {!isOnboarding && <OutcomeCheckinCard surface="tune" />}

          {/* Garage Selector */}
          <View style={S.selectorCard}>
            <View style={S.selectorHeaderRow}>
              <Text style={S.selectorLabel}>{isOnboarding ? "Selected bike" : "Select bike"}</Text>

              {!isOnboarding && bikes.length > 0 && (
                <Pressable
                  onPress={() => {
                    setBikeSheetOpen(true);
                    Haptics.selectionAsync();
                  }}
                  hitSlop={6}
                  style={S.seeAllLink}
                >
                  <Text style={S.seeAllText}>See all ({bikes.length})</Text>
                </Pressable>
              )}
            </View>

            {bikeLoading ? (
              <ActivityIndicator color="#fff" />
            ) : isOnboarding ? (
              // ✅ Onboarding: show a single locked card (even if bikes.length === 0)
              // ✅ If Supabase bike isn't loaded (guest), fall back to Make/Model/Year already in state
              <View style={[S.onbBikeCard, { borderColor: "rgba(255,255,255,0.28)" }]}>
                <Text style={S.onbBikeCardTitle}>
                  {selectedBike
                    ? `${selectedBike.year} ${selectedBike.make} ${selectedBike.model}${
                        selectedBike.nickname ? ` · ${selectedBike.nickname}` : ""
                      }`
                    : make?.trim() || model?.trim() || year?.trim()
                    ? `${year?.trim() || "—"} ${make?.trim() || ""} ${model?.trim() || ""}`.trim()
                    : "Loading selected bike…"}
                </Text>
                <Text style={S.onbBikeCardSub}>
                  Locked for onboarding (you can edit later in Garage).
                </Text>
              </View>
            ) : bikes.length === 0 ? (
              <Text style={S.selectorEmpty}>
                No bikes in your Garage yet. Add one in the Garage tab — or use the fields below.
              </Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                nestedScrollEnabled
                contentContainerStyle={{ paddingRight: 6 }}
              >
                {bikes.slice(0, 6).map((b) => {
                  const active = selectedBikeId === b.id;
                  return (
                    <Pressable
                      key={b.id}
                      onPress={() => (active ? clearSelected() : applySelected(b))}
                      style={[S.bikeChip, active && S.bikeChipActive]}
                    >
                      <Text style={[S.bikeChipText, active && S.bikeChipTextActive]}>
                        {b.year} {b.make} {b.model}
                        {b.nickname ? ` · ${b.nickname}` : ""}
                        {b.is_primary ? "  ★" : ""}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable onPress={clearSelected} style={[S.bikeChip, S.bikeChipGhost]}>
                  <Text style={[S.bikeChipText, S.bikeChipGhostText]}>Custom</Text>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>

        {/* Running setup: one-line pointer to Bike Home. The tune tab is for
            generating; managing setups lives in the garage. */}
        {!isOnboarding && selectedBikeId && isUuid(selectedBikeId) && (
          <RunningSetupRow bikeId={selectedBikeId} />
        )}

        {/* Bike (free text) */}
        <View style={S.card}>
          <Text style={S.h1}>Bike</Text>
          <Text style={S.muted}>Helpful for model-aware tuning.</Text>
          <View style={S.row}>
            <View style={{ flex: 1 }}>
              <Text style={S.caption}>Make</Text>
              <TextInput
                style={S.input}
                placeholder="KTM / Yamaha / Honda..."
                placeholderTextColor={C.MUTED}
                value={make}
                onChangeText={setMake}
                editable={canEditBikeInTune}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.caption}>Model</Text>
              <TextInput
                style={S.input}
                placeholder="250 SX-F / YZ250F..."
                placeholderTextColor={C.MUTED}
                value={model}
                onChangeText={setModel}
                editable={canEditBikeInTune}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>

            <View style={{ width: 110 }}>
              <Text style={S.caption}>Year</Text>
              <TextInput
                style={S.input}
                placeholder="2023"
                placeholderTextColor={C.MUTED}
                keyboardType="number-pad"
                value={year}
                onChangeText={setYear}
                editable={canEditBikeInTune}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>
          </View>

          {isOnboarding && (
            <Text style={[S.muted, { marginTop: 6 }]}>
              During onboarding, bike details are locked to the bike you selected.
            </Text>
          )}
        </View>

        {/* Conditions */}
        <View style={S.card}>
          <Text style={S.h1}>Conditions</Text>

          <Text style={S.label}>Terrain</Text>
          <View style={S.rowWrap}>
            {["hardpack", "sand", "mud", "rocks", "roots", "mixed", "mx"].map((tTag) => (
              <Pill
                key={tTag}
                label={cap(tTag)}
                active={terrainTags.includes(tTag)}
                onPress={() => toggleTerrain(tTag)}
              />
            ))}
          </View>
          <Text style={[S.caption, { marginTop: 6 }]}>
            Pick 1–3 that best match. Add details below if needed.
          </Text>

          <Text style={S.label}>Other terrain (optional)</Text>
          <TextInput
            style={S.input}
            placeholder="e.g., deep ruts, choppy whoops, square-edge rocks"
            placeholderTextColor={C.MUTED}
            value={terrainOther}
            onChangeText={setTerrainOther}
            autoCorrect
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
          />

          <Text style={S.label}>Track / Trail (optional)</Text>
          <TextInput
            style={S.input}
            placeholder="e.g., Glen Helen, local singletrack..."
            placeholderTextColor={C.MUTED}
            value={track}
            onChangeText={setTrack}
            autoCorrect
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
          />

          <TempSlider value={tempFahr} onChange={setTempFahr} C={C} />

          <Text style={[S.label, { marginTop: 12 }]}>Elevation (optional)</Text>
          <View style={S.rowWrap}>
            {(
              [
                { label: "Sea level", value: "sea_level" as const },
                { label: "Moderate", value: "moderate" as const },
                { label: "High altitude", value: "high" as const },
              ] as const
            ).map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => {
                  setElevBucket(elevBucket === opt.value ? null : opt.value);
                  Haptics.selectionAsync();
                }}
                style={[S.pill, elevBucket === opt.value && S.pillActive]}
              >
                <Text style={[S.pillText, elevBucket === opt.value && S.pillTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[S.caption, { marginTop: 4 }]}>
            Sea level ~0 ft · Moderate ~3,000 ft · High altitude ~8,000 ft
          </Text>
        </View>

        {/* Rider */}
        <View style={S.card}>
          {riderProfileLoaded && !riderExpanded ? (
            /* Confirmed summary row */
            <SettingRow
              icon="person-outline"
              label="Rider"
              hint={
                `${weight} lb · ${cap(skill)} · ${rideStyle === "short_motos" ? "Short Motos" : "Long Enduro"}` +
                (goals.length > 0 ? `\n${goals.map(cap).join(", ")}` : "")
              }
              trailingAction={{ label: "Edit", onPress: () => setRiderExpanded(true) }}
            />
          ) : (
            /* Full form */
            <>
              <Text style={S.h1}>Rider</Text>

              <Text style={S.label}>Weight with gear (lbs)</Text>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <TextInput
                  style={S.inputSm}
                  placeholder="e.g., 185"
                  placeholderTextColor={C.MUTED}
                  value={weight}
                  onChangeText={setWeight}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
                <View style={S.unitPill}>
                  <Text style={S.unitPillText}>lb</Text>
                </View>
              </View>
              <Text style={S.metricHint}>We scale the tune roughly with rider weight.</Text>

              <Text style={S.label}>Skill level</Text>
              <View style={S.rowWrap}>
                <Pill
                  label="Beginner"
                  active={skill === "beginner"}
                  onPress={() => setSkill("beginner")}
                />
                <Pill
                  label="Intermediate"
                  active={skill === "intermediate"}
                  onPress={() => setSkill("intermediate")}
                />
                <Pill label="Pro" active={skill === "pro"} onPress={() => setSkill("pro")} />
              </View>

              <Text style={S.label}>Ride style</Text>
              <View style={S.rowWrap}>
                <Pill
                  label="Short Motos"
                  active={rideStyle === "short_motos"}
                  onPress={() => setRideStyle("short_motos")}
                />
                <Pill
                  label="Long Enduro"
                  active={rideStyle === "long_enduro"}
                  onPress={() => setRideStyle("long_enduro")}
                />
              </View>

              <Text style={S.label}>Goals (pick a few)</Text>
              <View style={S.rowWrap}>
                {DEFAULT_GOALS.map((g) => (
                  <Pill
                    key={g}
                    label={cap(g)}
                    active={goals.includes(g)}
                    onPress={() => {
                      const newGoals = goals.includes(g)
                        ? goals.filter((x) => x !== g)
                        : [...goals, g];
                      updateGoals(newGoals);
                    }}
                  />
                ))}
              </View>

              <View style={S.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={S.caption}>Add your own goal</Text>
                  <TextInput
                    style={S.input}
                    placeholder="e.g., less dive on braking"
                    placeholderTextColor={C.MUTED}
                    value={goalInput}
                    onChangeText={setGoalInput}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      addGoal();
                      Keyboard.dismiss();
                    }}
                  />
                </View>
                <View style={{ width: 8 }} />
                <Pressable onPress={addGoal} hitSlop={8} style={S.btnSmall}>
                  <Text style={S.btnSmallText}>Add</Text>
                </Pressable>
              </View>

              {goals.some((g) => !DEFAULT_GOALS.includes(g as any)) && (
                <>
                  <Text style={[S.caption, { marginTop: 10 }]}>Your custom goals</Text>
                  <View style={S.rowWrap}>
                    {goals
                      .filter((g) => !DEFAULT_GOALS.includes(g as any))
                      .map((g) => (
                        <View key={g} style={S.customChip}>
                          <Text style={S.customChipText}>{cap(g)}</Text>
                          <Pressable
                            onPress={() => removeCustomGoal(g)}
                            hitSlop={8}
                            style={S.customChipClose}
                          >
                            <Text style={S.customChipCloseText}>×</Text>
                          </Pressable>
                        </View>
                      ))}
                  </View>
                </>
              )}

              <Text style={S.label}>Current issues (optional)</Text>
              <TextInput
                style={[S.input, { minHeight: 80 }]}
                placeholder="e.g., harsh on braking bumps; packs on whoops; kicks on square-edge..."
                placeholderTextColor={C.MUTED}
                value={issues}
                onChangeText={setIssues}
                multiline
              />

            </>
          )}
        </View>

        {/* Bike Specifics (Air fork + Zero-based) */}
        <View style={S.card}>
          {!bikeSpecsExpanded ? (
            /* Confirmed summary row */
            <SettingRow
              icon="build-outline"
              label="Bike Specifics"
              hint={
                (wantsAirFork ? "Air fork (AER)" : "Coil fork") +
                (!zeroed ? " · Not zeroed" : "")
              }
              trailingAction={{ label: "Edit", onPress: () => setBikeSpecsExpanded(true) }}
            />
          ) : (
            <>
              {/* Air fork toggle */}
              <Pressable
                onPress={() => {
                  setWantsAirFork((z) => !z);
                  Haptics.selectionAsync();
                }}
                style={[S.rowBetween, { alignItems: "center" }]}
              >
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={S.h1}>Air fork (AER)?</Text>
                  <Text style={S.muted}>
                    If yes, we’ll include a fork air-pressure target (and scale it to rider weight).
                  </Text>
                </View>
                <View style={[S.check, wantsAirFork && S.checkOn]} />
              </Pressable>

              <View style={{ height: 16 }} />

              {/* Zero-based */}
              <View style={S.requiredHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={S.h1}>Zero-based</Text>
                  <Pressable
                    onPress={() => {
                      setZeroInfoOpen(true);
                      Haptics.selectionAsync();
                    }}
                    hitSlop={10}
                  >
                    <Ionicons name="help-circle" size={20} color={C.TEXT} />
                  </Pressable>
                </View>
              </View>
              <View style={[S.rowBetween, { alignItems: "center", marginTop: 6 }]}>
                <Text style={[S.muted, { flex: 1, paddingRight: 12 }]}>
                  All clickers turned fully in first. We’ll guide you if needed.
                </Text>
                <Pressable
                  onPress={() => {
                    setZeroed((z) => !z);
                    Haptics.selectionAsync();
                  }}
                  hitSlop={8}
                >
                  <View style={[S.check, zeroed && S.checkOn]} />
                </Pressable>
              </View>
            </>
          )}
        </View>

        {/* Preset loaded banner */}
        {!isOnboarding && loadedPreset ? (
          <View style={[S.card, { marginTop: 12, borderColor: C.ACCENT }]}>
            <Text style={{ color: C.TEXT, fontWeight: "800" }}>
              Preset loaded{loadedPresetMeta?.name ? `: ${loadedPresetMeta.name}` : ""}
            </Text>
            <Text style={{ color: C.MUTED, marginTop: 4 }}>
              Apply the preset now, or tweak the form and run AI for a custom tune.
            </Text>
            <View style={{ height: 10 }} />
            <Pressable onPress={applyPresetNow} style={S.btn}>
              <Text style={S.btnText}>Use Preset Now</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky footer (hidden while sheets are open so nothing clashes) */}
      {!zeroInfoOpen && !bikeSheetOpen && (
        <View style={S.stickyFooterWrap} pointerEvents="box-none">
          {Platform.OS === "ios" ? (
            <BlurView
              intensity={30}
              tint={C.BG === lightTheme.BG ? "light" : "dark"}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: C.CARD }]} />
          )}
          <View style={[S.stickyInner, { paddingBottom: 14 + insets.bottom }]}>
            <Text style={S.stickyLine}>
              {selectedBikeId ? "Garage bike" : "Custom bike"} • {terrainLabel || "Terrain"} •{" "}
              {weight || "—"} lb
            </Text>

            <Pressable
              onPress={() => {
                // If trial is exhausted and they’re not Pro, this button is a pure paywall CTA
                if (trialExhausted) {
                  Haptics.selectionAsync();
                  router.push("/premium");
                  return;
                }
                onGenerate();
              }}
              disabled={ctaDisabled}
              style={({ pressed }) => [
                S.stickyBtn,
                ctaDisabled && S.stickyBtnDisabled,
                pressed && { opacity: 0.95 },
              ]}
            >
              <Text style={S.stickyBtnText}>{primaryCtaLabel}</Text>
            </Pressable>

          </View>
        </View>
      )}

      {/* All-bikes sheet (disabled in onboarding) */}
      {!isOnboarding && (
        <BikePickerSheet
          open={bikeSheetOpen}
          bikes={bikes}
          selectedId={selectedBikeId}
          onSelect={(b) => (b ? applySelected(b) : clearSelected())}
          onClose={() => setBikeSheetOpen(false)}
          C={C}
          S={S}
        />
      )}

      {/* Zero-based info sheet */}
      {zeroInfoOpen && (
        <View style={S.sheetWrap} pointerEvents="box-none">
          <Pressable style={S.sheetOverlay} onPress={() => setZeroInfoOpen(false)} />
          <View style={S.sheet}>
            <View style={S.sheetHeader}>
              <Text style={S.sheetTitle}>What is zero-based?</Text>
              <Pressable
                onPress={() => setZeroInfoOpen(false)}
                hitSlop={10}
                style={S.sheetClose}
              >
                <Ionicons name="close" size={18} color={C.MUTED} />
              </Pressable>
            </View>

            <Text style={[S.muted, { marginTop: 10 }]}>
              Zero-based just means we all start from the same point: every clicker is turned
              gently all the way in until it stops.
            </Text>

            <Text style={[S.muted, { marginTop: 10 }]}>
              1. Turn each clicker slowly all the way IN (clockwise, toward the "+" on the cap)
              until it lightly stops.
            </Text>

            <Text style={[S.muted, { marginTop: 6 }]}>
              2. From there, count clicks OUT as you back it off. So “12 clicks” means 12 clicks
              out from fully closed.
            </Text>

            <Text style={[S.muted, { marginTop: 10 }]}>
              All Dialed Offroad numbers are from zero. If you get lost, just close the clicker
              again and recount out.
            </Text>
          </View>
        </View>
      )}

      {/* Risk consent modal */}
      <RiskGate
        visible={riskOpen}
        onCancel={() => {
          setRiskOpen(false);
          const resolve = riskResolveRef.current;
          riskResolveRef.current = null;
          if (resolve) resolve(false);
        }}
        onAccept={async () => {
          try {
            const { data: auth } = await supabase.auth.getUser();
            const user = auth?.user;
            const acceptedAt = new Date().toISOString();

            if (user?.id) {
              try {
                const payload: StoredRisk = { version: RISK_VER, acceptedAt };
                await AsyncStorage.setItem(riskKeyForUser(user.id), JSON.stringify(payload));
              } catch (e) {
                console.warn("RiskGate: local risk consent save failed", e);
              }
            }

            setHasRiskConsent(true);
          } finally {
            setRiskOpen(false);
            const resolve = riskResolveRef.current;
            riskResolveRef.current = null;
            if (resolve) resolve(true);
          }
        }}
      />
      </KeyboardAvoidingView>

    {/* Full-screen generating overlay — appears when setGenerating(true) fires, tears down in finally */}
    {generating && (
      <GeneratingOverlay
        accent={C.ACCENT}
        onCancel={() => cancelGenerateRef.current?.()}
      />
    )}
    </View>
  );
}

/* ---------------------- Generating overlay component --------------------- */

const GEN_STAGES = [
  "Read bike + conditions",
  "Matched rider profile",
  "Calculating clicker settings\u2026",
] as const;

const RING_SIZE = 96;
const RING_STROKE = 3;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_R;

function GeneratingOverlay({
  accent,
  onCancel,
}: {
  accent: string;
  onCancel: () => void;
}) {
  // Spinning ring animation
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  // Timed stage progression
  const [completedStages, setCompletedStages] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setCompletedStages(1), 3000);
    const t2 = setTimeout(() => setCompletedStages(2), 8000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 2000 }]}
      pointerEvents="auto"
    >
      <BlurView
        intensity={Platform.OS === "ios" ? 40 : 80}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 32,
        }}
      >
        {/* Icon badge with progress ring */}
        <View
          style={{
            width: RING_SIZE,
            height: RING_SIZE,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
          }}
        >
          {/* Spinning ring */}
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ rotate }] },
            ]}
          >
            <Svg width={RING_SIZE} height={RING_SIZE}>
              {/* Track */}
              <SvgCircle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                stroke="rgba(29,155,240,0.15)"
                strokeWidth={RING_STROKE}
                fill="none"
              />
              {/* Arc */}
              <SvgCircle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                stroke={accent}
                strokeWidth={RING_STROKE}
                fill="none"
                strokeDasharray={`${RING_CIRC * 0.3} ${RING_CIRC * 0.7}`}
                strokeLinecap="round"
              />
            </Svg>
          </Animated.View>

          {/* Center icon chip */}
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              backgroundColor: "rgba(29,155,240,0.18)",
              borderWidth: 1,
              borderColor: "rgba(29,155,240,0.35)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="sparkles" size={30} color={accent} />
          </View>
        </View>

        {/* Headline */}
        <Text
          style={{
            color: "#fff",
            fontSize: 22,
            fontWeight: "900",
            textAlign: "center",
            letterSpacing: -0.3,
            marginBottom: 10,
          }}
        >
          Dialing in your setup...
        </Text>

        {/* Status lines */}
        <Text
          style={{
            color: "rgba(255,255,255,0.65)",
            fontSize: 14,
            textAlign: "center",
            lineHeight: 21,
          }}
        >
          Analyzing your terrain, rider profile, and bike data.
        </Text>
        <Text
          style={{
            color: "rgba(255,255,255,0.4)",
            fontSize: 13,
            textAlign: "center",
            marginTop: 4,
          }}
        >
          This usually takes 10–20 seconds.
        </Text>

        {/* Progress checklist */}
        <View style={{ marginTop: 28, alignSelf: "stretch", paddingHorizontal: 16 }}>
          {GEN_STAGES.map((label, i) => {
            const done = i < completedStages;
            const active = i === completedStages;
            return (
              <View
                key={label}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 6,
                }}
              >
                {done ? (
                  <Ionicons name="checkmark-circle" size={18} color="#34C759" />
                ) : active ? (
                  <ActivityIndicator size={16} color={accent} />
                ) : (
                  <Ionicons name="ellipse-outline" size={18} color="rgba(255,255,255,0.2)" />
                )}
                <Text
                  style={{
                    fontSize: 14,
                    color: done
                      ? "rgba(255,255,255,0.7)"
                      : active
                        ? "rgba(255,255,255,0.85)"
                        : "rgba(255,255,255,0.3)",
                    fontWeight: active ? "600" : "400",
                  }}
                >
                  {label}
                </Text>
              </View>
            );
          })}
        </View>

        <Pressable
          onPress={onCancel}
          style={({ pressed }) => ({
            marginTop: 28,
            paddingVertical: 10,
            paddingHorizontal: 24,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            style={{
              color: "rgba(255,255,255,0.5)",
              fontSize: 14,
              fontWeight: "600",
            }}
          >
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* --------------------------------- Helpers -------------------------------- */
function cap(s: string) {
  return s.replace(/\b\w/g, (m) => m.toUpperCase());
}

/* ---------------------------------- Styles --------------------------------- */
const makeStyles = (C: {
  BG: string;
  CARD: string;
  TEXT: string;
  MUTED: string;
  BORDER: string;
  ACCENT: string;
  SUCCESS: string;
  ERROR: string;
  OVERLAY?: string;
  INPUT_BG?: string;
}) => {
  return StyleSheet.create({
    topSafeSpacer: { backgroundColor: C.BG },

    headerSolid: {
      backgroundColor: C.CARD,
      paddingTop: 18,
      paddingBottom: 14,
      paddingHorizontal: 16,
      borderBottomLeftRadius: 18,
      borderBottomRightRadius: 18,
      borderBottomWidth: 1,
      borderBottomColor: C.BORDER,
    },

    heroTitle: {
      color: C.TEXT,
      fontSize: 22,
      lineHeight: 26,
      fontWeight: "900",
      letterSpacing: -0.2,
    },
    heroSubtitle: {
      color: C.MUTED,
      fontSize: 14,
      lineHeight: 18,
      marginTop: 4,
    },

    headerActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 10,
    },

    manageLink: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.1)",
      backgroundColor: "rgba(255,255,255,0.04)",
      minHeight: 36,
    },
    manageLinkText: { color: C.TEXT, fontWeight: "800", fontSize: 12 },

    selectorCard: {
      marginTop: 12,
      backgroundColor: "rgba(29,155,240,0.06)",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "rgba(29,155,240,0.12)",
      padding: 10,
    },
    selectorHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    selectorLabel: { color: C.TEXT, fontWeight: "800", fontSize: 13 },
    selectorEmpty: { color: C.MUTED },
    seeAllLink: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: "rgba(255,255,255,0.04)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.1)",
      minHeight: 32,
    },
    seeAllText: { color: C.TEXT, fontWeight: "800", fontSize: 12 },

    onbBikeCard: {
      borderRadius: 12,
      borderWidth: 1,
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: "rgba(255,255,255,0.10)",
    },
    onbBikeCardTitle: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 13,
      lineHeight: 18,
    },
    onbBikeCardSub: {
      color: C.MUTED,
      fontSize: 12,
      marginTop: 6,
    },

    bikeChip: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.18)",
      backgroundColor: (C.INPUT_BG ?? "#0C1222") + "8C", // ~55% alpha
      marginRight: 8,
      minHeight: 44,
      justifyContent: "center",
    },
    bikeChipActive: {
      borderColor: "#fff",
      backgroundColor: C.INPUT_BG ?? "#0C1222",
    },
    bikeChipText: {
      color: "rgba(255,255,255,0.9)",
      fontWeight: "700",
      fontSize: 12,
    },
    bikeChipTextActive: { color: "#fff" },
    bikeChipGhost: {
      backgroundColor: "transparent",
      borderColor: "rgba(255,255,255,0.25)",
    },
    bikeChipGhostText: {
      color: "rgba(255,255,255,0.9)",
      fontWeight: "700",
    },

    card: {
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 14,
      padding: 14,
      marginHorizontal: 16,
      marginTop: 12,
    },
    requiredCard: { borderColor: "rgba(255,165,0,0.45)" },
    requiredHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    reqPill: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: "rgba(255,165,0,0.18)",
      borderWidth: 1,
      borderColor: "rgba(255,165,0,0.35)",
    },
    reqPillText: { color: "#FFC470", fontWeight: "900", fontSize: 11 },

    h1: { fontSize: 15, fontWeight: "900", color: C.TEXT, marginBottom: 6 },
    label: { color: C.MUTED, fontWeight: "700", marginBottom: 6, marginTop: 10 },
    caption: { color: C.MUTED, fontSize: 12, marginBottom: 6 },
    muted: { color: C.MUTED, fontSize: 12 },
    metricHint: { color: C.MUTED, marginTop: 6, fontSize: 12 },

    input: {
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INPUT_BG ?? "#0C1222",
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 10 : 8,
      fontSize: 16,
      color: C.TEXT,
      marginBottom: 8,
      minHeight: 44,
    },

    inputSm: {
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INPUT_BG ?? "#0C1222",
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 10 : 8,
      fontSize: 16,
      color: C.TEXT,
      width: 140,
      minHeight: 44,
    },
    unitPill: {
      marginLeft: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INPUT_BG ?? "#0C1222",
    },
    unitPillText: { color: C.MUTED, fontWeight: "800" },

    row: { flexDirection: "row", gap: 12 },
    row2: { flexDirection: "row", alignItems: "flex-end", marginTop: 6 },
    rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
    rowBetween: { flexDirection: "row", justifyContent: "space-between" },

    pill: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INPUT_BG ?? "#0C1222",
      minHeight: 44,
      justifyContent: "center",
    },
    pillActive: {
      backgroundColor: "rgba(29,155,240,0.1)",
      borderColor: "rgba(29,155,240,0.3)",
    },
    pillText: { color: C.TEXT, fontWeight: "600" },
    pillTextActive: {
      color: "#60A5FA",
      fontWeight: "800",
    },

    labelWithToggles: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    toggles: { flexDirection: "row", gap: 6 },
    toggle: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INPUT_BG ?? "#0C1222",
      minHeight: 36,
      justifyContent: "center",
    },
    toggleOn: {
      backgroundColor: "rgba(29,155,240,0.12)",
      borderColor: "rgba(29,155,240,0.3)",
    },
    toggleText: { color: C.MUTED, fontWeight: "800", fontSize: 12 },
    toggleTextOn: {
      color: "#60A5FA",
      fontWeight: "800",
      fontSize: 12,
    },

    check: {
      width: 52,
      height: 30,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INPUT_BG ?? "#0C1222",
    },
    checkOn: {
      backgroundColor: "rgba(34,197,94,0.22)",
      borderColor: "rgba(34,197,94,0.55)",
    },

    btnSmall: {
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 16,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
    },
    btnSmallText: { color: C.TEXT, fontWeight: "800" },

    customChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INPUT_BG ?? "#0C1222",
    },
    customChipText: { color: C.TEXT, fontWeight: "700" },
    customChipClose: {
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.12)",
    },
    customChipCloseText: { color: C.TEXT, fontWeight: "900", lineHeight: 20 },

    btn: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 48,
    },
    btnText: { color: "#fff", fontWeight: "900" },

    stickyFooterWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 1000,
      backgroundColor: C.BG,
      borderTopWidth: 1,
      borderTopColor: C.BORDER,
      ...Platform.select({ android: { elevation: 40 } }),
    },
    stickyInner: {
      paddingTop: 8,
      paddingHorizontal: 16,
    },
    stickyLine: { color: C.MUTED, marginBottom: 8, textAlign: "left" },
    stickyBtn: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 52,
    },
    stickyBtnDisabled: { opacity: 0.4 },
    stickyBtnText: { color: "#fff", fontWeight: "900" },

    sheetWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "flex-end",
      alignItems: "stretch",
    },
    sheetOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: C.OVERLAY ?? "rgba(0,0,0,0.45)",
    },
    sheet: {
      backgroundColor: C.CARD,
      padding: 16,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderWidth: 1,
      borderColor: C.BORDER,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sheetTitle: { fontSize: 16, fontWeight: "900", color: C.TEXT },
    sheetClose: { padding: 6, borderRadius: 8 },
    optionRow: {
      paddingVertical: 14,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderColor: C.BORDER,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: C.INPUT_BG ?? "#0C1222",
      borderRadius: 10,
      marginBottom: 8,
      minHeight: 44,
    },
    optionText: { color: C.TEXT, fontWeight: "800" },
  });
};
