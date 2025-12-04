// lib/tuneEvents.ts
import { supabase } from "./supabase";

export type TuneSource = "trial" | "pro";

type LogTuneEventParams = {
  source: TuneSource;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  notes?: Record<string, any>;
};

export async function logTuneEvent(params: LogTuneEventParams) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user?.id) return; // not logged in, nothing to do

    await supabase.from("tune_events").insert({
      user_id: user.id,
      is_pro: params.source === "pro",
      source: params.source,
      model: params.model ?? null,
      prompt_tokens: params.promptTokens ?? null,
      completion_tokens: params.completionTokens ?? null,
      notes: params.notes ? JSON.stringify(params.notes) : null,
    });
  } catch (e) {
    // fail silently – logging should never break tuning
    console.warn("logTuneEvent failed", e);
  }
}
