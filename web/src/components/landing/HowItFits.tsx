import { motion } from "motion/react";

const FIT = [
  {
    n: "01",
    t: "You bring the denial.",
    d: "Paste the denial letter, or connect a claims feed and let denials land in the queue as they come. No new format to learn. The letter you already have is the input.",
  },
  {
    n: "02",
    t: "The hearing runs in minutes.",
    d: "Four advocates argue the claim, for and against, against the plan's own rules and the law that sits above them. An appeal otherwise takes months. Here a ruling lands while you're still on the call.",
  },
  {
    n: "03",
    t: "The output is a filed-ready appeal.",
    d: "Not a summary. A finished appeal letter with the citations already set in it, the statute, the policy clause, the chart date, each one tied to the line it backs.",
  },
  {
    n: "04",
    t: "Every step is on the record.",
    d: "Each turn, each exhibit, each ruling is hash-chained into one root for the file. If anyone asks how the decision was reached, the answer is the record itself.",
  },
];

export function HowItFits() {
  return (
    <section id="fit" className="grain relative bg-cpaper">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-4 flex items-baseline justify-between border-b border-cpaperline pb-4">
          <h2 className="display text-[34px] leading-tight text-cink md:text-[52px]">How it fits.</h2>
          <span className="mono text-[11px] text-cslate">{"// 05"}</span>
        </div>
        <p className="mb-14 max-w-xl text-[15px] leading-relaxed text-cslate">
          Today, fewer than 1% of denials are ever appealed. Of the ones that are filed, about a
          third get overturned. The gap isn&apos;t whether people are right. It&apos;s whether anyone has the
          time to argue. Juro closes the distance from months to minutes. And this is not a one-click
          appeal letter. It&apos;s a full hearing, both sides argued and on the record, which is what holds
          up when a decision is contested.
        </p>
        <div className="grid gap-x-12 gap-y-12 md:grid-cols-2">
          {FIT.map((f, i) => (
            <motion.div
              key={f.n}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-15%" }}
              transition={{ duration: 0.55, delay: i * 0.06 }}
              className="border-t border-cpaperline pt-6"
            >
              <div className="flex items-center gap-3">
                <span className="mono text-[12px] text-coxblood">{f.n}</span>
                <span className="display text-[22px] leading-tight text-cink md:text-[26px]">{f.t}</span>
              </div>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-cslate">{f.d}</p>
            </motion.div>
          ))}
        </div>
        <div className="mt-16 flex flex-wrap items-baseline gap-x-10 gap-y-4 border-t border-cpaperline pt-8">
          <span className="display text-[40px] leading-none text-cink md:text-[56px]">Minutes</span>
          <span className="mono text-[12px] text-cslate">not months</span>
          <span className="ml-auto max-w-xs text-[13px] leading-relaxed text-cslate">
            The hearing finishes before a fax machine would have warmed up.
          </span>
        </div>
        <p className="mt-8 max-w-2xl text-[13.5px] leading-relaxed text-cslate">
          <span className="text-coxblood">How it pays. </span>
          Juro earns a share of the claims it recovers, and runs as a reviewer console and API for the
          hospitals and patient-advocacy firms already spending to fight denials by hand.
        </p>
      </div>
    </section>
  );
}
