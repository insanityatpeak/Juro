"use client";

import { useRouter } from "next/navigation";
import { CASES } from "@/data/cases";
import { Hearing } from "./Hearing";

export function ReopenedHearing({ hearingId, caseId }: { hearingId: string; caseId: string }) {
  const router = useRouter();
  const entry = CASES.find((c) => c.id === caseId);
  if (!entry) return null;
  return <Hearing key={hearingId} entry={entry} hearingId={hearingId} onBack={() => router.push("/chamber")} />;
}
