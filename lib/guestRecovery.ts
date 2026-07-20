// lib/guestRecovery.ts
// ONE local notification recovering an abandoned guest onboarding: a guest
// (no session) generated a tune, saw the locked results, and backgrounded the
// app without signing up. 30 hours later — clamped into the 9am–8pm civil
// window — one nudge points back at the tune they already invested in.
// Mirrors lib/trialReminder.ts patterns.
//
// Rules:
// - NEVER asks for notification permission — a typical guest has never been
//   asked (the ask lives at feedback-submit success, post-signup), so this
//   is usually a silent no-op. That's by design for this pass: no
//   guest-facing permission prompt.
// - max one pending recovery notification (scheduling replaces, so the timer
//   restarts on each abandon — it fires 30h after the LAST one)
// - cancelled the moment any session exists (signup or sign-in — see the
//   auth listener in app/_layout.tsx)
// - no navigation payload handling needed: a cold-start tap boots through
//   IndexGate, which already resumes results_locked + pending tune onto
//   /tune-results; a warm tap foregrounds the app where the guest left it.
//
// Wanted usage events for the next usage_events CHECK-constraint migration
// (NOT added in this pass — no new event types): guest_recovery_scheduled,
// guest_recovery_tapped. Until then this surface is analytics-dark; guests
// are session-less anyway, so rows would queue until signup.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  clampToDaytime,
  ensureAndroidChannel,
  getNotificationPermission,
  RIDE_REMINDER_CHANNEL_ID,
} from "./rideReminder";

/** { notificationId } for the single pending recovery notification. */
const GUEST_RECOVERY_KEY = "guest_recovery_v1";
const FIRE_AFTER_MS = 30 * 60 * 60 * 1000;

type GuestRecoveryRecord = { notificationId: string };

const supported = () => Platform.OS !== "web";

async function readRecord(): Promise<GuestRecoveryRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(GUEST_RECOVERY_KEY);
    return raw ? (JSON.parse(raw) as GuestRecoveryRecord) : null;
  } catch {
    return null;
  }
}

export async function cancelGuestRecoveryReminder(): Promise<void> {
  if (!supported()) return;
  try {
    const rec = await readRecord();
    if (rec?.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(rec.notificationId);
    }
    if (rec) await AsyncStorage.removeItem(GUEST_RECOVERY_KEY);
  } catch (err) {
    console.error("guestRecovery: cancel failed", err);
  }
}

/**
 * Schedule the recovery notification. Call when the app backgrounds while a
 * guest sits on locked results. Silent no-op without an existing permission
 * grant (the typical guest — see header).
 */
export async function scheduleGuestRecoveryReminder(params: {
  make: string | null;
  model: string | null;
}): Promise<void> {
  if (!supported()) return;
  try {
    if ((await getNotificationPermission()) !== "granted") return;

    await cancelGuestRecoveryReminder(); // never more than one pending
    await ensureAndroidChannel();

    const bikeName =
      [params.make, params.model].filter(Boolean).join(" ") || "bike";
    const date = clampToDaytime(new Date(Date.now() + FIRE_AFTER_MS));

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `Your ${bikeName} setup is still waiting`,
        body: "7 days free to unlock it.",
        data: {
          kind: "guest_recovery",
          url: "dialedoffroad:///",
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        ...(Platform.OS === "android"
          ? { channelId: RIDE_REMINDER_CHANNEL_ID }
          : {}),
      },
    });

    const rec: GuestRecoveryRecord = { notificationId };
    await AsyncStorage.setItem(GUEST_RECOVERY_KEY, JSON.stringify(rec));
  } catch (err) {
    console.error("guestRecovery: schedule failed", err);
  }
}
