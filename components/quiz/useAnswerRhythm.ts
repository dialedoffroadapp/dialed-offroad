// components/quiz/useAnswerRhythm.ts
// The one tap → commit → hold → advance rhythm every question screen shares
// (spec: light haptic on tap, siblings dim, footer echo, hold ~250 ms, next
// screen slides in). Re-entrancy guarded; the hold never advances before the
// commit (persist + event) has settled, so a slow signed-in bike insert simply
// extends the hold. Returning to the screen resets it so answers can change.
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { RHYTHM } from "./quizTheme";

type Options<T extends string> = {
  /** Persisted answer to show as selected when the screen (re)mounts. */
  initial?: T | null;
  holdMs?: number;
  onCommit: (id: T) => void | Promise<void>;
  onAdvance: (id: T) => void;
};

export function useAnswerRhythm<T extends string>({
  initial,
  holdMs = RHYTHM.hold,
  onCommit,
  onAdvance,
}: Options<T>) {
  const [selected, setSelected] = useState<T | null>(initial ?? null);
  /** True from the tap until the screen loses focus: drives sibling dimming. */
  const [answering, setAnswering] = useState(false);
  const advancingRef = useRef(false);
  const mountedRef = useRef(true);
  const commitRef = useRef(onCommit);
  const advanceRef = useRef(onAdvance);
  commitRef.current = onCommit;
  advanceRef.current = onAdvance;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A persisted answer arriving after hydration (or changed elsewhere) shows
  // as selected — but never mid-rhythm.
  useEffect(() => {
    if (!advancingRef.current && initial !== undefined) setSelected(initial ?? null);
  }, [initial]);

  useFocusEffect(
    useCallback(() => {
      advancingRef.current = false;
      setAnswering(false);
      return undefined;
    }, [])
  );

  const choose = useCallback(
    (id: T) => {
      if (advancingRef.current) return;
      advancingRef.current = true;
      setSelected(id);
      setAnswering(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      const commit = Promise.resolve()
        .then(() => commitRef.current(id))
        .catch((e) => console.warn("[quiz] commit failed", e));
      const hold = new Promise<void>((r) => setTimeout(r, holdMs));
      void Promise.all([commit, hold]).then(() => {
        if (!mountedRef.current) return;
        advanceRef.current(id);
      });
    },
    [holdMs]
  );

  /** Re-arm within the same screen (Q2 switches sub-steps without a route
   *  change, so the focus reset never fires). */
  const reset = useCallback(() => {
    advancingRef.current = false;
    setAnswering(false);
  }, []);

  const isDimmed = useCallback(
    (id: T) => answering && selected !== id,
    [answering, selected]
  );

  return { selected, answering, choose, isDimmed, reset };
}
