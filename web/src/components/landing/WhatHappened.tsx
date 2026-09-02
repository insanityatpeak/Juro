import { motion } from "motion/react";

const REAL_CASES = [
  {
    place: "United States",
    who: "Gene Lokken, 91",
    what: "After he broke a leg, an algorithm called nH Predict cut his rehab coverage at 19 days, against his own doctor's plan. The lawsuit says only about 0.2% of patients ever appeal.",
    harm: "His family paid roughly $150,000 before he died.",
    fix: "Cite Jimmo v. Sebelius, which bars ending skilled care just because a patient has stopped improving.",
    src: "Estate of Lokken v. UnitedHealth (alleged) · StatNews",
  },
  {
    place: "United States",
    who: "Dr. Nick van Terheyden, 58",
    what: "Cigna's PxDx system flagged a $350 blood test and a medical director signed the denial in about 1.2 seconds, without opening the file. The appeal took seven months.",
    harm: "An external reviewer finally ruled the test medically necessary, and Cigna paid.",
    fix: "Hold a 1.2-second batch denial against the duty to run a thorough, fair investigation of each claim.",
    src: "ProPublica",
  },
  {
    place: "India",
    who: "Alok Bector, Mumbai",
    what: "Niva Bupa rejected his overseas cancer-treatment claim by pointing to an unrelated asthma history it said he hadn't disclosed. A consumer court found a deficiency in service.",
    harm: "He carried about ₹66.5 lakh in treatment costs before the court ordered the insurer to pay.",
    fix: "Cite the rule that a non-disclosure must be material to the condition claimed. Asthma is not material to colorectal cancer.",
    src: "Mumbai Suburban Consumer Commission · Free Press Journal",
  },
  {
    place: "United Kingdom",
    who: "Philippa Day, 27",
    what: "Her disability payment (PIP) was wrongly stopped. A coroner later found 28 separate failures in how the claim was handled.",
    harm: "The coroner found the resulting financial distress was the predominant factor in her death.",
    fix: "Catch a benefit stopped on a wrongly-decided 'no good cause' finding, despite a recorded need for support.",
    src: "Coroner's inquest, 2021 · Disability News Service",
  },
];

export function WhatHappened() {
  return (
    <section id="cases" className="grain grain-ink relative bg-cink text-cchalk">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-4 flex items-baseline justify-between border-b border-cinkline pb-4">
          <h2 className="display text-[34px] leading-tight text-cchalk md:text-[52px]">This already happened.</h2>
          <span className="mono text-[11px] text-cchalkdim">{"// 02"}</span>
        </div>
        <p className="mb-12 max-w-xl text-[15px] leading-relaxed text-cchalkdim">
          Real people, real denials, on three continents. Each one was a single rule away from a
          different ending. These are documented cases. For the ones still in court, we keep to the
          wording the filings use.
        </p>
        <div className="grid gap-5 md:grid-cols-2">
          {REAL_CASES.map((c, i) => (
            <motion.div
              key={c.who}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.6, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col rounded-sm border border-cinkline bg-cink2 p-6"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="display text-[22px] leading-tight text-cchalk">{c.who}</span>
                <span className="keb shrink-0 !text-[9px] text-cbrass">{c.place}</span>
              </div>
              <p className="mt-3 text-[14px] leading-relaxed text-cchalkdim">{c.what}</p>
              <p className="mt-3 text-[14px] font-medium leading-relaxed text-cchalk">{c.harm}</p>
              <p className="mt-4 border-l-2 pl-3 text-[13px] leading-relaxed text-cchalkdim" style={{ borderColor: "var(--c-brass)" }}>
                <span className="text-cbrass">What Juro does. </span>
                {c.fix}
              </p>
              <p className="mono mt-auto pt-4 text-[10px] text-cchalkdim opacity-70">{c.src}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
