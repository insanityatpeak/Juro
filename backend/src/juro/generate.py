"""
Local debate generator (no Band required).

Runs the four tribunal agents as plain Anthropic calls — the SAME role prompts
and turn order as the Band runtime — and writes a hash-chained transcript the
front-end can play. This lets you drive the cinematic UI with a *real* AI debate
using only your ANTHROPIC_API_KEY, and it's the fastest way to iterate on the
agents before provisioning Band.

Usage:
    cd backend && pip install -e .
    export ANTHROPIC_API_KEY=sk-ant-...        # PowerShell: $env:ANTHROPIC_API_KEY="..."
    python -m juro.generate                  # default case (mri-erisa)
    python -m juro.generate pet-oncology     # any of the 3 case ids
    python -m juro.generate snf-jimmo        # writes web/public/transcript.json

The Band submission path (juro.band_runner) reuses agents.py unchanged.
"""

from __future__ import annotations

import json
import os
import sys

from dotenv import load_dotenv
import anthropic

from juro.cases import CASES, DEFAULT_CASE_ID
from juro.roles import SYSTEM_PROMPTS, TURN_PLAN, model_for
from juro.transcript import (
    EvidenceItem,
    Turn,
    build_transcript,
    estimate_duration,
    save_transcript,
)


def _evidence_from_case(case_id: str) -> list[EvidenceItem]:
    """Convert the cases.py evidence dicts into EvidenceItem dataclasses.

    EvidenceItem(id, label, kind, cite, detail="") — an evidence entry carries
    either a "detail" (clinical/policy/record) or an "authority" (statute); map
    whichever is present into the detail field.
    """
    items: list[EvidenceItem] = []
    for e in CASES[case_id]["evidence"]:
        detail = e.get("detail", e.get("authority", ""))
        items.append(EvidenceItem(e["id"], e["label"], e["kind"], e["cite"], detail))
    return items


def _select_case(case_id: str | None) -> tuple[str, dict, list[EvidenceItem]]:
    cid = case_id or DEFAULT_CASE_ID
    if cid not in CASES:
        raise SystemExit(
            f"Unknown case id '{cid}'. Choose one of: {', '.join(CASES)}"
        )
    return cid, dict(CASES[cid]["case"]), _evidence_from_case(cid)


# ---- the case under review (the denial the tribunal will argue) -------------
# Defaults to the MRI/ERISA case; main() rebuilds these from an argv case id.
CASE_ID = DEFAULT_CASE_ID
CASE = dict(CASES[CASE_ID]["case"])
EVIDENCE = _evidence_from_case(CASE_ID)


def _case_brief() -> str:
    ev = "\n".join(f"  {e.id} [{e.kind}] {e.label}: {e.detail} (cite {e.cite})" for e in EVIDENCE)
    return (
        f"CLAIM {CASE['claimId']} — {CASE['patient']}\n"
        f"Procedure: {CASE['procedure']} ({CASE['amount']})\n"
        f"Insurer: {CASE['insurer']}\n"
        f"DENIAL: {CASE['denialReason']}\n\nEVIDENCE ON THE RECORD:\n{ev}"
    )


def _transcript_so_far(turns: list[Turn]) -> str:
    if not turns:
        return "(the floor is open)"
    return "\n".join(f"{t.agent.upper()}: {t.text}" for t in turns)


def _ask(client: anthropic.Anthropic, role: str, kind: str, turns: list[Turn]) -> dict:
    valid_ids = ", ".join(e.id for e in EVIDENCE)
    user = (
        f"{_case_brief()}\n\nDEBATE SO FAR:\n{_transcript_so_far(turns)}\n\n"
        f"It is your turn ({role}, contribution type: {kind}). "
        f"Valid evidence ids: {valid_ids}.\n"
        'Respond ONLY with compact JSON: '
        '{"text": "<your 1-3 sentence line>", '
        '"addressedTo": "<advocate|scrutinizer|evidence|adjudicator|human|null>", '
        '"evidenceRefs": ["EX-..", ...]}'
    )
    msg = client.messages.create(
        model=model_for(role),
        max_tokens=400,
        system=SYSTEM_PROMPTS[role],
        messages=[{"role": "user", "content": user}],
    )
    raw = "".join(block.text for block in msg.content if block.type == "text").strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"LLM returned non-JSON for {role}/{kind}: {raw[:200]}")
    try:
        data = json.loads(raw[start : end + 1])
    except json.JSONDecodeError as e:
        raise ValueError(f"Bad JSON from {role}/{kind}: {e}\nRaw: {raw[:200]}") from e
    text = data.get("text")
    if not text:
        raise ValueError(f"LLM response missing 'text' for {role}/{kind}: {data}")
    refs = [r for r in data.get("evidenceRefs", []) if r in {e.id for e in EVIDENCE}]
    addressed = data.get("addressedTo")
    if addressed in ("null", "", None):
        addressed = None
    return {"text": text.strip(), "addressedTo": addressed, "evidenceRefs": refs}


def _final_verdict(client: anthropic.Anthropic, turns: list[Turn]) -> dict:
    user = (
        f"{_case_brief()}\n\nFULL DEBATE:\n{_transcript_so_far(turns)}\n\n"
        "You are the human medical reviewer delivering the FINAL verdict. "
        'Respond ONLY with JSON: {"decision": "OVERTURNED|UPHELD", '
        '"rationale": "<one or two sentences>", "confidence": <0..1>}'
    )
    msg = client.messages.create(
        model=model_for("adjudicator"),
        max_tokens=300,
        system="You weigh both sides fairly and decide. Patients deserve a defense; insurers deserve rigor.",
        messages=[{"role": "user", "content": user}],
    )
    raw = "".join(b.text for b in msg.content if b.type == "text").strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"LLM returned non-JSON for final verdict: {raw[:200]}")
    try:
        data = json.loads(raw[start : end + 1])
    except json.JSONDecodeError as e:
        raise ValueError(f"Bad JSON from final verdict: {e}\nRaw: {raw[:200]}") from e
    return {
        "decision": data.get("decision", "OVERTURNED"),
        "rationale": data.get("rationale", "Juro delivered."),
        "by": "Dr. P. Nguyen, MD · Medical Reviewer",
        "confidence": float(data.get("confidence", 0.85)),
    }


def main() -> None:
    global CASE_ID, CASE, EVIDENCE
    requested = sys.argv[1] if len(sys.argv) > 1 else None
    CASE_ID, CASE, EVIDENCE = _select_case(requested)
    print(f"Generating debate for case: {CASE_ID}  ({CASE['claimId']} — {CASE['patient']})")

    _env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env")
    if os.path.exists(_env):
        load_dotenv(_env)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("Set ANTHROPIC_API_KEY first (see backend/.env.example).")
    client = anthropic.Anthropic()

    turns: list[Turn] = []
    for i, (role, kind) in enumerate(TURN_PLAN, start=1):
        print(f"  [{i:>2}/{len(TURN_PLAN)}] {role} ({kind})…")
        out = _ask(client, role, kind, turns)
        turns.append(
            Turn(
                id=f"t{i}",
                agent=role,
                type=kind,
                text=out["text"],
                durationMs=estimate_duration(out["text"]),
                addressedTo=out["addressedTo"],
                evidenceRefs=out["evidenceRefs"],
            )
        )

    verdict = _final_verdict(client, turns)
    transcript = build_transcript(CASE, EVIDENCE, turns, verdict)

    # Write where the front-end can fetch it (UI falls back to the bundled sample).
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(here, "..", "..", ".."))
    out_path = os.path.join(repo_root, "web", "public", "transcript.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    save_transcript(transcript, out_path)
    print(f"\n✓ Juro: {verdict['decision']} (conf {verdict['confidence']:.2f})")
    print(f"✓ Audit root {transcript['auditRoot']}")
    print(f"✓ Wrote {out_path}")
    print("  Reload the web app — it will play this real debate.")


if __name__ == "__main__":
    main()
