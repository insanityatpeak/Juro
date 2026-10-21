import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/hearings/store";

export const runtime = "nodejs";

const DECISIONS = ["OVERTURNED", "UPHELD", "REMANDED"] as const;

// POST { decision } -> records the reviewer's binding ruling.
// Refused with 409 unless the hearing is complete: a partial hearing is never a ruling.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { decision } = (await req.json().catch(() => ({}))) as { decision?: string };
  if (!DECISIONS.includes(decision as (typeof DECISIONS)[number])) {
    return NextResponse.json({ error: "invalid_decision" }, { status: 400 });
  }
  const store = getStore();
  const result = store.recordRuling(id, decision as (typeof DECISIONS)[number]);
  if (result === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (result === "not_complete") {
    return NextResponse.json(
      { error: "not_complete", message: "This hearing is not complete, so it cannot be ruled on." },
      { status: 409 },
    );
  }
  if (result === "already_ruled") {
    return NextResponse.json({ error: "already_ruled", message: "A ruling was already recorded for this hearing." }, { status: 409 });
  }
  return NextResponse.json(store.view(id, Number.MAX_SAFE_INTEGER));
}
