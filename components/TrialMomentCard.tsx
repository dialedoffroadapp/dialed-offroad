// components/TrialMomentCard.tsx
// Home-tab trial moments. Two cards, mutually exclusive (lib/trialStatus
// pickTrialCard — countdown always wins):
//
// "countdown" — day 5+ of the trial (daysRemaining <= 2): value recap built
// from the rider's actual data (setup versions, refinements, bike) + a
// conversion CTA. Before day 5 the hero's small "Trial · N days left" line
// (rendered by Home, not here) is the only trial surface — subtle, not naggy.
//
// "value" — day 1-3 of the account, in trial, with a generated tune: the
// anti-abandonment moment for the 48.8% who disable auto-renew before the
// trial proves value. One showing lifetime: the X writes an AsyncStorage
// flag and it never returns.

import { paywallHref } from "../lib/paywall";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";
import {
  pickTrialCard,
  TrialCardKind,
  TrialStatus,
} from "../lib/trialStatus";
import { logEvent } from "../lib/usage";

const VALUE_CARD_DISMISSED_KEY = "trial_value_card_dismissed_v1";

// Once-per-session event guards (module scope survives remounts).
let countdownShownLogged = false;
let valueShownLogged = false;

type SupportData = {
  accountAgeDays: number | null;
  versionCount: number;
  refinementCount: number;
  bikeTitle: string;
  hasTune: boolean;
  valueCardDismissed: boolean;
  /** |fork comp clicks − stock| for the newest tuned bike, when stock data
   *  exists in the catalog (v_bikes_with_stock). null = no stat available. */
  stockDeltaClicks: number | null;
};

async function loadSupportData(): Promise<SupportData | null> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user?.id) return null;

  const createdMs = user.created_at ? new Date(user.created_at).getTime() : NaN;
  const accountAgeDays = Number.isFinite(createdMs)
    ? Math.floor((Date.now() - createdMs) / (24 * 60 * 60 * 1000))
    : null;

  let valueCardDismissed = false;
  try {
    valueCardDismissed =
      (await AsyncStorage.getItem(VALUE_CARD_DISMISSED_KEY)) === "1";
  } catch {
    // unreadable → treat as not dismissed
  }

  const { data: versions } = await supabase
    .from("setup_versions")
    .select("source, bike_id, fork_comp_clicks")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (versions ?? []) as {
    source: string;
    bike_id: string | null;
    fork_comp_clicks: number | null;
  }[];

  let bikeTitle = "your bike";
  let stockDeltaClicks: number | null = null;
  const newest = rows.find((r) => r.bike_id) ?? null;
  if (newest?.bike_id) {
    const { data: bike } = await supabase
      .from("v_bikes_with_stock")
      .select("make, model, nickname, stock_fork_comp")
      .eq("id", newest.bike_id)
      .maybeSingle();
    bikeTitle =
      bike?.nickname ||
      [bike?.make, bike?.model].filter(Boolean).join(" ") ||
      "your bike";
    if (
      typeof bike?.stock_fork_comp === "number" &&
      typeof newest.fork_comp_clicks === "number"
    ) {
      const d = Math.abs(newest.fork_comp_clicks - bike.stock_fork_comp);
      if (d > 0) stockDeltaClicks = d;
    }
  }

  return {
    accountAgeDays,
    versionCount: rows.length,
    refinementCount: rows.filter((r) => r.source === "refinement").length,
    bikeTitle,
    hasTune: rows.length > 0,
    valueCardDismissed,
    stockDeltaClicks,
  };
}

export function TrialMomentCard({ status }: { status: TrialStatus | null }) {
  const { colors: C } = useTheme();
  const router = useRouter();
  const [support, setSupport] = useState<SupportData | null>(null);

  const isInTrial = !!status?.isInTrial;
  useEffect(() => {
    if (!isInTrial) {
      setSupport(null);
      return;
    }
    let mounted = true;
    loadSupportData()
      .then((d) => {
        if (mounted) setSupport(d);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [isInTrial, status?.daysRemaining]);

  // Local dismissal so the value card disappears immediately on X, before
  // the AsyncStorage write round-trips.
  const [dismissedNow, setDismissedNow] = useState(false);

  if (!status || !support) return null;

  const kind: TrialCardKind = pickTrialCard({
    isInTrial: status.isInTrial,
    daysRemaining: status.daysRemaining,
    accountAgeDays: support.accountAgeDays,
    hasTune: support.hasTune,
    valueCardDismissed: support.valueCardDismissed || dismissedNow,
  });

  if (kind === "countdown") {
    return <CountdownCard status={status} support={support} C={C} router={router} />;
  }
  if (kind === "value") {
    return (
      <ValueCard
        support={support}
        C={C}
        onDismiss={() => {
          setDismissedNow(true);
          AsyncStorage.setItem(VALUE_CARD_DISMISSED_KEY, "1").catch(() => {});
          void logEvent("trial_value_card_dismissed", {});
        }}
      />
    );
  }
  return null;
}

function ValueCard({
  support,
  C,
  onDismiss,
}: {
  support: SupportData;
  C: any;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!valueShownLogged) {
      valueShownLogged = true;
      void logEvent("trial_value_card_shown", {
        has_stock_delta: support.stockDeltaClicks !== null,
        version_count: support.versionCount,
      });
    }
  }, [support.stockDeltaClicks, support.versionCount]);

  const stat =
    support.stockDeltaClicks !== null
      ? `Fork compression: ${support.stockDeltaClicks} click${
          support.stockDeltaClicks === 1 ? "" : "s"
        } off stock. Tuned for your weight and style.`
      : "v1 saved. Refine after your next ride.";

  return (
    <View style={[styles.card, { backgroundColor: C.CARD, borderColor: C.BORDER }]}>
      <View style={styles.row}>
        <View style={[styles.iconTile, { backgroundColor: "rgba(29,155,240,0.14)" }]}>
          <Ionicons name="checkmark-circle-outline" size={19} color={C.ACCENT} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: C.TEXT }]} numberOfLines={1}>
            Your {support.bikeTitle} is set up for YOU now
          </Text>
          <Text style={[styles.sub, { color: C.MUTED }]} numberOfLines={2}>
            {stat}
          </Text>
        </View>
        <Pressable
          onPress={onDismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          style={styles.closeBtn}
        >
          <Ionicons name="close" size={16} color={C.MUTED} />
        </Pressable>
      </View>
    </View>
  );
}

function CountdownCard({
  status,
  support,
  C,
  router,
}: {
  status: TrialStatus;
  support: SupportData;
  C: any;
  router: ReturnType<typeof useRouter>;
}) {
  useEffect(() => {
    if (!countdownShownLogged) {
      countdownShownLogged = true;
      void logEvent("trial_countdown_shown", {
        days_remaining: status.daysRemaining,
        version_count: support.versionCount,
      });
    }
  }, [status.daysRemaining, support.versionCount]);

  const n = status.daysRemaining ?? 0;
  const title = `Your trial ends in ${n === 1 ? "1 day" : `${n} days`}`;

  const plur = (c: number, w: string) => `${c} ${w}${c === 1 ? "" : "s"}`;
  const recap =
    support.versionCount > 0
      ? `${support.bikeTitle}: ${plur(support.versionCount, "setup version")}${
          support.refinementCount > 0
            ? `, ${plur(support.refinementCount, "refinement")}`
            : ""
        }. All of it stays with Pro.`
      : "Your setup and history stay with Pro.";

  const onCta = () => {
    void logEvent("trial_countdown_cta_tapped", {
      days_remaining: status.daysRemaining,
    });
    router.push(paywallHref("trial_moment_card", "back") as any);
  };

  return (
    <View style={[styles.card, { backgroundColor: C.CARD, borderColor: C.ACCENT }]}>
      <View style={styles.row}>
        <View style={[styles.iconTile, { backgroundColor: "rgba(29,155,240,0.14)" }]}>
          <Ionicons name="hourglass-outline" size={19} color={C.ACCENT} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: C.TEXT }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.sub, { color: C.MUTED }]} numberOfLines={2}>
            {recap}
          </Text>
        </View>
      </View>
      <Pressable onPress={onCta} style={[styles.cta, { backgroundColor: C.ACCENT }]}>
        <Text style={styles.ctaText}>Keep your setup dialed</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 15,
    fontWeight: "800",
  },
  sub: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 12,
  },
  ctaText: { color: "#fff", fontWeight: "900", fontSize: 14 },
  closeBtn: {
    alignSelf: "flex-start",
    padding: 2,
  },
});
