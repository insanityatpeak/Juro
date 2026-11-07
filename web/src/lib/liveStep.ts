import { CASES } from "../data/cases";
import { TURN_PLAN } from "./roles";
import type { CaseEntry, Faction, Turn, Verdict } from "./types";
import { SourceError, type TurnSource } from "./hearings/source";

/**
 * Stateless live-hearing step, safe for serverless hosts: the browser holds the transcript and
 * sends it back each step; the server checks it against the fixed turn plan, runs ONE model call
 * for the next step, and returns the result. No database, no background worker.
 *
 * The client-held transcript is untrusted: it can only steer the next turn of the client's own
 * hearing. The case and evidence always come from the bundled synthetic cases, never the client.
 */
const MAX_TEXT = 800;
const VALID_ADDRESSES = new Set<Faction>(["advocate", "scrutinizer", "evidence", "adjudicator", "human"]);

export type LiveStepRequest = { entry: CaseEntry; turns: Pick<Turn, "agent" | "type" | "text" | "addressedTo" | "evidenceRefs">[] };

export type LiveStepResult =
  | { kind: "turn"; turn: Turn }
  | { kind: "verdict"; verdict: Verdict };

/** Validate a step request. Returns a parsed request or an error string. */
export function parseLiveStep(body: Record<string, unknown>): LiveStepRequest | string {
  const entry = typeof body.caseId === "string" ? CASES.find((c) => c.id === body.caseId) : undefined;
  if (!entry) return "unknown_case";
  if (!Array.isArray(body.turns)) return "invalid_turns";
  if (body.turns.length > TURN_PLAN.length) return "too_many_turns";
  const ids = new Set(entry.transcript.evidence.map((e) => e.id));
  const turns: LiveStepRequest["turns"] = [];
  for (let i = 0; i < body.turns.length; i++) {
    const t = body.turns[i] as Record<string, unknown> | null;
    if (!t || typeof t !== "object") return "invalid_turns";
    const [role, kind] = TURN_PLAN[i];
    // The transcript must follow the fixed plan: the client cannot invent speakers or order.
    if (t.agent !== role || t.type !== kind) return "out_of_order";
    if (typeof t.text !== "string" || !t.text.trim() || t.text.length > MAX_TEXT) return "invalid_text";
    const refs = Array.isArray(t.evidenceRefs) ? t.evidenceRefs.filter((r): r is string => typeof r === "string" && ids.has(r)) : [];
    const addressedTo = VALID_ADDRESSES.has(t.addressedTo as Faction) ? (t.addressedTo as Faction) : undefined;
    turns.push({ agent: role, type: kind as Turn["type"], text: t.text.trim(), addressedTo, evidenceRefs: refs });
  }
  return { entry, turns };
}

/** Run the next step: the next turn, or the recommendation once every turn is on the record. */
export async function runLiveStep(source: TurnSource, req: LiveStepRequest): Promise<LiveStepResult> {
  const done = req.turns.length;
  if (done < TURN_PLAN.length) {
    const seq = done + 1;
    const g = await source.generateTurn({ entry: req.entry, seq, turns: req.turns });
    return {
      kind: "turn",
      turn: {
        id: `t${seq}`,
        agent: g.agent,
        type: g.type,
        text: g.text,
        addressedTo: g.addressedTo ?? undefined,
        evidenceRefs: g.evidenceRefs,
        durationMs: g.durationMs,
      },
    };
  }
  return { kind: "verdict", verdict: await source.generateVerdict(req.entry, req.turns) };
}

/** HTTP status + body for a SourceError, so the browser knows whether to retry, pause or stop. */
export function stepErrorResponse(e: unknown): { status: number; body: { error: string; kind: string; message: string; retryAfterMs?: number } } {
  const err = e instanceof SourceError ? e : new SourceError("transient", "internal_error", "Unexpected error.");
  const status = err.code === "provider_disabled" ? 503 : err.kind === "pause" || err.code === "rate_limited" ? 429 : err.kind === "transient" ? 502 : 500;
  return { status, body: { error: err.code, kind: err.kind, message: err.message, retryAfterMs: err.retryAfterMs } };
}
