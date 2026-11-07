import assert from "node:assert/strict";
import { test } from "node:test";
import { createAsk, pickMode, SourceError } from "./source";

const allowed = () => ({ allowed: true, reason: "" });

/** A Response whose body never arrives unless the request is aborted. */
function stalledResponse(status: number, signal: AbortSignal): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))),
      ),
  } as unknown as Response;
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof SourceError && e.code === code);
}

test("the timeout covers a stalled success body", async () => {
  const ask = createAsk({
    fetch: async (_u, init) => stalledResponse(200, init!.signal!),
    timeoutMs: 20,
    policy: allowed,
    apiKey: () => "k",
  });
  await rejectsWith(ask("m", "s", "u"), "timeout");
});

test("the timeout covers a stalled error body", async () => {
  const ask = createAsk({
    fetch: async (_u, init) => stalledResponse(500, init!.signal!),
    timeoutMs: 20,
    policy: allowed,
    apiKey: () => "k",
  });
  await rejectsWith(ask("m", "s", "u"), "timeout");
});

test("a disabled provider is refused before any request, even with a key", async () => {
  let fetched = 0;
  const ask = createAsk({
    fetch: async () => {
      fetched++;
      return new Response("{}");
    },
    timeoutMs: 1000,
    policy: () => ({ allowed: false, reason: "off" }),
    apiKey: () => "k",
  });
  await rejectsWith(ask("m", "s", "u"), "provider_disabled");
  assert.equal(fetched, 0);
});

test("the policy is read on every call, so retries stop once generation is disabled", async () => {
  let on = true;
  const ask = createAsk({
    fetch: async () => new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }] })),
    timeoutMs: 1000,
    policy: () => ({ allowed: on, reason: "off" }),
    apiKey: () => "k",
  });
  assert.equal(await ask("m", "s", "u"), "hi");
  on = false;
  await rejectsWith(ask("m", "s", "u"), "provider_disabled");
});

test("new hearings use the sample record even when an API key is set", () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "set-but-unused";
  try {
    assert.equal(pickMode(), "sample");
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});
