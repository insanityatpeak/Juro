import assert from "node:assert/strict";
import { test } from "node:test";
import { CASES } from "../../data/cases";
import { GENESIS_HASH, nextHash } from "../hash";
import type { Faction, TurnType } from "../types";
import { openDb } from "./db";
import { runHearing, type RunnerDeps } from "./runner";
import { SourceError, type TurnSource } from "./source";
import { createStore, hashControlToken, newControlToken } from "./store";

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

test("a reviewer pause lets the active step finish and saves it, then stops; resume finishes", async () => {
  // the reviewer presses Pause while turn 2 is being generated
  const ctx: { pause?: () => void } = {};
  let paused = false;
  const { source, calls } = fakeSource({}, {
    onTurn: (seq) => {
      if (seq === 2 && !paused) {
        paused = true;
        ctx.pause?.();
      }
    },
  });
  const { store, deps, id } = setup(source);
  ctx.pause = () => assert.equal(store.requestPause(id), "pausing");
  await runHearing(deps, id);

  let v = store.view(id)!;
  assert.equal(v.status, "paused");
  assert.equal(v.pauseReason, "reviewer");
  assert.equal(v.pauseRequested, false);
  assert.deepEqual(seqs(store, id), [1, 2]); // the paid-for in-flight turn is kept
  assert.deepEqual(calls, ["turn:1", "turn:2"]); // nothing started after the pause
  assert.match(v.error?.nextAction ?? "", /turn 3 of 4/);

  assert.equal(store.requeue(id), true);
  await runHearing(deps, id);
  v = store.view(id)!;
  assert.equal(v.status, "complete");
  assert.deepEqual(seqs(store, id), [1, 2, 3, 4]);
  assert.equal(calls.filter((c) => c === "turn:2").length, 1); // resume did not redo the saved turn
});

test("a pause requested during a step that then fails pauses without retrying", async () => {
  const ctx: { pause?: () => void } = {};
  const { source, calls } = fakeSource({ "turn:2": [transient()] }, { onTurn: (seq) => seq === 2 && ctx.pause?.() });
  const { store, deps, id } = setup(source);
  ctx.pause = () => store.requestPause(id);
  await runHearing(deps, id);

  const v = store.view(id)!;
  assert.equal(v.status, "paused");
  assert.equal(v.pauseReason, "reviewer");
  assert.equal(v.error?.code, "upstream_error"); // the reviewer sees why the step did not land
  assert.deepEqual(seqs(store, id), [1]);
  assert.equal(calls.filter((c) => c === "turn:2").length, 1); // no retry
});

test("a pause requested during the final recommendation still completes the hearing", async () => {
  const ctx: { pause?: () => void } = {};
  const { source } = fakeSource();
  const verdict = source.generateVerdict.bind(source);
  source.generateVerdict = async (entry, turns) => {
    ctx.pause?.();
    return verdict(entry, turns);
  };
  const { store, deps, id } = setup(source);
  ctx.pause = () => assert.equal(store.requestPause(id), "pausing");
  await runHearing(deps, id);

  const v = store.view(id)!;
  assert.equal(v.status, "complete"); // no work remains to pause
  assert.equal(v.pauseRequested, false);
  assert.equal(v.canRule, true);
});

test("pausing a queued hearing is immediate; a pending pause can be withdrawn", async () => {
  const { store, id } = setup(fakeSource().source);
  assert.equal(store.requestPause(id), "paused");
  assert.equal(store.get(id)?.status, "paused");
  assert.equal(store.requestPause(id), "invalid");

  assert.equal(store.requeue(id), true);
  assert.equal(store.claim(id, "w"), true);
  assert.equal(store.requestPause(id), "pausing");
  assert.equal(store.cancelPause(id), true);
  assert.equal(store.view(id)?.pauseRequested, false);
  assert.equal(store.cancelPause(id), false);
});

test("a stale worker cannot retry-note, pause, fail or settle a hearing a newer worker owns", () => {
  const { store, id } = setup(fakeSource().source);
  assert.equal(store.claim(id, "old"), true);
  assert.equal(store.recoverStale(-1000), 1); // old worker's heartbeat counts as stale
  assert.equal(store.claim(id, "new"), true);

  assert.equal(store.noteRetry(id, "old", 1, "timeout", "late"), false);
  assert.equal(store.pauseBySystem(id, "old", "timeout", "late", "x"), false);
  assert.equal(store.failPermanently(id, "old", "auth_failed", "late", "x"), null);
  store.requestPause(id);
  assert.equal(store.settlePause(id, "old", "x"), false);

  const row = store.get(id)!;
  assert.equal(row.status, "running");
  assert.equal(row.worker_id, "new");
  assert.equal(row.error_code, null);
});

test("a worker that loses ownership while its request is pending saves nothing", async () => {
  const ctx: { steal?: () => void } = {};
  const { source } = fakeSource({}, { onTurn: (seq) => seq === 2 && ctx.steal?.() });
  const { store, deps, id } = setup(source);
  ctx.steal = () => {
    store.recoverStale(-1000);
    store.claim(id, "new");
  };
  await runHearing({ ...deps, workerId: "old" }, id);

  assert.deepEqual(seqs(store, id), [1]); // old worker's turn 2 was refused
  assert.equal(store.get(id)?.worker_id, "new");
  assert.equal(store.get(id)?.status, "running");
});

test("a dead worker with a pending pause request recovers to paused, not back to the queue", () => {
  const { store, id } = setup(fakeSource().source);
  store.claim(id, "dead");
  store.requestPause(id);
  assert.equal(store.recoverStale(-1000), 1);
  const v = store.view(id)!;
  assert.equal(v.status, "paused");
  assert.equal(v.pauseReason, "reviewer");
});

test("a disabled provider fails the hearing permanently with a next action", async () => {
  const { source } = fakeSource({ "turn:1": [new SourceError("permanent", "provider_disabled", "off")] });
  const { store, deps, id } = setup(source);
  await runHearing(deps, id);
  const v = store.view(id)!;
  assert.equal(v.status, "failed");
  assert.equal(v.error?.code, "provider_disabled");
  assert.match(v.error?.nextAction ?? "", /sample/);
});

test("only the holder of the control token controls a hearing", () => {
  const store = createStore(openDb(":memory:"));
  const token = newControlToken();
  const h = store.create({ caseId: CASES[0].id, mode: "sample", totalTurns: TOTAL, controlTokenHash: hashControlToken(token) });
  assert.equal(store.isController(h.id, token), true);
  assert.equal(store.isController(h.id, newControlToken()), false);
  assert.equal(store.isController(h.id, null), false);
  const legacy = store.create({ caseId: CASES[0].id, mode: "sample", totalTurns: TOTAL });
  assert.equal(store.isController(legacy.id, token), false); // no token on record: nobody controls it
  assert.equal(store.view(legacy.id)?.controllable, false);
  assert.equal(store.view(h.id)?.controllable, true);
  assert.equal(store.openCount(), 2);
});

// Note: better-sqlite3 calls are synchronous, so this interleaves rather than truly races; the
// cross-process guarantee comes from BEGIN IMMEDIATE taking the write lock before the count.
test("the queue cap holds across two connections to the same database file", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "juro-admit-"));
  const file = path.join(dir, "h.db");
  const a = createStore(openDb(file));
  const b = createStore(openDb(file));
  const input = { caseId: CASES[0].id, mode: "sample" as const, totalTurns: TOTAL };
  // Interleave admissions from two connections against a cap of 3.
  const results = [a, b, a, b, a, b].map((s) => s.createIfRoom(input, 3));
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(a.openCount(), 3);
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
