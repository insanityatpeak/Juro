import { NextRequest } from "next/server";

// Distinct, warm Aura-2 voices per agent so the hearing is legible by ear alone
// (two female / two male, different timbres).
const VOICES: Record<string, string> = {
  advocate: "aura-2-thalia-en", // warm, earnest counsel (for the patient)
  scrutinizer: "aura-2-apollo-en", // measured, confident (uphold the denial)
  evidence: "aura-2-cora-en", // smooth, caring, factual delivery
  adjudicator: "aura-2-jupiter-en", // knowledgeable baritone chair
  human: "aura-2-hera-en", // warm, professional reviewer
};

// POST { text, agent } -> audio/mpeg. The Deepgram key stays server-side.
export async function POST(req: NextRequest) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return new Response("no_key", { status: 503 });

  const { text, agent } = (await req.json()) as { text?: string; agent?: string };
  if (!text) return new Response("no_text", { status: 400 });

  const model = VOICES[agent ?? "human"] ?? "aura-2-athena-en";
  const dg = await fetch(`https://api.deepgram.com/v1/speak?model=${model}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 2000) }), // Deepgram caps at 2000 chars
  });

  if (!dg.ok || !dg.body) return new Response("tts_error", { status: 502 });
  return new Response(dg.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      // per-turn audio is deterministic for the same text+voice — cache hard
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
