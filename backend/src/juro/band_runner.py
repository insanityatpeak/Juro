"""
Band submission runtime for the Juro adversarial tribunal.

Subcommands:
    python -m juro.band_runner setup      Register 4 agents + create tribunal room
    python -m juro.band_runner case       Submit the sample case into the room
    python -m juro.band_runner export     Export room transcript → web/public/transcript.json
    python -m juro.band_runner teardown   Delete registered agents

Reuses the BandHumanAPI wrappers from juro/band_api.py for all
REST calls. The agents themselves run as separate processes (see juro/agents/).

One shared room, adversarial debate: the Adjudicator moderates via @mentions.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

import httpx
import yaml

_BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

_src = os.path.join(_BACKEND_ROOT, "src")
if _src not in sys.path:
    sys.path.insert(0, _src)

from juro.cases import CASES, DEFAULT_CASE_ID
from juro.config import (
    _AGENT_CONFIG_PATH,
    _append_env,
    _load_env,
    _rest_url,
    _save_agent_config,
    _user_api_key,
)
from juro.export import cmd_export
from juro.generate import _evidence_from_case


def _get_api():
    from juro.band_api import BandHumanAPI
    return BandHumanAPI(_rest_url(), _user_api_key())


# --- Agent definitions for Juro (adversarial tribunal) ---

AGENT_DEFS = [
    {"key": "advocate", "name": "Advocate",
     "description": "Juro tribunal: argues FOR the patient — marshals clinical + policy facts for coverage."},
    {"key": "scrutinizer", "name": "Scrutinizer",
     "description": "Juro tribunal: argues FOR the denial — exclusions, missing docs, cost-appropriateness."},
    {"key": "evidence", "name": "Evidence",
     "description": "Juro tribunal: neutral — produces the specific record that settles a dispute."},
    {"key": "adjudicator", "name": "Adjudicator",
     "description": "Juro tribunal: moderates the debate, recommends OVERTURN/UPHOLD, defers to human."},
]


def _build_case_brief(case_id: str) -> str:
    """Render a tribunal case brief from the shared case library (cases.py)."""
    if case_id not in CASES:
        raise SystemExit(f"Unknown case id '{case_id}'. Choose one of: {', '.join(CASES)}")
    case = CASES[case_id]["case"]
    # Reuses generate.py's EvidenceItem mapping (detail-or-authority) instead of
    # re-deriving it here, so the two brief-builders can't drift apart.
    lines = [f"  {e.id} [{e.kind}] {e.label}: {e.detail} (cite {e.cite})" for e in _evidence_from_case(case_id)]
    evidence = "\n".join(lines)
    return (
        f"CLAIM {case['claimId']} - {case['patient']}\n"
        f"Procedure: {case['procedure']} ({case['amount']})\n"
        f"Insurer: {case['insurer']}\n"
        f"Plan type: {case['planType']}\n"
        f"DENIAL: {case['denialReason']}\n\n"
        f"EVIDENCE ON THE RECORD:\n{evidence}\n\n"
        "@Adjudicator - please convene the tribunal and adjudicate this denied claim."
    )


# ============================================================================
# SETUP — register agents + create the shared tribunal room
# ============================================================================

async def cmd_setup() -> None:
    _load_env()
    api_key = _user_api_key()

    if not api_key.startswith("thnv_u_"):
        print("WARNING: THENVOI_API_KEY should be a USER key (thnv_u_…).", file=sys.stderr)

    print(f"\n⚖️  Provisioning Juro tribunal on {_rest_url()}\n" + "=" * 55)

    registered: dict[str, dict] = {}
    api = _get_api()
    async with api:
        # Step 1 — Register agents
        print("Step 1 — Registering tribunal agents…")
        for d in AGENT_DEFS:
            res = await api.register_agent(d["name"], d["description"])
            agent_id = res.get("agent", {}).get("id", "")
            agent_key = res.get("credentials", {}).get("api_key", "")
            if not agent_id or not agent_key:
                print(f"  ERROR: incomplete registration for {d['name']}: {res}", file=sys.stderr)
                sys.exit(1)
            registered[d["key"]] = {
                "id": agent_id,
                "api_key": agent_key,
                "name": d["name"],
            }
            # Band shows each agent's api_key exactly once — persist immediately
            # so a failure on a later agent in this loop can't orphan the ones
            # already registered (their one-time key would otherwise be lost).
            _save_agent_config(registered)
            print(f"  {d['name']:14s} → id={agent_id}  key={agent_key[:16]}…")

        print(f"  Saved credentials → {_AGENT_CONFIG_PATH}")

        # Step 2 — Create ONE shared tribunal room + add all agents.
        # NOTE: programmatic room creation goes through Band's Human API, which is
        # now gated behind an Enterprise plan (HTTP 403 plan_required on a normal
        # account). Agent *registration* and the agent *WebSocket runtime* are not
        # gated, so the live debate still happens — we just create the room in the
        # Band web app instead of over REST. We try REST first and fall back.
        print("Step 2 — Creating tribunal room…")
        room_id = ""
        try:
            room = await api.create_room(title="Tribunal")
            room_id = room.get("id", "")
            for data in registered.values():
                await api.add_participant(room_id, data["id"], role="member")
            agent_names = ", ".join(d["name"] for d in AGENT_DEFS)
            print(f"  Tribunal room → {room_id}  ({agent_names})")
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (402, 403):
                print("  Human API room creation needs an Enterprise plan — skipping.")
                print("  Create the room in the Band web app instead (instructions below).")
            else:
                raise

    if room_id:
        _append_env({"VERDICT_TRIBUNAL_ROOM_ID": room_id})

    print("=" * 55)
    print("Agents registered on Band. Next steps:\n")
    print("  1. Start all 4 agents (separate terminals) — they connect over WebSocket:")
    print("       python -m juro.agents.advocate")
    print("       python -m juro.agents.scrutinizer")
    print("       python -m juro.agents.evidence")
    print("       python -m juro.agents.adjudicator")
    if room_id:
        print("  2. Submit a case:")
        print("       python -m juro.band_runner case")
    else:
        print("  2. In the Band web app (https://app.band.ai): create a room named")
        print("     'Tribunal', add all four agents, then paste a case brief and")
        print("     @mention Adjudicator. (Get a brief with: python -m juro.band_runner brief)")
    print("  3. Watch the debate at https://app.band.ai")
    print("  4. When the Adjudicator asks, reply OVERTURN or UPHOLD in the room.\n")


# ============================================================================
# CASE — submit the denied claim into the tribunal room
# ============================================================================

async def cmd_case() -> None:
    _load_env()
    room_id = os.environ.get("VERDICT_TRIBUNAL_ROOM_ID", "")
    if not room_id:
        raise SystemExit("VERDICT_TRIBUNAL_ROOM_ID not set — run `python -m juro.band_runner setup` first.")

    case_id = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_CASE_ID
    brief = _build_case_brief(case_id)
    claim_id = CASES[case_id]["case"]["claimId"]

    print(f"Submitting case {case_id} ({claim_id}) to tribunal room {room_id}…")
    api = _get_api()
    async with api:
        await api.send_message(room_id, brief, mentions=["Adjudicator"])
    _append_env({"VERDICT_CASE_ID": case_id})
    print("Case submitted. The Adjudicator will convene the panel.")
    print("Watch the debate at https://app.band.ai")


# ============================================================================
# TEARDOWN — delete registered agents
# ============================================================================

async def cmd_teardown() -> None:
    _load_env()
    if not os.path.exists(_AGENT_CONFIG_PATH):
        print("No agent_config.yaml found — nothing to tear down.")
        return

    with open(_AGENT_CONFIG_PATH) as f:
        cfg = yaml.safe_load(f) or {}

    api = _get_api()
    async with api:
        for role, data in (cfg.get("agents", {}) or {}).items():
            aid = data.get("agent_id")
            if not aid:
                continue
            try:
                await api.delete_agent(aid, force=True)
                print(f"  Deleted {role} ({aid})")
            except Exception as e:
                print(f"  Could not delete {role} ({aid}): {e}")
    print("Teardown complete. Delete the room from the Band UI if desired.")


# ============================================================================
# CLI
# ============================================================================

async def cmd_brief() -> None:
    """Print a case brief to paste into a Band-web-app room (Enterprise-free path)."""
    case_id = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_CASE_ID
    print(_build_case_brief(case_id))


COMMANDS = {
    "setup": cmd_setup,
    "case": cmd_case,
    "brief": cmd_brief,
    "export": cmd_export,
    "teardown": cmd_teardown,
}


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd not in COMMANDS:
        print(f"Usage: python -m juro.band_runner <{'|'.join(COMMANDS)}>")
        print("\n  setup     Register agents (+ create the room if your plan allows)")
        print("  case [id] Submit a denied claim into the room (id: mri-erisa|pet-oncology|snf-jimmo)")
        print("  brief [id] Print a case brief to paste into a Band-web-app room")
        print("  export    Fetch room messages → web/public/transcript.json")
        print("  teardown  Delete registered agents from Band")
        sys.exit(1)
    asyncio.run(COMMANDS[cmd]())


if __name__ == "__main__":
    main()
