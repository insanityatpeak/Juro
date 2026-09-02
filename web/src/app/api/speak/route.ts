import { NextRequest } from "next/server";
import { FACTION_META, type Faction } from "@/lib/types";

// POST { text, agent } -> audio/mpeg. The Deepgram key stays server-side.
// Voices are defined once in FACTION_META (lib/types.ts) — the single source
// of truth also used client-side, so the two never drift apart.
export async function POST(req: NextRequest) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return new Response("no_key", { status: 503 });

  const { text, agent } = (await req.json().catch(() => ({}))) as { text?: string; agent?: string };
  if (!text) return new Response("no_text", { status: 400 });

  const meta = FACTION_META[agent as Faction];
  const model = meta?.voice ?? "aura-2-athena-en";
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
