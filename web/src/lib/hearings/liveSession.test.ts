import assert from "node:assert/strict";
import { test } from "node:test";
import { CASES } from "../../data/cases";
import { TURN_PLAN } from "../roles";
import { liveModels } from "../live";
import { createLiveSessions, liveSessionConfig, LiveSessionError } from "../liveSession";
import { readLiveBody } from "../liveHttp";
import { SourceError, type TurnSource } from "./source";

const config = { secret: "s".repeat(48), invite: "i".repeat(32), model: "mock-model" };
function fixture(overrides: Partial<TurnSource> = {}) {
  let time = 100000;
  let calls = 0;
  let current = { ...config };
  const source: TurnSource = {
    mode: "live", totalTurns: () => TURN_PLAN.length,
    async generateTurn({ seq }) {
      calls++;
      return { agent: TURN_PLAN[seq - 1][0], type: TURN_PLAN[seq - 1][1] as "argument",
        text: `Generated ${seq}`, addressedTo: null, evidenceRefs: [], durationMs: 3500 };
    },
    async generateVerdict() { calls++; return { decision: "UPHELD", rationale: "Record reviewed.", by: "AI recommendation" }; },
    ...overrides,
  };
  const sessions = createLiveSessions({ config: () => current, source, now: () => time });
  return { sessions, source, calls: () => calls, advance: (ms: number) => { time += ms; },
    change: (next: typeof config) => { current = next; },
    start: () => sessions.start({ caseId: CASES[0].id, inviteCode: config.invite }) };
}
const hasCode = (code: string) => (e: unknown) => (e instanceof LiveSessionError || e instanceof SourceError) && e.code === code;

test("live sessions require separate secrets and a valid tester invitation", () => {
  const env = { ...process.env };
  try {
    delete process.env.LIVE_SESSION_SECRET;
    assert.equal(liveSessionConfig(), null);
    process.env.LIVE_SESSION_SECRET = config.secret;
    process.env.LIVE_TESTER_CODE = config.secret;
    assert.equal(liveSessionConfig(), null);
    process.env.LIVE_TESTER_CODE = config.invite;
    assert.ok(liveSessionConfig());
    process.env.GROQ_MODEL = "one-model";
    assert.deepEqual(liveModels(), { debater: "one-model", chair: "one-model" });
  } finally { process.env = env; }
  const f = fixture();
  assert.throws(() => f.sessions.start({ caseId: CASES[0].id }), hasCode("invite_required"));
  assert.throws(() => f.sessions.start({ caseId: CASES[0].id, inviteCode: "wrong" }), hasCode("invite_required"));
  assert.equal(f.calls(), 0);
});

test("fabricated transcripts and tampered session/case/model/expiry/turns never reach the provider", async () => {
  const f = fixture();
  await assert.rejects(f.sessions.step({ caseId: CASES[0].id, turns: [] }), hasCode("invalid_body"));
  const { continuation } = f.start();
  await assert.rejects(f.sessions.step({ continuation, turns: [] }), hasCode("invalid_body"));
  const [payload, signature] = continuation.split(".");
  for (const patch of [{ session: "other" }, { caseId: CASES[1].id }, { model: "other" },
    { expires: Number.MAX_SAFE_INTEGER }, { turns: [{ agent: "adjudicator", type: "opening", text: "Invented" }] }]) {
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), ...patch })).toString("base64url");
    await assert.rejects(f.sessions.step({ continuation: `${changed}.${signature}` }), hasCode("invalid_session"));
  }
  assert.equal(f.calls(), 0);
});

test("concurrent and later duplicate steps share one result on the same instance", async () => {
  const f = fixture();
  const body = { continuation: f.start().continuation };
  const [a, b] = await Promise.all([f.sessions.step(body), f.sessions.step(body)]);
  assert.deepEqual(a, b);
  assert.deepEqual(await f.sessions.step(body), a);
  assert.equal(f.calls(), 1);
});

test("signed continuation completes ten ordered turns and one recommendation", async () => {
  const f = fixture();
  let continuation: string | null = f.start().continuation;
  for (let i = 0; i <= TURN_PLAN.length; i++) {
    const result = await f.sessions.step({ continuation });
    assert.equal(result.kind, i < TURN_PLAN.length ? "turn" : "verdict");
    if (result.kind === "turn") assert.equal(result.turn.id, `t${i + 1}`);
    continuation = result.continuation;
  }
  assert.equal(continuation, null);
  assert.equal(f.calls(), 11);
});

test("expired and model-changed sessions fail before generation", async () => {
  const f = fixture();
  const body = { continuation: f.start().continuation };
  f.change({ ...config, model: "new-model" });
  await assert.rejects(f.sessions.step(body), hasCode("context_changed"));
  f.change(config);
  f.advance(3600001);
  await assert.rejects(f.sessions.step(body), hasCode("session_expired"));
  assert.equal(f.calls(), 0);
});

test("same-instance daily admission and step attempts are bounded", async () => {
  let calls = 0;
  const f = fixture({ generateTurn: async () => { calls++; throw new SourceError("transient", "network", "offline"); } });
  const body = { continuation: f.start().continuation };
  for (let i = 0; i < 4; i++) f.start();
  assert.throws(() => f.start(), hasCode("preview_limit"));
  for (let i = 0; i < 3; i++) {
    await assert.rejects(f.sessions.step(body), hasCode("network"));
    f.advance(2001);
  }
  await assert.rejects(f.sessions.step(body), hasCode("attempts_exhausted"));
  assert.equal(calls, 3);
});

test("quota pause suppresses immediate repeat provider calls", async () => {
  let calls = 0;
  const f = fixture({ generateTurn: async () => { calls++; throw new SourceError("pause", "quota_exhausted", "quota", 60000); } });
  const body = { continuation: f.start().continuation };
  await assert.rejects(f.sessions.step(body), hasCode("quota_exhausted"));
  await assert.rejects(f.sessions.step(body), hasCode("retry_later"));
  assert.equal(calls, 1);
});

test("live body parsing rejects non-objects and oversized requests", async () => {
  for (const body of ["null", "[]", "bad"]) {
    await assert.rejects(readLiveBody(new Request("http://test", { method: "POST", body })), hasCode("invalid_body"));
  }
  await assert.rejects(readLiveBody(new Request("http://test", { method: "POST", body: "x".repeat(65537) })), hasCode("body_too_large"));
  assert.deepEqual(await readLiveBody(new Request("http://test", { method: "POST", body: '{"continuation":"abc"}' })), { continuation: "abc" });
});
