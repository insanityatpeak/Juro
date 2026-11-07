import { NextResponse } from "next/server";
import { NO_STORE } from "@/lib/hearings/http";
import { LIVE_PROVIDER_LABEL, liveModels } from "@/lib/live";
import { providerPolicy } from "@/lib/providers";

export const runtime = "nodejs";

// GET -> whether live hearings are available on this server, and which free-tier models run them.
// Never returns the key.
export async function GET() {
  const policy = providerPolicy("groq");
  return NextResponse.json(
    { available: policy.allowed, provider: LIVE_PROVIDER_LABEL, models: policy.allowed ? liveModels() : null, reason: policy.reason || null },
    { headers: NO_STORE },
  );
}
