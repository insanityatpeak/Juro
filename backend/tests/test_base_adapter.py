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
