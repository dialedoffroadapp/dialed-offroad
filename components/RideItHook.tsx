// components/RideItHook.tsx
// Workstream D: post-reveal hook. One quiet line under the revealed settings
// on tune-results, inviting the rider into the loop right after unlock. The
// button arms the ride check-in for this bike (the SCREEN owns the arming:
// ensure a baseline version exists, then scheduleRideReminder — which stays
// a silent no-op without an existing notification grant; the permission ask
// lives at feedback-submit, never here).
//
// Purely presentational: armed state and the arm handler are injected so the
// component stays render-testable without supabase/notification stubs.

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme";

export const RIDE_HOOK_LINE = "Ride it, then tell me how it felt. I'll adjust.";
export const RIDE_HOOK_CTA_IDLE = "Set ride check-in";
export const RIDE_HOOK_CTA_ARMED = "Check-in set ✓";

export function RideItHook({
  armed,
  busy = false,
  onArm,
}: {
  armed: boolean;
  busy?: boolean;
  onArm: () => void;
}) {
  const { colors: C } = useTheme();
  const S = React.useMemo(() => makeStyles(C), [C]);
  const disabled = armed || busy;

  return (
    <View style={S.row}>
      <Text style={S.line}>{RIDE_HOOK_LINE}</Text>
      <Pressable
        onPress={disabled ? undefined : onArm}
        disabled={disabled}
        style={[S.btn, armed && S.btnArmed]}
      >
        <Text style={[S.btnText, armed && S.btnTextArmed]}>
          {armed ? RIDE_HOOK_CTA_ARMED : RIDE_HOOK_CTA_IDLE}
        </Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (C: {
  TEXT: string;
  MUTED: string;
  ACCENT: string;
  BORDER: string;
}) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: 16,
      marginTop: 10,
      gap: 10,
    },
    line: {
      flex: 1,
      color: C.MUTED,
      fontSize: 13,
      lineHeight: 18,
    },
    // Quiet button: outline only, never competes with the primary action bar.
    btn: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: C.BORDER,
    },
    btnArmed: {
      borderColor: C.ACCENT + "66",
    },
    btnText: {
      color: C.TEXT,
      fontSize: 12,
      fontWeight: "700",
    },
    btnTextArmed: {
      color: C.ACCENT,
    },
  });
