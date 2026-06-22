"""
Evidence agent — neutral, only states what the record shows.

Run: python -m juro.agents.evidence
"""

from __future__ import annotations

import asyncio
import logging

from juro.roles import SYSTEM_PROMPTS, band_section
from juro.agents.base import VerdictAgent


class Evidence(VerdictAgent):
    @property
    def role(self) -> str:
        return "evidence"

    @property
    def agent_name(self) -> str:
        return "Evidence"

    def build_prompt(self) -> str:
        return SYSTEM_PROMPTS["evidence"] + band_section("evidence")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    await Evidence().run()


if __name__ == "__main__":
    asyncio.run(main())
