import { NextRequest, NextResponse } from "next/server";

export const NO_STORE = { "Cache-Control": "no-store" };

/** Header carrying a hearing's control token (needed to pause, resume, retry or rule). */
export const CONTROL_HEADER = "x-hearing-control";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isHearingId = (id: string) => UUID.test(id);

/** Parse a JSON object body. Anything else (bad JSON, null, arrays, scalars) is null. */
export async function readObject(req: NextRequest): Promise<Record<string, unknown> | null> {
  const body: unknown = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export const jsonError = (status: number, error: string, message?: string) =>
  NextResponse.json(message ? { error, message } : { error }, { status, headers: NO_STORE });

export const notFound = () => jsonError(404, "not_found");
export const invalidBody = () => jsonError(400, "invalid_body", "Send a JSON object.");
export const forbidden = () =>
  jsonError(403, "forbidden", "Only the browser that started this hearing can control it. Viewing is still allowed.");
