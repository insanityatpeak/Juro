"""Wiring of the relay into the Band adapter (agents/base.py), against a stand-in band-sdk.

band-sdk is not installable in CI (private submodule), so a minimal fake LangGraphAdapter stands in:
like the real one, it speaks by calling tools.send_message and emits on_tool_start / on_chat_model_end
stream events through _handle_stream_event. This checks base.py's forced handoff, the chair's
open/rule phases (including resume after a pause) and the quota notice path.
"""

import asyncio
import sys
import types

import pytest


class _RateLimit(Exception):
    def __init__(self, msg):
        super().__init__(msg)
        self.response = type("R", (), {"status_code": 429, "headers": {}})()


class FakeLangGraphAdapter:
    script: list = []  # per call: "tool" | "answer" | Exception

    def __init__(self, **kwargs):
        self.kwargs = kwargs

    async def _handle_stream_event(self, event, room_id, tools):
        return None

    async def on_message(self, msg, tools, history, participants_msg, contacts_msg, *, is_session_bootstrap, room_id):
        step = FakeLangGraphAdapter.script.pop(0)
        if isinstance(step, Exception):
            raise step
        if step == "llm+tool":  # like LangGraph: one model call (the agent's real GuardedChatGroq), then the tool
            from langchain_core.messages import HumanMessage

            await self.kwargs["llm"].ainvoke([HumanMessage(content="turn prompt")])
            step = "tool"
        if step == "tool":
            await self._handle_stream_event({"event": "on_tool_start", "name": "band_send_message"}, room_id, tools)
            await tools.send_message("model text", mentions=["WhoeverTheModelPicked"])
        else:
            data = {"output": {"content": "plain answer"}}
            await self._handle_stream_event({"event": "on_chat_model_end", "data": data}, room_id, tools)
        return "adapter-result"


class FakeTools:
    def __init__(self, participants=("Advocate", "Scrutinizer", "Evidence", "Adjudicator", "Priya")):
        self.posts = []
        self._participants = [{"name": n} for n in participants]

    async def send_message(self, content, mentions=None):
        self.posts.append((content, list(mentions or [])))

    async def get_participants(self):
        return self._participants


@pytest.fixture
def adapter_for(monkeypatch):
    band = types.ModuleType("band")
    adapters = types.ModuleType("band.adapters")
    adapters.LangGraphAdapter = FakeLangGraphAdapter
    band.adapters = adapters
    monkeypatch.setitem(sys.modules, "band", band)
    monkeypatch.setitem(sys.modules, "band.adapters", adapters)
    pytest.importorskip("langgraph")

    from juro.agents.adjudicator import Adjudicator
    from juro.agents.advocate import Advocate
    from juro.agents.base import VerdictAgent

    monkeypatch.setattr(VerdictAgent, "_create_llm", lambda self: object())

    def build(agent_cls):
        return {"advocate": Advocate, "adjudicator": Adjudicator}[agent_cls]()._build_relay_adapter()

    return build


def deliver(adapter, tools, sender, script, room="r1"):
    FakeLangGraphAdapter.script = list(script)
    msg = types.SimpleNamespace(sender_name=sender)
    return asyncio.run(adapter.on_message(msg, tools, [], None, None, is_session_bootstrap=False, room_id=room))


def test_debater_handoff_is_forced_and_written_by_code(adapter_for):
    a = adapter_for("advocate")
    assert a.kwargs["recursion_limit"] == 4
    tools = FakeTools()
    assert deliver(a, tools, "Adjudicator", ["tool"]) == "adapter-result"
    # The model's mention choice is ignored and the handoff line is appended by code.
    assert tools.posts == [("model text @Scrutinizer, your response.", ["Scrutinizer"])]


def test_silent_debater_turn_is_posted_with_code_handoff(adapter_for):
    tools = FakeTools()
    deliver(adapter_for("advocate"), tools, "Adjudicator", ["answer"])
    assert tools.posts == [("plain answer @Scrutinizer, your response.", ["Scrutinizer"])]


def test_opening_is_written_by_code_without_a_model_call(adapter_for):
    chair = adapter_for("adjudicator")
    tools = FakeTools()
    msg = types.SimpleNamespace(sender_name="Priya", content="CLAIM ON-2026-0612 - brief. @Adjudicator")
    FakeLangGraphAdapter.script = []  # any model call would fail: pop from an empty list
    asyncio.run(chair.on_message(msg, tools, [], None, None, is_session_bootstrap=False, room_id="r1"))
    (text, mentions), = tools.posts
    assert mentions == ["Advocate"]
    assert "ON-2026-0612" in text and text.endswith("@Advocate, present the case for coverage.")


def test_chair_rules_after_opening_and_a_reviewer_resume_does_not_restart(adapter_for):
    chair = adapter_for("adjudicator")
    tools = FakeTools()
    deliver(chair, tools, "Priya", [])  # case arrives -> code-written opening
    assert tools.posts[-1][1] == ["Advocate"]
    # The ruling hits the daily quota: pause notice to the reviewer, phase stays "ruling".
    deliver(chair, tools, "Evidence", [_RateLimit("tokens per day (TPD)")])
    text, mentions = tools.posts[-1]
    assert text.startswith("[tribunal notice]") and mentions == ["Priya"]
    # The reviewer @mentions the chair to resume: it rules (to the reviewer), it does not reopen.
    deliver(chair, tools, "Priya", ["tool"])
    text, mentions = tools.posts[-1]
    assert mentions == ["Priya"] and text.startswith("model text") and text.endswith("Over to you, @Priya.")


def test_mocked_hearing_produces_a_telemetry_summary(monkeypatch, _telemetry_in_tmp):
    """Opening (code) -> Advocate -> Scrutinizer (rate limited once, then posts), with mocked Groq calls."""
    pytest.importorskip("langgraph")
    lg = pytest.importorskip("langchain_groq")
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult

    band = types.ModuleType("band")
    adapters = types.ModuleType("band.adapters")
    adapters.LangGraphAdapter = FakeLangGraphAdapter
    band.adapters = adapters
    monkeypatch.setitem(sys.modules, "band", band)
    monkeypatch.setitem(sys.modules, "band.adapters", adapters)
    for k, v in {"JURO_LIVE_PROVIDER": "groq", "GROQ_API_KEY": "gsk_x", "JURO_GROQ_FREE_CONFIRMED": "1"}.items():
        monkeypatch.setenv(k, v)

    async def fake_agenerate(self, messages, stop=None, run_manager=None, **kw):
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="arg"))],
                          llm_output={"token_usage": {"prompt_tokens": 1000, "completion_tokens": 120}})

    monkeypatch.setattr(lg.ChatGroq, "_agenerate", fake_agenerate)
    import juro.relay

    async def no_sleep(_s):
        return None

    # run_turn's sleep default was bound at definition time; replace the default itself.
    monkeypatch.setitem(juro.relay.run_turn.__kwdefaults__, "sleep", no_sleep)

    from juro import telemetry
    from juro.agents.adjudicator import Adjudicator
    from juro.agents.advocate import Advocate
    from juro.agents.scrutinizer import Scrutinizer

    tools = FakeTools()
    chair, adv, scr = Adjudicator()._build_relay_adapter(), Advocate()._build_relay_adapter(), Scrutinizer()._build_relay_adapter()
    deliver(chair, tools, "Priya", [], room="room-42")
    deliver(adv, tools, "Adjudicator", ["llm+tool"], room="room-42")
    deliver(scr, tools, "Advocate", [_RateLimit("tokens per minute"), "llm+tool"], room="room-42")

    s = telemetry.summarize(telemetry.load("room-42"))
    rows = {r["agent"]: r for r in s["turns"]}
    assert rows["adjudicator"]["outcome"] == "code_opening" and rows["adjudicator"]["calls"] == 0
    assert (rows["advocate"]["calls"], rows["advocate"]["input_tokens"], rows["advocate"]["outcome"]) == (1, 1000, "posted")
    assert (rows["scrutinizer"]["retries"], rows["scrutinizer"]["outcome"]) == (1, "posted")
    assert rows["scrutinizer"]["wait_s"] < 1  # measured wait; the planned 10s is in the event
    waits = [e for e in telemetry.load("room-42") if e["event"] == "wait"]
    assert [w["planned_s"] for w in waits] == [10.0]
    assert len(telemetry.split_runs(telemetry.load("room-42"))) == 1
    assert s["totals"]["input_tokens"] == 2000 and s["totals"]["missing_usage"] == 0
