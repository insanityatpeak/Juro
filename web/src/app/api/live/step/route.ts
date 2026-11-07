import { NextResponse } from "next/server";
import { jsonError, NO_STORE } from "@/lib/hearings/http";
import { liveError, readLiveBody } from "@/lib/liveHttp";
import { liveSessions } from "@/lib/liveSession";
import { providerPolicy } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

// Only server-signed state from the invited session endpoint reaches a provider.
export async function POST(req: Request) {
  const policy = providerPolicy("groq");
  if (!policy.allowed) return jsonError(503, "provider_disabled", policy.reason);

  try {
    return NextResponse.json(await liveSessions.step(await readLiveBody(req)), { headers: NO_STORE });
  } catch (e) { return liveError(e); }
}
