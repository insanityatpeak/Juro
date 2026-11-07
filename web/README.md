Juro's Next.js half: the landing page and the Chamber. See the repo root [README](../README.md) and [CLAUDE.md](../CLAUDE.md) for the full project.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
npm test         # durable-hearing store, runner, provider and request-validation tests
```

## No paid services

The app makes no paid API calls. Both provider controls in `src/lib/providers.ts` are off:

| Control | Effect |
|---|---|
| `generation` | No AI model is called. Every hearing replays the bundled sample record (`src/data/cases.ts`). Checked inside every provider call, so retries and queued work stop too. |
| `tts` | `/api/speak` returns `503 provider_disabled`. **Listen** uses the browser's speech synthesis instead. |

API keys (`ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`) are ignored; setting one does not enable anything.

## Two hearing modes

**Sample playback (default).** The Chamber replays a sample hearing entirely in the browser: no hearing API call, no database, nothing saved. Leaving the page ends it, and the reviewer's ruling stays in that browser. This is what a static/serverless deployment serves. With the flag off, every `/api/hearings*` route returns `404 durable_hearings_disabled` and SQLite is never loaded.

**Durable hearings (opt-in, local).** Set `NEXT_PUBLIC_DURABLE_HEARINGS=1` (in `.env.local`, then restart or rebuild; it is inlined at build time). Hearings then run on the server and are stored in SQLite (`.data/hearings.db`, gitignored), survive closing the tab and server restarts, and can be reopened at `/chamber/<id>`. They need a long-running Node server (`npm run dev`, or `npm run build && npm start`), not a serverless host.

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
