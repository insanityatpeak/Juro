"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HearingStatus, StoredTurn } from "./hearings/types";
import type { CaseEntry, Faction, Verdict } from "./types";
import type { HearingPhase, HearingState } from "./useBackgroundHearing";

// How long the next speaker "researches" before its line lands, then how long the line holds.
const THINK_MS = 1150;

/**
 * Browser-only sample hearing: replays the bundled, pre-written record with timers.
 * No network, no hearing creation, no database. Leaving the page ends it. The ruling stays
 * in this browser and is not recorded anywhere. Returns the same shape as useBackgroundHearing
 * so the hearing room renders either one.
 */
export function useSampleHearing(entry: CaseEntry): HearingState {
  const all = entry.transcript.turns;
  const [started, setStarted] = useState(false);
  const [shown, setShown] = useState(0);
  const [paused, setPaused] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [decision, setDecision] = useState<Verdict["decision"] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const done = started && shown >= all.length;

  // Advance one turn at a time while playing. Each step: think, then reveal, then hold the line.
  useEffect(() => {
    if (!started || paused || shown >= all.length) return;
    const hold = shown === 0 ? 0 : all[shown - 1].durationMs;
    timer.current = setTimeout(() => {
      setThinking(true);
      timer.current = setTimeout(() => {
        setThinking(false);
        setShown((n) => n + 1);
      }, THINK_MS);
    }, hold);
    return () => clearTimeout(timer.current);
  }, [started, paused, shown, all]);

  const start = useCallback(async () => {
    setStarted(true);
    setPaused(false);
    setShown(0);
    setDecision(null);
  }, []);

  const restart = useCallback(() => {
    clearTimeout(timer.current);
    setStarted(false);
    setPaused(false);
    setThinking(false);
    setShown(0);
    setDecision(null);
  }, []);

  const pause = useCallback(async () => {
    clearTimeout(timer.current);
    setThinking(false);
    setPaused(true);
  }, []);
  const resume = useCallback(async () => setPaused(false), []);

  const deliverVerdict = useCallback(async (d: Verdict["decision"]) => setDecision(d), []);

  const turns: StoredTurn[] = all.slice(0, shown).map((t, i) => ({ ...t, seq: i + 1, hash: "" })); // not hash-chained
  const status: HearingStatus | null = !started ? null : done ? "complete" : paused ? "paused" : "running";
  const phase: HearingPhase = !started ? "idle" : decision ? "verdict" : done ? "ready" : "debate";
  const thinkingAgent: Faction | null = thinking && !paused ? (all[shown]?.agent ?? null) : null;
  const noop = useCallback(async () => {}, []);

  return {
    phase,
    turns,
    thinkingAgent,
    verdict: entry.transcript.verdict, // the sample's AI recommendation; the reviewer's choice is humanDecision
    humanDecision: decision,
    live: false,
    engines: null,
    auditRoot: null, // a browser sample is not sealed
    activeId: turns.length ? turns[turns.length - 1].id : null,
    progress: !started ? 0 : done ? 1 : Math.min(shown / Math.max(all.length, 1), 0.96),
    start,
    restart,
    deliverVerdict,
    backend: "browser",
    hearingId: null,
    status,
    mode: started ? "sample" : null,
    pauseReason: paused ? "reviewer" : null,
    pauseRequested: false,
    attempt: 0,
    error: null,
    controllable: true,
    canControl: true,
    canRule: done && !decision,
    totalTurns: all.length,
    turnCount: shown,
    loading: false,
    notFound: false,
    offline: false,
    starting: false,
    startError: null,
    rulingError: null,
    busy: false,
    pause,
    resume,
    retry: noop,
    canRetry: false,
  };
}
