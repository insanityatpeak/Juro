"""
Thin async wrappers over the Band/thenvoi Human API (verified endpoints):

  - register agent : POST /api/v1/me/agents/register   -> data.agent.id + data.credentials.api_key (one-time!)
  - create room    : POST /api/v1/me/chats             -> data.id
  - add participant: POST /api/v1/me/chats/{id}/participants
  - send message   : POST /api/v1/me/chats/{id}/messages   (used to inject a case as the human)

All require a USER api key (thnv_u_...), passed as the X-API-Key header.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)
_TIMEOUT = 30.0


class BandHumanAPI:
    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"X-API-Key": api_key, "Content-Type": "application/json"},
            timeout=_TIMEOUT,
        )

    async def __aenter__(self) -> "BandHumanAPI":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self._client.aclose()

    # -- agents ----------------------------------------------------------------

    async def register_agent(self, name: str, description: str | None = None) -> dict:
        """Register an external agent. Returns {'agent': {...}, 'credentials': {'api_key': ...}}.

        The api_key is shown ONCE — persist it immediately.
        """
        payload: dict[str, Any] = {"agent": {"name": name}}
        if description:
            payload["agent"]["description"] = description
        r = await self._client.post("/api/v1/me/agents/register", json=payload)
        r.raise_for_status()
        result = r.json().get("data", r.json())
        if not result.get("credentials", {}).get("api_key"):
            logger.warning("No api_key returned for %s — check API version.", name)
        return result

    async def delete_agent(self, agent_id: str, force: bool = True) -> None:
        params = {"force": "true"} if force else {}
        r = await self._client.delete(f"/api/v1/me/agents/{agent_id}", params=params)
        r.raise_for_status()

    async def list_agents(self) -> list[dict]:
        r = await self._client.get("/api/v1/me/agents")
        r.raise_for_status()
        data = r.json().get("data", r.json())
        return data if isinstance(data, list) else ([data] if data else [])

    # -- rooms -----------------------------------------------------------------

    async def create_room(self, title: str | None = None) -> dict:
        """Create a chat room (the platform auto-titles from first message)."""
        r = await self._client.post("/api/v1/me/chats", json={"chat": {}})
        r.raise_for_status()
        room = r.json().get("data", r.json())
        logger.info("Room created: id=%s%s", room.get("id", "?"), f" ({title})" if title else "")
        return room

    async def add_participant(self, chat_id: str, participant_id: str, role: str = "member") -> dict:
        r = await self._client.post(
            f"/api/v1/me/chats/{chat_id}/participants",
            json={"participant": {"participant_id": participant_id, "role": role}},
        )
        r.raise_for_status()
        return r.json().get("data", r.json())

    async def send_message(self, chat_id: str, content: str, mentions: list[str] | None = None) -> dict:
        """Post a message into a room as the human user (used to inject a case)."""
        payload: dict[str, Any] = {"message": {"content": content}}
        if mentions:
            payload["message"]["mentions"] = mentions
        r = await self._client.post(f"/api/v1/me/chats/{chat_id}/messages", json=payload)
        r.raise_for_status()
        return r.json().get("data", r.json())
