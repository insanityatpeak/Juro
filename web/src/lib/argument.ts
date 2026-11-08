// Structured arguments for live hearings. The model returns fields (claim, evidence ids, rule,
// what is missing, a direct answer to the other side); code validates them and composes the
// plain `text` that is stored, hashed and replayed. The transcript shape does not change.
//
// Code can check that a reference EXISTS and that required fields are present. It cannot check
// that a cited record actually supports the claim: that is what the Evidence role's
// supported / contradicted / not-established classification is for, and a human still reviews.

import type { Faction, TurnType } from "./types";
import type { Role } from "./roles";

/** Longest stored turn text. Field caps below keep every composed turn under this. */
export const MAX_TURN_TEXT = 1800;

export type Stance = "accept" | "dispute" | "partly";
export type FindingStatus = "supported" | "contradicted" | "not_established";
export type Recommendation = "OVERTURN" | "UPHOLD" | "REMAND";

export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgumentError";
  }
}

export interface ParsedTurn {
  text: string;
  addressedTo: Faction | null;
  evidenceRefs: string[];
  recommendation?: Recommendation;
}

const VALID_ADDRESSES = new Set<Faction>(["advocate", "scrutinizer", "evidence", "adjudicator", "human"]);
const STANCES = new Set<Stance>(["accept", "dispute", "partly"]);
const STATUSES = new Set<FindingStatus>(["supported", "contradicted", "not_established"]);
const RECOMMENDATIONS = new Set<Recommendation>(["OVERTURN", "UPHOLD", "REMAND"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Trim and cap a field at a word boundary, so a long answer is shortened rather than rejected. */
export function clip(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, "")}…`;
}

const NONE = /^(none|n\/a|nothing|no|null|nil|-+)\.?$/i;
/** Optional fields: "none" and friends mean empty. */
const optional = (v: unknown, max: number) => {
  const s = clip(v, max);
  return NONE.test(s) ? "" : s;
};
const required = (v: unknown, max: number, field: string) => {
  const s = clip(v, max);
  if (!s || NONE.test(s)) throw new ArgumentError(`"${field}" is required.`);
  return s;
};

/** Every reference must be a listed id. A bad one rejects the turn (it is retried), never silently dropped. */
function refs(v: unknown, valid: string[], field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ArgumentError(`"${field}" must be a list of evidence ids.`);
  const out: string[] = [];
  for (const r of v) {
    if (typeof r !== "string" || !valid.includes(r)) {
      throw new ArgumentError(`"${field}" cites ${JSON.stringify(r)}, which is not on the record.`);
    }
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

const cite = (ids: string[]) => (ids.length ? ` [${ids.join(", ")}]` : "");
const addressee = (v: unknown): Faction | null => (VALID_ADDRESSES.has(v as Faction) ? (v as Faction) : null);

function parseDebater(d: Obj, kind: TurnType, valid: string[]): ParsedTurn {
  const claim = required(d.claim, 280, "claim");
  const evidenceRefs = refs(d.evidenceRefs, valid, "evidenceRefs");
  const rule = optional(d.rule, 200);
  const missing = optional(d.missing, 200);
  // A factual claim needs a record behind it, or an honest statement that the record lacks it.
  if (!evidenceRefs.length && !missing) {
    throw new ArgumentError("A claim must cite at least one evidence id, or say in \"missing\" what the record lacks.");
  }
  const parts: string[] = [];
  if (kind === "rebuttal") {
    const r = d.response;
    if (!isObj(r)) throw new ArgumentError('A rebuttal needs a "response" answering the other side.');
    const stance = typeof r.stance === "string" ? r.stance.toLowerCase() : "";
    if (!STANCES.has(stance as Stance)) throw new ArgumentError('"response.stance" must be accept, dispute or partly.');
    const point = required(r.strongestPoint, 200, "response.strongestPoint");
    const why = required(r.why, 200, "response.why");
    const verb = stance === "accept" ? "I accept" : stance === "partly" ? "I accept in part" : "I dispute";
    parts.push(`Their strongest point: ${point} ${verb}: ${why}`);
  }
  parts.push(`${claim}${cite(evidenceRefs)}`);
  if (rule) parts.push(`Rule: ${rule}`);
  if (missing) parts.push(`Not in the record: ${missing}`);
  return { text: parts.join(" "), addressedTo: addressee(d.addressedTo), evidenceRefs };
}

const STATUS_LABEL: Record<FindingStatus, string> = {
  supported: "Supported",
  contradicted: "Contradicted",
  not_established: "Not established",
};

function parseEvidence(d: Obj, valid: string[]): ParsedTurn {
  if (!Array.isArray(d.findings) || d.findings.length < 1 || d.findings.length > 4) {
    throw new ArgumentError('"findings" must list 1 to 4 disputed claims.');
  }
  const all: string[] = [];
  const parts: string[] = [];
  for (const f of d.findings) {
    if (!isObj(f)) throw new ArgumentError("Each finding must be an object.");
    const status = typeof f.status === "string" ? f.status.toLowerCase() : "";
    if (!STATUSES.has(status as FindingStatus)) throw new ArgumentError('"status" must be supported, contradicted or not_established.');
    const claim = required(f.claim, 220, "findings.claim");
    const ids = refs(f.evidenceRefs, valid, "findings.evidenceRefs");
    // Never mark a claim settled without naming the record that settles it.
    if (status !== "not_established" && !ids.length) {
      throw new ArgumentError("A supported or contradicted finding must cite the record that settles it.");
    }
    for (const id of ids) if (!all.includes(id)) all.push(id);
    parts.push(`${STATUS_LABEL[status as FindingStatus]}: ${claim}${cite(ids)}.`);
  }
  const missing = optional(d.missing, 220);
  if (missing) parts.push(`Missing from the record: ${missing}`);
  return { text: parts.join(" "), addressedTo: addressee(d.addressedTo), evidenceRefs: all };
}

function parseRuling(d: Obj, valid: string[]): ParsedTurn {
  const rec = typeof d.recommendation === "string" ? d.recommendation.toUpperCase() : "";
  if (!RECOMMENDATIONS.has(rec as Recommendation)) throw new ArgumentError('"recommendation" must be OVERTURN, UPHOLD or REMAND.');
  const recommendation = rec as Recommendation;
  const decisive = required(d.decisiveIssue, 220, "decisiveIssue");
  const rule = required(d.rule, 200, "rule");
  const evidenceRefs = refs(d.evidenceRefs, valid, "evidenceRefs");
  if (!evidenceRefs.length && recommendation !== "REMAND") {
    throw new ArgumentError("A ruling to overturn or uphold must cite the evidence it rests on.");
  }
  const opposing = required(d.strongestOpposing, 220, "strongestOpposing");
  const effect = required(d.effectOnOutcome, 220, "effectOnOutcome");
  const uncertainty = optional(d.uncertainty, 220);
  const needed = optional(d.evidenceNeeded, 220);
  // A remand that does not say what would resolve the uncertainty is just a refusal to decide.
  if (recommendation === "REMAND" && !needed) {
    throw new ArgumentError('A REMAND must say in "evidenceNeeded" what record would resolve the uncertainty.');
  }
  const parts = [
    `Decisive issue: ${decisive} Rule: ${rule}`,
    `Resting on${cite(evidenceRefs) || " the absence of a decisive record"}.`,
    `Strongest opposing argument: ${opposing} ${effect}`,
  ];
  if (uncertainty) parts.push(`Remaining uncertainty: ${uncertainty}`);
  if (needed) parts.push(`Needed to resolve it: ${needed}`);
  parts.push(`Recommendation: ${recommendation}.`);
  return { text: parts.join(" "), addressedTo: "human", evidenceRefs, recommendation };
}

function parseChair(d: Obj, valid: string[]): ParsedTurn {
  const text = required(d.text, 500, "text");
  return { text, addressedTo: addressee(d.addressedTo), evidenceRefs: refs(d.evidenceRefs, valid, "evidenceRefs") };
}

/** Parse and validate one live turn's JSON. Throws ArgumentError with a reason the caller can retry on. */
export function parseTurnJson(role: Role, kind: TurnType, data: Obj, validIds: string[]): ParsedTurn {
  let out: ParsedTurn;
  if (role === "advocate" || role === "scrutinizer") out = parseDebater(data, kind, validIds);
  else if (role === "evidence") out = parseEvidence(data, validIds);
  else if (kind === "ruling") out = parseRuling(data, validIds);
  else out = parseChair(data, validIds);
  if (out.text.length > MAX_TURN_TEXT) throw new ArgumentError("The turn is too long.");
  return out;
}

/** The JSON shape to ask for, per role and turn type. */
export function turnFormat(role: Role, kind: TurnType, validIds: string[]): string {
  const ids = `Valid evidence ids: ${validIds.join(", ")}. Cite only these.`;
  const addr = '"addressedTo":"advocate|scrutinizer|evidence|adjudicator|human|null"';
  if (role === "advocate" || role === "scrutinizer") {
    const resp =
      kind === "rebuttal"
        ? '"response":{"strongestPoint":"<the other side\'s strongest point, in your words>","stance":"accept|dispute|partly","why":"<why>"},'
        : "";
    return (
      `${ids}\nRespond ONLY with compact JSON: {${resp}"claim":"<one specific claim, one or two sentences>",` +
      '"evidenceRefs":["EX-.."],"rule":"<policy or statute provision relied on, or empty>",' +
      `"missing":"<what the record lacks that matters, or empty>",${addr}}\n` +
      'Facts come from the record. If a point rests on a document that is not listed, put it in "missing", not in "claim".' +
      (kind === "rebuttal" ? " Answer the other side directly; do not give a parallel speech." : "")
    );
  }
  if (role === "evidence") {
    return (
      `${ids}\nRespond ONLY with compact JSON: {"findings":[{"claim":"<a disputed claim>",` +
      '"status":"supported|contradicted|not_established","evidenceRefs":["EX-.."]}],' +
      `"missing":"<documents that would settle open points but are not on the record, or empty>",${addr}}\n` +
      "Check claims from BOTH sides (1 to 4 findings). supported/contradicted require the id that settles it. " +
      "If the record does not settle a claim, mark it not_established; never invent a fact."
    );
  }
  if (kind === "ruling") {
    return (
      `${ids}\nRespond ONLY with compact JSON: {"decisiveIssue":"<the issue the outcome turns on>",` +
      '"rule":"<the applicable policy or statute provision>","evidenceRefs":["EX-.."],' +
      '"strongestOpposing":"<the strongest argument against your recommendation>",' +
      '"effectOnOutcome":"<why it does or does not change the outcome>",' +
      '"uncertainty":"<what remains uncertain, or empty>","recommendation":"OVERTURN|UPHOLD|REMAND",' +
      '"evidenceNeeded":"<required for REMAND: the specific record that would resolve it; else empty>"}\n' +
      "Choose REMAND when the record cannot settle the decisive issue; do not force OVERTURN or UPHOLD."
    );
  }
  return `${ids}\nRespond ONLY with compact JSON: {"text":"<1-3 sentences>",${addr}}`;
}
