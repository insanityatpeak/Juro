"""Shared test setup: no real config, no inherited provider settings, no network."""

import socket

import pytest

# Settings that could enable a provider, point at a real service, or change telemetry if they leaked
# in from the developer's shell. Tests that need one set it explicitly with monkeypatch.
INHERITED = (
    "JURO_LIVE_PROVIDER", "GROQ_API_KEY", "JURO_GROQ_FREE_CONFIRMED", "GROQ_MODEL", "GROQ_BASE_URL",
    "ANTHROPIC_API_KEY", "DEEPGRAM_API_KEY", "THENVOI_API_KEY", "THENVOI_REST_URL", "THENVOI_WS_URL",
    "VERDICT_TRIBUNAL_ROOM_ID", "VERDICT_CASE_ID", "VERDICT_DEFAULT_MODEL", "VERDICT_ADJUDICATOR_MODEL",
    "JURO_TELEMETRY", "JURO_TELEMETRY_DIR",
)
_LOOPBACK = {"127.0.0.1", "::1", "localhost"}


@pytest.fixture(autouse=True)
def _clean_provider_env(monkeypatch):
    for key in INHERITED:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def _telemetry_in_tmp(tmp_path, monkeypatch, _clean_provider_env):
    """Tests never write telemetry into the repo; each test gets its own folder."""
    monkeypatch.setenv("JURO_TELEMETRY_DIR", str(tmp_path / "telemetry"))
    return tmp_path / "telemetry"


@pytest.fixture(autouse=True)
def _never_read_the_real_env_file(monkeypatch):
    """Tests must not pick up backend/.env (it may hold a real key and the live switches)."""
    import juro.agents.base
    import juro.config
    import juro.generate

    monkeypatch.setattr(juro.config, "_load_env", lambda: None)
    monkeypatch.setattr(juro.agents.base, "_load_env", lambda: None)
    monkeypatch.setattr(juro.generate, "load_dotenv", lambda *a, **k: False)


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Block every non-loopback connection, so no test can reach Groq, Band or anything else even if a
    real key leaked in. Loopback stays open (asyncio uses local socket pairs on Windows)."""
    real_connect, real_connect_ex = socket.socket.connect, socket.socket.connect_ex

    def _host(address):
        return address[0] if isinstance(address, tuple) and address else address

    def guarded_connect(self, address):
        if _host(address) not in _LOOPBACK:
            raise ConnectionRefusedError(f"network access is blocked in tests (tried {_host(address)!r})")
        return real_connect(self, address)

    def guarded_connect_ex(self, address):
        if _host(address) not in _LOOPBACK:
            raise ConnectionRefusedError(f"network access is blocked in tests (tried {_host(address)!r})")
        return real_connect_ex(self, address)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", guarded_connect_ex)
    monkeypatch.setattr(socket, "getaddrinfo", _guarded_getaddrinfo(socket.getaddrinfo))


def _guarded_getaddrinfo(real):
    def guarded(host, *args, **kwargs):
        if host not in _LOOPBACK and host is not None:
            raise socket.gaierror(f"DNS lookups are blocked in tests (tried {host!r})")
        return real(host, *args, **kwargs)

    return guarded
