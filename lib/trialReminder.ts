// lib/trialReminder.ts
// ONE local notification, 2 days before trial expiry ("day 5" of a 7-day
// trial), targeting the bail cohort: 48.8% of trials disable auto-renew
// mid-trial, and that decision happens DURING the trial — day 6 previously
// looked identical to day 1. Mirrors lib/rideReminder.ts patterns.
//
// Rules (see reconcileTrialReminder):
// - never asks for notification permission — only schedules if the ride
//   reminder flow already got it granted
// - max one pending trial notification (scheduling replaces)
// - never scheduled for lapsed/expired (fire date must be in the future and
//   status.isInTrial true)
// - willRenew === true (auto-renew on, the elite-converting cohort) →
//   cancelled/not scheduled: they convert silently; a reminder can only
//   invite cancellation. willRenew is re-checked on every app-observation of
//   trial state — the closest a local notification gets to "fire-evaluation
//   time".
// - conversion or expiry (isInTrial flips false) → cancelled

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  ensureAndroidChannel,
  getNotificationPermission,
  RIDE_REMINDER_CHANNEL_ID,
} from "./rideReminder";
import { MS_PER_DAY, TrialStatus } from "./trialStatus";

/** { expirationDate, notificationId } for the single pending reminder. */
const TRIAL_REMINDER_KEY = "trial_reminder_v1";
const FIRE_DAYS_BEFORE_EXPIRY = 2;

type TrialReminderRecord = { expirationDate: string; notificationId: string };

const supported = () => Platform.OS !== "web";

async function readRecord(): Promise<TrialReminderRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(TRIAL_REMINDER_KEY);
    return raw ? (JSON.parse(raw) as TrialReminderRecord) : null;
  } catch {
    return null;
  }
}

export async function cancelTrialReminder(): Promise<void> {
  if (!supported()) return;
  try {
    const rec = await readRecord();
    if (rec?.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(rec.notificationId);
    }
    if (rec) await AsyncStorage.removeItem(TRIAL_REMINDER_KEY);
  } catch (err) {
    console.error("trialReminder: cancel failed", err);
  }
}

/**
 * Reconcile the pending trial reminder against the currently observed trial
 * state. Called whenever the app reads trial status (Home focus). Idempotent.
 */
export async function reconcileTrialReminder(
  status: TrialStatus,
  bikeName: string
): Promise<void> {
  if (!supported()) return;
  try {
    // Converted, expired, lapsed, or on track to auto-convert → no reminder.
    if (!status.isInTrial || status.willRenew === true || !status.expirationDate) {
      await cancelTrialReminder();
      return;
    }

    // Only meaningful while there is still runway: the reminder fires at
    // expiry - 2d, and inside that window the in-app countdown card is the
    // surface (daysRemaining <= 2 → nothing to schedule).
    if ((status.daysRemaining ?? 0) <= FIRE_DAYS_BEFORE_EXPIRY) {
      await cancelTrialReminder();
      return;
    }

    // Never re-ask permission for this — piggyback only on an existing grant.
    if ((await getNotificationPermission()) !== "granted") return;

    const fireAtMs =
      new Date(status.expirationDate).getTime() -
      FIRE_DAYS_BEFORE_EXPIRY * MS_PER_DAY;
    if (!Number.isFinite(fireAtMs) || fireAtMs <= Date.now()) return;

    const existing = await readRecord();
    if (existing?.expirationDate === status.expirationDate) return; // already set

    await cancelTrialReminder(); // never more than one pending
    await ensureAndroidChannel();

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Your Dialed trial ends in 2 days",
        body: `Your ${bikeName} setup and history stay with Pro.`,
        data: {
          kind: "trial_reminder",
          // "/" resolves through IndexGate → /(tabs) Home, where the
          // countdown card is showing by then (daysRemaining <= 2).
          url: "dialedoffroad:///",
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(fireAtMs),
        ...(Platform.OS === "android"
          ? { channelId: RIDE_REMINDER_CHANNEL_ID }
          : {}),
      },
    });

    const rec: TrialReminderRecord = {
      expirationDate: status.expirationDate,
      notificationId,
    };
    await AsyncStorage.setItem(TRIAL_REMINDER_KEY, JSON.stringify(rec));
  } catch (err) {
    console.error("trialReminder: reconcile failed", err);
  }
}
