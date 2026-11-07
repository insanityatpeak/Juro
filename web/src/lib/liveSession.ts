import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { CASES } from "../data/cases";
import { liveModels } from "./live";
import { SYSTEM_PROMPTS, TURN_PLAN } from "./roles";
import { liveSource, SourceError, type TurnSource } from "./hearings/source";
import { parseLiveStep, runLiveStep, type LiveStepRequest, type LiveStepResult } from "./liveStep";

// Bump when generation instructions change outside SYSTEM_PROMPTS/TURN_PLAN.
const PROTOCOL_VERSION = 1;
const TTL_MS = 60 * 60 * 1000;
const DAILY_SESSIONS = 5;
const MAX_ATTEMPTS = 3;
type Config = { secret: string; invite: string; model: string };
type State = {
  version: number; session: string; caseId: string; model: string;
  context: string; expires: number; turns: LiveStepRequest["turns"];
};
export type SignedStep = LiveStepResult & { continuation: string | null };

export class LiveSessionError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function liveSessionConfig(): Config | null {
  const secret = process.env.LIVE_SESSION_SECRET || "";
  const invite = process.env.LIVE_TESTER_CODE || "";
  // Separate high-entropy secrets: knowing the invite must not permit signing state.
  return secret.length >= 32 && invite.length >= 24 && invite.length <= 256 && secret !== invite
    ? { secret, invite, model: liveModels().debater } : null;
}

const digest = (value: string) => createHash("sha256").update(value).digest();
function equal(a: string, b: string): boolean { return timingSafeEqual(digest(a), digest(b)); }
function context(caseId: string, model: string): string {
  const entry = CASES.find((c) => c.id === caseId);
  return digest(JSON.stringify({ version: PROTOCOL_VERSION, case: entry?.transcript.case,
    evidence: entry?.transcript.evidence, plan: TURN_PLAN, prompts: SYSTEM_PROMPTS, model })).toString("hex");
}
function seal(state: State, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
function unseal(token: unknown, config: Config, now: number): State {
  const invalid = () => new LiveSessionError(403, "invalid_session", "This live hearing could not be verified. Start a new hearing.");
  if (typeof token !== "string" || token.length > 60000) throw invalid();
  const parts = token.split(".");
  if (parts.length !== 2 || !equal(parts[1], createHmac("sha256", config.secret).update(parts[0]).digest("base64url"))) throw invalid();
  let state: State;
  try { state = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { throw invalid(); }
  if (!state || state.version !== PROTOCOL_VERSION || typeof state.session !== "string"
    || !Number.isFinite(state.expires) || !Array.isArray(state.turns)) throw invalid();
  if (state.expires <= now) throw new LiveSessionError(410, "session_expired", "This live session expired. Start a new hearing; this record remains visible until you leave.");
  if (state.model !== config.model || state.context !== context(state.caseId, config.model)) {
    throw new LiveSessionError(409, "context_changed", "The model or case instructions changed. Start a new hearing to use the new version.");
  }
  return state;
}

interface CachedStep { expires: number; attempts: number; pending?: Promise<SignedStep>; result?: SignedStep; retryAt: number; }

/**
 * Signed continuations are portable across serverless instances; duplicate suppression and the
 * five-session allowance are ONLY per instance. This is an invited preview, not a shared quota
 * or an exactly-once provider guarantee. A restart loses the cache. Public access must remain off.
 */
export function createLiveSessions(deps: {
  config: () => Config | null; source: TurnSource; now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, CachedStep>();
  let day = -1;
  let starts = 0;
  let active = false;
  function configured(): Config {
    const config = deps.config();
    if (!config) throw new LiveSessionError(503, "preview_disabled", "Invited live hearings are not configured. Replay a sample instead.");
    return config;
  }
  return {
    start(body: Record<string, unknown>) {
      const config = configured();
      if (typeof body.inviteCode !== "string" || body.inviteCode.length > 256 || !equal(body.inviteCode, config.invite)) {
        throw new LiveSessionError(403, "invite_required", "Enter a valid tester invite code. This is not your Groq API key.");
      }
      const parsed = parseLiveStep({ caseId: body.caseId, turns: [] });
      if (typeof parsed === "string") throw new LiveSessionError(400, parsed, "Choose a bundled sample case.");
      const today = Math.floor(now() / 86400000);
      if (day !== today) { day = today; starts = 0; }
      if (starts >= DAILY_SESSIONS) throw new LiveSessionError(429, "preview_limit", "This preview instance has reached its daily session allowance. Use a sample instead.");
      starts++;
      const state: State = { version: PROTOCOL_VERSION, session: randomUUID(), caseId: parsed.entry.id,
        model: config.model, context: context(parsed.entry.id, config.model), expires: now() + TTL_MS, turns: [] };
      return { continuation: seal(state, config.secret), models: { debater: config.model, chair: config.model }, expiresAt: state.expires };
    },
    async step(body: Record<string, unknown>): Promise<SignedStep> {
      const config = configured();
      // Never accept client-written transcript fields, even alongside a valid continuation.
      if (Object.keys(body).some((key) => key !== "continuation")) throw new LiveSessionError(400, "invalid_body", "Send only the signed continuation.");
      const state = unseal(body.continuation, config, now());
      const parsed = parseLiveStep({ caseId: state.caseId, turns: state.turns });
      if (typeof parsed === "string") throw new LiveSessionError(409, "invalid_session", "The session record is incompatible. Start a new hearing.");
      for (const [key, item] of cache) if (item.expires <= now() && !item.pending) cache.delete(key);
      const key = digest(body.continuation as string).toString("hex");
      let item = cache.get(key);
      if (item?.result) return item.result;
      if (item?.pending) return item.pending;
      if (item && item.attempts >= MAX_ATTEMPTS) throw new LiveSessionError(409, "attempts_exhausted", "This step exhausted its retry allowance. Start a new hearing or replay the sample.");
      if (item && item.retryAt > now()) throw new SourceError("pause", "retry_later", "This step is cooling down. Resume after the provider's requested wait.", item.retryAt - now());
      if (active) throw new SourceError("transient", "preview_busy", "Another live step is running on this instance. Please wait.", 5000);
      if (!item) {
        // Bound memory without evicting live replay records and re-enabling spent requests.
        if (cache.size >= 128) throw new SourceError("pause", "preview_full", "This preview instance is full. Replay a sample or try later.");
        item = { expires: state.expires, attempts: 0, retryAt: 0 };
        cache.set(key, item);
      }
      const current = item;
      active = true;
      current.attempts++;
      current.pending = (async () => {
        try {
          const result = await runLiveStep(deps.source, parsed);
          const next = result.kind === "turn" ? seal({ ...state, turns: [...state.turns, {
            agent: result.turn.agent, type: result.turn.type, text: result.turn.text,
            addressedTo: result.turn.addressedTo, evidenceRefs: result.turn.evidenceRefs,
          }] }, config.secret) : null;
          current.result = { ...result, continuation: next };
          return current.result;
        } catch (e) {
          if (e instanceof SourceError) {
            if (e.kind === "permanent") current.attempts = MAX_ATTEMPTS;
            current.retryAt = now() + Math.max(e.retryAfterMs ?? (e.kind === "pause" ? 60000 : 2000), 2000);
          } else current.attempts = MAX_ATTEMPTS;
          throw e;
        } finally { active = false; }
      })();
      try { return await current.pending; } finally { current.pending = undefined; }
    },
  };
}

export const liveSessions = createLiveSessions({ config: liveSessionConfig, source: liveSource });
