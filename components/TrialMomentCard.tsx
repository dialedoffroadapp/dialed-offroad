// components/TrialMomentCard.tsx
// Home-tab trial moments. Two cards, mutually exclusive (lib/trialStatus
// pickTrialCard — countdown always wins):
//
// "countdown" — day 5+ of the trial (daysRemaining <= 2): value recap built
// from the rider's actual data (setup versions, refinements, bike) + a
// conversion CTA. Before day 5 the hero's small "Trial · N days left" line
// (rendered by Home, not here) is the only trial surface — subtle, not naggy.

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

// Once-per-session event guards (module scope survives remounts).
let countdownShownLogged = false;

type SupportData = {
  accountAgeDays: number | null;
  versionCount: number;
  refinementCount: number;
  bikeTitle: string;
  hasTune: boolean;
};

async function loadSupportData(): Promise<SupportData | null> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user?.id) return null;

  const createdMs = user.created_at ? new Date(user.created_at).getTime() : NaN;
  const accountAgeDays = Number.isFinite(createdMs)
    ? Math.floor((Date.now() - createdMs) / (24 * 60 * 60 * 1000))
    : null;

  const { data: versions } = await supabase
    .from("setup_versions")
    .select("source, bike_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (versions ?? []) as { source: string; bike_id: string | null }[];

  let bikeTitle = "your bike";
  const newestBikeId = rows.find((r) => r.bike_id)?.bike_id ?? null;
  if (newestBikeId) {
    const { data: bike } = await supabase
      .from("bikes")
      .select("make, model, nickname")
      .eq("id", newestBikeId)
      .maybeSingle();
    bikeTitle =
      bike?.nickname ||
      [bike?.make, bike?.model].filter(Boolean).join(" ") ||
      "your bike";
  }

  return {
    accountAgeDays,
    versionCount: rows.length,
    refinementCount: rows.filter((r) => r.source === "refinement").length,
    bikeTitle,
    hasTune: rows.length > 0,
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

  if (!status || !support) return null;

  const kind: TrialCardKind = pickTrialCard({
    isInTrial: status.isInTrial,
    daysRemaining: status.daysRemaining,
    accountAgeDays: support.accountAgeDays,
    hasTune: support.hasTune,
    valueCardDismissed: true, // WS2 wires the value card
  });

  if (kind === "countdown") {
    return <CountdownCard status={status} support={support} C={C} router={router} />;
  }
  return null;
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
        } — all of it stays with Pro.`
      : "Your setup and history stay with Pro.";

  const onCta = () => {
    void logEvent("trial_countdown_cta_tapped", {
      days_remaining: status.daysRemaining,
    });
    router.push("/premium");
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
});
