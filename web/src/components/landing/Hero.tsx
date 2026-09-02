import Link from "next/link";
import { Magnetic, Reveal, VerdictStamp } from "@/components/motion";
import { HearingTranscript } from "@/components/HearingTranscript";
import { CASES } from "@/data/cases";

const tx = CASES[0].transcript;

export function Hero() {
  return (
    <header className="grain grain-ink relative min-h-screen bg-cink text-cchalk">
      <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col justify-center px-6 pt-28 pb-16 md:px-10">
        <div className="keb mb-7 text-cbrass">No. 2207-A · The People v. Denial</div>

        <h1 className="display max-w-[15ch] text-[40px] leading-[0.98] text-cchalk md:text-[78px]">
          <Reveal>Every year, millions of</Reveal>
          <Reveal delay={0.06}>valid claims are denied.</Reveal>
          <Reveal delay={0.12}>
            <span className="text-cchalkdim">Not because they&apos;re wrong,</span>
          </Reveal>
          <Reveal delay={0.18}>
            but because no one will <span className="italic text-cbrass display-soft">argue</span> them.
          </Reveal>
        </h1>

        <div className="mt-12 grid items-end gap-10 md:grid-cols-[1fr_minmax(320px,420px)]">
          <div>
            <p className="max-w-sm text-[15px] leading-relaxed text-cchalkdim">
              Juro convenes a tribunal of four AI advocates to argue a denied claim, for and
              against. A human delivers the ruling, grounded in real law, with every word on the record.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Magnetic strength={0.35}>
                <Link href="/chamber" className="btn btn-brass">Bring a claim to trial →</Link>
              </Magnetic>
              <a href="#demo" className="btn btn-line-ink">Watch a hearing</a>
            </div>
          </div>

          <div className="rounded-sm border border-cinkline bg-cink2/60 p-4">
            <div className="mb-3 flex items-center justify-between border-b border-cinkline pb-2.5">
              <span className="keb text-[10px] text-cchalkdim">Court transcript</span>
              <span className="mono text-[11px] text-cbrass">● in session</span>
            </div>
            <HearingTranscript turns={tx.turns.slice(0, 3)} all={tx.turns} activeId={tx.turns[2].id} showBench={false} autoScroll={false} />
          </div>
        </div>
      </div>
      <VerdictStamp className="absolute right-8 top-28 hidden md:block lg:right-20" />
    </header>
  );
}
