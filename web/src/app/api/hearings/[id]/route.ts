import { NextRequest, NextResponse } from "next/server";
import { ensureWorker, tick } from "@/lib/hearings/scheduler";
import { getStore } from "@/lib/hearings/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

// GET /api/hearings/<id>?after=<seq> -> status plus the turns after `after` (0 = everything).
// Polling this is all the page needs; reopening later just asks for everything again.
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  ensureWorker();
  const after = Math.max(0, Number(req.nextUrl.searchParams.get("after")) || 0);
  const view = getStore().view(id, after);
  if (!view) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  return NextResponse.json(view, { headers: NO_STORE });
}

// PATCH { action: "pause" | "resume" | "retry" }
//   pause  : waiting/running -> paused (reviewer)
//   resume : paused          -> waiting (continues from the next turn)
//   retry  : failed/partial  -> waiting (continues from the next turn)
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const store = getStore();
  const row = store.get(id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

  let ok = false;
  if (action === "pause") ok = store.pauseByReviewer(id);
  else if (action === "resume") ok = row.status === "paused" && store.requeue(id);
  else if (action === "retry") ok = (row.status === "failed" || row.status === "partial") && store.requeue(id);
  else return NextResponse.json({ error: "unknown_action" }, { status: 400, headers: NO_STORE });

  if (!ok) {
    return NextResponse.json({ error: "invalid_transition", status: row.status }, { status: 409, headers: NO_STORE });
  }
  ensureWorker();
  tick();
  return NextResponse.json(store.view(id), { headers: NO_STORE });
}
