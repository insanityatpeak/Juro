"use client";

import { useState } from "react";
import { CASES } from "@/data/cases";
import { Picker } from "@/components/chamber/Picker";
import { Hearing, SampleHearing } from "@/components/chamber/Hearing";
import { DURABLE_HEARINGS } from "@/lib/hearings/config";

export default function Chamber() {
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ? CASES.find((c) => c.id === selected) ?? null : null;

  if (!active) {
    return <Picker onPick={(id) => setSelected(id)} />;
  }

  // Keyed so all hearing-room hooks reset cleanly when the case changes.
  // Default: sample playback in the browser (no server state). Durable server hearings are opt-in.
  return DURABLE_HEARINGS ? (
    <Hearing key={active.id} entry={active} onBack={() => setSelected(null)} />
  ) : (
    <SampleHearing key={active.id} entry={active} onBack={() => setSelected(null)} />
  );
}
