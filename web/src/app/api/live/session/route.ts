import { NextResponse } from "next/server";
import { NO_STORE, jsonError } from "@/lib/hearings/http";
import { liveError, readLiveBody } from "@/lib/liveHttp";
import { liveSessions } from "@/lib/liveSession";
import { providerPolicy } from "@/lib/providers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const policy = providerPolicy("groq");
  if (!policy.allowed) return jsonError(503, "provider_disabled", policy.reason);
  try {
    return NextResponse.json(liveSessions.start(await readLiveBody(req)), { headers: NO_STORE });
  } catch (e) { return liveError(e); }
}
