import assert from "node:assert/strict";
import { test } from "node:test";
import { CASES } from "../../data/cases";
import { providerPolicy } from "../providers";
import { createAsk, createLiveSource, pickMode, SourceError, type AskDeps } from "./source";

const allowed = () => ({ allowed: true, reason: "" });
const base = (over: Partial<AskDeps>): AskDeps => ({
  fetch: async () => new Response("{}"),
  timeoutMs: 1000,
  policy: allowed,
  apiKey: () => "k",
  baseUrl: () => "http://groq.test/openai/v1",
  ...over,
});
const chat = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

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

async function rejectsWith(p: Promise<unknown>, code: string, kind?: string) {
  await assert.rejects(p, (e: unknown) => e instanceof SourceError && e.code === code && (!kind || e.kind === kind));
}

test("the timeout covers a stalled success body", async () => {
  const ask = createAsk(base({ fetch: async (_u, init) => stalledResponse(200, init!.signal!), timeoutMs: 20 }));
  await rejectsWith(ask("m", "s", "u"), "timeout");
});

test("the timeout covers a stalled error body", async () => {
  const ask = createAsk(base({ fetch: async (_u, init) => stalledResponse(500, init!.signal!), timeoutMs: 20 }));
  await rejectsWith(ask("m", "s", "u"), "timeout");
});

test("a disabled provider is refused before any request, even with a key", async () => {
  let fetched = 0;
  const ask = createAsk(base({ fetch: async () => (fetched++, new Response("{}")), policy: () => ({ allowed: false, reason: "off" }) }));
  await rejectsWith(ask("m", "s", "u"), "provider_disabled", "permanent");
  assert.equal(fetched, 0);
});

test("the policy is read on every call, so retries stop once live hearings are switched off", async () => {
  let on = true;
  const ask = createAsk(base({ fetch: async () => chat("hi"), policy: () => ({ allowed: on, reason: "off" }) }));
  assert.equal(await ask("m", "s", "u"), "hi");
  on = false;
  await rejectsWith(ask("m", "s", "u"), "provider_disabled");
});

test("requests go to the Groq chat endpoint with the key server-side and reasoning trimmed", async () => {
  let seen: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
  const ask = createAsk(
    base({
      fetch: async (u, init) => {
        seen = { url: String(u), auth: new Headers(init!.headers).get("authorization"), body: JSON.parse(String(init!.body)) };
        return chat("ok");
      },
    }),
  );
  await ask("openai/gpt-oss-20b", "sys", "usr");
  assert.equal(seen!.url, "http://groq.test/openai/v1/chat/completions");
  assert.equal(seen!.auth, "Bearer k");
  assert.equal(seen!.body.reasoning_effort, "low");
  assert.equal(seen!.body.include_reasoning, false);
  assert.equal(seen!.body.max_completion_tokens, 1024);
});

test("a daily quota 429 pauses; a short rate limit is retried", async () => {
  const r429 = (message: string, retryAfter?: string) =>
    new Response(JSON.stringify({ error: { message } }), { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} });
  const daily = createAsk(base({ fetch: async () => r429("Rate limit reached on tokens per day (TPD): Limit 200000") }));
  await rejectsWith(daily("m", "s", "u"), "quota_exhausted", "pause");
  const long = createAsk(base({ fetch: async () => r429("Rate limit reached", "3600") }));
  await rejectsWith(long("m", "s", "u"), "quota_exhausted", "pause");
  const minute = createAsk(base({ fetch: async () => r429("Rate limit reached on tokens per minute (TPM)", "7") }));
  await rejectsWith(minute("m", "s", "u"), "rate_limited", "transient");
});

test("a bad key is permanent", async () => {
  const ask = createAsk(base({ fetch: async () => new Response("{}", { status: 401 }) }));
  await rejectsWith(ask("m", "s", "u"), "auth_failed", "permanent");
});

test("live turns keep only listed evidence ids and valid addressees", async () => {
  const src = createLiveSource(async () => '{"text":"The record shows it.","addressedTo":"nobody","evidenceRefs":["EX-01","EX-99","EX-01"]}');
  const g = await src.generateTurn({ entry: CASES[0], seq: 2, turns: [] });
  assert.equal(g.agent, "advocate");
  assert.deepEqual(g.evidenceRefs, ["EX-01"]);
  assert.equal(g.addressedTo, null);
});

test("a malformed recommendation is retried, never defaulted to a decision", async () => {
  const bad = createLiveSource(async () => '{"decision":"MAYBE","rationale":"x"}');
  await rejectsWith(bad.generateVerdict(CASES[0], []), "bad_output", "transient");
  const empty = createLiveSource(async () => '{"decision":"UPHELD","rationale":""}');
  await rejectsWith(empty.generateVerdict(CASES[0], []), "bad_output");
  const good = createLiveSource(async () => '{"decision":"UPHELD","rationale":"Documentation is missing.","confidence":0.99}');
  const v = await good.generateVerdict(CASES[0], []);
  assert.equal(v.decision, "UPHELD");
  assert.equal(v.confidence, undefined); // a model-reported number is not shown as a probability
  assert.match(v.by, /AI recommendation/);
  assert.doesNotMatch(v.by, /Dr\./);
});

test("paid providers stay off; Groq needs opt-in, a key, and explicit Free-account confirmation", () => {
  const prev = { ...process.env };
  try {
    process.env.ANTHROPIC_API_KEY = "set";
    process.env.DEEPGRAM_API_KEY = "set";
    assert.equal(providerPolicy("anthropic").allowed, false);
    assert.equal(providerPolicy("deepgram").allowed, false);
    process.env.GROQ_API_KEY = "gsk_test";
    delete process.env.JURO_LIVE_PROVIDER;
    assert.equal(providerPolicy("groq").allowed, false); // key alone is not enough
    process.env.JURO_LIVE_PROVIDER = "groq";
    delete process.env.JURO_GROQ_FREE_CONFIRMED;
    assert.equal(providerPolicy("groq").allowed, false);
    process.env.JURO_GROQ_FREE_CONFIRMED = "1";
    assert.equal(providerPolicy("groq").allowed, true);
    delete process.env.HEARING_MODE;
    assert.equal(pickMode(), "sample"); // sample stays the default even when live is available
  } finally {
    process.env = prev;
  }
});
