"""The Band agents' chat model: Groq's free tier only (see juro.providers).

Every call attempt is recorded locally by juro.telemetry (tokens, latency, outcome; no text).

One model runs all four roles, matching the web live hearings. `GuardedChatGroq` re-checks the
provider control before EVERY model call, so switching Groq off stops agents mid-hearing too.
The provider's own retries are off: the relay (juro.relay) decides when to wait, retry or pause.
"""

from __future__ import annotations

import os
import time
from functools import lru_cache

from juro.providers import require_provider

DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b"
MAX_OUTPUT_TOKENS = 700  # a 2-4 sentence turn plus one tool call; gpt-oss reasoning is kept low


def groq_model() -> str:
    return os.environ.get("GROQ_MODEL") or DEFAULT_GROQ_MODEL


def _record(model: str, started: float, usage: tuple, exc: BaseException | None) -> None:
    """One telemetry line per model-call attempt. Never raises (see juro.telemetry)."""
    try:
        from juro import telemetry
        from juro.relay import classify_failure

        kind = classify_failure(exc).kind if exc is not None else None
        telemetry.model_call(
            model=model, ok=exc is None, latency_ms=int((time.monotonic() - started) * 1000),
            input_tokens=usage[0], output_tokens=usage[1],
            error_kind=kind, error_type=type(exc).__name__ if exc is not None else None,
        )
    except Exception:  # noqa: BLE001
        pass


@lru_cache(maxsize=1)
def _guarded_class():
    from langchain_groq import ChatGroq

    from juro.telemetry import usage_from

    class GuardedChatGroq(ChatGroq):
        """ChatGroq that checks the provider control before each call and records each attempt."""

        def _generate(self, *args, **kwargs):
            started, usage, exc = time.monotonic(), (None, None), None
            try:
                require_provider("groq")
                result = super()._generate(*args, **kwargs)
                usage = usage_from(result)
                return result
            except BaseException as e:
                exc = e
                raise
            finally:
                _record(self.model_name, started, usage, exc)

        async def _agenerate(self, *args, **kwargs):
            started, usage, exc = time.monotonic(), (None, None), None
            try:
                require_provider("groq")
                result = await super()._agenerate(*args, **kwargs)
                usage = usage_from(result)
                return result
            except BaseException as e:
                exc = e
                raise
            finally:
                _record(self.model_name, started, usage, exc)

        def _stream(self, *args, **kwargs):
            started, usage, exc = time.monotonic(), (None, None), None
            try:
                require_provider("groq")
                for chunk in super()._stream(*args, **kwargs):
                    got = usage_from(chunk)
                    if got != (None, None):
                        usage = got
                    yield chunk
            except BaseException as e:
                exc = e
                raise
            finally:
                _record(self.model_name, started, usage, exc)

        async def _astream(self, *args, **kwargs):
            started, usage, exc = time.monotonic(), (None, None), None
            try:
                require_provider("groq")
                async for chunk in super()._astream(*args, **kwargs):
                    got = usage_from(chunk)
                    if got != (None, None):
                        usage = got
                    yield chunk
            except BaseException as e:
                exc = e
                raise
            finally:
                _record(self.model_name, started, usage, exc)

    return GuardedChatGroq


def create_chat_model():
    """Build the agents' model. Refuses (ProviderDisabled) before any client exists if Groq is off."""
    require_provider("groq")
    model = groq_model()
    kwargs: dict = {
        "model": model,
        "temperature": 0.6,
        "max_tokens": MAX_OUTPUT_TOKENS,
        "max_retries": 0,  # juro.relay owns retries, pauses and the "room is never silent" notice
        "timeout": 30,
    }
    if model.startswith("openai/gpt-oss"):
        # Keep reasoning short and out of the reply. reasoning_format is not supported for gpt-oss.
        kwargs["reasoning_effort"] = "low"
        kwargs["model_kwargs"] = {"include_reasoning": False}
    return _guarded_class()(**kwargs)
