import { NextRequest, NextResponse } from "next/server";
import { CASES } from "@/data/cases";
import { invalidBody, jsonError, NO_STORE, readObject } from "@/lib/hearings/http";
import { ensureWorker } from "@/lib/hearings/scheduler";
import { getSource, pickMode } from "@/lib/hearings/source";
import { getStore, hashControlToken, newControlToken } from "@/lib/hearings/store";

export const runtime = "nodejs";

/** Queued + running hearings allowed at once on this server. */
const MAX_OPEN = Math.max(1, Number(process.env.HEARINGS_MAX_OPEN) || 10);

// POST { caseId } -> 201 { id, status, mode, controlToken }. The hearing runs on the server from here on;
// the page can be closed and reopened at /chamber/<id>. Anyone with the link can view it; only the holder
// of controlToken (returned once, never stored in plain text) can pause, resume, retry or rule on it.
export async function POST(req: NextRequest) {
  const body = await readObject(req);
  if (!body) return invalidBody();
  const entry = typeof body.caseId === "string" ? CASES.find((c) => c.id === body.caseId) : undefined;
  if (!entry) return jsonError(400, "unknown_case");

  const store = getStore();
  if (store.openCount() >= MAX_OPEN) {
    return jsonError(429, "queue_full", "Too many hearings are already queued or running. Try again shortly.");
  }

  const mode = pickMode();
  const controlToken = newControlToken();
  const row = store.create({
    caseId: entry.id,
    mode,
    totalTurns: getSource(mode).totalTurns(entry),
    controlTokenHash: hashControlToken(controlToken),
  });
  ensureWorker();
  return NextResponse.json({ id: row.id, status: row.status, mode: row.mode, controlToken }, { status: 201, headers: NO_STORE });
}
