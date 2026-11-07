"""Provider controls (mirror of web/src/lib/providers.ts).

Juro must run without paid services:
  - anthropic: paid, always off. Setting ANTHROPIC_API_KEY does nothing.
  - groq: free tier only, opt-in with JURO_LIVE_PROVIDER=groq, GROQ_API_KEY and the operator
    assertion JURO_GROQ_FREE_CONFIRMED=1. The key must belong to a dedicated Groq Free-plan
    account with no payment method or paid upgrade. No paid fallback: if Groq is unavailable or
    out of quota, the tribunal pauses.

Call `require_provider(...)` immediately before every model call (not just at startup), so a
retry or a long-running agent process also stops when a provider is switched off.
"""

from __future__ import annotations

import os

PAID_PROVIDERS = {"anthropic"}


class ProviderDisabled(RuntimeError):
    """Raised instead of making a call to a provider that is not allowed."""


def provider_allowed(name: str) -> bool:
    if name in PAID_PROVIDERS:
        return False
    if name == "groq":
        return (
            os.environ.get("JURO_LIVE_PROVIDER") == "groq"
            and bool(os.environ.get("GROQ_API_KEY"))
            and os.environ.get("JURO_GROQ_FREE_CONFIRMED") == "1"
        )
    return False  # unknown providers are off


def require_provider(name: str) -> None:
    if provider_allowed(name):
        return
    if name in PAID_PROVIDERS:
        raise ProviderDisabled(
            f"The '{name}' provider is disabled: Juro uses no paid services. "
            "Setting an API key does not enable it."
        )
    if name == "groq":
        raise ProviderDisabled(
            "Groq is off. It needs JURO_LIVE_PROVIDER=groq, GROQ_API_KEY from a dedicated Groq "
            "Free-plan account, and JURO_GROQ_FREE_CONFIRMED=1 (no payment method on that account)."
        )
    raise ProviderDisabled(f"Unknown provider '{name}' is not allowed.")
