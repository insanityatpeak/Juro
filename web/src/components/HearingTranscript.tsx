"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CHAIR_MODEL, DEBATER_MODEL } from "@/lib/roles";
import type { Faction, Turn } from "@/lib/types";

/** "claude-sonnet-4-6" → "Sonnet 4.6" — for the panel caption. */
function engineLabel(model: string): string {
  const m = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (!m) return model;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
}

/* Court-record palette for the dark "hearing room" ground. */
export const SEAT_META: Record<
  Faction,
  { label: string; role: string; accent: string }
> = {
  advocate: { label: "Advocate", role: "for", accent: "var(--c-brass)" },
  scrutinizer: { label: "Scrutinizer", role: "against", accent: "var(--c-oxblood)" },
  evidence: { label: "Evidence", role: "the record", accent: "var(--c-chalk-dim)" },
  adjudicator: { label: "Adjudicator", role: "chair", accent: "var(--c-chalk)" },
  human: { label: "Reviewer", role: "bench", accent: "var(--c-chalk)" },
};

const SEATS: Faction[] = ["advocate", "evidence", "adjudicator", "scrutinizer"];

function clockFor(turns: Turn[], i: number) {
  let ms = 0;
  for (let k = 0; k < i; k++) ms += turns[k].durationMs;
  const t = 9 * 3600 + Math.round(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(t / 3600) % 24)}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}

function Waveform({ color }: { color: string }) {
  return (
    <div className="flex items-end gap-[2px]" style={{ height: 10 }}>
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="w-[2px] rounded-full"
          style={{ background: color }}
          animate={{ height: [3, 10, 4, 9, 3] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/** Each seat names the engine behind it, so the cross-model panel is legible. */
const SEAT_ENGINE: Record<Faction, string> = {
  advocate: DEBATER_MODEL,
  scrutinizer: DEBATER_MODEL,
  evidence: DEBATER_MODEL,
  adjudicator: CHAIR_MODEL,
  human: CHAIR_MODEL,
};

/** The panel of seats. The agent who holds the floor lights up. */
export function Bench({ active }: { active: Faction | null }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SEATS.map((f) => {
          const m = SEAT_META[f];
          const on = active === f;
          return (
            <motion.div
              key={f}
              animate={{ opacity: on ? 1 : 0.5 }}
              className="flex items-center gap-2.5 rounded-sm border px-3 py-2"
              style={{ borderColor: on ? m.accent : "var(--c-ink-line)", background: on ? "var(--c-ink-2)" : "transparent" }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.accent }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-cchalk">{m.label}</div>
                <div className="keb !text-[9px] !tracking-[0.14em]" style={{ color: m.accent }}>{m.role}</div>
              </div>
              {on ? <Waveform color={m.accent} /> : <span className="h-1 w-1 rounded-full bg-cchalkdim opacity-50" />}
            </motion.div>
          );
        })}
      </div>
      {/* The panel spans two models on purpose — make that legible. */}
      <p className="mono text-[10px] leading-relaxed text-cchalkdim">
        cross-model panel · three debaters on {engineLabel(SEAT_ENGINE.advocate)} ·
        chair on {engineLabel(SEAT_ENGINE.adjudicator)}
      </p>
    </div>
  );
}

function Row({ turn, time, active, onCite }: { turn: Turn; time: string; active: boolean; onCite?: (id: string) => void }) {
  const m = SEAT_META[turn.agent];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
      className="relative pl-4"
      style={{ overflowAnchor: "none" }}
    >
      {/* side accent bar */}
      <span
        className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full"
        style={{ background: m.accent, opacity: active ? 1 : 0.32 }}
      />
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium" style={{ color: m.accent }}>{m.label}</span>
        <span className="keb !text-[9px]" style={{ color: "var(--c-chalk-dim)" }}>{m.role}</span>
        <span className="mono ml-auto text-[10px] text-cchalkdim">{time}</span>
      </div>
      <p className="mt-1 text-[14px] leading-relaxed" style={{ color: active ? "var(--c-chalk)" : "var(--c-chalk-dim)" }}>
        {turn.text}
      </p>
      {turn.evidenceRefs && turn.evidenceRefs.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {turn.evidenceRefs.map((r) => (
            <button
              key={r}
              onClick={() => onCite?.(r)}
              className="mono rounded-[2px] border border-cinkline px-1.5 py-0.5 text-[10px] text-cbrass transition-colors hover:border-cbrass hover:text-cchalk"
            >
              ⌐ {r}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// Each agent works through a few visible stages while it "researches", so the
// loader reads as real work, not a spinner.
const THINK_STAGES: Record<Faction, string[]> = {
  advocate: ["reading the file", "marshalling the records", "drafting the argument"],
  scrutinizer: ["reviewing the claim", "probing for gaps", "forming the objection"],
  evidence: ["pulling the record", "matching the citation", "confirming the fact"],
  adjudicator: ["weighing both sides", "checking the evidence", "writing the ruling"],
  human: ["reviewing the hearing", "checking the citations", "preparing to rule"],
};

function ThinkingRow({ agent }: { agent: Faction }) {
  const m = SEAT_META[agent];
  const stages = THINK_STAGES[agent];
  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
    const id = setInterval(() => setStep((s) => Math.min(s + 1, stages.length - 1)), 850);
    return () => clearInterval(id);
  }, [agent, stages.length]);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative pl-4"
    >
      <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full" style={{ background: m.accent, opacity: 0.7 }} />
      <div className="flex items-center gap-2.5">
        <span className="text-[13px] font-medium" style={{ color: m.accent }}>{m.label}</span>
        <AnimatePresence mode="wait">
          <motion.span
            key={step}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="text-[13px] italic text-cchalkdim"
          >
            is {stages[step]}
          </motion.span>
        </AnimatePresence>
        <span className="flex gap-[3px]">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1 w-1 rounded-full"
              style={{ background: m.accent }}
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
            />
          ))}
        </span>
      </div>
      {/* three-step progress: each tick fills as the agent advances */}
      <div className="mt-2 flex gap-1.5">
        {stages.map((_, i) => (
          <span key={i} className="block h-[3px] w-7 overflow-hidden rounded-full" style={{ background: "var(--c-ink-line)" }}>
            <motion.span
              className="block h-full"
              style={{ background: m.accent }}
              initial={{ width: 0 }}
              animate={{ width: i <= step ? "100%" : "0%" }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </span>
        ))}
      </div>
    </motion.div>
  );
}

/**
 * The hearing as a clean court transcript: a bench of seats up top (the speaker
 * lights up), then a single readable column that streams in turn by turn. Before
 * each line, the agent shows a brief "researching" loader.
 */
export function HearingTranscript({
  turns,
  all,
  activeId,
  thinkingAgent = null,
  onCite,
  showBench = true,
  autoScroll = true,
}: {
  turns: Turn[];
  all: Turn[];
  activeId?: string | null;
  thinkingAgent?: Faction | null;
  onCite?: (id: string) => void;
  showBench?: boolean;
  autoScroll?: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoScroll) return;
    // Scroll ONLY a genuine inner scroll container, and NEVER the page itself.
    // Walking up to the document scroller (or a Lenis wrapper) is what yanked the
    // whole landing to the demo; bound the walk and require real overflow.
    const stop = document.scrollingElement || document.documentElement;
    let el = endRef.current?.parentElement as HTMLElement | null;
    while (el && el !== document.body && el !== document.documentElement && el !== stop) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 4) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        return;
      }
      el = el.parentElement;
    }
    // No genuine inner scroll container: do nothing. Never scroll the page.
  }, [turns.length, thinkingAgent, autoScroll]);

  const activeAgent =
    thinkingAgent ?? (activeId ? (all.find((t) => t.id === activeId)?.agent ?? null) : null);

  return (
    <div className="flex flex-col gap-5">
      {showBench && <Bench active={activeAgent} />}
      <div className="flex flex-col gap-4">
        <AnimatePresence initial={false}>
          {turns.map((t) => (
            <Row key={t.id} turn={t} time={clockFor(all, all.findIndex((x) => x.id === t.id))} active={activeId === t.id} onCite={onCite} />
          ))}
          {thinkingAgent && <ThinkingRow key="thinking" agent={thinkingAgent} />}
        </AnimatePresence>
        <div ref={endRef} />
      </div>
    </div>
  );
}
