"""
EXPORT — fetch a Band tribunal room's messages and write them out as the
web/public/transcript.json the front-end plays. Split out of band_runner.py so
the message-parsing heuristics don't mix with CLI/REST orchestration.

The room runs the 5-step Band relay (roles.RELAY_ORDER):
  Adjudicator (opening) -> Advocate -> Scrutinizer -> Evidence -> Adjudicator (ruling)
followed by the human reviewer's decision.
"""

from __future__ import annotations

import os
import re

import httpx

from juro.cases import CASES
from juro.config import _TRANSCRIPT_OUT, _load_env, _rest_url, _user_api_key
from juro.generate import _evidence_from_case
from juro.relay import NOTICE_PREFIX
from juro.transcript import Turn, build_transcript, estimate_duration, save_transcript

_ROLES = ("advocate", "scrutinizer", "evidence", "adjudicator")

# Whole-word match: a plain substring check would misattribute any sender whose
# display name merely contains a role word (e.g. a human reviewer named
# "Advocate Jones") to that agent.
_ROLE_PATTERN = {key: re.compile(rf"\b{re.escape(key)}\b") for key in _ROLES}

# Turn type by relay position. The chair speaks twice: first it opens, then it rules.
_DEBATER_KIND = {"advocate": "argument", "scrutinizer": "rebuttal", "evidence": "evidence"}

# The reviewer's decision must lead the message (optionally after @mentions), so a remark such as
# "don't overturn yet" is not read as a ruling.
_DECISION = re.compile(r"^\s*(?:@\S+[\s,:]*)*(OVERTURN(?:ED)?|UPHOLD|UPHELD|REMAND(?:ED)?)\b", re.IGNORECASE)
_TIME_KEYS = ("inserted_at", "created_at", "timestamp", "sent_at")
_PAGE_HINTS = ("next", "next_cursor", "has_more", "total_pages", "next_page")


class ExportError(SystemExit):
    pass


def _agent_from_sender(sender_name: str) -> str | None:
    lower = sender_name.lower()
    for key, pattern in _ROLE_PATTERN.items():
        if pattern.search(lower):
            return key
    return None


def _sender(msg: dict) -> str:
    sender = msg.get("sender") or {}
    name = sender.get("name") if isinstance(sender, dict) else None
    return name or msg.get("sender_name") or ""


def _ordered(messages: list[dict]) -> list[dict]:
    """Oldest first, by the first timestamp field present; otherwise keep the API order."""
    for key in _TIME_KEYS:
        if messages and all(isinstance(m.get(key), (str, int, float)) for m in messages):
            return sorted(messages, key=lambda m: m[key])
    return messages


def detect_case(messages: list[dict], fallback: str | None) -> str:
    """The case is whichever bundled case's claim id appears in a human message (the brief)."""
    for msg in messages:
        if _agent_from_sender(_sender(msg)) is not None:
            continue
        content = msg.get("content") or ""
        for case_id, case in CASES.items():
            if case["case"]["claimId"] in content:
                return case_id
    if fallback in CASES:
        return fallback
    raise ExportError(
        "Could not tell which case this room heard: no bundled claim id appears in the brief, and "
        f"VERDICT_CASE_ID is not set. Set VERDICT_CASE_ID to one of: {', '.join(CASES)}"
    )


def parse_room(messages: list[dict], case_id: str) -> tuple[list[Turn], dict]:
    """Turn room messages into transcript turns plus the human reviewer's verdict."""
    evidence = _evidence_from_case(case_id)
    ref_patterns = {ev.id: re.compile(rf"(?<![\w-]){re.escape(ev.id)}(?![\w-])") for ev in evidence}
    turns: list[Turn] = []
    ruled = False
    verdict: dict | None = None

    for msg in _ordered(messages):
        content = (msg.get("content") or "").strip()
        if not content or content.startswith(NOTICE_PREFIX):
            continue  # empty, or an agent's pause/failure notice: not part of the debate
        sender = _sender(msg)
        agent = _agent_from_sender(sender)

        if agent is None:
            # Human messages: only a decision given after the chair's ruling counts.
            match = _DECISION.match(content) if ruled else None
            if match:
                word = match.group(1).upper()
                decision = "OVERTURNED" if word.startswith("OVERTURN") else "REMANDED" if word.startswith("REMAND") else "UPHELD"
                verdict = {"decision": decision, "rationale": content, "by": sender or "Human reviewer"}
            continue

        if agent == "adjudicator":
            opened = any(t.agent == "adjudicator" for t in turns)
            kind = "ruling" if opened else "opening"
            ruled = ruled or kind == "ruling"
        else:
            kind = _DEBATER_KIND[agent]

        addressed = None
        for name in ("advocate", "scrutinizer", "evidence", "adjudicator", "human"):
            if re.search(rf"@{name}\b", content, re.IGNORECASE):
                addressed = name
                break

        turns.append(Turn(
            id=f"t{len(turns) + 1}",
            agent=agent,
            type=kind,
            text=content,
            durationMs=estimate_duration(content),
            addressedTo=addressed,
            evidenceRefs=[eid for eid, pat in ref_patterns.items() if pat.search(content)],
        ))

    if not turns:
        raise ExportError("No agent messages found in the room.")
    if not ruled:
        raise ExportError("The Adjudicator has not ruled yet in this room. Finish the hearing, then export.")
    if verdict is None:
        raise ExportError(
            "No reviewer decision found after the ruling. Reply in the room starting with OVERTURN, "
            "UPHOLD or REMAND, then export again."
        )
    return turns, verdict


async def cmd_export() -> None:
    _load_env()
    room_id = os.environ.get("VERDICT_TRIBUNAL_ROOM_ID", "")
    if not room_id:
        raise SystemExit("VERDICT_TRIBUNAL_ROOM_ID not set.")

    print(f"Fetching messages from tribunal room {room_id}…")
    async with httpx.AsyncClient(
        base_url=_rest_url(),
        headers={"X-API-Key": _user_api_key(), "Content-Type": "application/json"},
        timeout=30.0,
    ) as client:
        r = await client.get(f"/api/v1/me/chats/{room_id}/messages")
        r.raise_for_status()
        data = r.json()

    messages = data.get("data", []) if isinstance(data, dict) else []
    container = messages if isinstance(messages, dict) else data if isinstance(data, dict) else {}
    if isinstance(messages, dict):
        messages = messages.get("messages", messages.get("data", []))
    if not isinstance(messages, list):
        messages = []
    if not messages:
        raise SystemExit("No messages found in the tribunal room. Run a case first.")
    hints = [k for k in _PAGE_HINTS if isinstance(container, dict) and container.get(k)]
    if hints or (isinstance(data, dict) and isinstance(data.get("meta"), dict) and data["meta"].get("next")):
        print(f"  ! The API reported more pages ({', '.join(hints) or 'meta.next'}); only the first page was "
              "exported. The transcript may be incomplete.")

    # Never fall back to a default case: exporting the wrong case's evidence is worse than stopping.
    case_id = detect_case(messages, os.environ.get("VERDICT_CASE_ID"))
    turns, verdict = parse_room(messages, case_id)

    transcript = build_transcript(dict(CASES[case_id]["case"]), _evidence_from_case(case_id), turns, verdict)
    os.makedirs(os.path.dirname(_TRANSCRIPT_OUT), exist_ok=True)
    save_transcript(transcript, _TRANSCRIPT_OUT)
    print(f"\nExported {len(turns)} turns for case {case_id} -> {_TRANSCRIPT_OUT}")
    print(f"  Reviewer decision: {verdict['decision']}")
    print(f"  Audit root: {transcript['auditRoot']}")
