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
  auth_failed: "Fix ANTHROPIC_API_KEY on the server, then press Retry to continue from where it stopped.",
  request_rejected: "Check the model name and account access, then press Retry to continue from where it stopped.",
  case_missing: "This case no longer exists. Start a new hearing from the Chamber.",
  state_error: "Press Retry. If it fails again, start a new hearing.",
};

function exhaustedNextAction(code: string, done: number, total: number): string {
  const where = done >= total ? "the final recommendation" : `turn ${done + 1} of ${total}`;
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
  const hb = setInterval(() => store.heartbeat(id, workerId), deps.heartbeatMs ?? 5000);
  hb.unref?.();

  try {
    let attempt = 0;
    for (;;) {
      const row = store.get(id);
      // Paused by the reviewer, or another worker owns it now: stop quietly, nothing is lost.
      if (!row || row.status !== "running" || row.worker_id !== workerId) return;

      const entry = deps.getEntry(row.case_id);
      if (!entry) {
        store.failPermanently(id, "case_missing", "The case for this hearing could not be found.", PERMANENT_NEXT_ACTION.case_missing);
        return;
      }
      const source = deps.getSource(row.mode);
      const done = store.turnCount(id);

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
          const verdict = await source.generateVerdict(entry, store.listTurns(id));
          if (store.complete(id, verdict, workerId)) return;
          if (store.get(id)?.status === "running") {
            store.failPermanently(id, "state_error", "The hearing could not be completed because its record is inconsistent.", PERMANENT_NEXT_ACTION.state_error);
          }
          return;
        }
        attempt = 0;
      } catch (e) {
        const err =
          e instanceof SourceError ? e : new SourceError("transient", "internal_error", e instanceof Error ? e.message : "Unexpected error.");
        if (err.kind === "permanent") {
          store.failPermanently(id, err.code, err.message, PERMANENT_NEXT_ACTION[err.code] ?? "Press Retry to continue from where it stopped.");
          return;
        }
        attempt++;
        if (attempt >= maxAttempts) {
          store.pauseBySystem(id, err.code, err.message, exhaustedNextAction(err.code, done, row.total_turns));
          return;
        }
        store.noteRetry(id, attempt, err.code, err.message);
        await sleep(backoff(attempt, err.retryAfterMs));
      }
    }
  } finally {
    clearInterval(hb);
  }
}
