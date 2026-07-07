// components/OutcomeCheckinCard.tsx
// Post-refinement outcome check-in: "Last time you said X. Better on the new
// setup?" → Better / Same / Worse feeds ride_feedback.outcome, which the
// engine's adaptive step (last_outcome) builds on.
//
// Eligibility (checked on tab focus, one query, fail-silent):
// - newest ride_feedback for the signed-in user with a resulting refinement,
//   no outcome yet, and at least 12h old (give them time to actually ride)
// - not dismissed: AsyncStorage checkin_dismissed_${feedbackId} = {count, until};
//   skipped while `until` is in the future or after 2 dismissals
// - guests never see it; max one card per app session

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SYMPTOM_PHRASES, Tune2SymptomId } from "../lib/ai";
import { FeedbackOutcome, updateFeedbackOutcome } from "../lib/setupVersions";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import { logEvent } from "../lib/usage";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_DISMISSALS = 2;
const CONFIRM_VISIBLE_MS = 2500;

const dismissKey = (feedbackId: string) => `checkin_dismissed_${feedbackId}`;

// Max one card per app session, across tab remounts.
let shownThisSession = false;

type DismissRecord = { count: number; until: number };

const FALLBACK_TITLE = "How's the refined setup treating you?";

const CONFIRMATIONS: Record<FeedbackOutcome, string> = {
  improved: "Logged — that's what the next refinement builds on.",
  same: "Noted. Next refinement takes a bigger step.",
  worse: "Got it — next refinement goes back and tries the other direction.",
};

/** Build the card title from the feedback's symptoms jsonb. */
function titleFromSymptoms(symptoms: unknown): string {
  const issues = (Array.isArray(symptoms) ? symptoms : []).filter(
    (s: any) => s && typeof s.id === "string" && !s.protect
  );
  if (!issues.length) return FALLBACK_TITLE;

  const top = [...issues].sort(
    (a: any, b: any) => (Number(b.severity) || 0) - (Number(a.severity) || 0)
  )[0];
  const phrase = SYMPTOM_PHRASES[top.id as Tune2SymptomId];
  if (!phrase) return FALLBACK_TITLE;

  const where =
    typeof top.where === "string" && top.where.trim().length
      ? ` in ${top.where.trim().toLowerCase()}`
      : "";
  return `Last time you said ${phrase}${where}. Better on the new setup?`;
}

export function OutcomeCheckinCard() {
  const { colors: C } = useTheme();

  const [feedback, setFeedback] = useState<{ id: string; title: string } | null>(
    null
  );
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

  // Subtle entrance once eligible feedback is set.
  useEffect(() => {
    if (!feedback) return;
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
  }, [feedback, opacity, translateY]);

  const animateOut = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setFeedback(null);
      setConfirmation(null);
    });
  }, [opacity]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          if (shownThisSession || feedback) return;

          const { data: auth } = await supabase.auth.getUser();
          const uid = auth?.user?.id;
          if (!uid) return; // guests / signed-out never see the card

          const cutoff = new Date(Date.now() - TWELVE_HOURS_MS).toISOString();
          const { data: row, error } = await supabase
            .from("ride_feedback")
            .select("id, symptoms")
            .eq("user_id", uid)
            .not("resulting_version_id", "is", null)
            .is("outcome", null)
            .lt("created_at", cutoff)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error || !row?.id || cancelled) return;

          const raw = await AsyncStorage.getItem(dismissKey(row.id));
          if (raw) {
            try {
              const rec = JSON.parse(raw) as DismissRecord;
              if (
                (rec?.count ?? 0) >= MAX_DISMISSALS ||
                (rec?.until ?? 0) > Date.now()
              ) {
                return;
              }
            } catch {
              // unreadable record → treat as never dismissed
            }
          }

          if (cancelled) return;
          shownThisSession = true;
          setFeedback({ id: row.id, title: titleFromSymptoms(row.symptoms) });
          void logEvent("checkin_shown", { feedback_id: row.id });
        } catch {
          // fail-silent: the check-in must never disturb the tune flow
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [feedback])
  );

  const onAnswer = async (outcome: FeedbackOutcome) => {
    if (!feedback || answering || confirmation) return;
    setAnswering(true);
    try {
      await updateFeedbackOutcome(feedback.id, outcome);
      void logEvent("checkin_answered", {
        feedback_id: feedback.id,
        outcome,
      });
      setConfirmation(CONFIRMATIONS[outcome]);
      hideTimerRef.current = setTimeout(animateOut, CONFIRM_VISIBLE_MS);
    } catch {
      // write failed — drop the card quietly; eligibility re-offers it later
      animateOut();
    } finally {
      setAnswering(false);
    }
  };

  const onDismiss = async () => {
    if (!feedback || confirmation) return;
    let count = 0;
    try {
      const raw = await AsyncStorage.getItem(dismissKey(feedback.id));
      if (raw) count = (JSON.parse(raw) as DismissRecord)?.count ?? 0;
    } catch {
      // ignore — start a fresh record
    }
    const rec: DismissRecord = {
      count: count + 1,
      until: Date.now() + THREE_DAYS_MS,
    };
    AsyncStorage.setItem(dismissKey(feedback.id), JSON.stringify(rec)).catch(
      () => {}
    );
    void logEvent("checkin_dismissed", {
      feedback_id: feedback.id,
      count: rec.count,
    });
    animateOut();
  };

  if (!feedback) return null;

  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: C.CARD, opacity, transform: [{ translateY }] },
      ]}
    >
      {confirmation ? (
        <Text style={[styles.confirmText, { color: C.TEXT }]}>
          {confirmation}
        </Text>
      ) : (
        <>
          <Text style={[styles.title, { color: C.TEXT }]}>{feedback.title}</Text>

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

          <Pressable onPress={onDismiss} hitSlop={8} style={styles.dismissLink}>
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
  title: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
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
