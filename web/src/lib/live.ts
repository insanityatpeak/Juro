/**
 * Live hearing configuration (server-side). Live hearings use Groq's free tier only.
 * Models are overridable because free-plan availability can change; confirm both models
 * appear on the account's limits page before enabling live hearings.
 */
export const LIVE_PROVIDER_LABEL = "Groq Free";

export interface LiveModels {
  debater: string;
  chair: string;
}

export function liveModels(): LiveModels {
  return {
    debater: process.env.GROQ_DEBATER_MODEL || "openai/gpt-oss-20b",
    chair: process.env.GROQ_CHAIR_MODEL || "openai/gpt-oss-120b",
  };
}

/** OpenAI-compatible base URL. Override only to point tests at a local mock. */
export const groqBaseUrl = () => process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";

/** Client flag: show the live-hearing option in the Chamber (inlined at build time). */
export const LIVE_HEARINGS_UI = process.env.NEXT_PUBLIC_LIVE_HEARINGS === "1";
