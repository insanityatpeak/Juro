"use client";

import { motion, useSpring } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import Lenis from "lenis";

/* Studio-grade smooth scroll. Respects reduced-motion. */
export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    let raf = 0;
    const loop = (t: number) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);
  return <>{children}</>;
}

/* Clip-mask line reveal — the premium "unfolding argument" entrance. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <span className={`block overflow-hidden pb-[0.12em] ${className ?? ""}`}>
      <motion.span
        className="block"
        initial={{ y: "115%" }}
        animate={{ y: "0%" }}
        transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1], delay }}
      >
        {children}
      </motion.span>
    </span>
  );
}

/* Magnetic wrapper — the button leans toward the cursor (Family/Stripe feel). */
export function Magnetic({
  children,
  strength = 0.3,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(0, { stiffness: 200, damping: 15 });
  const y = useSpring(0, { stiffness: 200, damping: 15 });
  return (
    <motion.div
      ref={ref}
      style={{ x, y }}
      className={className}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/* The signature: a letterpress brass seal that impresses into the paper once. */
export function VerdictStamp({ size = 124, className }: { size?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      style={{ width: size, height: size }}
      initial={{ scale: 1.5, rotate: -9, opacity: 0 }}
      whileInView={{ scale: 1, rotate: -5, opacity: 1 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ type: "spring", stiffness: 460, damping: 15, mass: 0.7 }}
    >
      <svg viewBox="0 0 124 124" width={size} height={size} fill="none">
        <defs>
          <path id="vstamp" d="M62 19 a43 43 0 1 1 -0.1 0" />
        </defs>
        <circle cx="62" cy="62" r="58" stroke="var(--c-brass)" strokeWidth="1.4" opacity="0.45" />
        <circle cx="62" cy="62" r="50" stroke="var(--c-brass)" strokeWidth="2" />
        <text
          fill="var(--c-brass)"
          style={{ fontFamily: "var(--font-mono)", fontSize: "8.5px", letterSpacing: "3.2px" }}
        >
          <textPath href="#vstamp" startOffset="0%">
            JURO · GROUNDED IN LAW · A HUMAN RULES ·
          </textPath>
        </text>
        <g stroke="var(--c-brass)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M62 46 V80 M50 86 H74" />
          <path d="M62 52 L46 58 M62 52 L78 58" />
          <path d="M42 58 a4 4 0 0 0 8 0 M74 58 a4 4 0 0 0 8 0" />
        </g>
      </svg>
    </motion.div>
  );
}
