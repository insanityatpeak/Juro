// A small reasoning evaluation. Tool calling working says little about whether the panel reasons
// from the record; these synthetic cases change ONE decisive fact (or remove or contradict it)
// and check that the recommendation moves with it, and that merely reordering the evidence
// does not. Synthetic data only: no real patient, physician or claim.
//
// The harness takes any TurnSource, so tests run it against a fake model and the live script
// (scripts/eval-live.ts) runs it against Groq Free only when explicitly authorized.

import { TURN_PLAN } from "../roles";
import { runLiveStep } from "../liveStep";
import type { CaseEntry, EvidenceItem, Turn, Verdict } from "../types";
import type { TurnSource } from "./source";

type Decision = Verdict["decision"];

const POLICY: EvidenceItem = {
  id: "POL-1",
  label: "Plan imaging policy",
  kind: "policy",
  cite: "Plan §7.3",
  detail: "Knee MRI is covered after at least 6 weeks of documented, supervised physical therapy that did not relieve symptoms.",
};
const CHART: EvidenceItem = {
  id: "CH-1",
  label: "Orthopedic visit note",
  kind: "clinical",
  cite: "Chart 2026-03-04",
  detail: "Persistent knee pain with locking; MRI ordered to assess a suspected meniscal tear.",
};
const PT_LONG: EvidenceItem = {
  id: "PT-1",
  label: "Physical therapy record",
  kind: "record",
  cite: "PT log Jan-Mar 2026",
  detail: "Supervised physical therapy for 8 weeks, 16 visits. Symptoms persisted and locking continued.",
};
const PT_SHORT: EvidenceItem = {
  id: "PT-1",
  label: "Physical therapy record",
  kind: "record",
  cite: "PT log Feb 2026",
  detail: "Supervised physical therapy for 2 weeks, 3 visits. Patient self-discharged; no further sessions.",
};
const PT_DISCHARGE: EvidenceItem = {
  id: "PT-2",
  label: "Physical therapy discharge summary",
  kind: "record",
  cite: "PT discharge 2026-03-01",
  detail: "Discharge summary states supervised physical therapy for 2 weeks, 3 visits.",
};

function entryWith(id: string, evidence: EvidenceItem[]): CaseEntry {
  return {
    id,
    title: "Synthetic knee MRI",
    tag: "Evaluation · synthetic",
    blurb: "Synthetic evaluation case.",
    stake: "Synthetic.",
    transcript: {
      case: {
        claimId: `EVAL-${id}`,
        patient: "Synthetic Patient",
        procedure: "Knee MRI without contrast",
        denialReason: "Conservative therapy requirement not met.",
        amount: "$1,200",
        insurer: "Synthetic Health Plan",
        planType: "Employer plan",
      },
      evidence,
      turns: [],
      verdict: { decision: "REMANDED", rationale: "", by: "" },
    },
  };
}

export interface EvalScenario {
  id: string;
  what: string;
  entry: CaseEntry;
  /** Decisions that count as correct for this case. */
  expect: Decision[];
}

export const EVAL_SCENARIOS: EvalScenario[] = [
  { id: "therapy-met", what: "Decisive fact present: 8 weeks of therapy", entry: entryWith("therapy-met", [POLICY, CHART, PT_LONG]), expect: ["OVERTURNED"] },
  { id: "therapy-short", what: "Decisive fact flipped: only 2 weeks of therapy", entry: entryWith("therapy-short", [POLICY, CHART, PT_SHORT]), expect: ["UPHELD"] },
  { id: "therapy-missing", what: "Decisive record absent: no therapy record at all", entry: entryWith("therapy-missing", [POLICY, CHART]), expect: ["REMANDED"] },
  { id: "therapy-conflict", what: "Records contradict: 8 weeks vs a 2-week discharge summary", entry: entryWith("therapy-conflict", [POLICY, CHART, PT_LONG, PT_DISCHARGE]), expect: ["REMANDED"] },
];

/** The same case with the evidence in a different order. The recommendation should not change. */
export function reorder(entry: CaseEntry, id = `${entry.id}-reordered`): CaseEntry {
  return { ...entry, id, transcript: { ...entry.transcript, evidence: [...entry.transcript.evidence].reverse() } };
}

export interface HearingOutcome {
  turns: Pick<Turn, "agent" | "type" | "text" | "addressedTo" | "evidenceRefs">[];
  verdict: Verdict;
}

/** Run one whole hearing through the same step function the live route uses. */
export async function runHearing(source: TurnSource, entry: CaseEntry): Promise<HearingOutcome> {
  const turns: HearingOutcome["turns"] = [];
  for (let guard = 0; guard <= TURN_PLAN.length + 1; guard++) {
    const r = await runLiveStep(source, { entry, turns });
    if (r.kind === "verdict") return { turns, verdict: r.verdict };
    const { agent, type, text, addressedTo, evidenceRefs } = r.turn;
    turns.push({ agent, type, text, addressedTo, evidenceRefs });
  }
  throw new Error("The hearing did not reach a recommendation.");
}

export interface ScenarioResult {
  id: string;
  decision: Decision;
  ok: boolean;
  reorderedDecision: Decision;
  orderStable: boolean;
}

export interface EvalReport {
  results: ScenarioResult[];
  /** Fraction of scenarios whose recommendation was an accepted one. */
  accuracy: number;
  /** Fraction whose recommendation did not change when the evidence was reordered. */
  orderStability: number;
  /** True when the flipped-fact case did not get the same recommendation as the original. */
  flipRespected: boolean;
}

export async function runEval(source: TurnSource, scenarios: EvalScenario[] = EVAL_SCENARIOS): Promise<EvalReport> {
  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    const a = await runHearing(source, s.entry);
    const b = await runHearing(source, reorder(s.entry));
    results.push({
      id: s.id,
      decision: a.verdict.decision,
      ok: s.expect.includes(a.verdict.decision),
      reorderedDecision: b.verdict.decision,
      orderStable: a.verdict.decision === b.verdict.decision,
    });
  }
  const by = new Map(results.map((r) => [r.id, r]));
  const met = by.get("therapy-met");
  const short = by.get("therapy-short");
  return {
    results,
    accuracy: results.filter((r) => r.ok).length / Math.max(1, results.length),
    orderStability: results.filter((r) => r.orderStable).length / Math.max(1, results.length),
    flipRespected: !met || !short ? true : met.decision !== short.decision,
  };
}
