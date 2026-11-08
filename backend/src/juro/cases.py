"""
Case library for the Juro adversarial tribunal.

Loaded from cases_data.json, which scripts/sync_cases.py generates from the canonical
data/cases.json at the repo root (the web app's cases.generated.json comes from the same
file, so the two halves never drift). Edit data/cases.json, never this module's data.

    mri-erisa     R. Alvarez  - MRI lumbar / ERISA step-therapy denial
    pet-oncology  D. Okafor   - PET/CT lymphoma / ERISA "experimental" denial
    snf-jimmo     M. Reyes    - Skilled nursing rehab cut / Medicare Advantage

CASES maps id -> {"case": {...}, "evidence": [ {...}, ... ]}, consumed by juro.generate,
juro.band_runner and juro.export.
"""

from __future__ import annotations

import json
from importlib import resources


def _load() -> dict[str, dict]:
    raw = json.loads(resources.files("juro").joinpath("cases_data.json").read_text(encoding="utf-8"))
    return {c["id"]: {"case": c["case"], "evidence": c["evidence"]} for c in raw["cases"]}


CASES: dict[str, dict] = _load()

DEFAULT_CASE_ID = "mri-erisa"
