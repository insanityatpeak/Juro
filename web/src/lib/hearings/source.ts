import { groqBaseUrl, liveModels, LIVE_PROVIDER_LABEL } from "../live";
import { ArgumentError, clip, parseTurnJson, turnFormat } from "../argument";
import { providerPolicy, type ProviderPolicy } from "../providers";
import { SYSTEM_PROMPTS, TURN_PLAN, type Role } from "../roles";
import type { CaseEntry, Faction, TurnType, Verdict } from "../types";
import type { HearingMode, StoredTurn } from "./types";

/**
 * transient = worth retrying; permanent = retrying the same request will not help;
 * pause = stop now and let the reviewer resume later (e.g. the free-tier quota is used up).
 */
export class SourceError extends Error {
  constructor(
    public kind: "transient" | "permanent" | "pause",
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

/** A turn already on the record, as the generator needs it. */
export type PriorTurn = Pick<StoredTurn, "agent" | "text">;

export interface TurnContext {
  entry: CaseEntry;
  seq: number; // 1-based position of the turn being generated
  turns: PriorTurn[]; // the turns already on the record
}

/** Where turns come from. The runner only talks to this, so tests can swap in a flaky one. */
export interface TurnSource {
  mode: HearingMode;
  totalTurns(entry: CaseEntry): number;
  generateTurn(ctx: TurnContext): Promise<GeneratedTurn>;
  generateVerdict(entry: CaseEntry, turns: PriorTurn[]): Promise<Verdict>;
}

const CALL_TIMEOUT_MS = 25000;
export const estDur = (t: string) => Math.max(3500, Math.min(8000, t.length * 45));

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

const soFar = (turns: PriorTurn[]) =>
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

export interface AskDeps {
  fetch: typeof fetch;
  timeoutMs: number;
  policy: () => ProviderPolicy;
  apiKey: () => string | undefined;
  baseUrl: () => string;
}

/** Groq says when the free-tier allowance is used up for the day (vs a short per-minute limit). */
function isQuotaExhausted(message: string, retryAfterMs: number | undefined): boolean {
  return /per day|\bTPD\b|\bRPD\b|daily/i.test(message) || (retryAfterMs !== undefined && retryAfterMs > 60_000);
}

/**
 * One chat call to Groq (OpenAI-compatible). The provider policy is checked on every call, so
 * retries and queued work stop as soon as live hearings are switched off, and the timeout covers
 * the whole exchange, including reading the response body (success and error bodies alike).
 */
export function createAsk(deps: AskDeps) {
  return async function ask(model: string, system: string, user: string): Promise<string> {
    const policy = deps.policy();
    if (!policy.allowed) throw new SourceError("permanent", "provider_disabled", policy.reason);
    const key = deps.apiKey();
    if (!key) throw new SourceError("permanent", "auth_failed", "GROQ_API_KEY is not set on the server.");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
    const timedOut = () =>
      new SourceError("transient", "timeout", `The AI provider did not answer within ${deps.timeoutMs / 1000}s.`);
    const reasoning = model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low", include_reasoning: false } : {};
    try {
      let r: Response;
      try {
        r = await deps.fetch(`${deps.baseUrl()}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            max_completion_tokens: 1024,
            temperature: 0.6,
            ...reasoning,
          }),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) throw timedOut();
        throw new SourceError("transient", "network", "Could not reach the AI provider.");
      }

      // Read the body while the timer is still armed: a stalled body must not hold the caller.
      let body: unknown;
      try {
        body = await r.json();
      } catch {
        if (controller.signal.aborted) throw timedOut();
        body = null;
      }

      if (!r.ok) {
        const m = String((body as { error?: { message?: string } } | null)?.error?.message ?? "");
        const detail = m ? ` (${m.slice(0, 160)})` : "";
        if (r.status === 429) {
          const ra = Number(r.headers.get("retry-after"));
          const retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
          if (isQuotaExhausted(m, retryAfterMs)) {
            throw new SourceError("pause", "quota_exhausted", `The ${LIVE_PROVIDER_LABEL} quota is used up for now.${detail}`, retryAfterMs);
          }
          throw new SourceError("transient", "rate_limited", "The AI provider is rate limiting requests.", retryAfterMs);
        }
        if (r.status === 401 || r.status === 403) {
          throw new SourceError("permanent", "auth_failed", `The AI provider rejected the API key (HTTP ${r.status}).${detail}`);
        }
        if (r.status === 408 || r.status === 409 || r.status >= 500) {
          throw new SourceError("transient", "upstream_error", `The AI provider had a temporary error (HTTP ${r.status}).`);
        }
        throw new SourceError("permanent", "request_rejected", `The AI provider rejected the request (HTTP ${r.status}).${detail}`);
      }
      const content = (body as { choices?: { message?: { content?: string | null } }[] } | null)?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new SourceError("transient", "bad_output", "The AI provider returned an unreadable response.");
      return content.trim();
    } finally {
      clearTimeout(timer);
    }
  };
}

const ask = createAsk({
  fetch: (...a) => fetch(...a),
  timeoutMs: CALL_TIMEOUT_MS,
  policy: () => providerPolicy("groq"),
  apiKey: () => process.env.GROQ_API_KEY,
  baseUrl: groqBaseUrl,
});

const modelFor = (role: Role) => (role === "adjudicator" ? liveModels().chair : liveModels().debater);

/** Build the live source around any `ask` (tests pass a fake). */
export function createLiveSource(askFn: typeof ask): TurnSource {
  return {
    mode: "live",
    totalTurns: () => TURN_PLAN.length,

    async generateTurn({ entry, seq, turns }) {
      const step = TURN_PLAN[seq - 1];
      if (!step) throw new SourceError("permanent", "plan_mismatch", `There is no turn ${seq} in the hearing plan.`);
      const [role, kind] = step;
      const validIds = entry.transcript.evidence.map((e) => e.id);
      const user =
        `${brief(entry)}

DEBATE SO FAR:
${soFar(turns)}

` +
        `It is your turn (${role}, ${kind}).
${turnFormat(role, kind as TurnType, validIds)}`;
      const data = parseJson(await askFn(modelFor(role), SYSTEM_PROMPTS[role], user));
      try {
        const p = parseTurnJson(role, kind as TurnType, data, validIds);
        return { agent: role, type: kind as TurnType, text: p.text, addressedTo: p.addressedTo, evidenceRefs: p.evidenceRefs, durationMs: estDur(p.text) };
      } catch (e) {
        if (e instanceof ArgumentError) throw new SourceError("transient", "bad_output", `The model's turn was rejected: ${e.message}`);
        throw e;
      }
    },

    /** The AI recommendation. A malformed answer is retried, never defaulted to a decision. */
    async generateVerdict(entry, turns) {
      const chair = liveModels().chair;
      const user =
        `${brief(entry)}\n\nFULL DEBATE:\n${soFar(turns)}\n\n` +
        "Recommend a decision for the human reviewer, who makes the final call. Use REMANDED when the record cannot " +
        "settle the decisive issue, and say what record would. Do not force OVERTURNED or UPHELD on thin evidence. " +
        'Respond ONLY with JSON: {"decision":"OVERTURNED|UPHELD|REMANDED","rationale":"<1-2 sentences>",' +
        '"evidenceNeeded":"<required for REMANDED: the specific record that would resolve it; else empty>"}';
      const vd = parseJson(
        await askFn(chair, "You weigh both sides fairly and recommend. Patients deserve a defense; insurers deserve rigor.", user),
      );
      if (vd.decision !== "OVERTURNED" && vd.decision !== "UPHELD" && vd.decision !== "REMANDED") {
        throw new SourceError("transient", "bad_output", "The model did not give a valid recommendation.");
      }
      let rationale = clip(vd.rationale, 420);
      if (!rationale) throw new SourceError("transient", "bad_output", "The model gave no rationale.");
      if (vd.decision === "REMANDED") {
        const needed = clip(vd.evidenceNeeded, 160);
        if (!needed) throw new SourceError("transient", "bad_output", "A remand must say what record would resolve it.");
        rationale = `${rationale} Needed: ${needed}`;
      }
      // No confidence: a model-reported number is not a calibrated probability.
      return { decision: vd.decision, rationale, by: `AI recommendation · ${LIVE_PROVIDER_LABEL} · ${chair}` };
    },
  };
}

export const liveSource: TurnSource = createLiveSource(ask);

/** No API key needed: replays the bundled case through the same background pipeline. */
export const sampleSource: TurnSource = {
  mode: "sample",
  totalTurns: (entry) => entry.transcript.turns.length,

  async generateTurn({ entry, seq }) {
    const delay = Number(process.env.HEARING_SAMPLE_DELAY_MS ?? 1500);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const t = entry.transcript.turns[seq - 1];
    if (!t) throw new SourceError("permanent", "plan_mismatch", `There is no turn ${seq} in the sample record.`);
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

/**
 * Durable hearings replay the sample unless HEARING_MODE=live is set AND the Groq free-tier
 * provider is enabled. An API key alone never makes a hearing live.
 */
export function pickMode(): HearingMode {
  return process.env.HEARING_MODE === "live" && providerPolicy("groq").allowed ? "live" : "sample";
}

export const getSource = (mode: HearingMode): TurnSource => (mode === "live" ? liveSource : sampleSource);
