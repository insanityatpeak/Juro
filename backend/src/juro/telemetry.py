"""
Local hearing telemetry for the Band agents: what each model call cost and how long turns took.

Every model-call attempt (including failures, refusals and retries), every rate-limit wait and every
turn outcome is appended as one JSON line to a local, gitignored file:

    backend/.telemetry/<room-folder>/<agent>.jsonl   (one file per agent process; no shared writes)

<room-folder> is the Band room id made filesystem-safe plus a short hash of the raw id, so every
room gets its own folder and no id can point outside .telemetry. Several hearings in one room are
split into RUNS: each code-written opening starts a new run (a fresh run id); the summary shows
the latest run by default.

Never recorded: message text, prompts, API keys, raw error bodies. Errors are stored as a kind
(rate_limited, quota_exhausted, provider_disabled, error) plus the exception class name only.
Token counts the provider does not report are stored as null ("unknown"), never 0.
Telemetry can never interrupt a hearing: every write swallows its own errors.

    python -m juro.telemetry summary                    # latest run of the most recent room
    python -m juro.telemetry summary <room> [--run N]   # a room (raw id or folder); run N (1 = first), default latest
    python -m juro.telemetry summary <room> --all       # every run in that room
    python -m juro.telemetry list                       # rooms on disk, with run counts

Disable with JURO_TELEMETRY=0; move with JURO_TELEMETRY_DIR=<path>.
Cleanup is manual: delete a room's folder under backend/.telemetry/, or the whole folder. Nothing
else reads these files. They hold counts, timings, room ids and agent names, never text or keys.
"""

from __future__ import annotations

import contextvars
import hashlib
import json
import logging
import os
import re
import sys
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
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


_AGENT_RE = re.compile(r"[a-z][a-z0-9_-]{0,31}")
_FOLDER_RE = re.compile(r"[A-Za-z0-9_-]{1,48}-[0-9a-f]{10}")
EVENTS = {"model_call", "wait", "turn_end"}


def room_folder(raw: object) -> str:
    """Filesystem-safe, collision-free folder name for a room id: no dots (so never '.' or '..'),
    no separators, bounded length, plus a hash of the raw id so 'room/a' and 'room_a' stay apart."""
    raw = str(raw if raw is not None else "")
    slug = re.sub(r"[^A-Za-z0-9_-]", "_", raw).strip("_")[:48] or "room"
    return f"{slug}-{hashlib.sha256(raw.encode('utf-8', 'replace')).hexdigest()[:10]}"


def agent_file(raw: object) -> str:
    """Agent names are roles; anything else is stored under a safe, hashed name."""
    raw = str(raw or "")
    return raw if _AGENT_RE.fullmatch(raw) else room_folder(raw or "unknown-agent")


def _inside(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _write(event: dict[str, Any]) -> None:
    """Append one event. Never raises: telemetry must not interrupt a hearing."""
    global _warned
    if not enabled():
        return
    try:
        root = base_dir()
        target = root / room_folder(event.get("hearing") or "no-hearing") / f"{agent_file(event.get('agent'))}.jsonl"
        if not _inside(root, target):  # defence in depth: the names above are already safe
            raise ValueError("telemetry path outside the telemetry folder")
        target.parent.mkdir(parents=True, exist_ok=True)
        now = time.time()  # UTC epoch seconds (durations elsewhere use time.monotonic())
        stamp = datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        line = json.dumps({"v": SCHEMA, "ts": round(now, 3), "utc": stamp, **event}, separators=(",", ":"))
        with open(target, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:  # noqa: BLE001
        if not _warned:
            _warned = True
            logger.warning("[TELEMETRY] could not write telemetry; continuing without it", exc_info=True)


def _ids() -> dict[str, Any]:
    hearing = _hearing.get()
    return {"hearing": hearing[:200] if isinstance(hearing, str) else hearing, "agent": _agent.get(),
            "turn": _turn.get(), "attempt": _attempt.get()}


def new_run_id() -> str:
    return f"run-{uuid.uuid4().hex[:10]}"


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


def wait(seconds: float, reason: str, planned: float | None = None) -> None:
    """Record a wait AFTER it ends: `seconds` is measured with time.monotonic(), `planned_s` is what was asked."""
    _write({**_ids(), "event": "wait", "seconds": round(seconds, 3), "planned_s": planned, "reason": reason})


def turn_end(outcome: str, duration_ms: int, run: str | None = None) -> None:
    """`run` is set only by the code-written opening: it starts a new run (hearing) in the room."""
    event = {**_ids(), "event": "turn_end", "outcome": outcome, "duration_ms": duration_ms}
    if run:
        event["run"] = run
    _write(event)


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


def resolve_folder(hearing: str, root: Path | None = None) -> Path | None:
    """A room's folder from its raw id or its folder name; None if it would fall outside the root."""
    root = root or base_dir()
    name = hearing if _FOLDER_RE.fullmatch(hearing or "") and (root / hearing).is_dir() else room_folder(hearing)
    folder = root / name
    return folder if _inside(root, folder) else None


def _valid(e: object) -> bool:
    return (isinstance(e, dict) and isinstance(e.get("ts"), (int, float)) and e.get("event") in EVENTS
            and (e.get("turn") is None or isinstance(e.get("turn"), str)))


def load_with_issues(hearing: str, root: Path | None = None) -> tuple[list[dict], int]:
    """(events, malformed line count). Torn or invalid lines (e.g. a crash mid-write) are skipped and counted."""
    folder = resolve_folder(hearing, root)
    events: list[dict] = []
    malformed = 0
    if folder is None or not folder.is_dir():
        return events, malformed
    for f in sorted(folder.glob("*.jsonl")):
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            malformed += 1
            continue
        for line in text.splitlines():
            if not line.strip():
                continue
            try:
                e = json.loads(line)
            except ValueError:
                malformed += 1
                continue
            if _valid(e):
                events.append(e)
            else:
                malformed += 1
    return sorted(events, key=lambda e: e["ts"]), malformed


def load(hearing: str, root: Path | None = None) -> list[dict]:
    return load_with_issues(hearing, root)[0]


def split_runs(events: list[dict]) -> list[tuple[str, list[dict]]]:
    """Split a room's events into runs: each code-written opening (turn_end carrying a run id) starts one.
    Events before the first opening form a run named 'before-first-opening'."""
    runs: list[tuple[str, list[dict]]] = []
    # Order by when each event was LOGGED (ts), not its computed start: the opening is logged before
    # the next agent is even called on, whereas a call's start (end - latency) can precede it.
    for e in sorted(events, key=lambda e: e["ts"]):
        if e.get("event") == "turn_end" and e.get("run"):
            runs.append((str(e["run"]), [e]))
        elif runs:
            runs[-1][1].append(e)
        else:
            runs.append(("before-first-opening", [e]))
    return runs


def _span(e: dict) -> tuple[float, float]:
    """(start, end) of an event. Calls, turns and waits are all logged when they END: start = end - duration."""
    ts = float(e.get("ts", 0))
    kind = e.get("event")
    if kind == "model_call":
        return ts - (e.get("latency_ms") or 0) / 1000, ts
    if kind == "turn_end":
        return ts - (e.get("duration_ms") or 0) / 1000, ts
    if kind == "wait":
        return ts - float(e.get("seconds") or 0), ts
    return ts, ts


def summarize(events: list[dict], malformed: int = 0) -> dict:
    turns: dict[str, dict] = {}
    calls_by_ts: list[tuple[float, int]] = []
    for e in events:
        tid = e.get("turn") or "(outside a turn)"
        start, end = _span(e)
        t = turns.setdefault(tid, {"turn": tid, "agent": e.get("agent"), "start": start, "end": end,
                                   "calls": 0, "failed_calls": 0, "input_tokens": None, "output_tokens": None,
                                   "missing_usage": 0, "missing_usage_failed": 0, "model_ms": 0, "wait_s": 0.0,
                                   "attempts": 0, "outcome": None})
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
                t["missing_usage_failed"] += 0 if e.get("ok") else 1
            # Unknown stays unknown: a turn's total is None until some call reports usage.
            if inp is not None:
                t["input_tokens"] = (t["input_tokens"] or 0) + int(inp)
            if out is not None:
                t["output_tokens"] = (t["output_tokens"] or 0) + int(out)
            if inp is not None or out is not None:
                calls_by_ts.append((float(e["ts"]), int(inp or 0) + int(out or 0)))
        elif kind == "wait":
            t["wait_s"] += float(e.get("seconds") or 0)
        elif kind == "turn_end":
            t["outcome"] = e.get("outcome")
    rows = sorted(turns.values(), key=lambda r: r["start"])
    for r in rows:
        r["retries"] = max(0, r["attempts"] - 1)
    peak = 0
    calls_by_ts.sort()
    for i, (ts, _) in enumerate(calls_by_ts):
        peak = max(peak, sum(tok for t2, tok in calls_by_ts[i:] if t2 - ts < 60))
    # Wall clock: earliest start to latest end across all agents (not a sum of turn durations,
    # which would double-count turns that overlap and miss idle gaps between them).
    spans = [_span(e) for e in events]
    span = (max(end for _, end in spans) - min(start for start, _ in spans)) if spans else 0.0

    def known_sum(key: str) -> int | None:
        vals = [r[key] for r in rows if r[key] is not None]
        return sum(vals) if vals else None

    return {
        "turns": rows,
        "totals": {
            "wall_clock_s": round(span, 1),
            "model_calls": sum(r["calls"] for r in rows),
            "failed_calls": sum(r["failed_calls"] for r in rows),
            "input_tokens": known_sum("input_tokens"),
            "output_tokens": known_sum("output_tokens"),
            "missing_usage": sum(r["missing_usage"] for r in rows),
            "missing_usage_failed": sum(r["missing_usage_failed"] for r in rows),
            "retries": sum(r["retries"] for r in rows),
            "wait_s": round(sum(r["wait_s"] for r in rows), 1),
            "model_s": round(sum(r["model_ms"] for r in rows) / 1000, 1),
            "peak_tokens_60s": peak,
            "incomplete_turns": sum(1 for r in rows if r["outcome"] is None and r["turn"] != "(outside a turn)"),
            "malformed_lines": malformed,
        },
    }


def _n(v: int | None) -> str:
    return "?" if v is None else str(v)


def format_summary(hearing: str, s: dict, run: str | None = None) -> str:
    lines = [f"Hearing {hearing}" + (f" - {run}" if run else "")]
    lines.append(f"{'agent':<12}{'calls':>6}{'failed':>7}{'in tok':>8}{'out tok':>8}{'unknown':>8}{'retries':>8}{'wait s':>8}{'model s':>8}  outcome")
    for r in s["turns"]:
        lines.append(f"{(r['agent'] or '?'):<12}{r['calls']:>6}{r['failed_calls']:>7}{_n(r['input_tokens']):>8}{_n(r['output_tokens']):>8}"
                     f"{r['missing_usage']:>8}{r['retries']:>8}{r['wait_s']:>8.1f}{r['model_ms'] / 1000:>8.1f}  {r['outcome'] or '(incomplete: no end recorded)'}")
    t = s["totals"]
    unknown = ""
    if t["missing_usage"]:
        unknown = f" + {t['missing_usage']} call(s) with unknown usage"
        if t["missing_usage_failed"]:
            unknown += f" ({t['missing_usage_failed']} of them failed calls)"
    lines.append(f"Total: {t['model_calls']} model calls ({t['failed_calls']} failed), "
                 f"{_n(t['input_tokens'])} in / {_n(t['output_tokens'])} out tokens (known){unknown}")
    lines.append(f"Time: {t['wall_clock_s']}s wall clock (earliest start to latest end, all agents), {t['model_s']}s in model calls, "
                 f"{t['wait_s']}s waiting on rate limits (measured), {t['retries']} retries")
    lines.append(f"Peak observed tokens in any 60s window: {t['peak_tokens_60s']} "
                 f"(calls that reported usage only{'; ' + str(t['missing_usage']) + ' without usage not counted, so this can understate' if t['missing_usage'] else ''}). "
                 "An observation for comparing with your tokens-per-minute limit, not Groq's own quota accounting.")
    if t["incomplete_turns"]:
        lines.append(f"Warning: {t['incomplete_turns']} turn(s) have no recorded end (still running, crashed, or the log was cut off).")
    if t["malformed_lines"]:
        lines.append(f"Warning: {t['malformed_lines']} malformed or truncated log line(s) were skipped.")
    return "\n".join(lines)


def _hearings(root: Path) -> list[Path]:
    dirs = [p for p in root.glob("*") if p.is_dir() and _FOLDER_RE.fullmatch(p.name)]
    return sorted(dirs, key=lambda p: max((f.stat().st_mtime for f in p.glob("*.jsonl")), default=0))


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    root = base_dir()
    if not argv or argv[0] not in ("summary", "list"):
        print(__doc__.split("\n\n")[0])
        print("usage: python -m juro.telemetry summary [room] [--run N | --all] | list")
        return 2
    found = _hearings(root) if root.exists() else []
    if argv[0] == "list":
        for p in found:
            events, bad = load_with_issues(p.name, root)
            raw = next((e.get("hearing") for e in events if e.get("hearing")), "?")
            print(f"{p.name}  room={raw}  runs={len(split_runs(events))}{f'  malformed={bad}' if bad else ''}")
        return 0
    args = argv[1:]
    want_all = "--all" in args
    run_n = None
    if "--run" in args:
        try:
            run_n = int(args[args.index("--run") + 1])
        except (IndexError, ValueError):
            print("--run needs a number (1 = first run in the room)")
            return 2
    positional = [a for i, a in enumerate(args) if not a.startswith("--") and not (i > 0 and args[i - 1] == "--run")]
    if positional:
        hearing = positional[0]
    elif found:
        hearing = found[-1].name
    else:
        print(f"No telemetry in {root}. Run a hearing with the Band agents first.")
        return 1
    if resolve_folder(hearing, root) is None:
        print("That room id does not map to a folder inside the telemetry directory.")
        return 2
    events, malformed = load_with_issues(hearing, root)
    if not events:
        print(f"No telemetry for room {hearing} in {root}." + (f" ({malformed} malformed line(s) skipped.)" if malformed else ""))
        return 1
    runs = split_runs(events)
    if want_all:
        chosen = list(enumerate(runs, 1))
    else:
        idx = run_n if run_n is not None else len(runs)
        if not 1 <= idx <= len(runs):
            print(f"Room has {len(runs)} run(s); choose --run 1..{len(runs)}.")
            return 2
        chosen = [(idx, runs[idx - 1])]
    for n, (run_id, evs) in chosen:
        # Malformed lines can't be attributed to a run, so they are reported with every run shown.
        print(format_summary(hearing, summarize(evs, malformed), run=f"run {n} of {len(runs)} ({run_id})"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
