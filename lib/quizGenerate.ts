// lib/quizGenerate.ts
// The quiz's "Build my tune": the SAME generation path app/(tabs)/tune.tsx
// runs (credit claim for signed-in non-Pro riders, verified model specs → sag
// bounds + spring check, generateTune with the 30 s cap, coil enforcement,
// pending-tune write + funnel event), with the quiz answers as the input.
// tune.tsx is deliberately untouched; keep the two in step when it changes.
import { generateTune, type ZeroTuneResult } from "./ai";
import { computeSpringCheck, fetchModelSpecs, type ModelSpecs } from "./modelSpecs";
import { writePendingTune } from "./onboarding";
import { claimBaselineCredit, refundBaselineCredit, type ClaimResult } from "./freeTune";
import { deriveIsPro } from "./proUtils";
import {
  bikeDisplayName,
  buildQuizTuneInput,
  terrainLabel,
  type QuizAnswers,
} from "./quizOnboarding";
import { resolveSagBounds } from "./sagBounds";
import { supabase } from "./supabase";
import { getOrCreateFunnelId, logEvent } from "./usage";
import { isUuid } from "./uuid";

const GENERATE_TIMEOUT_MS = 30_000;

export type QuizGenerateErrorCode =
  | "invalid_answers"
  | "no_trial"
  | "claim_failed"
  | "timeout"
  | "generate_failed";

export class QuizGenerateError extends Error {
  code: QuizGenerateErrorCode;
  constructor(code: QuizGenerateErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type QuizGenerateResult = {
  tune: ZeroTuneResult;
  specs: ModelSpecs | null;
  encodedResult: string;
  encodedMeta: string;
  signedIn: boolean;
};

export async function generateQuizTune(params: {
  answers: QuizAnswers;
  /** Onboarding step at generation time (for the funnel event). */
  onboardingStep: string;
  onboardingActive: boolean;
  lastUpdatedAt: string;
}): Promise<QuizGenerateResult> {
  const { answers, onboardingStep, onboardingActive, lastUpdatedAt } = params;
  const input = buildQuizTuneInput(answers);
  if (!input) throw new QuizGenerateError("invalid_answers", "Some answers are missing.");
  // The edge's per-bike rule keys on the garage bike; guest-local ids stay off the wire.
  if (isUuid(answers.bikeLocalId)) input.bike_id = answers.bikeLocalId;

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user ?? null;
  const signedIn = !!user?.id;

  // Signed-in non-Pro riders spend the free baseline credit exactly like the
  // Tune tab (claim BEFORE generating; refund on failure). Guests are the
  // funnel's normal case and claim nothing.
  // Free rule (2026-09-04): one baseline per bike, regenerable. The quiz
  // bike is usually a guest-local id (no claim); a signed-in rider's garage
  // bike claims per bike (first counted, regenerate not consumed).
  let claimResult: ClaimResult | null = null;
  if (user?.id) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("is_pro, pro_until")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!deriveIsPro(prof)) {
      const claim = await claimBaselineCredit(answers.bikeLocalId ?? null);
      if (claim.reason === "error") throw new QuizGenerateError("claim_failed", "Couldn't check your free tune. Try again.");
      if (!claim.ok && claim.reason === "no_trial") {
        throw new QuizGenerateError("no_trial", "Another baseline on this account is a Pro thing. Update your bike's baseline instead.");
      }
      if (!claim.ok) throw new QuizGenerateError("claim_failed", "Couldn't claim your tune right now. Try again.");
      claimResult = claim;
    }
  }

  try {
    const modelSpecs = await fetchModelSpecs({
      id: answers.bikeLocalId ?? null,
      model_id: null,
      make: input.make ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
    });
    const sagBounds = resolveSagBounds(modelSpecs);
    const springCheck = computeSpringCheck(modelSpecs, input.rider.weight_lbs);
    if (modelSpecs?.id) input.model_id = modelSpecs.id;

    const specAirFork =
      typeof modelSpecs?.has_air_fork === "boolean" ? modelSpecs.has_air_fork : undefined;
    const effectiveAirFork = specAirFork ?? input.wants_air_fork ?? false;
    if (specAirFork !== undefined) input.wants_air_fork = specAirFork;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const tune: ZeroTuneResult = await Promise.race([
      generateTune(input, sagBounds, specAirFork),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new QuizGenerateError("timeout", "This is taking longer than expected. Try again")),
          GENERATE_TIMEOUT_MS
        );
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });

    if (springCheck) tune.spring_check = springCheck;
    if (specAirFork === false) {
      delete (tune.fork as any).air_pressure_bar;
      if (tune.detected) tune.detected.has_air_fork = false;
    }

    // Same event the Tune tab logs (dropped for guests there too — no queue
    // option — so the shipped analytics shape is unchanged).
    await logEvent("ai_tune_generated_zero", {
      terrain: input.terrain,
      weight: String(input.rider.weight_lbs ?? ""),
      skill: input.rider.skill,
      rideStyle: input.rider.style,
      goals: input.rider.goals,
      zeroed: true,
      wantsAirFork: effectiveAirFork,
      make: input.make,
      model: input.model,
      year: input.year,
      selectedBikeId: answers.bikeLocalId ?? null,
      onboarding: onboardingActive ? 1 : 0,
      guest: signedIn ? 0 : 1,
      spring_check_status: springCheck?.status ?? "unknown",
      source: "quiz",
    });

    const encodedResult = encodeURIComponent(JSON.stringify(tune));
    const encodedMeta = encodeURIComponent(
      JSON.stringify({
        bike: {
          year: input.year,
          make: input.make,
          model: input.model,
          selectedBikeId: answers.bikeLocalId ?? null,
        },
        context: {
          terrain: input.terrain,
          track: undefined,
          temp_f: undefined,
          elev_ft: undefined,
          wants_air_fork: effectiveAirFork,
          rider_weight_lbs: input.rider.weight_lbs,
          goals: input.rider.goals,
          issues: input.rider.issues,
        },
        spec: {
          model_id: modelSpecs?.id ?? null,
          spec_verified: modelSpecs?.spec_verified ?? false,
          sag_target_mm: sagBounds.target,
          sag_bounds: [sagBounds.min, sagBounds.max],
          fork_type: modelSpecs?.fork_type ?? null,
          shock_type: modelSpecs?.shock_type ?? null,
        },
        // Quiz provenance (display + analysis only; readers ignore it).
        quiz: {
          discipline: answers.discipline,
          skill: answers.skill,
          terrain_main: answers.terrainMain,
          terrain_secondary: (answers.terrainSecondary ?? []).map((id) =>
            terrainLabel(answers.discipline ?? "mx", id)
          ),
          bike_name: bikeDisplayName(answers),
        },
        onboarding: onboardingActive,
        guest: !signedIn,
      })
    );

    if (onboardingActive) {
      if (user?.id) {
        const { error: stepErr } = await supabase.from("profiles").upsert(
          { user_id: user.id, onboarding_step: "results_locked" },
          { onConflict: "user_id" }
        );
        if (stepErr) console.warn("[quiz] onboarding_step upsert failed:", stepErr);
      }
      await writePendingTune({
        r: encodedResult,
        meta: encodedMeta,
        bikeId: answers.bikeLocalId ?? null,
        savedAt: Date.now(),
      });
      const funnelId = await getOrCreateFunnelId();
      const ageMinutesSinceLastStep = Math.round(
        Math.max(0, Date.now() - Date.parse(lastUpdatedAt || "")) / 60000
      );
      await logEvent(
        "onboarding_tune_generated",
        {
          funnel_id: funnelId,
          onboarding_step: "results_locked",
          signed_in: signedIn,
          bike_id: answers.bikeLocalId ?? null,
          pending_tune_exists: true,
          resume: ageMinutesSinceLastStep >= 5,
          age_minutes_since_last_step: ageMinutesSinceLastStep,
          source_route: "/quiz/building",
          spring_check_status: springCheck?.status ?? "unknown",
          from_step: onboardingStep,
        },
        { allowAnonymous: true, queueIfAnonymous: true }
      );
    } else {
      // Outside onboarding (dev / re-entry): still hand the tune to the
      // reveal through the same pending slot.
      await writePendingTune({
        r: encodedResult,
        meta: encodedMeta,
        bikeId: answers.bikeLocalId ?? null,
        savedAt: Date.now(),
      });
    }

    return { tune, specs: modelSpecs, encodedResult, encodedMeta, signedIn };
  } catch (e: any) {
    void refundBaselineCredit(claimResult);
    if (e instanceof QuizGenerateError) throw e;
    throw new QuizGenerateError(
      "generate_failed",
      typeof e?.message === "string" && e.message.trim() ? e.message : "Couldn't build your tune. Try again."
    );
  }
}
