// app/garage-bike.tsx — v3 per-bike page route (from the 2+ bike list).
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { BikePage } from "../components/garage/BikePage";

export default function GarageBikeRoute() {
  const { bikeId } = useLocalSearchParams<{ bikeId?: string }>();
  return <BikePage bikeId={String(bikeId ?? "")} />;
}
