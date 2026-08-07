// supabase/functions/ai-tune/index.ts
// Zero-based MX/Enduro tuning Edge Function — engine v2
// - Mode "zero_baseline_v1": build initial tune (baseline + optional AI refinement)
// - Mode "tune2_v1": refine an existing tune based on rider feedback
//   v2 pipeline: auth+ratelimit → free-text parse → merge → symptom switch with
//   where-context modifiers → per-circuit conflict resolution → protect pass →
//   adaptive step from last outcome → total clamps → safeShape
// - Enforces guardrails and returns deterministic JSON for the app UI

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/* ----------------------------- Shared types ----------------------------- */

type ZeroInput = {
  mode?: "zero_baseline_v1" | "tune2_v1";
  // Pre-auth attribution (Workstream C): a client-minted random uuid sent
  // only by signed-out baseline callers. Stamped onto the anon tune_calls
  // row so claim_anon_tune_calls can attribute it after signup. Ignored for
  // authenticated callers (their user_id is already correct).
  anon_id?: string;
  input: {
    // baseline context
    make?: string;
    model?: string;
    year?: number;
    // Matched bike_models row id when the client resolved one (v2.4.0 data
    // capture). Stamped onto tune_calls.bike_model_id; never used for math —
    // guardrails stay the resolved-values contract.
    model_id?: string;
    terrain?: string;
    track?: string;
    temp_f?: number;
    elev_ft?: number;
    rider: {
      weight_lbs?: number;
      skill: "beginner" | "intermediate" | "pro";
      style: "short_motos" | "long_enduro";
      goals: string[];
      issues?: string;
    };
    has_zeroed_clickers: boolean;

    // pass-through from app (air fork toggle)
    wants_air_fork?: boolean;

    guardrails?: {
      clicks_min: number;
      clicks_max: number;
      hsc_turns_min: number;
      hsc_turns_max: number;
      sag_min_mm: number;
      sag_max_mm: number;
      sag_target_mm?: number; // per-model sag target (lib/sagBounds); optional
      has_air_fork?: boolean; // spec-verified fork type — authoritative over toggle/heuristic when present
      aer_pressure_bar_default?: number;
      aer_pressure_bar_per_10lb?: number;
    };

    // ----------------- Tune Two specific fields (optional) -----------------
    // When mode === "tune2_v1", the client should also send:
    previous?: ZeroResult; // previous full tune result
    feedback?: Tune2Feedback;
    last_outcome?: Tune2LastOutcome; // adaptive step input (optional)
  };
};

type ZeroResult = {
  fork: { comp_clicks: number; reb_clicks: number; air_pressure_bar?: number };
  shock: {
    lsc_clicks: number;
    hsc_turns: number;
    reb_clicks: number;
    sag_mm: number;
  };
  detected?: { has_air_fork?: boolean; fork_family?: string };
  notes: string[];
  // Client-computed spring-rate check (lib/modelSpecs). The server never sets it,
  // but safeShape passes it through if present so it's never silently dropped.
  spring_check?: unknown;
};

type Discipline = "mx" | "enduro" | "mixed";

/* ---------------------- Tune Two (feedback) types ---------------------- */

type SymptomId =
  | "harsh_braking_bumps"
  | "deflects_in_chop"
  | "rear_kicks_accel"
  | "bottoms_landings"
  | "front_knifes"
  | "dead_feel"
  | "unstable_whoops"
  | "packs_whoops"
  | "harsh_square_edge"
  | "headshake"
  | "general_harsh";

type WhereTag = "braking" | "corners" | "whoops" | "landings";
type ProtectArea = "rear_traction" | "front_planted" | "landings" | "cornering";

type Tune2Symptom = {
  id: SymptomId;
  severity: number; // 1–10
  where?: WhereTag; // optional location context (v2)
  source?: "explicit" | "parsed"; // provenance (v2, set by merge stage)
};

type Tune2Feedback = {
  overall_rating?: number; // 1–10
  ride_duration_min?: number;
  terrain_tags?: string[];
  symptoms: Tune2Symptom[];
  free_text?: string; // raw rider note (v2, parsed server-side)
  protected?: { area: string }[]; // "don't touch" areas (v2)
};

type Tune2LastOutcome = {
  outcome: "improved" | "same" | "worse";
  symptoms: SymptomId[]; // symptom ids the previous refinement addressed
  deltas: Partial<Record<ClickCircuit, number>>; // per-circuit deltas it applied
};

type Circuit =
  | "fork_comp"
  | "fork_reb"
  | "shock_lsc"
  | "shock_reb"
  | "shock_hsc"
  | "fork_air";
type ClickCircuit = Exclude<Circuit, "fork_air">;

type Contribution = { symptomId: SymptomId; delta: number; severity: number };

type Tune2Input = {
  make?: string;
  model?: string;
  year?: number;
  terrain?: string;
  track?: string;
  rider?: {
    weight_lbs?: number;
    skill?: "beginner" | "intermediate" | "pro";
    style?: "short_motos" | "long_enduro";
    goals?: string[];
  };
  previous: ZeroResult;
  feedback: Tune2Feedback;
  guardrails?: ZeroInput["input"]["guardrails"];
  // v2 additions (populated by the handler after parse+merge):
  protectedAreas?: ProtectArea[];
  lastOutcome?: Tune2LastOutcome;
  parsedAddedIds?: SymptomId[];
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function clampInt(n: number, lo: number, hi: number): number {
  return clamp(Math.round(n), lo, hi);
}

function clampFloat(n: number, lo: number, hi: number): number {
  return clamp(n, lo, hi);
}

function isAERFork(make?: string, model?: string) {
  const s = `${make ?? ""} ${model ?? ""}`.toLowerCase();
  // Heuristic: KTM/Husqvarna/GASGAS MX models (XACT AER)
  return /(ktm|husqvarna|gasgas)/.test(s) && /(sx|fc|mc)/.test(s);
}

/* ---------------------- Baseline helpers (discipline/weight/etc.) ---------------------- */

// If rider weight missing, assume a reasonable “reference rider”
function getWeight(z: ZeroInput["input"]): number {
  const w = z.rider.weight_lbs;
  if (!w || w < 90) return 185;
  return Math.min(w, 260);
}

// Relative to a 185 lb reference rider (every 10 lb = +1 “step”)
function weightFactor(z: ZeroInput["input"]): number {
  const w = getWeight(z);
  return (w - 185) / 10;
}

// How aggressive the riding is (skill + style)
function intensityFactor(z: ZeroInput["input"]): number {
  let f = 0;

  if (z.rider.skill === "pro") f += 1.0;
  if (z.rider.skill === "beginner") f -= 0.5;

  if (z.rider.style === "short_motos") f += 0.5;
  if (z.rider.style === "long_enduro") f -= 0.2;

  return clampFloat(f, -1.5, 1.5);
}

// MX vs Enduro vs Mixed, inferred from terrain/track/issues/style
function inferDiscipline(z: ZeroInput["input"]): Discipline {
  const terrain = (z.terrain || "").toLowerCase();
  const track = (z.track || "").toLowerCase();
  const issues = (z.rider.issues || "").toLowerCase();

  const mxHits = [
    "mx",
    "track",
    "motocross",
    "whoops",
    "sand whoops",
    "sx",
    "supercross",
    "jump",
    "table",
    "double",
    "triple",
    "rhythm",
  ];
  const enduroHits = [
    "enduro",
    "woods",
    "singletrack",
    "gnarly",
    "hard enduro",
    "roots",
    "rocks",
    "rocky",
    "technical",
    "tight",
    "chop",
  ];

  let mxScore = 0;
  let enduroScore = 0;

  for (const k of mxHits) {
    if (terrain.includes(k) || track.includes(k) || issues.includes(k)) mxScore++;
  }
  for (const k of enduroHits) {
    if (terrain.includes(k) || track.includes(k) || issues.includes(k))
      enduroScore++;
  }

  // Style hint
  if (z.rider.style === "short_motos") mxScore++;
  if (z.rider.style === "long_enduro") enduroScore++;

  if (mxScore === 0 && enduroScore === 0) return "mixed";
  if (mxScore >= enduroScore + 1) return "mx";
  if (enduroScore >= mxScore + 1) return "enduro";
  return "mixed";
}

// Air fork baseline (AER / XACT style) with discipline + goals/issue bias
function baselineAirBar(
  z: ZeroInput["input"],
  discipline: Discipline,
  hasAirFork: boolean
): number | undefined {
  if (!hasAirFork) return undefined;

  const wf = weightFactor(z);
  const intensity = intensityFactor(z);

  // Discipline-specific defaults and slopes
  let baseDefault: number;
  let per10lbDefault: number;
  let clampLo: number;
  let clampHi: number;

  switch (discipline) {
    case "mx":
      baseDefault = 10.6; // more mid-stroke support
      per10lbDefault = 0.22;
      clampLo = 9.8;
      clampHi = 11.8;
      break;
    case "enduro":
      baseDefault = 10.0; // more small-bump compliance
      per10lbDefault = 0.18;
      clampLo = 9.0;
      clampHi = 11.2;
      break;
    default:
      baseDefault = 10.2;
      per10lbDefault = 0.2;
      clampLo = 9.4;
      clampHi = 11.5;
      break;
  }

  // Allow guardrails to override absolute baseline if you ever want to tune globally
  const base = z.guardrails?.aer_pressure_bar_default ?? baseDefault;
  const per10lb = z.guardrails?.aer_pressure_bar_per_10lb ?? per10lbDefault;

  // Core weight-based scaling
  let bar = base + wf * per10lb;

  // Intensity bias → MX gets stronger mid-stroke support, enduro gets softer nudge
  const intensityBias =
    discipline === "mx" ? 0.12 : discipline === "enduro" ? 0.06 : 0.08;
  bar += intensity * intensityBias;

  // Goals / issues bias: comfort vs support
  const goalsLower = (z.rider.goals || []).map((g) => g.toLowerCase());
  const issues = (z.rider.issues || "").toLowerCase();

  const wantsComfort =
    goalsLower.some((g) =>
      ["comfort", "plush", "traction", "grip", "compliance"].some((k) =>
        g.includes(k)
      )
    ) ||
    ["harsh", "chatter", "chop", "spiky"].some((k) => issues.includes(k));

  const wantsSupport =
    goalsLower.some((g) =>
      ["stability", "jumps", "big hits", "g-out", "bottom"].some((k) =>
        g.includes(k)
      )
    ) ||
    ["bottom", "case", "slam"].some((k) => issues.includes(k));

  if (wantsComfort && !wantsSupport) {
    // bias a touch softer
    bar -= 0.1;
  } else if (wantsSupport && !wantsComfort) {
    // bias a touch firmer
    bar += 0.1;
  }

  // Safe clamp per discipline
  bar = clampFloat(bar, clampLo, clampHi);

  // round to 0.05 bar – feels pro
  return Number(bar.toFixed(2));
}

// Sag baseline
function baselineSagMm(z: ZeroInput["input"], discipline: Discipline): number {
  const g = z.guardrails;
  // Per-model path: when the client sends a resolved target (from a verified
  // bike_models row via lib/sagBounds), honor it + the model's bounds. The
  // model's stock sag is authoritative — sag is preload-set for the rider's
  // weight to hit it — so no discipline literals or rider adjustment here.
  if (g && typeof g.sag_target_mm === "number") {
    const lo = typeof g.sag_min_mm === "number" ? g.sag_min_mm : 95;
    const hi = typeof g.sag_max_mm === "number" ? g.sag_max_mm : 112;
    return clampInt(g.sag_target_mm, lo, hi);
  }

  // v1 fallback — UNCHANGED, preserves the byte-identical regression. Only hit
  // by clients that don't send sag_target_mm (pre-consolidation clients / tests).
  const wf = weightFactor(z);
  const intensity = intensityFactor(z);

  let base =
    discipline === "mx"
      ? 102 // MX typical 98–105
      : discipline === "enduro"
      ? 108 // Enduro typical 105–112
      : 105; // Mixed

  // Heavier + more intense → a bit more sag for stability
  base += wf * 0.5 + intensity * 0.5;

  // Small bias for long enduro days
  if (z.rider.style === "long_enduro") base += 2;

  // Global clamp
  const sag = clampInt(base, 98, 112);
  return sag;
}

// Fork clickers baseline
function baselineForkClicks(z: ZeroInput["input"], discipline: Discipline) {
  const wf = weightFactor(z);
  const intensity = intensityFactor(z);

  // midpoints from ZERO (fully closed)
  let compBase =
    discipline === "mx"
      ? 14 // more support
      : discipline === "enduro"
      ? 16 // softer
      : 15;

  let rebBase =
    discipline === "mx"
      ? 12 // more rebound control
      : discipline === "enduro"
      ? 14 // a touch freer
      : 13;

  // heavier + more intense → stiffer + more rebound control (fewer clicks out)
  compBase -= wf * 0.4 + intensity * 0.6;
  rebBase -= wf * 0.3 + intensity * 0.5;

  const comp_clicks = clampInt(compBase, 6, 24);
  const reb_clicks = clampInt(rebBase, 6, 24);

  return { comp_clicks, reb_clicks };
}

// Shock clickers baseline
function baselineShock(z: ZeroInput["input"], discipline: Discipline) {
  const wf = weightFactor(z);
  const intensity = intensityFactor(z);

  let lscBase = discipline === "mx" ? 12 : discipline === "enduro" ? 14 : 13;

  let rebBase = discipline === "mx" ? 14 : discipline === "enduro" ? 16 : 15;

  let hscBaseTurns =
    discipline === "mx"
      ? 1.4
      : discipline === "enduro"
      ? 1.6
      : 1.5;

  // Scale: heavier + more intense → more control
  lscBase -= wf * 0.3 + intensity * 0.4;
  rebBase -= wf * 0.4 + intensity * 0.6;
  hscBaseTurns -= wf * 0.03 + intensity * 0.05;

  const lsc_clicks = clampInt(lscBase, 6, 20);
  const reb_clicks = clampInt(rebBase, 8, 22);
  const hsc_turns = Number(clampFloat(hscBaseTurns, 0.75, 2.0).toFixed(2));

  return { lsc_clicks, reb_clicks, hsc_turns };
}

/* ------------------------- Guardrail shaping ------------------------- */

export function safeShape(
  partial: Partial<ZeroResult>,
  g: ZeroInput["input"]["guardrails"] | undefined
): ZeroResult {
  const clicksMin = g?.clicks_min ?? 0;
  const clicksMax = g?.clicks_max ?? 30;
  const hscMin = g?.hsc_turns_min ?? 0;
  const hscMax = g?.hsc_turns_max ?? 3;
  const sagMin = g?.sag_min_mm ?? 95;
  const sagMax = g?.sag_max_mm ?? 112;

  const forkComp = clamp(
    Math.round(Number(partial.fork?.comp_clicks ?? 12)),
    clicksMin,
    clicksMax
  );
  const forkReb = clamp(
    Math.round(Number(partial.fork?.reb_clicks ?? 12)),
    clicksMin,
    clicksMax
  );
  const shockLSC = clamp(
    Math.round(Number(partial.shock?.lsc_clicks ?? 12)),
    clicksMin,
    clicksMax
  );
  const shockReb = clamp(
    Math.round(Number(partial.shock?.reb_clicks ?? 14)),
    clicksMin,
    clicksMax
  );
  const shockHSC = clamp(
    Number(partial.shock?.hsc_turns ?? 1.5),
    hscMin,
    hscMax
  );
  const sag = clamp(
    Math.round(Number(partial.shock?.sag_mm ?? g?.sag_target_mm ?? 105)),
    sagMin,
    sagMax
  );

  const out: ZeroResult = {
    fork: { comp_clicks: forkComp, reb_clicks: forkReb },
    shock: {
      lsc_clicks: shockLSC,
      hsc_turns: Number(shockHSC.toFixed(1)),
      reb_clicks: shockReb,
      sag_mm: sag,
    },
    detected: {
      has_air_fork: !!partial.detected?.has_air_fork,
      fork_family: partial.detected?.fork_family,
    },
    notes: Array.isArray(partial.notes) ? partial.notes.slice(0, 12) : [],
  };

  if (typeof partial.fork?.air_pressure_bar === "number") {
    out.fork.air_pressure_bar = Number(
      partial.fork.air_pressure_bar.toFixed(2)
    );
  }
  // Spec-verified fork type is authoritative: an AI-guessed air fork can never
  // survive on a confirmed-coil bike (and a confirmed air fork is flagged even
  // if the model forgot to).
  if (g?.has_air_fork === false) {
    delete out.fork.air_pressure_bar;
    if (out.detected) out.detected.has_air_fork = false;
  } else if (g?.has_air_fork === true && out.detected) {
    out.detected.has_air_fork = true;
  }
  // Pass through a client-computed spring_check if one ever rides in (whitelist
  // reconstruction otherwise drops unknown fields).
  if (partial.spring_check !== undefined) out.spring_check = partial.spring_check;
  return out;
}

/* ------------------------- Prompt construction (baseline AI) ------------------------- */

function buildSystemPrompt(z: ZeroInput["input"]): string {
  const clicksMin = z.guardrails?.clicks_min ?? 0;
  const clicksMax = z.guardrails?.clicks_max ?? 30;
  const hscMin = z.guardrails?.hsc_turns_min ?? 0;
  const hscMax = z.guardrails?.hsc_turns_max ?? 3;
  const sagMin = z.guardrails?.sag_min_mm ?? 95;
  const sagMax = z.guardrails?.sag_max_mm ?? 112;
  const sagTarget = z.guardrails?.sag_target_mm;
  const airSpec = z.guardrails?.has_air_fork;

  const lines = [
    "You are a world-class off-road suspension tuner for modern MX and enduro bikes.",
    "",
    "Your job:",
    "- Use ALL provided context (bike, terrain, temp, elevation, rider weight/skill/style, goals, issues, and zero-based flag).",
    "- Output a realistic, safe zero-based tune suitable for a normal rider.",
    "",
    "Definitions:",
    "- Zero-based means the rider starts with all clickers fully closed (0).",
    "- You must output absolute clicks OUT from zero.",
    "",
    "Output format:",
    "- You must return ONLY a single valid JSON object with this exact shape:",
    "  {",
    '    "fork": { "comp_clicks": number, "reb_clicks": number, "air_pressure_bar"?: number },',
    '    "shock": { "lsc_clicks": number, "hsc_turns": number, "reb_clicks": number, "sag_mm": number },',
    '    "detected"?: { "has_air_fork"?: boolean, "fork_family"?: string },',
    '    "notes": string[]',
    "  }",
    "- Do NOT include any markdown, explanations, or extra text outside the JSON.",
    "",
    "Constraints (guardrails):",
    `- Clamp all clickers between ${clicksMin} and ${clicksMax} clicks out.`,
    `- Clamp shock high-speed compression (hsc_turns) between ${hscMin} and ${hscMax} turns out.`,
    `- Clamp sag between ${sagMin} and ${sagMax} mm unless goals clearly require being slightly stiffer/softer.`,
    // Per-model target (verified bike_models row). Without an explicit target
    // the model tends to echo the generic 105 from the example output.
    ...(typeof sagTarget === "number"
      ? [
          `- Target riding sag for THIS bike is ${sagTarget} mm. Set shock.sag_mm to ${sagTarget} unless the rider's goals/issues clearly justify a small deviation within the clamp range.`,
        ]
      : []),
    "",
    "Bike & fork rules:",
    ...(typeof airSpec === "boolean"
      ? [
          airSpec
            ? "- This bike is confirmed to have a WP AER/XACT-style air fork — include fork.air_pressure_bar and set detected.has_air_fork to true."
            : "- This bike is confirmed to have a COIL fork — do NOT include fork.air_pressure_bar and do not mark it as an air fork.",
        ]
      : [
          "- If the bike is likely to have WP AER/XACT air forks OR the user indicates they have an air fork, you may include fork.air_pressure_bar.",
          "- If you are not confident it's an air fork and the user did not say it is, omit air_pressure_bar.",
        ]),
    "- Never suggest internal revalving, oil changes, or hardware modifications; only clicker changes, sag target, and (if applicable) air pressure guidance.",
    "",
    "Tuning priorities:",
    "- Always react to the rider's weight, skill, and style.",
    "- Use terrain, elevation, and temperature to bias towards traction vs hold-up.",
    "- Respect the rider's goals (e.g., stability, comfort, playfulness, grip, jump support).",
    "- If issues are provided (harsh on braking bumps, packs on whoops, kicks on square-edge, etc.), explicitly address them in the tune.",
    "",
    "Notes field:",
    "- Provide 3–8 short, track-side style notes as a test plan (e.g., 'If harsh on square-edge → +2 fork comp', 'If rear kicks on chop → +2 shock rebound').",
    "- Reference the rider's goals and issues in the notes.",
  ];

  return lines.join("\n");
}

function buildUserPrompt(z: ZeroInput["input"]): string {
  const bikeLine =
    [z.year, z.make, z.model].filter(Boolean).join(" ") || "Unknown bike";

  const weight = z.rider.weight_lbs
    ? `${z.rider.weight_lbs} lb`
    : "not specified (assume 180–190 lb adult, but do NOT say this)";

  const goals =
    (z.rider.goals || []).length > 0
      ? z.rider.goals.join(", ")
      : "No specific goals given";

  const tempStr =
    typeof z.temp_f === "number" ? `${z.temp_f} °F` : "not specified";
  const elevStr =
    typeof z.elev_ft === "number" ? `${z.elev_ft} ft` : "not specified";

  const wantsAir =
    z.wants_air_fork === true
      ? "Rider explicitly indicated an air fork (AER) is in use or desired."
      : "Rider did not explicitly request an air fork.";

  const lines = [
    `Bike: ${bikeLine}`,
    `Terrain: ${z.terrain ?? ""}${z.track ? ` @ ${z.track}` : ""}`,
    `Environment: Temp ${tempStr}, Elevation ${elevStr}`,
    `Rider: ${weight}, skill=${z.rider.skill}, style=${z.rider.style}`,
    `Goals: ${goals}`,
    `Issues: ${z.rider.issues || "None described"}`,
    `Zero-based clickers: ${
      z.has_zeroed_clickers
        ? "true"
        : "false (still output absolute clicks from zero)"
    }`,
    `Air fork: ${wantsAir}`,
    "",
    "Now compute a safe, realistic zero-based tune and respond ONLY with the JSON object.",
  ];

  return lines.join("\n");
}

/* ---------------------------- OpenAI call (baseline refinement only) ---------------------------- */

async function callOpenAI(
  z: ZeroInput["input"]
): Promise<Partial<ZeroResult>> {
  const system = buildSystemPrompt(z);
  const user = buildUserPrompt(z);

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            user +
            "\n\nReturn only valid JSON. Example shape:\n" +
            JSON.stringify(
              {
                fork: {
                  comp_clicks: 12,
                  reb_clicks: 12,
                  air_pressure_bar: 10.6,
                },
                shock: {
                  lsc_clicks: 12,
                  hsc_turns: 1.5,
                  reb_clicks: 14,
                  sag_mm: 105,
                },
                detected: {
                  has_air_fork: true,
                  fork_family: "WP XACT AER 48",
                },
                notes: [
                  "Do X",
                  "If Y then +2 fork reb",
                  "If harsh on square-edge → +2 fork comp",
                ],
              },
              null,
              0
            ),
        },
      ],
      temperature: 0.2,
      max_tokens: 350,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const json = await resp.json();
  const content: string =
    json?.choices?.[0]?.message?.content ??
    json?.choices?.[0]?.message ??
    "{}";

  // Try to parse strict JSON; also strip code fences if present
  const trimmed = String(content)
    .trim()
    .replace(/^```json/i, "")
    .replace(/```$/i, "");

  try {
    return JSON.parse(trimmed);
  } catch {
    // last resort minimal suggestion
    return {};
  }
}

/* ----------------------- Baseline personal notes helper ----------------------- */

function buildPersonalBaselineNotes(
  z: ZeroInput["input"],
  discipline: Discipline,
  hasAER: boolean,
  air_pressure_bar?: number,
  sag_mm?: number
): string[] {
  const bikeStr =
    [z.year, z.make, z.model].filter(Boolean).join(" ") || "your bike";

  const terrain =
    z.terrain && z.terrain.trim().length
      ? z.terrain
      : "mixed off-road terrain";

  const weightStr = z.rider.weight_lbs
    ? `${z.rider.weight_lbs} lb rider`
    : "average adult rider";

  const goalsArr = z.rider.goals || [];
  const goalsStr = goalsArr.length ? goalsArr.join(", ") : "";
  const issuesStr = (z.rider.issues || "").trim();

  const disciplineLabel =
    discipline === "mx"
      ? "MX track"
      : discipline === "enduro"
      ? "enduro / singletrack"
      : "mixed MX / off-road";

  const notes: string[] = [];

  notes.push(
    `Baseline zero-based tune for ${bikeStr} on ${terrain} (${disciplineLabel}).`
  );

  notes.push(
    `This setup assumes a ${weightStr} with ${z.rider.skill} skill and ${z.rider.style.replace(
      "_",
      " "
    )} riding.`
  );

  if (goalsStr) {
    notes.push(`Primary goals: ${goalsStr}.`);
  }

  if (issuesStr) {
    notes.push(`We biased the tune to help with: ${issuesStr}.`);
  }

  if (typeof sag_mm === "number") {
    notes.push(
      `Start by setting rear sag close to ${sag_mm} mm with full gear on, standing in attack position.`
    );
  }

  if (hasAER && typeof air_pressure_bar === "number") {
    notes.push(
      `Set fork air (AER) to about ${air_pressure_bar.toFixed(
        2
      )} bar with the fork bled to ambient, then recheck once the bike is warm.`
    );
  }

  notes.push(
    "Ride a 5–7 minute loop that includes braking bumps, some chop, and at least one faster straight so you can feel stability."
  );

  notes.push(
    "If the front feels harsh or deflects on square-edge hits → add 1–2 clicks of fork compression (softer) and consider dropping ~0.1 bar AER."
  );

  notes.push(
    "If the rear kicks on acceleration chop → add 1–2 clicks of shock rebound (slower) to calm it down."
  );

  notes.push(
    "If it blows through and bottoms hard on landings or G-outs → go 1–2 clicks firmer on shock low-speed compression and 0.1–0.2 turns stiffer on HSC."
  );

  return notes.slice(0, 10);
}

/* --------------------------- Baseline / fallback (mode: zero_baseline_v1) --------------------------- */

function buildFallback(z: ZeroInput["input"]): Partial<ZeroResult> {
  const discipline = inferDiscipline(z);

  // Spec-verified fork type (guardrails) is authoritative; the user toggle
  // and the model-name heuristic only decide for unmatched bikes.
  const specAER = z.guardrails?.has_air_fork;
  const heuristicAER = isAERFork(z.make, z.model);
  const hasAER =
    typeof specAER === "boolean"
      ? specAER
      : z.wants_air_fork === true || heuristicAER;

  const forkClicks = baselineForkClicks(z, discipline);
  const shockClicks = baselineShock(z, discipline);
  const sag_mm = baselineSagMm(z, discipline);
  const air_pressure_bar = baselineAirBar(z, discipline, hasAER);

  const base: Partial<ZeroResult> = {
    fork: {
      comp_clicks: forkClicks.comp_clicks,
      reb_clicks: forkClicks.reb_clicks,
      air_pressure_bar,
    },
    shock: {
      lsc_clicks: shockClicks.lsc_clicks,
      hsc_turns: shockClicks.hsc_turns,
      reb_clicks: shockClicks.reb_clicks,
      sag_mm,
    },
    detected: {
      has_air_fork: hasAER,
      fork_family: hasAER ? "WP XACT AER 48 (heuristic)" : undefined,
    },
    notes: [],
  };

  // Always build rider-specific baseline notes, even if AI is off
  base.notes = buildPersonalBaselineNotes(
    z,
    discipline,
    hasAER,
    air_pressure_bar,
    sag_mm
  );

  return base;
}

/* ---------------- Tune Two symptom labels for tailored notes ---------------- */

const SYMPTOM_LABELS: Record<SymptomId, string> = {
  harsh_braking_bumps: "harsh on braking bumps",
  deflects_in_chop: "front deflects in chop",
  rear_kicks_accel: "rear kicks under acceleration",
  bottoms_landings: "bottoming on landings / G-outs",
  front_knifes: "front knifing in corners",
  dead_feel: "dead / no pop feel",
  unstable_whoops: "unstable in whoops",
  packs_whoops: "packing in whoops",
  harsh_square_edge: "harsh on square-edge",
  headshake: "high-speed headshake",
  general_harsh: "general harsh feel",
};

/* ------------------- v2 vocabularies + validation helpers ------------------- */

const KNOWN_SYMPTOM_IDS = new Set<SymptomId>([
  "harsh_braking_bumps",
  "deflects_in_chop",
  "rear_kicks_accel",
  "bottoms_landings",
  "front_knifes",
  "dead_feel",
  "unstable_whoops",
  "packs_whoops",
  "harsh_square_edge",
  "headshake",
  "general_harsh",
]);

const KNOWN_WHERES = new Set<WhereTag>([
  "braking",
  "corners",
  "whoops",
  "landings",
]);

const KNOWN_AREAS = new Set<ProtectArea>([
  "rear_traction",
  "front_planted",
  "landings",
  "cornering",
]);

const AREA_LABELS: Record<ProtectArea, string> = {
  rear_traction: "rear traction",
  front_planted: "front-end feel",
  landings: "landings",
  cornering: "cornering",
};

// Which circuits each protected area covers (Change 6)
const PROTECT_MAP: Record<ProtectArea, ClickCircuit[]> = {
  rear_traction: ["shock_lsc", "shock_reb"],
  front_planted: ["fork_comp", "fork_reb"],
  landings: ["shock_hsc", "shock_lsc"],
  cornering: ["fork_comp", "fork_reb"],
};

const CIRCUIT_META: Record<Circuit, { label: string; unit: number }> = {
  fork_comp: { label: "fork compression", unit: 1 },
  fork_reb: { label: "fork rebound", unit: 1 },
  shock_lsc: { label: "shock low-speed compression", unit: 1 },
  shock_reb: { label: "shock rebound", unit: 1 },
  shock_hsc: { label: "shock high-speed compression", unit: 0.15 },
  fork_air: { label: "fork air pressure", unit: 0.05 },
};

function normalizeWhere(v: unknown): WhereTag | undefined {
  if (typeof v !== "string") return undefined;
  const w = v.trim().toLowerCase();
  return KNOWN_WHERES.has(w as WhereTag) ? (w as WhereTag) : undefined;
}

function normalizeArea(v: unknown): ProtectArea | undefined {
  if (typeof v !== "string") return undefined;
  const a = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return KNOWN_AREAS.has(a as ProtectArea) ? (a as ProtectArea) : undefined;
}

function fmtDelta(n: number): string {
  const body = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return n > 0 ? `+${body}` : body;
}

/* --------------------- v2 free-text parsing (Change 2) --------------------- */

const PARSE_SYSTEM_PROMPT = [
  "You extract structured dirt-bike suspension feedback from a rider's free-text ride note.",
  'Return ONLY strict JSON with this exact shape: {"symptoms":[{"id":"...","severity":5,"where":"..."}],"protected":[{"area":"..."}]}',
  "Rules:",
  `- "id" MUST be one of: ${[...KNOWN_SYMPTOM_IDS].join(", ")}.`,
  '- "severity" is an integer 1-10 for how bad it sounds; use 5 when unclear.',
  '- "where" is optional and MUST be one of: braking, corners, whoops, landings. Omit it when the note does not say where.',
  '- "protected" entries are ONLY for things the rider says are working well and should not change; "area" MUST be one of: rear_traction, front_planted, landings, cornering.',
  "- If a statement does not map cleanly onto these vocabularies, OMIT it. Never invent symptoms, severities, wheres, or areas.",
  "- Empty arrays are valid. Return no other keys and no prose.",
].join("\n");

/**
 * callParseFeedback — extract structured feedback from a rider's free-text note.
 * Fail-open by design: any timeout, HTTP error, or unparseable response returns
 * null and the pipeline continues on explicit input only.
 */
export async function callParseFeedback(
  freeText: string,
  fetcher: typeof fetch = fetch
): Promise<unknown | null> {
  if (!OPENAI_API_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetcher("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: PARSE_SYSTEM_PROMPT },
          { role: "user", content: freeText.slice(0, 1000) },
        ],
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenAI HTTP ${resp.status}: ${text.slice(0, 120)}`);
    }

    const json = await resp.json();
    const content: string = json?.choices?.[0]?.message?.content ?? "{}";
    return JSON.parse(String(content));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("free-text parse skipped (fail-open):", msg.slice(0, 160));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * sanitizeParsedFeedback — server-side validation of whatever the parse model
 * returned. Everything is whitelisted/clamped regardless of what came back.
 */
export function sanitizeParsedFeedback(raw: unknown): {
  symptoms: Tune2Symptom[];
  protectedAreas: ProtectArea[];
} {
  const out: { symptoms: Tune2Symptom[]; protectedAreas: ProtectArea[] } = {
    symptoms: [],
    protectedAreas: [],
  };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as any;

  if (Array.isArray(r.symptoms)) {
    for (const s of r.symptoms) {
      if (!s || typeof s !== "object") continue;
      const id = typeof s.id === "string" ? s.id.trim() : "";
      if (!KNOWN_SYMPTOM_IDS.has(id as SymptomId)) continue; // unknown ids dropped
      const severity = clampInt(Number(s.severity) || 5, 1, 10);
      const where = normalizeWhere(s.where);
      out.symptoms.push({
        id: id as SymptomId,
        severity,
        ...(where ? { where } : {}),
        source: "parsed",
      });
    }
  }

  if (Array.isArray(r.protected)) {
    for (const p of r.protected) {
      const area = normalizeArea(p?.area);
      if (area && !out.protectedAreas.includes(area)) {
        out.protectedAreas.push(area);
      }
    }
  }

  return out;
}

/* --------------------------- v2 merge stage (Change 3) --------------------------- */

/**
 * mergeFeedback — combine explicit chip feedback with parsed free-text feedback.
 * Per symptom id, explicit chips win on conflict (severity AND where); parsed
 * symptoms only add ids the rider didn't chip. Same rule for protected areas
 * (union — same vocabulary, no per-area payload to conflict on).
 */
export function mergeFeedback(
  explicit: Tune2Feedback | undefined,
  parsed: { symptoms: Tune2Symptom[]; protectedAreas: ProtectArea[] } | null
): {
  symptoms: Tune2Symptom[];
  protectedAreas: ProtectArea[];
  parsedAddedIds: SymptomId[];
} {
  const symptoms: Tune2Symptom[] = [];
  const seen = new Set<SymptomId>();

  for (const s of explicit?.symptoms ?? []) {
    if (!s || !KNOWN_SYMPTOM_IDS.has(s.id as SymptomId)) continue;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const where = normalizeWhere(s.where);
    symptoms.push({
      id: s.id,
      severity: s.severity,
      ...(where ? { where } : {}),
      source: "explicit",
    });
  }

  const parsedAddedIds: SymptomId[] = [];
  for (const s of parsed?.symptoms ?? []) {
    if (seen.has(s.id)) continue; // explicit chip wins
    seen.add(s.id);
    symptoms.push(s);
    parsedAddedIds.push(s.id);
  }

  const protectedAreas: ProtectArea[] = [];
  for (const p of explicit?.protected ?? []) {
    const area = normalizeArea(p?.area);
    if (area && !protectedAreas.includes(area)) protectedAreas.push(area);
  }
  for (const area of parsed?.protectedAreas ?? []) {
    if (!protectedAreas.includes(area)) protectedAreas.push(area);
  }

  return { symptoms, protectedAreas, parsedAddedIds };
}

/** sanitizeLastOutcome — whitelist/clamp the optional adaptive-step input. */
export function sanitizeLastOutcome(raw: unknown): Tune2LastOutcome | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as any;
  if (!["improved", "same", "worse"].includes(r.outcome)) return undefined;

  const symptoms: SymptomId[] = Array.isArray(r.symptoms)
    ? r.symptoms.filter((id: unknown) =>
        KNOWN_SYMPTOM_IDS.has(id as SymptomId)
      )
    : [];

  const deltas: Tune2LastOutcome["deltas"] = {};
  if (r.deltas && typeof r.deltas === "object") {
    for (const key of ["fork_comp", "fork_reb", "shock_lsc", "shock_reb", "shock_hsc"] as ClickCircuit[]) {
      const v = Number(r.deltas[key]);
      if (Number.isFinite(v) && v !== 0) {
        deltas[key] = clampFloat(v, -10, 10);
      }
    }
  }

  if (!symptoms.length || !Object.keys(deltas).length) return undefined;
  return { outcome: r.outcome, symptoms, deltas };
}

/* --------------------------- Tune Two engine (mode: tune2_v1) --------------------------- */

export function buildTuneTwo(input: Tune2Input): Partial<ZeroResult> {
  const prev = input.previous;

  // Start from previous tune
  let forkComp = prev.fork.comp_clicks;
  let forkReb = prev.fork.reb_clicks;
  let air = prev.fork.air_pressure_bar;
  let shockLSC = prev.shock.lsc_clicks;
  let shockReb = prev.shock.reb_clicks;
  let shockHSC = prev.shock.hsc_turns;
  const sag = prev.shock.sag_mm; // keep sag constant in Tune Two (for now)

  const fb = input.feedback;
  const symptoms = fb?.symptoms ?? [];

  // ---- Scale aggressiveness based on overall rating ----
  const overall = clampInt(fb?.overall_rating ?? 6, 1, 10);

  let globalScale = 1;
  if (overall >= 9) globalScale = 0.4; // almost perfect → micro moves
  else if (overall >= 7) globalScale = 0.7;
  else if (overall >= 5) globalScale = 1.0;
  else if (overall >= 3) globalScale = 1.3;
  else globalScale = 1.5; // really bad → bigger moves (still safe)

  if (!symptoms.length) {
    // No feedback – just echo previous tune with a gentle note
    return {
      fork: { comp_clicks: forkComp, reb_clicks: forkReb, air_pressure_bar: air },
      shock: {
        lsc_clicks: shockLSC,
        hsc_turns: shockHSC,
        reb_clicks: shockReb,
        sag_mm: sag,
      },
      detected: prev.detected,
      notes: [
        "No specific issues were selected, so this Tune Two keeps your last settings.",
        "Next moto: pick where it felt off (braking bumps, whoops, landings, etc.) so we can make targeted changes.",
      ],
    };
  }

  // v2: accumulate per-circuit CONTRIBUTIONS instead of running sums, so
  // opposing symptoms can be resolved explicitly (Change 5).
  const contribs: Record<Circuit, Contribution[]> = {
    fork_comp: [],
    fork_reb: [],
    shock_lsc: [],
    shock_reb: [],
    shock_hsc: [],
    fork_air: [],
  };
  const symptomNotes: string[] = [];

  const add = (
    circuit: Circuit,
    symptomId: SymptomId,
    delta: number,
    severity: number
  ) => {
    if (delta === 0) return;
    contribs[circuit].push({
      symptomId,
      delta,
      severity: clampInt(severity || 5, 1, 10),
    });
  };

  if (input.parsedAddedIds?.length) {
    const labels = input.parsedAddedIds
      .map((id) => SYMPTOM_LABELS[id])
      .filter(Boolean)
      .join(", ");
    symptomNotes.push(`From your written note, I also picked up: ${labels}.`);
  }

  const clickDeltaForSeverity = (sev: number) => {
    const s = clampInt(sev || 5, 1, 10);
    let base = 1;
    if (s <= 3) base = 1;
    else if (s <= 7) base = 2;
    else if (s <= 9) base = 3;
    else base = 4;

    const scaled = Math.round(base * globalScale);
    return clampInt(scaled, 1, 4);
  };

  const airDeltaForSeverity = (sev: number) => {
    const s = clampInt(sev || 5, 1, 10);
    let base = 0.05;
    if (s <= 3) base = 0.05;
    else if (s <= 7) base = 0.1;
    else if (s <= 9) base = 0.2;
    else base = 0.25;

    const scaled = base * globalScale;
    return clampFloat(scaled, 0.03, 0.3);
  };

  // Where-suffix helper for symptom+where combos that have NO special modifier
  // (Change 4: "the where still appears in that symptom's note").
  const whereSuffix = (s: Tune2Symptom) =>
    s.where ? ` (reported in ${s.where})` : "";

  // Reusable case bodies so where-modifiers can route between them (Change 4).
  const applyBottomsLandings = (s: Tune2Symptom, routedFrom?: SymptomId) => {
    const scale = clickDeltaForSeverity(s.severity);
    const airScale = airDeltaForSeverity(s.severity);
    const dLSC = Math.max(1, scale - 1);
    const dHSC = 0.15 * (scale >= 3 ? 2 : 1);
    add("shock_lsc", s.id, -dLSC, s.severity);
    add("shock_hsc", s.id, -dHSC, s.severity);
    if (air !== undefined) add("fork_air", s.id, airScale * 0.7, s.severity);
    if (routedFrom) {
      symptomNotes.push(
        `Harshness on landings is a bottoming problem → -${dLSC} shock LSC clicks (firmer) and -${dHSC.toFixed(
          2
        )} HSC turns.`
      );
    } else {
      symptomNotes.push(
        `Bottoming on landings / G-outs → -${dLSC} shock LSC clicks (firmer) and -${dHSC.toFixed(
          2
        )} HSC turns.${routedFrom ? "" : whereSuffix(s) && s.where !== "whoops" ? whereSuffix(s) : ""}`
      );
    }
    if (air !== undefined) {
      symptomNotes.push(
        `Also +${(airScale * 0.7).toFixed(
          2
        )} bar fork AER for more mid-stroke support.`
      );
    }
    // bottoms_landings + whoops → also slow the shock for whoop faces (Change 4)
    if (!routedFrom && s.where === "whoops") {
      add("shock_reb", s.id, -1, s.severity);
      symptomNotes.push(
        "Since the bottoming is in whoops → also -1 shock rebound click (slower on whoop faces)."
      );
    }
  };

  const applyFrontKnifes = (s: Tune2Symptom, routedFrom?: SymptomId) => {
    const scale = clickDeltaForSeverity(s.severity);
    const dComp = Math.max(1, scale - 1);
    add("fork_comp", s.id, -dComp, s.severity);
    add("fork_reb", s.id, 1, s.severity);
    if (routedFrom === "unstable_whoops") {
      symptomNotes.push(
        `Instability in corners points at the front end → -${dComp} fork compression clicks (firmer) and +1 fork rebound click for support.`
      );
    } else {
      symptomNotes.push(
        `Front knifing in corners → -${dComp} fork compression clicks (firmer) and +1 fork rebound click for a touch more pop.`
      );
    }
  };

  for (const s of symptoms) {
    const scale = clickDeltaForSeverity(s.severity);
    const airScale = airDeltaForSeverity(s.severity);

    switch (s.id) {
      case "harsh_braking_bumps": {
        if (s.where === "landings") {
          // Change 4: it's a bottoming complaint — route to bottoms logic.
          applyBottomsLandings(s, "harsh_braking_bumps");
          break;
        }
        // Front is too stiff / spiky on small chop → soften comp, tiny air tweak
        add("fork_comp", s.id, scale, s.severity); // more clicks out = softer
        if (s.where === "corners") {
          // Change 4: weight softening toward fork comp only, skip the air tweak.
          symptomNotes.push(
            `Harsh into corners → +${scale} fork compression clicks (softer), leaving air pressure alone.`
          );
          break;
        }
        if (air !== undefined) add("fork_air", s.id, -(airScale * 0.5), s.severity);
        symptomNotes.push(
          `Harsh on braking bumps → +${scale} fork compression clicks (softer).${
            air !== undefined
              ? ` Optionally -${airScale.toFixed(2)} bar AER.`
              : ""
          }${s.where === "whoops" ? "" : whereSuffix(s)}`
        );
        if (s.where === "whoops") {
          // Change 4: harshness in whoops → also soften the shock a touch.
          add("shock_lsc", s.id, 1, s.severity);
          symptomNotes.push(
            "Since it's harsh in the whoops → also +1 shock LSC click (softer)."
          );
        }
        break;
      }
      case "deflects_in_chop": {
        // Front hunts side to side → rebound too fast → slower rebound
        add("fork_reb", s.id, -scale, s.severity); // fewer clicks = slower
        symptomNotes.push(
          `Front deflects in chop → -${scale} fork rebound clicks (slower to keep the tire planted).${whereSuffix(s)}`
        );
        break;
      }
      case "rear_kicks_accel": {
        // Rear kicking on throttle → rebound too fast
        add("shock_reb", s.id, -scale, s.severity);
        symptomNotes.push(
          `Rear kicks on acceleration chop → -${scale} shock rebound clicks (slower to stop kicking).${whereSuffix(s)}`
        );
        break;
      }
      case "bottoms_landings": {
        applyBottomsLandings(s);
        break;
      }
      case "front_knifes": {
        applyFrontKnifes(s);
        break;
      }
      case "dead_feel": {
        if (s.where === "corners") {
          // Change 4: fork-only version — skip the shock rebound change.
          add("fork_reb", s.id, scale, s.severity);
          add("fork_comp", s.id, -1, s.severity);
          symptomNotes.push(
            `Dead feel in corners → +${scale} fork rebound clicks (livelier front) with -1 fork comp click for support, leaving the shock alone.`
          );
          break;
        }
        // Bike feels glued / no pop → more rebound speed, a bit more support
        add("fork_reb", s.id, scale, s.severity);
        add("shock_reb", s.id, Math.max(1, scale - 1), s.severity);
        add("fork_comp", s.id, -1, s.severity);
        symptomNotes.push(
          `Bike feels dead / no pop → +${scale} fork rebound clicks and +${Math.max(
            1,
            scale - 1
          )} shock rebound clicks (faster), with -1 fork comp click for a bit more support.${whereSuffix(s)}`
        );
        break;
      }
      case "unstable_whoops": {
        if (s.where === "corners") {
          // Change 4: instability in corners → treat as front_knifes instead.
          applyFrontKnifes(s, "unstable_whoops");
          break;
        }
        // Unstable in whoops → more control (slower rebound)
        add("fork_reb", s.id, -scale, s.severity);
        add("shock_reb", s.id, -scale, s.severity);
        if (air !== undefined) add("fork_air", s.id, airScale * 0.4, s.severity);
        symptomNotes.push(
          `Unstable in whoops → -${scale} fork rebound clicks and -${scale} shock rebound clicks (slower for stability).${whereSuffix(s)}`
        );
        if (air !== undefined) {
          symptomNotes.push(
            `Slight +${(airScale * 0.4).toFixed(
              2
            )} bar AER to hold up in whoops.`
          );
        }
        break;
      }
      case "packs_whoops": {
        // Packing in whoops → rebound too slow → speed it up
        add("fork_reb", s.id, scale, s.severity);
        add("shock_reb", s.id, scale, s.severity);
        symptomNotes.push(
          `Packing in whoops → +${scale} fork rebound clicks and +${scale} shock rebound clicks (faster to avoid packing).${whereSuffix(s)}`
        );
        break;
      }
      case "harsh_square_edge": {
        // Sharp square-edge → comp too stiff
        const dLSC = Math.max(1, scale - 1);
        add("fork_comp", s.id, scale, s.severity);
        add("shock_lsc", s.id, dLSC, s.severity);
        symptomNotes.push(
          `Harsh on square-edge → +${scale} fork compression clicks (softer) and +${dLSC} shock LSC clicks for traction.${
            s.where === "corners" ? "" : whereSuffix(s)
          }`
        );
        if (s.where === "corners") {
          // Change 4: square-edge harshness in corners → add the front_knifes pop move.
          add("fork_reb", s.id, 1, s.severity);
          symptomNotes.push(
            "Since it's in corners → also +1 fork rebound click for a touch more front-end pop."
          );
        }
        break;
      }
      case "headshake": {
        // High-speed headshake → calm chassis (small clicks only)
        add("shock_reb", s.id, -1, s.severity);
        add("fork_reb", s.id, -1, s.severity);
        symptomNotes.push(
          "High-speed headshake → -1 fork rebound click and -1 shock rebound click (slightly slower) for stability."
        );
        break;
      }
      case "general_harsh": {
        // General harshness → small global softening
        const dComp = Math.max(1, scale - 1);
        add("fork_comp", s.id, dComp, s.severity);
        add("shock_lsc", s.id, 1, s.severity);
        if (air !== undefined) add("fork_air", s.id, -(airScale * 0.5), s.severity);
        symptomNotes.push(
          `General harshness → +${dComp} fork compression clicks (softer) and +1 shock LSC click.${whereSuffix(s)}`
        );
        if (air !== undefined) {
          symptomNotes.push(
            `Also -${(airScale * 0.5).toFixed(
              2
            )} bar AER for a touch more comfort.`
          );
        }
        break;
      }
    }
  }

  // ---- Change 5: per-circuit conflict resolution (replaces silent summing) ----
  const conflictNotes: string[] = [];
  const resolved: Record<Circuit, number> = {
    fork_comp: 0,
    fork_reb: 0,
    shock_lsc: 0,
    shock_reb: 0,
    shock_hsc: 0,
    fork_air: 0,
  };

  for (const circuit of Object.keys(contribs) as Circuit[]) {
    const list = contribs[circuit];
    if (!list.length) continue;

    const pos = list.filter((c) => c.delta > 0);
    const neg = list.filter((c) => c.delta < 0);

    if (!pos.length || !neg.length) {
      // All contributions agree in sign → sum as before.
      resolved[circuit] = list.reduce((acc, c) => acc + c.delta, 0);
      continue;
    }

    // Opposing signs: highest severity wins direction; magnitude shrinks by
    // the largest opposing pull, never below one adjustment unit.
    const winner = [...list].sort(
      (a, b) =>
        b.severity - a.severity || Math.abs(b.delta) - Math.abs(a.delta)
    )[0];
    const opposers = winner.delta > 0 ? neg : pos;
    const largestOpposer = [...opposers].sort(
      (a, b) => Math.abs(b.delta) - Math.abs(a.delta)
    )[0];

    const unit = CIRCUIT_META[circuit].unit;
    const magnitude = Math.max(
      unit,
      Math.abs(winner.delta) - Math.abs(largestOpposer.delta)
    );
    resolved[circuit] = Math.sign(winner.delta) * magnitude;

    conflictNotes.push(
      `You reported both ${SYMPTOM_LABELS[largestOpposer.symptomId]} and ${
        SYMPTOM_LABELS[winner.symptomId]
      }, which pull ${CIRCUIT_META[circuit].label} opposite ways — ${
        SYMPTOM_LABELS[winner.symptomId]
      } was worse, so I prioritized it with a smaller step.`
    );
  }

  // ---- Change 6a: protect pass ----
  const protectNotes: string[] = [];
  const protectedCircuits = new Set<Circuit>(); // fully zeroed OR capped — adaptive skips both
  const handledCircuits = new Set<Circuit>();

  for (const area of input.protectedAreas ?? []) {
    for (const circuit of PROTECT_MAP[area] ?? []) {
      if (handledCircuits.has(circuit)) continue;
      handledCircuits.add(circuit);
      protectedCircuits.add(circuit);

      const current = resolved[circuit];
      if (current === 0) continue; // nothing to zero → no note

      const circuitContribs = contribs[circuit];
      const topSeverity = Math.max(
        0,
        ...circuitContribs.map((c) => c.severity)
      );

      if (topSeverity >= 8) {
        // A severe symptom demands this circuit → cap at ±1 unit instead of zero.
        const unit = CIRCUIT_META[circuit].unit;
        const capped = Math.sign(current) * Math.min(Math.abs(current), unit);
        resolved[circuit] = capped;
        const demanding = circuitContribs
          .filter((c) => c.severity >= 8)
          .map((c) => SYMPTOM_LABELS[c.symptomId])[0];
        protectNotes.push(
          `You asked me to keep ${AREA_LABELS[area]} as-is, but ${demanding} really needs ${CIRCUIT_META[circuit].label} — capping that change at ${fmtDelta(capped)} instead of skipping it.`
        );
      } else {
        resolved[circuit] = 0;
        protectNotes.push(
          `Left ${CIRCUIT_META[circuit].label} alone — you said it was working.`
        );
      }
    }
  }

  // ---- Change 6b: adaptive step from last outcome ----
  const adaptiveNotes: string[] = [];
  const lo = input.lastOutcome;
  if (lo && lo.outcome !== "improved") {
    for (const key of Object.keys(lo.deltas) as ClickCircuit[]) {
      const lastDelta = lo.deltas[key];
      if (!lastDelta || !CIRCUIT_META[key]) continue;
      // Protection outranks history — never re-touch a protected circuit here.
      if (protectedCircuits.has(key)) continue;
      // Only when this feedback re-reports a symptom the last refinement addressed,
      // and that symptom pulls on this circuit this round.
      const reReported = contribs[key].some((c) =>
        lo.symptoms.includes(c.symptomId)
      );
      if (!reReported) continue;

      const label = CIRCUIT_META[key].label;
      if (lo.outcome === "worse") {
        resolved[key] = -lastDelta;
        adaptiveNotes.push(
          `Heads up: last time we moved ${label} by ${fmtDelta(
            lastDelta
          )} and it felt WORSE — reversing that this round (${fmtDelta(
            -lastDelta
          )}).`
        );
      } else if (lo.outcome === "same" && resolved[key] !== 0) {
        const unit = CIRCUIT_META[key].unit;
        resolved[key] += Math.sign(resolved[key]) * unit;
        adaptiveNotes.push(
          `${label[0].toUpperCase()}${label.slice(1)} didn't change the feel last time, so I'm taking a slightly bigger step this round.`
        );
      }
    }
  }

  // ---- Existing total clamps so we never go wild in one step ----
  const dForkComp = clampInt(resolved.fork_comp, -4, 4);
  const dForkReb = clampInt(resolved.fork_reb, -4, 4);
  const dShockLSC = clampInt(resolved.shock_lsc, -4, 4);
  const dShockReb = clampInt(resolved.shock_reb, -4, 4);
  const dShockHSC = clampFloat(resolved.shock_hsc, -0.5, 0.5);
  const dAir = clampFloat(resolved.fork_air, -0.3, 0.3);

  // Apply deltas
  forkComp += dForkComp;
  forkReb += dForkReb;
  shockLSC += dShockLSC;
  shockReb += dShockReb;
  shockHSC += dShockHSC;
  if (air !== undefined) {
    air += dAir;
  }

  // Tailored summary based on bike / terrain / selected issues / goals
  const humanSymptoms = Array.from(
    new Set(
      symptoms
        .map((s) => SYMPTOM_LABELS[s.id as SymptomId])
        .filter(Boolean)
    )
  );

  const bikeStr =
    [input.year, input.make, input.model].filter(Boolean).join(" ") ||
    "your bike";
  const terrainStr = input.terrain || "today's terrain";

  const goalsArr = input.rider?.goals ?? [];
  const goalsStr =
    goalsArr.length > 0 ? `Goals: ${goalsArr.join(", ")}.` : undefined;

  const issuesPart = humanSymptoms.length
    ? `small changes for ${humanSymptoms.join(", ")}.`
    : "small changes based on your feedback.";

  const summary: string[] = [
    `Tune Two for ${bikeStr} on ${terrainStr}: ${issuesPart}`,
    "Re-test on the same section for 3–5 laps. If a symptom gets worse, go back 2 clicks in that direction.",
  ];
  if (goalsStr) summary.push(goalsStr);

  // Notes priority when trimming to 12 (safeShape slices): summary first, then
  // adaptive/protect/conflict decisions, then routine per-symptom notes.
  const notes = [
    ...summary,
    ...adaptiveNotes,
    ...protectNotes,
    ...conflictNotes,
    ...symptomNotes,
  ];

  const out: Partial<ZeroResult> = {
    fork: {
      comp_clicks: forkComp,
      reb_clicks: forkReb,
      air_pressure_bar: air,
    },
    shock: {
      lsc_clicks: shockLSC,
      hsc_turns: shockHSC,
      reb_clicks: shockReb,
      sag_mm: sag,
    },
    detected: prev.detected,
    notes,
  };

  return out;
}

/* ------------------- Auth + rate limiting (Change 1) ------------------- */

const RATE_LIMIT_USER_PER_HOUR = 20; // authenticated users, all modes
const RATE_LIMIT_ANON_PER_HOUR = 10; // anon-key callers, baseline only
const RATE_WINDOW_MS = 60 * 60 * 1000;

export type HandlerDeps = {
  /** Resolve the calling user's id from the request, or null for anon-key/invalid. */
  getUserId: (req: Request) => Promise<string | null>;
  /** Count this caller's ai-tune calls in the last hour. null = infra failure (fail-open). */
  countRecentCalls: (key: { userId?: string; ip?: string }) => Promise<number | null>;
  /** Record this call for future rate-limit windows. Must never throw.
   *  Returns the inserted tune_calls id so the output can be attached after
   *  generation (void-returning test fakes read as "no id"). */
  recordCall: (row: {
    userId: string | null;
    ip: string | null;
    mode: string;
    // Optional so pre-existing test fakes keep compiling; null for
    // authenticated callers and for anon callers that sent no/garbage id.
    anonId?: string | null;
    // v2.4.0 data capture — the full validated request input, the promoted
    // rider weight, and the matched bike_models id (all optional for the
    // same fake-compat reason).
    input?: unknown;
    riderWeightLbs?: number | null;
    bikeModelId?: string | null;
  }) => Promise<number | null | void>;
  /** Attach the generated tune to the tune_calls row after a successful
   *  generation. Optional (test fakes omit it); must never throw. */
  recordOutput?: (callId: number, output: unknown) => Promise<void>;
  /** Parse free-text feedback (Change 2). null = skip (fail-open). */
  parseFreeText: (text: string) => Promise<unknown | null>;
};

// deno-lint-ignore no-explicit-any
let _anonClient: any = null;
function getAnonClient() {
  if (!_anonClient) {
    _anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
  }
  return _anonClient;
}

// deno-lint-ignore no-explicit-any
let _serviceClient: any = null;
function getServiceClient() {
  if (!_serviceClient) {
    _serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _serviceClient;
}

export const defaultDeps: HandlerDeps = {
  getUserId: async (req) => {
    try {
      const token = (req.headers.get("Authorization") ?? "")
        .replace(/^Bearer\s+/i, "")
        .trim();
      if (!token) return null;
      // The anon key is itself a valid JWT but carries no user — getUser()
      // rejects it, which is exactly the "anon key alone doesn't count" rule.
      const { data, error } = await getAnonClient().auth.getUser(token);
      if (error || !data?.user?.id) return null;
      return data.user.id;
    } catch {
      return null;
    }
  },

  countRecentCalls: async ({ userId, ip }) => {
    try {
      const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
      let q = getServiceClient()
        .from("tune_calls")
        .select("*", { count: "exact", head: true })
        .gte("created_at", since);
      q = userId ? q.eq("user_id", userId) : q.eq("ip", ip ?? "unknown");
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    } catch (e) {
      // Fail-open: a rate-limit infra hiccup must not take tuning down.
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("rate-limit count failed (fail-open):", msg.slice(0, 160));
      return null;
    }
  },

  recordCall: async ({ userId, ip, mode, anonId, input, riderWeightLbs, bikeModelId }) => {
    try {
      const { data, error } = await getServiceClient()
        .from("tune_calls")
        .insert({
          user_id: userId,
          ip,
          mode,
          anon_id: anonId ?? null,
          input: input ?? null,
          rider_weight_lbs: riderWeightLbs ?? null,
          bike_model_id: bikeModelId ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return typeof data?.id === "number" ? data.id : null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("tune_calls insert failed:", msg.slice(0, 160));
      return null;
    }
  },

  recordOutput: async (callId, output) => {
    try {
      const { error } = await getServiceClient()
        .from("tune_calls")
        .update({ output })
        .eq("id", callId);
      if (error) throw error;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("tune_calls output update failed:", msg.slice(0, 160));
    }
  },

  parseFreeText: (text) => callParseFeedback(text),
};

/* ---------------- H2: server-side entitlement / credit gate ---------------- */
// Until now the free-credit quota and Pro gate lived only in the client
// (tune.tsx calls claim_free_tune before invoking this function), so direct
// API calls got unlimited baseline tunes and the claim/refund pairing was
// client-trusted. Enforcement now happens here, per request:
//
//   guests (anon-key, zero_baseline only): allowed — guest onboarding depends
//     on it; abuse-bounded by the per-IP hourly rate limit.
//   tune2_v1: authenticated-only (checked above the mode branch), and NO
//     Pro/credit gate — mirrors the product: the client refine flow
//     (tune-feedback.tsx) has never been Pro-gated (churned users may refine
//     their saved setups); it never claims credits for refinements.
//   zero_baseline_v1 + authenticated: Pro passes through untouched; non-Pro
//     must hold the free credit. The server claims it atomically BEFORE
//     generation and refunds it itself if generation throws.
//
// INTERIM COMPATIBILITY with deployed v2.0.x clients (they claim client-side
// via claim_free_tune, then call this function; a second server claim would
// double-consume and reject legitimate first tunes): claim_free_tune stamps
// profiles.trial_claimed_at when it consumes (migration 20260710180000).
// "Credit consumed + fresh stamp" therefore means THIS request carries the
// client's claim → pass through without claiming again, and without a server
// refund on failure (the old client performs its own refund, which clears
// the stamp). Server-side claims deliberately do NOT stamp, so a
// server-claimed request opens no grace window of its own — the second
// direct call sees a stale/absent stamp and is rejected. Once pre-claiming
// clients age out, drop CLIENT_CLAIM_GRACE_MS to 0.

const CLIENT_CLAIM_GRACE_MS = 2 * 60 * 1000;

type CreditDecision =
  | { allow: true; serverClaimed: boolean }
  | { allow: false; status: number; error: string };

async function enforceBaselineCredit(userId: string): Promise<CreditDecision> {
  // Atomic claim/pro decision lives in SQL (server_claim_free_tune,
  // migration 20260710190000, service_role-only) under the same row lock the
  // client RPC uses. NOTE: this was first built as a PostgREST guarded
  // update with an or=() filter, which Postgres rejects with a spurious
  // 42703 on UPDATE — do not reintroduce that shape.
  const { data, error } = await getServiceClient().rpc(
    "server_claim_free_tune",
    { p_user_id: userId },
  );
  if (error) {
    // Fail-open with a loud log, matching this function's rate-limit
    // precedent: this runs as service role, so a caller cannot induce the
    // failure, and blocking paying users on an infra blip is worse than one
    // uncounted tune.
    console.error(
      "server claim failed (fail-open):",
      String(error.message ?? error).slice(0, 160),
    );
    return { allow: true, serverClaimed: false };
  }

  const reason = (data as any)?.reason;
  if (reason === "pro") return { allow: true, serverClaimed: false };
  if (reason === "claimed") return { allow: true, serverClaimed: true };

  // no_trial → interim pass-through window: an old client claimed for this
  // exact request moments ago (claim_free_tune stamps trial_claimed_at;
  // server claims never do).
  const claimedAtMs = (data as any)?.claimed_at
    ? new Date((data as any).claimed_at).getTime()
    : 0;
  if (claimedAtMs && Date.now() - claimedAtMs <= CLIENT_CLAIM_GRACE_MS) {
    return { allow: true, serverClaimed: false };
  }
  return { allow: false, status: 402, error: "no_trial" };
}

/** Exact inverse of a server-side claim (guarded decrement in SQL). */
async function refundServerClaim(userId: string): Promise<void> {
  try {
    const { error } = await getServiceClient().rpc(
      "server_refund_free_tune",
      { p_user_id: userId },
    );
    if (error) {
      console.error(
        "server refund failed:",
        String(error.message ?? error).slice(0, 160),
      );
    }
  } catch (e) {
    console.error(
      "server refund threw:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function callerIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

// Strict uuid gate for the client-supplied anon_id — anything else (including
// the app's legacy "1783553470201_…" local ids) must never reach the uuid
// column.
const ANON_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function anonIdFrom(body: ZeroInput, userId: string | null): string | null {
  if (userId) return null; // authenticated rows are already attributed
  const raw = body.anon_id;
  return typeof raw === "string" && ANON_ID_RE.test(raw)
    ? raw.toLowerCase()
    : null;
}

/* ------------------ v2.4.0 data capture (tune_calls) ------------------ */

function riderWeightFrom(body: ZeroInput): number | null {
  const w = body.input?.rider?.weight_lbs;
  return typeof w === "number" && Number.isFinite(w) ? Math.round(w) : null;
}

// Same strict uuid gate as anon_id: tune_calls.bike_model_id is a uuid FK,
// so anything else must never reach it.
function bikeModelIdFrom(body: ZeroInput): string | null {
  const raw = body.input?.model_id;
  return typeof raw === "string" && ANON_ID_RE.test(raw)
    ? raw.toLowerCase()
    : null;
}

/* ------------------------------ Handler ------------------------------ */

export function makeHandler(deps: HandlerDeps = defaultDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: CORS_HEADERS });
    }

    try {
      const body = (await req.json().catch(() => null)) as ZeroInput | null;
      if (!body || !body.input) {
        return jsonResponse({ error: "Bad request" }, 400);
      }

      const mode = body.mode ?? "zero_baseline_v1";

      // ---------------- Change 1: server-side auth ----------------
      // tune2_v1 requires a real authenticated user; zero_baseline_v1 permits
      // anon-key callers (guest onboarding depends on it).
      const userId = await deps.getUserId(req);
      if (mode === "tune2_v1" && !userId) {
        return jsonResponse({ error: "Sign in to refine your tune." }, 401);
      }

      // ---------------- Change 1: abuse rate limit ----------------
      const ip = callerIp(req);
      const limit = userId ? RATE_LIMIT_USER_PER_HOUR : RATE_LIMIT_ANON_PER_HOUR;
      const recent = await deps.countRecentCalls(
        userId ? { userId } : { ip }
      );
      if (recent !== null && recent >= limit) {
        return jsonResponse(
          {
            error:
              "You've hit the hourly tune limit — take a breather and try again in a bit.",
          },
          429
        );
      }
      // The insert stays HERE (before generation) so rate-limit counting is
      // unchanged; the generated tune is attached to the row afterwards via
      // recordOutput. `input` is body.input verbatim — top-level mode/anon_id
      // are excluded (already dedicated columns) and ip never enters the body.
      const recordedId = await deps.recordCall({
        userId: userId ?? null,
        ip: userId ? null : ip,
        mode,
        anonId: anonIdFrom(body, userId),
        input: body.input,
        riderWeightLbs: riderWeightFrom(body),
        bikeModelId: bikeModelIdFrom(body),
      });
      const callId = typeof recordedId === "number" ? recordedId : null;

      // ------------------------ MODE: Tune Two (feedback refinement) ------------------------
      if (mode === "tune2_v1") {
        const raw = body.input as any;

        if (!raw.previous || !raw.feedback) {
          return jsonResponse(
            { error: "Tune Two requires 'previous' tune and 'feedback'." },
            400
          );
        }

        // ---- Change 2: free-text parse stage (fail-open) ----
        const freeText =
          typeof raw.feedback?.free_text === "string"
            ? raw.feedback.free_text.trim()
            : "";
        let parsed: { symptoms: Tune2Symptom[]; protectedAreas: ProtectArea[] } | null =
          null;
        if (freeText.length > 0) {
          // Fail-open even if the parse dep itself throws.
          const rawParsed = await deps.parseFreeText(freeText).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn("free-text parse dep failed (fail-open):", msg.slice(0, 160));
            return null;
          });
          parsed = rawParsed ? sanitizeParsedFeedback(rawParsed) : null;
        }

        // ---- Change 3: merge (explicit chips win) ----
        const merged = mergeFeedback(raw.feedback as Tune2Feedback, parsed);

        const tune2Input: Tune2Input = {
          make: raw.make,
          model: raw.model,
          year: raw.year,
          terrain: raw.terrain,
          track: raw.track,
          rider: raw.rider,
          previous: raw.previous as ZeroResult,
          feedback: {
            ...(raw.feedback as Tune2Feedback),
            symptoms: merged.symptoms,
          },
          guardrails: raw.guardrails,
          protectedAreas: merged.protectedAreas,
          lastOutcome: sanitizeLastOutcome(raw.last_outcome),
          parsedAddedIds: merged.parsedAddedIds,
        };

        const partial = buildTuneTwo(tune2Input);
        const result = safeShape(partial, tune2Input.guardrails);

        if (callId !== null) await deps.recordOutput?.(callId, result);
        return jsonResponse(result, 200);
      }

      // ------------------------ MODE: Baseline (zero_baseline_v1) ------------------------
      // ---- H2: server-side Pro/credit gate (guests pass; see helper) ----
      let serverClaimedCredit = false;
      if (userId) {
        const decision = await enforceBaselineCredit(userId);
        if (!decision.allow) {
          return jsonResponse({ error: decision.error }, decision.status);
        }
        serverClaimedCredit = decision.serverClaimed;
      }

      try {
        const z = body.input;

        // Build initial baseline (fallback). If OpenAI is available, refine.
        let partial: Partial<ZeroResult> = buildFallback(z);

        if (OPENAI_API_KEY) {
          try {
            const ai = await callOpenAI(z);
            // merge AI fields over baseline
            partial = {
              ...partial,
              ...ai,
              fork: { ...partial.fork, ...ai?.fork } as ZeroResult["fork"],
              shock: { ...partial.shock, ...ai?.shock } as ZeroResult["shock"],
              detected: { ...partial.detected, ...ai?.detected },
              notes: ai?.notes ?? partial.notes,
            };
          } catch (e) {
            // keep baseline but include note
            const msg = (e as Error).message ?? String(e);
            partial.notes = [
              ...(partial.notes ?? []),
              `AI fallback used: ${msg.slice(0, 160)}`,
            ];
          }
        } else {
          partial.notes = [
            ...(partial.notes ?? []),
            "OPENAI_API_KEY not set — using safe baseline.",
          ];
        }

        // Enforce guardrails & shape
        const result = safeShape(partial, z.guardrails);

        if (callId !== null) await deps.recordOutput?.(callId, result);
        return jsonResponse(result, 200);
      } catch (genErr) {
        // The server claimed the credit before generation — generation
        // failed, so the server gives it back (H2: claim/refund pairing is
        // server-owned now). Old-client pass-through requests refund
        // themselves via refund_free_tune.
        if (serverClaimedCredit && userId) {
          await refundServerClaim(userId);
        }
        throw genErr;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: msg }, 400);
    }
  };
}

export const handler = makeHandler();

// Guarded so `deno test` can import this module without starting a server.
// The edge runtime never sets AI_TUNE_TEST, so production always serves.
if (Deno.env.get("AI_TUNE_TEST") !== "1") {
  Deno.serve(handler);
}
