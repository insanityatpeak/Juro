import { randomUUID } from "node:crypto";
import type { CaseEntry } from "../types";
import { SourceError, type TurnSource } from "./source";
import type { HearingStore } from "./store";
import type { HearingMode } from "./types";

export interface RunnerDeps {
  store: HearingStore;
  getEntry: (caseId: string) => CaseEntry | undefined;
  getSource: (mode: HearingMode) => TurnSource;
  sleep?: (ms: number) => Promise<void>;
  /** Tries per step (one turn, or the final recommendation) before the system pauses the hearing. */
  maxAttempts?: number;
  backoffMs?: (attempt: number, retryAfterMs?: number) => number;
  workerId?: string;
  heartbeatMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const defaultBackoff = (attempt: number, retryAfterMs?: number) =>
  Math.min(Math.max(retryAfterMs ?? 0, 2000 * 2 ** (attempt - 1)), 30000);

const PERMANENT_NEXT_ACTION: Record<string, string> = {
  auth_failed: "Fix GROQ_API_KEY on the server, then press Retry to continue from where it stopped.",
  request_rejected: "Check the model name and account access, then press Retry to continue from where it stopped.",
  case_missing: "This case no longer exists. Start a new hearing from the Chamber.",
  state_error: "Press Retry. If it fails again, start a new hearing.",
  provider_disabled: "Live hearings are turned off on this server. Start a new hearing; it replays the sample record.",
  plan_mismatch: "The hearing plan changed since this hearing started. Start a new hearing.",
};

function resumeNextAction(done: number, total: number): string {
  const where = done >= total ? "the final recommendation" : `turn ${done + 1} of ${total}`;
  return `Press Resume to continue from ${where}.`;
}

function exhaustedNextAction(code: string, done: number, total: number): string {
  const where = done >= total ? "the final recommendation" : `turn ${done + 1} of ${total}`;
  if (code === "quota_exhausted") return `The free-tier quota is used up. Press Resume once it resets to continue from ${where}; turns already on the record are kept.`;
  if (code === "rate_limited") return `The AI provider is rate limiting requests. Wait a minute, then press Resume to continue from ${where}.`;
  return `A temporary problem kept happening. Press Resume to continue from ${where}; the ${done} turn${done === 1 ? "" : "s"} already on the record are kept.`;
}

/**
 * Drive one hearing to a resting state. Safe to call again for the same hearing: it always continues
 * from the turns already stored, and the store refuses any turn that is not the next one in the chain.
 */
export async function runHearing(deps: RunnerDeps, id: string): Promise<void> {
  const { store } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const maxAttempts = deps.maxAttempts ?? 3;
  const backoff = deps.backoffMs ?? defaultBackoff;
  const workerId = deps.workerId ?? randomUUID();

  if (!store.claim(id, workerId)) return;
  const hb = setInterval(() => {
    try {
      store.heartbeat(id, workerId);
    } catch (e) {
      // A missed heartbeat only risks a stale-recovery handover, which ownership checks make safe.
      console.error("[hearings] heartbeat failed", id, e);
    }
  }, deps.heartbeatMs ?? 5000);
  hb.unref?.();

  const ownsIt = () => {
    const r = store.get(id);
    return r && r.status === "running" && r.worker_id === workerId ? r : null;
  };

  try {
    let attempt = 0;
    for (;;) {
      const row = ownsIt();
      // Another worker owns it now, or it left `running`: stop quietly, nothing is lost.
      if (!row) return;

      const done = store.turnCount(id);
      // A reviewer pause takes effect between steps: the previous step is already saved.
      if (row.pause_requested) {
        store.settlePause(id, workerId, resumeNextAction(done, row.total_turns));
        return;
      }

      const entry = deps.getEntry(row.case_id);
      if (!entry) {
        store.failPermanently(id, workerId, "case_missing", "The case for this hearing could not be found.", PERMANENT_NEXT_ACTION.case_missing);
        return;
      }
      const source = deps.getSource(row.mode);

      try {
        if (done < row.total_turns) {
          const seq = done + 1;
          const g = await source.generateTurn({ entry, seq, turns: store.listTurns(id) });
          store.appendTurn(
            id,
            seq,
            { id: `t${seq}`, agent: g.agent, type: g.type, text: g.text, addressedTo: g.addressedTo, evidenceRefs: g.evidenceRefs, durationMs: g.durationMs },
            workerId,
          );
        } else {
          // If a pause was requested during the final step, completing is still right: nothing is left to pause.
          const verdict = await source.generateVerdict(entry, store.listTurns(id));
          if (store.complete(id, verdict, workerId)) return;
          if (ownsIt()) {
            store.failPermanently(id, workerId, "state_error", "The hearing could not be completed because its record is inconsistent.", PERMANENT_NEXT_ACTION.state_error);
          }
          return;
        }
        attempt = 0;
      } catch (e) {
        const err =
          e instanceof SourceError ? e : new SourceError("transient", "internal_error", e instanceof Error ? e.message : "Unexpected error.");
        if (err.kind === "permanent") {
          store.failPermanently(id, workerId, err.code, err.message, PERMANENT_NEXT_ACTION[err.code] ?? "Press Retry to continue from where it stopped.");
          return;
        }
        // e.g. the free-tier quota is used up: retrying now would only fail again. Pause; no paid fallback.
        if (err.kind === "pause") {
          store.pauseBySystem(id, workerId, err.code, err.message, exhaustedNextAction(err.code, done, row.total_turns));
          return;
        }
        // Pause requested while this step was in flight and it failed: pause now, do not retry.
        if (ownsIt()?.pause_requested) {
          store.settlePause(id, workerId, resumeNextAction(done, row.total_turns), { code: err.code, message: err.message });
          return;
        }
        attempt++;
        if (attempt >= maxAttempts) {
          store.pauseBySystem(id, workerId, err.code, err.message, exhaustedNextAction(err.code, done, row.total_turns));
          return;
        }
        if (!store.noteRetry(id, workerId, attempt, err.code, err.message)) return; // lost ownership
        await sleep(backoff(attempt, err.retryAfterMs));
      }
    }
  } finally {
    clearInterval(hb);
  }
}
