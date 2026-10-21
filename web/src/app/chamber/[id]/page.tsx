import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ReopenedHearing } from "@/components/chamber/ReopenedHearing";
import { CASES } from "@/data/cases";
import { ensureWorker } from "@/lib/hearings/scheduler";
import { getStore } from "@/lib/hearings/store";

// /chamber/<hearingId>: reopen a hearing by its link. Its state and turns live on the server.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await connection(); // read the database per request, never at build time
  const { id } = await params;
  ensureWorker();
  const row = getStore().get(id);
  const entry = row ? CASES.find((c) => c.id === row.case_id) : undefined;
  if (!row || !entry) notFound();
  return <ReopenedHearing hearingId={id} caseId={entry.id} />;
}
