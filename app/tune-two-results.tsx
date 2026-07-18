// app/tune-two-results.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chip } from "../components/Chip";
import { SettingRow } from "../components/SettingRow";
import { useShareSetup } from "../components/ShareSetupCard";
import { useToast } from "../components/Toast";
import { createBaselineVersion } from "../lib/setupVersions";
import { ZeroTuneResult } from "../lib/ai";
import { normalizeBikeStrings, resolveModelId } from "../lib/bikes";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import {
  classifyTuneNotes,
  NOTE_HINTS,
  reasonFromNotes,
} from "../lib/tuneNotes";
import { asUuidOrNull } from "../lib/uuid";

/* ---------------- Free / Pro limits ---------------- */
const FREE_BASELINE_LIMIT = 10;

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

type Mode = "balanced" | "comfort" | "precision";

// Diff-row id → engine-note circuit hints (shared with setup-history).
const DIFF_HINTS: Record<string, readonly string[]> = {
  fork_comp: NOTE_HINTS.fork_comp,
  fork_reb: NOTE_HINTS.fork_reb,
  air_bar: NOTE_HINTS.fork_air,
  shock_lsc: NOTE_HINTS.shock_lsc,
  shock_hsc: NOTE_HINTS.shock_hsc,
  shock_reb: NOTE_HINTS.shock_reb,
  shock_sag: NOTE_HINTS.sag,
};

export default function TuneTwoResultScreen() {
  const { r, previous, meta } = useLocalSearchParams<{
    r?: string;
    previous?: string;
    meta?: string;
  }>();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);

  // Refined result (Tune Two)
  const refined: ZeroTuneResult | null = useMemo(() => {
    try {
      return r ? (JSON.parse(decodeURIComponent(r)) as ZeroTuneResult) : null;
    } catch {
      return null;
    }
  }, [r]);

  // Previous (Tune One) result
  const prev: ZeroTuneResult | null = useMemo(() => {
    try {
      return previous
        ? (JSON.parse(decodeURIComponent(previous)) as ZeroTuneResult)
        : null;
    } catch {
      return null;
    }
  }, [previous]);

  const metaObj: FeedbackMeta & {
    context?: any;
    bike?: any;
    bike_hint?: any;
  } = useMemo(() => {
    try {
      return meta
        ? (JSON.parse(decodeURIComponent(meta)) as FeedbackMeta & {
            context?: any;
            bike?: any;
            bike_hint?: any;
          })
        : {};
    } catch {
      return {};
    }
  }, [meta]);

  // Try to pull bikeId (same shapes as tune-results). Legacy/guest local ids
  // are not uuids — sanitize to null so the sessions insert can't crash and
  // the UI honestly says "pick a bike" instead.
  const bikeId: string | null = useMemo(() => {
    const m: any = metaObj;
    return asUuidOrNull(
      m?.bike?.selectedBikeId ?? m?.bike?.id ?? m?.bike_id ?? null
    );
  }, [metaObj]);

  // Monetization: Pro flag (Supabase-only)
  const [isPro, setIsPro] = useState(false);

  // Share card: latest version number for this bike (the refinement that was
  // just created by the feedback screen's shadow write). Fail-soft.
  const { shareView, share } = useShareSetup();
  const [latestVersionNumber, setLatestVersionNumber] = useState<number | null>(null);

  useEffect(() => {
    if (!bikeId) return;
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("setup_versions")
          .select("version_number")
          .eq("bike_id", bikeId)
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (mounted && typeof data?.version_number === "number") {
          setLatestVersionNumber(data.version_number);
        }
      } catch {
        // no version chip on the share card, nothing else breaks
      }
    })();
    return () => { mounted = false; };
  }, [bikeId]);

  const onShare = () => {
    if (!refined) return;
    // 0 clicks is a legitimate value — only non-finite becomes null.
    const shareVal = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    void share(
      {
        bikeTitle,
        versionNumber: latestVersionNumber,
        date: new Date().toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        values: {
          forkComp: shareVal(refined.fork.comp_clicks),
          forkReb: shareVal(refined.fork.reb_clicks),
          shockLsc: shareVal(refined.shock.lsc_clicks),
          shockHsc: shareVal(refined.shock.hsc_turns),
          shockReb: shareVal(refined.shock.reb_clicks),
          sag: shareVal(refined.shock.sag_mm),
        },
      },
      "results"
    );
  };

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

          if (profErr || !prof) {
            setIsPro(false);
          } else {
            const hasServerPro =
              !!prof.is_pro ||
              (!!prof.pro_until &&
                new Date(prof.pro_until).getTime() > Date.now());
            setIsPro(hasServerPro);
          }
        } catch (e) {
          console.warn("TuneTwoResults: profiles select threw", e);
          setIsPro(false);
        }
      } catch (e) {
        console.warn("TuneTwoResults: init failed", e);
        setIsPro(false);
      }
    })();
  }, []);

  // If we somehow land here without a refined result, bounce back
  useEffect(() => {
    if (!refined) {
      const t = setTimeout(() => router.replace("/(tabs)/tune"), 10);
      return () => clearTimeout(t);
    }
  }, [refined, router]);

  if (!refined) {
    return (
      <View style={S.emptyWrap}>
        <Text style={S.emptyText}>No refined tune to display.</Text>
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

  // Mode comes from FeedbackMeta (how they ran Tune One)
  const mode: Mode =
    (metaObj.mode?.toLowerCase() as Mode) || ("balanced" as Mode);

  // Terrain / track / bike title
  const terrainRaw = metaObj.terrainRaw ?? metaObj.surface ?? undefined;
  const trackName = (metaObj as any)?.context?.track ?? null;
  const terrainVal = terrainRaw ? String(terrainRaw) : undefined;

  const bikeTitle = metaObj.bikeTitle || "Custom Bike";

  // Rider weight / wants-air pulled from context if present
  const riderWeight: number | undefined =
    typeof (metaObj as any)?.context?.rider_weight_lbs === "number"
      ? (metaObj as any).context.rider_weight_lbs
      : undefined;

  // infer AER
  const wantsAir: boolean =
    !!(metaObj as any)?.context?.wants_air_fork ||
    !!refined?.detected?.has_air_fork ||
    typeof refined?.fork?.air_pressure_bar === "number";

  const airBarRefined = wantsAir ? deriveAirBar(refined, riderWeight) : undefined;
  const airBarPrev =
    wantsAir && prev ? deriveAirBar(prev, riderWeight) : undefined;

  // Header chips
  const headerChips = [
    metaObj.mode ? `Mode: ${cap(metaObj.mode)}` : null,
    terrainVal ? `Surface: ${cap(terrainVal)}` : null,
    trackName ? `Track: ${trackName}` : null,
    typeof refined.shock.sag_mm === "number"
      ? `Sag: ${num(refined.shock.sag_mm)} mm`
      : null,
    typeof airBarRefined === "number"
      ? `AER: ${airBarRefined.toFixed(2)} bar`
      : null,
  ].filter(Boolean) as string[];

  // Build diff list vs previous
  type DiffRow = {
    id: string;
    label: string;
    from: number | null;
    to: number | null;
    unit: string;
  };

  const diffs: DiffRow[] = useMemo(() => {
    if (!prev) return [];

    const rows: DiffRow[] = [
      {
        id: "fork_comp",
        label: "Fork compression",
        from: num(prev.fork.comp_clicks, NaN),
        to: num(refined.fork.comp_clicks, NaN),
        unit: "clicks",
      },
      {
        id: "fork_reb",
        label: "Fork rebound",
        from: num(prev.fork.reb_clicks, NaN),
        to: num(refined.fork.reb_clicks, NaN),
        unit: "clicks",
      },
      {
        id: "air_bar",
        label: "Fork air (AER)",
        from: typeof airBarPrev === "number" ? airBarPrev : NaN,
        to: typeof airBarRefined === "number" ? airBarRefined : NaN,
        unit: "bar",
      },
      {
        id: "shock_lsc",
        label: "Shock low-speed comp",
        from: num(prev.shock.lsc_clicks, NaN),
        to: num(refined.shock.lsc_clicks, NaN),
        unit: "clicks",
      },
      {
        id: "shock_hsc",
        label: "Shock high-speed comp",
        from: num(prev.shock.hsc_turns, NaN),
        to: num(refined.shock.hsc_turns, NaN),
        unit: "turns",
      },
      {
        id: "shock_reb",
        label: "Shock rebound",
        from: num(prev.shock.reb_clicks, NaN),
        to: num(refined.shock.reb_clicks, NaN),
        unit: "clicks",
      },
      {
        id: "shock_sag",
        label: "Rear sag",
        from: num(prev.shock.sag_mm, NaN),
        to: num(refined.shock.sag_mm, NaN),
        unit: "mm",
      },
    ];

    return rows.filter((row) => {
      if (!Number.isFinite(row.from!) || !Number.isFinite(row.to!)) {
        return false;
      }
      const delta = row.to! - row.from!;
      const absDelta = Math.abs(delta);

      if (row.unit === "bar") return absDelta >= 0.05;
      if (row.unit === "turns") return absDelta >= 0.05;
      if (row.unit === "mm") return absDelta >= 1;
      return absDelta >= 1;
    });
  }, [prev, refined, airBarPrev, airBarRefined]);

  // Classified engine notes for the "Why these changes" section, plus mined
  // per-circuit reasons for the diff rows. Presentation only.
  const classified = useMemo(() => classifyTuneNotes(refined?.notes), [refined]);
  const diffReasons = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const [id, hints] of Object.entries(DIFF_HINTS)) {
      map[id] = reasonFromNotes(refined?.notes, hints);
    }
    return map;
  }, [refined]);

  const [savingBaseline, setSavingBaseline] = useState(false);
  const canSaveBaseline = !!bikeId;

  // Custom-bike rescue: no garage bikeId, but the tune context knows the
  // bike's make/model — offer to add it to the garage and save against it,
  // instead of stranding the rider at a dead helper message.
  const bikeInfo = useMemo(() => {
    const m: any = metaObj;
    const candidates = [m?.bike, m?.bike_hint, m?.context];
    for (const c of candidates) {
      if (c?.make && c?.model) {
        const year = Number(c.year);
        return {
          make: String(c.make).trim(),
          model: String(c.model).trim(),
          year: Number.isFinite(year) ? year : null,
        };
      }
    }
    return null;
  }, [metaObj]);

  const onAddBikeAndSave = async () => {
    if (!bikeInfo || savingBaseline) return;
    try {
      setSavingBaseline(true);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user?.id) {
        router.push("/login");
        return;
      }

      // Reuse an existing garage bike with the same make/model/year before
      // inserting — repeat saves must not duplicate.
      const { data: existing } = await supabase
        .from("bikes")
        .select("id, make, model, year")
        .eq("user_id", auth.user.id);
      const match = (existing ?? []).find(
        (b: any) =>
          String(b.make ?? "").trim().toLowerCase() ===
            bikeInfo.make.toLowerCase() &&
          String(b.model ?? "").trim().toLowerCase() ===
            bikeInfo.model.toLowerCase() &&
          (b.year ?? null) === bikeInfo.year
      );

      let newBikeId: string;
      if (match) {
        newBikeId = match.id;
      } else {
        const { make: canonMake, model: canonModel } = normalizeBikeStrings(
          bikeInfo.make,
          bikeInfo.model
        );
        const model_id = await resolveModelId(
          canonMake,
          canonModel,
          bikeInfo.year
        );
        const { data: inserted, error: insertErr } = await supabase
          .from("bikes")
          .insert({
            user_id: auth.user.id,
            make: canonMake,
            model: canonModel,
            year: bikeInfo.year,
            model_id,
          })
          .select("id")
          .single();
        if (insertErr || !inserted?.id) {
          throw insertErr ?? new Error("Couldn't add the bike");
        }
        newBikeId = inserted.id;
      }

      // Start the bike's version chain with this refined setup so Bike Home /
      // history / check-in have something to key on. Shadow write — a failure
      // here must not block the save itself.
      try {
        const ctx: any = (metaObj as any).context ?? {};
        await createBaselineVersion({
          bikeId: newBikeId,
          tune: refined,
          terrain: Array.isArray(ctx.terrain)
            ? ctx.terrain[0] ?? null
            : ctx.terrain ?? null,
          context: ctx,
        });
      } catch (shadowErr) {
        console.warn("custom-bike version shadow write failed", shadowErr);
      }

      await doSave(auth.user.id, newBikeId);
    } catch (e: any) {
      toast.show(e?.message ?? "Save failed", { kind: "error" });
    } finally {
      setSavingBaseline(false);
    }
  };

  const onSaveBaseline = async () => {
    if (!canSaveBaseline) {
      toast.show(
        "Pick a bike first (Garage -> select bike), then save your refined setup.",
        { kind: "error" }
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
      await doSave(auth.user.id, bikeId as string);
    } catch (e: any) {
      toast.show(e?.message ?? "Save failed", { kind: "error" });
    } finally {
      setSavingBaseline(false);
    }
  };

  // Shared save body: free-plan cap check + sessions insert. Callers own the
  // savingBaseline flag and error toasts.
  const doSave = async (userId: string, saveBikeId: string) => {
    {
      // Free plan: enforce saved-setup cap
      if (!isPro) {
        const { count, error: countErr } = await supabase
          .from("sessions")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId);

        if (countErr) throw countErr;

        if ((count ?? 0) >= FREE_BASELINE_LIMIT) {
          toast.show(
            `Free plan: up to ${FREE_BASELINE_LIMIT} saved setups. Unlock Pro for unlimited history.`,
            { kind: "info" }
          );
          router.push("/premium");
          return;
        }
      }

      const ctx: any = (metaObj as any).context ?? {};
      const terrain = Array.isArray(ctx.terrain)
        ? ctx.terrain[0] ?? null
        : ctx.terrain ?? null;

      const insert = {
        user_id: userId,
        bike_id: saveBikeId,
        rode_on: new Date().toISOString().slice(0, 10),
        surface: terrain,
        track: ctx.track ?? null,
        temp_f: ctx.temp_f ?? null,
        elev_ft: ctx.elev_ft ?? null,
        fork_comp: num(refined.fork.comp_clicks),
        fork_reb: num(refined.fork.reb_clicks),
        shock_comp: num(refined.shock.lsc_clicks),
        shock_reb: num(refined.shock.reb_clicks),
        sag_mm: num(refined.shock.sag_mm),
        notes: [
          "Refined tune from Dialed Offroad AI",
          metaObj.mode ? `Mode: ${cap(metaObj.mode)}` : null,
          terrain ? `Surface: ${cap(terrain)}` : null,
          typeof airBarRefined === "number"
            ? `AER: ${airBarRefined.toFixed(2)} bar`
            : null,
        ]
          .filter(Boolean)
          .join(" — "),
      };

      const { error } = await supabase.from("sessions").insert(insert);
      if (error) throw error;
      toast.show("Refined setup saved", { kind: "success" });
      // The natural end of the loop teaches its new beginning: land on the
      // bike's home page, where the saved setup now lives.
      router.replace({
        pathname: "/bike-home",
        params: { bikeId: saveBikeId },
      } as any);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
      {/* Safe-area spacer */}
      <View style={{ height: insets.top, backgroundColor: C.BG }} />

      {/* Compact header */}
      <View style={S.compactHeader}>
        <Pressable
          onPress={() => router.replace("/(tabs)/tune")}
          hitSlop={8}
          style={S.headerIconBtn}
        >
          <Ionicons name="chevron-back-outline" size={24} color={C.TEXT} />
        </Pressable>
        <Text style={S.compactHeaderTitle}>Refined Setup</Text>
        <Pressable onPress={onShare} hitSlop={8} style={S.headerIconBtn}>
          <Ionicons name="share-outline" size={21} color={C.TEXT} />
        </Pressable>
      </View>

      {shareView}

      {/* Subtitle + chips (below compact header, above scroll) */}
      <View style={S.subHeader}>
        <Text style={S.subHeaderBike}>{bikeTitle}</Text>
        {headerChips.length > 0 ? (
          <View style={S.chipsRow}>
            {headerChips.map((c) => (
              <Chip key={c} label={c} />
            ))}
          </View>
        ) : null}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
      >
        {/* What changed */}
        <View style={[S.card, S.lift]}>
          <Text style={S.h1}>What changed from last time</Text>
          {diffs.length === 0 ? (
            <Text style={S.bodySmall}>
              No meaningful changes were needed. Ride this setup again and only
              adjust if something still feels off.
            </Text>
          ) : (
            diffs.map((d) => {
              const delta = (d.to ?? 0) - (d.from ?? 0);
              const isUp = delta > 0;
              const deltaStr = `${isUp ? "+" : ""}${
                d.unit === "clicks" || d.unit === "mm"
                  ? Math.round(delta)
                  : delta.toFixed(d.unit === "turns" ? 1 : 2)
              }`;
              return (
                <View key={d.id} style={S.diffRow}>
                  <View style={S.diffTopRow}>
                    <Text style={S.diffLabel} numberOfLines={1}>
                      {d.label}
                    </Text>
                    <Text style={S.diffValues}>
                      {fmtDiff(d.from, d.unit)} {"→"} {fmtDiff(d.to, d.unit)}
                    </Text>
                    <View
                      style={[
                        S.deltaBadge,
                        isUp ? S.deltaBadgeUp : S.deltaBadgeDown,
                      ]}
                    >
                      <Text
                        style={[
                          S.deltaBadgeText,
                          isUp ? S.deltaBadgeTextUp : S.deltaBadgeTextDown,
                        ]}
                      >
                        {deltaStr}
                      </Text>
                    </View>
                  </View>
                  {diffReasons[d.id] ? (
                    <Text style={S.diffReason}>{diffReasons[d.id]}</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        {/* Fork */}
        <View style={[S.card, S.lift]}>
          <Text style={S.h1}>Fork</Text>
          <SettingRow
            icon="settings-outline"
            label="Compression"
            hint="Clicks out from zero"
            value={`${num(refined.fork.comp_clicks)}`}
            unit="clicks"
          />
          <SettingRow
            icon="refresh-outline"
            label="Rebound"
            hint="Clicks out from zero"
            value={`${num(refined.fork.reb_clicks)}`}
            unit="clicks"
          />
          {typeof airBarRefined === "number" && (
            <SettingRow
              icon="water-outline"
              label="Air (AER)"
              hint="WP AER fork pressure"
              value={airBarRefined.toFixed(2)}
              unit="bar"
            />
          )}
        </View>

        {/* Shock */}
        <View style={[S.card, S.lift]}>
          <Text style={S.h1}>Shock</Text>
          <SettingRow
            icon="settings-outline"
            label="Low-Speed Comp"
            hint="Clicks out from zero"
            value={`${num(refined.shock.lsc_clicks)}`}
            unit="clicks"
          />
          <SettingRow
            icon="flash-outline"
            label="High-Speed Comp"
            hint="Turns out from zero"
            value={num(refined.shock.hsc_turns, 0).toFixed(1)}
            unit="turns"
          />
          <SettingRow
            icon="refresh-outline"
            label="Rebound"
            hint="Clicks out from zero"
            value={`${num(refined.shock.reb_clicks)}`}
            unit="clicks"
          />
          <SettingRow
            icon="resize-outline"
            label="Sag"
            hint="Static sag target"
            value={`${num(refined.shock.sag_mm)}`}
            unit="mm"
          />
        </View>

        {/* Engine notes. Echo path keeps the simple numbered rendering; real
            refinements get the classified "Why these changes" hierarchy. */}
        {refined?.notes?.length ? (
          classified.isEcho ? (
            <View style={S.card}>
              <Text style={S.h1}>Ride notes</Text>
              <View style={{ marginTop: 4 }}>
                {refined.notes.map((n, i) => (
                  <View key={`${i}-${n}`} style={S.stepRow}>
                    <View style={S.stepBadge}>
                      <Text style={S.stepBadgeText}>{i + 1}</Text>
                    </View>
                    <Text style={S.stepText}>{n}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View style={[S.card, S.notesCard]}>
              <Text style={S.h1}>Why these changes</Text>

              {classified.summaryLead ? (
                <Text style={S.noteLead}>{classified.summaryLead}</Text>
              ) : null}
              {classified.goals ? (
                <Text style={S.noteGoals}>{classified.goals}</Text>
              ) : null}

              {/* Adaptive decisions — rare and important, always first */}
              {classified.adaptive.map((n, i) => (
                <View key={`adaptive-${i}`} style={S.adaptiveCallout}>
                  <Text style={S.adaptiveText}>↩ {n}</Text>
                </View>
              ))}

              {/* Protect decisions */}
              {classified.protect.map((n, i) => (
                <View key={`protect-${i}`} style={S.protectRow}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={14}
                    color="#34D399"
                    style={{ marginTop: 1 }}
                  />
                  <Text style={S.protectText}>{n}</Text>
                </View>
              ))}

              {/* Conflict resolutions — expertise, not an error */}
              {classified.conflict.map((n, i) => (
                <View key={`conflict-${i}`} style={S.labeledRow}>
                  <Text style={S.microLabel}>JUDGMENT CALL</Text>
                  <Text style={S.labeledText}>{n}</Text>
                </View>
              ))}

              {/* Free-text parse additions */}
              {classified.parse.map((n, i) => (
                <View key={`parse-${i}`} style={S.labeledRow}>
                  <Text style={S.microLabel}>FROM YOUR NOTE</Text>
                  <Text style={S.labeledText}>{n}</Text>
                </View>
              ))}

              {/* Routine per-symptom notes — muted, action part brighter */}
              {classified.routine.length ? (
                <View style={{ marginTop: 6 }}>
                  {classified.routine.map((n, i) => (
                    <RoutineNote key={`routine-${i}`} text={n} S={S} />
                  ))}
                </View>
              ) : null}

              {classified.retest ? (
                <Text style={S.noteFooter}>{classified.retest}</Text>
              ) : null}
            </View>
          )
        ) : null}

        {/* Save + back */}
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          {!canSaveBaseline && !bikeInfo ? (
            <View style={S.helperBox}>
              <Ionicons
                name="alert-circle"
                size={16}
                color={(C as any).WARN ?? "#FFC36A"}
              />
              <Text style={S.helperText}>
                Select or add a bike in your Garage to enable "Save refined
                setup".
              </Text>
            </View>
          ) : null}

          {!canSaveBaseline && bikeInfo ? (
            /* Custom-bike rescue: create the garage bike inline and save
               against it — the refine loop must not dead-end here. */
            <View style={S.addBikeBox}>
              <Text style={S.addBikeText}>
                Add{" "}
                {[bikeInfo.year, bikeInfo.make, bikeInfo.model]
                  .filter(Boolean)
                  .join(" ")}{" "}
                to your garage and save?
              </Text>
              <Pressable
                onPress={onAddBikeAndSave}
                style={[S.btnPrimary, savingBaseline && S.btnDisabled]}
                disabled={savingBaseline}
              >
                {savingBaseline ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={S.btnPrimaryText}>Add to garage & save</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={onSaveBaseline}
              style={[
                S.btnPrimary,
                (!canSaveBaseline || savingBaseline) && S.btnDisabled,
              ]}
              disabled={!canSaveBaseline || savingBaseline}
            >
              {savingBaseline ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={S.btnPrimaryText}>Save refined setup</Text>
              )}
            </Pressable>
          )}

          <View style={{ height: 10 }} />
          <Pressable
            onPress={() => router.replace("/(tabs)/tune")}
            style={S.btnGhost}
          >
            <Text style={S.btnGhostText}>Back to Tune</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

/* Routine note: explanation muted, the arrow-and-clicks action brighter. */
function RoutineNote({ text, S }: { text: string; S: any }) {
  const arrow = text.indexOf("→");
  if (arrow <= 0) {
    return <Text style={S.routineText}>{text}</Text>;
  }
  return (
    <Text style={S.routineText}>
      {text.slice(0, arrow).trim()}{" "}
      <Text style={S.routineAction}>→ {text.slice(arrow + 1).trim()}</Text>
    </Text>
  );
}

/* utils */
function fmtDiff(v: unknown, unit: string): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  if (unit === "bar") return n.toFixed(2);
  if (unit === "turns") return n.toFixed(1);
  return String(Math.round(n));
}

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

// Same logic as tune-results
function deriveAirBar(res: ZeroTuneResult, rider?: number) {
  const aiBaseline =
    typeof res.fork.air_pressure_bar === "number"
      ? res.fork.air_pressure_bar
      : 10.6;

  if (!Number.isFinite(Number(rider))) {
    return clamp(Number(aiBaseline.toFixed(2)), 7, 14);
  }

  const w = Number(rider);
  const est = aiBaseline + 0.2 * ((w - 185) / 10);
  return clamp(Number(est.toFixed(2)), 7, 14);
}

/* styles */
const makeStyles = (C: any) =>
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

    // ── Sub-header (bike + chips) ───────────────────────────────────
    subHeader: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 6,
      backgroundColor: C.BG,
    },
    subHeaderBike: {
      color: C.MUTED,
      fontSize: 13,
      fontWeight: "600",
    },
    chipsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 8,
    },

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
    h1: {
      fontSize: 15,
      fontWeight: "900",
      color: C.TEXT,
      marginBottom: 8,
    },
    bodySmall: {
      color: C.MUTED,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 2,
    },

    // ── Diff card (glanceable: values dominant, reason muted below) ──
    diffRow: {
      paddingVertical: 9,
    },
    diffTopRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    diffLabel: {
      flex: 1,
      color: C.TEXT,
      fontWeight: "700",
      fontSize: 13,
    },
    diffValues: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 18,
      fontVariant: ["tabular-nums"],
    },
    deltaBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      minWidth: 34,
      alignItems: "center",
    },
    deltaBadgeUp: { backgroundColor: "rgba(29,155,240,0.16)" },
    deltaBadgeDown: { backgroundColor: "rgba(16,185,129,0.16)" },
    deltaBadgeText: {
      fontSize: 11,
      fontWeight: "800",
      fontVariant: ["tabular-nums"],
    },
    deltaBadgeTextUp: { color: C.ACCENT },
    deltaBadgeTextDown: { color: "#34D399" },
    diffReason: {
      color: C.MUTED,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 3,
    },

    // ── "Why these changes" (classified engine notes) ───────────────
    // Read trackside, often in gloves — sized for glanceability.
    notesCard: {
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    noteLead: {
      color: C.TEXT,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 4,
    },
    noteGoals: {
      color: C.MUTED,
      fontSize: 12,
      marginTop: 6,
    },
    adaptiveCallout: {
      backgroundColor: "rgba(29,155,240,0.10)",
      borderLeftWidth: 3,
      borderLeftColor: C.ACCENT,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 12,
    },
    adaptiveText: {
      color: C.ACCENT,
      fontSize: 13,
      fontWeight: "700",
      lineHeight: 19,
    },
    protectRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      backgroundColor: "#122A1E",
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 12,
    },
    protectText: {
      color: "#34D399",
      fontSize: 13,
      fontWeight: "600",
      lineHeight: 19,
      flex: 1,
    },
    labeledRow: {
      backgroundColor: C.INK,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 12,
    },
    microLabel: {
      color: C.MUTED,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1.4,
      marginBottom: 4,
    },
    labeledText: {
      color: C.TEXT,
      fontSize: 14,
      lineHeight: 20,
    },
    routineText: {
      color: C.MUTED,
      fontSize: 13,
      lineHeight: 20,
      marginTop: 8,
    },
    routineAction: {
      color: C.TEXT,
      opacity: 0.92,
      fontWeight: "600",
    },
    noteFooter: {
      color: C.MUTED,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 14,
      fontStyle: "italic",
    },

    // ── Test plan steps ─────────────────────────────────────────────
    stepRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingVertical: 6,
    },
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
    stepBadgeText: {
      color: "#EAF2FF",
      fontWeight: "900",
      fontSize: 12,
      lineHeight: 12,
    },
    stepText: { color: C.TEXT, flex: 1, lineHeight: 20 },

    // ── Buttons ─────────────────────────────────────────────────────
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
    addBikeBox: {
      borderRadius: 12,
      backgroundColor: C.CARD,
      padding: 14,
      gap: 12,
    },
    addBikeText: {
      color: C.TEXT,
      fontSize: 14,
      fontWeight: "700",
      lineHeight: 20,
    },
    helperBox: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: ((C as any).WARN ?? "#FFC36A") + "66",
      backgroundColor: ((C as any).WARN ?? "#FFC36A") + "1F",
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginBottom: 8,
    },
    helperText: {
      color: (C as any).WARN ?? "#FFD9A8",
      fontWeight: "700",
      flex: 1,
    },
  });
