// app/tune-feedback.tsx
import { HOME_GARAGE_V3_ENABLED } from "../lib/featureFlags";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    Easing,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "../components/Toast";
import { supabase } from "../lib/supabase";
import { deriveIsPro } from "../lib/proUtils";
import { hasPurchasedThisSession } from "../lib/purchases";
import { showProGate } from "../lib/proGate";
import { isEntitled, resolveEntitlement } from "../lib/entitlement";
import {
    generateTuneTwo,
    Tune2Context,
    Tune2Feedback,
    Tune2SymptomId,
    ZeroTuneResult,
    completeTune,
} from "../lib/ai";
import { enqueueFeedbackRetry } from "../lib/feedbackRetry";
import {
  cancelRideReminderForVersion,
  declineNotificationPrompt,
  requestNotificationPermission,
  scheduleRideReminder,
  shouldOfferNotificationPrompt,
} from "../lib/rideReminder";
import {
    createBaselineVersion,
    createFeedback,
    createRefinementVersion,
    FeedbackEntry,
} from "../lib/setupVersions";
import { useTheme } from "../lib/theme";
import { prewarmTuneLocation } from "../lib/tuneLocation";
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
  checkinSource?: string; // set only when a check-in card opened this screen
};

/** Trust only the card's own vocabulary — a malformed deep link must not put
 *  junk in feedback_submitted meta. Absent/invalid = not a card-origin visit. */
const CHECKIN_SOURCES = [
  "home_mount",
  "warm_resume",
  "notification",
  "tune_focus",
] as const;
function asCheckinSource(v: unknown): string | null {
  return typeof v === "string" && (CHECKIN_SOURCES as readonly string[]).includes(v)
    ? v
    : null;
}

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

// The post-feedback reminder is about the refined setup the rider leaves
// with, not the version they just critiqued — its tap lands on the outcome
// check-in card (Better/Same/Worse), so the copy asks that question.
const OUTCOME_REMINDER_TITLE = "How did the new setup feel?";

/** Inline pre-prompt at feedback-submit success — the value moment: the rider
 *  just turned ride notes into a refined setup, so the reminder offer lands
 *  when its worth is obvious. Never shows the OS dialog cold; declining
 *  snoozes the offer 30 days (lib/rideReminder.ts). The outcome is logged in
 *  existing event meta only (heard_card_shown, surface "notif_prompt") — a
 *  new event type would need a usage_events CHECK-constraint migration. */
async function offerReminderPermission(params: {
  versionId: string;
  versionNumber: number;
  bikeName: string;
}): Promise<void> {
  try {
    if (!(await shouldOfferNotificationPrompt())) return;
    Alert.alert(
      "Want a reminder to log how it felt after your next ride?",
      "One nudge after your next ride. Takes 10 seconds to answer.",
      [
        {
          text: "Not now",
          style: "cancel",
          onPress: () => {
            void declineNotificationPrompt();
            void logEvent("heard_card_shown", {
              surface: "notif_prompt",
              outcome: "declined",
              version_id: params.versionId,
            });
          },
        },
        {
          text: "Remind me",
          onPress: () => {
            void (async () => {
              const granted = await requestNotificationPermission();
              if (granted) {
                // The re-arm at submit no-op'd while permission was still
                // undetermined — schedule the same reminder now.
                if (!HOME_GARAGE_V3_ENABLED) void scheduleRideReminder({
                  versionId: params.versionId,
                  versionNumber: params.versionNumber,
                  bikeName: params.bikeName,
                  title: OUTCOME_REMINDER_TITLE,
                });
              }
              void logEvent("heard_card_shown", {
                surface: "notif_prompt",
                outcome: granted ? "granted" : "denied",
                version_id: params.versionId,
              });
            })();
          },
        },
      ],
      { cancelable: true } // Android back-dismiss = no decision; offer again next submit
    );
  } catch {
    // never block the results handoff on a permission offer
  }
}

const OVERALL_LABELS: Record<number, string> = {
  1: "Rough day. We'll make real moves",
  2: "Needs work: bigger corrections",
  3: "Decent base: targeted changes",
  4: "Pretty good, small stuff to fix",
  5: "Dialed: micro adjustments only",
};

/* ---------------- Tuner voice (sticky bar reactions) ---------------- */

const IDLE_LINE = "Waiting on you. How'd it ride?";
const FREETEXT_FOCUS_LINE = "Go ahead, say it how you'd say it.";
const CLEARED_LINE = "Cleared. What else?";

const OVERALL_REACTIONS: Record<number, string> = {
  1: "Alright, rough one. Let's make real changes.",
  2: "Heard. We'll take bigger swings this round.",
  3: "Solid base. Let's sharpen it.",
  4: "Close. Small, targeted moves.",
  5: "Nearly perfect. I'll barely touch it.",
};

const ISSUE_ACKS: Partial<Record<Tune2SymptomId, { mild: string; bad: string }>> = {
  harsh_braking_bumps: {
    mild: "Harsh, noted. We'll soften it up.",
    bad: "Really beating you up. On it.",
  },
  rear_kicks_accel: {
    mild: "Rear kicking, got it.",
    bad: "Rear kicking hard. On it.",
  },
  front_knifes: {
    mild: "Front tucking, noted.",
    bad: "Front's washing on you. Big one.",
  },
  bottoms_landings: {
    mild: "Bottoming a bit, okay.",
    bad: "Slamming through the stroke. Fixing that.",
  },
  dead_feel: {
    mild: "Feels dead. We'll wake it up.",
    bad: "No life at all. We'll get the pop back.",
  },
  unstable_whoops: {
    mild: "A little nervous in the fast stuff, noted.",
    bad: "Sketchy at speed. Priority one.",
  },
  packs_whoops: {
    mild: "Packing up, got it.",
    bad: "Packing down bad. We'll free it up.",
  },
  harsh_square_edge: {
    mild: "Square edges biting, noted.",
    bad: "Roots and rocks are hammering you. On it.",
  },
  // Not exposed as chips, but keep the map total for safety.
  deflects_in_chop: {
    mild: "Front deflecting, noted.",
    bad: "Front's pinballing. On it.",
  },
  headshake: {
    mild: "Bit of headshake, noted.",
    bad: "Headshake at speed. On it.",
  },
  general_harsh: {
    mild: "Generally harsh, noted.",
    bad: "Harsh everywhere. We'll calm it down.",
  },
};

const PROTECT_ACKS: Record<string, { on: string; off: string }> = {
  "Rear traction": {
    on: "Rear's hooked up. Not touching it.",
    off: "Okay, rear's fair game again.",
  },
  "Front planted": {
    on: "Front's planted. Leaving it alone.",
    off: "Okay, front's fair game again.",
  },
  "Landings": {
    on: "Landings are money. Hands off.",
    off: "Okay, landings are fair game again.",
  },
  "Cornering": {
    on: "Corners are working. Not touching those.",
    off: "Okay, corners are fair game again.",
  },
};

/* ---------------- Chip + section icons (Ionicons, state-colored) ------- */

const ISSUE_ICONS: Partial<Record<Tune2SymptomId, keyof typeof Ionicons.glyphMap>> = {
  harsh_braking_bumps: "flash",
  rear_kicks_accel: "arrow-up-circle",
  front_knifes: "arrow-down-circle",
  bottoms_landings: "download",
  dead_feel: "battery-dead",
  unstable_whoops: "pulse",
  packs_whoops: "layers",
  harsh_square_edge: "triangle",
  // Unexposed ids — safe fallbacks.
  deflects_in_chop: "pulse",
  headshake: "pulse",
  general_harsh: "flash",
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
/* PulsePressable: 150–200ms scale pulse on tap. The pulse lives on a  */
/* wrapping Animated.View so the Pressable stays tappable throughout.  */
/* ------------------------------------------------------------------ */

function PulsePressable({
  onPress,
  style,
  containerStyle,
  children,
}: {
  onPress: () => void;
  style?: any;
  containerStyle?: ViewStyle;
  children: React.ReactNode;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 1.06,
        duration: 90,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 90,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
    onPress();
  };

  return (
    <Animated.View style={[containerStyle, { transform: [{ scale }] }]}>
      <Pressable onPress={handlePress} style={style}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                             */
/* ------------------------------------------------------------------ */

/** 3.0 (device pass round 3, item 5): the debrief is retired under the v3
 *  flag. Every caller (check-in cards, bike home, results, active setup card)
 *  lands on the ride-day Log in quick mode for the same bike and version. */
export default function TuneFeedbackScreen() {
  const { bikeId, versionId } = useLocalSearchParams<RouteParams>();
  if (HOME_GARAGE_V3_ENABLED) {
    return <Redirect href={{ pathname: "/ride/log", params: { quick: "1", bikeId: bikeId ?? "", versionId: versionId ?? "" } } as never} />;
  }
  return <LegacyTuneFeedbackScreen />;
}

function LegacyTuneFeedbackScreen() {
  const { meta, previous, context, versionId, checkinSource } =
    useLocalSearchParams<RouteParams>();
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
  const [overallTouched, setOverallTouched] = useState(false);

  // Prewarm a coarse location fix while the rider picks symptoms, so the
  // submit-time read inside generateTuneTwo is instant. Never prompts.
  useEffect(() => {
    prewarmTuneLocation();
  }, []);

  /* ---------------- Tuner bar reactions ---------------- */

  const [reaction, setReaction] = useState<string | null>(null);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barScale = useRef(new Animated.Value(1)).current;

  useEffect(
    () => () => {
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
    },
    []
  );

  // Show a transient reaction line + subtle ~200ms bar pulse, then settle
  // back to the composed summary (or idle line).
  const react = useCallback(
    (line: string) => {
      setReaction(line);
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
      reactionTimer.current = setTimeout(() => setReaction(null), 2400);
      Animated.sequence([
        Animated.timing(barScale, {
          toValue: 1.02,
          duration: 100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(barScale, {
          toValue: 1,
          duration: 100,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    },
    [barScale]
  );

  /* ---------------- Handlers ---------------- */

  const onRateOverall = (n: number) => {
    setOverall(n);
    setOverallTouched(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    react(OVERALL_REACTIONS[n] ?? OVERALL_REACTIONS[3]);
  };

  const selectCondition = (c: string) => {
    setCondition((prev) => {
      const selecting = prev !== c;
      if (selecting) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      return selecting ? c : null;
    });
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
    if (next === 1) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      react(ISSUE_ACKS[id]?.mild ?? "Noted.");
    } else if (next === 2) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      react(ISSUE_ACKS[id]?.bad ?? "On it.");
    } else {
      // clear: no haptic
      react(CLEARED_LINE);
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
    if (!active) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      react(PROTECT_ACKS[area]?.on ?? "Locked in. Not touching it.");
    } else {
      // deselect: no haptic
      react(PROTECT_ACKS[area]?.off ?? "Okay, fair game again.");
    }
    void logEvent("protect_toggled", { area, active: !active });
  };

  /* ---------------- Derived ---------------- */

  const activeIssues = ISSUE_CHIPS.filter(
    (chip) => (issueLevels[chip.id] ?? 0) > 0
  );
  const issueCount = activeIssues.length;
  const hasAnyInput =
    overallTouched ||
    issueCount > 0 ||
    protectedAreas.length > 0 ||
    !!condition ||
    notes.trim().length > 0;

  // Analytics continuity: the old in-flow hearing card fired this when it
  // first appeared; the sticky bar fires it on first meaningful input.
  const heardShownRef = useRef(false);
  useEffect(() => {
    if (hasAnyInput && !heardShownRef.current) {
      heardShownRef.current = true;
      void logEvent("heard_card_shown", { surface: "tuner_bar" });
    }
  }, [hasAnyInput]);

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
        ? "Base is close. Small, targeted moves."
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

    // Refine after ride is Pro (3.0 Free/Pro flip, action-gated paywall —
    // lib/paywall.ts). Gated at submit, the one choke point every refine
    // entry funnels into (results, garage, Bike Home, check-in cards), so the
    // picker stays explorable and a dismissed paywall returns right here.
    // Fails OPEN only on a thrown read (offline Pro rider); a successful
    // "not Pro" read gates.
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user?.id && !hasPurchasedThisSession()) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("pro_until, is_pro")
          .eq("user_id", auth.user.id)
          .maybeSingle();
        if (!deriveIsPro(prof) && !isEntitled(await resolveEntitlement())) {
          void Haptics.selectionAsync();
          // The Pro gate names the action and offers "Update my baseline
          // instead"; it opens the paywall with paywall_trigger_action=adjust.
          showProGate({ trigger: "refine" });
          return;
        }
      }
    } catch (e) {
      console.warn("[tune-feedback] pro check failed open", e);
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
      // refinement call fails. Failures never break the flow, but they are no
      // longer silent: the rider gets a toast and the un-persisted remainder
      // goes to the retry queue (lib/feedbackRetry.ts, flushed on next launch).
      // ride_feedback.symptoms jsonb = issue entries + {area, protect: true}
      // entries in one flat array (see FeedbackEntry in lib/setupVersions.ts).
      let critiquedVersionId: string | null =
        typeof versionId === "string" && versionId.length > 0 ? versionId : null;
      let feedbackId: string | null = null;
      let shadowWriteFailed = false;
      const cardSource = asCheckinSource(checkinSource);
      const feedbackEntries: FeedbackEntry[] = [
        ...symptoms,
        ...protectedAreas.map((area) => ({ area, protect: true as const })),
      ];
      const feedbackPayload = {
        overallRating: overallRatingTen ?? null,
        symptoms: feedbackEntries,
        freeText: notes.trim() || null,
        checkinSource: cardSource,
      };
      // The retry queue replays whatever is still null/pending in this entry.
      const retryEntry = () => ({
        versionId: critiquedVersionId,
        bikeId,
        previousTune,
        refinedTune: null as ZeroTuneResult | null,
        feedback: feedbackId ? null : feedbackPayload,
        feedbackId,
        resultingVersionId: null as string | null,
        terrain: surface ?? null,
        context: ctxObj ?? null,
      });
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
          overallRating: feedbackPayload.overallRating,
          symptoms: feedbackEntries,
          freeText: notes,
          checkinSource: cardSource,
        });
        feedbackId = fb.id;
        // Feedback landed for this version — the ride reminder pointing at it
        // has done its job (or is no longer needed).
        void cancelRideReminderForVersion(critiquedVersionId);
      } catch (shadowErr: any) {
        shadowWriteFailed = true;
        // Real Supabase error, not a generic line — RLS rejections (42501)
        // must be distinguishable from network failures in dev.
        console.error("ride_feedback shadow write failed", {
          code: shadowErr?.code,
          message: shadowErr?.message,
          details: shadowErr?.details,
        });
      }

      let result: ZeroTuneResult;
      try {
        // The debrief always critiques a complete saved tune, so the sparse
        // refine shape (contract v3) completes back to a full tune here.
        result = completeTune(
          await generateTuneTwo({
            previous: previousTune,
            feedback: { ...feedback, source: "debrief" },
            context: ctxObj ?? undefined,
            bikeId, // enables the engine's adaptive step from the last rated outcome
          }),
          previousTune
        );
      } catch (engineErr) {
        // Engine failed after the debrief write also failed: keep the debrief
        // anyway (it's the part the rider typed), then let the outer catch
        // surface the engine error.
        if (shadowWriteFailed) {
          void enqueueFeedbackRetry(retryEntry());
        }
        throw engineErr;
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Lineage shadow write: record the refinement as a child version and
      // link it back to the feedback row that produced it.
      let refinementSaved = false;
      let refinementRowId: string | null = null;
      let refinementVersionNumber: number | null = null;
      if (critiquedVersionId) {
        try {
          const refinement = await createRefinementVersion({
            bikeId,
            parentVersionId: critiquedVersionId,
            tune: result,
            terrain: surface ?? null,
            context: ctxObj ?? null,
            feedbackId,
          });
          refinementSaved = true;
          refinementRowId = refinement.id;
          refinementVersionNumber = refinement.version_number;
          // The refined setup is the next thing to ride — re-arm the 36h
          // check-in for it. Replaces the reminder we just cancelled for the
          // version we critiqued (scheduleRideReminder keeps one pending).
          if (!HOME_GARAGE_V3_ENABLED) void scheduleRideReminder({
            versionId: refinement.id,
            versionNumber: refinement.version_number,
            bikeName: bikeTitle,
            title: OUTCOME_REMINDER_TITLE,
          });
        } catch (shadowErr: any) {
          shadowWriteFailed = true;
          console.error("setup_versions refinement shadow write failed", {
            code: shadowErr?.code,
            message: shadowErr?.message,
            details: shadowErr?.details,
          });
        }
      }

      if (shadowWriteFailed) {
        void enqueueFeedbackRetry({
          ...retryEntry(),
          refinedTune: refinementSaved ? null : result,
          // Feedback row pending + refinement row saved: the replayed feedback
          // must link to the refinement that already exists.
          resultingVersionId: feedbackId ? null : refinementRowId,
        });
        toast.show(
          "Your refined tune is ready, but we couldn't save this ride's notes. We'll retry automatically.",
          { kind: "info", durationMs: 3500 }
        );
      }

      if (refinementSaved && refinementRowId) {
        // Permission ask at the value moment (moved off the results screen).
        // Fire-and-forget: the native alert overlays the results screen the
        // router.replace below navigates to.
        void offerReminderPermission({
          versionId: refinementRowId,
          versionNumber: refinementVersionNumber ?? 1,
          bikeName: bikeTitle,
        });
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
              <Text style={S.headerTitle}>Post-ride debrief</Text>
              <Text style={S.headerSub}>{bikeTitle} · 30 seconds, be honest</Text>
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
            {/* Conditions (no icons on this row by design) */}
            <View style={S.section}>
              <Text style={S.sectionTitle}>Conditions today</Text>
              <View style={S.pillRow}>
                {CONDITIONS.map((c) => {
                  const on = condition === c;
                  return (
                    <PulsePressable
                      key={c}
                      onPress={() => selectCondition(c)}
                      style={[S.pill, on && S.pillOn]}
                    >
                      <Text style={[S.pillText, on && S.pillTextOn]}>{c}</Text>
                    </PulsePressable>
                  );
                })}
              </View>
            </View>

            {/* Overall */}
            <View style={S.section}>
              <View style={S.sectionTitleRow}>
                <Ionicons name="speedometer" size={16} color={C.MUTED} />
                <Text style={S.sectionTitle}>
                  How did this setup feel overall?
                </Text>
              </View>
              <RatingRow
                value={overall}
                onChange={onRateOverall}
                scaleMax={SCALE_MAX}
                C={C}
              />
              <Text style={S.overallLabel}>{OVERALL_LABELS[overall]}</Text>
            </View>

            {/* Issue chips (tap-twice severity) */}
            <View style={S.section}>
              <View style={S.sectionTitleRow}>
                <Ionicons name="build" size={16} color={C.MUTED} />
                <Text style={S.sectionTitle}>What needs work?</Text>
              </View>
              <Text style={S.sectionSub}>
                Tap once for mild, twice for bad.
              </Text>

              <View style={{ marginTop: 12 }}>
                {ISSUE_CHIPS.map((chip) => {
                  const level = issueLevels[chip.id] ?? 0;
                  const selectedWhere = issueWhere[chip.id];
                  const chipColor =
                    level === 1 ? C.ACCENT : level === 2 ? AMBER_TEXT : C.TEXT;
                  return (
                    <View key={chip.id} style={S.issueBlock}>
                      <PulsePressable
                        containerStyle={{ alignSelf: "flex-start" }}
                        onPress={() => cycleIssue(chip.id)}
                        style={[
                          S.issueChip,
                          level === 1 && S.issueChipMild,
                          level === 2 && S.issueChipBad,
                        ]}
                      >
                        <Ionicons
                          name={ISSUE_ICONS[chip.id] ?? "alert-circle-outline"}
                          size={14}
                          color={chipColor}
                          style={{ marginRight: 6 }}
                        />
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
                      </PulsePressable>

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

            {/* What was dialed */}
            <View style={S.section}>
              <View style={S.sectionTitleRow}>
                <Ionicons name="shield-checkmark" size={16} color={C.MUTED} />
                <Text style={S.sectionTitle}>What was dialed?</Text>
              </View>
              <Text style={S.sectionSub}>
                I won't touch what's already good.
              </Text>
              <View style={S.pillRow}>
                {PROTECT_OPTIONS.map((area) => {
                  const on = protectedAreas.includes(area);
                  return (
                    <PulsePressable
                      key={area}
                      onPress={() => toggleProtect(area)}
                      style={[S.pill, S.pillWithIcon, on && S.protectPillOn]}
                    >
                      <Ionicons
                        name={on ? "shield-checkmark" : "ellipse-outline"}
                        size={14}
                        color={on ? GREEN_TEXT : C.TEXT}
                        style={{ marginRight: 5 }}
                      />
                      <Text style={[S.pillText, on && S.protectPillTextOn]}>
                        {area}
                      </Text>
                    </PulsePressable>
                  );
                })}
              </View>
            </View>

            {/* Free text */}
            <View style={S.section}>
              <View style={S.sectionTitleRow}>
                <Ionicons name="chatbubble-ellipses" size={16} color={C.MUTED} />
                <Text style={S.sectionTitle}>Or say it your way</Text>
              </View>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                onFocus={() => react(FREETEXT_FOCUS_LINE)}
                placeholder="Front was sketchy into corners after the whoops..."
                placeholderTextColor={C.MUTED}
                style={S.notesInput}
                multiline
                textAlignVertical="top"
                returnKeyType="done"
                blurOnSubmit
              />
            </View>

            {/* Back link (submit lives in the docked tuner bar) */}
            <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
              <Pressable onPress={() => router.back()} style={S.btnGhost}>
                <Text style={S.btnGhostText}>Back to Setup</Text>
              </Pressable>
            </View>
          </ScrollView>

          {/* Sticky tuner bar: reacts to every input, docked above the
              keyboard via the surrounding KeyboardAvoidingView. */}
          <View style={[S.tunerBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Text style={S.tunerLabel}>YOUR TUNER'S NOTES</Text>
            <Animated.Text
              style={[S.tunerText, { transform: [{ scale: barScale }] }]}
              numberOfLines={2}
            >
              {reaction ?? (hasAnyInput ? heardText : IDLE_LINE)}
            </Animated.Text>
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
          </View>
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
    sectionTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
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
    pillWithIcon: {
      flexDirection: "row",
      alignItems: "center",
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
      flexDirection: "row",
      alignItems: "center",
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

    // Sticky tuner bar (docked; submit lives inside it)
    tunerBar: {
      backgroundColor: C.CARD,
      borderTopWidth: 2,
      borderTopColor: C.ACCENT,
      paddingHorizontal: 16,
      paddingTop: 10,
    },
    tunerLabel: {
      color: C.MUTED,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1.4,
    },
    tunerText: {
      color: C.TEXT,
      fontSize: 14,
      fontWeight: "600",
      lineHeight: 19,
      marginTop: 4,
      marginBottom: 10,
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
