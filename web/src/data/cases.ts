import type { CaseEntry, EvidenceItem, Turn, Verdict } from "@/lib/types";
import data from "./cases.generated.json";

// The bundled synthetic cases. Edit data/cases.json at the repo root, then run
// `python scripts/sync_cases.py`; cases.generated.json (this file's source) and the
// backend's copy are generated from it so the two halves never drift.
//
// The sample turns, recommendation and appeal letter are pre-written. The recommendation is
// labelled as a sample and carries no reviewer name, confidence or audit root.

type Raw = (typeof data)["cases"][number];

const SAMPLE_BY = "Sample recommendation (pre-written)";

function toEntry(c: Raw): CaseEntry {
  const verdict: Verdict = {
    decision: c.sample.recommendation.decision as Verdict["decision"],
    rationale: c.sample.recommendation.rationale,
    by: SAMPLE_BY,
  };
  return {
    id: c.id,
    title: c.title,
    tag: c.tag,
    blurb: c.blurb,
    stake: c.stake,
    transcript: {
      case: c.case,
      evidence: c.evidence as EvidenceItem[],
      turns: c.sample.turns as Turn[],
      verdict,
      appealLetter: c.sample.appealLetter,
    },
  };
}

export const CASES: CaseEntry[] = data.cases.map(toEntry);
