import { NextRequest, NextResponse } from "next/server";
import { providerPolicy } from "@/lib/providers";
import { FACTION_META, type Faction } from "@/lib/types";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

// POST { text, agent } -> audio/mpeg via Deepgram. Disabled by the TTS provider control
// (no paid services); the Chamber reads turns aloud with the browser's own speech synthesis.
export async function POST(req: NextRequest) {
  const policy = providerPolicy("deepgram"); // checked per request, before anything else
  if (!policy.allowed) return NextResponse.json({ error: "provider_disabled", message: policy.reason }, { status: 503, headers: NO_STORE });

  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 503, headers: NO_STORE });

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }
  const { text, agent } = body as { text?: unknown; agent?: unknown };
  if (typeof text !== "string" || !text.trim()) return NextResponse.json({ error: "no_text" }, { status: 400, headers: NO_STORE });

  const meta = typeof agent === "string" ? FACTION_META[agent as Faction] : undefined;
  const model = meta?.voice ?? "aura-2-athena-en";
  const dg = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 2000) }), // Deepgram caps at 2000 chars
  });

  if (!dg.ok || !dg.body) return NextResponse.json({ error: "tts_error" }, { status: 502, headers: NO_STORE });
  return new Response(dg.body, { headers: { "Content-Type": "audio/mpeg", ...NO_STORE } });
}
