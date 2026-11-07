/**
 * Provider controls. Juro must run without paid services:
 *  - anthropic, deepgram: paid, always off. Setting their API keys does nothing.
 *  - groq: free tier only, opt-in with JURO_LIVE_PROVIDER=groq, GROQ_API_KEY,
 *    and operator assertion JURO_GROQ_FREE_CONFIRMED=1.
 *    The key must belong to a dedicated Groq Free-plan account with no payment method or paid
 *    upgrade. There is no paid fallback: if Groq is unavailable or out of quota, live hearings pause.
 *
 * Each control is checked immediately before a call (including retries and queued work),
 * not once at startup.
 */
export type Provider = "anthropic" | "deepgram" | "groq";

export interface ProviderPolicy {
  allowed: boolean;
  reason: string;
}

const NO_PAID = "this project uses no paid services";

export function providerPolicy(p: Provider): ProviderPolicy {
  switch (p) {
    case "anthropic":
      return { allowed: false, reason: `Anthropic generation is disabled: ${NO_PAID}.` };
    case "deepgram":
      return { allowed: false, reason: `Server text-to-speech is disabled: ${NO_PAID}. Audio uses the browser's built-in voices.` };
    case "groq": {
      const on = process.env.JURO_LIVE_PROVIDER === "groq" && !!process.env.GROQ_API_KEY
        && process.env.JURO_GROQ_FREE_CONFIRMED === "1";
      return on
        ? { allowed: true, reason: "" }
        : {
            allowed: false,
            reason: "Live hearings are off until the operator configures Groq and confirms a dedicated Free account without billing. Sample hearings still work.",
          };
    }
  }
}
