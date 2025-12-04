// app/tune-results.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { useToast } from "../components/Toast";
import { ZeroTuneResult } from "../lib/ai";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";

/* ---------------- Free / Pro limits ---------------- */
const FREE_BASELINE_LIMIT = 10;

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
  // Extra context so tune-feedback can build smart sliders
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
  const insets = useSafeAreaInsets();
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);

  const base: ZeroTuneResult | null = useMemo(() => {
    try {
      return r ? (JSON.parse(decodeURIComponent(r)) as ZeroTuneResult) : null;
    } catch {
      return null;
    }
  }, [r]);

  const metaObj: any = useMemo(() => {
    try {
      return meta ? JSON.parse(decodeURIComponent(meta)) : null;
    } catch {
      return null;
    }
  }, [meta]);

  // If we’re coming from Tune Two we expect a "previous" tune tucked into meta.
  const previousTune: ZeroTuneResult | null = useMemo(() => {
    const cand =
      metaObj?.previous ??
      metaObj?.previousTune ??
      metaObj?.prev ??
      null;
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

  // Try to pull a concrete bike id from:
  // 1) explicit route param from Tune → Results → Feedback → Tune Two
  // 2) older meta shapes (baseline results)
  const bikeId: string | null = useMemo(() => {
    if (typeof bikeIdParam === "string" && bikeIdParam.length > 0) {
      return bikeIdParam;
    }
    return (
      metaObj?.bike?.selectedBikeId ??
      metaObj?.bike?.id ??
      metaObj?.bike_id ??
      metaObj?.bike_hint?.id ??
      metaObj?.bike_hint?.selectedBikeId ??
      null
    );
  }, [bikeIdParam, metaObj]);

  // Monetization: Pro flag (Supabase-only)
  const [isPro, setIsPro] = useState(false);

  // Load Pro status from Supabase profiles (same source of truth as Tune)
  useEffect(() => {
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;
        if (!user?.id) {
          setIsPro(false);
          return;
        }

        try {
          const { data: prof, error: profErr } = await supabase
            .from("profiles")
            .select("pro_until, is_pro")
            .eq("user_id", user.id)
            .maybeSingle<ProfileMeta>();

          if (profErr) {
            console.warn("TuneResults: profiles select failed", profErr);
            setIsPro(false);
          } else if (!prof) {
            setIsPro(false);
          } else {
            const hasServerPro =
              !!prof.is_pro ||
              (!!prof.pro_until &&
                new Date(prof.pro_until).getTime() > Date.now());
            setIsPro(hasServerPro);
          }
        } catch (e) {
          console.warn("TuneResults: profiles select threw", e);
          setIsPro(false);
        }
      } catch (e) {
        console.warn("TuneResults: init failed", e);
        setIsPro(false);
      }
    })();
  }, []);

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

  // Preset save (with rename modal) — still here, used later on refined tunes
  const [showNameModal, setShowNameModal] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);

  useEffect(() => {
    if (!base) {
      const t = setTimeout(() => router.replace("/(tabs)/tune"), 10);
      return () => clearTimeout(t);
    }
  }, [base, router]);

  if (!result) {
    return (
      <View style={S.emptyWrap}>
        <Text style={S.emptyText}>No result to display.</Text>
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

  // Air pressure logic (only if tune screen asked for AER)
  const wantsAir: boolean = !!metaObj?.context?.wants_air_fork;
  const riderWeight: number | undefined =
    typeof metaObj?.context?.rider_weight_lbs === "number"
      ? metaObj.context.rider_weight_lbs
      : undefined;
  const airBar = wantsAir ? deriveAirBar(result, riderWeight) : undefined;
  const prevAirBar =
    wantsAir && previousTune ? deriveAirBar(previousTune, riderWeight) : undefined;

  // Prefer bike_hint (from preset) → meta.bike → fallback
  const bikeTitle =
    metaObj?.bike_hint &&
    (metaObj.bike_hint.make ||
      metaObj.bike_hint.model ||
      metaObj.bike_hint.year)
      ? [
          metaObj.bike_hint.year,
          metaObj.bike_hint.make,
          metaObj.bike_hint.model,
        ]
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

  // Chips
  const terrainVal = Array.isArray(metaObj?.context?.terrain)
    ? metaObj?.context?.terrain[0]
    : metaObj?.context?.terrain;
  const trackName = metaObj?.context?.track ?? metaObj?.track_name ?? null;

  const headerChips = [
    metaObj?.preset?.name ? `Preset: ${metaObj.preset.name}` : null,
    terrainVal ? `Surface: ${cap(terrainVal)}` : null,
    trackName ? `Track: ${trackName}` : null,
    typeof result.shock.sag_mm === "number"
      ? `Sag: ${num(result.shock.sag_mm)} mm`
      : null,
    typeof airBar === "number" ? `AER: ${airBar.toFixed(2)} bar` : null,
  ].filter(Boolean) as string[];

  // ----- Tune Two meta: build rider-specific key areas -----
  const keyAreasForFeedback: KeyAreaMeta[] = useMemo(
    () => buildKeyAreasFromContext(metaObj),
    [metaObj]
  );

  const goalsForMeta: string[] = Array.isArray(metaObj?.context?.goals)
    ? metaObj.context.goals
    : [];
  const issuesForMeta: string | undefined =
    typeof metaObj?.context?.issues === "string"
      ? metaObj.context.issues
      : undefined;

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

  // 🔧 UPDATED: include bikeId inside the context for Tune Two so the refine flow can save to the right bike
  const goToFeedback = () => {
    // Build a lean context object for Tune Two (what the backend actually cares about)
    // plus bike id hints so tune-feedback can re-embed them.
    const ctxForFeedback: any = {
      make:
        metaObj?.bike?.make ??
        metaObj?.bike_hint?.make ??
        undefined,
      model:
        metaObj?.bike?.model ??
        metaObj?.bike_hint?.model ??
        undefined,
      year:
        metaObj?.bike?.year ??
        metaObj?.bike_hint?.year ??
        undefined,
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

      // 🔵 NEW: carry through concrete bike id hints
      selectedBikeId: bikeId ?? undefined,
      bike_id: bikeId ?? undefined,
    };

    router.push({
      pathname: "/tune-feedback",
      params: {
        meta: encodeURIComponent(JSON.stringify(feedbackMeta)),
        previous: encodeURIComponent(JSON.stringify(result)),
        context: encodeURIComponent(JSON.stringify(ctxForFeedback)),
        // Optional extra param: not required, but harmless
        bikeId: bikeId ?? "",
      },
    });
  };

  // ----- Save baseline / refined (requires bike + Pro/limit logic) -----
  const canSave = !!bikeId;

  const onSaveBaseline = async () => {
    if (!canSave) {
      toast.show(
        "Pick a bike first (Garage → select bike), then save your setup.",
        {
          kind: "error",
        }
      );
      return;
    }

    try {
      setSavingBaseline(true);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user?.id) {
        router.push("/login");
        return;
      }

      // Free plan: enforce saved-baseline cap (using same sessions table)
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
        bike_id: bikeId, // REQUIRED now
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
          metaObj?.preset?.name
            ? `Preset: ${metaObj.preset.name}`
            : "Zero-based tune",
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
          typeof airBar === "number"
            ? `AER pressure: ${airBar.toFixed(2)} bar`
            : null,
        ]
          .filter(Boolean)
          .join(" — "),
      };

      const { error } = await supabase.from("sessions").insert(insert);
      if (error) throw error;
      toast.show(
        isTuneTwo ? "Refined setup saved ✅" : "Baseline saved ✅",
        { kind: "success" }
      );
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
        router.push("/login");
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
      router.push("/login");
    }
  };

  const confirmSavePreset = async () => {
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
        name:
          presetName.trim() ||
          `My Preset – ${new Date().toLocaleDateString()}`,
        track_name: trackName ?? null,
        terrain,
        bike_hint: {
          year: metaObj?.bike?.year ?? metaObj?.bike_hint?.year ?? null,
          make: metaObj?.bike?.make ?? metaObj?.bike_hint?.make ?? null,
          model: metaObj?.bike?.model ?? metaObj?.bike_hint?.model ?? null,
        },
        tune: base, // store original tune payload
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

  // ---------- Build "what changed" rows (Tune Two only) ----------
  const changedRows: ChangedRow[] = useMemo(() => {
    if (!isTuneTwo || !previousTune) return [];

    const rows: ChangedRow[] = [];

    const pushIfChangedClicks = (
      id: string,
      label: string,
      prevVal: number,
      nextVal: number
    ) => {
      if (!Number.isFinite(prevVal) || !Number.isFinite(nextVal)) return;
      const delta = nextVal - prevVal;
      if (Math.abs(delta) < 1) return; // ignore tiny one-click noise

      rows.push({
        id,
        label,
        from: `${num(prevVal)} clicks`,
        to: `${num(nextVal)} clicks`,
        deltaLabel:
          (delta > 0 ? "+" : "") + `${delta.toFixed(0)} clicks`,
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
        deltaLabel:
          (delta > 0 ? "+" : "") + `${delta.toFixed(2)} turns`,
        direction: delta > 0 ? "up" : "down",
      });
    };

    const pushIfChangedAir = (
      id: string,
      label: string,
      prevVal?: number,
      nextVal?: number
    ) => {
      if (
        !Number.isFinite(Number(prevVal)) ||
        !Number.isFinite(Number(nextVal))
      )
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
        deltaLabel:
          (delta > 0 ? "+" : "") + `${delta.toFixed(2)} bar`,
        direction: delta > 0 ? "up" : "down",
      });
    };

    // Clicker changes
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

    // Air changes (this is the bit you asked for)
    if (wantsAir) {
      pushIfChangedAir("fork_air", "Fork air (AER)", prevAirBar, airBar);
    }

    return rows;
  }, [isTuneTwo, previousTune, result, wantsAir, airBar, prevAirBar]);

  // 🔵 Title: drop the “(Tune Two)” — just “Refined Setup”
  const headerTitle = isTuneTwo
    ? "Refined Setup"
    : "Your Suggested Setup";

  const headerSubtitle = bikeTitle;

  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
      {/* Safe-area spacer so the header never clashes with the notch */}
      <View style={[S.topSafeSpacer, { height: insets.top }]} />

      {/* Solid accent header */}
      <View style={S.headerSolid}>
        <Text style={S.title}>{headerTitle}</Text>
        <Text style={S.subtitle}>{headerSubtitle}</Text>

        <View style={S.chipsRow}>
          {headerChips.map((c) => (
            <View key={c} style={S.chip}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={S.chipText}>
                {c}
              </Text>
            </View>
          ))}
        </View>

        <Text style={S.zeroText}>
          Zero-based: turn each clicker gently all the way IN (clockwise,
          toward the "+" on the cap) until it lightly stops, then count clicks
          OUT from there.
        </Text>

        {/* Mode chips */}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          {(["balanced", "comfort", "precision"] as Mode[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={[S.modePill, mode === m && S.modePillOn]}
            >
              <Text style={[S.modePillText, mode === m && S.modePillTextOn]}>
                {cap(m)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* What changed (Tune Two only) */}
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

        {/* Fork */}
        <View style={[S.card, S.lift]}>
          <Text style={S.h1}>Fork</Text>
          <Metric
            C={C}
            S={S}
            label="Compression"
            value={`${num(result.fork.comp_clicks)} clicks`}
            hint="Clicks out from zero"
          />
          <Bar C={C} value={num(result.fork.comp_clicks)} max={30} />
          <Metric
            C={C}
            S={S}
            label="Rebound"
            value={`${num(result.fork.reb_clicks)} clicks`}
            hint="Clicks out from zero"
          />
          <Bar C={C} value={num(result.fork.reb_clicks)} max={30} />
          {typeof airBar === "number" && (
            <>
              <Metric
                C={C}
                S={S}
                label="Air (AER)"
                value={`${airBar.toFixed(2)} bar`}
                hint="WP AER fork pressure"
              />
              <Bar C={C} value={airBar} max={14} />
            </>
          )}
        </View>

        {/* Shock */}
        <View style={[S.card, S.lift]}>
          <Text style={S.h1}>Shock</Text>
          <Metric
            C={C}
            S={S}
            label="Low-Speed Comp"
            value={`${num(result.shock.lsc_clicks)} clicks`}
          />
          <Bar C={C} value={num(result.shock.lsc_clicks)} max={30} />
          <Metric
            C={C}
            S={S}
            label="High-Speed Comp"
            value={`${num(result.shock.hsc_turns, 0).toFixed(1)} turns`}
          />
          <Bar C={C} value={num(result.shock.hsc_turns, 0)} max={3} />
          <Metric
            C={C}
            S={S}
            label="Rebound"
            value={`${num(result.shock.reb_clicks)} clicks`}
          />
          <Bar C={C} value={num(result.shock.reb_clicks)} max={30} />
          <Metric
            C={C}
            S={S}
            label="Sag"
            value={`${num(result.shock.sag_mm)} mm`}
          />
          <Bar
            C={C}
            value={num(result.shock.sag_mm)}
            max={120}
            goodMin={100}
            goodMax={108}
          />
        </View>

        {/* Notes/Test plan */}
        {base?.notes?.length ? (
          <View style={S.card}>
            <Text style={S.h1}>{isTuneTwo ? "Refined test plan" : "Test Plan"}</Text>
            <View style={{ marginTop: 4 }}>
              {base.notes.map((n, i) => (
                <View key={`${i}-${n}`} style={S.stepRow}>
                  <View style={S.stepBadge}>
                    <Text style={S.stepBadgeText}>{i + 1}</Text>
                  </View>
                  <Text style={S.stepText}>{n}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Ride & refine (Tune Two) – only show on baseline */}
        {!isTuneTwo && (
          <View style={S.card}>
            <View style={S.rowBetweenAlign}>
              <Text style={S.h1}>Ride & refine (optional)</Text>
              <View style={S.tunePill}>
                <Text style={S.tunePillText}>Tune Two</Text>
              </View>
            </View>
            <Text style={S.body}>
              1. Set these numbers on your bike.{"\n"}
              2. Ride 5–10 minutes on today&apos;s terrain.{"\n"}
              3. Come back and we&apos;ll use your feedback for a second-pass
              pro adjustment.
            </Text>
            <View style={{ height: 6 }} />
            <Text style={S.bodySmall}>
              We&apos;ll only move things a few clicks / 0.1–0.2 bar at a time.
              You&apos;ll rate this setup and flag issues like harshness, kicks,
              or bottoming, and we&apos;ll build a refined tune on top of this
              baseline.
            </Text>

            <Pressable
              onPress={goToFeedback}
              style={[S.btnPrimary, { marginTop: 14 }]}
            >
              <Text style={S.btnPrimaryText}>
                Refine this tune after my ride
              </Text>
            </Pressable>
          </View>
        )}

        {/* Save + back buttons */}
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          {!canSave ? (
            <View style={S.helperBox}>
              <Ionicons
                name="alert-circle"
                size={16}
                color={C.WARN ?? "#FFC36A"}
              />
              <Text style={S.helperText}>
                Select or add a bike in your Garage to enable{" "}
                {isTuneTwo ? "“Save refined setup”." : "“Save baseline”."}
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={onSaveBaseline}
            style={[
              S.btnPrimary,
              (!canSave || savingBaseline) && S.btnDisabled,
            ]}
            disabled={!canSave || savingBaseline}
          >
            {savingBaseline ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={S.btnPrimaryText}>
                {isTuneTwo ? "Save refined setup" : "Save baseline"}
              </Text>
            )}
          </Pressable>

          <View style={{ height: 10 }} />
          <Pressable
            onPress={() => router.replace("/(tabs)/tune")}
            style={S.btnGhost}
          >
            <Text style={S.btnGhostText}>Back</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Naming Modal (kept for future refined tunes) */}
      <Modal
        visible={showNameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNameModal(false)}
      >
        <View style={S.modalWrap}>
          <Pressable
            style={S.backdrop}
            onPress={() => setShowNameModal(false)}
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
              onSubmitEditing={confirmSavePreset}
            />
            <View style={S.row}>
              <Pressable
                style={[S.modalBtnGhost, { flex: 1 }]}
                onPress={() => setShowNameModal(false)}
              >
                <Text style={S.modalBtnGhostText}>Cancel</Text>
              </Pressable>
              <View style={{ width: 8 }} />
              <Pressable
                style={[S.modalBtnPrimary, { flex: 1 }]}
                onPress={confirmSavePreset}
                disabled={savingPreset}
              >
                {savingPreset ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={S.modalBtnPrimaryText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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

// 🔻 UPDATED: scale air pressure using rider weight around the AI baseline
function deriveAirBar(res: ZeroTuneResult, rider?: number) {
  // Use AI-supplied pressure as the ~185 lb baseline if present
  const aiBaseline =
    typeof res.fork.air_pressure_bar === "number"
      ? res.fork.air_pressure_bar
      : 10.6; // fallback baseline at ~185 lb

  // If we don't know rider weight, just show the AI value (or fallback)
  if (!Number.isFinite(Number(rider))) {
    return clamp(Number(aiBaseline.toFixed(2)), 7, 14);
  }

  const w = Number(rider);

  // Scale around ~185 lb: about 0.2 bar per 10 lb
  const est = aiBaseline + 0.2 * ((w - 185) / 10);

  return clamp(Number(est.toFixed(2)), 7, 14);
}

/* Build rider-specific key areas for Tune Two */
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

  // Fallback / fill
  [SMALL_CHOP, BIG_HITS].forEach(pushUnique);

  return areas.slice(0, 2);
}

/* small presentational pieces (theme-aware) */
function Metric({
  label,
  value,
  hint,
  C,
  S,
}: {
  label: string;
  value: string;
  hint?: string;
  C: any;
  S: any;
}) {
  return (
    <View style={S.rowBetween}>
      <View style={{ flexShrink: 1 }}>
        <Text style={S.metricLabel}>{label}</Text>
        {hint ? <Text style={S.metricHint}>{hint}</Text> : null}
      </View>
      <Text style={S.metricValue}>{value}</Text>
    </View>
  );
}

function Bar({
  value,
  max,
  goodMin,
  goodMax,
  C,
}: {
  value: number;
  max: number;
  goodMin?: number;
  goodMax?: number;
  C: any;
}) {
  const pct = Math.max(0, Math.min(1, value / max));
  const inGood =
    goodMin != null && goodMax != null && value >= goodMin && value <= goodMax;
  return (
    <View
      style={{
        height: 8,
        backgroundColor: C.INK,
        borderRadius: 999,
        overflow: "hidden",
        marginTop: 6,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: C.BORDER,
        position: "relative",
      }}
    >
      <View
        style={{
          height: "100%",
          width: `${pct * 100}%`,
          backgroundColor: inGood ? (C.SUCCESS ?? "#22c55e") : C.ACCENT,
        }}
      />
      {goodMin != null && goodMax != null ? (
        <View
          style={{
            position: "absolute",
            top: -1,
            bottom: -1,
            left: `${(goodMin / max) * 100}%`,
            right: `${(1 - goodMax / max) * 100}%`,
            borderRadius: 999,
            backgroundColor: (C.SUCCESS ?? "#22c55e") + "2E",
            borderWidth: 1,
            borderColor: (C.SUCCESS ?? "#22c55e") + "59",
          }}
        />
      ) : null}
    </View>
  );
}

/* styles */
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

    topSafeSpacer: {
      backgroundColor: C.BG,
    },

    headerSolid: {
      backgroundColor: C.ACCENT,
      paddingTop: 18,
      paddingBottom: 18,
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
    title: {
      color: "#fff",
      fontSize: 22,
      lineHeight: 26,
      fontWeight: "900",
      letterSpacing: -0.2,
    },
    subtitle: {
      color: "rgba(255,255,255,0.9)",
      marginTop: 4,
      fontSize: 14,
      lineHeight: 18,
    },

    chipsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 10,
    },
    chip: {
      backgroundColor: "rgba(0,0,0,0.18)",
      borderColor: "rgba(255,255,255,0.2)",
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      maxWidth: 220,
    },
    chipText: { color: "#fff", fontWeight: "700", fontSize: 12 },

    zeroText: {
      color: "rgba(255,255,255,0.92)",
      marginTop: 10,
      fontSize: 13,
      lineHeight: 17,
    },

    modePill: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.28)",
      backgroundColor: "rgba(0,0,0,0.15)",
    },
    modePillOn: {
      borderColor: "#fff",
      backgroundColor: "rgba(0,0,0,0.28)",
    },
    modePillText: {
      color: "rgba(255,255,255,0.9)",
      fontWeight: "800",
      fontSize: 12,
    },
    modePillTextOn: { color: "#fff" },

    card: {
      backgroundColor: C.CARD,
      borderWidth: 1,
      borderColor: C.BORDER,
      borderRadius: 14,
      padding: 14,
      marginHorizontal: 16,
      marginTop: 12,
    },
    lift: {
      shadowColor: C.ACCENT_2 ?? C.ACCENT,
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
      elevation: 5,
    },
    h1: { fontSize: 15, fontWeight: "900", color: C.TEXT, marginBottom: 8 },

    stepRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingVertical: 6,
    },
    stepBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: (C.ACCENT_2 ?? C.ACCENT) + "2E",
      borderWidth: 1,
      borderColor: (C.ACCENT_2 ?? C.ACCENT) + "73",
      marginRight: 8,
      marginTop: 1,
    },
    stepBadgeText: {
      color: "#EAF2FF",
      fontWeight: "900",
      fontSize: 12,
      lineHeight: 12,
    },
    stepText: { color: C.TEXT, flex: 1, lineHeight: 20 },

    metricLabel: { color: "#DDE2F2", fontWeight: "800" },
    metricHint: { color: C.MUTED, fontSize: 12, marginTop: 2 },
    metricValue: {
      color: "#fff",
      fontWeight: "900",
      marginLeft: 8,
      minWidth: 80,
      textAlign: "right",
    },
    rowBetween: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 4,
    },
    rowBetweenAlign: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 6,
    },

    body: {
      color: C.TEXT,
      fontSize: 13,
      lineHeight: 18,
    },
    bodySmall: {
      color: C.MUTED,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 2,
    },

    tunePill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: "rgba(0,0,0,0.18)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.2)",
    },
    tunePillText: {
      color: "#fff",
      fontWeight: "800",
      fontSize: 12,
    },

    btnPrimary: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: "center",
      justifyContent: "center",
    },
    btnDisabled: { opacity: 0.5 },
    btnPrimaryText: { color: "#fff", fontWeight: "900" },
    btnGhost: {
      borderColor: "rgba(255,255,255,0.25)",
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    },
    btnGhostText: { color: "#E6E9F2", fontWeight: "800" },

    helperBox: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: (C.WARN ?? "#FFC36A") + "66",
      backgroundColor: (C.WARN ?? "#FFC36A") + "1F",
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginBottom: 8,
    },
    helperText: {
      color: C.WARN ?? "#FFD9A8",
      fontWeight: "700",
      flex: 1,
    },

    // change list
    changeRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 6,
    },
    changeLabel: {
      color: C.TEXT,
      fontWeight: "800",
      marginBottom: 2,
    },
    changeSub: {
      color: C.MUTED,
      fontSize: 12,
    },
    changeIconWrap: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: (C.ACCENT_2 ?? C.ACCENT),
      marginLeft: 8,
    },

    // Modal styles
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
    modalTitle: {
      color: C.TEXT,
      fontSize: 16,
      fontWeight: "900",
      marginBottom: 10,
    },

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
