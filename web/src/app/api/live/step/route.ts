import { NextRequest, NextResponse } from "next/server";
import { invalidBody, jsonError, NO_STORE, readObject } from "@/lib/hearings/http";
import { liveSource } from "@/lib/hearings/source";
import { parseLiveStep, runLiveStep, stepErrorResponse } from "@/lib/liveStep";
import { providerPolicy } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

// Best-effort per-IP limit. On serverless each instance has its own memory, so this only slows
// a single client down; the real ceiling is the Groq Free plan's quota (which pauses hearings).
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Math.max(1, Number(process.env.LIVE_STEPS_PER_MINUTE) || 20);
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

// POST { caseId, turns } -> { kind: "turn", turn } | { kind: "verdict", verdict }
// One Groq free-tier call per request; the browser drives the hearing and holds the transcript.
export async function POST(req: NextRequest) {
  const policy = providerPolicy("groq");
  if (!policy.allowed) return jsonError(503, "provider_disabled", policy.reason);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip)) {
    return NextResponse.json(
      { error: "rate_limited", kind: "transient", message: "Too many live steps from this address. Slow down.", retryAfterMs: 10_000 },
      { status: 429, headers: NO_STORE },
    );
  }

  const body = await readObject(req);
  if (!body) return invalidBody();
  const parsed = parseLiveStep(body);
  if (typeof parsed === "string") return jsonError(400, parsed);

  try {
    return NextResponse.json(await runLiveStep(liveSource, parsed), { headers: NO_STORE });
  } catch (e) {
    const { status, body: b } = stepErrorResponse(e);
    return NextResponse.json(b, { status, headers: NO_STORE });
  }
}
