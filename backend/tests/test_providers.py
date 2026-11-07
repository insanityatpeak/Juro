"""No paid services: the Anthropic provider must never be called, even with a key set."""

import pytest

from juro import generate
from juro.cases import CASES, DEFAULT_CASE_ID
from juro.providers import ProviderDisabled, provider_allowed, require_provider


class _ExplodingMessages:
    def create(self, **_kwargs):  # pragma: no cover - must never run
        raise AssertionError("a paid provider call was attempted")


class _FakeClient:
    messages = _ExplodingMessages()


def test_anthropic_is_disabled():
    assert provider_allowed("anthropic") is False
    with pytest.raises(ProviderDisabled):
        require_provider("anthropic")


def test_generator_cli_refuses_even_with_a_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-not-used")
    monkeypatch.setattr("sys.argv", ["juro.generate"])
    with pytest.raises(SystemExit) as e:
        generate.main()
    assert "disabled" in str(e.value)


def test_each_generator_call_is_guarded_before_the_client():
    _, case, evidence = generate._select_case(DEFAULT_CASE_ID)
    with pytest.raises(ProviderDisabled):
        generate._ask(_FakeClient(), "advocate", "argument", [], case, evidence)
    with pytest.raises(ProviderDisabled):
        generate._final_verdict(_FakeClient(), [], case, evidence)


GROQ_ENV = ("JURO_LIVE_PROVIDER", "GROQ_API_KEY", "JURO_GROQ_FREE_CONFIRMED")


def _groq_env(monkeypatch, **values):
    for k in GROQ_ENV:
        monkeypatch.delenv(k, raising=False)
    for k, v in values.items():
        monkeypatch.setenv(k, v)


def test_band_agent_llm_is_refused_without_groq_free(monkeypatch):
    from juro.agents.base import VerdictAgent

    _groq_env(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-not-used")  # a paid key never helps
    stand_in = type("A", (), {"role": "advocate"})()
    with pytest.raises(ProviderDisabled):
        VerdictAgent._create_llm(stand_in)


@pytest.mark.parametrize(
    "env",
    [
        {"GROQ_API_KEY": "gsk_x", "JURO_GROQ_FREE_CONFIRMED": "1"},  # not opted in
        {"JURO_LIVE_PROVIDER": "groq", "JURO_GROQ_FREE_CONFIRMED": "1"},  # no key
        {"JURO_LIVE_PROVIDER": "groq", "GROQ_API_KEY": "gsk_x"},  # Free plan not confirmed
    ],
)
def test_groq_needs_all_three_switches(monkeypatch, env):
    _groq_env(monkeypatch, **env)
    assert provider_allowed("groq") is False
    with pytest.raises(ProviderDisabled):
        require_provider("groq")


def test_groq_allowed_with_all_three_and_anthropic_still_blocked(monkeypatch):
    _groq_env(monkeypatch, JURO_LIVE_PROVIDER="groq", GROQ_API_KEY="gsk_x", JURO_GROQ_FREE_CONFIRMED="1")
    assert provider_allowed("groq") is True
    assert provider_allowed("anthropic") is False


def test_sample_cases_exist_for_free_use():
    assert {"mri-erisa", "pet-oncology", "snf-jimmo"} <= set(CASES)
