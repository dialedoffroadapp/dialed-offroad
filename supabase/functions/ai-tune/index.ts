// supabase/functions/ai-tune/index.ts
// Zero-based MX/Enduro tuning Edge Function
// - Mode "zero_baseline_v1": build initial tune (baseline + optional AI refinement)
// - Mode "tune2_v1": refine an existing tune based on rider feedback
// - Enforces guardrails and returns deterministic JSON for the app UI

// deno-lint-ignore-file no-explicit-any
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

/* ----------------------------- Shared types ----------------------------- */

type ZeroInput = {
  mode?: "zero_baseline_v1" | "tune2_v1";
  input: {
    // baseline context
    make?: string;
    model?: string;
    year?: number;
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
      aer_pressure_bar_default?: number;
      aer_pressure_bar_per_10lb?: number;
    };

    // ----------------- Tune Two specific fields (optional) -----------------
    // When mode === "tune2_v1", the client should also send:
    previous?: ZeroResult; // previous full tune result
    feedback?: Tune2Feedback;
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

type Tune2Symptom = {
  id: SymptomId;
  severity: number; // 1–10
};

type Tune2Feedback = {
  overall_rating?: number; // 1–10
  ride_duration_min?: number;
  terrain_tags?: string[];
  symptoms: Tune2Symptom[];
};

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

function safeShape(
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
    Math.round(Number(partial.shock?.sag_mm ?? 105)),
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
    "",
    "Bike & fork rules:",
    "- If the bike is likely to have WP AER/XACT air forks OR the user indicates they have an air fork, you may include fork.air_pressure_bar.",
    "- If you are not confident it's an air fork and the user did not say it is, omit air_pressure_bar.",
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

  // Respect both the heuristic AND the user toggle
  const heuristicAER = isAERFork(z.make, z.model);
  const hasAER = z.wants_air_fork === true || heuristicAER;

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

/* --------------------------- Tune Two engine (mode: tune2_v1) --------------------------- */

function buildTuneTwo(input: Tune2Input): Partial<ZeroResult> {
  const prev = input.previous;

  // Start from previous tune
  let forkComp = prev.fork.comp_clicks;
  let forkReb = prev.fork.reb_clicks;
  let air = prev.fork.air_pressure_bar;
  let shockLSC = prev.shock.lsc_clicks;
  let shockReb = prev.shock.reb_clicks;
  let shockHSC = prev.shock.hsc_turns;
  const sag = prev.shock.sag_mm; // keep sag constant in Tune Two (for now)

  const notes: string[] = [];
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

  // Accumulate deltas per circuit
  let dForkComp = 0;
  let dForkReb = 0;
  let dShockLSC = 0;
  let dShockReb = 0;
  let dShockHSC = 0;
  let dAir = 0;

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

  for (const s of symptoms) {
    const scale = clickDeltaForSeverity(s.severity);
    const airScale = airDeltaForSeverity(s.severity);

    switch (s.id) {
      case "harsh_braking_bumps": {
        // Front is too stiff / spiky on small chop → soften comp, tiny air tweak
        dForkComp += scale; // more clicks out = softer
        if (air !== undefined) dAir -= airScale * 0.5;
        notes.push(
          `Harsh on braking bumps → +${scale} fork compression clicks (softer).${
            air !== undefined
              ? ` Optionally -${airScale.toFixed(2)} bar AER.`
              : ""
          }`
        );
        break;
      }
      case "deflects_in_chop": {
        // Front hunts side to side → rebound too fast → slower rebound
        dForkReb -= scale; // fewer clicks = slower
        notes.push(
          `Front deflects in chop → -${scale} fork rebound clicks (slower to keep the tire planted).`
        );
        break;
      }
      case "rear_kicks_accel": {
        // Rear kicking on throttle → rebound too fast
        dShockReb -= scale;
        notes.push(
          `Rear kicks on acceleration chop → -${scale} shock rebound clicks (slower to stop kicking).`
        );
        break;
      }
      case "bottoms_landings": {
        // Big hits / landings → need more bottoming resistance
        const dLSC = Math.max(1, scale - 1);
        const dHSC = 0.15 * (scale >= 3 ? 2 : 1);
        dShockLSC -= dLSC;
        dShockHSC -= dHSC;
        if (air !== undefined) dAir += airScale * 0.7;
        notes.push(
          `Bottoming on landings / G-outs → -${dLSC} shock LSC clicks (firmer) and -${dHSC.toFixed(
            2
          )} HSC turns.`
        );
        if (air !== undefined) {
          notes.push(
            `Also +${(airScale * 0.7).toFixed(
              2
            )} bar fork AER for more mid-stroke support.`
          );
        }
        break;
      }
      case "front_knifes": {
        // Front diving / knifing mid-corner → more support + slightly faster rebound
        const dComp = Math.max(1, scale - 1);
        dForkComp -= dComp; // firmer
        dForkReb += 1; // tiny bit more pop
        notes.push(
          `Front knifing in corners → -${dComp} fork compression clicks (firmer) and +1 fork rebound click for a touch more pop.`
        );
        break;
      }
      case "dead_feel": {
        // Bike feels glued / no pop → more rebound speed, a bit more support
        dForkReb += scale;
        dShockReb += Math.max(1, scale - 1);
        dForkComp -= 1;
        notes.push(
          `Bike feels dead / no pop → +${scale} fork rebound clicks and +${Math.max(
            1,
            scale - 1
          )} shock rebound clicks (faster), with -1 fork comp click for a bit more support.`
        );
        break;
      }
      case "unstable_whoops": {
        // Unstable in whoops → more control (slower rebound)
        dForkReb -= scale;
        dShockReb -= scale;
        if (air !== undefined) dAir += airScale * 0.4;
        notes.push(
          `Unstable in whoops → -${scale} fork rebound clicks and -${scale} shock rebound clicks (slower for stability).`
        );
        if (air !== undefined) {
          notes.push(
            `Slight +${(airScale * 0.4).toFixed(
              2
            )} bar AER to hold up in whoops.`
          );
        }
        break;
      }
      case "packs_whoops": {
        // Packing in whoops → rebound too slow → speed it up
        dForkReb += scale;
        dShockReb += scale;
        notes.push(
          `Packing in whoops → +${scale} fork rebound clicks and +${scale} shock rebound clicks (faster to avoid packing).`
        );
        break;
      }
      case "harsh_square_edge": {
        // Sharp square-edge → comp too stiff
        const dLSC = Math.max(1, scale - 1);
        dForkComp += scale;
        dShockLSC += dLSC;
        notes.push(
          `Harsh on square-edge → +${scale} fork compression clicks (softer) and +${dLSC} shock LSC clicks for traction.`
        );
        break;
      }
      case "headshake": {
        // High-speed headshake → calm chassis (small clicks only)
        dShockReb -= 1;
        dForkReb -= 1;
        notes.push(
          "High-speed headshake → -1 fork rebound click and -1 shock rebound click (slightly slower) for stability."
        );
        break;
      }
      case "general_harsh": {
        // General harshness → small global softening
        const dComp = Math.max(1, scale - 1);
        dForkComp += dComp;
        dShockLSC += 1;
        if (air !== undefined) dAir -= airScale * 0.5;
        notes.push(
          `General harshness → +${dComp} fork compression clicks (softer) and +1 shock LSC click.`
        );
        if (air !== undefined) {
          notes.push(
            `Also -${(airScale * 0.5).toFixed(
              2
            )} bar AER for a touch more comfort.`
          );
        }
        break;
      }
    }
  }

  // Clamp total deltas so we never go wild in one step
  dForkComp = clampInt(dForkComp, -4, 4);
  dForkReb = clampInt(dForkReb, -4, 4);
  dShockLSC = clampInt(dShockLSC, -4, 4);
  dShockReb = clampInt(dShockReb, -4, 4);
  dShockHSC = clampFloat(dShockHSC, -0.5, 0.5);
  dAir = clampFloat(dAir, -0.3, 0.3);

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
    notes: [...summary, ...notes],
  };

  return out;
}

/* ------------------------------ Handler ------------------------------ */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const body = (await req.json().catch(() => null)) as ZeroInput | null;
    if (!body || !body.input) {
      return new Response(JSON.stringify({ error: "Bad request" }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const mode = body.mode ?? "zero_baseline_v1";

    // ------------------------ MODE: Tune Two (feedback refinement) ------------------------
    if (mode === "tune2_v1") {
      const raw = body.input as any;

      if (!raw.previous || !raw.feedback) {
        return new Response(
          JSON.stringify({
            error: "Tune Two requires 'previous' tune and 'feedback'.",
          }),
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const tune2Input: Tune2Input = {
        make: raw.make,
        model: raw.model,
        year: raw.year,
        terrain: raw.terrain,
        track: raw.track,
        rider: raw.rider,
        previous: raw.previous as ZeroResult,
        feedback: raw.feedback as Tune2Feedback,
        guardrails: raw.guardrails,
      };

      const partial = buildTuneTwo(tune2Input);
      const result = safeShape(partial, tune2Input.guardrails);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    // ------------------------ MODE: Baseline (zero_baseline_v1) ------------------------
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
          fork: { ...partial.fork, ...ai?.fork },
          shock: { ...partial.shock, ...ai?.shock },
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

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }
});
