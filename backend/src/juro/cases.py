"""
Case library for the Juro adversarial tribunal.

Mirrors the three real-shaped denials defined in the front-end
(web/src/data/cases.ts) so the backend can generate a transcript for any of
them. Keyed by the same ids the UI uses:

    mri-erisa     R. Alvarez   — MRI lumbar / ERISA step-therapy denial
    pet-oncology  D. Okafor    — PET/CT lymphoma / ERISA "experimental" denial
    snf-jimmo     M. Reyes     — Skilled nursing rehab cut / Medicare Advantage

Each value is { "case": {...}, "evidence": [ {...}, ... ] } and is the single
source of truth consumed by juro.generate and juro.band_runner.
"""

from __future__ import annotations

CASES: dict[str, dict] = {
    "mri-erisa": {
        "case": {
            "claimId": "DN-2026-04471",
            "patient": "R. Alvarez, 47",
            "procedure": "MRI lumbar spine w/ contrast - CPT 72148",
            "denialReason": "Not medically necessary, step therapy not met",
            "amount": "$2,840",
            "insurer": "Meridian Health",
            "planType": "Employer plan - ERISA",
        },
        "evidence": [
            {"id": "STAT-1", "kind": "statute", "label": "ERISA, full and fair review",
             "cite": "29 C.F.R. § 2560.503-1",
             "authority": "A full and fair review of the entire claim file, free of charge, and 180 days to appeal."},
            {"id": "STAT-2", "kind": "statute", "label": "ACA §2719, external review",
             "cite": "45 C.F.R. § 147.136",
             "authority": "After an internal appeal, an independent reviewer decides and the insurer is bound by it."},
            {"id": "STAT-3", "kind": "statute", "label": "ACR Appropriateness Criteria",
             "cite": "ACR AC - Low Back Pain",
             "authority": "MRI is indicated for radiculopathy with a motor deficit."},
            {"id": "EX-01", "kind": "policy", "label": "Plan medical-necessity criteria",
             "cite": "SPD §4.2",
             "detail": "Six weeks of conservative care, or a red-flag exception for a progressive deficit."},
            {"id": "EX-03", "kind": "clinical", "label": "Neurology exam",
             "cite": "Chart 2026-06-02",
             "detail": "Progressive left foot-drop, 3/5 dorsiflexion, new since the 05-14 visit."},
            {"id": "EX-04", "kind": "record", "label": "Physical-therapy log",
             "cite": "Rehab record Apr to Jun",
             "detail": "Seven weeks of conservative therapy completed, no improvement."},
            {"id": "EX-06", "kind": "eob", "label": "Original denial",
             "cite": "Code ST-06",
             "detail": "Auto-denied, the conservative-care window wasn't detected in the claim as filed."},
        ],
    },
    "pet-oncology": {
        "case": {
            "claimId": "ON-2026-0612",
            "patient": "D. Okafor, 58",
            "procedure": "PET/CT whole body - CPT 78815",
            "denialReason": "Not medically necessary, interim restaging not supported",
            "amount": "$6,400",
            "insurer": "Coastal Mutual",
            "planType": "Employer plan - ERISA",
        },
        "evidence": [
            {"id": "STAT-1", "kind": "statute", "label": "ERISA, full and fair review",
             "cite": "29 C.F.R. § 2560.503-1",
             "authority": "The plan must review the whole record and give a specific reason a clinician can answer."},
            {"id": "STAT-2", "kind": "statute", "label": "ACA §2719, external review",
             "cite": "45 C.F.R. § 147.136",
             "authority": "An independent external reviewer can overturn the plan, and the plan is bound by it."},
            {"id": "STAT-3", "kind": "statute", "label": "NCCN Guidelines",
             "cite": "NCCN - Hodgkin Lymphoma",
             "authority": "Interim PET/CT is the standard tool to assess treatment response in Hodgkin lymphoma."},
            {"id": "EX-01", "kind": "policy", "label": "Plan oncology imaging policy",
             "cite": "Med Policy ON-09",
             "detail": "PET covered for staging and response assessment of biopsy-proven lymphoma."},
            {"id": "EX-02", "kind": "clinical", "label": "Pathology report",
             "cite": "Path 2026-05-20",
             "detail": "Biopsy-confirmed classic Hodgkin lymphoma, nodular sclerosis."},
            {"id": "EX-03", "kind": "clinical", "label": "Oncology note",
             "cite": "Chart 2026-06-08",
             "detail": "Interim restaging after two cycles to decide whether to escalate therapy."},
            {"id": "EX-04", "kind": "record", "label": "Prior CT",
             "cite": "Imaging 2026-05-28",
             "detail": "Residual mediastinal mass, indeterminate, CT cannot tell scar from active disease."},
            {"id": "EX-06", "kind": "eob", "label": "Original denial",
             "cite": "Code MN-22",
             "detail": "Auto-denied, the system flagged a second scan in 30 days as duplicative."},
        ],
    },
    "snf-jimmo": {
        "case": {
            "claimId": "PA-2026-0731",
            "patient": "M. Reyes, 74",
            "procedure": "Skilled nursing facility, continued rehab, days 15 to 21",
            "denialReason": "No longer medically necessary, plateau",
            "amount": "$4,900",
            "insurer": "Summit Advantage",
            "planType": "Medicare Advantage",
        },
        "evidence": [
            {"id": "STAT-1", "kind": "statute", "label": "Jimmo v. Sebelius settlement",
             "cite": "Jimmo - CMS 2013",
             "authority": "There is no \"improvement standard.\" Skilled care is covered to maintain function or slow decline, not only to improve."},
            {"id": "STAT-2", "kind": "statute", "label": "Medicare Benefit Policy Manual",
             "cite": "Ch. 8, SNF coverage",
             "authority": "Coverage turns on whether skilled care is needed, judged on the patient, not a projected length of stay."},
            {"id": "STAT-3", "kind": "statute", "label": "MA reconsideration rights",
             "cite": "42 C.F.R. § 405.926",
             "authority": "A Medicare Advantage member can appeal a coverage cut and get an independent reconsideration."},
            {"id": "EX-01", "kind": "record", "label": "Physical-therapy notes, days 8 to 14",
             "cite": "Rehab log",
             "detail": "Gait distance went from 25 to 90 feet, transfers from moderate to minimal assist. Still progressing."},
            {"id": "EX-02", "kind": "clinical", "label": "Treating physician order",
             "cite": "Order 2026-07-28",
             "detail": "Continue skilled rehab, functional goals not yet met, unsafe for discharge."},
            {"id": "EX-03", "kind": "eob", "label": "Plan denial",
             "cite": "Code SNF-PL",
             "detail": "Projected length of stay reached, the model flagged a plateau."},
            {"id": "EX-04", "kind": "clinical", "label": "Functional assessment",
             "cite": "Nursing 2026-07-29",
             "detail": "Still needs skilled supervision for safe transfers, high fall risk without it."},
        ],
    },
}

DEFAULT_CASE_ID = "mri-erisa"
