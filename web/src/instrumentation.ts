// Start the hearing worker when the Node server boots, so queued hearings are picked up
// (and interrupted ones recovered) without waiting for someone to open the page.
// Only when durable hearings are enabled; otherwise SQLite is never loaded.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PUBLIC_DURABLE_HEARINGS === "1") {
    const { ensureWorker } = await import("./lib/hearings/scheduler");
    ensureWorker();
  }
}
