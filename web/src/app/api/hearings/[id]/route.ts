import { NextRequest, NextResponse } from "next/server";
import { CONTROL_HEADER, forbidden, invalidBody, isHearingId, jsonError, NO_STORE, notFound, readObject } from "@/lib/hearings/http";
import { ensureWorker, tick } from "@/lib/hearings/scheduler";
import { getStore } from "@/lib/hearings/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/hearings/<id>?after=<seq> -> status plus the turns after `after` (0 = everything).
// Viewing needs only the link. Polling this is all the page needs.
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isHearingId(id)) return notFound();
  ensureWorker();
  const after = Math.max(0, Number(req.nextUrl.searchParams.get("after")) || 0);
  const view = getStore().view(id, after);
  if (!view) return notFound();
  return NextResponse.json(view, { headers: NO_STORE });
}

// PATCH { action: "pause" | "resume" | "retry" }, with the hearing's control token in x-hearing-control.
//   pause  : waiting -> paused; running -> pause requested (the active step finishes and is saved first)
//   resume : paused -> waiting (continues from the next turn); also withdraws a pending pause request
//   retry  : failed/partial -> waiting (continues from the next turn)
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isHearingId(id)) return notFound();
  const body = await readObject(req);
  if (!body) return invalidBody();
  const store = getStore();
  const row = store.get(id);
  if (!row) return notFound();
  if (!store.isController(id, req.headers.get(CONTROL_HEADER))) return forbidden();

  const action = body.action;
  let ok = false;
  if (action === "pause") ok = store.requestPause(id) !== "invalid";
  else if (action === "resume") ok = row.status === "paused" ? store.requeue(id) : store.cancelPause(id);
  else if (action === "retry") ok = (row.status === "failed" || row.status === "partial") && store.requeue(id);
  else return jsonError(400, "unknown_action");

  if (!ok) {
    return NextResponse.json({ error: "invalid_transition", status: row.status }, { status: 409, headers: NO_STORE });
  }
  ensureWorker();
  tick();
  return NextResponse.json(store.view(id), { headers: NO_STORE });
}
