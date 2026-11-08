#!/usr/bin/env python3
"""
Canonical case data: validate data/cases.json and generate the copies each half reads.

    python scripts/sync_cases.py           # validate + write the generated copies
    python scripts/sync_cases.py --check   # validate + fail if a generated copy is out of date

data/cases.json is the ONLY place to edit cases. Generated (do not edit):
    web/src/data/cases.generated.json     -> web/src/data/cases.ts
    backend/src/juro/cases_data.json      -> backend/src/juro/cases.py

Validation also refuses content that misrepresents the samples: named physicians, invented
audit roots, and model "confidence" numbers. Standard library only.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "cases.json"
TARGETS = {
    "web": ROOT / "web" / "src" / "data" / "cases.generated.json",
    "backend": ROOT / "backend" / "src" / "juro" / "cases_data.json",
}
GENERATED_NOTE = "GENERATED from data/cases.json by scripts/sync_cases.py. Do not edit; edit data/cases.json."

AGENTS = {"advocate", "scrutinizer", "evidence", "adjudicator"}
ADDRESSES = AGENTS | {"human"}
TURN_TYPES = {"opening", "argument", "rebuttal", "evidence", "question", "ruling"}
EVIDENCE_KINDS = {"clinical", "policy", "statute", "record", "eob"}
DECISIONS = {"OVERTURNED", "UPHELD", "REMANDED"}
CASE_FIELDS = ("claimId", "patient", "procedure", "denialReason", "amount", "insurer", "planType")
FORBIDDEN_KEYS = {"auditRoot", "confidence", "by"}
FORBIDDEN_TEXT = [
    (re.compile(r"\bDr\.?\s+[A-Z]"), "a named physician"),
    (re.compile(r",\s*(MD|DO)\b"), "a physician credential"),
]


def _strings(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _strings(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _strings(v, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, node


def _keys(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield f"{path}.{k}", k
            yield from _keys(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _keys(v, f"{path}[{i}]")


def validate(data: dict) -> list[str]:
    errors: list[str] = []
    err = errors.append
    cases = data.get("cases") if isinstance(data, dict) else None
    if not isinstance(cases, list) or not cases:
        return ["top level must be {\"cases\": [ ... ]} with at least one case"]

    ids, claims = set(), []
    for n, c in enumerate(cases):
        where = f"cases[{n}]"
        cid = c.get("id")
        if not isinstance(cid, str) or not re.fullmatch(r"[a-z0-9-]+", cid):
            err(f"{where}.id must be lowercase letters, digits and dashes")
            continue
        where = cid
        if cid in ids:
            err(f"{where}: duplicate id")
        ids.add(cid)
        for f in ("title", "tag", "blurb", "stake"):
            if not isinstance(c.get(f), str) or not c[f].strip():
                err(f"{where}.{f} is required")
        case = c.get("case") or {}
        for f in CASE_FIELDS:
            if not isinstance(case.get(f), str) or not case[f].strip():
                err(f"{where}.case.{f} is required")
        if isinstance(case.get("claimId"), str):
            claims.append((cid, case["claimId"]))

        ev_ids = set()
        for i, e in enumerate(c.get("evidence") or []):
            ew = f"{where}.evidence[{i}]"
            if not isinstance(e.get("id"), str) or not re.fullmatch(r"[A-Z]+-\d+", e["id"]):
                err(f"{ew}.id must look like EX-01 or STAT-1")
                continue
            if e["id"] in ev_ids:
                err(f"{ew}: duplicate evidence id {e['id']}")
            ev_ids.add(e["id"])
            if e.get("kind") not in EVIDENCE_KINDS:
                err(f"{ew}.kind must be one of {sorted(EVIDENCE_KINDS)}")
            for f in ("label", "cite"):
                if not isinstance(e.get(f), str) or not e[f].strip():
                    err(f"{ew}.{f} is required")
            if not (e.get("detail") or e.get("authority")):
                err(f"{ew} needs a detail (records) or an authority (statutes)")
        if not ev_ids:
            err(f"{where}.evidence must not be empty")

        sample = c.get("sample") or {}
        turns = sample.get("turns") or []
        if not turns:
            err(f"{where}.sample.turns must not be empty")
        for i, t in enumerate(turns):
            tw = f"{where}.sample.turns[{i}]"
            if t.get("id") != f"t{i + 1}":
                err(f"{tw}.id must be t{i + 1}")
            if t.get("agent") not in AGENTS:
                err(f"{tw}.agent must be one of {sorted(AGENTS)}")
            if t.get("type") not in TURN_TYPES:
                err(f"{tw}.type must be one of {sorted(TURN_TYPES)}")
            if not isinstance(t.get("text"), str) or not t["text"].strip():
                err(f"{tw}.text is required")
            if not isinstance(t.get("durationMs"), int) or t["durationMs"] <= 0:
                err(f"{tw}.durationMs must be a positive integer")
            if "addressedTo" in t and t["addressedTo"] not in ADDRESSES:
                err(f"{tw}.addressedTo must be one of {sorted(ADDRESSES)}")
            for r in t.get("evidenceRefs") or []:
                if r not in ev_ids:
                    err(f"{tw}.evidenceRefs cites {r}, which is not in this case's evidence")
        if turns and turns[0].get("type") != "opening":
            err(f"{where}.sample.turns must start with an opening")
        if turns and turns[-1].get("type") != "ruling":
            err(f"{where}.sample.turns must end with a ruling")
        rec = sample.get("recommendation") or {}
        if rec.get("decision") not in DECISIONS:
            err(f"{where}.sample.recommendation.decision must be one of {sorted(DECISIONS)}")
        if not isinstance(rec.get("rationale"), str) or not rec["rationale"].strip():
            err(f"{where}.sample.recommendation.rationale is required")

    for i, (a, ca) in enumerate(claims):
        for b, cb in claims[i + 1:]:
            if ca == cb or ca in cb or cb in ca:
                err(f"claim ids of {a} and {b} overlap ({ca} / {cb}); the Band export finds cases by claim id")

    for path, key in _keys(data):
        if key in FORBIDDEN_KEYS:
            err(f"{path}: '{key}' is not allowed (no invented audit roots, confidence numbers or reviewer names)")
    for path, text in _strings(data):
        for pattern, what in FORBIDDEN_TEXT:
            if pattern.search(text):
                err(f"{path}: contains {what}; samples must not be attributed to a real-looking clinician")
    return errors


def render(data: dict) -> str:
    return json.dumps({"_generated": GENERATED_NOTE, **data}, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    check = "--check" in argv
    try:
        data = json.loads(SOURCE.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"cannot read {SOURCE.relative_to(ROOT)}: {exc}")
        return 1
    errors = validate(data)
    if errors:
        print(f"{SOURCE.relative_to(ROOT)} is invalid:")
        for e in errors:
            print(f"  - {e}")
        return 1
    expected = render(data)
    stale = []
    for name, target in TARGETS.items():
        current = target.read_text(encoding="utf-8") if target.exists() else None
        if current == expected:
            continue
        if check:
            stale.append(str(target.relative_to(ROOT)))
        else:
            target.write_text(expected, encoding="utf-8", newline="\n")
            print(f"wrote {target.relative_to(ROOT)}")
    if stale:
        print("Generated case data is out of date: " + ", ".join(stale))
        print("Run: python scripts/sync_cases.py")
        return 1
    print(f"cases OK ({len(data['cases'])} cases){', generated copies up to date' if check else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
