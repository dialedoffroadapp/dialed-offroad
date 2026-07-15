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
const THIRTY_SIX_HOURS_MS = 36 * 60 * 60 * 1000;
// Civil send window: never buzz a rider before 9am or after 8pm local.
const WINDOW_OPEN_HOUR = 9;
const WINDOW_CLOSE_HOUR = 20;
// Midweek (Mon–Thu) tunes fire the coming Saturday evening — after the ride.
const SATURDAY_EVENING_HOUR = 19;

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

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Ride reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export const RIDE_REMINDER_CHANNEL_ID = ANDROID_CHANNEL_ID;

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

/** Nudge an instant into the same/next 9am–8pm local window: pull a pre-9am
 *  time up to 9am today, push an 8pm-or-later time to 9am tomorrow. */
function clampToDaytime(d: Date): Date {
  const r = new Date(d);
  const h = r.getHours();
  if (h < WINDOW_OPEN_HOUR) {
    r.setHours(WINDOW_OPEN_HOUR, 0, 0, 0);
  } else if (h >= WINDOW_CLOSE_HOUR) {
    r.setDate(r.getDate() + 1);
    r.setHours(WINDOW_OPEN_HOUR, 0, 0, 0);
  }
  return r;
}

/** Next Saturday at `hour`:00 local, strictly after `now`. */
function nextSaturday(now: Date, hour: number): Date {
  const c = new Date(now);
  const daysAhead = (6 - now.getDay() + 7) % 7; // 0 Sun … 6 Sat
  c.setDate(now.getDate() + daysAhead);
  c.setHours(hour, 0, 0, 0);
  if (c.getTime() <= now.getTime()) c.setDate(c.getDate() + 7);
  return c;
}

/**
 * Post-ride check-in time.
 *
 * Mon–Thu tunes fire the coming Saturday 7pm — riders who tune midweek usually
 * ride the weekend, so the reminder lands Saturday evening, AFTER the ride,
 * rather than 36h later when they haven't ridden yet.
 *
 * Fri–Sun tunes fire 36h after the tune, nudged into a civil 9am–8pm window so
 * they never buzz at 3am.
 */
export function nextReminderDate(now: Date = new Date()): Date {
  const day = now.getDay(); // 0 Sun … 6 Sat
  const isMidweek = day >= 1 && day <= 4;
  if (isMidweek) {
    return nextSaturday(now, SATURDAY_EVENING_HOUR);
  }
  return clampToDaytime(new Date(now.getTime() + THIRTY_SIX_HOURS_MS));
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
