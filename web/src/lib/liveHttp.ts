import { NextResponse } from "next/server";
import { NO_STORE } from "./hearings/http";
import { LiveSessionError } from "./liveSession";
import { stepErrorResponse } from "./liveStep";

/** Bound the body before JSON parsing, including chunked requests. */
export async function readLiveBody(req: Request): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new LiveSessionError(400, "invalid_body", "Send a JSON object.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) {
      await reader.cancel();
      throw new LiveSessionError(413, "body_too_large", "The live request is too large.");
    }
    chunks.push(value);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new LiveSessionError(400, "invalid_body", "Send a JSON object.");
  return body as Record<string, unknown>;
}

export function liveError(e: unknown) {
  const result = e instanceof LiveSessionError
    ? { status: e.status, body: { error: e.code, kind: "permanent", message: e.message } }
    : stepErrorResponse(e);
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}
