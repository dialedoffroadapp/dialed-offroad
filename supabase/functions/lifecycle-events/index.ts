// supabase/functions/lifecycle-events
// Lifecycle email foundation (conversion model, 2026-09-04). Two modes:
//   POST {event, props}   from the app (user JWT): forwards one behavior
//                         event to Loops + upserts the contact's properties.
//   POST ?cron=1          service role (scheduled): scans profiles for the
//                         time-based sends Loops cannot infer on its own
//                         (trial ending in 3 days, downgraded + 3 days) and
//                         emits them once each (lifecycle_sends dedupe).
// Loops handles sequencing, delays, unsubscribes, and the manual seasonal
// campaign. NOT DEPLOYED; sends nothing until LOOPS_API_KEY is set and the
// seven drafts (docs/lifecycle-emails.md) are approved.
import { createClient } from "npm:@supabase/supabase-js@2";

const LOOPS_EVENTS_URL = "https://app.loops.so/api/v1/events/send";
const LOOPS_CONTACT_URL = "https://app.loops.so/api/v1/contacts/update";

const EVENTS = new Set([
  "account_created",
  "first_session",
  "first_ride_day_logged",
  "trial_ending",
  "downgraded",
  "meter_stalled",
  "seasonal_reactivation",
]);

type Env = { url: string; anon: string; service: string; loops: string | null };
function env(): Env {
  return {
    url: Deno.env.get("SUPABASE_URL") ?? "",
    anon: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    loops: Deno.env.get("LOOPS_API_KEY") ?? null,
  };
}

async function loops(path: string, body: Record<string, unknown>, key: string | null): Promise<boolean> {
  if (!key) {
    console.log("lifecycle: LOOPS_API_KEY unset, would send", JSON.stringify(body).slice(0, 200));
    return false;
  }
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error("lifecycle: loops error", res.status, (await res.text()).slice(0, 200));
  return res.ok;
}

async function sendEvent(e: Env, email: string, userId: string, event: string, props: Record<string, unknown>) {
  await loops(LOOPS_CONTACT_URL, { email, userId, ...flat(props) }, e.loops);
  return loops(LOOPS_EVENTS_URL, { email, userId, eventName: event, eventProperties: flat(props) }, e.loops);
}

function flat(o: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "object" ? JSON.stringify(v) : (v as string | number | boolean);
  }
  return out;
}

Deno.serve(async (req) => {
  const e = env();
  const url = new URL(req.url);
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // ---- cron mode: time-based sends ----
  if (url.searchParams.get("cron") === "1") {
    const auth = req.headers.get("Authorization") ?? "";
    if (!e.service || auth !== `Bearer ${e.service}`) return new Response("Forbidden", { status: 403 });
    const admin = createClient(e.url, e.service);
    const now = Date.now();
    const in3d = new Date(now + 3 * 86400000).toISOString();
    const ago3d = new Date(now - 3 * 86400000).toISOString();
    let sent = 0;

    // Trial ending: ≤ 3 days left (the ride-day leg fires from the app).
    const { data: ending } = await admin
      .from("profiles")
      .select("user_id, trial_ends_at, trial_ride_day_limit")
      .eq("entitlement_state", "trial_active")
      .lte("trial_ends_at", in3d);
    for (const p of ending ?? []) {
      if (await mark(admin, p.user_id, "trial_ending")) {
        const email = await emailFor(admin, p.user_id);
        if (email && (await sendEvent(e, email, p.user_id, "trial_ending", { trial_ends_at: p.trial_ends_at, leg: "clock" }))) sent++;
      }
    }
    // Downgraded + 3 days: "history is waiting".
    const { data: down } = await admin
      .from("profiles")
      .select("user_id, downgraded_at")
      .eq("entitlement_state", "free")
      .not("downgraded_at", "is", null)
      .lte("downgraded_at", ago3d);
    for (const p of down ?? []) {
      if (await mark(admin, p.user_id, "downgraded_3d")) {
        const { count } = await admin.from("setup_versions").select("id", { count: "exact", head: true }).eq("user_id", p.user_id);
        const email = await emailFor(admin, p.user_id);
        if (email && (await sendEvent(e, email, p.user_id, "downgraded", { locked_versions: count ?? 0, leg: "plus_3_days" }))) sent++;
      }
    }
    return Response.json({ ok: true, sent });
  }

  // ---- app mode: one behavior event for the caller ----
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  const userClient = createClient(e.url, e.anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id || !u.user.email) return new Response("Unauthorized", { status: 401 });
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const event = String(body?.event ?? "");
  if (!EVENTS.has(event)) return new Response("Unknown event", { status: 400 });
  const props = body?.props && typeof body.props === "object" ? body.props : {};
  const admin = createClient(e.url, e.service);
  // Once-per-account events dedupe server-side; repeatable ones (meter_stalled) don't.
  const onceEvents = new Set(["account_created", "first_session", "first_ride_day_logged", "trial_ending", "downgraded"]);
  if (onceEvents.has(event) && !(await mark(admin, u.user.id, event))) return Response.json({ ok: true, deduped: true });
  const ok = await sendEvent(e, u.user.email, u.user.id, event, props);
  return Response.json({ ok });
});

async function mark(admin: ReturnType<typeof createClient>, userId: string, event: string): Promise<boolean> {
  const { error } = await admin.from("lifecycle_sends").insert({ user_id: userId, event });
  return !error; // unique violation = already sent
}

async function emailFor(admin: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}
