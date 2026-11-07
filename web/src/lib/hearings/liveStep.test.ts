import assert from "node:assert/strict";
import { test } from "node:test";
import { CASES } from "../../data/cases";
import { parseLiveStep, runLiveStep, stepErrorResponse } from "../liveStep";
import { TURN_PLAN } from "../roles";
import { SourceError, type TurnSource } from "./source";

const planTurns = (n: number) =>
  TURN_PLAN.slice(0, n).map(([agent, type], i) => ({ agent, type, text: `turn ${i + 1}`, evidenceRefs: [], addressedTo: null }));

const fakeSource = (): TurnSource & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    mode: "live",
    totalTurns: () => TURN_PLAN.length,
    async generateTurn({ seq }) {
      calls.push(`turn:${seq}`);
      const [agent, type] = TURN_PLAN[seq - 1];
      return { agent, type: type as never, text: `turn ${seq}`, addressedTo: null, evidenceRefs: [], durationMs: 4000 };
    },
    async generateVerdict() {
      calls.push("verdict");
      return { decision: "UPHELD", rationale: "r", by: "AI recommendation" };
    },
  };
};

test("a live step only accepts a transcript that follows the fixed plan", () => {
  assert.equal(parseLiveStep({ caseId: "nope", turns: [] }), "unknown_case");
  assert.equal(parseLiveStep({ caseId: CASES[0].id, turns: "x" }), "invalid_turns");
  assert.equal(parseLiveStep({ caseId: CASES[0].id, turns: [...planTurns(TURN_PLAN.length), planTurns(1)[0]] }), "too_many_turns");
  const swapped = planTurns(2);
  swapped[1].agent = "scrutinizer" as never;
  assert.equal(parseLiveStep({ caseId: CASES[0].id, turns: swapped }), "out_of_order");
  const long = planTurns(1);
  long[0].text = "x".repeat(801);
  assert.equal(parseLiveStep({ caseId: CASES[0].id, turns: long }), "invalid_text");
  const ok = parseLiveStep({ caseId: CASES[0].id, turns: [{ ...planTurns(1)[0], evidenceRefs: ["EX-01", "FAKE"] }] });
  assert.ok(typeof ok !== "string");
  assert.deepEqual(ok.turns[0].evidenceRefs, ["EX-01"]); // unknown ids dropped
  assert.equal(ok.entry.id, CASES[0].id); // case data comes from the bundled cases, not the client
});

test("each step makes exactly one call: the next turn, then the recommendation", async () => {
  const src = fakeSource();
  const r1 = await runLiveStep(src, parseLiveStep({ caseId: CASES[0].id, turns: planTurns(3) }) as never);
  assert.equal(r1.kind, "turn");
  assert.equal(r1.kind === "turn" && r1.turn.id, "t4");
  const r2 = await runLiveStep(src, parseLiveStep({ caseId: CASES[0].id, turns: planTurns(TURN_PLAN.length) }) as never);
  assert.equal(r2.kind, "verdict");
  assert.deepEqual(src.calls, ["turn:4", "verdict"]);
});

test("step errors tell the browser whether to pause, retry or stop", () => {
  assert.deepEqual(
    [
      stepErrorResponse(new SourceError("pause", "quota_exhausted", "q")).status,
      stepErrorResponse(new SourceError("transient", "rate_limited", "r")).status,
      stepErrorResponse(new SourceError("transient", "timeout", "t")).status,
      stepErrorResponse(new SourceError("permanent", "provider_disabled", "d")).status,
      stepErrorResponse(new SourceError("permanent", "auth_failed", "a")).status,
    ],
    [429, 429, 502, 503, 500],
  );
  assert.equal(stepErrorResponse(new SourceError("pause", "quota_exhausted", "q")).body.kind, "pause");
});
