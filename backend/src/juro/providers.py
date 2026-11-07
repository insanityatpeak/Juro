"""Provider controls (mirror of web/src/lib/providers.ts).

Juro must run without paid services. Paid model APIs are off and cannot be switched on by setting
an API key. Call `require_provider(...)` immediately before every model call (not just at startup),
so a retry or a long-running agent process also stops.

A free provider can be added later with its own control. Do not add a paid fallback.
"""

from __future__ import annotations

PAID_PROVIDERS = {"anthropic"}


class ProviderDisabled(RuntimeError):
    """Raised instead of making a call to a provider that is not allowed."""


def provider_allowed(name: str) -> bool:
    return name not in PAID_PROVIDERS


def require_provider(name: str) -> None:
    if not provider_allowed(name):
        raise ProviderDisabled(
            f"The '{name}' provider is disabled: Juro uses no paid services. "
            "Setting an API key does not enable it."
        )
