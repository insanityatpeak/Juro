# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Juro is an adversarial AI tribunal for denied health-insurance claims. Four agents (Advocate, Scrutinizer, Evidence, Adjudicator) argue a denial in one shared room, a human delivers the binding ruling, and every turn is hash-chained so the record is tamper-evident. Built for the Band of Agents Hackathon (Track 3 — Regulated & High-Stakes Workflows).

The repo has two independent halves that both produce the same output shape (a **transcript**):

- `web/` — Next.js 16 app. The landing page and the **Chamber** (`/chamber`), which runs a *live* cross-model debate entirely inside a Next.js API route by calling the Anthropic API directly (no Band dependency). This is what the deployed demo uses.
- `backend/` — Python. The **Band tribunal runtime**: the same four roles run as separate OS processes, each its own Band agent connected over WebSocket to one shared room, coordinating by `@mentioning` each other. This is the actual multi-agent (Band) submission path.

These two paths are deliberately kept in sync by sharing role prompts/turn order conceptually (`web/src/lib/roles.ts` mirrors `backend/src/juro/roles.py`), but they are separately implemented — changes to the debate flow or prompts usually need to be made in **both** places. The pairs to check whenever you touch either side:

| Concern | Python | TypeScript |
|---|---|---|
| Role prompts / turn order | `backend/src/juro/roles.py` | `web/src/lib/roles.ts` |
| Case data | `backend/src/juro/cases.py` | `web/src/data/cases.ts` |
| Transcript schema | `backend/src/juro/transcript.py` | `web/src/lib/types.ts` |
| Debate generation loop | `backend/src/juro/generate.py` | `web/src/app/api/hearing/route.ts` |

## Commands

### Web app (`web/`)
```bash
cd web
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint      # eslint
```
Live hearings and voices need `ANTHROPIC_API_KEY` and `DEEPGRAM_API_KEY` in `web/.env.local`. Without keys, the app still runs using the bundled sample transcript (`web/src/data/sample-transcript.ts`).

### Backend (`backend/`)
```bash
cd backend
pip install -e .                 # base install (local generator only)
pip install -e ".[band]"         # + Band SDK, LangGraph, langchain-anthropic
pip install -e ".[dev]"          # + pytest

python -m juro.band_runner setup            # register 4 agents on Band (+ room if plan allows)
python -m juro.agents.advocate              # each in its own process/terminal —
python -m juro.agents.scrutinizer           #   connects over WebSocket and waits
python -m juro.agents.evidence              #   to be @mentioned
python -m juro.agents.adjudicator
python -m juro.band_runner brief <case_id>  # print a case brief to paste into a Band room
python -m juro.band_runner case [case_id]   # submit a case into the tribunal room (REST path)
python -m juro.band_runner export           # fetch room messages → web/public/transcript.json
python -m juro.band_runner teardown         # delete registered Band agents

python -m juro.generate      # local debate generator (Anthropic-only, no Band needed)
```
The Band SDK pins a private git submodule pip can't clone directly — install it from a no-submodule clone (see README "Getting started" section) rather than the plain PyPI/git spec.

`python -m juro.generate` needs `ANTHROPIC_API_KEY` in `backend/.env`; the Band commands (`setup`, `case`, `export`, `teardown`, and each `agents/*.py` process) additionally need `THENVOI_API_KEY` (plus `THENVOI_REST_URL`/`THENVOI_WS_URL`, which default to Band's hosted instance) — see `backend/.env.example`.

Case ids: `mri-erisa`, `pet-oncology`, `snf-jimmo` (defined in `backend/src/juro/cases.py`).

No test suite currently exists in either half despite `pytest`/`pytest-asyncio` being listed as backend dev dependencies. To sanity-check a change, run it end-to-end and inspect the output: `python -m juro.generate` for the local/Chamber path (check the resulting transcript JSON and that `auditRoot` still validates), or start all four `agents/*.py` processes plus `band_runner case`/`export` for the Band relay path.

## Architecture

### The transcript is the contract
Both the Chamber and the Band runtime ultimately produce a JSON object shaped like `web/src/lib/types.ts` (`case`, `evidence`, `turns[]`, `verdict`, `auditRoot`). The Python-side equivalent is `backend/src/juro/transcript.py`. Front-end playback (`web/src/lib/useTranscript.ts`, `usePlayback.ts`) only ever consumes this shape, regardless of which path produced it — so a change to the transcript schema must be mirrored in both `types.ts` and `transcript.py`, plus the NDJSON turn events emitted by `web/src/app/api/hearing/route.ts`.

### Hash chain (tamper-evidence)
`transcript.py`'s `chain_turns()` computes `hash_i = sha256(hash_{i-1} + canonical(turn_i))` over each turn in order, producing an `auditRoot`. This is the "audit-ready" property the regulated-workflow framing depends on — any edit to a past turn breaks the chain. Preserve turn ordering and canonical JSON serialization (`sort_keys=True`, compact separators) if you touch this.

### Two debate runners, one turn plan vs. one relay
- **Local/Chamber generator** (`backend/src/juro/generate.py`, mirrored by `web/src/app/api/hearing/route.ts`) uses the full scripted `TURN_PLAN` in `roles.py` / `roles.ts` — a fixed 10-step sequence (opening → argument → rebuttal → evidence → ... → ruling) driven by one process calling the Anthropic API in a loop and asking each model to respond with structured JSON (`{text, addressedTo, evidenceRefs}`).
- **Band runtime** (`backend/src/juro/agents/*.py`, `band_runner.py`) can't use a scripted loop — Band is mention-driven and each agent is a separate process that only acts when `@mentioned`. Instead it runs a simpler fixed **relay**: `adjudicator(open) → advocate → scrutinizer → evidence → adjudicator(rule)`, defined by `RELAY_ORDER`/`NEXT_VOICE`/`HANDOFF` in `roles.py`. Each agent's Band prompt (`band_section()`) instructs it to end its turn by `@mentioning` the next voice by name.

### The relay-hardening adapter (`backend/src/juro/agents/base.py`)
Band agents speak only by calling the `band_send_message` tool — there's no auto-send of a final answer. `VerdictAgent._build_relay_adapter()` wraps `LangGraphAdapter` to fix two failure modes that would otherwise stall or silence the debate:
1. **Wrong handoff** — the adapter overrides whatever mention the model chose and forces the `@mention` to the correct next voice per `NEXT_VOICE` (with the Adjudicator's opening-vs-ruling branch decided by checking whether Evidence was the last sender).
2. **Silent turn** — it captures the model's final streamed text and posts it itself via `band_send_message` if the tool call never fired.

This is load-bearing for reliability; when modifying agent behavior, keep the deterministic relay guarantee intact rather than trusting the model to self-orchestrate.

### Cross-model panel
The three debaters (`advocate`, `scrutinizer`, `evidence`) run on a fast/light model (`claude-haiku-4-5`); the `adjudicator` (chair) runs on a heavier model (`claude-sonnet-4-6`) since weighing both sides and ruling carries the most reasoning. This split is defined via `DEFAULT_MODEL`/`ADJUDICATOR_MODEL` in `roles.py` (env-overridable: `VERDICT_DEFAULT_MODEL`, `VERDICT_ADJUDICATOR_MODEL`) and `MODEL_FOR`/`VERDICT_MODEL` in `web/src/lib/roles.ts`.

### Shared role prompts
`roles.py`'s `SHARED_RULES` + per-role `SYSTEM_PROMPTS` define each agent's voice once; both the local generator and the Band agents build on top of them (Band agents additionally append `band_section(role)` for the relay/handoff protocol). Keep `roles.py` and `web/src/lib/roles.ts` prompt content in sync when changing agent behavior, since the two runners must debate identically.

### Case data lives in two places
`backend/src/juro/cases.py` (Python, used by `band_runner.py`/`generate.py`) and `web/src/data/cases.ts` (TS, used by the Chamber's `/api/hearing` route) both define the same sample cases (claim, evidence, denial reason). Adding or editing a case means updating both.

### Voice playback (Chamber only)
`web/src/app/api/speak/route.ts` and `web/src/lib/useVoice.ts` add spoken playback of turns in the Chamber UI via Deepgram TTS (`DEEPGRAM_API_KEY`). This is presentation-layer only — it consumes the same transcript shape and has no equivalent on the Band side, since the Band runtime just posts text to a room.

### Config/credentials flow (Band path only)
`band_runner.py setup` registers 4 agents via Band's REST API, writes their id/api_key to `backend/agent_config.yaml` (gitignored) and appends `VERDICT_TRIBUNAL_ROOM_ID` to `backend/.env`. `band_runner.py case [case_id]` similarly appends `VERDICT_CASE_ID` after a successful submit, so `export` later knows which of the 3 sample cases' `case`/`evidence` data to pair with the room's turns (it doesn't otherwise appear anywhere in the room transcript). Each agent process (`agents/advocate.py` etc.) reads its own credentials out of `agent_config.yaml` via `_load_agent_creds()` in `base.py`. The actual HTTP calls (register agent, create room, add participant, send message) live in `band_api.py`, a thin async wrapper over Band's Human API. Room creation over REST requires an Enterprise Band plan; on a normal account it 403s and the room must be created manually in the Band web app instead (`setup` detects this and prints fallback instructions).
