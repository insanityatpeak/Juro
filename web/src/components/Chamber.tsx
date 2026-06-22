"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { HearingTranscript } from "@/components/HearingTranscript";
import { CASES } from "@/data/cases";
import { useLiveHearing } from "@/lib/useLiveHearing";
import { useVoice } from "@/lib/useVoice";
import type { CaseEntry, EvidenceItem, Transcript } from "@/lib/types";

type HearingState = ReturnType<typeof useLiveHearing>;

export default function Chamber() {
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ? CASES.find((c) => c.id === selected) ?? null : null;

  if (!active) {
    return <Picker onPick={(id) => setSelected(id)} />;
  }

  // Keyed so all hearing-room hooks reset cleanly when the case changes.
  return <Hearing key={active.id} entry={active} onBack={() => setSelected(null)} />;
}

/* ----------------------------------------------------------------- picker */

function Picker({ onPick }: { onPick: (id: string) => void }) {
  return (
    <section className="grain-ink relative min-h-dvh bg-cink text-cchalk">
      <header className="flex items-center gap-3 border-b border-cinkline px-6 py-4">
        <Link href="/" className="display text-lg text-cchalk">
          Juro
        </Link>
        <span className="h-4 w-px bg-cinkline" />
        <span className="keb text-cchalkdim">the chamber</span>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        <h1 className="display text-3xl text-cchalk sm:text-4xl">Choose a case to hear.</h1>
        <p className="mt-3 max-w-xl text-[15px] text-cchalkdim">
          Each one is a real-shaped denial. Open it and the tribunal argues both sides on the record
          before you rule.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CASES.map((c) => (
            <CaseCard key={c.id} entry={c} onPick={onPick} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CaseCard({ entry, onPick }: { entry: CaseEntry; onPick: (id: string) => void }) {
  const { case: cf } = entry.transcript;
  return (
    <motion.button
      onClick={() => onPick(entry.id)}
      whileHover={{ y: -2 }}
      className="group flex flex-col rounded-sm border border-cinkline bg-cink2 p-5 text-left transition-colors hover:border-cslate"
    >
      <div className="keb text-cbrass">{entry.tag}</div>
      <h2 className="display mt-2 text-xl text-cchalk">{entry.title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-cchalkdim">{entry.blurb}</p>
      <p className="mt-3 text-[13px] italic text-cslate">{entry.stake}</p>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-cinkline pt-3">
        <span className="mono text-[11px] text-cchalkdim">
          {cf.patient} · {cf.amount}
        </span>
        <span className="btn btn-brass !px-3 !py-1.5 !text-[12px]">Hear this case →</span>
      </div>
    </motion.button>
  );
}

/* ---------------------------------------------------------------- hearing */

function Hearing({ entry, onBack }: { entry: CaseEntry; onBack: () => void }) {
  const transcript: Transcript = entry.transcript;
  const cf = transcript.case;

  const voice = useVoice();
  const [listen, setListen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  // The player (useLiveHearing) drives the voice: it reveals a turn and waits for
  // its audio to finish before the next, so reply and speech stay in lockstep.
  // A ref lets the player read the *current* Listen state without re-subscribing.
  const listenRef = useRef(listen);
  listenRef.current = listen;
  const pb = useLiveHearing(entry, {
    speak: voice.speak,
    isListening: () => listenRef.current,
    prefetch: (t) => voice.prime([t]),
    ready: voice.ready,
  });

  const revealed = pb.turns;
  const current = revealed.length ? revealed[revealed.length - 1] : null;
  const activeRefs = new Set([...(current?.evidenceRefs ?? []), focus].filter(Boolean) as string[]);

  const toggleListen = () => {
    const next = !listen;
    setListen(next);
    if (!next) voice.stop();
  };

  const back = () => {
    voice.reset();
    pb.restart();
    setFocus(null);
    onBack();
  };

  return (
    <section className="grain-ink relative min-h-dvh bg-cink text-cchalk">
      {/* header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cinkline px-6 py-4">
        <button onClick={back} className="btn btn-line-ink !px-3 !py-1.5 !text-[12px]">
          ← All cases
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="mono text-[12px] text-cchalkdim">{cf.claimId}</span>
            <span className="text-[14px] text-cchalk">{cf.patient}</span>
            <span className="text-cslate">·</span>
            <span className="text-[14px] text-cchalkdim">{cf.procedure}</span>
            {pb.live && pb.phase !== "idle" && (
              <span className="mono ml-1 flex items-center gap-1.5 text-[10px] text-cbrass">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--c-brass)" }} /> live
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[13px] text-coxblood">Denied: {cf.denialReason}</div>
        </div>
        <button
          onClick={toggleListen}
          className={listen ? "btn btn-brass !px-3 !py-1.5 !text-[12px]" : "btn btn-line-ink !px-3 !py-1.5 !text-[12px]"}
        >
          {listen ? "Listening" : "Listen"}
        </button>
      </header>

      <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* main column */}
        <main className="flex min-h-0 flex-col border-cinkline lg:border-r">
          {pb.phase === "idle" ? (
            <Intro onStart={pb.start} />
          ) : (
            <>
              <div className="scroll-fade min-h-0 flex-1 overflow-y-auto px-6 py-6">
                <HearingTranscript
                  turns={revealed}
                  all={revealed}
                  activeId={pb.activeId}
                  thinkingAgent={pb.thinkingAgent}
                  onCite={(id) => setFocus(id)}
                  showBench
                />
              </div>
              <Transport pb={pb} />
            </>
          )}
        </main>

        {/* right rail */}
        <aside className="scroll-fade min-h-0 overflow-y-auto px-5 py-6">
          <RightRail
            transcript={transcript}
            activeRefs={activeRefs}
            focus={focus}
            onFocus={setFocus}
            pb={pb}
          />
        </aside>
      </div>
    </section>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <div className="display text-3xl text-cchalk">A claim was denied.</div>
      <p className="mt-3 text-[15px] leading-relaxed text-cchalkdim">
        Convene the tribunal and hear both sides argue from the record. You deliver the ruling.
      </p>
      <button onClick={onStart} className="btn btn-brass mt-7">
        Convene the tribunal
      </button>
    </div>
  );
}

function Transport({ pb }: { pb: HearingState }) {
  const status =
    pb.phase === "ready"
      ? "deliberation complete"
      : pb.phase === "verdict"
        ? "ruled"
        : pb.live
          ? "in session · live"
          : "in session";
  return (
    <div className="flex items-center gap-4 border-t border-cinkline px-6 py-4">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: pb.phase === "debate" ? "var(--c-brass)" : "var(--c-ink-line)" }}
      />
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-cink2">
        <motion.div
          className="h-full bg-cbrass"
          animate={{ width: `${Math.round(pb.progress * 100)}%` }}
          transition={{ ease: "linear" }}
        />
      </div>
      <span className="keb shrink-0 text-cchalkdim">{status}</span>
    </div>
  );
}

/* --------------------------------------------------------------- right rail */

function RightRail({
  transcript,
  activeRefs,
  focus,
  onFocus,
  pb,
}: {
  transcript: Transcript;
  activeRefs: Set<string>;
  focus: string | null;
  onFocus: (id: string | null) => void;
  pb: HearingState;
}) {
  const statutes = transcript.evidence.filter((e) => e.kind === "statute");
  const records = transcript.evidence.filter((e) => e.kind !== "statute");

  return (
    <div className="flex flex-col gap-7">
      <section>
        <div className="keb mb-3 text-cchalkdim">Authority & evidence</div>
        <div className="flex flex-col gap-2">
          {statutes.map((e) => (
            <StatuteCard
              key={e.id}
              e={e}
              hot={activeRefs.has(e.id) || focus === e.id}
              onClick={() => onFocus(e.id)}
            />
          ))}
          {records.map((e) => (
            <RecordCard
              key={e.id}
              e={e}
              hot={activeRefs.has(e.id) || focus === e.id}
              onClick={() => onFocus(e.id)}
            />
          ))}
        </div>
      </section>

      <RulingPanel transcript={transcript} pb={pb} />
    </div>
  );
}

function StatuteCard({ e, hot, onClick }: { e: EvidenceItem; hot: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-sm border bg-cink2 px-3 py-2.5 text-left transition-colors"
      style={{ borderColor: hot ? "var(--c-brass)" : "var(--c-ink-line)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-medium text-cchalk">{e.label}</span>
        <span className="mono shrink-0 text-[10px] text-cbrass">{e.cite}</span>
      </div>
      {e.authority && (
        <p className="mt-1 text-[11.5px] leading-snug text-cchalkdim">{e.authority}</p>
      )}
    </button>
  );
}

function RecordCard({ e, hot, onClick }: { e: EvidenceItem; hot: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-sm border bg-cink2 px-3 py-2 text-left transition-colors"
      style={{ borderColor: hot ? "var(--c-brass)" : "var(--c-ink-line)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="mono text-[10px] text-cchalkdim">{e.id}</span>
        <span className="keb !text-[9px] !tracking-[0.14em] text-cslate">{e.kind}</span>
      </div>
      <div className="mt-0.5 text-[12.5px] text-cchalk">{e.label}</div>
      {e.detail && <div className="mt-0.5 text-[11.5px] leading-snug text-cchalkdim">{e.detail}</div>}
      <div className="mono mt-1 text-[10px] text-cslate">{e.cite}</div>
    </button>
  );
}

function RulingPanel({
  transcript,
  pb,
}: {
  transcript: Transcript;
  pb: HearingState;
}) {
  const [choice, setChoice] = useState<"OVERTURNED" | "UPHELD" | "REMANDED">("OVERTURNED");
  const ruled = pb.phase === "verdict";
  const ready = pb.phase === "ready";
  const v = pb.verdict;

  return (
    <section>
      <div className="keb mb-3 text-cchalkdim">Your ruling</div>

      {!ready && !ruled && (
        <p className="rounded-sm border border-cinkline bg-cink2 px-3 py-3 text-[12.5px] leading-relaxed text-cchalkdim">
          Hear both sides through. The ruling unlocks once deliberation is complete.
        </p>
      )}

      {ready && (
        <div className="flex flex-col gap-3 rounded-sm border border-cinkline bg-cink2 p-3">
          <div className="grid grid-cols-3 gap-1.5">
            {(["OVERTURNED", "UPHELD", "REMANDED"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setChoice(c)}
                className="rounded-sm border px-2 py-2 text-[12px] transition-colors"
                style={{
                  borderColor: choice === c ? "var(--c-brass)" : "var(--c-ink-line)",
                  color: choice === c ? "var(--c-chalk)" : "var(--c-chalk-dim)",
                  background: choice === c ? "var(--c-ink)" : "transparent",
                }}
              >
                {c === "OVERTURNED" ? "Overturn" : c === "UPHELD" ? "Uphold" : "Remand"}
              </button>
            ))}
          </div>
          <button onClick={pb.deliverVerdict} className="btn btn-brass !py-2.5 !text-[13px]">
            Seal ruling and draft appeal
          </button>
        </div>
      )}

      {ruled && (
        <div className="flex flex-col gap-4">
          <div className="rounded-sm border border-cinkline bg-cink2 p-4">
            <div
              className="display text-2xl"
              style={{ color: v.decision === "UPHELD" ? "var(--c-oxblood)" : "var(--c-brass)" }}
            >
              {v.decision}
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-cchalkdim">{v.rationale}</p>
            <div className="mono mt-3 text-[10px] text-cslate">
              {v.by} · sealed to audit · {transcript.auditRoot}
            </div>
          </div>

          <AnimatePresence>
            {transcript.appealLetter && <AppealLetter text={transcript.appealLetter} />}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

function AppealLetter({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="overflow-hidden rounded-sm border border-cinkline"
    >
      <div className="flex items-center justify-between border-b border-cinkline bg-cink2 px-3 py-2">
        <span className="keb !text-[9px] text-cchalkdim">Drafted appeal</span>
        <span className="keb !text-[9px]" style={{ color: "var(--c-brass)" }}>
          ready
        </span>
      </div>
      <div className="bg-cpaper px-4 py-4">
        <pre
          className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-[#1a1d23]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {text}
        </pre>
      </div>
      <div className="flex gap-2 border-t border-cinkline bg-cink2 px-3 py-2">
        <button className="btn btn-line-ink !px-3 !py-1.5 !text-[11px]">Export PDF</button>
        <button className="btn btn-brass !px-3 !py-1.5 !text-[11px]">Send to insurer</button>
      </div>
    </motion.div>
  );
}
