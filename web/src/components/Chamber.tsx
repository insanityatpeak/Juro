"use client";

import { useState } from "react";
import { CASES } from "@/data/cases";
import { Picker } from "@/components/chamber/Picker";
import { Hearing, LiveHearing, SampleHearing } from "@/components/chamber/Hearing";
import { DURABLE_HEARINGS } from "@/lib/hearings/config";
import { LIVE_HEARINGS_UI } from "@/lib/live";

export default function Chamber() {
  const [selected, setSelected] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const active = selected ? CASES.find((c) => c.id === selected) ?? null : null;

  if (!active) {
    return (
      <Picker
        onPick={(id) => {
          setLive(false); // sample replay is always the default
          setSelected(id);
        }}
      />
    );
  }

  const back = () => setSelected(null);
  // Keyed so all hearing-room hooks reset cleanly when the case or mode changes.
  if (DURABLE_HEARINGS) return <Hearing key={active.id} entry={active} onBack={back} />;
  const toggle = LIVE_HEARINGS_UI ? () => setLive((v) => !v) : undefined;
  return live ? (
    <LiveHearing key={`${active.id}:live`} entry={active} onBack={back} onSwitch={toggle} />
  ) : (
    <SampleHearing key={`${active.id}:sample`} entry={active} onBack={back} onSwitch={toggle} />
  );
}
