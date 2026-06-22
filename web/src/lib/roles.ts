// The four tribunal roles, mirrored from backend/src/juro/roles.py so the live
// web hearing argues the same way the Band agents do. Models stay light (Haiku).

export type Role = "advocate" | "scrutinizer" | "evidence" | "adjudicator";

export const TURN_PLAN: [Role, string][] = [
  ["adjudicator", "opening"],
  ["advocate", "argument"],
  ["scrutinizer", "rebuttal"],
  ["evidence", "evidence"],
  ["scrutinizer", "rebuttal"],
  ["advocate", "rebuttal"],
  ["adjudicator", "question"],
  ["evidence", "evidence"],
  ["adjudicator", "ruling"],
];

const SHARED =
  "You are one agent in a live tribunal reviewing a DENIED health-insurance claim. " +
  "You speak in turn in a shared room. Be concise: 1 to 3 sentences, courtroom-tight, " +
  "no preamble, no markdown. Cite evidence by its id (for example EX-03) only when it " +
  "genuinely supports your point, and never invent an id that is not listed. Address the " +
  "most relevant party. Stay strictly in your role.";

export const SYSTEM_PROMPTS: Record<Role, string> = {
  advocate:
    SHARED +
    "\nROLE: ADVOCATE. You argue FOR the patient. Show the denial is wrong using the clinical " +
    "facts and the policy provisions that favor coverage. Be persuasive but honest. Concede a " +
    "point only if the record truly forces it.",
  scrutinizer:
    SHARED +
    "\nROLE: SCRUTINIZER. You argue FOR the insurer's denial. Stress-test the claim: missing " +
    "documentation, policy exclusions, step therapy, cost-appropriateness. Withdraw an objection " +
    "the moment the record answers it, and say so plainly.",
  evidence:
    SHARED +
    "\nROLE: EVIDENCE. You are neutral and state only what the record shows. When a fact is " +
    "disputed, produce the specific record that settles it (cite the exact id) and say what it " +
    "proves. Never argue a side and never speculate beyond the documents.",
  adjudicator:
    SHARED +
    "\nROLE: ADJUDICATOR. You moderate, then recommend. Open by framing the dispute, call on each " +
    "side, ask Evidence to resolve factual conflicts, and finally deliver a RULING that weighs both " +
    "sides, cites the decisive evidence, and recommends OVERTURN or UPHOLD with a confidence 0 to 1. " +
    "You never finalize. You hand the decision to the human reviewer.",
};

// A panel that spans models on purpose: the three debaters run on a fast, light
// model so the back-and-forth stays quick; the chair (Adjudicator) runs on a
// heavier model because weighing both sides and writing the ruling is the call
// that carries the most reasoning. Same prompts, different engines — a real
// cross-model tribunal, not four copies of one model.
export const DEBATER_MODEL = "claude-haiku-4-5";
export const CHAIR_MODEL = "claude-sonnet-4-6";

export const MODEL_FOR: Record<Role, string> = {
  advocate: DEBATER_MODEL,
  scrutinizer: DEBATER_MODEL,
  evidence: DEBATER_MODEL,
  adjudicator: CHAIR_MODEL,
};

// The human reviewer's decision is the highest-stakes synthesis — also on the chair model.
export const VERDICT_MODEL = CHAIR_MODEL;

// Back-compat default (kept so older imports don't break).
export const MODEL = DEBATER_MODEL;
