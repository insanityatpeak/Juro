"""Shared test setup."""

import pytest


@pytest.fixture(autouse=True)
def _telemetry_in_tmp(tmp_path, monkeypatch):
    """Tests never write telemetry into the repo; each test gets its own folder."""
    monkeypatch.setenv("JURO_TELEMETRY_DIR", str(tmp_path / "telemetry"))
    monkeypatch.delenv("JURO_TELEMETRY", raising=False)
    return tmp_path / "telemetry"


@pytest.fixture(autouse=True)
def _never_read_the_real_env_file(monkeypatch):
    """Tests must not pick up backend/.env (it may hold a real key and the live switches)."""
    import juro.config
    import juro.agents.base

    monkeypatch.setattr(juro.config, "_load_env", lambda: None)
    monkeypatch.setattr(juro.agents.base, "_load_env", lambda: None)
