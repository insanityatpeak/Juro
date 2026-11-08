# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Juro is an adversarial AI tribunal for denied health-insurance claims. Four agents (Advocate, Scrutinizer, Evidence, Adjudicator) argue a denial in one shared room, a human delivers the ruling, and stored turns are hash-chained so edits to them are detectable (turns only; no trusted checkpoint yet). Built for the Band of Agents Hackathon (Track 3 — Regulated & High-Stakes Workflows).

The repo has two independent halves that both produce the same output shape (a **transcript**):

- `web/` — Next.js 16 app. The landing page and the **Chamber** (`/chamber`). By default the Chamber replays bundled, pre-written **sample** hearings entirely in the browser (`web/src/lib/useSampleHearing.ts`): no API call, no database. Opt-in **durable hearings** (`NEXT_PUBLIC_DURABLE_HEARINGS=1`, local long-running Node only) run server-side in SQLite (`web/src/lib/hearings/*`, `/api/hearings*`, `useBackgroundHearing.ts`) and also replay samples.
- **Live hearings (invited preview):** Groq Free only. `/api/live/session` requires `LIVE_TESTER_CODE` and issues a one-hour HMAC continuation signed with a separate `LIVE_SESSION_SECRET`. `/api/live/step` accepts only that continuation; never expose `parseLiveStep` to client-written turns. Tokens bind the case/evidence/prompts/plan, model, transcript and expiry. One `GROQ_MODEL` (default `openai/gpt-oss-20b`) serves all roles. Server opt-in requires `JURO_LIVE_PROVIDER=groq`, `GROQ_API_KEY`, and operator assertion `JURO_GROQ_FREE_CONFIRMED=1`; the UI flag is `NEXT_PUBLIC_LIVE_HEARINGS=1`. Duplicate suppression, retry bounds and five-session daily admission are per instance only. Keep access restricted until a shared quota/replay store exists. Leaving/reloading ends the hearing; no durable record. Sample replay remains default. See `web/README.md`.
- **Hard rule: no paid services.** `web/src/lib/providers.ts` keeps Anthropic and Deepgram off; an API key must never enable a paid call, and there is no paid fallback. The Python side mirrors this in `backend/src/juro/providers.py`: Anthropic is always blocked (`generate.py` refuses to run), and the Band agents run on Groq's free tier only when `JURO_LIVE_PROVIDER=groq`, `GROQ_API_KEY` and `JURO_GROQ_FREE_CONFIRMED=1` are all set. `juro/llm.py`'s `GuardedChatGroq` re-checks that before every model call.
- `backend/` — Python. The **Band tribunal runtime**: the same four roles run as separate OS processes, each its own Band agent connected over WebSocket to one shared room, coordinating by `@mentioning` each other. This is the actual multi-agent (Band) submission path.

These two paths are deliberately kept in sync by sharing role prompts/turn order conceptually (`web/src/lib/roles.ts` mirrors `backend/src/juro/roles.py`), but they are separately implemented — changes to the debate flow or prompts usually need to be made in **both** places. The pairs to check whenever you touch either side:

| Concern | Python | TypeScript |
|---|---|---|
| Role prompts / turn order | `backend/src/juro/roles.py` | `web/src/lib/roles.ts` |
| Case data | generated from `data/cases.json` (`scripts/sync_cases.py`) → `backend/src/juro/cases_data.json` | → `web/src/data/cases.generated.json` |
| Transcript schema | `backend/src/juro/transcript.py` | `web/src/lib/types.ts` |
| Debate generation loop | `backend/src/juro/generate.py` (blocked: paid) | `web/src/lib/hearings/source.ts` (`createLiveSource`, Groq free tier) driven by `liveStep.ts` (browser) or `runner.ts` (durable) |

## Commands

### Whole repo
```bash
python scripts/verify.py            # data + provider guards + sample-only + backend pytest + web test/lint/tsc/build
python scripts/verify.py --quick    # same, without the production build
python scripts/sync_cases.py        # after editing data/cases.json: validate + regenerate both copies
```

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
pip install -e ".[band]"         # + Band SDK, LangGraph, langchain-groq
pip install -e ".[dev]"          # + pytest, langchain-groq (band-sdk is not needed for tests)

python -m juro.band_runner setup            # register 4 agents on Band (+ room if plan allows)
python -m juro.agents.advocate              # each in its own process/terminal —
python -m juro.agents.scrutinizer           #   connects over WebSocket and waits
python -m juro.agents.evidence              #   to be @mentioned
python -m juro.agents.adjudicator
python -m juro.band_runner brief <case_id>  # print a case brief to paste into a Band room
python -m juro.band_runner case [case_id]   # submit a case into the tribunal room (REST path)
python -m juro.band_runner export           # fetch room messages → web/public/transcript.json
python -m juro.band_runner teardown         # delete registered Band agents

python -m juro.groq_check   # capped Groq Free check (<=3 calls, synthetic case, no retries): tool calling, tokens, latency, limits
python -m juro.telemetry summary   # per-turn tokens, unknown usage, retries, rate-limit waits, wall clock for the latest hearing
python -m juro.generate      # local debate generator — blocked (it calls Anthropic)
```
The Band SDK pins a private git submodule pip can't clone directly — install it from a no-submodule clone (see README "Getting started" section) rather than the plain PyPI/git spec.

The agent processes need the three Groq Free switches in `backend/.env`; the Band commands (`setup`, `case`, `export`, `teardown`, and each `agents/*.py` process) also need `THENVOI_API_KEY` (plus `THENVOI_REST_URL`/`THENVOI_WS_URL`, which default to Band's hosted instance) — see `backend/.env.example`.

Case ids: `mri-erisa`, `pet-oncology`, `snf-jimmo` (defined in `backend/src/juro/cases.py`).

The web tests cover durable store/runner behavior, provider controls, signed live sessions and request validation (`npm test`). Backend tests (`python -m pytest tests`) cover the provider controls, the Groq model guard, the relay (waits, quota pauses, notices, no duplicate posts, chair phases), the export, and `base.py`'s adapter wiring against a stand-in band-sdk. Do not run paid generation to verify the app.

## Architecture

### The transcript is the contract
Both the Chamber and the Band runtime ultimately produce a JSON object shaped like `web/src/lib/types.ts` (`case`, `evidence`, `turns[]`, `verdict`, `auditRoot`). The Python-side equivalent is `backend/src/juro/transcript.py`. Front-end playback (`usePlayback.ts` on the landing demo, `useSampleHearing.ts` and `useBackgroundHearing.ts` in the Chamber) consumes this shape, so a schema change must be mirrored in `types.ts`, `transcript.py`, and the durable store's `HearingView` (`web/src/lib/hearings/types.ts`).

### Durable hearings (web, opt-in)
`store.ts` is the only writer. Rules to keep: every worker-originated mutation checks `worker_id` (a stale worker must not change a newer worker's hearing); Pause is a persisted `pause_requested` flag honoured between steps (the in-flight step is saved, a failed in-flight step pauses without retry, a successful final recommendation completes); queue admission (`createIfRoom`) is one IMMEDIATE transaction; control tokens are stored only as sha256 and authorize actions without identifying the reviewer. Route handlers import the store dynamically after checking `DURABLE_HEARINGS`, so sample-only deployments never load `better-sqlite3`.

### Hash chain (tamper-evidence)
`transcript.py`'s `chain_turns()` computes `hash_i = sha256(hash_{i-1} + canonical(turn_i))` over each turn in order, producing an `auditRoot`. This is the "audit-ready" property the regulated-workflow framing depends on — any edit to a past turn breaks the chain. Preserve turn ordering and canonical JSON serialization (`sort_keys=True`, compact separators) if you touch this.

### Two debate runners, one turn plan vs. one relay
- **Local generator** (`backend/src/juro/generate.py`, mirrored by `createLiveSource` in `web/src/lib/hearings/source.ts`) uses the full scripted `TURN_PLAN` in `roles.py` / `roles.ts` — a fixed 10-step sequence (opening → argument → rebuttal → evidence → ... → ruling) driven by one process calling the Anthropic API in a loop and asking each model to respond with structured JSON (`{text, addressedTo, evidenceRefs}`).
- **Band runtime** (`backend/src/juro/agents/*.py`, `band_runner.py`) can't use a scripted loop — Band is mention-driven and each agent is a separate process that only acts when `@mentioned`. Instead it runs a simpler fixed **relay**: `adjudicator(open) → advocate → scrutinizer → evidence → adjudicator(rule)`, defined by `RELAY_ORDER`/`NEXT_VOICE`/`HANDOFF` in `roles.py`. Each agent's Band prompt (`band_section()`) tells it to write only its argument; the relay adds the `@mention` handoff to the next voice in code (`relay.compose_turn`), and the Adjudicator's opening is posted by code.

### The relay-hardening adapter (`backend/src/juro/agents/base.py`)
Band agents speak only by calling the `band_send_message` tool — there's no auto-send of a final answer. `VerdictAgent._build_relay_adapter()` wraps `LangGraphAdapter`, and each turn runs through `juro/relay.py`'s `run_turn`:
1. **Wrong handoff** — the adapter overrides whatever mention the model chose and forces the `@mention` to the correct next voice per `NEXT_VOICE`. The Adjudicator's open-vs-rule branch comes from `AdjudicatorPhases` (per-room state: it rules once it has opened, or when Evidence reports), so a reviewer resuming a paused hearing never restarts it.
2. **Silent turn** — it captures the model's final streamed text and posts it itself if the tool call never fired.
3. **Limits and failures** — per-minute 429s are waited out (bounded, two retries); a daily-quota 429 or any other failure posts a `[tribunal notice]` to the human reviewer (never to an agent) and stops; a failure after the agent already posted is not retried (no duplicates). Only a turn that reached the room advances the chair's phase. The exporter skips notices.
4. **Deterministic wording** — code writes the procedural text: the Adjudicator's opening is posted by code from the brief's case (no model call), each debater's handoff line is appended by `relay.compose_turn` after stripping the model's own mentions/handoffs, and the ruling's closing line names OVERTURN/UPHOLD only when the model's text states exactly one. The model supplies the arguments only.

This is load-bearing for reliability; when modifying agent behavior, keep the deterministic relay guarantee intact rather than trusting the model to self-orchestrate.

### Hearing telemetry (Band path, local)
`juro/telemetry.py` appends JSON lines to `backend/.telemetry/<room>/<agent>.jsonl` (gitignored; `JURO_TELEMETRY=0` disables, `JURO_TELEMETRY_DIR` moves it). `GuardedChatGroq` (`llm.py`) records every model-call attempt (ok/failed/refused, latency, input/output tokens or `null` when unknown); `run_turn` records attempt numbers, rate-limit waits (separate from model latency) and the turn outcome; `base.py` scopes each message as one turn (ids: hearing = room, agent, turn, attempt, call). Never record message text, prompts, keys or raw error bodies (errors are a kind + exception class). Writes swallow their own errors. The summary's wall clock is earliest start to latest end across agents (calls/turns are logged at their end, so start = end - duration); its 60-second peak is observed usage from calls that reported tokens, not Groq's quota accounting. Tests redirect telemetry to a temp dir and never read the real `backend/.env` (`tests/conftest.py`).

### Cross-model panel
Both the web preview and the Band agents use one Groq Free model for all four role prompts (`GROQ_MODEL`, default `openai/gpt-oss-20b`; Band: `backend/src/juro/llm.py`). The Haiku/Sonnet constants in `roles.py` are only referenced by the blocked local generator. Do not describe it as a cross-model tribunal.

### Shared role prompts
`roles.py`'s `SHARED_RULES` + per-role `SYSTEM_PROMPTS` define each agent's voice once; both the local generator and the Band agents build on top of them (Band agents additionally append `band_section(role)` for the relay/handoff protocol). Keep `roles.py` and `web/src/lib/roles.ts` prompt content in sync when changing agent behavior, since the two runners must debate identically.

### Case data: one canonical file
`data/cases.json` is the only place to edit cases (case, evidence, pre-written sample turns, sample recommendation, appeal letter). `python scripts/sync_cases.py` validates it and writes `web/src/data/cases.generated.json` (read by `cases.ts`) and `backend/src/juro/cases_data.json` (read by `cases.py`); `--check` (run by `verify.py`) fails on drift. Validation rejects named physicians, `auditRoot`, `confidence` and `by` keys, unknown evidence refs and overlapping claim ids (the Band export finds cases by claim id).

### Voice playback (Chamber only)
`web/src/lib/useVoice.ts` reads turns aloud with the browser's speech synthesis (free). `web/src/app/api/speak/route.ts` (Deepgram) is disabled by the `tts` provider control. This is presentation-layer only — it consumes the same transcript shape and has no equivalent on the Band side, since the Band runtime just posts text to a room.

### Config/credentials flow (Band path only)
`band_runner.py setup` registers 4 agents via Band's REST API, writes their id/api_key to `backend/agent_config.yaml` (gitignored) and appends `VERDICT_TRIBUNAL_ROOM_ID` to `backend/.env`. `band_runner.py case [case_id]` similarly appends `VERDICT_CASE_ID` after a successful submit, so `export` later knows which of the 3 sample cases' `case`/`evidence` data to pair with the room's turns (it doesn't otherwise appear anywhere in the room transcript). Each agent process (`agents/advocate.py` etc.) reads its own credentials out of `agent_config.yaml` via `_load_agent_creds()` in `base.py`. The actual HTTP calls (register agent, create room, add participant, send message) live in `band_api.py`, a thin async wrapper over Band's Human API. Room creation over REST requires an Enterprise Band plan; on a normal account it 403s and the room must be created manually in the Band web app instead (`setup` detects this and prints fallback instructions).
