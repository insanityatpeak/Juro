"""Regression tests for the PR #4 review: safe paths, runs, malformed logs, timing, usage, isolation."""

import asyncio
import json
import os
import re
import socket
import time

import pytest

from juro import telemetry
from juro.relay import run_turn

# ---------------------------------------------------------------- ids and paths


@pytest.mark.parametrize("room", ["..", ".", "../escape", "a/../../b", "/abs/path", "C:\\win\\path", "", "x" * 500, "naïve room"])
def test_room_ids_always_map_inside_the_telemetry_folder(room, _telemetry_in_tmp):
    folder = telemetry.room_folder(room)
    assert re.fullmatch(r"[A-Za-z0-9_-]{1,48}-[0-9a-f]{10}", folder)
    assert "." not in folder and "/" not in folder and "\\" not in folder
    with telemetry.turn(room, "advocate"):
        telemetry.turn_end("posted", 1)
    written = list(_telemetry_in_tmp.rglob("*.jsonl"))
    assert len(written) == 1
    assert written[0].resolve().is_relative_to(_telemetry_in_tmp.resolve())
    assert not list(_telemetry_in_tmp.parent.glob("*.jsonl"))  # nothing escaped one level up


def test_distinct_rooms_never_share_a_folder():
    names = {telemetry.room_folder(r) for r in ("room/a", "room_a", "room a", "room:a", "ROOM_A")}
    assert len(names) == 5


def test_agent_names_are_validated():
    assert telemetry.agent_file("advocate") == "advocate"
    for bad in ("../advocate", "Advocate", "a/b", "", "x" * 40):
        name = telemetry.agent_file(bad)
        assert "/" not in name and "." not in name and name != bad


def test_cli_cannot_be_pointed_outside_the_folder(_telemetry_in_tmp, capsys):
    outside = _telemetry_in_tmp.parent / "outside"
    outside.mkdir(parents=True)
    (outside / "advocate.jsonl").write_text(json.dumps({"ts": 1.0, "event": "turn_end", "turn": "t", "outcome": "posted"}) + "\n")
    assert telemetry.main(["summary", "../outside"]) == 1  # mapped to a hashed folder inside: nothing there
    assert "No telemetry" in capsys.readouterr().out


# ---------------------------------------------------------------- runs


def _opening(room):
    with telemetry.turn(room, "adjudicator"):
        telemetry.turn_end("code_opening", 0, run=telemetry.new_run_id())


def _debater_turn(room, tokens):
    with telemetry.turn(room, "advocate"):
        telemetry.model_call(model="m", ok=True, latency_ms=5, input_tokens=tokens, output_tokens=1)
        telemetry.turn_end("posted", 6)


def test_repeated_hearings_in_one_room_are_separate_runs(_telemetry_in_tmp, capsys):
    _opening("room-r")
    _debater_turn("room-r", 100)
    time.sleep(0.01)
    _opening("room-r")
    _debater_turn("room-r", 200)
    runs = telemetry.split_runs(telemetry.load("room-r"))
    assert len(runs) == 2 and runs[0][0] != runs[1][0]
    assert [telemetry.summarize(evs)["totals"]["input_tokens"] for _, evs in runs] == [100, 200]

    assert telemetry.main(["summary", "room-r"]) == 0  # default: the latest run
    out = capsys.readouterr().out
    assert "run 2 of 2" in out and "200 in" in out and "100 in" not in out
    assert telemetry.main(["summary", "room-r", "--run", "1"]) == 0
    assert "100 in" in capsys.readouterr().out
    assert telemetry.main(["summary", "room-r", "--all"]) == 0
    assert capsys.readouterr().out.count("Hearing room-r") == 2
    assert telemetry.main(["summary", "room-r", "--run", "9"]) == 2


def test_events_before_any_opening_form_their_own_run():
    evs = [{"ts": 1.0, "event": "turn_end", "turn": "t", "agent": "advocate", "outcome": "posted", "duration_ms": 0}]
    assert telemetry.split_runs(evs)[0][0] == "before-first-opening"


# ---------------------------------------------------------------- malformed logs and incomplete turns


def test_truncated_and_invalid_lines_are_counted_not_fatal(_telemetry_in_tmp, capsys):
    _debater_turn("room-m", 10)
    log = next(_telemetry_in_tmp.rglob("advocate.jsonl"))
    with open(log, "a", encoding="utf-8") as f:
        f.write('{"ts": 5, "event": "model_call", "turn": "x"\n')  # torn line (crash mid-write)
        f.write("not json at all\n")
        f.write('["a", "list"]\n')  # valid JSON, wrong shape
        f.write('{"event": "model_call"}\n')  # no timestamp
        f.write('{"ts": 6, "event": "bogus"}\n')  # unknown event
        f.write('{"ts": 7, "event": "turn_end"')  # final line cut off, no newline
    events, bad = telemetry.load_with_issues("room-m")
    assert bad == 6 and len(events) == 2
    assert telemetry.main(["summary", "room-m"]) == 0
    out = capsys.readouterr().out
    assert "6 malformed or truncated log line(s) were skipped" in out and "room-wide" in out


def test_turns_without_an_end_are_reported_incomplete(_telemetry_in_tmp, capsys):
    with telemetry.turn("room-i", "scrutinizer"):
        telemetry.model_call(model="m", ok=True, latency_ms=5, input_tokens=3, output_tokens=4)
        # the process died here: no turn_end
    s = telemetry.summarize(telemetry.load("room-i"))
    assert s["totals"]["incomplete_turns"] == 1
    assert telemetry.main(["summary", "room-i"]) == 0
    out = capsys.readouterr().out
    assert "1 turn(s) have no recorded end" in out and "(incomplete: no end recorded)" in out


# ---------------------------------------------------------------- timing


def test_timestamps_are_utc_and_durations_monotonic(_telemetry_in_tmp, monkeypatch):
    with telemetry.turn("room-t", "advocate"):
        telemetry.turn_end("posted", 5)
    e = telemetry.load("room-t")[0]
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", e["utc"])
    assert abs(e["ts"] - time.time()) < 5

    # A wall-clock jump during a wait must not change the recorded (monotonic) wait.
    wall = iter([1000.0, 5000.0])
    monkeypatch.setattr(telemetry.time, "time", lambda: next(wall, 9999.0))

    class _429(Exception):
        response = type("R", (), {"status_code": 429, "headers": {"retry-after": "3"}})()

    steps = [_429("tokens per minute"), "ok"]
    state = {"sent": False}

    async def invoke():
        step = steps.pop(0)
        if isinstance(step, Exception):
            raise step
        state["sent"] = True

    async def short_sleep(_s):
        await asyncio.sleep(0.05)

    async def noop(*a, **k):
        return None

    async def reviewer():
        return "Priya"

    with telemetry.turn("room-w", "advocate"):
        asyncio.run(run_turn(label="Advocate", invoke=invoke, reset=lambda: state.update(sent=False),
                             sent=lambda: state["sent"], final_text=lambda: "", send=noop, forced=["Scrutinizer"],
                             reviewer=reviewer, sleep=short_sleep))
    wait = [e for e in telemetry.load("room-w") if e["event"] == "wait"][0]
    assert wait["planned_s"] == 3.0 and 0.03 <= wait["seconds"] < 1.0


# ---------------------------------------------------------------- usage


def test_mixed_known_and_unknown_usage_keeps_both():
    evs = [
        {"ts": 1.0, "event": "model_call", "turn": "t", "agent": "advocate", "attempt": 0, "ok": True, "latency_ms": 1, "input_tokens": 100, "output_tokens": 10},
        {"ts": 2.0, "event": "model_call", "turn": "t", "agent": "advocate", "attempt": 0, "ok": True, "latency_ms": 1, "input_tokens": None, "output_tokens": None},
        {"ts": 3.0, "event": "model_call", "turn": "u", "agent": "evidence", "attempt": 0, "ok": False, "latency_ms": 1, "input_tokens": None, "output_tokens": None},
    ]
    s = telemetry.summarize(evs)
    t, u = s["turns"]
    assert (t["input_tokens"], t["missing_usage"]) == (100, 1)
    assert (u["input_tokens"], u["missing_usage"], u["missing_usage_failed"]) == (None, 1, 1)
    assert (s["totals"]["input_tokens"], s["totals"]["missing_usage"], s["totals"]["missing_usage_failed"]) == (100, 2, 1)
    text = telemetry.format_summary("h", s)
    assert "2 call(s) with unknown usage (1 of them failed calls)" in text
    assert re.search(r"evidence\s+1\s+1\s+\?\s+\?", text)  # unknown shown as '?', not 0


langchain_groq = pytest.importorskip("langchain_groq")


def test_streaming_generate_is_recorded_once_not_twice(monkeypatch, _telemetry_in_tmp):
    """ChatGroq(streaming=True)._agenerate calls self._astream: both are wrapped, only one may record."""
    from langchain_core.messages import AIMessageChunk, HumanMessage
    from langchain_core.outputs import ChatGenerationChunk

    for k, v in {"JURO_LIVE_PROVIDER": "groq", "GROQ_API_KEY": "gsk_x", "JURO_GROQ_FREE_CONFIRMED": "1"}.items():
        monkeypatch.setenv(k, v)

    async def fake_astream(self, messages, stop=None, run_manager=None, **kw):
        yield ChatGenerationChunk(message=AIMessageChunk(content="arg", usage_metadata={"input_tokens": 50, "output_tokens": 5, "total_tokens": 55}))

    monkeypatch.setattr(langchain_groq.ChatGroq, "_astream", fake_astream)
    from juro.llm import create_chat_model

    model = create_chat_model().model_copy(update={"streaming": True})
    with telemetry.turn("room-d", "advocate"):
        asyncio.run(model.ainvoke([HumanMessage(content="x")]))
    calls = [e for e in telemetry.load("room-d") if e["event"] == "model_call"]
    assert len(calls) == 1 and (calls[0]["input_tokens"], calls[0]["output_tokens"]) == (50, 5)


# ---------------------------------------------------------------- test isolation


def test_inherited_provider_settings_are_cleared():
    for key in ("JURO_LIVE_PROVIDER", "GROQ_API_KEY", "JURO_GROQ_FREE_CONFIRMED", "ANTHROPIC_API_KEY", "THENVOI_API_KEY"):
        assert key not in os.environ


def test_real_network_calls_are_blocked():
    with pytest.raises(OSError):
        socket.create_connection(("api.groq.com", 443), timeout=2)
    with pytest.raises(OSError):
        s = socket.socket()
        try:
            s.connect(("203.0.113.1", 443))
        finally:
            s.close()


def test_groq_client_cannot_reach_the_network(monkeypatch):
    groq = pytest.importorskip("groq")
    client = groq.Groq(api_key="gsk_not_real", max_retries=0, timeout=3)
    with pytest.raises(groq.APIConnectionError):
        client.chat.completions.create(model="m", messages=[{"role": "user", "content": "x"}])
