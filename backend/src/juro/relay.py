"""Relay logic for the Band tribunal, kept free of band-sdk imports so it can be unit-tested.

- classify_failure: map a model/provider error to rate-limited / quota-exhausted / disabled / error.
- run_turn: run one agent turn with bounded waits for per-minute limits, no retry once the agent has
  already posted (no duplicates), a visible pause notice when the free quota is used up, and a
  notice for any other failure, so the room is never left silent.
- AdjudicatorPhases: per-room "opened" state, so the chair rules after it has opened, whoever
  @mentions it (a reviewer resuming after a pause must not restart the debate).
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from typing import Awaitable, Callable

from juro.providers import ProviderDisabled

logger = logging.getLogger(__name__)

# Messages the agents post about the tribunal itself (pauses, failures). The exporter skips them.
NOTICE_PREFIX = "[tribunal notice]"

MAX_RATE_LIMIT_RETRIES = 2
MAX_WAIT_S = 60.0
DEFAULT_WAIT_S = 10.0


@dataclass
class Failure:
    kind: str  # "rate_limited" | "quota_exhausted" | "provider_disabled" | "error"
    message: str
    retry_after_s: float | None = None


def _status_and_headers(exc: BaseException) -> tuple[int | None, dict]:
    status = getattr(exc, "status_code", None)
    response = getattr(exc, "response", None)
    if status is None and response is not None:
        status = getattr(response, "status_code", None)
    headers = getattr(response, "headers", None) or {}
    return status, headers


def classify_failure(exc: BaseException) -> Failure:
    if isinstance(exc, ProviderDisabled):
        return Failure("provider_disabled", str(exc))
    status, headers = _status_and_headers(exc)
    text = str(exc)
    if status == 429:
        retry_after: float | None = None
        try:
            raw = headers.get("retry-after")
            retry_after = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            retry_after = None
        daily = re.search(r"per day|\bTPD\b|\bRPD\b|daily", text, re.IGNORECASE) is not None
        if daily or (retry_after is not None and retry_after > MAX_WAIT_S):
            return Failure("quota_exhausted", "the Groq free-tier quota is used up", retry_after)
        return Failure("rate_limited", "Groq is rate limiting requests", retry_after)
    return Failure("error", f"{type(exc).__name__}: {text[:160]}" if text else type(exc).__name__)


def notice_text(label: str, failure: Failure, *, gave_up_waiting: bool = False) -> str:
    if failure.kind == "quota_exhausted":
        body = (f"{label} paused: {failure.message}. The tribunal stops here; no paid fallback is used. "
                f"When the quota resets, @mention {label} to resume.")
    elif failure.kind == "rate_limited":
        body = (f"{label} paused: Groq kept rate limiting{' after waiting' if gave_up_waiting else ''}. "
                f"Wait a minute, then @mention {label} to resume.")
    elif failure.kind == "provider_disabled":
        body = f"{label} can't speak: live models are switched off on this server ({failure.message})"
    else:
        body = f"{label} couldn't respond ({failure.message}). @mention {label} to retry."
    return f"{NOTICE_PREFIX} {body}"


Send = Callable[[str, list[str]], Awaitable[object]]


async def run_turn(
    *,
    label: str,
    invoke: Callable[[], Awaitable[object]],
    reset: Callable[[], None],
    sent: Callable[[], bool],
    final_text: Callable[[], str],
    send: Send,
    forced: list[str],
    reviewer: Callable[[], Awaitable[str | None]],
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    compose: Callable[[str], str] = lambda text: text,
) -> bool:
    """Run one agent turn. Returns True if the agent's turn message reached the room.

    Each attempt number, rate-limit wait and the turn's outcome are recorded by juro.telemetry
    (model calls themselves are recorded by juro.llm). Telemetry never interrupts the turn.
    """
    from juro import telemetry

    started = time.monotonic()
    outcome = "unknown"
    try:
        attempt = 0
        while True:
            telemetry.set_attempt(attempt)
            reset()
            try:
                await invoke()
            except Exception as exc:  # noqa: BLE001 - every failure must end in a post or a log
                failure = classify_failure(exc)
                if sent():
                    # The turn already posted (the failure hit the follow-up model call): done, never repeat it.
                    logger.warning("[RELAY] %s failed after posting (%s); not retrying.", label, failure.kind)
                    outcome = f"posted_then_{failure.kind}"
                    return True
                if failure.kind == "rate_limited" and attempt < MAX_RATE_LIMIT_RETRIES:
                    wait = min(failure.retry_after_s or DEFAULT_WAIT_S, MAX_WAIT_S)
                    attempt += 1
                    logger.info("[RELAY] %s rate limited; waiting %.0fs (retry %d).", label, wait, attempt)
                    waited_from = time.monotonic()
                    try:
                        await sleep(wait)
                    finally:  # logged when the wait ends, with the measured (monotonic) duration
                        telemetry.wait(time.monotonic() - waited_from, "rate_limited", planned=wait)
                    continue
                await _post_notice(label, notice_text(label, failure, gave_up_waiting=attempt > 0), send, reviewer)
                outcome = f"paused_{failure.kind}"
                return False

            if sent():
                outcome = "posted"
                return True
            text = final_text()
            if text:
                # Silent turn: the model answered without calling band_send_message. Post it ourselves.
                logger.info("[RELAY] %s answered without the send tool; posting it -> %s", label, forced)
                if not forced:
                    logger.error("[RELAY] %s has no handoff target; not posting to avoid a loop.", label)
                    outcome = "silent_no_handoff"
                    return False
                await send(compose(text), forced)
                outcome = "posted_fallback"
                return True
            await _post_notice(label, notice_text(label, Failure("error", "the model returned nothing")), send, reviewer)
            outcome = "paused_empty"
            return False
    finally:
        telemetry.turn_end(outcome, int((time.monotonic() - started) * 1000))


async def _post_notice(label: str, text: str, send: Send, reviewer: Callable[[], Awaitable[str | None]]) -> None:
    # Notices go to the human reviewer only, so they never trigger another agent's turn.
    human = await reviewer()
    if not human:
        logger.error("[RELAY] %s: no human reviewer in the room to notify: %s", label, text)
        return
    try:
        await send(text, [human])
    except Exception:  # noqa: BLE001
        logger.exception("[RELAY] %s: could not post notice: %s", label, text)


class AdjudicatorPhases:
    """Per-room chair state: idle -> (opens) -> opened -> (rules) -> idle.

    Lives in the Adjudicator process's memory; a restart mid-hearing forgets it. To stay safe then,
    a message from Evidence also means "rule" (Evidence is the only voice that hands to the chair).
    """

    def __init__(self) -> None:
        self._opened: set[str] = set()

    def next_move(self, room_id: str, sender_name: str) -> str:
        if room_id in self._opened or re.search(r"\bevidence\b", sender_name or "", re.IGNORECASE):
            return "rule"
        return "open"

    def record(self, room_id: str, move: str) -> None:
        if move == "open":
            self._opened.add(room_id)
        else:
            self._opened.discard(room_id)


# ---------------------------------------------------------------------------
# Deterministic phase wording: code writes the procedural parts of every turn (the opening, each
# handoff, the ruling's closing line); the model supplies only the arguments in between.
# ---------------------------------------------------------------------------

HANDOFF_LINE: dict[str, str] = {
    "advocate": "@Scrutinizer, your response.",
    "scrutinizer": "@Evidence, confirm what the file shows.",
    "evidence": "@Adjudicator, the record is before you.",
}
OPEN_HANDOFF = "@Advocate, present the case for coverage."
_AGENT_NAMES = ("Advocate", "Scrutinizer", "Evidence", "Adjudicator")
_ROLE_LABEL = re.compile(r"^\s*(?:\*\*)?(?:advocate|scrutinizer|evidence|adjudicator|the bench)(?:\*\*)?\s*[:\-–—]\s*", re.I)
# Split only at . ! ? followed by whitespace and a sentence start, so citations such as
# "29 C.F.R. § 2560.503-1" stay intact; kept sentences are reused verbatim.
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[A-Z@\"“'(])")
_CLOSING = re.compile(r"over to you|the bench recommends|your call|reviewer, the call", re.I)


def _drop_procedural(text: str, reviewer: str | None) -> str:
    """Remove role labels, @mention/handoff sentences and the model's own closing line."""
    text = _ROLE_LABEL.sub("", text.strip())
    names = list(_AGENT_NAMES) + ([reviewer] if reviewer else [])
    kept = []
    for sentence in _SENTENCE_BREAK.split(text):
        s = sentence.strip()
        if not s:
            continue
        if re.search(r"@\w", s) or any(s.lower().startswith(f"{n.lower()}, ") for n in names):
            continue  # a handoff ("@Scrutinizer, your response." / "Advocate, begin."): code writes those
        if _CLOSING.search(s):
            continue  # the ruling's closing line: code writes it
        kept.append(s)
    return " ".join(kept).strip()


def recommendation_in(text: str) -> str | None:
    """OVERTURN / UPHOLD only when the text names exactly one of them."""
    over = re.search(r"\boverturn(?:ed|ing)?\b", text, re.I) is not None
    up = re.search(r"\buph(?:old|eld|olding)\b", text, re.I) is not None
    return "OVERTURN" if over and not up else "UPHOLD" if up and not over else None


def compose_turn(role: str, move: str | None, text: str, reviewer: str | None = None) -> str:
    """The model's argument plus the code-written procedural line for this role and phase."""
    if role == "adjudicator" and move == "rule":
        rec = recommendation_in(text)  # read before stripping: the closing line often names it
        body = _drop_procedural(text, reviewer)
        who = f"@{reviewer}" if reviewer else "reviewer"
        close = f"The bench recommends {rec}. Over to you, {who}." if rec else f"The recommendation is above. Over to you, {who}."
        return f"{body} {close}".strip() if body else close
    body = _drop_procedural(text, reviewer)
    line = OPEN_HANDOFF if role == "adjudicator" else HANDOFF_LINE.get(role, "")
    return f"{body} {line}".strip() if body else line


def opening_text(brief: str, cases: dict[str, dict]) -> str:
    """The chair's opening, written entirely by code from the case named in the brief (no model call)."""
    for case in cases.values():
        c = case["case"]
        if c["claimId"] in (brief or ""):
            return (f"This tribunal is convened on claim {c['claimId']}, {c['procedure']}, denied by {c['insurer']} as "
                    f"\"{c['denialReason']}\". The question is whether the record and the governing law support coverage. "
                    f"{OPEN_HANDOFF}")
    return ("This tribunal is convened on the claim in the brief above. The question is whether the record and the "
            f"governing law support coverage. {OPEN_HANDOFF}")
