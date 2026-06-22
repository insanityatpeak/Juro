// Core data model for Juro — the adversarial claims tribunal.
// The Python/Band backend emits this exact shape; the UI plays it back.

export type Faction =
  | "advocate" // argues FOR the patient — overturn the denial (teal rail)
  | "scrutinizer" // argues AGAINST — uphold the denial (brass rail)
  | "evidence" // supplies grounded records & citations (neutral)
  | "adjudicator" // chairs: frames the question, weighs, recommends
  | "human"; // the licensed reviewer who delivers the final verdict

export type Side = "for" | "against" | "neutral" | "chair" | "human";

export type TurnType =
  | "opening"
  | "argument"
  | "rebuttal"
  | "evidence"
  | "question"
  | "ruling"
  | "verdict";

export type EvidenceKind = "clinical" | "policy" | "statute" | "record" | "eob";

export interface EvidenceItem {
  id: string; // e.g. "EX-03" or "STAT-1"
  label: string;
  kind: EvidenceKind;
  cite: string; // "29 C.F.R. § 2560.503-1" or "Chart 2026-06-02"
  detail?: string;
  /** For statutes: the right it grants, in plain language. */
  authority?: string;
}

export interface Turn {
  id: string;
  agent: Faction;
  type: TurnType;
  text: string;
  addressedTo?: Faction;
  evidenceRefs?: string[];
  durationMs: number;
  hash?: string;
}

export interface CaseFile {
  claimId: string;
  patient: string;
  procedure: string;
  denialReason: string;
  denialCode?: string;
  amount: string;
  insurer: string;
  planType: string; // e.g. "Employer / ERISA" — drives which appeal rights apply
}

export interface Verdict {
  decision: "OVERTURNED" | "UPHELD" | "REMANDED";
  rationale: string;
  by: string;
  confidence?: number;
}

export interface Transcript {
  case: CaseFile;
  evidence: EvidenceItem[];
  turns: Turn[];
  verdict: Verdict;
  /** Generated, editable appeal letter grounded in the cited statutes. */
  appealLetter?: string;
  auditRoot?: string;
}

/** A selectable case for the Chamber picker + landing showcase. */
export interface CaseEntry {
  id: string;
  title: string; // short label for the card
  tag: string; // e.g. "Imaging · ERISA"
  blurb: string; // 1–2 plain sentences on the situation and stakes
  stake: string; // the human stake, one line
  transcript: Transcript;
}

export const FACTION_META: Record<
  Faction,
  { label: string; role: string; side: Side; accent: string; voice: string }
> = {
  advocate: {
    label: "Advocate",
    role: "Argues to overturn the denial",
    side: "for",
    accent: "var(--for)",
    voice: "aura-2-thalia-en",
  },
  scrutinizer: {
    label: "Scrutinizer",
    role: "Argues to uphold the denial",
    side: "against",
    accent: "var(--against)",
    voice: "aura-2-apollo-en",
  },
  evidence: {
    label: "Evidence",
    role: "Supplies records & citations",
    side: "neutral",
    accent: "var(--muted)",
    voice: "aura-2-cora-en",
  },
  adjudicator: {
    label: "Adjudicator",
    role: "Chairs and recommends",
    side: "chair",
    accent: "var(--blue)",
    voice: "aura-2-jupiter-en",
  },
  human: {
    label: "Reviewer",
    role: "Delivers the binding verdict",
    side: "human",
    accent: "var(--fg)",
    voice: "aura-2-hera-en",
  },
};
