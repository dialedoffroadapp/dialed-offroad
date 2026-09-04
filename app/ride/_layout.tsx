// app/ride/_layout.tsx — the ride-day stack (Start Riding → pickers → Today's
// setup → ride mode → log / adjust / retune → end). Fonts come from the v3
// pack; ride mode itself disables the back gesture (it is left only through
// End ride or Home).
import { Stack } from "expo-router";
import React from "react";
import { useV3Fonts, V3 } from "../../components/v3/theme";

export default function RideLayout() {
  useV3Fonts();
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right", contentStyle: { backgroundColor: V3.carbon } }}>
      <Stack.Screen name="mode" options={{ gestureEnabled: false, animation: "fade" }} />
      <Stack.Screen name="today" options={{ gestureEnabled: false }} />
      <Stack.Screen name="end" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
