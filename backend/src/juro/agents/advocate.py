"""
Advocate agent — argues FOR the patient in the tribunal.

Run: python -m juro.agents.advocate
"""

from __future__ import annotations

import asyncio
import logging

from juro.roles import SYSTEM_PROMPTS, band_section
from juro.agents.base import VerdictAgent


class Advocate(VerdictAgent):
    @property
    def role(self) -> str:
        return "advocate"

    @property
    def agent_name(self) -> str:
        return "Advocate"

    def build_prompt(self) -> str:
        return SYSTEM_PROMPTS["advocate"] + band_section("advocate")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    await Advocate().run()


if __name__ == "__main__":
    asyncio.run(main())
