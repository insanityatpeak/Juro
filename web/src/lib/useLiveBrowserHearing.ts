"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HearingError, HearingStatus, PauseReason, StoredTurn } from "./hearings/types";
import type { LiveModels } from "./live";
import { TURN_PLAN } from "./roles";
import type { CaseEntry, Faction, Verdict } from "./types";
import type { HearingPhase, HearingState } from "./useBackgroundHearing";

const MAX_TRIES = 3;
// Failures a retry can never fix: the signed session is gone, changed, or out of attempts,
// or live hearings are off. The reviewer is offered a new hearing instead of Retry.
const UNRECOVERABLE = new Set(["invalid_session", "session_expired", "context_changed", "attempts_exhausted", "provider_disabled", "preview_disabled"]);

const backoff = (tries: number, retryAfterMs?: number) => Math.min(Math.max(retryAfterMs ?? 0, 2000 * 2 ** (tries - 1)), 30000);

type StepBody =
  | { kind: "turn"; turn: Omit<StoredTurn, "seq" | "hash">; continuation: string }
  | { kind: "verdict"; verdict: Verdict; continuation: null }
  | { error: string; kind: string; message: string; retryAfterMs?: number };

/**
 * Live hearing on Groq's free tier, driven from the browser one step at a time (POST /api/live/step).
 * Signed continuations preserve transcript provenance. Leaving the page ends the hearing.
 *
 * Pause: the step in flight finishes and is kept, then the hearing stops before the next one.
 * Quota used up: the hearing pauses; Resume continues. There is no paid fallback.
 */
export function useLiveBrowserHearing(entry: CaseEntry, inviteCode: string): HearingState {
  const [started, setStarted] = useState(false);
  const [turns, setTurns] = useState<StoredTurn[]>([]);
  const [status, setStatus] = useState<HearingStatus | null>(null);
  const [canRetry, setCanRetry] = useState(true);
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  const [pauseRequested, setPauseRequested] = useState(false);
  const [error, setError] = useState<HearingError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [decision, setDecision] = useState<Verdict["decision"] | null>(null);
  const [engines, setEngines] = useState<LiveModels | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const turnsRef = useRef<StoredTurn[]>([]);
  const pauseRef = useRef(false);
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const continuationRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const runningRef = useRef(false);

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
    if (runningRef.current) return;
    runningRef.current = true;
    const my = ++runRef.current;
    setStatus("running");
    setCanRetry(true);
    setPauseReason(null);
    setError(null);
    setAttempt(0);
    let tries = 0;
    const alive = () => runRef.current === my;

    try {
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
          body: JSON.stringify({ continuation: continuationRef.current }),
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
          continuationRef.current = data.continuation;
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
          nextAction: code === "quota_exhausted"
            ? "The free quota is used up. Resume after it resets if this one-hour session is still valid; otherwise start a new hearing."
            : `Wait before pressing Resume to continue from ${where()}. The turns so far are kept.`,
        });
        return;
      }
      if (kind === "permanent" || (res && [400, 403, 409, 410, 413, 503].includes(res.status))) {
        const recoverable = res?.status !== 503 && !UNRECOVERABLE.has(code);
        setCanRetry(recoverable);
        setStatus(turnsRef.current.length ? "partial" : "failed");
        setError({
          code,
          message,
          nextAction: res?.status === 503
            ? "Live hearings are unavailable on this server. Start a new hearing to replay the sample instead."
            : recoverable
              ? `Press Retry to continue from ${where()}.`
              : "This live session can't continue. Start a new hearing (a new invited session) or replay the sample.",
        });
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
    } finally {
      if (runRef.current === my) runningRef.current = false;
    }
  }, [stopHere]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(async () => {
    if (startingRef.current || runningRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    const my = ++runRef.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await fetch("/api/live/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: entry.id, inviteCode }), signal: ctrl.signal,
      });
      const data = await r.json();
      if (runRef.current !== my) return;
      if (!r.ok || typeof data.continuation !== "string") {
        setStartError(data.message || "Could not start this live hearing.");
        return;
      }
      continuationRef.current = data.continuation;
      setEngines(data.models);
      turnsRef.current = [];
      pauseRef.current = false;
      setTurns([]);
      setVerdict(null);
      setDecision(null);
      setPauseRequested(false);
      setStarted(true);
      startingRef.current = false;
      setStarting(false);
      void run();
    } catch {
      if (runRef.current === my) setStartError("Could not reach the server. Please try again.");
    } finally {
      if (runRef.current === my) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }, [entry.id, inviteCode, run]);

  const cancelRun = useCallback(() => {
    runRef.current++;
    runningRef.current = false;
    startingRef.current = false;
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
    setStarting(false);
    setStartError(null);
    continuationRef.current = null;
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
    if ((status === "failed" || status === "partial") && canRetry) void run();
  }, [status, canRetry, run]);

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
    starting,
    startError,
    rulingError: null,
    busy: false,
    pause,
    resume,
    retry,
    /** False when the failure can't be retried (expired/invalid session, live off): offer a new hearing. */
    canRetry,
  };
}
