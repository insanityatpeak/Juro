"""The Band agents' model: Groq free tier, one model, provider re-checked on every call."""

import asyncio

import pytest

pytest.importorskip("langchain_groq")

from langchain_core.messages import HumanMessage  # noqa: E402

from juro import llm  # noqa: E402
from juro.providers import ProviderDisabled  # noqa: E402

ON = {"JURO_LIVE_PROVIDER": "groq", "GROQ_API_KEY": "gsk_test_not_real", "JURO_GROQ_FREE_CONFIRMED": "1"}


def _env(monkeypatch, on: bool, **extra):
    for k in ON:
        monkeypatch.delenv(k, raising=False)
    if on:
        for k, v in ON.items():
            monkeypatch.setenv(k, v)
    for k, v in extra.items():
        monkeypatch.setenv(k, v)


def test_refused_before_a_client_exists(monkeypatch):
    _env(monkeypatch, on=False)
    with pytest.raises(ProviderDisabled):
        llm.create_chat_model()


def test_one_free_model_with_low_reasoning_and_no_provider_retries(monkeypatch):
    _env(monkeypatch, on=True)
    monkeypatch.delenv("GROQ_MODEL", raising=False)
    m = llm.create_chat_model()
    assert m.model_name == "openai/gpt-oss-20b"
    assert m.max_retries == 0
    assert m.reasoning_effort == "low"
    assert m.model_kwargs == {"include_reasoning": False}
    assert m.reasoning_format is None  # not supported for gpt-oss


def test_model_override_drops_gpt_oss_reasoning_settings(monkeypatch):
    _env(monkeypatch, on=True, GROQ_MODEL="llama-3.3-70b-versatile")
    m = llm.create_chat_model()
    assert m.model_name == "llama-3.3-70b-versatile"
    assert m.reasoning_effort is None
    assert not m.model_kwargs


def test_switching_groq_off_stops_the_next_call(monkeypatch):
    """The guard runs before each call, so an already-built model refuses once Groq is turned off."""
    _env(monkeypatch, on=True)
    m = llm.create_chat_model()
    monkeypatch.delenv("JURO_GROQ_FREE_CONFIRMED")
    with pytest.raises(ProviderDisabled):
        asyncio.run(m.ainvoke([HumanMessage(content="hi")]))
    with pytest.raises(ProviderDisabled):
        m.invoke([HumanMessage(content="hi")])
