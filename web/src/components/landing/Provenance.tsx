import { motion } from "motion/react";

const RELAY = [
  { k: "A relay that can't stall", d: "Every handoff between agents is forced in code, in a fixed order. A model can argue however it likes; it cannot skip a voice or break the chain." },
  { k: "A turn that's never silent", d: "On Band an agent only speaks by calling a tool. If one reasons out its ruling but forgets to post, we capture the text and post it for it. No turn is ever lost." },
  { k: "A panel across two models", d: "The debaters run on a fast model; the chair on a heavier one, because weighing both sides and writing the ruling carries the most reasoning." },
];

const CHAIN = [
  { n: "01", who: "Adjudicator · opening", h: "9f2a1c4e" },
  { n: "02", who: "Advocate · argument", h: "c4d137b9" },
  { n: "03", who: "Scrutinizer · rebuttal", h: "7b0e5826" },
  { n: "04", who: "Evidence · the record", h: "1e6fa20d" },
  { n: "05", who: "Adjudicator · ruling", h: "a3904471" },
];

export function Provenance() {
  return (
    <section id="record" className="grain relative bg-cpaper">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-4 flex items-baseline justify-between border-b border-cpaperline pb-4">
          <h2 className="display text-[34px] leading-tight text-cink md:text-[52px]">Built to hold up.</h2>
          <span className="mono text-[11px] text-cslate">{"// 08"}</span>
        </div>
        <p className="mb-14 max-w-xl text-[15px] leading-relaxed text-cslate">
          A tribunal is only worth trusting if it runs cleanly and can&apos;t be quietly rewritten. We
          engineered for both: a debate that can&apos;t stall, and a record that can&apos;t lie.
        </p>
        <div className="grid gap-x-12 gap-y-14 md:grid-cols-[1fr_0.9fr]">
          {/* the engine */}
          <div>
            <span className="keb text-coxblood">The engine</span>
            <div className="mt-7 flex flex-col gap-8">
              {RELAY.map((r, i) => (
                <motion.div
                  key={r.k}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.5, delay: i * 0.06 }}
                  className="border-t border-cpaperline pt-5"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="mono text-[12px] text-cslate">{String(i + 1).padStart(2, "0")}</span>
                    <span className="display text-[21px] leading-tight text-cink md:text-[24px]">{r.k}</span>
                  </div>
                  <p className="mt-2.5 max-w-md text-[14.5px] leading-relaxed text-cslate">{r.d}</p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* the sealed record — hash chain */}
          <div className="rounded-sm border border-cpaperline bg-cpaper2 p-6 md:p-8">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="keb text-cslate">The sealed record</span>
              <span className="mono text-[10px] text-cslate">sha-256 · hash chain</span>
            </div>
            <p className="mb-6 text-[12.5px] leading-relaxed text-cslate">
              Each turn is hashed together with the one before it. The whole hearing collapses to a single root.
            </p>
            <div className="relative">
              <span className="absolute left-[7px] top-2 bottom-2 w-px" style={{ background: "var(--c-paper-line)" }} />
              <div className="flex flex-col gap-3.5">
                {CHAIN.map((c, i) => (
                  <motion.div
                    key={c.n}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 0.4, delay: i * 0.09 }}
                    className="relative flex items-center gap-3 pl-6"
                  >
                    <span
                      className="absolute left-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2"
                      style={{ borderColor: "var(--c-brass)", background: "var(--c-paper-2)" }}
                    />
                    <span className="mono w-5 text-[11px] text-cslate">{c.n}</span>
                    <span className="flex-1 text-[13px] text-cink">{c.who}</span>
                    <span className="mono text-[11px] text-cslate">{c.h}</span>
                  </motion.div>
                ))}
              </div>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="mt-5 flex items-center gap-3 rounded-[2px] border px-4 py-3"
                style={{ borderColor: "var(--c-brass)" }}
              >
                <span className="keb !text-[10px] text-cbrass">root</span>
                <span className="mono text-[12px] text-cink">4c7e91a2 8f0b6d35</span>
                <span className="mono ml-auto text-[10px] text-cbrass">sealed</span>
              </motion.div>
            </div>
            <p className="mt-6 text-[12px] leading-relaxed text-cslate">
              Change one word, anywhere in the hearing, and the root no longer matches. Every argument
              stays pinned to the exact record it cites. The whole thing is verifiable, and
              tamper-evident by construction.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
