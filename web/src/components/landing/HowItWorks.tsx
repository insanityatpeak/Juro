import { useRef } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "motion/react";

const STEPS = [
  { n: "01", who: "Advocate · for", t: "Argues the claim is valid, and pulls the records and policy language that support coverage.", accent: "var(--c-brass)" },
  { n: "02", who: "Scrutinizer · against", t: "Stress-tests every weakness: exclusions, missing documentation, the insurer's strongest case.", accent: "var(--c-oxblood)" },
  { n: "03", who: "Evidence · the record", t: "Grounds both sides in fact: the exact document or statute that settles each dispute.", accent: "var(--c-chalk-dim)" },
  { n: "04", who: "Adjudicator + you", t: "The AI weighs both rails and recommends. A human delivers the binding ruling.", accent: "var(--c-chalk)" },
];

function Dot({ cx, cy, label, color, o }: { cx: number; cy: number; label: string; color: string; o: MotionValue<number> }) {
  return (
    <motion.g style={{ opacity: o }}>
      <circle cx={cx} cy={cy} r="7" fill={color} />
      <text x={cx} y={cy - 16} textAnchor="middle" fill="var(--c-chalk)" style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: 1.5 }}>{label}</text>
    </motion.g>
  );
}

export function HowItWorks() {
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
          <div className="keb mb-8 text-cbrass">{"// 03 · How the tribunal works"}</div>
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
          <div className="keb mb-10 text-cbrass md:hidden">{"// 03 · How the tribunal works"}</div>
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
