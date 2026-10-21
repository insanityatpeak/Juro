import { NextRequest, NextResponse } from "next/server";
import { CASES } from "@/data/cases";
import { ensureWorker } from "@/lib/hearings/scheduler";
import { getSource, pickMode } from "@/lib/hearings/source";
import { getStore } from "@/lib/hearings/store";

export const runtime = "nodejs";

// POST { caseId } -> 201 { id, status, mode }. The hearing runs on the server from here on;
// the page can be closed and reopened at /chamber/<id>.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { caseId?: string };
  const entry = CASES.find((c) => c.id === body.caseId);
  if (!entry) return NextResponse.json({ error: "unknown_case" }, { status: 400 });

  const mode = pickMode();
  const row = getStore().create({ caseId: entry.id, mode, totalTurns: getSource(mode).totalTurns(entry) });
  ensureWorker();
  return NextResponse.json({ id: row.id, status: row.status, mode: row.mode }, { status: 201 });
}
