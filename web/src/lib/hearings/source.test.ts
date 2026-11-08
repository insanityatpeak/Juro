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

const adv = (o: Record<string, unknown>) => JSON.stringify({ claim: "The denial ignores the chart.", evidenceRefs: ["EX-01"], ...o });

test("a structured turn is composed into plain text with its evidence ids", async () => {
  const src = createLiveSource(async () => adv({ rule: "Plan §4.2", missing: "", addressedTo: "nobody" }));
  const g = await src.generateTurn({ entry: CASES[0], seq: 2, turns: [] });
  assert.equal(g.agent, "advocate");
  assert.deepEqual(g.evidenceRefs, ["EX-01"]);
  assert.equal(g.addressedTo, null);
  assert.match(g.text, /The denial ignores the chart\. \[EX-01\] Rule: Plan §4\.2/);
});

test("a reference to a nonexistent record rejects the turn instead of being dropped", async () => {
  const src = createLiveSource(async () => adv({ evidenceRefs: ["EX-01", "EX-99"] }));
  await rejectsWith(src.generateTurn({ entry: CASES[0], seq: 2, turns: [] }), "bad_output", "transient");
});

test("a claim needs a record or an honest statement of what is missing", async () => {
  const bare = createLiveSource(async () => adv({ evidenceRefs: [] }));
  await rejectsWith(bare.generateTurn({ entry: CASES[0], seq: 2, turns: [] }), "bad_output");
  const honest = createLiveSource(async () => adv({ evidenceRefs: [], missing: "No peer-reviewed letter on file." }));
  const g = await honest.generateTurn({ entry: CASES[0], seq: 2, turns: [] });
  assert.match(g.text, /Not in the record: No peer-reviewed letter/);
});

test("a rebuttal must answer the other side's strongest point", async () => {
  const none = createLiveSource(async () => adv({}));
  await rejectsWith(none.generateTurn({ entry: CASES[0], seq: 3, turns: [] }), "bad_output");
  const bad = createLiveSource(async () => adv({ response: { strongestPoint: "x", stance: "shrug", why: "y" } }));
  await rejectsWith(bad.generateTurn({ entry: CASES[0], seq: 3, turns: [] }), "bad_output");
  const ok = createLiveSource(async () => adv({ response: { strongestPoint: "The chart is undated.", stance: "dispute", why: "EX-01 carries a date." } }));
  const g = await ok.generateTurn({ entry: CASES[0], seq: 3, turns: [] });
  assert.match(g.text, /^Their strongest point: The chart is undated\. I dispute: EX-01 carries a date\./);
});

test("evidence classifies claims and cannot settle one without citing a record", async () => {
  const f = (o: Record<string, unknown>) => JSON.stringify({ findings: [{ claim: "Imaging was ordered.", status: "supported", evidenceRefs: ["EX-01"], ...o }], missing: "Prior authorization letter." });
  const ok = await createLiveSource(async () => f({})).generateTurn({ entry: CASES[0], seq: 4, turns: [] });
  assert.match(ok.text, /Supported: Imaging was ordered\. \[EX-01\]\./);
  assert.match(ok.text, /Missing from the record: Prior authorization letter/);
  await rejectsWith(createLiveSource(async () => f({ evidenceRefs: [] })).generateTurn({ entry: CASES[0], seq: 4, turns: [] }), "bad_output");
  const open = await createLiveSource(async () => f({ status: "not_established", evidenceRefs: [] })).generateTurn({ entry: CASES[0], seq: 4, turns: [] });
  assert.match(open.text, /Not established:/);
});

test("a ruling is structured, and a remand must say what record would resolve it", async () => {
  const r = (o: Record<string, unknown>) =>
    JSON.stringify({ decisiveIssue: "Whether therapy was tried.", rule: "Plan §4.2", evidenceRefs: ["EX-01"], strongestOpposing: "No therapy notes.", effectOnOutcome: "It does not change the outcome because EX-01 is dated.", uncertainty: "", recommendation: "OVERTURN", ...o });
  const ok = await createLiveSource(async () => r({})).generateTurn({ entry: CASES[0], seq: 10, turns: [] });
  assert.match(ok.text, /Decisive issue:.*Strongest opposing argument:.*Recommendation: OVERTURN\.$/);
  await rejectsWith(createLiveSource(async () => r({ recommendation: "REMAND" })).generateTurn({ entry: CASES[0], seq: 10, turns: [] }), "bad_output");
  const remand = await createLiveSource(async () => r({ recommendation: "REMAND", evidenceRefs: [], evidenceNeeded: "The therapy notes." })).generateTurn({ entry: CASES[0], seq: 10, turns: [] });
  assert.match(remand.text, /Needed to resolve it: The therapy notes\..*Recommendation: REMAND\./);
  await rejectsWith(createLiveSource(async () => r({ evidenceRefs: [] })).generateTurn({ entry: CASES[0], seq: 10, turns: [] }), "bad_output");
  await rejectsWith(createLiveSource(async () => r({ recommendation: "MAYBE" })).generateTurn({ entry: CASES[0], seq: 10, turns: [] }), "bad_output");
});

test("the recommendation can be a remand, which names the record that would resolve it", async () => {
  const bad = createLiveSource(async () => '{"decision":"REMANDED","rationale":"Unclear."}');
  await rejectsWith(bad.generateVerdict(CASES[0], []), "bad_output");
  const good = createLiveSource(async () => '{"decision":"REMANDED","rationale":"The record cannot settle it.","evidenceNeeded":"The therapy notes."}');
  const v = await good.generateVerdict(CASES[0], []);
  assert.equal(v.decision, "REMANDED");
  assert.match(v.rationale, /Needed: The therapy notes\./);
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
