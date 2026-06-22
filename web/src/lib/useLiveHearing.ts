"use client";

import { useCallback, useRef, useState } from "react";
import type { CaseEntry, Faction, Turn, Verdict } from "@/lib/types";

export type HearingPhase = "idle" | "debate" | "ready" | "verdict";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const LOADER_MS = 2400; // minimum loader per step (also stretches to cover real generation)
const GAP_MS = 450; // breath between a turn finishing and the next loader
const READ_CAP = 6500; // when not listening, max time a turn stays before the next

type Ev =
  | { type: "thinking"; agent: Faction }
  | { type: "turn"; turn: Turn }
  | { type: "verdict"; verdict: Verdict };

/** Voice hooks the Chamber wires in, so reveal and speech stay in lockstep. */
export type HearingVoice = {
  speak?: (turn: Turn) => Promise<void>;
  isListening?: () => boolean;
  prefetch?: (turn: Turn) => void;
  ready?: (turn: Turn) => Promise<void>;
};

function nextTurnAfter(events: Ev[], from: number): Turn | null {
  for (let k = from; k < events.length; k++) if (events[k].type === "turn") return (events[k] as { turn: Turn }).turn;
  return null;
}

/**
 * Runs a hearing as a paced player on top of a streaming producer.
 *
 * The producer streams turns from /api/hearing (or falls back to the bundled
 * transcript) into an ordered event buffer. The player consumes that buffer one
 * step at a time: it shows a loader (which naturally stretches to cover real
 * generation), reveals the turn, and — when Listen is on — speaks it and waits
 * for the audio to finish before moving on. So replies never bullet ahead of the
 * voice; the line and the speech land together. Audio is prefetched the instant a
 * turn streams in, so by the time the loader clears, the voice is ready.
 */
export function useLiveHearing(entry: CaseEntry, voice: HearingVoice = {}) {
  const [phase, setPhase] = useState<HearingPhase>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [thinkingAgent, setThinkingAgent] = useState<Faction | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(entry.transcript.verdict);
  const [live, setLive] = useState(false);
  const runId = useRef(0);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const start = useCallback(async () => {
    const my = ++runId.current;
    setTurns([]);
    setThinkingAgent(null);
    setVerdict(entry.transcript.verdict);
    setLive(false);
    setPhase("debate");

    const events: Ev[] = [];
    const stream = { done: false };

    // ---- producer: stream live, or fall back to the bundled transcript ----
    const produce = async () => {
      let res: Response | null = null;
      try {
        res = await fetch("/api/hearing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId: entry.id }),
        });
      } catch {
        res = null;
      }
      if (runId.current !== my) return;

      let got = 0;
      if (res && res.ok && res.body) {
        setLive(true);
        try {
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (runId.current !== my) return;
            buf += dec.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line) continue;
              let msg: { type: string; agent?: Faction; turn?: Turn; verdict?: Verdict; message?: string };
              try {
                msg = JSON.parse(line);
              } catch {
                continue;
              }
              if (msg.type === "thinking" && msg.agent) {
                events.push({ type: "thinking", agent: msg.agent });
              } else if (msg.type === "turn" && msg.turn) {
                got++;
                events.push({ type: "turn", turn: msg.turn });
                // Warm only the FIRST turn here. Warming all of them at once hits
                // Deepgram with 9 concurrent requests and every clip comes back
                // slow; the player prefetches one turn ahead instead.
                if (got === 1) voiceRef.current.prefetch?.(msg.turn);
              } else if (msg.type === "verdict" && msg.verdict) {
                events.push({ type: "verdict", verdict: msg.verdict });
              } else if (msg.type === "error") {
                throw new Error(msg.message || "stream error");
              }
            }
          }
        } catch {
          // stream broke; keep whatever turns we already got
        }
      }

      if (got > 0) {
        stream.done = true;
        return;
      }

      // no live turns — replay the bundled transcript through the same player
      if (runId.current !== my) return;
      setLive(false);
      events.length = 0;
      entry.transcript.turns.forEach((t, idx) => {
        events.push({ type: "thinking", agent: t.agent });
        events.push({ type: "turn", turn: t });
        if (idx === 0) voiceRef.current.prefetch?.(t); // first only; player warms the rest one ahead
      });
      events.push({ type: "verdict", verdict: entry.transcript.verdict });
      stream.done = true;
    };

    // ---- player: pace the buffer, gated by the voice ----
    const play = async () => {
      let i = 0;
      for (;;) {
        if (runId.current !== my) return;
        while (i >= events.length && !stream.done) {
          await sleep(60);
          if (runId.current !== my) return;
        }
        if (i >= events.length && stream.done) break;
        const ev = events[i++];

        if (ev.type === "thinking") {
          setThinkingAgent(ev.agent);
          await sleep(LOADER_MS);
        } else if (ev.type === "turn") {
          const listening = voiceRef.current.isListening?.() ?? false;
          // When listening, keep the loader up until this turn's audio is actually
          // in hand, then reveal the line and start the voice together. ready()
          // resolves on fetch success or failure, so it won't hang; the cap is only
          // a backstop for a stalled network. With one-ahead prefetch the clip is
          // usually ready within a second.
          if (listening && voiceRef.current.ready) {
            await Promise.race([voiceRef.current.ready(ev.turn), sleep(9000)]);
            if (runId.current !== my) return;
          }
          setThinkingAgent(null);
          setTurns((t) => [...t, ev.turn]);
          const upcoming = nextTurnAfter(events, i);
          if (upcoming) voiceRef.current.prefetch?.(upcoming);
          if (listening) {
            try {
              await voiceRef.current.speak?.(ev.turn);
            } catch {
              await sleep(Math.min(ev.turn.durationMs, READ_CAP));
            }
          } else {
            await sleep(Math.min(ev.turn.durationMs, READ_CAP));
          }
          if (runId.current !== my) return;
          await sleep(GAP_MS);
        } else if (ev.type === "verdict") {
          setVerdict(ev.verdict);
        }
      }
      if (runId.current !== my) return;
      setThinkingAgent(null);
      setPhase("ready");
    };

    await Promise.all([produce(), play()]);
  }, [entry]);

  const restart = useCallback(() => {
    runId.current++;
    setTurns([]);
    setThinkingAgent(null);
    setVerdict(entry.transcript.verdict);
    setPhase("idle");
    setLive(false);
  }, [entry]);

  const deliverVerdict = useCallback(() => {
    runId.current++;
    setThinkingAgent(null);
    setPhase("verdict");
  }, []);

  const activeId = turns.length ? turns[turns.length - 1].id : null;
  const expected = Math.max(entry.transcript.turns.length, 1);
  const progress = phase === "idle" ? 0 : phase === "debate" ? Math.min(turns.length / expected, 0.96) : 1;

  return { phase, turns, thinkingAgent, verdict, live, activeId, progress, start, restart, deliverVerdict };
}
