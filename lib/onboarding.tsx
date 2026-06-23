// lib/onboarding.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "./supabase";

export const ONBOARDING_STORAGE_KEY = "dialed_onboarding_v1";
export const PENDING_TUNE_STORAGE_KEY = "dialed_pending_tune_v1";
export const GUEST_BIKES_STORAGE_KEY = "dialed_onboarding_guest_bikes_v1";
export const GUEST_DEFAULT_BIKE_STORAGE_KEY =
  "dialed_onboarding_guest_default_bike_v1";
// Compatibility-only marker for older onboarding checks. `dialed_onboarding_v1`
// remains the canonical onboarding source of truth going forward.
export const INTRO_SEEN_STORAGE_KEY = "dialed_onboarding_has_seen_intro_v1";
/** Guest bike that failed to migrate at signup; retried on next cold start. */
export const PENDING_GUEST_BIKE_SYNC_KEY = "dialed_pending_guest_bike_sync_v1";
const PENDING_TUNE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Onboarding state machine — linear, forward-only transitions:
 *
 *   intro → garage_locked → tune → results_locked → signup → trial → complete
 *
 * "intro"          First cold start, before the user taps "Get Started".
 * "garage_locked"  User saw intro; Add Bike sheet is open (guest flow).
 * "tune"           Bike added; Tune tab is unlocked for one AI tune.
 * "results_locked" Tune generated; results shown but gated behind auth wall.
 * "signup"         User is on the Create Account screen.
 * "trial"          Account created; Paywall / trial offer shown.
 * "complete"       Onboarding finished (trial started or Pro purchased).
 *
 * Source of truth priority: Supabase `profiles.onboarding_step` (signed-in)
 * wins over `LocalOnboardingState` (AsyncStorage). IndexGate reconciles both
 * on every cold start.
 */
export type OnboardingStep =
  | "intro"
  | "garage_locked"
  | "tune"
  | "results_locked"
  | "signup"
  | "trial"
  | "complete";

export type LocalOnboardingState = {
  version: 1;
  hasSeenIntro: boolean;
  onboardingStep: OnboardingStep;
  guestBikeId: string | null;
  accountCreated: boolean;
  trialStarted: boolean;
  onboardingComplete: boolean;
  lastUpdatedAt: string;
};

export type PendingTunePayload = {
  r: string;
  meta: string;
  bikeId: string | null;
  savedAt: number;
};

type OnboardingContextValue = {
  onboardingActive: boolean;
  setOnboardingActive: (v: boolean) => void;
  completeOnboarding: () => Promise<LocalOnboardingState>;
  hydrated: boolean;
  state: LocalOnboardingState;
  refreshFromStorage: () => Promise<LocalOnboardingState>;
  replaceState: (
    next:
      | LocalOnboardingState
      | ((current: LocalOnboardingState) => LocalOnboardingState)
  ) => Promise<LocalOnboardingState>;
  setStep: (step: OnboardingStep) => Promise<LocalOnboardingState>;
  markIntroSeen: () => Promise<LocalOnboardingState>;
  setGuestBikeId: (bikeId: string | null) => Promise<LocalOnboardingState>;
  markAccountCreated: () => Promise<LocalOnboardingState>;
  markTrialStarted: () => Promise<LocalOnboardingState>;
  markOnboardingComplete: () => Promise<LocalOnboardingState>;
  resetState: () => Promise<LocalOnboardingState>;
};

const EMPTY_STATE: LocalOnboardingState = {
  version: 1,
  hasSeenIntro: false,
  onboardingStep: "intro",
  guestBikeId: null,
  accountCreated: false,
  trialStarted: false,
  onboardingComplete: false,
  lastUpdatedAt: new Date(0).toISOString(),
};

function nowIso() {
  return new Date().toISOString();
}

function buildState(
  patch: Partial<LocalOnboardingState> = {}
): LocalOnboardingState {
  return {
    ...EMPTY_STATE,
    ...patch,
    version: 1,
    lastUpdatedAt: patch.lastUpdatedAt ?? nowIso(),
  };
}

function isOnboardingStep(value: unknown): value is OnboardingStep {
  return (
    value === "intro" ||
    value === "garage_locked" ||
    value === "tune" ||
    value === "results_locked" ||
    value === "signup" ||
    value === "trial" ||
    value === "complete"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOnboardingState(raw: string | null): LocalOnboardingState {
  if (!raw) return buildState();

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return buildState();
    if (!isOnboardingStep(parsed.onboardingStep)) return buildState();

    return buildState({
      hasSeenIntro: parsed.hasSeenIntro === true,
      onboardingStep: parsed.onboardingStep,
      guestBikeId:
        typeof parsed.guestBikeId === "string" ? parsed.guestBikeId : null,
      accountCreated: parsed.accountCreated === true,
      trialStarted: parsed.trialStarted === true,
      onboardingComplete: parsed.onboardingComplete === true,
      lastUpdatedAt:
        typeof parsed.lastUpdatedAt === "string" && parsed.lastUpdatedAt.length > 0
          ? parsed.lastUpdatedAt
          : nowIso(),
    });
  } catch {
    return buildState();
  }
}

function canParseEncodedJson(value: string): boolean {
  try {
    JSON.parse(decodeURIComponent(value));
    return true;
  } catch {
    return false;
  }
}

export function isValidPendingTunePayload(
  value: unknown
): value is PendingTunePayload {
  if (!isRecord(value)) return false;
  if (typeof value.r !== "string" || value.r.length === 0) return false;
  if (typeof value.meta !== "string" || value.meta.length === 0) return false;
  if (value.bikeId !== null && typeof value.bikeId !== "string") return false;
  if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)) {
    return false;
  }

  return canParseEncodedJson(value.r) && canParseEncodedJson(value.meta);
}

export async function readLocalOnboardingState(): Promise<LocalOnboardingState> {
  const raw = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
  return parseOnboardingState(raw);
}

export async function writeLocalOnboardingState(
  state: LocalOnboardingState
): Promise<void> {
  await AsyncStorage.setItem(
    ONBOARDING_STORAGE_KEY,
    JSON.stringify(buildState(state))
  );
}

export async function clearLocalOnboardingState(): Promise<void> {
  await AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY);
}

export async function readPendingTune(): Promise<{
  tune: PendingTunePayload | null;
  isExpired: boolean;
}> {
  const raw = await AsyncStorage.getItem(PENDING_TUNE_STORAGE_KEY);
  if (!raw) return { tune: null, isExpired: false };

  try {
    const parsed = JSON.parse(raw);
    if (!isValidPendingTunePayload(parsed)) return { tune: null, isExpired: false };
    if (Date.now() - parsed.savedAt > PENDING_TUNE_TTL_MS) {
      return { tune: null, isExpired: true };
    }
    return { tune: parsed, isExpired: false };
  } catch {
    return { tune: null, isExpired: false };
  }
}

export async function writePendingTune(
  payload: PendingTunePayload
): Promise<void> {
  if (!isValidPendingTunePayload(payload)) {
    throw new Error("Invalid pending tune payload.");
  }

  await AsyncStorage.setItem(PENDING_TUNE_STORAGE_KEY, JSON.stringify(payload));
}

export async function clearPendingTune(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_TUNE_STORAGE_KEY);
}

const Ctx = createContext<OnboardingContextValue>({
  onboardingActive: false,
  setOnboardingActive: () => {},
  completeOnboarding: async () => buildState({ onboardingStep: "complete" }),
  hydrated: false,
  state: buildState(),
  refreshFromStorage: async () => buildState(),
  replaceState: async () => buildState(),
  setStep: async () => buildState(),
  markIntroSeen: async () => buildState({ hasSeenIntro: true }),
  setGuestBikeId: async () => buildState(),
  markAccountCreated: async () => buildState({ accountCreated: true }),
  markTrialStarted: async () => buildState({ trialStarted: true }),
  markOnboardingComplete: async () =>
    buildState({ onboardingStep: "complete", onboardingComplete: true }),
  resetState: async () => buildState(),
});

export function OnboardingProvider({
  children,
  initialActive = false,
}: {
  children: React.ReactNode;
  initialActive?: boolean;
}) {
  const [onboardingActive, setOnboardingActiveState] = useState(initialActive);
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<LocalOnboardingState>(() => buildState());
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const persistState = useCallback(async (next: LocalOnboardingState) => {
    const normalized = buildState(next);
    await AsyncStorage.multiSet([
      [ONBOARDING_STORAGE_KEY, JSON.stringify(buildState(normalized))],
      [INTRO_SEEN_STORAGE_KEY, normalized.hasSeenIntro ? "1" : "0"],
    ]);
    return normalized;
  }, []);

  const replaceState = useCallback(
    async (
      next:
        | LocalOnboardingState
        | ((current: LocalOnboardingState) => LocalOnboardingState)
    ) => {
      const current = stateRef.current;
      const resolved = typeof next === "function" ? next(current) : next;
      const persisted = await persistState(resolved);
      setState(() => {
        stateRef.current = persisted;
        return persisted;
      });
      return persisted;
    },
    [persistState]
  );

  const refreshFromStorage = useCallback(async () => {
    const next = await readLocalOnboardingState();
    setState(next);
    setHydrated(true);
    return next;
  }, []);

  useEffect(() => {
    refreshFromStorage().catch(() => {
      setState(buildState());
      setHydrated(true);
    });
  }, [refreshFromStorage]);

  // Restore onboardingActive when the app resumes mid-onboarding.
  // Without this, onboardingActive stays false after a cold start and all
  // tab-locking / onboarding-mode UI silently breaks for resuming users.
  useEffect(() => {
    if (!hydrated) return;
    if (
      !state.onboardingComplete &&
      state.onboardingStep !== "intro" &&
      state.onboardingStep !== "complete"
    ) {
      setOnboardingActiveState(true);
    }
  }, [hydrated, state.onboardingComplete, state.onboardingStep]);

  const setOnboardingActive = useCallback((value: boolean) => {
    setOnboardingActiveState(value);
  }, []);

  const setStep = useCallback(
    async (step: OnboardingStep) =>
      replaceState((current) =>
        buildState({
          ...current,
          onboardingStep: step,
          onboardingComplete: step === "complete",
        })
      ),
    [replaceState]
  );

  const markIntroSeen = useCallback(
    async () =>
      replaceState((current) =>
        buildState({
          ...current,
          hasSeenIntro: true,
        })
      ),
    [replaceState]
  );

  const setGuestBikeId = useCallback(
    async (bikeId: string | null) =>
      replaceState((current) =>
        buildState({
          ...current,
          guestBikeId: bikeId,
        })
      ),
    [replaceState]
  );

  const markAccountCreated = useCallback(
    async () =>
      replaceState((current) =>
        buildState({
          ...current,
          accountCreated: true,
        })
      ),
    [replaceState]
  );

  const markTrialStarted = useCallback(
    async () =>
      replaceState((current) =>
        buildState({
          ...current,
          trialStarted: true,
        })
      ),
    [replaceState]
  );

  const markOnboardingComplete = useCallback(
    async () =>
      replaceState((current) =>
        buildState({
          ...current,
          hasSeenIntro: true,
          onboardingStep: "complete",
          onboardingComplete: true,
          accountCreated: true,
          trialStarted: true,
        })
      ),
    [replaceState]
  );

  const resetState = useCallback(async () => {
    const next = buildState();
    await clearLocalOnboardingState();
    await AsyncStorage.removeItem(INTRO_SEEN_STORAGE_KEY);
    setState(next);
    setOnboardingActiveState(false);
    return next;
  }, []);

  const completeOnboarding = useCallback(async () => {
    setOnboardingActiveState(false);
    // Dual-write: also persist to Supabase for signed-in users so both
    // stores agree (survives reinstall / second device).
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user?.id) {
        void supabase.from("profiles").upsert(
          {
            user_id: auth.user.id,
            onboarding_complete: true,
            onboarding_step: "complete",
          },
          { onConflict: "user_id" }
        );
      }
    } catch {
      // Non-critical — AsyncStorage write below is the primary
    }
    // Clear stale guest/onboarding flags from any pending tune so restored
    // tunes reflect current state (user is now signed in + onboarded).
    try {
      const { tune } = await readPendingTune();
      if (tune?.meta) {
        const parsed = JSON.parse(decodeURIComponent(tune.meta));
        if (parsed?.guest || parsed?.onboarding) {
          parsed.guest = false;
          parsed.onboarding = false;
          tune.meta = encodeURIComponent(JSON.stringify(parsed));
          await writePendingTune(tune);
        }
      }
    } catch {
      // Non-critical — live derivation in tune-results.tsx is the primary guard
    }
    return markOnboardingComplete();
  }, [markOnboardingComplete]);

  const value = useMemo(
    () => ({
      onboardingActive,
      setOnboardingActive,
      completeOnboarding,
      hydrated,
      state,
      refreshFromStorage,
      replaceState,
      setStep,
      markIntroSeen,
      setGuestBikeId,
      markAccountCreated,
      markTrialStarted,
      markOnboardingComplete,
      resetState,
    }),
    [
      onboardingActive,
      setOnboardingActive,
      completeOnboarding,
      hydrated,
      state,
      refreshFromStorage,
      replaceState,
      setStep,
      markIntroSeen,
      setGuestBikeId,
      markAccountCreated,
      markTrialStarted,
      markOnboardingComplete,
      resetState,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOnboarding() {
  return useContext(Ctx);
}
