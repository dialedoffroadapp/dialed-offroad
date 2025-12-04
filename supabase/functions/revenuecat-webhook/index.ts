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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

  if (WEBHOOK_SECRET) {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (token !== WEBHOOK_SECRET) {
      console.warn("Webhook: invalid secret");
      return new Response("Unauthorized", { status: 401 });
    }
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
