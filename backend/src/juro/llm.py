"""The Band agents' chat model: Groq's free tier only (see juro.providers).

One model runs all four roles, matching the web live hearings. `GuardedChatGroq` re-checks the
provider control before EVERY model call, so switching Groq off stops agents mid-hearing too.
The provider's own retries are off: the relay (juro.relay) decides when to wait, retry or pause.
"""

from __future__ import annotations

import os
from functools import lru_cache

from juro.providers import require_provider

DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b"
MAX_OUTPUT_TOKENS = 700  # a 2-4 sentence turn plus one tool call; gpt-oss reasoning is kept low


def groq_model() -> str:
    return os.environ.get("GROQ_MODEL") or DEFAULT_GROQ_MODEL


@lru_cache(maxsize=1)
def _guarded_class():
    from langchain_groq import ChatGroq

    class GuardedChatGroq(ChatGroq):
        """ChatGroq that checks the provider control immediately before each call."""

        def _generate(self, *args, **kwargs):
            require_provider("groq")
            return super()._generate(*args, **kwargs)

        async def _agenerate(self, *args, **kwargs):
            require_provider("groq")
            return await super()._agenerate(*args, **kwargs)

        def _stream(self, *args, **kwargs):
            require_provider("groq")
            yield from super()._stream(*args, **kwargs)

        async def _astream(self, *args, **kwargs):
            require_provider("groq")
            async for chunk in super()._astream(*args, **kwargs):
                yield chunk

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
