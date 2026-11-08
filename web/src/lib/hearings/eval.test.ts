import assert from "node:assert/strict";
import { test } from "node:test";
import { EVAL_SCENARIOS, reorder, runEval, runHearing } from "./eval";
import { createLiveSource } from "./source";

/**
 * A stand-in model that reads the brief the way a careful panel should: it only reaches for a
 * decision the record supports. It tests the harness and the structured pipeline, NOT any real
 * model's reasoning; that needs the capped live run (scripts/eval-live.ts).
 */
function fakeAsk(opts: { orderBias?: boolean } = {}) {
  return async (_model: string, system: string, user: string): Promise<string> => {
    const role = /ROLE: (\w+)/.exec(system)?.[1]?.toLowerCase() ?? "";
    const long = /for 8 weeks/.test(user);
    const short = /for 2 weeks/.test(user);
    const first = /^\s+((?:POL|CH|PT)-\d) \[/m.exec(user)?.[1] ?? "POL-1";
    if (!role) {
      const decision = long && short ? "REMANDED" : long ? "OVERTURNED" : short ? "UPHELD" : "REMANDED";
      // Optional defect to prove the harness notices order effects: decide by whatever is listed first.
      const biased = opts.orderBias ? (first.startsWith("PT") ? "UPHELD" : "OVERTURNED") : decision;
      return JSON.stringify({ decision: biased, rationale: "Weighed against the record.", evidenceNeeded: biased === "REMANDED" ? "The therapy record." : "" });
    }
    if (role === "adjudicator" && /\(adjudicator, ruling\)/.test(user)) {
      const rec = long && short ? "REMAND" : long ? "OVERTURN" : short ? "UPHOLD" : "REMAND";
      return JSON.stringify({
        decisiveIssue: "Whether six weeks of therapy were completed.",
        rule: "Plan §7.3",
        evidenceRefs: rec === "REMAND" ? [] : ["POL-1"],
        strongestOpposing: "The therapy requirement.",
        effectOnOutcome: "The record decides it.",
        uncertainty: "",
        recommendation: rec,
        evidenceNeeded: rec === "REMAND" ? "The therapy record." : "",
      });
    }
    if (role === "adjudicator") return JSON.stringify({ text: "Is the therapy requirement met?", addressedTo: "evidence" });
    if (role === "evidence") {
      return JSON.stringify({ findings: [{ claim: "The policy sets a 6-week requirement.", status: "supported", evidenceRefs: ["POL-1"] }], missing: "" });
    }
    const rebuttal = /\((?:advocate|scrutinizer), rebuttal\)/.test(user);
    return JSON.stringify({
      ...(rebuttal ? { response: { strongestPoint: "The other side's main point.", stance: "partly", why: "It depends on the therapy record." } } : {}),
      claim: "The policy turns on documented therapy.",
      evidenceRefs: ["POL-1"],
    });
  };
}

test("a whole hearing runs through the structured pipeline to a recommendation", async () => {
  const out = await runHearing(createLiveSource(fakeAsk()), EVAL_SCENARIOS[0].entry);
  assert.equal(out.turns.length, 10);
  assert.equal(out.verdict.decision, "OVERTURNED");
  assert.match(out.turns[9].text, /Recommendation: OVERTURN\.$/);
});

test("the evaluation set covers a flipped fact, a missing record and contradictory records", async () => {
  const report = await runEval(createLiveSource(fakeAsk()));
  const by = Object.fromEntries(report.results.map((r) => [r.id, r.decision]));
  assert.deepEqual(by, {
    "therapy-met": "OVERTURNED",
    "therapy-short": "UPHELD",
    "therapy-missing": "REMANDED",
    "therapy-conflict": "REMANDED",
  });
  assert.equal(report.accuracy, 1);
  assert.equal(report.orderStability, 1);
  assert.equal(report.flipRespected, true);
});

test("reordering changes only the order of the evidence", () => {
  const e = EVAL_SCENARIOS[2].entry;
  const r = reorder(e);
  assert.deepEqual(r.transcript.evidence.map((x) => x.id), [...e.transcript.evidence.map((x) => x.id)].reverse());
  assert.deepEqual(r.transcript.case, e.transcript.case);
});

test("the harness flags a model that is swayed by evidence order or ignores the decisive fact", async () => {
  const report = await runEval(createLiveSource(fakeAsk({ orderBias: true })));
  assert.ok(report.orderStability < 1);
  assert.ok(report.accuracy < 1);
});
