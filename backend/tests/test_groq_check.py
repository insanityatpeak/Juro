"""groq_check: capped, no retries, stops on limits, reports without secrets or case text."""

import json
from types import SimpleNamespace as NS

import pytest

pytest.importorskip("langchain_groq")
from langchain_core.messages import AIMessageChunk  # noqa: E402

from juro import groq_check  # noqa: E402

ON = {"JURO_LIVE_PROVIDER": "groq", "GROQ_API_KEY": "gsk_secret_do_not_print", "JURO_GROQ_FREE_CONFIRMED": "1"}
GOOD_ARGS = json.dumps({"content": "The record shows a red-flag exception.", "mentions": ["Scrutinizer"]})


def env(monkeypatch, on=True):
    for k in ON:
        monkeypatch.delenv(k, raising=False)
    if on:
        for k, v in ON.items():
            monkeypatch.setenv(k, v)
    monkeypatch.delenv("GROQ_MODEL", raising=False)


class FakeClient:
    def __init__(self, tool=True, args=GOOD_ARGS, error=None):
        self.calls = 0
        self.kwargs = []
        outer = self

        class Raw:
            headers = {"x-ratelimit-remaining-requests": "999", "x-ratelimit-remaining-tokens": "7600"}

            @staticmethod
            def parse():
                tc = [NS(function=NS(name="band_send_message", arguments=args))] if tool else []
                return NS(choices=[NS(message=NS(tool_calls=tc), finish_reason="tool_calls" if tool else "stop")],
                          usage=NS(prompt_tokens=1500, completion_tokens=120))

        def create(**kw):
            outer.calls += 1
            outer.kwargs.append(kw)
            if error:
                raise error
            return Raw()

        self.chat = NS(completions=NS(with_raw_response=NS(create=create)))


class FakeModel:
    def __init__(self, tool=True):
        self.tool = tool
        self.streams = 0

    def bind_tools(self, tools):
        assert tools[0]["function"]["name"] == "band_send_message"
        return self

    async def astream(self, messages):
        self.streams += 1
        chunks = [{"name": "band_send_message", "args": GOOD_ARGS, "id": "c1", "index": 0}] if self.tool else []
        yield AIMessageChunk(content="", tool_call_chunks=chunks,
                             usage_metadata={"input_tokens": 1500, "output_tokens": 110, "total_tokens": 1610})


class _429(Exception):
    def __init__(self, msg):
        super().__init__(msg)
        self.response = NS(status_code=429, headers={})


def run(**kw):
    clock = iter(x / 10 for x in range(100))
    return groq_check.run_check(clock=lambda: next(clock), **kw)


def test_disabled_without_the_three_switches_makes_no_call(monkeypatch):
    env(monkeypatch, on=False)
    client = FakeClient()
    r = run(calls=2, max_tokens=400, client_factory=lambda: client, model_factory=FakeModel)
    assert r.verdict == "DISABLED" and client.calls == 0


def test_pass_on_both_paths_with_limits_and_caps(monkeypatch):
    env(monkeypatch)
    client, model = FakeClient(), FakeModel()
    r = run(calls=2, max_tokens=5000, client_factory=lambda: client, model_factory=lambda: model)
    assert r.verdict == "PASS"
    assert [c.path for c in r.calls] == ["raw-sdk", "langchain-stream"]
    assert all(c.tool_called and c.tool_args_valid for c in r.calls)
    assert r.rate_limits["x-ratelimit-remaining-tokens"] == "7600"
    kw = client.kwargs[0]
    assert kw["max_completion_tokens"] == 1024  # capped
    assert kw["reasoning_effort"] == "low" and kw["include_reasoning"] is False
    assert "[synthetic test case]" in kw["messages"][1]["content"]


def test_call_count_is_capped(monkeypatch):
    env(monkeypatch)
    client, model = FakeClient(), FakeModel()
    r = run(calls=99, max_tokens=400, client_factory=lambda: client, model_factory=lambda: model)
    assert len(r.calls) == groq_check.MAX_CALLS == 3
    assert client.calls == 2 and model.streams == 1


def test_quota_error_stops_immediately_without_retry(monkeypatch):
    env(monkeypatch)
    client, model = FakeClient(error=_429("Rate limit reached on tokens per day (TPD)")), FakeModel()
    r = run(calls=3, max_tokens=400, client_factory=lambda: client, model_factory=lambda: model)
    assert r.verdict == "FAIL" and client.calls == 1 and model.streams == 0
    assert r.calls[0].error_kind == "quota_exhausted"


def test_no_tool_call_is_a_warning(monkeypatch):
    env(monkeypatch)
    r = run(calls=2, max_tokens=400, client_factory=lambda: FakeClient(tool=False), model_factory=lambda: FakeModel(tool=False))
    assert r.verdict == "WARN"


def test_bad_tool_arguments_are_caught(monkeypatch):
    env(monkeypatch)
    r = run(calls=1, max_tokens=400, client_factory=lambda: FakeClient(args="{not json"), model_factory=FakeModel)
    assert r.verdict == "WARN" and r.calls[0].tool_called and not r.calls[0].tool_args_valid


def test_report_has_no_key_or_case_text(monkeypatch, capsys):
    env(monkeypatch)
    from juro import config

    monkeypatch.setattr(config, "_load_env", lambda: None)
    import groq

    monkeypatch.setattr(groq, "Groq", lambda **kw: FakeClient())
    monkeypatch.setattr("juro.llm.create_chat_model", lambda: FakeModel())
    code = groq_check.main(["--json"])
    out = capsys.readouterr().out
    assert code == 0
    assert "gsk_secret_do_not_print" not in out
    assert "R. Alvarez" not in out and "foot-drop" not in out
    assert json.loads(out)["verdict"] == "PASS"
