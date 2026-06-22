"""
Transcript model + tamper-evident audit chain.

The transcript is the contract between the backend and the front-end: the exact
shape in web/src/lib/types.ts. Every turn is hash-chained
(hash_i = sha256(hash_{i-1} + canonical(turn_i))) so any later edit to the record
is detectable — this is the "audit-ready" property regulated workflows require.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class EvidenceItem:
    id: str
    label: str
    kind: str  # clinical | policy | eob | statute | record
    cite: str
    detail: str = ""


@dataclass
class Turn:
    id: str
    agent: str
    type: str
    text: str
    durationMs: int
    addressedTo: str | None = None
    evidenceRefs: list[str] = field(default_factory=list)
    hash: str | None = None


def _canonical(obj: dict[str, Any]) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def chain_turns(turns: list[Turn]) -> str:
    """Populate each turn.hash and return the audit root (last hash, short form)."""
    prev = "genesis"
    for t in turns:
        payload = {k: v for k, v in asdict(t).items() if k != "hash"}
        digest = hashlib.sha256((prev + _canonical(payload)).encode("utf-8")).hexdigest()
        t.hash = digest
        prev = digest
    return f"{prev[:4]}…{prev[-4:]}" if prev != "genesis" else "—"


def estimate_duration(text: str) -> int:
    """A readable speaking time for playback: ~45ms/char, clamped to 3.5–8s."""
    return max(3500, min(8000, len(text) * 45))


def build_transcript(case: dict, evidence: list[EvidenceItem], turns: list[Turn], verdict: dict) -> dict:
    audit_root = chain_turns(turns)
    return {
        "case": case,
        "evidence": [asdict(e) for e in evidence],
        "turns": [asdict(t) for t in turns],
        "verdict": verdict,
        "auditRoot": audit_root,
    }


def save_transcript(transcript: dict, path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(transcript, f, indent=2, ensure_ascii=False)
