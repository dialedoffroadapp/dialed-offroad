// app/tune-feedback.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    KeyboardAvoidingView,
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
import {
    generateTuneTwo,
    Tune2Context,
    Tune2Feedback,
    Tune2SymptomId,
    ZeroTuneResult,
} from "../lib/ai";
import {
    createBaselineVersion,
    createFeedback,
    createRefinementVersion,
    FeedbackEntry,
} from "../lib/setupVersions";
import { useTheme } from "../lib/theme";
import { logEvent } from "../lib/usage";
import { asUuidOrNull } from "../lib/uuid";

const SCALE_MAX = 5;

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

// meta we can pass in from tune-results (can be expanded later)
type FeedbackMeta = {
  bikeTitle?: string;
  surface?: string;
  mode?: string;
  riderGoals?: string[];
  riderIssues?: string;
  terrainRaw?: string;
};

type RouteParams = {
  meta?: string;
  previous?: string; // encoded ZeroTuneResult from Tune One
  context?: string; // encoded Tune2Context (bike + rider info)
  bikeId?: string; // optional – carried through but not required here
  versionId?: string; // setup_versions id of the tune being critiqued (if saved)
};

// Issue chips cycle: off → mild → bad → off
type IssueLevel = 0 | 1 | 2;

const LEVEL_NAMES = ["off", "mild", "bad"] as const;
const LEVEL_SUFFIX = ["", " · mild", " · bad"] as const;

// Severity on the 1–10 scale (the only conversion for chips — lib/ai.ts clamps only)
const LEVEL_SEVERITY: Record<Exclude<IssueLevel, 0>, number> = { 1: 5, 2: 9 };

const CONDITIONS = [
  "Dry / hardpack",
  "Soft / loamy",
  "Rough / blown out",
  "Mud",
  "Sand",
];

/**
 * ISSUE_CHIPS:
 * 1:1 mapping between chip and backend Tune2SymptomId. `phrase` feeds the
 * "What I'm hearing" template. headshake and general_harsh are intentionally
 * not exposed — unstable_whoops absorbs headshake's job for now.
 */
const ISSUE_CHIPS: { id: Tune2SymptomId; label: string; phrase: string }[] = [
  { id: "harsh_braking_bumps", label: "Harsh / stiff", phrase: "harshness" },
  { id: "rear_kicks_accel", label: "Rear kicks", phrase: "rear kick" },
  { id: "front_knifes", label: "Front tucks in corners", phrase: "front-end tuck" },
  { id: "bottoms_landings", label: "Bottoms out", phrase: "bottoming" },
  { id: "dead_feel", label: "Feels dead / no pop", phrase: "dead feeling" },
  { id: "unstable_whoops", label: "Unstable / headshake", phrase: "instability" },
  { id: "packs_whoops", label: "Packs down in whoops", phrase: "packing" },
  { id: "harsh_square_edge", label: "Harsh on roots / rocks", phrase: "harshness on square edges" },
];

const WHERE_OPTIONS = ["Braking", "Corners", "Whoops", "Landings"];

const PROTECT_OPTIONS = [
  "Rear traction",
  "Front planted",
  "Landings",
  "Cornering",
];

const OVERALL_LABELS: Record<number, string> = {
  1: "Rough day — we'll make real moves",
  2: "Needs work — bigger corrections",
  3: "Decent base — targeted changes",
  4: "Pretty good, small stuff to fix",
  5: "Dialed — micro adjustments only",
};

// Chip state palettes (design system: accent #1D9BF0; amber for "bad", NOT red;
// green for "working")
const AMBER_BORDER = "#F59E0B";
const AMBER_TEXT = "#FBBF24";
const AMBER_BG = "rgba(245,158,11,0.12)";
const GREEN_BORDER = "#10B981";
const GREEN_TEXT = "#34D399";
const GREEN_BG = "rgba(16,185,129,0.12)";
const ACCENT_BG = "rgba(29,155,240,0.10)";

/* ------------------------------------------------------------------ */
/* Screen                                                             */
/* ------------------------------------------------------------------ */

export default function TuneFeedbackScreen() {
  const { meta, previous, context, versionId } = useLocalSearchParams<RouteParams>();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);

  const metaObj: FeedbackMeta = useMemo(() => {
    try {
      return meta ? (JSON.parse(decodeURIComponent(meta)) as FeedbackMeta) : {};
    } catch {
      return {};
    }
  }, [meta]);

  const previousTune: ZeroTuneResult | null = useMemo(() => {
    try {
      return previous
        ? (JSON.parse(decodeURIComponent(previous)) as ZeroTuneResult)
        : null;
    } catch {
      return null;
    }
  }, [previous]);

  const ctxObj: Tune2Context | null = useMemo(() => {
    try {
      return context
        ? (JSON.parse(decodeURIComponent(context)) as Tune2Context)
        : null;
    } catch {
      return null;
    }
  }, [context]);

  const bikeTitle = metaObj.bikeTitle || "Custom Bike";
  const surface =
    metaObj.surface ||
    metaObj.terrainRaw ||
    ctxObj?.terrain ||
    "Mixed conditions";
  const mode = metaObj.mode || "Balanced";

  /* ---------------- State ---------------- */

  const [condition, setCondition] = useState<string | null>(null);
  const [overall, setOverall] = useState<number>(4);
  const [issueLevels, setIssueLevels] = useState<
    Partial<Record<Tune2SymptomId, IssueLevel>>
  >({});
  const [issueWhere, setIssueWhere] = useState<
    Partial<Record<Tune2SymptomId, string>>
  >({});
  const [protectedAreas, setProtectedAreas] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /* ---------------- Handlers ---------------- */

  const selectCondition = (c: string) => {
    setCondition((prev) => (prev === c ? null : c));
    void logEvent("conditions_selected", { condition: c });
  };

  const cycleIssue = (id: Tune2SymptomId) => {
    const next = (((issueLevels[id] ?? 0) + 1) % 3) as IssueLevel;
    setIssueLevels((prev) => ({ ...prev, [id]: next }));
    if (next === 0) {
      setIssueWhere((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    }
    void logEvent("chip_toggled", { id, level: LEVEL_NAMES[next] });
  };

  const selectWhere = (id: Tune2SymptomId, where: string) => {
    setIssueWhere((prev) => {
      const copy = { ...prev };
      if (copy[id] === where) delete copy[id];
      else copy[id] = where;
      return copy;
    });
    void logEvent("where_selected", { symptom: id, where });
  };

  const toggleProtect = (area: string) => {
    const active = protectedAreas.includes(area);
    setProtectedAreas((prev) =>
      active ? prev.filter((a) => a !== area) : [...prev, area]
    );
    void logEvent("protect_toggled", { area, active: !active });
  };

  /* ---------------- Derived ---------------- */

  const activeIssues = ISSUE_CHIPS.filter(
    (chip) => (issueLevels[chip.id] ?? 0) > 0
  );
  const issueCount = activeIssues.length;
  const heardVisible = issueCount > 0 || protectedAreas.length > 0;

  const heardShownRef = useRef(false);
  useEffect(() => {
    if (heardVisible && !heardShownRef.current) {
      heardShownRef.current = true;
      void logEvent("heard_card_shown", {});
    }
  }, [heardVisible]);

  // Pure template — no network calls, rebuilt on every input change.
  const heardText = useMemo(() => {
    const parts: string[] = [];

    const fragments = activeIssues.map((chip) => {
      const level = issueLevels[chip.id] ?? 1;
      const where = issueWhere[chip.id];
      return `${level === 2 ? "bad" : "some"} ${chip.phrase}${
        where ? ` in ${where.toLowerCase()}` : ""
      }`;
    });
    if (fragments.length) {
      parts.push(`You've got ${joinList(fragments)}.`);
    }

    if (protectedAreas.length) {
      parts.push(
        `Keeping ${joinList(
          protectedAreas.map((a) => a.toLowerCase())
        )} exactly as-is.`
      );
    }

    parts.push(
      overall >= 4
        ? "Base is close — small, targeted moves."
        : "I'll make bigger corrections this round."
    );

    return parts.join(" ");
  }, [activeIssues, issueLevels, issueWhere, protectedAreas, overall]);

  /* ---------------- Submit ---------------- */

  const onSubmit = async () => {
    if (!previousTune) {
      toast.show("No previous tune found. Generate a base tune first.", {
        kind: "error",
      });
      router.back();
      return;
    }

    try {
      setSubmitting(true);

      // Overall 1–5 → 1–10. This is the ONLY conversion in the pipeline;
      // lib/ai.ts clamps but never rescales.
      const overallRatingTen =
        overall && SCALE_MAX > 0
          ? Math.max(
              1,
              Math.min(10, Math.round((overall / SCALE_MAX) * 10))
            )
          : undefined;

      const symptoms: Tune2Feedback["symptoms"] = activeIssues.map((chip) => {
        const level = issueLevels[chip.id] as Exclude<IssueLevel, 0>;
        const where = issueWhere[chip.id];
        return {
          id: chip.id,
          severity: LEVEL_SEVERITY[level],
          ...(where ? { where } : {}),
        };
      });

      const protectedList = protectedAreas.map((area) => ({ area }));

      const feedback: Tune2Feedback = {
        overall_rating: overallRatingTen,
        ride_duration_min: undefined, // can add later if you add a field
        terrain_tags: [surface, condition].filter(Boolean) as string[],
        symptoms,
        protected: protectedList.length ? protectedList : undefined,
        free_text: notes.trim() || undefined, // engine v2 parses this server-side
      };

      // 🔵 Make sure bike id gets forwarded into Tune Two results via meta/context
      // (derived above the engine call so the lineage shadow writes can use it)
      const anyMeta: any = metaObj || {};
      const anyCtx: any = ctxObj || {};

      // Guest bikes carry local non-uuid ids ("1783553470201_…") in old meta
      // snapshots — sanitize so DB writes downstream go bikeless, never crash.
      const bikeId = asUuidOrNull(
        anyCtx.selectedBikeId ??
          anyCtx.bike_id ??
          anyMeta?.bike?.selectedBikeId ??
          anyMeta?.bike?.id ??
          anyMeta?.bike_id ??
          null
      );

      // Lineage shadow writes: persist the feedback against the critiqued
      // version BEFORE the engine runs, so rider feedback survives even if the
      // refinement call fails. Never let shadow failures break the flow.
      // ride_feedback.symptoms jsonb = issue entries + {area, protect: true}
      // entries in one flat array (see FeedbackEntry in lib/setupVersions.ts).
      let critiquedVersionId: string | null =
        typeof versionId === "string" && versionId.length > 0 ? versionId : null;
      let feedbackId: string | null = null;
      try {
        if (!critiquedVersionId) {
          // Rider is refining a tune they never saved — create the baseline
          // version on the fly so the feedback has something to point at.
          const baseline = await createBaselineVersion({
            bikeId,
            tune: previousTune,
            terrain: surface ?? null,
            context: ctxObj ?? null,
          });
          critiquedVersionId = baseline.id;
        }
        const feedbackEntries: FeedbackEntry[] = [
          ...symptoms,
          ...protectedAreas.map((area) => ({ area, protect: true as const })),
        ];
        const fb = await createFeedback({
          setupVersionId: critiquedVersionId,
          overallRating: overallRatingTen ?? null,
          symptoms: feedbackEntries,
          freeText: notes,
        });
        feedbackId = fb.id;
      } catch (shadowErr) {
        console.warn("ride_feedback shadow write failed", shadowErr);
      }

      const result = await generateTuneTwo({
        previous: previousTune,
        feedback,
        context: ctxObj ?? undefined,
        bikeId, // enables the engine's adaptive step from the last rated outcome
      });

      // Lineage shadow write: record the refinement as a child version and
      // link it back to the feedback row that produced it.
      if (critiquedVersionId) {
        try {
          await createRefinementVersion({
            bikeId,
            parentVersionId: critiquedVersionId,
            tune: result,
            terrain: surface ?? null,
            context: ctxObj ?? null,
            feedbackId,
          });
        } catch (shadowErr) {
          console.warn("setup_versions refinement shadow write failed", shadowErr);
        }
      }

      const mergedContext = {
        ...anyCtx,
        selectedBikeId: bikeId ?? anyCtx.selectedBikeId ?? null,
        bike_id: bikeId ?? anyCtx.bike_id ?? null,
      };

      const mergedMeta = {
        ...anyMeta,
        bike_id: bikeId ?? anyMeta.bike_id ?? null,
        bike: anyMeta.bike
          ? {
              ...anyMeta.bike,
              id: bikeId ?? anyMeta.bike?.id ?? null,
              selectedBikeId: bikeId ?? anyMeta.bike?.selectedBikeId ?? null,
            }
          : anyMeta.bike,
        context: {
          ...(anyMeta.context || {}),
          ...mergedContext,
        },
      };

      // 👉 Route into the Tune Two results screen
      router.replace({
        pathname: "/tune-two-results",
        params: {
          r: encodeURIComponent(JSON.stringify(result)),
          // keep the original encoded previous tune
          previous: typeof previous === "string" ? previous : "",
          // send enriched meta + context so results can find bike id
          meta: encodeURIComponent(JSON.stringify(mergedMeta)),
        },
      });
    } catch (e: any) {
      console.warn("Tune Two error", e);
      toast.show(e?.message ?? "Refined tune failed. Try again.", {
        kind: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------- Render ---------------- */

  const submitLabel =
    issueCount >= 1
      ? `Fix ${issueCount} issue${issueCount === 1 ? "" : "s"}`
      : "Refine my setup";

  // NOTE: no full-screen TouchableWithoutFeedback wrapper here. It was used
  // for tap-to-dismiss-keyboard but could win the responder race against the
  // ScrollView and intermittently eat scroll gestures. Keyboard dismissal is
  // handled by the ScrollView's keyboardDismissMode instead.
  return (
    <View style={{ flex: 1, backgroundColor: C.BG }}>
        <View style={{ height: insets.top, backgroundColor: C.ACCENT }} />

        {/* Header */}
        <View style={S.header}>
          <View style={S.headerRow}>
            <Pressable
              onPress={() => router.back()}
              style={S.backCircle}
              hitSlop={10}
            >
              <Ionicons name="chevron-back" size={20} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={S.headerTitle}>Refine Your Setup</Text>
              <Text style={S.headerSub}>{bikeTitle}</Text>
            </View>
          </View>

          <View style={S.headerChipsRow}>
            <View style={S.headerChip}>
              <Text style={S.headerChipText}>{`Surface: ${surface}`}</Text>
            </View>
            <View style={S.headerChip}>
              <Text style={S.headerChipText}>{`Mode: ${mode}`}</Text>
            </View>
          </View>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          >
            {/* Conditions */}
            <View style={S.section}>
              <Text style={S.sectionTitle}>Conditions today</Text>
              <View style={S.pillRow}>
                {CONDITIONS.map((c) => {
                  const on = condition === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => selectCondition(c)}
                      style={[S.pill, on && S.pillOn]}
                    >
                      <Text style={[S.pillText, on && S.pillTextOn]}>{c}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Overall */}
            <View style={S.section}>
              <Text style={S.sectionTitle}>How did this setup feel overall?</Text>
              <RatingRow
                value={overall}
                onChange={setOverall}
                scaleMax={SCALE_MAX}
                C={C}
              />
              <Text style={S.overallLabel}>{OVERALL_LABELS[overall]}</Text>
            </View>

            {/* Issue chips (tap-twice severity) */}
            <View style={S.section}>
              <Text style={S.sectionTitle}>What needs improvement?</Text>
              <Text style={S.sectionSub}>
                Tap once for mild, twice for bad.
              </Text>

              <View style={{ marginTop: 12 }}>
                {ISSUE_CHIPS.map((chip) => {
                  const level = issueLevels[chip.id] ?? 0;
                  const selectedWhere = issueWhere[chip.id];
                  return (
                    <View key={chip.id} style={S.issueBlock}>
                      <Pressable
                        onPress={() => cycleIssue(chip.id)}
                        style={[
                          S.issueChip,
                          level === 1 && S.issueChipMild,
                          level === 2 && S.issueChipBad,
                        ]}
                      >
                        <Text
                          style={[
                            S.issueChipText,
                            level === 1 && S.issueChipTextMild,
                            level === 2 && S.issueChipTextBad,
                          ]}
                        >
                          {chip.label}
                          {LEVEL_SUFFIX[level]}
                        </Text>
                      </Pressable>

                      {level > 0 ? (
                        <View style={S.whereRow}>
                          {WHERE_OPTIONS.map((w) => {
                            const on = selectedWhere === w;
                            return (
                              <Pressable
                                key={w}
                                onPress={() => selectWhere(chip.id, w)}
                                style={[S.wherePill, on && S.wherePillOn]}
                              >
                                <Text
                                  style={[
                                    S.wherePillText,
                                    on && S.wherePillTextOn,
                                  ]}
                                >
                                  {w}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>

            {/* What was working */}
            <View style={S.section}>
              <Text style={S.sectionTitle}>What was working?</Text>
              <Text style={S.sectionSub}>
                I won't touch what's already good.
              </Text>
              <View style={S.pillRow}>
                {PROTECT_OPTIONS.map((area) => {
                  const on = protectedAreas.includes(area);
                  return (
                    <Pressable
                      key={area}
                      onPress={() => toggleProtect(area)}
                      style={[S.pill, on && S.protectPillOn]}
                    >
                      <Text style={[S.pillText, on && S.protectPillTextOn]}>
                        {area}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Free text */}
            <View style={S.section}>
              <Text style={S.sectionTitle}>Or say it your way</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Front was sketchy into corners after the whoops..."
                placeholderTextColor={C.MUTED}
                style={S.notesInput}
                multiline
                textAlignVertical="top"
                returnKeyType="done"
                blurOnSubmit
              />
            </View>

            {/* What I'm hearing */}
            {heardVisible ? (
              <View style={S.heardCard}>
                <Text style={S.heardLabel}>WHAT I'M HEARING</Text>
                <Text style={S.heardText}>{heardText}</Text>
              </View>
            ) : null}

            {/* Buttons */}
            <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
              <Pressable
                onPress={onSubmit}
                style={[S.btnPrimary, submitting && S.btnDisabled]}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={S.btnPrimaryText}>{submitLabel}</Text>
                )}
              </Pressable>

              <View style={{ height: 10 }} />
              <Pressable onPress={() => router.back()} style={S.btnGhost}>
                <Text style={S.btnGhostText}>Back to Setup</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
    </View>
  );
}

/* ------- Rating row (1–5 bubbles) ------- */

function RatingRow({
  value,
  onChange,
  scaleMax,
  C,
}: {
  value: number;
  onChange: (v: number) => void;
  scaleMax: number;
  C: any;
}) {
  const dots = Array.from({ length: scaleMax }, (_, i) => i + 1);
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "center",
        gap: 12,
        marginTop: 14,
      }}
    >
      {dots.map((n) => {
        const on = n === value;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: on ? C.ACCENT : "transparent",
              borderWidth: 2,
              borderColor: on ? C.ACCENT : C.BORDER,
            }}
          >
            <Text
              style={{
                color: on ? "#fff" : C.TEXT,
                fontWeight: "800",
                fontSize: 16,
              }}
            >
              {n}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------- Utils ------- */

function joinList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ------- Styles ------- */

const makeStyles = (C: {
  BG: string;
  CARD: string;
  TEXT: string;
  MUTED: string;
  BORDER: string;
  ACCENT: string;
  INK: string;
}) =>
  StyleSheet.create({
    header: {
      backgroundColor: C.ACCENT,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 16,
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
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 8,
      gap: 10,
    },
    backCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "rgba(0,0,0,0.25)",
      alignItems: "center",
      justifyContent: "center",
    },
    headerTitle: {
      color: "#fff",
      fontSize: 22,
      fontWeight: "900",
      letterSpacing: -0.2,
    },
    headerSub: {
      color: "rgba(255,255,255,0.9)",
      marginTop: 2,
      fontSize: 14,
    },
    headerChipsRow: {
      flexDirection: "row",
      gap: 8,
      marginTop: 6,
      flexWrap: "wrap",
    },
    headerChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.28)",
      backgroundColor: "rgba(0,0,0,0.18)",
    },
    headerChipText: {
      color: "#fff",
      fontWeight: "700",
      fontSize: 12,
    },

    // Sections: whitespace + type hierarchy instead of stacked bordered cards
    section: {
      paddingHorizontal: 20,
      marginTop: 28,
    },
    sectionTitle: {
      color: C.TEXT,
      fontWeight: "800",
      fontSize: 17,
    },
    sectionSub: {
      color: C.MUTED,
      fontSize: 13,
      marginTop: 3,
    },

    // Generic pills (conditions / protect base state)
    pillRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 12,
    },
    pill: {
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: "transparent",
    },
    pillOn: {
      borderColor: C.ACCENT,
      backgroundColor: ACCENT_BG,
    },
    pillText: {
      color: C.TEXT,
      fontWeight: "700",
      fontSize: 13,
    },
    pillTextOn: {
      color: C.ACCENT,
    },

    overallLabel: {
      color: C.MUTED,
      fontSize: 13,
      fontWeight: "600",
      textAlign: "center",
      marginTop: 10,
    },

    // Issue chips: off → mild (accent) → bad (amber)
    issueBlock: {
      marginBottom: 10,
    },
    issueChip: {
      alignSelf: "flex-start",
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: "transparent",
    },
    issueChipMild: {
      borderColor: C.ACCENT,
      backgroundColor: ACCENT_BG,
    },
    issueChipBad: {
      borderColor: AMBER_BORDER,
      backgroundColor: AMBER_BG,
    },
    issueChipText: {
      color: C.TEXT,
      fontWeight: "700",
      fontSize: 13,
    },
    issueChipTextMild: {
      color: C.ACCENT,
    },
    issueChipTextBad: {
      color: AMBER_TEXT,
    },

    // Where pills — indented single-select row under an active issue chip
    whereRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 8,
      paddingLeft: 14,
    },
    wherePill: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: "transparent",
    },
    wherePillOn: {
      borderColor: C.ACCENT,
      backgroundColor: ACCENT_BG,
    },
    wherePillText: {
      color: C.MUTED,
      fontWeight: "700",
      fontSize: 12,
    },
    wherePillTextOn: {
      color: C.ACCENT,
    },

    // Protect chips — green when active
    protectPillOn: {
      borderColor: GREEN_BORDER,
      backgroundColor: GREEN_BG,
    },
    protectPillTextOn: {
      color: GREEN_TEXT,
    },

    notesInput: {
      marginTop: 12,
      minHeight: 100,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.CARD,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: C.TEXT,
      fontSize: 14,
    },

    // "What I'm hearing" card
    heardCard: {
      marginHorizontal: 20,
      marginTop: 28,
      backgroundColor: C.CARD,
      borderRadius: 12,
      borderLeftWidth: 3,
      borderLeftColor: C.ACCENT,
      padding: 14,
    },
    heardLabel: {
      color: C.MUTED,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1.2,
    },
    heardText: {
      color: C.TEXT,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 6,
    },

    btnPrimary: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: "center",
      justifyContent: "center",
    },
    btnDisabled: {
      opacity: 0.6,
    },
    btnPrimaryText: {
      color: "#fff",
      fontWeight: "900",
      fontSize: 16,
    },
    btnGhost: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: C.BORDER,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    },
    btnGhostText: {
      color: C.TEXT,
      fontWeight: "800",
    },
  });
