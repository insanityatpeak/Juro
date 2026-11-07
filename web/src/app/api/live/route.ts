import { NextResponse } from "next/server";
import { NO_STORE } from "@/lib/hearings/http";
import { LIVE_PROVIDER_LABEL, liveModels } from "@/lib/live";
import { providerPolicy } from "@/lib/providers";
import { liveSessionConfig } from "@/lib/liveSession";

export const runtime = "nodejs";

// GET -> whether live hearings are available on this server, and which free-tier models run them.
// Never returns the key.
export async function GET() {
  const policy = providerPolicy("groq");
  const available = policy.allowed && !!liveSessionConfig();
  return NextResponse.json(
    { available, access: "invited_testers", provider: LIVE_PROVIDER_LABEL, models: available ? liveModels() : null,
      reason: available ? null : policy.reason || "Invited live hearings are not configured." },
    { headers: NO_STORE },
  );
}
