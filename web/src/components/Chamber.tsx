"use client";

import { useState } from "react";
import { CASES } from "@/data/cases";
import { Picker } from "@/components/chamber/Picker";
import { Hearing } from "@/components/chamber/Hearing";

export default function Chamber() {
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ? CASES.find((c) => c.id === selected) ?? null : null;

  if (!active) {
    return <Picker onPick={(id) => setSelected(id)} />;
  }

  // Keyed so all hearing-room hooks reset cleanly when the case changes.
  return <Hearing key={active.id} entry={active} onBack={() => setSelected(null)} />;
}
