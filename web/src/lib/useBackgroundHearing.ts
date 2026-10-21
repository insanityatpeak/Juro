"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HearingStatus, HearingView, StoredTurn } from "./hearings/types";
import { TURN_PLAN } from "./roles";
import type { CaseEntry, Faction, Verdict } from "./types";

export type HearingPhase = "idle" | "debate" | "ready" | "verdict";
type Meta = Omit<HearingView, "turns">;

const POLL_ACTIVE_MS = 1500; // hearing is moving
const POLL_RESTING_MS = 5000; // paused / failed / partial: slow check in case another tab resumes it

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
      const d = (await r.json()) as { id: string };
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
      if (!id) return;
      setBusy(true);
      try {
        const r = await fetch(`/api/hearings/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
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
    [id, apply],
  );

  const deliverVerdict = useCallback(
    async (decision: Verdict["decision"]) => {
      if (!id) return;
      setRulingError(null);
      try {
        const r = await fetch(`/api/hearings/${id}/ruling`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
    [id, apply],
  );

  /** Leave this view. The hearing itself keeps its state on the server. */
  const restart = useCallback(() => {
    lastSeq.current = 0;
    setId(null);
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

  const base = meta?.verdict ?? entry.transcript.verdict;
  const verdict: Verdict = meta?.humanDecision ? { ...base, decision: meta.humanDecision, by: "Human reviewer" } : base;

  const totalTurns = meta?.totalTurns ?? entry.transcript.turns.length;
  return {
    // same surface the Chamber already used
    phase,
    turns,
    thinkingAgent,
    verdict,
    live: meta?.mode === "live",
    auditRoot: meta?.auditRoot ?? null,
    activeId: turns.length ? turns[turns.length - 1].id : null,
    progress: phase === "idle" ? 0 : status === "complete" ? 1 : Math.min(turns.length / Math.max(totalTurns, 1), 0.96),
    start,
    restart,
    deliverVerdict,
    // background-hearing state
    hearingId: id,
    status,
    mode: meta?.mode ?? null,
    pauseReason: meta?.pauseReason ?? null,
    attempt: meta?.attempt ?? 0,
    error: meta?.error ?? null,
    canRule: meta?.canRule ?? false,
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
