import { motion } from "motion/react";

const DOMAINS = [
  { k: "Disability", tag: "next", denial: "Benefits stopped on a contested capacity finding.", same: "The same Advocate and Scrutinizer, argued from the medical record." },
  { k: "Veterans' benefits", tag: "next", denial: "A claim denied for “insufficient nexus” to service.", same: "Evidence pins each finding to the file; a human signs the rating." },
  { k: "Prior authorization", tag: "near fit", denial: "Care delayed by an automated “not medically necessary.”", same: "Necessity argued against the plan’s own criteria, on a clock." },
  { k: "Unemployment", tag: "planned", denial: "A claim refused over “misconduct” or availability.", same: "Both sides heard against the statute, not a call-center script." },
  { k: "Auto & property", tag: "planned", denial: "A payout cut by an estimating algorithm.", same: "The Scrutinizer in reverse: stress-test the insurer’s number." },
  { k: "Consumer & billing", tag: "planned", denial: "Surprise bills and quietly denied refunds.", same: "A small, fast hearing where none existed before." },
];

export function Expand() {
  return (
    <section id="next" className="grain grain-ink relative bg-cink text-cchalk">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-6 flex items-baseline justify-between border-b border-cinkline pb-4">
          <h2 className="display max-w-[18ch] text-[30px] leading-tight text-cchalk md:text-[46px]">
            The same tribunal, wherever a rulebook meets a backlog.
          </h2>
          <span className="mono text-[11px] text-cchalkdim">{"// 09"}</span>
        </div>
        <p className="mb-12 max-w-2xl text-[15px] leading-relaxed text-cchalkdim">
          Health insurance is the wedge, because the rules are already written down. The wedge alone
          rides on a $150B-plus denial-management market and $4.9 trillion of US health spend, with
          about one in five claims denied. But the machinery is the same wherever a denial hides behind
          a rulebook. A different statute loads in; the four roles, the relay, and the sealed record do
          not change, and every rulebook after the first widens the floor.
        </p>

        <div className="grid gap-px md:grid-cols-2 lg:grid-cols-3" style={{ background: "var(--c-ink-line)" }}>
          {DOMAINS.map((d, i) => (
            <motion.div
              key={d.k}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.06 }}
              className="flex flex-col bg-cink p-6 md:p-7"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="display text-[21px] leading-tight text-cchalk">{d.k}</span>
                <span
                  className="mono shrink-0 text-[9px] uppercase tracking-[0.14em]"
                  style={{ color: d.tag === "planned" ? "var(--c-chalk-dim)" : "var(--c-brass)" }}
                >
                  {d.tag}
                </span>
              </div>
              <p className="mt-3 text-[13.5px] leading-relaxed text-cchalkdim">{d.denial}</p>
              <p className="mt-4 border-l-2 pl-3 text-[13px] leading-relaxed text-cchalkdim" style={{ borderColor: "var(--c-brass)" }}>
                <span className="text-cbrass">Same tribunal. </span>
                {d.same}
              </p>
            </motion.div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-baseline gap-x-8 gap-y-3 border-t border-cinkline pt-8">
          <span className="display text-[40px] leading-none text-cchalk md:text-[56px]">One engine.</span>
          <span className="display text-[40px] italic leading-none text-cbrass display-soft md:text-[56px]">Every rulebook.</span>
          <span className="ml-auto max-w-xs text-[13px] leading-relaxed text-cchalkdim">
            Each new domain is a rulebook to argue against, not a system to rebuild.
          </span>
        </div>
      </div>
    </section>
  );
}
