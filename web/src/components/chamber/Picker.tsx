import Link from "next/link";
import { motion } from "motion/react";
import { CASES } from "@/data/cases";
import type { CaseEntry } from "@/lib/types";

export function Picker({ onPick }: { onPick: (id: string) => void }) {
  return (
    <section className="grain-ink relative min-h-dvh bg-cink text-cchalk">
      <header className="flex items-center gap-3 border-b border-cinkline px-6 py-4">
        <Link href="/" className="display text-lg text-cchalk">
          Juro
        </Link>
        <span className="h-4 w-px bg-cinkline" />
        <span className="keb text-cchalkdim">the chamber</span>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <h1 className="display text-3xl text-cchalk sm:text-4xl">Choose a case to hear.</h1>
        <p className="mt-3 max-w-xl text-[15px] text-cchalkdim">
          Each one is a real-shaped denial. Open it and the tribunal argues both sides on the record
          before you rule.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CASES.map((c) => (
            <CaseCard key={c.id} entry={c} onPick={onPick} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CaseCard({ entry, onPick }: { entry: CaseEntry; onPick: (id: string) => void }) {
  const { case: cf } = entry.transcript;
  return (
    <motion.button
      onClick={() => onPick(entry.id)}
      whileHover={{ y: -2 }}
      className="group flex flex-col rounded-sm border border-cinkline bg-cink2 p-5 text-left transition-colors hover:border-cslate"
    >
      <div className="keb text-cbrass">{entry.tag}</div>
      <h2 className="display mt-2 text-xl text-cchalk">{entry.title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-cchalkdim">{entry.blurb}</p>
      <p className="mt-3 text-[13px] italic text-cslate">{entry.stake}</p>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-cinkline pt-3">
        <span className="mono text-[11px] text-cchalkdim">
          {cf.patient} · {cf.amount}
        </span>
        <span className="btn btn-brass !px-3 !py-1.5 !text-[12px]">Hear this case →</span>
      </div>
    </motion.button>
  );
}
