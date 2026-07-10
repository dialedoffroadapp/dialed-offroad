// Live Supabase integration checks for retention-loop-v1 + paywall-decliner-recovery.
// Creates two disposable auth users, exercises RPCs / constraints / RLS with
// user-scoped JWTs, and deletes everything afterwards. Secrets come from env
// and are never printed.
const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN;
const REF = "urqpiwxapckaiorvdvfi";
const URL_BASE = `https://${REF}.supabase.co`;
const MGMT = `https://api.supabase.com/v1/projects/${REF}`;

const results = [];
let anonKey, serviceKey;
const record = (id, desc, pass, detail = "") =>
  results.push({ id, desc, pass, detail: String(detail).slice(0, 110) });

const mgmtSql = async (query) => {
  const r = await fetch(`${MGMT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`mgmt sql ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
};

const rest = async (method, path, { key, jwt, body, prefer } = {}) => {
  const r = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${jwt ?? key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  const text = await r.text();
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: r.status, body: parsed };
};

const EVENT_NAMES = [
  "ai_tune_generated","session_saved","session_deleted","bike_created","bike_updated",
  "ai_tune_generated_zero","version_created","feedback_submitted","outcome_recorded",
  "chip_toggled","where_selected","protect_toggled","conditions_selected","heard_card_shown",
  "checkin_shown","checkin_answered","checkin_dismissed","preride_shown","preride_history_tapped",
  "preride_copied","history_opened","history_version_expanded","restore_started","restore_confirmed",
  "history_gate_hit","setup_shared","preset_applied","sign_in","sign_up",
  "onboarding_intro_completed","onboarding_bike_added","onboarding_tune_generated",
  "onboarding_locked_results_viewed","onboarding_unlock_clicked","onboarding_signup_started",
  "onboarding_signup_completed","onboarding_paywall_shown","onboarding_paywall_dismissed",
  "onboarding_trial_started","onboarding_completed",
  "decliner_home_landed","decliner_banner_tapped","decliner_converted",
];

const stamp = Date.now();
const users = [
  { email: `it-a-${stamp}@dialed-integration.test`, pw: `Aa1!${stamp}xyzz`, id: null, jwt: null },
  { email: `it-b-${stamp}@dialed-integration.test`, pw: `Bb2!${stamp}xyzz`, id: null, jwt: null },
];

async function main() {
  // 0. keys
  const keysRes = await fetch(`${MGMT}/api-keys`, { headers: { Authorization: `Bearer ${MGMT_TOKEN}` } });
  const keys = await keysRes.json();
  anonKey = keys.find((k) => k.name === "anon")?.api_key;
  serviceKey = keys.find((k) => k.name === "service_role")?.api_key;
  if (!anonKey || !serviceKey) throw new Error("could not fetch project api keys");

  // 1. create + sign in both users
  for (const u of users) {
    const c = await rest("POST", "/auth/v1/admin/users", {
      key: serviceKey,
      body: { email: u.email, password: u.pw, email_confirm: true },
    });
    if (c.status !== 200 && c.status !== 201) throw new Error(`admin create ${c.status}: ${JSON.stringify(c.body).slice(0, 150)}`);
    u.id = c.body.id;
    const t = await rest("POST", "/auth/v1/token?grant_type=password", {
      key: anonKey,
      body: { email: u.email, password: u.pw },
    });
    if (!t.body?.access_token) throw new Error(`sign-in failed ${t.status}`);
    u.jwt = t.body.access_token;
  }
  const [A, B] = users;
  record("SETUP", "two disposable auth users created + signed in", true, `A=${A.id.slice(0, 8)}… B=${B.id.slice(0, 8)}…`);

  // 2. claim_free_tune → trial_tunes_used = 1
  const claim = await rest("POST", "/rest/v1/rpc/claim_free_tune", { key: anonKey, jwt: A.jwt, body: {} });
  record("INT-1a", "claim_free_tune → ok/trial/used=1", claim.status === 200 && claim.body?.ok === true && claim.body?.reason === "trial" && claim.body?.trial_tunes_used === 1, JSON.stringify(claim.body));
  const p1 = await rest("GET", `/rest/v1/profiles?user_id=eq.${A.id}&select=trial_tunes_used`, { key: serviceKey });
  record("INT-1b", "profiles.trial_tunes_used = 1 after claim", p1.body?.[0]?.trial_tunes_used === 1, JSON.stringify(p1.body));

  // 3. refund_free_tune → back to 0
  const refund = await rest("POST", "/rest/v1/rpc/refund_free_tune", { key: anonKey, jwt: A.jwt, body: {} });
  record("INT-2a", "refund_free_tune → ok/refunded/used=0", refund.status === 200 && refund.body?.ok === true && refund.body?.reason === "refunded" && refund.body?.trial_tunes_used === 0, JSON.stringify(refund.body));
  const p2 = await rest("GET", `/rest/v1/profiles?user_id=eq.${A.id}&select=trial_tunes_used`, { key: serviceKey });
  record("INT-2b", "profiles.trial_tunes_used = 0 after refund", p2.body?.[0]?.trial_tunes_used === 0, JSON.stringify(p2.body));
  const refund2 = await rest("POST", "/rest/v1/rpc/refund_free_tune", { key: anonKey, jwt: A.jwt, body: {} });
  record("INT-2c", "second refund → nothing_claimed (floor 0, no farming below zero)", refund2.body?.ok === false && refund2.body?.reason === "nothing_claimed", JSON.stringify(refund2.body));

  // 4. usage_events: all 43 whitelisted names insert as the user
  const evRows = EVENT_NAMES.map((event_type) => ({ user_id: A.id, event_type, meta: { it: true } }));
  const evIns = await rest("POST", "/rest/v1/usage_events", { key: anonKey, jwt: A.jwt, body: evRows });
  record("INT-3a", "all 43 whitelisted event names insert (user JWT)", evIns.status === 201, `status=${evIns.status} ${JSON.stringify(evIns.body).slice(0, 80)}`);
  const evCount = await rest("GET", `/rest/v1/usage_events?user_id=eq.${A.id}&select=id`, { key: serviceKey, prefer: "count=exact" });
  record("INT-3b", "43 rows landed", Array.isArray(evCount.body) && evCount.body.length === 43, `count=${Array.isArray(evCount.body) ? evCount.body.length : "?"}`);
  const evBad = await rest("POST", "/rest/v1/usage_events", { key: anonKey, jwt: A.jwt, body: { user_id: A.id, event_type: "not_a_real_event", meta: {} } });
  record("INT-3c", "bogus event name rejected by CHECK (23514)", evBad.status === 400 && evBad.body?.code === "23514", `status=${evBad.status} code=${evBad.body?.code}`);

  // 5. RLS: setup_versions own vs other
  const vals = { source: "baseline", parent_version_id: null, terrain: "hardpack", context: null, fork_comp_clicks: 12, fork_reb_clicks: 12, fork_air_bar: null, shock_lsc_clicks: 12, shock_hsc_turns: 1.5, shock_reb_clicks: 14, sag_mm: 105, notes: [] };
  const svOwn = await rest("POST", "/rest/v1/setup_versions", { key: anonKey, jwt: A.jwt, body: { user_id: A.id, bike_id: null, ...vals }, prefer: "return=representation" });
  const v1 = Array.isArray(svOwn.body) ? svOwn.body[0] : null;
  record("INT-4a", "setup_versions: user can insert own row", svOwn.status === 201 && !!v1?.id, `status=${svOwn.status} v${v1?.version_number}`);
  const svOther = await rest("POST", "/rest/v1/setup_versions", { key: anonKey, jwt: A.jwt, body: { user_id: B.id, bike_id: null, ...vals } });
  record("INT-4b", "setup_versions: user CANNOT insert for another user_id", svOther.status === 403 || svOther.body?.code === "42501", `status=${svOther.status} code=${svOther.body?.code}`);

  // 6. RLS: ride_feedback own vs other
  const fbOwn = await rest("POST", "/rest/v1/ride_feedback", { key: anonKey, jwt: A.jwt, body: { user_id: A.id, setup_version_id: v1.id, overall_rating: 6, symptoms: [{ id: "dead_feel", severity: 5 }], free_text: "integration test" }, prefer: "return=representation" });
  const fb1 = Array.isArray(fbOwn.body) ? fbOwn.body[0] : null;
  record("INT-5a", "ride_feedback: user can insert own row", fbOwn.status === 201 && !!fb1?.id, `status=${fbOwn.status}`);
  const fbOther = await rest("POST", "/rest/v1/ride_feedback", { key: anonKey, jwt: A.jwt, body: { user_id: B.id, setup_version_id: v1.id, symptoms: [] } });
  record("INT-5b", "ride_feedback: user CANNOT insert for another user_id", fbOther.status === 403 || fbOther.body?.code === "42501", `status=${fbOther.status} code=${fbOther.body?.code}`);

  // 7. Outcome-branch (refinement) check-in eligibility, end to end:
  //    refinement child + resulting_version_id link + 13h backdate → the
  //    card's exact query returns the row.
  const svRef = await rest("POST", "/rest/v1/setup_versions", { key: anonKey, jwt: A.jwt, body: { user_id: A.id, bike_id: null, ...vals, source: "refinement", parent_version_id: v1.id }, prefer: "return=representation" });
  const v2 = Array.isArray(svRef.body) ? svRef.body[0] : null;
  record("INT-6a", "refinement version inserts (RLS fix 20260707100000 holds)", svRef.status === 201 && !!v2?.id, `status=${svRef.status} v${v2?.version_number}`);
  const link = await rest("PATCH", `/rest/v1/ride_feedback?id=eq.${fb1.id}`, { key: anonKey, jwt: A.jwt, body: { resulting_version_id: v2.id } });
  record("INT-6b", "resulting_version_id link writable by owner (column grant)", link.status === 204, `status=${link.status}`);
  await mgmtSql(`update public.ride_feedback set created_at = now() - interval '13 hours' where id = '${fb1.id}';`);
  const cutoff = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const elig = await rest("GET", `/rest/v1/ride_feedback?select=id,symptoms&user_id=eq.${A.id}&resulting_version_id=not.is.null&outcome=is.null&created_at=lt.${encodeURIComponent(cutoff)}&order=created_at.desc&limit=1`, { key: anonKey, jwt: A.jwt });
  record("INT-6c", "outcome check-in eligibility query returns the 13h-old row", Array.isArray(elig.body) && elig.body[0]?.id === fb1.id, JSON.stringify(elig.body).slice(0, 60));

  // 8. H3/M5: is_pro / pro_until client-writability (locked by 20260710170000)
  const proPatch = await rest("PATCH", `/rest/v1/profiles?user_id=eq.${A.id}`, { key: anonKey, jwt: A.jwt, body: { is_pro: true, pro_until: "2030-01-01T00:00:00Z" }, prefer: "return=representation" });
  const proAfter = await rest("GET", `/rest/v1/profiles?user_id=eq.${A.id}&select=is_pro,pro_until`, { key: serviceKey });
  const escalated = proAfter.body?.[0]?.is_pro === true;
  record("INT-7", "H3/M5 audit: is_pro NOT writable by client", !escalated, `patch=${proPatch.status} db is_pro=${proAfter.body?.[0]?.is_pro} pro_until=${proAfter.body?.[0]?.pro_until}`);
  const trialPatch = await rest("PATCH", `/rest/v1/profiles?user_id=eq.${A.id}`, { key: anonKey, jwt: A.jwt, body: { trial_tunes_used: 0 } });
  const trialAfterHack = await rest("GET", `/rest/v1/profiles?user_id=eq.${A.id}&select=trial_tunes_used`, { key: serviceKey });
  record("INT-7b", "trial_tunes_used NOT writable by client (RPCs are the only writers)", trialPatch.status !== 200 && trialPatch.status !== 204, `patch=${trialPatch.status} db=${trialAfterHack.body?.[0]?.trial_tunes_used}`);

  // 9. Legitimate profile edits still work post-lock (row exists via
  //    claim_free_tune's insert-if-missing earlier in this run).
  const nameEdit = await rest("PATCH", `/rest/v1/profiles?user_id=eq.${A.id}`, { key: anonKey, jwt: A.jwt, body: { display_name: "Integration Rider" }, prefer: "return=representation" });
  record("INT-8a", "profiles: display_name PATCH under user JWT still succeeds", nameEdit.status === 200 && nameEdit.body?.[0]?.display_name === "Integration Rider", `status=${nameEdit.status}`);
  const upsertEdit = await rest("POST", `/rest/v1/profiles?on_conflict=user_id`, { key: anonKey, jwt: A.jwt, body: { user_id: A.id, display_name: "Upsert Rider", avatar_url: null, updated_at: new Date().toISOString() }, prefer: "resolution=merge-duplicates,return=representation" });
  record("INT-8b", "profiles: app-style upsert (lib/profiles.ts shape) still succeeds", (upsertEdit.status === 200 || upsertEdit.status === 201) && upsertEdit.body?.[0]?.display_name === "Upsert Rider", `status=${upsertEdit.status}`);
}

async function cleanup() {
  if (!serviceKey) return;
  for (const u of users) {
    if (!u.id) continue;
    // Children first in case any FK lacks ON DELETE CASCADE.
    for (const t of ["ride_feedback", "usage_events", "setup_versions", "sessions", "profiles"]) {
      await rest("DELETE", `/rest/v1/${t}?user_id=eq.${u.id}`, { key: serviceKey }).catch(() => {});
    }
    const del = await rest("DELETE", `/auth/v1/admin/users/${u.id}`, { key: serviceKey });
    console.log(`cleanup: deleted user ${u.email} status=${del.status}`);
  }
  // Verify nothing is left behind.
  for (const u of users) {
    if (!u.id) continue;
    const left = await mgmtSql(`select (select count(*) from public.profiles where user_id = '${u.id}') as profiles, (select count(*) from public.usage_events where user_id = '${u.id}') as events, (select count(*) from public.setup_versions where user_id = '${u.id}') as versions, (select count(*) from public.ride_feedback where user_id = '${u.id}') as feedback, (select count(*) from auth.users where id = '${u.id}') as auth_user;`).catch(() => null);
    console.log(`cleanup-verify ${u.email}:`, JSON.stringify(left?.[0] ?? "unverified"));
  }
}

main()
  .catch((e) => record("FATAL", "unhandled failure", false, e.message))
  .finally(async () => {
    try { await cleanup(); } catch (e) { console.log("cleanup error:", e.message); }
    const w = Math.max(...results.map((r) => r.desc.length));
    console.log("\nRESULT | ID      | ASSERTION" + " ".repeat(w - 8) + "| DETAIL");
    for (const r of results) {
      console.log(`${r.pass ? "PASS  " : "FAIL  "} | ${r.id.padEnd(7)} | ${r.desc.padEnd(w)} | ${r.detail}`);
    }
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} assertions passed`);
    process.exit(failed ? 1 : 0);
  });
