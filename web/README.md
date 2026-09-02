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
