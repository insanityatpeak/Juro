// Start the hearing worker when the Node server boots, so queued hearings are picked up
// (and interrupted ones recovered) without waiting for someone to open the page.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureWorker } = await import("./lib/hearings/scheduler");
    ensureWorker();
  }
}
