/**
 * Durable (server-side, SQLite-backed) hearings are opt-in: set NEXT_PUBLIC_DURABLE_HEARINGS=1
 * when running on a long-lived Node server with a writable disk (e.g. `npm run dev` / `npm start`
 * locally). Without it, the Chamber plays the bundled sample hearings entirely in the browser and
 * no hearing API touches the database, so the app deploys to static/serverless hosts for free.
 *
 * NEXT_PUBLIC_ so the same flag is inlined into the client bundle at build time.
 */
export const DURABLE_HEARINGS = process.env.NEXT_PUBLIC_DURABLE_HEARINGS === "1";
