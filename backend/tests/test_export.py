"""Band room -> transcript: relay labels, case detection, notices skipped, verdict rules."""

import pytest

from juro.cases import CASES
from juro.export import ExportError, detect_case, parse_room
from juro.relay import NOTICE_PREFIX

PET = "pet-oncology"
CLAIM = CASES[PET]["case"]["claimId"]


def m(sender, content, t=None):
    msg = {"sender": {"name": sender}, "content": content}
    if t is not None:
        msg["inserted_at"] = t
    return msg


def room(decision="UPHOLD, documentation is missing."):
    msgs = [
        m("Priya", f"CLAIM {CLAIM} - brief. @Adjudicator please open.", 1),
        m("Adjudicator", "The dispute is X. @Advocate, present the case for coverage.", 2),
        m("Advocate", "EX-02 and EX-03 support coverage. @Scrutinizer, your response.", 3),
        m("Scrutinizer", "EX-06 flags a duplicate. @Evidence, confirm what the file shows.", 4),
        m("Evidence", "EX-04 shows a CT, not a PET. @Adjudicator, the record is before you.", 5),
        m("Adjudicator", "The bench recommends OVERTURN. Over to you, reviewer.", 6),
    ]
    if decision:
        msgs.append(m("Priya", decision, 7))
    return msgs


def test_relay_labels_include_opening_and_ruling():
    turns, verdict = parse_room(room(), PET)
    assert [(t.agent, t.type) for t in turns] == [
        ("adjudicator", "opening"), ("advocate", "argument"), ("scrutinizer", "rebuttal"),
        ("evidence", "evidence"), ("adjudicator", "ruling"),
    ]
    assert verdict["decision"] == "UPHELD" and verdict["by"] == "Priya"
    assert "confidence" not in verdict  # no invented number


def test_case_comes_from_the_brief_not_a_default():
    assert detect_case(room(), fallback=None) == PET
    with pytest.raises(ExportError):
        detect_case([m("Priya", "no claim id here")], fallback=None)
    assert detect_case([m("Priya", "no claim id here")], fallback="snf-jimmo") == "snf-jimmo"


def test_messages_are_ordered_and_null_sender_tolerated():
    msgs = list(reversed(room()))
    msgs.insert(0, {"sender": None, "content": "system message", "inserted_at": 0})
    turns, _ = parse_room(msgs, PET)
    assert [t.type for t in turns][0] == "opening" and turns[-1].type == "ruling"


def test_notices_are_not_turns():
    msgs = room()
    msgs.insert(3, m("Scrutinizer", f"{NOTICE_PREFIX} Scrutinizer paused: quota used up.", 3.5))
    turns, _ = parse_room(msgs, PET)
    assert all(not t.text.startswith(NOTICE_PREFIX) for t in turns)
    assert len(turns) == 5


def test_decision_must_lead_and_follow_the_ruling():
    with pytest.raises(ExportError, match="No reviewer decision"):
        parse_room(room("Don't overturn this yet, I need more time."), PET)
    # A decision word before the ruling (e.g. in the brief) is ignored.
    early = room(decision=None)
    early.insert(1, m("Priya", "OVERTURN please", 1.5))
    with pytest.raises(ExportError, match="No reviewer decision"):
        parse_room(early, PET)
    _, v = parse_room(room("@Adjudicator REMAND for more records."), PET)
    assert v["decision"] == "REMANDED"


def test_no_ruling_yet_is_refused():
    msgs = room()[:5]
    with pytest.raises(ExportError, match="not ruled"):
        parse_room(msgs, PET)


def test_evidence_refs_use_whole_ids():
    msgs = room()
    msgs[2] = m("Advocate", "See EX-030 and EX-03. @Scrutinizer", 3)
    turns, _ = parse_room(msgs, PET)
    assert "EX-03" in turns[1].evidenceRefs
    assert all(r != "EX-030" for r in turns[1].evidenceRefs)
