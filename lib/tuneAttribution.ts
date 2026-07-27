// lib/tuneAttribution.ts
// Workstream C (v2.3.0): attribute pre-auth onboarding tune_calls rows to the
// account created at signup.
//
// The device mints ONE random uuid and sends it with signed-out baseline tune
// requests (lib/ai.ts generateTune → ai-tune stamps it on the anon
// tune_calls row). At auth success, claimAnonTuneCalls() asks the server to
// attribute matching rows via the claim_anon_tune_calls RPC
// (20260724110000_tune_calls_anon_claim.sql). All matching is server-side:
// exact anon_id + still-unclaimed (user_id is null) + 48h window.
//
// Rotation rule: the stored id is DELETED after a successful claim, so a
// second account signing up on the same device starts from a fresh id and
// its claim can never touch the first account's rows (which are also
// user_id-stamped by then — the server's one-shot guard).
//
// Every export is fail-silent: attribution must never block tune generation
// or the signup flow.

import "react-native-get-random-values";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

const ANON_TUNE_ID_KEY = "dialed_anon_tune_id_v1";

function uuidV4(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = (globalThis as any)?.crypto;
  if (typeof cryptoObj?.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes);
  } else {
    // Last-resort fallback (polyfill missing). Weaker randomness only ever
    // risks a collision/guess of a rate-limit-log claim key — never data
    // exposure, since the RPC only claims still-unattributed rows.
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The stored id, or null — never creates one (claim must not mint ids). */
export async function peekAnonTuneId(): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(ANON_TUNE_ID_KEY)) || null;
  } catch {
    return null;
  }
}

/**
 * The device's attribution id, minting it on first use. Called from the
 * signed-out generateTune path; returns null only if storage fails (the tune
 * request then simply goes out unattributed, like pre-v2.3.0 clients).
 */
export async function getOrCreateAnonTuneId(): Promise<string | null> {
  try {
    const existing = await AsyncStorage.getItem(ANON_TUNE_ID_KEY);
    if (existing) return existing;
    const created = uuidV4();
    await AsyncStorage.setItem(ANON_TUNE_ID_KEY, created);
    return created;
  } catch {
    return null;
  }
}

/**
 * Claim this device's pre-auth tune_calls rows for the signed-in user, then
 * rotate the id. Fire at auth success, next to the pre-auth analytics flush.
 * No stored id → no-op (nothing was generated pre-auth, or already claimed).
 * On RPC failure the id is KEPT so the next sign-in retries.
 */
export async function claimAnonTuneCalls(): Promise<void> {
  try {
    const anonId = await peekAnonTuneId();
    if (!anonId) return;

    const { error } = await supabase.rpc("claim_anon_tune_calls", {
      p_anon_id: anonId,
    });
    if (error) {
      console.warn("[attribution] claim failed:", error.message);
      return;
    }

    // Rotate: clear the used id; the next signed-out tune mints a fresh one.
    await AsyncStorage.removeItem(ANON_TUNE_ID_KEY);
  } catch (e) {
    console.warn("[attribution] claim unexpected error:", e);
  }
}
