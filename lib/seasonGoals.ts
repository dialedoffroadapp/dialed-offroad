// lib/seasonGoals.ts
// Rider-set season goal (Home). Local-first (AsyncStorage) with a best-effort
// mirror to `season_goals` (migration 20260904100000, STAGED): every server
// call is wrapped so the card works before the migration lands and offline.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SeasonGoalType } from "./homeCopy";
import { supabase } from "./supabase";

export type SeasonGoal = {
  type: SeasonGoalType;
  target: number;
  raceName?: string | null;
  /** ISO date (YYYY-MM-DD). */
  raceDate?: string | null;
  seasonYear: number;
  updatedAt: string;
};

const key = (userId: string, year: number) => `season_goal_v1:${userId}:${year}`;

function parse(raw: string | null): SeasonGoal | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || (p.type !== "ride_days" && p.type !== "engine_hours" && p.type !== "race")) return null;
    return {
      type: p.type,
      target: typeof p.target === "number" ? p.target : 0,
      raceName: typeof p.raceName === "string" ? p.raceName : null,
      raceDate: typeof p.raceDate === "string" ? p.raceDate : null,
      seasonYear: typeof p.seasonYear === "number" ? p.seasonYear : new Date().getFullYear(),
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function readSeasonGoal(userId: string, year: number): Promise<SeasonGoal | null> {
  let local: SeasonGoal | null = null;
  try {
    local = parse(await AsyncStorage.getItem(key(userId, year)));
  } catch {
    local = null;
  }
  try {
    const { data } = await supabase
      .from("season_goals")
      .select("goal_type, target, race_name, race_date, season_year, updated_at")
      .eq("user_id", userId)
      .eq("season_year", year)
      .maybeSingle();
    const row = data as any;
    if (row?.goal_type) {
      const remote: SeasonGoal = {
        type: row.goal_type,
        target: Number(row.target ?? 0),
        raceName: row.race_name ?? null,
        raceDate: row.race_date ?? null,
        seasonYear: row.season_year,
        updatedAt: row.updated_at ?? new Date(0).toISOString(),
      };
      if (!local || Date.parse(remote.updatedAt) >= Date.parse(local.updatedAt)) {
        void AsyncStorage.setItem(key(userId, year), JSON.stringify(remote)).catch(() => {});
        return remote;
      }
    }
  } catch {
    // table not migrated yet / offline: local stands
  }
  return local;
}

export async function saveSeasonGoal(userId: string, goal: Omit<SeasonGoal, "updatedAt">): Promise<SeasonGoal> {
  const full: SeasonGoal = { ...goal, updatedAt: new Date().toISOString() };
  try {
    await AsyncStorage.setItem(key(userId, goal.seasonYear), JSON.stringify(full));
  } catch {
    // keep going — the server mirror may still land
  }
  try {
    await supabase.from("season_goals").upsert(
      {
        user_id: userId,
        season_year: goal.seasonYear,
        goal_type: goal.type,
        target: goal.target,
        race_name: goal.raceName ?? null,
        race_date: goal.raceDate ?? null,
        updated_at: full.updatedAt,
      },
      { onConflict: "user_id,season_year" }
    );
  } catch {
    // best-effort
  }
  return full;
}

export async function clearSeasonGoal(userId: string, year: number): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(userId, year));
  } catch {
    // ignore
  }
  try {
    await supabase.from("season_goals").delete().eq("user_id", userId).eq("season_year", year);
  } catch {
    // ignore
  }
}
