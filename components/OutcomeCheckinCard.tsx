// components/OutcomeCheckinCard.tsx
// Ride check-in card, two modes:
//
// "outcome" — post-refinement: "Last time you said X. Better on the new
// setup?" → Better / Same / Worse feeds ride_feedback.outcome, which the
// engine's adaptive step (last_outcome) builds on. Answering it then continues
// into the picker for the rated setup — outcome → chips as one funnel.
//
// "first_ride" — post-baseline (the loop's most important prompt, previously
// missing): the newest version is an uncritiqued baseline ≥12h old →
// "How did the {bike} feel on v1?" → routes into the refine flow. Also the
// landing for a post-ride reminder tap (lib/rideReminder.ts) once the outcome
// is recorded or absent — including refinement versions the tap targets.
//
// Eligibility (checked on tab focus, fail-silent). Outcome mode wins — it's the
// label on every downstream row, so it fires first even on a reminder tap:
// - outcome: newest ride_feedback for the signed-in user with a resulting
//   refinement, no outcome yet, and at least 12h old (time to actually ride)
// - first_ride: an uncritiqued setup_versions row with a bike — the newest
//   baseline ≥12h old on organic focus, or the exact version a reminder tap
//   named (baseline or refinement, age gate bypassed) when there's no outcome
//   left to record
// - not snoozed/dismissed: AsyncStorage checkin_dismissed_<id> = {count, until};
//   skipped while `until` is in the future. "Haven't ridden yet" only snoozes
//   (3 days, unlimited); the ✕ dismissal counts toward the 2-strike limit.
// - guests never see it; max one card per app session across all mounts
//   (Home + Tune tab both render this — the first eligible instance wins).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Easing,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import {
  applyDismiss,
  applySnooze,
  DismissRecord,
  isFirstRideEligible,
  isRecordBlocking,
  titleFromSymptoms,
  TWELVE_HOURS_MS,
} from "../lib/checkinLogic";
import { buildRefineParams } from "../lib/refineFlow";
import {
  consumeReminderArrival,
  subscribeReminderArrival,
} from "../lib/reminderArrival";
import { cancelRideReminderForVersion } from "../lib/rideReminder";
import {
  FeedbackOutcome,
  SetupVersionRow,
  updateFeedbackOutcome,
  VERSION_COLUMNS,
} from "../lib/setupVersions";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { logEvent } from "../lib/usage";

const CONFIRM_VISIBLE_MS = 2500;

const dismissKey = (id: string) => `checkin_dismissed_${id}`;

// Max one card per app session, across tab remounts and both host tabs.
let shownThisSession = false;

// Wall-clock when the app last entered the background (module-level: one
// truth across both host-tab instances). A gap longer than SESSION_RESET_MS
// is a new session for the one-card-per-session rule above.
let backgroundedAtMs: number | null = null;
const SESSION_RESET_MS = 60 * 60 * 1000;

type CardState =
  | {
      kind: "outcome";
      feedbackId: string;
      title: string;
      // The setup being rated (ride_feedback.resulting_version_id) + its bike,
      // so answering can continue into the picker for it. Null when it can't
      // be resolved — the card then just confirms and dismisses.
      nextVersion: SetupVersionRow | null;
      nextBikeTitle: string;
      // Kept separately from nextVersion (which is fail-soft null) so
      // answering can always cancel the pending reminder aimed at this setup.
      resultingVersionId: string | null;
    }
  | {
      kind: "first_ride";
      version: SetupVersionRow;
      bikeTitle: string;
      title: string;
    };

/** Snooze/dismiss id: outcome cards key on the feedback row, first-ride cards
 *  on the version row (prefixed so the two can never collide). */
function dismissIdOf(card: CardState): string {
  return card.kind === "outcome" ? card.feedbackId : `v_${card.version.id}`;
}

const CONFIRMATIONS: Record<FeedbackOutcome, string> = {
  improved: "Logged — that's what the next refinement builds on.",
  same: "Noted. Next refinement takes a bigger step.",
  worse: "Got it — next refinement goes back and tries the other direction.",
};

async function isSnoozedOrDismissed(id: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(dismissKey(id));
  if (!raw) return false;
  try {
    return isRecordBlocking(JSON.parse(raw) as DismissRecord, Date.now());
  } catch {
    return false; // unreadable record → treat as never dismissed
  }
}

/** Load the setup an outcome card is rating (its resulting_version) and the
 *  bike title, so answering can flow into the picker for it. Fail-soft: a null
 *  version just means the card confirms-and-dismisses instead of routing. */
async function loadNextForOutcome(
  resultingVersionId: string | null
): Promise<{ next: SetupVersionRow | null; bikeTitle: string }> {
  if (!resultingVersionId) return { next: null, bikeTitle: "the bike" };
  try {
    const { data: rv } = await supabase
      .from("setup_versions")
      .select(VERSION_COLUMNS)
      .eq("id", resultingVersionId)
      .maybeSingle();
    const next = (rv as unknown as SetupVersionRow) ?? null;
    if (!next?.bike_id) return { next, bikeTitle: "the bike" };
    const { data: bike } = await supabase
      .from("bikes")
      .select("make, model, year, nickname")
      .eq("id", next.bike_id)
      .maybeSingle();
    const bikeTitle =
      bike?.nickname ||
      [bike?.make, bike?.model].filter(Boolean).join(" ") ||
      "the bike";
    return { next, bikeTitle };
  } catch {
    return { next: null, bikeTitle: "the bike" };
  }
}

export function OutcomeCheckinCard({
  surface = "tune",
  style,
  onEligibility,
}: {
  /** Which tab hosts this instance — analytics only. */
  surface?: "home" | "tune";
  /** Container override — hosts with their own padding zero out the default
   *  16px side margins. Nothing renders (and no style applies) when the card
   *  isn't eligible. */
  style?: StyleProp<ViewStyle>;
  /**
   * Reports whether the check-in card is showing after each focus-time
   * eligibility check. Lets sibling cards yield — check-in wins, never two
   * cards at once.
   */
  onEligibility?: (visible: boolean) => void;
}) {
  const { colors: C } = useTheme();
  const router = useRouter();

  const [card, setCard] = useState<CardState | null>(null);
  const onEligibilityRef = useRef(onEligibility);
  onEligibilityRef.current = onEligibility;
  // Ride-reminder tap while this tab is already focused (incl. the delayed
  // cold-start handler): bump a tick so the focus-time eligibility check
  // re-runs and picks up the arrival flag it would otherwise have missed.
  const [arrivalTick, setArrivalTick] = useState(0);
  useEffect(
    () => subscribeReminderArrival(() => setArrivalTick((t) => t + 1)),
    []
  );

  // Warm resume: useFocusEffect never re-fires when the app returns from the
  // background onto an already-focused tab — the dominant way riders come
  // back (including via the reminder's banner) — so without this, resuming
  // never re-evaluates eligibility. Bump a tick on background→active so the
  // focus-time check re-runs on the focused instance. Debounce: one bump per
  // background episode (handledBackgroundRef), and iOS 'inactive' flaps
  // (control center, notification shade) never set backgroundedAtMs, so they
  // trigger nothing. A >1h background gap starts a new session for the
  // one-card-per-session latch.
  const [resumeTick, setResumeTick] = useState(0);
  const handledBackgroundRef = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") {
        backgroundedAtMs = Date.now();
        return;
      }
      if (next !== "active") return;
      const at = backgroundedAtMs;
      if (at == null || handledBackgroundRef.current === at) return;
      handledBackgroundRef.current = at;
      if (Date.now() - at > SESSION_RESET_MS) shownThisSession = false;
      setResumeTick((t) => t + 1);
    });
    return () => sub.remove();
  }, []);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(6)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    []
  );

  // Subtle entrance once an eligible card is set.
  useEffect(() => {
    if (!card) return;
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [card, opacity, translateY]);

  const animateOut = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setCard(null);
      setConfirmation(null);
    });
  }, [opacity]);

  useFocusEffect(
    useCallback(() => {
      // arrivalTick/resumeTick are the re-run triggers for reminder-tap pings
      // and warm resumes; reference them so exhaustive-deps counts them as used.
      void arrivalTick;
      void resumeTick;
      let cancelled = false;
      (async () => {
        let visible = false;
        try {
          if (shownThisSession || card) {
            visible = !!card;
            return;
          }

          const { data: auth } = await supabase.auth.getUser();
          const uid = auth?.user?.id;
          if (!uid) return; // guests / signed-out never see the card

          const cutoff = new Date(Date.now() - TWELVE_HOURS_MS).toISOString();

          // Read-and-clear the ride-reminder tap flag once, up front. Branch 2
          // uses it to bypass the 12h age gate and to load the exact version a
          // reminder targeted; consuming here spends it on one attempt.
          const arrival = await consumeReminderArrival();

          // ── Branch 1 (wins): outcome check-in on the last refinement. The
          //    outcome is the label on every downstream row, so it fires first
          //    even on a reminder tap; answering it flows straight into the
          //    picker for the setup just rated (outcome → chips, one funnel). ──
          const { data: row, error } = await supabase
            .from("ride_feedback")
            .select("id, symptoms, resulting_version_id")
            .eq("user_id", uid)
            .not("resulting_version_id", "is", null)
            .is("outcome", null)
            .lt("created_at", cutoff)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (cancelled) return;

          if (!error && row?.id && !(await isSnoozedOrDismissed(row.id))) {
            if (cancelled) return;
            const { next, bikeTitle } = await loadNextForOutcome(
              row.resulting_version_id
            );
            if (cancelled) return;
            shownThisSession = true;
            visible = true;
            setCard({
              kind: "outcome",
              feedbackId: row.id,
              title: titleFromSymptoms(row.symptoms),
              nextVersion: next,
              nextBikeTitle: bikeTitle,
              resultingVersionId: row.resulting_version_id ?? null,
            });
            void logEvent("checkin_shown", { feedback_id: row.id, surface });
            return;
          }

          // ── Branch 2 (no outcome to record): give feedback on an
          //    uncritiqued setup. A targeted reminder tap points at a specific
          //    version (baseline OR the refinement it just produced) and lands
          //    in the picker for it — e.g. a baseline first ride, or a
          //    refinement whose outcome was already answered; organic focus
          //    uses the newest version and only nudges baselines. ──
          const { data: v, error: vErr } = arrival?.versionId
            ? await supabase
                .from("setup_versions")
                .select(VERSION_COLUMNS)
                .eq("user_id", uid)
                .not("bike_id", "is", null)
                .eq("id", arrival.versionId)
                .maybeSingle()
            : await supabase
                .from("setup_versions")
                .select(VERSION_COLUMNS)
                .eq("user_id", uid)
                .not("bike_id", "is", null)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
          if (cancelled || vErr) return;

          const version = (v as unknown as SetupVersionRow) ?? null;

          // arrival was consumed up front (see Branch 1). It bypasses the 12h
          // age gate and, only for the version the reminder named, admits a
          // refinement version so the tap can open the picker for it.
          const viaReminder =
            !!arrival &&
            (!arrival.versionId || arrival.versionId === version?.id);

          if (
            !version ||
            !isFirstRideEligible(version, Date.now(), {
              bypassAgeGate: viaReminder,
              allowRefinement: viaReminder,
            })
          ) {
            return;
          }

          // Already critiqued? Then the loop is running — nothing to prompt.
          const { data: fb, error: fbErr } = await supabase
            .from("ride_feedback")
            .select("id")
            .eq("setup_version_id", version.id)
            .limit(1)
            .maybeSingle();
          if (cancelled || fbErr || fb?.id) return;

          if (await isSnoozedOrDismissed(`v_${version.id}`)) return;

          const { data: bike } = await supabase
            .from("bikes")
            .select("make, model, year, nickname")
            .eq("id", version.bike_id)
            .maybeSingle();
          if (cancelled) return;

          const bikeTitle =
            bike?.nickname ||
            [bike?.make, bike?.model].filter(Boolean).join(" ") ||
            "the bike";

          shownThisSession = true;
          visible = true;
          setCard({
            kind: "first_ride",
            version,
            bikeTitle,
            title: `How did the ${bikeTitle} feel on v${version.version_number}?`,
          });
          void logEvent("preride_shown", {
            version_id: version.id,
            bike_id: version.bike_id,
            surface,
            shown_via_reminder: viaReminder,
          });
        } catch {
          // fail-silent: the check-in must never disturb the host tab
        } finally {
          if (!cancelled) onEligibilityRef.current?.(visible);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [card, surface, arrivalTick, resumeTick])
  );

  const onAnswer = async (outcome: FeedbackOutcome) => {
    if (!card || card.kind !== "outcome" || answering || confirmation) return;
    setAnswering(true);
    try {
      // Record the outcome first — it's the label on the whole dataset and must
      // never be skipped. Only continue into the picker once it's persisted.
      await updateFeedbackOutcome(card.feedbackId, outcome);
      // The outcome is answered — the pending "How did the new setup feel?"
      // reminder aimed at this setup has nothing left to ask.
      void cancelRideReminderForVersion(card.resultingVersionId);
      void logEvent("checkin_answered", {
        feedback_id: card.feedbackId,
        outcome,
        surface,
      });
      if (card.nextVersion) {
        // outcome → chips as one funnel: continue into the picker for the setup
        // just rated so the rider gives full feedback → next refinement.
        const params = buildRefineParams(card.nextVersion, card.nextBikeTitle);
        animateOut();
        router.push({ pathname: "/tune-feedback", params } as any);
      } else {
        // Couldn't resolve the rated setup — just confirm and dismiss.
        setConfirmation(CONFIRMATIONS[outcome]);
        hideTimerRef.current = setTimeout(animateOut, CONFIRM_VISIBLE_MS);
      }
    } catch {
      // write failed — drop the card quietly; eligibility re-offers it later
      animateOut();
    } finally {
      setAnswering(false);
    }
  };

  const onFirstRideCta = () => {
    if (!card || card.kind !== "first_ride") return;
    const params = buildRefineParams(card.version, card.bikeTitle);
    animateOut();
    router.push({ pathname: "/tune-feedback", params } as any);
  };

  const readDismissRecord = async (id: string): Promise<DismissRecord | null> => {
    try {
      const raw = await AsyncStorage.getItem(dismissKey(id));
      return raw ? (JSON.parse(raw) as DismissRecord) : null;
    } catch {
      return null; // unreadable — start a fresh record
    }
  };

  /** "Haven't ridden yet": pure 3-day snooze. Never counts toward the
   *  2-strike limit — a rider who genuinely hasn't ridden twice must not
   *  lose the loop-closing prompt forever. */
  const onSnooze = async () => {
    if (!card || confirmation) return;
    const id = dismissIdOf(card);
    const rec = applySnooze(await readDismissRecord(id), Date.now());
    AsyncStorage.setItem(dismissKey(id), JSON.stringify(rec)).catch(() => {});
    void logEvent("checkin_dismissed", {
      checkin_id: id,
      kind: card.kind,
      action: "snooze",
      count: rec.count,
      surface,
    });
    animateOut();
  };

  /** Explicit ✕: the only dismissal that counts toward MAX_DISMISSALS. */
  const onDismiss = async () => {
    if (!card || confirmation) return;
    const id = dismissIdOf(card);
    const rec = applyDismiss(await readDismissRecord(id), Date.now());
    AsyncStorage.setItem(dismissKey(id), JSON.stringify(rec)).catch(() => {});
    void logEvent("checkin_dismissed", {
      checkin_id: id,
      kind: card.kind,
      action: "dismiss",
      count: rec.count,
      surface,
    });
    animateOut();
  };

  if (!card) return null;

  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: C.CARD, opacity, transform: [{ translateY }] },
        style,
      ]}
    >
      {confirmation ? (
        <Text style={[styles.confirmText, { color: C.TEXT }]}>
          {confirmation}
        </Text>
      ) : (
        <>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: C.TEXT }]}>{card.title}</Text>
            <Pressable
              onPress={onDismiss}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Dismiss check-in"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={16} color={C.MUTED} />
            </Pressable>
          </View>

          {card.kind === "outcome" ? (
            <View style={styles.buttonRow}>
              <Pressable
                onPress={() => onAnswer("improved")}
                disabled={answering}
                style={[styles.btn, { backgroundColor: C.ACCENT }]}
              >
                <Text style={styles.btnPrimaryText}>Better</Text>
              </Pressable>
              <Pressable
                onPress={() => onAnswer("same")}
                disabled={answering}
                style={[styles.btn, styles.btnGhost, { borderColor: C.BORDER }]}
              >
                <Text style={[styles.btnGhostText, { color: C.TEXT }]}>Same</Text>
              </Pressable>
              <Pressable
                onPress={() => onAnswer("worse")}
                disabled={answering}
                style={[styles.btn, styles.btnGhost, { borderColor: C.BORDER }]}
              >
                <Text style={[styles.btnGhostText, { color: C.TEXT }]}>Worse</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.buttonRow}>
              <Pressable
                onPress={onFirstRideCta}
                style={[styles.btn, { backgroundColor: C.ACCENT }]}
              >
                <Text style={styles.btnPrimaryText}>Give feedback</Text>
              </Pressable>
            </View>
          )}

          <Pressable onPress={onSnooze} hitSlop={8} style={styles.dismissLink}>
            <Text style={[styles.dismissText, { color: C.MUTED }]}>
              Haven't ridden yet
            </Text>
          </Pressable>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },
  closeBtn: {
    marginTop: 1,
    padding: 2,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  btn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  btnPrimaryText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },
  btnGhostText: {
    fontWeight: "700",
    fontSize: 14,
  },
  dismissLink: {
    alignSelf: "center",
    marginTop: 10,
    paddingVertical: 2,
  },
  dismissText: {
    fontSize: 12,
    fontWeight: "600",
  },
  confirmText: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    paddingVertical: 6,
  },
});
