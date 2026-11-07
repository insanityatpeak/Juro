/**
 * Live hearing configuration (server-side). Live hearings use Groq's free tier only.
 * Use one model for all roles. Confirm it appears on the account's Free-plan limits page.
 */
export const LIVE_PROVIDER_LABEL = "Groq Free";

export interface LiveModels {
  debater: string;
  chair: string;
}

export function liveModels(): LiveModels {
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
  return {
    debater: model,
    chair: model,
  };
}

/** OpenAI-compatible base URL. Override only to point tests at a local mock. */
export const groqBaseUrl = () => process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";

/** Client flag: show the live-hearing option in the Chamber (inlined at build time). */
export const LIVE_HEARINGS_UI = process.env.NEXT_PUBLIC_LIVE_HEARINGS === "1";
