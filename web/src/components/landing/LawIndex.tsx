import { motion } from "motion/react";

const LAWS = [
  { id: "29 C.F.R. § 2560.503-1", t: "ERISA: full and fair review, the entire claim file, 180 days to appeal." },
  { id: "45 C.F.R. § 147.136", t: "ACA §2719: independent external review that binds the insurer." },
  { id: "No Surprises Act, 2022", t: "No balance billing for emergency & in-network-facility care." },
  { id: "CMS-0057-F, 2024", t: "A specific reason for every prior-auth denial, on a clock." },
];

export function LawIndex() {
  return (
    <section id="law" className="grain relative bg-cpaper2">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-36">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="display text-[34px] leading-tight text-cink md:text-[52px]">Grounded in real law.</h2>
          <span className="mono text-[11px] text-cslate">{"// 06"}</span>
        </div>
        <p className="mb-12 max-w-md text-[15px] text-cslate">
          A challenge isn&apos;t a plea. It&apos;s an assertion of a right you already hold. Every
          ruling cites its authority.
        </p>
        <ul>
          {LAWS.map((l, i) => (
            <motion.li
              key={l.id}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.5, delay: i * 0.05 }}
              className="group grid grid-cols-[auto_1fr] items-baseline gap-6 border-t border-cpaperline py-6 transition-colors last:border-b hover:bg-cink/[0.03] md:grid-cols-[260px_1fr] md:gap-10 md:px-2"
            >
              <span className="mono text-[12px] text-coxblood transition-colors group-hover:text-cbrass md:text-[13px]">{l.id}</span>
              <span className="text-[17px] text-cink md:text-[22px]">{l.t}</span>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}
