"""
EXPORT — fetch a Band tribunal room's messages and write them out as the
web/public/transcript.json the front-end plays. Split out of band_runner.py so
the message-parsing heuristics don't mix with CLI/REST orchestration.
"""

from __future__ import annotations

import os
import re

import httpx

from juro.cases import CASES, DEFAULT_CASE_ID
from juro.config import _TRANSCRIPT_OUT, _load_env, _rest_url, _user_api_key
from juro.generate import _evidence_from_case
from juro.roles import TURN_PLAN
from juro.transcript import Turn, build_transcript, estimate_duration, save_transcript

_ROLE_MAP = {
    "advocate": "advocate",
    "scrutinizer": "scrutinizer",
    "evidence": "evidence",
    "adjudicator": "adjudicator",
}

# Whole-word match: a plain substring check would misattribute any sender whose
# display name merely contains a role word (e.g. a human reviewer named
# "Advocate Jones") to that agent.
_ROLE_PATTERN = {key: re.compile(rf"\b{re.escape(key)}\b") for key in _ROLE_MAP}
_VERDICT_WORD = re.compile(r"\bOVERTURN(?:ED)?\b|\bUPHOLD\b|\bUPHELD\b")


def _agent_from_sender(sender_name: str) -> str | None:
    lower = sender_name.lower()
    for key, pattern in _ROLE_PATTERN.items():
        if pattern.search(lower):
            return _ROLE_MAP[key]
    return None


async def cmd_export() -> None:
    _load_env()
    room_id = os.environ.get("VERDICT_TRIBUNAL_ROOM_ID", "")
    if not room_id:
        raise SystemExit("VERDICT_TRIBUNAL_ROOM_ID not set.")

    api_key = _user_api_key()
    base_url = _rest_url()

    print(f"Fetching messages from tribunal room {room_id}…")
    async with httpx.AsyncClient(
        base_url=base_url,
        headers={"X-API-Key": api_key, "Content-Type": "application/json"},
        timeout=30.0,
    ) as client:
        r = await client.get(f"/api/v1/me/chats/{room_id}/messages")
        r.raise_for_status()
        data = r.json()

    messages = data.get("data", [])
    if isinstance(messages, dict):
        messages = messages.get("messages", messages.get("data", []))
    if not isinstance(messages, list):
        messages = []
    if not messages:
        raise SystemExit("No messages found in the tribunal room. Run a case first.")

    case_id = os.environ.get("VERDICT_CASE_ID", DEFAULT_CASE_ID)
    if case_id not in CASES:
        raise SystemExit(f"Unknown case id '{case_id}' in VERDICT_CASE_ID. Choose one of: {', '.join(CASES)}")
    case = dict(CASES[case_id]["case"])
    evidence = _evidence_from_case(case_id)

    turns: list[Turn] = []
    kind_idx = 0
    verdict_data = None

    for msg in messages:
        sender = msg.get("sender", {}).get("name", "") or msg.get("sender_name", "") or ""
        content = msg.get("content", "") or ""
        if not content.strip():
            continue

        agent = _agent_from_sender(sender)
        if agent is None:
            # Not a recognized agent — check whether the human reviewer's reply
            # carries the verdict word anywhere in it (not just as the entire
            # message), so a natural reply like "I'll go with UPHOLD." still counts.
            match = _VERDICT_WORD.search(content.strip().upper())
            if match:
                word = match.group(0)
                decision = "OVERTURNED" if word.startswith("OVERTURN") else "UPHELD"
                verdict_data = {
                    "decision": decision,
                    "rationale": content.strip(),
                    "by": sender or "Human Reviewer",
                    "confidence": 0.90,
                }
            continue

        if kind_idx < len(TURN_PLAN) and TURN_PLAN[kind_idx][0] == agent:
            kind = TURN_PLAN[kind_idx][1]
            kind_idx += 1
        else:
            kind = "argument"

        refs = []
        for ev in evidence:
            if ev.id in content:
                refs.append(ev.id)

        addressed = None
        for name in ("advocate", "scrutinizer", "evidence", "adjudicator", "human"):
            if f"@{name.capitalize()}" in content or f"@{name}" in content:
                addressed = name
                break

        turns.append(Turn(
            id=f"t{len(turns) + 1}",
            agent=agent,
            type=kind,
            text=content.strip(),
            durationMs=estimate_duration(content),
            addressedTo=addressed,
            evidenceRefs=refs,
        ))

    if not turns:
        raise SystemExit("No agent messages found in the room.")

    if verdict_data is None:
        verdict_data = {
            "decision": "PENDING",
            "rationale": "Human verdict not yet delivered.",
            "by": "—",
            "confidence": 0.0,
        }

    transcript = build_transcript(case, evidence, turns, verdict_data)
    os.makedirs(os.path.dirname(_TRANSCRIPT_OUT), exist_ok=True)
    save_transcript(transcript, _TRANSCRIPT_OUT)
    print(f"\n✓ Exported {len(turns)} turns → {_TRANSCRIPT_OUT}")
    print(f"  Juro: {verdict_data['decision']}")
    print(f"  Audit root: {transcript['auditRoot']}")
    print("  Reload the web app to play this Band-sourced debate.")
