// components/RideCheckinCard.tsx
// Shared card for arming the ride check-in, used on two surfaces (v2.3.0
// approved design): the Setup screen ("THE NEXT STEP", replaces the old
// inline RideItHook row) and Home ("YOUR TUNE IS LIVE", with "Not now").
// Purely presentational — arming logic, eligibility, and events live in the
// host screens; lifecycle rules in lib/rideArmCard.ts.

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { useTheme } from "../lib/theme";

export const RIDE_CHECKIN_CTA = "Set ride check-in";
export const RIDE_CHECKIN_ARMED = "Check-in set ✓";

export function RideCheckinCard({
  caps,
  body,
  armed,
  busy = false,
  onArm,
  onNotNow,
  style,
}: {
  /** Small-caps header, e.g. "THE NEXT STEP" / "YOUR TUNE IS LIVE". */
  caps: string;
  body: string;
  armed: boolean;
  busy?: boolean;
  onArm: () => void;
  /** Home only: quiet 24h snooze. */
  onNotNow?: () => void;
  /** Layout override for hosts with their own margins (Home slot). */
  style?: StyleProp<ViewStyle>;
}) {
  const { colors: C } = useTheme();
  const S = React.useMemo(() => makeStyles(C), [C]);
  const disabled = armed || busy;

  return (
    <View style={[S.card, armed ? S.cardArmed : S.cardAccent, style]}>
      <View style={S.headerRow}>
        <Ionicons name="refresh-outline" size={14} color={C.ACCENT} />
        <Text style={S.caps}>{caps}</Text>
      </View>

      <Text style={S.body}>{body}</Text>

      <Pressable
        onPress={disabled ? undefined : onArm}
        disabled={disabled}
        style={({ pressed }) => [
          S.btn,
          armed && S.btnArmed,
          pressed && !disabled && { opacity: 0.92 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={armed ? RIDE_CHECKIN_ARMED : RIDE_CHECKIN_CTA}
      >
        <Text style={[S.btnText, armed && S.btnTextArmed]}>
          {armed ? RIDE_CHECKIN_ARMED : RIDE_CHECKIN_CTA}
        </Text>
      </Pressable>

      {onNotNow && !armed ? (
        <Pressable
          onPress={onNotNow}
          style={S.notNow}
          accessibilityRole="button"
          accessibilityLabel="Not now"
        >
          <Text style={S.notNowText}>Not now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (C: {
  CARD: string;
  TEXT: string;
  MUTED: string;
  ACCENT: string;
  BORDER: string;
}) =>
  StyleSheet.create({
    // Card family: same width/radius/padding as tune-results siblings.
    card: {
      marginHorizontal: 16,
      marginTop: 12,
      padding: 16,
      borderRadius: 16,
      borderWidth: 1,
      backgroundColor: C.CARD,
    },
    cardAccent: {
      borderColor: C.ACCENT + "66",
    },
    // Armed: border drops to standard, slight dim.
    cardArmed: {
      borderColor: C.BORDER,
      opacity: 0.85,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: 8,
    },
    caps: {
      color: C.ACCENT,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1.3,
    },
    body: {
      color: C.TEXT,
      opacity: 0.9,
      fontSize: 13,
      lineHeight: 18,
      marginBottom: 12,
    },
    btn: {
      backgroundColor: C.ACCENT,
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: "center",
      justifyContent: "center",
    },
    btnArmed: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: C.ACCENT + "66",
    },
    btnText: {
      color: "#fff",
      fontWeight: "700",
      fontSize: 15,
    },
    btnTextArmed: {
      color: C.ACCENT,
    },
    notNow: {
      alignItems: "center",
      paddingVertical: 10,
      marginTop: 2,
    },
    notNowText: {
      color: C.MUTED,
      fontSize: 13,
      fontWeight: "600",
    },
  });
