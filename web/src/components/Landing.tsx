"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useInView, useScroll, useTransform, type MotionValue } from "motion/react";
import NumberFlow from "@number-flow/react";
import { Magnetic, Reveal, SmoothScroll, VerdictStamp } from "@/components/motion";
import { usePlayback } from "@/lib/usePlayback";
import { HearingTranscript } from "@/components/HearingTranscript";
import { CASES } from "@/data/cases";

const tx = CASES[0].transcript;

export default function Landing() {
  return (
    <SmoothScroll>
      <div className="bg-cpaper text-cink">
        <Nav />
        <Hero />
        <TheScale />
        <WhatHappened />
        <HowItWorks />
        <DemoSection />
        <HowItFits />
        <LawIndex />
        <BuiltOnBand />
        <Provenance />
        <Expand />
        <FinalCta />
        <Footer />
      </div>
    </SmoothScroll>
  );
}

/* ===================================================================== nav */
function Nav() {
  return (
    <nav className="absolute left-0 right-0 top-0 z-50">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2.5 text-cchalk">
          <Scales className="h-7 w-7" />
          <span className="display text-2xl tracking-tight">Juro</span>
        </div>
        <div className="hidden items-center gap-9 text-[13px] text-cchalkdim md:flex">
          <a href="#how" className="transition-colors hover:text-cchalk">The tribunal</a>
          <a href="#demo" className="transition-colors hover:text-cchalk">In session</a>
          <a href="#law" className="transition-colors hover:text-cchalk">The law</a>
        </div>
        <Link href="/chamber" className="btn btn-line-ink !py-2 !text-[13px]">Enter the chamber</Link>
      </div>
    </nav>
  );
}

/* ==================================================================== hero */
function Hero() {
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

/* ============================================================= justice gap */
function CountUp({ to, suffix = "", prefix = "" }: { to: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  // Trigger on partial visibility (no aggressive negative margin) so it fires
  // reliably on any screen size and scroll speed.
  // amount: 0.5 fires when the number is half-visible — reliable on any screen,
  // and it animates ON SCROLL into view (not on load) without the old -25% margin
  // that left it stuck at 0.
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (inView) setV(to);
  }, [inView, to]);
  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      <NumberFlow value={v} trend={1} />
      {suffix}
    </span>
  );
}

const OVERTURN = [
  { label: "US · Medicare prior-auth appeals", rate: 80, year: "2024" },
  { label: "UK · disability (PIP) at tribunal", rate: 67, year: "2026" },
  { label: "India · ombudsman awards for the insured", rate: 52, year: "FY24" },
  { label: "US · ACA internal appeals", rate: 34, year: "2024" },
];

function OverturnChart() {
  const ref = useRef<HTMLDivElement>(null);
  // Fires when 35% of the chart is visible — animates on scroll into view.
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (inView) setShow(true);
  }, [inView]);
  return (
    <div ref={ref} className="flex flex-col gap-5">
      {OVERTURN.map((b, i) => (
        <div key={b.label}>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[12.5px] text-cink">{b.label}</span>
            <span className="mono text-[11px] text-cslate">{b.year}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-6 flex-1 overflow-hidden rounded-[2px]" style={{ background: "rgba(28,26,21,0.07)" }}>
              <motion.div
                className="h-full"
                style={{ background: "var(--c-brass)" }}
                initial={{ width: 0 }}
                animate={show ? { width: `${b.rate}%` } : { width: 0 }}
                transition={{ duration: 1, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <span className="display w-12 shrink-0 text-right text-[20px] text-cink">{b.rate}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function TheScale() {
  return (
    <section className="grain relative bg-cpaper">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-12 flex items-baseline justify-between border-b border-cpaperline pb-4">
          <span className="keb text-cslate">The scale</span>
          <span className="mono text-[11px] text-cslate">// 01</span>
        </div>
        <div className="grid gap-14 md:grid-cols-[0.95fr_1.05fr] md:items-center">
          <div>
            <h2 className="display text-[34px] leading-[1.04] text-cink md:text-[52px]">
              Deny first. Almost no one fights back.
            </h2>
            <p className="mt-6 max-w-md text-[15.5px] leading-relaxed text-cslate">
              In the US, nearly 1 in 5 in-network claims is denied, and fewer than 1 in 100 is
              appealed. In India, about 1 in 9 health claims is rejected, and the insurance ombudsman
              took 31,490 health complaints in a single year. In the UK, two thirds of disability
              denials get overturned once a judge actually looks. The denials usually aren&apos;t
              right. They just go unchallenged.
            </p>
            <div className="mt-9 flex flex-wrap gap-x-10 gap-y-5">
              <div>
                <div className="display text-[40px] leading-none text-cink"><CountUp to={19} suffix="%" /></div>
                <div className="mono mt-1 text-[10px] text-cslate">US claims denied (KFF, 2024)</div>
              </div>
              <div>
                <div className="display text-[40px] leading-none text-cink">~<CountUp to={11} suffix="%" /></div>
                <div className="mono mt-1 text-[10px] text-cslate">India health claims rejected (IRDAI, FY24)</div>
              </div>
              <div>
                <div className="display text-[40px] leading-none text-cink">&lt;1%</div>
                <div className="mono mt-1 text-[10px] text-cslate">US denials ever appealed</div>
              </div>
            </div>
          </div>
          <div className="rounded-sm border border-cpaperline bg-cpaper2 p-6 md:p-8">
            <div className="mb-6 text-[14px] leading-snug text-cink">
              When a denial is finally challenged, how often it gets reversed
            </div>
            <OverturnChart />
            <p className="mt-7 text-[11.5px] leading-relaxed text-cslate">
              Different countries, different appeal systems, different years. The shared lesson holds:
              a large share of denials do not survive review. Sources: KFF, UK Ministry of Justice,
              India Insurance Ombudsman.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================== how it works */
const STEPS = [
  { n: "01", who: "Advocate · for", t: "Argues the claim is valid, and pulls the records and policy language that support coverage.", accent: "var(--c-brass)" },
  { n: "02", who: "Scrutinizer · against", t: "Stress-tests every weakness: exclusions, missing documentation, the insurer's strongest case.", accent: "var(--c-oxblood)" },
  { n: "03", who: "Evidence · the record", t: "Grounds both sides in fact: the exact document or statute that settles each dispute.", accent: "var(--c-chalk-dim)" },
  { n: "04", who: "Adjudicator + you", t: "The AI weighs both rails and recommends. A human delivers the binding ruling.", accent: "var(--c-chalk)" },
];

function HowItWorks() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const e1 = useTransform(scrollYProgress, [0.08, 0.28], [0, 1]);
  const e2 = useTransform(scrollYProgress, [0.3, 0.5], [0, 1]);
  const e3 = useTransform(scrollYProgress, [0.5, 0.7], [0, 1]);
  const nFor = useTransform(scrollYProgress, [0.1, 0.2], [0.25, 1]);
  const nAgainst = useTransform(scrollYProgress, [0.32, 0.42], [0.25, 1]);
  const nClerk = useTransform(scrollYProgress, [0.52, 0.62], [0.25, 1]);
  const nRule = useTransform(scrollYProgress, [0.78, 0.95], [0.15, 1]);
  const ruleStroke = useTransform(scrollYProgress, [0.7, 0.95], [0, 1]);

  return (
    <section id="how" ref={ref} className="grain grain-ink relative bg-cink text-cchalk">
      <div className="mx-auto grid max-w-[1400px] gap-0 px-6 md:grid-cols-2 md:px-10">
        {/* sticky diagram */}
        <div className="sticky top-0 hidden h-screen flex-col justify-center md:flex">
          <div className="keb mb-8 text-cbrass">// 03 · How the tribunal works</div>
          <svg viewBox="0 0 360 360" className="w-full max-w-[440px]">
            <motion.line x1="120" y1="80" x2="220" y2="180" stroke="var(--c-brass)" strokeWidth="1.5" style={{ pathLength: e1 }} />
            <motion.line x1="120" y1="280" x2="220" y2="180" stroke="var(--c-oxblood)" strokeWidth="1.5" style={{ pathLength: e2 }} />
            <motion.line x1="48" y1="180" x2="220" y2="180" stroke="var(--c-chalk-dim)" strokeWidth="1.5" style={{ pathLength: e3 }} />
            <motion.line x1="220" y1="180" x2="320" y2="180" stroke="var(--c-brass)" strokeWidth="2" style={{ pathLength: ruleStroke }} />
            <Dot cx={120} cy={80} label="FOR" color="var(--c-brass)" o={nFor} />
            <Dot cx={120} cy={280} label="AGAINST" color="var(--c-oxblood)" o={nAgainst} />
            <Dot cx={48} cy={180} label="CLERK" color="var(--c-chalk-dim)" o={nClerk} />
            <motion.g style={{ opacity: nRule }}>
              <circle cx={320} cy={180} r="22" fill="var(--c-brass)" />
              <text x={320} y={184} textAnchor="middle" fill="#1b1206" style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: 1 }}>RULE</text>
            </motion.g>
            <circle cx={220} cy={180} r="9" fill="none" stroke="var(--c-chalk)" strokeWidth="1.5" />
          </svg>
        </div>

        {/* scrolling steps */}
        <div className="py-[18vh] md:py-[24vh]">
          <div className="keb mb-10 text-cbrass md:hidden">// 03 · How the tribunal works</div>
          <div className="space-y-[16vh]">
            {STEPS.map((s) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-12%" }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.accent }} />
                  <span className="mono text-[12px] text-cchalkdim">{s.n}</span>
                  <span className="keb text-[10px]" style={{ color: s.accent }}>{s.who}</span>
                </div>
                <p className="display mt-4 max-w-md text-[26px] leading-tight text-cchalk md:text-[32px]">{s.t}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Dot({ cx, cy, label, color, o }: { cx: number; cy: number; label: string; color: string; o: MotionValue<number> }) {
  return (
    <motion.g style={{ opacity: o }}>
      <circle cx={cx} cy={cy} r="7" fill={color} />
      <text x={cx} y={cy - 16} textAnchor="middle" fill="var(--c-chalk)" style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: 1.5 }}>{label}</text>
    </motion.g>
  );
}

/* ==================================================================== demo */
function DemoSection() {
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
  }, [pb.phase, pb.start]);
  const revealed = pb.phase === "idle" ? tx.turns.slice(0, 1) : pb.phase === "debate" ? tx.turns.slice(0, pb.index + 1) : tx.turns;
  return (
    <section id="demo" className="grain grain-ink relative bg-cink text-cchalk">
      <div className="mx-auto max-w-[1100px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-10 flex items-end justify-between border-b border-cinkline pb-4">
          <div>
            <div className="keb mb-3 text-cbrass">// 04 · In session</div>
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

/* ============================================================ real cases */
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

function WhatHappened() {
  return (
    <section id="cases" className="grain grain-ink relative bg-cink text-cchalk">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-4 flex items-baseline justify-between border-b border-cinkline pb-4">
          <h2 className="display text-[34px] leading-tight text-cchalk md:text-[52px]">This already happened.</h2>
          <span className="mono text-[11px] text-cchalkdim">// 02</span>
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

/* ============================================================== how it fits */
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

function HowItFits() {
  return (
    <section id="fit" className="grain relative bg-cpaper">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-4 flex items-baseline justify-between border-b border-cpaperline pb-4">
          <h2 className="display text-[34px] leading-tight text-cink md:text-[52px]">How it fits.</h2>
          <span className="mono text-[11px] text-cslate">// 05</span>
        </div>
        <p className="mb-14 max-w-xl text-[15px] leading-relaxed text-cslate">
          Today, fewer than 1% of denials are ever appealed. Of the ones that are filed, about a
          third get overturned. The gap isn't whether people are right. It's whether anyone has the
          time to argue. Juro closes the distance from months to minutes. And this is not a one-click
          appeal letter. It's a full hearing, both sides argued and on the record, which is what holds
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

/* =============================================================== law index */
const LAWS = [
  { id: "29 C.F.R. § 2560.503-1", t: "ERISA: full and fair review, the entire claim file, 180 days to appeal." },
  { id: "45 C.F.R. § 147.136", t: "ACA §2719: independent external review that binds the insurer." },
  { id: "No Surprises Act, 2022", t: "No balance billing for emergency & in-network-facility care." },
  { id: "CMS-0057-F, 2024", t: "A specific reason for every prior-auth denial, on a clock." },
];

function LawIndex() {
  return (
    <section id="law" className="grain relative bg-cpaper2">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-36">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="display text-[34px] leading-tight text-cink md:text-[52px]">Grounded in real law.</h2>
          <span className="mono text-[11px] text-cslate">// 06</span>
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

/* ================================================================= expand */
const DOMAINS = [
  { k: "Disability", tag: "next", denial: "Benefits stopped on a contested capacity finding.", same: "The same Advocate and Scrutinizer, argued from the medical record." },
  { k: "Veterans' benefits", tag: "next", denial: "A claim denied for “insufficient nexus” to service.", same: "Evidence pins each finding to the file; a human signs the rating." },
  { k: "Prior authorization", tag: "near fit", denial: "Care delayed by an automated “not medically necessary.”", same: "Necessity argued against the plan’s own criteria, on a clock." },
  { k: "Unemployment", tag: "planned", denial: "A claim refused over “misconduct” or availability.", same: "Both sides heard against the statute, not a call-center script." },
  { k: "Auto & property", tag: "planned", denial: "A payout cut by an estimating algorithm.", same: "The Scrutinizer in reverse: stress-test the insurer’s number." },
  { k: "Consumer & billing", tag: "planned", denial: "Surprise bills and quietly denied refunds.", same: "A small, fast hearing where none existed before." },
];

function Expand() {
  return (
    <section id="next" className="grain grain-ink relative bg-cink text-cchalk">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-6 flex items-baseline justify-between border-b border-cinkline pb-4">
          <h2 className="display max-w-[18ch] text-[30px] leading-tight text-cchalk md:text-[46px]">
            The same tribunal, wherever a rulebook meets a backlog.
          </h2>
          <span className="mono text-[11px] text-cchalkdim">// 09</span>
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

/* =========================================================== built on band */
const BAND_STEPS = ["four agents register", "live over WebSocket", "one shared room", "@mention to convene", "argue by reply"];
const SAFEGUARDS = [
  "A human delivers every ruling. The AI argues, it never decides.",
  "Every argument cites a source: a plan clause, a guideline, or a statute.",
  "The whole hearing is hash-chained into one root, so the record can't be quietly edited.",
];

function BuiltOnBand() {
  return (
    <section className="grain grain-ink relative bg-cink text-cchalk">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-10 flex items-baseline justify-between border-b border-cinkline pb-4">
          <h2 className="display text-[34px] leading-tight text-cchalk md:text-[52px]">Built on Band.</h2>
          <span className="mono text-[11px] text-cchalkdim">// 07</span>
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

/* =========================================================== provenance */
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

function Provenance() {
  return (
    <section id="record" className="grain relative bg-cpaper">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-4 flex items-baseline justify-between border-b border-cpaperline pb-4">
          <h2 className="display text-[34px] leading-tight text-cink md:text-[52px]">Built to hold up.</h2>
          <span className="mono text-[11px] text-cslate">// 08</span>
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

/* ==================================================================== cta */
function FinalCta() {
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

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="keb mb-3 text-cchalkdim">{title}</div>
      <ul className="flex flex-col gap-2 text-[13px]">
        {links.map(([t, h]) => (
          <li key={t}>
            <a href={h} className="text-cchalkdim transition-colors hover:text-cchalk">{t}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Footer() {
  return (
    <footer className="bg-cink text-cchalkdim">
      <div className="mx-auto max-w-[1400px] px-6 py-14 md:px-10">
        <div className="grid gap-10 border-b border-cinkline pb-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2 text-cchalk">
              <Scales className="h-5 w-5" />
              <span className="display text-lg">Juro</span>
            </div>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-cchalkdim">
              Both sides heard. One ruling. An adversarial tribunal for denied claims, grounded in
              real law and run on Band.
            </p>
          </div>
          <FooterCol title="Product" links={[["Enter the chamber", "/chamber"], ["How it works", "#how"], ["See a hearing", "#demo"]]} />
          <FooterCol title="The case" links={[["Real cases", "#cases"], ["The law", "#law"], ["Where it goes", "#next"]]} />
          <FooterCol title="More" links={[["GitHub", "https://github.com/PiyushMalik01/juro"], ["Built on Band", "https://www.band.ai"]]} />
        </div>
        <div className="flex flex-col gap-3 pt-7 text-[12px] md:flex-row md:items-center md:justify-between">
          <p className="max-w-2xl leading-relaxed text-cchalkdim">
            Juro provides decision support, not legal advice. A human delivers every ruling. Citations
            are informational. Verify deadlines and rights for your plan, program, and state.
          </p>
          <span className="mono shrink-0">Band of Agents Hackathon · 2026</span>
        </div>
      </div>
    </footer>
  );
}

/* scales-of-justice mark */
function Scales({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="var(--c-brass)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 V21 M7 21 H17" />
      <path d="M12 6 L5 9 M12 6 L19 9" />
      <path d="M3 9 a3 3 0 0 0 6 0 M15 9 a3 3 0 0 0 6 0" />
    </svg>
  );
}
