import Link from "next/link";
import { Magnetic, Reveal, VerdictStamp } from "@/components/motion";

export function FinalCta() {
  return (
    <section className="grain grain-ink relative bg-cink text-cchalk">
      <div className="mx-auto flex max-w-[1400px] flex-col items-start px-6 py-32 md:px-10 md:py-44">
        <h2 className="display text-[16vw] leading-[0.86] text-cchalk md:text-[12rem]">
          <Reveal>Bring your</Reveal>
          <Reveal delay={0.06}>denied claim</Reveal>
          <Reveal delay={0.12}>
            to <span className="italic text-cbrass display-soft">trial.</span>
          </Reveal>
        </h2>
        <div className="mt-12 flex items-center gap-6">
          <Magnetic strength={0.4}>
            <Link href="/chamber" className="btn btn-brass !px-7 !py-4 !text-[15px]">Enter the chamber →</Link>
          </Magnetic>
          <VerdictStamp size={92} />
        </div>
        <p className="mono mt-10 text-[11px] text-cchalkdim">
          JURO · BOTH SIDES HEARD · A HUMAN ALWAYS RULES · EVERY DECISION AUDITABLE
        </p>
      </div>
    </section>
  );
}
