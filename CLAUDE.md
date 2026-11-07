# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Juro is an adversarial AI tribunal for denied health-insurance claims. Four agents (Advocate, Scrutinizer, Evidence, Adjudicator) argue a denial in one shared room, a human delivers the ruling, and stored turns are hash-chained so edits to them are detectable (turns only; no trusted checkpoint yet). Built for the Band of Agents Hackathon (Track 3 — Regulated & High-Stakes Workflows).

The repo has two independent halves that both produce the same output shape (a **transcript**):

- `web/` — Next.js 16 app. The landing page and the **Chamber** (`/chamber`). By default the Chamber replays bundled, pre-written **sample** hearings entirely in the browser (`web/src/lib/useSampleHearing.ts`): no API call, no database. Opt-in **durable hearings** (`NEXT_PUBLIC_DURABLE_HEARINGS=1`, local long-running Node only) run server-side in SQLite (`web/src/lib/hearings/*`, `/api/hearings*`, `useBackgroundHearing.ts`) and also replay samples.
- **Live hearings (invited preview):** Groq Free only. `/api/live/session` requires `LIVE_TESTER_CODE` and issues a one-hour HMAC continuation signed with a separate `LIVE_SESSION_SECRET`. `/api/live/step` accepts only that continuation; never expose `parseLiveStep` to client-written turns. Tokens bind the case/evidence/prompts/plan, model, transcript and expiry. One `GROQ_MODEL` (default `openai/gpt-oss-20b`) serves all roles. Server opt-in requires `JURO_LIVE_PROVIDER=groq`, `GROQ_API_KEY`, and operator assertion `JURO_GROQ_FREE_CONFIRMED=1`; the UI flag is `NEXT_PUBLIC_LIVE_HEARINGS=1`. Duplicate suppression, retry bounds and five-session daily admission are per instance only. Keep access restricted until a shared quota/replay store exists. Leaving/reloading ends the hearing; no durable record. Sample replay remains default. See `web/README.md`.
- **Hard rule: no paid services.** `web/src/lib/providers.ts` keeps Anthropic and Deepgram off; an API key must never enable a paid call, and there is no paid fallback. The Python side mirrors this in `backend/src/juro/providers.py`: `require_provider("anthropic")` runs before every model call in `generate.py` and before the Band agents build their LLM, so those commands refuse to run (`backend/tests/test_providers.py`).
- `backend/` — Python. The **Band tribunal runtime**: the same four roles run as separate OS processes, each its own Band agent connected over WebSocket to one shared room, coordinating by `@mentioning` each other. This is the actual multi-agent (Band) submission path.

These two paths are deliberately kept in sync by sharing role prompts/turn order conceptually (`web/src/lib/roles.ts` mirrors `backend/src/juro/roles.py`), but they are separately implemented — changes to the debate flow or prompts usually need to be made in **both** places. The pairs to check whenever you touch either side:

| Concern | Python | TypeScript |
|---|---|---|
| Role prompts / turn order | `backend/src/juro/roles.py` | `web/src/lib/roles.ts` |
| Case data | `backend/src/juro/cases.py` | `web/src/data/cases.ts` |
| Transcript schema | `backend/src/juro/transcript.py` | `web/src/lib/types.ts` |
| Debate generation loop | `backend/src/juro/generate.py` (blocked: paid) | `web/src/lib/hearings/source.ts` (`createLiveSource`, Groq free tier) driven by `liveStep.ts` (browser) or `runner.ts` (durable) |

## Commands

### Web app (`web/`)
```bash
cd web
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint      # eslint
npm test          # node:test via tsx: src/lib/hearings/*.test.ts
```
No keys are used. Sample cases live in `web/src/data/cases.ts`. Durable hearings: set `NEXT_PUBLIC_DURABLE_HEARINGS=1` (inlined at build time) and see `web/README.md` for the related env vars.

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

The web tests cover durable store/runner behavior, provider controls, signed live sessions and request validation (`npm test`). Backend tests (`python -m pytest tests`) prove Anthropic remains blocked. Do not run paid generation to verify the app.

## Architecture

### The transcript is the contract
Both the Chamber and the Band runtime ultimately produce a JSON object shaped like `web/src/lib/types.ts` (`case`, `evidence`, `turns[]`, `verdict`, `auditRoot`). The Python-side equivalent is `backend/src/juro/transcript.py`. Front-end playback (`usePlayback.ts` on the landing demo, `useSampleHearing.ts` and `useBackgroundHearing.ts` in the Chamber) consumes this shape, so a schema change must be mirrored in `types.ts`, `transcript.py`, and the durable store's `HearingView` (`web/src/lib/hearings/types.ts`).

### Durable hearings (web, opt-in)
`store.ts` is the only writer. Rules to keep: every worker-originated mutation checks `worker_id` (a stale worker must not change a newer worker's hearing); Pause is a persisted `pause_requested` flag honoured between steps (the in-flight step is saved, a failed in-flight step pauses without retry, a successful final recommendation completes); queue admission (`createIfRoom`) is one IMMEDIATE transaction; control tokens are stored only as sha256 and authorize actions without identifying the reviewer. Route handlers import the store dynamically after checking `DURABLE_HEARINGS`, so sample-only deployments never load `better-sqlite3`.

### Hash chain (tamper-evidence)
`transcript.py`'s `chain_turns()` computes `hash_i = sha256(hash_{i-1} + canonical(turn_i))` over each turn in order, producing an `auditRoot`. This is the "audit-ready" property the regulated-workflow framing depends on — any edit to a past turn breaks the chain. Preserve turn ordering and canonical JSON serialization (`sort_keys=True`, compact separators) if you touch this.

### Two debate runners, one turn plan vs. one relay
- **Local generator** (`backend/src/juro/generate.py`, mirrored by `createLiveSource` in `web/src/lib/hearings/source.ts`) uses the full scripted `TURN_PLAN` in `roles.py` / `roles.ts` — a fixed 10-step sequence (opening → argument → rebuttal → evidence → ... → ruling) driven by one process calling the Anthropic API in a loop and asking each model to respond with structured JSON (`{text, addressedTo, evidenceRefs}`).
- **Band runtime** (`backend/src/juro/agents/*.py`, `band_runner.py`) can't use a scripted loop — Band is mention-driven and each agent is a separate process that only acts when `@mentioned`. Instead it runs a simpler fixed **relay**: `adjudicator(open) → advocate → scrutinizer → evidence → adjudicator(rule)`, defined by `RELAY_ORDER`/`NEXT_VOICE`/`HANDOFF` in `roles.py`. Each agent's Band prompt (`band_section()`) instructs it to end its turn by `@mentioning` the next voice by name.

### The relay-hardening adapter (`backend/src/juro/agents/base.py`)
Band agents speak only by calling the `band_send_message` tool — there's no auto-send of a final answer. `VerdictAgent._build_relay_adapter()` wraps `LangGraphAdapter` to fix two failure modes that would otherwise stall or silence the debate:
1. **Wrong handoff** — the adapter overrides whatever mention the model chose and forces the `@mention` to the correct next voice per `NEXT_VOICE` (with the Adjudicator's opening-vs-ruling branch decided by checking whether Evidence was the last sender).
2. **Silent turn** — it captures the model's final streamed text and posts it itself via `band_send_message` if the tool call never fired.

This is load-bearing for reliability; when modifying agent behavior, keep the deterministic relay guarantee intact rather than trusting the model to self-orchestrate.

### Cross-model panel
The legacy Python panel specifies Haiku/Sonnet, but Anthropic calls are blocked by `backend/src/juro/providers.py`. The web preview uses one verified Groq Free model for all four role prompts (`GROQ_MODEL`, default `openai/gpt-oss-20b`). Do not describe it as a cross-model tribunal.

### Shared role prompts
`roles.py`'s `SHARED_RULES` + per-role `SYSTEM_PROMPTS` define each agent's voice once; both the local generator and the Band agents build on top of them (Band agents additionally append `band_section(role)` for the relay/handoff protocol). Keep `roles.py` and `web/src/lib/roles.ts` prompt content in sync when changing agent behavior, since the two runners must debate identically.

### Case data lives in two places
`backend/src/juro/cases.py` (Python, used by `band_runner.py`/`generate.py`) and `web/src/data/cases.ts` (TS, the Chamber's sample hearings) both define the same sample cases (claim, evidence, denial reason). Adding or editing a case means updating both.

### Voice playback (Chamber only)
`web/src/lib/useVoice.ts` reads turns aloud with the browser's speech synthesis (free). `web/src/app/api/speak/route.ts` (Deepgram) is disabled by the `tts` provider control. This is presentation-layer only — it consumes the same transcript shape and has no equivalent on the Band side, since the Band runtime just posts text to a room.

### Config/credentials flow (Band path only)
`band_runner.py setup` registers 4 agents via Band's REST API, writes their id/api_key to `backend/agent_config.yaml` (gitignored) and appends `VERDICT_TRIBUNAL_ROOM_ID` to `backend/.env`. `band_runner.py case [case_id]` similarly appends `VERDICT_CASE_ID` after a successful submit, so `export` later knows which of the 3 sample cases' `case`/`evidence` data to pair with the room's turns (it doesn't otherwise appear anywhere in the room transcript). Each agent process (`agents/advocate.py` etc.) reads its own credentials out of `agent_config.yaml` via `_load_agent_creds()` in `base.py`. The actual HTTP calls (register agent, create room, add participant, send message) live in `band_api.py`, a thin async wrapper over Band's Human API. Room creation over REST requires an Enterprise Band plan; on a normal account it 403s and the room must be created manually in the Band web app instead (`setup` detects this and prints fallback instructions).
