// lib/lifecycle.ts
// Lifecycle email foundation: the app emits behavior events to the
// `lifecycle-events` edge function, which forwards them to the email
// provider (drafted for Loops; Resend recommended 2026-09-07 because it
// documents Apple's private relay, pending River's yes; see
// docs/lifecycle-emails.md). Fire-and-forget, never blocks, never throws.
// Nothing sends until the provider key is set on the function and the
// drafts are approved.
import { supabase } from "./supabase";

export type LifecycleEvent =
  | "account_created"
  | "first_session"
  | "first_ride_day_logged"
  | "trial_ending"
  | "downgraded"
  | "meter_stalled"
  | "seasonal_reactivation";

export async function emitLifecycleEvent(event: LifecycleEvent, props: Record<string, unknown> = {}): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.id) return;
    await supabase.functions.invoke("lifecycle-events", { body: { event, props } });
  } catch {
    // never surface
  }
}
