import { NextRequest, NextResponse } from "next/server";
import { DURABLE_HEARINGS } from "@/lib/hearings/config";
import {
  CONTROL_HEADER,
  durableDisabled,
  forbidden,
  invalidBody,
  isHearingId,
  jsonError,
  NO_STORE,
  notFound,
  readObject,
  readOnlyLegacy,
} from "@/lib/hearings/http";

export const runtime = "nodejs";

const DECISIONS = ["OVERTURNED", "UPHELD", "REMANDED"] as const;
type Decision = (typeof DECISIONS)[number];

// POST { decision }, with the hearing's control token in x-hearing-control -> records the ruling.
// The token proves the request came from the browser that started the hearing; it does not identify
// the reviewer. Refused with 409 unless the hearing is complete: a partial hearing is never a ruling.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!DURABLE_HEARINGS) return durableDisabled();
  const { id } = await params;
  if (!isHearingId(id)) return notFound();
  const body = await readObject(req);
  if (!body) return invalidBody();
  const decision = body.decision;
  if (typeof decision !== "string" || !DECISIONS.includes(decision as Decision)) return jsonError(400, "invalid_decision");

  const { getStore } = await import("@/lib/hearings/store");
  const store = getStore();
  const row = store.get(id);
  if (!row) return notFound();
  if (!row.control_token_hash) return readOnlyLegacy();
  if (!store.isController(id, req.headers.get(CONTROL_HEADER))) return forbidden();

  const result = store.recordRuling(id, decision as Decision);
  if (result === "not_found") return notFound();
  if (result === "not_complete") return jsonError(409, "not_complete", "This hearing is not complete, so it cannot be ruled on.");
  if (result === "already_ruled") return jsonError(409, "already_ruled", "A ruling was already recorded for this hearing.");
  return NextResponse.json(store.view(id, Number.MAX_SAFE_INTEGER), { headers: NO_STORE });
}
