import { useRef } from "react";
import { motion, useInView } from "motion/react";
import NumberFlow from "@number-flow/react";

function CountUp({ to, suffix = "", prefix = "" }: { to: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  // Trigger on partial visibility (no aggressive negative margin) so it fires
  // reliably on any screen size and scroll speed.
  // amount: 0.5 fires when the number is half-visible — reliable on any screen,
  // and it animates ON SCROLL into view (not on load) without the old -25% margin
  // that left it stuck at 0.
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const v = inView ? to : 0;
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
                animate={inView ? { width: `${b.rate}%` } : { width: 0 }}
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

export function TheScale() {
  return (
    <section className="grain relative bg-cpaper">
      <div className="mx-auto max-w-[1400px] px-6 py-28 md:px-10 md:py-40">
        <div className="mb-12 flex items-baseline justify-between border-b border-cpaperline pb-4">
          <span className="keb text-cslate">The scale</span>
          <span className="mono text-[11px] text-cslate">{"// 01"}</span>
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
