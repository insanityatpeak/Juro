import type Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { GENESIS_HASH, nextHash, shortRoot } from "../hash";
import type { Faction, TurnType, Verdict } from "../types";
import { getDb } from "./db";
import type {
  HearingError,
  HearingMode,
  HearingRow,
  HearingStatus,
  HearingView,
  PauseReason,
  StoredTurn,
} from "./types";

export type NewTurn = {
  id: string;
  agent: Faction;
  type: TurnType;
  text: string;
  addressedTo: Faction | null;
  evidenceRefs: string[];
  durationMs: number;
};

type TurnRow = {
  seq: number;
  turn_id: string;
  agent: string;
  type: string;
  text: string;
  addressed_to: string | null;
  evidence_refs: string;
  duration_ms: number;
  hash: string;
};

const now = () => Date.now();

/** A control token lets its holder pause, resume, retry and rule on one hearing. Only its hash is stored. */
export const newControlToken = () => randomBytes(32).toString("base64url");
export const hashControlToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createStore(db: Database.Database) {
  const getRow = (id: string) => db.prepare("SELECT * FROM hearings WHERE id = ?").get(id) as HearingRow | undefined;
  const turnCount = (id: string) =>
    (db.prepare("SELECT COUNT(*) AS n FROM turns WHERE hearing_id = ?").get(id) as { n: number }).n;

  /**
   * Move a hearing between states only if it is currently in one of `from` and, when `workerId`
   * is given, only if that worker still owns it. Returns whether it moved.
   */
  function transition(
    id: string,
    from: HearingStatus[],
    to: HearingStatus,
    extra: Partial<
      Pick<HearingRow, "pause_reason" | "attempt" | "error_code" | "error_message" | "next_action" | "worker_id" | "pause_requested">
    > = {},
    workerId?: string,
  ): boolean {
    const sets = ["status = @to", "updated_at = @t"];
    const params: Record<string, unknown> = { id, to, t: now() };
    for (const [k, v] of Object.entries(extra)) {
      sets.push(`${k} = @${k}`);
      params[k] = v ?? null;
    }
    const marks = from.map((_, i) => `@f${i}`).join(", ");
    from.forEach((f, i) => (params[`f${i}`] = f));
    let where = `id = @id AND status IN (${marks})`;
    if (workerId !== undefined) {
      where += " AND worker_id = @owner";
      params.owner = workerId;
    }
    const r = db.prepare(`UPDATE hearings SET ${sets.join(", ")} WHERE ${where}`).run(params);
    return r.changes === 1;
  }

  return {
    create(input: { caseId: string; mode: HearingMode; totalTurns: number; controlTokenHash?: string | null }): HearingRow {
      const id = randomUUID();
      const t = now();
      db.prepare(
        `INSERT INTO hearings (id, case_id, mode, status, total_turns, chain_hash, control_token_hash, created_at, updated_at)
         VALUES (?, ?, ?, 'waiting', ?, ?, ?, ?, ?)`,
      ).run(id, input.caseId, input.mode, input.totalTurns, GENESIS_HASH, input.controlTokenHash ?? null, t, t);
      return getRow(id)!;
    },

    get: getRow,
    turnCount,

    /** Hearings still queued or running; used to cap the queue. */
    openCount(): number {
      return (db.prepare("SELECT COUNT(*) AS n FROM hearings WHERE status IN ('waiting', 'running')").get() as { n: number }).n;
    },

    /** Whether `token` is this hearing's control token. Hearings without a token cannot be controlled. */
    isController(id: string, token: string | null | undefined): boolean {
      const h = getRow(id);
      if (!h?.control_token_hash || !token) return false;
      const a = Buffer.from(hashControlToken(token), "hex");
      const b = Buffer.from(h.control_token_hash, "hex");
      return a.length === b.length && timingSafeEqual(a, b);
    },

    listTurns(id: string, after = 0): StoredTurn[] {
      const rows = db
        .prepare("SELECT * FROM turns WHERE hearing_id = ? AND seq > ? ORDER BY seq")
        .all(id, after) as TurnRow[];
      return rows.map((r) => ({
        seq: r.seq,
        id: r.turn_id,
        agent: r.agent as Faction,
        type: r.type as TurnType,
        text: r.text,
        addressedTo: (r.addressed_to as Faction | null) ?? undefined,
        evidenceRefs: JSON.parse(r.evidence_refs) as string[],
        durationMs: r.duration_ms,
        hash: r.hash,
      }));
    },

    /**
     * Store the turn at position `seq`. It only lands if it is exactly the next turn in the chain,
     * so retrying, resuming or racing workers can never duplicate or reorder the transcript.
     */
    appendTurn(id: string, seq: number, turn: NewTurn, workerId: string): { stored: boolean; hash?: string } {
      return db.transaction(() => {
        const h = getRow(id);
        if (!h || h.status !== "running" || h.worker_id !== workerId) return { stored: false };
        if (turnCount(id) !== seq - 1) return { stored: false };
        const payload = {
          id: turn.id,
          agent: turn.agent,
          type: turn.type,
          text: turn.text,
          addressedTo: turn.addressedTo,
          evidenceRefs: turn.evidenceRefs,
          durationMs: turn.durationMs,
        };
        const hash = nextHash(h.chain_hash, payload);
        db.prepare(
          `INSERT INTO turns (hearing_id, seq, turn_id, agent, type, text, addressed_to, evidence_refs, duration_ms, hash, prev_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, seq, turn.id, turn.agent, turn.type, turn.text, turn.addressedTo, JSON.stringify(turn.evidenceRefs), turn.durationMs, hash, h.chain_hash, now());
        db.prepare("UPDATE hearings SET chain_hash = ?, attempt = 0, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?").run(hash, now(), id);
        return { stored: true, hash };
      })();
    },

    /** Worker takes a queued hearing. Only one worker can win. */
    claim(id: string, workerId: string): boolean {
      const t = now();
      const r = db
        .prepare(
          `UPDATE hearings SET status = 'running', pause_reason = NULL, worker_id = ?, heartbeat_at = ?, updated_at = ?
           WHERE id = ? AND status = 'waiting'`,
        )
        .run(workerId, t, t, id);
      return r.changes === 1;
    },

    heartbeat(id: string, workerId: string): void {
      db.prepare("UPDATE hearings SET heartbeat_at = ? WHERE id = ? AND worker_id = ? AND status = 'running'").run(now(), id, workerId);
    },

    /** Record a temporary failure while the owning worker keeps retrying. */
    noteRetry(id: string, workerId: string, attempt: number, code: string, message: string): boolean {
      return (
        db
          .prepare(
            "UPDATE hearings SET attempt = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ? AND status = 'running' AND worker_id = ?",
          )
          .run(attempt, code, message, now(), id, workerId).changes === 1
      );
    },

    /**
     * Reviewer pause. A queued hearing pauses at once. A running one keeps its worker: the active
     * step finishes and is saved, then the worker stops before starting another (see `settlePause`).
     */
    requestPause(id: string): "paused" | "pausing" | "invalid" {
      return db.transaction(() => {
        const ok = transition(id, ["waiting"], "paused", {
          pause_reason: "reviewer",
          worker_id: null,
          pause_requested: 0,
          error_code: null,
          error_message: null,
          next_action: "Press Resume to continue from the next turn.",
        });
        if (ok) return "paused" as const;
        const r = db
          .prepare("UPDATE hearings SET pause_requested = 1, updated_at = ? WHERE id = ? AND status = 'running'")
          .run(now(), id);
        return r.changes === 1 ? ("pausing" as const) : ("invalid" as const);
      })();
    },

    /** Withdraw a pause request that has not taken effect yet. */
    cancelPause(id: string): boolean {
      return (
        db
          .prepare("UPDATE hearings SET pause_requested = 0, updated_at = ? WHERE id = ? AND status = 'running' AND pause_requested = 1")
          .run(now(), id).changes === 1
      );
    },

    /**
     * The owning worker honours a pause request between steps. `failure` is set when the active
     * step failed: the hearing pauses without retrying and the reviewer sees why.
     */
    settlePause(id: string, workerId: string, nextAction: string, failure?: { code: string; message: string }): boolean {
      return transition(
        id,
        ["running"],
        "paused",
        {
          pause_reason: "reviewer",
          worker_id: null,
          pause_requested: 0,
          attempt: 0,
          error_code: failure?.code ?? null,
          error_message: failure?.message ?? null,
          next_action: nextAction,
        },
        workerId,
      );
    },

    /** System pause (rate limit or retries used up). The owning worker releases the hearing. */
    pauseBySystem(id: string, workerId: string, code: string, message: string, nextAction: string): boolean {
      return transition(
        id,
        ["running"],
        "paused",
        { pause_reason: "system", worker_id: null, pause_requested: 0, error_code: code, error_message: message, next_action: nextAction },
        workerId,
      );
    },

    /** Resume a paused hearing, or retry a failed/partial one from its next turn. */
    requeue(id: string): boolean {
      return transition(id, ["paused", "failed", "partial"], "waiting", {
        pause_reason: null,
        pause_requested: 0,
        attempt: 0,
        error_code: null,
        error_message: null,
        next_action: null,
        worker_id: null,
      });
    },

    /** Permanent failure, by the owning worker. Hearings with turns become `partial`, the rest `failed`. */
    failPermanently(id: string, workerId: string, code: string, message: string, nextAction: string): HearingStatus | null {
      const to: HearingStatus = turnCount(id) > 0 ? "partial" : "failed";
      const ok = transition(
        id,
        ["running"],
        to,
        { worker_id: null, pause_requested: 0, error_code: code, error_message: message, next_action: nextAction },
        workerId,
      );
      return ok ? to : null;
    },

    /**
     * All turns are stored and the recommendation is ready: the hearing becomes complete.
     * A pending pause request is dropped, because no work remains to pause.
     */
    complete(id: string, verdict: Verdict, workerId: string): boolean {
      return db.transaction(() => {
        const h = getRow(id);
        if (!h || h.status !== "running" || h.worker_id !== workerId || turnCount(id) !== h.total_turns) return false;
        db.prepare(
          `UPDATE hearings SET status = 'complete', verdict_json = ?, audit_root = ?, worker_id = NULL, pause_requested = 0,
             attempt = 0, error_code = NULL, error_message = NULL, next_action = NULL, updated_at = ? WHERE id = ?`,
        ).run(JSON.stringify(verdict), shortRoot(h.chain_hash), now(), id);
        return true;
      })();
    },

    /** The reviewer's binding decision. Only a complete hearing can be ruled on, and only once. */
    recordRuling(id: string, decision: Verdict["decision"]): "ok" | "not_found" | "not_complete" | "already_ruled" {
      return db.transaction(() => {
        const h = getRow(id);
        if (!h) return "not_found" as const;
        if (h.status !== "complete") return "not_complete" as const;
        if (h.human_decision) return "already_ruled" as const;
        db.prepare("UPDATE hearings SET human_decision = ?, human_decided_at = ?, updated_at = ? WHERE id = ?").run(decision, now(), now(), id);
        return "ok" as const;
      })();
    },

    /**
     * Hearings whose worker stopped heartbeating (server restart/crash) go back to the queue,
     * or to `paused` if the reviewer had asked for a pause.
     */
    recoverStale(ttlMs: number): number {
      const t = now();
      return db.transaction(() => {
        const paused = db
          .prepare(
            `UPDATE hearings SET status = 'paused', pause_reason = 'reviewer', pause_requested = 0, worker_id = NULL,
               next_action = 'Press Resume to continue from the next turn.', updated_at = ?
             WHERE status = 'running' AND pause_requested = 1 AND heartbeat_at < ?`,
          )
          .run(t, t - ttlMs).changes;
        const queued = db
          .prepare("UPDATE hearings SET status = 'waiting', worker_id = NULL, updated_at = ? WHERE status = 'running' AND heartbeat_at < ?")
          .run(t, t - ttlMs).changes;
        return paused + queued;
      })();
    },

    waitingIds(): string[] {
      return (db.prepare("SELECT id FROM hearings WHERE status = 'waiting' ORDER BY created_at").all() as { id: string }[]).map((r) => r.id);
    },

    view(id: string, after = 0): HearingView | null {
      const h = getRow(id);
      if (!h) return null;
      const error: HearingError | null = h.error_code
        ? { code: h.error_code, message: h.error_message ?? "", nextAction: h.next_action }
        : h.next_action && h.status === "paused"
          ? { code: "paused", message: "", nextAction: h.next_action }
          : null;
      const verdict = h.verdict_json ? (JSON.parse(h.verdict_json) as Verdict) : null;
      return {
        id: h.id,
        caseId: h.case_id,
        mode: h.mode,
        status: h.status,
        pauseReason: (h.pause_reason as PauseReason | null) ?? null,
        pauseRequested: h.status === "running" && h.pause_requested === 1,
        totalTurns: h.total_turns,
        turnCount: turnCount(id),
        attempt: h.attempt,
        error,
        auditRoot: h.audit_root,
        verdict,
        humanDecision: (h.human_decision as Verdict["decision"] | null) ?? null,
        canRule: h.status === "complete" && !!verdict && !h.human_decision,
        updatedAt: h.updated_at,
        turns: this.listTurns(id, after),
      };
    },
  };
}

export type HearingStore = ReturnType<typeof createStore>;

const g = globalThis as unknown as { __juroHearingStore?: HearingStore };
export function getStore(): HearingStore {
  if (!g.__juroHearingStore) g.__juroHearingStore = createStore(getDb());
  return g.__juroHearingStore;
}
