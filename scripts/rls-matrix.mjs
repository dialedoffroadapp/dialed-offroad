// M6 RLS matrix spot-tests: risky cells only, two disposable users.
const MGMT_TOKEN = process.env.SUPABASE_MGMT_TOKEN;
const REF = "urqpiwxapckaiorvdvfi";
const U = `https://${REF}.supabase.co`;
const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, { headers: { Authorization: `Bearer ${MGMT_TOKEN}` } })).json();
const anon = keys.find((k) => k.name === "anon").api_key;
const svc = keys.find((k) => k.name === "service_role").api_key;
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const rest = (m, p, { jwt, body, prefer } = {}) => fetch(`${U}${p}`, { method: m, headers: { apikey: anon, Authorization: `Bearer ${jwt ?? anon}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }).then(j);

const mk = async (tag) => {
  const email = `rls-${tag}-${Date.now()}@dialed-integration.test`;
  const c = await (await fetch(`${U}/auth/v1/admin/users`, { method: "POST", headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Rls!12345678", email_confirm: true }) })).json();
  const t = await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anon, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Rls!12345678" }) })).json();
  return { id: c.id, jwt: t.access_token, email };
};
const A = await mk("a"), B = await mk("b");
const out = [];
const rec = (cell, pass, detail) => out.push({ cell, pass, detail: String(detail).slice(0, 70) });

// A seeds a bike; B tries to read/update/delete it.
const seed = await rest("POST", "/rest/v1/bikes", { jwt: A.jwt, body: { user_id: A.id, make: "KTM", model: "350", year: 2024 }, prefer: "return=representation" });
const bikeId = seed.body?.[0]?.id;
rec("bikes A insert own", seed.status === 201, `status=${seed.status}`);

const bReadA = await rest("GET", `/rest/v1/bikes?id=eq.${bikeId}`, { jwt: B.jwt });
rec("bikes B select A's row → empty", Array.isArray(bReadA.body) && bReadA.body.length === 0, `rows=${bReadA.body?.length}`);
const bUpdA = await rest("PATCH", `/rest/v1/bikes?id=eq.${bikeId}`, { jwt: B.jwt, body: { make: "HACKED" }, prefer: "return=representation" });
rec("bikes B update A's row → 0 rows", (bUpdA.body?.length ?? 0) === 0, `rows=${bUpdA.body?.length ?? 0}`);
const bDelA = await rest("DELETE", `/rest/v1/bikes?id=eq.${bikeId}`, { jwt: B.jwt, prefer: "return=representation" });
rec("bikes B delete A's row → 0 rows", (bDelA.body?.length ?? 0) === 0, `rows=${bDelA.body?.length ?? 0}`);
const stillThere = await rest("GET", `/rest/v1/bikes?id=eq.${bikeId}&select=make`, { jwt: A.jwt });
rec("bikes A's row survived B's attacks, unmodified", stillThere.body?.[0]?.make === "KTM", `make=${stillThere.body?.[0]?.make}`);

// anon (no JWT) can't read anyone's bikes
const anonRead = await rest("GET", `/rest/v1/bikes?id=eq.${bikeId}`, {});
rec("bikes anon select → empty (auth.uid null)", (anonRead.body?.length ?? 0) === 0, `rows=${anonRead.body?.length ?? 0} status=${anonRead.status}`);

// Reference tables: bike_models (SELECT-only policy true), writes should fail.
const bmRead = await rest("GET", "/rest/v1/bike_models?limit=1", { jwt: A.jwt });
rec("bike_models authed SELECT allowed (public reference)", bmRead.status === 200, `status=${bmRead.status} rows=${bmRead.body?.length}`);
const bmWrite = await rest("POST", "/rest/v1/bike_models", { jwt: A.jwt, body: { make: "x", model: "y", year: 2024 } });
rec("bike_models authed INSERT blocked (no write policy)", bmWrite.status === 403 || bmWrite.body?.code === "42501", `status=${bmWrite.status} code=${bmWrite.body?.code}`);

// blocked_words / bike_setups: no client usage; confirm not writable + read posture.
const bwRead = await rest("GET", "/rest/v1/blocked_words?limit=1", { jwt: A.jwt });
rec("blocked_words authed SELECT", `${bwRead.status}`, `status=${bwRead.status} rows=${Array.isArray(bwRead.body) ? bwRead.body.length : "n/a"}`);
const bwWrite = await rest("POST", "/rest/v1/blocked_words", { jwt: A.jwt, body: { word: "x" } });
rec("blocked_words authed INSERT blocked", bwWrite.status === 403 || bwWrite.status === 404 || bwWrite.body?.code === "42501", `status=${bwWrite.status} code=${bwWrite.body?.code}`);

// tune_calls: revoked from client entirely — SELECT should be empty/forbidden.
const tcRead = await rest("GET", "/rest/v1/tune_calls?limit=1", { jwt: A.jwt });
rec("tune_calls authed SELECT → empty/blocked (service-only)", (tcRead.body?.length ?? 0) === 0 || tcRead.status >= 400, `status=${tcRead.status} rows=${Array.isArray(tcRead.body) ? tcRead.body.length : "n/a"}`);

// usage_events: B cannot read A's events (own-row select).
await rest("POST", "/rest/v1/usage_events", { jwt: A.jwt, body: { user_id: A.id, event_type: "sign_in", meta: {} } });
const ueCross = await rest("GET", `/rest/v1/usage_events?user_id=eq.${A.id}`, { jwt: B.jwt });
rec("usage_events B select A's events → empty", (ueCross.body?.length ?? 0) === 0, `rows=${ueCross.body?.length ?? 0}`);

// cleanup
for (const u of [A, B]) {
  for (const t of ["usage_events", "ride_feedback", "setup_versions", "sessions", "bikes", "user_presets", "profiles"]) {
    await fetch(`${U}/rest/v1/${t}?user_id=eq.${u.id}`, { method: "DELETE", headers: { apikey: svc, Authorization: `Bearer ${svc}` } }).catch(() => {});
  }
  await fetch(`${U}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: { apikey: svc, Authorization: `Bearer ${svc}` } });
}
const w = Math.max(...out.map((o) => o.cell.length));
for (const o of out) console.log(`${o.pass === true ? "PASS" : o.pass === false ? "FAIL" : "INFO"} | ${o.cell.padEnd(w)} | ${o.detail}`);
console.log("cleanup done");
