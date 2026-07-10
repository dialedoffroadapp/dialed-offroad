// lib/rideReminder.ts
// ONE local ride-reminder notification, scheduled when a baseline setup
// version is created and cancelled the moment the rider gives feedback on
// that version. Local scheduling only — no push backend, no tokens, no
// server work.
//
// NOTE: expo-notifications ships as a config plugin (see app.config.ts).
// A new dev client / production build is required before any of this
// functions — it is inert in builds produced before the plugin was added.
//
// Invariants:
// - max ONE pending reminder at a time (scheduling replaces any prior one)
// - never schedules without OS permission already granted; the permission
//   ask itself lives on the results screen (the value moment), not here
// - the inline pre-prompt is never re-shown within 30 days of a decline,
//   and the OS dialog is never shown cold

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/** Single pending-reminder record: { versionId, notificationId }. Keyed by
 *  the setup_versions id it reminds about (one key, since only one reminder
 *  may be pending at a time). */
const REMINDER_KEY = "ride_reminder_v1";
/** Timestamp of the last inline-prompt decline — 30-day re-ask snooze. */
const PROMPT_DECLINED_AT_KEY = "notif_prompt_declined_at_v1";
const PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
const ANDROID_CHANNEL_ID = "ride-reminders";
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

type ReminderRecord = { versionId: string; notificationId: string };

const supported = () => Platform.OS !== "web";

// Foreground presentation: if the reminder fires while the app is open,
// still show it as a banner rather than dropping it silently.
if (supported()) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Ride reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export type NotifPermission = "granted" | "denied" | "undetermined";

export async function getNotificationPermission(): Promise<NotifPermission> {
  if (!supported()) return "denied";
  try {
    const s = await Notifications.getPermissionsAsync();
    if (s.granted) return "granted";
    if (s.canAskAgain === false) return "denied";
    return "undetermined";
  } catch {
    return "denied";
  }
}

/** True when the inline "Want a nudge…?" rationale should render: platform
 *  supported, OS permission never asked, and no decline within 30 days. */
export async function shouldOfferNotificationPrompt(): Promise<boolean> {
  if (!supported()) return false;
  if ((await getNotificationPermission()) !== "undetermined") return false;
  try {
    const raw = await AsyncStorage.getItem(PROMPT_DECLINED_AT_KEY);
    if (raw && Date.now() - Number(raw) < PROMPT_SNOOZE_MS) return false;
  } catch {
    // unreadable timestamp → offer
  }
  return true;
}

/** Inline rationale declined: never show the OS dialog, snooze 30 days. */
export async function declineNotificationPrompt(): Promise<void> {
  try {
    await AsyncStorage.setItem(PROMPT_DECLINED_AT_KEY, String(Date.now()));
  } catch {
    // non-critical
  }
}

/** Show the OS dialog (call only after the inline rationale was accepted). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!supported()) return false;
  try {
    const s = await Notifications.requestPermissionsAsync();
    if (s.granted) {
      await ensureAndroidChannel();
      return true;
    }
    return false;
  } catch (err) {
    console.error("rideReminder: permission request failed", err);
    return false;
  }
}

/**
 * min(next Saturday 9:00am local, now + 48h).
 * The min() matters: a rider who onboards Saturday afternoon must not wait
 * 7 days for first touch — they get the +48h slot instead.
 */
export function nextReminderDate(now: Date = new Date()): Date {
  const saturday = new Date(now);
  const day = now.getDay(); // 0 Sun … 6 Sat
  let daysAhead = (6 - day + 7) % 7; // days until Saturday (0 if today)
  const candidate = new Date(now);
  candidate.setDate(now.getDate() + daysAhead);
  candidate.setHours(9, 0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    // Saturday 9am already passed today → next week's Saturday.
    candidate.setDate(candidate.getDate() + 7);
  }
  saturday.setTime(candidate.getTime());

  const in48h = new Date(now.getTime() + FORTY_EIGHT_HOURS_MS);
  return saturday.getTime() <= in48h.getTime() ? saturday : in48h;
}

/**
 * Schedule THE ride reminder for a just-created setup version. Replaces any
 * pending reminder (also how a superseding version reschedules it). No-op
 * without granted permission.
 */
export async function scheduleRideReminder(params: {
  versionId: string;
  versionNumber: number;
  bikeName: string;
}): Promise<void> {
  if (!supported()) return;
  try {
    if ((await getNotificationPermission()) !== "granted") return;

    await cancelPendingRideReminder();
    await ensureAndroidChannel();

    const date = nextReminderDate();
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `How did the ${params.bikeName} feel on v${params.versionNumber}?`,
        body: "Tell Dialed and get your refined setup — takes 30 seconds.",
        data: {
          kind: "ride_reminder",
          // Existing app scheme; "/" resolves through IndexGate → /(tabs)
          // Home for completed users, where the check-in card is waiting.
          url: "dialedoffroad:///",
          version_id: params.versionId,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
    });

    const record: ReminderRecord = {
      versionId: params.versionId,
      notificationId,
    };
    await AsyncStorage.setItem(REMINDER_KEY, JSON.stringify(record));
  } catch (err) {
    console.error("rideReminder: schedule failed", err);
  }
}

/** Cancel whatever reminder is pending, regardless of version. */
export async function cancelPendingRideReminder(): Promise<void> {
  if (!supported()) return;
  try {
    const raw = await AsyncStorage.getItem(REMINDER_KEY);
    if (!raw) return;
    const rec = JSON.parse(raw) as ReminderRecord;
    if (rec?.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(rec.notificationId);
    }
    await AsyncStorage.removeItem(REMINDER_KEY);
  } catch (err) {
    console.error("rideReminder: cancel failed", err);
  }
}

/** Cancel the reminder iff it points at this version — called when feedback
 *  for that version lands (the loop closed by itself). */
export async function cancelRideReminderForVersion(
  versionId: string | null | undefined
): Promise<void> {
  if (!supported() || !versionId) return;
  try {
    const raw = await AsyncStorage.getItem(REMINDER_KEY);
    if (!raw) return;
    const rec = JSON.parse(raw) as ReminderRecord;
    if (rec?.versionId !== versionId) return;
    if (rec?.notificationId) {
      await Notifications.cancelScheduledNotificationAsync(rec.notificationId);
    }
    await AsyncStorage.removeItem(REMINDER_KEY);
  } catch (err) {
    console.error("rideReminder: cancel-for-version failed", err);
  }
}
