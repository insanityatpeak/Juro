Juro's Next.js half — the landing page and the Chamber (live cross-model hearing). See the repo root [README](../README.md) and [CLAUDE.md](../CLAUDE.md) for the full project.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

## Environment variables

Without any keys, the app still runs fully at `localhost:3000` — the Chamber falls back to the bundled sample transcript (`src/data/cases.ts`) and voice playback is simply unavailable. Add keys to go live:

Create `web/.env.local` (gitignored) with:

```
ANTHROPIC_API_KEY=sk-ant-...     # required for live hearings (/api/hearing)
DEEPGRAM_API_KEY=...             # required for spoken playback (/api/speak)
```

| Key | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) → Settings → API Keys |
| `DEEPGRAM_API_KEY` | [console.deepgram.com](https://console.deepgram.com/) → API Keys (free tier available) |

Restart `npm run dev` after editing `.env.local` — it's only read at startup.

## Learn more

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)

## Background hearings

A hearing runs on the server, not in the browser tab. Starting one (`POST /api/hearings`) returns an id; the Chamber moves to `/chamber/<id>`, and that link can be closed and reopened at any time. Turns and state are stored in SQLite (`.data/hearings.db`, gitignored), so a reopened hearing shows the same turns with the same hashes.

| State | Meaning |
|---|---|
| `waiting` | queued |
| `running` | generating turns (retries temporary failures with backoff, never duplicating a turn) |
| `paused` | paused by the reviewer, or by the system after a rate limit / repeated temporary failure; **Resume** continues from the next turn |
| `failed` | permanent failure before any turn (bad API key, rejected request) with a reason and next action; **Retry** |
| `partial` | permanent failure after some turns; kept on the record but **cannot be ruled on**; **Retry** continues it |
| `complete` | every turn and the recommendation are stored; the only state the reviewer can rule on |

It needs a long-running Node server (`npm run dev`, or `npm run build && npm start`), not a serverless host. If the server restarts mid-hearing, it picks the hearing back up from the last stored turn.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Live hearings. Without it, hearings run in **sample mode** from the bundled cases, so no key is needed to try the whole flow. |
| `HEARING_MODE` | auto | Set `sample` to force sample mode even when a key is present. |
| `HEARING_SAMPLE_DELAY_MS` | `1500` | Pause between turns in sample mode. |
| `HEARINGS_DB_PATH` | `.data/hearings.db` | Where the SQLite file lives. |

API: `GET /api/hearings/<id>?after=<seq>` (state + turns after `seq`), `PATCH /api/hearings/<id>` with `{"action":"pause"|"resume"|"retry"}`, `POST /api/hearings/<id>/ruling` with `{"decision":"OVERTURNED"|"UPHELD"|"REMANDED"}` (409 unless the hearing is complete).

Tests: `npm test` (runner, retries, pause/resume, partial-hearing guard, crash recovery).
