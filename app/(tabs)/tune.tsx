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
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RiskGate } from "../../components/RiskGate";
import { useToast } from "../../components/Toast";
import { generateTune, ZeroTuneInput, ZeroTuneResult } from "../../lib/ai";
// 🔻 Removed direct RevenueCat gating – Tune now trusts Supabase profile only
// import { getCustomerInfo, isPro as isProEntitlement } from "../../lib/purchases";
import { supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import type { UsageEvent } from "../../lib/usage";
import { logEvent } from "../../lib/usage";

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

/* -------------------------------- Component -------------------------------- */
export default function TuneScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
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
  } = useLocalSearchParams<{
    preset?: string;
    t?: string;
    bikeId?: string;
    onboarding?: string; // ✅ from Garage: onboarding:"1"
    make?: string;
    model?: string;
    year?: string;
    nickname?: string;
  }>();

  // ✅ onboarding mode supports either legacy t=onboarding OR onboarding=1
  const isOnboarding = useMemo(() => t === "onboarding" || onboarding === "1", [t, onboarding]);

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

  // ——— Conditions / rider ———
  const [terrainTags, setTerrainTags] = useState<string[]>(["hardpack"]);
  const [terrainOther, setTerrainOther] = useState("");
  const [track, setTrack] = useState("");
  const [temp, setTemp] = useState("");
  const [elev, setElev] = useState("");

  const [tempUnit, setTempUnit] = useState<"f" | "c">("f");
  const [elevUnit, setElevUnit] = useState<"ft" | "m">("ft");

  const [weight, setWeight] = useState("185");
  const [skill, setSkill] = useState<"beginner" | "intermediate" | "pro">("intermediate");
  const [rideStyle, setRideStyle] = useState<"short_motos" | "long_enduro">("short_motos");

  const [goals, setGoals] = useState<string[]>(["stability", "comfort"]);
  const [goalInput, setGoalInput] = useState("");
  const addGoal = () => {
    const raw = goalInput;
    const g = normalizeGoal(raw);
    if (!g) return;
    const exists = goals.some((x) => normalizeGoal(x) === g);
    if (!exists) setGoals((x) => [...x, g]);
    setGoalInput("");
    Haptics.selectionAsync();
  };
  const removeCustomGoal = (g: string) => {
    setGoals((cur) => cur.filter((x) => x !== g));
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
  const [zeroed, setZeroed] = useState(false); // must be ON to generate
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

  // --- CTA logic for main button ---
  const hasFreeTrialTune = !isPro && trialUsed < TRIAL_LIMIT;
  const trialExhausted = !isPro && !hasFreeTrialTune;
  // If the CTA actually runs a tune (Pro or still has free trial), we require Zero-based
  const needsZeroForCta = !trialExhausted;

  const primaryCtaLabel = isOnboarding
    ? isPro
      ? "Generate my first tune"
      : hasFreeTrialTune
      ? "Generate my first tune"
      : "Go Pro for unlimited tunes"
    : isPro
    ? "Generate tune"
    : hasFreeTrialTune
    ? "Use 1 free tune credit"
    : "Go Pro for unlimited tunes";

  const ctaDisabled = generating || (needsZeroForCta && !zeroed);

  // ——— Loaded preset + meta ———
  const [loadedPreset, setLoadedPreset] = useState<ZeroTuneResult | null>(null);
  const [loadedPresetMeta, setLoadedPresetMeta] = useState<PresetMeta>(null);
  const lastPresetRef = useRef<string | undefined>(undefined);

  // ✅ track whether we already applied the onboarding bikeId so we don’t bounce
  const onboardingAppliedRef = useRef(false);

  // risk + monetization:
  //  - Risk: stored locally in AsyncStorage (per user)
  //  - Trial + Pro: from Supabase profile (account-based, not device-based)
  useEffect(() => {
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;

        if (!user?.id) {
          setIsPro(false);
          setTrialUsed(0);
          return;
        }

        // Load local Risk consent
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
            const proActive =
              !!prof.is_pro ||
              (!!prof.pro_until && new Date(prof.pro_until).getTime() > Date.now());
            setIsPro(proActive);
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
      }
    })();
  }, []);

  // ---------- bikes helper + live updates ----------
  const applySelected = (b: Bike) => {
    setSelectedBikeId(b.id);
    setMake(b.make ?? "");
    setModel(b.model ?? "");
    setYear(b.year ? String(b.year) : "");
  };
  const clearSelected = () => setSelectedBikeId(null);

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
      toast.show(e?.message ?? "Failed to load Garage", { kind: "error" });
    } finally {
      setBikeLoading(false);
    }
  }, [toast, bikeId, isOnboarding, selectedBikeId]);

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
    if (!zeroed) {
      toast.show("Turn on Zero-based to continue.", { kind: "error" });
      return;
    }

    const ok = await ensureRiskAccepted();
    if (!ok) return;

    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;

      // ✅ Guest allowed ONLY during onboarding
      const isGuest = !user?.id;

      if (isGuest && !isOnboarding) {
        throw new Error("Please sign in");
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

        // claim.reason is 'trial' or 'pro'
        const trialCountFromServer = (claim as any)?.trial_tunes_used;

        if (typeof trialCountFromServer === "number") {
          setTrialUsed(trialCountFromServer);
        }

        if (claim?.reason === "pro") {
          setIsPro(true); // server says they’re Pro now
        }
      }

      setGenerating(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const input: ZeroTuneInput = {
        make: make.trim() || undefined,
        model: model.trim() || undefined,
        year: year ? Number(year) : undefined,
        terrain: terrainLabel,
        track: track.trim() || undefined,
        temp_f:
          temp.trim().length === 0
            ? undefined
            : tempUnit === "f"
            ? Number(temp)
            : Math.round((Number(temp) * 9) / 5 + 32),
        elev_ft:
          elev.trim().length === 0
            ? undefined
            : elevUnit === "ft"
            ? Number(elev)
            : Math.round(Number(elev) * 3.28084),
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

      const s: ZeroTuneResult = await generateTune(input);

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
      });

      router.push({
        pathname: "/tune-results",
        params: {
          r: encodeURIComponent(JSON.stringify(s)),
          meta: encodeURIComponent(
            JSON.stringify({
              bike: { year: input.year, make: input.make, model: input.model, selectedBikeId },
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
              onboarding: isOnboarding ? true : false,
              guest: !user?.id, // ✅ used later to blur + “Unlock for free”
            })
          ),
        },
      });
    } catch (e: any) {
      toast.show(e?.message ?? "AI tune failed", { kind: "error" });
    } finally {
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

  /* --------------------------------- Render -------------------------------- */
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
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
        {/* Header (solid accent, no gradient) */}
        <View style={S.headerSolid}>
          <Text style={S.heroTitle}>{isOnboarding ? "Step 2 of 2" : "Suggested setup"}</Text>
          <Text style={S.heroSubtitle}>
            {isOnboarding
              ? "Confirm today’s conditions, then generate your first tune."
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
                <Ionicons name="bicycle" size={14} color="#fff" />
                <Text style={S.manageLinkText}>Manage Garage</Text>
                <Ionicons name="chevron-forward" size={14} color="#fff" />
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
                <Ionicons name="bookmarks" size={14} color="#fff" />
                <Text style={S.manageLinkText}>My Presets</Text>
                <Ionicons name="chevron-forward" size={14} color="#fff" />
              </Pressable>
            )}
          </View>

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

          <View style={S.row}>
            <View style={{ flex: 1 }}>
              <View style={S.labelWithToggles}>
                <Text style={S.caption}>Temp</Text>
                <View style={S.toggles}>
                  <Pressable
                    onPress={() => setTempUnit("f")}
                    style={[S.toggle, tempUnit === "f" && S.toggleOn]}
                  >
                    <Text style={[S.toggleText, tempUnit === "f" && S.toggleTextOn]}>°F</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setTempUnit("c")}
                    style={[S.toggle, tempUnit === "c" && S.toggleOn]}
                  >
                    <Text style={[S.toggleText, tempUnit === "c" && S.toggleTextOn]}>°C</Text>
                  </Pressable>
                </View>
              </View>
              <TextInput
                style={S.input}
                placeholder="e.g., 75"
                placeholderTextColor={C.MUTED}
                value={temp}
                onChangeText={setTemp}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>

            <View style={{ flex: 1 }}>
              <View style={S.labelWithToggles}>
                <Text style={S.caption}>Elevation</Text>
                <View style={S.toggles}>
                  <Pressable
                    onPress={() => setElevUnit("ft")}
                    style={[S.toggle, elevUnit === "ft" && S.toggleOn]}
                  >
                    <Text style={[S.toggleText, elevUnit === "ft" && S.toggleTextOn]}>ft</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setElevUnit("m")}
                    style={[S.toggle, elevUnit === "m" && S.toggleOn]}
                  >
                    <Text style={[S.toggleText, elevUnit === "m" && S.toggleTextOn]}>m</Text>
                  </Pressable>
                </View>
              </View>
              <TextInput
                style={S.input}
                placeholder="e.g., 1200"
                placeholderTextColor={C.MUTED}
                value={elev}
                onChangeText={setElev}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
            </View>
          </View>
        </View>

        {/* Rider */}
        <View style={S.card}>
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
                onPress={() =>
                  setGoals((cur) =>
                    cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]
                  )
                }
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
        </View>

        {/* Air fork toggle */}
        <View style={S.card}>
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
        </View>

        {/* Zero-based (Required) */}
        <View style={[S.card, S.requiredCard]}>
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
            <View style={S.reqPill}>
              <Text style={S.reqPillText}>Required</Text>
            </View>
          </View>
          <View style={[S.rowBetween, { alignItems: "center", marginTop: 6 }]}>
            <Text style={[S.muted, { flex: 1, paddingRight: 12 }]}>
              All clickers are turned fully in (0). Show clicks out from that zero point.
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
              tint={C.BG === "#FFFFFF" ? "light" : "dark"}
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
              {generating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={S.stickyBtnText}>{primaryCtaLabel}</Text>
              )}
            </Pressable>

            {needsZeroForCta && !zeroed && (
              <Text style={[S.muted, { textAlign: "left", marginTop: 8 }]}>
                Turn on <Text style={{ fontWeight: "800", color: C.TEXT }}>Zero-based</Text> to
                continue.
              </Text>
            )}
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
    </TouchableWithoutFeedback>
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
  const isLight = C.BG === "#FFFFFF";

  return StyleSheet.create({
    topSafeSpacer: { backgroundColor: C.BG },

    headerSolid: {
      backgroundColor: C.ACCENT,
      paddingTop: 18,
      paddingBottom: 14,
      paddingHorizontal: 16,
      borderBottomLeftRadius: 18,
      borderBottomRightRadius: 18,
      ...Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        },
        android: { elevation: 6 },
      }),
    },

    heroTitle: {
      color: "#fff",
      fontSize: 22,
      lineHeight: 26,
      fontWeight: "900",
      letterSpacing: -0.2,
    },
    heroSubtitle: {
      color: "rgba(255,255,255,0.9)",
      fontSize: 14,
      lineHeight: 18,
      marginTop: 6,
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
      borderColor: "rgba(255,255,255,0.25)",
      backgroundColor: "rgba(0,0,0,0.12)",
      minHeight: 36,
    },
    manageLinkText: { color: "#fff", fontWeight: "800", fontSize: 12 },

    selectorCard: {
      marginTop: 12,
      backgroundColor: "rgba(0,0,0,0.12)",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.18)",
      padding: 10,
    },
    selectorHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    selectorLabel: { color: "#fff", fontWeight: "800", fontSize: 13 },
    selectorEmpty: { color: "rgba(255,255,255,0.9)" },
    seeAllLink: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: "rgba(0,0,0,0.12)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.25)",
      minHeight: 32,
    },
    seeAllText: { color: "#fff", fontWeight: "800", fontSize: 12 },

    onbBikeCard: {
      borderRadius: 12,
      borderWidth: 1,
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: "rgba(255,255,255,0.10)",
    },
    onbBikeCardTitle: {
      color: "#fff",
      fontWeight: "900",
      fontSize: 13,
      lineHeight: 18,
    },
    onbBikeCardSub: {
      color: "rgba(255,255,255,0.86)",
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
    // brighter + darker border in light mode so it pops
    pillActive: {
      backgroundColor: isLight ? C.ACCENT + "1A" : C.ACCENT + "2E",
      borderColor: isLight ? C.ACCENT : C.ACCENT + "73",
    },
    pillText: { color: C.TEXT, fontWeight: "600" },
    // dark text in light mode, light text in dark mode
    pillTextActive: {
      color: isLight ? C.TEXT : "#EAF2FF",
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
      backgroundColor: isLight ? C.ACCENT + "1A" : C.ACCENT + "2E",
      borderColor: isLight ? C.ACCENT : C.ACCENT + "73",
    },
    toggleText: { color: C.MUTED, fontWeight: "800", fontSize: 12 },
    toggleTextOn: {
      color: isLight ? C.TEXT : "#EAF2FF",
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
      ...Platform.select({
        ios: {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: "rgba(255,255,255,0.12)",
        },
        android: {
          backgroundColor: C.CARD,
          borderTopWidth: 1,
          borderTopColor: C.BORDER,
          elevation: 40,
        },
      }),
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
    stickyBtnDisabled: { opacity: 0.55 },
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
