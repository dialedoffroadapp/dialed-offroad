// supabase/functions/delete-account/index.ts
// Deletes the current authenticated user and any of their files.
// Your DB rows in profiles/bikes/sessions will cascade-delete
// because of the ON DELETE CASCADE FK we set earlier.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Simple CORS helper so the function can be called from your app
function withCors(res: Response) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set(
    "Access-Control-Allow-Headers",
    "authorization, x-client-info, apikey, content-type"
  );
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return new Response(res.body, { status: res.status, headers });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return withCors(new Response("ok"));

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // 1) Auth-scoped client to figure out who is calling
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return withCors(
        new Response(JSON.stringify({ error: "Not authenticated" }), {
          status: 401,
        })
      );
    }

    // 2) Admin client to actually delete the auth user
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // (Optional) Best-effort: remove avatar files under avatars/<user.id>/
    try {
      const list = await admin.storage.from("avatars").list(user.id, {
        limit: 100,
        search: "",
      });
      const paths =
        list.data?.map((f) => `${user.id}/${f.name}`) ?? [];
      if (paths.length) {
        await admin.storage.from("avatars").remove(paths);
      }
    } catch {
      // ignore storage errors (non-fatal)
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      return withCors(
        new Response(JSON.stringify({ error: delErr.message }), {
          status: 500,
        })
      );
    }

    // profiles/bikes/sessions rows will be removed by DB cascade.
    return withCors(new Response(JSON.stringify({ success: true })));
  } catch (e) {
    return withCors(
      new Response(
        JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        { status: 500 }
      )
    );
  }
});
