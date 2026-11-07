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
| `groq` | Off unless the server sets `JURO_LIVE_PROVIDER=groq`, `GROQ_API_KEY`, and `JURO_GROQ_FREE_CONFIRMED=1`. Free tier only. |

## Live hearings (Groq Free, invited preview)

Sample replay stays the default. The public deployment should remain sample-only until a real Free-account hearing is verified. To run an invited preview:

1. Create a **dedicated Groq account on the Free plan** with **no payment method and no paid upgrade**. Verify its billing settings and model access in the account console; the app cannot infer these from an API key.
2. Confirm `openai/gpt-oss-20b` is available on that account. All four roles use this one model; `GROQ_MODEL` overrides it. Old per-role model overrides are no longer used.
3. Set server-only `JURO_LIVE_PROVIDER=groq`, `GROQ_API_KEY`, and `JURO_GROQ_FREE_CONFIRMED=1` after that check. The confirmation is an operator assertion, not automatic billing verification.
4. Set two independent random secrets: `LIVE_TESTER_CODE` (24–256 characters, shared only with invited testers) and `LIVE_SESSION_SECRET` (at least 32 characters, never shared). Generate each using a cryptographic random generator. Never put either secret or the provider key in `NEXT_PUBLIC_*` variables, URLs, or source control.
5. Set `NEXT_PUBLIC_LIVE_HEARINGS=1` at build time to show the live option. Testers enter the invite code on the case intro; it stays in page memory and is sent only to the session endpoint.

`POST /api/live/session` accepts `{ caseId, inviteCode }` and issues a signed, one-hour continuation. `POST /api/live/step` accepts **only** `{ continuation }`. Its HMAC covers the session ID, case, model, case/evidence/prompt/plan fingerprint, expiry and all prior turns. Client-written turns and tampered tokens are rejected before any provider call. Changed model or inputs require a new session; the service never mixes versions. Bump the protocol version in `liveSession.ts` when generation instructions outside the fingerprint change. `GET /api/live` reports availability without returning secrets.

No database or persistent worker is needed. Successful and in-flight duplicate steps reuse the same response **within one instance**. The process also limits admission to five sessions per UTC day, one active provider step, three attempts per step, and a bounded replay cache. A full cache refuses new work rather than evicting valid replay records. These protections reset with the instance and **do not prevent cross-instance replay or enforce a global quota**. Do not open access to the public until shared admission and replay storage are implemented. Rotating the signing secret invalidates active sessions; rotating only the invite stops new sessions with the old invite.

- **Quota used up** (Groq 429 for a daily limit, or a long `retry-after`): the hearing **pauses**; **Resume** continues from the next turn. Short per-minute limits are retried with backoff. There is **no paid fallback**.
- **Pause**: the in-flight step finishes and is kept, then it stops. If that step fails, it pauses without retrying. A completed final recommendation ends the hearing.
- **No durable record or audit seal**: continuations and responses are cached briefly in server memory. Leaving or reloading ends the hearing; its transcript and ruling are lost. Client cancellation stops further steps, but does not guarantee an already accepted provider request is cancelled. Sessions expire after one hour, even while paused; after expiry start a new hearing.
- **Recommendations**: a malformed model answer is retried, never defaulted to a decision. No model "confidence" is shown.
- **Access**: only a valid tester code can issue new continuations. A continuation is a bearer credential; do not share it. An invited tester can still exhaust shared Free quota across instances. Keeping the provider account on Free is essential; the application cannot prevent an account owner from upgrading it.

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
