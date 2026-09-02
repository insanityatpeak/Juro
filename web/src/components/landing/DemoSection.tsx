import Link from "next/link";
import { useEffect } from "react";
import { usePlayback } from "@/lib/usePlayback";
import { HearingTranscript } from "@/components/HearingTranscript";
import { CASES } from "@/data/cases";

const tx = CASES[0].transcript;

export function DemoSection() {
  const pb = usePlayback(tx);
  useEffect(() => {
    const t = setTimeout(() => pb.start(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // runs on its own loop: when a hearing finishes, replay it after a short pause
  useEffect(() => {
    if (pb.phase === "ready") {
      const t = setTimeout(() => pb.start(), 2800);
      return () => clearTimeout(t);
    }
    // pb is a fresh object every render; phase/start are the actual reactive
    // values and depending on pb itself would re-fire this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pb.phase, pb.start]);
  const revealed = pb.phase === "idle" ? tx.turns.slice(0, 1) : pb.phase === "debate" ? tx.turns.slice(0, pb.index + 1) : tx.turns;
  return (
    <section id="demo" className="grain grain-ink relative bg-cink text-cchalk">
      <div className="mx-auto max-w-[1100px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-10 flex items-end justify-between border-b border-cinkline pb-4">
          <div>
            <div className="keb mb-3 text-cbrass">{"// 04 · In session"}</div>
            <h2 className="display text-[34px] leading-tight text-cchalk md:text-[52px]">See a denial argued.</h2>
          </div>
          <span className="mono flex items-center gap-2 text-[11px] text-cchalkdim">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--c-brass)" }} /> live · on loop
          </span>
        </div>
        <div className="overflow-hidden rounded-lg border border-cinkline bg-cink2/50 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.6)]">
          <div className="flex items-center justify-between border-b border-cinkline px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--c-oxblood)" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--c-brass)" }} />
              <span className="h-2.5 w-2.5 rounded-full bg-cchalkdim" />
            </div>
            <span className="mono text-[10px] text-cchalkdim">{tx.case.claimId} · {tx.case.procedure}</span>
            <span className="mono text-[10px] text-cbrass">sample · replay</span>
          </div>
          <div className="scroll-fade max-h-[460px] overflow-y-auto px-6 py-6">
            <HearingTranscript turns={revealed} all={tx.turns} activeId={pb.activeId} thinkingAgent={pb.thinkingAgent} />
          </div>
        </div>
        <div className="mt-6 text-center">
          <Link href="/chamber" className="mono text-[12px] text-cbrass hover:underline">
            OPEN THE CHAMBER, HEAR THE VOICES, DELIVER A RULING, DRAFT THE APPEAL →
          </Link>
        </div>
      </div>
    </section>
  );
}
