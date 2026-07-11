// @ts-nocheck
// supabase/functions/revenuecat-webhook/index.ts
// RevenueCat -> Supabase webhook
// Keeps profiles.is_pro / profiles.pro_until in sync with RevenueCat

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("REVENUECAT_SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
  "REVENUECAT_SUPABASE_SERVICE_ROLE_KEY",
)!;
const WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET") ?? null;

// Startup-style alarm (H4 history: this check was once silently broken
// because the header wasn't configured in RevenueCat; a missing env var
// used to silently skip validation entirely). The handler below fails
// closed regardless — this log just makes the misconfiguration loud.
if (!WEBHOOK_SECRET) {
  console.error(
    "[webhook] FATAL: REVENUECAT_WEBHOOK_SECRET is not set — every event will be rejected with 500 (fail-closed)",
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * Constant-time secret comparison: compare fixed-length SHA-256 digests of
 * both values with a full XOR sweep, so neither content nor length of the
 * expected secret leaks through timing.
 */
async function secretsMatch(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

type RevenueCatEvent = {
  type?: string;
  app_user_id?: string;
  expiration_at_ms?: number | null;
};

type RevenueCatPayload = {
  event?: RevenueCatEvent;
};

// simple uuid v4-ish check (good enough)
function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function isGrantType(type?: string | null): boolean {
  if (!type) return false;
  const grantTypes = [
    "INITIAL_PURCHASE",
    "NON_RENEWING_PURCHASE",
    "RENEWAL",
    "PRODUCT_CHANGE",
    "UNCANCELLATION",
    "SUBSCRIPTION_EXTENDED",
  ];
  return grantTypes.includes(type);
}

function isHardRevokeType(type?: string | null): boolean {
  if (!type) return false;
  const revokeTypes = [
    "EXPIRATION",
    "SUBSCRIPTION_EXPIRED",
    "REFUND",
  ];
  return revokeTypes.includes(type);
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── Auth: FAIL CLOSED (H4). This function is deployed with
  // verify_jwt=false (RevenueCat cannot send a Supabase JWT), so this block
  // is the ONLY gate in front of a service-role writer of Pro status.
  //
  // RevenueCat sends the exact string configured in the dashboard's
  // "Authorization header value" field as the `Authorization` header — RC
  // adds no scheme of its own. This code reads that exact header and
  // tolerates an optional "Bearer " prefix in the dashboard value, comparing
  // the bare token against REVENUECAT_WEBHOOK_SECRET (same normalization the
  // previous implementation used, so a correctly-configured RC dashboard
  // keeps working unchanged).
  if (!WEBHOOK_SECRET) {
    console.error(
      JSON.stringify({ scope: "webhook_auth", reject: "secret_env_missing" }),
    );
    return new Response("Server misconfigured", { status: 500 });
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    console.warn(
      JSON.stringify({
        scope: "webhook_auth",
        reject: "missing_authorization_header",
      }),
    );
    return new Response("Unauthorized", { status: 401 });
  }
  if (!(await secretsMatch(token, WEBHOOK_SECRET))) {
    console.warn(
      JSON.stringify({ scope: "webhook_auth", reject: "secret_mismatch" }),
    );
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: RevenueCatPayload;
  try {
    payload = (await req.json()) as RevenueCatPayload;
  } catch (err) {
    console.error("Webhook: invalid JSON", err);
    return new Response("Bad Request", { status: 400 });
  }

  const event = payload.event;
  if (!event) {
    console.warn("Webhook: no event in payload");
    return new Response("OK", { status: 200 });
  }

  const userId = event.app_user_id;
  if (!userId) {
    console.warn("Webhook: missing app_user_id");
    return new Response("OK", { status: 200 });
  }

  // 🚨 Guard: skip events whose app_user_id is not a Supabase uuid
  if (!isUuid(userId)) {
    console.warn("Webhook: app_user_id is not a uuid, skipping", userId);
    return new Response("OK", { status: 200 });
  }

  const type = event.type;
  console.log("RevenueCat webhook event:", type, "for user", userId);

  let is_pro: boolean | null = null;
  let pro_until: string | null = null;

  if (isGrantType(type)) {
    is_pro = true;
    if (event.expiration_at_ms && Number.isFinite(event.expiration_at_ms)) {
      pro_until = new Date(event.expiration_at_ms).toISOString();
    } else {
      pro_until = null; // lifetime / unknown -> treat as lifetime
    }
  } else if (type === "CANCELLATION") {
    // still Pro until actual expiration date
    is_pro = true;
    if (event.expiration_at_ms && Number.isFinite(event.expiration_at_ms)) {
      pro_until = new Date(event.expiration_at_ms).toISOString();
    } else {
      pro_until = null;
    }
  } else if (isHardRevokeType(type)) {
    is_pro = false;
    pro_until = null;
  } else {
    // ignore BILLING_ISSUE, SUBSCRIPTION_PAUSED, etc
    console.log("Webhook: ignoring event type", type);
    return new Response("OK", { status: 200 });
  }

  try {
    const { error } = await supabase
      .from("profiles")
      .upsert(
        { user_id: userId, is_pro, pro_until },
        { onConflict: "user_id" },
      );

    if (error) {
      console.error("Webhook: Supabase upsert error", error);
      return new Response("Error updating profile", { status: 500 });
    }

    console.log("Webhook: updated profile for", userId, { is_pro, pro_until });
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook: unexpected error", err);
    return new Response("Internal Server Error", { status: 500 });
  }
});
