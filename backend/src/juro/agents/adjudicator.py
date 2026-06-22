"""
Adjudicator agent — chairs the tribunal on Band.

In the Band relay (see roles.band_section) the Adjudicator speaks at two moments
only: it OPENS the hearing when the case arrives and hands to @Advocate, then it
RULES once Evidence has reported — weighing both sides and recommending OVERTURN
or UPHOLD before handing the binding decision to the human reviewer. It runs on
the heavier model because telling "open" from "rule" is the one judgment call in
the relay. The agents in between hand off to each other, so no one shepherds the
whole debate.

Run: python -m juro.agents.adjudicator
"""

from __future__ import annotations

import asyncio
import logging

from juro.roles import SYSTEM_PROMPTS, band_section
from juro.agents.base import VerdictAgent


class Adjudicator(VerdictAgent):
    @property
    def role(self) -> str:
        return "adjudicator"

    @property
    def agent_name(self) -> str:
        return "Adjudicator"

    def build_prompt(self) -> str:
        return SYSTEM_PROMPTS["adjudicator"] + band_section("adjudicator")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    await Adjudicator().run()


if __name__ == "__main__":
    asyncio.run(main())
