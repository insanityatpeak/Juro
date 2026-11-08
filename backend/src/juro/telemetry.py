"""
Local hearing telemetry for the Band agents: what each model call cost and how long turns took.

Every model-call attempt (including failures, refusals and retries), every rate-limit wait and every
turn outcome is appended as one JSON line to a local, gitignored file:

    backend/.telemetry/<hearing>/<agent>.jsonl     (one file per agent process; no shared writes)

The hearing id is the Band room id. Use a fresh room per hearing.

Never recorded: message text, prompts, API keys, raw error bodies. Errors are stored as a kind
(rate_limited, quota_exhausted, provider_disabled, error) plus the exception class name only.
Token counts the provider does not report are stored as null ("unknown"), never 0.
Telemetry can never interrupt a hearing: every write swallows its own errors.

    python -m juro.telemetry summary            # most recent hearing
    python -m juro.telemetry summary <hearing>  # a specific hearing (room id)
    python -m juro.telemetry list               # hearings on disk

Disable with JURO_TELEMETRY=0; move with JURO_TELEMETRY_DIR=<path>.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import re
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

logger = logging.getLogger(__name__)

SCHEMA = 1
_DEFAULT_DIR = Path(__file__).resolve().parents[2] / ".telemetry"

_hearing: contextvars.ContextVar[str | None] = contextvars.ContextVar("juro_hearing", default=None)
_agent: contextvars.ContextVar[str | None] = contextvars.ContextVar("juro_agent", default=None)
_turn: contextvars.ContextVar[str | None] = contextvars.ContextVar("juro_turn", default=None)
_attempt: contextvars.ContextVar[int] = contextvars.ContextVar("juro_attempt", default=0)
_call_seq: contextvars.ContextVar[list[int] | None] = contextvars.ContextVar("juro_call_seq", default=None)

_warned = False


def enabled() -> bool:
    return os.environ.get("JURO_TELEMETRY", "1") != "0"


def base_dir() -> Path:
    return Path(os.environ.get("JURO_TELEMETRY_DIR") or _DEFAULT_DIR)


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", name)[:120] or "unknown"


def _write(event: dict[str, Any]) -> None:
    """Append one event. Never raises: telemetry must not interrupt a hearing."""
    global _warned
    if not enabled():
        return
    try:
        hearing = event.get("hearing") or "no-hearing"
        agent = event.get("agent") or "unknown-agent"
        folder = base_dir() / _safe(hearing)
        folder.mkdir(parents=True, exist_ok=True)
        line = json.dumps({"v": SCHEMA, "ts": round(time.time(), 3), **event}, separators=(",", ":"))
        with open(folder / f"{_safe(agent)}.jsonl", "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:  # noqa: BLE001
        if not _warned:
            _warned = True
            logger.warning("[TELEMETRY] could not write telemetry; continuing without it", exc_info=True)


def _ids() -> dict[str, Any]:
    return {"hearing": _hearing.get(), "agent": _agent.get(), "turn": _turn.get(), "attempt": _attempt.get()}


@contextmanager
def turn(hearing: str, agent: str) -> Iterator[str]:
    """Scope one agent turn: every model call and wait inside it carries these ids."""
    turn_id = f"{agent}-{uuid.uuid4().hex[:8]}"
    tokens = (_hearing.set(hearing), _agent.set(agent), _turn.set(turn_id), _attempt.set(0), _call_seq.set([0]))
    try:
        yield turn_id
    finally:
        for var, tok in zip((_hearing, _agent, _turn, _attempt, _call_seq), tokens):
            try:
                var.reset(tok)
            except Exception:  # noqa: BLE001 - reset across contexts can fail; never interrupt
                pass


def set_attempt(n: int) -> None:
    _attempt.set(n)


def _next_call() -> int:
    seq = _call_seq.get()
    if seq is None:
        return 0
    seq[0] += 1
    return seq[0]


def model_call(*, model: str, ok: bool, latency_ms: int, input_tokens: int | None, output_tokens: int | None,
               error_kind: str | None = None, error_type: str | None = None) -> None:
    _write({**_ids(), "event": "model_call", "call": _next_call(), "model": model, "ok": ok, "latency_ms": latency_ms,
            "input_tokens": input_tokens, "output_tokens": output_tokens, "error_kind": error_kind, "error_type": error_type})


def wait(seconds: float, reason: str) -> None:
    _write({**_ids(), "event": "wait", "seconds": round(seconds, 3), "reason": reason})


def turn_end(outcome: str, duration_ms: int) -> None:
    _write({**_ids(), "event": "turn_end", "outcome": outcome, "duration_ms": duration_ms})


def usage_from(obj: Any) -> tuple[int | None, int | None]:
    """Input/output tokens from a LangChain message/chunk/result; None when not reported."""
    for candidate in (obj, getattr(obj, "message", None)):
        meta = getattr(candidate, "usage_metadata", None)
        if isinstance(meta, dict) and ("input_tokens" in meta or "output_tokens" in meta):
            return meta.get("input_tokens"), meta.get("output_tokens")
    llm_output = getattr(obj, "llm_output", None)
    if isinstance(llm_output, dict):
        usage = llm_output.get("token_usage") or {}
        if usage:
            return usage.get("prompt_tokens"), usage.get("completion_tokens")
    gens = getattr(obj, "generations", None)
    if gens:
        return usage_from(gens[0])
    return None, None


# --------------------------------------------------------------------------- summary


def load(hearing: str, root: Path | None = None) -> list[dict]:
    events = []
    for f in sorted((root or base_dir()).joinpath(_safe(hearing)).glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            try:
                events.append(json.loads(line))
            except ValueError:
                continue  # a torn line from a crash: skip it
    return sorted(events, key=lambda e: e.get("ts", 0))


def _span(e: dict) -> tuple[float, float]:
    """(start, end) of an event. Calls and turns are logged when they END, so start = end - duration;
    a wait is logged when it BEGINS, so end = start + seconds."""
    ts = float(e.get("ts", 0))
    kind = e.get("event")
    if kind == "model_call":
        return ts - (e.get("latency_ms") or 0) / 1000, ts
    if kind == "turn_end":
        return ts - (e.get("duration_ms") or 0) / 1000, ts
    if kind == "wait":
        return ts, ts + float(e.get("seconds") or 0)
    return ts, ts


def summarize(events: list[dict]) -> dict:
    turns: dict[str, dict] = {}
    calls_by_ts: list[tuple[float, int]] = []
    for e in events:
        tid = e.get("turn") or "(outside a turn)"
        start, end = _span(e)
        t = turns.setdefault(tid, {"turn": tid, "agent": e.get("agent"), "start": start, "end": end,
                                   "calls": 0, "failed_calls": 0, "input_tokens": 0, "output_tokens": 0,
                                   "missing_usage": 0, "model_ms": 0, "wait_s": 0.0, "attempts": 0, "outcome": None})
        t["start"], t["end"] = min(t["start"], start), max(t["end"], end)
        t["attempts"] = max(t["attempts"], int(e.get("attempt") or 0) + 1)
        kind = e.get("event")
        if kind == "model_call":
            t["calls"] += 1
            t["failed_calls"] += 0 if e.get("ok") else 1
            t["model_ms"] += int(e.get("latency_ms") or 0)
            inp, out = e.get("input_tokens"), e.get("output_tokens")
            if inp is None or out is None:
                t["missing_usage"] += 1
            t["input_tokens"] += inp or 0
            t["output_tokens"] += out or 0
            if inp is not None or out is not None:
                calls_by_ts.append((e["ts"], (inp or 0) + (out or 0)))
        elif kind == "wait":
            t["wait_s"] += float(e.get("seconds") or 0)
        elif kind == "turn_end":
            t["outcome"] = e.get("outcome")
    rows = sorted(turns.values(), key=lambda r: r["start"])
    for r in rows:
        r["retries"] = max(0, r["attempts"] - 1)
    peak = 0
    for i, (ts, _) in enumerate(calls_by_ts):
        peak = max(peak, sum(tok for t2, tok in calls_by_ts[i:] if t2 - ts < 60))
    # Wall clock: earliest start to latest end across all agents (not a sum of turn durations,
    # which would double-count turns that overlap and miss idle gaps between them).
    spans = [_span(e) for e in events]
    span = (max(end for _, end in spans) - min(start for start, _ in spans)) if spans else 0.0
    return {
        "turns": rows,
        "totals": {
            "wall_clock_s": round(span, 1),
            "model_calls": sum(r["calls"] for r in rows),
            "failed_calls": sum(r["failed_calls"] for r in rows),
            "input_tokens": sum(r["input_tokens"] for r in rows),
            "output_tokens": sum(r["output_tokens"] for r in rows),
            "missing_usage": sum(r["missing_usage"] for r in rows),
            "retries": sum(r["retries"] for r in rows),
            "wait_s": round(sum(r["wait_s"] for r in rows), 1),
            "model_s": round(sum(r["model_ms"] for r in rows) / 1000, 1),
            "peak_tokens_60s": peak,
        },
    }


def format_summary(hearing: str, s: dict) -> str:
    lines = [f"Hearing {hearing}"]
    lines.append(f"{'agent':<12}{'calls':>6}{'failed':>7}{'in tok':>8}{'out tok':>8}{'unknown':>8}{'retries':>8}{'wait s':>8}{'model s':>8}  outcome")
    for r in s["turns"]:
        lines.append(f"{(r['agent'] or '?'):<12}{r['calls']:>6}{r['failed_calls']:>7}{r['input_tokens']:>8}{r['output_tokens']:>8}"
                     f"{r['missing_usage']:>8}{r['retries']:>8}{r['wait_s']:>8.1f}{r['model_ms'] / 1000:>8.1f}  {r['outcome'] or '(no end recorded)'}")
    t = s["totals"]
    unknown = f" + {t['missing_usage']} call(s) with unknown usage" if t["missing_usage"] else ""
    lines.append(f"Total: {t['model_calls']} model calls ({t['failed_calls']} failed), "
                 f"{t['input_tokens']} in / {t['output_tokens']} out tokens{unknown}")
    lines.append(f"Time: {t['wall_clock_s']}s wall clock (earliest start to latest end, all agents), {t['model_s']}s in model calls, {t['wait_s']}s waiting on rate limits, {t['retries']} retries")
    lines.append(f"Peak observed tokens in any 60s window: {t['peak_tokens_60s']} "
                 f"(calls that reported usage only{'; ' + str(t['missing_usage']) + ' without usage not counted, so this can understate' if t['missing_usage'] else ''}). "
                 "An observation for comparing with your tokens-per-minute limit, not Groq's own quota accounting.")
    return "\n".join(lines)


def _hearings(root: Path) -> list[Path]:
    return sorted((p for p in root.glob("*") if p.is_dir()), key=lambda p: max((f.stat().st_mtime for f in p.glob("*.jsonl")), default=0))


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    root = base_dir()
    if not argv or argv[0] not in ("summary", "list"):
        print(__doc__.split("\n\n")[0])
        print("usage: python -m juro.telemetry summary [hearing] | list")
        return 2
    found = _hearings(root) if root.exists() else []
    if argv[0] == "list":
        for p in found:
            print(p.name)
        return 0
    if len(argv) > 1:
        hearing = argv[1]
    elif found:
        hearing = found[-1].name
    else:
        print(f"No telemetry in {root}. Run a hearing with the Band agents first.")
        return 1
    events = load(hearing, root)
    if not events:
        print(f"No telemetry for hearing {hearing} in {root}.")
        return 1
    print(format_summary(hearing, summarize(events)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
