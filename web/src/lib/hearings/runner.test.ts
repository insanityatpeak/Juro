import assert from "node:assert/strict";
import { test } from "node:test";
import { CASES } from "../../data/cases";
import { GENESIS_HASH, nextHash } from "../hash";
import type { Faction, TurnType } from "../types";
import { openDb } from "./db";
import { runHearing, type RunnerDeps } from "./runner";
import { SourceError, type TurnSource } from "./source";
import { createStore } from "./store";

const TOTAL = 4;
const AGENTS: Faction[] = ["adjudicator", "advocate", "scrutinizer", "evidence"];
const TYPES: TurnType[] = ["opening", "argument", "rebuttal", "evidence"];

/** A scripted turn source. `fails["turn:3"] = [err, err]` makes turn 3 fail twice, then succeed. */
function fakeSource(fails: Record<string, SourceError[]> = {}, hooks: { onTurn?: (seq: number) => void } = {}) {
  const calls: string[] = [];
  const source: TurnSource = {
    mode: "sample",
    totalTurns: () => TOTAL,
    async generateTurn({ seq }) {
      calls.push(`turn:${seq}`);
      hooks.onTurn?.(seq);
      const err = fails[`turn:${seq}`]?.shift();
      if (err) throw err;
      return { agent: AGENTS[seq - 1], type: TYPES[seq - 1], text: `turn ${seq}`, addressedTo: null, evidenceRefs: [], durationMs: 1000 };
    },
    async generateVerdict(entry) {
      calls.push("verdict");
      const err = fails["verdict"]?.shift();
      if (err) throw err;
      return entry.transcript.verdict;
    },
  };
  return { source, calls };
}

function setup(source: TurnSource) {
  const store = createStore(openDb(":memory:"));
  const deps: RunnerDeps = {
    store,
    getEntry: (id) => CASES.find((c) => c.id === id),
    getSource: () => source,
    sleep: async () => {},
    backoffMs: () => 0,
    heartbeatMs: 60_000,
  };
  const h = store.create({ caseId: CASES[0].id, mode: "sample", totalTurns: TOTAL });
  return { store, deps, id: h.id };
}

const seqs = (store: ReturnType<typeof createStore>, id: string) => store.listTurns(id).map((t) => t.seq);
const transient = (code = "upstream_error") => new SourceError("transient", code, "temporary");

test("a hearing runs to complete without anyone watching, and the chain verifies", async () => {
  const { source } = fakeSource();
  const { store, deps, id } = setup(source);
  assert.equal(store.get(id)?.status, "waiting");
  await runHearing(deps, id);

  const v = store.view(id)!;
  assert.equal(v.status, "complete");
  assert.deepEqual(seqs(store, id), [1, 2, 3, 4]);
  assert.equal(v.canRule, true);
  assert.ok(v.auditRoot);
  assert.ok(v.verdict);

  let prev = GENESIS_HASH;
  for (const t of v.turns) {
    prev = nextHash(prev, { id: t.id, agent: t.agent, type: t.type, text: t.text, addressedTo: t.addressedTo ?? null, evidenceRefs: t.evidenceRefs ?? [], durationMs: t.durationMs });
    assert.equal(t.hash, prev);
  }
});

test("temporary failures retry and never duplicate turns", async () => {
  const { source, calls } = fakeSource({ "turn:3": [transient(), transient("timeout")] });
  const { store, deps, id } = setup(source);
  await runHearing(deps, id);

  assert.equal(store.get(id)?.status, "complete");
  assert.deepEqual(seqs(store, id), [1, 2, 3, 4]);
  assert.deepEqual(store.listTurns(id).map((t) => t.text), ["turn 1", "turn 2", "turn 3", "turn 4"]);
  assert.equal(calls.filter((c) => c === "turn:3").length, 3);
  assert.equal(store.get(id)?.attempt, 0);
});

test("retries used up -> system pause, turns kept, resume continues without duplicates", async () => {
  const { source } = fakeSource({ "turn:3": [transient("rate_limited"), transient("rate_limited"), transient("rate_limited")] });
  const { store, deps, id } = setup(source);
  await runHearing(deps, id);

  let v = store.view(id)!;
  assert.equal(v.status, "paused");
  assert.equal(v.pauseReason, "system");
  assert.equal(v.error?.code, "rate_limited");
  assert.match(v.error?.nextAction ?? "", /Resume/);
  assert.deepEqual(seqs(store, id), [1, 2]);
  assert.equal(v.canRule, false);

  assert.equal(store.requeue(id), true);
  await runHearing(deps, id);
  v = store.view(id)!;
  assert.equal(v.status, "complete");
  assert.deepEqual(seqs(store, id), [1, 2, 3, 4]);
});

test("permanent failure after some turns is partial: never rulable, retry resumes", async () => {
  const { source } = fakeSource({ "turn:3": [new SourceError("permanent", "auth_failed", "bad key")] });
  const { store, deps, id } = setup(source);
  await runHearing(deps, id);

  let v = store.view(id)!;
  assert.equal(v.status, "partial");
  assert.equal(v.error?.code, "auth_failed");
  assert.ok(v.error?.nextAction);
  assert.deepEqual(seqs(store, id), [1, 2]);
  assert.equal(v.canRule, false);
  assert.equal(store.recordRuling(id, "OVERTURNED"), "not_complete");

  assert.equal(store.requeue(id), true);
  await runHearing(deps, id);
  v = store.view(id)!;
  assert.equal(v.status, "complete");
  assert.deepEqual(seqs(store, id), [1, 2, 3, 4]);
});

test("permanent failure before any turn is failed, with a reason and next action", async () => {
  const { source } = fakeSource({ "turn:1": [new SourceError("permanent", "auth_failed", "bad key")] });
  const { store, deps, id } = setup(source);
  await runHearing(deps, id);
  const v = store.view(id)!;
  assert.equal(v.status, "failed");
  assert.equal(v.turns.length, 0);
  assert.ok(v.error?.message && v.error.nextAction);
  assert.equal(v.canRule, false);
});

test("all turns but no recommendation is still partial, not complete", async () => {
  const { source } = fakeSource({ verdict: [new SourceError("permanent", "request_rejected", "rejected")] });
  const { store, deps, id } = setup(source);
  await runHearing(deps, id);
  const v = store.view(id)!;
  assert.equal(v.status, "partial");
  assert.equal(v.turnCount, TOTAL);
  assert.equal(v.canRule, false);
  assert.equal(store.recordRuling(id, "UPHELD"), "not_complete");
});

test("a reviewer pause stops the hearing before the next turn and resume finishes it", async () => {
  // the source pauses the hearing the first time it is asked for turn 2 (a pause mid-flight)
  const ctx: { pause?: () => void } = {};
  let paused = false;
  const { source } = fakeSource({}, {
    onTurn: (seq) => {
      if (seq === 2 && !paused) {
        paused = true;
        ctx.pause?.();
      }
    },
  });
  const { store, deps, id } = setup(source);
  ctx.pause = () => store.pauseByReviewer(id);
  await runHearing(deps, id);

  let v = store.view(id)!;
  assert.equal(v.status, "paused");
  assert.equal(v.pauseReason, "reviewer");
  assert.deepEqual(seqs(store, id), [1]); // the in-flight turn is dropped, not half-saved

  assert.equal(store.requeue(id), true);
  await runHearing(deps, id);
  v = store.view(id)!;
  assert.equal(v.status, "complete");
  assert.deepEqual(seqs(store, id), [1, 2, 3, 4]);
});

test("two workers on one hearing cannot duplicate or reorder turns", async () => {
  const { source } = fakeSource();
  const { store, deps, id } = setup(source);
  await Promise.all([runHearing({ ...deps, workerId: "a" }, id), runHearing({ ...deps, workerId: "b" }, id)]);
  assert.equal(store.get(id)?.status, "complete");
  assert.deepEqual(seqs(store, id), [1, 2, 3, 4]);
});

test("appendTurn only accepts the next turn in the chain", () => {
  const { store, id } = setup(fakeSource().source);
  assert.equal(store.claim(id, "w"), true);
  const t = { id: "t", agent: "advocate" as const, type: "argument" as const, text: "x", addressedTo: null, evidenceRefs: [], durationMs: 1 };
  assert.equal(store.appendTurn(id, 2, t, "w").stored, false); // gap
  assert.equal(store.appendTurn(id, 1, t, "w").stored, true);
  assert.equal(store.appendTurn(id, 1, t, "w").stored, false); // duplicate
  assert.equal(store.appendTurn(id, 2, t, "other").stored, false); // not the owning worker
  assert.deepEqual(seqs(store, id), [1]);
});

test("a hearing whose server died mid-run is recovered and finishes with the same turns", async () => {
  const { source } = fakeSource();
  const { store, deps, id } = setup(source);
  assert.equal(store.claim(id, "dead-worker"), true);
  const t = { id: "t1", agent: "adjudicator" as const, type: "opening" as const, text: "turn 1", addressedTo: null, evidenceRefs: [], durationMs: 1 };
  store.appendTurn(id, 1, t, "dead-worker");

  assert.equal(store.recoverStale(30_000), 0); // heartbeat is fresh
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(store.recoverStale(1), 1); // pretend the heartbeat is older than 1ms
  assert.equal(store.get(id)?.status, "waiting");

  await runHearing(deps, id);
  assert.equal(store.get(id)?.status, "complete");
  assert.deepEqual(seqs(store, id), [1, 2, 3, 4]);
  assert.equal(store.listTurns(id)[0].text, "turn 1"); // the turn from before the crash survived
});

test("only a complete hearing can be ruled on, and only once", async () => {
  const { source } = fakeSource();
  const { store, deps, id } = setup(source);
  assert.equal(store.recordRuling(id, "OVERTURNED"), "not_complete");
  await runHearing(deps, id);
  assert.equal(store.recordRuling(id, "OVERTURNED"), "ok");
  assert.equal(store.recordRuling(id, "UPHELD"), "already_ruled");
  assert.equal(store.view(id)?.humanDecision, "OVERTURNED");
  assert.equal(store.recordRuling("nope", "UPHELD"), "not_found");
});
