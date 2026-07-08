// components/ShareSetupCard.tsx
// Branded, shareable setup image. Renders an offscreen styled card, captures
// it with react-native-view-shot, and hands the PNG to the system share sheet
// (expo-sharing, falling back to the RN Share API). No servers involved —
// this image IS marketing, so it's styled tighter than the app screens.

import * as Sharing from "expo-sharing";
import React, { useCallback, useRef, useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import ViewShot, { captureRef } from "react-native-view-shot";
import { logEvent } from "../lib/usage";

export type ShareSetupData = {
  bikeTitle: string;
  versionNumber?: number | null;
  date: string; // pre-formatted, e.g. "Jul 8"
  values: {
    forkComp: number | null;
    forkReb: number | null;
    shockLsc: number | null;
    shockHsc: number | null;
    shockReb: number | null;
    sag: number | null;
  };
};

type ShareSource = "history" | "results";

const CARD_W = 360;

const fmt = (v: number | null, digits = 0): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";

/**
 * useShareSetup — returns { shareView, share }. Mount `shareView` once in the
 * host screen (it stays offscreen and invisible); call `share(data, source)`
 * from any button. The card renders with the requested data, is captured on
 * the next frame, then shared.
 */
export function useShareSetup() {
  const shotRef = useRef<ViewShot>(null);
  const [data, setData] = useState<ShareSetupData | null>(null);
  const busyRef = useRef(false);

  const share = useCallback(async (next: ShareSetupData, source: ShareSource) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      setData(next);
      // Two frames so the offscreen card mounts and lays out before capture.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const uri = await captureRef(shotRef, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "image/png",
          dialogTitle: "Share setup",
        });
      } else {
        await Share.share({ url: uri, message: "My suspension setup" });
      }
      void logEvent("setup_shared", { source });
    } catch (e) {
      // User-cancelled shares land here on some platforms — stay quiet.
      console.warn("share setup skipped:", e);
    } finally {
      busyRef.current = false;
      setData(null);
    }
  }, []);

  const shareView = (
    <View style={styles.offscreen} pointerEvents="none">
      {data ? (
        <ViewShot ref={shotRef} options={{ format: "png", quality: 1 }}>
          <ShareCard data={data} />
        </ViewShot>
      ) : null}
    </View>
  );

  return { shareView, share };
}

/* ------------------------------- the card ------------------------------- */

function ShareCard({ data }: { data: ShareSetupData }) {
  const v = data.values;
  return (
    <View style={styles.card} collapsable={false}>
      {/* Wordmark */}
      <View style={styles.brandRow}>
        <Text style={styles.brandDialed}>DIALED</Text>
        <Text style={styles.brandOffroad}>OFFROAD</Text>
        <View style={{ flex: 1 }} />
        {typeof data.versionNumber === "number" ? (
          <View style={styles.versionPill}>
            <Text style={styles.versionPillText}>v{data.versionNumber}</Text>
          </View>
        ) : null}
      </View>

      {/* Bike + date */}
      <Text style={styles.bikeTitle} numberOfLines={2}>
        {data.bikeTitle}
      </Text>
      <Text style={styles.date}>{data.date}</Text>

      {/* Divider glow */}
      <View style={styles.divider} />

      {/* Values grid: 2 columns × 3 rows */}
      <View style={styles.grid}>
        <ValueCell label="FORK COMP" value={fmt(v.forkComp)} unit="clicks" />
        <ValueCell label="FORK REB" value={fmt(v.forkReb)} unit="clicks" />
        <ValueCell label="SHOCK LSC" value={fmt(v.shockLsc)} unit="clicks" />
        <ValueCell label="SHOCK HSC" value={fmt(v.shockHsc, 1)} unit="turns" />
        <ValueCell label="SHOCK REB" value={fmt(v.shockReb)} unit="clicks" />
        <ValueCell label="SAG" value={fmt(v.sag)} unit="mm" />
      </View>

      {/* Footer */}
      <Text style={styles.footer}>dialedoffroad.app</Text>
    </View>
  );
}

function ValueCell({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
        <Text style={styles.cellValue}>{value}</Text>
        <Text style={styles.cellUnit}>{unit}</Text>
      </View>
    </View>
  );
}

/* -------------------------------- styles -------------------------------- */

const styles = StyleSheet.create({
  offscreen: {
    position: "absolute",
    left: -9999,
    top: 0,
  },
  card: {
    width: CARD_W,
    backgroundColor: "#0B0C10",
    borderRadius: 20,
    paddingHorizontal: 26,
    paddingTop: 24,
    paddingBottom: 18,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  brandDialed: {
    color: "#F5F7FC",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 3,
  },
  brandOffroad: {
    color: "#1D9BF0",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 3,
  },
  versionPill: {
    backgroundColor: "rgba(29,155,240,0.16)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  versionPillText: { color: "#1D9BF0", fontSize: 12, fontWeight: "900" },

  bikeTitle: {
    color: "#F5F7FC",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.3,
    marginTop: 18,
  },
  date: { color: "#6B7280", fontSize: 12, fontWeight: "600", marginTop: 3 },

  divider: {
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(29,155,240,0.35)",
    marginTop: 16,
    marginBottom: 4,
    width: 44,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 10,
  },
  cell: {
    width: "50%",
    paddingVertical: 10,
  },
  cellLabel: {
    color: "#6B7280",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 3,
  },
  cellValue: { color: "#F5F7FC", fontSize: 26, fontWeight: "900" },
  cellUnit: { color: "#6B7280", fontSize: 11, fontWeight: "700" },

  footer: {
    color: "rgba(107,114,128,0.8)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textAlign: "center",
    marginTop: 16,
  },
});
