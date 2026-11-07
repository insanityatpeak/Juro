import type { Turn, Verdict } from "../types";

// waiting  queued, no worker has picked it up yet
// running  a worker is generating turns (attempt > 0 means it is retrying a temporary failure)
// paused   stopped on purpose (reviewer) or by the system (rate limit / retries exhausted); resumable
// failed   permanent failure before any turn was produced
// partial  permanent failure after some turns; kept for the record, never a ruling
// complete every turn plus the recommendation are stored; the only state a human can rule on
export type HearingStatus = "waiting" | "running" | "paused" | "failed" | "partial" | "complete";
export type PauseReason = "reviewer" | "system";
export type HearingMode = "live" | "sample";

export const FINAL_STATUSES: HearingStatus[] = ["failed", "partial", "complete"];

export interface HearingRow {
  id: string;
  case_id: string;
  mode: HearingMode;
  status: HearingStatus;
  pause_reason: PauseReason | null;
  total_turns: number;
  attempt: number;
  error_code: string | null;
  error_message: string | null;
  next_action: string | null;
  chain_hash: string;
  audit_root: string | null;
  verdict_json: string | null;
  human_decision: string | null;
  human_decided_at: number | null;
  worker_id: string | null;
  heartbeat_at: number | null;
  /** 1 while a reviewer pause waits for the active step to finish and be saved. */
  pause_requested: number;
  /** sha256 of the creator's control token; null for hearings created before access control. */
  control_token_hash: string | null;
  created_at: number;
  updated_at: number;
}

export type StoredTurn = Turn & { seq: number; hash: string };

export interface HearingError {
  code: string;
  message: string;
  nextAction: string | null;
}

/** What the API returns to the browser. */
export interface HearingView {
  id: string;
  caseId: string;
  mode: HearingMode;
  status: HearingStatus;
  pauseReason: PauseReason | null;
  /** A reviewer asked to pause; the active step is finishing and will be saved first. */
  pauseRequested: boolean;
  /** False for hearings created before control tokens existed: nobody can control them; view only. */
  controllable: boolean;
  totalTurns: number;
  turnCount: number;
  attempt: number;
  error: HearingError | null;
  auditRoot: string | null;
  verdict: Verdict | null;
  humanDecision: Verdict["decision"] | null;
  /** Only true when the hearing is complete. Partial hearings can never be ruled on. */
  canRule: boolean;
  updatedAt: number;
  turns: StoredTurn[];
}
