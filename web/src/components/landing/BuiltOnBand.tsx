const BAND_STEPS = ["four agents register", "live over WebSocket", "one shared room", "@mention to convene", "argue by reply"];
const SAFEGUARDS = [
  "A human delivers every ruling. The AI argues, it never decides.",
  "Every argument cites a source: a plan clause, a guideline, or a statute.",
  "The whole hearing is hash-chained into one root, so the record can't be quietly edited.",
];

export function BuiltOnBand() {
  return (
    <section className="grain grain-ink relative bg-cink text-cchalk">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-10 flex items-baseline justify-between border-b border-cinkline pb-4">
          <h2 className="display text-[34px] leading-tight text-cchalk md:text-[52px]">Built on Band.</h2>
          <span className="mono text-[11px] text-cchalkdim">{"// 07"}</span>
        </div>
        <div className="grid gap-14 md:grid-cols-[1fr_0.85fr]">
          <div>
            <p className="max-w-xl text-[16px] leading-relaxed text-cchalkdim">
              The four advocates are not a script that calls one function after another. Each is a
              separate agent that registers on Band and sits in the same room. A denied claim drops
              in, the Adjudicator gets mentioned, and from there the agents argue by answering each
              other in that one shared room. The hearing is the room&apos;s own record, and we export
              it straight into this interface.
            </p>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-cchalkdim">
              The hackathon asked for agents that genuinely work together, not a pipeline wearing four
              hats. Putting them in one room on Band, where the Scrutinizer can read the Advocate&apos;s
              argument and push back on it, is what makes the debate real.
            </p>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-cchalkdim">
              The panel even spans models on purpose: the three debaters run on a fast, light model so
              the back-and-forth stays quick; the chair runs on a heavier one, because weighing both
              sides and writing the ruling is the call that carries the most reasoning. Different
              engines, one room — the kind of mixed company Band exists to coordinate.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {BAND_STEPS.map((s) => (
                <span key={s} className="mono rounded-[2px] border border-cinkline px-2.5 py-1 text-[11px] text-cbrass">{s}</span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-4 md:border-l md:border-cinkline md:pl-10">
            <span className="keb text-cchalkdim">The safeguards</span>
            {SAFEGUARDS.map((s) => (
              <div key={s} className="flex items-start gap-3 text-[14px] leading-relaxed text-cchalkdim">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--c-brass)" }} />
                {s}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
