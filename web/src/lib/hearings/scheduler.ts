import { CASES } from "../../data/cases";
import { runHearing, type RunnerDeps } from "./runner";
import { getSource } from "./source";
import { getStore } from "./store";

const TICK_MS = 1000;
const STALE_MS = 30000; // a "running" hearing with no heartbeat for this long lost its worker
const MAX_CONCURRENT = 2;

type SchedulerState = { active: Set<string>; timer: NodeJS.Timeout | null };
const g = globalThis as unknown as { __juroScheduler?: SchedulerState };

function deps(): RunnerDeps {
  return { store: getStore(), getEntry: (id) => CASES.find((c) => c.id === id), getSource };
}

/** Pick up queued hearings (and any whose worker died). Runs inside the Node server process. */
export function tick(): void {
  const s = g.__juroScheduler;
  if (!s) return;
  const store = getStore();
  store.recoverStale(STALE_MS);
  for (const id of store.waitingIds()) {
    if (s.active.size >= MAX_CONCURRENT) break;
    if (s.active.has(id)) continue;
    s.active.add(id);
    void runHearing(deps(), id)
      .catch((e) => console.error("[hearings] runner crashed", id, e))
      .finally(() => s.active.delete(id));
  }
}

/** Start the background worker once per server process. Safe to call from anywhere. */
export function ensureWorker(): void {
  if (!g.__juroScheduler) {
    g.__juroScheduler = { active: new Set(), timer: null };
  }
  const s = g.__juroScheduler;
  if (!s.timer) {
    s.timer = setInterval(tick, TICK_MS);
    s.timer.unref?.();
  }
  tick();
}
