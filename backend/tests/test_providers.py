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


def test_band_agent_llm_is_refused_before_import():
    from juro.agents.base import VerdictAgent

    # _create_llm only reads self.role; call it unbound on a minimal stand-in.
    stand_in = type("A", (), {"role": "advocate"})()
    with pytest.raises(ProviderDisabled):
        VerdictAgent._create_llm(stand_in)


def test_sample_cases_exist_for_free_use():
    assert {"mri-erisa", "pet-oncology", "snf-jimmo"} <= set(CASES)
