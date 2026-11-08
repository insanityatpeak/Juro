"""
GROQ CHECK — a tightly capped test of the Band agents' Groq Free setup, before any full hearing.

    python -m juro.groq_check            # 2 calls (raw SDK + the agents' LangChain path)
    python -m juro.groq_check --calls 1  # raw SDK call only
    python -m juro.groq_check --json     # machine-readable report

What it checks, on the bundled synthetic case only (no real patient data):
  1. the provider switches (JURO_LIVE_PROVIDER, GROQ_API_KEY, JURO_GROQ_FREE_CONFIRMED) allow Groq;
  2. the model answers and calls the band_send_message tool with usable arguments;
  3. the agents' own path (GuardedChatGroq, streamed) also produces that tool call;
  4. latency, token usage, and the account's remaining limits (x-ratelimit-* headers).

Caps: at most 3 calls, a small output-token limit, no retries. A rate-limit or quota error stops
the check immediately (no waiting, no fallback). The report never includes the API key or case text.
Exit codes: 0 pass, 1 fail, 2 Groq not enabled / misconfigured.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Callable

from juro.llm import groq_model
from juro.providers import ProviderDisabled, require_provider
from juro.relay import classify_failure

MAX_CALLS = 3
DEFAULT_MAX_TOKENS = 400
MAX_CONTENT_CHARS = 1200
RATE_HEADERS = (
    "x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "x-ratelimit-reset-requests",
    "x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens", "x-ratelimit-reset-tokens",
)

SEND_TOOL = {
    "type": "function",
    "function": {
        "name": "band_send_message",
        "description": "Post your turn to the tribunal room. This is the ONLY way to speak.",
        "parameters": {
            "type": "object",
            "properties": {
                "content": {"type": "string", "description": "Your 2-4 sentence turn."},
                "mentions": {"type": "array", "items": {"type": "string"}, "description": "Who you hand the floor to."},
            },
            "required": ["content", "mentions"],
        },
    },
}


@dataclass
class CallResult:
    path: str  # "raw-sdk" | "langchain-stream"
    ok: bool
    latency_ms: int
    tool_called: bool = False
    tool_args_valid: bool = False
    content_chars: int = 0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    finish_reason: str | None = None
    error_kind: str | None = None
    error: str | None = None


@dataclass
class Report:
    model: str
    verdict: str = "FAIL"  # PASS | WARN | FAIL | DISABLED
    calls: list[CallResult] = field(default_factory=list)
    rate_limits: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def _messages() -> list[dict]:
    from juro.cases import CASES
    from juro.generate import _case_brief, _evidence_from_case
    from juro.roles import SYSTEM_PROMPTS, band_section

    case_id = "mri-erisa"  # bundled synthetic case
    brief = _case_brief(dict(CASES[case_id]["case"]), _evidence_from_case(case_id))
    return [
        {"role": "system", "content": SYSTEM_PROMPTS["advocate"] + band_section("advocate")},
        {"role": "user", "content": f"[synthetic test case]\n{brief}\n\n@Advocate, present the case for coverage."},
    ]


def _check_args(raw: str | dict | None) -> tuple[bool, int]:
    try:
        args = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except (TypeError, ValueError):
        return False, 0
    content = args.get("content") if isinstance(args, dict) else None
    mentions = args.get("mentions") if isinstance(args, dict) else None
    ok = isinstance(content, str) and 0 < len(content.strip()) <= MAX_CONTENT_CHARS and isinstance(mentions, list)
    return ok, len(content) if isinstance(content, str) else 0


def _reasoning(model: str) -> dict:
    return {"reasoning_effort": "low", "include_reasoning": False} if model.startswith("openai/gpt-oss") else {}


def raw_sdk_call(client: Any, model: str, max_tokens: int, clock: Callable[[], float]) -> tuple[CallResult, dict]:
    """One chat call with the send tool, reading the account's rate-limit headers."""
    start = clock()
    try:
        raw = client.chat.completions.with_raw_response.create(
            model=model, messages=_messages(), tools=[SEND_TOOL], tool_choice="auto",
            max_completion_tokens=max_tokens, temperature=0.6, **_reasoning(model),
        )
    except Exception as exc:  # noqa: BLE001
        f = classify_failure(exc)
        return CallResult("raw-sdk", False, int((clock() - start) * 1000), error_kind=f.kind, error=f.message), {}
    latency = int((clock() - start) * 1000)
    headers = {h: raw.headers.get(h) for h in RATE_HEADERS if raw.headers.get(h) is not None}
    resp = raw.parse()
    choice = resp.choices[0]
    calls = [c for c in (choice.message.tool_calls or []) if c.function.name == "band_send_message"]
    valid, chars = _check_args(calls[0].function.arguments) if calls else (False, 0)
    usage = getattr(resp, "usage", None)
    return CallResult(
        "raw-sdk", True, latency, tool_called=bool(calls), tool_args_valid=valid, content_chars=chars,
        prompt_tokens=getattr(usage, "prompt_tokens", None), completion_tokens=getattr(usage, "completion_tokens", None),
        finish_reason=choice.finish_reason,
    ), headers


async def langchain_stream_call(model_factory: Callable[[], Any], clock: Callable[[], float]) -> CallResult:
    """The agents' own path: GuardedChatGroq with the tool bound, streamed like LangGraph does."""
    from langchain_core.messages import HumanMessage, SystemMessage

    msgs = _messages()
    start = clock()
    try:
        llm = model_factory().bind_tools([SEND_TOOL])
        merged = None
        async for chunk in llm.astream([SystemMessage(content=msgs[0]["content"]), HumanMessage(content=msgs[1]["content"])]):
            merged = chunk if merged is None else merged + chunk
    except Exception as exc:  # noqa: BLE001
        f = classify_failure(exc)
        return CallResult("langchain-stream", False, int((clock() - start) * 1000), error_kind=f.kind, error=f.message)
    latency = int((clock() - start) * 1000)
    calls = [c for c in (getattr(merged, "tool_calls", None) or []) if c.get("name") == "band_send_message"]
    valid, chars = _check_args(calls[0].get("args")) if calls else (False, 0)
    usage = getattr(merged, "usage_metadata", None) or {}
    return CallResult(
        "langchain-stream", True, latency, tool_called=bool(calls), tool_args_valid=valid, content_chars=chars,
        prompt_tokens=usage.get("input_tokens"), completion_tokens=usage.get("output_tokens"),
    )


def run_check(*, calls: int, max_tokens: int, client_factory: Callable[[], Any],
              model_factory: Callable[[], Any], clock: Callable[[], float] = time.monotonic) -> Report:
    report = Report(model=groq_model())
    try:
        require_provider("groq")
    except ProviderDisabled as exc:
        report.verdict = "DISABLED"
        report.notes.append(str(exc))
        return report

    calls = max(1, min(calls, MAX_CALLS))
    max_tokens = max(64, min(max_tokens, 1024))
    first, headers = raw_sdk_call(client_factory(), report.model, max_tokens, clock)
    report.calls.append(first)
    report.rate_limits = headers
    if first.ok and calls >= 2:
        report.calls.append(asyncio.run(langchain_stream_call(model_factory, clock)))
    if first.ok and calls >= 3:  # a second raw call: shows how the remaining limits move
        nxt, headers = raw_sdk_call(client_factory(), report.model, max_tokens, clock)
        report.calls.append(nxt)
        report.rate_limits = headers or report.rate_limits

    failed = [c for c in report.calls if not c.ok]
    if failed:
        f = failed[0]
        report.verdict = "FAIL"
        if f.error_kind in ("rate_limited", "quota_exhausted"):
            report.notes.append("Stopped at the first rate-limit/quota error, as designed. Try again after the limit resets.")
    elif all(c.tool_called and c.tool_args_valid for c in report.calls):
        report.verdict = "PASS"
    else:
        report.verdict = "WARN"
        report.notes.append(
            "The model answered but did not reliably call band_send_message with valid arguments. The relay "
            "would fall back to posting plain text; consider another Free-plan model via GROQ_MODEL."
        )
    if not headers:
        report.notes.append("No x-ratelimit-* headers were returned; check limits on the Groq console.")
    return report


def _print(report: Report) -> None:
    print(f"Groq check · model {report.model} · {report.verdict}")
    for c in report.calls:
        status = "ok" if c.ok else f"error ({c.error_kind}: {c.error})"
        print(f"  [{c.path}] {status} · {c.latency_ms} ms · tool call: {'yes' if c.tool_called else 'no'}"
              f" · args valid: {'yes' if c.tool_args_valid else 'no'} · tokens in/out: {c.prompt_tokens}/{c.completion_tokens}")
    if report.rate_limits:
        print("  limits: " + ", ".join(f"{k.replace('x-ratelimit-', '')}={v}" for k, v in report.rate_limits.items()))
    for n in report.notes:
        print(f"  note: {n}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m juro.groq_check", description=__doc__.split("\n\n")[0])
    p.add_argument("--calls", type=int, default=2, help=f"1-{MAX_CALLS} (default 2)")
    p.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS, help="per-call output cap (64-1024)")
    p.add_argument("--json", action="store_true", help="print a JSON report (no key, no case text)")
    args = p.parse_args(argv)

    from juro.config import _load_env

    _load_env()

    def client_factory():
        from groq import Groq

        return Groq(api_key=os.environ["GROQ_API_KEY"], max_retries=0, timeout=30)

    def model_factory():
        from juro.llm import create_chat_model

        return create_chat_model()

    report = run_check(calls=args.calls, max_tokens=args.max_tokens, client_factory=client_factory, model_factory=model_factory)
    if args.json:
        print(json.dumps(asdict(report), indent=2))
    else:
        _print(report)
    return {"PASS": 0, "DISABLED": 2}.get(report.verdict, 1)


if __name__ == "__main__":
    sys.exit(main())
