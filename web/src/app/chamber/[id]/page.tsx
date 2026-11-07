import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ReopenedHearing } from "@/components/chamber/ReopenedHearing";
import { CASES } from "@/data/cases";
import { DURABLE_HEARINGS } from "@/lib/hearings/config";
import { isHearingId } from "@/lib/hearings/http";

// /chamber/<hearingId>: reopen a durable hearing by its link. Its state and turns live on the server.
// When durable hearings are off (the default), there are no saved hearings and the DB is never opened.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!DURABLE_HEARINGS) notFound();
  await connection(); // read the database per request, never at build time
  const { id } = await params;
  if (!isHearingId(id)) notFound();
  const { getStore } = await import("@/lib/hearings/store");
  const { ensureWorker } = await import("@/lib/hearings/scheduler");
  ensureWorker();
  const row = getStore().get(id);
  const entry = row ? CASES.find((c) => c.id === row.case_id) : undefined;
  if (!row || !entry) notFound();
  return <ReopenedHearing hearingId={id} caseId={entry.id} />;
}
