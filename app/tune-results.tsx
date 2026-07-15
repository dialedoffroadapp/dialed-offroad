// app/tune-results.tsx
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chip } from "../components/Chip";
import { OnboardingProgress } from "../components/OnboardingProgress";
import { SettingRow } from "../components/SettingRow";
import { useToast } from "../components/Toast";
import { TuneSegmentedControl } from "../components/TuneSegmentedControl";
import { ZeroTuneResult } from "../lib/ai";
import { versionMatchesTune } from "../lib/autoBaseline";
import { createBaselineVersion } from "../lib/setupVersions";
import {
  clearPendingTune,
  readPendingTune,
  useOnboarding,
  writePendingTune,
  type PendingTunePayload,
} from "../lib/onboarding";
import { isProfane } from "../lib/profanity";
import { deriveIsPro } from "../lib/proUtils";
import { hasPurchasedThisSession } from "../lib/purchases";
import {
  declineNotificationPrompt,
  requestNotificationPermission,
  scheduleRideReminder,
  shouldOfferNotificationPrompt,
} from "../lib/rideReminder";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { getOrCreateFunnelId, logEvent } from "../lib/usage";
import { asUuidOrNull } from "../lib/uuid";

/* ---------------- Free / Pro limits ---------------- */
const FREE_BASELINE_LIMIT = 10;

// ✅ Auth entry route (create account)
const AUTH_ROUTE = "/signup" as const;

type Mode = "balanced" | "comfort" | "precision";

type ProfileMeta = {
  pro_until: string | null;
  is_pro: boolean | null;
};

type KeyAreaMeta = {
  id: string;
  label: string;
  description: string;
};

type FeedbackMeta = {
  bikeTitle?: string;
  surface?: string;
  mode?: string;
  keyAreas?: KeyAreaMeta[];
  riderGoals?: string[];
  riderIssues?: string;
  terrainRaw?: string;
};

type ChangedRow = {
  id: string;
  label: string;
  from: string;
  to: string;
  deltaLabel: string;
  direction: "up" | "down";
};

export default function TuneResultScreen() {
  const { r, meta, bikeId: bikeIdParam } = useLocalSearchParams<{
    r?: string;
    meta?: string;
    bikeId?: string;
  }>();

  const toast = useToast();
  const router = useRouter();
  const { state, setStep, onboardingActive, completeOnboarding } = useOnboarding();
  const insets = useSafeAreaInsets();
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);

  // ---------------- Restore pending tune (for post-auth return) ----------------
  const [restored, setRestored] = useState<PendingTunePayload | null>(null);
  const [restoreTried, setRestoreTried] = useState(false);
  const [tuneExpired, setTuneExpired] = useState(false);
  const loggedLockedViewRef = React.useRef(false);

  useEffect(() => {
    (async () => {
      // If route has r/meta, we don't need restore.
      if (
        typeof r === "string" &&
        r.length > 0 &&
        typeof meta === "string" &&
        meta.length > 0
      ) {
        setRestoreTried(true);
        return;
      }

      try {
        const { tune: parsed, isExpired } = await readPendingTune();
        if (isExpired) {
          setTuneExpired(true);
          setRestoreTried(true);
          return;
        }
        if (!parsed) {
          setRestoreTried(true);
          return;
        }
        setRestored(parsed);
      } catch (e) {
        console.warn("TuneResults: restore pending tune failed", e);
      } finally {
        setRestoreTried(true);
      }
    })();
  }, [r, meta]);

  const effectiveR =
    (typeof r === "string" && r.length > 0 ? r : restored?.r) ?? undefined;
  const effectiveMeta =
    (typeof meta === "string" && meta.length > 0 ? meta : restored?.meta) ??
    undefined;
  const effectiveBikeIdParam =
    (typeof bikeIdParam === "string" && bikeIdParam.length > 0
      ? bikeIdParam
      : restored?.bikeId) ?? undefined;

  const base: ZeroTuneResult | null = useMemo(() => {
    try {
      return effectiveR
        ? (JSON.parse(decodeURIComponent(effectiveR)) as ZeroTuneResult)
        : null;
    } catch {
      return null;
    }
  }, [effectiveR]);

  const metaObj: any = useMemo(() => {
    try {
      return effectiveMeta ? JSON.parse(decodeURIComponent(effectiveMeta)) : null;
    } catch {
      return null;
    }
  }, [effectiveMeta]);

  // If we're coming from Tune Two we expect a "previous" tune tucked into meta.
  const previousTune: ZeroTuneResult | null = useMemo(() => {
    const cand =
      metaObj?.previous ?? metaObj?.previousTune ?? metaObj?.prev ?? null;
    if (
      cand &&
      typeof cand === "object" &&
      cand.fork &&
      cand.shock &&
      typeof cand.fork.comp_clicks === "number"
    ) {
      return cand as ZeroTuneResult;
    }
    return null;
  }, [metaObj]);

  const isTuneTwo = !!previousTune;

  // Try to pull a concrete bike id from param/meta shapes. Guest bikes carry
  // local non-uuid ids ("1783553470201_…") — sanitize to null so the sessions
  // insert and lineage shadow writes can't hit a uuid column with garbage.
  const bikeId: string | null = useMemo(() => {
    if (
      typeof effectiveBikeIdParam === "string" &&
      effectiveBikeIdParam.length > 0
    ) {
      return asUuidOrNull(effectiveBikeIdParam);
    }
    return asUuidOrNull(
      metaObj?.bike?.selectedBikeId ??
        metaObj?.bike?.id ??
        metaObj?.bike_id ??
        metaObj?.bike_hint?.id ??
        metaObj?.bike_hint?.selectedBikeId ??
        null
    );
  }, [effectiveBikeIdParam, metaObj]);

  // Monetization: Pro flag (Supabase-only)
  const [isPro, setIsPro] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [proResolved, setProResolved] = useState(false);

  // ✅ Guest/onboarding flags — derive from LIVE state, not stale meta snapshot.
  // metaObj.guest was set at tune-generation time (before signup); a signed-in
  // user is never a guest regardless of what the pending tune's meta says.
  // Gate on proResolved so the first render (before auth check) doesn't flash
  // guest/locked UI for a frame then flip — this prevents the "free credit" flash.
  const isGuest = proResolved ? (!!metaObj?.guest && !isSignedIn) : false;
  const isOnboarding = !!metaObj?.onboarding && onboardingActive;
  const isResultsLockedStep = state.onboardingStep === "results_locked";
  const isOnboardingUnlockStep =
    state.onboardingStep === "results_locked" ||
    state.onboardingStep === "trial";

  // Load Pro status from Supabase profiles — re-checks on every focus
  // so returning from the paywall reflects a new purchase immediately.
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        try {
          const { data: auth } = await supabase.auth.getUser();
          const user = auth?.user;
          if (!user?.id) {
            if (mounted) { setIsSignedIn(false); setIsPro(false); }
            return;
          }

          if (mounted) setIsSignedIn(true);

          const { data: prof, error: profErr } = await supabase
            .from("profiles")
            .select("pro_until, is_pro")
            .eq("user_id", user.id)
            .maybeSingle<ProfileMeta>();

          if (!mounted) return;
          if (profErr || !prof) {
            if (profErr)
              console.warn("TuneResults: profiles select failed", profErr);
            setIsPro(false);
            return;
          }

          setIsPro(deriveIsPro(prof));
        } catch (e) {
          console.warn("TuneResults: init failed", e);
          if (mounted) { setIsSignedIn(false); setIsPro(false); }
        } finally {
          if (mounted) setProResolved(true);
        }
      })();
      return () => { mounted = false; };
    }, [])
  );

  // The session purchase flag is authoritative: a purchase moments ago beats
  // any not-yet-propagated profile read at the unlock step.
  const hasActiveEntitlement = isPro || hasPurchasedThisSession();
  const shouldBlur = isOnboardingUnlockStep && !hasActiveEntitlement;

  // Auto-complete onboarding for users who are already Pro at results_locked.
  // Without this, the "Reveal Your Setup" CTA never renders (shouldBlur is false),
  // so goToAuth/completeOnboarding are never called and the step is stuck forever.
  const didAutoCompleteRef = useRef(false);
  useEffect(() => {
    if (
      !didAutoCompleteRef.current &&
      proResolved &&
      (isPro || hasPurchasedThisSession()) &&
      onboardingActive &&
      isOnboardingUnlockStep &&
      !state.onboardingComplete
    ) {
      didAutoCompleteRef.current = true;
      completeOnboarding();
    }
  }, [proResolved, isPro, onboardingActive, isOnboardingUnlockStep, state.onboardingComplete, completeOnboarding]);

  const onboardingAgeMs = useMemo(() => {
    const parsed = Date.parse(state.lastUpdatedAt);
    return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : 0;
  }, [state.lastUpdatedAt]);
  const ageMinutesSinceLastStep = Math.round(onboardingAgeMs / 60000);

  // variant without showing deltas
  const [mode, setMode] = useState<Mode>("balanced");

  const result = useMemo(() => {
    if (!base) return null;
    const f = { ...base.fork };
    const s = { ...base.shock };

    if (mode === "comfort") {
      f.comp_clicks = Math.min(30, (f.comp_clicks ?? 0) + 2);
      s.lsc_clicks = Math.min(30, (s.lsc_clicks ?? 0) + 2);
      s.reb_clicks = Math.min(30, (s.reb_clicks ?? 0) + 2);
    } else if (mode === "precision") {
      f.comp_clicks = Math.max(0, (f.comp_clicks ?? 0) - 3);
      f.reb_clicks = Math.max(0, (f.reb_clicks ?? 0) - 2);
      s.lsc_clicks = Math.max(0, (s.lsc_clicks ?? 0) - 2);
      s.hsc_turns = Math.max(0, (s.hsc_turns ?? 0) + 0.25);
      s.sag_mm = clamp((s.sag_mm ?? 105) - 2, 95, 112);
    }

    return { ...base, fork: f, shock: s } as ZeroTuneResult;
  }, [base, mode]);

  const [savingBaseline, setSavingBaseline] = useState(false);
  // Lineage shadow table: id of the setup_versions row created on save, so the
  // refine flow can critique it instead of lazily re-creating a baseline.
  const baselineVersionIdRef = useRef<string | null>(null);

  // Preset save (with rename modal)
  const [showNameModal, setShowNameModal] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);

  const [whyExpanded, setWhyExpanded] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Inline notification rationale — the OS permission dialog is never shown
  // cold. Offered once the UNBLURRED results render for an entitled user
  // (the value moment), never during the funnel and never at app launch.
  const [notifPromptVisible, setNotifPromptVisible] = useState(false);
  const notifPromptCheckedRef = useRef(false);
  useEffect(() => {
    if (
      notifPromptCheckedRef.current ||
      !proResolved ||
      shouldBlur ||
      !hasActiveEntitlement ||
      !base
    ) {
      return;
    }
    notifPromptCheckedRef.current = true;
    let mounted = true;
    (async () => {
      const offer = await shouldOfferNotificationPrompt();
      if (mounted && offer) setNotifPromptVisible(true);
    })();
    return () => {
      mounted = false;
    };
  }, [proResolved, shouldBlur, hasActiveEntitlement, base]);

  const onEnableNotifs = async () => {
    setNotifPromptVisible(false);
    const granted = await requestNotificationPermission();
    if (!granted) return;
    toast.show("Ride reminder on — we'll nudge you after your next ride.", {
      kind: "success",
    });
    // A baseline version may already exist (auto-created at onboarding
    // completion, or manually saved) — schedule against it now. Otherwise
    // the next Save Setup schedules it.
    try {
      if (!bikeId) return;
      const { data: latest } = await supabase
        .from("setup_versions")
        .select("id, version_number")
        .eq("bike_id", bikeId)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest?.id) {
        void scheduleRideReminder({
          versionId: latest.id,
          versionNumber: latest.version_number ?? 1,
          bikeName: bikeTitle,
        });
      }
    } catch {
      // non-critical — next save schedules it
    }
  };

  const onDeclineNotifs = () => {
    setNotifPromptVisible(false);
    void declineNotificationPrompt();
  };

  useEffect(() => {
    if (!base && restoreTried && !restored && !tuneExpired && isResultsLockedStep) {
      const t = setTimeout(async () => {
        // Reset stale results_locked step so the user isn't stranded
        await setStep("tune");
        const { data: auth } = await supabase.auth.getUser();
        if (auth?.user?.id) {
          void supabase.from("profiles").upsert(
            { user_id: auth.user.id, onboarding_step: "tune" },
            { onConflict: "user_id" }
          );
        }
        router.replace("/(tabs)/tune");
      }, 10);
      return () => clearTimeout(t);
    }
  }, [base, isResultsLockedStep, router, restoreTried, restored, setStep, tuneExpired]);

  useEffect(() => {
    if (!restoreTried || !base || !isOnboardingUnlockStep || loggedLockedViewRef.current) {
      return;
    }

    loggedLockedViewRef.current = true;
    void (async () => {
      const funnelId = await getOrCreateFunnelId();
      await logEvent(
        "onboarding_locked_results_viewed",
        {
          funnel_id: funnelId,
          onboarding_step: state.onboardingStep,
          signed_in: isSignedIn,
          account_created: state.accountCreated,
          trial_started: state.trialStarted,
          onboarding_complete: state.onboardingComplete,
          pending_tune_exists: true,
          bike_id: bikeId,
          resume: ageMinutesSinceLastStep >= 5,
          age_minutes_since_last_step: ageMinutesSinceLastStep,
          source_route: "/tune-results",
        },
        { allowAnonymous: true, queueIfAnonymous: true }
      );
    })();
  }, [
    ageMinutesSinceLastStep,
    base,
    bikeId,
    isOnboardingUnlockStep,
    isSignedIn,
    restoreTried,
    state.accountCreated,
    state.onboardingComplete,
    state.onboardingStep,
    state.trialStarted,
  ]);

  // ---------- meta-derived values (NO early returns above this point) ----------
  const terrainVal = Array.isArray(metaObj?.context?.terrain)
    ? metaObj?.context?.terrain[0]
    : metaObj?.context?.terrain;

  const trackName = metaObj?.context?.track ?? metaObj?.track_name ?? null;

  const goalsForMeta: string[] = Array.isArray(metaObj?.context?.goals)
    ? metaObj.context.goals
    : [];

  const issuesForMeta: string | undefined =
    typeof metaObj?.context?.issues === "string"
      ? metaObj.context.issues
      : undefined;

  // Prefer bike_hint (from preset) → meta.bike → fallback
  const bikeTitle =
    metaObj?.bike_hint &&
    (metaObj.bike_hint.make || metaObj.bike_hint.model || metaObj.bike_hint.year)
      ? [metaObj.bike_hint.year, metaObj.bike_hint.make, metaObj.bike_hint.model]
          .filter(Boolean)
          .join(" ")
      : metaObj?.bike &&
        (metaObj.bike.make || metaObj.bike.model || metaObj.bike.year)
      ? [metaObj.bike.year, metaObj.bike.make, metaObj.bike.model]
          .filter(Boolean)
          .join(" ")
      : metaObj?.preset?.bike_hint &&
        (metaObj.preset.bike_hint.make ||
          metaObj.preset.bike_hint.model ||
          metaObj.preset.bike_hint.year)
      ? [
          metaObj.preset.bike_hint.year,
          metaObj.preset.bike_hint.make,
          metaObj.preset.bike_hint.model,
        ]
          .filter(Boolean)
          .join(" ")
      : "Custom Bike";

  // ----- Tune Two meta: build rider-specific key areas -----
  const keyAreasForFeedback: KeyAreaMeta[] = useMemo(
    () => buildKeyAreasFromContext(metaObj),
    [metaObj]
  );

  const feedbackMeta: FeedbackMeta = useMemo(
    () => ({
      bikeTitle,
      surface: terrainVal ? cap(terrainVal) : undefined,
      mode: cap(mode),
      keyAreas: keyAreasForFeedback,
      riderGoals: goalsForMeta,
      riderIssues: issuesForMeta,
      terrainRaw: terrainVal ? String(terrainVal) : undefined,
    }),
    [bikeTitle, terrainVal, mode, keyAreasForFeedback, goalsForMeta, issuesForMeta]
  );

  // Air pressure logic (safe to compute even if result is null)
  const wantsAir: boolean = !!metaObj?.context?.wants_air_fork;
  const riderWeight: number | undefined =
    typeof metaObj?.context?.rider_weight_lbs === "number"
      ? metaObj.context.rider_weight_lbs
      : undefined;

  const airBar =
    wantsAir && result ? deriveAirBar(result, riderWeight) : undefined;
  const prevAirBar =
    wantsAir && previousTune ? deriveAirBar(previousTune, riderWeight) : undefined;

  // ---------- Build "what changed" rows (Tune Two only) ----------
  // ✅ MUST be above early returns (hook order)
  const changedRows: ChangedRow[] = useMemo(() => {
    if (!isTuneTwo || !previousTune || !result) return [];

    const rows: ChangedRow[] = [];

    const pushIfChangedClicks = (
      id: string,
      label: string,
      prevVal: number,
      nextVal: number
    ) => {
      if (!Number.isFinite(prevVal) || !Number.isFinite(nextVal)) return;
      const delta = nextVal - prevVal;
      if (Math.abs(delta) < 1) return;

      rows.push({
        id,
        label,
        from: `${num(prevVal)} clicks`,
        to: `${num(nextVal)} clicks`,
        deltaLabel: (delta > 0 ? "+" : "") + `${delta.toFixed(0)} clicks`,
        direction: delta > 0 ? "up" : "down",
      });
    };

    const pushIfChangedTurns = (
      id: string,
      label: string,
      prevVal: number,
      nextVal: number
    ) => {
      if (!Number.isFinite(prevVal) || !Number.isFinite(nextVal)) return;
      const delta = nextVal - prevVal;
      if (Math.abs(delta) < 0.05) return;

      rows.push({
        id,
        label,
        from: `${prevVal.toFixed(2)} turns`,
        to: `${nextVal.toFixed(2)} turns`,
        deltaLabel: (delta > 0 ? "+" : "") + `${delta.toFixed(2)} turns`,
        direction: delta > 0 ? "up" : "down",
      });
    };

    const pushIfChangedAir = (
      id: string,
      label: string,
      prevVal?: number,
      nextVal?: number
    ) => {
      if (!Number.isFinite(Number(prevVal)) || !Number.isFinite(Number(nextVal)))
        return;
      const p = Number(prevVal);
      const n = Number(nextVal);
      const delta = n - p;
      if (Math.abs(delta) < 0.03) return;

      rows.push({
        id,
        label,
        from: `${p.toFixed(2)} bar`,
        to: `${n.toFixed(2)} bar`,
        deltaLabel: (delta > 0 ? "+" : "") + `${delta.toFixed(2)} bar`,
        direction: delta > 0 ? "up" : "down",
      });
    };

    pushIfChangedClicks(
      "fork_comp",
      "Fork compression",
      previousTune.fork.comp_clicks,
      result.fork.comp_clicks
    );
    pushIfChangedClicks(
      "fork_reb",
      "Fork rebound",
      previousTune.fork.reb_clicks,
      result.fork.reb_clicks
    );
    pushIfChangedClicks(
      "shock_lsc",
      "Shock low-speed comp",
      previousTune.shock.lsc_clicks,
      result.shock.lsc_clicks
    );
    pushIfChangedClicks(
      "shock_reb",
      "Shock rebound",
      previousTune.shock.reb_clicks,
      result.shock.reb_clicks
    );
    pushIfChangedTurns(
      "shock_hsc",
      "Shock high-speed comp",
      previousTune.shock.hsc_turns,
      result.shock.hsc_turns
    );

    if (wantsAir) pushIfChangedAir("fork_air", "Fork air (AER)", prevAirBar, airBar);

    return rows;
  }, [isTuneTwo, previousTune, result, wantsAir, airBar, prevAirBar]);

  // Teaser steps for guest
  // ✅ MUST be above early returns (hook order)
  const teaserSteps = useMemo(() => {
    const surface = terrainVal ? cap(terrainVal) : "today's terrain";
    const goals = goalsForMeta.length
      ? goalsForMeta.slice(0, 2).map(cap).join(" + ")
      : null;

    return [
      `Set sag to the target range and verify free sag. (Surface: ${surface})`,
      `Ride 5–10 minutes and note: front vs rear balance (too harsh / too soft / deflecting).`,
      `Make changes 2 clicks at a time (or 0.1–0.2 bar), then re-test.`,
      goals ? `Focus your test on: ${goals}.` : null,
    ].filter(Boolean) as string[];
  }, [terrainVal, goalsForMeta]);

  // ✅ EARLY RETURNS MUST BE AFTER ALL HOOKS ABOVE
  if (!restoreTried) {
    return (
      <View style={S.emptyWrap}>
        <ActivityIndicator color={C.TEXT} />
        <Text style={[S.emptyText, { marginTop: 10 }]}>Loading your tune…</Text>
      </View>
    );
  }

  if (!result) {
    return (
      <View style={S.emptyWrap}>
        <Text style={S.emptyText}>
          {tuneExpired
            ? "Your saved tune expired (24 hours). Generate a new one to see your setup."
            : "No result to display."}
        </Text>
        <View style={{ height: 12 }} />
        <Pressable
          onPress={() => router.replace("/(tabs)/tune")}
          style={S.btnGhost}
        >
          <Text style={S.btnGhostText}>Back to Tune</Text>
        </Pressable>
      </View>
    );
  }

  // Chips
  const headerChips = [
    metaObj?.preset?.name ? `Preset: ${metaObj.preset.name}` : null,
    terrainVal ? `Surface: ${cap(terrainVal)}` : null,
    trackName ? `Track: ${trackName}` : null,
    typeof result.shock.sag_mm === "number"
      ? `Sag: ${num(result.shock.sag_mm)} mm`
      : null,
    typeof airBar === "number" ? `AER: ${airBar.toFixed(2)} bar` : null,
  ].filter(Boolean) as string[];

  // ✅ Save pending tune BEFORE auth so they return to this exact screen.
  // Returns true on success, false on failure.
  const persistPendingTune = async (): Promise<boolean> => {
    try {
      if (!effectiveR || !effectiveMeta) return true; // nothing to persist
      const payload: PendingTunePayload = {
        r: effectiveR,
        meta: effectiveMeta,
        bikeId: bikeId ?? null,
        savedAt: Date.now(),
      };
      await writePendingTune(payload);
      return true;
    } catch (e) {
      console.warn("TuneResults: persist pending tune failed", e);
      return false;
    }
  };

  // ✅ Auth funnel for onboarding (signup -> paywall)
  const goToAuth = async () => {
    const persisted = await persistPendingTune();
    if (!persisted) {
      toast.show("Could not save your tune. Please try again.", { kind: "error" });
      return;
    }

    if (isOnboardingUnlockStep) {
      const { tune: pending } = await readPendingTune();
      if (!pending) {
        router.replace("/(tabs)/tune");
        return;
      }

      const funnelId = await getOrCreateFunnelId();
      await logEvent(
        "onboarding_unlock_clicked",
        {
          funnel_id: funnelId,
          onboarding_step: state.onboardingStep,
          signed_in: isSignedIn,
          account_created: state.accountCreated,
          trial_started: state.trialStarted,
          onboarding_complete: state.onboardingComplete,
          pending_tune_exists: true,
          bike_id: bikeId,
          resume: ageMinutesSinceLastStep >= 5,
          age_minutes_since_last_step: ageMinutesSinceLastStep,
          source_route: "/tune-results",
        },
        { allowAnonymous: true, queueIfAnonymous: true }
      );

      if (state.onboardingStep === "trial") {
        router.replace("/premium");
        return;
      }

      // Local session check — a ROUTING signal only. getSession() reads from
      // storage and cannot fail from network, unlike getUser(), whose round
      // trip misrouted real account holders to /signup when offline or during
      // a slow token refresh. The session may be expired; supabase-js refreshes
      // it on the next API call, so it is not treated as a valid token here.
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionUserId = sessionData?.session?.user?.id ?? null;

      if (sessionUserId) {
        await setStep("trial");
        // Best-effort profile sync; fires the client's refresh if needed.
        void supabase.from("profiles").upsert(
          { user_id: sessionUserId, onboarding_step: "trial" },
          { onConflict: "user_id" }
        );
        router.replace("/premium");
        return;
      }

      if (state.accountCreated) {
        // Has an account but no local session — sign in first. Never /signup
        // (their email is already registered → dead end) and never straight
        // to /premium (a purchase there could not attach to their profile).
        router.replace("/login");
        return;
      }

      await setStep("signup");
      // Guest at this point — no Supabase write needed
      router.replace(AUTH_ROUTE);
      return;
    }

    router.push({
      pathname: AUTH_ROUTE,
      params: {
        // ✅ after signup, go to paywall
        returnTo: "/premium",
      },
    } as any);
  };

  // 🔧 include bikeId inside the context for Tune Two so refine flow can save to right bike
  const goToFeedback = async () => {
    const { data: authCheck } = await supabase.auth.getUser();
    if (!authCheck?.user?.id) return; // Guest refine is locked

    const ctxForFeedback: any = {
      make: metaObj?.bike?.make ?? metaObj?.bike_hint?.make ?? undefined,
      model: metaObj?.bike?.model ?? metaObj?.bike_hint?.model ?? undefined,
      year: metaObj?.bike?.year ?? metaObj?.bike_hint?.year ?? undefined,
      terrain: terrainVal ?? undefined,
      track: trackName ?? undefined,
      temp_f: metaObj?.context?.temp_f ?? undefined,
      elev_ft: metaObj?.context?.elev_ft ?? undefined,
      rider: {
        weight_lbs:
          typeof metaObj?.context?.rider_weight_lbs === "number"
            ? metaObj.context.rider_weight_lbs
            : undefined,
        skill: metaObj?.context?.rider_skill ?? "intermediate",
        style: metaObj?.context?.rider_style ?? "short_motos",
        goals: goalsForMeta,
      },
      wants_air_fork: !!metaObj?.context?.wants_air_fork,
      selectedBikeId: bikeId ?? undefined,
      bike_id: bikeId ?? undefined,
    };

    router.push({
      pathname: "/tune-feedback",
      params: {
        meta: encodeURIComponent(JSON.stringify(feedbackMeta)),
        previous: encodeURIComponent(JSON.stringify(result)),
        context: encodeURIComponent(JSON.stringify(ctxForFeedback)),
        bikeId: bikeId ?? "",
        versionId: baselineVersionIdRef.current ?? "",
      },
    });
  };

  // ----- Save baseline / refined (requires bike + Pro/limit logic) -----
  const canSave = !!bikeId;
  const guestLocksActions = isGuest;

  const onSaveBaseline = async () => {
    if (guestLocksActions) {
      await goToAuth();
      return;
    }

    if (!canSave) {
      toast.show(
        "Pick a bike first (Garage → select bike), then save your setup.",
        { kind: "error" }
      );
      return;
    }

    try {
      setSavingBaseline(true);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user?.id) {
        await goToAuth();
        return;
      }

      // Free plan: enforce saved-baseline cap (using sessions table)
      if (!isPro) {
        const { count, error: countErr } = await supabase
          .from("sessions")
          .select("*", { count: "exact", head: true })
          .eq("user_id", auth.user.id);

        if (countErr) throw countErr;

        if ((count ?? 0) >= FREE_BASELINE_LIMIT) {
          toast.show(
            `Free plan: up to ${FREE_BASELINE_LIMIT} saved baselines. Unlock Pro for unlimited history.`,
            { kind: "info" }
          );
          router.push("/premium");
          return;
        }
      }

      const insert = {
        user_id: auth.user.id,
        bike_id: bikeId,
        rode_on: new Date().toISOString().slice(0, 10),
        surface: Array.isArray(metaObj?.context?.terrain)
          ? metaObj.context.terrain[0] ?? null
          : metaObj?.context?.terrain ?? null,
        track: trackName ?? null,
        temp_f: metaObj?.context?.temp_f ?? null,
        elev_ft: metaObj?.context?.elev_ft ?? null,
        fork_comp: num(result.fork.comp_clicks),
        fork_reb: num(result.fork.reb_clicks),
        shock_comp: num(result.shock.lsc_clicks),
        shock_reb: num(result.shock.reb_clicks),
        sag_mm: num(result.shock.sag_mm),
        notes: [
          isTuneTwo
            ? "Refined setup from Dialed Offroad AI"
            : "Baseline from Dialed Offroad AI",
          metaObj?.preset?.name ? `Preset: ${metaObj.preset.name}` : "Zero-based tune",
          metaObj?.bike_hint
            ? `Bike: ${[
                metaObj.bike_hint.year,
                metaObj.bike_hint.make,
                metaObj.bike_hint.model,
              ]
                .filter(Boolean)
                .join(" ")}`
            : metaObj?.bike
            ? `Bike: ${[
                metaObj.bike.year,
                metaObj.bike.make,
                metaObj.bike.model,
              ]
                .filter(Boolean)
                .join(" ")}`
            : null,
          typeof airBar === "number" ? `AER pressure: ${airBar.toFixed(2)} bar` : null,
        ]
          .filter(Boolean)
          .join(" — "),
      };

      const { error } = await supabase.from("sessions").insert(insert);
      if (error) throw error;

      // Shadow write to the lineage table. Must never break the save flow.
      // Idempotent against the auto-created onboarding v1 (lib/autoBaseline)
      // and double-taps: if the bike's latest version already carries these
      // exact values, reuse it instead of minting a duplicate. A tune with
      // different values (new generation, mode tweak) still saves normally.
      try {
        const { data: latest } = await supabase
          .from("setup_versions")
          .select(
            "id, version_number, fork_comp_clicks, fork_reb_clicks, fork_air_bar, shock_lsc_clicks, shock_hsc_turns, shock_reb_clicks, sag_mm"
          )
          .eq("bike_id", bikeId)
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latest && versionMatchesTune(latest as any, result)) {
          baselineVersionIdRef.current = (latest as any).id;
        } else {
          const version = await createBaselineVersion({
            bikeId,
            tune: result,
            terrain: Array.isArray(metaObj?.context?.terrain)
              ? metaObj.context.terrain[0] ?? null
              : metaObj?.context?.terrain ?? null,
            context: metaObj?.context ?? null,
            // Engine-context capture (the training-data link): the resolved model
            // + sag inputs + spring-check outcome, recorded with the tune.
            recommendedContext: {
              model_id: metaObj?.spec?.model_id ?? null,
              spec_verified: !!metaObj?.spec?.spec_verified,
              sag_target_mm: metaObj?.spec?.sag_target_mm ?? null,
              sag_bounds: metaObj?.spec?.sag_bounds ?? null,
              rider_weight_lbs: metaObj?.context?.rider_weight_lbs ?? null,
              spring_check: base?.spring_check
                ? {
                    status: base.spring_check.status,
                    direction: base.spring_check.direction,
                  }
                : null,
              engine: "zero_baseline_v1",
            },
          });
          baselineVersionIdRef.current = version.id;
          // A new saved setup supersedes any pending ride reminder — point
          // the (single) reminder at this version. No-op without permission.
          void scheduleRideReminder({
            versionId: version.id,
            versionNumber: version.version_number,
            bikeName: bikeTitle,
          });
        }
      } catch (shadowErr) {
        console.warn("setup_versions shadow write failed", shadowErr);
      }

      // Only clear the pending tune once onboarding is fully complete.
      // During results_locked the pending tune must stay in storage so the
      // unlock flow can restore it after signup/paywall.
      if (state.onboardingComplete) {
        await clearPendingTune();
      }

      toast.show(isTuneTwo ? "Refined setup saved ✅" : "Baseline saved ✅", {
        kind: "success",
      });
      router.push("/(tabs)/sessions");
    } catch (e: any) {
      toast.show(e?.message ?? "Save failed", { kind: "error" });
    } finally {
      setSavingBaseline(false);
    }
  };

  // ----- Preset: open naming modal (kept for future refined tunes) -----
  const startSavePreset = async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user?.id) {
        await goToAuth();
        return;
      }

      if (!isPro) {
        toast.show("Pro feature: save custom presets and load them anytime.", {
          kind: "info",
        });
        router.push("/premium");
        return;
      }

      const suggested =
        (trackName ? `${trackName} – ` : "My Preset – ") +
        new Date().toLocaleDateString();
      setPresetName(suggested);
      setShowNameModal(true);
    } catch {
      await goToAuth();
    }
  };

  const confirmSavePreset = async () => {
    if (presetName.trim() && isProfane(presetName)) {
      toast.show("Please choose a different preset name.", { kind: "error" });
      return;
    }
    try {
      setSavingPreset(true);
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user?.id) throw new Error("Please sign in");

      if (!isPro) {
        setSavingPreset(false);
        toast.show("Pro feature: save custom presets and load them anytime.", {
          kind: "info",
        });
        router.push("/premium");
        return;
      }

      const terrain = Array.isArray(metaObj?.context?.terrain)
        ? metaObj.context.terrain.map((t: any) => String(t).trim())
        : metaObj?.context?.terrain
        ? [String(metaObj.context.terrain).trim()]
        : [];

      const { error } = await supabase.from("user_presets").insert({
        user_id: user.id,
        name: presetName.trim() || `My Preset – ${new Date().toLocaleDateString()}`,
        track_name: trackName ?? null,
        terrain,
        bike_hint: {
          year: metaObj?.bike?.year ?? metaObj?.bike_hint?.year ?? null,
          make: metaObj?.bike?.make ?? metaObj?.bike_hint?.make ?? null,
          model: metaObj?.bike?.model ?? metaObj?.bike_hint?.model ?? null,
        },
        tune: base,
      });

      if (error) throw error;

      setShowNameModal(false);
      toast.show("Saved to My Presets ✅", { kind: "success" });
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to save preset", { kind: "error" });
    } finally {
      setSavingPreset(false);
    }
  };

  const headerTitle = isTuneTwo ? "Refined Setup" : "Your Suggested Setup";
  const headerSubtitle = bikeTitle;

  const onUnlock = async () => {
    await goToAuth();
  };

  const goToTuneWithPrefill = (mode: "terrain" | "race_trail") => {
    const params: Record<string, string> = {};
    const b = metaObj?.bike;
    if (b?.selectedBikeId) params.bikeId = b.selectedBikeId;
    if (b?.make) params.make = b.make;
    if (b?.model) params.model = b.model;
    if (b?.year != null) params.year = String(b.year);
    const ctx = metaObj?.context;
    const pf: Record<string, any> = { mode };
    if (ctx) {
      if (typeof ctx.rider_weight_lbs === "number") pf.rider_weight_lbs = ctx.rider_weight_lbs;
      if (mode === "race_trail") {
        // Carry existing goals + append race/trail goal if not already present
        const existing: string[] = Array.isArray(ctx.goals) ? ctx.goals : [];
        const hasRaceGoal = existing.some(
          (g: string) => g.toLowerCase().includes("race") || g.toLowerCase().includes("trail")
        );
        pf.goals = hasRaceGoal ? existing : [...existing, "race vs trail"];
      }
      // "terrain" mode: no goals carried — user picks their intent fresh on Tune screen
      if (typeof ctx.issues === "string" && ctx.issues.length > 0) pf.issues = ctx.issues;
    }
    params.prefill = encodeURIComponent(JSON.stringify(pf));
    router.push({ pathname: "/(tabs)/tune", params });
  };

  const onboardingResumeTitle =
    state.onboardingStep === "trial" ? "Your tune is ready" : "Your setup is ready";
  const onboardingResumeBody =
    state.onboardingStep === "trial"
      ? "Your tune is ready — start your free trial to unlock it."
      : state.hasSeenIntro
        ? "Your setup is still waiting — start your free trial to reveal it."
        : "Your first tune is ready. Create your account to reveal the exact clickers and notes.";

  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
      {/* Safe area top */}
      <View style={{ height: insets.top, backgroundColor: C.BG }} />

      {/* Compact header */}
      <View style={S.compactHeader}>
        <Pressable onPress={() => router.replace("/(tabs)/tune")} hitSlop={8} style={S.headerIconBtn}>
          <Ionicons name="chevron-back-outline" size={24} color={C.TEXT} />
        </Pressable>
        <Text style={S.compactHeaderTitle}>Setup</Text>
        {/* placeholder to balance chevron */}
        <View style={S.headerIconBtn} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingBottom: 24 + insets.bottom,
        }}
      >
        {/* TuneTwo: What changed — untouched */}
        {isTuneTwo && changedRows.length > 0 && (
          <View style={[S.card, S.lift]}>
            <Text style={S.h1}>What changed from last time</Text>
            {changedRows.map((row) => (
              <View key={row.id} style={S.changeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={S.changeLabel}>{row.label}</Text>
                  <Text style={S.changeSub}>
                    {row.from} → {row.to} ({row.deltaLabel})
                  </Text>
                </View>
                <View
                  style={[
                    S.changeIconWrap,
                    row.direction === "down" && { transform: [{ rotate: "180deg" }] },
                  ]}
                >
                  <Ionicons name="arrow-down" size={16} color="#fff" />
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Hero section (non-TuneTwo) */}
        {!isTuneTwo && (
          <View style={S.heroSection}>
            <View style={[
              S.heroBadge,
              shouldBlur && { backgroundColor: C.ACCENT + "2A" },
            ]}>
              <Ionicons
                name={shouldBlur ? "lock-closed-outline" : "checkmark-circle"}
                size={36}
                color={shouldBlur ? C.ACCENT : (C.SUCCESS ?? "#22C55E")}
              />
            </View>
            <Text style={S.heroTitle}>
              {shouldBlur ? "Your setup is ready" : "Your setup is dialed."}
            </Text>
            <Text style={S.heroSubtitle}>{bikeTitle}</Text>
            {shouldBlur ? (
              <Text style={S.heroLockHint}>{onboardingResumeBody}</Text>
            ) : null}
          </View>
        )}

        {/* OnboardingProgress */}
        <View style={{ paddingHorizontal: 16, marginTop: 2 }}>
          <OnboardingProgress />
        </View>

        {/* Summary chips */}
        {(terrainVal || typeof result.shock.sag_mm === "number" || typeof airBar === "number") ? (
          <View style={S.summaryChipsRow}>
            {terrainVal ? <Chip label={cap(terrainVal)} /> : null}
            {typeof result.shock.sag_mm === "number" ? <Chip label={`Sag ${num(result.shock.sag_mm)} mm`} /> : null}
            {typeof airBar === "number" ? <Chip label={`AER ${airBar.toFixed(2)} bar`} /> : null}
          </View>
        ) : null}

        {/* Segmented mode control */}
        <TuneSegmentedControl value={mode} onChange={setMode} />

        {/* Helper line */}
        <View style={S.modeHelperRow}>
          <Ionicons name="information-circle-outline" size={14} color={C.MUTED} />
          <Text style={S.modeHelperText}>
            {mode === "balanced"
              ? "Factory-balanced for most conditions."
              : mode === "comfort"
              ? "Softer — better for rough, physical terrain."
              : "Stiffer — better for speed and precision."}
          </Text>
        </View>

        {/* Spring-rate legitimacy check — a credibility signal shown to guests
            too (NOT blurred, NOT gated). "ok" is one quiet confidence line; a
            mismatch is a warning card. Unknown / no specs renders nothing. */}
        {base?.spring_check?.status === "ok" ? (
          <View style={S.modeHelperRow}>
            <Ionicons name="checkmark-circle-outline" size={14} color={C.MUTED} />
            <Text style={S.modeHelperText}>
              Stock springs suit your weight — dialed in below.
            </Text>
          </View>
        ) : base?.spring_check &&
          (base.spring_check.status === "marginal" ||
            base.spring_check.status === "out_of_range") ? (
          <View style={[S.lockHintBox, { marginTop: 12 }]}>
            <Ionicons
              name="warning-outline"
              size={16}
              color={(C as any).WARN ?? "#FFC36A"}
            />
            <Text style={S.lockHintText}>
              {(() => {
                const c = base.spring_check!;
                const dir = c.direction ?? "different";
                if (c.component === "both") {
                  const rates = [
                    typeof c.stock_fork_nmm === "number"
                      ? `fork ${c.stock_fork_nmm}`
                      : null,
                    typeof c.stock_shock_nmm === "number"
                      ? `shock ${c.stock_shock_nmm}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(", ");
                  return `Your weight suggests ${dir} fork and shock springs than stock (${rates} N/mm) — a suspension shop can spec the exact rates.`;
                }
                const rate =
                  c.component === "shock" ? c.stock_shock_nmm : c.stock_fork_nmm;
                const rateStr = typeof rate === "number" ? ` (${rate} N/mm)` : "";
                return `Your weight suggests a ${dir} ${c.component} spring than stock${rateStr} — a suspension shop can spec the exact rate.`;
              })()}
            </Text>
          </View>
        ) : null}

        {/* Fork card */}
        <BlurCard enabled={shouldBlur} C={C} S={S} title="Fork">
          <SettingRow
            icon="settings-outline"
            label="Compression"
            hint="Clicks out from zero"
            value={shouldBlur ? "•••" : String(num(result.fork.comp_clicks))}
            unit="clicks"
            onPress={shouldBlur ? undefined : () => router.push({
              pathname: "/setting-detail",
              params: { id: "fork_comp", value: String(num(result.fork.comp_clicks)), unit: "clicks", notes: encodeURIComponent(JSON.stringify(base?.notes ?? [])), bikeTitle },
            } as any)}
          />
          <SettingRow
            icon="refresh-outline"
            label="Rebound"
            hint="Clicks out from zero"
            value={shouldBlur ? "•••" : String(num(result.fork.reb_clicks))}
            unit="clicks"
            onPress={shouldBlur ? undefined : () => router.push({
              pathname: "/setting-detail",
              params: { id: "fork_reb", value: String(num(result.fork.reb_clicks)), unit: "clicks", notes: encodeURIComponent(JSON.stringify(base?.notes ?? [])), bikeTitle },
            } as any)}
          />
          {typeof airBar === "number" ? (
            <SettingRow
              icon="water-outline"
              label="Air (AER)"
              hint="WP AER fork pressure"
              value={shouldBlur ? "•••" : airBar.toFixed(2)}
              unit="bar"
              onPress={shouldBlur ? undefined : () => router.push({
                pathname: "/setting-detail",
                params: { id: "fork_air", value: airBar!.toFixed(2), unit: "bar", notes: encodeURIComponent(JSON.stringify(base?.notes ?? [])), bikeTitle },
              } as any)}
            />
          ) : null}
        </BlurCard>

        {/* Shock card */}
        <BlurCard enabled={shouldBlur} C={C} S={S} title="Shock">
          <SettingRow
            icon="settings-outline"
            label="Low-Speed Comp"
            hint="Clicks out from zero"
            value={shouldBlur ? "•••" : String(num(result.shock.lsc_clicks))}
            unit="clicks"
            onPress={shouldBlur ? undefined : () => router.push({
              pathname: "/setting-detail",
              params: { id: "shock_lsc", value: String(num(result.shock.lsc_clicks)), unit: "clicks", notes: encodeURIComponent(JSON.stringify(base?.notes ?? [])), bikeTitle },
            } as any)}
          />
          <SettingRow
            icon="flash-outline"
            label="High-Speed Comp"
            hint="Turns out from zero"
            value={shouldBlur ? "•••" : num(result.shock.hsc_turns, 0).toFixed(1)}
            unit="turns"
            onPress={shouldBlur ? undefined : () => router.push({
              pathname: "/setting-detail",
              params: { id: "shock_hsc", value: num(result.shock.hsc_turns, 0).toFixed(1), unit: "turns", notes: encodeURIComponent(JSON.stringify(base?.notes ?? [])), bikeTitle },
            } as any)}
          />
          <SettingRow
            icon="refresh-outline"
            label="Rebound"
            hint="Clicks out from zero"
            value={shouldBlur ? "•••" : String(num(result.shock.reb_clicks))}
            unit="clicks"
            onPress={shouldBlur ? undefined : () => router.push({
              pathname: "/setting-detail",
              params: { id: "shock_reb", value: String(num(result.shock.reb_clicks)), unit: "clicks", notes: encodeURIComponent(JSON.stringify(base?.notes ?? [])), bikeTitle },
            } as any)}
          />
          <SettingRow
            icon="resize-outline"
            label="Sag"
            hint="Static sag target"
            value={shouldBlur ? "•••" : String(num(result.shock.sag_mm))}
            unit="mm"
            onPress={shouldBlur ? undefined : () => router.push({
              pathname: "/setting-detail",
              params: { id: "shock_sag", value: String(num(result.shock.sag_mm)), unit: "mm", notes: encodeURIComponent(JSON.stringify(base?.notes ?? [])), bikeTitle },
            } as any)}
          />
        </BlurCard>

        {/* Why this setup? — collapsible (unlocked only) */}
        {!shouldBlur && base?.notes?.length ? (
          <View style={[S.card, { overflow: "hidden" }]}>
            <Pressable onPress={() => setWhyExpanded(!whyExpanded)} style={S.whyRow}>
              <Ionicons name="sparkles-outline" size={16} color={C.ACCENT} style={{ marginRight: 8 }} />
              <Text style={[S.h1, { flex: 1, marginBottom: 0 }]}>Why this setup?</Text>
              <Ionicons
                name={whyExpanded ? "chevron-up-outline" : "chevron-down-outline"}
                size={16}
                color={C.MUTED}
              />
            </Pressable>
            {whyExpanded ? (
              <View style={{ marginTop: 10 }}>
                {base.notes.map((n, i) => (
                  <View key={`why-${i}`} style={S.stepRow}>
                    <View style={S.stepBadge}>
                      <Text style={S.stepBadgeText}>{i + 1}</Text>
                    </View>
                    <Text style={S.stepText}>{n}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Today's Test Plan */}
        {base?.notes?.length ? (
          shouldBlur ? (
            <BlurCard enabled C={C} S={S} title="Today's Test Plan">
              <Text style={S.bodySmall}>Here's a quick starter plan while your full notes are locked:</Text>
              <View style={{ marginTop: 8 }}>
                {teaserSteps.map((n, i) => (
                  <View key={`ts-${i}`} style={S.stepRow}>
                    <View style={S.stepBadge}>
                      <Text style={S.stepBadgeText}>{i + 1}</Text>
                    </View>
                    <Text style={S.stepText}>{n}</Text>
                  </View>
                ))}
              </View>
              <View style={[S.lockHintBox, { marginTop: 10 }]}>
                <Ionicons name="lock-closed" size={16} color={(C as any).WARN ?? "#FFC36A"} />
                <Text style={S.lockHintText}>
                  Unlock to see exact clickers + your personalized notes based on your goals/issues.
                </Text>
              </View>
            </BlurCard>
          ) : (
            <View style={S.card}>
              <Text style={S.h1}>{isTuneTwo ? "Refined test plan" : "Today's Test Plan"}</Text>
              <View style={{ marginTop: 4 }}>
                {base.notes.map((n, i) => (
                  <View key={`tp-${i}`} style={S.stepRow}>
                    <View style={S.stepBadge}>
                      <Text style={S.stepBadgeText}>{i + 1}</Text>
                    </View>
                    <Text style={S.stepText}>{n}</Text>
                  </View>
                ))}
              </View>
            </View>
          )
        ) : null}

        {/* Pro tip */}
        {!shouldBlur ? (
          <View style={S.proTipRow}>
            <Ionicons name="bulb-outline" size={16} color={(C as any).WARN ?? "#FFC36A"} />
            <Text style={S.proTipText}>
              Only adjust one setting at a time — then ride before changing anything else.
            </Text>
          </View>
        ) : null}

        {/* Ride-reminder rationale — inline ask before the OS dialog */}
        {!shouldBlur && notifPromptVisible ? (
          <View style={S.notifPromptRow}>
            <Ionicons name="notifications-outline" size={16} color={C.ACCENT} />
            <Text style={S.notifPromptText}>
              Want a nudge to refine after your next ride?
            </Text>
            <Pressable onPress={onEnableNotifs} style={S.notifEnableBtn}>
              <Text style={S.notifEnableText}>Enable</Text>
            </Pressable>
            <Pressable
              onPress={onDeclineNotifs}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Not now"
            >
              <Ionicons name="close" size={16} color={C.MUTED} />
            </Pressable>
          </View>
        ) : null}

        {/* Bottom action bar */}
        <View style={S.bottomActionBar}>
          {shouldBlur ? (
            <Pressable onPress={onUnlock} style={[S.btnRefinePrimary, { flex: 1 }]}>
              <Ionicons name="lock-open-outline" size={18} color="#fff" />
              <Text style={S.btnRefinePrimaryText}>Reveal Your Setup</Text>
            </Pressable>
          ) : (
            <>
              <Pressable onPress={goToFeedback} style={[S.btnRefinePrimary, { flex: 1 }]}>
                <Ionicons name="swap-horizontal-outline" size={18} color="#fff" />
                <Text style={S.btnRefinePrimaryText}>Refine After Ride</Text>
              </Pressable>
              <Pressable onPress={() => setMoreMenuOpen(true)} style={S.btnMoreSquare}>
                <Ionicons name="ellipsis-horizontal-outline" size={20} color={C.TEXT} />
              </Pressable>
            </>
          )}
        </View>

        <View style={{ height: 8 }} />
      </ScrollView>

      {/* More menu */}
      <Modal
        visible={moreMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMoreMenuOpen(false)}
      >
        <View style={S.moreMenuWrap}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMoreMenuOpen(false)} />
          <View style={[S.moreMenuCard, { paddingBottom: insets.bottom + 8 }]}>
            <Pressable
              onPress={async () => { setMoreMenuOpen(false); await onSaveBaseline(); }}
              style={S.moreMenuItem}
            >
              <Ionicons name="bookmark-outline" size={20} color={C.TEXT} />
              <Text style={S.moreMenuItemText}>
                {isTuneTwo ? "Save Refined Setup" : "Save Setup"}
              </Text>
            </Pressable>
            <View style={S.moreMenuDivider} />
            <Pressable
              onPress={() => { setMoreMenuOpen(false); startSavePreset(); }}
              style={S.moreMenuItem}
            >
              <Ionicons name="layers-outline" size={20} color={C.TEXT} />
              <Text style={S.moreMenuItemText}>Save as Preset</Text>
              {!isPro ? (
                <View style={S.proBadge}>
                  <Text style={S.proBadgeText}>PRO</Text>
                </View>
              ) : null}
            </Pressable>
            <View style={S.moreMenuDivider} />
            <Pressable
              onPress={() => { setMoreMenuOpen(false); goToTuneWithPrefill("terrain"); }}
              style={S.moreMenuItem}
            >
              <Ionicons name="map-outline" size={20} color={C.TEXT} />
              <Text style={S.moreMenuItemText}>Try Another Terrain</Text>
            </Pressable>
            <View style={S.moreMenuDivider} />
            <Pressable
              onPress={() => { setMoreMenuOpen(false); router.replace("/(tabs)/tune"); }}
              style={S.moreMenuItem}
            >
              <Ionicons name="arrow-back-outline" size={20} color={C.TEXT} />
              <Text style={S.moreMenuItemText}>Back to Tune</Text>
            </Pressable>
            <View style={S.moreMenuDivider} />
            <Pressable onPress={() => setMoreMenuOpen(false)} style={S.moreMenuCancel}>
              <Text style={S.moreMenuCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Preset rename modal (unchanged) */}
      <Modal visible={showNameModal} transparent animationType="fade" onRequestClose={() => setShowNameModal(false)}>
        <View style={S.modalWrap}>
          <Pressable
            style={S.backdrop}
            onPress={() => {
              Keyboard.dismiss();
              setShowNameModal(false);
            }}
          />
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>Name your preset</Text>
            <TextInput
              value={presetName}
              onChangeText={setPresetName}
              placeholder="e.g., Owyhee MX | 10/8"
              placeholderTextColor={C.MUTED}
              style={S.input}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                Keyboard.dismiss();
                confirmSavePreset();
              }}
            />
            <View style={S.row}>
              <Pressable style={[S.modalBtnGhost, { flex: 1 }]} onPress={() => setShowNameModal(false)}>
                <Text style={S.modalBtnGhostText}>Cancel</Text>
              </Pressable>
              <View style={{ width: 8 }} />
              <Pressable style={[S.modalBtnPrimary, { flex: 1 }]} onPress={confirmSavePreset} disabled={savingPreset}>
                {savingPreset ? <ActivityIndicator color="#fff" /> : <Text style={S.modalBtnPrimaryText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* -------------------- Guest blur wrapper -------------------- */
function BlurCard({
  enabled,
  title,
  children,
  C,
  S,
}: {
  enabled: boolean;
  title: string;
  children: React.ReactNode;
  C: any;
  S: any;
}) {
  return (
    <View style={[S.card, S.lift, { overflow: "hidden" }]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={S.h1}>{title}</Text>
        {enabled ? (
          <View style={S.lockPill}>
            <Ionicons name="lock-closed" size={12} color="#fff" />
            <Text style={S.lockPillText}>Locked</Text>
          </View>
        ) : null}
      </View>

      <View style={{ marginTop: 2 }}>{children}</View>

      {enabled ? (
        // Light blur — shows structure is real, feels intentional not broken.
        // Per-card overlay removed; single hero card above delivers the message.
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView intensity={30} tint={C.BG === "#FFFFFF" ? "light" : "dark"} style={StyleSheet.absoluteFill} />
        </View>
      ) : null}
    </View>
  );
}


/* utils */
function num(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function cap(s: unknown) {
  return String(s ?? "").replace(/\b\w/g, (m) => m.toUpperCase());
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function deriveAirBar(res: ZeroTuneResult, rider?: number) {
  const aiBaseline = typeof res.fork.air_pressure_bar === "number" ? res.fork.air_pressure_bar : 10.6;

  if (!Number.isFinite(Number(rider))) {
    return clamp(Number(aiBaseline.toFixed(2)), 7, 14);
  }

  const w = Number(rider);
  const est = aiBaseline + 0.2 * ((w - 185) / 10);
  return clamp(Number(est.toFixed(2)), 7, 14);
}

function buildKeyAreasFromContext(metaObj: any): KeyAreaMeta[] {
  const goalsRaw: string[] = Array.isArray(metaObj?.context?.goals)
    ? metaObj.context.goals.map((g: any) => String(g).toLowerCase())
    : [];
  const issuesText = String(metaObj?.context?.issues || "").toLowerCase();

  const areas: KeyAreaMeta[] = [];
  const pushUnique = (area: KeyAreaMeta) => {
    if (!areas.find((a) => a.id === area.id)) areas.push(area);
  };

  const SMALL_CHOP: KeyAreaMeta = {
    id: "small_chop",
    label: "Small chop / chatter",
    description: "How did it feel in small chop and braking bumps?",
  };
  const BIG_HITS: KeyAreaMeta = {
    id: "big_hits",
    label: "Big hits / landings",
    description: "How did it feel on big hits and jump landings?",
  };
  const WHOOPS: KeyAreaMeta = {
    id: "whoops",
    label: "Whoops / high-speed stability",
    description: "How did it feel in whoops and fast rough sections?",
  };

  if (
    goalsRaw.includes("comfort") ||
    goalsRaw.includes("plush") ||
    issuesText.includes("harsh") ||
    issuesText.includes("chop")
  ) {
    pushUnique(SMALL_CHOP);
  }

  if (
    goalsRaw.includes("stability") ||
    goalsRaw.includes("whoops") ||
    issuesText.includes("whoops") ||
    issuesText.includes("headshake")
  ) {
    pushUnique(WHOOPS);
  }

  if (
    goalsRaw.includes("jumps") ||
    goalsRaw.includes("big hits") ||
    issuesText.includes("bottom") ||
    issuesText.includes("landing")
  ) {
    pushUnique(BIG_HITS);
  }

  [SMALL_CHOP, BIG_HITS].forEach(pushUnique);
  return areas.slice(0, 2);
}


const makeStyles = (C: {
  BG: string;
  CARD: string;
  TEXT: string;
  MUTED: string;
  BORDER: string;
  ACCENT: string;
  INK: string;
  SUCCESS?: string;
  WARN?: string;
  ACCENT_2?: string;
  INPUT_BG?: string;
}) =>
  StyleSheet.create({
    // ── Empty / loading states ──────────────────────────────────────
    emptyWrap: {
      flex: 1,
      backgroundColor: C.BG,
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
    },
    emptyText: {
      color: C.TEXT,
      fontWeight: "800",
      fontSize: 16,
      textAlign: "center",
    },
    btnGhost: {
      borderColor: C.BORDER,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    },
    btnGhostText: { color: C.TEXT, fontWeight: "800" },

    // ── Compact header ──────────────────────────────────────────────
    compactHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 4,
      paddingVertical: 6,
      backgroundColor: C.BG,
      borderBottomWidth: 1,
      borderBottomColor: C.BORDER,
    },
    headerIconBtn: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    compactHeaderTitle: {
      flex: 1,
      textAlign: "center",
      color: C.TEXT,
      fontSize: 16,
      fontWeight: "700",
    },

    // ── Hero section ────────────────────────────────────────────────
    heroSection: {
      alignItems: "center",
      paddingTop: 28,
      paddingBottom: 12,
      paddingHorizontal: 16,
    },
    heroBadge: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: (C.SUCCESS ?? "#22C55E") + "2A",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    heroTitle: {
      color: C.TEXT,
      fontSize: 24,
      fontWeight: "900",
      textAlign: "center",
      letterSpacing: -0.4,
    },
    heroSubtitle: {
      color: C.MUTED,
      fontSize: 14,
      marginTop: 4,
      textAlign: "center",
    },
    heroLockHint: {
      color: C.MUTED,
      fontSize: 13,
      marginTop: 10,
      textAlign: "center",
      lineHeight: 18,
      paddingHorizontal: 20,
    },

    // ── Summary chips ───────────────────────────────────────────────
    summaryChipsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      paddingHorizontal: 16,
      marginTop: 10,
      marginBottom: 4,
    },
    modeHelperRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 16,
      marginTop: 8,
      marginBottom: 2,
    },
    modeHelperText: { color: C.MUTED, fontSize: 12, flex: 1 },

    // ── Card shell ──────────────────────────────────────────────────
    card: {
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 14,
      padding: 14,
      marginHorizontal: 16,
      marginTop: 12,
    },
    lift: {},
    h1: { fontSize: 15, fontWeight: "900", color: C.TEXT, marginBottom: 8 },
    bodySmall: { color: C.MUTED, fontSize: 12, lineHeight: 17, marginTop: 2 },

    // ── BlurCard lock pill ──────────────────────────────────────────
    lockPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: "rgba(0,0,0,0.18)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.22)",
    },
    lockPillText: { color: "#fff", fontWeight: "900", fontSize: 12 },

    // ── Test plan steps ─────────────────────────────────────────────
    stepRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 6 },
    stepBadge: {
      width: 22,
      height: 22,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(29,155,240,0.12)",
      borderWidth: 1,
      borderColor: "rgba(29,155,240,0.25)",
      marginRight: 8,
      marginTop: 1,
    },
    stepBadgeText: { color: "#EAF2FF", fontWeight: "900", fontSize: 12, lineHeight: 12 },
    stepText: { color: C.TEXT, flex: 1, lineHeight: 20 },

    lockHintBox: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: (C.WARN ?? "#FFC36A") + "66",
      backgroundColor: (C.WARN ?? "#FFC36A") + "1F",
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    lockHintText: {
      color: C.WARN ?? "#FFD9A8",
      fontWeight: "700",
      flex: 1,
      lineHeight: 18,
    },

    // ── Why this setup ──────────────────────────────────────────────
    whyRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 2,
    },

    // ── Pro tip ─────────────────────────────────────────────────────
    proTipRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      marginHorizontal: 16,
      marginTop: 12,
      padding: 12,
      backgroundColor: (C.WARN ?? "#FFC36A") + "12",
      borderRadius: 10,
      borderWidth: 1,
      borderColor: (C.WARN ?? "#FFC36A") + "33",
    },
    proTipText: {
      color: C.WARN ?? "#FFD9A8",
      fontSize: 12,
      flex: 1,
      lineHeight: 17,
      fontWeight: "600",
    },

    // ── Ride-reminder inline ask ────────────────────────────────────
    notifPromptRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 16,
      marginTop: 10,
      padding: 12,
      backgroundColor: C.CARD,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.BORDER,
    },
    notifPromptText: {
      color: C.TEXT,
      fontSize: 12,
      flex: 1,
      lineHeight: 17,
      fontWeight: "600",
    },
    notifEnableBtn: {
      backgroundColor: C.ACCENT,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    notifEnableText: { color: "#fff", fontWeight: "800", fontSize: 12 },

    // ── Bottom action bar ───────────────────────────────────────────
    bottomActionBar: {
      flexDirection: "row",
      gap: 10,
      marginHorizontal: 16,
      marginTop: 16,
    },
    btnRefinePrimary: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    btnRefinePrimaryText: { color: "#fff", fontWeight: "900", fontSize: 15 },
    btnMoreSquare: {
      width: 50,
      height: 50,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
      alignSelf: "center",
    },

    // ── More menu (bottom sheet) ────────────────────────────────────
    moreMenuWrap: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    moreMenuCard: {
      backgroundColor: C.CARD,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderTopWidth: 1,
      borderTopColor: C.BORDER,
      overflow: "hidden",
    },
    moreMenuItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    moreMenuItemText: {
      color: C.TEXT,
      fontSize: 16,
      fontWeight: "700",
      flex: 1,
    },
    moreMenuDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: C.BORDER,
    },
    moreMenuCancel: {
      paddingHorizontal: 20,
      paddingVertical: 16,
      alignItems: "center",
    },
    moreMenuCancelText: { color: C.MUTED, fontSize: 16, fontWeight: "700" },

    proBadge: {
      backgroundColor: C.ACCENT + "22",
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderWidth: 1,
      borderColor: C.ACCENT + "44",
    },
    proBadgeText: {
      color: C.ACCENT,
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 0.5,
    },

    // ── TuneTwo changed rows ────────────────────────────────────────
    changeRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
    changeLabel: { color: C.TEXT, fontWeight: "800", marginBottom: 2 },
    changeSub: { color: C.MUTED, fontSize: 12 },
    changeIconWrap: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: C.ACCENT_2 ?? C.ACCENT,
      marginLeft: 8,
    },

    // ── Sticky unlock bar ───────────────────────────────────────────
    unlockBarWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: C.BG,
      borderTopWidth: 1,
      borderTopColor: C.BORDER,
      zIndex: 1000,
    },
    unlockCard: {
      marginHorizontal: 12,
      marginTop: 10,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.08)",
      backgroundColor: "rgba(13,14,19,0.98)",
      padding: 16,
      paddingTop: 18,
    },
    unlockClose: {
      position: "absolute",
      top: 10,
      right: 10,
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(255,255,255,0.10)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.14)",
    },
    unlockTitleBig: { color: C.TEXT, fontWeight: "900", fontSize: 20 },
    unlockSubStack: {
      color: C.MUTED,
      marginTop: 6,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: "700",
    },
    unlockBtnFull: {
      backgroundColor: C.ACCENT,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      marginTop: 12,
    },
    unlockBtnText: { color: "#fff", fontWeight: "900", fontSize: 16 },

    // ── Preset rename modal ─────────────────────────────────────────
    modalWrap: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      padding: 16,
    },
    backdrop: { ...StyleSheet.absoluteFillObject },
    modalCard: {
      backgroundColor: C.CARD,
      borderColor: C.BORDER,
      borderWidth: 1,
      borderRadius: 16,
      padding: 16,
    },
    modalTitle: { color: C.TEXT, fontSize: 16, fontWeight: "900", marginBottom: 10 },
    input: {
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INPUT_BG ?? "#0C1222",
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: Platform.OS === "ios" ? 10 : 8,
      fontSize: 16,
      color: C.TEXT,
      marginBottom: 12,
    },
    row: { flexDirection: "row", alignItems: "center" },
    modalBtnGhost: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: "transparent",
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    modalBtnGhostText: { color: C.TEXT, fontWeight: "800" },
    modalBtnPrimary: {
      backgroundColor: C.ACCENT,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    modalBtnPrimaryText: { color: "#fff", fontWeight: "900" },
  });
