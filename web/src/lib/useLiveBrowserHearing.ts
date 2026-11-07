"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HearingError, HearingStatus, PauseReason, StoredTurn } from "./hearings/types";
import type { LiveModels } from "./live";
import { TURN_PLAN } from "./roles";
import type { CaseEntry, Faction, Verdict } from "./types";
import type { HearingPhase, HearingState } from "./useBackgroundHearing";

const MAX_TRIES = 3;
const backoff = (tries: number, retryAfterMs?: number) => Math.min(Math.max(retryAfterMs ?? 0, 2000 * 2 ** (tries - 1)), 30000);

type StepBody =
  | { kind: "turn"; turn: Omit<StoredTurn, "seq" | "hash"> }
  | { kind: "verdict"; verdict: Verdict }
  | { error: string; kind: string; message: string; retryAfterMs?: number };

/**
 * Live hearing on Groq's free tier, driven from the browser one step at a time (POST /api/live/step).
 * Works on serverless hosts: the server keeps no state. Leaving the page ends the hearing.
 *
 * Pause: the step in flight finishes and is kept, then the hearing stops before the next one.
 * Quota used up: the hearing pauses; Resume continues. There is no paid fallback.
 */
export function useLiveBrowserHearing(entry: CaseEntry): HearingState {
  const [started, setStarted] = useState(false);
  const [turns, setTurns] = useState<StoredTurn[]>([]);
  const [status, setStatus] = useState<HearingStatus | null>(null);
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  const [pauseRequested, setPauseRequested] = useState(false);
  const [error, setError] = useState<HearingError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [decision, setDecision] = useState<Verdict["decision"] | null>(null);
  const [engines, setEngines] = useState<LiveModels | null>(null);

  const turnsRef = useRef<StoredTurn[]>([]);
  const pauseRef = useRef(false);
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const total = TURN_PLAN.length;
  const where = () => (turnsRef.current.length >= total ? "the final recommendation" : `turn ${turnsRef.current.length + 1} of ${total}`);

  const stopHere = useCallback((reason: PauseReason, err: HearingError) => {
    pauseRef.current = false;
    setPauseRequested(false);
    setPauseReason(reason);
    setStatus("paused");
    setError(err);
  }, []);

  const run = useCallback(async () => {
    const my = ++runRef.current;
    setStatus("running");
    setPauseReason(null);
    setError(null);
    setAttempt(0);
    let tries = 0;
    const alive = () => runRef.current === my;

    for (;;) {
      if (!alive()) return;
      if (pauseRef.current) {
        stopHere("reviewer", { code: "paused", message: "", nextAction: `Press Resume to continue from ${where()}.` });
        return;
      }

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let res: Response | null = null;
      let data: StepBody | null = null;
      try {
        res = await fetch("/api/live/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caseId: entry.id,
            turns: turnsRef.current.map(({ agent, type, text, addressedTo, evidenceRefs }) => ({ agent, type, text, addressedTo, evidenceRefs })),
          }),
          signal: ctrl.signal,
        });
        data = (await res.json().catch(() => null)) as StepBody | null;
      } catch {
        res = null;
      }
      if (!alive()) return;

      if (res?.ok && data && "kind" in data && (data.kind === "turn" || data.kind === "verdict") && !("error" in data)) {
        tries = 0;
        setAttempt(0);
        setError(null);
        if (data.kind === "turn") {
          const t: StoredTurn = { ...data.turn, seq: turnsRef.current.length + 1, hash: "" }; // not hash-chained
          turnsRef.current = [...turnsRef.current, t];
          setTurns(turnsRef.current);
          continue; // the pause check at the top runs after the step is kept
        }
        // A successful final recommendation completes the hearing even if a pause was requested.
        pauseRef.current = false;
        setPauseRequested(false);
        setVerdict(data.verdict);
        setStatus("complete");
        return;
      }

      const e = data && "error" in data ? data : null;
      const code = e?.error ?? "network";
      const message = e?.message ?? "Could not reach the server.";
      const kind = e?.kind ?? "transient";

      if (pauseRef.current) {
        // Pause was requested while this step was in flight and it failed: pause now, no retry.
        stopHere("reviewer", { code, message, nextAction: `Press Resume to continue from ${where()}.` });
        return;
      }
      if (kind === "pause" || code === "quota_exhausted") {
        stopHere("system", {
          code,
          message,
          nextAction: `The free-tier quota is used up. Press Resume once it resets to continue from ${where()}; the turns so far are kept.`,
        });
        return;
      }
      if (kind === "permanent" || (res && (res.status === 400 || res.status === 503))) {
        setStatus(turnsRef.current.length ? "partial" : "failed");
        setError({ code, message, nextAction: res?.status === 503 ? "Live hearings are unavailable on this server. Go back and replay the sample instead." : `Press Retry to continue from ${where()}.` });
        return;
      }
      tries++;
      setAttempt(tries);
      setError({ code, message, nextAction: null });
      if (tries >= MAX_TRIES) {
        stopHere("system", { code, message, nextAction: `A temporary problem kept happening. Press Resume to continue from ${where()}.` });
        return;
      }
      await new Promise((r) => setTimeout(r, backoff(tries, e?.retryAfterMs)));
    }
  }, [entry.id, stopHere]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(async () => {
    turnsRef.current = [];
    pauseRef.current = false;
    setTurns([]);
    setVerdict(null);
    setDecision(null);
    setPauseRequested(false);
    setStarted(true);
    fetch("/api/live", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { models?: LiveModels | null }) => setEngines(d.models ?? null))
      .catch(() => {});
    void run();
  }, [run]);

  const cancelRun = useCallback(() => {
    runRef.current++;
    abortRef.current?.abort();
  }, []);

  const restart = useCallback(() => {
    cancelRun();
    turnsRef.current = [];
    pauseRef.current = false;
    setStarted(false);
    setTurns([]);
    setStatus(null);
    setPauseReason(null);
    setPauseRequested(false);
    setError(null);
    setVerdict(null);
    setDecision(null);
  }, [cancelRun]);

  // Leaving the page or the case ends the hearing: stop the loop and abort the request in flight.
  useEffect(() => cancelRun, [cancelRun]);

  const pause = useCallback(async () => {
    if (status !== "running") return;
    pauseRef.current = true;
    setPauseRequested(true);
  }, [status]);

  const resume = useCallback(async () => {
    if (status === "running" && pauseRef.current) {
      pauseRef.current = false; // withdraw a pause that has not taken effect yet
      setPauseRequested(false);
      return;
    }
    if (status === "paused") void run();
  }, [status, run]);

  const retry = useCallback(async () => {
    if (status === "failed" || status === "partial") void run();
  }, [status, run]);

  const deliverVerdict = useCallback(async (d: Verdict["decision"]) => setDecision(d), []);

  const phase: HearingPhase = !started ? "idle" : decision ? "verdict" : status === "complete" ? "ready" : "debate";
  const thinkingAgent: Faction | null = status === "running" ? (TURN_PLAN[turns.length]?.[0] ?? "adjudicator") : null;

  return {
    phase,
    turns,
    thinkingAgent,
    verdict: verdict ?? { decision: "OVERTURNED", rationale: "", by: "" }, // only shown once complete
    humanDecision: decision,
    live: true,
    engines,
    auditRoot: null, // a browser-held live hearing is not stored or sealed
    activeId: turns.length ? turns[turns.length - 1].id : null,
    progress: !started ? 0 : status === "complete" ? 1 : Math.min(turns.length / total, 0.96),
    start,
    restart,
    deliverVerdict,
    backend: "browser",
    hearingId: null,
    status,
    mode: started ? "live" : null,
    pauseReason,
    pauseRequested,
    attempt,
    error,
    controllable: true,
    canControl: true,
    canRule: status === "complete" && !!verdict && !decision,
    totalTurns: total,
    turnCount: turns.length,
    loading: false,
    notFound: false,
    offline: false,
    starting: false,
    startError: null,
    rulingError: null,
    busy: false,
    pause,
    resume,
    retry,
  };
}
