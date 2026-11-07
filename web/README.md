Juro's Next.js half: the landing page and the Chamber. See the repo root [README](../README.md) and [CLAUDE.md](../CLAUDE.md) for the full project.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
npm test         # durable-hearing store/runner, Groq provider, live-step and request-validation tests
```

## No paid services

The app makes no paid API calls. Provider controls live in `src/lib/providers.ts` and are checked immediately before every call, including retries and queued work:

| Provider | Status |
|---|---|
| `anthropic` | Off, always. `ANTHROPIC_API_KEY` is ignored. |
| `deepgram` | Off, always. `/api/speak` returns `503 provider_disabled`; **Listen** uses the browser's speech synthesis. |
| `groq` | Off unless the server sets `JURO_LIVE_PROVIDER=groq` **and** `GROQ_API_KEY`. Free tier only. |

## Live hearings (Groq Free, opt-in)

Sample replay stays the default. To offer a live hearing:

1. Create a **dedicated Groq account on the Free plan** with **no payment method and no paid upgrade**, so usage cannot be billed. Create an API key there.
2. On that account's limits page, confirm the models are available on the Free plan: by default `openai/gpt-oss-20b` (debaters) and `openai/gpt-oss-120b` (chair). Override with `GROQ_DEBATER_MODEL` / `GROQ_CHAIR_MODEL`.
3. Set server env: `JURO_LIVE_PROVIDER=groq`, `GROQ_API_KEY=...` (server-only; never `NEXT_PUBLIC_`).
4. Set `NEXT_PUBLIC_LIVE_HEARINGS=1` at build time to show "Run a live hearing instead" on the case intro.

How it runs (works on Vercel/serverless): the browser drives the hearing one step at a time via `POST /api/live/step` with `{ caseId, turns }`. The server keeps no state and needs no database or worker. Each request is checked against the fixed turn plan, uses only the bundled synthetic case, makes one Groq call, and returns the next turn or the final recommendation. `GET /api/live` reports whether live is available (never the key).

- **Quota used up** (Groq 429 for a daily limit, or a long `retry-after`): the hearing **pauses**; **Resume** continues from the next turn. Short per-minute limits are retried with backoff. There is **no paid fallback**.
- **Pause**: the in-flight step finishes and is kept, then it stops. If that step fails, it pauses without retrying. A completed final recommendation ends the hearing.
- **Nothing is stored or sealed**: leaving the page ends the hearing (the request in flight is aborted). The ruling stays in that browser.
- **Recommendations**: a malformed model answer is retried, never defaulted to a decision. No model "confidence" is shown.
- **Abuse**: a best-effort per-IP limit (`LIVE_STEPS_PER_MINUTE`, default 20) applies per server instance. The real ceiling is the free quota, so a heavy user can exhaust it for everyone, but cannot cause a charge.

`GROQ_BASE_URL` overrides the endpoint for local testing against a mock only.

## Two hearing modes

**Sample playback (default).** The Chamber replays a sample hearing entirely in the browser: no hearing API call, no database, nothing saved. Leaving the page ends it, and the reviewer's ruling stays in that browser. This is what a static/serverless deployment serves. With the flag off, every `/api/hearings*` route returns `404 durable_hearings_disabled` and SQLite is never loaded.

**Durable hearings (opt-in, local).** Set `NEXT_PUBLIC_DURABLE_HEARINGS=1` (in `.env.local`, then restart or rebuild; it is inlined at build time). Hearings then run on the server and are stored in SQLite (`.data/hearings.db`, gitignored), survive closing the tab and server restarts, and can be reopened at `/chamber/<id>`. They need a long-running Node server (`npm run dev`, or `npm run build && npm start`), not a serverless host. Durable hearings replay the sample unless `HEARING_MODE=live` is also set and the Groq provider is enabled.

| State | Meaning |
|---|---|
| `waiting` | queued |
| `running` | generating turns (retries temporary failures with backoff, never duplicating a turn) |
| `paused` | paused by the reviewer, or by the system after repeated temporary failures; **Resume** continues from the next turn |
| `failed` | permanent failure before any turn, with a reason and next action; **Retry** |
| `partial` | permanent failure after some turns; kept on the record but **cannot be ruled on**; **Retry** continues it |
| `complete` | every turn and the recommendation are stored; the only state the reviewer can rule on |

**Pause** lets the step in progress finish and saves it, then stops before the next one (the banner shows *Pausing…*). If that step fails, the hearing pauses without retrying; if it was the final recommendation, the hearing completes.

**Access.** Creating a hearing returns a one-time control token, kept in that browser's `localStorage` (only its hash is stored on the server). Anyone with the link can view; only the token holder can pause, resume, retry or rule. The token authorizes those actions; it does not identify the reviewer. Hearings created before tokens existed are read-only.

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_DURABLE_HEARINGS` | off | `1` enables durable server-side hearings. |
| `HEARING_SAMPLE_DELAY_MS` | `1500` | Pause between turns when a durable hearing replays the sample. |
| `HEARINGS_DB_PATH` | `.data/hearings.db` | Where the SQLite file lives. |
| `HEARINGS_MAX_OPEN` | `10` | Queued + running hearings allowed at once (`429 queue_full` beyond). Checked atomically with creation. |

API (durable mode only):
- `POST /api/hearings` with `{"caseId": ...}` returns `{ id, status, mode, controlToken }`.
- `GET /api/hearings/<id>?after=<seq>` returns state plus the turns after `seq`.
- `PATCH /api/hearings/<id>` with `{"action":"pause"|"resume"|"retry"}` and an `x-hearing-control: <token>` header.
- `POST /api/hearings/<id>/ruling` with `{"decision":"OVERTURNED"|"UPHELD"|"REMANDED"}` and the same header. Returns 409 unless the hearing is complete.

Bodies must be JSON objects (anything else returns 400). A missing or wrong token returns 403.

`better-sqlite3` ships prebuilt binaries for common platforms, so `npm ci` works even when npm blocks its install script.
