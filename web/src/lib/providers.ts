/**
 * Provider controls. Juro must run without paid services, so every paid integration is off and
 * cannot be switched on by setting an API key. Each control is checked immediately before a call
 * (including retries and queued work), not once at startup.
 *
 * A free, locally running model could be added later as a new provider with its own control.
 * Do not add a paid fallback.
 */
export type Provider = "generation" | "tts";

export interface ProviderPolicy {
  allowed: boolean;
  reason: string;
}

const POLICY: Record<Provider, ProviderPolicy> = {
  generation: {
    allowed: false,
    reason: "Live AI generation is disabled: this project uses no paid services. Hearings replay the bundled sample record.",
  },
  tts: {
    allowed: false,
    reason: "Server text-to-speech is disabled: this project uses no paid services. Audio uses the browser's built-in voices.",
  },
};

export function providerPolicy(p: Provider): ProviderPolicy {
  return POLICY[p];
}
