"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HearingStatus, HearingView, StoredTurn } from "./hearings/types";
import { TURN_PLAN } from "./roles";
import type { CaseEntry, Faction, Verdict } from "./types";

export type HearingPhase = "idle" | "debate" | "ready" | "verdict";
type Meta = Omit<HearingView, "turns">;

const POLL_ACTIVE_MS = 1500; // hearing is moving
const POLL_RESTING_MS = 5000; // paused / failed / partial: slow check in case another tab resumes it

// The control token is returned once at creation and kept only in this browser.
// Without it the hearing can still be viewed, but not paused, resumed, retried or ruled on.
const CONTROL_HEADER = "x-hearing-control";
const tokenKey = (id: string) => `juro:hearing-control:${id}`;
function loadToken(id: string): string | null {
  try {
    return window.localStorage.getItem(tokenKey(id));
  } catch {
    return null;
  }
}
function saveToken(id: string, token: string): void {
  try {
    window.localStorage.setItem(tokenKey(id), token);
  } catch {
    /* storage blocked: controls work for this page view only */
  }
}

/**
 * The hearing runs on the server. This hook only watches it: it starts one, polls its state,
 * merges new turns by sequence number, and sends pause/resume/retry/ruling requests.
 * Closing the page changes nothing server-side; reopening /chamber/<id> loads the same record.
 */
export function useBackgroundHearing(entry: CaseEntry, initialId: string | null = null) {
  const [id, setId] = useState<string | null>(initialId);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [turns, setTurns] = useState<StoredTurn[]>([]);
  const [offline, setOffline] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [rulingError, setRulingError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollKey, setPollKey] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const lastSeq = useRef(0);

  const apply = useCallback((v: HearingView) => {
    const { turns: incoming, ...rest } = v;
    setMeta(rest);
    if (incoming.length) {
      lastSeq.current = Math.max(lastSeq.current, ...incoming.map((t) => t.seq));
      setTurns((prev) => {
        const have = new Set(prev.map((t) => t.seq));
        const add = incoming.filter((t) => !have.has(t.seq)); // never show a turn twice
        return add.length ? [...prev, ...add].sort((a, b) => a.seq - b.seq) : prev;
      });
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let delay = POLL_ACTIVE_MS;
      try {
        const r = await fetch(`/api/hearings/${id}?after=${lastSeq.current}`, { cache: "no-store" });
        if (stop) return;
        if (r.status === 404) {
          setNotFound(true);
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        const v = (await r.json()) as HearingView;
        if (stop) return;
        setOffline(false);
        // Reopened from a link: pick up the control token if this browser started the hearing.
        setToken((t) => t ?? loadToken(id));
        apply(v);
        if (v.status === "complete") return; // the record is final; only the ruling can still change
        delay = v.status === "waiting" || v.status === "running" ? POLL_ACTIVE_MS : POLL_RESTING_MS;
      } catch {
        if (stop) return;
        setOffline(true); // the hearing keeps running on the server; keep trying to reconnect
        delay = 3000;
      }
      timer = setTimeout(tick, delay);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, pollKey, apply]);

  const start = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const r = await fetch("/api/hearings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: entry.id }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { id: string; controlToken: string };
      saveToken(d.id, d.controlToken);
      setToken(d.controlToken);
      lastSeq.current = 0;
      setTurns([]);
      setMeta(null);
      setNotFound(false);
      setId(d.id);
      window.history.replaceState(null, "", `/chamber/${d.id}`); // a link the reviewer can come back to
    } catch {
      setStartError("Could not start the hearing. Check that the server is running and try again.");
    } finally {
      setStarting(false);
    }
  }, [entry.id]);

  const act = useCallback(
    async (action: "pause" | "resume" | "retry") => {
      if (!id || !token) return;
      setBusy(true);
      try {
        const r = await fetch(`/api/hearings/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", [CONTROL_HEADER]: token },
          body: JSON.stringify({ action }),
        });
        if (r.ok) apply((await r.json()) as HearingView);
        setPollKey((k) => k + 1); // on a 409 the state changed elsewhere; the next poll shows it
      } catch {
        setOffline(true);
      } finally {
        setBusy(false);
      }
    },
    [id, token, apply],
  );

  const deliverVerdict = useCallback(
    async (decision: Verdict["decision"]) => {
      if (!id) return;
      if (!token) {
        setRulingError("Only the browser that started this hearing can rule on it.");
        return;
      }
      setRulingError(null);
      try {
        const r = await fetch(`/api/hearings/${id}/ruling`, {
          method: "POST",
          headers: { "Content-Type": "application/json", [CONTROL_HEADER]: token },
          body: JSON.stringify({ decision }),
        });
        if (r.ok) {
          apply((await r.json()) as HearingView);
          return;
        }
        const d = (await r.json().catch(() => ({}))) as { message?: string };
        setRulingError(d.message ?? "The ruling could not be recorded.");
      } catch {
        setRulingError("Could not reach the server. Try again.");
      }
    },
    [id, token, apply],
  );

  /** Leave this view. The hearing itself keeps its state on the server. */
  const restart = useCallback(() => {
    lastSeq.current = 0;
    setId(null);
    setToken(null);
    setMeta(null);
    setTurns([]);
    setOffline(false);
    setNotFound(false);
    setStartError(null);
    setRulingError(null);
  }, []);

  const status: HearingStatus | null = meta?.status ?? null;
  const phase: HearingPhase = !id ? "idle" : meta?.humanDecision ? "verdict" : status === "complete" ? "ready" : "debate";

  // While the server is working, show who is about to speak.
  const thinkingAgent: Faction | null = useMemo(() => {
    if (status !== "running" || !meta) return null;
    if (turns.length >= meta.totalTurns) return "adjudicator";
    if (meta.mode === "live") return TURN_PLAN[turns.length]?.[0] ?? null;
    return entry.transcript.turns[turns.length]?.agent ?? null;
  }, [status, meta, turns.length, entry]);

  // The AI recommendation and the reviewer's ruling stay separate: the ruling is never merged into
  // the recommendation's rationale or attributed to a named physician.
  const verdict: Verdict = meta?.verdict ?? entry.transcript.verdict;
  const controllable = meta?.controllable ?? true;
  const canControl = token !== null && controllable;

  const totalTurns = meta?.totalTurns ?? entry.transcript.turns.length;
  return {
    // same surface the Chamber already used
    phase,
    turns,
    thinkingAgent,
    verdict,
    humanDecision: meta?.humanDecision ?? null,
    live: meta?.mode === "live",
    auditRoot: meta?.auditRoot ?? null,
    activeId: turns.length ? turns[turns.length - 1].id : null,
    progress: phase === "idle" ? 0 : status === "complete" ? 1 : Math.min(turns.length / Math.max(totalTurns, 1), 0.96),
    start,
    restart,
    deliverVerdict,
    // background-hearing state
    backend: "server" as "server" | "browser",
    hearingId: id,
    status,
    mode: meta?.mode ?? null,
    pauseReason: meta?.pauseReason ?? null,
    pauseRequested: meta?.pauseRequested ?? false,
    attempt: meta?.attempt ?? 0,
    error: meta?.error ?? null,
    /** False for legacy hearings (no control token on record): read-only for everyone. */
    controllable,
    /** This browser holds the control token: it may pause, resume, retry and rule. */
    canControl,
    canRule: (meta?.canRule ?? false) && canControl,
    totalTurns,
    turnCount: turns.length,
    loading: id !== null && meta === null && !notFound,
    notFound,
    offline,
    starting,
    startError,
    rulingError,
    busy,
    pause: () => act("pause"),
    resume: () => act("resume"),
    retry: () => act("retry"),
  };
}

export type HearingState = ReturnType<typeof useBackgroundHearing>;
