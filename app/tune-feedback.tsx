// app/tune-feedback.tsx
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
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
} from "../lib/setupVersions";
import { useTheme } from "../lib/theme";

const SCALE_MAX = 5;

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type KeyAreaMeta = {
  id: string;
  label: string;
  description: string;
  symptom?: Tune2SymptomId; // which circuit this slider should influence
};

// meta we can pass in from tune-results (can be expanded later)
type FeedbackMeta = {
  bikeTitle?: string;
  surface?: string;
  mode?: string;
  // optional: let us customize the key-area questions per rider
  keyAreas?: KeyAreaMeta[];
  // optional “source” info for smarter questions
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

/**
 * ISSUE_TAGS:
 * 1:1 mapping between chip label and backend Tune2SymptomId
 * so every chip actually drives the Tune Two engine.
 */
const ISSUE_TAGS: { id: Tune2SymptomId; label: string }[] = [
  {
    id: "harsh_braking_bumps",
    label: "Harsh in braking bumps / small chop",
  },
  {
    id: "harsh_square_edge",
    label: "Harsh on square-edge / rocks",
  },
  {
    id: "bottoms_landings",
    label: "Bottoms on big hits / landings",
  },
  {
    id: "rear_kicks_accel",
    label: "Rear kicks on throttle",
  },
  {
    id: "unstable_whoops",
    label: "Unstable in whoops / rollers",
  },
  {
    id: "packs_whoops",
    label: "Packs down in whoops",
  },
  {
    id: "front_knifes",
    label: "Front knifes / tucks in corners",
  },
  {
    id: "dead_feel",
    label: "Feels dead / no pop",
  },
  {
    id: "headshake",
    label: "High-speed headshake",
  },
  {
    id: "general_harsh",
    label: "Just generally harsh",
  },
];

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

  // Raw meta string to pass back into results screens
  const rawMetaParam =
    typeof meta === "string" && meta.length > 0 ? meta : undefined;

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

  // Build dynamic key areas based on meta + context
  const keyAreas: KeyAreaMeta[] = useMemo(
    () => buildKeyAreas(metaObj, ctxObj),
    [metaObj, ctxObj]
  );

  // 1–5 ratings
  const [overall, setOverall] = useState<number>(4);

  // keep per-key-area ratings in an array so it’s easy to expand later
  const [keyRatings, setKeyRatings] = useState<number[]>(
    keyAreas.map(() => 3)
  );

  // If keyAreas length changes (different bike/terrain/goals), keep arrays in sync
  useEffect(() => {
    setKeyRatings((prev) => {
      if (prev.length === keyAreas.length) return prev;
      // Initialize new array defaulted to 3, but keep any existing ratings by index
      const next = keyAreas.map((_, i) => prev[i] ?? 3);
      return next;
    });
  }, [keyAreas]);

  const setKeyRating = (index: number, value: number) => {
    setKeyRatings((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  // issue chips → we track by symptomId so we can talk directly to the backend
  const [selectedIssues, setSelectedIssues] = useState<Tune2SymptomId[]>([]);

  // free-text notes (not yet sent to backend – can be logged or added later)
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const toggleIssue = (id: Tune2SymptomId) => {
    setSelectedIssues((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

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

      // Overall 1–5 → 1–10 severity
      const overallSeverity =
        overall && SCALE_MAX > 0
          ? Math.max(
              1,
              Math.min(10, Math.round((overall / SCALE_MAX) * 10))
            )
          : undefined;

      // Combine slider + chip info into Tune2Feedback.symptoms
      const symptomMap = new Map<Tune2SymptomId, number>();

      // 1) Sliders: interpret low ratings as “this area needs work”
      keyAreas.forEach((area, idx) => {
        if (!area.symptom) return;
        const rating = keyRatings[idx] ?? 3;
        const badness = SCALE_MAX + 1 - rating; // 1 (perfect) → 5 (terrible)
        if (badness <= 1) return; // 5/5 → no issue

        const sev = Math.max(
          1,
          Math.min(10, Math.round((badness / SCALE_MAX) * 10))
        );

        const existing = symptomMap.get(area.symptom) ?? 0;
        symptomMap.set(area.symptom, Math.max(existing, sev));
      });

      // 2) Chips: each selected tag is a solid “there is an issue here”
      selectedIssues.forEach((id) => {
        const sevFromChip = 7; // chips mean “this was clearly a problem”
        const existing = symptomMap.get(id) ?? 0;
        symptomMap.set(id, Math.max(existing, sevFromChip));
      });

      const symptoms: Tune2Feedback["symptoms"] = Array.from(
        symptomMap.entries()
      ).map(([id, severity]) => ({
        id,
        severity,
      }));

      const feedback: Tune2Feedback = {
        overall_rating: overallSeverity,
        ride_duration_min: undefined, // can add later if you add a field
        terrain_tags: surface ? [surface] : undefined,
        symptoms,
      };

      // 🔵 Make sure bike id gets forwarded into Tune Two results via meta/context
      // (derived above the engine call so the lineage shadow writes can use it)
      const anyMeta: any = metaObj || {};
      const anyCtx: any = ctxObj || {};

      const bikeId =
        anyCtx.selectedBikeId ??
        anyCtx.bike_id ??
        anyMeta?.bike?.selectedBikeId ??
        anyMeta?.bike?.id ??
        anyMeta?.bike_id ??
        null;

      // Lineage shadow writes: persist the feedback against the critiqued
      // version BEFORE the engine runs, so rider feedback survives even if the
      // refinement call fails. Never let shadow failures break the flow.
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
        const fb = await createFeedback({
          setupVersionId: critiquedVersionId,
          overallRating: overallSeverity ?? null,
          symptoms,
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

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
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

        <Text style={S.headerBody}>
          We’ll make small, pro-level changes (a few clicks / 0.1–0.2 bar)
          based on how this setup felt on your last ride.
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          {/* Overall rating */}
          <View style={S.card}>
            <Text style={S.cardTitle}>How did this setup feel overall?</Text>
            <Text style={S.cardSubtitle}>
              1 = needs a lot of work, 5 = almost perfect. We bias adjustments
              based on this.
            </Text>

            <RatingRow
              value={overall}
              onChange={setOverall}
              scaleMax={SCALE_MAX}
              leftLabel="Needs a lot of work"
              rightLabel="Almost perfect"
              C={C}
            />
          </View>

          {/* Key areas (sliders 1–5) */}
          <View style={S.card}>
            <Text style={S.cardTitle}>Dial in key areas</Text>
            <Text style={S.cardSubtitle}>
              These questions adapt to your terrain, goals, and issues.
            </Text>

            {keyAreas.map((ka, i) => (
              <AreaBlock
                key={ka.id}
                label={ka.label}
                description={ka.description}
                value={keyRatings[i] ?? 3}
                onChange={(v) => setKeyRating(i, v)}
                C={C}
              />
            ))}
          </View>

          {/* Issue chips */}
          <View style={S.card}>
            <Text style={S.cardTitle}>What needs improvement?</Text>
            <Text style={S.cardSubtitle}>
              Pick everything that applied on your last ride.
            </Text>

            <View style={S.chipsGrid}>
              {ISSUE_TAGS.map((tag) => {
                const onTag = selectedIssues.includes(tag.id);
                return (
                  <Pressable
                    key={tag.id}
                    onPress={() => toggleIssue(tag.id)}
                    style={[S.issueChip, onTag && S.issueChipOn]}
                  >
                    <Text
                      style={[S.issueChipText, onTag && S.issueChipTextOn]}
                      numberOfLines={2}
                    >
                      {tag.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Notes */}
          <View style={S.card}>
            <Text style={S.cardTitle}>Anything else we should know?</Text>
            <Text style={S.cardSubtitle}>
              Optional. Example: “Harsh on small chop but good on big jumps.”
            </Text>

            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Describe exactly what the bike was doing..."
              placeholderTextColor={C.MUTED}
              style={S.notesInput}
              multiline
              textAlignVertical="top"
            />
          </View>

          {/* Buttons */}
          <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
            <Pressable
              onPress={onSubmit}
              style={[S.btnPrimary, submitting && S.btnDisabled]}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={S.btnPrimaryText}>Build my refined tune</Text>
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
    </TouchableWithoutFeedback>
  );
}

/* ------- Rating row (1–5 bubbles only) ------- */

function RatingRow({
  value,
  onChange,
  scaleMax,
  leftLabel,
  rightLabel,
  C,
}: {
  value: number;
  onChange: (v: number) => void;
  scaleMax: number;
  leftLabel?: string;
  rightLabel?: string;
  C: any;
}) {
  const dots = Array.from({ length: scaleMax }, (_, i) => i + 1);
  return (
    <View style={{ marginTop: 14 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          gap: 12,
          marginBottom: 4,
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

      {(leftLabel || rightLabel) && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginTop: 4,
          }}
        >
          <Text style={{ color: C.MUTED, fontSize: 12 }}>{leftLabel}</Text>
          <Text style={{ color: C.MUTED, fontSize: 12 }}>{rightLabel}</Text>
        </View>
      )}
    </View>
  );
}

function AreaBlock({
  label,
  description,
  value,
  onChange,
  C,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
  C: any;
}) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ color: C.TEXT, fontWeight: "900", fontSize: 15 }}>
        {label}
      </Text>
      <Text style={{ color: C.MUTED, marginTop: 2, fontSize: 13 }}>
        {description}
      </Text>
      <RatingRow
        value={value}
        onChange={onChange}
        scaleMax={SCALE_MAX}
        leftLabel="Needs a lot of work"
        rightLabel="Almost perfect"
        C={C}
      />
    </View>
  );
}

/* ------- Key area builder (makes sliders semi-custom) ------- */

function buildKeyAreas(
  meta: FeedbackMeta,
  ctx?: Tune2Context | null
): KeyAreaMeta[] {
  // If caller pre-computed custom keyAreas, respect that (but still cap at 4)
  if (meta.keyAreas && meta.keyAreas.length) {
    return meta.keyAreas.slice(0, 4);
  }

  const goals = (ctx?.rider?.goals ?? meta.riderGoals ?? []).map((g) =>
    g.toLowerCase()
  );

  const terrainText = (
    ctx?.terrain ??
    meta.terrainRaw ??
    meta.surface ??
    ""
  ).toLowerCase();

  const issuesText = (meta.riderIssues ?? "").toLowerCase();

  const areas: KeyAreaMeta[] = [];
  const pushUnique = (area: KeyAreaMeta) => {
    if (!areas.find((a) => a.id === area.id)) areas.push(area);
  };

  const isWoods =
    /woods|singletrack|roots|rocks|rocky|enduro|hard enduro/.test(
      terrainText
    ) || /roots|rocks|square edge/.test(issuesText);

  const isMxTrack =
    /mx|track|motocross|supercross|sx/.test(terrainText) ||
    /braking bumps|whoops|rhythm/.test(issuesText);

  const isSand =
    /sand/.test(terrainText) || /sand whoops/.test(issuesText);

  const wantsComfort =
    goals.some((g) => /comfort|plush|soft/.test(g)) ||
    /harsh|beat up|stiff/.test(issuesText);

  const wantsStability =
    goals.some((g) => /stabil|confidence|planted/.test(g)) ||
    /headshake|sketchy|unstable/.test(issuesText);

  const wantsPop =
    goals.some((g) => /playful|pop|lively/.test(g)) ||
    /dead|packed/.test(issuesText);

  const wantsJumps =
    goals.some((g) => /jumps|big hits|air/.test(g)) ||
    /bottom|case|flat land/.test(issuesText);

  const wantsCornering =
    goals.some((g) => /corner|turn|rut/.test(g)) ||
    /corner|turn|pushes|tucks/.test(issuesText);

  const wantsWhoops =
    /whoops|rollers/.test(terrainText) || /whoops|rollers/.test(issuesText);

  // ----- Area: braking bumps / small chop (MX bias) -----
  pushUnique({
    id: isWoods ? "tech_chop" : "small_chop",
    label: isWoods
      ? "Roots / technical chop"
      : "Braking bumps / small chop",
    description: isWoods
      ? "How did it feel in roots, rocks, and slow, technical chop?"
      : "How did it feel in braking bumps and small chop into corners?",
    symptom: "harsh_braking_bumps",
  });

  // ----- Area: roots / rocks / square-edge (enduro bias) -----
  if (isWoods || /roots|rocks|square edge/.test(issuesText)) {
    pushUnique({
      id: "roots_rocks",
      label: "Roots / rocks / square-edge",
      description:
        "How did it feel smashing through roots, rocks, and square-edge hits?",
      symptom: "harsh_square_edge",
    });
  }

  // ----- Area: big hits / landings -----
  if (isMxTrack || isSand || wantsJumps) {
    pushUnique({
      id: "big_hits",
      label: "Big hits / landings",
      description:
        "How did it handle big jump landings, G-outs, and overshoots?",
      symptom: "bottoms_landings",
    });
  }

  // ----- Area: whoops / rollers / high-speed rough -----
  if (wantsWhoops || isMxTrack || isSand) {
    pushUnique({
      id: "whoops",
      label: "Whoops / rollers / high-speed rough",
      description: "How stable did it feel through whoops and fast rough?",
      symptom: "unstable_whoops",
    });
  }

  // ----- Area: cornering support / front end confidence -----
  if (wantsCornering) {
    pushUnique({
      id: "cornering",
      label: "Corner entry / mid-corner front feel",
      description:
        "How confident did the front feel on corner entry and mid-corner?",
      symptom: "front_knifes",
    });
  }

  // ----- Area: pop vs planted (lively vs dead) -----
  if (wantsPop) {
    pushUnique({
      id: "pop_vs_planted",
      label: "Pop vs planted feel",
      description:
        "Did it feel lively enough to hop and change lines, or too dead and packed?",
      symptom: "dead_feel",
    });
  }

  // ----- Area: high-speed stability / headshake -----
  if (wantsStability) {
    pushUnique({
      id: "high_speed",
      label: "High-speed stability",
      description:
        "How calm did the bike feel at higher speeds or on fast straightaways?",
      symptom: "headshake",
    });
  }

  // Ensure at least 2 sliders
  if (areas.length < 2) {
    pushUnique({
      id: "big_hits",
      label: "Big hits / landings",
      description: "How did it feel on big hits and jump landings?",
      symptom: "bottoms_landings",
    });
  }

  // As a last resort, add a general slider if we still have < 2
  if (areas.length < 2) {
    pushUnique({
      id: "general",
      label: "Overall feel on the track",
      description:
        "How confident and comfortable did the bike feel everywhere?",
      symptom: "general_harsh",
    });
  }

  // Cap to 4 so the screen doesn’t get crazy long
  return areas.slice(0, 4);
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
      paddingBottom: 18,
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
    headerBody: {
      color: "rgba(255,255,255,0.92)",
      marginTop: 8,
      fontSize: 13,
      lineHeight: 18,
    },

    card: {
      marginHorizontal: 16,
      marginTop: 12,
      backgroundColor: C.CARD,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.BORDER,
      padding: 14,
    },
    cardTitle: {
      color: C.TEXT,
      fontWeight: "900",
      fontSize: 18,
      marginBottom: 4,
    },
    cardSubtitle: {
      color: C.MUTED,
      fontSize: 13,
    },

    chipsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 12,
    },
    issueChip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: C.INK,
      minWidth: "44%",
      maxWidth: "48%",
      alignItems: "center",
      justifyContent: "center",
    },
    issueChipOn: {
      borderColor: C.ACCENT,
      backgroundColor: "#0b1729",
    },
    issueChipText: {
      color: C.TEXT,
      fontWeight: "800",
      textAlign: "center",
      fontSize: 13,
    },
    issueChipTextOn: {
      color: "#fff",
    },

    notesInput: {
      marginTop: 10,
      minHeight: 120,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: C.BORDER,
      backgroundColor: "#050914",
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: C.TEXT,
      fontSize: 14,
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
      borderColor: "rgba(255,255,255,0.25)",
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    },
    btnGhostText: {
      color: "#E6E9F2",
      fontWeight: "800",
    },
  });
