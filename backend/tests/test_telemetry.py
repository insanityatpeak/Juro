"""Local hearing telemetry, verified with mocked model calls (no Groq quota used)."""

import asyncio
import json
from types import SimpleNamespace as NS

import pytest

from juro import telemetry
from juro.relay import run_turn

ALLOWED_KEYS = {"v", "ts", "utc", "run", "planned_s", "hearing", "agent", "turn", "attempt", "event", "call", "model", "ok", "latency_ms",
                "input_tokens", "output_tokens", "error_kind", "error_type", "seconds", "reason", "outcome", "duration_ms"}


def events(root, hearing="room-1"):
    return telemetry.load(hearing, root)


class _429(Exception):
    def __init__(self, msg, retry_after=None):
        super().__init__(msg)
        headers = {"retry-after": str(retry_after)} if retry_after is not None else {}
        self.response = NS(status_code=429, headers=headers)


# ---------------------------------------------------------------- relay: attempts, waits, outcomes


def _turn(invoke_steps):
    state = {"sent": False}
    steps = list(invoke_steps)

    async def invoke():
        step = steps.pop(0)
        if isinstance(step, Exception):
            raise step
        state["sent"] = True

    async def noop(*a, **k):
        return None

    async def reviewer():
        return "Priya"

    return dict(label="Advocate", invoke=invoke, reset=lambda: state.update(sent=False), sent=lambda: state["sent"],
                final_text=lambda: "", send=noop, forced=["Scrutinizer"], reviewer=reviewer, sleep=noop)


def test_retry_wait_and_outcome_are_recorded_separately(_telemetry_in_tmp):
    with telemetry.turn("room-1", "advocate") as turn_id:
        ok = asyncio.run(run_turn(**_turn([_429("tokens per minute", retry_after=7), "send"])))
    assert ok
    evs = events(_telemetry_in_tmp)
    assert [e["event"] for e in evs] == ["wait", "turn_end"]
    wait, end = evs
    assert (wait["planned_s"], wait["reason"], wait["attempt"]) == (7, "rate_limited", 0)
    assert 0 <= wait["seconds"] < 1  # measured: the test's sleep returns at once
    assert (end["outcome"], end["attempt"], end["turn"]) == ("posted", 1, turn_id)
    s = telemetry.summarize(evs)
    assert s["turns"][0]["retries"] == 1 and s["totals"]["wait_s"] < 1


def test_quota_pause_outcome(_telemetry_in_tmp):
    with telemetry.turn("room-1", "scrutinizer"):
        assert asyncio.run(run_turn(**_turn([_429("tokens per day (TPD)")]))) is False
    assert events(_telemetry_in_tmp)[-1]["outcome"] == "paused_quota_exhausted"


def test_logging_failure_never_interrupts_a_turn(tmp_path, monkeypatch):
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x")
    monkeypatch.setenv("JURO_TELEMETRY_DIR", str(blocker))  # mkdir under a file fails
    with telemetry.turn("room-1", "advocate"):
        assert asyncio.run(run_turn(**_turn([_429("per minute", retry_after=1), "send"]))) is True


def test_disabled_writes_nothing(_telemetry_in_tmp, monkeypatch):
    monkeypatch.setenv("JURO_TELEMETRY", "0")
    with telemetry.turn("room-1", "advocate"):
        asyncio.run(run_turn(**_turn(["send"])))
    assert not _telemetry_in_tmp.exists()


# ---------------------------------------------------------------- model calls (GuardedChatGroq), mocked

langchain_groq = pytest.importorskip("langchain_groq")
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage  # noqa: E402
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult  # noqa: E402

ON = {"JURO_LIVE_PROVIDER": "groq", "GROQ_API_KEY": "gsk_test_key_never_logged", "JURO_GROQ_FREE_CONFIRMED": "1"}


@pytest.fixture
def model(monkeypatch):
    for k, v in ON.items():
        monkeypatch.setenv(k, v)
    from juro.llm import create_chat_model

    return create_chat_model()


def _stream_with(monkeypatch, usage=None, error=None):
    async def fake_astream(self, messages, stop=None, run_manager=None, **kw):
        yield ChatGenerationChunk(message=AIMessageChunk(content="SECRET ARGUMENT TEXT"))
        if error:
            raise error
        yield ChatGenerationChunk(message=AIMessageChunk(content="", usage_metadata=usage) if usage else AIMessageChunk(content=""))

    monkeypatch.setattr(langchain_groq.ChatGroq, "_astream", fake_astream)


async def _consume(model):
    async for _ in model.astream([HumanMessage(content="SECRET PROMPT TEXT")]):
        pass


def test_streamed_call_records_tokens_and_latency(model, monkeypatch, _telemetry_in_tmp):
    _stream_with(monkeypatch, usage={"input_tokens": 957, "output_tokens": 150, "total_tokens": 1107})
    with telemetry.turn("room-1", "evidence") as turn_id:
        asyncio.run(_consume(model))
        asyncio.run(_consume(model))  # a second call in the same turn (tool loop)
    calls = [e for e in events(_telemetry_in_tmp) if e["event"] == "model_call"]
    assert [c["call"] for c in calls] == [1, 2]
    assert all(c["turn"] == turn_id and c["agent"] == "evidence" and c["ok"] for c in calls)
    assert (calls[0]["input_tokens"], calls[0]["output_tokens"]) == (957, 150)
    assert isinstance(calls[0]["latency_ms"], int)


def test_missing_usage_is_unknown_not_zero(model, monkeypatch, _telemetry_in_tmp):
    _stream_with(monkeypatch, usage=None)
    with telemetry.turn("room-1", "advocate"):
        asyncio.run(_consume(model))
    call = [e for e in events(_telemetry_in_tmp) if e["event"] == "model_call"][0]
    assert call["input_tokens"] is None and call["output_tokens"] is None
    s = telemetry.summarize(events(_telemetry_in_tmp))
    assert s["totals"]["missing_usage"] == 1
    assert s["totals"]["input_tokens"] is None and s["turns"][0]["input_tokens"] is None  # unknown, not 0


def test_failed_call_is_recorded_without_error_body(model, monkeypatch, _telemetry_in_tmp):
    _stream_with(monkeypatch, error=_429("Rate limit reached... RAW ERROR BODY with org_secret_123", retry_after=5))
    with telemetry.turn("room-1", "scrutinizer"):
        with pytest.raises(_429):
            asyncio.run(_consume(model))
    call = [e for e in events(_telemetry_in_tmp) if e["event"] == "model_call"][0]
    assert (call["ok"], call["error_kind"], call["error_type"]) == (False, "rate_limited", "_429")


def test_refused_call_is_recorded_without_network(model, monkeypatch, _telemetry_in_tmp):
    called = []

    async def must_not_run(self, *a, **k):
        called.append(1)
        yield None

    monkeypatch.setattr(langchain_groq.ChatGroq, "_astream", must_not_run)
    monkeypatch.delenv("JURO_GROQ_FREE_CONFIRMED")
    with telemetry.turn("room-1", "advocate"):
        with pytest.raises(Exception):
            asyncio.run(_consume(model))
    call = [e for e in events(_telemetry_in_tmp) if e["event"] == "model_call"][0]
    assert call["error_kind"] == "provider_disabled" and not called


def test_non_streamed_call_reads_llm_output_usage(model, monkeypatch, _telemetry_in_tmp):
    async def fake_agenerate(self, messages, stop=None, run_manager=None, **kw):
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="SECRET ARGUMENT TEXT"))],
                          llm_output={"token_usage": {"prompt_tokens": 800, "completion_tokens": 90}})

    monkeypatch.setattr(langchain_groq.ChatGroq, "_agenerate", fake_agenerate)
    with telemetry.turn("room-1", "adjudicator"):
        asyncio.run(model.ainvoke([HumanMessage(content="SECRET PROMPT TEXT")]))
    call = [e for e in events(_telemetry_in_tmp) if e["event"] == "model_call"][0]
    assert (call["input_tokens"], call["output_tokens"]) == (800, 90)


def test_files_contain_no_text_keys_or_error_bodies(model, monkeypatch, _telemetry_in_tmp):
    _stream_with(monkeypatch, usage={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2})
    with telemetry.turn("room-1", "advocate"):
        asyncio.run(_consume(model))
    _stream_with(monkeypatch, error=_429("RAW ERROR BODY org_secret_123"))
    with telemetry.turn("room-1", "advocate"):
        with pytest.raises(_429):
            asyncio.run(_consume(model))
    raw = "".join(p.read_text(encoding="utf-8") for p in _telemetry_in_tmp.rglob("*.jsonl"))
    for secret in ("SECRET ARGUMENT TEXT", "SECRET PROMPT TEXT", "gsk_test_key_never_logged", "RAW ERROR BODY", "org_secret_123"):
        assert secret not in raw
    for line in raw.splitlines():
        assert set(json.loads(line)) <= ALLOWED_KEYS


# ---------------------------------------------------------------- summary


def test_summary_per_turn_totals_and_peak_window():
    evs = [
        {"ts": 100.0, "hearing": "h", "agent": "adjudicator", "turn": "adj-1", "attempt": 0, "event": "turn_end", "outcome": "code_opening", "duration_ms": 0},
        {"ts": 101.0, "hearing": "h", "agent": "advocate", "turn": "adv-1", "attempt": 0, "event": "model_call", "call": 1, "ok": True, "latency_ms": 2000, "input_tokens": 1000, "output_tokens": 150},
        {"ts": 104.0, "hearing": "h", "agent": "advocate", "turn": "adv-1", "attempt": 0, "event": "model_call", "call": 2, "ok": True, "latency_ms": 1000, "input_tokens": 1300, "output_tokens": 20},
        {"ts": 105.0, "hearing": "h", "agent": "advocate", "turn": "adv-1", "attempt": 0, "event": "turn_end", "outcome": "posted", "duration_ms": 4000},
        {"ts": 110.0, "hearing": "h", "agent": "scrutinizer", "turn": "scr-1", "attempt": 0, "event": "model_call", "call": 1, "ok": False, "latency_ms": 300, "input_tokens": None, "output_tokens": None, "error_kind": "rate_limited"},
        {"ts": 140.5, "hearing": "h", "agent": "scrutinizer", "turn": "scr-1", "attempt": 0, "event": "wait", "seconds": 30.0, "reason": "rate_limited"},
        {"ts": 141.0, "hearing": "h", "agent": "scrutinizer", "turn": "scr-1", "attempt": 1, "event": "model_call", "call": 2, "ok": True, "latency_ms": 2500, "input_tokens": 1500, "output_tokens": 140},
        {"ts": 175.0, "hearing": "h", "agent": "scrutinizer", "turn": "scr-1", "attempt": 1, "event": "turn_end", "outcome": "posted", "duration_ms": 65000},
    ]
    s = telemetry.summarize(evs)
    adv = next(r for r in s["turns"] if r["turn"] == "adv-1")
    scr = next(r for r in s["turns"] if r["turn"] == "scr-1")
    assert (adv["calls"], adv["input_tokens"], adv["output_tokens"], adv["missing_usage"]) == (2, 2300, 170, 0)
    assert (scr["calls"], scr["failed_calls"], scr["missing_usage"], scr["retries"], scr["wait_s"]) == (2, 1, 1, 1, 30.0)
    t = s["totals"]
    # Earliest start: the advocate's first call ended at 101 after 2s, so it started at 99. Latest end: 175.
    assert t["wall_clock_s"] == 76.0
    assert (t["input_tokens"], t["output_tokens"], t["missing_usage"], t["retries"], t["wait_s"]) == (3800, 310, 1, 1, 30.0)
    assert t["peak_tokens_60s"] == 1150 + 1320 + 1640  # all three counted calls fall within 60s of the first
    text = telemetry.format_summary("h", s)
    assert "1 call(s) with unknown usage" in text and "76.0s wall clock" in text and "30.0s waiting" in text
    assert "Peak observed tokens" in text and "can understate" in text and "not Groq's own quota accounting" in text


def test_wall_clock_spans_overlapping_agents_not_a_sum():
    # Two agents' turns overlap (100-130 and 110-140): wall clock is 40s, not 30 + 30.
    evs = [
        {"ts": 130.0, "agent": "a", "turn": "a-1", "attempt": 0, "event": "turn_end", "outcome": "posted", "duration_ms": 30000},
        {"ts": 140.0, "agent": "b", "turn": "b-1", "attempt": 0, "event": "turn_end", "outcome": "posted", "duration_ms": 30000},
    ]
    assert telemetry.summarize(evs)["totals"]["wall_clock_s"] == 40.0


def test_wait_extends_to_its_end():
    evs = [{"ts": 10.0, "agent": "a", "turn": "a-1", "attempt": 0, "event": "wait", "seconds": 20.0, "reason": "rate_limited"}]
    assert telemetry.summarize(evs)["totals"]["wall_clock_s"] == 20.0


def test_cli_summary_reads_the_latest_hearing(_telemetry_in_tmp, capsys):
    with telemetry.turn("room-cli", "advocate"):
        telemetry.model_call(model="m", ok=True, latency_ms=10, input_tokens=5, output_tokens=6)
        telemetry.turn_end("posted", 12)
    assert telemetry.main(["summary"]) == 0
    out = capsys.readouterr().out
    assert "Hearing room-cli" in out and "5 in / 6 out tokens" in out
    assert telemetry.main(["list"]) == 0 and "room-cli" in capsys.readouterr().out
