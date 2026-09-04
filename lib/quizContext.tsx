// lib/quizContext.tsx
// Answers provider for the quiz route group (app/quiz/_layout.tsx). Answers
// persist to AsyncStorage on every change so back-navigation and cold-start
// resumes keep them; the provider also owns the quiz_abandoned signal.
import { useFocusEffect } from "expo-router";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import {
  clearQuizAnswers,
  emptyQuizAnswers,
  logQuizEvent,
  readQuizAnswers,
  writeQuizAnswers,
  type QuizAnswers,
  type QuizStepId,
} from "./quizOnboarding";

type QuizContextValue = {
  answers: QuizAnswers;
  hydrated: boolean;
  setAnswers: (patch: Partial<QuizAnswers>) => Promise<QuizAnswers>;
  reset: () => Promise<void>;
};

const Ctx = createContext<QuizContextValue>({
  answers: emptyQuizAnswers(),
  hydrated: false,
  setAnswers: async () => emptyQuizAnswers(),
  reset: async () => {},
});

export function QuizProvider({ children }: { children: React.ReactNode }) {
  const [answers, setAnswersState] = useState<QuizAnswers>(() => emptyQuizAnswers());
  const [hydrated, setHydrated] = useState(false);
  const ref = useRef(answers);

  useEffect(() => {
    let mounted = true;
    readQuizAnswers()
      .then((a) => {
        if (!mounted) return;
        ref.current = a;
        setAnswersState(a);
        setHydrated(true);
      })
      .catch(() => mounted && setHydrated(true));
    return () => {
      mounted = false;
    };
  }, []);

  const setAnswers = useCallback(async (patch: Partial<QuizAnswers>) => {
    const next: QuizAnswers = {
      ...ref.current,
      ...patch,
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    ref.current = next;
    setAnswersState(next);
    try {
      await writeQuizAnswers(next);
    } catch (e) {
      console.warn("[quiz] answers persist failed", e);
    }
    return next;
  }, []);

  const reset = useCallback(async () => {
    const next = emptyQuizAnswers();
    ref.current = next;
    setAnswersState(next);
    await clearQuizAnswers();
  }, []);

  // quiz_abandoned: the only client-side abandonment signal available is the
  // app going to the background while a question is on screen. Latched once
  // per background episode so a rider flipping apps doesn't spam the 25-slot
  // pre-auth queue. last_step = the question most recently VIEWED.
  useEffect(() => {
    let latched = false;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") {
        if (latched) return;
        latched = true;
        const last = ref.current.lastStep;
        if (last) void logQuizEvent("quiz_abandoned", { last_step: last });
      } else if (s === "active") {
        latched = false;
      }
    });
    return () => sub.remove();
  }, []);

  const value = useMemo(
    () => ({ answers, hydrated, setAnswers, reset }),
    [answers, hydrated, setAnswers, reset]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useQuiz() {
  return useContext(Ctx);
}

/**
 * Log quiz_step_viewed on every focus of a question (and again when `key`
 * changes while focused — Q2's brand → model sub-step) and record it as the
 * last viewed step for quiz_abandoned.
 */
export function useQuizStepView(
  step: QuizStepId,
  meta: Record<string, unknown> = {},
  key: string = ""
) {
  const { setAnswers } = useQuiz();
  const metaRef = useRef(meta);
  metaRef.current = meta;
  useFocusEffect(
    useCallback(() => {
      void setAnswers({ lastStep: step });
      void logQuizEvent("quiz_step_viewed", { step, ...metaRef.current });
      return undefined;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, key])
  );
}
