"use client";

import { useCallback, useRef, useState } from "react";
import type { Faction, Transcript, Turn } from "@/lib/types";

export type Phase = "idle" | "debate" | "ready" | "verdict";

/** Optional gate awaited between turns — used to advance in sync with audio. */
export type Gate = (turn: Turn) => Promise<void>;

export interface Playback {
  phase: Phase;
  index: number;
  activeId: string | null;
  activeAgent: Faction | null;
  /** The agent preparing to speak (shows a "researching…" loader before its turn). */
  thinkingAgent: Faction | null;
  progress: number;
  playing: boolean;
  start: () => void;
  pause: () => void;
  restart: () => void;
  deliverVerdict: () => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// How long an agent "researches" before its line lands. Long enough to read as
// real work, short enough to keep the hearing moving.
const THINK_MS = 1150;

export function usePlayback(tx: Transcript, gate?: Gate): Playback {
  const turns = tx.turns;
  const [phase, setPhase] = useState<Phase>("idle");
  const [index, setIndex] = useState(-1);
  const [thinkingAgent, setThinkingAgent] = useState<Faction | null>(null);
  const [playing, setPlaying] = useState(false);
  const runId = useRef(0);

  const run = useCallback(
    async (from: number) => {
      const my = ++runId.current;
      setPhase("debate");
      setPlaying(true);
      for (let i = from; i < turns.length; i++) {
        if (runId.current !== my) return;
        // research beat: the upcoming agent works the file before it speaks
        setThinkingAgent(turns[i].agent);
        await sleep(THINK_MS);
        if (runId.current !== my) return;
        setThinkingAgent(null);
        setIndex(i);
        try {
          if (gate) await gate(turns[i]);
          else await sleep(turns[i].durationMs);
        } catch {
          await sleep(turns[i].durationMs);
        }
        if (runId.current !== my) return;
      }
      setPlaying(false);
      setPhase("ready");
    },
    [turns, gate],
  );

  const start = useCallback(() => {
    const from = phase === "debate" && index >= 0 ? index + 1 : 0;
    if (phase !== "debate") setIndex(-1);
    run(from);
  }, [run, phase, index]);

  const pause = useCallback(() => {
    runId.current++;
    setThinkingAgent(null);
    setPlaying(false);
  }, []);

  const restart = useCallback(() => {
    runId.current++;
    setIndex(-1);
    setThinkingAgent(null);
    setPhase("idle");
    setPlaying(false);
  }, []);

  const deliverVerdict = useCallback(() => {
    runId.current++;
    setThinkingAgent(null);
    setPlaying(false);
    setPhase("verdict");
  }, []);

  const activeId = index >= 0 && index < turns.length ? turns[index].id : null;
  const activeAgent =
    phase === "verdict"
      ? "human"
      : thinkingAgent
        ? thinkingAgent
        : index >= 0 && phase === "debate"
          ? turns[index].agent
          : null;
  const progress = phase === "idle" ? 0 : phase === "debate" ? (index + 1) / turns.length : 1;

  return {
    phase,
    index,
    activeId,
    activeAgent,
    thinkingAgent,
    progress,
    playing,
    start,
    pause,
    restart,
    deliverVerdict,
  };
}
