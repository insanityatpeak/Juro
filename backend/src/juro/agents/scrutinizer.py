"""
Scrutinizer agent — argues FOR the insurer's denial in the tribunal.

Run: python -m juro.agents.scrutinizer
"""

from __future__ import annotations

import asyncio
import logging

from juro.roles import SYSTEM_PROMPTS, band_section
from juro.agents.base import VerdictAgent


class Scrutinizer(VerdictAgent):
    @property
    def role(self) -> str:
        return "scrutinizer"

    @property
    def agent_name(self) -> str:
        return "Scrutinizer"

    def build_prompt(self) -> str:
        return SYSTEM_PROMPTS["scrutinizer"] + band_section("scrutinizer")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    await Scrutinizer().run()


if __name__ == "__main__":
    asyncio.run(main())
