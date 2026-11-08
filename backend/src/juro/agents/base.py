"""
Base Band agent for the Juro adversarial tribunal.

Juro puts all four agents in ONE shared Band room. Each acts only when @mentioned
and hands the floor to the next by name (the relay in roles.band_section), so the
debate is adversarial without any one agent shepherding the whole flow.

Built on band-sdk 1.0 with a relay-hardened LangGraph adapter: because the SDK
agent speaks only by calling band_send_message, _build_relay_adapter() guarantees
a turn still posts even if the model returns a plain answer instead of a tool call.
Agents run on Groq's free tier (juro.llm); juro.relay handles rate limits, quota
pauses and failures so the room is never left silent.
"""

from __future__ import annotations

import asyncio
import logging
import os
from abc import ABC, abstractmethod

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

_BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_ENV_PATH = os.path.join(_BACKEND_ROOT, ".env")
_AGENT_CONFIG_PATH = os.path.join(_BACKEND_ROOT, "agent_config.yaml")


def _load_env() -> None:
    if os.path.exists(_ENV_PATH):
        load_dotenv(_ENV_PATH)


def _load_agent_creds(role: str) -> tuple[str, str]:
    import yaml

    if not os.path.exists(_AGENT_CONFIG_PATH):
        raise SystemExit(
            f"{_AGENT_CONFIG_PATH} not found. Run `python -m juro.band_runner setup` first."
        )
    with open(_AGENT_CONFIG_PATH) as f:
        cfg = yaml.safe_load(f) or {}
    agent = cfg.get("agents", {}).get(role, {})
    agent_id = agent.get("agent_id", "")
    api_key = agent.get("api_key", "")
    if not agent_id or not api_key:
        raise SystemExit(f"agent_config.yaml missing credentials for '{role}'.")
    return agent_id, api_key


def _platform_urls() -> tuple[str, str]:
    return (
        os.environ.get("THENVOI_REST_URL", "https://app.band.ai"),
        os.environ.get("THENVOI_WS_URL", "wss://app.band.ai/api/v1/socket/websocket"),
    )


class VerdictAgent(ABC):
    """Base class for Juro tribunal agents running on Band."""

    @property
    @abstractmethod
    def role(self) -> str:
        """Role key matching agent_config.yaml (advocate/scrutinizer/evidence/adjudicator)."""

    @property
    @abstractmethod
    def agent_name(self) -> str:
        """Display name used in @mentions."""

    @abstractmethod
    def build_prompt(self) -> str:
        """Return the full system prompt for this agent."""

    @property
    def additional_tools(self) -> list:
        return []

    def create_agent(self):
        # band-sdk 1.0 (the package formerly known as thenvoi). The LangGraph
        # adapter now takes recursion_limit as a first-class argument, so the old
        # astream monkeypatch is gone. Same Agent.create() shape as before.
        from band import Agent, SessionConfig

        _load_env()
        agent_id, api_key = _load_agent_creds(self.role)
        rest_url, ws_url = _platform_urls()

        adapter = self._build_relay_adapter()

        agent = Agent.create(
            adapter=adapter,
            agent_id=agent_id,
            api_key=api_key,
            ws_url=ws_url,
            rest_url=rest_url,
            session_config=SessionConfig(enable_context_hydration=False),
        )
        logger.info("%s created (role=%s, id=%s)", self.agent_name, self.role, agent_id)
        return agent

    def _create_llm(self):
        # Juro uses no paid services: the agents run on Groq's free tier only, with the provider
        # control re-checked before every model call. Anthropic stays blocked.
        _load_env()
        from juro.llm import create_chat_model

        return create_chat_model()

    def _build_relay_adapter(self):
        """A LangGraph adapter that makes the relay DETERMINISTIC and never silent.

        Two failure modes of a mention-driven debate, both fixed here so the
        hearing doesn't depend on the model behaving:

        1. Wrong handoff. The next speaker is whoever gets @mentioned, but the
           model sometimes mentions the wrong agent (often whoever just called on
           it). We force every turn's mention to the correct next voice in the
           fixed relay order, overriding whatever the model chose. The room's
           message-send method requires at least one resolved mention, so this is
           also what guarantees the message is accepted.

        2. Silent turn. The agent speaks only by calling band_send_message; a
           final synthesis (the ruling) is often returned as a plain answer with
           no tool call. We capture the model's final text and post it ourselves
           if the tool never fired.

        Relay order: Adjudicator(open) -> Advocate -> Scrutinizer -> Evidence ->
        Adjudicator(rule). The Adjudicator's next is conditional: it opens to the
        Advocate, and once Evidence has reported it rules to the human reviewer —
        which is exactly the one judgment call we put on the heavier model.
        """
        from band.adapters import LangGraphAdapter
        from langgraph.checkpoint.memory import InMemorySaver
        from juro.cases import CASES
        from juro.relay import AdjudicatorPhases, compose_turn, opening_text, run_turn
        from juro.roles import NEXT_VOICE

        role = self.role
        agent_label = self.agent_name
        agent_names = {"Advocate", "Scrutinizer", "Evidence", "Adjudicator"}

        def _ai_text(output) -> str:
            content = getattr(output, "content", None)
            if content is None and isinstance(output, dict):
                content = output.get("content")
            if isinstance(content, str):
                return content.strip()
            if isinstance(content, list):
                parts = []
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "text":
                        parts.append(b.get("text", ""))
                    elif isinstance(b, str):
                        parts.append(b)
                return "".join(parts).strip()
            return ""

        def _msg_text(msg) -> str:
            for attr in ("content", "text", "body"):
                value = getattr(msg, attr, None) or (msg.get(attr) if isinstance(msg, dict) else None)
                if isinstance(value, str) and value:
                    return value
            return ""

        async def _human_name(tools) -> str | None:
            try:
                parts = await tools.get_participants()
            except Exception:
                return None
            for p in parts or []:
                name = (p.get("name") if isinstance(p, dict) else getattr(p, "name", None)) or ""
                if name and name not in agent_names:
                    return name
            return None

        phases = AdjudicatorPhases()

        async def _forced_mentions(move: str | None, tools) -> list[str]:
            # Debaters always hand to their single fixed successor.
            if role in NEXT_VOICE:
                return [NEXT_VOICE[role]]
            # The chair opens to the Advocate, and rules to the human reviewer once it has opened.
            if role == "adjudicator":
                if move == "rule":
                    human = await _human_name(tools)
                    if not human:
                        # Don't loop the tribunal back to Advocate (that restarts the debate) and
                        # don't self-mention (that loops the chair). Leave it to the model's choice.
                        logger.error("[RELAY] Could not resolve the human reviewer to deliver the ruling to.")
                        return []
                    return [human]
                return ["Advocate"]
            return []

        class RelayLangGraphAdapter(LangGraphAdapter):
            def __init__(self, *a, **kw):
                super().__init__(*a, **kw)
                self._sent_this_turn: dict[str, bool] = {}
                self._final_text: dict[str, str] = {}
                self._room_locks: dict[str, asyncio.Lock] = {}

            def _lock_for(self, room_id: str) -> asyncio.Lock:
                lock = self._room_locks.get(room_id)
                if lock is None:
                    lock = self._room_locks[room_id] = asyncio.Lock()
                return lock

            async def _handle_stream_event(self, event, room_id, tools):
                if isinstance(event, dict):
                    et = event.get("event")
                    if et == "on_tool_start" and "send_message" in (event.get("name") or ""):
                        self._sent_this_turn[room_id] = True
                    elif et == "on_chat_model_end":
                        data = event.get("data") if isinstance(event.get("data"), dict) else {}
                        text = _ai_text(data.get("output"))
                        if text:
                            self._final_text[room_id] = text
                return await super()._handle_stream_event(event, room_id, tools)

            async def on_message(
                self, msg, tools, history, participants_msg, contacts_msg,
                *, is_session_bootstrap, room_id,
            ):
                # Serialize per room: self._sent_this_turn[room_id] /
                # self._final_text[room_id] are reset-then-read across this whole
                # turn, so two messages for the same room arriving back-to-back
                # must not interleave and clobber each other's in-flight state.
                async with self._lock_for(room_id):
                    move = None
                    if role == "adjudicator":
                        move = phases.next_move(room_id, getattr(msg, "sender_name", "") or "")
                    forced = await _forced_mentions(move, tools)
                    orig_send = tools.send_message
                    reviewer_name = forced[0] if move == "rule" and forced else None

                    if move == "open":
                        # The opening is procedural: code writes it from the case in the brief, with no
                        # model call (nothing to fail, no quota used). The model speaks when it rules.
                        try:
                            await orig_send(opening_text(_msg_text(msg), CASES), mentions=forced)
                        except Exception:
                            logger.exception("[RELAY] could not post the opening; @mention Adjudicator to retry")
                            return None
                        phases.record(room_id, move)
                        return None

                    def _compose(content: str) -> str:
                        # Code writes the handoff / closing line; the model supplies the argument.
                        return compose_turn(role, move, content or "", reviewer_name)

                    async def _send(content, mentions=None):
                        # Deterministic handoff: ignore the model's choice of mention and wording.
                        return await orig_send(_compose(content), mentions=forced or mentions)

                    def _reset():
                        self._sent_this_turn[room_id] = False
                        self._final_text[room_id] = ""

                    outcome: dict = {}

                    async def _invoke():
                        tools.send_message = _send  # execute_tool_call does getattr(self,"send_message")
                        try:
                            outcome["result"] = await super(RelayLangGraphAdapter, self).on_message(
                                msg, tools, history, participants_msg, contacts_msg,
                                is_session_bootstrap=is_session_bootstrap, room_id=room_id,
                            )
                        finally:
                            tools.send_message = orig_send

                    spoke = await run_turn(
                        label=agent_label,
                        invoke=_invoke,
                        reset=_reset,
                        sent=lambda: bool(self._sent_this_turn.get(room_id)),
                        final_text=lambda: self._final_text.get(room_id, ""),
                        send=lambda text, mentions: orig_send(text, mentions=mentions),
                        forced=forced,
                        reviewer=lambda: _human_name(tools),
                        compose=_compose,
                    )
                    # Only a turn that actually reached the room advances the chair's phase, so a
                    # paused or failed turn resumes at the same step when the reviewer @mentions it.
                    if spoke and move:
                        phases.record(room_id, move)
                    return outcome.get("result")

        return RelayLangGraphAdapter(
            llm=self._create_llm(),
            checkpointer=InMemorySaver(),
            custom_section=self.build_prompt(),
            additional_tools=self.additional_tools,
            # A turn needs model -> send tool -> model; 4 leaves slack while capping free-tier usage.
            recursion_limit=4,
        )

    async def run(self) -> None:
        agent = self.create_agent()
        logger.info("Starting %s — listening in the tribunal room…", self.agent_name)
        try:
            await agent.run()
        except KeyboardInterrupt:
            logger.info("%s shutting down…", self.agent_name)
