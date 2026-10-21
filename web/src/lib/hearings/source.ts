import { MODEL_FOR, SYSTEM_PROMPTS, TURN_PLAN, VERDICT_MODEL } from "../roles";
import type { CaseEntry, Faction, TurnType, Verdict } from "../types";
import type { HearingMode, StoredTurn } from "./types";

/** transient = worth retrying; permanent = retrying the same request will not help. */
export class SourceError extends Error {
  constructor(
    public kind: "transient" | "permanent",
    public code: string,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

export interface GeneratedTurn {
  agent: Faction;
  type: TurnType;
  text: string;
  addressedTo: Faction | null;
  evidenceRefs: string[];
  durationMs: number;
}

export interface TurnContext {
  entry: CaseEntry;
  seq: number; // 1-based position of the turn being generated
  turns: StoredTurn[]; // the turns already on the record
}

/** Where turns come from. The runner only talks to this, so tests can swap in a flaky one. */
export interface TurnSource {
  mode: HearingMode;
  totalTurns(entry: CaseEntry): number;
  generateTurn(ctx: TurnContext): Promise<GeneratedTurn>;
  generateVerdict(entry: CaseEntry, turns: StoredTurn[]): Promise<Verdict>;
}

const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const CALL_TIMEOUT_MS = 20000;
const VALID_ADDRESSES = new Set<Faction>(["advocate", "scrutinizer", "evidence", "adjudicator", "human"]);
const estDur = (t: string) => Math.max(3500, Math.min(8000, t.length * 45));

function brief(entry: CaseEntry): string {
  const c = entry.transcript.case;
  const ev = entry.transcript.evidence
    .map((e) => `  ${e.id} [${e.kind}] ${e.label}: ${e.detail || e.authority || ""} (cite ${e.cite})`)
    .join("\n");
  return (
    `CLAIM ${c.claimId} — ${c.patient}\n` +
    `Procedure: ${c.procedure} (${c.amount})\n` +
    `Insurer: ${c.insurer}\nPlan: ${c.planType}\n` +
    `DENIAL: ${c.denialReason}\n\nEVIDENCE ON THE RECORD:\n${ev}`
  );
}

const soFar = (turns: StoredTurn[]) =>
  turns.length ? turns.map((t) => `${t.agent.toUpperCase()}: ${t.text}`).join("\n") : "(the floor is open)";

function parseJson(raw: string): Record<string, unknown> {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) throw new SourceError("transient", "bad_output", "The model did not return JSON.");
  try {
    return JSON.parse(raw.slice(s, e + 1));
  } catch {
    throw new SourceError("transient", "bad_output", "The model returned malformed JSON.");
  }
}

async function errorDetail(r: Response): Promise<string> {
  try {
    const d = (await r.json()) as { error?: { message?: string } };
    return d?.error?.message ? ` (${String(d.error.message).slice(0, 160)})` : "";
  } catch {
    return "";
  }
}

async function ask(model: string, system: string, user: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new SourceError("permanent", "auth_failed", "ANTHROPIC_API_KEY is not set on the server.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(ANTHROPIC, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 400, system, messages: [{ role: "user", content: user }] }),
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new SourceError("transient", "timeout", `The AI provider did not answer within ${CALL_TIMEOUT_MS / 1000}s.`);
    }
    throw new SourceError("transient", "network", "Could not reach the AI provider.");
  } finally {
    clearTimeout(timer);
  }

  if (!r.ok) {
    const detail = await errorDetail(r);
    if (r.status === 429) {
      const ra = Number(r.headers.get("retry-after"));
      throw new SourceError("transient", "rate_limited", "The AI provider is rate limiting requests.", Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
    }
    if (r.status === 401 || r.status === 403) {
      throw new SourceError("permanent", "auth_failed", `The AI provider rejected the API key (HTTP ${r.status}).${detail}`);
    }
    if (r.status === 408 || r.status === 409 || r.status >= 500) {
      throw new SourceError("transient", "upstream_error", `The AI provider had a temporary error (HTTP ${r.status}).`);
    }
    throw new SourceError("permanent", "request_rejected", `The AI provider rejected the request (HTTP ${r.status}).${detail}`);
  }
  const d = (await r.json()) as { content?: { type: string; text?: string }[] };
  return (d.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
}

export const liveSource: TurnSource = {
  mode: "live",
  totalTurns: () => TURN_PLAN.length,

  async generateTurn({ entry, seq, turns }) {
    const [role, kind] = TURN_PLAN[seq - 1];
    const validIds = entry.transcript.evidence.map((e) => e.id);
    const user =
      `${brief(entry)}\n\nDEBATE SO FAR:\n${soFar(turns)}\n\n` +
      `It is your turn (${role}, ${kind}). Valid evidence ids: ${validIds.join(", ")}.\n` +
      'Respond ONLY with compact JSON: {"text":"<1-3 sentences>",' +
      '"addressedTo":"<advocate|scrutinizer|evidence|adjudicator|human|null>",' +
      '"evidenceRefs":["EX-..",...]}';
    const data = parseJson(await ask(MODEL_FOR[role], SYSTEM_PROMPTS[role], user));
    const text = String(data.text || "").trim();
    if (!text) throw new SourceError("transient", "bad_output", "The model returned an empty turn.");
    const refs = (Array.isArray(data.evidenceRefs) ? data.evidenceRefs : []).filter((r): r is string => validIds.includes(r as string));
    const addressedTo = VALID_ADDRESSES.has(data.addressedTo as Faction) ? (data.addressedTo as Faction) : null;
    return { agent: role, type: kind as TurnType, text, addressedTo, evidenceRefs: refs, durationMs: estDur(text) };
  },

  async generateVerdict(entry, turns) {
    const user =
      `${brief(entry)}\n\nFULL DEBATE:\n${soFar(turns)}\n\n` +
      "You are the human medical reviewer delivering the FINAL verdict. " +
      'Respond ONLY with JSON: {"decision":"OVERTURNED|UPHELD","rationale":"<1-2 sentences>","confidence":<0..1>}';
    const vd = parseJson(
      await ask(VERDICT_MODEL, "You weigh both sides fairly and decide. Patients deserve a defense; insurers deserve rigor.", user),
    );
    const decision = vd.decision === "OVERTURNED" || vd.decision === "UPHELD" ? vd.decision : "OVERTURNED";
    const conf = Number(vd.confidence);
    return {
      decision,
      rationale: String(vd.rationale || ""),
      by: entry.transcript.verdict.by,
      confidence: Number.isFinite(conf) ? conf : 0.85,
    };
  },
};

/** No API key needed: replays the bundled case through the same background pipeline. */
export const sampleSource: TurnSource = {
  mode: "sample",
  totalTurns: (entry) => entry.transcript.turns.length,

  async generateTurn({ entry, seq }) {
    const delay = Number(process.env.HEARING_SAMPLE_DELAY_MS ?? 1500);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const t = entry.transcript.turns[seq - 1];
    return {
      agent: t.agent,
      type: t.type,
      text: t.text,
      addressedTo: t.addressedTo ?? null,
      evidenceRefs: t.evidenceRefs ?? [],
      durationMs: t.durationMs,
    };
  },

  async generateVerdict(entry) {
    return entry.transcript.verdict;
  },
};

export function pickMode(): HearingMode {
  if (process.env.HEARING_MODE === "sample") return "sample";
  return process.env.ANTHROPIC_API_KEY ? "live" : "sample";
}

export const getSource = (mode: HearingMode): TurnSource => (mode === "live" ? liveSource : sampleSource);
