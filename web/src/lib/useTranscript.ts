"use client";

import { useEffect, useState } from "react";
import type { Transcript } from "@/lib/types";
import { sampleTranscript } from "@/data/sample-transcript";

/**
 * Prefer a generated debate (web/public/transcript.json, written by
 * `python -m verdict.generate`) and fall back to the bundled sample — so a fresh
 * clone always has a flawless demo, and a real run upgrades it automatically.
 */
export function useTranscript(): Transcript {
  const [tx, setTx] = useState<Transcript>(sampleTranscript);
  useEffect(() => {
    let active = true;
    fetch("/transcript.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Transcript | null) => {
        if (active && d && Array.isArray(d.turns) && d.turns.length) setTx(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return tx;
}
