"""Relay behaviour: waits, quota pauses, no duplicate posts, never silent, resumable chair."""

import asyncio

import pytest

from juro.providers import ProviderDisabled
from juro.cases import CASES
from juro.relay import (
    NOTICE_PREFIX, AdjudicatorPhases, classify_failure, compose_turn, opening_text, recommendation_in, run_turn,
)


class _HTTPError(Exception):
    """Shaped like groq.RateLimitError: status on .response, headers on .response.headers."""

    def __init__(self, message, status=429, retry_after=None):
        super().__init__(message)
        headers = {"retry-after": str(retry_after)} if retry_after is not None else {}
        self.response = type("R", (), {"status_code": status, "headers": headers})()


def test_classify_failures():
    assert classify_failure(_HTTPError("Rate limit reached on tokens per minute (TPM)", retry_after=7)).kind == "rate_limited"
    assert classify_failure(_HTTPError("Rate limit reached on tokens per day (TPD)")).kind == "quota_exhausted"
    assert classify_failure(_HTTPError("Rate limit reached", retry_after=3600)).kind == "quota_exhausted"
    assert classify_failure(ProviderDisabled("off")).kind == "provider_disabled"
    assert classify_failure(_HTTPError("server error", status=500)).kind == "error"
    assert classify_failure(RuntimeError("boom")).kind == "error"


def test_real_groq_rate_limit_error_is_classified():
    groq = pytest.importorskip("groq")
    httpx = pytest.importorskip("httpx")
    resp = httpx.Response(429, headers={"retry-after": "12"}, request=httpx.Request("POST", "https://api.groq.com"))
    err = groq.RateLimitError("Rate limit reached on requests per day (RPD)", response=resp, body=None)
    assert classify_failure(err).kind == "quota_exhausted"
    resp2 = httpx.Response(429, headers={"retry-after": "12"}, request=httpx.Request("POST", "https://api.groq.com"))
    err2 = groq.RateLimitError("Rate limit reached on tokens per minute", response=resp2, body=None)
    f = classify_failure(err2)
    assert (f.kind, f.retry_after_s) == ("rate_limited", 12.0)


class Turn:
    """A fake agent turn: `steps` is a list of actions per attempt: 'send', 'answer', 'silent' or an exception."""

    def __init__(self, steps, reviewer="Priya"):
        self.steps = list(steps)
        self.sent_flag = False
        self.text = ""
        self.posts = []
        self.sleeps = []
        self.calls = 0
        self._reviewer = reviewer

    async def invoke(self):
        self.calls += 1
        step = self.steps.pop(0)
        if isinstance(step, tuple):  # (action-before-failure, exception)
            if step[0] == "send":
                self.sent_flag = True
                self.posts.append(("turn", ["Next"]))
            raise step[1]
        if isinstance(step, BaseException):
            raise step
        if step == "send":
            self.sent_flag = True
            self.posts.append(("turn", ["Next"]))
        elif step == "answer":
            self.text = "A final answer without the tool."

    def reset(self):
        self.sent_flag = False
        self.text = ""

    async def send(self, text, mentions):
        self.posts.append((text, mentions))

    async def reviewer(self):
        return self._reviewer

    async def sleep(self, s):
        self.sleeps.append(s)

    def run(self, forced=("Next",)):
        return asyncio.run(run_turn(
            label="Advocate", invoke=self.invoke, reset=self.reset, sent=lambda: self.sent_flag,
            final_text=lambda: self.text, send=self.send, forced=list(forced), reviewer=self.reviewer, sleep=self.sleep,
        ))


def test_normal_turn_posts_once():
    t = Turn(["send"])
    assert t.run() is True
    assert t.posts == [("turn", ["Next"])]


def test_per_minute_limit_waits_then_retries():
    t = Turn([_HTTPError("tokens per minute", retry_after=7), "send"])
    assert t.run() is True
    assert t.sleeps == [7.0]
    assert t.calls == 2
    assert t.posts == [("turn", ["Next"])]


def test_waits_are_bounded_then_pause_notice():
    t = Turn([_HTTPError("tpm", retry_after=30)] * 3)
    assert t.run() is False
    assert t.sleeps == [30.0, 30.0]  # two retries, then stop
    (text, mentions), = t.posts
    assert text.startswith(NOTICE_PREFIX) and "rate limiting" in text and "@mention Advocate" in text
    assert mentions == ["Priya"]  # notices go to the reviewer, never to another agent


def test_daily_quota_pauses_immediately_with_no_paid_fallback():
    t = Turn([_HTTPError("Rate limit reached on tokens per day (TPD)")])
    assert t.run() is False
    assert t.calls == 1 and t.sleeps == []
    (text, mentions), = t.posts
    assert "quota is used up" in text and "no paid fallback" in text and mentions == ["Priya"]


def test_failure_after_posting_is_not_retried_or_duplicated():
    t = Turn([("send", _HTTPError("tokens per minute", retry_after=5))])
    assert t.run() is True
    assert t.calls == 1
    assert t.posts == [("turn", ["Next"])]  # no second post, no notice


def test_any_other_error_leaves_a_notice():
    t = Turn([RuntimeError("graph recursion limit")])
    assert t.run() is False
    (text, _), = t.posts
    assert "couldn't respond" in text and "graph recursion limit" in text


def test_silent_turn_is_posted_with_the_forced_handoff():
    t = Turn(["answer"])
    assert t.run() is True
    assert t.posts == [("A final answer without the tool.", ["Next"])]


def test_silent_turn_without_a_handoff_target_is_not_posted():
    t = Turn(["answer"])
    assert t.run(forced=()) is False
    assert t.posts == []


def test_no_reviewer_means_no_notice_rather_than_waking_an_agent():
    t = Turn([_HTTPError("per day")], reviewer=None)
    assert t.run() is False
    assert t.posts == []


def test_chair_opens_then_rules_whoever_mentions_it():
    p = AdjudicatorPhases()
    assert p.next_move("room", "Priya") == "open"
    p.record("room", "open")
    # A reviewer resuming a paused hearing must get the ruling, not a restart.
    assert p.next_move("room", "Priya") == "rule"
    p.record("room", "rule")
    assert p.next_move("room", "Priya") == "open"  # next case in the same room starts fresh
    assert p.next_move("other", "Priya") == "open"  # rooms are independent


def test_chair_rules_when_evidence_reports_even_after_a_restart():
    assert AdjudicatorPhases().next_move("room", "Evidence") == "rule"


def test_failed_opening_does_not_advance_the_phase():
    p = AdjudicatorPhases()
    move = p.next_move("room", "Priya")
    # run_turn returned False (paused) -> base.py does not record the move
    assert p.next_move("room", "Priya") == move == "open"


def test_compose_keeps_citations_and_replaces_the_handoff():
    out = compose_turn("advocate", None, "Advocate: Under 29 C.F.R. § 2560.503-1 the plan owes a full review. "
                                           "EX-03 shows progression. @Evidence, check this. Scrutinizer, your turn.")
    assert out == "Under 29 C.F.R. § 2560.503-1 the plan owes a full review. EX-03 shows progression. @Scrutinizer, your response."


def test_compose_ruling_names_the_recommendation_only_when_unambiguous():
    clear = compose_turn("adjudicator", "rule", "EX-03 proves progression. The bench recommends OVERTURN. Over to you, reviewer.", "Priya")
    assert clear == "EX-03 proves progression. The bench recommends OVERTURN. Over to you, @Priya."
    mixed = compose_turn("adjudicator", "rule", "Whether to overturn or uphold turns on EX-04.", None)
    assert mixed.endswith("The recommendation is above. Over to you, reviewer.")
    assert recommendation_in("We should uphold the denial.") == "UPHOLD"
    assert recommendation_in("No view yet.") is None


def test_compose_with_only_procedural_text_still_hands_off():
    assert compose_turn("evidence", None, "@Adjudicator, the record is before you.") == "@Adjudicator, the record is before you."


def test_opening_is_built_from_the_brief():
    assert "ON-2026-0612" in opening_text("CLAIM ON-2026-0612 - D. Okafor", CASES)
    generic = opening_text("no claim id", CASES)
    assert generic.startswith("This tribunal is convened on the claim in the brief above") and generic.endswith("coverage.")


def test_silent_turn_fallback_is_composed():
    t = Turn(["answer"])
    ok = asyncio.run(run_turn(
        label="Advocate", invoke=t.invoke, reset=t.reset, sent=lambda: t.sent_flag, final_text=lambda: t.text,
        send=t.send, forced=["Scrutinizer"], reviewer=t.reviewer, sleep=t.sleep,
        compose=lambda x: compose_turn("advocate", None, x),
    ))
    assert ok and t.posts == [("A final answer without the tool. @Scrutinizer, your response.", ["Scrutinizer"])]
