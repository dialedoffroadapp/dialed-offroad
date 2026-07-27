// app/(tabs)/garage.tsx
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
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
import { OnboardingProgress } from "../../components/OnboardingProgress";
import { useToast } from "../../components/Toast";
import type { ThemeTokens } from "../../constants/theme";
import { useOnboarding } from "../../lib/onboarding";
import { deriveIsPro } from "../../lib/proUtils";
import { supabase } from "../../lib/supabase";
import { isProfane } from "../../lib/profanity";
import { useTheme } from "../../lib/theme";
import { getOrCreateFunnelId, logEvent } from "../../lib/usage";
import { isUuid } from "../../lib/uuid";
import { BIKE_BRANDS, BIKE_CATALOG } from "../../constants/bike-catalog";
import {
  catalogHasModel,
  normalizeBikeStrings,
  resolveModelId,
} from "../../lib/bikes";

const ICON = Platform.select({ ios: 20, android: 20, default: 20 })!;

/* -------------------------- Free / Pro limits -------------------------- */
const FREE_BIKE_LIMIT = 2;

/* -------------------------- Guest storage keys -------------------------- */
const GUEST_BIKES_KEY = "dialed_guest_bikes_v1";
const GUEST_DEFAULT_BIKE_KEY = "dialed_guest_default_bike_v1";

/* -------------------------------------------------------------------------- */
/*                              Inline Bike Catalog                           */
/* -------------------------------------------------------------------------- */
// MAKES / MODELS_BY_MAKE now live in constants/bike-catalog.ts as BIKE_BRANDS /
// BIKE_CATALOG — the single source of truth shared with on-save canonicalization
// (normalizeBikeStrings) and model_id resolution (resolveModelId) in lib/bikes.ts.

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
  Stark: "#E6342A",
};

function hexToRgba(hex: string, alpha: number) {
  const n = hex.replace("#", "");
  const r = parseInt(n.substring(0, 2), 16) || 0;
  const g = parseInt(n.substring(2, 4), 16) || 0;
  const b = parseInt(n.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

/* --------------------------------- Types ---------------------------------- */
type Bike = {
  id: string;
  make: string;
  model: string;
  year: number;
  nickname: string | null;
};

type NewBike = {
  make: string;
  model: string;
  year: string;
  nickname: string;
};

type ProfileMeta = {
  pro_until: string | null;
  is_pro: boolean | null;
};

/** Most recent session per bike, keyed by bike ID. */
type LastSessionMap = Record<string, { rode_on: string; surface: string | null }>;

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff}d ago`;
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
  if (diff < 365) return `${Math.floor(diff / 30)}mo ago`;
  return `${Math.floor(diff / 365)}y ago`;
}

/* ------------------------- Simple confirm bottom sheet -------------------- */
function ConfirmSheet({
  open,
  title,
  subtitle,
  confirmText = "Delete",
  onCancel,
  onConfirm,
  colors,
  styles,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  confirmText?: string;
  onCancel: () => void;
  onConfirm: () => void;
  colors: ThemeTokens;
  styles: any;
}) {
  if (!open) return null;
  return (
    <View style={styles.sheetWrap} pointerEvents="box-none">
      <Pressable style={styles.sheetOverlay} onPress={onCancel} />
      <View style={styles.sheet}>
        <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.1)", marginBottom: 14 }} />
        <Text style={[styles.sheetTitle, styles.noSelect]}>{title}</Text>
        {!!subtitle && (
          <Text style={[styles.sheetSubtitle, styles.noSelect]}>{subtitle}</Text>
        )}
        <View style={{ height: 12 }} />
        <View style={styles.sheetRow}>
          <Pressable
            onPress={onCancel}
            style={[styles.sheetBtn, styles.sheetBtnGhost]}
          >
            <Text style={[styles.sheetBtnGhostText, styles.noSelect]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={onConfirm}
            style={[styles.sheetBtn, styles.sheetBtnDanger]}
          >
            <Text style={[styles.sheetBtnText, styles.noSelect]}>{confirmText}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/* ----------------------------- Overflow menu sheet ------------------------ */
function OverflowSheet({
  open,
  bike,
  isDefault,
  onClose,
  onSetDefault,
  onDelete,
  colors,
  styles,
}: {
  open: boolean;
  bike: Bike | null;
  isDefault: boolean;
  onClose: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
  colors: ThemeTokens;
  styles: any;
}) {
  if (!open || !bike) return null;
  return (
    <View style={styles.sheetWrap} pointerEvents="box-none">
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.1)", marginBottom: 14 }} />
        <Text style={[styles.sheetTitle, styles.noSelect]}>
          {bike.make} {bike.model}
        </Text>
        <Text style={[styles.sheetSubtitle, styles.noSelect]}>
          {bike.year}{bike.nickname ? ` · ${bike.nickname}` : ""}
        </Text>
        <View style={{ height: 12 }} />

        <Pressable
          onPress={() => { onSetDefault(); onClose(); }}
          style={styles.overflowRow}
        >
          <Ionicons
            name={isDefault ? "star" : "star-outline"}
            size={18}
            color={isDefault ? colors.ACCENT : colors.TEXT}
          />
          <Text style={[styles.overflowRowText, styles.noSelect]}>
            {isDefault ? "Remove as default" : "Set as default"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => { onDelete(); onClose(); }}
          style={styles.overflowRow}
        >
          <Ionicons name="trash-outline" size={18} color={colors.ERROR} />
          <Text style={[styles.overflowRowText, { color: colors.ERROR }, styles.noSelect]}>
            Delete bike
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ----------------------------- Picker bottom sheet ------------------------ */
function PickerSheet({
  open,
  title,
  options,
  initialValue = "",
  onPick,
  onFreeText,
  onClose,
  colors,
  styles,
}: {
  open: boolean;
  title: string;
  options: string[];
  initialValue?: string;
  onPick: (value: string) => void;
  /** Called (in addition to onPick) when the user commits the free-text "Use
   *  '{query}'" fallback rather than a catalog row. */
  onFreeText?: (value: string) => void;
  onClose: () => void;
  colors: ThemeTokens;
  styles: any;
}) {
  const [query, setQuery] = useState(initialValue ?? "");
  useEffect(() => setQuery(initialValue ?? ""), [initialValue, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  if (!open) return null;
  return (
    <View style={styles.sheetWrap} pointerEvents="box-none">
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.1)", marginBottom: 14 }} />
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, styles.noSelect]}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.sheetClose}>
            <Ionicons name="close" size={18} color={colors.MUTED} />
          </Pressable>
        </View>

        <TextInput
          placeholder="Search or type custom…"
          placeholderTextColor={colors.MUTED}
          style={[styles.input, { marginTop: 8 }]}
          value={query}
          onChangeText={setQuery}
          autoCorrect
          returnKeyType="done"
          onSubmitEditing={Keyboard.dismiss}
        />

        <ScrollView style={{ maxHeight: 360, marginTop: 8 }}>
          {filtered.map((opt) => (
            <Pressable
              key={opt}
              style={styles.optionRow}
              onPress={() => {
                onPick(opt);
                onClose();
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="bicycle-outline" size={16} color={colors.MUTED} />
                <Text style={styles.optionText}>{opt}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.MUTED} />
            </Pressable>
          ))}

          {query.trim().length > 0 &&
          !options.some((o) => o.toLowerCase() === query.trim().toLowerCase()) ? (
            <Pressable
              style={[styles.optionRow, { borderStyle: "dashed" as any }]}
              onPress={() => {
                onFreeText?.(query.trim());
                onPick(query.trim());
                onClose();
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="create-outline" size={16} color={colors.ACCENT} />
                <Text style={[styles.optionText, { color: colors.ACCENT }]}>
                  Use “{query.trim()}”
                </Text>
              </View>
            </Pressable>
          ) : null}

          <Text style={[styles.muted, { marginTop: 6, textAlign: "center" }]}>
            Don&apos;t see your bike? Start typing to add it here.
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

/* ------------------------------- UI helpers ------------------------------- */
function Input({
  label,
  value,
  onChangeText,
  placeholder,
  width,
  keyboardType,
  colors,
  styles,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  width?: number;
  keyboardType?: "default" | "number-pad";
  colors: ThemeTokens;
  styles: any;
}) {
  return (
    <View style={{ flex: width ? undefined : 1, width }}>
      <Text style={[styles.caption, styles.noSelect]}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.MUTED}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        returnKeyType="done"
        onSubmitEditing={Keyboard.dismiss}
      />
    </View>
  );
}

/* ------------------------------ Local helpers ------------------------------ */
function genLocalId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function readGuestBikes(): Promise<Bike[]> {
  const raw = await AsyncStorage.getItem(GUEST_BIKES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Bike[]) : [];
  } catch {
    return [];
  }
}

async function writeGuestBikes(bikes: Bike[]) {
  await AsyncStorage.setItem(GUEST_BIKES_KEY, JSON.stringify(bikes));
}

async function readGuestDefaultBikeId(): Promise<string | null> {
  return (await AsyncStorage.getItem(GUEST_DEFAULT_BIKE_KEY)) ?? null;
}

async function writeGuestDefaultBikeId(id: string | null) {
  if (!id) {
    await AsyncStorage.removeItem(GUEST_DEFAULT_BIKE_KEY);
    return;
  }
  await AsyncStorage.setItem(GUEST_DEFAULT_BIKE_KEY, id);
}

/* --------------------------------- Screen --------------------------------- */
export default function GarageScreen() {
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // ✅ Onboarding mode is driven by context now (NOT query params)
  const { onboardingActive, state, setGuestBikeId, setStep } = useOnboarding();
  const isOnboarding = onboardingActive;
  const isGarageLocked =
    onboardingActive && state.onboardingStep === "garage_locked";

  const [loading, setLoading] = useState(true);
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [adding, setAdding] = useState(false);
  const [newBike, setNewBike] = useState<NewBike>({
    make: "",
    model: "",
    year: "",
    nickname: "",
  });

  const [isPro, setIsPro] = useState<boolean>(false);
  const [defaultBikeId, setDefaultBikeId] = useState<string | null>(null);
  const [lastSession, setLastSession] = useState<LastSessionMap>({});
  // latest setup version per bike — the garage visibly contains setups
  const [latestVersions, setLatestVersions] = useState<Record<string, number>>({});

  // overflow menu
  const [overflowBikeId, setOverflowBikeId] = useState<string | null>(null);
  const overflowBike = useMemo(
    () => bikes.find((b) => b.id === overflowBikeId) ?? null,
    [bikes, overflowBikeId]
  );

  // pickers
  const [makeOpen, setMakeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const modelOptions = useMemo(() => BIKE_CATALOG[newBike.make] ?? [], [newBike.make]);

  const ordered = useMemo(() => {
    const arr = [...bikes];
    if (defaultBikeId) {
      arr.sort((a, b) =>
        a.id === defaultBikeId ? -1 : b.id === defaultBikeId ? 1 : 0
      );
    }
    return arr;
  }, [bikes, defaultBikeId]);

  // In onboarding, the “selected” bike is just the default bike
  const selectedBikeId = defaultBikeId;

  // ---------- Load + auto-sync guest bikes if user logs in ----------
  const loadAll = async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;
      const userId = session?.user?.id;

      // If NOT logged in: use local guest garage
      if (!userId) {
        const guest = await readGuestBikes();
        const guestDefault = await readGuestDefaultBikeId();
        setBikes(guest);
        setDefaultBikeId(guestDefault);
        setIsPro(false);
        return;
      }

      // If logged in: first auto-sync any guest bikes one-by-one so a partial
      // failure does not delete bikes that were not successfully inserted.
      const guestBikes = await readGuestBikes();
      if (guestBikes.length > 0) {
        try {
          const results = await Promise.all(
            guestBikes.map(async (b) => {
              // Heal legacy guest strings + resolve model_id at sync time
              // (guests can't reach the DB offline).
              const { make, model } = normalizeBikeStrings(
                b.make ?? "",
                b.model ?? ""
              );
              const model_id = await resolveModelId(make, model, b.year);
              return supabase.from("bikes").insert({
                user_id: userId,
                make,
                model,
                year: b.year,
                nickname: b.nickname ?? null,
                model_id,
              });
            })
          );

          const allSucceeded = results.every((r) => !r.error);
          if (allSucceeded) {
            await writeGuestBikes([]);
            await writeGuestDefaultBikeId(null);
          } else {
            results.forEach((r, i) => {
              if (r.error) console.warn(`Guest bike sync failed (index ${i}):`, r.error);
            });
          }
        } catch (e) {
          console.warn("Guest bike sync exception:", e);
        }
      }

      // Load bikes from Supabase
      const { data: bikeRows, error: bikeErr } = await supabase
        .from("bikes")
        .select("id, make, model, year, nickname")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (bikeErr) throw bikeErr;
      setBikes(bikeRows || []);

      // Batch-fetch most recent session per bike for the state line
      if (bikeRows && bikeRows.length > 0) {
        try {
          const bikeIds = bikeRows.map((b: Bike) => b.id);
          const { data: sessionRows } = await supabase
            .from("sessions")
            .select("bike_id, rode_on, surface")
            .eq("user_id", userId)
            .in("bike_id", bikeIds)
            .order("rode_on", { ascending: false });

          if (sessionRows) {
            const map: LastSessionMap = {};
            for (const s of sessionRows as { bike_id: string; rode_on: string | null; surface: string | null }[]) {
              if (s.bike_id && s.rode_on && !map[s.bike_id]) {
                map[s.bike_id] = { rode_on: s.rode_on, surface: s.surface };
              }
            }
            setLastSession(map);
          }
        } catch {
          // Non-critical — state line just won't show
        }

        // Latest version number per bike for the "v{n}" badge
        try {
          const bikeIds = bikeRows.map((b: Bike) => b.id);
          const { data: versionRows } = await supabase
            .from("setup_versions")
            .select("bike_id, version_number")
            .eq("user_id", userId)
            .in("bike_id", bikeIds);

          if (versionRows) {
            const latest: Record<string, number> = {};
            for (const v of versionRows as { bike_id: string | null; version_number: number }[]) {
              if (v.bike_id && v.version_number > (latest[v.bike_id] ?? 0)) {
                latest[v.bike_id] = v.version_number;
              }
            }
            setLatestVersions(latest);
          }
        } catch {
          // Non-critical — badge just won't show
        }
      }
    } catch (e: any) {
      toast.show(e?.message ?? "Failed to load garage", { kind: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pro status (only if logged in) — refreshed on every tab focus so post-paywall
  // Pro status is always current without requiring an app restart.
  const refreshProStatus = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) {
        setIsPro(false);
        return;
      }

      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("pro_until, is_pro")
        .eq("user_id", userId)
        .maybeSingle<ProfileMeta>();

      if (profErr || !prof) {
        setIsPro(false);
        return;
      }

      setIsPro(deriveIsPro(prof));
    } catch {
      setIsPro(false);
    }
  }, []);

  useEffect(() => {
    refreshProStatus();
  }, [refreshProStatus]);

  useFocusEffect(
    useCallback(() => {
      refreshProStatus();
    }, [refreshProStatus])
  );

  // Persist guest garage whenever bikes/default change (ONLY when not logged in)
  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (userId) return; // logged in -> Supabase is source of truth
      await writeGuestBikes(bikes);
      await writeGuestDefaultBikeId(defaultBikeId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bikes, defaultBikeId]);

  // ---------- delete ----------
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBike, setConfirmBike] = useState<Bike | null>(null);

  const requestDelete = (bike: Bike) => {
    setConfirmBike(bike);
    setConfirmOpen(true);
  };

  const onDeleteConfirmed = async () => {
    const b = confirmBike;
    setConfirmOpen(false);
    if (!b) return;

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;

    // Guest delete (local)
    if (!userId) {
      setBikes((cur) => cur.filter((x) => x.id !== b.id));
      if (defaultBikeId === b.id) setDefaultBikeId(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show("Bike deleted", { kind: "success" });
      return;
    }

    // Logged-in delete (Supabase)
    const { error } = await supabase.from("bikes").delete().eq("id", b.id);
    if (error) {
      toast.show(error.message || "Delete failed", { kind: "error" });
      return;
    }
    setBikes((cur) => cur.filter((x) => x.id !== b.id));
    if (defaultBikeId === b.id) setDefaultBikeId(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast.show("Bike deleted", { kind: "success" });
  };

  // ---------- add ----------
  const onAddBike = async () => {
    // Free-plan gate
    if (!isPro && bikes.length >= FREE_BIKE_LIMIT) {
      toast.show(
        `Free plan: up to ${FREE_BIKE_LIMIT} bikes in your Garage. Unlock Pro for unlimited bikes.`,
        { kind: "info" }
      );
      Haptics.selectionAsync();
      router.push("/premium");
      return;
    }

    if (newBike.nickname.trim() && isProfane(newBike.nickname)) {
      toast.show("Please choose a different nickname.", { kind: "error" });
      return;
    }

    if (!newBike.make.trim() || !newBike.model.trim() || !newBike.year.trim()) {
      toast.show("Make, model, and year are required", { kind: "error" });
      return;
    }

    const y = Number(newBike.year);
    if (!Number.isFinite(y)) {
      toast.show("Year must be a number", { kind: "error" });
      return;
    }

    // Canonicalize make/model against the catalog before saving so the picker
    // and free-text paths both produce clean, matchable strings.
    const { make, model } = normalizeBikeStrings(newBike.make, newBike.model);
    const payload = {
      make,
      model,
      year: y,
      nickname: newBike.nickname.trim() || null,
    };

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;

    // Guest add (local)
    if (!userId) {
      const localBike: Bike = { id: genLocalId(), ...payload };
      setBikes((cur) => [...cur, localBike]);

      // ✅ onboarding: auto-select the newly added bike
      if (isGarageLocked) setDefaultBikeId(localBike.id);

      // Guests are the primary onboarding path — log here (queued, flushed at
      // signup). The signed-in branch below only covers the rarer
      // signed-in-but-still-locked case; a single add hits exactly one branch,
      // so this can't double-log with it.
      if (isGarageLocked) {
        const funnelId = await getOrCreateFunnelId();
        const ageMinutesSinceLastStep = Math.round(
          Math.max(0, Date.now() - Date.parse(state.lastUpdatedAt || "")) / 60000
        );
        await logEvent(
          "onboarding_bike_added",
          {
            funnel_id: funnelId,
            onboarding_step: state.onboardingStep,
            signed_in: false,
            bike_id: localBike.id,
            pending_tune_exists: false,
            resume: ageMinutesSinceLastStep >= 5,
            age_minutes_since_last_step: ageMinutesSinceLastStep,
            source_route: "/(tabs)/garage",
          },
          { allowAnonymous: true, queueIfAnonymous: true }
        );
      }

      setAdding(false);
      setNewBike({ make: "", model: "", year: "", nickname: "" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show("Bike added ✅", { kind: "success" });
      return;
    }

    // Logged-in add (Supabase)
    try {
      // Best-effort per-model link; null is fine and never blocks the save.
      const model_id = await resolveModelId(
        payload.make,
        payload.model,
        payload.year
      );
      const { data, error } = await supabase
        .from("bikes")
        .insert({
          user_id: userId, // REQUIRED for RLS
          ...payload,
          model_id,
        })
        .select("id, make, model, year, nickname")
        .single();

      if (error) throw error;

      const added = data as Bike;
      setBikes((cur) => [...cur, added]);

      // ✅ onboarding: auto-select the newly added bike
      if (isGarageLocked) setDefaultBikeId(added.id);

      if (isGarageLocked) {
        const funnelId = await getOrCreateFunnelId();
        const ageMinutesSinceLastStep = Math.round(
          Math.max(0, Date.now() - Date.parse(state.lastUpdatedAt || "")) / 60000
        );
        await logEvent(
          "onboarding_bike_added",
          {
            funnel_id: funnelId,
            onboarding_step: state.onboardingStep,
            signed_in: false,
            bike_id: added.id,
            pending_tune_exists: false,
            resume: ageMinutesSinceLastStep >= 5,
            age_minutes_since_last_step: ageMinutesSinceLastStep,
            source_route: "/(tabs)/garage",
          },
          { allowAnonymous: true, queueIfAnonymous: true }
        );
      }

      setAdding(false);
      setNewBike({ make: "", model: "", year: "", nickname: "" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show("Bike added ✅", { kind: "success" });
    } catch (e: any) {
      const code = e?.code;
      const msg = e?.message ?? "";

      if (code === "23505" || /duplicate key/i.test(msg) || /already exists/i.test(msg)) {
        toast.show("That bike is already in your garage.", { kind: "info" });
        Haptics.selectionAsync();
        return;
      }

      toast.show(msg || "Failed to add bike", { kind: "error" });
    }
  };

  const toggleDefault = (id: string) => {
    setDefaultBikeId((cur) => (cur === id ? null : id));
    Haptics.selectionAsync();
  };

  const onOnboardingContinue = async () => {
    if (!selectedBikeId) {
      Haptics.selectionAsync();
      setAdding(true);
      toast.show("Add a bike (or tap one) to continue.", { kind: "info" });
      return;
    }

    const b = bikes.find((x) => x.id === selectedBikeId);

    await setGuestBikeId(selectedBikeId);
    await setStep("tune");

    router.push({
      pathname: "/(tabs)/tune",
      params: {
        bikeId: selectedBikeId,
        onboarding: "1",

        // ✅ IMPORTANT: pass bike details so guest/local IDs still show correctly in Tune
        make: b?.make ?? "",
        model: b?.model ?? "",
        year: b?.year ? String(b.year) : "",
        nickname: b?.nickname ?? "",
      },
    });
  };

  if (loading) {
    return (
      <View style={styles.page}>
        <ActivityIndicator color={colors.ACCENT} />
      </View>
    );
  }

  return (
    <>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView
          behavior={Platform.select({ ios: "padding", android: undefined })}
          style={styles.screen}
          keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
        >
          <View style={[styles.topSafeSpacer, { height: insets.top }]} />

          <ScrollView
            contentContainerStyle={{
              padding: 16,
              paddingBottom: isOnboarding ? 140 : 56, // room for big CTA
            }}
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          >
          <OnboardingProgress />

          <View style={styles.cardHeaderBar}>
            <View style={styles.headerLeft}>
              <View style={styles.iconBadge}>
                <Ionicons name="bicycle-outline" size={16} color="#fff" />
              </View>
              <Text style={[styles.h1, styles.noSelect]}>
                {isOnboarding ? "Add your bike" : "Add Bike"}
              </Text>
            </View>

            <Pressable
              onPress={() => setAdding((x) => !x)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={adding ? "Close add bike" : "Add new bike"}
              style={styles.plusBtn}
            >
              <Ionicons name={adding ? "close" : "add"} size={18} color={colors.TEXT} />
            </Pressable>
          </View>

          {isOnboarding ? (
            <View style={[styles.onbTipCard, styles.shadow]}>
              <Text style={[styles.onbTipTitle, styles.noSelect]}>
                {state.hasSeenIntro ? "Pick up where you left off" : "Get started"}
              </Text>
              <Text style={styles.onbTipText}>
                {state.hasSeenIntro
                  ? "Add your bike to continue."
                  : "Add a bike, then tap it to select. We’ll use it to generate your first tune."}
              </Text>
            </View>
          ) : null}

          {adding && (
            <View style={[styles.card, styles.shadow, { marginBottom: 12 }]}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.caption, styles.noSelect]}>Make</Text>
                  <Pressable onPress={() => setMakeOpen(true)}>
                    <View style={styles.inputAffix}>
                      <TextInput
                        style={[styles.input, { paddingRight: 34 }]}
                        placeholder="Select make"
                        placeholderTextColor={colors.MUTED}
                        value={newBike.make}
                        onChangeText={(v) =>
                          setNewBike((nb) => ({
                            ...nb,
                            make: v,
                            model: "",
                          }))
                        }
                        onFocus={() => setMakeOpen(true)}
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                      <Ionicons
                        name="chevron-down"
                        size={16}
                        color={colors.MUTED}
                        style={styles.inputIcon}
                      />
                    </View>
                  </Pressable>
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={[styles.caption, styles.noSelect]}>Model</Text>
                  <Pressable onPress={() => setModelOpen(true)}>
                    <View style={styles.inputAffix}>
                      <TextInput
                        style={[styles.input, { paddingRight: 34 }]}
                        placeholder={newBike.make ? "Select model" : "Pick make first"}
                        placeholderTextColor={colors.MUTED}
                        value={newBike.model}
                        onChangeText={(v) =>
                          setNewBike((nb) => ({
                            ...nb,
                            model: v,
                          }))
                        }
                        onFocus={() => setModelOpen(true)}
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                      <Ionicons
                        name="list"
                        size={16}
                        color={colors.MUTED}
                        style={styles.inputIcon}
                      />
                    </View>
                  </Pressable>
                </View>
              </View>

              <View style={styles.row}>
                <Input
                  label="Year"
                  placeholder="2023"
                  value={newBike.year}
                  onChangeText={(v) => setNewBike((nb) => ({ ...nb, year: v }))}
                  width={130}
                  keyboardType="number-pad"
                  colors={colors}
                  styles={styles}
                />
                <Input
                  label="Nickname (optional)"
                  placeholder="Practice bike"
                  value={newBike.nickname}
                  onChangeText={(v) => setNewBike((nb) => ({ ...nb, nickname: v }))}
                  colors={colors}
                  styles={styles}
                />
              </View>

              <Pressable
                onPress={onAddBike}
                style={styles.btnPrimary}
                accessibilityRole="button"
                accessibilityLabel="Add bike"
              >
                <Ionicons name="add" size={18} color="#fff" style={{ marginRight: 6 }} />
                <Text style={[styles.btnPrimaryText, styles.noSelect]}>Add Bike</Text>
              </Pressable>

              <View style={styles.syncNote}>
                <Ionicons name="cloud-outline" size={14} color={colors.MUTED} />
                <Text style={[styles.syncNoteText, styles.noSelect]}>
                  Bikes save locally and sync when you create an account.
                </Text>
              </View>
            </View>
          )}

          <View style={styles.listHeader}>
            <Text style={[styles.sectionTitle, styles.noSelect]}>Your Bikes</Text>
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{bikes.length}</Text>
            </View>
          </View>

          {ordered.length === 0 ? (
            <View style={[styles.card, styles.centerEmpty]}>
              <Ionicons name="bicycle-outline" size={20} color={colors.MUTED} />
              <Text style={[styles.muted, { marginTop: 6 }]}>
                No bikes yet. Tap + to add one.
              </Text>
            </View>
          ) : (
            ordered.map((b) => {
              const accent = BRAND_ACCENTS[b.make] ?? "#3A3F4C";
              const isSelected = defaultBikeId === b.id;
              const session = lastSession[b.id];

              return (
                <Pressable
                  key={b.id}
                  onPress={() => {
                    if (isOnboarding) {
                      toggleDefault(b.id);
                    } else if (isUuid(b.id)) {
                      // Bike Home: everything about one bike, one place.
                      // Guest/local bikes have no table row to show — no-op.
                      router.push({
                        pathname: "/bike-home",
                        params: { bikeId: b.id },
                      } as any);
                    }
                  }}
                  style={[
                    styles.card,
                    styles.shadow,
                    isOnboarding && isSelected
                      ? { borderColor: colors.ACCENT, shadowOpacity: 0.32 }
                      : null,
                  ]}
                >
                  {/* ── Top row: icon chip + name + star + overflow ── */}
                  <View style={styles.cardTopRow}>
                    <View style={[styles.iconChip, { backgroundColor: hexToRgba(accent, 0.14) }]}>
                      <Ionicons name="bicycle" size={20} color={accent} />
                    </View>

                    <View style={styles.cardNameCol}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text
                          style={[styles.bikeName, styles.noSelect, { flexShrink: 1 }]}
                          numberOfLines={1}
                        >
                          {b.make} {b.model}
                        </Text>
                        {latestVersions[b.id] ? (
                          <View
                            style={{
                              backgroundColor: hexToRgba(colors.ACCENT, 0.16),
                              borderRadius: 999,
                              paddingHorizontal: 7,
                              paddingVertical: 2,
                            }}
                          >
                            <Text
                              style={{
                                color: colors.ACCENT,
                                fontSize: 10,
                                fontWeight: "900",
                              }}
                            >
                              v{latestVersions[b.id]}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.bikeSub, styles.noSelect]} numberOfLines={1}>
                        {b.year}{b.nickname ? ` · ${b.nickname}` : ""}
                      </Text>
                    </View>

                    {!isOnboarding && (
                      <View style={styles.cardActions}>
                        <Pressable onPress={() => toggleDefault(b.id)} style={styles.iconBtn} hitSlop={8}>
                          <Ionicons
                            name={isSelected ? "star" : "star-outline"}
                            size={ICON}
                            color={isSelected ? colors.ACCENT : colors.MUTED}
                          />
                        </Pressable>
                        <Pressable onPress={() => setOverflowBikeId(b.id)} style={styles.iconBtn} hitSlop={8}>
                          <Ionicons name="ellipsis-horizontal" size={ICON} color={colors.MUTED} />
                        </Pressable>
                      </View>
                    )}
                  </View>

                  {/* ── State line: last tuned ── */}
                  {!isOnboarding && (
                    <View style={styles.stateLine}>
                      <Ionicons
                        name={session ? "time-outline" : "ellipse-outline"}
                        size={13}
                        color={colors.MUTED}
                      />
                      <Text style={[styles.stateText, styles.noSelect]}>
                        {session
                          ? `Last tuned ${relativeDate(session.rode_on)}${session.surface ? ` · ${cap(session.surface)}` : ""}`
                          : "No tune yet"}
                      </Text>
                    </View>
                  )}

                  {/* ── Onboarding select pill ── */}
                  {isOnboarding && (
                    <View style={{ marginTop: 10 }}>
                      <View
                        style={[
                          styles.onbSelectPill,
                          isSelected && styles.onbSelectPillOn,
                        ]}
                      >
                        <Ionicons
                          name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                          size={16}
                          color={isSelected ? "#fff" : colors.MUTED}
                        />
                        <Text
                          style={[
                            styles.onbSelectPillText,
                            isSelected && styles.onbSelectPillTextOn,
                          ]}
                        >
                          {isSelected ? "Selected" : "Tap to select"}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* ── Tune button ── */}
                  {!isOnboarding && (
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/(tabs)/tune",
                          params: { bikeId: b.id },
                        })
                      }
                      style={[styles.tuneBtn, { backgroundColor: accent }]}
                    >
                      <Ionicons name="flash" size={15} color="#fff" />
                      <Text style={[styles.tuneBtnText, styles.noSelect]}>
                        Tune this bike
                      </Text>
                    </Pressable>
                  )}
                </Pressable>
              );
            })
          )}
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>

      {/* ✅ Onboarding sticky CTA */}
      {isOnboarding && (
        <View
          style={[
            styles.onbFooterWrap,
            { paddingBottom: insets.bottom + 14 },
          ]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={onOnboardingContinue}
            style={({ pressed }) => [
              styles.onbCta,
              !selectedBikeId && styles.onbCtaDisabled,
              pressed && { opacity: 0.92 },
            ]}
            disabled={!selectedBikeId}
          >
            <Text style={styles.onbCtaText}>
              {selectedBikeId ? "Continue to Tune" : "Add a bike to continue"}
            </Text>
          </Pressable>
        </View>
      )}

      <PickerSheet
        open={makeOpen}
        title="Select make"
        options={BIKE_BRANDS}
        initialValue={newBike.make}
        onPick={(val) => setNewBike((nb) => ({ ...nb, make: val, model: "" }))}
        onClose={() => setMakeOpen(false)}
        colors={colors}
        styles={styles}
      />
      <PickerSheet
        open={modelOpen}
        title={newBike.make ? `Select model: ${newBike.make}` : "Select model"}
        options={newBike.make ? modelOptions : []}
        initialValue={newBike.model}
        onPick={(val) => setNewBike((nb) => ({ ...nb, model: val }))}
        onFreeText={(q) => {
          // Rider used the free-text fallback for a model not in the catalog —
          // a coverage signal (suppressed when it's just a spacing/case variant
          // that canonicalizes to a real model, e.g. "300 xcw" → "300 XC-W").
          if (!catalogHasModel(newBike.make, q)) {
            void logEvent(
              "bike_search_no_result",
              { query: q, make: newBike.make },
              { allowAnonymous: true, queueIfAnonymous: true }
            );
          }
        }}
        onClose={() => setModelOpen(false)}
        colors={colors}
        styles={styles}
      />

      <ConfirmSheet
        open={confirmOpen}
        title="Delete this bike?"
        subtitle={confirmBike ? `${confirmBike.year} ${confirmBike.make} ${confirmBike.model}` : ""}
        confirmText="Delete"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={onDeleteConfirmed}
        colors={colors}
        styles={styles}
      />

      <OverflowSheet
        open={!!overflowBikeId}
        bike={overflowBike}
        isDefault={overflowBikeId === defaultBikeId}
        onClose={() => setOverflowBikeId(null)}
        onSetDefault={() => { if (overflowBikeId) toggleDefault(overflowBikeId); }}
        onDelete={() => { if (overflowBike) requestDelete(overflowBike); }}
        colors={colors}
        styles={styles}
      />
    </>
  );
}

/* --------------------------------- Styles --------------------------------- */
const makeStyles = (colors: ThemeTokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.BG },
    page: {
      flex: 1,
      backgroundColor: colors.BG,
      alignItems: "center",
      justifyContent: "center",
    },
    topSafeSpacer: { backgroundColor: colors.BG },

    cardHeaderBar: {
      backgroundColor: colors.CARD,
      borderWidth: 1,
      borderColor: colors.BORDER,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    plusBtn: {
      width: 32,
      height: 32,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.08)",
      backgroundColor: colors.CARD,
      alignItems: "center",
      justifyContent: "center",
    },

    // onboarding tip card
    onbTipCard: {
      backgroundColor: colors.CARD,
      borderWidth: 1,
      borderColor: colors.BORDER,
      borderRadius: 16,
      padding: 14,
      marginBottom: 12,
    },
    onbTipTitle: {
      color: colors.TEXT,
      fontWeight: "900",
      fontSize: 13,
      marginBottom: 4,
    },
    onbTipText: {
      color: colors.MUTED,
      fontSize: 13,
      lineHeight: 18,
    },

    card: {
      backgroundColor: colors.CARD,
      borderWidth: 1,
      borderColor: colors.BORDER,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
      overflow: "hidden",
    },
    shadow: {},

    headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
    iconBadge: {
      width: 28,
      height: 28,
      borderRadius: 999,
      backgroundColor: colors.ACCENT,
      alignItems: "center",
      justifyContent: "center",
    },
    h1: { fontSize: 17, fontWeight: "900", color: colors.TEXT },

    sectionTitle: {
      fontSize: 14,
      fontWeight: "900",
      color: colors.TEXT,
      marginTop: 4,
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    listHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },

    countPill: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.08)",
      backgroundColor: colors.INPUT_BG ?? "#0C0D12",
    },
    countPillText: { color: colors.TEXT, fontWeight: "900", fontSize: 12 },

    caption: { color: "#4B5563", fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 6 },
    muted: { color: colors.MUTED, fontSize: 13 },

    row: { flexDirection: "row", gap: 12, marginBottom: 10 },

    input: {
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.07)",
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.TEXT,
      backgroundColor: colors.INPUT_BG ?? "#0C0D12",
      minHeight: 44,
    },
    inputAffix: { position: "relative" },
    inputIcon: {
      position: "absolute",
      right: 10,
      top: Platform.OS === "ios" ? 12 : 10,
    },

    btnPrimary: {
      marginTop: 6,
      backgroundColor: colors.ACCENT,
      borderRadius: 12,
      paddingVertical: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    },
    btnPrimaryText: { color: "#FFFFFF", fontWeight: "900" },

    syncNote: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 10,
      justifyContent: "center",
    },
    syncNoteText: { color: colors.MUTED, fontSize: 12, flexShrink: 1 },

    // ── New bike card layout ──
    cardTopRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    iconChip: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    cardNameCol: {
      flex: 1,
      minWidth: 0,
    },
    bikeName: {
      color: colors.TEXT,
      fontWeight: "900",
      fontSize: 16,
      lineHeight: 20,
    },
    bikeSub: {
      color: colors.MUTED,
      fontSize: 13,
      lineHeight: 17,
      marginTop: 1,
    },
    cardActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      flexShrink: 0,
    },
    iconBtn: { padding: 8, borderRadius: 10 },

    stateLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.BORDER,
    },
    stateText: {
      color: colors.MUTED,
      fontSize: 12,
      fontWeight: "600",
    },

    tuneBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 12,
      paddingVertical: 12,
      borderRadius: 12,
    },
    tuneBtnText: {
      color: "#fff",
      fontWeight: "900",
      fontSize: 14,
    },

    // overflow menu rows
    overflowRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 4,
      borderBottomWidth: 1,
      borderColor: colors.BORDER,
    },
    overflowRowText: {
      color: colors.TEXT,
      fontWeight: "700",
      fontSize: 15,
    },

    // onboarding select pill
    onbSelectPill: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.BORDER,
      backgroundColor: colors.INK,
    },
    onbSelectPillOn: {
      backgroundColor: colors.ACCENT,
      borderColor: colors.ACCENT,
    },
    onbSelectPillText: {
      color: colors.MUTED,
      fontWeight: "900",
      fontSize: 12,
    },
    onbSelectPillTextOn: {
      color: "#fff",
    },

    centerEmpty: { alignItems: "center", justifyContent: "center" },

    noSelect: { userSelect: "none" as any },

    // sticky onboarding footer
    onbFooterWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 16,
      paddingTop: 10,
      backgroundColor: "rgba(13,14,19,0.95)",
      borderTopWidth: 1,
      borderTopColor: "rgba(255,255,255,0.06)",
    },
    onbCta: {
      minHeight: 56,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.ACCENT,
    },
    onbCtaDisabled: { opacity: 0.5 },
    onbCtaText: {
      color: "#fff",
      fontWeight: "900",
      fontSize: 16,
    },

    sheetWrap: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "flex-end",
      alignItems: "stretch",
    },
    sheetOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.OVERLAY,
    },
    sheet: {
      backgroundColor: colors.CARD,
      padding: 16,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      borderWidth: 1,
      borderColor: colors.BORDER,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sheetTitle: { fontSize: 16, fontWeight: "900", color: colors.TEXT },
    sheetClose: { padding: 6, borderRadius: 8 },

    sheetSubtitle: { fontSize: 13, color: colors.MUTED, marginTop: 4 },
    sheetRow: { flexDirection: "row", gap: 8, marginTop: 10 },
    sheetBtn: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    sheetBtnDanger: { backgroundColor: colors.ERROR },
    sheetBtnGhost: {
      borderWidth: 1,
      borderColor: colors.BORDER,
      backgroundColor: colors.CARD,
    },
    sheetBtnText: { color: "#fff", fontWeight: "900" },
    sheetBtnGhostText: { color: colors.TEXT, fontWeight: "900" },

    optionRow: {
      paddingVertical: 14,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderColor: colors.BORDER,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.INK,
      borderRadius: 10,
      marginBottom: 8,
    },
    optionText: { color: colors.TEXT, fontWeight: "800" },
  });
